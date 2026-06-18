import clsx from 'clsx';
import { motion } from 'framer-motion';
import { Check, Megaphone, ArrowRight, Sparkles, ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';
import type { GoogleAdsCampaign } from '../../types/connect';
import {
  formatCurrencyPrecise,
  formatNumber,
  formatPercent,
} from '../../utils/helpers';
import { Button } from '../ui/Button';
import { CampaignAdPreview } from '../dashboard/CampaignAdPreview';

interface CampaignCardProps {
  campaign: GoogleAdsCampaign;
  selected?: boolean;
  onToggle?: () => void;
  onAudit?: () => void;
  onOptimize?: () => void;
  auditing?: boolean;
  variant?: 'select' | 'action';
  currency?: string;
}

function formatType(type: string): string {
  return type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatBidding(strategy?: string): string {
  if (!strategy) return '—';
  return strategy.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function CampaignCard({
  campaign,
  selected = false,
  onToggle,
  onAudit,
  onOptimize,
  auditing = false,
  variant = 'select',
  currency = 'AUD',
}: CampaignCardProps) {
  const [adsExpanded, setAdsExpanded] = useState(true);
  const statusColor = campaign.status === 'ENABLED' ? 'text-teal' : 'text-muted';
  const isAction = variant === 'action';
  const windowLabel = campaign.metricsWindowDays >= 365
    ? '365d'
    : campaign.metricsWindowDays >= 90
      ? '90d'
      : '30d';

  return (
    <motion.div
      whileHover={{ scale: isAction ? 1.005 : 1.005 }}
      className={clsx(
        'w-full text-left rounded-xl border transition-all',
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

      {campaign.ads.length > 0 && (
        <div className="border-t border-border/50 mx-4 mb-4">
          <button
            type="button"
            onClick={() => setAdsExpanded((v) => !v)}
            className="w-full flex items-center justify-between py-3 text-left"
          >
            <span className="text-white text-xs font-semibold">
              Ads in this campaign ({campaign.ads.length})
            </span>
            {adsExpanded ? <ChevronUp size={16} className="text-muted" /> : <ChevronDown size={16} className="text-muted" />}
          </button>
          {adsExpanded && (
            <div className="space-y-3 pb-1">
              {campaign.ads.map((ad) => (
                <CampaignAdPreview key={ad.id} ad={ad} currency={currency} compact />
              ))}
            </div>
          )}
        </div>
      )}

      {campaign.adCount === 0 && (
        <p className="text-muted text-xs px-4 pb-3">No responsive search ads found for this campaign in the selected window.</p>
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
        </div>
      )}
    </motion.div>
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
