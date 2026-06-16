import clsx from 'clsx';
import type { PreviewDevice } from '../../types/optimization';

interface AdPreviewPanelProps {
  headlines: string[];
  descriptions: string[];
  displayUrl?: string;
  device: PreviewDevice;
  onDeviceChange: (d: PreviewDevice) => void;
  variant?: 'current' | 'optimized';
}

export function AdPreviewPanel({
  headlines,
  descriptions,
  displayUrl = 'www.example.com',
  device,
  onDeviceChange,
  variant = 'optimized',
}: AdPreviewPanelProps) {
  const headline = headlines[0] ?? 'Your Headline Here';
  const headline2 = headlines[1] ?? '';
  const description = descriptions[0] ?? 'Your ad description will appear here.';

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-muted text-xs uppercase tracking-wider">
          {variant === 'optimized' ? 'AI Preview' : 'Current Ad'}
        </span>
        <div className="flex gap-1 bg-navy rounded-lg p-0.5 border border-border">
          {(['mobile', 'desktop'] as PreviewDevice[]).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => onDeviceChange(d)}
              className={clsx(
                'px-2.5 py-1 rounded-md text-[10px] font-semibold capitalize transition-colors',
                device === d ? 'bg-orange/20 text-orange' : 'text-muted hover:text-white'
              )}
            >
              {d}
            </button>
          ))}
        </div>
      </div>

      <div
        className={clsx(
          'rounded-xl border transition-all duration-300',
          variant === 'optimized'
            ? 'border-teal/40 bg-gradient-to-br from-teal/5 to-navy glow-teal'
            : 'border-border bg-navy/50',
          device === 'mobile' ? 'max-w-[280px] mx-auto p-3' : 'p-4'
        )}
      >
        <div className="flex items-center gap-1 mb-1">
          <span className="text-[10px] font-bold text-teal bg-teal/10 px-1 rounded">Ad</span>
          <span className="text-muted text-[10px] truncate">{displayUrl}</span>
        </div>
        <div className={clsx('text-blue-400 font-medium leading-snug mb-1', device === 'mobile' ? 'text-sm' : 'text-base')}>
          {headline}
          {headline2 && ` · ${headline2}`}
        </div>
        <p className={clsx('text-muted leading-relaxed', device === 'mobile' ? 'text-[11px]' : 'text-xs')}>
          {description}
        </p>
        {device === 'desktop' && descriptions[1] && (
          <p className="text-muted text-xs mt-1 leading-relaxed">{descriptions[1]}</p>
        )}
      </div>

      {variant === 'optimized' && headlines.length > 1 && (
        <div className="flex flex-wrap gap-1">
          {headlines.slice(0, 4).map((h, i) => (
            <span key={i} className="text-[10px] bg-panel border border-border rounded px-2 py-0.5 text-muted truncate max-w-[120px]">
              H{i + 1}: {h}
            </span>
          ))}
          {headlines.length > 4 && (
            <span className="text-[10px] text-orange">+{headlines.length - 4} more</span>
          )}
        </div>
      )}
    </div>
  );
}
