import { ExternalLink } from 'lucide-react';
import { AdPreviewPanel } from './AdPreviewPanel';
import { CompetitorAdActivityMetrics, CompetitorBrandReviewBlock } from './CompetitorBrandMetrics';
import { decodeHtmlEntitiesList } from './html-entities';
import { competitorCreativeMatchesService } from '../../utils/serviceRelevance';
import type { CompetitorAdPreview, PreviewDevice } from '../../types/optimization';

interface CompetitorAdGalleryProps {
  competitors: CompetitorAdPreview[];
  previewDevice: PreviewDevice;
  onDeviceChange: (d: PreviewDevice) => void;
  source?: string;
  /** When set (ad-level optimize), hide creatives that are not about this service */
  primaryService?: string;
}

function galleryDedupeKey(c: CompetitorAdPreview): string {
  const creative = (c.creativeUrl ?? c.adLink ?? '').toLowerCase().trim();
  if (creative) return `creative:${creative}`;
  const adv =
    c.advertiserId ||
    (c.transparencyUrl ?? c.url)?.match(/advertiser\/(AR[\w-]+)/i)?.[1];
  if (adv) return `adv:${adv.toLowerCase()}`;
  const name = (c.advertiserName ?? c.name).toLowerCase().trim();
  const host = (c.displayUrl ?? c.url).replace(/^https?:\/\//, '').split('/')[0]?.toLowerCase() ?? '';
  if (host && !/adstransparency\.google\.com$/i.test(host)) return `host:${host}`;
  return `name:${name}`;
}

function dedupeCompetitors(competitors: CompetitorAdPreview[]): CompetitorAdPreview[] {
  const out: CompetitorAdPreview[] = [];
  const seen = new Set<string>();
  for (const c of competitors) {
    const key = galleryDedupeKey(c);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

export function CompetitorAdGallery({
  competitors,
  previewDevice,
  onDeviceChange,
  source,
  primaryService,
}: CompetitorAdGalleryProps) {
  // Only show real SociaVault / Transparency creatives — never empty stubs
  const gallery = dedupeCompetitors(competitors).filter(
    (c) =>
      ((c.totalAdCount ?? 0) > 0 ||
        c.headlines?.length > 0 ||
        c.descriptions?.length > 0 ||
        Boolean(c.previewImageUrl)) &&
      competitorCreativeMatchesService(c, primaryService)
  );
  if (!gallery.length) {
    return (
      <div className="bg-panel border border-purple-400/20 rounded-xl p-4">
        <p className="text-white text-sm font-semibold">Competitor Ad Gallery</p>
        <p className="text-muted text-[11px] mt-1">
          No service-matched Google Ads Transparency creatives were returned for this ad yet. Re-run Make It Better — SociaVault discovery will retry car/auto finance advertisers and known market domains.
        </p>
      </div>
    );
  }

  const viaSociaVault = source === 'sociavault' || gallery.some((c) => c.adSource === 'sociavault');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-white text-sm font-semibold">Competitor Ad Gallery</p>
          <p className="text-muted text-[11px] mt-0.5">
            {viaSociaVault
              ? 'Each competitor shows Ad duration, Active ads, Total ads, and a detailed brand review from SociaVault'
              : 'Live ads from Google Ads Transparency Center'}
          </p>
        </div>
        <span className="text-muted text-[10px] uppercase tracking-wider">
          {gallery.length} Competitor{gallery.length === 1 ? '' : 's'}
        </span>
      </div>

      <div className="grid sm:grid-cols-2 xl:grid-cols-2 gap-4">
        {gallery.map((c, idx) => {
          const headlines = decodeHtmlEntitiesList(c.headlines);
          const descriptions = decodeHtmlEntitiesList(c.descriptions);
          const adLink = c.adLink ?? c.creativeUrl ?? c.transparencyUrl;

          return (
            <div
              key={`${galleryDedupeKey(c)}-${idx}`}
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
                  <span className="text-[9px] px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-300 border border-purple-400/20 inline-block">
                    Google Ads Transparency Center
                  </span>
                  {c.durationLabel && (
                    <span className="text-[9px] px-2 py-0.5 rounded-full bg-teal/10 text-teal border border-teal/20 inline-block">
                      {c.durationLabel}
                    </span>
                  )}
                  {c.influencePercent != null && (
                    <span className="text-[9px] px-2 py-0.5 rounded-full bg-orange/10 text-orange border border-orange/20 inline-block">
                      {c.influencePercent}% Claude influence
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

              {(c.cta || c.offer || c.ctas?.[0] || c.offers?.[0]) && (
                <div className="flex flex-wrap gap-1.5">
                  {(c.cta || c.ctas?.[0]) && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-orange/10 text-orange border border-orange/25">
                      CTA: {c.cta || c.ctas?.[0]}
                    </span>
                  )}
                  {(c.offer || c.offers?.[0]) && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-teal/10 text-teal border border-teal/25">
                      Offer: {c.offer || c.offers?.[0]}
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
                <AdPreviewPanel
                  headlines={headlines.slice(0, 3)}
                  descriptions={descriptions.slice(0, 2)}
                  displayUrl={c.displayUrl}
                  device={previewDevice}
                  onDeviceChange={onDeviceChange}
                  variant="competitor"
                  finalUrl={c.destinationUrl ?? c.url}
                  simpleAdView
                />
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
