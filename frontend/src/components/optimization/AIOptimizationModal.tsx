import { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, Sparkles, RefreshCw, TrendingUp, AlertTriangle,
  Zap, Send, RotateCcw, Edit3, Brain,
} from 'lucide-react';
import clsx from 'clsx';
import { Button } from '../ui/Button';
import { AIThinkingLoader } from './AIThinkingLoader';
import { AdPreviewPanel } from './AdPreviewPanel';
import { StrategistEnhancementPanels } from './StrategistEnhancementPanels';
import { TONE_OPTIONS, normalizeRenderableStrings, asDisplayText } from './utils';
import { OptimizationErrorBoundary } from './OptimizationErrorBoundary';
import { PublishWorkflow } from './PublishWorkflow';
import { aiApi, googleAdsApi } from '../../services/api';
import type { Finding } from '../../types';
import type { GoogleAdsCampaign } from '../../types/connect';
import { resolveDisplayHost, resolveBusinessName } from '../../utils/business-identity';
import type {
  CurrentAdData,
  OptimizedAdContent,
  OptimizationTone,
  OptimizationVariation,
  OptimizationScenario,
  PreviewDevice,
  IntelligenceSummary,
  AnalysisSources,
  CampaignPerformanceSummary,
  OptimizeAdResponse,
  PublishAdResponse,
} from '../../types/optimization';

