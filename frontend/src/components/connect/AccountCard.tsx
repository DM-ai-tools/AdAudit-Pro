import clsx from 'clsx';
import { motion } from 'framer-motion';
import { Check, Building2 } from 'lucide-react';
import type { GoogleAdsAccount } from '../../types/connect';
import { formatCurrency } from '../../utils/helpers';

interface AccountCardProps {
  account: GoogleAdsAccount;
  selected: boolean;
  onSelect: () => void;
}

export function AccountCard({ account, selected, onSelect }: AccountCardProps) {
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
        <div className="flex items-start gap-3 min-w-0">
          <div className={clsx(
            'w-10 h-10 rounded-lg flex items-center justify-center shrink-0',
            selected ? 'bg-orange/20' : 'bg-panel'
          )}>
            <Building2 size={20} className={selected ? 'text-orange' : 'text-muted'} />
          </div>
          <div className="min-w-0">
            <h4 className="text-white font-semibold text-sm truncate">{account.name}</h4>
            <p className="text-muted text-xs mt-0.5">Customer ID: {account.customerId}</p>
            <p className="text-muted text-xs mt-1">
              {account.currency} • {account.timezone}
            </p>
            <div className="flex items-center gap-2 mt-2">
              <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-panel border border-border text-muted">
                {account.accountType}
              </span>
              <span className="text-teal text-sm font-bold">
                {formatCurrency(account.monthlySpend)}/month
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
