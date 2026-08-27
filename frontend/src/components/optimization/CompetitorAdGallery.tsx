import { ExternalLink } from 'lucide-react';
import { AdPreviewPanel } from './AdPreviewPanel';
import { CompetitorAdActivityMetrics, CompetitorBrandReviewBlock } from './CompetitorBrandMetrics';
import { decodeHtmlEntitiesList } from './html-entities';
import { competitorCreativeMatchesService } from '../../utils/serviceRelevance';
import { competitorIdentityKey } from '../../utils/competitorGalleryDisplay';
import type { CompetitorAdPreview, PreviewDevice } from '../../types/optimization';

const MAX_COMPETITORS = 6;
const MAX_ADS_PER_COMPETITOR = 8;

interface CompetitorAdGalleryProps {
  competitors: CompetitorAdPreview[];
  previewDevice: PreviewDevice;
  onDeviceChange: (d: PreviewDevice) => void;
  source?: string;
  /** When set (ad-level optimize), hide creatives that are not about this service */
  primaryService?: string;
}

function isDisplayableAd(c: CompetitorAdPreview): boolean {
  return (
    (c.totalAdCount ?? 0) > 0 ||
    (c.adDurationDays ?? 0) > 0 ||
    (c.headlines?.length ?? 0) > 0 ||
    (c.descriptions?.length ?? 0) > 0 ||
    Boolean(c.previewImageUrl)
  );
}

