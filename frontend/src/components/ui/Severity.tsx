import clsx from 'clsx';
import type { Severity } from '../../types';

export function SeverityDot({ severity, className }: { severity: Severity; className?: string }) {
  const colors: Record<Severity, string> = {
    CRITICAL: 'bg-red-500 shadow-[0_0_8px_rgba(255,68,68,0.6)]',
    HIGH: 'bg-orange shadow-[0_0_8px_rgba(255,107,43,0.6)]',
    MEDIUM: 'bg-orange-2 shadow-[0_0_8px_rgba(248,165,27,0.5)]',
    LOW: 'bg-teal shadow-[0_0_6px_rgba(0,201,167,0.5)]',
  };

  return <span className={clsx('inline-block w-2.5 h-2.5 rounded-full', colors[severity], className)} />;
}

export function SeverityBadge({ severity }: { severity: Severity }) {
  const styles: Record<Severity, string> = {
    CRITICAL: 'text-red-400 bg-red-500/10 border-red-500/30',
    HIGH: 'text-orange bg-orange/10 border-orange/30',
    MEDIUM: 'text-orange-2 bg-orange-2/10 border-orange-2/30',
    LOW: 'text-teal bg-teal/10 border-teal/30',
  };

  return (
    <span className={clsx('text-[10px] font-bold uppercase px-2 py-0.5 rounded border', styles[severity])}>
      {severity}
    </span>
  );
}
