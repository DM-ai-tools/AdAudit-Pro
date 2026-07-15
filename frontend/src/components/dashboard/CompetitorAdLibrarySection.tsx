import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, Library, Loader2, Sparkles } from 'lucide-react';
import clsx from 'clsx';
import { AdPreviewPanel } from '../optimization/AdPreviewPanel';
import { auditApi } from '../../services/api';
import type { PreviewDevice } from '../../types/optimization';
import type {
  CampaignOpportunity,
  CampaignRecommendation,
  CompetitorAdLibraryReport,
  CompetitorCampaignTypeKey,
  CompetitorLibraryAd,
} from '../../types/competitorAdLibrary';
import { COMPETITOR_CAMPAIGN_TAB_ORDER } from '../../types/competitorAdLibrary';

interface CompetitorAdLibrarySectionProps {
  auditId: string;
  enabled?: boolean;
}

function formatDate(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function OpportunityBadge({ level }: { level: CampaignOpportunity['opportunity'] }) {
  const styles =
    level === 'High'
      ? 'bg-teal/15 text-teal border-teal/30'
      : level === 'Medium'
        ? 'bg-orange/15 text-orange border-orange/30'
        : level === 'Low'
          ? 'bg-white/5 text-muted border-border'
          : 'bg-navy text-muted border-border';
  return (
    <span className={clsx('text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border', styles)}>
      {level}
    </span>
  );
}

function PriorityBadge({ priority }: { priority: CampaignRecommendation['priority'] }) {
  const styles =
    priority === 'High'
      ? 'bg-red-500/15 text-red-300 border-red-500/30'
      : priority === 'Medium'
        ? 'bg-orange/15 text-orange border-orange/30'
        : 'bg-white/5 text-muted border-border';
  return (
    <span className={clsx('text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border', styles)}>
      {priority}
    </span>
  );
}

function InsightList({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted mb-1">{title}</p>
      <div className="flex flex-wrap gap-1.5">
        {items.map((name) => (
          <span
            key={`${title}-${name}`}
            className="text-[11px] px-2 py-0.5 rounded-full bg-navy border border-border text-white/80"
          >
            {name}
          </span>
        ))}
      </div>
    </div>
  );
}

function CompetitorAdCard({
  ad,
  device,
  onDeviceChange,
}: {
  ad: CompetitorLibraryAd;
  device: PreviewDevice;
  onDeviceChange: (d: PreviewDevice) => void;
}) {
  return (
    <div className="bg-navy/40 border border-border rounded-xl p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-white text-sm font-semibold truncate">{ad.competitorName}</p>
          <a
            href={ad.competitorUrl.startsWith('http') ? ad.competitorUrl : `https://${ad.competitorUrl}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-teal text-[11px] hover:underline inline-flex items-center gap-1"
          >
            {ad.displayUrl || ad.competitorUrl}
            <ExternalLink size={11} />
          </a>
        </div>
        <div className="text-right shrink-0">
          <p className="text-[10px] text-muted uppercase tracking-wider">Confidence</p>
          <p className="text-teal font-semibold">{ad.confidenceScore || '—'}/100</p>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[11px]">
        <div className="rounded-lg border border-border bg-white/5 px-2 py-1.5">
          <p className="text-muted text-[10px] uppercase">Ad duration</p>
          <p className="text-white">
            {ad.adDurationDays > 0 ? `${ad.adDurationDays.toLocaleString()} Days` : '—'}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-white/5 px-2 py-1.5">
          <p className="text-muted text-[10px] uppercase">Active ads</p>
          <p className="text-white">{ad.activeAdCount}</p>
        </div>
        <div className="rounded-lg border border-border bg-white/5 px-2 py-1.5">
          <p className="text-muted text-[10px] uppercase">Total ads</p>
          <p className="text-white">{ad.totalAdCount}</p>
        </div>
        <div className="rounded-lg border border-border bg-white/5 px-2 py-1.5">
          <p className="text-muted text-[10px] uppercase">Brand rating</p>
          <p className="text-white">{ad.brandRating != null ? `${ad.brandRating}/5` : '—'}</p>
        </div>
        <div className="rounded-lg border border-border bg-white/5 px-2 py-1.5">
          <p className="text-muted text-[10px] uppercase">Trust score</p>
          <p className="text-white">{ad.trustScore != null ? `${ad.trustScore}/100` : '—'}</p>
        </div>
        <div className="rounded-lg border border-border bg-white/5 px-2 py-1.5">
          <p className="text-muted text-[10px] uppercase">Source</p>
          <p className="text-white leading-snug">{ad.source}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-[11px]">
        <div>
          <p className="text-muted text-[10px] uppercase">First seen</p>
          <p className="text-white">{formatDate(ad.firstSeen)}</p>
        </div>
        <div>
          <p className="text-muted text-[10px] uppercase">Last seen</p>
          <p className="text-white">{formatDate(ad.lastSeen)}</p>
        </div>
      </div>

      {(ad.offer || ad.cta) && (
        <div className="flex flex-wrap gap-2 text-[11px]">
          {ad.offer && (
            <span className="px-2 py-0.5 rounded-full bg-orange/10 text-orange border border-orange/25">
              Offer: {ad.offer}
            </span>
          )}
          {ad.cta && (
            <span className="px-2 py-0.5 rounded-full bg-teal/10 text-teal border border-teal/25">
              CTA: {ad.cta}
            </span>
          )}
        </div>
      )}

      {(ad.headlines.length > 0 || ad.descriptions.length > 0) && (
        <AdPreviewPanel
          headlines={ad.headlines}
          descriptions={ad.descriptions}
          displayUrl={ad.displayUrl}
          device={device}
          onDeviceChange={onDeviceChange}
          variant="competitor"
          finalUrl={ad.competitorUrl}
          simpleAdView
        />
      )}

      {ad.previewImageUrl && !ad.headlines.length && (
        <img
          src={ad.previewImageUrl}
          alt={`${ad.competitorName} ad`}
          className="w-full rounded-lg border border-border object-contain max-h-44 bg-white/5"
        />
      )}

      {(ad.creativeUrl || ad.transparencyUrl) && (
        <a
          href={ad.creativeUrl || ad.transparencyUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[11px] text-purple-300 hover:text-purple-200 inline-flex items-center gap-1"
        >
          <ExternalLink size={12} />
          View on Google Ads Transparency Center
        </a>
      )}
    </div>
  );
}

export function CompetitorAdLibrarySection({
  auditId,
  enabled = true,
}: CompetitorAdLibrarySectionProps) {
  const [report, setReport] = useState<CompetitorAdLibraryReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<CompetitorCampaignTypeKey>('search');
  const [previewDevice, setPreviewDevice] = useState<PreviewDevice>('desktop');

  useEffect(() => {
    if (!enabled || !auditId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void auditApi
      .competitorAdLibrary(auditId)
      .then((res) => {
        if (cancelled) return;
        setReport(res.data.report);
        const firstWithAds = COMPETITOR_CAMPAIGN_TAB_ORDER.find(
          (k) => (res.data.report.byCampaignType[k]?.adCount ?? 0) > 0
        );
        if (firstWithAds) setActiveTab(firstWithAds);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message =
          (err as { response?: { data?: { error?: string } }; message?: string })?.response?.data
            ?.error ||
          (err as { message?: string })?.message ||
          'Failed to load Competitor Ad Library';
        setError(message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [auditId, enabled]);

  const tabAds = useMemo(
    () => report?.byCampaignType[activeTab]?.ads ?? [],
    [report, activeTab]
  );
  const tabInsights = report?.byCampaignType[activeTab]?.insights;

  return (
    <section id="competitor-ad-library" className="scroll-mt-24 space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Library className="text-teal" size={20} />
            <h2 className="text-white font-bold text-xl">Competitor Ad Library</h2>
          </div>
          <p className="text-muted text-sm">
            Real competitor advertising from SociaVault / Google Ads Transparency Center — insights
            and recommendations only (no campaign creation).
          </p>
        </div>
      </div>

      {loading && (
        <div className="bg-panel border border-border rounded-xl p-8 flex flex-col items-center gap-3 text-muted">
          <Loader2 className="animate-spin text-teal" size={28} />
          <p className="text-sm">Discovering competitor ads via SociaVault…</p>
          <p className="text-[11px]">This can take up to a couple of minutes on first load.</p>
        </div>
      )}

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-sm text-red-300">
          {error}
        </div>
      )}

      {!loading && !error && report && (
        <>
          {/* Overview */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {[
              { label: 'Competitors Analyzed', value: report.overview.competitorsAnalyzed },
              {
                label: 'Total Competitor Ads',
                value: report.overview.totalCompetitorAds.toLocaleString(),
              },
              { label: 'Active Competitor Ads', value: report.overview.activeCompetitorAds },
              {
                label: 'Average Ad Duration',
                value:
                  report.overview.averageAdDuration > 0
                    ? `${report.overview.averageAdDuration.toLocaleString()} Days`
                    : '—',
              },
              {
                label: 'Avg Confidence Score',
                value:
                  report.overview.averageConfidenceScore > 0
                    ? `${report.overview.averageConfidenceScore}/100`
                    : '—',
              },
            ].map((m) => (
              <div key={m.label} className="bg-panel border border-border rounded-xl p-3 text-center">
                <div className="text-white text-lg font-bold">{m.value}</div>
                <div className="text-muted text-[10px] uppercase tracking-wider mt-1">{m.label}</div>
              </div>
            ))}
          </div>

          {/* Campaign type tabs */}
          <div className="bg-panel border border-border rounded-xl p-4 space-y-4">
            <div className="flex flex-wrap gap-2">
              {COMPETITOR_CAMPAIGN_TAB_ORDER.map((key) => {
                const bucket = report.byCampaignType[key];
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setActiveTab(key)}
                    className={clsx(
                      'text-[11px] px-3 py-1.5 rounded-full border transition-colors',
                      activeTab === key
                        ? 'bg-teal/15 text-teal border-teal/40'
                        : 'bg-navy text-muted border-border hover:text-white'
                    )}
                  >
                    {bucket.tabLabel}
                    <span className="ml-1.5 opacity-70">({bucket.adCount})</span>
                  </button>
                );
              })}
            </div>

            {tabInsights && (
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 border-t border-border/50 pt-4">
                <InsightList title="Top competitors" items={tabInsights.topCompetitors} />
                <InsightList title="Most active" items={tabInsights.mostActiveCompetitors} />
                <InsightList title="Longest running" items={tabInsights.longestRunningCompetitors} />
                <InsightList title="Most trusted" items={tabInsights.mostTrustedCompetitors} />
                <InsightList
                  title="Most consistent advertisers"
                  items={tabInsights.mostConsistentAdvertisers}
                />
              </div>
            )}

            {tabAds.length === 0 ? (
              <p className="text-muted text-sm py-4">
                No {report.byCampaignType[activeTab].label} creatives detected from Transparency
                Center data for the analyzed competitors.
              </p>
            ) : (
              <div className="grid lg:grid-cols-2 gap-4">
                {tabAds.map((ad, i) => (
                  <CompetitorAdCard
                    key={`${ad.competitorName}-${ad.creativeUrl ?? i}`}
                    ad={ad}
                    device={previewDevice}
                    onDeviceChange={setPreviewDevice}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Campaign opportunity analysis */}
          <div className="bg-panel border border-teal/25 rounded-xl p-4 space-y-4">
            <div>
              <h3 className="text-white text-sm font-semibold">Campaign Opportunity Analysis</h3>
              <p className="text-muted text-[11px] mt-0.5">
                Competitor adoption vs your account usage — recommendations only
              </p>
            </div>
            <div className="grid md:grid-cols-2 gap-3">
              {report.opportunities.map((o) => (
                <div
                  key={o.campaignType}
                  className="rounded-xl border border-border bg-navy/40 p-3 space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-white text-sm font-semibold">{o.label}</p>
                    <OpportunityBadge level={o.opportunity} />
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-[11px]">
                    <div>
                      <p className="text-muted text-[10px] uppercase">Competitor adoption</p>
                      <p className="text-teal font-semibold">{o.competitorAdoption}%</p>
                    </div>
                    <div>
                      <p className="text-muted text-[10px] uppercase">Your usage</p>
                      <p className="text-white font-semibold">{o.yourUsage}%</p>
                    </div>
                  </div>
                  <p className="text-muted text-xs leading-relaxed">{o.reason}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Recommendations */}
          <div className="bg-panel border border-orange/25 rounded-xl p-4 space-y-4">
            <div>
              <h3 className="text-white text-sm font-semibold">Recommendations</h3>
              <p className="text-muted text-[11px] mt-0.5">
                Do not create or publish campaigns from this section — suggested improvements only
              </p>
            </div>
            {report.recommendations.length === 0 ? (
              <p className="text-muted text-sm">No high-gap opportunities detected yet.</p>
            ) : (
              <div className="space-y-3">
                {report.recommendations.map((r) => (
                  <div
                    key={r.campaignType}
                    className="rounded-xl border border-border bg-navy/40 p-3 space-y-2"
                  >
                    <div className="flex flex-wrap items-center gap-2 justify-between">
                      <p className="text-white text-sm font-semibold">{r.label}</p>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-muted">
                          Competitor adoption {r.competitorAdoption}%
                        </span>
                        <PriorityBadge priority={r.priority} />
                      </div>
                    </div>
                    <p className="text-muted text-xs">{r.reason}</p>
                    <div className="grid sm:grid-cols-2 gap-3 text-[11px]">
                      <div>
                        <p className="text-teal text-[10px] uppercase tracking-wider mb-1">
                          Expected benefits
                        </p>
                        <ul className="text-muted space-y-0.5">
                          {r.expectedBenefits.map((b) => (
                            <li key={b}>• {b}</li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <p className="text-orange text-[10px] uppercase tracking-wider mb-1">
                          Suggested actions
                        </p>
                        <ul className="text-muted space-y-0.5">
                          {r.suggestedActions.map((a) => (
                            <li key={a}>• {a}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* AI insights */}
          {report.aiInsights && (
            <div className="bg-panel border border-purple-400/25 rounded-xl p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Sparkles className="text-purple-300" size={16} />
                <h3 className="text-white text-sm font-semibold">AI Insights</h3>
              </div>
              {[
                {
                  title: 'What competitors are doing differently',
                  text: report.aiInsights.whatCompetitorsDoDifferently,
                },
                {
                  title: 'Campaign types competitors prioritize',
                  text: report.aiInsights.campaignTypePriorities,
                },
                { title: 'Messaging', text: report.aiInsights.messaging },
                { title: 'Offers', text: report.aiInsights.offers },
                { title: 'Trust signals', text: report.aiInsights.trustSignals },
                {
                  title: 'Campaign opportunities',
                  text: report.aiInsights.campaignOpportunities,
                },
              ]
                .filter((row) => row.text)
                .map((row) => (
                  <div key={row.title}>
                    <p className="text-purple-300 text-[10px] uppercase tracking-wider mb-0.5">
                      {row.title}
                    </p>
                    <p className="text-muted text-xs leading-relaxed">{row.text}</p>
                  </div>
                ))}
            </div>
          )}

          <p className="text-[11px] text-muted leading-relaxed">{report.disclaimer}</p>
        </>
      )}

      {!loading && !error && !report && (
        <div className="bg-panel border border-border rounded-xl p-6 text-muted text-sm">
          Competitor Ad Library data is not available for this audit.
        </div>
      )}
    </section>
  );
}
