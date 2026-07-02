import { getAuditReport } from './audit.service.js';
import { getMe } from './user.service.js';
import { fetchModuleGoogleAdsData, isGoogleAdsConfigured } from './google-ads.service.js';
import { withTimeoutFallback } from '../utils/withTimeout.js';
import { analyzeWebsite, type WebsiteIntelligence } from './website-intelligence.service.js';
import { analyzeCompetitors, type CompetitorIntelligence } from './competitor-intelligence.service.js';
import type { Finding } from '../types/index.js';
import { resolveBusinessName } from '../utils/business-identity.js';

export type OptimizationScenario = 'REPLACE_EXISTING' | 'CREATE_ADS' | 'CREATE_STRATEGY';

export interface LiveAdRow {
  campaignId?: string;
  campaignName?: string;
  campaignResourceName?: string;
  adGroupId?: string;
  adGroupName?: string;
  adGroupResourceName?: string;
  adGroupAdResourceName?: string;
  headlines: string[];
  descriptions: string[];
  finalUrls?: string[];
  adStrength?: string;
  impressions?: number;
  clicks?: number;
  conversions?: number;
  ctr?: number;
  costMicros?: number;
}

export interface AuditIntelligence {
  business: {
    name: string;
    goal?: string;
    websiteUrl?: string;
    monthlySpend?: number;
    campaignCount?: number;
  };
  findings: {
    critical: Finding[];
    high: Finding[];
    medium: Finding[];
    all: Finding[];
  };
  campaigns: unknown[];
  keywords: unknown[];
  searchTerms: unknown[];
  ads: LiveAdRow[];
  landingPages: unknown[];
  bidding: unknown[];
  qualityScores: unknown[];
  devices: unknown[];
  audiences: unknown[];
  budgets: unknown[];
  websiteAnalysis: WebsiteIntelligence | null;
  competitorAnalysis: CompetitorIntelligence | null;
  auditHealth: { score: number; critical: number; high: number; medium: number };
  campaignPerformance: CampaignPerformanceSummary | null;
  analysisSources: AnalysisSources;
  scenario: OptimizationScenario;
  primaryAd: LiveAdRow | null;
  dataSource: 'live' | 'audit_only';
  selectedCampaignId?: string;
  selectedCampaign?: SelectedCampaignContext | null;
}

export interface SelectedCampaignContext {
  id: string;
  name: string;
  type: string;
  status: string;
  biddingStrategyType?: string;
  hasExistingAds: boolean;
  adCount: number;
  isPerformanceMax: boolean;
}

export interface AnalysisSources {
  campaignData: boolean;
  auditFindings: boolean;
  websiteAnalysis: boolean;
  competitorAnalysis: boolean;
  keywordAnalysis: boolean;
  searchTerms: boolean;
  landingPageAnalysis: boolean;
}

export interface CampaignPerformanceSummary {
  campaignId?: string;
  campaignName?: string;
  impressions: number;
  clicks: number;
  ctr: number;
  avgCpc: number;
  conversions: number;
  conversionRate: number;
  costPerConversion: number;
  cost: number;
  avgQualityScore?: number;
  biddingStrategy?: string;
  budgetDaily?: number;
  status?: string;
  campaignType?: string;
}

const MODULE_SLUGS = [
  'campaign',
  'keyword',
  'search-terms',
  'ad-copy',
  'landing-pages',
  'bidding',
  'quality-score',
  'device',
  'audience',
  'budget',
] as const;

function filterRowsByCampaign(rows: unknown[], campaignId: string): unknown[] {
  return rows.filter((row) => {
    const r = row as { campaign?: { id?: string } };
    return r.campaign?.id === campaignId;
  });
}

function computeAuditHealth(findings: Finding[]) {
  const critical = findings.filter((f) => f.severity === 'CRITICAL').length;
  const high = findings.filter((f) => f.severity === 'HIGH').length;
  const medium = findings.filter((f) => f.severity === 'MEDIUM').length;
  const penalty = critical * 12 + high * 6 + medium * 2;
  const score = Math.max(20, Math.min(100, 100 - penalty));
  return { score, critical, high, medium };
}

