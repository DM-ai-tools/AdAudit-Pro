import clsx from 'clsx';
import type { GoogleAdsCampaignAd } from '../../types/connect';
import { formatCurrencyPrecise, formatNumber, formatPercent } from '../../utils/helpers';

interface CampaignAdPreviewProps {
  ad: GoogleAdsCampaignAd;
  currency?: string;
  compact?: boolean;
}

function displayHost(urls: string[]): string {
  const raw = urls[0];
  if (!raw) return 'www.example.com';
  try {
    return new URL(raw.startsWith('http') ? raw : `https://${raw}`).hostname.replace(/^www\./, '');
  } catch {
    return raw.replace(/^https?:\/\//, '').split('/')[0];
  }
}

export function CampaignAdPreview({ ad, currency = 'AUD', compact = false }: CampaignAdPreviewProps) {
  const host = displayHost(ad.finalUrls);
  const pathLine = ad.displayPath1
    ? `${host} › ${ad.displayPath1}${ad.displayPath2 ? ` › ${ad.displayPath2}` : ''}`
    : host;
  const headlinePreview = ad.headlines.slice(0, 3).join(' | ') || 'Ad headline';
  const descriptionPreview = ad.descriptions[0] ?? 'Ad description';

  return (
    <div className={clsx('rounded-lg border border-border bg-panel/40 overflow-hidden', compact ? 'p-3' : 'p-4')}>
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="min-w-0">
          <p className="text-white text-xs font-semibold truncate">{ad.adGroupName}</p>
          <p className="text-muted text-[10px]">
            {ad.adType.replace(/_/g, ' ')}
            {ad.adStrength ? ` · ${ad.adStrength.replace(/_/g, ' ')}` : ''}
          </p>
        </div>
        <span className={clsx(
          'text-[9px] font-bold uppercase px-1.5 py-0.5 rounded shrink-0',
          ad.status === 'ENABLED' ? 'bg-teal/15 text-teal' : 'bg-panel text-muted'
        )}>
          {ad.status}
        </span>
      </div>

      {/* Google-style SERP preview */}
      <div className="rounded-lg border border-border/60 bg-navy/60 p-3 mb-3">
        <span className="text-[9px] font-bold text-teal bg-teal/15 px-1.5 py-0.5 rounded">Sponsored</span>
        <p className="text-[10px] text-muted mt-1.5 truncate">{pathLine}</p>
        <p className="text-blue-400 text-sm font-medium leading-snug mt-1 line-clamp-2">{headlinePreview}</p>
        <p className="text-gray-300 text-xs leading-relaxed mt-1 line-clamp-2">{descriptionPreview}</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px]">
        <Stat label="Clicks" value={formatNumber(ad.clicks)} />
        <Stat label="Impr." value={formatNumber(ad.impressions)} />
        <Stat label="CTR" value={formatPercent(ad.ctr)} />
        <Stat label="Avg. CPC" value={formatCurrencyPrecise(ad.avgCpc, currency)} />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-muted uppercase tracking-wide">{label}</p>
      <p className="text-white font-semibold">{value}</p>
    </div>
  );
}
