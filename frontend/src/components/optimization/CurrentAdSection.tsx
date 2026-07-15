import { AdPreviewPanel } from './AdPreviewPanel';
import type { CurrentAdData, PreviewDevice } from '../../types/optimization';

interface CurrentAdSectionProps {
  originalAd: CurrentAdData | null;
  displayUrl: string;
  finalUrl?: string;
  previewDevice: PreviewDevice;
  onDeviceChange: (d: PreviewDevice) => void;
  title?: string;
}

export function CurrentAdSection({
  originalAd,
  displayUrl,
  finalUrl,
  previewDevice,
  onDeviceChange,
  title = 'Current Ad',
}: CurrentAdSectionProps) {
  return (
    <div className="bg-panel border border-red-500/25 rounded-2xl p-5 space-y-4">
      <h3 className="text-white font-semibold flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-red-400" />
        {title}
      </h3>
      <AdPreviewPanel
        headlines={(originalAd?.headlines ?? []).slice(0, 1)}
        descriptions={(originalAd?.descriptions ?? []).slice(0, 1)}
        displayUrl={displayUrl}
        displayPaths={{
          path1: originalAd?.displayPath1,
          path2: originalAd?.displayPath2,
        }}
        device={previewDevice}
        onDeviceChange={onDeviceChange}
        variant="current"
        finalUrl={finalUrl}
        simpleAdView
      />
      {originalAd && (
        <div className="grid grid-cols-3 gap-2 text-center text-xs max-w-md">
          {[
            { l: 'CTR', v: originalAd.ctr != null ? `${originalAd.ctr}%` : '—' },
            {
              l: originalAd.qualityScore != null ? 'Campaign QS' : 'QS',
              v: originalAd.qualityScore != null ? String(originalAd.qualityScore) : '—',
            },
            { l: 'Strength', v: originalAd.adStrength ?? '—' },
          ].map((m) => (
            <div key={m.l} className="bg-navy rounded-lg p-2 border border-border">
              <div className="text-muted text-[10px]">{m.l}</div>
              <div className="text-white font-bold">{m.v}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
