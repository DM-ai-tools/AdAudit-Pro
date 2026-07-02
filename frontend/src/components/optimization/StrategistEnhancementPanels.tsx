import { ArrowRight, Check, X as XIcon } from 'lucide-react';
import clsx from 'clsx';
import type { GoogleAdsCampaign } from '../../types/connect';
import { normalizeRenderableStrings, asDisplayText } from './utils';
import type {
  AnalysisSources,
  OptimizedAdContent,
  CampaignPerformanceSummary,
  PerformanceEstimates,
} from '../../types/optimization';

interface StrategistEnhancementPanelsProps {
  analysisSources?: AnalysisSources;
  optimized: OptimizedAdContent;
  campaignPerformance?: CampaignPerformanceSummary | null;
  selectedCampaign?: GoogleAdsCampaign | null;
  auditHealthScore?: number;
}

const SOURCE_LABELS: Array<{ key: keyof AnalysisSources; label: string }> = [
  { key: 'campaignData', label: 'Campaign Data' },
  { key: 'auditFindings', label: 'Audit Findings' },
  { key: 'websiteAnalysis', label: 'Website Analysis' },
  { key: 'competitorAnalysis', label: 'Competitor Analysis' },
  { key: 'keywordAnalysis', label: 'Keyword Analysis' },
  { key: 'searchTerms', label: 'Search Terms' },
  { key: 'landingPageAnalysis', label: 'Landing Page Analysis' },
];

function MetricCompare({ label, current, estimated }: { label: string; current?: string; estimated?: string }) {
  if (!current && !estimated) return null;
  return (
    <div className="flex items-center justify-between gap-2 text-xs py-1.5 border-b border-border/50 last:border-0">
      <span className="text-muted w-24 shrink-0">{label}</span>
      <span className="text-white/80">{current ?? '—'}</span>
      <ArrowRight className="text-orange shrink-0" size={12} />
      <span className="text-teal font-medium text-right flex-1">{estimated ?? '—'}</span>
    </div>
  );
}

