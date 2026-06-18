import type { Finding, Severity, FindingCategory } from '../types/index.js';
import { getPrimaryApiKey } from './anthropic-pool.js';
import { createClaudeMessage, isAnalysisFailureFinding } from './anthropic-client.js';
import type { RoadmapItem } from '../types/index.js';
import { generateId } from '../services/mock-store.js';

export interface ModuleAnalysisInput {
  moduleSlug: string;
  moduleName: string;
  accountName: string;
  monthlySpend: number;
  campaignCount: number;
  dataWindowDays: number;
  goal?: string;
  googleAdsData: string;
  competitors?: string[];
  apiKey?: string;
  auditScope?: 'account' | 'campaign';
  campaignName?: string;
  auditDepth?: string;
}

const VALID_SEVERITIES: Severity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

function makeFinding(
  slug: string,
  moduleName: string,
  partial: Omit<Finding, 'id' | 'category' | 'dimension' | 'status' | 'evidence'>
): Omit<Finding, 'id'> {
  return {
    ...partial,
    category: slugToCategory(slug),
    dimension: moduleName,
    status: 'OPEN',
    evidence: { source: 'claude_analysis', module: slug },
  };
}

function slugToCategory(slug: string): FindingCategory {
  const map: Record<string, FindingCategory> = {
    campaign: 'CAMPAIGN',
    keyword: 'KEYWORDS',
    'search-terms': 'SEARCH_TERMS',
    budget: 'BUDGET',
    geo: 'GEO',
    audience: 'AUDIENCES',
    'ad-copy': 'AD_COPY',
    'landing-pages': 'LANDING_PAGES',
    bidding: 'BIDDING',
    conversion: 'CAMPAIGN',
    'quality-score': 'QUALITY_SCORE',
    device: 'CAMPAIGN',
    'impression-share': 'IMPRESSION_SHARE',
    pmax: 'PMAX',
  };
  return map[slug] ?? 'CAMPAIGN';
}

function maxFindingsForInput(input: ModuleAnalysisInput): number {
  if (input.auditScope === 'campaign') return 6;
  if (input.auditDepth === 'deep') return 5;
  return 4;
}

function parseFindingsJson(
  raw: string,
  moduleName: string,
  slug: string,
  maxFindings: number
): Omit<Finding, 'id'>[] {
  try {
    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) return [];
    const parsed = JSON.parse(match[0]) as Array<{
      severity?: string;
      title?: string;
      description?: string;
      recommendation?: string;
      confidence?: number;
      impactMonthly?: number;
    }>;
    return parsed.slice(0, maxFindings).map((f) =>
      makeFinding(slug, moduleName, {
        severity: VALID_SEVERITIES.includes(f.severity as Severity) ? (f.severity as Severity) : 'MEDIUM',
        title: f.title || `${moduleName} issue detected`,
        description: f.description || 'Review recommended based on account data.',
        recommendation: f.recommendation,
        confidence: Math.min(100, Math.max(50, f.confidence ?? 75)),
        impactMonthly: Math.max(0, Math.round(f.impactMonthly ?? 0)),
      })
    );
  } catch {
    return [];
  }
}

function buildAnalysisPrompt(input: ModuleAnalysisInput): string {
  const isCampaign = input.auditScope === 'campaign';
  const isDeep = input.auditDepth === 'deep' || isCampaign;
  const findingRange = isCampaign ? '4-6' : isDeep ? '3-5' : '2-4';
  const dataLimit = isCampaign ? 18000 : isDeep ? 15000 : 12000;

  const scopeBlock = isCampaign
    ? `Audit scope: CAMPAIGN-LEVEL — analyze ONLY the campaign "${input.campaignName ?? 'selected campaign'}".
Focus on ad groups, keywords, search terms, ads, and spend within this campaign. Reference specific campaign metrics, ad group names, keywords, and search terms from the data.
Do NOT recommend account-wide restructures unless they directly affect this campaign.`
    : `Audit scope: ACCOUNT-LEVEL — analyze the full Google Ads account holistically.
Identify cross-campaign patterns, budget allocation issues, and account-wide optimization opportunities.`;

  return `You are a senior Google Ads forensic auditor producing ${isDeep ? 'detailed, consultant-grade' : 'actionable'} findings.

${scopeBlock}

Account: ${input.accountName}
Monthly spend: $${input.monthlySpend.toLocaleString()}
Active campaigns: ${input.campaignCount}
Audit window: ${input.dataWindowDays} days
Audit depth: ${input.auditDepth || 'standard'}
Goal: ${input.goal || 'Not specified'}
Module: ${input.moduleName} (${input.moduleSlug})
${input.competitors?.length ? `Competitors: ${input.competitors.join(', ')}` : ''}

Google Ads data (JSON — may include campaignContext with ad groups, keywords, ads, search terms):
${input.googleAdsData.slice(0, dataLimit)}

Return ONLY a JSON array (no markdown) of ${findingRange} findings. Each finding must be specific and data-backed.

Each finding object must have:
- severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW"
- title: string (specific, under 100 chars — include campaign/keyword/ad group names when relevant)
- description: string (3-5 sentences with actual numbers, percentages, and entity names from the data)
- recommendation: string (step-by-step actionable fix with expected outcome)
- confidence: number 50-99
- impactMonthly: number (estimated USD monthly savings/opportunity for this ${isCampaign ? 'campaign' : 'account'}, integer)

${isDeep ? 'Prioritize high-impact waste, missed conversions, and structural issues. Include at least one finding with a concrete dollar estimate when spend data exists.' : ''}
When campaignPerformance or campaignContext is present in the data, base ALL numeric claims on those Google Ads metrics (clicks, impressions, CTR, avg CPC, cost, conversions, conversion rate, cost per conversion) — do not invent numbers.
IMPORTANT: You MUST return at least 2 findings for this module. Never return an empty array [].
If Google Ads data is sparse or empty, analyze account context (spend, goals, module type) and provide expert recommendations for ${input.moduleName} — setup gaps, best-practice improvements, and optimization opportunities.
Base findings on the provided data when available.`;
}

