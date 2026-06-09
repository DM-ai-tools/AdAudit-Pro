import clsx from 'clsx';
import type { ReactNode } from 'react';

interface BadgeProps {
  children: ReactNode;
  variant?: 'orange' | 'teal' | 'red' | 'muted' | 'outline';
  className?: string;
}

export function Badge({ children, variant = 'muted', className }: BadgeProps) {
  return (
    <span
      className={clsx(
        'inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider',
        {
          'bg-orange/15 text-orange border border-orange/30': variant === 'orange',
          'bg-teal/15 text-teal border border-teal/30': variant === 'teal',
          'bg-red-500/15 text-red-400 border border-red-500/30': variant === 'red',
          'bg-panel text-muted border border-border': variant === 'muted',
          'bg-transparent text-muted border border-border': variant === 'outline',
        },
        className
      )}
    >
      {children}
    </span>
  );
}