export function CampaignMetricsStrip({
  campaign,
  performance,
  estimates,
}: {
  campaign?: GoogleAdsCampaign | null;
  performance?: CampaignPerformanceSummary | null;
  estimates?: PerformanceEstimates;
}) {
  if (!campaign && !performance) return null;

  const currentCtr = performance?.ctr != null ? `${performance.ctr}%` : campaign?.ctr != null ? `${campaign.ctr}%` : '—';
  const currentQs = performance?.avgQualityScore != null ? String(performance.avgQualityScore) : '—';
  const currentCr = performance?.conversionRate != null ? `${performance.conversionRate}%` : campaign?.conversionRate != null ? `${campaign.conversionRate}%` : '—';

  return (
    <div className="grid sm:grid-cols-3 gap-3 mt-3">
      {[
        { label: 'CTR', current: currentCtr, estimated: estimates?.estimated.ctr },
        { label: 'Quality Score', current: currentQs, estimated: estimates?.estimated.qualityScore },
        { label: 'Conversion Rate', current: currentCr, estimated: estimates?.estimated.conversionRate },
      ].map((m) => (
        <div key={m.label} className="bg-navy/60 rounded-lg p-3 border border-border/60">
          <div className="text-[10px] uppercase tracking-wider text-muted mb-2">{m.label}</div>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-white/70">{m.current}</span>
            <ArrowRight className="text-orange" size={12} />
            <span className="text-teal font-semibold">{m.estimated ?? '—'}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

export function StrategistEnhancementPanels({
  analysisSources,
  optimized,
  campaignPerformance,
  selectedCampaign,
  auditHealthScore,
}: StrategistEnhancementPanelsProps) {
  const perf = optimized.performanceEstimates;
  const reasoning = optimized.strategistReasoning;
  const recs = optimized.strategistRecommendations;
  const account = optimized.accountImpact;
  const health = optimized.campaignHealth;

  return (
    <div className="space-y-4">
      {analysisSources && (
        <div className="bg-panel border border-border rounded-xl p-4">
          <p className="text-white text-sm font-semibold mb-3">AI Analysis Sources</p>
          <div className="flex flex-wrap gap-2">
            {SOURCE_LABELS.map(({ key, label }) => (
              <span
                key={key}
                className={clsx(
                  'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] border',
                  analysisSources[key]
                    ? 'border-teal/40 text-teal bg-teal/10'
                    : 'border-border text-muted bg-navy/40'
                )}
              >
                {analysisSources[key] ? <Check size={12} /> : <XIcon size={12} className="opacity-40" />}
                {label}
              </span>
            ))}
          </div>
        </div>
      )}

      <CampaignMetricsStrip
        campaign={selectedCampaign}
        performance={campaignPerformance}
        estimates={perf}
      />

      {perf && (
        <div className="bg-panel border border-orange/20 rounded-xl p-4 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-white text-sm font-semibold">AI Estimated Impact</p>
            <span className="text-[10px] uppercase text-orange/80">{perf.label}</span>
          </div>
          <div className="bg-navy/50 rounded-lg px-3 py-1">
            <MetricCompare label="CTR" current={perf.current.ctr} estimated={perf.estimated.ctr} />
            <MetricCompare label="Quality Score" current={perf.current.qualityScore} estimated={perf.estimated.qualityScore} />
            <MetricCompare label="Conv. Rate" current={perf.current.conversionRate} estimated={perf.estimated.conversionRate} />
            <MetricCompare label="CPA" current={perf.current.cpa} estimated={perf.estimated.cpa} />
            <MetricCompare label="ROAS" current={perf.current.roas} estimated={perf.estimated.roas} />
            <MetricCompare label="Monthly Leads" current={perf.current.monthlyLeads} estimated={perf.estimated.monthlyLeads} />
            <MetricCompare label="Savings" current={perf.current.monthlySavings} estimated={perf.estimated.monthlySavings} />
          </div>
        </div>
      )}

      {account && (
        <div className="bg-panel border border-purple-400/20 rounded-xl p-4 space-y-3">
          <p className="text-white text-sm font-semibold">Estimated Account Impact</p>
          <div className="grid sm:grid-cols-2 gap-3 text-xs">
            {[
              { label: 'Account Health', cur: account.currentAccountHealth ?? auditHealthScore, est: account.predictedAccountHealth },
              { label: 'Monthly Leads', cur: account.currentMonthlyLeads, est: account.estimatedMonthlyLeads },
              { label: 'Wasted Spend', cur: account.currentWastedSpend, est: account.estimatedWastedSpend },
              { label: 'ROAS', cur: account.currentRoas, est: account.estimatedRoas },
            ].map((row) => (
              <div key={row.label} className="flex items-center justify-between gap-2 bg-navy/50 rounded-lg px-3 py-2">
                <span className="text-muted">{row.label}</span>
                <span className="text-white/80">{row.cur ?? '—'}</span>
                <ArrowRight className="text-orange" size={12} />
                <span className="text-teal font-medium">{row.est ?? '—'}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {health && (
        <div className="flex items-center justify-center gap-6 text-center text-sm bg-panel border border-border rounded-xl p-4">
          <div>
            <div className="text-muted text-[10px] uppercase">Campaign Health</div>
            <div className="text-2xl font-bold text-white">{health.currentScore}<span className="text-sm text-muted">/100</span></div>
          </div>
          <ArrowRight className="text-orange" />
          <div>
            <div className="text-muted text-[10px] uppercase">Predicted</div>
            <div className="text-2xl font-bold text-teal">{health.predictedScore}<span className="text-sm text-muted">/100</span></div>
          </div>
        </div>
      )}

      {reasoning && (
        <div className="bg-panel border border-teal/20 rounded-xl p-4 space-y-3">
          <p className="text-white text-sm font-semibold">Why This Ad Is Better</p>
          {[
            { title: 'Headlines', text: reasoning.headlineChanges },
            { title: 'Descriptions', text: reasoning.descriptionChanges },
            { title: 'Keyword relevance', text: reasoning.keywordRelevance },
            { title: 'Quality Score', text: reasoning.qualityScore },
            { title: 'Conversion potential', text: reasoning.conversionPotential },
          ].filter((s) => s.text).map((s) => (
            <div key={s.title}>
              <p className="text-orange text-[10px] uppercase tracking-wider">{s.title}</p>
              <p className="text-muted text-xs leading-relaxed">{asDisplayText(s.text)}</p>
            </div>
          ))}
          {reasoning.auditFindingsAddressed?.length ? (
            <div>
              <p className="text-orange text-[10px] uppercase tracking-wider mb-1">Audit findings addressed</p>
              <ul className="text-muted text-xs space-y-1">
                {normalizeRenderableStrings(reasoning.auditFindingsAddressed).map((f, i) => <li key={i}>• {f}</li>)}
              </ul>
            </div>
          ) : null}
          {reasoning.competitorInsightsUsed?.length ? (
            <div>
              <p className="text-orange text-[10px] uppercase tracking-wider mb-1">Competitor insights used</p>
              <ul className="text-muted text-xs space-y-1">
                {normalizeRenderableStrings(reasoning.competitorInsightsUsed).map((f, i) => <li key={i}>• {f}</li>)}
              </ul>
            </div>
          ) : null}
        </div>
      )}

      {recs && (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
          {[
            { title: 'Recommended Keywords', items: recs.keywords },
            { title: 'Negative Keywords', items: recs.negativeKeywords },
            { title: 'Ad Extensions', items: recs.extensions },
            { title: 'Landing Page', items: recs.landingPage },
            { title: 'Budget', items: recs.budget },
            { title: 'Bidding', items: recs.bidding },
            { title: 'Audience', items: recs.audience },
          ].filter((g) => g.items?.length).map((g) => (
            <div key={g.title} className="bg-panel border border-border rounded-lg p-3">
              <p className="text-white text-xs font-semibold mb-2">{g.title}</p>
              <ul className="text-muted text-[11px] space-y-1 max-h-28 overflow-y-auto">
                {normalizeRenderableStrings(g.items).slice(0, 6).map((item, i) => <li key={i}>• {item}</li>)}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
