import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Wallet,
  Loader2,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  AlertTriangle,
  Target,
  Megaphone,
  KeyRound,
  Sparkles,
  ArrowRight,
} from 'lucide-react';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { googleAdsApi } from '../../services/api';
import type {
  AccountBudgetBreakdown,
  BudgetRecommendations,
} from '../../types/connect';
import { formatCurrencyPrecise, formatNumber, formatPercent } from '../../utils/helpers';

interface BudgetIntelligenceSectionProps {
  googleAdsCustomerId?: string;
  dataWindowDays?: number;
}

type DetailTab = 'campaigns' | 'ads' | 'keywords';

function formatGoogleAdsCustomerId(id: string): string {
  const bare = id.replace(/\D/g, '');
  if (bare.length !== 10) return id;
  return `${bare.slice(0, 3)}-${bare.slice(3, 6)}-${bare.slice(6)}`;
}

function utilColor(util: number): string {
  if (util >= 95) return 'bg-orange';
  if (util < 70) return 'bg-teal/70';
  return 'bg-teal';
}

function priorityBadge(priority: 'critical' | 'high' | 'medium') {
  if (priority === 'critical') return 'bg-red-500/15 text-red-300 border-red-500/30';
  if (priority === 'high') return 'bg-orange/15 text-orange border-orange/30';
  return 'bg-teal/10 text-teal border-teal/25';
}

