import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, Sparkles, RefreshCw, TrendingUp, AlertTriangle,
  Zap, Send, RotateCcw, Edit3, Brain, ChevronDown, ChevronRight,
} from 'lucide-react';
import clsx from 'clsx';
import { Button } from '../ui/Button';
import { AIThinkingLoader } from './AIThinkingLoader';
import { StrategistEnhancementPanels } from './StrategistEnhancementPanels';
import { CompetitorAdGallery } from './CompetitorAdGallery';
import { CompetitorGapAnalysisTable } from './CompetitorGapAnalysisTable';
import { CompetitorIntelligenceDashboard } from './CompetitorIntelligenceDashboard';
import { CurrentAdSection } from './CurrentAdSection';
import { AIOptimizedSection } from './AIOptimizedSection';
import { WhyThisAdWasGenerated } from './WhyThisAdWasGenerated';
import { TONE_OPTIONS, MODE_OPTIONS, normalizeRenderableStrings, asDisplayText, finalizeHeadline, finalizeDescription } from './utils';
import { OptimizationErrorBoundary } from './OptimizationErrorBoundary';
import { PublishWorkflow } from './PublishWorkflow';
import { MakeItBetterStepNav, type MakeItBetterStepId } from './MakeItBetterStepNav';
import { MakeItBetterScopeBar } from './MakeItBetterScopeBar';
import { CampaignContextSection } from './CampaignContextSection';
import { WhyImproveThisAd } from './WhyImproveThisAd';
import { MakeItBetterPublishSections } from './MakeItBetterPublishSections';
import { AdCopyPicker } from './AdCopyPicker';
import { EditableOptimizationAssets } from './EditableOptimizationAssets';
import {
  applyEditableAssetsToContent,
  buildAssetPromptContext,
  extractEditableAssets,
  type EditableOptimizationAssetsState,
} from './optimizationAssetHelpers';
import { aiApi, googleAdsApi } from '../../services/api';
import type { Finding } from '../../types';
import type { GoogleAdsCampaign, GoogleAdsCampaignAd } from '../../types/connect';
import { resolveDisplayHost, resolveBusinessName } from '../../utils/business-identity';
import {
  inferServiceFromAd,
  inferLocationFromAd,
} from '../../utils/adServiceInference';
import { resolveAccountCampaignType } from '../../utils/campaignTypes';
import { buildCompetitorGalleryItems } from '../../utils/competitorGalleryDisplay';
import type {
  CurrentAdData,
  OptimizedAdContent,
  OptimizationTone,
  OptimizationMode,
  OptimizationVariation,
  OptimizationScenario,
  PreviewDevice,
  IntelligenceSummary,
  AnalysisSources,
  CampaignPerformanceSummary,
  OptimizeAdResponse,
  PublishAdResponse,
  CompetitorIntelligenceData,
} from '../../types/optimization';

function deriveCampaignServices(campaign: GoogleAdsCampaign): string[] {
  const seen = new Set<string>();
  for (const ad of campaign.ads ?? []) {
    const s = inferServiceFromAd(ad).primaryService?.trim();
    if (s) seen.add(s);
  }
  return [...seen].slice(0, 8);
}

function buildCampaignAccountContext(
  campaign?: GoogleAdsCampaign | null,
  selectedAd?: GoogleAdsCampaignAd | null,
  requestedService?: string
) {
  if (!campaign) return {};
  const hasAds = campaign.adCount > 0 || campaign.ads.length > 0;
  const isAdScoped = !!selectedAd;
  const primaryAd =
    selectedAd ??
    (campaign.ads?.length
      ? [...campaign.ads].sort((a, b) => b.impressions - a.impressions)[0]
      : undefined);

  const serviceInference = primaryAd ? inferServiceFromAd(primaryAd) : null;
  const primaryService = requestedService?.trim() || serviceInference?.primaryService;
  const inferredLocation = primaryAd ? inferLocationFromAd(primaryAd) : undefined;
  const campaignServices = deriveCampaignServices(campaign);

  return {
    campaignName: campaign.name,
    campaignType: campaign.type,
    preferredCampaignType: resolveAccountCampaignType({
      type: campaign.type,
      name: campaign.name,
      ads: campaign.ads,
    }),
    campaignStatus: campaign.status,
    biddingStrategyType: campaign.biddingStrategyType,
    hasExistingAds: hasAds,
    adCount: campaign.adCount,
    ...(inferredLocation ? { location: inferredLocation } : {}),
    campaignMetrics: {
      impressions: campaign.impressions,
      clicks: campaign.clicks,
      ctr: campaign.ctr,
      avgCpc: campaign.avgCpc,
      conversions: campaign.conversions,
      conversionRate: campaign.conversionRate,
      costPerConversion: campaign.costPerConversion,
      cost: campaign.cost,
      budgetDaily: campaign.budgetDaily,
    },
    ...(isAdScoped
      ? {
          optimizationScope: 'ad' as const,
          primaryService,
          productsServices: primaryService
            ? [primaryService, ...(serviceInference?.services ?? [])]
                .filter(Boolean)
                .filter((s, i, arr) => arr.findIndex((x) => x.toLowerCase() === s.toLowerCase()) === i)
                .slice(0, 3)
            : serviceInference?.services ?? [],
          serviceKeywords: serviceInference?.keywords ?? [],
          primaryAdSnapshot: primaryAd
            ? {
                headlines: primaryAd.headlines,
                descriptions: primaryAd.descriptions,
                finalUrls: primaryAd.finalUrls,
                displayPath1: primaryAd.displayPath1,
                displayPath2: primaryAd.displayPath2,
                adStrength: primaryAd.adStrength,
                ctr: primaryAd.ctr,
                conversions: primaryAd.conversions,
                impressions: primaryAd.impressions,
                clicks: primaryAd.clicks,
                adGroupName: primaryAd.adGroupName,
                resourceName: primaryAd.resourceName,
                adId: primaryAd.id,
              }
            : undefined,
        }
      : {
          optimizationScope: 'campaign' as const,
          productsServices: campaignServices.length ? campaignServices : undefined,
        }),
  };
}

function normalizeOptimizedContent(data: OptimizeAdResponse['optimized']): OptimizedAdContent {
  const strategistReasoning = data.strategistReasoning
    ? {
        headlineChanges: asDisplayText(data.strategistReasoning.headlineChanges),
        descriptionChanges: asDisplayText(data.strategistReasoning.descriptionChanges),
        keywordRelevance: asDisplayText(data.strategistReasoning.keywordRelevance),
        qualityScore: asDisplayText(data.strategistReasoning.qualityScore),
        conversionPotential: asDisplayText(data.strategistReasoning.conversionPotential),
        auditFindingsAddressed: normalizeRenderableStrings(data.strategistReasoning.auditFindingsAddressed),
        competitorInsightsUsed: normalizeRenderableStrings(data.strategistReasoning.competitorInsightsUsed),
        competitiveOutperformance: data.strategistReasoning.competitiveOutperformance
          ? {
              messagingImprovements: asDisplayText(data.strategistReasoning.competitiveOutperformance.messagingImprovements),
              keywordImprovements: asDisplayText(data.strategistReasoning.competitiveOutperformance.keywordImprovements),
              trustSignalImprovements: asDisplayText(data.strategistReasoning.competitiveOutperformance.trustSignalImprovements),
              offerImprovements: asDisplayText(data.strategistReasoning.competitiveOutperformance.offerImprovements),
              ctaImprovements: asDisplayText(data.strategistReasoning.competitiveOutperformance.ctaImprovements),
              conversionImprovements: asDisplayText(data.strategistReasoning.competitiveOutperformance.conversionImprovements),
              competitorStrategiesUsed: asDisplayText(data.strategistReasoning.competitiveOutperformance.competitorStrategiesUsed),
              competitorGapsExploited: asDisplayText(data.strategistReasoning.competitiveOutperformance.competitorGapsExploited),
            }
          : undefined,
      }
    : data.strategistReasoning;

  const strategistRecommendations = data.strategistRecommendations
    ? {
        keywords: normalizeRenderableStrings(data.strategistRecommendations.keywords),
        negativeKeywords: normalizeRenderableStrings(data.strategistRecommendations.negativeKeywords),
        extensions: normalizeRenderableStrings(data.strategistRecommendations.extensions),
        landingPage: normalizeRenderableStrings(data.strategistRecommendations.landingPage),
        budget: normalizeRenderableStrings(data.strategistRecommendations.budget),
        bidding: normalizeRenderableStrings(data.strategistRecommendations.bidding),
        audience: normalizeRenderableStrings(data.strategistRecommendations.audience),
      }
    : data.strategistRecommendations;

  return {
    ...data,
    headlines: normalizeRenderableStrings(data.headlines).map((h) => finalizeHeadline(h, 30)),
    descriptions: normalizeRenderableStrings(data.descriptions).map((d) =>
      finalizeDescription(d, 90)
    ),
    ctaSuggestions: normalizeRenderableStrings(data.ctaSuggestions),
    keywordSuggestions: normalizeRenderableStrings(data.keywordSuggestions),
    improvementReasoning: asDisplayText(data.improvementReasoning, 'Optimization complete.'),
    predictedImpact: {
      ctrIncrease: asDisplayText(data.predictedImpact?.ctrIncrease, '—'),
      qualityScoreIncrease: asDisplayText(data.predictedImpact?.qualityScoreIncrease, '—'),
      conversionImprovement: asDisplayText(data.predictedImpact?.conversionImprovement, '—'),
    },
    adExtensions: data.adExtensions
      ? {
          sitelinks: normalizeRenderableStrings(data.adExtensions.sitelinks),
          callouts: normalizeRenderableStrings(data.adExtensions.callouts),
          structuredSnippets: normalizeRenderableStrings(data.adExtensions.structuredSnippets),
        }
      : data.adExtensions,
    strategistReasoning,
    strategistRecommendations,
    adDifferenceScore: data.adDifferenceScore,
    adGenerationExplanation: data.adGenerationExplanation
      ? {
          competitorSignalsUsed: normalizeRenderableStrings(
            data.adGenerationExplanation.competitorSignalsUsed
          ),
          topCompetitorsInfluencing: (data.adGenerationExplanation.topCompetitorsInfluencing ?? []).map(
            (c) => ({
              name: asDisplayText(c.name, 'Competitor'),
              influencePercent: Number(c.influencePercent) || 0,
              reason: asDisplayText(c.reason, 'High AI Learning Value'),
            })
          ),
          offersUsed: normalizeRenderableStrings(data.adGenerationExplanation.offersUsed),
          trustSignalsUsed: normalizeRenderableStrings(data.adGenerationExplanation.trustSignalsUsed),
          keywordsUsed: normalizeRenderableStrings(data.adGenerationExplanation.keywordsUsed),
          reviewInsightsUsed: normalizeRenderableStrings(
            data.adGenerationExplanation.reviewInsightsUsed
          ),
          socialAuthorityInsightsUsed: normalizeRenderableStrings(
            data.adGenerationExplanation.socialAuthorityInsightsUsed
          ),
          marketPositioningUsed: normalizeRenderableStrings(
            data.adGenerationExplanation.marketPositioningUsed
          ),
          adDifferenceScore:
            data.adGenerationExplanation.adDifferenceScore ?? data.adDifferenceScore,
        }
      : data.adGenerationExplanation,
    competitorInsights: data.competitorInsights?.map((c) => ({
      name: asDisplayText(c.name, 'Competitor'),
      url: c.url,
      keyMessages: normalizeRenderableStrings(c.keyMessages),
      offers: normalizeRenderableStrings(c.offers),
      keywordOpportunities: normalizeRenderableStrings(c.keywordOpportunities),
      adDurationDays: c.adDurationDays,
      activeAdCount: c.activeAdCount,
      totalAdCount: c.totalAdCount,
      firstShown: c.firstShown,
      lastShown: c.lastShown,
      brandReview: c.brandReview,
      confidenceScore: c.confidenceScore,
      influencePercent: c.influencePercent,
      durationLabel: c.durationLabel,
    })),
    missingCompetitorAdvantages: normalizeRenderableStrings(data.missingCompetitorAdvantages),
    campaignStrategy: data.campaignStrategy
      ? {
          ...data.campaignStrategy,
          campaignName: data.campaignStrategy.campaignName
            ? asDisplayText(data.campaignStrategy.campaignName)
            : undefined,
          adGroups: (data.campaignStrategy.adGroups ?? []).map((ag) => ({
            name: asDisplayText(ag.name, 'Ad group'),
            keywords: normalizeRenderableStrings(ag.keywords),
          })),
          negativeKeywords: normalizeRenderableStrings(data.campaignStrategy.negativeKeywords),
          competitorInsights: normalizeRenderableStrings(data.campaignStrategy.competitorInsights),
        }
      : undefined,
  };
}

