import type { CompetitorBrandReview } from '../../types/optimization';

function formatDateLabel(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function CompetitorAdActivityMetrics(props: {
  adDurationDays?: number;
  activeAdCount?: number;
  totalAdCount?: number;
  firstShown?: string;
  lastShown?: string;
  compact?: boolean;
}) {
  const {
    adDurationDays,
    activeAdCount,
    totalAdCount,
    firstShown,
    lastShown,
    compact = false,
  } = props;

  const hasLibraryData = (totalAdCount ?? 0) > 0 || (adDurationDays ?? 0) > 0;
  const duration = adDurationDays ?? 0;
  const active = activeAdCount ?? 0;
  const total = totalAdCount ?? 0;

  return (
    <div className={compact ? 'space-y-1.5' : 'space-y-2'}>
      <p className="text-[10px] uppercase tracking-wider text-purple-300/90 font-medium">
        Ad activity
      </p>
      {!hasLibraryData ? (
        <div className="rounded-lg border border-border bg-white/5 px-2.5 py-2">
          <p className="text-muted text-[11px] leading-relaxed">
            No public ad-library data found for this competitor yet. Metrics appear once live creatives are returned.
          </p>
        </div>
      ) : (
      <div className="grid grid-cols-1 gap-1.5">
        <div className="rounded-lg border border-teal/25 bg-teal/5 px-2.5 py-1.5">
          <p className="text-[10px] text-teal uppercase tracking-wider">Ad duration</p>
          <p className="text-white text-xs font-medium">
            {duration > 0 ? `${duration.toLocaleString('en-US')} Days` : 'Not available'}
          </p>
          <p className="text-[10px] text-muted leading-snug mt-0.5">
            Days from earliest first shown → latest last shown
            {firstShown || lastShown
              ? ` (${formatDateLabel(firstShown)} → ${formatDateLabel(lastShown)})`
              : ''}
          </p>
        </div>
        <div className="rounded-lg border border-orange/25 bg-orange/5 px-2.5 py-1.5">
          <p className="text-[10px] text-orange uppercase tracking-wider">Active ads</p>
          <p className="text-white text-xs font-medium">
            {active} creative{active === 1 ? '' : 's'}
          </p>
          <p className="text-[10px] text-muted leading-snug mt-0.5">
            Creatives with lastShown in the last ~45 days
          </p>
        </div>
        <div className="rounded-lg border border-border bg-white/5 px-2.5 py-1.5">
          <p className="text-[10px] text-muted uppercase tracking-wider">Total ads</p>
          <p className="text-white text-xs font-medium">
            {total} creative{total === 1 ? '' : 's'}
          </p>
          <p className="text-[10px] text-muted leading-snug mt-0.5">
            All creatives in the public ad library
          </p>
        </div>
      </div>
      )}
    </div>
  );
}

export function CompetitorBrandReviewBlock({
  review,
  expanded = true,
}: {
  review: CompetitorBrandReview;
  expanded?: boolean;
}) {
  const positive = review.positiveThemes?.length ? review.positiveThemes : review.strengths?.slice(0, 4);
  const negative = review.negativeThemes?.length ? review.negativeThemes : review.weaknesses?.slice(0, 3);

  return (
    <div className="space-y-2 border-t border-border/50 pt-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] uppercase tracking-wider text-white/80 font-medium">Brand review</p>
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/5 text-muted border border-border">
          Score {review.score}/100
        </span>
      </div>

      <div className="grid grid-cols-2 gap-1.5 text-[11px]">
        {review.averageRating != null && (
          <div className="rounded-lg border border-border bg-white/5 px-2 py-1">
            <p className="text-[10px] text-muted uppercase tracking-wider">Verified rating</p>
            <p className="text-white">{review.averageRating}/5</p>
          </div>
        )}
        {review.reviewCount != null && review.reviewCount > 0 && (
          <div className="rounded-lg border border-border bg-white/5 px-2 py-1">
            <p className="text-[10px] text-muted uppercase tracking-wider">Reviews</p>
            <p className="text-white">{review.reviewCount.toLocaleString()}</p>
          </div>
        )}
        {review.trustScore != null && (
          <div className="rounded-lg border border-border bg-white/5 px-2 py-1">
            <p className="text-[10px] text-muted uppercase tracking-wider">Ad trust</p>
            <p className="text-white">{review.trustScore}/100</p>
          </div>
        )}
        {review.sentiment && review.sentiment !== 'Unknown' && (
          <div className="rounded-lg border border-border bg-white/5 px-2 py-1">
            <p className="text-[10px] text-muted uppercase tracking-wider">Sentiment</p>
            <p className="text-white">{review.sentiment}</p>
          </div>
        )}
      </div>

      <p className="text-[11px] text-white/90 leading-relaxed">{review.summary}</p>

      {positive && positive.length > 0 && (
        <div>
          <p className="text-teal text-[10px] uppercase tracking-wider mb-0.5">Top positive themes</p>
          <ul className="text-[11px] text-muted space-y-0.5">
            {positive.slice(0, 4).map((s, i) => (
              <li key={i} className="break-words">✓ {s}</li>
            ))}
          </ul>
        </div>
      )}
      {negative && negative.length > 0 && (
        <div>
          <p className="text-orange text-[10px] uppercase tracking-wider mb-0.5">Top negative themes</p>
          <ul className="text-[11px] text-muted space-y-0.5">
            {negative.slice(0, 3).map((w, i) => (
              <li key={i} className="break-words">✗ {w}</li>
            ))}
          </ul>
        </div>
      )}

      {expanded && (
        <>
          {review.detailedReview && (
            <div>
              <p className="text-white/70 text-[10px] uppercase tracking-wider mb-0.5">Detailed brand review</p>
              <p className="text-[11px] text-muted leading-relaxed whitespace-pre-line">{review.detailedReview}</p>
            </div>
          )}
          {review.adActivityReview && (
            <div>
              <p className="text-teal text-[10px] uppercase tracking-wider mb-0.5">Ad activity</p>
              <p className="text-[11px] text-muted leading-relaxed">{review.adActivityReview}</p>
            </div>
          )}
          {review.messagingReview && (
            <div>
              <p className="text-orange text-[10px] uppercase tracking-wider mb-0.5">Messaging</p>
              <p className="text-[11px] text-muted leading-relaxed">{review.messagingReview}</p>
            </div>
          )}
          {review.trustReview && (
            <div>
              <p className="text-orange text-[10px] uppercase tracking-wider mb-0.5">Trust & proof</p>
              <p className="text-[11px] text-muted leading-relaxed">{review.trustReview}</p>
            </div>
          )}
          {review.offerReview && (
            <div>
              <p className="text-orange text-[10px] uppercase tracking-wider mb-0.5">Offers</p>
              <p className="text-[11px] text-muted leading-relaxed">{review.offerReview}</p>
            </div>
          )}
          {review.howToBeat?.length > 0 && (
            <div>
              <p className="text-teal text-[10px] uppercase tracking-wider mb-0.5">How to beat them</p>
              <ul className="text-[11px] text-muted space-y-0.5">
                {review.howToBeat.map((h, i) => (
                  <li key={i} className="break-words">• {h}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
