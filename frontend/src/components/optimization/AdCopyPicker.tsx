import clsx from 'clsx';
import { Check } from 'lucide-react';
import type { OptimizedAdContent } from '../../types/optimization';

export type AdCopyOption = {
  id: string;
  label: string;
  content: OptimizedAdContent;
};

interface AdCopyPickerProps {
  options: AdCopyOption[];
  selectedId: string;
  onSelect: (id: string) => void;
  title?: string;
  subtitle?: string;
}

export function AdCopyPicker({
  options,
  selectedId,
  onSelect,
  title = 'Select ad to publish',
  subtitle = 'Choose one of the AI-generated copies. The selected version is what Approve & Publish will send to Google Ads.',
}: AdCopyPickerProps) {
  if (!options.length) return null;

  return (
    <div className="bg-panel border border-orange/30 rounded-2xl p-5 space-y-3">
      <div>
        <h3 className="text-white font-semibold">{title}</h3>
        <p className="text-muted text-[11px] mt-1">{subtitle}</p>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        {options.map((opt, index) => {
          const selected = selectedId === opt.id;
          const h1 = opt.content.headlines?.[0] ?? '—';
          const h2 = opt.content.headlines?.[1];
          const d1 = opt.content.descriptions?.[0];
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => onSelect(opt.id)}
              className={clsx(
                'text-left rounded-xl border p-3 transition-colors',
                selected
                  ? 'border-orange/60 bg-orange/10 ring-1 ring-orange/40'
                  : 'border-border bg-navy/50 hover:border-orange/30 hover:bg-navy/70'
              )}
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="min-w-0">
                  <p className="text-[10px] uppercase tracking-wider text-muted">
                    Option {index + 1}
                    {opt.id === 'primary' ? ' · Primary' : ''}
                  </p>
                  <p className={clsx('text-sm font-semibold truncate', selected ? 'text-orange' : 'text-white')}>
                    {opt.label}
                  </p>
                </div>
                <span
                  className={clsx(
                    'shrink-0 w-5 h-5 rounded-full border flex items-center justify-center',
                    selected ? 'border-orange bg-orange text-navy' : 'border-border text-transparent'
                  )}
                >
                  <Check size={12} strokeWidth={3} />
                </span>
              </div>
              <p className="text-xs text-blue-300 leading-snug line-clamp-2">{h1}</p>
              {h2 && <p className="text-[11px] text-muted mt-0.5 line-clamp-1">{h2}</p>}
              {d1 && <p className="text-[11px] text-white/70 mt-1.5 line-clamp-2">{d1}</p>}
              {opt.content.adDifferenceScore != null && (
                <p className="text-[10px] text-teal mt-2">Difference {opt.content.adDifferenceScore}/100</p>
              )}
            </button>
          );
        })}
      </div>
      {options.length < 4 && (
        <p className="text-[10px] text-muted">
          {options.length === 1
            ? 'Only one copy was generated for this run. Re-run Make It Better to get all 4 ad options.'
            : `${options.length} of 4 ad copies ready. If some are missing, re-run Make It Better.`}
        </p>
      )}
    </div>
  );
}