export function CompetitorAdGallery({
  competitors,
  previewDevice,
  onDeviceChange,
  source: _source,
  primaryService,
}: CompetitorAdGalleryProps) {
  const byKey = new Map<string, CompetitorAdPreview[]>();
  for (const item of competitors) {
    if (!isDisplayableAd(item)) continue;
    if (!competitorCreativeMatchesService(item, primaryService)) continue;
    const key = competitorIdentityKey(item);
    const list = byKey.get(key) ?? [];
    list.push(item);
    byKey.set(key, list);
  }

  const gallery = [...byKey.entries()]
    .map(([key, ads]) => {
      const primary = [...ads].sort(
        (a, b) =>
          (b.confidenceScore ?? 0) - (a.confidenceScore ?? 0) ||
          (b.adDurationDays ?? 0) - (a.adDurationDays ?? 0) ||
          (b.activeAdCount ?? 0) - (a.activeAdCount ?? 0)
      )[0]!;
      return { key, primary, ads: ads.slice(0, MAX_ADS_PER_COMPETITOR) };
    })
    .sort(
      (a, b) =>
        b.ads.length - a.ads.length ||
        (b.primary.adDurationDays ?? 0) - (a.primary.adDurationDays ?? 0)
    )
    .slice(0, MAX_COMPETITORS);

  if (!gallery.length) {
    const serviceLabel = primaryService?.trim() || 'this service';
    return (
      <div className="bg-panel border border-purple-400/20 rounded-xl p-4">
        <p className="text-white text-sm font-semibold">Competitor Ad Gallery</p>
        <p className="text-muted text-[11px] mt-1">
          No competitor creatives were returned for{' '}
          <span className="text-white">{serviceLabel}</span> yet. Re-run Make It Better to retry
          discovery for this service.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-white text-sm font-semibold">Competitor Ad Gallery</p>
          <p className="text-muted text-[11px] mt-0.5">
            Live competitor creatives for every discovered advertiser.
          </p>
        </div>
        <span className="text-muted text-[10px] uppercase tracking-wider">
          {gallery.length} competitor{gallery.length === 1 ? '' : 's'}
          {' · '}
          {gallery.reduce((n, g) => n + g.ads.length, 0)} relevant ads
        </span>
      </div>

      <div className="grid sm:grid-cols-2 xl:grid-cols-2 gap-4">
        {gallery.map(({ key, primary: c, ads }) => {
          const sourceLabel =
            c.adSource === 'transparency_center'
              ? 'Public ad library'
              : c.adSource === 'sociavault'
                ? 'Live competitor ad'
                : c.adSource === 'website_fallback'
                  ? 'Website fallback'
                  : 'Live competitor ad';

          return (
            <div
              key={key}
              className="min-w-0 bg-panel border border-purple-400/25 rounded-2xl p-4 space-y-3"
            >
              <div className="space-y-1">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-white text-sm font-semibold flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-purple-400" />
                    {c.advertiserName ?? c.name}
                  </h3>
                  {c.confidenceScore != null && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-teal/10 text-teal border border-teal/25 shrink-0">
                      {c.confidenceScore}/100
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <span
                    className={`text-[9px] px-2 py-0.5 rounded-full border inline-block ${
                      c.adSource === 'website_fallback'
                        ? 'bg-amber-500/10 text-amber-300 border-amber-400/20'
                        : 'bg-purple-500/10 text-purple-300 border-purple-400/20'
                    }`}
                  >
                    {sourceLabel}
                  </span>
                  <span className="text-[9px] px-2 py-0.5 rounded-full bg-white/5 text-muted border border-border inline-block">
                    {ads.length} relevant ad{ads.length === 1 ? '' : 's'}
                  </span>
                </div>
              </div>

              <CompetitorAdActivityMetrics
                adDurationDays={c.adDurationDays}
                activeAdCount={c.activeAdCount}
                totalAdCount={c.totalAdCount}
                firstShown={c.firstShown}
                lastShown={c.lastShown}
              />

              {c.brandReview && <CompetitorBrandReviewBlock review={c.brandReview} />}

              {ads.map((ad, adIdx) => {
                const headlines = decodeHtmlEntitiesList(ad.headlines ?? []);
                const descriptions = decodeHtmlEntitiesList(ad.descriptions ?? []);
                const adLink = ad.adLink ?? ad.creativeUrl ?? ad.transparencyUrl;
                return (
                  <div
                    key={`${key}-ad-${adIdx}`}
                    className="rounded-lg border border-border/60 bg-panel/30 p-2 space-y-2"
                  >
                    <p className="text-[10px] text-muted uppercase tracking-wide">
                      Ad {adIdx + 1}
                    </p>
                    {(headlines.length > 0 || descriptions.length > 0) ? (
                      <AdPreviewPanel
                        headlines={headlines}
                        descriptions={descriptions}
                        displayUrl={ad.displayUrl ?? c.displayUrl}
                        device={previewDevice}
                        onDeviceChange={onDeviceChange}
                        variant="competitor"
                        finalUrl={ad.destinationUrl ?? ad.url ?? c.destinationUrl ?? c.url}
                        simpleAdView
                      />
                    ) : ad.previewImageUrl ? (
                      <a href={adLink} target="_blank" rel="noopener noreferrer" className="block">
                        <img
                          src={ad.previewImageUrl}
                          alt={`${c.name} ad ${adIdx + 1}`}
                          className="w-full rounded-lg border border-border object-contain max-h-44 bg-white/5"
                        />
                      </a>
                    ) : (
                      <p className="text-muted text-[10px] italic">No live ad copy for this creative.</p>
                    )}
                    {adLink && (
                      <a
                        href={adLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[10px] text-teal underline block"
                      >
                        View this ad →
                      </a>
                    )}
                  </div>
                );
              })}

              {(c.destinationUrl || (c.url && !/adstransparency\.google\.com/i.test(c.url))) && (
                <a
                  href={(c.destinationUrl ?? c.url).startsWith('http')
                    ? (c.destinationUrl ?? c.url)
                    : `https://${c.destinationUrl ?? c.url}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] text-teal hover:text-teal/80 flex items-start gap-1.5 break-all"
                >
                  <ExternalLink size={12} className="shrink-0 mt-0.5" />
                  <span>
                    Destination URL
                    <span className="block text-[9px] text-muted mt-0.5 font-mono">
                      {c.destinationUrl ?? c.url}
                    </span>
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
