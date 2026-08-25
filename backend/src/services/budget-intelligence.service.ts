import { createClaudeMessage } from '../ai/anthropic-client.js';
import { ANTHROPIC_MODEL_FALLBACKS } from '../ai/anthropic-models.js';
import { extractJsonFromClaudeText } from '../utils/claude-json.js';
import { withTimeoutFallback } from '../utils/withTimeout.js';
import type { AccountBudgetBreakdown, BudgetCampaignRow } from './google-ads.service.js';

export interface BudgetRecommendationAction {
  priority: 'critical' | 'high' | 'medium';
  title: string;
  detail: string;
  moveFrom?: string;
  moveTo?: string;
  amount?: number;
  expectedImpact?: string;
}

export interface BudgetReallocationRow {
  entityType: 'campaign' | 'keyword' | 'ad';
  name: string;
  currentDaily: number;
  recommendedDaily: number;
  rationale: string;
}

export interface BudgetRecommendations {
  summary: string;
  actions: BudgetRecommendationAction[];
  reallocation: BudgetReallocationRow[];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function claudeText(response: { content: Array<{ type: string; text?: string }> }): string {
  return response.content.map((b) => (b.type === 'text' ? b.text ?? '' : '')).join('\n');
}

function normalizeRecommendations(
  parsed: Partial<BudgetRecommendations> | null | undefined
): BudgetRecommendations | null {
  if (!parsed) return null;
  const actions = Array.isArray(parsed.actions)
    ? parsed.actions
        .filter((a) => a?.title && a?.detail)
        .slice(0, 8)
        .map((a) => ({
          priority: a.priority === 'critical' || a.priority === 'high' ? a.priority : 'medium' as const,
          title: String(a.title).slice(0, 140),
          detail: String(a.detail).slice(0, 600),
          moveFrom: a.moveFrom ? String(a.moveFrom).slice(0, 120) : undefined,
          moveTo: a.moveTo ? String(a.moveTo).slice(0, 120) : undefined,
          amount: typeof a.amount === 'number' && Number.isFinite(a.amount) ? a.amount : undefined,
          expectedImpact: a.expectedImpact ? String(a.expectedImpact).slice(0, 200) : undefined,
        }))
    : [];
  const reallocation = Array.isArray(parsed.reallocation)
    ? parsed.reallocation
        .filter((r) => r?.name)
        .slice(0, 10)
        .map((r) => ({
          entityType:
            r.entityType === 'keyword' || r.entityType === 'ad' ? r.entityType : ('campaign' as const),
          name: String(r.name).slice(0, 140),
          currentDaily: Number(r.currentDaily) || 0,
          recommendedDaily: Number(r.recommendedDaily) || 0,
          rationale: String(r.rationale ?? '').slice(0, 280),
        }))
    : [];
  if (!actions.length && !reallocation.length && !parsed.summary) return null;
  return {
    summary: String(parsed.summary || '').slice(0, 800),
    actions,
    reallocation,
  };
}

function mergeReallocation(rows: BudgetReallocationRow[]): BudgetReallocationRow[] {
  const byName = new Map<string, BudgetReallocationRow>();
  for (const row of rows) {
    byName.set(`${row.entityType}:${row.name}`, row);
  }
  return [...byName.values()].slice(0, 10);
}

export function heuristicBudgetRecommendations(
  breakdown: AccountBudgetBreakdown
): BudgetRecommendations {
  const ccy = breakdown.account.currency || 'USD';
  const windowDays = breakdown.account.windowDays || 30;
  const enabled = breakdown.campaigns.filter((c) => c.status === 'ENABLED' && c.dailyBudget > 0);
  const pool = enabled.length ? enabled : breakdown.campaigns.filter((c) => c.dailyBudget > 0);

  const actions: BudgetRecommendationAction[] = [];
  const realloc: BudgetReallocationRow[] = [];

  const constrained = [...pool]
    .filter((c) => c.budgetUtilization >= 90 && (c.budgetLostIs ?? 0) >= 5)
    .sort((a, b) => (b.budgetLostIs ?? 0) - (a.budgetLostIs ?? 0));
  const underspent = [...pool]
    .filter((c) => c.budgetUtilization < 70 && c.leftover > 0)
    .sort((a, b) => b.leftover - a.leftover);
  const wasted = [...pool]
    .filter((c) => c.spend >= 5 && c.conversions < 0.5)
    .sort((a, b) => b.spend - a.spend);
  const winners = [...pool]
    .filter((c) => c.conversions >= 1)
    .sort((a, b) => (a.costPerConversion || 1e9) - (b.costPerConversion || 1e9));

  const shiftDaily = (
    from: BudgetCampaignRow,
    to: BudgetCampaignRow,
    rawAmount: number,
    why: string,
    priority: BudgetRecommendationAction['priority']
  ) => {
    const amount = round2(
      Math.min(Math.max(rawAmount, 1), from.dailyBudget * 0.4, Math.max(1, from.dailyBudget * 0.25))
    );
    if (amount < 0.5 || from.campaignId === to.campaignId) return;
    actions.push({
      priority,
      title: `Shift ${ccy} ${amount.toFixed(2)}/day into ${to.name}`,
      detail: why,
      moveFrom: from.name,
      moveTo: to.name,
      amount,
      expectedImpact: 'Keep account spend similar while funding the stronger campaign.',
    });
    realloc.push({
      entityType: 'campaign',
      name: from.name,
      currentDaily: from.dailyBudget,
      recommendedDaily: round2(Math.max(1, from.dailyBudget - amount)),
      rationale: why,
    });
    realloc.push({
      entityType: 'campaign',
      name: to.name,
      currentDaily: to.dailyBudget,
      recommendedDaily: round2(to.dailyBudget + amount),
      rationale: why,
    });
  };

  if (underspent[0] && constrained[0]) {
    const from = underspent[0];
    const to = constrained[0];
    const dailyLeftover = from.leftover / windowDays;
    shiftDaily(
      from,
      to,
      Math.max(1, dailyLeftover * 0.5),
      `${from.name} is underspent (${from.budgetUtilization}% of period budget used, leftover ${ccy} ${from.leftover.toFixed(0)}). ${to.name} is budget-capped (${to.budgetUtilization}% util, ${to.budgetLostIs ?? 0}% impression share lost to budget).`,
      'high'
    );
  }

  if (wasted[0] && winners[0]) {
    shiftDaily(
      wasted[0],
      winners[0],
      wasted[0].dailyBudget * 0.25,
      `${wasted[0].name} spent ${ccy} ${wasted[0].spend.toFixed(0)} with ${wasted[0].conversions.toFixed(1)} conversions. ${winners[0].name} converts at CPA ${ccy} ${winners[0].costPerConversion.toFixed(2)}.`,
      wasted[0].spend > 50 ? 'critical' : 'high'
    );
  }

  if (breakdown.account.leftover > 20 && constrained[0]) {
    const bump = round2(
      Math.min(constrained[0].dailyBudget * 0.2, (breakdown.account.leftover / windowDays) * 0.35)
    );
    const alreadyBoosted = realloc.some(
      (r) => r.name === constrained[0].name && r.recommendedDaily > r.currentDaily
    );
    if (bump >= 1 && !alreadyBoosted) {
      actions.push({
        priority: 'high',
        title: `Raise ${constrained[0].name} by ${ccy} ${bump.toFixed(2)}/day`,
        detail: `Account leftover is ${ccy} ${breakdown.account.leftover.toFixed(0)} over ${windowDays} days while this campaign is losing impression share to budget.`,
        moveTo: constrained[0].name,
        amount: bump,
        expectedImpact: 'Recover budget-lost Search impression share without adding wasteful spend elsewhere.',
      });
      realloc.push({
        entityType: 'campaign',
        name: constrained[0].name,
        currentDaily: constrained[0].dailyBudget,
        recommendedDaily: round2(constrained[0].dailyBudget + bump),
        rationale: 'Constrained winner with leftover account budget.',
      });
    }
  }

  for (const kw of breakdown.keywords.filter((k) => k.spend >= 8 && k.conversions < 0.5).slice(0, 3)) {
    actions.push({
      priority: 'medium',
      title: `Pause or bid down “${kw.keyword}”`,
      detail: `${kw.keyword} (${kw.matchType.replace(/_/g, ' ')}) spent ${ccy} ${kw.spend.toFixed(0)} in ${kw.campaignName} with ${kw.conversions.toFixed(1)} conversions. Move that budget to converting keywords or the best campaign.`,
      moveFrom: kw.keyword,
      moveTo: winners[0]?.name,
      amount: round2(kw.spend / windowDays),
    });
  }

  if (!actions.length && pool.length) {
    const top = [...pool].sort((a, b) => b.spend - a.spend)[0];
    actions.push({
      priority: 'medium',
      title: 'Hold mix; reallocate only after CPA moves',
      detail: `${top.name} is the largest spender (${ccy} ${top.spend.toFixed(0)}, ${top.budgetUtilization}% util). No strong leftover-to-constrained or zero-conversion shift stood out in this window — watch CPA and budget-lost impression share before raising total spend.`,
    });
  }

  const leftoverNote =
    breakdown.account.leftover > 0
      ? ` About ${ccy} ${breakdown.account.leftover.toFixed(0)} of enabled budget was unused.`
      : '';
  const summary =
    pool.length === 0
      ? 'No campaign budgets to allocate in this window.'
      : `${windowDays}-day spend is ${ccy} ${breakdown.account.totalSpend.toFixed(0)} vs ${ccy} ${breakdown.account.expectedSpend.toFixed(0)} expected from enabled daily budgets (${breakdown.account.pacePercent}% pace).${leftoverNote} Shift leftover and zero-conversion spend toward campaigns with conversions and budget-lost impression share.`;

  return {
    summary,
    actions: actions.slice(0, 7),
    reallocation: mergeReallocation(realloc),
  };
}

export async function generateBudgetRecommendations(
  breakdown: AccountBudgetBreakdown
): Promise<BudgetRecommendations> {
  const heuristic = heuristicBudgetRecommendations(breakdown);

  const campaigns = breakdown.campaigns.slice(0, 12).map((c) => ({
    name: c.name,
    type: c.type,
    status: c.status,
    dailyBudget: c.dailyBudget,
    spend: c.spend,
    utilization: c.budgetUtilization,
    leftover: c.leftover,
    conv: c.conversions,
    cpa: c.costPerConversion,
    cpc: c.avgCpc,
    convRate: c.conversionRate,
    spendShare: c.spendShare,
    is: c.searchImpressionShare,
    budgetLostIs: c.budgetLostIs,
  }));
  const keywords = breakdown.keywords.slice(0, 20).map((k) => ({
    keyword: k.keyword,
    match: k.matchType,
    campaign: k.campaignName,
    spend: k.spend,
    conv: k.conversions,
    cpa: k.costPerConversion,
    qs: k.qualityScore,
    cpc: k.avgCpc,
  }));
  const ads = breakdown.ads.slice(0, 12).map((a) => ({
    headline: a.headline,
    campaign: a.campaignName,
    spend: a.spend,
    conv: a.conversions,
    cpa: a.costPerConversion,
  }));

  const parsed = await withTimeoutFallback(
    (async () => {
      const response = await createClaudeMessage(
        {
          max_tokens: 1400,
          messages: [
            {
              role: 'user',
              content: `You are a senior Google Ads media buyer. Recommend how to reallocate budget for this account.

Account (${breakdown.account.windowDays}d, ${breakdown.account.currency}):
spend=${breakdown.account.totalSpend}, enabled daily budget=${breakdown.account.enabledDailyBudget},
expected if fully spent=${breakdown.account.expectedSpend}, pace=${breakdown.account.pacePercent}%,
CPA=${breakdown.account.costPerConversion}, conv=${breakdown.account.conversions},
constrained campaigns=${breakdown.account.constrainedCampaigns}, underspent=${breakdown.account.underspentCampaigns}

Campaigns:
${JSON.stringify(campaigns)}

Top keywords by spend:
${JSON.stringify(keywords)}

Top ads by spend:
${JSON.stringify(ads)}

Rules:
- Be specific: name campaigns/keywords and $ amounts in ${breakdown.account.currency}.
- Prefer shifting leftover or wasted spend (high cost, 0 conversions) into budget-constrained winners (high util + budget-lost IS or strong CPA).
- Do not recommend increasing total account spend unless leftover is tiny AND winners are constrained.
- Daily budget changes should be realistic (typically ±10–40%).
- 4–7 actions. Prioritise critical/high first.

Return ONLY JSON:
{
  "summary": "2-3 sentence expert readout",
  "actions": [{"priority":"critical|high|medium","title":"...","detail":"...","moveFrom":"...","moveTo":"...","amount":0,"expectedImpact":"..."}],
  "reallocation": [{"entityType":"campaign|keyword|ad","name":"...","currentDaily":0,"recommendedDaily":0,"rationale":"..."}]
}`,
            },
          ],
        },
        undefined,
        ANTHROPIC_MODEL_FALLBACKS
      );
      return extractJsonFromClaudeText(claudeText(response)) as Partial<BudgetRecommendations>;
    })(),
    14_000,
    heuristic,
    'budget-recommendations'
  );

  const ai = parsed === heuristic ? null : normalizeRecommendations(parsed);
  if (ai?.actions.length) {
    return {
      summary: (ai.summary || heuristic.summary).slice(0, 800),
      actions: ai.actions,
      reallocation: ai.reallocation.length ? ai.reallocation : heuristic.reallocation,
    };
  }

  return heuristic;
}
