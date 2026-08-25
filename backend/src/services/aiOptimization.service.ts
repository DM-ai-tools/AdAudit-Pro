import { createClaudeMessage } from '../ai/anthropic-client.js';
import {
  ANTHROPIC_OPTIMIZE_MAX_TOKENS,
  ANTHROPIC_OPTIMIZE_MODEL_FALLBACKS,
} from '../ai/anthropic-models.js';
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
import type { CompetitorDiscoverySource } from './competitor-discovery-cache.service.js';
import { getCachedCompetitorDiscovery } from './competitor-discovery-cache.service.js';
import {
  inferCountryFromLocation,
  resolveMarketCountry,
} from '../utils/region-codes.js';
import { extractJsonFromClaudeText } from '../utils/claude-json.js';
import {
  AD_DIFFERENCE_TARGET,
  computeAdDifferenceScore,
  listNearDuplicateHeadlines,
} from '../utils/ad-difference-score.js';
import {
  displayPathFromWebsite,
  resolveBusinessName,
  resolveDisplayHost,
} from '../utils/business-identity.js';
import {
  detectServiceFamilies,
  hasConflictingService,
  targetServiceFamilies,
} from '../utils/service-relevance.js';

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
  trustSignalImprovements?: string;
  offerImprovements: string;
  conversionImprovements: string;
  ctaImprovements?: string;
  competitorStrategiesUsed?: string;
  competitorGapsExploited?: string;
}

export interface InfluencingCompetitor {
  name: string;
  influencePercent: number;
  reason: string;
}

/** Why This Ad Was Generated — Gen 2.0 explanation panel */
export interface AdGenerationExplanation {
  competitorSignalsUsed: string[];
  topCompetitorsInfluencing: InfluencingCompetitor[];
  offersUsed: string[];
  trustSignalsUsed: string[];
  keywordsUsed: string[];
  reviewInsightsUsed: string[];
  socialAuthorityInsightsUsed: string[];
  marketPositioningUsed: string[];
  /** Server-computed 0–100; target 70+ */
  adDifferenceScore?: number;
}

export interface CompetitorInsightCard {
  name: string;
  url?: string;
  advertiserId?: string;
  keyMessages: string[];
  offers: string[];
  keywordOpportunities: string[];
  adDurationDays?: number;
  activeAdCount?: number;
  totalAdCount?: number;
  firstShown?: string;
  lastShown?: string;
  brandReview?: import('./competitor-intelligence.service.js').CompetitorBrandReview;
  confidenceScore?: number;
  influencePercent?: number;
  durationLabel?: string;
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
  adGenerationExplanation?: AdGenerationExplanation;
  adDifferenceScore?: number;
  keywordImprovements?: string[];
  negativeKeywordSuggestions?: string[];
  landingPageRecommendations?: string[];
  /** UI label when this RSA is a competitor-focused alternate */
  variationLabel?: string;
  focusedCompetitor?: string;
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
    /** Competitor brand names from user document upload (when URLs missing) */
    competitorNames?: string[];
    /** Paired name+url rows from the uploaded document (preferred over separate lists) */
    competitorEntries?: Array<{ name: string; url?: string }>;
    /**
     * Competitor discovery mode after client confirm:
     * - uploaded_only: client list only (no auto-discovery)
     * - auto: SociaVault / Transparency discovery only
     * - both: client list + AI discovery (default when upload present)
     */
    competitorDiscoveryMode?: 'uploaded_only' | 'auto' | 'both';
    /** Promo/offer — part of competitor cache key */
    offer?: string;
    productsServices?: string[];
    /** When 'ad', competitor discovery is scoped to primaryService / productsServices only */
    optimizationScope?: 'campaign' | 'ad';
    primaryService?: string;
    serviceKeywords?: string[];
    userId?: string;
    campaignId?: string;
    campaignName?: string;
    campaignType?: string;
    /** Normalized bucket: search | display | video | performance_max | … */
    preferredCampaignType?: string;
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
      adId?: string;
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
  optimizedVariations?: OptimizedAdContent[];
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
      (g) =>
        (g.adSource === 'sociavault' || g.adSource === 'transparency_center') &&
        (g.totalAdCount ?? 0) > 0
    ).length ?? 0
  );
}

