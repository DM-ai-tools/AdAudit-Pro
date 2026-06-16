import { Sparkles } from 'lucide-react';
import clsx from 'clsx';

interface MakeItBetterButtonProps {
  onClick: () => void;
  className?: string;
  size?: 'sm' | 'md';
}

export function MakeItBetterButton({ onClick, className, size = 'sm' }: MakeItBetterButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'inline-flex items-center gap-1.5 font-semibold rounded-lg transition-all duration-300',
        'bg-gradient-to-r from-orange/20 to-purple-500/10 border border-orange/40 text-orange',
        'hover:from-orange/30 hover:to-purple-500/20 hover:border-orange/60 hover:shadow-lg hover:shadow-orange/10',
        size === 'sm' ? 'px-3 py-1.5 text-xs' : 'px-4 py-2 text-sm',
        className
      )}
    >
      <Sparkles size={size === 'sm' ? 12 : 14} />
      Make It Better
    </button>
  );
}
