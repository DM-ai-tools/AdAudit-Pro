import clsx from 'clsx';
import { Check, Megaphone, ArrowRight, Sparkles, ChevronDown, ChevronUp, Plus, Settings } from 'lucide-react';
import { useState } from 'react';
import type { GoogleAdsCampaign, GoogleAdsCampaignAd } from '../../types/connect';
import {
  formatCurrencyPrecise,
  formatNumber,
  formatPercent,
} from '../../utils/helpers';
import { Button } from '../ui/Button';
import { CampaignAdPreview, type AdCompetitorUpload } from '../dashboard/CampaignAdPreview';
import { CampaignSettingsPanel } from '../dashboard/CampaignSettingsPanel';
import { inferServiceFromAd } from '../../utils/adServiceInference';
import { campaignBidLabel } from '../../utils/campaignBidding';

interface CampaignCardProps {
  campaign: GoogleAdsCampaign;
  selected?: boolean;
  onToggle?: () => void;
  onAudit?: () => void;
  onOptimize?: () => void;
  /** Per-ad Make This Ad Better */
  onOptimizeAd?: (ad: GoogleAdsCampaignAd, competitors?: AdCompetitorUpload) => void;
  /** Create a new RSA in this campaign (same research flow as Create Campaign) */
  onCreateAd?: () => void;
  googleAdsCustomerId?: string;
  onSettingsUpdated?: () => void;
  auditing?: boolean;
  variant?: 'select' | 'action';
  currency?: string;
  /** When set, only ads matching this service are listed */
  serviceFilter?: string | 'all';
  competitorUploads?: Record<string, AdCompetitorUpload>;
  onCompetitorUploadChange?: (adId: string, upload: AdCompetitorUpload | null) => void;
}

