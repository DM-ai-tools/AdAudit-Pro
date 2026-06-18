import { createClaudeMessage } from '../ai/anthropic-client.js';
import type { OptimizationTone } from '../ai/prompts/optimize-ad.prompt.js';
import {
  buildFullOptimizeAdPrompt,
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
import { extractJsonFromClaudeText } from '../utils/claude-json.js';
import {
  displayPathFromWebsite,
  resolveBusinessName,
  resolveDisplayHost,
} from '../utils/business-identity.js';

export type { OptimizationTone } from '../ai/prompts/optimize-ad.prompt.js';

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
}

export interface OptimizeAdRequest {
  userId: string;
  auditId: string;
  findingId: string;
  tone?: OptimizationTone;
  variation?: 'regenerate' | 'shorter' | 'more-variations' | 'aggressive-cta';
  customPrompt?: string;
  findingSnapshot?: Finding;
  auditFindingsSnapshot?: Finding[];
  accountContext?: {
    accountName?: string;
    goal?: string;
    monthlySpend?: number;
    googleAdsCustomerId?: string;
    websiteUrl?: string;
    industry?: string;
    userId?: string;
    campaignId?: string;
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
  };
}

const VARIATION_HINTS: Record<string, string> = {
  regenerate: 'Generate fresh alternative copy with different angles.',
  shorter: 'Prioritize shorter, punchier headlines and descriptions.',
  'more-variations': 'Maximize headline/description diversity for RSA ad strength.',
  'aggressive-cta': 'Use stronger, more urgent call-to-action language.',
};

function normalizeStringArray(val: unknown): string[] {
  if (!val) return [];
  if (Array.isArray(val)) return val.map((v) => String(v).trim()).filter(Boolean);
  if (typeof val === 'string') return [val.trim()].filter(Boolean);
  return [];
}

function enforceGoogleAdsLimits(
  headlines: string[],
  descriptions: string[],
  brand: string
): { headlines: string[]; descriptions: string[] } {
  const h = headlines.map((s) => s.trim().slice(0, 30)).filter(Boolean);
  const d = descriptions.map((s) => s.trim().slice(0, 90)).filter(Boolean);

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
    const next = fallbacksD[d.length % fallbacksD.length];
    if (!d.includes(next)) d.push(next.slice(0, 90));
    else break;
  }

  return { headlines: h.slice(0, 15), descriptions: d.slice(0, 4) };
}

function parseClaudeJson(text: string, brand: string): OptimizedAdContent {
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

  return {
    campaignId: (parsed.campaignId as string) || undefined,
    adGroupId: (parsed.adGroupId as string) || undefined,
    headlines: headlines.slice(0, 15),
    descriptions: descriptions.slice(0, 4),
    ctaSuggestions: (parsed.ctaSuggestions as string[]) ?? ['Get Quote', 'Call Now', 'Book Online'],
    keywordSuggestions: (parsed.keywordSuggestions as string[]) ?? [],
    displayPaths,
    adExtensions: {
      sitelinks: (parsed.sitelinks as string[]) ?? [],
      callouts: (parsed.callouts as string[]) ?? [],
      structuredSnippets: (parsed.structuredSnippets as string[]) ?? [],
    },
    campaignStrategy: parsed.campaignStrategy as OptimizedAdContent['campaignStrategy'],
    improvementReasoning:
      (parsed.reasoning as string) ??
      (parsed.improvementReasoning as string) ??
      'Optimized using full audit intelligence for CTR, quality score, and conversions.',
    predictedImpact: {
      ctrIncrease: predicted?.ctr ?? legacyPredicted?.ctrIncrease ?? '+18% Estimated CTR',
      qualityScoreIncrease: predicted?.qualityScore ?? legacyPredicted?.qualityScoreIncrease ?? '+1 Quality Score',
      conversionImprovement:
        predicted?.conversionRate ?? legacyPredicted?.conversionImprovement ?? '+15% Conversion Potential',
    },
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
    return {
      ...base,
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

  const website = intelligence.business.websiteUrl;
  const finalUrl = website
    ? (website.startsWith('http') ? website : `https://${website}`)
    : undefined;

  return {
    headlines: [
      `${brand} — Get Started`,
      `Trusted ${brand} Experts`,
      'Free Consultation',
      'Book Online Today',
      'Quality Service Guaranteed',
    ].map((h) => h.slice(0, 30)),
    descriptions: [
      `${bizName} helps you reach more customers. Visit ${displayHost} to learn more and get started.`,
      'Professional service backed by proven results. Contact us today for your free consultation.',
    ].map((d) => d.slice(0, 90)),
    keywords: [brand.toLowerCase(), 'services'],
    qualityScore: noData ? 0 : 3,
    ctr: 0,
    conversions: 0,
    adStrength: noData ? 'NONE' : 'POOR',
    campaignName: `${bizName} - Search`,
    adGroupName: 'Core Services',
    displayPath1: pathBrand,
    displayPath2: 'services',
    finalUrls: finalUrl ? [finalUrl] : undefined,
    cta: 'Learn More',
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
  const stored = await getAuditReport(request.auditId);
  if (!stored && !request.accountContext?.accountName) {
    throw new Error('Audit not found — refresh the page or run a new audit.');
  }

  const finding = await resolveFinding(request.auditId, request.findingId, request.findingSnapshot);

  const intelligence = await gatherAuditIntelligence({
    auditId: request.auditId,
    userId: request.userId,
    dataWindowDays: stored?.dataWindowDays,
    campaignId: request.accountContext?.campaignId,
    accountContext: request.accountContext,
    auditFindingsSnapshot: request.auditFindingsSnapshot ?? stored?.findings,
  });

  const originalAd = intelligenceToCurrentAd(intelligence, finding);
  const tone = request.tone ?? 'default';
  const variationHint = request.variation ? VARIATION_HINTS[request.variation] : undefined;
  const brand = resolveBusinessName(
    intelligence.business.name,
    intelligence.business.websiteUrl
  );

  const response = await createClaudeMessage({
    max_tokens: 8192,
    messages: [
      {
        role: 'user',
        content: buildFullOptimizeAdPrompt({
          intelligence,
          finding,
          currentAd: originalAd,
          scenario: intelligence.scenario,
          tone,
          variationHint,
          customPrompt: request.customPrompt,
        }),
      },
    ],
  });

  const block = response.content[0];
  if (block.type !== 'text') throw new Error('Unexpected Claude response format');

  let optimized: OptimizedAdContent;
  try {
    optimized = parseClaudeJson(block.text, brand);
  } catch (firstErr) {
    const retry = await createClaudeMessage({
      max_tokens: 8192,
      messages: [
        {
          role: 'user',
          content: `${buildFullOptimizeAdPrompt({
            intelligence,
            finding,
            currentAd: originalAd,
            scenario: intelligence.scenario,
            tone,
            variationHint,
            customPrompt: request.customPrompt,
          })}\n\nIMPORTANT: Your previous response was missing required headlines/descriptions. Return ONLY valid JSON with exactly 15 headlines (≤30 chars) and 4 descriptions (≤90 chars).`,
        },
      ],
    });
    const retryBlock = retry.content[0];
    if (retryBlock.type !== 'text') throw firstErr;
    optimized = parseClaudeJson(retryBlock.text, brand);
  }

  if (originalAd.campaignId) optimized.campaignId = originalAd.campaignId;
  if (originalAd.adGroupId) optimized.adGroupId = originalAd.adGroupId;

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
    },
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
