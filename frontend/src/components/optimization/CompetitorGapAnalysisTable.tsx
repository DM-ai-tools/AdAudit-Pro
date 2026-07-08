import clsx from 'clsx';
import type { CompetitorGapAnalysis, GapCategory } from '../../types/optimization';

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
}

export function CompetitorGapAnalysisTable({ gapAnalysis }: CompetitorGapAnalysisTableProps) {
  if (!gapAnalysis?.rows?.length) return null;

  const { rows, summary } = gapAnalysis;

  return (
    <div className="bg-panel border border-border rounded-xl p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-white text-sm font-semibold">Competitor Gap Analysis</p>
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
      </div>

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
    </div>
  );
}
