import clsx from 'clsx';
import type { AdGenerationExplanation, OptimizedAdContent } from '../../types/optimization';

function ChipList({ items, empty }: { items?: string[]; empty?: string }) {
  if (!items?.length) {
    return empty ? <p className="text-[11px] text-muted">{empty}</p> : null;
  }
  return (
    <ul className="space-y-1">
    {items.slice(0, 6).map((item, i) => (
        <li key={`${i}-${item.slice(0, 48)}`} className="text-[11px] text-white/90">
          ✓ {item}
        </li>
      ))}
    </ul>
  );
}

interface WhyThisAdWasGeneratedProps {
  optimized: OptimizedAdContent;
}

export function WhyThisAdWasGenerated({ optimized }: WhyThisAdWasGeneratedProps) {
  const explanation: AdGenerationExplanation | undefined = optimized.adGenerationExplanation;
  const score = optimized.adDifferenceScore ?? explanation?.adDifferenceScore;
  const influencers = explanation?.topCompetitorsInfluencing ?? [];

  if (!explanation && score == null) return null;

  return (
    <div className="bg-panel border border-teal/25 rounded-xl p-4 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-white text-sm font-semibold">Why This Ad Was Generated</p>
          <p className="text-muted text-[11px] mt-0.5">
            Built in order: current ad diagnosed → competitor ads noted → new RSA suggested (not a rewrite)
          </p>
        </div>
        {score != null && (
          <div className="text-right shrink-0">
            <p className="text-[10px] uppercase tracking-wider text-muted">Ad Difference Score</p>
            <p
              className={clsx(
                'text-lg font-semibold leading-none',
                score >= 90 ? 'text-teal' : score >= 70 ? 'text-amber-300' : 'text-rose-300'
              )}
            >
              {score}/100
            </p>
            <p className="text-[10px] text-muted mt-1">
              {score >= 90 ? 'Target met (90+)' : 'Below target — rewritten to differ from current ad'}
            </p>
          </div>
        )}
      </div>

      {influencers.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] uppercase tracking-wider text-purple-300">
            Top Influencing Competitors
          </p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {influencers.map((c, i) => (
              <div
                key={`${i}-${c.name}`}
                className="rounded-lg border border-border/60 bg-navy/40 px-2.5 py-2 space-y-1"
              >
                <p className="text-white text-xs font-medium truncate">{c.name}</p>
                <p className="text-teal text-[11px] font-semibold">Influence: {c.influencePercent}%</p>
                <p className="text-[11px] text-muted leading-snug">
                  <span className="text-white/70">Reason: </span>
                  {c.reason}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {explanation && (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
          <div className="rounded-lg border border-border/60 bg-white/5 px-2.5 py-2">
            <p className="text-muted text-[10px] uppercase tracking-wider mb-1">Competitor Signals Used</p>
            <ChipList items={explanation.competitorSignalsUsed} empty="—" />
          </div>
          <div className="rounded-lg border border-border/60 bg-white/5 px-2.5 py-2">
            <p className="text-muted text-[10px] uppercase tracking-wider mb-1">Offers Used</p>
            <ChipList items={explanation.offersUsed} empty="—" />
          </div>
          <div className="rounded-lg border border-border/60 bg-white/5 px-2.5 py-2">
            <p className="text-muted text-[10px] uppercase tracking-wider mb-1">Trust Signals Used</p>
            <ChipList items={explanation.trustSignalsUsed} empty="—" />
          </div>
          <div className="rounded-lg border border-border/60 bg-white/5 px-2.5 py-2">
            <p className="text-muted text-[10px] uppercase tracking-wider mb-1">Keywords Used</p>
            <ChipList items={explanation.keywordsUsed} empty="—" />
          </div>
          <div className="rounded-lg border border-border/60 bg-white/5 px-2.5 py-2">
            <p className="text-muted text-[10px] uppercase tracking-wider mb-1">Review Insights Used</p>
            <ChipList items={explanation.reviewInsightsUsed} empty="—" />
          </div>
          <div className="rounded-lg border border-border/60 bg-white/5 px-2.5 py-2">
            <p className="text-muted text-[10px] uppercase tracking-wider mb-1">Social Authority Insights</p>
            <ChipList items={explanation.socialAuthorityInsightsUsed} empty="—" />
          </div>
          <div className="rounded-lg border border-border/60 bg-white/5 px-2.5 py-2 sm:col-span-2 lg:col-span-3">
            <p className="text-muted text-[10px] uppercase tracking-wider mb-1">Market Positioning Used</p>
            <ChipList items={explanation.marketPositioningUsed} empty="—" />
          </div>
        </div>
      )}
    </div>
  );
}