function mergeCompetitorInsightCards(
  aiInsights: CompetitorInsightCard[],
  analysis: CompetitorIntelligence | null | undefined
): CompetitorInsightCard[] {
  // SociaVault-backed analysis is the source of truth — never invent competitors from Claude.
  const gallery = (analysis?.adGallery ?? []).filter((g) => (g.totalAdCount ?? 0) > 0);
  const fallbacks = (analysis?.insights ?? []).filter(
    (i) =>
      (i.totalAdCount ?? 0) > 0 ||
      gallery.some(
        (g) =>
          g.name.toLowerCase() === i.name.toLowerCase() ||
          (g.advertiserName?.toLowerCase() === i.name.toLowerCase())
      )
  );

  if (!fallbacks.length && gallery.length) {
    return gallery.slice(0, 4).map((g) => ({
      name: g.advertiserName ?? g.name,
      url: g.url,
      keyMessages: [...(g.headlines ?? []), ...(g.descriptions ?? [])].filter(Boolean).slice(0, 6),
      offers: g.offers ?? [],
      keywordOpportunities: [],
      adDurationDays: g.adDurationDays,
      activeAdCount: g.activeAdCount,
      totalAdCount: g.totalAdCount,
      firstShown: g.firstShown,
      lastShown: g.lastShown,
      brandReview: g.brandReview,
      confidenceScore: g.confidenceScore,
      influencePercent: g.influencePercent,
      durationLabel: g.durationLabel,
    }));
  }

  return fallbacks.slice(0, 4).map((i) => {
    const ai = aiInsights.find((a) => a.name.toLowerCase() === i.name.toLowerCase());
    const g = gallery.find(
      (x) =>
        x.name.toLowerCase() === i.name.toLowerCase() ||
        x.advertiserName?.toLowerCase() === i.name.toLowerCase()
    );
    return {
      name: i.name,
      url: i.url ?? g?.url ?? ai?.url,
      keyMessages: i.keyMessages.length
        ? i.keyMessages
        : ai?.keyMessages?.length
          ? ai.keyMessages
          : [...(g?.headlines ?? []), ...(g?.descriptions ?? [])].filter(Boolean).slice(0, 6),
      offers: i.offers.length ? i.offers : (ai?.offers ?? g?.offers ?? []),
      keywordOpportunities: i.keywordOpportunities.length
        ? i.keywordOpportunities
        : (ai?.keywordOpportunities ?? []),
      adDurationDays: i.adDurationDays ?? g?.adDurationDays,
      activeAdCount: i.activeAdCount ?? g?.activeAdCount,
      totalAdCount: i.totalAdCount ?? g?.totalAdCount,
      firstShown: i.firstShown ?? g?.firstShown,
      lastShown: i.lastShown ?? g?.lastShown,
      brandReview: i.brandReview ?? g?.brandReview,
      confidenceScore: i.confidenceScore ?? g?.confidenceScore,
      influencePercent: i.influencePercent ?? g?.influencePercent,
      durationLabel: i.durationLabel ?? g?.durationLabel,
    };
  });
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

/** Common ad words Claude often truncates at the 30-char limit. */
const HEADLINE_WORD_COMPLETIONS: string[] = [
  'Approval',
  'Approvals',
  'Approved',
  'Approving',
  'Consultation',
  'Consultations',
  'Guaranteed',
  'Guarantee',
  'Australian',
  'Australia',
  'Financing',
  'Finance',
  'Financial',
  'Refinance',
  'Refinancing',
  'Comparison',
  'Compare',
  'Commercial',
  'Mortgage',
  'Mortgages',
  'Property',
  'Properties',
  'Business',
  'Businesses',
  'Independent',
  'Specialists',
  'Specialist',
  'Experts',
  'Expert',
  'Broker',
  'Brokers',
  'Lending',
  'Lenders',
  'Lowest',
  'Rates',
  'Quote',
  'Quotes',
  'Online',
  'Today',
  'Available',
  'Application',
  'Applications',
  'Pre-Approval',
  'Preapproval',
];

function isIncompleteTrailingWord(word: string): string | null {
  const stem = word.replace(/[^a-zA-Z0-9']/g, '');
  if (stem.length < 4) return null;
  const lower = stem.toLowerCase();
  for (const full of HEADLINE_WORD_COMPLETIONS) {
    const f = full.toLowerCase();
    if (f === lower) return null; // already complete
    if (f.startsWith(lower) && lower.length < f.length) return full;
  }
  // Heuristic: ends with truncated Latin fragment (e.g. "Approv", "Consultati")
  if (/^[A-Za-z]+$/.test(stem) && stem.length >= 5 && !/[aeiouy]{2}|ing$|ed$|ly$|er$|ers$|est$|tion$|sion$|ment$|ness$|able$|ful$|ous$/i.test(stem)) {
    // Likely incomplete if it doesn't look like a finished English word ending
    // Prefer dropping rather than inventing unknown completions
    return '';
  }
  return null;
}

/** Light grammar cleanup — complete sentences, spacing, common article fixes. */
function fixGrammarIssues(text: string): string {
  let s = text.replace(/\s+/g, ' ').trim();
  if (!s) return s;
  s = s.replace(/\s+([,.!?;:])/g, '$1');
  s = s.replace(/([a-z])\.([A-Z])/g, '$1. $2');
  s = s.replace(/\ba ([aeiouAEIOU])/g, 'an $1');
  s = s.replace(/\ban ([bcdfghjklmnpqrstvwxyzBCDFGHJKLMNPQRSTVWXYZ])/g, 'a $1');
  // Drop dangling conjunctions at end of headlines/descriptions
  s = s.replace(/\b(and|or|with|for|to|the|a|an)\s*$/i, '').trim();
  return s;
}

/**
 * Enforce ≤30 chars with COMPLETE words only — never mid-word cuts like "Fast Approv".
 */
export function finalizeHeadline(text: string, max = 30): string {
  let s = fixGrammarIssues(
    text
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/[–—]/g, '-')
      .replace(/\s*-\s*/g, ' - ')
  );
  if (!s) return s;

  const fitComplete = (candidate: string): string => {
    let out = candidate.trim().replace(/\s+/g, ' ');
    if (out.length > max) {
      let cut = out.slice(0, max);
      const lastSpace = cut.lastIndexOf(' ');
      if (lastSpace >= Math.floor(max * 0.4)) cut = cut.slice(0, lastSpace);
      out = cut.replace(/[\s\-|,;:/]+$/g, '').trim();
    }
    // Repair / drop incomplete final token
    const parts = out.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      const last = parts[parts.length - 1]!;
      const completion = isIncompleteTrailingWord(last);
      if (completion === '') {
        out = parts.slice(0, -1).join(' ').replace(/[\s\-|,;:/]+$/g, '').trim();
      } else if (completion) {
        const attempt = `${parts.slice(0, -1).join(' ')} ${completion}`.replace(/\s+/g, ' ').trim();
        if (attempt.length <= max) {
          out = attempt;
        } else if (parts.length >= 2) {
          const short = `${parts[parts.length - 2]} ${completion}`.replace(/\s+/g, ' ').trim();
          out =
            short.length <= max
              ? short
              : completion.length <= max
                ? completion
                : parts.slice(0, -1).join(' ').replace(/[\s\-|,;:/]+$/g, '').trim();
        } else {
          out = parts.slice(0, -1).join(' ').replace(/[\s\-|,;:/]+$/g, '').trim();
        }
      }
    }
    if (out.length > max) {
      let cut = out.slice(0, max);
      const lastSpace = cut.lastIndexOf(' ');
      if (lastSpace >= Math.floor(max * 0.4)) cut = cut.slice(0, lastSpace);
      out = cut.replace(/[\s\-|,;:/]+$/g, '').trim();
    }
    return out.slice(0, max);
  };

  return fitComplete(s);
}

function finalizeDescription(text: string): string {
  let s = fixGrammarIssues(text.trim().replace(/\s+/g, ' ').replace(/[–—]/g, '-'));
  if (!s) return s;
  if (s.length > 90) {
    s = s.slice(0, 90);
    const lastSpace = s.lastIndexOf(' ');
    if (lastSpace > 55) s = s.slice(0, lastSpace);
  }
  s = s.replace(/[,;\s\-]+$/, '');
  // Drop incomplete trailing word on descriptions too
  const parts = s.split(/\s+/);
  if (parts.length >= 2) {
    const completion = isIncompleteTrailingWord(parts[parts.length - 1]!);
    if (completion === '') {
      s = parts.slice(0, -1).join(' ');
    } else if (completion) {
      const attempt = `${parts.slice(0, -1).join(' ')} ${completion}`;
      if (attempt.length <= 90) s = attempt;
      else s = parts.slice(0, -1).join(' ');
    }
  }
  if (!/[.!?]$/.test(s)) s += '.';
  if (s.length > 90) {
    s = s.slice(0, 90);
    const lastSpace = s.lastIndexOf(' ');
    if (lastSpace > 55) s = s.slice(0, lastSpace);
    s = s.replace(/[,;\s\-]+$/, '');
    if (!/[.!?]$/.test(s)) s += '.';
  }
  return s.slice(0, 90);
}

function finalizeCallout(text: string, max = 25): string {
  return finalizeHeadline(text, max);
}

function enforceGoogleAdsLimits(
  headlines: string[],
  descriptions: string[],
  brand: string,
  primaryService?: string
): { headlines: string[]; descriptions: string[] } {
  const seen = new Set<string>();
  const h: string[] = [];
  for (const raw of headlines) {
    const next = finalizeHeadline(raw);
    if (!next || next.length < 3) continue;
    const key = next.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    h.push(next);
  }
  const d = descriptions.map((s) => finalizeDescription(s)).filter(Boolean);

  const svc = (primaryService ?? '').toLowerCase();
  const isCar = /\bcar\b|\bauto\b|\bvehicle\b/.test(svc);
  const isHome = /\bhome\b|\bmortgage\b/.test(svc);
  const isBiz = /\bbusiness\b|\bcommercial\b|\bsme\b/.test(svc);

  const fallbacksH = (
    isCar
      ? [
          'Compare Car Loan Rates',
          'New & Used Car Finance',
          'Same-Day Car Approvals',
          'No Deposit Car Loans',
          `${brand} Car Finance`.slice(0, 30),
          'Licensed Car Loan Broker',
          'Faster Car Finance Yes',
          'Get Your Car Loan Quote',
        ]
      : isHome
        ? [
            'Compare Home Loan Rates',
            'Refinance & Save Today',
            'Local Mortgage Experts',
            `${brand} Home Loans`.slice(0, 30),
            'First Home Buyer Help',
            'Low-Rate Home Options',
            'Free Home Loan Review',
            'Talk to a Broker Today',
          ]
        : isBiz
          ? [
              'Business Loan Options',
              'Fast SME Finance Yes',
              'Working Capital Ready',
              `${brand} Biz Finance`.slice(0, 30),
              'Compare Business Rates',
              'Equipment Finance Fast',
              'Simple Business Funding',
              'Get a Business Quote',
            ]
          : [
              `${brand} Get Started`.slice(0, 30),
              'Free Consultation Today',
              'Compare Top Options',
              'Fast Approvals Online',
              'Trusted Local Experts',
              'Apply Online in Minutes',
              'No Obligation Quote',
              'Better Rates Today',
            ]
  ).map((s) => finalizeHeadline(s));

  const fallbacksD = isCar
    ? [
        `${brand} compares car lenders for competitive rates on new & used vehicles. Get a free quote today.`,
        'Licensed brokers. Transparent fees. Same-day decisions on car finance when you qualify. Apply online.',
        'New or used cars — we match you with lenders that fit your budget. Speak with a specialist today.',
        'No-obligation car loan quotes with clear next steps from enquiry to approval. Start online now.',
      ]
    : [
        `${brand} helps you compare options and secure competitive rates. Get a free consultation today.`,
        'Expert guidance, transparent pricing, and fast approvals. Start your application online now.',
        'Trusted specialists matching you with options that fit your goals. Speak with an expert today.',
        'Clear next steps from enquiry to approval. Request your free, no-obligation quote online.',
      ];

  let i = 0;
  while (h.length < 15 && i < fallbacksH.length * 3) {
    const next = fallbacksH[i % fallbacksH.length]!;
    i += 1;
    const key = next.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    h.push(next);
  }
  while (d.length < 4) {
    const next = finalizeDescription(fallbacksD[d.length % fallbacksD.length]!);
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

  // Prefer the selected ad's live CTR/conversions when present (incl. 0) — don't invent campaign averages as "this ad"
  const ctr =
    ad?.ctr != null
      ? `${ad.ctr}%`
      : perf?.ctr != null
        ? `${perf.ctr}%`
        : undefined;
  const conversionRate =
    perf?.conversionRate != null ? `${perf.conversionRate}%` : undefined;
  const qualityScore =
    perf?.avgQualityScore != null ? String(perf.avgQualityScore) : undefined;
  const cpa =
    perf && perf.costPerConversion > 0 ? `$${Math.round(perf.costPerConversion)}` : undefined;
  const monthlyLeads =
    ad?.conversions != null && ad.conversions > 0
      ? String(Math.round(ad.conversions))
      : perf && perf.conversions > 0
        ? String(Math.round(perf.conversions))
        : undefined;
  const monthlySavings =
    perf && perf.cost > 0 ? `$${Math.round(perf.cost * 0.1)}` : undefined;

  return {
    ctr,
    qualityScore,
    conversionRate,
    cpa,
    monthlyLeads,
    monthlySavings,
  };
}

/** Keep Google Ads baseline for "current"; never let Claude invent fictitious baseline stats. */
function mergeCurrentMetrics(
  baseline: PerformanceMetrics,
  fromClaude: PerformanceMetrics
): PerformanceMetrics {
  // Only allow Claude to fill fields we truly have no signal for AND that aren't commonly hallucinated.
  // ROAS / savings are frequently invented — never take them from Claude for "current".
  return {
    ctr: baseline.ctr ?? fromClaude.ctr,
    qualityScore: baseline.qualityScore ?? fromClaude.qualityScore,
    conversionRate: baseline.conversionRate ?? fromClaude.conversionRate,
    cpa: baseline.cpa ?? fromClaude.cpa,
    roas: baseline.roas,
    monthlyLeads: baseline.monthlyLeads ?? fromClaude.monthlyLeads,
    monthlySavings: baseline.monthlySavings,
  };
}

function parsePercentish(raw?: string): number | null {
  if (!raw) return null;
  const m = String(raw).replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}

/** Extract Claude's declared % change (e.g. "+23% to ~3.44%" → 23). */
function parseUpliftPct(raw?: string): number | null {
  if (!raw?.trim()) return null;
  const m = raw.trim().match(/([+-]?\d+(?:\.\d+)?)\s*%/);
  return m ? Number(m[1]) : null;
}

/**
 * Build uplift strings grounded in real Google Ads baselines.
 * Never keep Claude absolute targets that ignore the live baseline (e.g. inventing 2.8% CTR).
 */
function groundedEstimate(
  baselineValue: string | undefined,
  preferred: string | undefined,
  defaultPct: number,
  opts?: { suffix?: string; money?: boolean }
): string | undefined {
  const preferredTrim = preferred?.trim();
  const isGenericEst = preferredTrim ? /^\+?\d+(\.\d+)?%\s*est\.?$/i.test(preferredTrim) : false;
  const base = parsePercentish(baselineValue);

  // No live baseline → never invent absolute projections (drop Claude fiction)
  if (base == null) {
    if (preferredTrim && !isGenericEst && preferredTrim !== '—') {
      // Relative-only phrases without an absolute baseline are still ok
      if (/^[+-]?\d+(\.\d+)?%\s*(relative|est)?/i.test(preferredTrim) && !/to\s*~/i.test(preferredTrim)) {
        return preferredTrim;
      }
    }
    return undefined;
  }

  // Near-zero rate/count baselines cannot be projected to absolute targets honestly
  if (base === 0 && (opts?.suffix === '%' || opts?.suffix === 'x' || !opts?.money)) {
    const pct = parseUpliftPct(preferredTrim) ?? defaultPct;
    const sign = pct >= 0 ? '+' : '';
    return `${sign}${pct}% relative (baseline ${baselineValue} — need more volume to project absolute)`;
  }

  const pct = parseUpliftPct(preferredTrim) ?? defaultPct;
  const next = base * (1 + pct / 100);
  const rounded = opts?.money
    ? `$${Math.round(next).toLocaleString('en-US')}`
    : opts?.suffix === 'x'
      ? `${next.toFixed(2)}x`
      : opts?.suffix === '%'
        ? `${next.toFixed(2)}%`
        : `${Math.round(next)}`;
  const sign = pct >= 0 ? '+' : '';
  return `${sign}${pct}% to ~${rounded}`;
}

function conflictsWithLockedService(text: string, lockedService?: string): boolean {
  if (!lockedService?.trim()) return false;
  const lock = lockedService.toLowerCase();
  const t = text.toLowerCase();
  const isCar = /\bcar\b|\bauto\b|\bvehicle\b/.test(lock);
  const isHome = /\bhome\b|\bmortgage\b/.test(lock);
  const isPersonal = /\bpersonal\b/.test(lock);
  const isBiz = /\bbusiness\b|\bcommercial\b|\bsme\b/.test(lock);

  if (isCar) {
    // Novated lease / chattel can be vehicle finance — keep those. Block other loan verticals.
    if (/\b(home\s*loans?|mortgages?|personal\s*loans?|business\s*loans?|sme\s*loans?)\b/.test(t)) {
      return true;
    }
    // "personal" alone as product breadth is drift
    if (/\bpersonal\b/.test(t) && !/\bcar\b|\bauto\b|\bvehicle\b|\bnovated\b|\bchattel\b/.test(t)) {
      return true;
    }
  }
  if (isHome && /\b(car\s*loans?|auto\s*loans?|personal\s*loans?|business\s*loans?)\b/.test(t)) return true;
  if (isPersonal && /\b(car\s*loans?|home\s*loans?|business\s*loans?)\b/.test(t)) return true;
  if (isBiz && /\b(car\s*loans?|home\s*loans?|personal\s*loans?)\b/.test(t)) return true;
  return false;
}

function filterServiceLockedInsights(items: string[], lockedService?: string): string[] {
  return items.filter((item) => !conflictsWithLockedService(item, lockedService));
}

function parseClaudeJson(
  text: string,
  brand: string,
  baseline: PerformanceMetrics,
  intelligence: AuditIntelligence,
  lockedService?: string
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

  ({ headlines, descriptions } = enforceGoogleAdsLimits(
    headlines,
    descriptions,
    brand,
    lockedService ?? intelligence.websiteAnalysis?.services?.[0]
  ));

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
    // Treat "", "—", null as missing so we never wipe real baseline metrics
    const pick = (k: string): string | undefined => {
      if (m[k] == null) return undefined;
      const s = String(m[k]).trim();
      if (!s || s === '—' || s === '-' || s.toLowerCase() === 'n/a' || s.toLowerCase() === 'null') {
        return undefined;
      }
      return s;
    };
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

  let estimatedPerf = parsePerf(perfRaw?.estimated);
  // Compact Claude retries often omit performanceEstimates — fill from predictedImprovements
  if (!estimatedPerf.ctr && (predicted?.ctr || legacyPredicted?.ctrIncrease)) {
    estimatedPerf = {
      ...estimatedPerf,
      ctr: predicted?.ctr ?? legacyPredicted?.ctrIncrease,
      qualityScore: estimatedPerf.qualityScore ?? predicted?.qualityScore ?? legacyPredicted?.qualityScoreIncrease,
      conversionRate:
        estimatedPerf.conversionRate ??
        predicted?.conversionRate ??
        legacyPredicted?.conversionImprovement,
    };
  }

  // Prefer real Google Ads baseline for CURRENT — Claude may invent fictional baselines
  const currentMetrics = mergeCurrentMetrics(baseline, parsePerf(perfRaw?.current));

  // Ground estimates in baseline — drop Claude absolutes when no live baseline exists
  estimatedPerf = {
    ctr: groundedEstimate(currentMetrics.ctr, estimatedPerf.ctr, 18, { suffix: '%' }),
    qualityScore: (() => {
      const preferred = estimatedPerf.qualityScore;
      const base = parsePercentish(currentMetrics.qualityScore);
      if (base == null) return undefined;
      const bumpMatch = preferred?.match(/([+-]?\d+(\.\d+)?)/);
      const bump = bumpMatch ? Math.abs(Number(bumpMatch[1])) : 1.5;
      // QS is 1–10 scale; treat Claude "+2.4 to ~8.6" as a points bump, not a % of current
      const points = bump > 5 ? 1.5 : bump; // guard against mistaking absolute QS as bump
      const next = Math.min(10, Math.round((base + points) * 10) / 10);
      return `+${points} to ~${next}`;
    })(),
    conversionRate: groundedEstimate(currentMetrics.conversionRate, estimatedPerf.conversionRate, 14, {
      suffix: '%',
    }),
    cpa: groundedEstimate(currentMetrics.cpa, estimatedPerf.cpa, -12, { money: true }),
    roas: groundedEstimate(currentMetrics.roas, estimatedPerf.roas, 15, { suffix: 'x' }),
    monthlyLeads: groundedEstimate(currentMetrics.monthlyLeads, estimatedPerf.monthlyLeads, 20),
    monthlySavings: groundedEstimate(currentMetrics.monthlySavings, estimatedPerf.monthlySavings, 25, {
      money: true,
    }),
  };

  const performanceEstimates: PerformanceEstimates = {
    label: String(perfRaw?.label ?? 'AI Estimated Impact · grounded in Google Ads data'),
    current: currentMetrics,
    estimated: estimatedPerf,
  };

  // Always use live audit health for "current" — never Claude's invented score (e.g. magic 20→38)
  const auditScore = Math.max(
    0,
    Math.min(100, Number(intelligence.auditHealth?.score ?? 0))
  );
  const healthRaw = parsed.campaignHealth as Record<string, unknown> | undefined;
  const currentHealth = auditScore;
  const parsedPredictedHealth = Number(healthRaw?.predictedScore);
  // Cap uplift at +20 so we don't fabricate dramatic jumps from invented Claude deltas
  const predictedHealth =
    Number.isFinite(parsedPredictedHealth) && parsedPredictedHealth > currentHealth
      ? Math.min(100, Math.min(Math.round(parsedPredictedHealth), currentHealth + 20))
      : Math.min(100, currentHealth + Math.max(5, Math.min(15, Math.round((100 - currentHealth) * 0.2))));

  const campaignHealth = {
    currentScore: currentHealth,
    predictedScore: predictedHealth,
    explanation:
      String(healthRaw?.explanation ?? '').trim() ||
      'Predicted lift assumes this RSA improves relevance and CTR for the selected campaign; grounded on audit account health.',
  };

  const nonEmptyStr = (v: unknown): string | undefined => {
    if (v == null) return undefined;
    const s = String(v).trim();
    return s && s !== '—' ? s : undefined;
  };

  const accountRaw = parsed.accountImpact as Record<string, unknown> | undefined;

  // Only keep Claude account numbers when we already have a matching live baseline (blocks invented ROAS/waste)
  const preferGrounded = (
    liveCurrent: string | undefined,
    liveOrEstNext: string | undefined,
    claudeEst: string | undefined
  ): { current: string; estimated: string } => {
    if (liveCurrent) {
      return {
        current: liveCurrent,
        estimated: liveOrEstNext ?? groundedEstimate(liveCurrent, claudeEst, 15) ?? '—',
      };
    }
    return { current: '—', estimated: '—' };
  };

  const leads = preferGrounded(
    currentMetrics.monthlyLeads,
    estimatedPerf.monthlyLeads,
    nonEmptyStr(accountRaw?.estimatedMonthlyLeads)
  );
  // Do not map monthlySavings → wasted spend (different metric; Claude often invents $3,600 waste)
  const waste = { current: '—', estimated: '—' };
  const roas = preferGrounded(
    currentMetrics.roas,
    estimatedPerf.roas,
    nonEmptyStr(accountRaw?.estimatedRoas)
  );

  const accountImpact: AccountImpact = {
    currentAccountHealth: campaignHealth.currentScore,
    predictedAccountHealth: campaignHealth.predictedScore,
    currentMonthlyLeads: leads.current,
    estimatedMonthlyLeads: leads.estimated,
    currentWastedSpend: waste.current,
    estimatedWastedSpend: waste.estimated,
    currentRoas: roas.current,
    estimatedRoas: roas.estimated,
  };

  const srRaw = parsed.strategistReasoning as Record<string, unknown> | undefined;
  const coRaw = srRaw?.competitiveOutperformance as Record<string, unknown> | undefined;
  const competitiveOutperformance: CompetitiveOutperformance | undefined = coRaw
    ? {
        messagingImprovements: conflictsWithLockedService(
          String(coRaw.messagingImprovements ?? ''),
          lockedService
        )
          ? ''
          : String(coRaw.messagingImprovements ?? ''),
        keywordImprovements: conflictsWithLockedService(
          String(coRaw.keywordImprovements ?? ''),
          lockedService
        )
          ? ''
          : String(coRaw.keywordImprovements ?? ''),
        trustSignalImprovements:
          coRaw.trustSignalImprovements != null &&
          !conflictsWithLockedService(String(coRaw.trustSignalImprovements), lockedService)
            ? String(coRaw.trustSignalImprovements)
            : undefined,
        offerImprovements: conflictsWithLockedService(
          String(coRaw.offerImprovements ?? ''),
          lockedService
        )
          ? ''
          : String(coRaw.offerImprovements ?? ''),
        conversionImprovements: conflictsWithLockedService(
          String(coRaw.conversionImprovements ?? ''),
          lockedService
        )
          ? ''
          : String(coRaw.conversionImprovements ?? ''),
        ctaImprovements:
          coRaw.ctaImprovements != null &&
          !conflictsWithLockedService(String(coRaw.ctaImprovements), lockedService)
            ? String(coRaw.ctaImprovements)
            : undefined,
        competitorStrategiesUsed:
          coRaw.competitorStrategiesUsed != null &&
          !conflictsWithLockedService(String(coRaw.competitorStrategiesUsed), lockedService)
            ? String(coRaw.competitorStrategiesUsed)
            : undefined,
        competitorGapsExploited:
          coRaw.competitorGapsExploited != null &&
          !conflictsWithLockedService(String(coRaw.competitorGapsExploited), lockedService)
            ? String(coRaw.competitorGapsExploited)
            : undefined,
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
        competitorInsightsUsed: filterServiceLockedInsights(
          normalizeStringArray(srRaw.competitorInsightsUsed),
          lockedService
        ),
        competitiveOutperformance,
      }
    : {
        headlineChanges: `Rewrote headlines around ${lockedService ?? 'service'}-specific competitor offers and CTAs.`,
        descriptionChanges: 'Descriptions emphasize proof, offers, and clearer call-to-action.',
        keywordRelevance: `Aligned copy to high-intent ${lockedService ?? 'service'} keywords from competitor ads.`,
        qualityScore: 'Tighter relevance between headline, path, and landing intent.',
        conversionPotential: 'Stronger commercial hooks borrowed from successful rival creatives.',
        auditFindingsAddressed: [
          String(intelligence.findings?.all?.[0]?.title ?? 'Ad strength / RSA quality'),
        ],
        competitorInsightsUsed: filterServiceLockedInsights(
          (intelligence.competitorAnalysis?.competitors ?? [])
            .slice(0, 3)
            .map(
              (c) =>
                `${c.name}: ${(c.offers ?? c.keyMessages ?? []).slice(0, 2).join('; ') || 'RSA angle'}`
            ),
          lockedService
        ),
        competitiveOutperformance: {
          messagingImprovements: `Clearer ${lockedService ?? 'service'} + outcome messaging vs rivals.`,
          keywordImprovements: 'Prioritized commercial intent phrases competitors use.',
          offerImprovements: 'Surfaced offers competitors advertise that you lacked.',
          conversionImprovements: 'Stronger CTA and trust pairing in descriptions.',
          competitorStrategiesUsed: 'Borrowed winning RSA angles from SociaVault gallery ads.',
          competitorGapsExploited: 'Filled gaps in trust/offer themes competitors own.',
        },
      };

  const competitorInsightsRaw = parsed.competitorInsights;
  let competitorInsights: CompetitorInsightCard[] = [];
  const galleryForInsights = intelligence.competitorAnalysis?.adGallery ?? [];
  const profilesForInsights = intelligence.competitorAnalysis?.competitors ?? [];
  const attachLibraryStats = (name: string, url?: string) => {
    const key = name.toLowerCase();
    const g =
      galleryForInsights.find(
        (x) =>
          (x.advertiserName ?? x.name).toLowerCase() === key ||
          (url && x.url && x.url.toLowerCase() === url.toLowerCase())
      ) ?? null;
    const p =
      profilesForInsights.find((x) => x.name.toLowerCase() === key) ?? null;
    return {
      url: g?.destinationUrl ?? g?.url ?? p?.url ?? url,
      advertiserId: g?.advertiserId,
      adDurationDays: g?.adDurationDays ?? p?.adDurationDays,
      activeAdCount: g?.activeAdCount ?? p?.activeAdCount,
      totalAdCount: g?.totalAdCount ?? p?.totalAdCount,
      firstShown: g?.firstShown ?? p?.firstShown,
      lastShown: g?.lastShown ?? p?.lastShown,
      brandReview: g?.brandReview ?? p?.brandReview,
      confidenceScore: g?.confidenceScore ?? p?.confidenceScore,
      influencePercent: g?.influencePercent ?? p?.influencePercent,
      durationLabel: g?.durationLabel ?? p?.durationLabel,
      keyMessagesFromGallery: [
        ...(g?.headlines ?? p?.headlines ?? []),
        ...(g?.descriptions ?? p?.descriptions ?? []),
      ]
        .filter(Boolean)
        .slice(0, 6),
      offersFromGallery: g?.offers ?? p?.offers ?? [],
    };
  };

  if (Array.isArray(competitorInsightsRaw)) {
    for (const row of competitorInsightsRaw) {
      if (!row || typeof row !== 'object') continue;
      const o = row as Record<string, unknown>;
      const name = String(o.name ?? '').trim();
      if (!name) continue;
      const lib = attachLibraryStats(name, o.url != null ? String(o.url) : undefined);
      const keyMessages = normalizeStringArray(o.keyMessages);
      const offers = normalizeStringArray(o.offers);
      competitorInsights.push({
        name,
        url: lib.url,
        advertiserId: lib.advertiserId,
        keyMessages: keyMessages.length ? keyMessages : lib.keyMessagesFromGallery,
        offers: offers.length ? offers : lib.offersFromGallery,
        keywordOpportunities: normalizeStringArray(o.keywordOpportunities),
        adDurationDays: lib.adDurationDays,
        activeAdCount: lib.activeAdCount,
        totalAdCount: lib.totalAdCount,
        firstShown: lib.firstShown,
        lastShown: lib.lastShown,
        brandReview: lib.brandReview,
        confidenceScore: lib.confidenceScore,
        influencePercent: lib.influencePercent,
        durationLabel: lib.durationLabel,
      });
    }
  } else if (intelligence.competitorAnalysis?.insights?.length) {
    competitorInsights = intelligence.competitorAnalysis.insights.map((i) => {
      const lib = attachLibraryStats(i.name, i.url);
      return {
        name: i.name,
        url: lib.url ?? i.url,
        advertiserId: lib.advertiserId ?? i.advertiserId,
        keyMessages: i.keyMessages?.length ? i.keyMessages : lib.keyMessagesFromGallery,
        offers: i.offers?.length ? i.offers : lib.offersFromGallery,
        keywordOpportunities: i.keywordOpportunities,
        adDurationDays: i.adDurationDays ?? lib.adDurationDays,
        activeAdCount: i.activeAdCount ?? lib.activeAdCount,
        totalAdCount: i.totalAdCount ?? lib.totalAdCount,
        firstShown: i.firstShown ?? lib.firstShown,
        lastShown: i.lastShown ?? lib.lastShown,
        brandReview: i.brandReview ?? lib.brandReview,
        confidenceScore: i.confidenceScore ?? lib.confidenceScore,
        influencePercent: i.influencePercent ?? lib.influencePercent,
        durationLabel: i.durationLabel ?? lib.durationLabel,
      };
    });
  }

  // Guarantee insight cards from gallery when Claude omitted competitorInsights
  if (competitorInsights.length < 4) {
    const seen = new Set(competitorInsights.map((c) => c.name.toLowerCase()));
    for (const g of galleryForInsights) {
      if (competitorInsights.length >= 4) break;
      const name = (g.advertiserName ?? g.name).trim();
      if (!name || seen.has(name.toLowerCase())) continue;
      const lib = attachLibraryStats(name, g.destinationUrl ?? g.url);
      competitorInsights.push({
        name,
        url: lib.url,
        advertiserId: lib.advertiserId,
        keyMessages: lib.keyMessagesFromGallery,
        offers: lib.offersFromGallery,
        keywordOpportunities: [],
        adDurationDays: lib.adDurationDays,
        activeAdCount: lib.activeAdCount,
        totalAdCount: lib.totalAdCount,
        firstShown: lib.firstShown,
        lastShown: lib.lastShown,
        brandReview: lib.brandReview,
        confidenceScore: lib.confidenceScore,
        influencePercent: lib.influencePercent,
        durationLabel: lib.durationLabel,
      });
      seen.add(name.toLowerCase());
    }
  }

  competitorInsights = mergeCompetitorInsightCards(
    competitorInsights,
    intelligence.competitorAnalysis
  );

  // Stick strictly to rivals present in competitorAnalysis (already document-only when uploaded)
  const analysisNames = new Set(
    [
      ...(intelligence.competitorAnalysis?.competitors ?? []).map((c) => c.name),
      ...(intelligence.competitorAnalysis?.adGallery ?? []).map((g) => g.advertiserName ?? g.name),
      ...(intelligence.competitorAnalysis?.insights ?? []).map((i) => i.name),
    ]
      .filter(Boolean)
      .map((n) =>
        String(n)
          .toLowerCase()
          .replace(/[^a-z0-9]/g, '')
      )
  );
  if (analysisNames.size > 0) {
    competitorInsights = competitorInsights.filter((c) => {
      const key = c.name
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');
      if (!key) return false;
      if (analysisNames.has(key)) return true;
      return [...analysisNames].some(
        (a) => a.length >= 4 && key.length >= 4 && (a.includes(key) || key.includes(a))
      );
    });
  }

  const missingCompetitorAdvantages = normalizeStringArray(
    Array.isArray(parsed.missingCompetitorAdvantages) && parsed.missingCompetitorAdvantages.length
      ? parsed.missingCompetitorAdvantages
      : intelligence.competitorAnalysis?.missingFromYourAds
  );

  const adGenerationExplanation = parseAdGenerationExplanation(
    parsed.adGenerationExplanation,
    intelligence.competitorAnalysis
  );

  const recsRaw =
    parsed.strategistRecommendations && typeof parsed.strategistRecommendations === 'object'
      ? (parsed.strategistRecommendations as Record<string, unknown>)
      : null;

  const strategistRecommendations: StrategistRecommendations = {
    keywords: normalizeStringArray(
      recsRaw?.keywords ?? parsed.recommendedKeywords ?? parsed.keywordImprovements
    ),
    negativeKeywords: normalizeStringArray(
      recsRaw?.negativeKeywords ?? parsed.negativeKeywordSuggestions
    ),
    extensions: normalizeStringArray(recsRaw?.extensions ?? parsed.recommendedExtensions),
    landingPage: normalizeStringArray(recsRaw?.landingPage ?? parsed.landingPageRecommendations),
    budget: normalizeStringArray(recsRaw?.budget ?? parsed.budgetRecommendations),
    bidding: normalizeStringArray(recsRaw?.bidding ?? parsed.biddingRecommendations),
    audience: normalizeStringArray(recsRaw?.audience ?? parsed.audienceRecommendations),
  };

  // Ensure recommendation tiles don't all vanish after compact retries
  if (!strategistRecommendations.keywords.length) {
    strategistRecommendations.keywords = [
      'service + location keyword',
      'high-intent commercial keyword',
      'competitor alternative phrase',
    ];
  }
  if (!strategistRecommendations.negativeKeywords.length) {
    strategistRecommendations.negativeKeywords = ['free', 'jobs', 'diy'];
  }
  if (!strategistRecommendations.extensions.length) {
    strategistRecommendations.extensions = ['Call extension', 'Location extension', 'Lead form'];
  }
  if (!strategistRecommendations.landingPage.length) {
    strategistRecommendations.landingPage = [
      'Match H1 to primary service keyword',
      'Add proof + CTA above the fold',
    ];
  }
  if (!strategistRecommendations.budget.length) {
    strategistRecommendations.budget = ['Shift budget to converting keywords'];
  }
  if (!strategistRecommendations.bidding.length) {
    strategistRecommendations.bidding = ['Test target CPA after conversion volume grows'];
  }
  if (!strategistRecommendations.audience.length) {
    strategistRecommendations.audience = ['In-market + remarketing overlay'];
  }

  return {
    campaignId: (parsed.campaignId as string) || undefined,
    adGroupId: (parsed.adGroupId as string) || undefined,
    headlines: headlines.slice(0, 15),
    descriptions: descriptions.slice(0, 4),
    ctaSuggestions: (parsed.ctaSuggestions as string[]) ?? ['Get Quote', 'Call Now', 'Book Online'],
    keywordSuggestions: (parsed.keywordSuggestions as string[]) ?? [],
    displayPaths,
    adExtensions: {
      sitelinks: normalizeStringArray(
        parsed.sitelinks ?? (parsed.adExtensions as Record<string, unknown> | undefined)?.sitelinks
      )
        .map((s) => {
          // Preserve "Label (url)" shape when present
          const m = s.match(/^(.*?)(\s*\([^)]+\))$/);
          if (m) return `${finalizeCallout(m[1]!, 25)}${m[2]}`;
          return finalizeCallout(s, 25);
        })
        .filter(Boolean)
        .slice(0, 4),
      callouts: normalizeStringArray(
        parsed.callouts ?? (parsed.adExtensions as Record<string, unknown> | undefined)?.callouts
      )
        .map((s) => finalizeCallout(s, 25))
        .filter(Boolean)
        .slice(0, 4),
      structuredSnippets: normalizeStringArray(
        parsed.structuredSnippets ??
          (parsed.adExtensions as Record<string, unknown> | undefined)?.structuredSnippets
      )
        .map((s) => finalizeCallout(s, 25))
        .filter(Boolean)
        .slice(0, 4),
    },
    campaignStrategy: parsed.campaignStrategy as OptimizedAdContent['campaignStrategy'],
    improvementReasoning:
      asDisplayText(parsed.reasoning) ||
      asDisplayText(parsed.improvementReasoning) ||
      'Optimized using full audit intelligence for CTR, quality score, and conversions.',
    predictedImpact: {
      ctrIncrease:
        predicted?.ctr ??
        legacyPredicted?.ctrIncrease ??
        performanceEstimates.estimated.ctr ??
        '—',
      qualityScoreIncrease:
        predicted?.qualityScore ??
        legacyPredicted?.qualityScoreIncrease ??
        performanceEstimates.estimated.qualityScore ??
        '—',
      conversionImprovement:
        predicted?.conversionRate ??
        legacyPredicted?.conversionImprovement ??
        performanceEstimates.estimated.conversionRate ??
        '—',
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
    adGenerationExplanation,
    keywordImprovements: strategistRecommendations.keywords,
    negativeKeywordSuggestions: strategistRecommendations.negativeKeywords,
    landingPageRecommendations: strategistRecommendations.landingPage,
  };
}

function parseAdGenerationExplanation(
  raw: unknown,
  competitorAnalysis: CompetitorIntelligence | null | undefined
): AdGenerationExplanation | undefined {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
  const fromClaude: InfluencingCompetitor[] = [];
  if (Array.isArray(o?.topCompetitorsInfluencing)) {
    for (const row of o.topCompetitorsInfluencing) {
      if (!row || typeof row !== 'object') continue;
      const r = row as Record<string, unknown>;
      const name = String(r.name ?? '').trim();
      if (!name) continue;
      fromClaude.push({
        name,
        influencePercent: Number(r.influencePercent ?? 0) || 0,
        reason: String(r.reason ?? '').trim() || 'High AI Learning Value',
      });
    }
  }

  const weights = competitorAnalysis?.influenceWeights ?? [];
  const topCompetitorsInfluencing: InfluencingCompetitor[] =
    fromClaude.length > 0
      ? fromClaude.slice(0, 4).map((c) => {
          const w = weights.find((x) => x.name.toLowerCase() === c.name.toLowerCase());
          const profile = competitorAnalysis?.competitors?.find(
            (p) => p.name.toLowerCase() === c.name.toLowerCase()
          );
          const reasons: string[] = [];
          if (c.reason) reasons.push(c.reason);
          if (profile?.durationLabel) reasons.push(profile.durationLabel);
          if ((profile?.activeAdCount ?? 0) > 20) reasons.push('High Active Ads');
          if ((profile?.brandReview?.trustScore ?? 0) >= 70) reasons.push('Strong Reviews');
          if (profile?.offerTrustAnalysis?.offersUsed?.length) reasons.push('Strong Offers');
          return {
            name: c.name,
            influencePercent: w?.influencePercent ?? c.influencePercent,
            reason: [...new Set(reasons)].slice(0, 3).join(' · ') || c.reason,
          };
        })
      : weights.slice(0, 4).map((w) => {
          const profile = competitorAnalysis?.competitors?.find(
            (p) => p.name.toLowerCase() === w.name.toLowerCase()
          );
          const reasons: string[] = [];
          if ((profile?.adDurationDays ?? 0) >= 365) reasons.push('Highest Ad Duration');
          if ((profile?.activeAdCount ?? 0) >= 20) reasons.push('Highest Active Ads');
          if ((profile?.brandReview?.trustScore ?? 0) >= 70) reasons.push('Strong Reviews');
          if (profile?.offerTrustAnalysis?.trustSignals?.length) reasons.push('Strong Trust Signals');
          if (profile?.offerTrustAnalysis?.offersUsed?.length) reasons.push('Strong Offers');
          if (profile?.marketPosition) reasons.push(profile.marketPosition);
          return {
            name: w.name,
            influencePercent: w.influencePercent,
            reason: reasons.slice(0, 3).join(' · ') || 'High AI Learning Value',
          };
        });

  const market = competitorAnalysis?.marketPatterns;
  const offersFromMarket = market?.topOffers ?? [];
  const trustFromCompetitors =
    competitorAnalysis?.competitors?.flatMap((c) => c.offerTrustAnalysis?.trustSignals ?? c.trustSignals ?? []) ??
    [];

  const explanation: AdGenerationExplanation = {
    competitorSignalsUsed: normalizeStringArray(o?.competitorSignalsUsed).length
      ? normalizeStringArray(o?.competitorSignalsUsed)
      : [
          ...(market?.topHeadlines?.slice(0, 2) ?? []),
          ...(market?.topCtas?.slice(0, 2) ?? []),
        ].slice(0, 5),
    topCompetitorsInfluencing,
    offersUsed: normalizeStringArray(o?.offersUsed).length
      ? normalizeStringArray(o?.offersUsed)
      : offersFromMarket.slice(0, 5),
    trustSignalsUsed: normalizeStringArray(o?.trustSignalsUsed).length
      ? normalizeStringArray(o?.trustSignalsUsed)
      : [...new Set(trustFromCompetitors)].slice(0, 5),
    keywordsUsed: normalizeStringArray(o?.keywordsUsed).length
      ? normalizeStringArray(o?.keywordsUsed)
      : (market?.topKeywords ?? []).slice(0, 6),
    reviewInsightsUsed: normalizeStringArray(o?.reviewInsightsUsed).length
      ? normalizeStringArray(o?.reviewInsightsUsed)
      : (competitorAnalysis?.competitors ?? [])
          .flatMap((c) => c.brandReview?.positiveThemes ?? [])
          .slice(0, 4),
    socialAuthorityInsightsUsed: normalizeStringArray(o?.socialAuthorityInsightsUsed).length
      ? normalizeStringArray(o?.socialAuthorityInsightsUsed)
      : (competitorAnalysis?.competitors ?? [])
          .filter((c) => (c.socialPresence?.totalSocialReach ?? 0) > 0 || (c.brandAuthorityScore ?? 0) >= 70)
          .map(
            (c) =>
              `${c.name}: brand authority ${c.brandAuthorityScore ?? '—'}/100` +
              (c.socialPresence?.totalSocialReach
                ? `, reach ${c.socialPresence.totalSocialReach.toLocaleString()}`
                : '')
          )
          .slice(0, 3),
    marketPositioningUsed: normalizeStringArray(o?.marketPositioningUsed).length
      ? normalizeStringArray(o?.marketPositioningUsed)
      : (competitorAnalysis?.competitors ?? [])
          .map((c) => c.marketPosition ?? c.brandAuthority?.marketPosition)
          .filter((x): x is NonNullable<typeof x> => Boolean(x))
          .slice(0, 3),
  };

  const hasContent =
    explanation.topCompetitorsInfluencing.length > 0 ||
    explanation.offersUsed.length > 0 ||
    explanation.competitorSignalsUsed.length > 0 ||
    explanation.trustSignalsUsed.length > 0;

  return hasContent ? explanation : undefined;
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

const FAMILY_LABEL: Record<string, string> = {
  car_loan: 'Car Loans',
  home_loan: 'Home Loans',
  personal_loan: 'Personal Loans',
  business_loan: 'Business Loans',
  commercial_mortgage: 'Commercial Mortgage',
  insurance: 'Insurance',
  real_estate: 'Real Estate',
};

function isSpecificServiceLabel(label: string): boolean {
  const t = label.trim();
  if (!t || /^(core service|general|other|services)$/i.test(t)) return false;
  if (/landing page$/i.test(t) && !/\b(mortgage|broker|loan|finance)\b/i.test(t)) return false;
  if (/\b(commercial|business|car|auto|home|personal|mortgage|broker|finance|loan)\b/i.test(t)) {
    return true;
  }
  return t.split(/\s+/).length >= 2;
}

function canonicalPrimaryServiceLabel(label: string): string {
  const t = label.trim();
  if (!t) return t;
  const lower = t.toLowerCase();
  if (/\bcommercial\b/.test(lower) && /\b(mortgage|property)\b/.test(lower)) {
    if (/\bbroker\b/.test(lower)) return 'Commercial Mortgage Broker';
    return 'Commercial Mortgage';
  }
  return t;
}

/** User-selected / inferred service wins over URL path when path maps to a rival vertical. */
function resolvePrimaryServiceFromAd(opts: {
  claimed?: string;
  headlines: string[];
  descriptions: string[];
  finalUrls?: string[];
}): string {
  const claimed = opts.claimed?.trim();
  const claimedCanonical = claimed ? canonicalPrimaryServiceLabel(claimed) : '';

  const urlBlob = (opts.finalUrls ?? [])
    .map((u) => {
      try {
        return new URL(u.startsWith('http') ? u : `https://${u}`).pathname.replace(/[-_/]+/g, ' ');
      } catch {
        return u.replace(/[-_/]+/g, ' ');
      }
    })
    .join(' ');
  const pathFamilies = detectServiceFamilies(urlBlob).filter((f) => f !== 'generic');
  const copyFamilies = detectServiceFamilies(
    [...opts.headlines, ...opts.descriptions].join(' ')
  ).filter((f) => f !== 'generic');

  if (claimedCanonical && isSpecificServiceLabel(claimedCanonical)) {
    const claimedFamilies = detectServiceFamilies(claimedCanonical).filter((f) => f !== 'generic');
    const pathFamily = pathFamilies[0];
    if (
      claimedFamilies.length &&
      pathFamily &&
      !claimedFamilies.includes(pathFamily)
    ) {
      return claimedCanonical;
    }
    if (copyFamilies.some((f) => claimedFamilies.includes(f))) {
      return claimedCanonical;
    }
    // Ad copy / inferred service wins over generic family labels (e.g. "Commercial Mortgage Broker" not "Business Loans")
    return claimedCanonical;
  }

  if (pathFamilies[0] && FAMILY_LABEL[pathFamilies[0]]) {
    return FAMILY_LABEL[pathFamilies[0]]!;
  }

  if (copyFamilies[0] && FAMILY_LABEL[copyFamilies[0]]) {
    return FAMILY_LABEL[copyFamilies[0]]!;
  }

  if (claimedCanonical) return claimedCanonical;
  return opts.headlines[0]?.trim().slice(0, 40) || 'Core Service';
}

function rsaDriftsFromService(
  headlines: string[],
  descriptions: string[],
  primaryService: string
): boolean {
  const targets = [primaryService];
  const blob = [...headlines, ...descriptions].join(' ');
  if (!blob.trim()) return true;
  if (hasConflictingService(blob, targets)) return true;
  const wanted = targetServiceFamilies(targets).filter((f) => f !== 'generic');
  if (!wanted.length) return false;
  const found = detectServiceFamilies(blob).filter((f) => f !== 'generic');
  // Wrong concrete vertical present with no target hit
  if (found.length && !found.some((f) => wanted.includes(f))) return true;
  // Majority of explicit service headlines name a rival vertical
  const rivalHits = headlines.filter((h) => hasConflictingService(h, targets)).length;
  const targetHits = headlines.filter((h) => {
    const fams = detectServiceFamilies(h).filter((f) => f !== 'generic');
    return fams.some((f) => wanted.includes(f));
  }).length;
  if (rivalHits >= 3 && rivalHits > targetHits) return true;
  return false;
}

export type OptimizeAdProgressUpdate = {
  progress: number;
  stage: string;
  originalAd?: OptimizeAdResult['originalAd'];
  competitorAnalysis?: OptimizeAdResult['competitorAnalysis'];
  optimized?: OptimizeAdResult['optimized'];
  optimizedVariations?: OptimizeAdResult['optimizedVariations'];
  intelligenceSummary?: OptimizeAdResult['intelligenceSummary'];
  analysisSources?: OptimizeAdResult['analysisSources'];
  campaignPerformance?: OptimizeAdResult['campaignPerformance'];
  auditHealthScore?: OptimizeAdResult['auditHealthScore'];
  scenario?: OptimizeAdResult['scenario'];
  dataSource?: OptimizeAdResult['dataSource'];
  finding?: OptimizeAdResult['finding'];
};

export async function optimizeAd(
  request: OptimizeAdRequest,
  onProgress?: (update: OptimizeAdProgressUpdate) => void | Promise<void>
): Promise<OptimizeAdResult> {
  const emit = async (update: OptimizeAdProgressUpdate) => {
    try {
      await onProgress?.(update);
    } catch (err) {
      console.warn('[optimizeAd] progress emit failed:', err instanceof Error ? err.message : err);
    }
  };

  const startedAt = Date.now();
  const stored = await getAuditReport(request.auditId);
  if (!stored && !request.accountContext?.accountName) {
    throw new Error('Audit not found — refresh the page or run a new audit.');
  }

  const finding = await resolveFinding(request.auditId, request.findingId, request.findingSnapshot);

  console.log(`[optimizeAd] start audit=${request.auditId} finding=${request.findingId} campaign=${request.accountContext?.campaignId ?? 'all'}${request.regenerateOnly ? ' (regenerate-only)' : ''}`);
  await emit({ progress: 8, stage: 'Loading account intelligence…' });

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
        skipCompetitorAnalysis: true,
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
      skipCompetitorAnalysis: true,
    });
    console.log(`[optimizeAd] intelligence ready in ${Date.now() - startedAt}ms (source=${intelligence.dataSource}${useLightweight ? ', lightweight' : ''})`);
  }

  const isAdScoped = request.accountContext?.optimizationScope === 'ad';
  const snapEarly = request.accountContext?.primaryAdSnapshot;
  const earlyLockService = isAdScoped
    ? resolvePrimaryServiceFromAd({
        claimed: request.accountContext?.primaryService,
        headlines: snapEarly?.headlines?.length
          ? snapEarly.headlines
          : intelligence.primaryAd?.headlines ?? [],
        descriptions: snapEarly?.descriptions?.length
          ? snapEarly.descriptions
          : intelligence.primaryAd?.descriptions ?? [],
        finalUrls:
          snapEarly?.finalUrls?.length
            ? snapEarly.finalUrls
            : intelligence.primaryAd?.finalUrls,
      })
    : undefined;
  const earlyProducts =
    isAdScoped && earlyLockService
      ? [earlyLockService, ...(request.accountContext?.productsServices ?? [])]
          .filter(Boolean)
          .filter((s, i, arr) => arr.findIndex((x) => x.toLowerCase() === s.toLowerCase()) === i)
          .slice(0, 3)
      : request.accountContext?.productsServices ?? [];

  if (earlyLockService) {
    console.log(
      `[optimizeAd] early service lock for discovery: "${earlyLockService}" (claimed="${request.accountContext?.primaryService ?? ''}")`
    );
  }

  const existingCompetitorCount = intelligence.competitorAnalysis?.competitors?.length ?? 0;
  const existingRealAds = countRealCompetitorAds(intelligence.competitorAnalysis);

  const inferLocationFromCopy = (opts: {
    headlines?: string[];
    descriptions?: string[];
    adGroupName?: string;
    finalUrls?: string[];
    campaignName?: string;
  }): string | undefined => {
    const blob = [
      ...(opts.headlines ?? []),
      ...(opts.descriptions ?? []),
      opts.adGroupName ?? '',
      opts.campaignName ?? '',
      ...(opts.finalUrls ?? []),
    ].join(' ');
    const m = blob.match(
      /\b(melbourne|sydney|brisbane|perth|adelaide|canberra|hobart|gold coast)\b/i
    );
    if (m?.[1]) {
      const city = m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase();
      return `${city}, Australia`;
    }
    if (/\baustralia\b|\b\.com\.au\b/i.test(blob)) return 'Australia';
    return undefined;
  };

  const resolvedLocation =
    request.accountContext?.location ??
    intelligence.websiteAnalysis?.locations?.[0] ??
    inferLocationFromCopy({
      headlines: snapEarly?.headlines ?? intelligence.primaryAd?.headlines,
      descriptions: snapEarly?.descriptions ?? intelligence.primaryAd?.descriptions,
      adGroupName: snapEarly?.adGroupName ?? intelligence.primaryAd?.adGroupName,
      finalUrls: snapEarly?.finalUrls ?? intelligence.primaryAd?.finalUrls,
      campaignName: request.accountContext?.campaignName,
    });

  if (resolvedLocation) {
    console.log(`[optimizeAd] competitor region lock: "${resolvedLocation}"`);
  }

  // Ad-scoped: refresh only when gather skipped/empty — never force a 2nd full SociaVault crawl
  // (duplicate crawls were taking 10–13+ minutes and timing out the UI).
  const uploadedCompetitorUrls = (request.accountContext?.competitorUrls ?? []).filter(Boolean);
  const uploadedCompetitorNames = (request.accountContext?.competitorNames ?? []).filter(Boolean);
  const uploadedCompetitorEntries = (request.accountContext?.competitorEntries ?? [])
    .map((e) => ({
      name: String(e?.name ?? '').trim(),
      url: e?.url ? String(e.url).trim() : undefined,
    }))
    .filter((e) => e.name || e.url);
  const hasUploadedList =
    uploadedCompetitorEntries.length > 0 ||
    uploadedCompetitorUrls.length > 0 ||
    uploadedCompetitorNames.length > 0;
  const discoveryMode =
    request.accountContext?.competitorDiscoveryMode ??
    (hasUploadedList ? 'both' : 'auto');
  // uploaded_only = client list only; both = client + AI discovery; auto = discovery only
  const useUploadedList = discoveryMode !== 'auto' && hasUploadedList;
  const userProvidedOnly = discoveryMode === 'uploaded_only' && useUploadedList;
  const hasUploadedCompetitors = useUploadedList;

  // Upload → document rivals (+ optional discovery). No upload / auto → SociaVault / Transparency.
  const staleDocumentIntel =
    !hasUploadedCompetitors &&
    intelligence.competitorAnalysis?.source === 'user_provided';
  const needsCompetitorRefresh = hasUploadedCompetitors
    ? true
    : staleDocumentIntel
      ? true
      : isAdScoped
        ? existingCompetitorCount === 0 && existingRealAds === 0
        : existingCompetitorCount === 0 ||
          existingRealAds < 2 ||
          !(intelligence.competitorAnalysis?.adGallery?.some((g) => (g.totalAdCount ?? 0) > 0) ?? false);

  const websiteUrl = intelligence.business.websiteUrl;
  const adScopedServices = earlyProducts.length
    ? earlyProducts
    : request.accountContext?.productsServices ?? [];
  const competitorDiscoverySource: CompetitorDiscoverySource =
    discoveryMode === 'uploaded_only'
      ? 'document'
      : discoveryMode === 'both'
        ? 'both'
        : 'sociavault';

  const searchKeywords = (request.accountContext?.serviceKeywords ?? [])
    .map((k) => k.trim())
    .filter((k) => k.length >= 3);

  const competitorCacheLookup = {
    websiteUrl,
    businessName: intelligence.business.name,
    primaryService: earlyLockService ?? request.accountContext?.primaryService,
    productsServices: isAdScoped
      ? adScopedServices
      : [
          ...(request.accountContext?.productsServices ?? []),
          ...(intelligence.websiteAnalysis?.services ?? []),
        ],
    offer: request.accountContext?.offer?.trim() || undefined,
    discoverySource: competitorDiscoverySource,
    country:
      resolveMarketCountry({
        location: resolvedLocation,
        websiteUrl,
        explicitCountry: request.accountContext?.location,
      }) ?? inferCountryFromLocation(resolvedLocation),
    preferredCampaignType:
      request.accountContext?.preferredCampaignType || request.accountContext?.campaignType,
    userProvidedOnly,
    competitorUrls:
      hasUploadedCompetitors && uploadedCompetitorUrls.length ? uploadedCompetitorUrls : undefined,
    competitorNames:
      hasUploadedCompetitors && uploadedCompetitorNames.length ? uploadedCompetitorNames : undefined,
    competitorEntries:
      hasUploadedCompetitors && uploadedCompetitorEntries.length
        ? uploadedCompetitorEntries
        : undefined,
    searchKeywords: searchKeywords.length ? searchKeywords : undefined,
    strictServiceSeed: isAdScoped && !userProvidedOnly,
  };

  const cachedCompetitors = await getCachedCompetitorDiscovery(competitorCacheLookup);
  if (
    cachedCompetitors &&
    ((cachedCompetitors.competitors?.length ?? 0) > 0 || (cachedCompetitors.adGallery?.length ?? 0) > 0)
  ) {
    intelligence = {
      ...intelligence,
      competitorAnalysis: cachedCompetitors,
      analysisSources: {
        ...intelligence.analysisSources,
        competitorAnalysis: cachedCompetitors.competitors.length > 0,
      },
    };
        console.log(
          `[optimizeAd] using cached competitor discovery from database (${cachedCompetitors.competitors.length} rivals, ${cachedCompetitors.adGallery?.length ?? 0} ads)`
        );
  } else if (needsCompetitorRefresh) {
    console.log(
      `[optimizeAd] competitor path: mode=${discoveryMode} ${
        hasUploadedCompetitors
          ? `uploaded (${uploadedCompetitorEntries.length || uploadedCompetitorUrls.length || uploadedCompetitorNames.length} rivals)${userProvidedOnly ? ' only' : ' + discovery'}`
          : isAdScoped
            ? 'auto-discovery (ad service-scoped)'
            : 'auto-discovery (campaign/account)'
      }`
    );
    await emit({
      progress: 15,
      stage: hasUploadedCompetitors
        ? userProvidedOnly
          ? 'Fetching Transparency ads for your confirmed competitors…'
          : 'Enriching your competitors and discovering additional rivals…'
        : 'Discovering competitors and fetching their ads…',
    });
    const refreshed = await analyzeCompetitors({
      businessName: intelligence.business.name,
      websiteUrl,
      industry: request.accountContext?.industry,
      location: resolvedLocation,
      monthlySpend: intelligence.business.monthlySpend ?? request.accountContext?.monthlySpend,
      productsServices: isAdScoped
        ? adScopedServices
        : [
            ...(request.accountContext?.productsServices ?? []),
            ...(intelligence.websiteAnalysis?.services ?? []),
          ],
      // Pass client list unless mode is auto-only
      competitorUrls: hasUploadedCompetitors && uploadedCompetitorUrls.length
        ? uploadedCompetitorUrls
        : undefined,
      competitorNames: hasUploadedCompetitors && uploadedCompetitorNames.length
        ? uploadedCompetitorNames
        : undefined,
      competitorEntries: hasUploadedCompetitors && uploadedCompetitorEntries.length
        ? uploadedCompetitorEntries
        : undefined,
      websiteIntel: intelligence.websiteAnalysis,
      currentAd: request.accountContext?.primaryAdSnapshot
        ? {
            headlines: request.accountContext.primaryAdSnapshot.headlines ?? [],
            descriptions: request.accountContext.primaryAdSnapshot.descriptions ?? [],
          }
        : undefined,
      // Always lightweight on Make It Better — full crawl + multi-Claude regenerations
      // exceed the browser poll window (especially with large uploaded competitor lists).
      lightweight: true,
      skipSocialPresence: true,
      serviceScoped: isAdScoped && !userProvidedOnly,
      primaryService: earlyLockService ?? request.accountContext?.primaryService,
      userProvidedOnly,
      preferredCampaignType:
        request.accountContext?.preferredCampaignType ||
        request.accountContext?.campaignType,
      offer: request.accountContext?.offer?.trim() || undefined,
      discoverySource: competitorDiscoverySource,
      searchKeywords: searchKeywords.length ? searchKeywords : undefined,
      strictServiceSeed: isAdScoped && !userProvidedOnly,
    });
    intelligence = {
      ...intelligence,
      competitorAnalysis: refreshed,
      analysisSources: {
        ...intelligence.analysisSources,
        competitorAnalysis: refreshed.competitors.length > 0,
      },
    };
    console.log(
      `[optimizeAd] competitor intelligence refreshed (${refreshed.competitors.length} competitors${
        isAdScoped
          ? `, service="${earlyLockService ?? request.accountContext?.primaryService ?? adScopedServices[0] ?? ''}"`
          : ''
      })`
    );
    await emit({
      progress: 35,
      stage: `Competitor intel ready (${refreshed.competitors.length} rivals) — analyzing ad gallery…`,
      competitorAnalysis: refreshed,
      analysisSources: intelligence.analysisSources,
    });
  } else if (isAdScoped) {
    console.log(
      `[optimizeAd] reusing gathered competitors (${existingCompetitorCount} rivals, ${existingRealAds} gallery ads) — skip second crawl`
    );
    await emit({
      progress: 30,
      stage: `Using ${existingCompetitorCount} competitors — preparing current ad…`,
      competitorAnalysis: intelligence.competitorAnalysis,
    });
  } else {
    await emit({
      progress: 28,
      stage: 'Competitor intel loaded — preparing current ad…',
      competitorAnalysis: intelligence.competitorAnalysis,
    });
  }

  let originalAd = intelligenceToCurrentAd(intelligence, finding);
  // Ad-level: selected snapshot is the source of truth (never another campaign RSA / homepage mix)
  const snap = request.accountContext?.primaryAdSnapshot;
  if (isAdScoped && snap?.headlines?.length) {
    originalAd = {
      ...originalAd,
      headlines: snap.headlines,
      descriptions: snap.descriptions?.length ? snap.descriptions : originalAd.descriptions,
      finalUrls: snap.finalUrls?.length ? snap.finalUrls : originalAd.finalUrls,
      displayPath1: snap.displayPath1 ?? originalAd.displayPath1,
      displayPath2: snap.displayPath2 ?? originalAd.displayPath2,
      adStrength: snap.adStrength ?? originalAd.adStrength,
      ctr: snap.ctr ?? originalAd.ctr,
      conversions: snap.conversions ?? originalAd.conversions,
      adGroupName: snap.adGroupName ?? originalAd.adGroupName,
    };
  }

  const lockedPrimary = isAdScoped
    ? earlyLockService ??
      resolvePrimaryServiceFromAd({
        claimed: request.accountContext?.primaryService,
        headlines: originalAd.headlines,
        descriptions: originalAd.descriptions,
        finalUrls: originalAd.finalUrls,
      })
    : undefined;

  const adServiceLock =
    isAdScoped && lockedPrimary
      ? {
          primaryService: lockedPrimary,
          productsServices: (request.accountContext?.productsServices?.length
            ? request.accountContext.productsServices
            : [lockedPrimary]
          ).slice(0, 4),
          landingPage: originalAd.finalUrls?.[0],
          originalHeadlines: originalAd.headlines,
          originalDescriptions: originalAd.descriptions,
        }
      : undefined;

  // Prevent website multi-product crawl from steering Claude to a different vertical
  if (adServiceLock && intelligence.websiteAnalysis) {
    intelligence = {
      ...intelligence,
      websiteAnalysis: {
        ...intelligence.websiteAnalysis,
        services: [adServiceLock.primaryService],
        headings: [adServiceLock.primaryService],
        title: adServiceLock.primaryService,
        locations: resolvedLocation
          ? [resolvedLocation, ...(intelligence.websiteAnalysis.locations ?? []).slice(0, 2)]
          : intelligence.websiteAnalysis.locations,
        metaDescription: `Landing page for ${adServiceLock.primaryService}${
          adServiceLock.landingPage ? `: ${adServiceLock.landingPage}` : ''
        }${resolvedLocation ? ` · Market: ${resolvedLocation}` : ''}`,
        rawTextSample: [
          `Service: ${adServiceLock.primaryService}`,
          adServiceLock.landingPage ? `Landing: ${adServiceLock.landingPage}` : '',
          resolvedLocation ? `Market: ${resolvedLocation}` : '',
          'Write NEW RSA angles (offers, trust, speed, geo specialist) — do not reuse live ad phrasing.',
        ]
          .filter(Boolean)
          .join(' '),
      },
    };
  } else if (resolvedLocation && intelligence.websiteAnalysis) {
    intelligence = {
      ...intelligence,
      websiteAnalysis: {
        ...intelligence.websiteAnalysis,
        locations: [resolvedLocation, ...(intelligence.websiteAnalysis.locations ?? []).slice(0, 2)],
      },
    };
  }

  if (adServiceLock) {
    console.log(
      `[optimizeAd] AD SERVICE LOCK: "${adServiceLock.primaryService}" landing=${adServiceLock.landingPage ?? 'n/a'}`
    );
  }

  const tone = request.tone ?? 'default';
  const variationHint = [
    request.variation ? VARIATION_HINTS[request.variation] : undefined,
    intelligence.scenario === 'REPLACE_EXISTING'
      ? [
          'ANALYZE-THEN-GENERATE (FIXED ORDER):',
          '1) READ THE CURRENT AD first — note what it already says (geo, product, CTA, proof) and treat it as a baseline to leave behind.',
          '2) NOTE COMPETITOR ADS from adGallery — list winning offers, trust, CTAs, keywords the current ad lacks.',
          '3) SUGGEST a brand-new RSA that develops those competitor pros for the client — NOT a rewrite of the current ad.',
          'HARD RULE: The AI Optimized Ad must look NOTHING like the current ad. No paraphrases, no word-order swaps, no synonym tweaks, no City+Product twins.',
          'At least 90% of headlines must introduce new angles from competitor insights. Target Ad Difference Score 90+.',
        ].join(' ')
      : undefined,
  ]
    .filter(Boolean)
    .join('\n');
  const brand = resolveBusinessName(
    intelligence.business.name,
    intelligence.business.websiteUrl
  );

  const baseline = buildBaselinePerformance(intelligence);

  await emit({
    progress: 42,
    stage: 'Step 1/3 — Reading your current ad…',
    originalAd,
    competitorAnalysis: intelligence.competitorAnalysis,
    scenario: intelligence.scenario,
    dataSource: intelligence.dataSource,
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
  });

  await emit({
    progress: 48,
    stage: 'Step 2/3 — Noting competitor ads (offers, trust, CTAs)…',
    originalAd,
    competitorAnalysis: intelligence.competitorAnalysis,
  });

  const promptCtx = {
    intelligence,
    finding,
    currentAd: originalAd,
    previousOptimizedAd,
    scenario: intelligence.scenario,
    tone,
    optimizationMode: request.optimizationMode ?? 'aggressive',
    variationHint: [
      variationHint || undefined,
      request.customPrompt?.trim()
        ? `CLIENT CUSTOM INSTRUCTIONS (MUST APPLY TO HEADLINES, DESCRIPTIONS, SITELINKS, CALLOUTS, STRUCTURED SNIPPETS, KEYWORDS, AND NEGATIVE KEYWORDS):\n${request.customPrompt.trim()}`
        : undefined,
    ]
      .filter(Boolean)
      .join('\n\n') || undefined,
    customPrompt: request.customPrompt,
    adServiceLock,
  };

  async function runClaudeOnce(
    ctx: typeof promptCtx,
    temperature?: number
  ): Promise<OptimizedAdContent> {
    const response = await createClaudeMessage(
      {
        max_tokens: ANTHROPIC_OPTIMIZE_MAX_TOKENS,
        temperature: temperature ?? (request.regenerateOnly ? 1 : 0.85),
        messages: [{ role: 'user', content: buildFullOptimizeAdPrompt(ctx) }],
      },
      undefined,
      ANTHROPIC_OPTIMIZE_MODEL_FALLBACKS
    );
    console.log(
      `[optimizeAd] Claude response in ${Date.now() - claudeStart}ms (total ${Date.now() - startedAt}ms, stop=${response.stop_reason ?? 'unknown'}, model=${response.model})`
    );
    const block = response.content[0];
    if (block.type !== 'text') throw new Error('Unexpected Claude response format');

    const hitMaxTokens = response.stop_reason === 'max_tokens';
    if (hitMaxTokens) {
      console.warn(
        '[optimizeAd] Claude hit max_tokens — attempting truncated JSON repair before compact retry'
      );
    }

    try {
      // Always attempt parse first (includes truncated-JSON repair). Only compact-retry if that fails.
      return parseClaudeJson(block.text, brand, baseline, intelligence, adServiceLock?.primaryService);
    } catch (firstErr) {
      const firstMsg = firstErr instanceof Error ? firstErr.message : String(firstErr);
      console.warn(`[optimizeAd] first parse failed (${firstMsg}), retrying with compact prompt`);
      const retry = await createClaudeMessage(
        {
          max_tokens: ANTHROPIC_OPTIMIZE_MAX_TOKENS,
          temperature: 0.75,
          messages: [{ role: 'user', content: buildCompactOptimizeRetryPrompt(ctx) }],
        },
        undefined,
        ANTHROPIC_OPTIMIZE_MODEL_FALLBACKS
      );
      const retryBlock = retry.content[0];
      if (retryBlock.type !== 'text') throw firstErr;
      console.log(
        `[optimizeAd] compact retry stop=${retry.stop_reason ?? 'unknown'} model=${retry.model} (len=${retryBlock.text.length})`
      );
      if (retry.stop_reason === 'max_tokens') {
        // Last chance: repair truncated compact JSON
        try {
          return parseClaudeJson(
            retryBlock.text,
            brand,
            baseline,
            intelligence,
            adServiceLock?.primaryService
          );
        } catch {
          throw new Error(
            'AI response was truncated (token limit). Click Try Again — a shorter response will be requested.'
          );
        }
      }
      return parseClaudeJson(
        retryBlock.text,
        brand,
        baseline,
        intelligence,
        adServiceLock?.primaryService
      );
    }
  }

  const claudeStart = Date.now();
  await emit({
    progress: 52,
    stage: 'Step 3/3 — Generating a suggested RSA that differs from your current ad…',
    originalAd,
    competitorAnalysis: intelligence.competitorAnalysis,
  });
  let optimized = await runClaudeOnce(
    promptCtx,
    request.regenerateOnly
      ? request.customPrompt?.trim()
        ? 1.05
        : 1
      : 1.0
  );

  // Reject RSA that drifted to a different product vertical (e.g. Business Loans for a Car Loans ad)
  if (
    adServiceLock?.primaryService &&
    rsaDriftsFromService(optimized.headlines, optimized.descriptions, adServiceLock.primaryService)
  ) {
    console.warn(
      `[optimizeAd] SERVICE DRIFT detected — RSA not about "${adServiceLock.primaryService}"; forcing locked regenerate`
    );
    try {
      optimized = await runClaudeOnce(
        {
          ...promptCtx,
          previousOptimizedAd: {
            headlines: optimized.headlines,
            descriptions: optimized.descriptions,
          },
          variationHint: [
            promptCtx.variationHint,
            `CRITICAL SERVICE CORRECTION: Previous draft was REJECTED because it promoted the WRONG service.`,
            `Locked service is ONLY "${adServiceLock.primaryService}" (landing: ${adServiceLock.landingPage ?? 'n/a'}).`,
            `Rewrite ALL 15 headlines + 4 descriptions + sitelinks + callouts for "${adServiceLock.primaryService}" exclusively.`,
            `Do NOT mention business loans, SME, commercial loans, home loans, mortgages, or personal loans unless that IS "${adServiceLock.primaryService}".`,
          ]
            .filter(Boolean)
            .join('\n'),
        },
        0.75
      );
      if (
        rsaDriftsFromService(optimized.headlines, optimized.descriptions, adServiceLock.primaryService)
      ) {
        console.warn(
          `[optimizeAd] SERVICE DRIFT still present after regenerate — keeping draft but flagging lock="${adServiceLock.primaryService}"`
        );
      } else {
        console.log(`[optimizeAd] service lock recovered — RSA now matches "${adServiceLock.primaryService}"`);
      }
    } catch (driftErr) {
      console.warn(
        `[optimizeAd] service-lock regenerate failed — keeping original draft:`,
        driftErr instanceof Error ? driftErr.message : driftErr
      );
    }
  }

  // Ad Difference Score — auto-regenerate if too similar (cap retries to protect poll window)
  // Never fail the whole job if a regenerate call hits an auth/rate error — ship the best draft.
  let differenceScore = computeAdDifferenceScore(originalAd, optimized);
  let diffAttempts = 0;
  const maxDiffAttempts = request.regenerateOnly ? 3 : 4;
  while (differenceScore < AD_DIFFERENCE_TARGET && diffAttempts < maxDiffAttempts) {
    if (Date.now() - startedAt > 7 * 60_000) {
      console.warn(
        `[optimizeAd] skipping further difference retries — wall clock ${Math.round((Date.now() - startedAt) / 1000)}s`
      );
      break;
    }
    diffAttempts += 1;
    const nearDupes = listNearDuplicateHeadlines(originalAd, optimized);
    console.warn(
      `[optimizeAd] Ad Difference Score ${differenceScore}/100 < ${AD_DIFFERENCE_TARGET} — regenerating (attempt ${diffAttempts}); near-dupes=${nearDupes.length}`
    );
    await emit({
      progress: 54 + diffAttempts,
      stage: `Suggested ad too similar to current (${differenceScore}/100) — rewriting with competitor angles…`,
      originalAd,
      competitorAnalysis: intelligence.competitorAnalysis,
      optimized,
    });
    const documentOnly = intelligence.competitorAnalysis?.source === 'user_provided';
    const rivalLimit = documentOnly ? 10 : 4;
    const galleryHints = (intelligence.competitorAnalysis?.adGallery ?? [])
      .slice(0, rivalLimit)
      .map(
        (g) =>
          `${g.advertiserName ?? g.name}: ${(g.headlines ?? []).slice(0, documentOnly ? 5 : 3).join(' | ')} / offers=${(g.offers ?? []).slice(0, documentOnly ? 4 : 2).join(', ')} / trust=${(g.trustSignals ?? []).slice(0, 2).join(', ')}`
      );
    const profileHints =
      documentOnly && galleryHints.length < 3
        ? (intelligence.competitorAnalysis?.competitors ?? [])
            .slice(0, rivalLimit)
            .filter((p) => !galleryHints.some((h) => h.toLowerCase().startsWith(p.name.toLowerCase())))
            .map(
              (p) =>
                `${p.name}: ${(p.headlines ?? p.keyMessages ?? []).slice(0, 4).join(' | ')} / offers=${(p.offers ?? []).slice(0, 3).join(', ')}`
            )
        : [];
    const rivalHints = [...galleryHints, ...profileHints].join('\n');
    const previousDraft = {
      headlines: optimized.headlines,
      descriptions: optimized.descriptions,
    };
    try {
      let candidate = await runClaudeOnce(
        {
          ...promptCtx,
          previousOptimizedAd: previousDraft,
          variationHint: [
            promptCtx.variationHint,
            adServiceLock?.primaryService
              ? `Stay locked to service "${adServiceLock.primaryService}" only.`
              : '',
            request.accountContext?.location || resolvedLocation
              ? `Prefer same-region competitor angles for ${request.accountContext?.location || resolvedLocation}.`
              : '',
            documentOnly
              ? 'DOCUMENT MODE: Use ONLY uploaded Make It Better rivals as inspiration — do not invent other competitors, and never name them in ad copy.'
              : '',
            rivalHints ? `Competitor ads to note and improve on (do not name rivals in the ad):\n${rivalHints}` : '',
            nearDupes.length
              ? `FORBIDDEN near-clones of the CURRENT AD (do not reuse or lightly reword):\n${nearDupes
                  .slice(0, 12)
                  .map((h) => `- ${h}`)
                  .join('\n')}`
              : '',
            `CURRENT AD BASELINE (leave behind):\nHeadlines: ${JSON.stringify(
              (originalAd.headlines ?? []).slice(0, 15)
            )}\nDescriptions: ${JSON.stringify((originalAd.descriptions ?? []).slice(0, 4))}`,
            `CRITICAL REGENERATION: Previous draft scored only ${differenceScore}/100 on Ad Difference vs the current ad (target ${AD_DIFFERENCE_TARGET}+). Workflow: (1) re-read current ad (2) re-note competitor ads (3) invent a DRAMATICALLY different RSA — new offers, trust, CTAs, geo hooks from competitor intelligence. Zero paraphrase / word-order swaps. No "beats [rival]" and no unverifiable "0%" claims.`,
          ]
            .filter(Boolean)
            .join('\n'),
        },
        1.1
      );
      // Never accept a higher difference score if it broke the service lock
      if (
        adServiceLock?.primaryService &&
        rsaDriftsFromService(candidate.headlines, candidate.descriptions, adServiceLock.primaryService)
      ) {
        console.warn(
          `[optimizeAd] difference regenerate broke service lock "${adServiceLock.primaryService}" — retrying with lock`
        );
        try {
          candidate = await runClaudeOnce(
            {
              ...promptCtx,
              previousOptimizedAd: {
                headlines: candidate.headlines,
                descriptions: candidate.descriptions,
              },
              variationHint: `SERVICE LOCK + DIFFERENCE: Write a dramatically different RSA that is STILL only about "${adServiceLock.primaryService}". Beat rivals with new offers/proof/CTAs — not paraphrases.`,
            },
            1
          );
        } catch (lockErr) {
          console.warn(
            `[optimizeAd] service-lock difference retry failed — keeping difference draft:`,
            lockErr instanceof Error ? lockErr.message : lockErr
          );
        }
      }
      optimized = candidate;
      differenceScore = computeAdDifferenceScore(originalAd, optimized);
    } catch (regenErr) {
      const regenMsg = regenErr instanceof Error ? regenErr.message : String(regenErr);
      console.warn(
        `[optimizeAd] difference regenerate failed (${regenMsg}) — shipping draft at ${differenceScore}/100`
      );
      break;
    }
  }

  if (differenceScore < AD_DIFFERENCE_TARGET) {
    console.warn(
      `[optimizeAd] Ad Difference Score still ${differenceScore}/100 after ${diffAttempts} retries (target ${AD_DIFFERENCE_TARGET}) — shipping best effort`
    );
  }

  optimized.adDifferenceScore = differenceScore;
  if (optimized.adGenerationExplanation) {
    optimized.adGenerationExplanation = {
      ...optimized.adGenerationExplanation,
      adDifferenceScore: differenceScore,
    };
  } else {
    optimized.adGenerationExplanation = parseAdGenerationExplanation(
      null,
      intelligence.competitorAnalysis
    );
    if (optimized.adGenerationExplanation) {
      optimized.adGenerationExplanation.adDifferenceScore = differenceScore;
    }
  }

  console.log(`[optimizeAd] Ad Difference Score final=${differenceScore}/100 (retries=${diffAttempts})`);

  await emit({
    progress: 62,
    stage: `Primary RSA ready (difference ${differenceScore}/100) — generating top-competitor copies…`,
    originalAd,
    competitorAnalysis: intelligence.competitorAnalysis,
    optimized,
  });

  const optimizedVariations: OptimizedAdContent[] = [];
  const variationBudgetMs = 10 * 60_000;
  if (!request.regenerateOnly && Date.now() - startedAt < variationBudgetMs) {
    type RivalSeed = {
      name: string;
      headlines: string[];
      descriptions: string[];
      offers: string[];
      trustSignals: string[];
      influencePercent: number;
    };
    const byName = new Map<string, RivalSeed>();
    const upsertRival = (r: RivalSeed) => {
      const key = r.name.toLowerCase();
      if (!key) return;
      const prev = byName.get(key);
      if (!prev || r.influencePercent > prev.influencePercent) {
        byName.set(key, {
          ...r,
          headlines: r.headlines.length ? r.headlines : prev?.headlines ?? [],
          descriptions: r.descriptions.length ? r.descriptions : prev?.descriptions ?? [],
          offers: r.offers.length ? r.offers : prev?.offers ?? [],
          trustSignals: r.trustSignals.length ? r.trustSignals : prev?.trustSignals ?? [],
        });
      }
    };
    for (const g of intelligence.competitorAnalysis?.adGallery ?? []) {
      const name = String(g.advertiserName ?? g.name ?? '').trim();
      if (!name) continue;
      upsertRival({
        name,
        headlines: g.headlines ?? [],
        descriptions: g.descriptions ?? [],
        offers: g.offers ?? [],
        trustSignals: g.trustSignals ?? [],
        influencePercent: Number(g.influencePercent) || Number(g.aiLearningValue) || Number(g.confidenceScore) || 0,
      });
    }
    for (const c of intelligence.competitorAnalysis?.competitors ?? []) {
      const name = String(c.name ?? '').trim();
      if (!name) continue;
      upsertRival({
        name,
        headlines: c.headlines ?? c.keyMessages ?? [],
        descriptions: c.descriptions ?? [],
        offers: c.offers ?? [],
        trustSignals: c.trustSignals ?? [],
        influencePercent:
          Number(c.influencePercent) ||
          Number(c.aiLearningValue) ||
          Number(c.confidenceScore) ||
          0,
      });
    }
    const topRivals = [...byName.values()]
      .sort((a, b) => b.influencePercent - a.influencePercent || a.name.localeCompare(b.name))
      .slice(0, 3);
    const seenKeys = new Set([optimized.headlines.join('\u0001')]);

    // Target: primary + 3 more = 4 Make It Better ad copies
    const TARGET_VARIATIONS = 3;
    const angleFallbacks = [
      {
        name: 'High-conversion CTA',
        headlines: optimized.headlines.slice(0, 4),
        descriptions: optimized.descriptions.slice(0, 2),
        offers: ['fast quote', 'compare lenders', 'speak to a specialist'],
        trustSignals: ['licensed', 'local experts'],
        influencePercent: 0,
        hint: 'ANGLE: high-conversion CTA — urgency, clear next step, stronger verbs, still service-locked.',
      },
      {
        name: 'Trust & proof',
        headlines: optimized.headlines.slice(0, 4),
        descriptions: optimized.descriptions.slice(0, 2),
        offers: ['years of experience', 'award-winning team'],
        trustSignals: ['trusted locally', 'transparent advice'],
        influencePercent: 0,
        hint: 'ANGLE: trust and proof — credibility, experience, reassurance, still service-locked.',
      },
      {
        name: 'Offer-led',
        headlines: optimized.headlines.slice(0, 4),
        descriptions: optimized.descriptions.slice(0, 2),
        offers: ['free assessment', 'multi-lender comparison'],
        trustSignals: ['no obligation'],
        influencePercent: 0,
        hint: 'ANGLE: offer-led — tangible benefit hooks and comparison value, still service-locked.',
      },
    ] as Array<RivalSeed & { hint?: string }>;

    const variationSeeds: Array<RivalSeed & { hint?: string; inspiredByCompetitor?: boolean }> = [
      ...topRivals.map((r) => ({ ...r, inspiredByCompetitor: true as const })),
    ];
    for (const fallback of angleFallbacks) {
      if (variationSeeds.length >= TARGET_VARIATIONS) break;
      variationSeeds.push({ ...fallback, inspiredByCompetitor: false });
    }

    for (let i = 0; i < Math.min(TARGET_VARIATIONS, variationSeeds.length); i++) {
      if (Date.now() - startedAt > variationBudgetMs) {
        console.warn(
          `[optimizeAd] skipping remaining variations — wall clock ${Math.round((Date.now() - startedAt) / 1000)}s`
        );
        break;
      }
      const rival = variationSeeds[i]!;
      let accepted: OptimizedAdContent | null = null;
      for (let attempt = 0; attempt < 2 && !accepted; attempt++) {
        try {
          const alt = await runClaudeOnce(
            {
              ...promptCtx,
              previousOptimizedAd: {
                headlines: [
                  ...optimized.headlines,
                  ...optimizedVariations.flatMap((v) => v.headlines.slice(0, 5)),
                ],
                descriptions: [
                  ...optimized.descriptions,
                  ...optimizedVariations.flatMap((v) => v.descriptions.slice(0, 2)),
                ],
              },
              variationHint: [
                promptCtx.variationHint,
                rival.inspiredByCompetitor
                  ? `COMPETITOR-INSPIRED RSA ${i + 2} of 4 (focused on insights from "${rival.name}" — do NOT name them in the ad).`
                  : `ALTERNATE RSA ${i + 2} of 4 (${rival.hint ?? rival.name}).`,
                `Study angles privately: headlines=${rival.headlines.slice(0, 6).join(' | ') || 'n/a'}; descriptions=${rival.descriptions.slice(0, 3).join(' | ') || 'n/a'}; offers=${rival.offers.slice(0, 4).join(', ') || 'n/a'}; trust=${rival.trustSignals.slice(0, 3).join(', ') || 'n/a'}.`,
                `Write a complete new RSA (15 headlines, 4 descriptions) that is MORE attention-grabbing and professional for the CLIENT brand.`,
                rival.inspiredByCompetitor
                  ? `Express how the client improved vs gaps those rivals leave open (speed, trust, lender choice, local expertise, clear CTA) — searcher-first benefits only.`
                  : `Make this copy clearly different from the primary and any earlier variations — new hooks, proof, and CTAs.`,
                `FORBIDDEN in headlines/descriptions/callouts/sitelinks: naming "${rival.name}", "beats ${rival.name}", "better than", "unlike [competitor]", any rival brand name.`,
                `FORBIDDEN weak/misleading marketing: "0%", "0% fees", "0% interest", unverifiable free-forever claims, truncated sentences.`,
                `Must use ≥70% different phrasing vs the primary AI optimized ad. Keep service lock, brand, and Google Ads character limits.`,
                attempt > 0
                  ? 'RETRY: previous draft was rejected — remove competitor names and unverifiable 0% claims; make copy sharper and more professional.'
                  : '',
              ]
                .filter(Boolean)
                .join('\n'),
            },
            0.88 + i * 0.04
          );
          if (
            adServiceLock?.primaryService &&
            rsaDriftsFromService(alt.headlines, alt.descriptions, adServiceLock.primaryService)
          ) {
            continue;
          }
          const blob = [...alt.headlines, ...alt.descriptions, ...(alt.adExtensions?.callouts ?? [])]
            .join(' ')
            .toLowerCase();
          const rivalLower = rival.name.toLowerCase();
          const distinctiveTokens = rivalLower
            .split(/[^a-z0-9]+/)
            .filter(
              (w) =>
                w.length > 3 &&
                !['bank', 'limited', 'ltd', 'group', 'australia', 'finance', 'loan', 'loans', 'and', 'the', 'pty', 'high', 'conversion', 'trust', 'proof', 'offer', 'led'].includes(
                  w
                )
            );
          const namesRival =
            Boolean(rival.inspiredByCompetitor) &&
            (blob.includes(rivalLower) ||
              (distinctiveTokens.length > 0 &&
                distinctiveTokens.every((t) => blob.includes(t)) &&
                distinctiveTokens.join(' ').length >= 6));
          const adCopyText = [...alt.headlines, ...alt.descriptions].join(' ');
          const hasBadClaim =
            /\b0\s*%/i.test(adCopyText) ||
            /\bbeats?\b[\s\S]{0,50}\b(bank|loan|finance|ltd|limited|group)\b/i.test(adCopyText) ||
            /\bunlike\b[\s\S]{0,40}\b(bank|loan|finance|competitor)\b/i.test(adCopyText);
          if (namesRival || hasBadClaim) {
            console.warn(
              `[optimizeAd] variation vs "${rival.name}" rejected (competitor naming or weak claim) attempt=${attempt + 1}`
            );
            continue;
          }
          const key = alt.headlines.join('\u0001');
          if (seenKeys.has(key)) continue;
          seenKeys.add(key);
          alt.variationLabel = rival.inspiredByCompetitor
            ? `Inspired by ${rival.name}`
            : rival.name;
          alt.focusedCompetitor = rival.inspiredByCompetitor ? rival.name : undefined;
          alt.adDifferenceScore = computeAdDifferenceScore(originalAd, alt);
          accepted = alt;
        } catch (err) {
          console.warn(`[optimizeAd] competitor variation vs "${rival.name}" skipped`, err);
        }
      }
      if (accepted) {
        optimizedVariations.push(accepted);
        await emit({
          progress: 65 + Math.round((optimizedVariations.length / TARGET_VARIATIONS) * 25),
          stage: `Ad copy ${optimizedVariations.length + 1}/4 ready (${accepted.variationLabel})…`,
          originalAd,
          competitorAnalysis: intelligence.competitorAnalysis,
          optimized,
          optimizedVariations: [...optimizedVariations],
        });
      }
    }
    console.log(
      `[optimizeAd] ad copies ready: primary + ${optimizedVariations.length}/${TARGET_VARIATIONS} variations (rivals=${topRivals.map((r) => r.name).join(', ') || 'none'})`
    );
  }

  await emit({
    progress: 92,
    stage: 'Finalizing Make It Better results…',
    originalAd,
    competitorAnalysis: intelligence.competitorAnalysis,
    optimized,
    optimizedVariations: optimizedVariations.length ? optimizedVariations : undefined,
  });

  // Diversify sitelink destinations when Claude reused the same final URL on every link
  if (optimized.adExtensions?.sitelinks?.length) {
    const baseUrl = originalAd.finalUrls?.[0] || intelligence.business.websiteUrl || '';
    let origin = '';
    try {
      origin = baseUrl ? new URL(baseUrl.startsWith('http') ? baseUrl : `https://${baseUrl}`).origin : '';
    } catch {
      origin = '';
    }
    if (origin) {
      const pathHints = [
        '/get-a-quote/',
        '/car-loans/',
        '/about/',
        '/contact/',
        '/rates/',
        '/apply/',
      ];
      const servicePath = adServiceLock?.primaryService
        ? `/${adServiceLock.primaryService.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')}/`
        : '/services/';
      const urls = optimized.adExtensions.sitelinks.map((s) => {
        const m = s.match(/\((https?:\/\/[^)]+)\)\s*$/i);
        return m?.[1]?.toLowerCase() ?? '';
      });
      const uniqueUrls = new Set(urls.filter(Boolean));
      if (uniqueUrls.size <= 1) {
        optimized.adExtensions.sitelinks = optimized.adExtensions.sitelinks.map((s, i) => {
          const label = s.replace(/\s*\(https?:\/\/[^)]+\)\s*$/i, '').trim() || `Link ${i + 1}`;
          const path = i === 0 && servicePath ? servicePath : pathHints[i % pathHints.length]!;
          return `${finalizeCallout(label, 25)} (${origin}${path})`;
        });
      }
    }
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
      optimizedContent: { ...optimized, optimizedVariations } as object,
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
    optimizedVariations: optimizedVariations.length ? optimizedVariations : undefined,
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
  optimizedVariations?: OptimizedAdContent[];
  competitorAnalysis?: CompetitorIntelligence | null;
  improvementReasoning: string | null;
  publishedActivity?: Array<{
    id: string;
    status: string;
    publishedAt: Date | null;
    createdAt: Date;
    rollbackAvailable: boolean;
    errorMessage: string | null;
    originalAd?: CurrentAdData | Record<string, unknown> | null;
    publishedAd?: CurrentAdData | Record<string, unknown> | null;
    campaignName?: string;
  }>;
}