interface AIOptimizationModalProps {
  open: boolean;
  onClose: () => void;
  auditId: string;
  finding: Finding;
  auditFindings: Finding[];
  accountName: string;
  googleAdsCustomerId?: string;
  websiteUrl?: string;
  goal?: string;
  monthlySpend?: number;
  userId?: string;
  industry?: string;
  competitorUrls?: string[];
  competitorNames?: string[];
  competitorEntries?: Array<{ name: string; url?: string }>;
  competitorDiscoveryMode?: 'uploaded_only' | 'auto' | 'both';
  initialCampaignId?: string;
  initialCampaign?: GoogleAdsCampaign | null;
  /** When set, optimize this RSA only with service-scoped competitors */
  initialAd?: GoogleAdsCampaignAd | null;
  /** Service chip the user filtered on (e.g. Commercial Mortgage Broker) */
  requestedService?: string;
  lockCampaignScope?: boolean;
}

export function AIOptimizationModal({
  open,
  onClose,
  auditId,
  finding,
  auditFindings,
  accountName,
  googleAdsCustomerId,
  websiteUrl,
  goal,
  monthlySpend,
  userId,
  industry,
  competitorUrls,
  competitorNames,
  competitorEntries,
  competitorDiscoveryMode,
  initialCampaignId,
  initialCampaign = null,
  initialAd = null,
  requestedService,
  lockCampaignScope = false,
}: AIOptimizationModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [optimizationId, setOptimizationId] = useState<string | null>(null);
  const [scenario, setScenario] = useState<OptimizationScenario>('CREATE_ADS');

  const [dataSource, setDataSource] = useState<'live' | 'audit_only'>('audit_only');
  const [intelligenceSummary, setIntelligenceSummary] = useState<IntelligenceSummary | null>(null);
  const [originalAd, setOriginalAd] = useState<CurrentAdData | null>(null);
  const [optimized, setOptimized] = useState<OptimizedAdContent | null>(null);
  const [editedHeadlines, setEditedHeadlines] = useState<string[]>([]);
  const [editedDescriptions, setEditedDescriptions] = useState<string[]>([]);
  const [editedAssets, setEditedAssets] = useState<EditableOptimizationAssetsState>({
    sitelinks: [],
    callouts: [],
    structuredSnippets: [],
    keywords: [],
    negativeKeywords: [],
  });
  const [editMode, setEditMode] = useState(false);
  const [previewDevice, setPreviewDevice] = useState<PreviewDevice>('mobile');
  const [showPublishConfirm, setShowPublishConfirm] = useState(false);
  const [publishResultData, setPublishResultData] = useState<PublishAdResponse | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [publishedId, setPublishedId] = useState<string | null>(null);
  const [rollbackAvailable, setRollbackAvailable] = useState(false);
  const [rollingBack, setRollingBack] = useState(false);
  const [customPrompt, setCustomPrompt] = useState('');
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>('');
  const [campaigns, setCampaigns] = useState<GoogleAdsCampaign[]>([]);
  const [campaignsLoading, setCampaignsLoading] = useState(false);
  const [activeTone, setActiveTone] = useState<OptimizationTone>('default');
  const [activeMode, setActiveMode] = useState<OptimizationMode>('balanced');
  const [regenerating, setRegenerating] = useState(false);
  const [campaignSwitching, setCampaignSwitching] = useState(false);
  const [analysisSources, setAnalysisSources] = useState<AnalysisSources | undefined>();
  const [campaignPerformance, setCampaignPerformance] = useState<CampaignPerformanceSummary | null | undefined>();
  const [auditHealthScore, setAuditHealthScore] = useState<number | undefined>();
  const [competitorAnalysis, setCompetitorAnalysis] = useState<CompetitorIntelligenceData | null>(null);
  const [optimizationVersion, setOptimizationVersion] = useState(0);
  const [adCopyOptions, setAdCopyOptions] = useState<
    Array<{ id: string; label: string; content: OptimizedAdContent }>
  >([]);
  const [selectedCopyId, setSelectedCopyId] = useState('primary');
  const [liveProgress, setLiveProgress] = useState(0);
  const [liveStage, setLiveStage] = useState('Starting Make It Better…');
  const [workflowStep, setWorkflowStep] = useState<MakeItBetterStepId>('ad');
  const [pauseExistingAd, setPauseExistingAd] = useState(false);
  const [refineOpen, setRefineOpen] = useState(false);
  const [reviewFinalUrl, setReviewFinalUrl] = useState('');
  const [reviewPath1, setReviewPath1] = useState('');
  const [reviewPath2, setReviewPath2] = useState('');
  const [finalUrlApproved, setFinalUrlApproved] = useState(false);
  const [publishCampaignSettings, setPublishCampaignSettings] = useState<{
    dailyBudget?: number;
    biddingStrategy?: string;
    targetCpa?: number;
  }>({});
  const optimizationCache = useRef<Map<string, OptimizeAdResponse>>(new Map());
  const requestGeneration = useRef(0);
  const requestInFlight = useRef(false);

  const businessName = resolveBusinessName(accountName, websiteUrl);

  const resolveCampaignKey = useCallback(
    (override?: string) => override ?? initialCampaignId ?? selectedCampaignId ?? '',
    [initialCampaignId, selectedCampaignId]
  );

  const resolveCampaignMeta = useCallback(
    (campaignKey: string) =>
      campaigns.find((c) => c.id === campaignKey)
        ?? (initialCampaign?.id === campaignKey ? initialCampaign : null),
    [campaigns, initialCampaign]
  );

  const applyOptimizationResponse = useCallback((data: OptimizeAdResponse) => {
    if (!data?.optimizationId || !data?.optimized?.headlines?.length) {
      throw new Error('AI returned an incomplete response. Click Try Again.');
    }
    const normalizedOptimized = normalizeOptimizedContent(data.optimized);
    if (!normalizedOptimized.headlines.length) {
      throw new Error('AI returned an incomplete response. Click Try Again.');
    }
    const safeOriginal: CurrentAdData = data.originalAd?.headlines?.length
      ? {
          ...data.originalAd,
          headlines: normalizeRenderableStrings(data.originalAd.headlines),
          descriptions: normalizeRenderableStrings(data.originalAd.descriptions),
        }
      : {
          headlines: normalizedOptimized.headlines.slice(0, 5),
          descriptions: normalizedOptimized.descriptions?.slice(0, 2) ?? [''],
          qualityScore: 0,
          ctr: 0,
          conversions: 0,
          adStrength: 'POOR',
        };
    setOptimizationId(data.optimizationId);
    setScenario(data.scenario);
    setDataSource(data.dataSource);
    setIntelligenceSummary(data.intelligenceSummary);
    setOriginalAd(safeOriginal);
    setOptimized(normalizedOptimized);
    setEditedHeadlines([...normalizedOptimized.headlines]);
    setEditedDescriptions([...(normalizedOptimized.descriptions ?? [])]);
    setEditedAssets(extractEditableAssets(normalizedOptimized));
    const baseUrl = safeOriginal.finalUrls?.[0] ?? websiteUrl ?? '';
    setReviewFinalUrl(baseUrl);
    setFinalUrlApproved(!!baseUrl);
    setReviewPath1(normalizedOptimized.displayPaths?.path1 ?? safeOriginal.displayPath1 ?? '');
    setReviewPath2(normalizedOptimized.displayPaths?.path2 ?? safeOriginal.displayPath2 ?? '');
    const extraCopies = (data.optimizedVariations ?? []).map((v) => normalizeOptimizedContent(v));
    const copyOptions: Array<{ id: string; label: string; content: OptimizedAdContent }> = [
      { id: 'primary', label: 'Primary — all competitors', content: normalizedOptimized },
      ...extraCopies.map((content, i) => ({
        id: `variation-${i}`,
        label:
          content.variationLabel ??
          (content.focusedCompetitor
            ? `Inspired by ${content.focusedCompetitor}`
            : `Variation ${i + 2}`),
        content,
      })),
    ];
    setAdCopyOptions(copyOptions);
    setSelectedCopyId('primary');
    setAnalysisSources(data.analysisSources);
    setCampaignPerformance(data.campaignPerformance);
    setAuditHealthScore(data.auditHealthScore);
    // Only when the user chose "uploaded competitors only" should we restrict the UI
    // to document domains. Modes "both" / "auto" must keep AI-discovered rivals.
    const docEntries =
      competitorEntries?.length
        ? competitorEntries
        : [
            ...(competitorUrls ?? []).map((url, i) => ({
              name: competitorNames?.[i] ?? url,
              url,
            })),
          ];
    const docDomains = new Set(
      docEntries
        .map((e) => e.url)
        .filter(Boolean)
        .map((u) => {
          try {
            return new URL(u!.startsWith('http') ? u! : `https://${u}`).hostname
              .replace(/^www\./, '')
              .toLowerCase();
          } catch {
            return '';
          }
        })
        .filter(Boolean)
    );
    const docNames = new Set(
      docEntries.map((e) => e.name.trim().toLowerCase()).filter(Boolean)
    );
    const nameByDomain = new Map(
      docEntries
        .filter((e) => e.url)
        .map((e) => {
          try {
            const d = new URL(e.url!.startsWith('http') ? e.url! : `https://${e.url}`).hostname
              .replace(/^www\./, '')
              .toLowerCase();
            return [d, e.name] as const;
          } catch {
            return null;
          }
        })
        .filter((x): x is readonly [string, string] => Boolean(x))
    );
    let nextAnalysis = data.competitorAnalysis ?? null;
    if (
      nextAnalysis &&
      competitorDiscoveryMode === 'uploaded_only' &&
      (docDomains.size > 0 || docNames.size > 0)
    ) {
      const domainOf = (url?: string) => {
        if (!url) return '';
        try {
          return new URL(url.startsWith('http') ? url : `https://${url}`).hostname
            .replace(/^www\./, '')
            .toLowerCase();
        } catch {
          return '';
        }
      };
      const domainMatches = (url?: string) => {
        const d = domainOf(url);
        if (!d || /adstransparency\.google\.com$/i.test(d)) return false;
        if (docDomains.has(d)) return true;
        return [...docDomains].some((doc) => d.endsWith(`.${doc}`) || doc.endsWith(`.${d}`));
      };
      const keep = (row: {
        name?: string;
        advertiserName?: string;
        url?: string;
        destinationUrl?: string;
        displayUrl?: string;
        transparencyUrl?: string;
      }) => {
        if (
          domainMatches(row.url) ||
          domainMatches(row.destinationUrl) ||
          domainMatches(row.displayUrl) ||
          domainMatches(row.transparencyUrl)
        ) {
          return true;
        }
        const name = (row.advertiserName ?? row.name ?? '').trim().toLowerCase();
        if (name && docNames.has(name)) return true;
        if (name) {
          return [...docNames].some(
            (doc) => name.includes(doc) || doc.includes(name)
          );
        }
        return false;
      };
      const stamp = <T extends { name: string; url?: string; advertiserName?: string }>(row: T): T => {
        const d =
          domainOf(row.url) ||
          domainOf((row as { destinationUrl?: string }).destinationUrl);
        const docName = nameByDomain.get(d);
        if (!docName) return row;
        return {
          ...row,
          name: docName,
          ...(row.advertiserName != null ? { advertiserName: docName } : {}),
        };
      };
      const seen = new Set<string>();
      nextAnalysis = {
        ...nextAnalysis,
        competitors: (nextAnalysis.competitors ?? [])
          .filter((c) => keep(c))
          .map((c) => stamp(c))
          .filter((c) => {
            const key = domainOf(c.url) || c.name.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          }),
        adGallery: (() => {
          const gSeen = new Set<string>();
          return (nextAnalysis.adGallery ?? [])
            .filter((g) => keep(g))
            .map((g) => stamp(g))
            .filter((g) => {
              const key =
                domainOf(g.destinationUrl) ||
                domainOf(g.url) ||
                (g.advertiserName ?? g.name).toLowerCase();
              if (gSeen.has(key)) return false;
              gSeen.add(key);
              return true;
            });
        })(),
        insights: (nextAnalysis.insights ?? [])
          .filter((i) => keep(i))
          .map((i) => stamp(i)),
        source: 'user_provided',
      };
    }
    setCompetitorAnalysis(nextAnalysis);
    setOptimizationVersion((v) => v + 1);
    setError(null);
  }, [competitorUrls, competitorNames, competitorEntries, competitorDiscoveryMode, websiteUrl]);

  const runOptimization = useCallback(async (
    tone?: OptimizationTone,
    variation?: OptimizationVariation,
    promptOverride?: string,
    isRegenerate = false,
    campaignIdOverride?: string,
    modeOverride?: OptimizationMode
  ) => {
    if (requestInFlight.current) return;

    const campaignKey = resolveCampaignKey(campaignIdOverride);
    const competitorFingerprint = [
      ...(competitorUrls ?? []),
      ...(competitorNames ?? []),
    ]
      .map((v) => v.trim().toLowerCase())
      .filter(Boolean)
      .sort()
      .join('|');
    const promptFingerprint = (promptOverride ?? customPrompt ?? '')
      .trim()
      .toLowerCase()
      .slice(0, 120);
    const cacheKey = `${initialAd?.id ? `${campaignKey}:${initialAd.id}` : campaignKey}::docs:${competitorFingerprint || 'auto'}::prompt:${promptFingerprint || 'none'}`;
    if (isRegenerate) {
      setRegenerating(true);
      setError(null);
      setEditMode(false);
      setWorkflowStep('recommendation');
      if (promptOverride?.trim()) {
        setLiveStage('Applying your custom AI instructions…');
        setLiveProgress(20);
      }
      // Drop any cached result for this ad (all prompt variants)
      for (const key of [...optimizationCache.current.keys()]) {
        if (key.startsWith(`${initialAd?.id ? `${campaignKey}:${initialAd.id}` : campaignKey}::`)) {
          optimizationCache.current.delete(key);
        }
      }
    } else if (optimizationCache.current.has(cacheKey) && !promptOverride) {
      applyOptimizationResponse(optimizationCache.current.get(cacheKey)!);
      return;
    } else if (campaignKey && !isRegenerate && optimized) {
      setCampaignSwitching(true);
    } else {
      setLoading(true);
      setLiveProgress(3);
      setLiveStage('Starting Make It Better…');
    }
    if (!isRegenerate) {
      setPublishResultData(null);
      setPublishError(null);
      setPublishedId(null);
      setRollbackAvailable(false);
    }
    const resolvedTone = tone ?? activeTone;
    const resolvedMode = modeOverride ?? activeMode;
    if (tone) setActiveTone(tone);
    if (modeOverride) setActiveMode(modeOverride);
    const prompt = promptOverride ?? customPrompt;
    const assetContext = buildAssetPromptContext(editedAssets);
    const fullCustomPrompt = [prompt.trim(), assetContext].filter(Boolean).join('\n\n');
    const generation = ++requestGeneration.current;
    requestInFlight.current = true;
    try {
      const campaignMeta = resolveCampaignMeta(campaignKey);
      const { data } = await aiApi.optimizeAd(
        {
        auditId,
        findingId: finding.id,
        tone: resolvedTone,
        optimizationMode: resolvedMode,
        variation,
        customPrompt: fullCustomPrompt || undefined,
        regenerateOnly: isRegenerate,
        findingSnapshot: finding,
        auditFindingsSnapshot: auditFindings,
        accountContext: {
          accountName: businessName,
          goal,
          monthlySpend,
          googleAdsCustomerId,
          websiteUrl,
          userId,
          industry,
          competitorUrls:
            competitorUrls?.filter(Boolean)?.length
              ? competitorUrls.filter(Boolean)
              : undefined,
          competitorNames:
            competitorNames?.filter(Boolean)?.length
              ? competitorNames.filter(Boolean)
              : undefined,
          competitorEntries: (() => {
            const rows = competitorEntries
              ?.map((e) => ({ name: e.name?.trim() ?? '', url: e.url?.trim() || undefined }))
              .filter((e) => e.name || e.url);
            return rows?.length ? rows : undefined;
          })(),
          competitorDiscoveryMode:
            competitorDiscoveryMode ??
            (competitorUrls?.length || competitorNames?.length || competitorEntries?.length
              ? 'both'
              : 'auto'),
          campaignId: campaignKey || undefined,
          findingCategory: finding.category,
          findingTitle: finding.title,
          ...(isRegenerate
            ? {
                previousOptimizedSnapshot: {
                  headlines: editedHeadlines.length ? editedHeadlines : optimized?.headlines ?? [],
                  descriptions: editedDescriptions.length ? editedDescriptions : optimized?.descriptions ?? [],
                },
              }
            : {}),
          ...buildCampaignAccountContext(campaignMeta, initialAd, requestedService),
        },
        },
        {
          onProgress: (update) => {
            if (generation !== requestGeneration.current) return;
            setLiveProgress(update.progress);
            setLiveStage(update.stage);
            const partial = update.partial;
            if (!partial) return;

            if (partial.originalAd?.headlines?.length) {
              setOriginalAd({
                ...partial.originalAd,
                headlines: normalizeRenderableStrings(partial.originalAd.headlines),
                descriptions: normalizeRenderableStrings(partial.originalAd.descriptions ?? []),
              });
            }
            if (partial.scenario) setScenario(partial.scenario);
            if (partial.dataSource) setDataSource(partial.dataSource);
            if (partial.intelligenceSummary) setIntelligenceSummary(partial.intelligenceSummary);
            if (partial.analysisSources) setAnalysisSources(partial.analysisSources);
            if (partial.campaignPerformance !== undefined) {
              setCampaignPerformance(partial.campaignPerformance);
            }
            if (partial.auditHealthScore !== undefined) {
              setAuditHealthScore(partial.auditHealthScore);
            }
            if (partial.competitorAnalysis) {
              setCompetitorAnalysis(partial.competitorAnalysis);
            }
            if (partial.optimized?.headlines?.length) {
              const normalizedOptimized = normalizeOptimizedContent(partial.optimized);
              setOptimized(normalizedOptimized);
              setEditedHeadlines([...normalizedOptimized.headlines]);
              setEditedDescriptions([...(normalizedOptimized.descriptions ?? [])]);
              const extraCopies = (partial.optimizedVariations ?? []).map((v) =>
                normalizeOptimizedContent(v)
              );
              setAdCopyOptions([
                { id: 'primary', label: 'Primary — all competitors', content: normalizedOptimized },
                ...extraCopies.map((content, i) => ({
                  id: `variation-${i}`,
                  label:
                    content.variationLabel ??
                    (content.focusedCompetitor
                      ? `Inspired by ${content.focusedCompetitor}`
                      : `Variation ${i + 2}`),
                  content,
                })),
              ]);
              setSelectedCopyId('primary');
              setOptimizationVersion((v) => v + 1);
            } else if (partial.optimizedVariations?.length) {
              setOptimized((prev) => {
                if (!prev) return prev;
                const extraCopies = partial.optimizedVariations!.map((v) => normalizeOptimizedContent(v));
                setAdCopyOptions([
                  { id: 'primary', label: 'Primary — all competitors', content: prev },
                  ...extraCopies.map((content, i) => ({
                    id: `variation-${i}`,
                    label:
                      content.variationLabel ??
                      (content.focusedCompetitor
                        ? `Inspired by ${content.focusedCompetitor}`
                        : `Variation ${i + 2}`),
                    content,
                  })),
                ]);
                return prev;
              });
            }
          },
        }
      );
      if (generation !== requestGeneration.current) return;
      optimizationCache.current.set(cacheKey, data);
      applyOptimizationResponse(data);
    } catch (err) {
      if (generation !== requestGeneration.current) return;
      let message = 'Failed to generate optimizations';
      if (axios.isAxiosError(err)) {
        if (err.code === 'ECONNABORTED') {
          message = 'Optimization is still running — wait a moment and try again.';
        } else if (err.code === 'ECONNRESET' || err.message?.includes('Network Error')) {
          message = isRegenerate
            ? 'Connection lost while regenerating. Your previous results are still shown — wait a moment and try Regenerate again.'
            : 'Connection lost — please try Make It Better again.';
        } else if (err.response?.status === 502) {
          message = 'Server gateway error — optimization may still be running. Wait a moment and try again.';
        }
        const apiError = (err.response?.data as { error?: string })?.error;
        if (err.response?.status === 404 && apiError === 'Not found') {
          message = 'AI API unavailable — restart backend with npm run dev.';
        } else if (err.response?.status === 401) {
          message = 'Sign in with Google to optimize and publish ads.';
        } else if (apiError && /api key is invalid|authentication_error/i.test(apiError)) {
          message =
            'Generation could not be completed. If a draft is already on screen, you can continue with it or try again.';
        } else if (apiError) {
          message = apiError;
        } else if (!err.code) {
          message = err.message;
        }
      } else if (err instanceof Error && err.message) {
        message = err.message;
      }
      setError(message);
    } finally {
      requestInFlight.current = false;
      if (generation !== requestGeneration.current) return;
      setLoading(false);
      setRegenerating(false);
      setCampaignSwitching(false);
    }
  }, [auditId, finding, auditFindings, businessName, goal, monthlySpend, googleAdsCustomerId, websiteUrl, userId, industry, competitorUrls, competitorNames, competitorEntries, competitorDiscoveryMode, customPrompt, activeTone, activeMode, applyOptimizationResponse, resolveCampaignKey, resolveCampaignMeta, optimized, editedHeadlines, editedDescriptions, editedAssets, initialAd]);

  useEffect(() => {
    if (!open || !googleAdsCustomerId) {
      setCampaigns([]);
      return;
    }
    setCampaignsLoading(true);
    void googleAdsApi.campaigns(googleAdsCustomerId)
      .then(({ data }) => setCampaigns(data.campaigns ?? []))
      .catch(() => setCampaigns([]))
      .finally(() => setCampaignsLoading(false));
  }, [open, googleAdsCustomerId]);

  useEffect(() => {
    if (!open) {
      optimizationCache.current.clear();
      setOptimizationId(null);
      setOriginalAd(null);
      setOptimized(null);
      setError(null);
      setPublishResultData(null);
      setPublishError(null);
      setEditMode(false);
      setShowPublishConfirm(false);
      setCustomPrompt('');
      setSelectedCampaignId('');
      setActiveTone('default');
      setAnalysisSources(undefined);
      setCampaignPerformance(undefined);
      setAuditHealthScore(undefined);
      setCompetitorAnalysis(null);
      setIntelligenceSummary(null);
      setAdCopyOptions([]);
      setSelectedCopyId('primary');
      setLiveProgress(0);
      setLiveStage('Starting Make It Better…');
      setCampaignSwitching(false);
      return;
    }
    setSelectedCampaignId(initialCampaignId ?? '');
  }, [open, initialCampaignId]);

  useEffect(() => {
    if (!open || !googleAdsCustomerId || campaignsLoading) return;
    if (initialCampaignId || lockCampaignScope) return;
    if (campaigns.length > 0 && !selectedCampaignId) {
      const pick = campaigns.find((c) => c.status === 'ENABLED')?.id ?? campaigns[0]?.id;
      if (pick) setSelectedCampaignId(pick);
    }
  }, [open, campaignsLoading, campaigns, initialCampaignId, lockCampaignScope, selectedCampaignId, googleAdsCustomerId]);

  const initialOptimizeDone = useRef(false);
  useEffect(() => {
    if (!open) {
      initialOptimizeDone.current = false;
      return;
    }
    if (campaignsLoading && !initialCampaignId && !initialCampaign) return;
    const targetCampaignId = initialCampaignId ?? selectedCampaignId;
    if (googleAdsCustomerId && campaigns.length > 0 && !targetCampaignId && !lockCampaignScope) return;
    if (initialOptimizeDone.current) return;
    initialOptimizeDone.current = true;
    void runOptimization(undefined, undefined, undefined, false, targetCampaignId || undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial load when modal opens
  }, [open, campaignsLoading, selectedCampaignId, initialCampaignId, lockCampaignScope, googleAdsCustomerId, campaigns.length]);

  const handleCampaignChange = (campaignId: string) => {
    if (campaignId === selectedCampaignId || isBusy) return;
    setSelectedCampaignId(campaignId);
    setPublishResultData(null);
    setPublishError(null);
    setPublishedId(null);
    setRollbackAvailable(false);
    const competitorFingerprint = [
      ...(competitorUrls ?? []),
      ...(competitorNames ?? []),
    ]
      .map((v) => v.trim().toLowerCase())
      .filter(Boolean)
      .sort()
      .join('|');
    const cacheKey = `${campaignId}::docs:${competitorFingerprint || 'auto'}`;
    const cached = optimizationCache.current.get(cacheKey);
    if (cached) {
      applyOptimizationResponse(cached);
      return;
    }
    void runOptimization(undefined, undefined, undefined, false, campaignId);
  };

  const handlePublish = async () => {
    if (!optimizationId) return;
    setPublishing(true);
    setPublishError(null);
    setError(null);
    try {
      const { data } = await googleAdsApi.publishAd({
        optimizationId,
        googleAdsCustomerId: googleAdsCustomerId ?? '0000000000',
        adGroupAdResourceName: originalAd?.adGroupAdResourceName,
        pauseExistingAd: pauseExistingAd === true,
        content: {
          headlines: editedHeadlines,
          descriptions: editedDescriptions,
          displayPaths: {
            path1: reviewPath1 || optimized?.displayPaths?.path1,
            path2: reviewPath2 || optimized?.displayPaths?.path2,
          },
          finalUrl: (reviewFinalUrl || originalAd?.finalUrls?.[0]) ?? websiteUrl,
        },
      });
      setPublishResultData(data);
      setPublishedId(data.publishedId);
      setRollbackAvailable(!!data.rollbackAvailable);
    } catch (err) {
      const message = axios.isAxiosError(err)
        ? (err.response?.data as { error?: string })?.error ?? 'Publish failed'
        : 'Publish failed';
      setPublishError(message);
      setError(message);
    } finally {
      setPublishing(false);
    }
  };

  const handleRollback = async () => {
    if (!publishedId) return;
    setRollingBack(true);
    try {
      const { data } = await googleAdsApi.rollbackAd(publishedId);
      setPublishResultData((prev) => prev ? {
        ...prev,
        message: data.message,
        rollbackAvailable: false,
      } : prev);
      setRollbackAvailable(false);
    } catch (err) {
      const message = axios.isAxiosError(err)
        ? (err.response?.data as { error?: string })?.error ?? 'Rollback failed'
        : 'Rollback failed';
      setPublishError(message);
      setError(message);
    } finally {
      setRollingBack(false);
    }
  };

  const closePublishWorkflow = () => {
    setShowPublishConfirm(false);
    if (!publishing) {
      setPublishError(null);
    }
  };

  const selectAdCopy = (copyId: string) => {
    const picked = adCopyOptions.find((o) => o.id === copyId);
    if (!picked) return;
    setSelectedCopyId(copyId);
    setOptimized(picked.content);
    setEditedHeadlines([...picked.content.headlines]);
    setEditedDescriptions([...(picked.content.descriptions ?? [])]);
    setEditedAssets(extractEditableAssets(picked.content));
    setEditMode(false);
  };

  const previewOptimized = useMemo(
    () => (optimized ? applyEditableAssetsToContent(optimized, editedAssets) : null),
    [optimized, editedAssets]
  );

  const patchEditedAssets = useCallback(
    (patch: Partial<EditableOptimizationAssetsState>) => {
      setEditedAssets((prev) => ({ ...prev, ...patch }));
    },
    []
  );

  const displayUrl = resolveDisplayHost(websiteUrl, businessName);
  const isBusy = loading || regenerating || campaignSwitching;
  const selectedCampaign = campaigns.find((c) => c.id === selectedCampaignId) ?? initialCampaign;
  const isAdScoped = !!initialAd;
  const isCampaignScoped = lockCampaignScope && !initialAd && !!selectedCampaign;
  const scopeMode: 'ad' | 'campaign' = isAdScoped ? 'ad' : 'campaign';
  const competitorGalleryItems = useMemo(
    () => buildCompetitorGalleryItems(competitorAnalysis),
    [competitorAnalysis]
  );
  const primaryServiceForCompetitors = initialAd
    ? requestedService?.trim() || inferServiceFromAd(initialAd).primaryService
    : undefined;
  const campaignServices = useMemo(
    () => (selectedCampaign ? deriveCampaignServices(selectedCampaign) : []),
    [selectedCampaign]
  );
  const activeCampaignType = initialCampaign?.type ?? selectedCampaign?.type ?? '';
  const isPmaxScope = /PERFORMANCE_MAX/i.test(activeCampaignType);
  const scenarioLabel =
    scenario === 'REPLACE_EXISTING'
      ? 'Optimize Existing Ads'
      : scenario === 'CREATE_ADS'
        ? isPmaxScope
          ? 'Create PMax Assets'
          : 'Create Ads In Campaign'
        : 'New Campaign Strategy';

  const handleToneClick = (toneId: OptimizationTone) => {
    const variation: OptimizationVariation | undefined =
      toneId === 'shorter' ? 'shorter'
        : toneId === 'aggressive' ? 'aggressive-cta'
          : 'regenerate';
    void runOptimization(toneId, variation, undefined, true, resolveCampaignKey());
  };

  const handleModeClick = (modeId: OptimizationMode) => {
    if (modeId === activeMode) return;
    void runOptimization(activeTone, 'regenerate', undefined, true, resolveCampaignKey(), modeId);
  };

  const stepUnlocked: Record<MakeItBetterStepId, boolean> = {
    ad: true,
    competitors: !!(originalAd || competitorAnalysis || optimized || isBusy),
    recommendation: !!(optimized || (isBusy && (originalAd || competitorAnalysis))),
    review: !!optimized,
  };

  useEffect(() => {
    if (!open) {
      setWorkflowStep('ad');
      setPauseExistingAd(false);
      return;
    }
    if (isAdScoped) setActiveMode('aggressive');
  }, [open, isAdScoped]);

  useEffect(() => {
    if (!open) return;
    if (optimized) {
      // Stay on review if already there; otherwise land on recommendation when AI finishes
      setWorkflowStep((prev) => (prev === 'review' ? prev : 'recommendation'));
    } else if (competitorAnalysis && !originalAd) {
      setWorkflowStep('competitors');
    } else if (originalAd && !competitorAnalysis) {
      setWorkflowStep('ad');
    } else if (originalAd && competitorAnalysis && !optimized) {
      setWorkflowStep((prev) => (prev === 'ad' ? 'competitors' : prev));
    }
  }, [open, optimized, competitorAnalysis, originalAd]);

  const publishValidation = [
    {
      id: 'campaign',
      label: 'Campaign valid',
      ok: !!(selectedCampaign?.id || originalAd?.campaignName || resolveCampaignKey()),
      detail: selectedCampaign?.name ?? originalAd?.campaignName,
    },
    {
      id: 'adgroup',
      label: 'Ad group valid',
      ok: !!(originalAd?.adGroupName || initialAd?.adGroupName),
      detail: originalAd?.adGroupName ?? initialAd?.adGroupName,
    },
    {
      id: 'headlines',
      label: 'Headlines valid',
      ok:
        editedHeadlines.filter((h) => h.trim()).length >= 3 &&
        editedHeadlines.every((h) => h.length <= 30),
      detail: `${editedHeadlines.filter((h) => h.trim()).length} headlines (max 30 chars)`,
    },
    {
      id: 'descriptions',
      label: 'Descriptions valid',
      ok:
        editedDescriptions.filter((d) => d.trim()).length >= 2 &&
        editedDescriptions.every((d) => d.length <= 90) &&
        editedDescriptions.filter((d) => d.trim()).every((d) => /[.!?]$/.test(d.trim())),
      detail: `${editedDescriptions.filter((d) => d.trim()).length} descriptions (max 90 chars, complete sentences)`,
    },
    {
      id: 'finalUrl',
      label: 'Final URL valid',
      ok: !!(finalUrlApproved && (reviewFinalUrl.trim() || originalAd?.finalUrls?.[0] || websiteUrl)),
      detail: (reviewFinalUrl || originalAd?.finalUrls?.[0]) ?? websiteUrl,
    },
    {
      id: 'tracking',
      label: 'Tracking preserved',
      ok: true,
      detail: 'Existing tracking template / suffix kept by default',
    },
    {
      id: 'ready',
      label: 'Ready to publish',
      ok: !!optimizationId && !!optimized,
    },
  ];

  if (!open) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[100] bg-navy/95 backdrop-blur-md flex flex-col min-h-0"
      >
        {/* Header */}
        <div className="shrink-0 border-b border-orange/20 bg-gradient-to-r from-orange/10 via-purple-500/5 to-teal/10 px-4 sm:px-6 py-4">
          <div className="max-w-5xl mx-auto flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-11 h-11 rounded-xl bg-orange/15 border border-orange/30 flex items-center justify-center shrink-0">
                <Sparkles className="text-orange" size={20} />
              </div>
              <div className="min-w-0">
                <h2 className="text-white font-bold text-lg truncate">Make It Better</h2>
                <p className="text-muted text-xs truncate">
                  {isAdScoped
                    ? 'Optimize one ad · service-scoped competitors'
                    : isCampaignScoped
                      ? 'Optimize whole campaign · generalized recommendations'
                      : 'AI ad optimization · Google Ads'}
                </p>
              </div>
              {scenario && !loading && (
                <span className={clsx(
                  'hidden md:inline shrink-0 px-2.5 py-1 rounded-full text-[10px] font-semibold border',
                  scenario === 'REPLACE_EXISTING'
                    ? 'border-orange/40 text-orange bg-orange/10'
                    : scenario === 'CREATE_ADS'
                      ? 'border-teal/40 text-teal bg-teal/10'
                      : 'border-purple-400/40 text-purple-300 bg-purple-500/10'
                )}>
                  {scenarioLabel}
                </span>
              )}
            </div>
            <button type="button" onClick={onClose} className="text-muted hover:text-white p-2 rounded-lg hover:bg-panel transition-colors shrink-0">
              <X size={22} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto relative min-h-0">
          {(loading || campaignsLoading || isBusy) && !originalAd && !competitorAnalysis && !optimized && (
            <AIThinkingLoader progress={liveProgress} stage={liveStage} />
          )}

          {error && !optimized && !isBusy && (
            <div className="max-w-2xl mx-auto p-8">
              <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-5 flex gap-3">
                <AlertTriangle className="text-red-400 shrink-0" size={22} />
                <div>
                  <p className="text-red-300 text-sm">{error}</p>
                  <Button variant="outline" size="sm" className="mt-3" onClick={() => void runOptimization()}>
                    <RefreshCw size={14} /> Try Again
                  </Button>
                </div>
              </div>
            </div>
          )}

          {!loading && !campaignsLoading && !isBusy && !optimized && !error && !originalAd && !competitorAnalysis && (
            <div className="max-w-2xl mx-auto p-8 text-center">
              <p className="text-muted text-sm mb-4">No optimization results yet.</p>
              <Button variant="outline" size="sm" onClick={() => void runOptimization()}>
                <RefreshCw size={14} /> Generate optimization
              </Button>
            </div>
          )}

          {(optimized || originalAd || competitorAnalysis) && (
            <OptimizationErrorBoundary onReset={() => void runOptimization(activeTone, 'regenerate', undefined, true, resolveCampaignKey())}>
            <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-5 relative">
              <MakeItBetterScopeBar
                mode={scopeMode}
                campaign={selectedCampaign}
                adHeadline={initialAd?.headlines[0]}
                adGroupName={initialAd?.adGroupName ?? originalAd?.adGroupName}
                service={primaryServiceForCompetitors}
              />
              <MakeItBetterStepNav
                active={workflowStep}
                onChange={setWorkflowStep}
                unlocked={stepUnlocked}
                scope={scopeMode}
              />
              {(loading || regenerating || campaignSwitching) && (
                <div className="sticky top-0 z-20 -mt-2 mb-2">
                  <div className="bg-navy/95 border border-orange/30 rounded-xl shadow-lg shadow-orange/5">
                    <AIThinkingLoader
                      compact
                      progress={liveProgress}
                      stage={liveStage}
                    />
                  </div>
                </div>
              )}
              {error && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 flex gap-2 text-red-300 text-sm">
                  <AlertTriangle size={18} className="shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}
              {campaignSwitching && !optimized && (
                <div className="absolute inset-0 z-10 bg-navy/70 backdrop-blur-sm rounded-xl flex items-center justify-center">
                  <div className="flex items-center gap-3 text-orange">
                    <RefreshCw size={20} className="animate-spin" />
                    <span className="text-sm font-medium">Analyzing campaign…</span>
                  </div>
                </div>
              )}
              {regenerating && !optimized && (
                <div className="absolute inset-0 z-10 bg-navy/70 backdrop-blur-sm rounded-xl flex items-center justify-center">
                  <div className="flex items-center gap-3 text-orange">
                    <RefreshCw size={20} className="animate-spin" />
                    <span className="text-sm font-medium">Regenerating ad copy…</span>
                  </div>
                </div>
              )}
              {/* Intelligence bar */}
              {intelligenceSummary && workflowStep === 'ad' && (
                <div className="flex flex-wrap gap-3 items-center bg-panel border border-border rounded-xl p-4">
                  <Brain className="text-orange shrink-0" size={18} />
                  <span className="text-muted text-xs">
                    Brand: <strong className="text-white">{businessName}</strong>
                    {websiteUrl && <> · <span className="text-teal">{displayUrl}</span></>}
                    {' · '}Analyzed <strong className="text-white">{intelligenceSummary.findingsAnalyzed}</strong> findings
                    · {intelligenceSummary.campaignsLoaded} campaigns
                    · {intelligenceSummary.keywordsLoaded} keywords
                    · {intelligenceSummary.searchTermsLoaded} search terms
                    · {intelligenceSummary.adsFound} ads
                    · {intelligenceSummary.devicesLoaded ?? 0} device
                    · {intelligenceSummary.audiencesLoaded ?? 0} audiences
                    · <span className={dataSource === 'live' ? 'text-teal' : 'text-orange'}>{dataSource === 'live' ? 'Live Google Ads data' : 'Audit data'}</span>
                  </span>
                </div>
              )}

              {workflowStep === 'ad' && optimized && (
                <StrategistEnhancementPanels
                  analysisSources={analysisSources}
                  optimized={optimized}
                  competitorAnalysis={competitorAnalysis}
                  campaignPerformance={campaignPerformance}
                  selectedCampaign={selectedCampaign}
                  auditHealthScore={auditHealthScore}
                    primaryService={primaryServiceForCompetitors}
                />
              )}

              {/* STEP 1 — Context */}
              {(workflowStep === 'ad' || (!stepUnlocked.competitors && !stepUnlocked.recommendation)) && (
                <>
                  {isCampaignScoped && selectedCampaign ? (
                    <CampaignContextSection
                      campaign={selectedCampaign}
                      services={campaignServices}
                    />
                  ) : null}
                  {originalAd && !isCampaignScoped && (
                    <CurrentAdSection
                      originalAd={originalAd}
                      displayUrl={displayUrl}
                      finalUrl={originalAd?.finalUrls?.[0] ?? websiteUrl}
                      previewDevice={previewDevice}
                      onDeviceChange={setPreviewDevice}
                      title={
                        scenario === 'REPLACE_EXISTING'
                          ? 'Current ad'
                          : scenario === 'CREATE_STRATEGY'
                            ? 'No campaign yet'
                            : scenario === 'CREATE_ADS'
                              ? isPmaxScope
                                ? 'No PMax assets yet'
                                : 'Campaign — no ads'
                              : 'Current ad'
                      }
                    />
                  )}
                  {originalAd && isCampaignScoped && selectedCampaign?.adCount ? (
                    <p className="text-muted text-xs px-1">
                      Baseline copy below is representative campaign performance — generated RSA is
                      generalized for the campaign, not tied to one ad ID.
                    </p>
                  ) : null}
                  {originalAd && isCampaignScoped && (
                    <CurrentAdSection
                      originalAd={originalAd}
                      displayUrl={displayUrl}
                      finalUrl={originalAd?.finalUrls?.[0] ?? websiteUrl}
                      previewDevice={previewDevice}
                      onDeviceChange={setPreviewDevice}
                      title="Representative ad (baseline)"
                    />
                  )}
                  <WhyImproveThisAd
                    originalAd={originalAd}
                    competitorAnalysis={competitorAnalysis}
                    optimized={optimized}
                    findings={auditFindings}
                  />
                  {stepUnlocked.competitors && (
                    <div className="flex justify-end pt-1">
                      <Button size="sm" onClick={() => setWorkflowStep('competitors')}>
                        Continue to competitors
                      </Button>
                    </div>
                  )}
                </>
              )}

              {/* STEP 2 — Competitors */}
              {workflowStep === 'competitors' && competitorAnalysis && (
                <>
                  <div className="bg-panel border border-border rounded-xl p-4 text-xs text-muted">
                    Competitor source:{' '}
                    <span className="text-white font-medium">
                      {competitorDiscoveryMode === 'uploaded_only'
                        ? 'My competitors'
                        : competitorDiscoveryMode === 'auto'
                          ? 'AI discovered'
                          : competitorUrls?.length || competitorNames?.length || competitorEntries?.length
                            ? 'My competitors + AI discovery'
                            : 'AI discovered'}
                    </span>
                    {initialAd && (
                      <>
                        {' '}
                        · service{' '}
                        <span className="text-teal">{primaryServiceForCompetitors}</span>
                      </>
                    )}
                  </div>
                  <CompetitorIntelligenceDashboard competitorAnalysis={competitorAnalysis} />
                  <CompetitorAdGallery
                    competitors={competitorGalleryItems}
                    previewDevice={previewDevice}
                    onDeviceChange={setPreviewDevice}
                    source={competitorAnalysis?.source}
                    primaryService={primaryServiceForCompetitors}
                  />
                  <CompetitorGapAnalysisTable
                    gapAnalysis={competitorAnalysis?.gapAnalysis}
                    competitorAnalysis={competitorAnalysis}
                  />
                  <div className="flex justify-between gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setWorkflowStep('ad')}>
                      Back to {isCampaignScoped ? 'campaign' : 'ad'}
                    </Button>
                    {stepUnlocked.recommendation && (
                      <Button size="sm" onClick={() => setWorkflowStep('recommendation')}>
                        Continue to AI Recommendation
                      </Button>
                    )}
                  </div>
                </>
              )}

              {workflowStep === 'competitors' && !competitorAnalysis && (
                <div className="bg-panel border border-orange/25 rounded-xl p-4 text-sm text-muted">
                  Waiting for competitor intelligence…
                </div>
              )}

              {optimized && workflowStep === 'recommendation' ? (
                <>
              {/* Campaign scope + custom AI prompt */}
              <div className="grid lg:grid-cols-2 gap-4">
                <div className="bg-panel border border-border rounded-xl p-4 space-y-2">
                  <label htmlFor="campaign-select" className="text-muted text-xs uppercase tracking-wider block">
                    {lockCampaignScope ? 'Optimizing this campaign' : 'Campaign scope (whole account audit)'}
                  </label>
                  {lockCampaignScope && selectedCampaign ? (
                    <div className="w-full bg-navy border border-orange/30 rounded-lg px-3 py-2 text-sm text-white space-y-1">
                      <div>
                        {selectedCampaign.name}
                        <span className="text-muted text-xs ml-2">({selectedCampaign.status})</span>
                      </div>
                      {initialAd ? (
                        <div className="text-[11px] text-teal border-t border-border/40 pt-1.5 mt-1">
                          Ad-level: {primaryServiceForCompetitors}
                          <span className="text-muted block mt-0.5 truncate">
                            {initialAd.headlines[0] ?? initialAd.adGroupName}
                          </span>
                          <span className="text-muted block">
                            {competitorDiscoveryMode === 'uploaded_only'
                              ? 'Using only competitors you confirmed.'
                              : competitorDiscoveryMode === 'auto'
                                ? 'Auto-discovering competitors for this ad’s service.'
                                : competitorUrls?.length || competitorNames?.length || competitorEntries?.length
                                  ? 'Your confirmed competitors plus AI discovery.'
                                  : 'No document uploaded — discovering competitors for this service automatically.'}
                          </span>
                        </div>
                      ) : (
                        <div className="text-[11px] text-orange border-t border-border/40 pt-1.5 mt-1">
                          Campaign-level · generalized RSA and strategy across services in this
                          campaign
                          {campaignServices.length > 0 && (
                            <span className="text-muted block mt-0.5">
                              Services: {campaignServices.join(', ')}
                            </span>
                          )}
                          <span className="text-muted block mt-0.5">
                            Competitors are discovered for the campaign mix — not locked to one ad.
                          </span>
                        </div>
                      )}
                    </div>
                  ) : (
                  <select
                    id="campaign-select"
                    value={selectedCampaignId}
                    onChange={(e) => handleCampaignChange(e.target.value)}
                    disabled={campaignsLoading || isBusy}
                    className="w-full bg-navy border border-border rounded-lg px-3 py-2 text-sm text-white focus:border-orange/40 outline-none"
                  >
                    <option value="">All campaigns (account-wide)</option>
                    {campaigns.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.status})
                      </option>
                    ))}
                  </select>
                  )}
                  <p className="text-muted text-[10px]">
                    {lockCampaignScope && selectedCampaign
                      ? initialAd
                        ? `Improving this ${primaryServiceForCompetitors} ad.`
                        : selectedCampaign.adCount > 0
                          ? `Generalized improvements for ${selectedCampaign.name} (${selectedCampaign.adCount} ads).`
                          : isPmaxScope
                            ? `No responsive search ads in this Performance Max campaign — AI will recommend asset group copy and strategy.`
                            : `No ads in this campaign yet — AI will recommend new ad copy and structure.`
                      : campaignsLoading
                      ? 'Loading campaigns from Google Ads…'
                      : campaigns.length
                        ? `${campaigns.length} campaign${campaigns.length === 1 ? '' : 's'} found — select one to optimize, or keep account-wide.`
                        : 'No campaigns in this account — AI will propose a new campaign strategy.'}
                  </p>
                  {selectedCampaignId && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={isBusy}
                      onClick={() => void runOptimization('default', 'regenerate', undefined, true, resolveCampaignKey())}
                    >
                      <RefreshCw size={14} /> Regenerate for campaign
                    </Button>
                  )}
                </div>

                <div className="bg-panel border border-purple-400/20 rounded-xl overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setRefineOpen((o) => !o)}
                    className="w-full flex items-center justify-between gap-2 px-4 py-3 text-left hover:bg-navy/40 transition-colors"
                  >
                    <span className="text-purple-300 text-xs uppercase tracking-wider flex items-center gap-1.5">
                      <Sparkles size={12} /> Refine generation
                    </span>
                    {refineOpen ? (
                      <ChevronDown size={16} className="text-muted shrink-0" />
                    ) : (
                      <ChevronRight size={16} className="text-muted shrink-0" />
                    )}
                  </button>
                  {refineOpen && (
                    <div className="px-4 pb-4 space-y-2 border-t border-border/60">
                      <label htmlFor="custom-prompt" className="text-muted text-[10px] uppercase tracking-wider block pt-3">
                        Custom AI instructions
                      </label>
                      <textarea
                        id="custom-prompt"
                        value={customPrompt}
                        onChange={(e) => setCustomPrompt(e.target.value)}
                        placeholder="e.g. Add sitelink 'Commercial Rates' → /rates. Add negative keyword 'residential'. Focus keywords on commercial mortgage broker Melbourne."
                        rows={3}
                        className="w-full bg-navy border border-border rounded-lg px-3 py-2 text-xs text-white placeholder:text-muted focus:border-purple-400/40 outline-none resize-none"
                      />
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={isBusy || !customPrompt.trim()}
                        onClick={() => {
                          setWorkflowStep('recommendation');
                          void runOptimization(
                            activeTone,
                            'regenerate',
                            customPrompt.trim(),
                            true,
                            resolveCampaignKey()
                          );
                        }}
                      >
                        <Sparkles size={14} />
                        {regenerating && customPrompt.trim()
                          ? 'Applying instructions…'
                          : 'Apply custom instructions'}
                      </Button>
                      <p className="text-[10px] text-muted">
                        Applies to headlines, descriptions, sitelinks, callouts, structured snippets, keywords, and
                        negative keywords on regenerate.
                      </p>
                    </div>
                  )}
                </div>
              </div>

              <div className="rounded-2xl border border-border bg-panel/50 overflow-hidden">
                <button
                  type="button"
                  onClick={() => setRefineOpen((o) => !o)}
                  className="w-full flex items-center justify-between gap-2 px-4 py-3 md:hidden text-left"
                >
                  <span className="text-muted text-xs uppercase tracking-wider">Tone, mode & regenerate</span>
                  {refineOpen ? <ChevronDown size={16} className="text-muted" /> : <ChevronRight size={16} className="text-muted" />}
                </button>
                <div className={clsx('px-4 pb-4 space-y-4', !refineOpen && 'hidden md:block')}>
              {/* Optimization mode */}
              <div className="space-y-2 pt-2 md:pt-0">
                <p className="text-muted text-xs uppercase tracking-wider">Optimization Mode</p>
                <div className="flex flex-wrap gap-2">
                  {MODE_OPTIONS.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      disabled={isBusy}
                      onClick={() => handleModeClick(m.id)}
                      title={m.desc}
                      className={clsx(
                        'px-3 py-1.5 rounded-full text-xs font-medium border transition-colors disabled:opacity-50',
                        activeMode === m.id
                          ? 'border-purple-400/50 bg-purple-500/15 text-purple-300'
                          : 'border-border bg-navy text-muted hover:text-white hover:border-purple-400/40'
                      )}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
                <p className="text-muted text-[11px]">
                  {MODE_OPTIONS.find((m) => m.id === activeMode)?.desc}
                </p>
              </div>

              {/* Tone controls */}
              <div className="flex flex-wrap gap-2">
                {TONE_OPTIONS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    disabled={isBusy}
                    onClick={() => handleToneClick(t.id)}
                    className={clsx(
                      'px-3 py-1.5 rounded-full text-xs font-medium border transition-colors disabled:opacity-50',
                      activeTone === t.id
                        ? 'border-orange/50 bg-orange/15 text-orange'
                        : 'border-border bg-navy text-muted hover:text-white hover:border-orange/40'
                    )}
                  >
                    {t.label}
                  </button>
                ))}
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => void runOptimization(activeTone, 'regenerate', undefined, true, resolveCampaignKey())}
                  className="px-3 py-1.5 rounded-full text-xs font-medium border border-orange/30 bg-orange/10 text-orange flex items-center gap-1 disabled:opacity-50"
                >
                  <RefreshCw size={12} className={regenerating ? 'animate-spin' : ''} /> Regenerate
                </button>
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => setEditMode((e) => !e)}
                  className={clsx(
                    'px-3 py-1.5 rounded-full text-xs font-medium border flex items-center gap-1 disabled:opacity-50',
                    editMode ? 'border-teal/40 text-teal bg-teal/10' : 'border-border text-muted hover:text-white'
                  )}
                >
                  <Edit3 size={12} /> Edit Manually
                </button>
              </div>
                </div>
              </div>

              {/* AI estimated opportunity — not guarantees */}
              <div className="grid sm:grid-cols-3 gap-3">
                <p className="sm:col-span-3 text-[10px] uppercase tracking-wider text-muted">
                  AI Estimated Opportunity · estimates only — not guaranteed improvements
                </p>
                {[
                  {
                    label: 'CTR',
                    current: originalAd?.ctr != null ? `${originalAd.ctr}%` : '—',
                    potential: 'Higher',
                    icon: TrendingUp,
                    color: 'text-teal',
                  },
                  {
                    label: 'CPA',
                    current:
                      originalAd && 'costPerConversion' in (originalAd as object)
                        ? 'See account'
                        : '—',
                    potential: 'Lower',
                    icon: Zap,
                    color: 'text-orange',
                  },
                  {
                    label: 'Conversion Rate',
                    current: '—',
                    potential: 'Higher',
                    icon: Sparkles,
                    color: 'text-purple-400',
                  },
                ].map((m) => (
                  <div key={m.label} className="bg-panel border border-border rounded-xl p-4 text-center">
                    <m.icon className={`${m.color} mx-auto mb-2`} size={18} />
                    <div className="text-muted text-[10px]">Current: {m.current}</div>
                    <div className={`font-bold text-lg ${m.color}`}>Potential: {m.potential}</div>
                    <div className="text-muted text-[10px] uppercase tracking-wider mt-1">{m.label}</div>
                  </div>
                ))}
                <p className="sm:col-span-3 text-[10px] text-muted">
                  Based on historical account data, competitor benchmarks, keyword relevance, messaging improvements, and
                  landing-page relevance — not guarantees.
                </p>
              </div>

              {optimized.adDifferenceScore != null && (
                <div
                  className={clsx(
                    'rounded-xl border p-4 space-y-2',
                    optimized.adDifferenceScore < 85
                      ? 'border-amber-400/40 bg-amber-400/10'
                      : 'border-teal/30 bg-teal/5'
                  )}
                >
                  <p className="text-white font-semibold text-sm">AI Differentiation · {optimized.adDifferenceScore}/100</p>
                  <p className="text-muted text-xs">
                    Target 90+ — the new ad must look clearly different from your current ad side-by-side.
                  </p>
                  <div className="grid sm:grid-cols-5 gap-2 text-[10px] text-muted">
                    <span>Messaging</span>
                    <span>Keywords</span>
                    <span>Value prop</span>
                    <span>CTA</span>
                    <span>vs Competitors</span>
                  </div>
                  {optimized.adDifferenceScore < 85 && (
                    <>
                      <p className="text-amber-200 text-xs">
                        WARNING: The generated ad is too similar to the current ad. Regenerate for a stronger alternative.
                      </p>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={isBusy}
                        onClick={() =>
                          void runOptimization(activeTone, 'aggressive-cta', undefined, true, resolveCampaignKey())
                        }
                      >
                        <RefreshCw size={14} /> Generate Stronger Alternative
                      </Button>
                    </>
                  )}
                </div>
              )}

              {competitorGalleryItems.length > 0 && (
                <section className="space-y-3">
                  <h3 className="text-white text-sm font-semibold">Competitor ads used for this RSA</h3>
                  <p className="text-muted text-[11px]">
                    Live competitor creatives matched to your service.
                  </p>
                  <CompetitorAdGallery
                    competitors={competitorGalleryItems}
                    previewDevice={previewDevice}
                    onDeviceChange={setPreviewDevice}
                    source={competitorAnalysis?.source}
                    primaryService={primaryServiceForCompetitors}
                  />
                </section>
              )}

              {/* Side-by-side current vs AI */}
              <AdCopyPicker
                options={adCopyOptions}
                selectedId={selectedCopyId}
                onSelect={selectAdCopy}
                title="Select which AI ad to use"
                subtitle="Pick primary or a competitor-inspired variation. Preview and publish use the selected copy."
              />

              <div className="grid lg:grid-cols-2 gap-4">
                {originalAd && (
                  <CurrentAdSection
                    originalAd={originalAd}
                    displayUrl={displayUrl}
                    finalUrl={originalAd?.finalUrls?.[0] ?? websiteUrl}
                    previewDevice={previewDevice}
                    onDeviceChange={setPreviewDevice}
                    title="Current Ad"
                  />
                )}
                <AIOptimizedSection
                  key={`optimized-${optimizationVersion}-${selectedCopyId}`}
                  optimized={previewOptimized ?? optimized}
                  headlines={editedHeadlines}
                  descriptions={editedDescriptions}
                  displayUrl={displayUrl}
                  finalUrl={originalAd?.finalUrls?.[0] ?? websiteUrl}
                  previewDevice={previewDevice}
                  onDeviceChange={setPreviewDevice}
                  adCopyOptions={adCopyOptions}
                  selectedCopyId={selectedCopyId}
                  onSelectCopy={selectAdCopy}
                />
              </div>

              <WhyThisAdWasGenerated optimized={optimized} />

              {/* Manual edit — headlines & descriptions (assets/keywords always editable below) */}
              {editMode && (
                <div className="grid lg:grid-cols-2 gap-4 bg-navy/50 border border-border rounded-xl p-4">
                  <div className="space-y-2 max-h-52 overflow-y-auto">
                    <p className="text-muted text-xs uppercase">Headlines (max 30 chars)</p>
                    {editedHeadlines.map((h, i) => (
                      <input key={i} value={h} onChange={(e) => setEditedHeadlines((p) => p.map((x, j) => (j === i ? e.target.value : x)))} maxLength={30} className="w-full bg-panel border border-border rounded-lg px-3 py-2 text-xs text-white focus:border-teal/50 outline-none" />
                    ))}
                  </div>
                  <div className="space-y-2 max-h-52 overflow-y-auto">
                    <p className="text-muted text-xs uppercase">Descriptions (max 90 chars)</p>
                    {editedDescriptions.map((d, i) => (
                      <textarea key={i} value={d} onChange={(e) => setEditedDescriptions((p) => p.map((x, j) => (j === i ? e.target.value : x)))} maxLength={90} rows={2} className="w-full bg-panel border border-border rounded-lg px-3 py-2 text-xs text-white focus:border-teal/50 outline-none resize-none" />
                    ))}
                  </div>
                </div>
              )}

              {optimized && (
                <div className="bg-panel border border-border rounded-xl p-4">
                  <EditableOptimizationAssets
                    sitelinks={editedAssets.sitelinks}
                    callouts={editedAssets.callouts}
                    structuredSnippets={editedAssets.structuredSnippets}
                    keywords={editedAssets.keywords}
                    negativeKeywords={editedAssets.negativeKeywords}
                    onSitelinksChange={(next) => patchEditedAssets({ sitelinks: next })}
                    onCalloutsChange={(next) => patchEditedAssets({ callouts: next })}
                    onStructuredSnippetsChange={(next) => patchEditedAssets({ structuredSnippets: next })}
                    onKeywordsChange={(next) => patchEditedAssets({ keywords: next })}
                    onNegativeKeywordsChange={(next) => patchEditedAssets({ negativeKeywords: next })}
                    disabled={isBusy}
                  />
                </div>
              )}

              {publishResultData && !showPublishConfirm && (
                <div className="bg-teal/10 border border-teal/30 rounded-xl p-4 text-teal text-sm flex items-center justify-between gap-4">
                  <span>{publishResultData.message}</span>
                  {rollbackAvailable && publishedId && (
                    <Button variant="outline" size="sm" loading={rollingBack} onClick={() => void handleRollback()}>
                      <RotateCcw size={14} /> Rollback
                    </Button>
                  )}
                </div>
              )}
              <div className="flex justify-between gap-2">
                <Button variant="ghost" size="sm" onClick={() => setWorkflowStep('competitors')}>
                  Back to Competitors
                </Button>
                <Button size="sm" onClick={() => setWorkflowStep('review')}>
                  Continue to Review &amp; Publish
                </Button>
              </div>

              {workflowStep === 'recommendation' && (
                <p className="text-muted text-xs text-center pb-2">
                  Client review, Google Ads settings, and publish approval are on the next step — nothing is changed in
                  your account until you approve.
                </p>
              )}
                </>
              ) : workflowStep === 'recommendation' && !optimized ? (
                (loading || isBusy) && (originalAd || competitorAnalysis) && (
                  <div className="bg-panel border border-orange/25 rounded-xl p-4 text-sm text-muted">
                    Still generating the AI Optimized Ad from competitor insights — live sections above update as they finish.
                  </div>
                )
              ) : null}

              {/* STEP 4 — Review & Publish */}
              {workflowStep === 'review' && optimized && (
                <div className="space-y-4">
                  <div className="bg-panel border border-border rounded-xl p-4 text-sm text-muted space-y-1">
                    <p className="text-white font-semibold text-xs uppercase tracking-wider">What will change in Google Ads</p>
                    <p>
                      A new RSA will be created in{' '}
                      <span className="text-white">{selectedCampaign?.name ?? originalAd?.campaignName ?? 'the selected campaign'}</span>
                      {pauseExistingAd
                        ? '. The existing ad will be paused (not deleted).'
                        : '. The existing ad stays active (default).'}
                    </p>
                    <p className="text-[11px]">
                      Campaign-level suggestions (budget, bidding, keywords, etc.) remain recommendations only — not applied
                      from this publish.
                    </p>
                  </div>

                  {/* Content the client is approving — always visible on Review */}
                  <div className="bg-panel border border-teal/30 rounded-2xl p-5 space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-white font-semibold">Content you&apos;re approving</h3>
                      <span className="text-[10px] uppercase tracking-wider text-teal">
                        Ready to publish · {editedHeadlines.filter((h) => h.trim()).length} headlines ·{' '}
                        {editedDescriptions.filter((d) => d.trim()).length} descriptions
                      </span>
                    </div>

                    <AdCopyPicker
                      options={adCopyOptions}
                      selectedId={selectedCopyId}
                      onSelect={selectAdCopy}
                      title="Select the ad to publish"
                      subtitle="Choose one of up to 4 AI copies. Only the selected version is published to Google Ads."
                    />

                    <div className="grid sm:grid-cols-2 gap-3 text-xs">
                      <div className="rounded-lg border border-border bg-navy/40 px-3 py-2">
                        <p className="text-muted text-[10px] uppercase tracking-wider">Campaign</p>
                        <p className="text-white mt-0.5">
                          {selectedCampaign?.name ?? originalAd?.campaignName ?? '—'}
                        </p>
                      </div>
                      <div className="rounded-lg border border-border bg-navy/40 px-3 py-2">
                        <p className="text-muted text-[10px] uppercase tracking-wider">Ad group</p>
                        <p className="text-white mt-0.5">
                          {originalAd?.adGroupName ?? initialAd?.adGroupName ?? '—'}
                        </p>
                      </div>
                      <div className="rounded-lg border border-border bg-navy/40 px-3 py-2 sm:col-span-2">
                        <p className="text-muted text-[10px] uppercase tracking-wider">Final URL</p>
                        <p className="text-teal mt-0.5 break-all">
                          {originalAd?.finalUrls?.[0] ?? websiteUrl ?? '—'}
                        </p>
                      </div>
                      {(optimized.displayPaths?.path1 || optimized.displayPaths?.path2) && (
                        <div className="rounded-lg border border-border bg-navy/40 px-3 py-2 sm:col-span-2">
                          <p className="text-muted text-[10px] uppercase tracking-wider">Display path</p>
                          <p className="text-white mt-0.5">
                            /{optimized.displayPaths?.path1 ?? ''}
                            {optimized.displayPaths?.path2 ? `/${optimized.displayPaths.path2}` : ''}
                          </p>
                        </div>
                      )}
                      <div className="rounded-lg border border-orange/30 bg-orange/5 px-3 py-2 sm:col-span-2">
                        <p className="text-muted text-[10px] uppercase tracking-wider">Selected copy</p>
                        <p className="text-orange mt-0.5 font-medium">
                          {adCopyOptions.find((o) => o.id === selectedCopyId)?.label ?? 'Primary'}
                        </p>
                      </div>
                    </div>

                    <AIOptimizedSection
                      key={`review-${optimizationVersion}-${selectedCopyId}`}
                      optimized={previewOptimized ?? optimized}
                      headlines={editedHeadlines}
                      descriptions={editedDescriptions}
                      displayUrl={displayUrl}
                      finalUrl={originalAd?.finalUrls?.[0] ?? websiteUrl}
                      previewDevice={previewDevice}
                      onDeviceChange={setPreviewDevice}
                      adCopyOptions={adCopyOptions}
                      selectedCopyId={selectedCopyId}
                      onSelectCopy={selectAdCopy}
                    />

                    <div className="grid lg:grid-cols-2 gap-4">
                      <div className="rounded-xl border border-border bg-navy/40 p-4 space-y-2 max-h-72 overflow-y-auto">
                        <p className="text-[10px] uppercase tracking-wider text-muted">
                          Headlines ({editedHeadlines.filter((h) => h.trim()).length}/15)
                        </p>
                        {editedHeadlines.filter((h) => h.trim()).length === 0 ? (
                          <p className="text-red-300 text-xs">No headlines — go back to AI Recommendation and regenerate.</p>
                        ) : (
                          editedHeadlines.map((h, i) =>
                            h.trim() ? (
                              <p key={`rh-${i}`} className="text-xs text-white leading-relaxed">
                                <span className="text-teal font-semibold">H{i + 1}:</span> {h}
                                <span className="text-muted ml-1">({h.length}/30)</span>
                              </p>
                            ) : null
                          )
                        )}
                      </div>
                      <div className="rounded-xl border border-border bg-navy/40 p-4 space-y-2 max-h-72 overflow-y-auto">
                        <p className="text-[10px] uppercase tracking-wider text-muted">
                          Descriptions ({editedDescriptions.filter((d) => d.trim()).length}/4)
                        </p>
                        {editedDescriptions.filter((d) => d.trim()).length === 0 ? (
                          <p className="text-red-300 text-xs">No descriptions — go back to AI Recommendation and regenerate.</p>
                        ) : (
                          editedDescriptions.map((d, i) =>
                            d.trim() ? (
                              <p key={`rd-${i}`} className="text-xs text-white leading-relaxed">
                                <span className="text-teal font-semibold">D{i + 1}:</span> {d}
                                <span className="text-muted ml-1">({d.length}/90)</span>
                              </p>
                            ) : null
                          )
                        )}
                      </div>
                    </div>

                    <div className="rounded-xl border border-border bg-navy/40 p-4">
                      <EditableOptimizationAssets
                        sitelinks={editedAssets.sitelinks}
                        callouts={editedAssets.callouts}
                        structuredSnippets={editedAssets.structuredSnippets}
                        keywords={editedAssets.keywords}
                        negativeKeywords={editedAssets.negativeKeywords}
                        onSitelinksChange={(next) => patchEditedAssets({ sitelinks: next })}
                        onCalloutsChange={(next) => patchEditedAssets({ callouts: next })}
                        onStructuredSnippetsChange={(next) => patchEditedAssets({ structuredSnippets: next })}
                        onKeywordsChange={(next) => patchEditedAssets({ keywords: next })}
                        onNegativeKeywordsChange={(next) => patchEditedAssets({ negativeKeywords: next })}
                        disabled={isBusy}
                        compact
                      />
                    </div>

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setWorkflowStep('recommendation')}
                    >
                      Edit headlines &amp; AI instructions
                    </Button>
                  </div>

                  {competitorGalleryItems.length > 0 && (
                    <section className="rounded-xl border border-purple-400/25 bg-purple-400/5 p-4 space-y-3">
                      <h3 className="text-white text-sm font-semibold">Competitor ads</h3>
                      <p className="text-muted text-[11px]">
                        Service-matched rivals used to shape your new RSA — verify these before approving publish.
                      </p>
                      <CompetitorAdGallery
                        competitors={competitorGalleryItems}
                        previewDevice={previewDevice}
                        onDeviceChange={setPreviewDevice}
                        source={competitorAnalysis?.source}
                        primaryService={primaryServiceForCompetitors}
                      />
                    </section>
                  )}

                  <MakeItBetterPublishSections
                    googleAdsCustomerId={googleAdsCustomerId}
                    selectedCampaign={selectedCampaign}
                    originalAd={originalAd}
                    optimized={previewOptimized ?? optimized}
                    scenario={scenario}
                    accountName={businessName}
                    websiteUrl={websiteUrl}
                    headlines={editedHeadlines}
                    descriptions={editedDescriptions}
                    onHeadlinesChange={setEditedHeadlines}
                    onDescriptionsChange={setEditedDescriptions}
                    editedKeywords={editedAssets.keywords}
                    editedNegativeKeywords={editedAssets.negativeKeywords}
                    onKeywordsChange={(next) => patchEditedAssets({ keywords: next })}
                    onNegativeKeywordsChange={(next) => patchEditedAssets({ negativeKeywords: next })}
                    editedSitelinks={editedAssets.sitelinks}
                    editedCallouts={editedAssets.callouts}
                    editedStructuredSnippets={editedAssets.structuredSnippets}
                    onSitelinksChange={(next) => patchEditedAssets({ sitelinks: next })}
                    onCalloutsChange={(next) => patchEditedAssets({ callouts: next })}
                    onStructuredSnippetsChange={(next) => patchEditedAssets({ structuredSnippets: next })}
                    displayPath1={reviewPath1}
                    displayPath2={reviewPath2}
                    onDisplayPathChange={(p1, p2) => {
                      setReviewPath1(p1);
                      setReviewPath2(p2);
                    }}
                    finalUrl={reviewFinalUrl}
                    onFinalUrlChange={setReviewFinalUrl}
                    finalUrlApproved={finalUrlApproved}
                    onFinalUrlApprovedChange={setFinalUrlApproved}
                    onRegenerateHeadline={(index) => {
                      void runOptimization(
                        activeTone,
                        'regenerate',
                        `Regenerate only headline ${index + 1}. Keep all other headlines and descriptions unchanged unless invalid. Current headline to replace: "${editedHeadlines[index] ?? ''}".`,
                        true,
                        resolveCampaignKey()
                      );
                    }}
                    onRegenerateDescription={(index) => {
                      void runOptimization(
                        activeTone,
                        'regenerate',
                        `Regenerate only description ${index + 1}. Keep all headlines and other descriptions unchanged unless invalid. Current description to replace: "${editedDescriptions[index] ?? ''}".`,
                        true,
                        resolveCampaignKey()
                      );
                    }}
                    regenerating={regenerating}
                    validation={publishValidation}
                    canPublish={!!optimizationId && !isBusy}
                    optimizationId={optimizationId}
                    disabled={isBusy || publishing}
                    pauseExistingAd={pauseExistingAd}
                    onPauseExistingAdChange={setPauseExistingAd}
                    oauthConnected={!!googleAdsCustomerId}
                    onCampaignSettingsChange={setPublishCampaignSettings}
                    onApprovePublish={() => {
                      setPublishResultData(null);
                      setPublishError(null);
                      setShowPublishConfirm(true);
                    }}
                  />

                  {optimized.strategistRecommendations && (
                    <details className="bg-panel border border-border rounded-xl p-4">
                      <summary className="text-white text-sm font-semibold cursor-pointer">
                        Campaign-level recommendations (advisory only)
                      </summary>
                      <div className="mt-3 text-xs text-muted space-y-2">
                        {Object.entries(optimized.strategistRecommendations).map(([k, v]) =>
                          Array.isArray(v) && v.length ? (
                            <div key={k}>
                              <p className="text-orange uppercase text-[10px] tracking-wider">{k}</p>
                              <ul className="list-disc pl-4">
                                {v.slice(0, 5).map((item) => (
                                  <li key={String(item)}>{String(item)}</li>
                                ))}
                              </ul>
                            </div>
                          ) : null
                        )}
                      </div>
                    </details>
                  )}
                </div>
              )}
            </div>
            </OptimizationErrorBoundary>
          )}
        </div>

        {/* Footer actions */}
        {optimized && (
          <div className="shrink-0 border-t border-border bg-panel px-6 py-4">
            <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
              <Button variant="ghost" onClick={onClose} disabled={isBusy}>Cancel</Button>
              <div className="flex gap-3">
                <Button variant="secondary" disabled={isBusy} onClick={() => void runOptimization(activeTone, 'regenerate', undefined, true, resolveCampaignKey())}>
                  <RefreshCw size={16} className={regenerating ? 'animate-spin' : ''} /> {regenerating ? 'Regenerating…' : 'Regenerate'}
                </Button>
                <Button
                  disabled={isBusy}
                  onClick={() => setWorkflowStep('review')}
                  className="bg-gradient-to-r from-orange to-orange-2 glow-orange"
                >
                  <Send size={16} /> Review &amp; Publish
                </Button>
              </div>
            </div>
          </div>
        )}

        <PublishWorkflow
          open={showPublishConfirm}
          scenario={scenario}
          campaignName={selectedCampaign?.name ?? originalAd?.campaignName ?? campaignPerformance?.campaignName}
          accountName={businessName}
          googleAdsCustomerId={googleAdsCustomerId}
          adGroupName={originalAd?.adGroupName ?? initialAd?.adGroupName}
          headlineCount={editedHeadlines.filter((h) => h.trim()).length}
          descriptionCount={editedDescriptions.filter((d) => d.trim()).length}
          finalUrl={(reviewFinalUrl || originalAd?.finalUrls?.[0]) ?? websiteUrl}
          publishing={publishing}
          publishResult={publishResultData}
          publishError={publishError}
          rollbackAvailable={rollbackAvailable}
          rollingBack={rollingBack}
          pauseExistingAd={pauseExistingAd}
          dailyBudget={publishCampaignSettings.dailyBudget}
          biddingStrategy={publishCampaignSettings.biddingStrategy}
          targetCpa={publishCampaignSettings.targetCpa}
          onConfirm={() => void handlePublish()}
          onCancel={closePublishWorkflow}
          onClose={closePublishWorkflow}
          onRollback={() => void handleRollback()}
        />
      </motion.div>
    </AnimatePresence>
  );
}
