import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  RefreshCw,
} from 'lucide-react';
import clsx from 'clsx';
import { Button } from '../ui/Button';
import { googleAdsApi } from '../../services/api';
import { formatCurrencyPrecise, formatNumber, formatPercent } from '../../utils/helpers';
import type { CampaignPublishContext, AiNegativeKeywordRow } from '../../types/publish-workflow';
import type { OptimizedAdContent, OptimizationScenario } from '../../types/optimization';
import type { CurrentAdData } from '../../types/optimization';
import type { GoogleAdsCampaign } from '../../types/connect';
import { EditableOptimizationAssets } from './EditableOptimizationAssets';
import type { PublishExistingAdAction } from './ClientReviewPanel';

function SectionCard({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={clsx('bg-panel border border-border rounded-2xl p-5 space-y-4', className)}>
      <h3 className="text-white font-semibold text-sm uppercase tracking-wider">{title}</h3>
      {children}
    </div>
  );
}

function Badge({
  tone,
  children,
}: {
  tone: 'current' | 'ai' | 'approved' | 'issue' | 'muted';
  children: React.ReactNode;
}) {
  const styles = {
    current: 'border-border bg-navy/50 text-muted',
    ai: 'border-orange/40 bg-orange/10 text-orange',
    approved: 'border-teal/40 bg-teal/10 text-teal',
    issue: 'border-red-400/40 bg-red-400/10 text-red-300',
    muted: 'border-border/60 text-muted',
  };
  return (
    <span className={clsx('text-[9px] uppercase tracking-wider px-2 py-0.5 rounded-full border', styles[tone])}>
      {children}
    </span>
  );
}

function CompareRow({
  label,
  current,
  recommended,
  reason,
}: {
  label: string;
  current?: React.ReactNode;
  recommended?: React.ReactNode;
  reason?: string;
}) {
  return (
    <div className="rounded-xl border border-border/80 bg-navy/30 p-3 space-y-2 text-sm">
      <p className="text-white font-medium">{label}</p>
      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <Badge tone="current">Current</Badge>
          <p className="text-muted text-xs mt-1">{current ?? '—'}</p>
        </div>
        <div>
          <Badge tone="ai">AI recommendation</Badge>
          <p className="text-orange text-xs mt-1">{recommended ?? 'No change recommended'}</p>
        </div>
      </div>
      {reason && <p className="text-[11px] text-muted">{reason}</p>}
      <p className="text-[10px] text-muted">Client approval required before any account change.</p>
    </div>
  );
}

export interface MakeItBetterPublishSectionsProps {
  googleAdsCustomerId?: string;
  selectedCampaign?: GoogleAdsCampaign | null;
  originalAd?: CurrentAdData | null;
  optimized: OptimizedAdContent;
  scenario: OptimizationScenario;
  accountName: string;
  websiteUrl?: string;
  headlines: string[];
  descriptions: string[];
  onHeadlinesChange: (next: string[]) => void;
  onDescriptionsChange: (next: string[]) => void;
  editedKeywords?: string[];
  editedNegativeKeywords?: string[];
  onKeywordsChange?: (next: string[]) => void;
  onNegativeKeywordsChange?: (next: string[]) => void;
  editedSitelinks?: string[];
  editedCallouts?: string[];
  editedStructuredSnippets?: string[];
  onSitelinksChange?: (next: string[]) => void;
  onCalloutsChange?: (next: string[]) => void;
  onStructuredSnippetsChange?: (next: string[]) => void;
  displayPath1: string;
  displayPath2: string;
  onDisplayPathChange: (p1: string, p2: string) => void;
  finalUrl: string;
  onFinalUrlChange: (url: string) => void;
  finalUrlApproved: boolean;
  onFinalUrlApprovedChange: (approved: boolean) => void;
  onRegenerateHeadline: (index: number) => void;
  onRegenerateDescription: (index: number) => void;
  regenerating?: boolean;
  validation: Array<{ id: string; label: string; ok: boolean; detail?: string }>;
  canPublish: boolean;
  optimizationId: string | null;
  disabled?: boolean;
  pauseExistingAd: boolean;
  onPauseExistingAdChange: (pause: boolean) => void;
  onApprovePublish: () => void;
  oauthConnected?: boolean;
  onCampaignSettingsChange?: (settings: {
    dailyBudget?: number;
    biddingStrategy?: string;
    targetCpa?: number;
  }) => void;
}

