import clsx from 'clsx';
import { motion } from 'framer-motion';

interface ToggleSwitchProps {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export function ToggleSwitch({ label, description, checked, onChange }: ToggleSwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="w-full flex items-center justify-between gap-4 py-2 text-left group"
    >
      <div>
        <p className="text-white text-sm font-medium group-hover:text-orange/90 transition-colors">{label}</p>
        {description && <p className="text-muted text-xs mt-0.5">{description}</p>}
      </div>
      <div
        className={clsx(
          'w-11 h-6 rounded-full relative shrink-0 transition-colors duration-200',
          checked ? 'bg-orange' : 'bg-border'
        )}
      >
        <motion.div
          layout
          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
          className={clsx(
            'absolute top-1 w-4 h-4 rounded-full bg-white shadow',
            checked ? 'left-6' : 'left-1'
          )}
        />
      </div>
    </button>
  );
}
