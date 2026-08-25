import { useCallback, useEffect, useState } from 'react';
import { History, Loader2 } from 'lucide-react';
import { googleAdsApi } from '../../services/api';
import type { LiveAdMetrics, PublishedAdHistoryItem } from '../../types/published-ads';
import { formatCurrencyPrecise, formatNumber, formatPercent } from '../../utils/helpers';
import { Button } from '../ui/Button';

function formatGoogleAdsCustomerId(id: string): string {
  const bare = id.replace(/\D/g, '');
  if (bare.length !== 10) return id;
  return `${bare.slice(0, 3)}-${bare.slice(3, 6)}-${bare.slice(6)}`;
}

function MetricRow({
  metrics,
  currency,
}: {
  metrics: LiveAdMetrics | null;
  currency: string;
}) {
  return (
    <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
      <div className="rounded-lg border border-border bg-panel px-2.5 py-1.5">
        <p className="text-muted text-[9px] uppercase tracking-wide">Clicks</p>
        <p className="text-white text-xs font-semibold">
          {metrics ? formatNumber(metrics.clicks) : '—'}
        </p>
      </div>
      <div className="rounded-lg border border-border bg-panel px-2.5 py-1.5">
        <p className="text-muted text-[9px] uppercase tracking-wide">Impr.</p>
        <p className="text-white text-xs font-semibold">
          {metrics ? formatNumber(metrics.impressions) : '—'}
        </p>
      </div>
      <div className="rounded-lg border border-border bg-panel px-2.5 py-1.5">
        <p className="text-muted text-[9px] uppercase tracking-wide">CTR</p>
        <p className="text-white text-xs font-semibold">
          {metrics ? formatPercent(metrics.ctr) : '—'}
        </p>
      </div>
      <div className="rounded-lg border border-border bg-panel px-2.5 py-1.5">
        <p className="text-muted text-[9px] uppercase tracking-wide">Avg. CPC</p>
        <p className="text-white text-xs font-semibold">
          {metrics ? formatCurrencyPrecise(metrics.avgCpc, currency) : '—'}
        </p>
      </div>
      <div className="rounded-lg border border-border bg-panel px-2.5 py-1.5">
        <p className="text-muted text-[9px] uppercase tracking-wide">Cost</p>
        <p className="text-white text-xs font-semibold">
          {metrics ? formatCurrencyPrecise(metrics.cost, currency) : '—'}
        </p>
      </div>
      <div className="rounded-lg border border-border bg-panel px-2.5 py-1.5">
        <p className="text-muted text-[9px] uppercase tracking-wide">Conv.</p>
        <p className="text-white text-xs font-semibold">
          {metrics ? metrics.conversions.toFixed(2) : '—'}
        </p>
      </div>
    </div>
  );
}

function CopyWithStats({
  title,
  headlines,
  descriptions,
  metrics,
  currency,
  accent,
}: {
  title: string;
  headlines: string[];
  descriptions: string[];
  metrics: LiveAdMetrics | null;
  currency: string;
  accent: 'muted' | 'teal';
}) {
  return (
    <div className="rounded-xl border border-border bg-navy/40 p-3 space-y-3 min-w-0">
      <p
        className={
          accent === 'teal'
            ? 'text-teal text-[11px] font-semibold uppercase tracking-wider'
            : 'text-muted text-[11px] font-semibold uppercase tracking-wider'
        }
      >
        {title}
      </p>
      <ol className="space-y-1 list-decimal list-inside">
        {(headlines.length ? headlines : ['—']).slice(0, 15).map((h, i) => (
          <li key={`${title}-h-${i}`} className="text-white text-xs leading-snug break-words">
            {h}
          </li>
        ))}
      </ol>
      <div className="pt-2 border-t border-border/60 space-y-1">
        {(descriptions.length ? descriptions : ['—']).slice(0, 4).map((d, i) => (
          <p key={`${title}-d-${i}`} className="text-muted text-xs leading-relaxed">
            {d}
          </p>
        ))}
      </div>
      <div className="pt-1 border-t border-border/60">
        <p className="text-muted text-[10px] uppercase tracking-wide mb-1.5">Stats</p>
        <MetricRow metrics={metrics} currency={currency} />
      </div>
    </div>
  );
}

interface PublishedAdsHistorySectionProps {
  googleAdsCustomerId?: string;
  dataWindowDays?: number;
}

export function PublishedAdsHistorySection({
  googleAdsCustomerId,
  dataWindowDays = 30,
}: PublishedAdsHistorySectionProps) {
  const [versions, setVersions] = useState<PublishedAdHistoryItem[]>([]);
  const [currency, setCurrency] = useState('AUD');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const customerId = googleAdsCustomerId
    ? formatGoogleAdsCustomerId(googleAdsCustomerId)
    : undefined;

  const load = useCallback(async () => {
    if (!customerId) return;
    setLoading(true);
    setError(null);
    try {
      const { data } = await googleAdsApi.publishedVersions({
        customerId,
        windowDays: dataWindowDays,
        limit: 40,
      });
      setVersions(data.versions ?? []);
      setCurrency(data.currency || 'AUD');
    } catch {
      setError('Could not load posted ad history. Sign in and try again.');
      setVersions([]);
    } finally {
      setLoading(false);
    }
  }, [customerId, dataWindowDays]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!customerId) return null;

  return (
    <section id="posted-ads-history" className="scroll-mt-24">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h2 className="text-white font-bold text-xl flex items-center gap-2">
            <History size={20} className="text-teal" />
            Posted Ads History
          </h2>
          <p className="text-muted text-sm mt-1">
            Successfully posted ads — previous vs current copy with performance for the last{' '}
            {dataWindowDays} days.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
          Refresh
        </Button>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-muted text-sm py-8">
          <Loader2 size={16} className="animate-spin" />
          Loading posted versions…
        </div>
      )}

      {error && <p className="text-red-400 text-sm mb-3">{error}</p>}

      {!loading && !versions.length && !error && (
        <div className="bg-panel border border-border rounded-xl p-6 text-center">
          <p className="text-white text-sm font-medium">No posted ads yet</p>
          <p className="text-muted text-xs mt-1">
            When you publish from Make It Better or the Edit Ads section, successful posts appear
            here.
          </p>
        </div>
      )}

      <div className="space-y-4">
        {versions.map((v) => {
          const postedAt = v.publishedAt || v.createdAt;
          const previousMetrics =
            v.previousLiveMetrics ??
            (v.previousAdResourceName &&
            v.previousAdResourceName === v.newAdResourceName
              ? v.liveMetrics
              : null);
          return (
            <article
              key={v.id}
              className="bg-panel border border-border rounded-xl p-4 space-y-3"
            >
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-white text-sm font-medium truncate">
                  {v.campaignName || v.campaignId || 'Campaign'}
                </span>
                <span className="text-muted text-[11px]">
                  {new Date(postedAt).toLocaleString()}
                </span>
              </div>

              <div className="grid md:grid-cols-2 gap-3">
                <CopyWithStats
                  title="Previous ad"
                  headlines={v.originalAd.headlines}
                  descriptions={v.originalAd.descriptions}
                  metrics={previousMetrics}
                  currency={currency}
                  accent="muted"
                />
                <CopyWithStats
                  title="Posted ad"
                  headlines={v.publishedAd.headlines}
                  descriptions={v.publishedAd.descriptions}
                  metrics={v.liveMetrics}
                  currency={currency}
                  accent="teal"
                />
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
