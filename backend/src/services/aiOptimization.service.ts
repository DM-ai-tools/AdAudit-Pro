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

function parseClaudeJson(text: string): OptimizedAdContent {
  const parsed = extractJsonFromClaudeText(text);

  const headlines = (parsed.headlines as string[] | undefined) ?? [];
  const descriptions = (parsed.descriptions as string[] | undefined) ?? [];
  if (!headlines.length || !descriptions.length) {
    throw new Error('Claude returned incomplete ad copy');
  }

  const displayPathsRaw = parsed.displayPaths;
  let displayPaths: { path1?: string; path2?: string } | undefined;
  if (Array.isArray(displayPathsRaw)) {
    displayPaths = { path1: displayPathsRaw[0], path2: displayPathsRaw[1] };
  } else if (displayPathsRaw && typeof displayPathsRaw === 'object') {
    const dp = displayPathsRaw as { path1?: string; path2?: string };
    displayPaths = dp;
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
  const ad = intelligence.primaryAd;
  const base = liveAdToCurrentAd(ad, intelligence.business.name);

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
      finalUrls: ad.finalUrls,
      displayPath1: intelligence.business.name.split(' ')[0].toLowerCase().slice(0, 15),
    };
  }

  const brand = intelligence.business.name.split(' ')[0];
  const noData = /no ad|no active|empty|not available|not detected|no data/i.test(
    `${finding.title} ${finding.description}`
  );

  return {
    headlines: base.headlines,
    descriptions: base.descriptions,
    keywords: [brand.toLowerCase(), 'services'],
    qualityScore: noData ? 0 : 3,
    ctr: 0,
    conversions: 0,
    adStrength: noData ? 'NONE' : 'POOR',
    campaignName: `${intelligence.business.name} - Search`,
    adGroupName: 'Brand Services',
    displayPath1: brand.toLowerCase().slice(0, 15),
    displayPath2: 'services',
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
        }),
      },
    ],
  });

  const block = response.content[0];
  if (block.type !== 'text') throw new Error('Unexpected Claude response format');

  const optimized = parseClaudeJson(block.text);

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