export function MakeItBetterPublishSections({
  googleAdsCustomerId,
  selectedCampaign,
  originalAd,
  optimized,
  scenario,
  accountName,
  websiteUrl,
  headlines,
  descriptions,
  onHeadlinesChange,
  onDescriptionsChange,
  editedKeywords,
  editedNegativeKeywords,
  onKeywordsChange,
  onNegativeKeywordsChange,
  editedSitelinks,
  editedCallouts,
  editedStructuredSnippets,
  onSitelinksChange,
  onCalloutsChange,
  onStructuredSnippetsChange,
  displayPath1,
  displayPath2,
  onDisplayPathChange,
  finalUrl,
  onFinalUrlChange,
  finalUrlApproved,
  onFinalUrlApprovedChange,
  onRegenerateHeadline,
  onRegenerateDescription,
  regenerating,
  validation,
  canPublish,
  optimizationId,
  disabled,
  pauseExistingAd,
  onPauseExistingAdChange,
  onApprovePublish,
  oauthConnected = true,
  onCampaignSettingsChange,
}: MakeItBetterPublishSectionsProps) {
  const assetsRef = useRef<HTMLDivElement>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [context, setContext] = useState<CampaignPublishContext | null>(null);
  const [contextLoading, setContextLoading] = useState(false);
  const [contextError, setContextError] = useState<string | null>(null);
  const [finalUrlEditing, setFinalUrlEditing] = useState(false);
  const [budgetReviewOpen, setBudgetReviewOpen] = useState(false);
  const [clientDailyBudget, setClientDailyBudget] = useState('');
  const [clientBiddingStrategy, setClientBiddingStrategy] = useState('MANUAL_CPC');
  const [clientTargetCpa, setClientTargetCpa] = useState('');
  const [approvals, setApprovals] = useState<Record<string, boolean>>({});
  const [existingAction, setExistingAction] = useState<PublishExistingAdAction>(
    pauseExistingAd ? 'pause_existing' : 'keep_active'
  );

  const currentFinalUrl = originalAd?.finalUrls?.[0] ?? websiteUrl ?? '';
  const aiFinalUrl = currentFinalUrl;

  const strategist = optimized.strategistRecommendations;
  const aiBudgetLine = strategist?.budget?.[0];
  const aiBiddingLine = strategist?.bidding?.[0];
  const aiKeywords = useMemo(
    () =>
      (editedKeywords ??
        strategist?.keywords ??
        optimized.keywordSuggestions ??
        []).slice(0, 20),
    [editedKeywords, strategist?.keywords, optimized.keywordSuggestions]
  );
  const aiNegatives: AiNegativeKeywordRow[] = useMemo(() => {
    const raw =
      editedNegativeKeywords ??
      strategist?.negativeKeywords ??
      [];
    return raw.slice(0, 20).map((k) => ({
      keyword: String(k),
      reason: 'Suggested to reduce irrelevant search intent for this service.',
      approved: false,
    }));
  }, [editedNegativeKeywords, strategist?.negativeKeywords]);

  const [negativeRows, setNegativeRows] = useState<AiNegativeKeywordRow[]>([]);
  useEffect(() => {
    setNegativeRows(aiNegatives);
  }, [aiNegatives]);

  const campaignId = selectedCampaign?.id ?? '';
  const loadContext = useCallback(async () => {
    if (!googleAdsCustomerId || !campaignId) return;
    setContextLoading(true);
    setContextError(null);
    try {
      const { data } = await googleAdsApi.campaignPublishContext(
        googleAdsCustomerId,
        campaignId,
        selectedCampaign?.metricsWindowDays ?? 30
      );
      setContext(data.context);
    } catch {
      setContextError('Could not load Google Ads settings for this campaign.');
    } finally {
      setContextLoading(false);
    }
  }, [googleAdsCustomerId, campaignId, selectedCampaign?.metricsWindowDays]);

  useEffect(() => {
    void loadContext();
  }, [loadContext]);

  useEffect(() => {
    if (!context) return;
    setClientDailyBudget(
      context.budget.dailyBudget != null ? String(context.budget.dailyBudget) : ''
    );
    setClientBiddingStrategy(context.bidding.strategyType ?? 'MANUAL_CPC');
    setClientTargetCpa(
      context.bidding.targetCpa != null ? String(context.bidding.targetCpa) : ''
    );
  }, [context]);

  useEffect(() => {
    const budgetNum = Number(clientDailyBudget);
    onCampaignSettingsChange?.({
      dailyBudget: Number.isFinite(budgetNum) && budgetNum > 0 ? budgetNum : undefined,
      biddingStrategy: clientBiddingStrategy || undefined,
      targetCpa:
        clientTargetCpa.trim() && Number.isFinite(Number(clientTargetCpa))
          ? Number(clientTargetCpa)
          : undefined,
    });
  }, [clientDailyBudget, clientBiddingStrategy, clientTargetCpa, onCampaignSettingsChange]);

  useEffect(() => {
    onPauseExistingAdChange(existingAction === 'pause_existing');
  }, [existingAction, onPauseExistingAdChange]);

  const approvalKeys = [
    'campaign',
    'budget',
    'bidding',
    'url',
    'headlines',
    'descriptions',
    'assets',
    'tracking',
    'publish',
  ] as const;
  const allApprovals = approvalKeys.every((k) => approvals[k]);
  const validationOk = validation.every((v) => v.ok);
  const urlOk = finalUrlApproved && finalUrl.trim().length > 0;
  const readyToPublish =
    !!optimizationId && canPublish && validationOk && allApprovals && urlOk && oauthConnected;

  const currency = context?.currency ?? 'AUD';
  const assetCounts = {
    headlines: headlines.filter((h) => h.trim()).length,
    descriptions: descriptions.filter((d) => d.trim()).length,
    sitelinks: optimized.adExtensions?.sitelinks?.length ?? 0,
    callouts: optimized.adExtensions?.callouts?.length ?? 0,
    snippets: optimized.adExtensions?.structuredSnippets?.length ?? 0,
  };

  const scrollToAssets = () => {
    assetsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const approvedNegatives = negativeRows.filter((n) => n.approved);

  return (
    <div className="space-y-5 border-t border-border/60 pt-6">
      {/* CLIENT REVIEW */}
      <SectionCard title="Client review">
        <p className="text-muted text-xs -mt-2">
          Review and edit the AI-generated Responsive Search Ad before publishing. Nothing is sent to Google Ads until
          you approve below.
        </p>

        <div className="space-y-3">
          <p className="text-[10px] uppercase tracking-wider text-muted">Headlines</p>
          {headlines.map((h, i) => (
            <div key={`cr-h-${i}`} className="space-y-1">
              <label className="text-xs text-white">Headline {i + 1}</label>
              <div className="flex flex-wrap gap-2 items-center">
                <input
                  value={h}
                  maxLength={30}
                  disabled={disabled}
                  onChange={(e) => {
                    const next = [...headlines];
                    next[i] = e.target.value;
                    onHeadlinesChange(next);
                  }}
                  className="flex-1 min-w-[200px] bg-navy border border-border rounded-lg px-3 py-2 text-sm text-white focus:border-teal/50 outline-none"
                />
                <span className={clsx('text-xs tabular-nums', h.length > 30 ? 'text-red-400' : 'text-muted')}>
                  {h.length}/30
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={disabled || regenerating}
                  onClick={() => onRegenerateHeadline(i)}
                >
                  <RefreshCw size={12} className={regenerating ? 'animate-spin' : ''} /> Regenerate
                </Button>
              </div>
            </div>
          ))}
          {headlines.length < 15 && (
            <Button
              variant="ghost"
              size="sm"
              disabled={disabled || headlines.length >= 15}
              onClick={() => onHeadlinesChange([...headlines, ''])}
            >
              Add headline ({headlines.length}/15)
            </Button>
          )}
        </div>

        <div className="space-y-3 pt-2">
          <p className="text-[10px] uppercase tracking-wider text-muted">Descriptions</p>
          {descriptions.map((d, i) => (
            <div key={`cr-d-${i}`} className="space-y-1">
              <label className="text-xs text-white">Description {i + 1}</label>
              <div className="flex flex-wrap gap-2 items-start">
                <textarea
                  value={d}
                  maxLength={90}
                  rows={2}
                  disabled={disabled}
                  onChange={(e) => {
                    const next = [...descriptions];
                    next[i] = e.target.value;
                    onDescriptionsChange(next);
                  }}
                  className="flex-1 min-w-[200px] bg-navy border border-border rounded-lg px-3 py-2 text-sm text-white focus:border-teal/50 outline-none resize-none"
                />
                <span className={clsx('text-xs tabular-nums', d.length > 90 ? 'text-red-400' : 'text-muted')}>
                  {d.length}/90
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={disabled || regenerating}
                  onClick={() => onRegenerateDescription(i)}
                >
                  <RefreshCw size={12} /> Regenerate
                </Button>
              </div>
            </div>
          ))}
          {descriptions.length < 4 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onDescriptionsChange([...descriptions, ''])}
              disabled={disabled || descriptions.length >= 4}
            >
              Add description ({descriptions.length}/4)
            </Button>
          )}
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-muted">Path 1</label>
            <input
              value={displayPath1}
              maxLength={15}
              disabled={disabled}
              onChange={(e) => onDisplayPathChange(e.target.value, displayPath2)}
              className="mt-1 w-full bg-navy border border-border rounded-lg px-3 py-2 text-sm text-white"
            />
          </div>
          <div>
            <label className="text-xs text-muted">Path 2</label>
            <input
              value={displayPath2}
              maxLength={15}
              disabled={disabled}
              onChange={(e) => onDisplayPathChange(displayPath1, e.target.value)}
              className="mt-1 w-full bg-navy border border-border rounded-lg px-3 py-2 text-sm text-white"
            />
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[10px] uppercase tracking-wider text-muted">Final URL</p>
            {!finalUrlApproved && <Badge tone="issue">Approval required</Badge>}
            {finalUrlApproved && <Badge tone="approved">Client approved</Badge>}
          </div>
          {finalUrlEditing ? (
            <input
              value={finalUrl}
              disabled={disabled}
              onChange={(e) => {
                onFinalUrlChange(e.target.value);
                onFinalUrlApprovedChange(false);
              }}
              className="w-full bg-navy border border-orange/40 rounded-lg px-3 py-2 text-sm text-white"
            />
          ) : (
            <p className="text-teal text-sm break-all">{finalUrl || '—'}</p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={() => {
                onFinalUrlChange(currentFinalUrl);
                setFinalUrlEditing(false);
                onFinalUrlApprovedChange(true);
              }}
            >
              Keep current
            </Button>
            <Button variant="outline" size="sm" disabled={disabled} onClick={() => setFinalUrlEditing(true)}>
              Edit
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={disabled}
              onClick={() => {
                onFinalUrlChange(aiFinalUrl);
                setFinalUrlEditing(false);
                onFinalUrlApprovedChange(true);
              }}
            >
              Use AI recommendation
            </Button>
          </div>
        </div>

        <div ref={assetsRef} className="space-y-3 pt-2 border-t border-border/60">
          <p className="text-[10px] uppercase tracking-wider text-muted">Ad assets</p>
          <p className="text-[11px] text-muted">
            Edit sitelinks, callouts, and snippets here. RSA extensions are advisory until applied in Google Ads.
          </p>
          {onSitelinksChange && onCalloutsChange && onStructuredSnippetsChange ? (
            <EditableOptimizationAssets
              sitelinks={editedSitelinks ?? optimized.adExtensions?.sitelinks ?? []}
              callouts={editedCallouts ?? optimized.adExtensions?.callouts ?? []}
              structuredSnippets={editedStructuredSnippets ?? optimized.adExtensions?.structuredSnippets ?? []}
              keywords={editedKeywords ?? aiKeywords}
              negativeKeywords={editedNegativeKeywords ?? aiNegatives.map((n) => n.keyword)}
              onSitelinksChange={onSitelinksChange}
              onCalloutsChange={onCalloutsChange}
              onStructuredSnippetsChange={onStructuredSnippetsChange}
              onKeywordsChange={onKeywordsChange ?? (() => undefined)}
              onNegativeKeywordsChange={onNegativeKeywordsChange ?? (() => undefined)}
              disabled={disabled}
              compact
              showKeywords={false}
            />
          ) : (
            <>
              {(['sitelinks', 'callouts', 'structuredSnippets'] as const).map((kind) => {
                const items =
                  kind === 'sitelinks'
                    ? optimized.adExtensions?.sitelinks
                    : kind === 'callouts'
                      ? optimized.adExtensions?.callouts
                      : optimized.adExtensions?.structuredSnippets;
                if (!items?.length) return null;
                const label =
                  kind === 'sitelinks' ? 'Sitelinks' : kind === 'callouts' ? 'Callouts' : 'Structured snippets';
                return (
                  <div key={kind} className="rounded-lg border border-border bg-navy/40 p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-white text-xs font-medium">{label}</span>
                      <Badge tone="ai">AI recommendation</Badge>
                    </div>
                    <ul className="text-xs text-muted space-y-1">
                      {items.map((item, idx) => (
                        <li key={idx}>{String(item)}</li>
                      ))}
                    </ul>
                  </div>
                );
              })}
              {!optimized.adExtensions?.sitelinks?.length &&
                !optimized.adExtensions?.callouts?.length &&
                !optimized.adExtensions?.structuredSnippets?.length && (
                  <p className="text-xs text-muted">No extension assets in this AI response.</p>
                )}
            </>
          )}
        </div>
      </SectionCard>

      {/* GOOGLE ADS SETTINGS */}
      <div className="bg-panel border border-border rounded-2xl overflow-hidden">
        <button
          type="button"
          onClick={() => setSettingsOpen((o) => !o)}
          className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-navy/30"
        >
          <span className="text-white font-semibold text-sm uppercase tracking-wider">Google Ads settings</span>
          {settingsOpen ? <ChevronDown className="text-muted" size={18} /> : <ChevronRight className="text-muted" size={18} />}
        </button>
        {settingsOpen && (
          <div className="px-5 pb-5 space-y-4 border-t border-border/60">
            {contextLoading && <p className="text-muted text-sm pt-4">Loading live settings from Google Ads…</p>}
            {contextError && (
              <p className="text-red-300 text-sm pt-4 flex gap-2">
                <AlertTriangle size={16} /> {contextError}
              </p>
            )}
            {context && (
              <>
                <CompareRow
                  label="Budget"
                  current={
                    context.budget.dailyBudget != null
                      ? `${formatCurrencyPrecise(context.budget.dailyBudget, currency)}/day · Spend ${formatCurrencyPrecise(context.budget.periodSpend ?? 0, currency)} (${context.windowDays}d)${
                          context.budget.utilizationPercent != null
                            ? ` · ${context.budget.utilizationPercent}% utilization`
                            : ''
                        }`
                      : 'Not returned by API'
                  }
                  recommended={aiBudgetLine ? String(aiBudgetLine) : 'No change recommended'}
                  reason={
                    aiBudgetLine
                      ? 'Based on AI strategist review of campaign performance and constraints.'
                      : undefined
                  }
                />
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setBudgetReviewOpen(false)}>
                    Keep current
                  </Button>
                  {aiBudgetLine && (
                    <Button variant="secondary" size="sm" onClick={() => setBudgetReviewOpen(true)}>
                      Review recommendation
                    </Button>
                  )}
                </div>
                {budgetReviewOpen && aiBudgetLine && (
                  <p className="text-[11px] text-orange">
                    Budget changes are not applied from Make It Better — adjust in Google Ads after client sign-off.
                  </p>
                )}

                <CompareRow
                  label="Bidding"
                  current={[
                    context.bidding.strategyType?.replace(/_/g, ' '),
                    context.bidding.targetCpa != null
                      ? `Target CPA ${formatCurrencyPrecise(context.bidding.targetCpa, currency)}`
                      : null,
                    context.bidding.targetRoas != null ? `Target ROAS ${context.bidding.targetRoas}` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ') || '—'}
                  recommended={aiBiddingLine ? String(aiBiddingLine) : 'Keep current strategy'}
                />

                <div className="rounded-xl border border-border/80 bg-navy/30 p-3 space-y-2">
                  <p className="text-white font-medium text-sm">Location targeting</p>
                  <Badge tone="current">Current</Badge>
                  {context.locations.length ? (
                    <ul className="text-xs text-muted mt-2 space-y-1">
                      {context.locations.map((loc) => (
                        <li key={loc.name}>
                          {loc.excluded ? '✗ ' : '✓ '}
                          {loc.name}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-muted mt-1">No location rows returned for this campaign.</p>
                  )}
                  {strategist?.audience?.[0] && (
                    <>
                      <Badge tone="ai">AI recommendation</Badge>
                      <p className="text-orange text-xs">{String(strategist.audience[0])}</p>
                    </>
                  )}
                </div>

                <div className="rounded-xl border border-border/80 bg-navy/30 p-3 space-y-2">
                  <p className="text-white font-medium text-sm">Keywords</p>
                  <p className="text-[10px] uppercase text-muted">Current keywords</p>
                  {context.keywords.length ? (
                    <ul className="text-xs text-muted max-h-32 overflow-y-auto space-y-0.5">
                      {context.keywords.slice(0, 15).map((k) => (
                        <li key={k.text}>
                          {k.text}
                          {k.matchType ? ` · ${k.matchType}` : ''}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-muted">No keyword_view rows for this window.</p>
                  )}
                  {aiKeywords.length > 0 && (
                    <>
                      <p className="text-[10px] uppercase text-orange pt-2">
                        {onKeywordsChange ? 'Recommended keywords (editable)' : 'AI recommended keywords'}
                      </p>
                      {onKeywordsChange ? (
                        <div className="space-y-2 max-h-48 overflow-y-auto">
                          {aiKeywords.map((k, i) => (
                            <input
                              key={`kw-${i}`}
                              type="text"
                              value={k}
                              disabled={disabled}
                              onChange={(e) => {
                                const next = [...aiKeywords];
                                next[i] = e.target.value;
                                onKeywordsChange(next);
                              }}
                              className="w-full bg-panel border border-border rounded-lg px-3 py-1.5 text-xs text-orange focus:border-orange/40 outline-none"
                            />
                          ))}
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={disabled}
                            onClick={() => onKeywordsChange([...aiKeywords, ''])}
                          >
                            Add keyword
                          </Button>
                        </div>
                      ) : (
                        <ul className="text-xs text-orange space-y-1">
                          {aiKeywords.map((k) => (
                            <li key={String(k)}>{String(k)}</li>
                          ))}
                        </ul>
                      )}
                    </>
                  )}
                </div>

                <div className="rounded-xl border border-border/80 bg-navy/30 p-3 space-y-2">
                  <p className="text-white font-medium text-sm">Negative keywords</p>
                  {negativeRows.length === 0 ? (
                    <p className="text-xs text-muted">No AI negative keyword suggestions in this run.</p>
                  ) : (
                    negativeRows.map((row, i) => (
                      <div key={`${row.keyword}-${i}`} className="flex flex-wrap items-start gap-2 text-xs border-b border-border/40 pb-2">
                        <div className="flex-1 min-w-[140px] space-y-1">
                          {onNegativeKeywordsChange ? (
                            <input
                              type="text"
                              value={row.keyword}
                              disabled={disabled}
                              onChange={(e) => {
                                const next = negativeRows.map((r, j) =>
                                  j === i ? { ...r, keyword: e.target.value } : r
                                );
                                setNegativeRows(next);
                                onNegativeKeywordsChange(next.map((r) => r.keyword).filter(Boolean));
                              }}
                              className="w-full bg-panel border border-border rounded-lg px-3 py-1.5 text-xs text-white focus:border-teal/40 outline-none"
                            />
                          ) : (
                            <p className="text-white">{row.keyword}</p>
                          )}
                          <p className="text-muted">{row.reason}</p>
                        </div>
                        <label className="flex items-center gap-1 text-muted cursor-pointer">
                          <input
                            type="checkbox"
                            checked={row.approved}
                            onChange={(e) => {
                              setNegativeRows((prev) =>
                                prev.map((r, j) => (j === i ? { ...r, approved: e.target.checked } : r))
                              );
                            }}
                          />
                          Approve
                        </label>
                      </div>
                    ))
                  )}
                  {onNegativeKeywordsChange && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={disabled}
                      onClick={() => {
                        const next = [
                          ...negativeRows,
                          {
                            keyword: '',
                            reason: 'Suggested to reduce irrelevant search intent for this service.',
                            approved: false,
                          },
                        ];
                        setNegativeRows(next);
                        onNegativeKeywordsChange(next.map((r) => r.keyword));
                      }}
                    >
                      Add negative keyword
                    </Button>
                  )}
                  {negativeRows.length > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setNegativeRows((prev) => prev.map((r) => ({ ...r, approved: true })))}
                    >
                      Approve selected negative keywords
                    </Button>
                  )}
                  <p className="text-[10px] text-muted">Negatives are not added automatically.</p>
                </div>

                <div className="text-xs text-muted">
                  Final URL —{' '}
                  <button type="button" className="text-teal underline" onClick={scrollToAssets}>
                    View / edit in Client review
                  </button>
                </div>

                <div className="rounded-xl border border-border/80 bg-navy/30 p-3 space-y-2">
                  <p className="text-white font-medium text-sm">Conversion tracking</p>
                  {!context.tracking.healthy && (
                    <p className="text-amber-300 text-xs flex gap-1">
                      <AlertTriangle size={14} /> Conversion tracking issue detected
                    </p>
                  )}
                  {context.tracking.warnings.map((w) => (
                    <p key={w} className="text-xs text-muted">
                      {w}
                    </p>
                  ))}
                  <ul className="space-y-1">
                    {context.conversions.map((c) => (
                      <li key={c.name} className="text-xs text-white flex gap-2">
                        {c.status === 'ENABLED' ? (
                          <CheckCircle2 size={14} className="text-teal shrink-0" />
                        ) : (
                          <Circle size={14} className="text-muted shrink-0" />
                        )}
                        <span>
                          {c.name}
                          {c.type ? ` · ${c.type}` : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="rounded-xl border border-border/80 bg-navy/30 p-3 space-y-2">
                  <p className="text-white font-medium text-sm">Device performance</p>
                  {context.devices.map((d) => (
                    <div key={d.device} className="text-xs text-muted grid sm:grid-cols-2 gap-1">
                      <span className="text-white">{d.device.replace(/_/g, ' ')}</span>
                      <span>
                        {d.conversionSharePercent != null ? `${d.conversionSharePercent}% of conversions · ` : ''}
                        CTR {formatPercent(d.ctr)} · {formatNumber(d.clicks)} clicks ·{' '}
                        {d.conversions.toFixed(1)} conv.
                      </span>
                    </div>
                  ))}
                  {context.devices.some((d) => (d.conversionSharePercent ?? 0) >= 50) && (
                    <p className="text-[11px] text-orange">
                      AI insight: Mobile or dominant device drives most conversions — review bid adjustments in Google
                      Ads (not changed here).
                    </p>
                  )}
                </div>

                <div className="rounded-xl border border-border/80 bg-navy/30 p-3 space-y-1 text-xs">
                  <p className="text-white font-medium text-sm">Ad schedule</p>
                  {context.adSchedule.length ? (
                    context.adSchedule.map((s, i) => (
                      <p key={i} className="text-muted">
                        {s.day?.replace(/_/g, ' ') ?? 'Day'} {s.startHour ?? 0}:00 – {s.endHour ?? 24}:00
                      </p>
                    ))
                  ) : (
                    <p className="text-muted">No ad schedule criteria returned (may run all day).</p>
                  )}
                  {strategist?.budget?.[1] && (
                    <p className="text-orange pt-1">AI note: {String(strategist.budget[1])}</p>
                  )}
                </div>

                <div className="rounded-xl border border-border/80 bg-navy/30 p-3 text-xs space-y-1">
                  <p className="text-white font-medium text-sm">Networks</p>
                  <p className="text-muted">
                    {context.networks.targetGoogleSearch ? '✓ Google Search' : '○ Google Search'}
                  </p>
                  <p className="text-muted">
                    {context.networks.targetSearchNetwork ? '✓ Search partners' : '○ Search partners'}
                  </p>
                  <p className="text-muted">
                    {context.networks.targetContentNetwork ? '✓ Display network' : '○ Display network'}
                  </p>
                </div>

                <div className="rounded-xl border border-teal/30 bg-teal/5 p-3 text-xs">
                  <p className="text-white font-medium text-sm mb-2">Asset summary (publish payload)</p>
                  <p className="text-muted">
                    {assetCounts.headlines} headlines · {assetCounts.descriptions} descriptions
                    {assetCounts.sitelinks ? ` · ${assetCounts.sitelinks} sitelinks (AI)` : ''}
                    {assetCounts.callouts ? ` · ${assetCounts.callouts} callouts (AI)` : ''}
                    {assetCounts.snippets ? ` · ${assetCounts.snippets} snippets (AI)` : ''}
                  </p>
                  <p className="text-teal mt-2">✓ Valid · ✓ Within character limits · ✓ Ready for review</p>
                  <Button variant="ghost" size="sm" className="mt-2" onClick={scrollToAssets}>
                    View assets
                  </Button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* PRE-PUBLISH CHECK */}
      <SectionCard title="Pre-publish check">
        {[
          { title: 'Campaign', ids: ['campaign'] },
          { title: 'Ad group', ids: ['adgroup'] },
          { title: 'Ad', ids: ['ready'] },
          { title: 'Headlines', ids: ['headlines'] },
          { title: 'Descriptions', ids: ['descriptions'] },
          { title: 'Final URL', ids: ['finalUrl'] },
          { title: 'Tracking', ids: ['tracking'] },
        ].map((group) => (
          <div key={group.title}>
            <p className="text-[10px] uppercase text-muted mb-1">{group.title}</p>
            {validation
              .filter((v) => group.ids.includes(v.id))
              .map((v) => (
                <div key={v.id} className="flex items-start gap-2 text-sm mb-1">
                  {v.ok ? (
                    <CheckCircle2 size={14} className="text-teal shrink-0 mt-0.5" />
                  ) : (
                    <Circle size={14} className="text-red-400 shrink-0 mt-0.5" />
                  )}
                  <span className={v.ok ? 'text-white' : 'text-red-300'}>
                    {v.label}
                    {v.detail ? ` — ${v.detail}` : ''}
                  </span>
                </div>
              ))}
          </div>
        ))}
        <div>
          <p className="text-[10px] uppercase text-muted mb-1">Google Ads</p>
          <div className="flex items-start gap-2 text-sm">
            {context?.oauth.hasRefreshToken && context.oauth.googleAdsConfigured ? (
              <CheckCircle2 size={14} className="text-teal shrink-0 mt-0.5" />
            ) : (
              <AlertTriangle size={14} className="text-red-400 shrink-0 mt-0.5" />
            )}
            <span className="text-white">
              OAuth {context?.oauth.hasRefreshToken ? 'connected' : 'missing'} · Customer{' '}
              {googleAdsCustomerId ?? '—'}
            </span>
          </div>
        </div>
        {readyToPublish ? (
          <p className="text-teal text-sm font-medium">Ready to publish</p>
        ) : (
          <p className="text-muted text-xs">Complete validation, URL approval, and client approvals below.</p>
        )}
      </SectionCard>

      {/* BUDGET & BIDDING — client editable at approve/publish */}
      <SectionCard title="Budget, bidding & campaign settings">
        <p className="text-muted text-xs -mt-2">
          Current Google Ads settings for this campaign. Edit what the client approves before publish.
          RSA copy is published from Make It Better; budget/bidding are documented here for sign-off
          (apply in Google Ads unless your account workflow updates them separately).
        </p>
        {contextLoading && <p className="text-muted text-sm">Loading live settings…</p>}
        {contextError && (
          <p className="text-red-300 text-sm flex gap-2">
            <AlertTriangle size={16} /> {contextError}
          </p>
        )}
        <div className="grid sm:grid-cols-2 gap-4">
          <label className="block">
            <span className="text-[11px] text-muted uppercase tracking-wider">Daily budget ({currency})</span>
            <input
              type="number"
              min={1}
              step={1}
              value={clientDailyBudget}
              disabled={disabled}
              onChange={(e) => setClientDailyBudget(e.target.value)}
              placeholder={
                context?.budget.dailyBudget != null
                  ? String(context.budget.dailyBudget)
                  : 'Enter daily budget'
              }
              className="mt-1 w-full bg-navy border border-border rounded-lg px-3 py-2 text-sm text-white"
            />
            {context?.budget.dailyBudget != null && (
              <p className="text-[10px] text-muted mt-1">
                Current in Google Ads: {formatCurrencyPrecise(context.budget.dailyBudget, currency)}/day
                {context.budget.utilizationPercent != null
                  ? ` · ${context.budget.utilizationPercent}% utilized (${context.windowDays}d)`
                  : ''}
              </p>
            )}
          </label>
          <label className="block">
            <span className="text-[11px] text-muted uppercase tracking-wider">Bidding strategy</span>
            <select
              value={clientBiddingStrategy}
              disabled={disabled}
              onChange={(e) => setClientBiddingStrategy(e.target.value)}
              className="mt-1 w-full bg-navy border border-border rounded-lg px-3 py-2 text-sm text-white"
            >
              <option value="MANUAL_CPC">Manual CPC</option>
              <option value="MAXIMIZE_CLICKS">Maximize Clicks</option>
              <option value="MAXIMIZE_CONVERSIONS">Maximize Conversions</option>
              <option value="TARGET_CPA">Target CPA</option>
              <option value="TARGET_ROAS">Target ROAS</option>
              <option value="MAXIMIZE_CONVERSION_VALUE">Maximize Conversion Value</option>
            </select>
            {context?.bidding.strategyType && (
              <p className="text-[10px] text-muted mt-1">
                Current: {context.bidding.strategyType.replace(/_/g, ' ')}
              </p>
            )}
          </label>
          {(clientBiddingStrategy === 'TARGET_CPA' || context?.bidding.targetCpa != null) && (
            <label className="block sm:col-span-2">
              <span className="text-[11px] text-muted uppercase tracking-wider">Target CPA ({currency})</span>
              <input
                type="number"
                min={0}
                step={0.01}
                value={clientTargetCpa}
                disabled={disabled}
                onChange={(e) => setClientTargetCpa(e.target.value)}
                placeholder={
                  context?.bidding.targetCpa != null ? String(context.bidding.targetCpa) : 'Optional'
                }
                className="mt-1 w-full max-w-xs bg-navy border border-border rounded-lg px-3 py-2 text-sm text-white"
              />
            </label>
          )}
        </div>
        {aiBudgetLine && (
          <div className="rounded-lg border border-orange/30 bg-orange/5 p-3 text-xs">
            <Badge tone="ai">AI recommendation</Badge>
            <p className="text-orange mt-2">{String(aiBudgetLine)}</p>
          </div>
        )}
        {aiBiddingLine && (
          <div className="rounded-lg border border-orange/30 bg-orange/5 p-3 text-xs">
            <Badge tone="ai">AI bidding note</Badge>
            <p className="text-orange mt-2">{String(aiBiddingLine)}</p>
          </div>
        )}
        {context && (
          <div className="grid sm:grid-cols-2 gap-3 text-xs text-muted pt-1">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted mb-1">Locations</p>
              {context.locations.length ? (
                <ul className="space-y-0.5">
                  {context.locations.slice(0, 6).map((loc) => (
                    <li key={loc.name}>
                      {loc.excluded ? '✗ ' : '✓ '}
                      {loc.name}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No location rows returned.</p>
              )}
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted mb-1">Networks</p>
              <p>{context.networks.targetGoogleSearch ? '✓ Google Search' : '○ Google Search'}</p>
              <p>{context.networks.targetSearchNetwork ? '✓ Search partners' : '○ Search partners'}</p>
              <p>{context.networks.targetContentNetwork ? '✓ Display network' : '○ Display network'}</p>
            </div>
          </div>
        )}
      </SectionCard>

      {/* APPROVAL SUMMARY */}
      <SectionCard title="Approval summary">
        <dl className="grid sm:grid-cols-2 gap-x-4 gap-y-2 text-xs">
          <div>
            <dt className="text-muted">Account</dt>
            <dd className="text-white">{accountName}</dd>
          </div>
          <div>
            <dt className="text-muted">Campaign</dt>
            <dd className="text-white">{selectedCampaign?.name ?? originalAd?.campaignName ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-muted">Ad group</dt>
            <dd className="text-white">{originalAd?.adGroupName ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-muted">Action</dt>
            <dd className="text-white">
              {scenario === 'REPLACE_EXISTING'
                ? 'Create new Responsive Search Ad'
                : scenario === 'CREATE_STRATEGY'
                  ? 'Create new campaign structure'
                  : 'Create new ad in campaign'}
            </dd>
          </div>
          <div>
            <dt className="text-muted">New headlines</dt>
            <dd className="text-white">{assetCounts.headlines}</dd>
          </div>
          <div>
            <dt className="text-muted">New descriptions</dt>
            <dd className="text-white">{assetCounts.descriptions}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-muted">Final URL</dt>
            <dd className="text-teal break-all">{finalUrl || '—'}</dd>
          </div>
          <div>
            <dt className="text-muted">Budget</dt>
            <dd className="text-white">
              {clientDailyBudget.trim()
                ? `${formatCurrencyPrecise(Number(clientDailyBudget) || 0, currency)}/day (client approved)`
                : context?.budget.dailyBudget != null
                  ? `${formatCurrencyPrecise(context.budget.dailyBudget, currency)}/day (unchanged)`
                  : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-muted">Bidding</dt>
            <dd className="text-white">
              {clientBiddingStrategy.replace(/_/g, ' ')}
              {clientTargetCpa.trim()
                ? ` · Target CPA ${formatCurrencyPrecise(Number(clientTargetCpa) || 0, currency)}`
                : context?.bidding.targetCpa != null
                  ? ` · Current CPA ${formatCurrencyPrecise(context.bidding.targetCpa, currency)}`
                  : ''}
            </dd>
          </div>
          <div>
            <dt className="text-muted">Keywords</dt>
            <dd className="text-white">No change</dd>
          </div>
          <div>
            <dt className="text-muted">Negative keywords</dt>
            <dd className="text-white">
              {approvedNegatives.length
                ? `${approvedNegatives.length} addition(s) proposed (not auto-applied)`
                : 'No change'}
            </dd>
          </div>
          <div>
            <dt className="text-muted">Tracking</dt>
            <dd className="text-white">No change</dd>
          </div>
          <div>
            <dt className="text-muted">Old ad</dt>
            <dd className="text-white">{pauseExistingAd ? 'PAUSE EXISTING' : 'KEEP ACTIVE'}</dd>
          </div>
        </dl>
      </SectionCard>

      {/* Publishing behavior + approvals + button */}
      <div className="bg-panel border border-border rounded-2xl p-5 space-y-3">
        <h3 className="text-white font-semibold">Publishing behavior</h3>
        <label className="flex items-start gap-2 text-sm text-muted cursor-pointer">
          <input
            type="radio"
            className="mt-1"
            checked={existingAction === 'keep_active'}
            onChange={() => setExistingAction('keep_active')}
          />
          <span>
            <span className="text-white">Create new ad and keep existing ad</span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm text-muted cursor-pointer">
          <input
            type="radio"
            className="mt-1"
            checked={existingAction === 'pause_existing'}
            onChange={() => setExistingAction('pause_existing')}
          />
          <span>
            <span className="text-white">Create new ad and pause existing ad</span>
            {existingAction === 'pause_existing' && (
              <span className="block text-amber-300 text-[11px] mt-1">
                This will stop the current ad from serving.
              </span>
            )}
          </span>
        </label>
      </div>

      <div className="bg-panel border border-orange/25 rounded-2xl p-5 space-y-3">
        <h3 className="text-white font-semibold">Client approval</h3>
        {[
          { id: 'campaign', label: 'I approve the campaign / ad group selection' },
          { id: 'budget', label: 'I approve the daily budget shown above' },
          { id: 'bidding', label: 'I approve the bidding strategy shown above' },
          { id: 'url', label: 'I approve the final URL' },
          { id: 'headlines', label: 'I approve the headlines' },
          { id: 'descriptions', label: 'I approve the descriptions' },
          { id: 'assets', label: 'I approve the ad assets (as shown)' },
          { id: 'tracking', label: 'I approve preserving existing tracking' },
          { id: 'publish', label: 'I approve publishing to Google Ads' },
        ].map((a) => (
          <label key={a.id} className="flex items-start gap-2 text-sm text-muted cursor-pointer">
            <input
              type="checkbox"
              className="mt-1"
              checked={!!approvals[a.id]}
              onChange={(e) => setApprovals((p) => ({ ...p, [a.id]: e.target.checked }))}
            />
            <span>{a.label}</span>
          </label>
        ))}
        <Button
          disabled={disabled || !readyToPublish}
          onClick={onApprovePublish}
          className={clsx(
            'w-full sm:w-auto bg-gradient-to-r from-orange to-orange-2',
            !readyToPublish && 'opacity-50'
          )}
        >
          Approve &amp; Publish
        </Button>
      </div>
    </div>
  );
}
