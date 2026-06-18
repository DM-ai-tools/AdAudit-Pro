import { useEffect, useState } from 'react';
import { Loader2, BarChart3 } from 'lucide-react';
import { googleAdsApi } from '../../services/api';
import type { AccountPerformanceSummary } from '../../types/connect';
import {
  formatCurrencyPrecise,
  formatNumber,
  formatPercent,
} from '../../utils/helpers';

interface AccountPerformanceStatsProps {
  googleAdsCustomerId?: string;
  dataWindowDays?: number;
}

function formatGoogleAdsCustomerId(id: string): string {
  const bare = id.replace(/\D/g, '');
  if (bare.length !== 10) return id;
  return `${bare.slice(0, 3)}-${bare.slice(3, 6)}-${bare.slice(6)}`;
}

export function AccountPerformanceStats({
  googleAdsCustomerId,
  dataWindowDays = 30,
}: AccountPerformanceStatsProps) {
  const [performance, setPerformance] = useState<AccountPerformanceSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [currency, setCurrency] = useState('AUD');

  const customerId = googleAdsCustomerId ? formatGoogleAdsCustomerId(googleAdsCustomerId) : undefined;

  useEffect(() => {
    if (!customerId) return;
    setLoading(true);
    void googleAdsApi.performance(customerId, dataWindowDays)
      .then(({ data }) => {
        setPerformance(data.performance);
        setCurrency(data.performance.currency || data.account.currency || 'AUD');
      })
      .catch(() => setPerformance(null))
      .finally(() => setLoading(false));
  }, [customerId, dataWindowDays]);

  if (!customerId) return null;

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted text-sm py-4">
        <Loader2 size={16} className="animate-spin" />
        Loading live Google Ads performance…
      </div>
    );
  }

  if (!performance) return null;

  const windowLabel = performance.windowDays >= 365
    ? 'Last 365 days'
    : performance.windowDays >= 90
      ? 'Last 90 days'
      : 'Last 30 days';

  const stats = [
    { label: 'Clicks', value: formatNumber(performance.clicks) },
    { label: 'Impressions', value: formatNumber(performance.impressions) },
    { label: 'CTR', value: formatPercent(performance.ctr) },
    { label: 'Avg. CPC', value: formatCurrencyPrecise(performance.avgCpc, currency) },
    { label: 'Cost', value: formatCurrencyPrecise(performance.cost, currency) },
    { label: 'Conversions', value: performance.conversions.toFixed(2) },
    { label: 'Conv. rate', value: formatPercent(performance.conversionRate) },
    { label: 'Cost / conv.', value: performance.costPerConversion > 0 ? formatCurrencyPrecise(performance.costPerConversion, currency) : '—' },
  ];

  return (
    <div className="bg-panel border border-teal/20 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-white font-semibold text-sm flex items-center gap-2">
          <BarChart3 size={16} className="text-teal" />
          Google Ads Performance
        </h3>
        <span className="text-muted text-[10px] uppercase tracking-wide">
          {windowLabel} · {performance.activeCampaigns} active campaign{performance.activeCampaigns === 1 ? '' : 's'}
        </span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
        {stats.map((s) => (
          <div key={s.label} className="bg-navy/50 rounded-lg px-3 py-2">
            <p className="text-muted text-[9px] uppercase tracking-wide">{s.label}</p>
            <p className="text-white text-sm font-bold mt-0.5">{s.value}</p>
          </div>
        ))}
      </div>
      <p className="text-muted text-[10px] mt-3">
        Stats sourced live from Google Ads API ({performance.dateRange.replace(/_/g, ' ').toLowerCase()}).
        Campaign audits use the same window as your account audit ({dataWindowDays} days).
      </p>
    </div>
  );
}