function formatType(type: string): string {
  // Prefer friendly labels when we can resolve the channel
  try {
    // lazy import avoided — keep local mapping aligned with campaignTypes util wording
    const key = type.toUpperCase().replace(/\s+/g, '_');
    if (key.includes('PERFORMANCE_MAX')) return 'Performance Max';
    if (key.includes('DEMAND_GEN') || key.includes('DISCOVERY')) return 'Demand Gen';
    if (key.includes('SHOPPING')) return 'Shopping Ads';
    if (key.includes('VIDEO')) return 'Video Ads';
    if (key.includes('DISPLAY')) return 'Display Ads';
    if (key.includes('MULTI_CHANNEL') || key.includes('APP')) return 'App Campaigns';
    if (key.includes('LOCAL_SERVICES') || key === 'LOCAL') return 'Local Services Ads';
    if (key.includes('SEARCH')) return 'Search Ads';
  } catch {
    /* fall through */
  }
  return type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatBidding(strategy?: string): string {
  return campaignBidLabel(strategy);
}

function adMatchesService(ad: GoogleAdsCampaignAd, service: string): boolean {
  const needle = service.toLowerCase().trim();
  if (!needle) return true;
  const inferred = inferServiceFromAd(ad).primaryService?.toLowerCase() ?? '';
  if (inferred && (inferred.includes(needle) || needle.includes(inferred))) return true;
  const hay = [
    ...(ad.headlines ?? []),
    ...(ad.descriptions ?? []),
    ...(ad.finalUrls ?? []),
  ]
    .join(' ')
    .toLowerCase();
  const tokens = needle.split(/\W+/).filter((t) => t.length > 2);
  if (!tokens.length) return hay.includes(needle);
  return tokens.every((t) => hay.includes(t));
}

export function CampaignCard({
  campaign,
  selected = false,
  onToggle,
  onAudit,
  onOptimize,
  onOptimizeAd,
  onCreateAd,
  googleAdsCustomerId,
  onSettingsUpdated,
  auditing = false,
  variant = 'select',
  currency = 'AUD',
  serviceFilter = 'all',
  competitorUploads = {},
  onCompetitorUploadChange,
}: CampaignCardProps) {
  const [adsExpanded, setAdsExpanded] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const statusColor = campaign.status === 'ENABLED' ? 'text-teal' : 'text-muted';
  const isAction = variant === 'action';
  const windowLabel = campaign.metricsWindowDays >= 365
    ? '365d'
    : campaign.metricsWindowDays >= 90
      ? '90d'
      : '30d';

  const visibleAds =
    serviceFilter !== 'all'
      ? campaign.ads.filter((ad) => adMatchesService(ad, serviceFilter))
      : campaign.ads;

  return (
    <div
      className={clsx(
        'w-full text-left rounded-xl border',
        isAction
          ? 'bg-navy border-border hover:border-orange/30'
          : clsx(
              selected ? 'bg-teal/5 border-teal/40' : 'bg-navy border-border hover:border-teal/20'
            ),
        auditing && 'opacity-70'
      )}
    >
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0 flex-1">
            <div className={clsx(
              'w-9 h-9 rounded-lg flex items-center justify-center shrink-0',
              isAction ? 'bg-orange/10' : selected ? 'bg-teal/20' : 'bg-panel'
            )}>
              <Megaphone size={18} className={isAction ? 'text-orange' : selected ? 'text-teal' : 'text-muted'} />
            </div>
            <div className="min-w-0 flex-1">
              <h4 className="text-white font-semibold text-sm">{campaign.name}</h4>
              <div className="flex flex-wrap gap-2 mt-1.5">
                <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded bg-panel border border-border text-muted">
                  {formatType(campaign.type)}
                </span>
                <span className={clsx('text-[10px] font-semibold uppercase', statusColor)}>
                  {campaign.status}
                </span>
                {campaign.biddingStrategyType && (
                  <span className="text-[10px] text-orange/90 font-medium">
                    {formatBidding(campaign.biddingStrategyType)}
                  </span>
                )}
              </div>
            </div>
          </div>
          {!isAction && (
            <button type="button" onClick={onToggle} className={clsx(
              'w-5 h-5 rounded border flex items-center justify-center shrink-0 mt-1',
              selected ? 'bg-teal border-teal' : 'border-border'
            )}>
              {selected && <Check size={12} className="text-white" />}
            </button>
          )}
        </div>

        <p className="text-muted text-[10px] mt-3 mb-2 uppercase tracking-wide">
          Campaign stats ({windowLabel}) — from Google Ads
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
          <Metric label="Clicks" value={formatNumber(campaign.clicks)} />
          <Metric label="Impr." value={formatNumber(campaign.impressions)} />
          <Metric label="CTR" value={formatPercent(campaign.ctr)} />
          <Metric label="Avg. CPC" value={formatCurrencyPrecise(campaign.avgCpc, currency)} />
          <Metric label="Cost" value={formatCurrencyPrecise(campaign.cost, currency)} />
          <Metric label="Conversions" value={campaign.conversions.toFixed(2)} />
          <Metric label="Conv. rate" value={formatPercent(campaign.conversionRate)} />
          <Metric label="Cost/conv." value={campaign.costPerConversion > 0 ? formatCurrencyPrecise(campaign.costPerConversion, currency) : '—'} />
        </div>
      </div>

      {visibleAds.length > 0 && (
        <div className="border-t border-border/50 mx-4 mb-4">
          <button
            type="button"
            onClick={() => setAdsExpanded((v) => !v)}
            className="w-full flex items-center justify-between py-3 text-left"
          >
            <span className="text-white text-xs font-semibold">
              Ads in this campaign ({visibleAds.length}
              {serviceFilter !== 'all' && visibleAds.length !== campaign.ads.length
                ? ` of ${campaign.ads.length}`
                : ''}
              )
            </span>
            {adsExpanded ? <ChevronUp size={16} className="text-muted" /> : <ChevronDown size={16} className="text-muted" />}
          </button>
          {adsExpanded && (
            <div className="space-y-3 pb-1">
              {visibleAds.map((ad) => {
                const inferred = inferServiceFromAd(ad);
                return (
                  <CampaignAdPreview
                    key={ad.id}
                    ad={ad}
                    currency={currency}
                    compact
                    inferredService={inferred.primaryService}
                    enableCompetitorUpload={isAction}
                    competitorUpload={competitorUploads[ad.id] ?? null}
                    onCompetitorUploadChange={
                      onCompetitorUploadChange
                        ? (upload) => onCompetitorUploadChange(ad.id, upload)
                        : undefined
                    }
                    onOptimizeAd={
                      onOptimizeAd
                        ? (competitors) => onOptimizeAd(ad, competitors ?? competitorUploads[ad.id])
                        : undefined
                    }
                  />
                );
              })}
            </div>
          )}
        </div>
      )}

      {campaign.adCount === 0 && (
        <p className="text-muted text-xs px-4 pb-3">
          No responsive search ads found for this campaign in the selected window.
          {onCreateAd && (
            <>
              {' '}
              <button type="button" className="text-orange hover:underline" onClick={onCreateAd}>
                Create an ad
              </button>
            </>
          )}
        </p>
      )}

      {campaign.ads.length > 0 && visibleAds.length === 0 && serviceFilter !== 'all' && (
        <p className="text-muted text-xs px-4 pb-3">
          No ads in this campaign match the “{serviceFilter}” service filter.
        </p>
      )}

      {isAction && (
        <div className="px-4 pb-4 flex flex-wrap gap-2 border-t border-border/50 pt-3 mx-4">
          <Button size="sm" loading={auditing} onClick={() => onAudit?.()}>
            {auditing ? 'Starting audit…' : 'Run Detailed Audit'}
            {!auditing && <ArrowRight size={14} />}
          </Button>
          {onOptimize && (
            <Button variant="secondary" size="sm" disabled={auditing} onClick={() => onOptimize()}>
              <Sparkles size={14} /> Make It Better
            </Button>
          )}
          {onCreateAd && (
            <Button variant="outline" size="sm" disabled={auditing} onClick={() => onCreateAd()}>
              <Plus size={14} /> Create Ad
            </Button>
          )}
          {googleAdsCustomerId && (
            <Button
              variant="ghost"
              size="sm"
              disabled={auditing}
              onClick={() => setSettingsOpen((v) => !v)}
            >
              <Settings size={14} /> Settings
            </Button>
          )}
        </div>
      )}

      {isAction && settingsOpen && googleAdsCustomerId && (
        <div className="px-4 pb-4">
          <CampaignSettingsPanel
            campaign={campaign}
            googleAdsCustomerId={googleAdsCustomerId}
            currency={currency}
            onUpdated={onSettingsUpdated}
          />
        </div>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-panel/60 rounded-lg px-2 py-1.5">
      <p className="text-[9px] text-muted uppercase tracking-wide">{label}</p>
      <p className="text-white text-xs font-semibold mt-0.5 truncate">{value}</p>
    </div>
  );
}
