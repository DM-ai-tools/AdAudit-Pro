import { createClaudeMessage } from '../ai/anthropic-client.js';
import { env } from '../config/env.js';
import type { OptimizationMode } from '../ai/prompts/full-optimize-ad.prompt.js';
import {
  buildFullOptimizeAdPrompt,
  buildCompactOptimizeRetryPrompt,
  liveAdToCurrentAd,
} from '../ai/prompts/full-optimize-ad.prompt.js';
import { getAuditReport } from './audit.service.js';
import {
  gatherAuditIntelligence,
  type AuditIntelligence,
  type OptimizationScenario,
} from './audit-intelligence.service.js';
import type { Finding } from '../types/index.js';
import { prisma } from '../lib/prisma.js';
import type { CompetitorIntelligence } from './competitor-intelligence.service.js';
import { analyzeCompetitors } from './competitor-intelligence.service.js';
import { extractJsonFromClaudeText } from '../utils/claude-json.js';
import {
  displayPathFromWebsite,
  resolveBusinessName,
  resolveDisplayHost,
} from '../utils/business-identity.js';

export type OptimizationTone =
  | 'default'
  | 'professional'
  | 'luxury'
  | 'high-conversion'
  | 'aggressive'
  | 'shorter';
export type { OptimizationMode } from '../ai/prompts/full-optimize-ad.prompt.js';

export interface CurrentAdData {
  headlines: string[];
  longHeadlines?: string[];
  descriptions: string[];
  cta?: string;
  keywords?: string[];
  displayPath1?: string;
  displayPath2?: string;
  qualityScore?: number;
  ctr?: number;
  conversions?: number;
  adStrength?: string;
  adGroupAdResourceName?: string;
  campaignId?: string;
  adGroupId?: string;
  campaignResourceName?: string;
  adGroupResourceName?: string;
  campaignName?: string;
  adGroupName?: string;
  finalUrls?: string[];
}

export interface PerformanceMetrics {
  ctr?: string;
  qualityScore?: string;
  conversionRate?: string;
  cpa?: string;
  roas?: string;
  monthlyLeads?: string;
  monthlySavings?: string;
}

export interface PerformanceEstimates {
  label: string;
  current: PerformanceMetrics;
  estimated: PerformanceMetrics;
}

export interface CompetitiveOutperformance {
  messagingImprovements: string;
  keywordImprovements: string;
  offerImprovements: string;
  conversionImprovements: string;
}

export interface CompetitorInsightCard {
  name: string;
  url?: string;
  keyMessages: string[];
  offers: string[];
  keywordOpportunities: string[];
}

export interface StrategistReasoning {
  headlineChanges: string;
  descriptionChanges: string;
  keywordRelevance: string;
  qualityScore: string;
  conversionPotential: string;
  auditFindingsAddressed: string[];
  competitorInsightsUsed: string[];
  competitiveOutperformance?: CompetitiveOutperformance;
}

