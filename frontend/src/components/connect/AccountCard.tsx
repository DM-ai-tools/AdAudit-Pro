import clsx from 'clsx';
import { motion } from 'framer-motion';
import { Check, Building2, Globe, Briefcase } from 'lucide-react';
import type { GoogleAdsAccount } from '../../types/connect';
import { formatCurrency } from '../../utils/helpers';

interface AccountCardProps {
  account: GoogleAdsAccount;
  selected: boolean;
  onSelect: () => void;
  onboardingWebsite?: string;
}

export function AccountCard({ account, selected, onSelect, onboardingWebsite }: AccountCardProps) {
  const displayWebsite = account.websiteUrl || onboardingWebsite;
  const isManager = account.accountType === 'Manager' || account.selectable === false;

  if (isManager) {
    return (
      <div className="w-full p-4 rounded-xl border border-border/60 bg-panel/40">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-orange/10 flex items-center justify-center shrink-0">
            <Building2 size={20} className="text-orange" />
          </div>
          <div>
            <h4 className="text-white font-semibold text-sm">{account.name}</h4>
            <p className="text-muted text-xs mt-0.5">
              Manager (MCC) account — select a client account below to audit
            </p>
            <p className="text-muted text-[10px] mt-1 font-mono">ID: {account.customerId}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <motion.button
      type="button"
      onClick={onSelect}
      whileHover={{ scale: 1.01 }}
      whileTap={{ scale: 0.99 }}
      className={clsx(
        'w-full text-left p-4 rounded-xl border transition-all duration-200',
        selected
          ? 'bg-orange/5 border-orange/50 glow-orange'
          : 'bg-navy border-border hover:border-orange/30'
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <div className={clsx(
            'w-10 h-10 rounded-lg flex items-center justify-center shrink-0',
            selected ? 'bg-orange/20' : 'bg-panel'
          )}>
            <Building2 size={20} className={selected ? 'text-orange' : 'text-muted'} />
          </div>
          <div className="min-w-0 flex-1">
            <h4 className="text-white font-bold text-base truncate">{account.name}</h4>
            {displayWebsite && (
              <p className="text-teal text-xs mt-1 flex items-center gap-1 truncate">
                <Globe size={12} className="shrink-0" />
                {displayWebsite.replace(/^https?:\/\//, '')}
              </p>
            )}
            <p className="text-muted text-[11px] mt-1.5 font-mono">
              Google Ads ID: {account.customerId}
            </p>
            {account.industry && (
              <p className="text-muted text-xs mt-1 flex items-center gap-1">
                <Briefcase size={12} className="shrink-0" />
                {account.industry}
              </p>
            )}
            {account.parentManagerId && account.managerName && (
              <p className="text-muted text-[10px] mt-1">
                Under MCC: <span className="text-white/80">{account.managerName}</span>
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2 mt-2">
              <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-panel border border-border text-muted">
                {account.accountType}
              </span>
              <span className="text-muted text-xs">{account.currency} • {account.timezone}</span>
              <span className="text-teal text-sm font-bold">
                {formatCurrency(account.monthlySpend, account.currency)}/mo
              </span>
            </div>
          </div>
        </div>
        {selected && (
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className="w-6 h-6 rounded-full bg-orange flex items-center justify-center shrink-0"
          >
            <Check size={14} className="text-white" />
          </motion.div>
        )}
      </div>
    </motion.button>
  );
}
