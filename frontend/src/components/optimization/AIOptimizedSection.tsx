import clsx from 'clsx';
import { AdPreviewPanel } from './AdPreviewPanel';
import type { OptimizedAdContent, PreviewDevice } from '../../types/optimization';

interface AIOptimizedSectionProps {
  optimized: OptimizedAdContent;
  headlines: string[];
  descriptions: string[];
  displayUrl: string;
  finalUrl?: string;
  previewDevice: PreviewDevice;
  onDeviceChange: (d: PreviewDevice) => void;
  adCopyOptions?: Array<{ id: string; label: string; content: OptimizedAdContent }>;
  selectedCopyId?: string;
  onSelectCopy?: (id: string) => void;
}

export function AIOptimizedSection({
  optimized,
  headlines,
  descriptions,
  displayUrl,
  finalUrl,
  previewDevice,
  onDeviceChange,
  adCopyOptions,
  selectedCopyId,
  onSelectCopy,
}: AIOptimizedSectionProps) {
  return (
    <div className="bg-panel border border-teal/30 rounded-2xl p-5 space-y-4 glow-teal">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-white font-semibold flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-teal animate-pulse" />
          AI Optimized Ad
          {adCopyOptions && adCopyOptions.length > 1 && (
            <span className="text-[10px] font-normal text-muted">
              ({adCopyOptions.length} copies)
            </span>
          )}
        </h3>
        <div className="flex items-center gap-2">
          {optimized.adDifferenceScore != null && (
            <span
              className={
                optimized.adDifferenceScore >= 80
                  ? 'text-[10px] px-2 py-0.5 rounded-full border border-teal/40 text-teal bg-teal/10'
                  : 'text-[10px] px-2 py-0.5 rounded-full border border-amber-400/40 text-amber-300 bg-amber-400/10'
              }
            >
              Difference {optimized.adDifferenceScore}/100
            </span>
          )}
          <span className="text-[10px] uppercase tracking-wider text-teal/80">Recommended for publish</span>
        </div>
      </div>

      {adCopyOptions && adCopyOptions.length > 1 && onSelectCopy && (
        <div className="flex flex-wrap gap-2">
          {adCopyOptions.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => onSelectCopy(opt.id)}
              className={clsx(
                'px-3 py-1.5 rounded-full text-[11px] font-medium border transition-colors text-left',
                selectedCopyId === opt.id
                  ? 'border-teal/50 bg-teal/15 text-teal'
                  : 'border-border bg-navy/60 text-muted hover:text-white hover:border-teal/30'
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}

      <AdPreviewPanel
        headlines={headlines}
        descriptions={descriptions}
        displayUrl={displayUrl}
        displayPaths={optimized.displayPaths}
        sitelinks={optimized.adExtensions?.sitelinks}
        callouts={optimized.adExtensions?.callouts}
        structuredSnippets={optimized.adExtensions?.structuredSnippets}
        device={previewDevice}
        onDeviceChange={onDeviceChange}
        variant="optimized"
        finalUrl={finalUrl}
      />

      {descriptions.length > 0 && (
        <div className="space-y-2 bg-navy/40 border border-border rounded-lg p-3">
          <p className="text-[10px] text-muted uppercase tracking-wider">Full ad descriptions (RSA)</p>
          {descriptions.map((d, i) => (
            <p key={i} className="text-xs text-white leading-relaxed break-words">
              <span className="text-teal font-semibold">D{i + 1}:</span> {d}
              <span className="text-muted ml-1">({d.length}/90)</span>
            </p>
          ))}
        </div>
      )}

      <p className="text-muted text-xs leading-relaxed bg-teal/5 border border-teal/20 rounded-lg p-3">
        {optimized.improvementReasoning}
      </p>

      {optimized.campaignStrategy && (
        <div className="bg-purple-500/5 border border-purple-400/20 rounded-lg p-3 space-y-2">
          <p className="text-purple-300 text-xs font-semibold uppercase tracking-wide">Recommended Campaign Strategy</p>
          {optimized.campaignStrategy.campaignName && (
            <p className="text-white text-sm font-medium">{optimized.campaignStrategy.campaignName}</p>
          )}
          {(optimized.campaignStrategy?.adGroups ?? []).map((ag, i) => (
            <div key={i} className="text-xs text-muted">
              <span className="text-white">{ag.name}</span>
              {ag.keywords?.length ? `: ${ag.keywords.slice(0, 6).join(', ')}` : ''}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
