import clsx from 'clsx';
import { motion } from 'framer-motion';

interface ConfigSelectorProps<T extends string | number> {
  options: { value: T; label: string; description?: string }[];
  value: T;
  onChange: (value: T) => void;
  layout?: 'cards' | 'segmented';
}

export function ConfigSelector<T extends string | number>({
  options,
  value,
  onChange,
  layout = 'cards',
}: ConfigSelectorProps<T>) {
  if (layout === 'segmented') {
    return (
      <div className="flex rounded-lg border border-border overflow-hidden">
        {options.map((opt) => (
          <button
            key={String(opt.value)}
            type="button"
            onClick={() => onChange(opt.value)}
            className={clsx(
              'flex-1 px-3 py-2.5 text-xs font-semibold transition-colors',
              value === opt.value
                ? 'bg-orange/15 text-orange border-r border-border last:border-r-0'
                : 'bg-navy text-muted hover:text-white'
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {options.map((opt) => {
        const selected = value === opt.value;
        return (
          <motion.button
            key={String(opt.value)}
            type="button"
            onClick={() => onChange(opt.value)}
            whileHover={{ scale: 1.02 }}
            className={clsx(
              'p-4 rounded-xl border text-left transition-all',
              selected
                ? 'bg-orange/5 border-orange/50 glow-orange'
                : 'bg-navy border-border hover:border-orange/30'
            )}
          >
            <p className={clsx('font-bold text-sm', selected ? 'text-orange' : 'text-white')}>
              {opt.label}
            </p>
            {opt.description && (
              <p className="text-muted text-xs mt-1 leading-relaxed">{opt.description}</p>
            )}
          </motion.button>
        );
      })}
    </div>
  );
}
