import { ExternalLink } from 'lucide-react';
import { AdPreviewPanel } from './AdPreviewPanel';
import { decodeHtmlEntitiesList } from './html-entities';
import type { CompetitorAdPreview, PreviewDevice } from '../../types/optimization';

interface CompetitorAdGalleryProps {
  competitors: CompetitorAdPreview[];
  previewDevice: PreviewDevice;
  onDeviceChange: (d: PreviewDevice) => void;
  source?: string;
}

export function CompetitorAdGallery({
  competitors,
  previewDevice,
  onDeviceChange,
  source,
}: CompetitorAdGalleryProps) {
  if (!competitors.length) return null;

  const viaSociaVault = source === 'sociavault' || competitors.some((c) => c.adSource === 'sociavault');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-white text-sm font-semibold">Competitor Ad Gallery</p>
          <p className="text-muted text-[11px] mt-0.5">
            {viaSociaVault
              ? 'Exact competitor ads from Google Ads Transparency Center via SociaVault'
              : 'Live ads from Google Ads Transparency Center'}
          </p>
        </div>
        <span className="text-muted text-[10px] uppercase tracking-wider">
          {competitors.length} Competitor{competitors.length === 1 ? '' : 's'}
        </span>
      </div>

      <div className="flex gap-4 overflow-x-auto pb-2 snap-x snap-mandatory">
        {competitors.map((c) => {
          const headlines = decodeHtmlEntitiesList(c.headlines).slice(0, 1);
          const descriptions = decodeHtmlEntitiesList(c.descriptions).slice(0, 1);
          const adLink = c.adLink ?? c.creativeUrl ?? c.transparencyUrl;

          return (
            <div
              key={`${c.url}-${c.name}-${adLink ?? ''}`}
              className="min-w-[300px] max-w-[340px] shrink-0 snap-start bg-panel border border-purple-400/25 rounded-2xl p-4 space-y-3"
            >
              <div className="space-y-1">
                <h3 className="text-white text-sm font-semibold flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-purple-400" />
                  {c.advertiserName ?? c.name}
                </h3>
                <span className="text-[9px] px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-300 border border-purple-400/20 inline-block">
                  Google Ads Transparency Center
                </span>
              </div>

              {c.previewImageUrl && !headlines.length && (
                <a href={adLink} target="_blank" rel="noopener noreferrer" className="block">
                  <img
                    src={c.previewImageUrl}
                    alt={`${c.name} ad preview`}
                    className="w-full rounded-lg border border-border object-contain max-h-44 bg-white/5 hover:opacity-90 transition-opacity"
                  />
                </a>
              )}

              {(headlines.length > 0 || descriptions.length > 0) && (
                <AdPreviewPanel
                  headlines={headlines}
                  descriptions={descriptions}
                  displayUrl={c.displayUrl}
                  device={previewDevice}
                  onDeviceChange={onDeviceChange}
                  variant="competitor"
                  finalUrl={c.url}
                  simpleAdView
                />
              )}

              {adLink && (
                <a
                  href={adLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] text-purple-300 hover:text-purple-200 flex items-start gap-1.5 break-all border-t border-border/50 pt-2"
                >
                  <ExternalLink size={12} className="shrink-0 mt-0.5" />
                  <span>
                    View competitor ad on Transparency Center
                    <span className="block text-[9px] text-muted mt-0.5 font-mono">{adLink}</span>
                  </span>
                </a>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
