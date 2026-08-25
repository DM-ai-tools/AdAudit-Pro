import { ExternalLink } from 'lucide-react';
import { AdPreviewPanel } from './AdPreviewPanel';
import { CompetitorAdActivityMetrics, CompetitorBrandReviewBlock } from './CompetitorBrandMetrics';
import { decodeHtmlEntitiesList } from './html-entities';
import { competitorCreativeMatchesService } from '../../utils/serviceRelevance';
import {
  collapseCompetitorsToOne,
  competitorIdentityKey,
} from '../../utils/competitorGalleryDisplay';
import type { CompetitorAdPreview, PreviewDevice } from '../../types/optimization';

interface CompetitorAdGalleryProps {
  competitors: CompetitorAdPreview[];
  previewDevice: PreviewDevice;
  onDeviceChange: (d: PreviewDevice) => void;
  source?: string;
  /** When set (ad-level optimize), hide creatives that are not about this service */
  primaryService?: string;
}

export function CompetitorAdGallery({
  competitors,
  previewDevice,
  onDeviceChange,
  source: _source,
  primaryService,
}: CompetitorAdGalleryProps) {
  const gallery = collapseCompetitorsToOne(competitors)
    .filter(
      (c) =>
        (c.totalAdCount ?? 0) > 0 ||
        (c.adDurationDays ?? 0) > 0 ||
        (c.headlines?.length ?? 0) > 0 ||
        (c.descriptions?.length ?? 0) > 0 ||
        Boolean(c.previewImageUrl)
    )
    .filter((c) => competitorCreativeMatchesService(c, primaryService));
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
          {gallery.length} Competitor{gallery.length === 1 ? '' : 's'}
        </span>
      </div>

      <div className="grid sm:grid-cols-2 xl:grid-cols-2 gap-4">
        {gallery.map((c) => {
          const headlines = decodeHtmlEntitiesList(c.headlines);
          const descriptions = decodeHtmlEntitiesList(c.descriptions);
          const adLink = c.adLink ?? c.creativeUrl ?? c.transparencyUrl;
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
              key={competitorIdentityKey(c)}
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
                  {c.durationLabel && (
                    <span className="text-[9px] px-2 py-0.5 rounded-full bg-teal/10 text-teal border border-teal/20 inline-block">
                      {c.durationLabel}
                    </span>
                  )}
                  {c.influencePercent != null && (
                    <span className="text-[9px] px-2 py-0.5 rounded-full bg-orange/10 text-orange border border-orange/20 inline-block">
                      {c.influencePercent}% AI influence
                    </span>
                  )}
                  {c.estimatedSuccessScore != null && (
                    <span className="text-[9px] px-2 py-0.5 rounded-full bg-white/5 text-muted border border-border inline-block">
                      Est. success {c.estimatedSuccessScore}/100
                    </span>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-1.5 text-[10px]">
                <div className="rounded-lg border border-border bg-white/5 px-2 py-1">
                  <p className="text-muted uppercase tracking-wider">First Seen</p>
                  <p className="text-white">
                    {(c.creativeFirstShown ?? c.firstShown)
                      ? new Date(c.creativeFirstShown ?? c.firstShown!).toLocaleDateString()
                      : '—'}
                  </p>
                </div>
                <div className="rounded-lg border border-border bg-white/5 px-2 py-1">
                  <p className="text-muted uppercase tracking-wider">Last Seen</p>
                  <p className="text-white">
                    {(c.creativeLastShown ?? c.lastShown)
                      ? new Date(c.creativeLastShown ?? c.lastShown!).toLocaleDateString()
                      : '—'}
                  </p>
                </div>
                <div className="rounded-lg border border-border bg-white/5 px-2 py-1">
                  <p className="text-muted uppercase tracking-wider">Active Status</p>
                  <p className={c.isActive ? 'text-teal' : 'text-muted'}>
                    {c.isActive ? 'Active (≤45 days)' : 'Inactive / aging'}
                  </p>
                </div>
                <div className="rounded-lg border border-border bg-white/5 px-2 py-1">
                  <p className="text-muted uppercase tracking-wider">Ad Duration</p>
                  <p className="text-white">
                    {c.adDurationDays
                      ? `${c.adDurationDays.toLocaleString('en-US')} Days`
                      : '—'}
                  </p>
                </div>
              </div>

              {(c.cta || c.offer) && c.adSource !== 'website_fallback' && (
                <div className="flex flex-wrap gap-1.5">
                  {c.cta && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-orange/10 text-orange border border-orange/25">
                      CTA: {c.cta}
                    </span>
                  )}
                  {c.offer && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-teal/10 text-teal border border-teal/25">
                      Offer: {c.offer}
                    </span>
                  )}
                </div>
              )}

              <CompetitorAdActivityMetrics
                adDurationDays={c.adDurationDays}
                activeAdCount={c.activeAdCount}
                totalAdCount={c.totalAdCount}
                firstShown={c.firstShown}
                lastShown={c.lastShown}
              />

              {c.brandReview && <CompetitorBrandReviewBlock review={c.brandReview} />}

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
                <div className="space-y-2">
                  <AdPreviewPanel
                    headlines={headlines}
                    descriptions={descriptions}
                    displayUrl={c.displayUrl}
                    device={previewDevice}
                    onDeviceChange={onDeviceChange}
                    variant="competitor"
                    finalUrl={c.destinationUrl ?? c.url}
                    simpleAdView
                  />
                  <div className="rounded-lg border border-border/60 bg-navy/40 px-2.5 py-2 space-y-1.5">
                    <p className="text-[9px] text-muted uppercase tracking-wider">
                      Exact creative copy ({headlines.length} headline
                      {headlines.length === 1 ? '' : 's'}, {descriptions.length} description
                      {descriptions.length === 1 ? '' : 's'})
                    </p>
                    {headlines.length > 0 && (
                      <ol className="list-decimal list-inside space-y-0.5">
                        {headlines.map((h, hi) => (
                          <li key={`h-${hi}`} className="text-[11px] text-white leading-snug">
                            {h}
                          </li>
                        ))}
                      </ol>
                    )}
                    {descriptions.length > 0 && (
                      <ul className="space-y-0.5 border-t border-border/40 pt-1.5">
                        {descriptions.map((d, di) => (
                          <li key={`d-${di}`} className="text-[11px] text-muted leading-snug">
                            {d}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              )}

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

              {adLink && (
                <a
                  href={adLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] text-purple-300 hover:text-purple-200 flex items-start gap-1.5 break-all border-t border-border/50 pt-2"
                >
                  <ExternalLink size={12} className="shrink-0 mt-0.5" />
                  <span>
                    View live competitor ad
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