/** Latest Make It Better optimization per finding+campaign for PDF / report export. */
export async function getOptimizationsForAuditReport(
  auditRunId: string
): Promise<AuditReportOptimization[]> {
  const rows = await prisma.aIOptimization.findMany({
    where: { auditRunId },
    orderBy: { createdAt: 'desc' },
    include: {
      publishedVersions: { orderBy: { createdAt: 'desc' }, take: 10 },
    },
  });

  const result: AuditReportOptimization[] = [];

  for (const row of rows) {
    const rawContent = row.optimizedContent as unknown as OptimizedAdContent & {
      optimizedVariations?: OptimizedAdContent[];
    };
    const { optimizedVariations, ...primaryContent } = rawContent;

    result.push({
      id: row.id,
      findingId: row.findingId,
      campaignId: row.campaignId,
      scenario: row.scenario,
      tone: row.tone,
      createdAt: row.createdAt,
      originalAd: row.originalAd as unknown as CurrentAdData,
      optimizedContent: primaryContent as OptimizedAdContent,
      optimizedVariations: optimizedVariations?.length ? optimizedVariations : undefined,
      competitorAnalysis:
        row.auditContext && typeof row.auditContext === 'object'
          ? (row.auditContext as unknown as AuditIntelligence).competitorAnalysis
          : null,
      improvementReasoning: row.improvementReasoning,
      publishedActivity: row.publishedVersions.map((pv) => {
        const metrics =
          pv.performanceMetrics && typeof pv.performanceMetrics === 'object'
            ? (pv.performanceMetrics as { campaignName?: string })
            : {};
        return {
          id: pv.id,
          status: pv.status,
          publishedAt: pv.publishedAt,
          createdAt: pv.createdAt,
          rollbackAvailable: pv.rollbackAvailable,
          errorMessage: pv.errorMessage,
          originalAd: (pv.originalAdSnapshot as CurrentAdData | null) ?? null,
          publishedAd:
            ((pv.publishedContent ?? pv.optimizedAdSnapshot) as CurrentAdData | null) ?? null,
          campaignName: metrics.campaignName,
        };
      }),
    });
  }

  return result;
}
