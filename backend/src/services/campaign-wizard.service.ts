import { extractServicesFromWebsite } from './website-scraper.service.js';
import {
  resolveMarketCountry,
  countryToLocationLabel,
} from '../utils/region-codes.js';
import {
  fetchOrganicKeywords,
  fetchMatchingKeywords,
  clusterKeywordsByService,
  buildClusterFromKeywords,
  dedupeKeywords,
  filterQuickWinKeywords,
  filterKeywordsForServiceSeed,
  isAhrefsConfigured,
  isAhrefsQuotaExhausted,
  pickSeedKeywords,
  filterBuyerIntentKeywords,
  suggestKeywordCpc,
  suggestKeywordMatch,
  scoreKeywordForBudget,
  annotateKeyword,
  type AhrefsOrganicKeyword,
  type KeywordCluster,
} from './ahrefs.service.js';
import {
  analyzeCompetitors,
  type CompetitorAdPreview,
  type CompetitorIntelligence,
} from './competitor-intelligence.service.js';
import { AD_RELEVANCE_THRESHOLD } from '../utils/ad-keyword-relevance.js';
import {
  copyConflictsWithLegalService,
  filterSeedKeywordsForService,
  looksLikeQueryNotAdvertiser,
} from '../utils/service-seed-match.js';
import { clearSociaVaultCreditPause, isSociaVaultCreditsExhausted } from './sociavault-google-ad-library.service.js';
import { claudeTextFromMessage, createClaudeMessage } from '../ai/anthropic-client.js';
import { ANTHROPIC_OPTIMIZE_MODEL_FALLBACKS } from '../ai/anthropic-models.js';
import { extractJsonFromClaudeText } from '../utils/claude-json.js';
import { withTimeoutFallback } from '../utils/withTimeout.js';

// ─── Step 1: Scrape website → services ───────────────────────────

export interface DiscoverServicesResult {
  companyName: string;
  industry: string;
  services: string[];
  scrapeStatus?: 'ok' | 'blocked' | 'empty' | 'inferred';
}

export async function discoverServices(
  websiteUrl: string
): Promise<DiscoverServicesResult> {
  return extractServicesFromWebsite(websiteUrl);
}

// ─── Step 2: Ahrefs keyword clusters ─────────────────────────────

export interface KeywordClusterResult {
  clusters: KeywordCluster[];
  ahrefsAvailable: boolean;
  totalKeywords: number;
  suggestedNegatives: string[];
}

const AD_COPY_STOP = new Set([
  'the', 'and', 'for', 'you', 'your', 'our', 'with', 'from', 'this', 'that', 'are', 'was',
  'not', 'all', 'get', 'now', 'new', 'best', 'free', 'top', 'www', 'http', 'https', 'com',
]);

export function extractPhrasesFromAdCopy(texts: string[], service: string): string[] {
  const svcTokens = service
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length >= 2);
  const out = new Set<string>();
  for (const raw of texts) {
    const words = raw
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 2 && !AD_COPY_STOP.has(w));
    for (let n = 2; n <= 5; n++) {
      for (let i = 0; i + n <= words.length; i++) {
        const phrase = words.slice(i, i + n).join(' ');
        if (phrase.length < 6) continue;
        if (svcTokens.some((t) => phrase.includes(t))) out.add(phrase);
      }
    }
  }
  return [...out].slice(0, 30);
}