function extractCampaignPerformance(
  campaigns: unknown[],
  qualityScores: unknown[],
  campaignId?: string
): CampaignPerformanceSummary | null {
  const row = (campaignId
    ? campaigns.find((c) => (c as { campaign?: { id?: string } }).campaign?.id === campaignId)
    : campaigns[0]) as {
    campaign?: {
      id?: string;
      name?: string;
      status?: string;
      advertisingChannelType?: string;
      biddingStrategyType?: string;
    };
    metrics?: {
      impressions?: string | number;
      clicks?: string | number;
      ctr?: number;
      averageCpc?: number;
      conversions?: number;
      costMicros?: string | number;
      costPerConversion?: number;
    };
    campaignBudget?: { amountMicros?: string | number };
  } | undefined;

  if (!row?.campaign) return null;

  const impressions = Number(row.metrics?.impressions ?? 0);
  const clicks = Number(row.metrics?.clicks ?? 0);
  const conversions = Number(row.metrics?.conversions ?? 0);
  const costMicros = Number(row.metrics?.costMicros ?? 0);
  const cost = costMicros / 1_000_000;

  const qsRows = qualityScores as Array<{
    adGroupCriterion?: { qualityInfo?: { qualityScore?: number } };
  }>;
  const qsVals = qsRows
    .map((r) => r.adGroupCriterion?.qualityInfo?.qualityScore)
    .filter((v): v is number => typeof v === 'number' && v > 0);
  const avgQualityScore = qsVals.length
    ? Math.round((qsVals.reduce((a, b) => a + b, 0) / qsVals.length) * 10) / 10
    : undefined;

  const ctr =
    row.metrics?.ctr != null
      ? Math.round(Number(row.metrics.ctr) * 1000) / 10
      : impressions > 0
        ? Math.round((clicks / impressions) * 1000) / 10
        : 0;

  return {
    campaignId: row.campaign.id,
    campaignName: row.campaign.name,
    impressions,
    clicks,
    ctr,
    avgCpc: row.metrics?.averageCpc
      ? Math.round(Number(row.metrics.averageCpc) / 10_000) / 100
      : clicks > 0
        ? Math.round((cost / clicks) * 100) / 100
        : 0,
    conversions,
    conversionRate: clicks > 0 ? Math.round((conversions / clicks) * 1000) / 10 : 0,
    costPerConversion: row.metrics?.costPerConversion
      ? Math.round(Number(row.metrics.costPerConversion) / 1_000_000)
      : conversions > 0
        ? Math.round(cost / conversions)
        : 0,
    cost: Math.round(cost * 100) / 100,
    avgQualityScore,
    biddingStrategy: row.campaign.biddingStrategyType,
    budgetDaily: row.campaignBudget?.amountMicros
      ? Math.round(Number(row.campaignBudget.amountMicros) / 1_000_000)
      : undefined,
    status: row.campaign.status,
    campaignType: row.campaign.advertisingChannelType,
  };
}

