import clsx from 'clsx';
import type {
  CompetitorGapAnalysis,
  CompetitorIntelligenceData,
  GapCategory,
} from '../../types/optimization';

const CATEGORY_LABELS: Record<GapCategory, string> = {
  messaging: 'Messaging',
  offers: 'Offers',
  keywords: 'Keywords',
  trust_signals: 'Trust Signals',
  ctas: 'CTAs',
};

const CATEGORY_COLORS: Record<GapCategory, string> = {
  messaging: 'text-blue-400',
  offers: 'text-orange',
  keywords: 'text-teal',
  trust_signals: 'text-purple-300',
  ctas: 'text-pink-300',
};

interface CompetitorGapAnalysisTableProps {
  gapAnalysis?: CompetitorGapAnalysis | null;
  competitorAnalysis?: CompetitorIntelligenceData | null;
}

function avg(nums: number[]): number | null {
  const valid = nums.filter((n) => Number.isFinite(n) && n > 0);
  if (!valid.length) return null;
  return Math.round(valid.reduce((a, b) => a + b, 0) / valid.length);
}

export function CompetitorGapAnalysisTable({
  gapAnalysis,
  competitorAnalysis,
}: CompetitorGapAnalysisTableProps) {
  if (!gapAnalysis?.rows?.length && !competitorAnalysis?.competitors?.length) {
    return (
      <div className="bg-panel border border-border rounded-xl p-4 space-y-2">
        <p className="text-white text-sm font-semibold">Competitor Gap Analysis</p>
        <p className="text-muted text-xs">
          Gap rows will appear once competitor ads and your RSA themes are compared. Re-run Make It Better if rivals were found but this table is empty.
        </p>
      </div>
    );
  }

  const { rows = [], summary } = gapAnalysis ?? {
    rows: [],
    summary: { messagingGaps: 0, offerGaps: 0, keywordGaps: 0, trustSignalGaps: 0, ctaGaps: 0 },
  };

  const competitors = competitorAnalysis?.competitors ?? [];
  const top = [...competitors].sort(
    (a, b) => (b.confidenceScore ?? 0) - (a.confidenceScore ?? 0)
  )[0];

  const comparisonRows = [
    {
      feature: 'Ad Trust Score',
      current: 'Your brand',
      average:
        avg(competitors.map((c) => c.brandReview?.trustScore ?? c.brandReview?.score ?? 0)) != null
          ? `${avg(competitors.map((c) => c.brandReview?.trustScore ?? c.brandReview?.score ?? 0))}/100`
          : '—',
      top:
        top?.brandReview?.trustScore != null || top?.brandReview?.score != null
          ? `${top.brandReview?.trustScore ?? top.brandReview?.score}/100`
          : '—',
      recommendation: 'Lead with concrete ratings/reviews in headlines when competitors do.',
    },
    {
      feature: 'Ad Activity',
      current: 'Your live RSA',
      average:
        avg(competitors.map((c) => c.activeAdCount ?? 0)) != null
          ? `${avg(competitors.map((c) => c.activeAdCount ?? 0))} active`
          : '—',
      top: top ? `${top.activeAdCount ?? 0} active / ${top.totalAdCount ?? 0} total` : '—',
      recommendation: 'Match rotation depth with stronger offer + trust variants.',
    },
    {
      feature: 'Ad Duration',
      current: '—',
      average:
        avg(competitors.map((c) => c.adDurationDays ?? 0)) != null
          ? `${avg(competitors.map((c) => c.adDurationDays ?? 0))?.toLocaleString()} days`
          : '—',
      top: top?.adDurationDays ? `${top.adDurationDays.toLocaleString()} days` : '—',
      recommendation: 'Study long-running competitor themes; keep proven angles, refresh weak ones.',
    },
    {
      feature: 'Trust Score',
      current: '—',
      average:
        avg(competitors.map((c) => c.brandReview?.trustScore ?? c.brandReview?.score ?? 0)) != null
          ? `${avg(competitors.map((c) => c.brandReview?.trustScore ?? c.brandReview?.score ?? 0))}/100`
          : '—',
      top:
        top?.brandReview?.trustScore != null || top?.brandReview?.score != null
          ? `${top.brandReview?.trustScore ?? top.brandReview?.score}/100`
          : '—',
      recommendation: 'Add proof points (reviews, guarantees, years) competitors underuse.',
    },
    {
      feature: 'Brand Positioning',
      current: 'Current ad messaging',
      average: 'Category average',
      top: top?.positioning || top?.keyMessages?.[0] || '—',
      recommendation: 'Differentiate with a sharper outcome + local/service proof.',
    },
  ];

  return (
    <div className="bg-panel border border-border rounded-xl p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-white text-sm font-semibold">Competitor Gap Analysis</p>
        {summary && (
          <div className="flex flex-wrap gap-2 text-[10px]">
            {[
              { label: 'Messaging', n: summary.messagingGaps },
              { label: 'Offers', n: summary.offerGaps },
              { label: 'Keywords', n: summary.keywordGaps },
              { label: 'Trust', n: summary.trustSignalGaps },
              { label: 'CTAs', n: summary.ctaGaps },
            ].map((s) => (
              <span key={s.label} className="px-2 py-0.5 rounded-full bg-navy border border-border text-muted">
                {s.label}: <strong className="text-white">{s.n}</strong>
              </span>
            ))}
          </div>
        )}
      </div>

      {competitors.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs min-w-[720px]">
            <thead>
              <tr className="text-muted uppercase tracking-wider border-b border-border">
                <th className="py-2 pr-3 font-semibold">Feature</th>
                <th className="py-2 pr-3 font-semibold">Current Business</th>
                <th className="py-2 pr-3 font-semibold">Competitor Average</th>
                <th className="py-2 pr-3 font-semibold">Top Competitor</th>
                <th className="py-2 font-semibold">AI Recommendation</th>
              </tr>
            </thead>
            <tbody>
              {comparisonRows.map((row) => (
                <tr key={row.feature} className="border-b border-border/50 hover:bg-navy/30">
                  <td className="py-2.5 pr-3 text-white font-semibold">{row.feature}</td>
                  <td className="py-2.5 pr-3 text-muted">{row.current}</td>
                  <td className="py-2.5 pr-3 text-muted">{row.average}</td>
                  <td className="py-2.5 pr-3 text-muted">{row.top}</td>
                  <td className="py-2.5 text-teal/90">{row.recommendation}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs min-w-[640px]">
            <thead>
              <tr className="text-muted uppercase tracking-wider border-b border-border">
                <th className="py-2 pr-3 font-semibold">Gap Type</th>
                <th className="py-2 pr-3 font-semibold">Competitor</th>
                <th className="py-2 pr-3 font-semibold">They Have</th>
                <th className="py-2 pr-3 font-semibold">You Have</th>
                <th className="py-2 font-semibold">Opportunity</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className="border-b border-border/50 hover:bg-navy/30">
                  <td className={clsx('py-2.5 pr-3 font-semibold', CATEGORY_COLORS[row.category])}>
                    {CATEGORY_LABELS[row.category]}
                  </td>
                  <td className="py-2.5 pr-3 text-white">{row.competitor}</td>
                  <td className="py-2.5 pr-3 text-muted max-w-[160px]">{row.competitorHas}</td>
                  <td className="py-2.5 pr-3 text-muted max-w-[160px]">{row.youHave}</td>
                  <td className="py-2.5 text-teal/90">{row.gap}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
