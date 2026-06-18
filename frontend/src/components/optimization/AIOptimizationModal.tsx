import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, Sparkles, RefreshCw, TrendingUp, AlertTriangle,
  ChevronRight, Zap, Send, RotateCcw, Edit3, Brain,
} from 'lucide-react';
import clsx from 'clsx';
import { Button } from '../ui/Button';
import { AIThinkingLoader } from './AIThinkingLoader';
import { AdPreviewPanel } from './AdPreviewPanel';
import { TONE_OPTIONS } from './utils';
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
} from '../../types/optimization';

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
}: AIOptimizationModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [optimizationId, setOptimizationId] = useState<string | null>(null);
  const [scenario, setScenario] = useState<OptimizationScenario>('CREATE_ADS');

  const scenarioLabel =
    scenario === 'REPLACE_EXISTING'
      ? 'Optimize Existing Ads'
      : scenario === 'CREATE_ADS'
        ? 'Create Ads In Campaign'
        : 'New Campaign Strategy';
  const [dataSource, setDataSource] = useState<'live' | 'audit_only'>('audit_only');
  const [intelligenceSummary, setIntelligenceSummary] = useState<IntelligenceSummary | null>(null);
  const [originalAd, setOriginalAd] = useState<CurrentAdData | null>(null);
  const [optimized, setOptimized] = useState<OptimizedAdContent | null>(null);
  const [editedHeadlines, setEditedHeadlines] = useState<string[]>([]);
  const [editedDescriptions, setEditedDescriptions] = useState<string[]>([]);
  const [editMode, setEditMode] = useState(false);
  const [previewDevice, setPreviewDevice] = useState<PreviewDevice>('mobile');
  const [showPublishConfirm, setShowPublishConfirm] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishResult, setPublishResult] = useState<string | null>(null);
  const [publishedId, setPublishedId] = useState<string | null>(null);
  const [rollbackAvailable, setRollbackAvailable] = useState(false);
  const [rollingBack, setRollingBack] = useState(false);
  const [customPrompt, setCustomPrompt] = useState('');
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>('');
  const [campaigns, setCampaigns] = useState<GoogleAdsCampaign[]>([]);
  const [campaignsLoading, setCampaignsLoading] = useState(false);
  const [activeTone, setActiveTone] = useState<OptimizationTone>('default');
  const [regenerating, setRegenerating] = useState(false);

  const businessName = resolveBusinessName(accountName, websiteUrl);

  const runOptimization = useCallback(async (
    tone?: OptimizationTone,
    variation?: OptimizationVariation,
    promptOverride?: string,
    isRegenerate = false
  ) => {
    if (isRegenerate) setRegenerating(true);
    else setLoading(true);
    setError(null);
    if (!isRegenerate) {
      setPublishResult(null);
      setPublishedId(null);
      setRollbackAvailable(false);
    }
    const resolvedTone = tone ?? activeTone;
    if (tone) setActiveTone(tone);
    const prompt = promptOverride ?? customPrompt;
    try {
      const { data } = await aiApi.optimizeAd({
        auditId,
        findingId: finding.id,
        tone: resolvedTone,
        variation,
        customPrompt: prompt.trim() || undefined,
        findingSnapshot: finding,
        auditFindingsSnapshot: auditFindings,
        accountContext: {
          accountName: businessName,
          goal,
          monthlySpend,
          googleAdsCustomerId,
          websiteUrl,
          userId,
          campaignId: selectedCampaignId || undefined,
        },
      });
      setOptimizationId(data.optimizationId);
      setScenario(data.scenario);
      setDataSource(data.dataSource);
      setIntelligenceSummary(data.intelligenceSummary);
      setOriginalAd(data.originalAd);
      setOptimized(data.optimized);
      setEditedHeadlines([...data.optimized.headlines]);
      setEditedDescriptions([...data.optimized.descriptions]);
    } catch (err) {
      let message = 'Failed to generate optimizations';
      if (axios.isAxiosError(err)) {
        const apiError = (err.response?.data as { error?: string })?.error;
        if (err.response?.status === 404 && apiError === 'Not found') {
          message = 'AI API unavailable — restart backend with npm run dev.';
        } else if (err.response?.status === 401) {
          message = 'Sign in with Google to optimize and publish ads.';
        } else {
          message = apiError ?? err.message;
        }
      }
      setError(message);
    } finally {
      setLoading(false);
      setRegenerating(false);
    }
  }, [auditId, finding, auditFindings, businessName, goal, monthlySpend, googleAdsCustomerId, websiteUrl, userId, customPrompt, selectedCampaignId, activeTone]);

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
    if (open) {
      setSelectedCampaignId(initialCampaignId ?? '');
      void runOptimization();
    } else {
      setOptimizationId(null);
      setOriginalAd(null);
      setOptimized(null);
      setError(null);
      setPublishResult(null);
      setEditMode(false);
      setShowPublishConfirm(false);
      setCustomPrompt('');
      setSelectedCampaignId('');
      setActiveTone('default');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once when modal opens
  }, [open]);

  const handlePublish = async () => {
    if (!optimizationId) return;
    setPublishing(true);
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
      setPublishResult(data.message);
      setPublishedId(data.publishedId);
      setRollbackAvailable(!!data.rollbackAvailable);
      setShowPublishConfirm(false);
    } catch (err) {
      setError(
        axios.isAxiosError(err)
          ? (err.response?.data as { error?: string })?.error ?? 'Publish failed'
          : 'Publish failed'
      );
    } finally {
      setPublishing(false);
    }
  };

  const handleRollback = async () => {
    if (!publishedId) return;
    setRollingBack(true);
    try {
      const { data } = await googleAdsApi.rollbackAd(publishedId);
      setPublishResult(data.message);
      setRollbackAvailable(false);
    } catch (err) {
      setError(
        axios.isAxiosError(err)
          ? (err.response?.data as { error?: string })?.error ?? 'Rollback failed'
          : 'Rollback failed'
      );
    } finally {
      setRollingBack(false);
    }
  };

  const displayUrl = resolveDisplayHost(websiteUrl, businessName);
  const isBusy = loading || regenerating;

  const handleToneClick = (toneId: OptimizationTone) => {
    const variation: OptimizationVariation | undefined =
      toneId === 'shorter' ? 'shorter'
        : toneId === 'aggressive' ? 'aggressive-cta'
          : 'regenerate';
    void runOptimization(toneId, variation, undefined, true);
  };

  if (!open) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[100] bg-navy/95 backdrop-blur-md flex flex-col"
      >
        {/* Header */}
        <div className="shrink-0 border-b border-orange/20 bg-gradient-to-r from-orange/10 via-purple-500/5 to-teal/10 px-6 py-4">
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-orange/15 border border-orange/30 flex items-center justify-center">
                <Sparkles className="text-orange" size={22} />
              </div>
              <div>
                <h2 className="text-white font-bold text-xl">AI Ad Generator</h2>
                <p className="text-muted text-sm">One-Click Google Ads Publishing · Powered by Claude</p>
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
        <div className="flex-1 overflow-y-auto relative">
          {loading && !optimized && <AIThinkingLoader />}

          {error && !loading && !optimized && (
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

          {!loading && optimized && originalAd && (
            <div className="max-w-7xl mx-auto p-6 space-y-6 relative">
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
                    · <span className={dataSource === 'live' ? 'text-teal' : 'text-orange'}>{dataSource === 'live' ? 'Live Google Ads data' : 'Audit data'}</span>
                  </span>
                </div>
              )}

              {/* Campaign scope + custom AI prompt */}
              <div className="grid lg:grid-cols-2 gap-4">
                <div className="bg-panel border border-border rounded-xl p-4 space-y-2">
                  <label htmlFor="campaign-select" className="text-muted text-xs uppercase tracking-wider block">
                    Campaign scope (whole account audit)
                  </label>
                  <select
                    id="campaign-select"
                    value={selectedCampaignId}
                    onChange={(e) => setSelectedCampaignId(e.target.value)}
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
                  <p className="text-muted text-[10px]">
                    {campaignsLoading
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
                      onClick={() => void runOptimization('default', 'regenerate', undefined, true)}
                    >
                      <RefreshCw size={14} /> Optimize selected campaign
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
                    onClick={() => void runOptimization(activeTone, 'regenerate', customPrompt, true)}
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
                  onClick={() => void runOptimization(activeTone, 'regenerate', undefined, true)}
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

              {/* Predicted impact */}
              <div className="grid sm:grid-cols-3 gap-3">
                {[
                  { label: 'CTR', value: optimized.predictedImpact.ctrIncrease, icon: TrendingUp, color: 'text-teal' },
                  { label: 'Conversions', value: optimized.predictedImpact.conversionImprovement, icon: Zap, color: 'text-orange' },
                  { label: 'Quality Score', value: optimized.predictedImpact.qualityScoreIncrease, icon: Sparkles, color: 'text-purple-400' },
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
                    {scenario === 'CREATE_STRATEGY' ? 'No Campaign Yet' : scenario === 'CREATE_ADS' ? 'Campaign — No Ads' : 'Current Ad'}
                  </h3>
                  <AdPreviewPanel
                    headlines={originalAd.headlines}
                    descriptions={originalAd.descriptions}
                    displayUrl={displayUrl}
                    displayPaths={{ path1: originalAd.displayPath1, path2: originalAd.displayPath2 }}
                    device={previewDevice}
                    onDeviceChange={setPreviewDevice}
                    variant="current"
                    finalUrl={originalAd.finalUrls?.[0] ?? websiteUrl}
                  />
                  <div className="grid grid-cols-3 gap-2 text-center text-xs">
                    {[
                      { l: 'CTR', v: originalAd.ctr != null ? `${originalAd.ctr}%` : '—' },
                      { l: 'QS', v: originalAd.qualityScore ?? '—' },
                      { l: 'Strength', v: originalAd.adStrength ?? '—' },
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
                      {optimized.campaignStrategy.adGroups?.map((ag, i) => (
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

              {publishResult && (
                <div className="bg-teal/10 border border-teal/30 rounded-xl p-4 text-teal text-sm flex items-center justify-between gap-4">
                  <span>{publishResult}</span>
                  {rollbackAvailable && publishedId && (
                    <Button variant="outline" size="sm" loading={rollingBack} onClick={() => void handleRollback()}>
                      <RotateCcw size={14} /> Rollback
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer actions */}
        {!loading && optimized && (
          <div className="shrink-0 border-t border-border bg-panel px-6 py-4">
            <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
              <Button variant="ghost" onClick={onClose}>Cancel</Button>
              <div className="flex gap-3">
                <Button variant="secondary" disabled={isBusy} onClick={() => void runOptimization(activeTone, 'regenerate', undefined, true)}>
                  <RefreshCw size={16} className={regenerating ? 'animate-spin' : ''} /> Regenerate
                </Button>
                <Button disabled={isBusy} onClick={() => setShowPublishConfirm(true)} className="bg-gradient-to-r from-orange to-orange-2 glow-orange">
                  <Send size={16} /> Approve & Publish
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Confirm publish */}
        <AnimatePresence>
          {showPublishConfirm && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-[110]">
              <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} className="bg-panel border border-orange/30 rounded-2xl p-6 max-w-md w-full glow-orange">
                <AlertTriangle className="text-orange mb-3" size={24} />
                <h3 className="text-white font-bold text-lg mb-2">Confirm Publish</h3>
                <p className="text-muted text-sm mb-2">
                  You are about to publish changes to your Google Ads account.
                </p>
                <p className="text-muted text-xs mb-6">
                  {scenario === 'REPLACE_EXISTING'
                    ? 'The existing ad will be paused. A new optimized ad will be created (paused until you enable it).'
                    : 'A new Responsive Search Ad will be created in your account (paused until you enable it).'}
                </p>
                <div className="flex gap-3 justify-end">
                  <Button variant="ghost" onClick={() => setShowPublishConfirm(false)} disabled={publishing}>Cancel</Button>
                  <Button loading={publishing} onClick={() => void handlePublish()}>
                    Confirm Publish <ChevronRight size={16} />
                  </Button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </AnimatePresence>
  );
}
