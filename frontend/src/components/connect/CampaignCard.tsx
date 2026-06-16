import clsx from 'clsx';
import { motion } from 'framer-motion';
import { Check, Megaphone, BarChart3 } from 'lucide-react';
import type { GoogleAdsCampaign } from '../../types/connect';
import { formatCurrency } from '../../utils/helpers';

interface CampaignCardProps {
  campaign: GoogleAdsCampaign;
  selected: boolean;
  onToggle: () => void;
  currency?: string;
}

function formatType(type: string): string {
  return type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function CampaignCard({ campaign, selected, onToggle, currency = 'USD' }: CampaignCardProps) {
  const statusColor =
    campaign.status === 'ENABLED' ? 'text-teal' : 'text-muted';

  return (
    <motion.button
      type="button"
      onClick={onToggle}
      whileHover={{ scale: 1.005 }}
      className={clsx(
        'w-full text-left p-4 rounded-xl border transition-all',
        selected ? 'bg-teal/5 border-teal/40' : 'bg-navy border-border hover:border-teal/20'
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <div className={clsx(
            'w-9 h-9 rounded-lg flex items-center justify-center shrink-0',
            selected ? 'bg-teal/20' : 'bg-panel'
          )}>
            <Megaphone size={18} className={selected ? 'text-teal' : 'text-muted'} />
          </div>
          <div className="min-w-0 flex-1">
            <h4 className="text-white font-semibold text-sm truncate">{campaign.name}</h4>
            <div className="flex flex-wrap gap-2 mt-1.5">
              <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded bg-panel border border-border text-muted">
                {formatType(campaign.type)}
              </span>
              <span className={clsx('text-[10px] font-semibold uppercase', statusColor)}>
                {campaign.status}
              </span>
              {campaign.adCount === 0 && (
                <span className="text-[10px] text-orange font-medium">No ads yet</span>
              )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
              <Metric label="Budget/day" value={formatCurrency(campaign.budgetDaily, currency)} />
              <Metric label="Conversions" value={String(campaign.conversions)} />
              <Metric label="CTR" value={`${campaign.ctr}%`} />
              <Metric label="Spend (30d)" value={formatCurrency(campaign.cost, currency)} />
            </div>
          </div>
        </div>
        <div className={clsx(
          'w-5 h-5 rounded border flex items-center justify-center shrink-0 mt-1',
          selected ? 'bg-teal border-teal' : 'border-border'
        )}>
          {selected && <Check size={12} className="text-white" />}
        </div>
      </div>
    </motion.button>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-panel/60 rounded-lg px-2 py-1.5">
      <p className="text-[9px] text-muted uppercase tracking-wide flex items-center gap-0.5">
        <BarChart3 size={9} /> {label}
      </p>
      <p className="text-white text-xs font-semibold mt-0.5">{value}</p>
    </div>
  );
}