function parseGaqlJson(raw: string): unknown[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeStringArray(val: unknown): string[] {
  if (!val) return [];
  if (Array.isArray(val)) return val.flatMap((v) => normalizeStringArray(v));
  if (typeof val === 'string') return [val.trim()].filter(Boolean);
  if (typeof val === 'object') {
    const o = val as Record<string, unknown>;
    const text = o.text ?? o.linkText ?? o.label ?? o.name ?? o.headline ?? o.value;
    if (typeof text === 'string' && text.trim()) return [text.trim()];
  }
  return [];
}

function parseAdRows(rows: unknown[]): LiveAdRow[] {
  const ads: LiveAdRow[] = [];
  for (const row of rows) {
    const r = row as {
      campaign?: { id?: string; name?: string; resourceName?: string };
      adGroup?: { id?: string; name?: string; resourceName?: string };
      adGroupAd?: {
        resourceName?: string;
        adStrength?: string;
        ad?: {
          responsiveSearchAd?: {
            headlines?: Array<{ text?: string }>;
            descriptions?: Array<{ text?: string }>;
          };
          finalUrls?: string[];
        };
      };
      metrics?: {
        impressions?: string;
        clicks?: string;
        conversions?: number;
        costMicros?: string;
      };
    };

    const rsa = r.adGroupAd?.ad?.responsiveSearchAd;
    const headlines = (rsa?.headlines ?? []).map((h) => h.text ?? '').filter(Boolean);
    const descriptions = (rsa?.descriptions ?? []).map((d) => d.text ?? '').filter(Boolean);

    if (!headlines.length && !descriptions.length) continue;

    const impressions = Number(r.metrics?.impressions ?? 0);
    const clicks = Number(r.metrics?.clicks ?? 0);

    ads.push({
      campaignId: r.campaign?.id,
      campaignName: r.campaign?.name,
      campaignResourceName: r.campaign?.resourceName,
      adGroupId: r.adGroup?.id,
      adGroupName: r.adGroup?.name,
      adGroupResourceName: r.adGroup?.resourceName,
      adGroupAdResourceName: r.adGroupAd?.resourceName,
      headlines,
      descriptions,
      finalUrls: r.adGroupAd?.ad?.finalUrls,
      adStrength: r.adGroupAd?.adStrength,
      impressions,
      clicks,
      conversions: r.metrics?.conversions,
      ctr: impressions > 0 ? Math.round((clicks / impressions) * 1000) / 10 : 0,
      costMicros: Number(r.metrics?.costMicros ?? 0),
    });
  }
  return ads;
}

function isPerformanceMaxType(type?: string): boolean {
  return !!type && /PERFORMANCE_MAX|PERFORMANCE\s*MAX/i.test(type);
}

function buildPerformanceFromContext(
  campaignId: string,
  ctx: NonNullable<Parameters<typeof gatherAuditIntelligence>[0]['accountContext']>
): CampaignPerformanceSummary | null {
  if (!ctx?.campaignName && !ctx?.campaignMetrics) return null;
  const m = ctx.campaignMetrics;
  return {
    campaignId,
    campaignName: ctx.campaignName,
    impressions: m?.impressions ?? 0,
    clicks: m?.clicks ?? 0,
    ctr: m?.ctr ?? 0,
    avgCpc: m?.avgCpc ?? 0,
    conversions: m?.conversions ?? 0,
    conversionRate: m?.conversionRate ?? 0,
    costPerConversion: m?.costPerConversion ?? 0,
    cost: m?.cost ?? 0,
    budgetDaily: m?.budgetDaily,
    biddingStrategy: ctx.biddingStrategyType,
    status: ctx.campaignStatus,
    campaignType: ctx.campaignType,
  };
}

function buildSelectedCampaignContext(
  campaignId: string | undefined,
  ctx: Parameters<typeof gatherAuditIntelligence>[0]['accountContext']
): SelectedCampaignContext | null {
  if (!campaignId || !ctx?.campaignName) return null;
  const adCount = ctx.adCount ?? (ctx.hasExistingAds ? 1 : 0);
  return {
    id: campaignId,
    name: ctx.campaignName,
    type: ctx.campaignType ?? 'UNKNOWN',
    status: ctx.campaignStatus ?? 'UNKNOWN',
    biddingStrategyType: ctx.biddingStrategyType,
    hasExistingAds: !!ctx.hasExistingAds,
    adCount,
    isPerformanceMax: isPerformanceMaxType(ctx.campaignType),
  };
}

function buildFindingsFromAudit(auditFindings: Finding[]) {
  return {
    critical: auditFindings.filter((f) => f.severity === 'CRITICAL'),
    high: auditFindings.filter((f) => f.severity === 'HIGH'),
    medium: auditFindings.filter((f) => f.severity === 'MEDIUM'),
    all: auditFindings,
  };
}

export async function gatherAuditIntelligence(options: {
  auditId: string;
  userId: string;
  dataWindowDays?: number;
  campaignId?: string;
  accountContext?: {
    accountName?: string;
    goal?: string;
    monthlySpend?: number;
    googleAdsCustomerId?: string;
    websiteUrl?: string;
    industry?: string;
    campaignId?: string;
    campaignName?: string;
    campaignType?: string;
    campaignStatus?: string;
    biddingStrategyType?: string;
    hasExistingAds?: boolean;
    adCount?: number;
    findingCategory?: string;
    findingTitle?: string;
    primaryAdSnapshot?: {
      headlines?: string[];
      descriptions?: string[];
      finalUrls?: string[];
      displayPath1?: string;
      displayPath2?: string;
      adStrength?: string;
      ctr?: number;
      conversions?: number;
      impressions?: number;
      clicks?: number;
      adGroupName?: string;
      resourceName?: string;
    };
    campaignMetrics?: {
      impressions?: number;
      clicks?: number;
      ctr?: number;
      avgCpc?: number;
      conversions?: number;
      conversionRate?: number;
      costPerConversion?: number;
      cost?: number;
      budgetDaily?: number;
    };
  };
  auditFindingsSnapshot?: Finding[];
  lightweight?: boolean;
}): Promise<AuditIntelligence> {
  const stored = await getAuditReport(options.auditId);
  const findings = buildFindingsFromAudit(
    stored?.findings ?? options.auditFindingsSnapshot ?? []
  );

  const business = {
    name: resolveBusinessName(
      stored?.accountName ?? options.accountContext?.accountName ?? 'Account',
      stored?.websiteUrl ?? options.accountContext?.websiteUrl,
    ),
    goal: stored?.goal ?? options.accountContext?.goal,
    websiteUrl: stored?.websiteUrl ?? options.accountContext?.websiteUrl,
    monthlySpend: stored?.monthlySpend ?? options.accountContext?.monthlySpend,
    campaignCount: stored?.campaignCount,
  };

  const customerId = stored?.googleAdsCustomerId ?? options.accountContext?.googleAdsCustomerId;
  const campaignId = options.campaignId ?? options.accountContext?.campaignId;
  const windowDays = stored?.dataWindowDays ?? options.dataWindowDays ?? 30;
  const dateRange = windowDays >= 365 ? 'LAST_365_DAYS' : windowDays >= 90 ? 'LAST_90_DAYS' : 'LAST_30_DAYS';

  let campaigns: unknown[] = [];
  let keywords: unknown[] = [];
  let searchTerms: unknown[] = [];
  let ads: LiveAdRow[] = [];
  let landingPages: unknown[] = [];
  let bidding: unknown[] = [];
  let qualityScores: unknown[] = [];
  let devices: unknown[] = [];
  let audiences: unknown[] = [];
  let budgets: unknown[] = [];
  let dataSource: 'live' | 'audit_only' = 'audit_only';

  const user = await getMe(options.userId);
  if (!options.lightweight && user?.googleRefreshToken && customerId && isGoogleAdsConfigured()) {
    const googleAdsStart = Date.now();
    const settled = await Promise.allSettled(
      MODULE_SLUGS.map(async (slug) =>
        withTimeoutFallback(
          fetchModuleGoogleAdsData(
            user.googleRefreshToken!,
            customerId,
            slug,
            dateRange,
            options.userId,
            campaignId
          ).then((raw) => ({ slug, rows: parseGaqlJson(raw) })),
          20_000,
          { slug, rows: [] as unknown[] },
          `google-ads:${slug}`
        )
      )
    );
    const fetches = settled
      .filter((r): r is PromiseFulfilledResult<{ slug: (typeof MODULE_SLUGS)[number]; rows: unknown[] }> => r.status === 'fulfilled')
      .map((r) => r.value);
    console.log(`[gatherAuditIntelligence] Google Ads modules fetched in ${Date.now() - googleAdsStart}ms (${fetches.filter((f) => f.rows.length).length}/${MODULE_SLUGS.length} with data)`);

    for (const { slug, rows } of fetches) {
      if (!rows.length) continue;
      dataSource = 'live';
      switch (slug) {
        case 'campaign':
          campaigns = rows;
          break;
        case 'keyword':
          keywords = rows;
          break;
        case 'search-terms':
          searchTerms = rows;
          break;
        case 'ad-copy':
          ads = parseAdRows(rows);
          break;
        case 'landing-pages':
          landingPages = rows;
          break;
        case 'bidding':
          bidding = rows;
          break;
        case 'quality-score':
          qualityScores = rows;
          break;
        case 'device':
          devices = rows;
          break;
        case 'audience':
          audiences = rows;
          break;
        case 'budget':
          budgets = rows;
          break;
      }
    }
  }

  if (campaignId) {
    campaigns = filterRowsByCampaign(campaigns, campaignId);
    ads = ads.filter((a) => a.campaignId === campaignId);
    keywords = filterRowsByCampaign(keywords, campaignId);
    searchTerms = filterRowsByCampaign(searchTerms, campaignId);
    landingPages = filterRowsByCampaign(landingPages, campaignId);
    bidding = filterRowsByCampaign(bidding, campaignId);
    qualityScores = filterRowsByCampaign(qualityScores, campaignId);
    devices = filterRowsByCampaign(devices, campaignId);
    audiences = filterRowsByCampaign(audiences, campaignId);
    budgets = filterRowsByCampaign(budgets, campaignId);
  }

  const snap = options.accountContext?.primaryAdSnapshot;
  if (!ads.length && snap && typeof snap === 'object') {
    const snapHeadlines = normalizeStringArray((snap as { headlines?: unknown }).headlines);
    if (snapHeadlines.length) {
      const s = snap as {
        headlines?: unknown;
        descriptions?: unknown;
        finalUrls?: string[];
        adStrength?: string;
        ctr?: number;
        conversions?: number;
        impressions?: number;
        clicks?: number;
        adGroupName?: string;
        resourceName?: string;
      };
      ads = [{
        campaignId,
        campaignName: options.accountContext?.campaignName,
        headlines: snapHeadlines,
        descriptions: normalizeStringArray(s.descriptions),
        finalUrls: s.finalUrls,
        adStrength: s.adStrength,
        ctr: s.ctr,
        conversions: s.conversions,
        impressions: s.impressions,
        clicks: s.clicks,
        adGroupName: s.adGroupName,
        adGroupAdResourceName: s.resourceName,
      }];
      dataSource = 'live';
    }
  }

  const websiteUrl = business.websiteUrl;
  const websiteAnalysis = options.lightweight
    ? (websiteUrl
      ? {
          url: websiteUrl.startsWith('http') ? websiteUrl : `https://${websiteUrl}`,
          fetched: false,
          headings: [],
          offers: [],
          services: [],
          ctas: [],
          locations: [],
          usps: [],
          rawTextSample: '',
        }
      : null)
    : await withTimeoutFallback(
    analyzeWebsite(websiteUrl),
    8_000,
    websiteUrl ? {
      url: websiteUrl.startsWith('http') ? websiteUrl : `https://${websiteUrl}`,
      fetched: false,
      headings: [],
      offers: [],
      services: [],
      ctas: [],
      locations: [],
      usps: [],
      rawTextSample: '',
      error: 'Website fetch timed out',
    } : null,
    'website-analysis'
  );
  const competitorAnalysis = options.lightweight
    ? {
        competitors: [],
        keywordOpportunities: [],
        messagingOpportunities: [],
        missingOffers: [],
        competitiveAdvantages: [],
        source: 'unavailable' as const,
      }
    : await withTimeoutFallback(
    analyzeCompetitors({
      businessName: business.name,
      websiteUrl,
      industry: options.accountContext?.industry,
      websiteIntel: websiteAnalysis,
    }),
    20_000,
    {
      competitors: [],
      keywordOpportunities: [],
      messagingOpportunities: [],
      missingOffers: [],
      competitiveAdvantages: [],
      source: 'unavailable' as const,
    },
    'competitor-analysis'
  );

  const auditHealth = computeAuditHealth(findings.all);
  let campaignPerformance = extractCampaignPerformance(campaigns, qualityScores, campaignId);
  if (!campaignPerformance && campaignId && options.accountContext) {
    campaignPerformance = buildPerformanceFromContext(campaignId, options.accountContext);
  }

  const selectedCampaign = buildSelectedCampaignContext(campaignId, options.accountContext);

  const analysisSources: AnalysisSources = {
    campaignData: campaigns.length > 0 || dataSource === 'live',
    auditFindings: findings.all.length > 0,
    websiteAnalysis: !!websiteAnalysis?.fetched,
    competitorAnalysis: (competitorAnalysis?.competitors?.length ?? 0) > 0,
    keywordAnalysis: keywords.length > 0,
    searchTerms: searchTerms.length > 0,
    landingPageAnalysis: landingPages.length > 0 || !!websiteUrl,
  };

  let scenario: OptimizationScenario = 'CREATE_STRATEGY';
  if (ads.length > 0) scenario = 'REPLACE_EXISTING';
  else if (campaignId || campaigns.length > 0 || selectedCampaign) scenario = 'CREATE_ADS';

  const primaryAd =
    ads.length > 0
      ? [...ads].sort((a, b) => (b.impressions ?? 0) - (a.impressions ?? 0))[0]
      : null;

  return {
    business,
    findings,
    campaigns,
    keywords,
    searchTerms,
    ads,
    landingPages,
    bidding,
    qualityScores,
    devices,
    audiences,
    budgets,
    websiteAnalysis,
    competitorAnalysis,
    auditHealth,
    campaignPerformance,
    analysisSources,
    scenario,
    primaryAd,
    dataSource,
    selectedCampaignId: campaignId,
    selectedCampaign,
  };
}