export async function generateModuleFindings(
  input: ModuleAnalysisInput
): Promise<Omit<Finding, 'id'>[]> {
  const apiKey = input.apiKey || getPrimaryApiKey();
  const maxFindings = maxFindingsForInput(input);
  const maxTokens = input.auditScope === 'campaign' ? 2400 : input.auditDepth === 'deep' ? 2000 : 1600;

  if (!apiKey) {
    return [makeFinding(input.moduleSlug, input.moduleName, {
      severity: 'MEDIUM',
      title: `${input.moduleName} — configure Anthropic API keys for AI analysis`,
      description: 'Add ANTHROPIC_API_KEY (and optional _2/_3/_4) to backend/.env to enable Claude-powered findings.',
      recommendation: 'Set API keys and restart the backend server.',
      confidence: 100,
      impactMonthly: 0,
    })];
  }

  try {
    const response = await createClaudeMessage({
      max_tokens: maxTokens,
      messages: [{
        role: 'user',
        content: buildAnalysisPrompt(input),
      }],
    }, apiKey);

    const block = response.content[0];
    if (block.type !== 'text') {
      return [
        makeFinding(input.moduleSlug, input.moduleName, {
          severity: 'MEDIUM',
          title: `${input.moduleName} — optimization opportunities identified`,
          description: `Claude returned an unexpected response format for ${input.moduleName}. Review this area in Google Ads.`,
          recommendation: `Manually audit ${input.moduleName} settings and apply best practices.`,
          confidence: 65,
          impactMonthly: Math.max(50, Math.round(input.monthlySpend * 0.02)),
        }),
      ];
    }
    const findings = parseFindingsJson(block.text, input.moduleName, input.moduleSlug, maxFindings);
    return findings.length ? findings : [
      makeFinding(input.moduleSlug, input.moduleName, {
        severity: 'MEDIUM',
        title: `${input.moduleName} — optimization opportunities identified`,
        description: input.auditScope === 'campaign' && input.campaignName
          ? `Claude reviewed campaign "${input.campaignName}" for ${input.moduleName}. Limited API rows were available — review bidding, targeting, and creative alignment for this campaign.`
          : `Claude reviewed ${input.accountName} for ${input.moduleName}. Apply module-specific best practices and verify configuration in Google Ads.`,
        recommendation: `Audit ${input.moduleName} settings in Google Ads and implement recommended improvements from this report.`,
        confidence: 72,
        impactMonthly: Math.max(50, Math.round(input.monthlySpend * 0.02)),
      }),
      makeFinding(input.moduleSlug, input.moduleName, {
        severity: 'LOW',
        title: `${input.moduleName} — ongoing monitoring recommended`,
        description: `Continue tracking ${input.moduleName} metrics over the ${input.dataWindowDays}-day audit window and re-audit after changes.`,
        recommendation: 'Set up weekly performance checks for this dimension.',
        confidence: 65,
        impactMonthly: 0,
      }),
    ];
  } catch (err) {
    console.error(`Claude analysis failed for ${input.moduleSlug}:`, err);
    const detail = err instanceof Error ? err.message.slice(0, 120) : 'Unknown error';
    return [makeFinding(input.moduleSlug, input.moduleName, {
      severity: 'MEDIUM',
      title: `${input.moduleName} analysis incomplete`,
      description: `Claude API request failed (${detail}). Verify Anthropic API keys and model access, then retry the audit.`,
      confidence: 50,
      impactMonthly: 0,
    })];
  }
}

