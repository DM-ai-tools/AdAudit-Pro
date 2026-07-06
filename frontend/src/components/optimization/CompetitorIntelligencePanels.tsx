import { ExternalLink, Swords, Target, TrendingUp } from 'lucide-react';
import clsx from 'clsx';
import { normalizeRenderableStrings, asDisplayText } from './utils';
import type {
  CompetitorIntelligenceData,
  CompetitorInsightCard,
  CompetitiveOutperformance,
  OptimizedAdContent,
} from '../../types/optimization';

interface CompetitorIntelligencePanelsProps {
  competitorAnalysis?: CompetitorIntelligenceData | null;
  optimized: OptimizedAdContent;
}

function InsightCard({ insight }: { insight: CompetitorInsightCard }) {
  return (
    <div className="bg-navy/50 border border-border rounded-lg p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <p className="text-white text-sm font-semibold">{insight.name}</p>
        {insight.url && (
          <a
            href={insight.url.startsWith('http') ? insight.url : `https://${insight.url}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-teal hover:text-teal/80 shrink-0"
            aria-label={`Open ${insight.name} website`}
          >
            <ExternalLink size={14} />
          </a>
        )}
      </div>
      {insight.keyMessages.length > 0 && (
        <div>
          <p className="text-orange text-[10px] uppercase tracking-wider mb-1">Key messages</p>
          <ul className="text-muted text-[11px] space-y-0.5">
            {insight.keyMessages.slice(0, 4).map((m, i) => <li key={i}>• {m}</li>)}
          </ul>
        </div>
      )}
      {insight.offers.length > 0 && (
        <div>
          <p className="text-orange text-[10px] uppercase tracking-wider mb-1">Offers</p>
          <ul className="text-muted text-[11px] space-y-0.5">
            {insight.offers.slice(0, 4).map((o, i) => <li key={i}>• {o}</li>)}
          </ul>
        </div>
      )}
      {insight.keywordOpportunities.length > 0 && (
        <div>
          <p className="text-teal text-[10px] uppercase tracking-wider mb-1">Keyword opportunities</p>
          <div className="flex flex-wrap gap-1">
            {insight.keywordOpportunities.slice(0, 6).map((k) => (
              <span key={k} className="text-[10px] px-2 py-0.5 rounded-full bg-teal/10 text-teal border border-teal/20">
                {k}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function OutperformSection({ data }: { data: CompetitiveOutperformance }) {
  const rows = [
    { title: 'Messaging', text: data.messagingImprovements, icon: Swords },
    { title: 'Keywords', text: data.keywordImprovements, icon: Target },
    { title: 'Offers', text: data.offerImprovements, icon: TrendingUp },
    { title: 'Conversions', text: data.conversionImprovements, icon: TrendingUp },
  ].filter((r) => r.text);

  if (!rows.length) return null;

  return (
    <div className="bg-panel border border-orange/25 rounded-xl p-4 space-y-3">
      <p className="text-white text-sm font-semibold">Why This Ad Will Outperform Competitors</p>
      {rows.map((row) => (
        <div key={row.title} className="flex gap-3">
          <row.icon className="text-orange shrink-0 mt-0.5" size={16} />
          <div>
            <p className="text-orange text-[10px] uppercase tracking-wider">{row.title}</p>
            <p className="text-muted text-xs leading-relaxed">{asDisplayText(row.text)}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

export function CompetitorIntelligencePanels({
  competitorAnalysis,
  optimized,
}: CompetitorIntelligencePanelsProps) {
  const insights =
    optimized.competitorInsights?.length
      ? optimized.competitorInsights
      : competitorAnalysis?.insights ?? [];

  const missingAdvantages = normalizeRenderableStrings(
    optimized.missingCompetitorAdvantages?.length
      ? optimized.missingCompetitorAdvantages
      : competitorAnalysis?.missingFromYourAds ?? []
  );

  const keywordOpportunities = normalizeRenderableStrings(
    competitorAnalysis?.keywordOpportunities ?? []
  );

  const hasContent =
    insights.length > 0 ||
    missingAdvantages.length > 0 ||
    optimized.strategistReasoning?.competitiveOutperformance;

  if (!hasContent) return null;

  return (
    <div className="space-y-4">
      {insights.length > 0 && (
        <div className="bg-panel border border-purple-400/20 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-white text-sm font-semibold">Competitor Insights</p>
            {competitorAnalysis?.source && (
              <span className={clsx(
                'text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border',
                competitorAnalysis.source === 'unavailable'
                  ? 'border-border text-muted'
                  : 'border-purple-400/30 text-purple-300'
              )}>
                {competitorAnalysis.source.replace(/_/g, ' ')}
              </span>
            )}
          </div>
          <div className="grid md:grid-cols-2 gap-3">
            {insights.slice(0, 4).map((insight) => (
              <InsightCard key={insight.name} insight={insight} />
            ))}
          </div>
          {keywordOpportunities.length > 0 && (
            <div className="pt-2 border-t border-border/50">
              <p className="text-teal text-[10px] uppercase tracking-wider mb-2">Account-wide keyword opportunities</p>
              <div className="flex flex-wrap gap-1.5">
                {keywordOpportunities.slice(0, 12).map((k) => (
                  <span key={k} className="text-[10px] px-2 py-0.5 rounded-full bg-teal/10 text-teal border border-teal/20">
                    {k}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {optimized.strategistReasoning?.competitiveOutperformance && (
        <OutperformSection data={optimized.strategistReasoning.competitiveOutperformance} />
      )}

      {missingAdvantages.length > 0 && (
        <div className="bg-panel border border-red-500/25 rounded-xl p-4 space-y-2">
          <p className="text-white text-sm font-semibold">Competitor Advantages Missing From Your Ads</p>
          <ul className="text-muted text-xs space-y-1.5">
            {missingAdvantages.map((item, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-red-400 shrink-0">•</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