export function BudgetIntelligenceSection({
  googleAdsCustomerId,
  dataWindowDays = 30,
}: BudgetIntelligenceSectionProps) {
  const [breakdown, setBreakdown] = useState<AccountBudgetBreakdown | null>(null);
  const [recommendations, setRecommendations] = useState<BudgetRecommendations | null>(null);
  const [currency, setCurrency] = useState('AUD');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<DetailTab>('campaigns');
  const [source, setSource] = useState<string>('');

  const customerId = googleAdsCustomerId
    ? formatGoogleAdsCustomerId(googleAdsCustomerId)
    : undefined;

  const load = useCallback(() => {
    if (!customerId) return;
    setLoading(true);
    setError(null);
    void googleAdsApi
      .budgetIntelligence(customerId, dataWindowDays)
      .then(({ data }) => {
        setBreakdown(data.breakdown);
        setRecommendations(data.recommendations);
        setCurrency(data.breakdown.account.currency || data.account.currency || 'AUD');
        setSource(data.source);
      })
      .catch(() => {
        setBreakdown(null);
        setRecommendations(null);
        setError('Could not load budget intelligence from Google Ads.');
      })
      .finally(() => setLoading(false));
  }, [customerId, dataWindowDays]);

  useEffect(() => {
    load();
  }, [load]);

  const maxDailySpend = useMemo(
    () => Math.max(...(breakdown?.daily.map((d) => d.spend) ?? [0]), 0.01),
    [breakdown]
  );

  if (!customerId) return null;

  const acct = breakdown?.account;
  const windowLabel =
    (acct?.windowDays ?? dataWindowDays) >= 365
      ? 'Last 365 days'
      : (acct?.windowDays ?? dataWindowDays) >= 90
        ? 'Last 90 days'
        : 'Last 30 days';

  return (
    <section id="budget-intelligence" className="scroll-mt-24 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-white font-bold text-xl flex items-center gap-2">
            <Wallet size={20} className="text-teal" />
            Budget Intelligence
          </h2>
          <p className="text-muted text-sm mt-1">
            Account spend vs daily budgets, ad and keyword cost, and allocation recommendations.
            {source === 'mock' ? ' Mock data.' : ' Live Google Ads API.'}
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={load} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
        </Button>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-muted text-sm py-6">
          <Loader2 size={16} className="animate-spin" />
          Pulling campaign budgets, ad spend, and keyword cost from Google Ads…
        </div>
      )}

      {error && !loading && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {!loading && acct && breakdown && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2">
            {[
              { label: 'Spend', value: formatCurrencyPrecise(acct.totalSpend, currency) },
              {
                label: 'Daily budget (on)',
                value: formatCurrencyPrecise(acct.enabledDailyBudget, currency),
              },
              {
                label: 'Period capacity',
                value: formatCurrencyPrecise(acct.expectedSpend, currency),
              },
              { label: 'Pace vs budget', value: formatPercent(acct.pacePercent) },
              { label: 'Unspent capacity', value: formatCurrencyPrecise(acct.leftover, currency) },
              { label: 'CPA', value: acct.costPerConversion > 0 ? formatCurrencyPrecise(acct.costPerConversion, currency) : '—' },
              { label: 'Conversions', value: acct.conversions.toFixed(1) },
              { label: 'Avg CPC', value: formatCurrencyPrecise(acct.avgCpc, currency) },
            ].map((s) => (
              <div key={s.label} className="bg-panel border border-border rounded-xl px-3 py-2.5">
                <p className="text-muted text-[9px] uppercase tracking-wider">{s.label}</p>
                <p className="text-white text-sm font-semibold mt-0.5 tabular-nums">{s.value}</p>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-2 text-[11px]">
            <span className="rounded-full border border-border px-2.5 py-1 text-muted">
              {windowLabel} · {acct.activeCampaigns} enabled campaign{acct.activeCampaigns === 1 ? '' : 's'}
            </span>
            {acct.constrainedCampaigns > 0 && (
              <span className="rounded-full border border-orange/30 bg-orange/10 px-2.5 py-1 text-orange flex items-center gap-1">
                <TrendingUp size={11} /> {acct.constrainedCampaigns} budget-constrained (≥95% util)
              </span>
            )}
            {acct.underspentCampaigns > 0 && (
              <span className="rounded-full border border-teal/30 bg-teal/10 px-2.5 py-1 text-teal flex items-center gap-1">
                <TrendingDown size={11} /> {acct.underspentCampaigns} underspent (&lt;70% util)
              </span>
            )}
          </div>

          {breakdown.campaigns.length > 0 && (
            <div className="bg-panel border border-border rounded-xl p-4">
              <p className="text-[10px] uppercase tracking-wider text-muted mb-2">
                Spend mix by campaign
              </p>
              <div className="flex h-3 rounded-full overflow-hidden bg-navy">
                {breakdown.campaigns
                  .filter((c) => c.spendShare > 0)
                  .map((c, i) => (
                    <div
                      key={c.campaignId}
                      title={`${c.name}: ${formatPercent(c.spendShare)}`}
                      className={i % 2 === 0 ? 'bg-teal' : 'bg-orange'}
                      style={{ width: `${Math.max(c.spendShare, 0.4)}%` }}
                    />
                  ))}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
                {breakdown.campaigns.slice(0, 8).map((c, i) => (
                  <span key={c.campaignId} className="text-[10px] text-muted flex items-center gap-1.5">
                    <span className={`w-2 h-2 rounded-sm ${i % 2 === 0 ? 'bg-teal' : 'bg-orange'}`} />
                    {c.name.slice(0, 36)}
                    <span className="text-white/70 tabular-nums">{formatPercent(c.spendShare, 1)}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {breakdown.daily.length > 1 && (
            <div className="bg-panel border border-border rounded-xl p-4">
              <p className="text-[10px] uppercase tracking-wider text-muted mb-2">Daily spend</p>
              <div className="flex items-end gap-px h-16">
                {breakdown.daily.map((d) => (
                  <div
                    key={d.date}
                    title={`${d.date}: ${formatCurrencyPrecise(d.spend, currency)}`}
                    className="flex-1 min-w-0 bg-teal/80 rounded-t-sm"
                    style={{ height: `${Math.max(6, (d.spend / maxDailySpend) * 100)}%` }}
                  />
                ))}
              </div>
              <div className="flex justify-between text-[9px] text-muted mt-1">
                <span>{breakdown.daily[0]?.date}</span>
                <span>{breakdown.daily[breakdown.daily.length - 1]?.date}</span>
              </div>
            </div>
          )}

          <div className="flex gap-2">
            {(
              [
                ['campaigns', 'Campaigns', Megaphone],
                ['ads', 'Ads', Target],
                ['keywords', 'Keywords', KeyRound],
              ] as const
            ).map(([id, label, Icon]) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={`text-[11px] px-3 py-1.5 rounded-full border flex items-center gap-1.5 ${
                  tab === id
                    ? 'bg-orange/15 text-orange border-orange/40'
                    : 'bg-navy text-muted border-border hover:text-white'
                }`}
              >
                <Icon size={12} /> {label}
              </button>
            ))}
          </div>

          {tab === 'campaigns' && (
            <div className="bg-panel border border-border rounded-xl overflow-x-auto">
              <table className="w-full text-[11px] min-w-[860px]">
                <thead>
                  <tr className="text-muted text-[9px] uppercase tracking-wider border-b border-border">
                    <th className="text-left font-medium px-3 py-2">Campaign</th>
                    <th className="text-right font-medium px-2 py-2">Daily budget</th>
                    <th className="text-right font-medium px-2 py-2">Spend</th>
                    <th className="text-right font-medium px-2 py-2">Util.</th>
                    <th className="text-right font-medium px-2 py-2">Leftover</th>
                    <th className="text-right font-medium px-2 py-2">Conv</th>
                    <th className="text-right font-medium px-2 py-2">CPA</th>
                    <th className="text-right font-medium px-2 py-2">IS / budget lost</th>
                  </tr>
                </thead>
                <tbody>
                  {breakdown.campaigns.map((c) => (
                    <tr key={c.campaignId} className="border-b border-border/60 last:border-0">
                      <td className="px-3 py-2">
                        <p className="text-white font-medium">{c.name}</p>
                        <p className="text-muted text-[10px]">
                          {c.type} · {c.status}
                          {c.biddingStrategyType ? ` · ${c.biddingStrategyType.replace(/_/g, ' ')}` : ''}
                        </p>
                      </td>
                      <td className="text-right px-2 tabular-nums text-white">
                        {formatCurrencyPrecise(c.dailyBudget, currency)}
                      </td>
                      <td className="text-right px-2 tabular-nums text-white">
                        {formatCurrencyPrecise(c.spend, currency)}
                        <span className="block text-muted text-[9px]">{formatPercent(c.spendShare, 1)}</span>
                      </td>
                      <td className="text-right px-2">
                        <div className="flex items-center justify-end gap-2">
                          <div className="w-16 h-1.5 rounded-full bg-navy overflow-hidden">
                            <div
                              className={`h-full ${utilColor(c.budgetUtilization)}`}
                              style={{ width: `${Math.min(100, c.budgetUtilization)}%` }}
                            />
                          </div>
                          <span className="tabular-nums text-white w-10 text-right">
                            {formatPercent(c.budgetUtilization, 0)}
                          </span>
                        </div>
                      </td>
                      <td className="text-right px-2 tabular-nums text-muted">
                        {formatCurrencyPrecise(c.leftover, currency)}
                      </td>
                      <td className="text-right px-2 tabular-nums text-white">{c.conversions.toFixed(1)}</td>
                      <td className="text-right px-2 tabular-nums text-white">
                        {c.costPerConversion > 0 ? formatCurrencyPrecise(c.costPerConversion, currency) : '—'}
                      </td>
                      <td className="text-right px-2 tabular-nums text-muted">
                        {c.searchImpressionShare != null ? formatPercent(c.searchImpressionShare, 0) : '—'}
                        {c.budgetLostIs != null && c.budgetLostIs > 1 ? (
                          <span className="block text-orange text-[9px]">
                            lost {formatPercent(c.budgetLostIs, 0)}
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {tab === 'ads' && (
            <div className="bg-panel border border-border rounded-xl overflow-x-auto">
              {breakdown.ads.length === 0 ? (
                <p className="text-muted text-sm px-4 py-6">No ad-level spend in this window.</p>
              ) : (
                <table className="w-full text-[11px] min-w-[780px]">
                  <thead>
                    <tr className="text-muted text-[9px] uppercase tracking-wider border-b border-border">
                      <th className="text-left font-medium px-3 py-2">Ad</th>
                      <th className="text-left font-medium px-2 py-2">Campaign / ad group</th>
                      <th className="text-right font-medium px-2 py-2">Spend</th>
                      <th className="text-right font-medium px-2 py-2">Clicks</th>
                      <th className="text-right font-medium px-2 py-2">Conv</th>
                      <th className="text-right font-medium px-2 py-2">CPA</th>
                      <th className="text-right font-medium px-2 py-2">CPC</th>
                    </tr>
                  </thead>
                  <tbody>
                    {breakdown.ads.map((ad) => (
                      <tr key={`${ad.campaignId}-${ad.adId}`} className="border-b border-border/60 last:border-0">
                        <td className="px-3 py-2">
                          <p className="text-blue-300">{ad.headline}</p>
                          <p className="text-muted text-[10px]">{ad.status}</p>
                        </td>
                        <td className="px-2 py-2 text-muted">
                          <p className="text-white/80">{ad.campaignName}</p>
                          {ad.adGroupName}
                        </td>
                        <td className="text-right px-2 tabular-nums text-white">
                          {formatCurrencyPrecise(ad.spend, currency)}
                          <span className="block text-muted text-[9px]">{formatPercent(ad.spendShare, 1)}</span>
                        </td>
                        <td className="text-right px-2 tabular-nums">{formatNumber(ad.clicks)}</td>
                        <td className="text-right px-2 tabular-nums">{ad.conversions.toFixed(1)}</td>
                        <td className="text-right px-2 tabular-nums">
                          {ad.costPerConversion > 0 ? formatCurrencyPrecise(ad.costPerConversion, currency) : '—'}
                        </td>
                        <td className="text-right px-2 tabular-nums">
                          {formatCurrencyPrecise(ad.avgCpc, currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {tab === 'keywords' && (
            <div className="bg-panel border border-border rounded-xl overflow-x-auto">
              {breakdown.keywords.length === 0 ? (
                <p className="text-muted text-sm px-4 py-6">
                  No keyword spend in this window (common for PMax-only accounts).
                </p>
              ) : (
                <table className="w-full text-[11px] min-w-[820px]">
                  <thead>
                    <tr className="text-muted text-[9px] uppercase tracking-wider border-b border-border">
                      <th className="text-left font-medium px-3 py-2">Keyword</th>
                      <th className="text-left font-medium px-2 py-2">Campaign</th>
                      <th className="text-right font-medium px-2 py-2">Spend</th>
                      <th className="text-right font-medium px-2 py-2">Clicks</th>
                      <th className="text-right font-medium px-2 py-2">Conv</th>
                      <th className="text-right font-medium px-2 py-2">CPA</th>
                      <th className="text-right font-medium px-2 py-2">CPC</th>
                      <th className="text-right font-medium px-2 py-2">QS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {breakdown.keywords.map((kw, i) => (
                      <tr key={`${kw.campaignId}-${kw.keyword}-${i}`} className="border-b border-border/60 last:border-0">
                        <td className="px-3 py-2">
                          <p className="text-white font-medium">{kw.keyword}</p>
                          <p className="text-muted text-[10px]">{kw.matchType.replace(/_/g, ' ')}</p>
                        </td>
                        <td className="px-2 py-2 text-muted">
                          <p className="text-white/80">{kw.campaignName}</p>
                          {kw.adGroupName}
                        </td>
                        <td className="text-right px-2 tabular-nums text-white">
                          {formatCurrencyPrecise(kw.spend, currency)}
                          <span className="block text-muted text-[9px]">{formatPercent(kw.spendShare, 1)}</span>
                        </td>
                        <td className="text-right px-2 tabular-nums">{formatNumber(kw.clicks)}</td>
                        <td className="text-right px-2 tabular-nums">{kw.conversions.toFixed(1)}</td>
                        <td className="text-right px-2 tabular-nums">
                          {kw.costPerConversion > 0 ? formatCurrencyPrecise(kw.costPerConversion, currency) : '—'}
                        </td>
                        <td className="text-right px-2 tabular-nums">
                          {formatCurrencyPrecise(kw.avgCpc, currency)}
                        </td>
                        <td className="text-right px-2 tabular-nums text-muted">
                          {kw.qualityScore ?? '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          <div className="rounded-xl border border-teal/25 bg-teal/5 p-4 space-y-4">
            <div className="flex items-center gap-2">
              <Sparkles size={16} className="text-teal" />
              <h3 className="text-white font-semibold text-sm">AI budget allocation</h3>
              <Badge variant="teal">Expert recs</Badge>
            </div>
            {recommendations?.summary && (
              <p className="text-sm text-white/85 leading-relaxed">{recommendations.summary}</p>
            )}
            {recommendations?.actions?.length ? (
              <div className="space-y-2">
                {recommendations.actions.map((a, i) => (
                  <div key={`${a.title}-${i}`} className="rounded-lg border border-border bg-navy/50 p-3">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span className={`text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full border ${priorityBadge(a.priority)}`}>
                        {a.priority}
                      </span>
                      <p className="text-white text-xs font-semibold">{a.title}</p>
                      {a.amount != null && a.amount > 0 && (
                        <span className="text-orange text-[11px] tabular-nums">
                          {formatCurrencyPrecise(a.amount, currency)}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-muted leading-relaxed">{a.detail}</p>
                    {(a.moveFrom || a.moveTo) && (
                      <p className="text-[10px] text-teal/90 mt-1.5 flex items-center gap-1.5">
                        {a.moveFrom && <span>{a.moveFrom}</span>}
                        {a.moveFrom && a.moveTo && <ArrowRight size={11} />}
                        {a.moveTo && <span>{a.moveTo}</span>}
                      </p>
                    )}
                    {a.expectedImpact && (
                      <p className="text-[10px] text-white/60 mt-1">Impact: {a.expectedImpact}</p>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-muted text-xs flex items-center gap-1.5">
                <AlertTriangle size={12} /> No structured allocation actions returned. Use leftover and CPA columns as the first pass.
              </p>
            )}

            {recommendations?.reallocation?.length ? (
              <div className="overflow-x-auto">
                <p className="text-[10px] uppercase tracking-wider text-muted mb-2">Suggested daily budgets</p>
                <table className="w-full text-[11px] min-w-[560px]">
                  <thead>
                    <tr className="text-muted text-[9px] uppercase tracking-wider border-b border-border">
                      <th className="text-left font-medium py-1">Entity</th>
                      <th className="text-right font-medium py-1">Current / day</th>
                      <th className="text-right font-medium py-1">Recommended / day</th>
                      <th className="text-left font-medium py-1 pl-3">Why</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recommendations.reallocation.map((r, i) => (
                      <tr key={`${r.name}-${i}`} className="border-b border-border/50 last:border-0">
                        <td className="py-1.5 text-white">
                          <span className="text-[9px] text-muted uppercase mr-1.5">{r.entityType}</span>
                          {r.name}
                        </td>
                        <td className="text-right tabular-nums">
                          {formatCurrencyPrecise(r.currentDaily, currency)}
                        </td>
                        <td className="text-right tabular-nums text-teal">
                          {formatCurrencyPrecise(r.recommendedDaily, currency)}
                        </td>
                        <td className="pl-3 text-muted">{r.rationale}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        </>
      )}
    </section>
  );
}