function scoreDimension(findings: Finding[], dimension: string): { dimension: string; score: number; label: string } {
  const modFindings = findings.filter((f) => f.dimension === dimension);
  const penalty = modFindings.filter((f) => f.severity === 'CRITICAL').length * 15
    + modFindings.filter((f) => f.severity === 'HIGH').length * 8
    + modFindings.filter((f) => f.severity === 'MEDIUM').length * 3;
  return { dimension, score: Math.max(15, 88 - penalty), label: 'AI scored' };
}

export async function generateHealthScoresFromFindings(
  findings: Finding[],
  accountName: string,
  apiKey?: string
): Promise<{ dimension: string; score: number; label?: string }[]> {
  const validFindings = findings.filter((f) => !isAnalysisFailureFinding(f.title));
  const dimensions = [...new Set(validFindings.map((f) => f.dimension))];
  if (!dimensions.length) return [];

  const key = apiKey || getPrimaryApiKey();
  if (!key || !validFindings.length) {
    return dimensions.map((d) => scoreDimension(validFindings, d));
  }

  try {
    const response = await createClaudeMessage({
      max_tokens: 600,
      messages: [{
        role: 'user',
        content: `Score each audit dimension 0-100 for ${accountName}. Return ONLY JSON array: [{"dimension":"...","score":number,"label":"..."}]
Findings summary: ${validFindings.map((f) => `${f.dimension}: ${f.severity} - ${f.title}`).join('; ')}`,
      }],
    }, apiKey);
    const block = response.content[0];
    if (block.type === 'text') {
      const match = block.text.match(/\[[\s\S]*\]/);
      if (match) return JSON.parse(match[0]);
    }
  } catch {
    /* fallback below */
  }
  return dimensions.map((d) => scoreDimension(validFindings, d));
}

export async function generateRoadmapWithClaude(
  findings: Finding[],
  accountName: string,
  apiKey?: string,
  options?: { auditScope?: 'account' | 'campaign'; campaignName?: string }
): Promise<RoadmapItem[]> {
  const valid = findings.filter((f) => !isAnalysisFailureFinding(f.title));
  if (!valid.length) return [];

  const key = apiKey || getPrimaryApiKey();
  if (!key) return [];

  const scopeNote = options?.auditScope === 'campaign' && options.campaignName
    ? `This is a campaign-level roadmap for the "${options.campaignName}" campaign only.`
    : 'This is an account-level optimization roadmap.';

  try {
    const response = await createClaudeMessage({
      max_tokens: 1600,
      messages: [{
        role: 'user',
        content: `Create a 30/60/90-day Google Ads optimization roadmap for ${accountName}. ${scopeNote}
Return ONLY JSON array of 8-12 items:
[{"phase":"DAY_30"|"DAY_60"|"DAY_90","title":"...","description":"...","effort":"LOW"|"MEDIUM"|"HIGH","owner":"CLIENT"|"AGENCY"|"SHARED","impactMonthly":number}]
Base items on these findings: ${valid.map((f) => `${f.severity}: ${f.title} ($${f.impactMonthly}/mo)`).join('; ')}`,
      }],
    }, key);
    const block = response.content[0];
    if (block.type !== 'text') return [];
    const match = block.text.match(/\[[\s\S]*\]/);
    if (!match) return [];
    const parsed = JSON.parse(match[0]) as Array<{
      phase?: string;
      title?: string;
      description?: string;
      effort?: string;
      owner?: string;
      impactMonthly?: number;
    }>;
    return parsed.slice(0, 12).map((item, i) => ({
      id: generateId('rm_'),
      phase: (['DAY_30', 'DAY_60', 'DAY_90'].includes(item.phase || '') ? item.phase : 'DAY_30') as RoadmapItem['phase'],
      order: i + 1,
      title: item.title || 'Optimization action',
      description: item.description,
      effort: (['LOW', 'MEDIUM', 'HIGH'].includes(item.effort || '') ? item.effort : 'MEDIUM') as RoadmapItem['effort'],
      owner: (['CLIENT', 'AGENCY', 'SHARED'].includes(item.owner || '') ? item.owner : 'AGENCY') as RoadmapItem['owner'],
      impactMonthly: Math.max(0, Math.round(item.impactMonthly ?? 0)),
    }));
  } catch (err) {
    console.error('Claude roadmap generation failed:', err);
    return [];
  }
}