export function suggestNegativeKeywords(opts: {
  competitorNames: string[];
  adTexts: string[];
  service: string;
}): string[] {
  const negs = new Set<string>();
  const serviceLower = opts.service.toLowerCase();
  for (const name of opts.competitorNames) {
    const brand = name
      .replace(/\b(pty|ltd|inc|llc|limited|group|australia|services?)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (brand.length < 3 || brand.toLowerCase() === serviceLower) continue;
    if (brand.split(/\s+/).length <= 4) negs.add(brand);
  }
  const informational = [
    'jobs',
    'salary',
    'career',
    'how to',
    'what is',
    'diy',
    'course',
    'training',
    'wikipedia',
    'reddit',
    'template',
  ];
  const blob = opts.adTexts.join(' ').toLowerCase();
  for (const term of informational) {
    if (blob.includes(term)) negs.add(term);
  }
  return [...negs].slice(0, 20);
}

async function generateFallbackKeywords(
  service: string,
  offer?: string,
  country = 'au'
): Promise<AhrefsOrganicKeyword[]> {
  const prompt = `Generate 20 quick-win Google Ads search keywords for this EXACT service in ${country.toUpperCase()}.

Service: ${service}
${offer ? `Offer/promo: ${offer}` : ''}

CRITICAL: Every keyword MUST relate to "${service}" specifically — include ALL significant words from the service name.
Example: for "AI SEO" every keyword must contain both "ai" and "seo" — NOT generic "seo services" or "local seo".

Quick-win criteria: low competition, realistic to rank/win quickly, clear commercial intent.
Prefer long-tail and local variants over ultra-competitive head terms.

Return a JSON array of keyword strings only.
Return ONLY the JSON array.`;

  try {
    const response = await createClaudeMessage({
      model: ANTHROPIC_OPTIMIZE_MODEL_FALLBACKS[0]!,
      max_tokens: 1200,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = claudeTextFromMessage(response);

    const parsed = extractJsonFromClaudeText(text);
    if (!Array.isArray(parsed)) return [];

    return (parsed as unknown[])
      .filter((k): k is string => typeof k === 'string' && k.trim().length > 0)
      .slice(0, 25)
      .map((keyword) => ({
        keyword: keyword.trim(),
        volume: 0,
        position: 0,
        traffic: 0,
        url: '',
      }));
  } catch (err) {
    console.warn(
      '[campaign-wizard] fallback keyword generation failed:',
      err instanceof Error ? err.message : err
    );
    return [{ keyword: service, volume: 0, position: 0, traffic: 0, url: '' }];
  }
}

export async function getKeywordClusters(
  websiteUrl: string,
  services: string[],
  opts?: {
    country?: string;
    offer?: string;
    dailyBudget?: number;
    competitorSeeds?: Record<string, string[]>;
    competitorNames?: string[];
    competitorAdTexts?: string[];
  }
): Promise<KeywordClusterResult> {
  const country = opts?.country ?? 'au';
  const dailyBudget = Number(opts?.dailyBudget) > 0 ? Number(opts?.dailyBudget) : undefined;
  const rankingBudget = dailyBudget ?? 40;
  const ahrefsAvailable = isAhrefsConfigured();
  const selectedServices = [...new Set(services.map((s) => s.trim()).filter(Boolean))];

  if (!selectedServices.length) {
    return { clusters: [], ahrefsAvailable, totalKeywords: 0, suggestedNegatives: [] };
  }

  const domain = websiteUrl
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]!;

  const allKeywords = ahrefsAvailable
    ? await fetchOrganicKeywords(domain, { country, limit: 2000 })
    : [];

  const organicByService = new Map(
    clusterKeywordsByService(allKeywords, selectedServices).map((c) => [c.service, c])
  );

  const clusters: KeywordCluster[] = [];

  for (const service of selectedServices) {
    let keywords: AhrefsOrganicKeyword[] = [...(organicByService.get(service)?.keywords ?? [])];

    const competitorPhrases = [
      ...new Set(
        [
          ...(opts?.competitorSeeds?.[service] ?? []),
          ...extractPhrasesFromAdCopy(opts?.competitorAdTexts ?? [], service),
        ]
          .map((k) => k.trim())
          .filter((k) => k.length >= 3)
      ),
    ].slice(0, 20);

    if (ahrefsAvailable && !isAhrefsQuotaExhausted()) {
      const matching = await fetchMatchingKeywords(service, { country, limit: 80 });
      keywords = dedupeKeywords([...keywords, ...matching]);
      keywords = filterKeywordsForServiceSeed(service, keywords);

      for (const phrase of competitorPhrases.slice(0, 4)) {
        const related = await fetchMatchingKeywords(phrase, { country, limit: 25 });
        keywords = dedupeKeywords([
          ...keywords,
          ...filterKeywordsForServiceSeed(service, related),
          { keyword: phrase, volume: 0, position: 0, traffic: 0, url: '', seed: phrase },
        ]);
      }

      if (opts?.offer?.trim()) {
        const offerSeeds = await fetchMatchingKeywords(`${service} ${opts.offer}`, {
          country,
          limit: 30,
        });
        keywords = dedupeKeywords([
          ...keywords,
          ...filterKeywordsForServiceSeed(service, offerSeeds),
        ]);
      }

      const seeds = pickSeedKeywords(service, keywords, 4);
      for (const seed of seeds) {
        if (seed.toLowerCase() === service.toLowerCase()) continue;
        const related = await fetchMatchingKeywords(seed, { country, limit: 40 });
        keywords = dedupeKeywords([
          ...keywords,
          ...filterKeywordsForServiceSeed(service, related),
        ]);
      }
    }

    for (const phrase of competitorPhrases) {
      keywords = dedupeKeywords([
        ...keywords,
        { keyword: phrase, volume: 0, position: 0, traffic: 0, url: '', seed: phrase },
      ]);
    }

    keywords = filterBuyerIntentKeywords(keywords);
    keywords = filterQuickWinKeywords(keywords, { maxCount: 40, dailyBudget: rankingBudget });
    keywords = filterKeywordsForServiceSeed(service, keywords);

    if (!keywords.length) {
      keywords = [{ keyword: service, volume: 0, position: 0, traffic: 0, url: '' }];
    }

    if (keywords.length < 8) {
      const fallback = await generateFallbackKeywords(service, opts?.offer, country);
      keywords = dedupeKeywords([
        ...keywords,
        ...filterKeywordsForServiceSeed(service, fallback),
      ]);
    }

    clusters.push(buildClusterFromKeywords(service, keywords, rankingBudget));
  }

  const suggestedNegatives = suggestNegativeKeywords({
    competitorNames: opts?.competitorNames ?? [],
    adTexts: opts?.competitorAdTexts ?? [],
    service: selectedServices[0] ?? '',
  });

  return {
    clusters,
    ahrefsAvailable,
    totalKeywords: allKeywords.length,
    suggestedNegatives,
  };
}

export interface BidStrategyOption {
  id: 'MANUAL_CPC' | 'MAXIMIZE_CONVERSIONS';
  label: string;
  recommended: boolean;
  recommendedDailyBudget: number;
  recommendedMaxCpc?: number;
  typicalCpc?: number;
  expectedClicks?: number;
  expectedConversions?: number;
  usesKeywordMaxCpc: boolean;
  situation: string;
  howSpendWorks: string;
}

export interface KeywordBidRecommendation {
  summary: string;
  bidStrategy: 'MANUAL_CPC' | 'MAXIMIZE_CLICKS' | 'MAXIMIZE_CONVERSIONS';
  bidStrategyWhy: string;
  suggestedDailyBudget?: number;
  recommendedMaxCpc?: number;
  keywordCount: number;
  /** How many keywords fit the daily budget at planner/max CPC sizing. */
  recommendedKeywordCount: number;
  maxAffordableKeywords: number;
  avgKeywordCpc: number;
  estClicksPerDay: number;
  selectionNote: string;
  defaultMatchType: 'EXACT' | 'PHRASE';
  accountBudgetNote?: string;
  strategyOptions: BidStrategyOption[];
  themes: Array<{
    service: string;
    seed: string;
    intent: 'transactional' | 'commercial';
    primary: string[];
    secondary: string[];
    phrase: string[];
    exact: string[];
    suggestedCpc?: number;
    recommended: boolean;
  }>;
  recommendedKeywords: Array<{
    keyword: string;
    seed?: string;
    role: 'primary' | 'secondary';
    matchType: 'EXACT' | 'PHRASE';
    intent: 'transactional' | 'commercial';
    suggestedCpc: number;
    recommended: boolean;
    why: string;
  }>;
}

export async function recommendKeywordBids(opts: {
  clusters: KeywordCluster[];
  dailyBudget?: number;
  campaignType?: string;
  location?: string;
  preferredStrategy?: 'MANUAL_CPC' | 'MAXIMIZE_CONVERSIONS';
  budgetContext?: {
    totalSpend?: number;
    enabledDailyBudget?: number;
    leftover?: number;
    costPerConversion?: number;
    avgCpc?: number;
    pacePercent?: number;
    constrainedCampaigns?: number;
    conversions?: number;
    windowDays?: number;
    currency?: string;
  };
}): Promise<KeywordBidRecommendation> {
  const dailyBudget =
    Number(opts.dailyBudget) > 0
      ? Number(opts.dailyBudget)
      : Number(opts.budgetContext?.enabledDailyBudget) > 0
        ? Number(opts.budgetContext?.enabledDailyBudget)
        : 0;
  const sizingBudget = dailyBudget > 0 ? dailyBudget : 40;
  const currency = opts.budgetContext?.currency || 'AUD';
  const strategy = opts.preferredStrategy ?? 'MANUAL_CPC';
  const selection = selectKeywordsForBudget({
    clusters: opts.clusters,
    dailyBudget: sizingBudget,
    avgCpc: opts.budgetContext?.avgCpc,
    strategy,
    currency,
  });
  const fallbackKeywords = selection.keywords;
  const fallback: KeywordBidRecommendation = {
    summary:
      dailyBudget > 0
        ? selection.selectionNote
        : 'Enter a daily budget to size keyword max CPCs and see how many keywords you can afford.',
    bidStrategy: strategy,
    bidStrategyWhy:
      strategy === 'MAXIMIZE_CONVERSIONS'
        ? 'Maximize Conversions lets Google set click prices automatically within your daily budget — no per-keyword max CPC.'
        : 'Manual CPC with a max bid per keyword keeps click prices inside your daily budget wallet.',
    suggestedDailyBudget: dailyBudget || undefined,
    recommendedMaxCpc: Math.max(...fallbackKeywords.filter((k) => k.recommended).map((k) => k.suggestedCpc), 0.5),
    keywordCount: fallbackKeywords.filter((k) => k.recommended).length || selection.recommendedCount,
    recommendedKeywordCount: selection.recommendedCount,
    maxAffordableKeywords: selection.maxAffordable,
    avgKeywordCpc: selection.avgKeywordCpc,
    estClicksPerDay: selection.estClicksPerDay,
    selectionNote: selection.selectionNote,
    defaultMatchType: 'PHRASE',
    strategyOptions: [],
    themes: fallbackThemes(opts.clusters, sizingBudget, opts.budgetContext?.avgCpc),
    recommendedKeywords: fallbackKeywords,
  };

  const parsed = fallback;

  const catalog = indexClusterKeywords(opts.clusters);
  const allowed = new Set(catalog.keys());
  const avgCpc = opts.budgetContext?.avgCpc;
  const recommendedKeywords = (parsed.recommendedKeywords ?? fallback.recommendedKeywords)
    .filter((k) => k?.keyword && allowed.has(k.keyword.toLowerCase()))
    .map((k) => {
      const row = catalog.get(k.keyword.toLowerCase());
      const matchType = k.matchType === 'EXACT' ? ('EXACT' as const) : ('PHRASE' as const);
      const role = k.role === 'primary' ? ('primary' as const) : ('secondary' as const);
      const suggestedCpc =
        typeof k.suggestedCpc === 'number' && k.suggestedCpc > 0
          ? Math.round(k.suggestedCpc * 100) / 100
          : suggestKeywordCpc(
              {
                ...(row ?? { keyword: k.keyword, volume: 0, position: 0, traffic: 0, url: '' }),
                role,
                matchSuggestion: matchType,
              },
              sizingBudget,
              avgCpc
            );
      return {
        keyword: String(k.keyword),
        seed: String(k.seed || row?.seed || ''),
        role,
        matchType,
        intent: k.intent === 'transactional' ? ('transactional' as const) : ('commercial' as const),
        suggestedCpc,
        recommended: k.recommended !== false,
        why: String(k.why ?? '').slice(0, 180),
      };
    });

  const themes = (
    Array.isArray(parsed.themes) && parsed.themes.length >= 3 ? parsed.themes : fallback.themes
  )
    .slice(0, 4)
    .map((t) => {
      const members = [...asStringList(t.primary), ...asStringList(t.secondary)];
      const themeCpc =
        typeof t.suggestedCpc === 'number' && t.suggestedCpc > 0
          ? t.suggestedCpc
          : Math.max(
              ...members.map((name) => {
                const row = catalog.get(name.toLowerCase());
                return row
                  ? suggestKeywordCpc(row, dailyBudget, avgCpc)
                  : suggestKeywordCpc(
                      { keyword: name, volume: 0, position: 0, traffic: 0, url: '' },
                      dailyBudget,
                      avgCpc
                    );
              }),
              0.5
            );
      return {
        service: String(t.service ?? ''),
        seed: String(t.seed ?? ''),
        intent: t.intent === 'transactional' ? ('transactional' as const) : ('commercial' as const),
        primary: asStringList(t.primary),
        secondary: asStringList(t.secondary),
        phrase: asStringList(t.phrase),
        exact: asStringList(t.exact),
        suggestedCpc: Math.round(themeCpc * 100) / 100,
        recommended: t.recommended !== false,
      };
    });

  const finalKeywords = recommendedKeywords.length ? recommendedKeywords : fallback.recommendedKeywords;
  const recommendedMaxCpc = Math.max(
    ...finalKeywords.filter((k) => k.recommended).map((k) => k.suggestedCpc),
    typeof parsed.recommendedMaxCpc === 'number' ? parsed.recommendedMaxCpc : 0,
    0.5
  );

  const strategyOptions = buildStrategyOptions({
    currency,
    wizardDailyBudget: dailyBudget,
    maxCpc: recommendedMaxCpc,
    keywordBids: finalKeywords.filter((k) => k.recommended).map((k) => k.suggestedCpc),
    ctx: opts.budgetContext,
  });
  const preferred =
    opts.preferredStrategy != null
      ? strategyOptions.find((o) => o.id === opts.preferredStrategy) ?? strategyOptions[0]!
      : strategyOptions.find((o) => o.recommended) ?? strategyOptions[0]!;

  return {
    summary: String(parsed.summary || fallback.summary).slice(0, 700),
    bidStrategy: preferred.id,
    bidStrategyWhy: preferred.situation,
    suggestedDailyBudget: preferred.recommendedDailyBudget,
    recommendedMaxCpc,
    keywordCount: finalKeywords.filter((k) => k.recommended).length || fallback.keywordCount,
    recommendedKeywordCount: selection.recommendedCount,
    maxAffordableKeywords: selection.maxAffordable,
    avgKeywordCpc: selection.avgKeywordCpc,
    estClicksPerDay: selection.estClicksPerDay,
    selectionNote: selection.selectionNote,
    defaultMatchType: parsed.defaultMatchType === 'EXACT' ? 'EXACT' : 'PHRASE',
    accountBudgetNote: strategyOptions[0] ? accountBudgetNote(currency, opts.budgetContext) : undefined,
    strategyOptions,
    themes,
    recommendedKeywords: finalKeywords,
  };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function accountBudgetNote(
  currency: string,
  ctx?: {
    enabledDailyBudget?: number;
    leftover?: number;
    avgCpc?: number;
    costPerConversion?: number;
    constrainedCampaigns?: number;
  }
): string {
  if (!ctx) {
    return `No live Budget Intelligence yet — daily budget is based on the wizard amount and keyword max CPCs.`;
  }
  const parts = [
    `Account enabled daily budget ${currency} ${Math.round(ctx.enabledDailyBudget || 0)}`,
    ctx.leftover != null ? `unused in window ${currency} ${Math.round(ctx.leftover)}` : '',
    ctx.avgCpc ? `avg CPC ${currency} ${ctx.avgCpc.toFixed(2)}` : '',
    ctx.costPerConversion ? `CPA ${currency} ${ctx.costPerConversion.toFixed(0)}` : '',
    ctx.constrainedCampaigns ? `${ctx.constrainedCampaigns} campaigns hitting budget` : '',
  ].filter(Boolean);
  return parts.join(' · ');
}

function buildStrategyOptions(opts: {
  currency: string;
  wizardDailyBudget: number;
  maxCpc: number;
  keywordBids: number[];
  ctx?: Parameters<typeof recommendKeywordBids>[0]['budgetContext'];
}): BidStrategyOption[] {
  const { currency, wizardDailyBudget, maxCpc, keywordBids, ctx } = opts;
  const budget = wizardDailyBudget > 0 ? wizardDailyBudget : 0;
  const avgBid =
    keywordBids.length > 0
      ? keywordBids.reduce((s, n) => s + n, 0) / keywordBids.length
      : maxCpc;
  const leftoverDaily = ctx?.leftover != null ? Math.max(0, ctx.leftover / Math.max(1, ctx.windowDays || 30)) : 0;
  const accountAvgCpc = ctx?.avgCpc && ctx.avgCpc > 0 ? ctx.avgCpc : avgBid;
  const cpa = ctx?.costPerConversion && ctx.costPerConversion > 0 ? ctx.costPerConversion : 0;
  const conversions = ctx?.conversions || 0;
  const constrained = ctx?.constrainedCampaigns || 0;
  const cpcClicks = budget > 0 ? Math.max(1, Math.floor(budget / Math.max(avgBid, 0.4))) : 0;
  const preferConversions = conversions >= 8 && cpa > 0 && budget >= Math.max(cpa, 1);

  const manual: BidStrategyOption = {
    id: 'MANUAL_CPC',
    label: 'Maximum CPC',
    recommended: !preferConversions,
    recommendedDailyBudget: budget,
    recommendedMaxCpc: Math.round(maxCpc * 100) / 100,
    typicalCpc: Math.round(avgBid * 100) / 100,
    expectedClicks: cpcClicks || undefined,
    usesKeywordMaxCpc: true,
    situation: [
      budget > 0
        ? `Size keyword max CPCs to your ${currency} ${budget}/day wallet (~${cpcClicks} clicks if bids average ${currency} ${avgBid.toFixed(2)}).`
        : 'Enter a daily budget to size keyword max CPCs.',
      `Planner estimates are scaled down when they exceed what ${currency} ${budget || '—'}/day can afford.`,
      leftoverDaily > 0
        ? `Budget intelligence shows about ${currency} ${Math.round(leftoverDaily)}/day unused across the account.`
        : '',
      constrained
        ? `${constrained} existing campaigns are already limited by budget.`
        : '',
    ]
      .filter(Boolean)
      .join(' '),
    howSpendWorks:
      'Daily budget is the campaign wallet. Max CPC is the price tag per click. Keywords share the wallet; none can pay more than its max CPC.',
  };

  const estConversions =
    cpa > 0 && budget > 0 ? Math.max(1, Math.round(budget / cpa)) : undefined;

  const conversionsOpt: BidStrategyOption = {
    id: 'MAXIMIZE_CONVERSIONS',
    label: 'Maximize conversions',
    recommended: preferConversions,
    recommendedDailyBudget: budget,
    typicalCpc: Math.round(accountAvgCpc * 100) / 100,
    expectedConversions: estConversions,
    usesKeywordMaxCpc: false,
    situation: [
      budget > 0
        ? `Spend up to ${currency} ${budget}/day. Google sets click prices automatically to maximize conversions — you do not set per-keyword max CPC.`
        : 'Enter a daily budget first. Google will spend up to that cap.',
      estConversions != null
        ? `At your account CPA (~${currency} ${cpa.toFixed(0)}), ${currency} ${budget}/day can support about ${estConversions} conversion(s) per day.`
        : cpa
          ? `Account CPA is about ${currency} ${cpa.toFixed(0)} — use that to sanity-check whether ${currency} ${budget}/day is enough.`
          : 'No stable CPA yet — Google may bid aggressively until it hits the daily budget.',
      conversions >= 8
        ? `You already have conversion history (${Math.round(conversions)} in the window).`
        : 'Few conversions on the account yet — expect learning spend before CPA stabilizes.',
    ]
      .filter(Boolean)
      .join(' '),
    howSpendWorks:
      'Only the daily budget is fixed. Google chooses each click price and may exceed typical CPC to win conversions.',
  };

  return [manual, conversionsOpt];
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => (typeof v === 'string' ? v : v && typeof v === 'object' && 'keyword' in v ? String((v as { keyword: unknown }).keyword) : ''))
    .filter(Boolean)
    .slice(0, 10);
}

function indexClusterKeywords(clusters: KeywordCluster[]): Map<string, AhrefsOrganicKeyword> {
  const map = new Map<string, AhrefsOrganicKeyword>();
  for (const c of clusters) {
    for (const k of c.keywords) map.set(k.keyword.toLowerCase(), k);
    for (const t of c.seedThemes ?? []) {
      map.set(t.seed.toLowerCase(), {
        keyword: t.seed,
        volume: t.primary[0]?.volume ?? 0,
        position: 0,
        traffic: 0,
        url: '',
        seed: t.seed,
        intent: t.intent,
        matchSuggestion: suggestKeywordMatch(t.seed),
        role: 'primary',
      });
      for (const k of [...t.primary, ...t.secondary]) {
        map.set(k.keyword.toLowerCase(), { ...k, seed: t.seed });
      }
    }
  }
  return map;
}

function fallbackThemes(
  clusters: KeywordCluster[],
  dailyBudget: number,
  avgCpc?: number
): KeywordBidRecommendation['themes'] {
  return clusters
    .flatMap((c) =>
      (c.seedThemes ?? []).slice(0, 4).map((t) => {
        const members = [...t.primary, ...t.secondary];
        const suggestedCpc = Math.max(
          ...members.map((k) => k.suggestedCpc ?? suggestKeywordCpc(k, dailyBudget, avgCpc)),
          0.5
        );
        return {
          service: c.service,
          seed: t.seed,
          intent: t.intent,
          primary: t.primary.map((k) => k.keyword),
          secondary: t.secondary.map((k) => k.keyword),
          phrase: members
            .filter((k) => (k.matchSuggestion ?? suggestKeywordMatch(k.keyword)) === 'PHRASE')
            .map((k) => k.keyword),
          exact: members
            .filter((k) => (k.matchSuggestion ?? suggestKeywordMatch(k.keyword)) === 'EXACT')
            .map((k) => k.keyword),
          suggestedCpc: Math.round(suggestedCpc * 100) / 100,
          recommended: true,
        };
      })
    )
    .slice(0, 4);
}

function marketCpcFromKeyword(row: AhrefsOrganicKeyword): number | undefined {
  const r = row as AhrefsOrganicKeyword & {
    googleAccountMaxCpc?: number;
    googleAccountAvgCpc?: number;
    googlePlannerAvgCpc?: number;
    googlePlannerLowBid?: number;
    googlePlannerHighBid?: number;
  };
  if (r.googleAccountMaxCpc != null && r.googleAccountMaxCpc > 0) return r.googleAccountMaxCpc;
  if (r.googleAccountAvgCpc != null && r.googleAccountAvgCpc > 0) return r.googleAccountAvgCpc;
  if (r.googlePlannerAvgCpc != null && r.googlePlannerAvgCpc > 0) return r.googlePlannerAvgCpc;
  if (r.googlePlannerLowBid != null && r.googlePlannerHighBid != null) {
    return (r.googlePlannerLowBid + r.googlePlannerHighBid) / 2;
  }
  return r.suggestedCpc;
}

function maxKeywordsForBudget(
  dailyBudget: number,
  avgCpc: number,
  strategy: 'MANUAL_CPC' | 'MAXIMIZE_CONVERSIONS'
): number {
  if (!(dailyBudget > 0)) return strategy === 'MAXIMIZE_CONVERSIONS' ? 8 : 12;
  const cpc = Math.max(avgCpc, 0.4);
  const estClicksPerDay = Math.max(1, Math.floor(dailyBudget / cpc));
  if (strategy === 'MAXIMIZE_CONVERSIONS') {
    // Google smart bidding: fewer terms, more budget per keyword for conversion learning.
    return Math.max(3, Math.min(12, Math.floor(estClicksPerDay / 2)));
  }
  const clicksPerKeyword = dailyBudget >= 60 ? 2 : 1.5;
  return Math.max(4, Math.min(24, Math.floor(estClicksPerDay / clicksPerKeyword)));
}

function selectKeywordsForBudget(opts: {
  clusters: KeywordCluster[];
  dailyBudget: number;
  avgCpc?: number;
  strategy: 'MANUAL_CPC' | 'MAXIMIZE_CONVERSIONS';
  currency: string;
}): {
  keywords: KeywordBidRecommendation['recommendedKeywords'];
  recommendedCount: number;
  maxAffordable: number;
  avgKeywordCpc: number;
  estClicksPerDay: number;
  selectionNote: string;
} {
  const { clusters, dailyBudget, avgCpc, strategy, currency } = opts;
  const catalog = indexClusterKeywords(clusters);
  type Candidate = {
    keyword: string;
    seed: string;
    role: 'primary' | 'secondary';
    matchType: 'EXACT' | 'PHRASE';
    intent: 'transactional' | 'commercial';
    suggestedCpc: number;
    volume: number;
    score: number;
  };

  const candidateMap = new Map<string, Candidate>();

  const addCandidate = (raw: AhrefsOrganicKeyword, seed: string) => {
    const row = annotateKeyword(catalog.get(raw.keyword.toLowerCase()) ?? raw);
    const matchType = row.matchSuggestion === 'EXACT' ? 'EXACT' : 'PHRASE';
    const role = row.role === 'primary' ? 'primary' : 'secondary';
    const intent = row.intent === 'transactional' ? 'transactional' : 'commercial';
    const suggestedCpc =
      marketCpcFromKeyword(row) ??
      row.suggestedCpc ??
      suggestKeywordCpc({ ...row, role, matchSuggestion: matchType }, dailyBudget, avgCpc);
    const cappedCpc = suggestKeywordCpc(
      { ...row, role, matchSuggestion: matchType, suggestedCpc },
      dailyBudget,
      avgCpc
    );
    let score = scoreKeywordForBudget(row, dailyBudget);
    if (role === 'primary') score *= 1.35;
    if (intent === 'transactional') score *= 1.2;
    if (strategy === 'MAXIMIZE_CONVERSIONS') {
      score *= intent === 'transactional' ? 1.35 : 0.95;
      score *= role === 'primary' ? 1.3 : 0.8;
    } else if (cappedCpc > dailyBudget / 3) {
      score *= 0.55;
    }
    const key = row.keyword.toLowerCase();
    const prev = candidateMap.get(key);
    if (!prev || score > prev.score) {
      candidateMap.set(key, {
        keyword: row.keyword,
        seed,
        role,
        matchType,
        intent,
        suggestedCpc: cappedCpc,
        volume: row.volume ?? 0,
        score,
      });
    }
  };

  for (const c of clusters) {
    if (c.seedThemes?.length) {
      for (const t of c.seedThemes) {
        for (const k of [...t.primary, ...t.secondary]) addCandidate(k, t.seed);
      }
    } else {
      for (const k of c.keywords) addCandidate(k, k.seed ?? c.service);
    }
  }

  const candidates = [...candidateMap.values()].sort(
    (a, b) => b.score - a.score || b.volume - a.volume
  );

  const avgKeywordCpc =
    candidates.length > 0
      ? candidates.reduce((s, k) => s + k.suggestedCpc, 0) / candidates.length
      : avgCpc && avgCpc > 0
        ? avgCpc
        : 1;
  const cpcForSizing = Math.max(0.4, avgKeywordCpc);
  const estClicksPerDay =
    dailyBudget > 0 ? Math.max(1, Math.floor(dailyBudget / cpcForSizing)) : 0;
  const maxAffordable = maxKeywordsForBudget(dailyBudget, cpcForSizing, strategy);
  const maxPerSeed = strategy === 'MAXIMIZE_CONVERSIONS' ? 2 : 3;

  const picked = new Set<string>();
  const seedCounts = new Map<string, number>();

  // Ensure one primary per seed theme first.
  const seeds = [...new Set(candidates.map((c) => c.seed))];
  for (const seed of seeds) {
    if (picked.size >= maxAffordable) break;
    const primary = candidates.find((c) => c.seed === seed && c.role === 'primary');
    if (primary && !picked.has(primary.keyword.toLowerCase())) {
      picked.add(primary.keyword.toLowerCase());
      seedCounts.set(seed, 1);
    }
  }

  for (const c of candidates) {
    if (picked.size >= maxAffordable) break;
    const key = c.keyword.toLowerCase();
    if (picked.has(key)) continue;
    const sc = seedCounts.get(c.seed) ?? 0;
    if (sc >= maxPerSeed) continue;
    picked.add(key);
    seedCounts.set(c.seed, sc + 1);
  }

  const recommendedCount = picked.size;

  const buildWhy = (c: Candidate, selected: boolean): string => {
    if (!selected) {
      return `Lower priority for ${currency} ${dailyBudget}/day — ${c.role} “${c.seed}” · ${c.matchType.toLowerCase()}`;
    }
    if (strategy === 'MAXIMIZE_CONVERSIONS') {
      return `Selected for Maximize Conversions — ${c.intent} · ${c.matchType.toLowerCase()} · Google auto-bids (typical ~${currency} ${c.suggestedCpc.toFixed(2)})`;
    }
    return `Fits ${currency} ${dailyBudget}/day at max CPC ${currency} ${c.suggestedCpc.toFixed(2)} · ${c.role} · ${c.matchType.toLowerCase()}`;
  };

  const keywords = candidates.map((c) => ({
    keyword: c.keyword,
    seed: c.seed,
    role: c.role,
    matchType: c.matchType,
    intent: c.intent,
    suggestedCpc: Math.round(c.suggestedCpc * 100) / 100,
    recommended: picked.has(c.keyword.toLowerCase()),
    why: buildWhy(c, picked.has(c.keyword.toLowerCase())),
  }));

  const selectionNote =
    strategy === 'MAXIMIZE_CONVERSIONS'
      ? dailyBudget > 0
        ? `Select ${recommendedCount} high-intent keywords (max ~${maxAffordable} fit ${currency} ${dailyBudget}/day). Google Maximize Conversions auto-bids inside that budget — fewer terms helps conversion learning.`
        : 'Enter a daily budget. Maximize Conversions uses Google auto-bidding — we recommend fewer high-intent keywords.'
      : dailyBudget > 0
        ? `Select ${recommendedCount} keywords (~${estClicksPerDay} clicks/day at avg max CPC ${currency} ${avgKeywordCpc.toFixed(2)}). Each selected term is sized to your ${currency} ${dailyBudget}/day wallet.`
        : 'Enter a daily budget to calculate how many keywords you can afford at planner max CPC.';

  return {
    keywords,
    recommendedCount,
    maxAffordable,
    avgKeywordCpc: Math.round(avgKeywordCpc * 100) / 100,
    estClicksPerDay,
    selectionNote,
  };
}

function flattenFallbackKeywords(
  clusters: KeywordCluster[],
  dailyBudget: number,
  avgCpc?: number
): KeywordBidRecommendation['recommendedKeywords'] {
  const out: KeywordBidRecommendation['recommendedKeywords'] = [];
  for (const c of clusters) {
    for (const t of (c.seedThemes ?? []).slice(0, 4)) {
      const picks = [...t.primary, ...t.secondary.slice(0, 1)];
      for (const k of picks) {
        const matchType = k.matchSuggestion === 'EXACT' ? 'EXACT' : 'PHRASE';
        const role = k.role === 'primary' ? 'primary' : 'secondary';
        const suggestedCpc =
          k.suggestedCpc ??
          suggestKeywordCpc({ ...k, role, matchSuggestion: matchType }, dailyBudget, avgCpc);
        out.push({
          keyword: k.keyword,
          seed: t.seed,
          role,
          matchType,
          intent: k.intent === 'transactional' ? 'transactional' : 'commercial',
          suggestedCpc,
          recommended: true,
          why: `Seed “${t.seed}” · ${matchType.toLowerCase()} · max CPC $${suggestedCpc.toFixed(2)}`,
        });
      }
    }
  }
  if (!out.length) {
    for (const c of clusters) {
      for (const k of c.keywords.slice(0, 8)) {
        const matchType = k.matchSuggestion === 'EXACT' ? 'EXACT' : 'PHRASE';
        const suggestedCpc = k.suggestedCpc ?? suggestKeywordCpc(k, dailyBudget, avgCpc);
        out.push({
          keyword: k.keyword,
          seed: k.seed ?? c.service,
          role: k.role === 'primary' ? 'primary' : 'secondary',
          matchType,
          intent: k.intent === 'transactional' ? 'transactional' : 'commercial',
          suggestedCpc,
          recommended: true,
          why: `Max CPC $${suggestedCpc.toFixed(2)} for ${matchType.toLowerCase()} match`,
        });
      }
    }
  }
  return out;
}

// ─── Step 3: Competitor discovery per service ────────────────────

export interface CompetitorForService {
  name: string;
  url: string;
  advertiserId?: string;
  headlines: string[];
  descriptions: string[];
  totalAdCount: number;
  activeAdCount: number;
  adDurationDays: number;
  previewImageUrl?: string;
  transparencyUrl?: string;
  creativeUrl?: string;
  adLink?: string;
  adSource?: string;
  confidenceScore?: number;
  isMostRelevant: boolean;
  allAds: CompetitorAdPreview[];
}

export interface CompetitorDiscoveryResult {
  competitors: CompetitorForService[];
  allAds: CompetitorAdPreview[];
  source: string;
}

export async function discoverCompetitors(opts: {
  websiteUrl: string;
  service: string;
  keywords: string[];
  offer?: string;
  userId?: string;
  country?: string;
  /** Bypass competitor discovery cache and fetch fresh rivals */
  forceRefresh?: boolean;
}): Promise<CompetitorDiscoveryResult> {
  const TARGET = 8;
  const MIN_DISPLAY = 6;
  const country = resolveMarketCountry({
    location: opts.country,
    websiteUrl: opts.websiteUrl,
  });
  const locationLabel =
    countryToLocationLabel(country) ??
    (opts.country?.trim() || undefined);
  // Prefer commercial service keywords — drop library/guide noise before discovery
  const keywords = (opts.keywords ?? [])
    .map((k) => k.trim())
    .filter((k) => k.length >= 3)
    .filter((k) => {
      if (/\b(ad library|ads library|how to use|best practices|complete guide|tutorial)\b/i.test(k)) {
        return false;
      }
      return true;
    })
    .slice(0, 15);
  const filteredSeeds = filterSeedKeywordsForService(opts.service, keywords);
  const seedKeywords = filteredSeeds.length ? filteredSeeds : [opts.service];
  clearSociaVaultCreditPause();

  const runDiscovery = async (skipCache: boolean) => {
    const analysis = (await analyzeCompetitors({
      businessName: hostFrom(opts.websiteUrl),
      websiteUrl: opts.websiteUrl,
      industry: '',
      productsServices: [opts.service],
      primaryService: opts.service,
      serviceScoped: true,
      location: locationLabel,
      // Full discovery for Create Campaign — lightweight mode stops after the first gallery hit
      lightweight: false,
      skipSocialPresence: true,
      offer: opts.offer,
      discoverySource: 'sociavault',
      skipCache: skipCache || Boolean(opts.forceRefresh),
      searchKeywords: seedKeywords,
      minCompetitors: TARGET,
      strictServiceSeed: true,
    })) as CompetitorIntelligence;

    // analyzeCompetitors already applies market filter and keeps selected library rivals.
    return analysis;
  };

  const galleryMatchesProfile = (
    p: { name: string; url?: string; advertiserId?: string; transparencyUrl?: string },
    g: CompetitorAdPreview
  ): boolean => {
    const profileAdv =
      p.advertiserId ||
      (p.transparencyUrl?.match(/advertiser\/(AR[\w-]+)/i)?.[1] ?? undefined);
    const galleryAdv =
      g.advertiserId ||
      (g.transparencyUrl?.match(/advertiser\/(AR[\w-]+)/i)?.[1] ?? undefined);
    if (profileAdv && galleryAdv && profileAdv === galleryAdv) return true;

    const profileName = p.name.toLowerCase().trim();
    const galleryName = (g.advertiserName ?? g.name).toLowerCase().trim();
    if (profileName && galleryName && profileName === galleryName) return true;
    if (
      profileName &&
      galleryName &&
      (profileName.includes(galleryName) || galleryName.includes(profileName)) &&
      Math.min(profileName.length, galleryName.length) >= 8
    ) {
      return true;
    }
    if (p.url && (g.url || g.destinationUrl) && hostMatch(p.url, g.url || g.destinationUrl || '')) {
      return true;
    }
    return false;
  };

  const isRealCreative = (g: CompetitorAdPreview): boolean => {
    if (g.syntheticCopy || g.adSource === 'website_fallback') return false;
    if (looksLikeQueryNotAdvertiser(g.advertiserName ?? g.name, opts.service)) return false;
    const headlines = (g.headlines ?? []).map((h) => h.trim()).filter(Boolean);
    const descriptions = (g.descriptions ?? []).map((d) => d.trim()).filter(Boolean);
    if (headlines.some((h) => /shop now/i.test(h))) return false;
    if (descriptions.some((d) => /^visit .+ for quality service/i.test(d))) return false;
    if (copyConflictsWithLegalService([...headlines, ...descriptions].join(' '), opts.service)) {
      return false;
    }

    // Only show ads the LLM scored as the same service
    if (typeof g.keywordRelevanceScore !== 'number') return false;
    if (g.keywordRelevanceScore < AD_RELEVANCE_THRESHOLD) return false;
    return headlines.length > 0 || descriptions.length > 0 || Boolean(g.previewImageUrl);
  };

  /** Build UI cards from analyzeCompetitors output (already service-filtered). */
  const toCards = (analysis: CompetitorIntelligence): CompetitorForService[] => {
    const gallery = analysis.adGallery ?? [];
    const profiles = analysis.competitors ?? [];
    const byName = new Map<string, CompetitorForService>();

    for (const p of profiles) {
      const key = p.name.toLowerCase().trim();
      if (!key || byName.has(key)) continue;
      if (looksLikeQueryNotAdvertiser(p.name, opts.service)) continue;

      const matchingAds = gallery.filter((g) => galleryMatchesProfile(p, g));
      const realAds = matchingAds.filter(isRealCreative);
      const profileHeadlines = (p.headlines ?? []).map((h) => String(h).trim()).filter(Boolean);
      const profileDescriptions = (p.descriptions ?? []).map((d) => String(d).trim()).filter(Boolean);
      if (
        copyConflictsWithLegalService(
          [...profileHeadlines, ...profileDescriptions].join(' '),
          opts.service
        )
      ) {
        continue;
      }
      if (!realAds.length) continue;

      const headlines = [...new Set([
        ...realAds.flatMap((a) => a.headlines ?? []),
        ...profileHeadlines,
      ])].slice(0, 15);
      const descriptions = [...new Set([
        ...realAds.flatMap((a) => a.descriptions ?? []),
        ...profileDescriptions,
      ])].slice(0, 8);
      const primaryAd = realAds[0];

      byName.set(key, {
        name: p.name,
        url: p.url,
        advertiserId: p.advertiserId,
        headlines,
        descriptions,
        // Library totals (Transparency / SociaVault activity), not just displayed creatives
        totalAdCount: p.totalAdCount ?? realAds.length,
        activeAdCount: p.activeAdCount ?? realAds.filter((a) => a.isActive !== false).length,
        adDurationDays: p.adDurationDays ?? primaryAd?.adDurationDays ?? 0,
        previewImageUrl: primaryAd?.previewImageUrl,
        transparencyUrl:
          p.transparencyUrl ??
          primaryAd?.transparencyUrl ??
          (p.advertiserId
            ? `https://adstransparency.google.com/advertiser/${p.advertiserId}?region=${country ?? 'anywhere'}`
            : undefined),
        creativeUrl: primaryAd?.creativeUrl,
        adLink: primaryAd?.adLink ?? primaryAd?.creativeUrl,
        adSource: primaryAd?.adSource,
        confidenceScore: p.confidenceScore ?? primaryAd?.confidenceScore,
        isMostRelevant: false,
        allAds: realAds,
      });
    }

    for (const g of gallery) {
      if (!isRealCreative(g)) continue;
      const key = (g.advertiserName ?? g.name).toLowerCase().trim();
      if (!key || byName.has(key)) continue;
      if (looksLikeQueryNotAdvertiser(g.advertiserName ?? g.name, opts.service)) continue;
      byName.set(key, {
        name: g.advertiserName ?? g.name,
        url: g.destinationUrl ?? g.url,
        advertiserId: g.advertiserId,
        headlines: g.headlines ?? [],
        descriptions: g.descriptions ?? [],
        totalAdCount: g.totalAdCount ?? 1,
        activeAdCount: g.activeAdCount ?? (g.isActive === false ? 0 : 1),
        adDurationDays: g.adDurationDays ?? 0,
        previewImageUrl: g.previewImageUrl,
        transparencyUrl:
          g.transparencyUrl ??
          (g.advertiserId
            ? `https://adstransparency.google.com/advertiser/${g.advertiserId}?region=${country ?? 'anywhere'}`
            : undefined),
        creativeUrl: g.creativeUrl,
        adLink: g.adLink ?? g.creativeUrl,
        adSource: g.adSource,
        confidenceScore: g.confidenceScore,
        isMostRelevant: false,
        allAds: [g],
      });
    }

    return [...byName.values()]
      .filter(
        (c) =>
          (c.allAds?.length ?? 0) > 0 ||
          c.headlines.length > 0 ||
          c.totalAdCount > 0
      )
      .sort(
        (a, b) =>
          (b.confidenceScore ?? 0) - (a.confidenceScore ?? 0) ||
          (b.allAds?.length ?? 0) - (a.allAds?.length ?? 0) ||
          b.adDurationDays - a.adDurationDays ||
          b.activeAdCount - a.activeAdCount
      );
  };

  // forceRefresh always skips cache. A second full discovery is only worth it
  // when the first pass displayed nobody — rerunning after 3+ rivals often
  // exceeds the browser timeout and the UI shows 0 even though rivals exist.
  let analysis = await runDiscovery(Boolean(opts.forceRefresh));
  let competitors = toCards(analysis);

  if (
    competitors.length === 0 &&
    !opts.forceRefresh &&
    !isSociaVaultCreditsExhausted()
  ) {
    console.warn(
      `[campaign-wizard] only ${competitors.length}/${MIN_DISPLAY} with relevant ads — refreshing discovery for "${opts.service}"`
    );
    const refreshed = await runDiscovery(true);
    const next = toCards(refreshed);
    if (next.length > competitors.length) {
      analysis = refreshed;
      competitors = next;
    } else {
      console.warn(
        `[campaign-wizard] refresh returned ${next.length} rival(s) — keeping first pass (${competitors.length})`
      );
    }
  } else if (competitors.length < MIN_DISPLAY && isSociaVaultCreditsExhausted()) {
    console.warn(
      `[campaign-wizard] ad-library credits exhausted — keeping ${competitors.length} fetched rival(s) for "${opts.service}"`
    );
  }

  // If Claude scoring or identity matching still left too few cards, keep extra library advertisers
  if (competitors.length < MIN_DISPLAY) {
    const used = new Set(competitors.map((c) => c.name.toLowerCase().trim()));
    for (const g of analysis.adGallery ?? []) {
      if (competitors.length >= TARGET) break;
      if (!isRealCreative(g)) continue;
      const key = (g.advertiserName ?? g.name).toLowerCase().trim();
      if (!key || used.has(key)) continue;
      if (looksLikeQueryNotAdvertiser(g.advertiserName ?? g.name, opts.service)) continue;
      used.add(key);
      competitors.push({
        name: g.advertiserName ?? g.name,
        url: g.destinationUrl ?? g.url,
        advertiserId: g.advertiserId,
        headlines: g.headlines ?? [],
        descriptions: g.descriptions ?? [],
        totalAdCount: g.totalAdCount ?? 1,
        activeAdCount: g.activeAdCount ?? (g.isActive === false ? 0 : 1),
        adDurationDays: g.adDurationDays ?? 0,
        previewImageUrl: g.previewImageUrl,
        transparencyUrl:
          g.transparencyUrl ??
          (g.advertiserId
            ? `https://adstransparency.google.com/advertiser/${g.advertiserId}?region=${country ?? 'anywhere'}`
            : undefined),
        creativeUrl: g.creativeUrl,
        adLink: g.adLink ?? g.creativeUrl,
        adSource: g.adSource,
        confidenceScore: g.confidenceScore,
        isMostRelevant: false,
        allAds: [g],
      });
    }
  }

  competitors = competitors.slice(0, Math.max(TARGET, 10));
  if (competitors.length) {
    competitors[0]!.isMostRelevant = true;
  }

  if (competitors.length < TARGET) {
    console.warn(
      `[campaign-wizard] returning ${competitors.length}/${TARGET} competitors for UI — "${opts.service}" (keywords=${seedKeywords.slice(0, 5).join(', ') || 'none'}, market=${country ?? 'auto'}): ${competitors.map((c) => c.name).join(', ') || '(none)'}`
    );
  } else {
    console.log(
      `[campaign-wizard] returning ${competitors.length} competitors for UI — "${opts.service}" (market=${country ?? 'auto'}): ${competitors.map((c) => c.name).join(', ')}`
    );
  }

  return {
    competitors,
    allAds: analysis.adGallery?.filter(isRealCreative) ?? [],
    source: analysis.source ?? 'auto',
  };
}

function hostMatch(a: string, b: string): boolean {
  const ha = hostFrom(a);
  const hb = hostFrom(b);
  return ha.length > 3 && hb.length > 3 && (ha.includes(hb) || hb.includes(ha));
}

function hostFrom(url: string): string {
  try {
    return new URL(url.startsWith('http') ? url : `https://${url}`).hostname
      .replace(/^www\./, '')
      .toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

// ─── Step 4: Generate 4 ads using Claude ─────────────────────────

export interface GeneratedAd {
  id: string;
  label: string;
  headlines: string[];
  descriptions: string[];
  displayPaths?: { path1?: string; path2?: string };
  keywords: string[];
  focusedCompetitor?: string;
}

export async function generateCampaignAds(opts: {
  companyName: string;
  websiteUrl: string;
  service: string;
  keywords: string[];
  competitors: CompetitorForService[];
  offer?: string;
  audience?: string;
  tone?: string;
  finalUrl?: string;
  locationFocus?: string;
}): Promise<GeneratedAd[]> {
  const competitorBrief = opts.competitors
    .map((c, i) => {
      const headlines = c.headlines.slice(0, 5).join(' | ');
      const descriptions = c.descriptions.slice(0, 2).join(' ');
      return `${i + 1}. ${c.name}${c.isMostRelevant ? ' ⭐ (most relevant)' : ''} — ${c.totalAdCount} ads, ${c.adDurationDays}d running\n   Headlines: ${headlines || 'N/A'}\n   Descriptions: ${descriptions || 'N/A'}`;
    })
    .join('\n');

  const keywordList = opts.keywords.slice(0, 30).join(', ');

  const prompt = `You are a senior Google Ads copywriter. Create 4 different Responsive Search Ads for this campaign.

Company: ${opts.companyName}
Website: ${opts.websiteUrl}
Service focus: ${opts.service}
${opts.offer ? `Offer: ${opts.offer}` : ''}
${opts.audience ? `Target audience: ${opts.audience}` : ''}
${opts.tone ? `Tone: ${opts.tone}` : ''}
${opts.locationFocus ? `Location: ${opts.locationFocus}` : ''}
${opts.finalUrl ? `Landing page: ${opts.finalUrl}` : ''}

Target keywords: ${keywordList}

Competitor ads to beat:
${competitorBrief || 'No competitor data available'}

Requirements per ad:
- 15 headlines (max 30 chars each)
- 4 descriptions (max 90 chars each)
- Display paths (path1, path2 — max 15 chars each)
- 8-10 recommended keywords
- Each ad should have a different angle/approach:
  Ad 1: Primary — best overall using competitor intelligence
  Ad 2: Beat the #1 competitor — directly counter their messaging
  Ad 3: Offer/value focused — emphasize deals, savings, unique value
  Ad 4: Trust/authority focused — reviews, experience, certifications

Return JSON array:
[
  {
    "id": "ad-1",
    "label": "Primary — competitor intelligence",
    "headlines": ["...", ...],
    "descriptions": ["...", ...],
    "displayPaths": {"path1": "...", "path2": "..."},
    "keywords": ["...", ...],
    "focusedCompetitor": "competitor name or null"
  },
  ...
]

Return ONLY the JSON array, no markdown.`;

  try {
    const response = await createClaudeMessage({
      model: ANTHROPIC_OPTIMIZE_MODEL_FALLBACKS[0]!,
      max_tokens: 6000,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = claudeTextFromMessage(response);

    const parsed = extractJsonFromClaudeText(text);
    if (Array.isArray(parsed)) {
      return (parsed as GeneratedAd[])
        .filter((ad) => ad.headlines?.length >= 3)
        .slice(0, 4)
        .map((ad, i) => ({
          ...ad,
          id: ad.id || `ad-${i + 1}`,
          label: ad.label || `Ad ${i + 1}`,
          headlines: (ad.headlines ?? []).map((h: string) => String(h).slice(0, 30)).slice(0, 15),
          descriptions: (ad.descriptions ?? []).map((d: string) => String(d).slice(0, 90)).slice(0, 4),
          keywords: (ad.keywords ?? []).slice(0, 15),
        }));
    }
  } catch (err) {
    console.error(
      '[campaign-wizard] ad generation failed:',
      err instanceof Error ? err.message : err
    );
  }

  return [];
}

/** Refine one generated RSA from a user instruction (chat). */
export async function refineCampaignAd(opts: {
  companyName: string;
  websiteUrl: string;
  service: string;
  keywords?: string[];
  offer?: string;
  locationFocus?: string;
  instruction: string;
  currentAd: GeneratedAd;
  chatHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
}): Promise<{ ad: GeneratedAd; reply: string }> {
  const historyBlock = (opts.chatHistory ?? [])
    .slice(-6)
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n');

  const prompt = `You are a senior Google Ads RSA copywriter. Revise the selected ad based on the user's instruction.

Company: ${opts.companyName}
Website: ${opts.websiteUrl}
Service: ${opts.service}
${opts.offer ? `Offer: ${opts.offer}` : ''}
${opts.locationFocus ? `Location: ${opts.locationFocus}` : ''}
Keywords: ${(opts.keywords ?? []).slice(0, 20).join(', ') || '(none)'}

Current ad:
Label: ${opts.currentAd.label}
Headlines (${opts.currentAd.headlines.length}):
${opts.currentAd.headlines.map((h, i) => `${i + 1}. ${h}`).join('\n')}
Descriptions (${opts.currentAd.descriptions.length}):
${opts.currentAd.descriptions.map((d, i) => `${i + 1}. ${d}`).join('\n')}
Display paths: ${opts.currentAd.displayPaths?.path1 ?? ''} / ${opts.currentAd.displayPaths?.path2 ?? ''}

${historyBlock ? `Recent chat:\n${historyBlock}\n` : ''}
User instruction: ${opts.instruction}

Rules:
- Apply the user's request (tone, offers, length, keywords, CTAs, location, etc.).
- Keep Google RSA limits: headlines ≤ 30 characters, descriptions ≤ 90 characters.
- Return 10–15 headlines and 2–4 descriptions unless the user asks for fewer.
- Keep displayPaths if still relevant (max 15 chars each).
- Do not invent banned claims; stay truthful for a Search ad.

Return ONLY JSON:
{
  "reply": "1-2 sentence confirmation of what you changed",
  "headlines": ["...", "..."],
  "descriptions": ["...", "..."],
  "displayPaths": {"path1": "...", "path2": "..."},
  "keywords": ["...", "..."]
}`;

  try {
    const response = await createClaudeMessage({
      model: ANTHROPIC_OPTIMIZE_MODEL_FALLBACKS[0]!,
      max_tokens: 2500,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = claudeTextFromMessage(response);

    const parsed = extractJsonFromClaudeText(text) as {
      reply?: string;
      headlines?: string[];
      descriptions?: string[];
      displayPaths?: { path1?: string; path2?: string };
      keywords?: string[];
    };

    const headlines = (parsed.headlines ?? [])
      .map((h) => String(h).trim().slice(0, 30))
      .filter(Boolean)
      .slice(0, 15);
    const descriptions = (parsed.descriptions ?? [])
      .map((d) => String(d).trim().slice(0, 90))
      .filter(Boolean)
      .slice(0, 4);

    if (headlines.length < 3 || descriptions.length < 1) {
      throw new Error('Refine returned incomplete ad copy');
    }

    return {
      reply: (parsed.reply ?? 'Updated the ad copy based on your request.').trim(),
      ad: {
        ...opts.currentAd,
        headlines,
        descriptions,
        displayPaths: parsed.displayPaths ?? opts.currentAd.displayPaths,
        keywords: (parsed.keywords ?? opts.currentAd.keywords).map(String).slice(0, 15),
      },
    };
  } catch (err) {
    console.error(
      '[campaign-wizard] refine ad failed:',
      err instanceof Error ? err.message : err
    );
    throw err;
  }
}