export interface AccountImpact {
  currentAccountHealth?: number;
  predictedAccountHealth?: number;
  currentMonthlyLeads?: string;
  estimatedMonthlyLeads?: string;
  currentWastedSpend?: string;
  estimatedWastedSpend?: string;
  currentRoas?: string;
  estimatedRoas?: string;
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

export interface StrategistRecommendations {
  keywords: string[];
  negativeKeywords: string[];
  extensions: string[];
  landingPage: string[];
  budget: string[];
  bidding: string[];
  audience: string[];
}

export interface OptimizedAdContent {
  campaignId?: string;
  adGroupId?: string;
  headlines: string[];
  longHeadlines?: string[];
  descriptions: string[];
  ctaSuggestions: string[];
  keywordSuggestions: string[];
  displayPaths?: { path1?: string; path2?: string };
  adExtensions?: {
    sitelinks?: string[];
    callouts?: string[];
    structuredSnippets?: string[];
  };
  campaignStrategy?: {
    campaignName?: string;
    campaignType?: string;
    dailyBudget?: number;
    adGroups?: Array<{ name: string; keywords: string[] }>;
    negativeKeywords?: string[];
    competitorInsights?: string[];
  };
  improvementReasoning: string;
  predictedImpact: {
    ctrIncrease: string;
    qualityScoreIncrease: string;
    conversionImprovement: string;
  };
  performanceEstimates?: PerformanceEstimates;
  campaignHealth?: { currentScore: number; predictedScore: number; explanation: string };
  accountImpact?: AccountImpact;
  strategistReasoning?: StrategistReasoning;
  strategistRecommendations?: StrategistRecommendations;
  competitorInsights?: CompetitorInsightCard[];
  missingCompetitorAdvantages?: string[];
  keywordImprovements?: string[];
  negativeKeywordSuggestions?: string[];
  landingPageRecommendations?: string[];
}

export interface OptimizeAdRequest {
  userId: string;
  auditId: string;
  findingId: string;
  tone?: OptimizationTone;
  optimizationMode?: OptimizationMode;
  variation?: 'regenerate' | 'shorter' | 'more-variations' | 'aggressive-cta';
  customPrompt?: string;
  regenerateOnly?: boolean;
  findingSnapshot?: Finding;
  auditFindingsSnapshot?: Finding[];
  accountContext?: {
    accountName?: string;
    goal?: string;
    monthlySpend?: number;
    googleAdsCustomerId?: string;
    websiteUrl?: string;
    industry?: string;
    location?: string;
    competitorUrls?: string[];
    productsServices?: string[];
    userId?: string;
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
    previousOptimizedSnapshot?: {
      headlines?: string[];
      descriptions?: string[];
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
}

export interface OptimizeAdResult {
  optimizationId: string;
  scenario: OptimizationScenario;
  dataSource: 'live' | 'audit_only';
  originalAd: CurrentAdData;
  optimized: OptimizedAdContent;
  finding: Pick<Finding, 'id' | 'title' | 'category' | 'dimension'>;
  intelligenceSummary: {
    findingsAnalyzed: number;
    campaignsLoaded: number;
    keywordsLoaded: number;
    searchTermsLoaded: number;
    adsFound: number;
    devicesLoaded: number;
    audiencesLoaded: number;
  };
  analysisSources: AnalysisSources;
  campaignPerformance?: import('./audit-intelligence.service.js').CampaignPerformanceSummary | null;
  auditHealthScore?: number;
  competitorAnalysis?: CompetitorIntelligence | null;
}

const VARIATION_HINTS: Record<string, string> = {
  regenerate:
    'REGENERATE: Produce a completely fresh ad. Study competitor adGallery copy and out-position rivals with NEW headlines/descriptions — do not reuse or lightly reword the PREVIOUS AI OPTIMIZATION.',
  shorter: 'Prioritize shorter, punchier headlines and descriptions.',
  'more-variations': 'Maximize headline/description diversity for RSA ad strength.',
  'aggressive-cta': 'Use stronger, more urgent call-to-action language.',
};

function countRealCompetitorAds(analysis: CompetitorIntelligence | null | undefined): number {
  return (
    analysis?.adGallery?.filter(
      (g) => g.adSource === 'sociavault' || g.adSource === 'transparency_center'
    ).length ?? 0
  );
}

function normalizeStringArray(val: unknown): string[] {
  if (!val) return [];
  if (Array.isArray(val)) {
    return val.flatMap((v) => normalizeStringArray(v));
  }
  if (typeof val === 'string') return [val.trim()].filter(Boolean);
  if (typeof val === 'object') {
    const o = val as Record<string, unknown>;
    const text = o.text ?? o.linkText ?? o.label ?? o.name ?? o.headline ?? o.value;
    const url = o.url ?? o.finalUrl ?? o.href;
    if (typeof text === 'string' && text.trim()) {
      const label = text.trim();
      if (typeof url === 'string' && url.trim()) {
        return [`${label} (${url.trim()})`];
      }
      return [label];
    }
    if (typeof url === 'string' && url.trim()) return [url.trim()];
  }
  return [];
}

function asDisplayText(val: unknown, fallback = ''): string {
  if (val == null) return fallback;
  if (typeof val === 'string') return val;
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  const fromList = normalizeStringArray(val);
  if (fromList.length) return fromList.join(', ');
  return fallback;
}

function finalizeDescription(text: string): string {
  let s = text.trim().replace(/\s+/g, ' ');
  if (!s) return s;
  if (s.length > 90) {
    s = s.slice(0, 90);
    const lastSpace = s.lastIndexOf(' ');
    if (lastSpace > 55) s = s.slice(0, lastSpace);
  }
  s = s.replace(/[,;\s]+$/, '');
  if (!/[.!?]$/.test(s)) s += '.';
  return s.slice(0, 90);
}

function enforceGoogleAdsLimits(
  headlines: string[],
  descriptions: string[],
  brand: string
): { headlines: string[]; descriptions: string[] } {
  const h = headlines.map((s) => s.trim().slice(0, 30)).filter(Boolean);
  const d = descriptions.map((s) => finalizeDescription(s)).filter(Boolean);

  const fallbacksH = [
    `${brand} — Get Started`,
    `Trusted ${brand} Experts`,
    'Free Consultation Today',
    'Book Online Now',
    'Call For a Quote',
  ];
  const fallbacksD = [
    `${brand} delivers results you can measure. Contact us for a free consultation today.`,
    'Professional services tailored to your goals. Start improving performance now.',
  ];

  while (h.length < 5) {
    const next = fallbacksH[h.length % fallbacksH.length];
    if (!h.includes(next)) h.push(next.slice(0, 30));
    else break;
  }
  while (d.length < 2) {
    const next = finalizeDescription(fallbacksD[d.length % fallbacksD.length]);
    if (!d.includes(next)) d.push(next);
    else break;
  }

  return { headlines: h.slice(0, 15), descriptions: d.slice(0, 4).map(finalizeDescription) };
}

function buildBaselinePerformance(
  intelligence: AuditIntelligence
): PerformanceMetrics {
  const perf = intelligence.campaignPerformance;
  const ad = intelligence.primaryAd;
  if (perf) {
    return {
      ctr: `${perf.ctr}%`,
      qualityScore: perf.avgQualityScore != null ? String(perf.avgQualityScore) : undefined,
      conversionRate: `${perf.conversionRate}%`,
      cpa: perf.costPerConversion > 0 ? `$${perf.costPerConversion}` : undefined,
      monthlyLeads: perf.conversions > 0 ? String(Math.round(perf.conversions)) : undefined,
      monthlySavings: perf.cost > 0 ? `$${Math.round(perf.cost * 0.1)}/mo est. waste` : undefined,
    };
  }
  return {
    ctr: ad?.ctr != null ? `${ad.ctr}%` : undefined,
    conversionRate: undefined,
    qualityScore: undefined,
  };
}

function parseClaudeJson(
  text: string,
  brand: string,
  baseline: PerformanceMetrics,
  intelligence: AuditIntelligence
): OptimizedAdContent {
  const parsed = extractJsonFromClaudeText(text);

  let headlines = normalizeStringArray(parsed.headlines);
  let descriptions = normalizeStringArray(parsed.descriptions);

  // Some Claude responses nest RSA under responsiveSearchAd
  const rsa = parsed.responsiveSearchAd as Record<string, unknown> | undefined;
  if (rsa) {
    if (!headlines.length) headlines = normalizeStringArray(rsa.headlines);
    if (!descriptions.length) descriptions = normalizeStringArray(rsa.descriptions);
  }

  ({ headlines, descriptions } = enforceGoogleAdsLimits(headlines, descriptions, brand));

  const displayPathsRaw = parsed.displayPaths ?? rsa?.displayPaths;
  let displayPaths: { path1?: string; path2?: string } | undefined;
  if (Array.isArray(displayPathsRaw)) {
    displayPaths = {
      path1: String(displayPathsRaw[0] ?? '').slice(0, 15) || undefined,
      path2: String(displayPathsRaw[1] ?? '').slice(0, 15) || undefined,
    };
  } else if (displayPathsRaw && typeof displayPathsRaw === 'object') {
    const dp = displayPathsRaw as { path1?: string; path2?: string };
    displayPaths = {
      path1: dp.path1?.slice(0, 15),
      path2: dp.path2?.slice(0, 15),
    };
  }

  const predicted = parsed.predictedImprovements as Record<string, string> | undefined;
  const legacyPredicted = parsed.predictedImpact as Record<string, string> | undefined;

  const perfRaw = parsed.performanceEstimates as Record<string, unknown> | undefined;
  const parsePerf = (raw: unknown): PerformanceMetrics => {
    if (!raw || typeof raw !== 'object') return {};
    const m = raw as Record<string, unknown>;
    const pick = (k: string) => (m[k] != null ? String(m[k]) : undefined);
    return {
      ctr: pick('ctr'),
      qualityScore: pick('qualityScore'),
      conversionRate: pick('conversionRate'),
      cpa: pick('cpa'),
      roas: pick('roas'),
      monthlyLeads: pick('monthlyLeads'),
      monthlySavings: pick('monthlySavings'),
    };
  };

  const performanceEstimates: PerformanceEstimates = {
    label: String(perfRaw?.label ?? 'AI Estimated Impact'),
    current: { ...baseline, ...parsePerf(perfRaw?.current) },
    estimated: parsePerf(perfRaw?.estimated),
  };

  const healthRaw = parsed.campaignHealth as Record<string, unknown> | undefined;
  const campaignHealth = healthRaw
    ? {
        currentScore: Number(healthRaw.currentScore ?? intelligence.auditHealth.score),
        predictedScore: Number(healthRaw.predictedScore ?? Math.min(100, intelligence.auditHealth.score + 15)),
        explanation: String(healthRaw.explanation ?? ''),
      }
    : {
        currentScore: intelligence.auditHealth.score,
        predictedScore: Math.min(100, intelligence.auditHealth.score + 18),
        explanation: 'Improved ad relevance, keyword alignment, and landing page messaging.',
      };

  const accountRaw = parsed.accountImpact as Record<string, unknown> | undefined;
  const accountImpact: AccountImpact | undefined = accountRaw
    ? {
        currentAccountHealth: Number(accountRaw.currentAccountHealth ?? intelligence.auditHealth.score),
        predictedAccountHealth: Number(accountRaw.predictedAccountHealth ?? campaignHealth.predictedScore),
        currentMonthlyLeads: accountRaw.currentMonthlyLeads != null ? String(accountRaw.currentMonthlyLeads) : undefined,
        estimatedMonthlyLeads: accountRaw.estimatedMonthlyLeads != null ? String(accountRaw.estimatedMonthlyLeads) : undefined,
        currentWastedSpend: accountRaw.currentWastedSpend != null ? String(accountRaw.currentWastedSpend) : undefined,
        estimatedWastedSpend: accountRaw.estimatedWastedSpend != null ? String(accountRaw.estimatedWastedSpend) : undefined,
        currentRoas: accountRaw.currentRoas != null ? String(accountRaw.currentRoas) : undefined,
        estimatedRoas: accountRaw.estimatedRoas != null ? String(accountRaw.estimatedRoas) : undefined,
      }
    : undefined;

  const srRaw = parsed.strategistReasoning as Record<string, unknown> | undefined;
  const coRaw = srRaw?.competitiveOutperformance as Record<string, unknown> | undefined;
  const competitiveOutperformance: CompetitiveOutperformance | undefined = coRaw
    ? {
        messagingImprovements: String(coRaw.messagingImprovements ?? ''),
        keywordImprovements: String(coRaw.keywordImprovements ?? ''),
        offerImprovements: String(coRaw.offerImprovements ?? ''),
        conversionImprovements: String(coRaw.conversionImprovements ?? ''),
      }
    : undefined;

  const strategistReasoning: StrategistReasoning | undefined = srRaw
    ? {
        headlineChanges: String(srRaw.headlineChanges ?? ''),
        descriptionChanges: String(srRaw.descriptionChanges ?? ''),
        keywordRelevance: String(srRaw.keywordRelevance ?? ''),
        qualityScore: String(srRaw.qualityScore ?? ''),
        conversionPotential: String(srRaw.conversionPotential ?? ''),
        auditFindingsAddressed: normalizeStringArray(srRaw.auditFindingsAddressed),
        competitorInsightsUsed: normalizeStringArray(srRaw.competitorInsightsUsed),
        competitiveOutperformance,
      }
    : undefined;

  const competitorInsightsRaw = parsed.competitorInsights;
  let competitorInsights: CompetitorInsightCard[] = [];
  if (Array.isArray(competitorInsightsRaw)) {
    for (const row of competitorInsightsRaw) {
      if (!row || typeof row !== 'object') continue;
      const o = row as Record<string, unknown>;
      const name = String(o.name ?? '').trim();
      if (!name) continue;
      competitorInsights.push({
        name,
        url: o.url != null ? String(o.url) : undefined,
        keyMessages: normalizeStringArray(o.keyMessages),
        offers: normalizeStringArray(o.offers),
        keywordOpportunities: normalizeStringArray(o.keywordOpportunities),
      });
    }
  } else if (intelligence.competitorAnalysis?.insights?.length) {
    competitorInsights = intelligence.competitorAnalysis.insights.map((i) => ({
      name: i.name,
      url: i.url,
      keyMessages: i.keyMessages,
      offers: i.offers,
      keywordOpportunities: i.keywordOpportunities,
    }));
  }

  const missingCompetitorAdvantages = normalizeStringArray(
    Array.isArray(parsed.missingCompetitorAdvantages) && parsed.missingCompetitorAdvantages.length
      ? parsed.missingCompetitorAdvantages
      : intelligence.competitorAnalysis?.missingFromYourAds
  );

  const strategistRecommendations: StrategistRecommendations = {
    keywords: normalizeStringArray(parsed.recommendedKeywords ?? parsed.keywordImprovements),
    negativeKeywords: normalizeStringArray(parsed.negativeKeywordSuggestions),
    extensions: normalizeStringArray(parsed.recommendedExtensions),
    landingPage: normalizeStringArray(parsed.landingPageRecommendations),
    budget: normalizeStringArray(parsed.budgetRecommendations),
    bidding: normalizeStringArray(parsed.biddingRecommendations),
    audience: normalizeStringArray(parsed.audienceRecommendations),
  };

  return {
    campaignId: (parsed.campaignId as string) || undefined,
    adGroupId: (parsed.adGroupId as string) || undefined,
    headlines: headlines.slice(0, 15),
    descriptions: descriptions.slice(0, 4),
    ctaSuggestions: (parsed.ctaSuggestions as string[]) ?? ['Get Quote', 'Call Now', 'Book Online'],
    keywordSuggestions: (parsed.keywordSuggestions as string[]) ?? [],
    displayPaths,
    adExtensions: {
      sitelinks: normalizeStringArray(parsed.sitelinks ?? (parsed.adExtensions as Record<string, unknown> | undefined)?.sitelinks),
      callouts: normalizeStringArray(parsed.callouts ?? (parsed.adExtensions as Record<string, unknown> | undefined)?.callouts),
      structuredSnippets: normalizeStringArray(
        parsed.structuredSnippets ?? (parsed.adExtensions as Record<string, unknown> | undefined)?.structuredSnippets
      ),
    },
    campaignStrategy: parsed.campaignStrategy as OptimizedAdContent['campaignStrategy'],
    improvementReasoning:
      asDisplayText(parsed.reasoning) ||
      asDisplayText(parsed.improvementReasoning) ||
      'Optimized using full audit intelligence for CTR, quality score, and conversions.',
    predictedImpact: {
      ctrIncrease: predicted?.ctr ?? legacyPredicted?.ctrIncrease ?? performanceEstimates.estimated.ctr ?? '+18% est.',
      qualityScoreIncrease: predicted?.qualityScore ?? legacyPredicted?.qualityScoreIncrease ?? performanceEstimates.estimated.qualityScore ?? '+1.5 est.',
      conversionImprovement:
        predicted?.conversionRate ?? legacyPredicted?.conversionImprovement ?? performanceEstimates.estimated.conversionRate ?? '+14% est.',
    },
    performanceEstimates,
    campaignHealth,
    accountImpact,
    strategistReasoning,
    strategistRecommendations,
    competitorInsights: competitorInsights.length ? competitorInsights : undefined,
    missingCompetitorAdvantages: missingCompetitorAdvantages.length
      ? missingCompetitorAdvantages
      : undefined,
    keywordImprovements: strategistRecommendations.keywords,
    negativeKeywordSuggestions: strategistRecommendations.negativeKeywords,
    landingPageRecommendations: strategistRecommendations.landingPage,
  };
}

function intelligenceToCurrentAd(
  intelligence: AuditIntelligence,
  finding: Finding
): CurrentAdData {
  const bizName = resolveBusinessName(
    intelligence.business.name,
    intelligence.business.websiteUrl
  );
  const brand = bizName.split(' ')[0];

  const ad = intelligence.primaryAd;
  const base = liveAdToCurrentAd(ad, bizName, intelligence.business.websiteUrl);

  const displayHost = resolveDisplayHost(intelligence.business.websiteUrl, bizName);
  const pathBrand = displayPathFromWebsite(intelligence.business.websiteUrl);

  if (ad) {
    const perf = intelligence.campaignPerformance;
    return {
      ...base,
      ctr: ad.ctr ?? perf?.ctr,
      qualityScore: perf?.avgQualityScore,
      conversions: ad.conversions ?? perf?.conversions,
      adGroupAdResourceName: ad.adGroupAdResourceName,
      campaignId: ad.campaignId,
      adGroupId: ad.adGroupId,
      campaignResourceName: ad.campaignResourceName,
      adGroupResourceName: ad.adGroupResourceName,
      campaignName: ad.campaignName,
      adGroupName: ad.adGroupName,
      finalUrls: ad.finalUrls?.length
        ? ad.finalUrls
        : intelligence.business.websiteUrl
          ? [intelligence.business.websiteUrl.startsWith('http')
              ? intelligence.business.websiteUrl
              : `https://${intelligence.business.websiteUrl}`]
          : undefined,
      displayPath1: pathBrand,
      displayPath2: 'services',
    };
  }

  const noData = /no ad|no active|empty|not available|not detected|no data|no campaign/i.test(
    `${finding.title} ${finding.description}`
  );

  const selected = intelligence.selectedCampaign;
  const perf = intelligence.campaignPerformance;
  const campaignName = selected?.name ?? perf?.campaignName ?? `${bizName} - Search`;
  const isPmax = selected?.isPerformanceMax ?? /PERFORMANCE_MAX/i.test(perf?.campaignType ?? '');

  const placeholderHeadlines = isPmax
    ? [
        'No PMax Assets Yet',
        `${brand} — Shop Now`,
        'Premium Fragrance Oils',
        'Discover Our Collection',
        'Quality You Can Trust',
      ]
    : [
        `${brand} — Get Started`,
        `Trusted ${brand} Experts`,
        'Free Consultation',
        'Book Online Today',
        'Quality Service Guaranteed',
      ];

  const placeholderDescriptions = isPmax
    ? [
        `${campaignName} has no Performance Max text assets yet. AI will recommend headlines and descriptions for asset groups.`,
        `${bizName} — build asset groups with strong product messaging, offers, and CTAs aligned to your feed and landing pages.`,
      ]
    : [
        `${bizName} helps you reach more customers. Visit ${displayHost} to learn more and get started.`,
        'Professional service backed by proven results. Contact us today for your free consultation.',
      ];

  const website = intelligence.business.websiteUrl;
  const finalUrl = website
    ? (website.startsWith('http') ? website : `https://${website}`)
    : undefined;

  return {
    headlines: placeholderHeadlines.map((h) => h.slice(0, 30)),
    descriptions: placeholderDescriptions.map((d) => d.slice(0, 90)),
    keywords: [brand.toLowerCase(), 'services'],
    qualityScore: noData ? 0 : 3,
    ctr: perf?.ctr ?? 0,
    conversions: perf?.conversions ?? 0,
    adStrength: isPmax ? 'PENDING_ASSETS' : noData ? 'NONE' : 'POOR',
    campaignId: selected?.id ?? perf?.campaignId,
    campaignName,
    adGroupName: isPmax ? 'Asset Group (recommended)' : 'Core Services',
    displayPath1: pathBrand,
    displayPath2: 'services',
    finalUrls: finalUrl ? [finalUrl] : undefined,
    cta: isPmax ? 'Shop Now' : 'Learn More',
  };
}

async function resolveFinding(
  auditId: string,
  findingId: string,
  findingSnapshot?: Finding
): Promise<Finding> {
  const stored = await getAuditReport(auditId);
  const fromStore = stored?.findings.find((f) => f.id === findingId);
  if (fromStore) return fromStore;
  if (findingSnapshot) return { ...findingSnapshot, id: findingId };
  throw new Error('Finding not found — refresh the dashboard and try again.');
}

export async function optimizeAd(request: OptimizeAdRequest): Promise<OptimizeAdResult> {
  const startedAt = Date.now();
  const stored = await getAuditReport(request.auditId);
  if (!stored && !request.accountContext?.accountName) {
    throw new Error('Audit not found — refresh the page or run a new audit.');
  }

  const finding = await resolveFinding(request.auditId, request.findingId, request.findingSnapshot);

  console.log(`[optimizeAd] start audit=${request.auditId} finding=${request.findingId} campaign=${request.accountContext?.campaignId ?? 'all'}${request.regenerateOnly ? ' (regenerate-only)' : ''}`);

  let intelligence: AuditIntelligence;
  let previousOptimizedAd: { headlines: string[]; descriptions: string[] } | undefined;
  const useLightweight =
    request.regenerateOnly ||
    env.isProduction ||
    Boolean(request.accountContext?.primaryAdSnapshot) ||
    Boolean(request.accountContext?.campaignId);

  if (request.regenerateOnly) {
    const cached = await prisma.aIOptimization.findFirst({
      where: {
        auditRunId: request.auditId,
        findingId: request.findingId,
        userId: request.userId,
        ...(request.accountContext?.campaignId
          ? { campaignId: request.accountContext.campaignId }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
    if (cached?.auditContext && typeof cached.auditContext === 'object') {
      intelligence = cached.auditContext as unknown as AuditIntelligence;
      console.log(`[optimizeAd] reused cached intelligence (${Date.now() - startedAt}ms)`);
    } else {
      intelligence = await gatherAuditIntelligence({
        auditId: request.auditId,
        userId: request.userId,
        dataWindowDays: stored?.dataWindowDays,
        campaignId: request.accountContext?.campaignId,
        accountContext: request.accountContext,
        auditFindingsSnapshot: request.auditFindingsSnapshot ?? stored?.findings,
        lightweight: true,
      });
      console.log(`[optimizeAd] lightweight intelligence ready in ${Date.now() - startedAt}ms`);
    }

    if (cached?.optimizedContent && typeof cached.optimizedContent === 'object') {
      const prev = cached.optimizedContent as unknown as OptimizedAdContent;
      if (prev.headlines?.length) {
        previousOptimizedAd = {
          headlines: prev.headlines,
          descriptions: prev.descriptions ?? [],
        };
      }
    }
    const snapshot = request.accountContext?.previousOptimizedSnapshot;
    if (snapshot?.headlines?.length) {
      previousOptimizedAd = {
        headlines: snapshot.headlines,
        descriptions: snapshot.descriptions ?? previousOptimizedAd?.descriptions ?? [],
      };
    }
    if (previousOptimizedAd?.headlines?.length) {
      console.log(
        `[optimizeAd] regenerate avoiding ${previousOptimizedAd.headlines.length} previous headlines, gallery=${countRealCompetitorAds(intelligence.competitorAnalysis)} ads`
      );
    }
  } else {
    intelligence = await gatherAuditIntelligence({
      auditId: request.auditId,
      userId: request.userId,
      dataWindowDays: stored?.dataWindowDays,
      campaignId: request.accountContext?.campaignId,
      accountContext: request.accountContext,
      auditFindingsSnapshot: request.auditFindingsSnapshot ?? stored?.findings,
      lightweight: useLightweight,
    });
    console.log(`[optimizeAd] intelligence ready in ${Date.now() - startedAt}ms (source=${intelligence.dataSource}${useLightweight ? ', lightweight' : ''})`);
  }

  const needsCompetitorRefresh =
    !(intelligence.competitorAnalysis?.competitors?.length ?? 0) ||
    countRealCompetitorAds(intelligence.competitorAnalysis) < 4;

  if (needsCompetitorRefresh) {
    const websiteUrl = intelligence.business.websiteUrl;
    const refreshed = await analyzeCompetitors({
      businessName: intelligence.business.name,
      websiteUrl,
      industry: request.accountContext?.industry,
      location: request.accountContext?.location ?? intelligence.websiteAnalysis?.locations?.[0],
      productsServices: [
        ...(request.accountContext?.productsServices ?? []),
        ...(intelligence.websiteAnalysis?.services ?? []),
      ],
      competitorUrls: request.accountContext?.competitorUrls,
      websiteIntel: intelligence.websiteAnalysis,
      currentAd: request.accountContext?.primaryAdSnapshot
        ? {
            headlines: request.accountContext.primaryAdSnapshot.headlines ?? [],
            descriptions: request.accountContext.primaryAdSnapshot.descriptions ?? [],
          }
        : undefined,
      lightweight: useLightweight,
    });
    intelligence = {
      ...intelligence,
      competitorAnalysis: refreshed,
      analysisSources: {
        ...intelligence.analysisSources,
        competitorAnalysis: refreshed.competitors.length > 0,
      },
    };
    console.log(`[optimizeAd] competitor intelligence refreshed (${refreshed.competitors.length} competitors)`);
  }

  const originalAd = intelligenceToCurrentAd(intelligence, finding);
  const tone = request.tone ?? 'default';
  const variationHint = request.variation ? VARIATION_HINTS[request.variation] : undefined;
  const brand = resolveBusinessName(
    intelligence.business.name,
    intelligence.business.websiteUrl
  );

  const baseline = buildBaselinePerformance(intelligence);

  const claudeStart = Date.now();
  const promptCtx = {
    intelligence,
    finding,
    currentAd: originalAd,
    previousOptimizedAd,
    scenario: intelligence.scenario,
    tone,
    optimizationMode: request.optimizationMode ?? 'balanced',
    variationHint,
    customPrompt: request.customPrompt,
  };

  const response = await createClaudeMessage({
    max_tokens: 8192,
    temperature: request.regenerateOnly ? 1 : undefined,
    messages: [{ role: 'user', content: buildFullOptimizeAdPrompt(promptCtx) }],
  });

  console.log(
    `[optimizeAd] Claude response in ${Date.now() - claudeStart}ms (total ${Date.now() - startedAt}ms, stop=${response.stop_reason ?? 'unknown'})`
  );

  const block = response.content[0];
  if (block.type !== 'text') throw new Error('Unexpected Claude response format');

  let optimized: OptimizedAdContent;
  try {
    optimized = parseClaudeJson(block.text, brand, baseline, intelligence);
  } catch (firstErr) {
    const firstMsg = firstErr instanceof Error ? firstErr.message : String(firstErr);
    console.warn(`[optimizeAd] first parse failed (${firstMsg}), retrying with compact prompt`);
    const retry = await createClaudeMessage({
      max_tokens: 8192,
      messages: [
        {
          role: 'user',
          content: buildCompactOptimizeRetryPrompt(promptCtx),
        },
      ],
    });
    const retryBlock = retry.content[0];
    if (retryBlock.type !== 'text') throw firstErr;
    console.log(`[optimizeAd] compact retry stop=${retry.stop_reason ?? 'unknown'}`);
    optimized = parseClaudeJson(retryBlock.text, brand, baseline, intelligence);
  }

  if (originalAd.campaignId) optimized.campaignId = originalAd.campaignId;
  if (originalAd.adGroupId) optimized.adGroupId = originalAd.adGroupId;

  // Gallery is already enriched during analyzeCompetitors — skip duplicate SociaVault calls here.
  const competitorAnalysis = intelligence.competitorAnalysis;

  const record = await prisma.aIOptimization.create({
    data: {
      userId: request.userId,
      auditRunId: request.auditId,
      findingId: request.findingId,
      campaignId: originalAd.campaignId ?? optimized.campaignId,
      adGroupId: originalAd.adGroupId ?? optimized.adGroupId,
      campaignResourceName: originalAd.campaignResourceName,
      adGroupResourceName: originalAd.adGroupResourceName,
      scenario: intelligence.scenario,
      auditContext: intelligence as object,
      originalAd: originalAd as object,
      optimizedContent: optimized as object,
      improvementReasoning: optimized.improvementReasoning,
      predictedImpact: optimized.predictedImpact as object,
      tone,
      status: 'DRAFT',
    },
  });

  console.log(`[optimizeAd] saved optimization ${record.id} (total ${Date.now() - startedAt}ms)`);

  return {
    optimizationId: record.id,
    scenario: intelligence.scenario,
    dataSource: intelligence.dataSource,
    originalAd,
    optimized,
    finding: {
      id: finding.id,
      title: finding.title,
      category: finding.category,
      dimension: finding.dimension,
    },
    intelligenceSummary: {
      findingsAnalyzed: intelligence.findings.all.length,
      campaignsLoaded: intelligence.campaigns.length,
      keywordsLoaded: intelligence.keywords.length,
      searchTermsLoaded: intelligence.searchTerms.length,
      adsFound: intelligence.ads.length,
      devicesLoaded: intelligence.devices.length,
      audiencesLoaded: intelligence.audiences.length,
    },
    analysisSources: intelligence.analysisSources,
    campaignPerformance: intelligence.campaignPerformance,
    auditHealthScore: intelligence.auditHealth.score,
    competitorAnalysis,
  };
}

export async function getOptimization(id: string, userId: string) {
  return prisma.aIOptimization.findFirst({
    where: { id, userId },
    include: { publishedVersions: { orderBy: { createdAt: 'desc' }, take: 5 } },
  });
}

export async function getOptimizationForPreview(id: string, userId?: string) {
  return prisma.aIOptimization.findFirst({
    where: userId ? { id, userId } : { id },
  });
}

export interface AuditReportOptimization {
  id: string;
  findingId: string;
  campaignId: string | null;
  scenario: string | null;
  tone: string | null;
  createdAt: Date;
  originalAd: CurrentAdData;
  optimizedContent: OptimizedAdContent;
  competitorAnalysis?: CompetitorIntelligence | null;
  improvementReasoning: string | null;
}

/** Latest Make It Better optimization per finding+campaign for PDF / report export. */
export async function getOptimizationsForAuditReport(
  auditRunId: string
): Promise<AuditReportOptimization[]> {
  const rows = await prisma.aIOptimization.findMany({
    where: { auditRunId },
    orderBy: { createdAt: 'desc' },
  });

  const seen = new Set<string>();
  const result: AuditReportOptimization[] = [];

  for (const row of rows) {
    const key = `${row.findingId}:${row.campaignId ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);

    result.push({
      id: row.id,
      findingId: row.findingId,
      campaignId: row.campaignId,
      scenario: row.scenario,
      tone: row.tone,
      createdAt: row.createdAt,
      originalAd: row.originalAd as unknown as CurrentAdData,
      optimizedContent: row.optimizedContent as unknown as OptimizedAdContent,
      competitorAnalysis:
        row.auditContext && typeof row.auditContext === 'object'
          ? (row.auditContext as unknown as AuditIntelligence).competitorAnalysis
          : null,
      improvementReasoning: row.improvementReasoning,
    });
  }

  return result;
}