function buildCampaignAccountContext(campaign?: GoogleAdsCampaign | null) {
  if (!campaign) return {};
  const hasAds = campaign.adCount > 0 || campaign.ads.length > 0;
  const primaryAd = campaign.ads?.length
    ? [...campaign.ads].sort((a, b) => b.impressions - a.impressions)[0]
    : undefined;
  return {
    campaignName: campaign.name,
    campaignType: campaign.type,
    campaignStatus: campaign.status,
    biddingStrategyType: campaign.biddingStrategyType,
    hasExistingAds: hasAds,
    adCount: campaign.adCount,
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
        }
      : undefined,
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
    headlines: normalizeRenderableStrings(data.headlines),
    descriptions: normalizeRenderableStrings(data.descriptions),
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
  initialCampaignId?: string;
  initialCampaign?: GoogleAdsCampaign | null;
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
  initialCampaignId,
  initialCampaign = null,
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
  const [regenerating, setRegenerating] = useState(false);
  const [campaignSwitching, setCampaignSwitching] = useState(false);
  const [analysisSources, setAnalysisSources] = useState<AnalysisSources | undefined>();
  const [campaignPerformance, setCampaignPerformance] = useState<CampaignPerformanceSummary | null | undefined>();
  const [auditHealthScore, setAuditHealthScore] = useState<number | undefined>();
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
    setAnalysisSources(data.analysisSources);
    setCampaignPerformance(data.campaignPerformance);
    setAuditHealthScore(data.auditHealthScore);
    setError(null);
  }, []);

  const runOptimization = useCallback(async (
    tone?: OptimizationTone,
    variation?: OptimizationVariation,
    promptOverride?: string,
    isRegenerate = false,
    campaignIdOverride?: string
  ) => {
    if (requestInFlight.current) return;

    const campaignKey = resolveCampaignKey(campaignIdOverride);
    if (isRegenerate) {
      setRegenerating(true);
      optimizationCache.current.delete(campaignKey);
    } else if (optimizationCache.current.has(campaignKey) && !promptOverride) {
      applyOptimizationResponse(optimizationCache.current.get(campaignKey)!);
      return;
    } else if (campaignKey && !isRegenerate && optimized) {
      setCampaignSwitching(true);
    } else {
      setLoading(true);
    }
    if (!isRegenerate) {
      setPublishResultData(null);
      setPublishError(null);
      setPublishedId(null);
      setRollbackAvailable(false);
    }
    const resolvedTone = tone ?? activeTone;
    if (tone) setActiveTone(tone);
    const prompt = promptOverride ?? customPrompt;
    const generation = ++requestGeneration.current;
    requestInFlight.current = true;
    try {
      const campaignMeta = resolveCampaignMeta(campaignKey);
      const { data } = await aiApi.optimizeAd({
        auditId,
        findingId: finding.id,
        tone: resolvedTone,
        variation,
        customPrompt: prompt.trim() || undefined,
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
          campaignId: campaignKey || undefined,
          findingCategory: finding.category,
          findingTitle: finding.title,
          ...buildCampaignAccountContext(campaignMeta),
        },
      });
      if (generation !== requestGeneration.current) return;
      optimizationCache.current.set(campaignKey, data);
      applyOptimizationResponse(data);
    } catch (err) {
      if (generation !== requestGeneration.current) return;
      let message = 'Failed to generate optimizations';
      if (axios.isAxiosError(err)) {
        if (err.code === 'ECONNABORTED') {
          message = 'Optimization timed out — the server is still analyzing a large account. Try again or pick a single campaign.';
        } else if (err.code === 'ECONNRESET' || err.message?.includes('Network Error')) {
          message = isRegenerate
            ? 'Connection lost while regenerating. Your previous results are still shown — wait a moment and try Regenerate again.'
            : 'Connection lost — the server may still be working. Wait a moment and try again.';
        }
        const apiError = (err.response?.data as { error?: string })?.error;
        if (err.response?.status === 404 && apiError === 'Not found') {
          message = 'AI API unavailable — restart backend with npm run dev.';
        } else if (err.response?.status === 401) {
          message = 'Sign in with Google to optimize and publish ads.';
        } else if (apiError) {
          message = apiError;
        } else if (!err.code) {
          message = err.message;
        }
      }
      setError(message);
    } finally {
      requestInFlight.current = false;
      if (generation !== requestGeneration.current) return;
      setLoading(false);
      setRegenerating(false);
      setCampaignSwitching(false);
    }
  }, [auditId, finding, auditFindings, businessName, goal, monthlySpend, googleAdsCustomerId, websiteUrl, userId, customPrompt, activeTone, applyOptimizationResponse, resolveCampaignKey, resolveCampaignMeta, optimized]);

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
    const cached = optimizationCache.current.get(campaignId);
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
        content: {
          headlines: editedHeadlines,
          descriptions: editedDescriptions,
          displayPaths: optimized?.displayPaths,
          finalUrl: originalAd?.finalUrls?.[0] ?? websiteUrl,
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

  const openPublishWorkflow = () => {
    setPublishResultData(null);
    setPublishError(null);
    setShowPublishConfirm(true);
  };

  const closePublishWorkflow = () => {
    setShowPublishConfirm(false);
    if (!publishing) {
      setPublishError(null);
    }
  };

  const displayUrl = resolveDisplayHost(websiteUrl, businessName);
  const isBusy = loading || regenerating || campaignSwitching;
  const selectedCampaign = campaigns.find((c) => c.id === selectedCampaignId) ?? initialCampaign;
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
        <div className="shrink-0 border-b border-orange/20 bg-gradient-to-r from-orange/10 via-purple-500/5 to-teal/10 px-6 py-4">
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-orange/15 border border-orange/30 flex items-center justify-center">
                <Sparkles className="text-orange" size={22} />
              </div>
              <div>
                <h2 className="text-white font-bold text-xl">AI Campaign Optimizer</h2>
                <p className="text-muted text-sm">Make It Better · Google Ads Strategist powered by Claude</p>
              </div>
              {scenario && !loading && (
                <span className={clsx(
                  'ml-4 px-3 py-1 rounded-full text-xs font-semibold border',
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
            <button type="button" onClick={onClose} className="text-muted hover:text-white p-2 rounded-lg hover:bg-panel transition-colors">
              <X size={22} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto relative min-h-0">
          {(loading || campaignsLoading || isBusy) && !optimized && <AIThinkingLoader />}

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

          {!loading && !campaignsLoading && !isBusy && !optimized && !error && (
            <div className="max-w-2xl mx-auto p-8 text-center">
              <p className="text-muted text-sm mb-4">No optimization results yet.</p>
              <Button variant="outline" size="sm" onClick={() => void runOptimization()}>
                <RefreshCw size={14} /> Generate optimization
              </Button>
            </div>
          )}

          {optimized && (
            <OptimizationErrorBoundary onReset={() => void runOptimization(activeTone, 'regenerate', undefined, true, resolveCampaignKey())}>
            <div className="max-w-7xl mx-auto p-6 space-y-6 relative">
              {error && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 flex gap-2 text-red-300 text-sm">
                  <AlertTriangle size={18} className="shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}
              {campaignSwitching && (
                <div className="absolute inset-0 z-10 bg-navy/70 backdrop-blur-sm rounded-xl flex items-center justify-center">
                  <div className="flex items-center gap-3 text-orange">
                    <RefreshCw size={20} className="animate-spin" />
                    <span className="text-sm font-medium">Analyzing campaign…</span>
                  </div>
                </div>
              )}
              {regenerating && (
                <div className="absolute inset-0 z-10 bg-navy/70 backdrop-blur-sm rounded-xl flex items-center justify-center">
                  <div className="flex items-center gap-3 text-orange">
                    <RefreshCw size={20} className="animate-spin" />
                    <span className="text-sm font-medium">Regenerating ad copy…</span>
                  </div>
                </div>
              )}
              {/* Intelligence bar */}
              {intelligenceSummary && (
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

              <StrategistEnhancementPanels
                analysisSources={analysisSources}
                optimized={optimized}
                campaignPerformance={campaignPerformance}
                selectedCampaign={selectedCampaign}
                auditHealthScore={auditHealthScore}
              />

              {/* Campaign scope + custom AI prompt */}
              <div className="grid lg:grid-cols-2 gap-4">
                <div className="bg-panel border border-border rounded-xl p-4 space-y-2">
                  <label htmlFor="campaign-select" className="text-muted text-xs uppercase tracking-wider block">
                    {lockCampaignScope ? 'Optimizing this campaign' : 'Campaign scope (whole account audit)'}
                  </label>
                  {lockCampaignScope && selectedCampaign ? (
                    <div className="w-full bg-navy border border-orange/30 rounded-lg px-3 py-2 text-sm text-white">
                      {selectedCampaign.name}
                      <span className="text-muted text-xs ml-2">({selectedCampaign.status})</span>
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
                      ? selectedCampaign.adCount > 0
                        ? `Improving ads for ${selectedCampaign.name}.`
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

                <div className="bg-panel border border-purple-400/20 rounded-xl p-4 space-y-2">
                  <label htmlFor="custom-prompt" className="text-purple-300 text-xs uppercase tracking-wider block flex items-center gap-1.5">
                    <Sparkles size={12} /> Custom AI instructions
                  </label>
                  <textarea
                    id="custom-prompt"
                    value={customPrompt}
                    onChange={(e) => setCustomPrompt(e.target.value)}
                    placeholder="e.g. Focus on emergency plumbing services in Sydney. Use a friendly tone. Mention 24/7 availability and free quotes."
                    rows={3}
                    className="w-full bg-navy border border-border rounded-lg px-3 py-2 text-xs text-white placeholder:text-muted focus:border-purple-400/40 outline-none resize-none"
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={isBusy || !customPrompt.trim()}
                    onClick={() => void runOptimization(activeTone, 'regenerate', customPrompt, true, resolveCampaignKey())}
                  >
                    <Sparkles size={14} /> Apply custom instructions
                  </Button>
                </div>
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

              {/* Predicted impact summary cards */}
              <div className="grid sm:grid-cols-3 gap-3">
                <p className="sm:col-span-3 text-[10px] uppercase tracking-wider text-muted">AI Estimated Impact</p>
                {[
                  { label: 'CTR', value: optimized.predictedImpact?.ctrIncrease ?? '—', icon: TrendingUp, color: 'text-teal' },
                  { label: 'Conversions', value: optimized.predictedImpact?.conversionImprovement ?? '—', icon: Zap, color: 'text-orange' },
                  { label: 'Quality Score', value: optimized.predictedImpact?.qualityScoreIncrease ?? '—', icon: Sparkles, color: 'text-purple-400' },
                ].map((m) => (
                  <div key={m.label} className="bg-panel border border-border rounded-xl p-4 text-center">
                    <m.icon className={`${m.color} mx-auto mb-2`} size={18} />
                    <div className={`font-bold text-lg ${m.color}`}>{m.value}</div>
                    <div className="text-muted text-[10px] uppercase tracking-wider mt-1">{m.label}</div>
                  </div>
                ))}
              </div>

              {/* Split comparison */}
              <div className="grid lg:grid-cols-2 gap-6">
                <div className="bg-panel border border-red-500/20 rounded-2xl p-5 space-y-4">
                  <h3 className="text-white font-semibold flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-red-400" />
                    {scenario === 'REPLACE_EXISTING'
                      ? 'Current Ad'
                      : scenario === 'CREATE_STRATEGY'
                      ? 'No Campaign Yet'
                      : scenario === 'CREATE_ADS'
                        ? isPmaxScope
                          ? 'No PMax Assets Yet'
                          : 'Campaign — No Ads'
                        : 'Current Ad'}
                  </h3>
                  <AdPreviewPanel
                    headlines={originalAd?.headlines ?? optimized.headlines.slice(0, 5)}
                    descriptions={originalAd?.descriptions ?? optimized.descriptions.slice(0, 2)}
                    displayUrl={displayUrl}
                    displayPaths={{ path1: originalAd?.displayPath1, path2: originalAd?.displayPath2 }}
                    device={previewDevice}
                    onDeviceChange={setPreviewDevice}
                    variant="current"
                    finalUrl={originalAd?.finalUrls?.[0] ?? websiteUrl}
                  />
                  <div className="grid grid-cols-3 gap-2 text-center text-xs">
                    {[
                      { l: 'CTR', v: originalAd?.ctr != null ? `${originalAd.ctr}%` : '—' },
                      { l: 'QS', v: originalAd?.qualityScore ?? '—' },
                      { l: 'Strength', v: originalAd?.adStrength ?? '—' },
                    ].map((m) => (
                      <div key={m.l} className="bg-navy rounded-lg p-2 border border-border">
                        <div className="text-muted text-[10px]">{m.l}</div>
                        <div className="text-white font-bold">{m.v}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="bg-panel border border-teal/30 rounded-2xl p-5 space-y-4 glow-teal">
                  <h3 className="text-white font-semibold flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-teal animate-pulse" />
                    AI Optimized Ad
                  </h3>
                  <AdPreviewPanel
                    headlines={editedHeadlines}
                    descriptions={editedDescriptions}
                    displayUrl={displayUrl}
                    displayPaths={optimized.displayPaths}
                    sitelinks={optimized.adExtensions?.sitelinks}
                    callouts={optimized.adExtensions?.callouts}
                    structuredSnippets={optimized.adExtensions?.structuredSnippets}
                    device={previewDevice}
                    onDeviceChange={setPreviewDevice}
                    variant="optimized"
                    finalUrl={originalAd?.finalUrls?.[0] ?? websiteUrl}
                  />
                  <p className="text-muted text-xs leading-relaxed bg-teal/5 border border-teal/20 rounded-lg p-3">
                    {optimized.improvementReasoning}
                  </p>
                  {optimized.campaignStrategy && (
                    <div className="bg-purple-500/5 border border-purple-400/20 rounded-lg p-3 space-y-2">
                      <p className="text-purple-300 text-xs font-semibold uppercase tracking-wide">Recommended Campaign Strategy</p>
                      {optimized.campaignStrategy.campaignName && (
                        <p className="text-white text-sm font-medium">{optimized.campaignStrategy.campaignName}</p>
                      )}
                      {(optimized.campaignStrategy?.adGroups ?? []).map((ag, i) => (
                        <div key={i} className="text-xs text-muted">
                          <span className="text-white">{ag.name}</span>
                          {ag.keywords?.length ? `: ${ag.keywords.slice(0, 6).join(', ')}` : ''}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Manual edit */}
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
            </div>
            </OptimizationErrorBoundary>
          )}
        </div>

        {/* Footer actions */}
        {!isBusy && optimized && (
          <div className="shrink-0 border-t border-border bg-panel px-6 py-4">
            <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
              <Button variant="ghost" onClick={onClose}>Cancel</Button>
              <div className="flex gap-3">
                <Button variant="secondary" disabled={isBusy} onClick={() => void runOptimization(activeTone, 'regenerate', undefined, true, resolveCampaignKey())}>
                  <RefreshCw size={16} className={regenerating ? 'animate-spin' : ''} /> Regenerate
                </Button>
                <Button disabled={isBusy} onClick={openPublishWorkflow} className="bg-gradient-to-r from-orange to-orange-2 glow-orange">
                  <Send size={16} /> Approve & Publish
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
          publishing={publishing}
          publishResult={publishResultData}
          publishError={publishError}
          rollbackAvailable={rollbackAvailable}
          rollingBack={rollingBack}
          onConfirm={() => void handlePublish()}
          onCancel={closePublishWorkflow}
          onClose={closePublishWorkflow}
          onRollback={() => void handleRollback()}
        />
      </motion.div>
    </AnimatePresence>
  );
}
