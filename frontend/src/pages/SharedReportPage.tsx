import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Link2, Download, AlertTriangle, Rocket, BarChart3, Siren,
  CheckCircle,
} from 'lucide-react';
import { Logo } from '../components/layout/Logo';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { HealthProgressBar } from '../components/ui/ProgressBar';
import { SeverityBadge } from '../components/ui/Severity';
import { formatImpact, formatCurrency, getHealthLabel } from '../utils/helpers';
import { auditApi } from '../services/api';
import type { AuditRun } from '../types';

export default function SharedReportPage() {
  const { reportId } = useParams<{ reportId: string }>();
  const [audit, setAudit] = useState<AuditRun | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!reportId) return;
    auditApi.shared(reportId).then(({ data }) => {
      setAudit(data.audit);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [reportId]);

  if (loading) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center">
        <div className="skeleton w-64 h-8 rounded" />
      </div>
    );
  }

  if (!audit) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-white text-xl mb-4">Report not found</h1>
          <Link to="/"><Button>Go home</Button></Link>
        </div>
      </div>
    );
  }

  const healthScore = audit.healthScore || 38;
  const totalImpact = audit.totalImpact || audit.findings.reduce((s, f) => s + f.impactMonthly, 0);
  const healthLabel = getHealthLabel(healthScore);
  const visibleFindings = audit.findings.slice(0, 4);
  const hiddenCount = audit.hiddenFindings || Math.max(0, (audit.totalFindings || audit.findings.length) - 4);

  return (
    <div className="min-h-screen bg-bg">
      {/* Top notification bar */}
      <div className="bg-navy border-b border-border py-2 px-6 flex items-center justify-between text-xs">
        <span className="text-body">
          You're viewing a shared AdAudit Pro report for <span className="text-white font-semibold">{audit.accountName}</span>
          {' '}— Generated {audit.completedAt ? new Date(audit.completedAt).toLocaleDateString() : '—'} — Some sections are visible to stakeholders only.
        </span>
        <Link to="/"><Button size="sm" variant="outline">Visit your own audit</Button></Link>
      </div>

      {/* Header */}
      <header className="border-b border-border bg-navy/30 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <Logo size="sm" />
          <span className="text-white font-semibold text-sm hidden sm:block">Audit Report — {audit.accountName}</span>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" className="!bg-teal/20 !text-teal !border-teal/30">
              <Link2 size={14} /> Shared link
            </Button>
            <Button size="sm" variant="secondary">
              <Download size={14} /> Download PDF
            </Button>
            <Link to="/"><Button size="sm">Run your own audit</Button></Link>
          </div>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-6 py-8 space-y-8">
        {/* Hero */}
        <section>
          <div className="flex gap-2 mb-3">
            <Badge variant="orange">Google Ads Audit</Badge>
            <Badge variant="teal">12 Modules Complete</Badge>
          </div>
          <p className="text-muted text-sm mb-2">
            Generated {audit.completedAt ? new Date(audit.completedAt).toLocaleDateString() : '—'} • {audit.dataWindowDays}-day data window • Shared by Joe Smith
          </p>
          <h1 className="text-3xl font-bold text-white mb-4">
            Audit Report — <span className="text-orange">{audit.accountName}</span>
          </h1>
          <p className="text-body text-sm leading-relaxed">
            This audit identified <span className="text-white font-semibold">{audit.totalFindings || audit.findings.length} findings</span> across
            12 dimensions, representing an estimated <span className="text-teal font-semibold">{formatImpact(totalImpact)}</span> in
            recoverable wasted spend and optimization opportunity.
          </p>
        </section>

        {/* Metrics grid */}
        <section className="grid sm:grid-cols-2 lg:grid-cols-5 gap-4">
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="sm:col-span-2 bg-panel border border-border rounded-xl p-5">
            <div className="text-muted text-xs uppercase tracking-wider mb-2">Account Health Score</div>
            <div className="text-5xl font-bold text-orange">{healthScore}<span className="text-muted text-2xl">/100</span></div>
            <Badge variant="red" className="mt-2">{healthLabel.label.split('—')[0].trim()}</Badge>
          </motion.div>
          {[
            { icon: AlertTriangle, label: 'Total Findings', value: audit.totalFindings || audit.findings.length, color: 'text-white' },
            { icon: Rocket, label: 'Est. Monthly Impact', value: formatCurrency(totalImpact), color: 'text-teal' },
            { icon: BarChart3, label: 'Annual Opportunity', value: formatCurrency(totalImpact * 12), color: 'text-teal' },
            { icon: Siren, label: 'Critical Findings', value: audit.criticalCount || audit.findings.filter((f) => f.severity === 'CRITICAL').length, color: 'text-red-400' },
          ].map((m) => (
            <motion.div key={m.label} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="bg-panel border border-border rounded-xl p-4">
              <m.icon size={18} className="text-muted mb-2" />
              <div className={`text-2xl font-bold ${m.color}`}>{m.value}</div>
              <div className="text-muted text-[10px] uppercase tracking-wider mt-1">{m.label}</div>
            </motion.div>
          ))}
        </section>

        {/* Executive Summary */}
        <section className="bg-panel border border-border rounded-xl p-6">
          <div className="flex items-center gap-2 mb-4">
            <h2 className="text-white font-bold text-lg">Executive Summary</h2>
            <Badge variant="orange">AI Generated</Badge>
          </div>
          <div className="text-body text-sm leading-relaxed space-y-3">
            {(audit.executiveSummary || '').split('\n\n').slice(0, 2).map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
        </section>

        {/* Health Breakdown */}
        <section>
          <h2 className="text-white font-bold text-lg mb-4">Account Health Breakdown</h2>
          <div className="space-y-3">
            {(audit.healthScores.length ? audit.healthScores : [
              { dimension: 'Waste Rate', score: 22 }, { dimension: 'Quality Score Avg', score: 61 },
              { dimension: 'Bidding Health', score: 32 }, { dimension: 'Audience Coverage', score: 48 },
              { dimension: 'Budget Efficiency', score: 52 },
            ]).map((h) => (
              <div key={h.dimension} className="flex items-center gap-4">
                <span className="text-muted text-sm w-40 shrink-0">{h.dimension}</span>
                <div className="flex-1"><HealthProgressBar score={h.score} /></div>
                <span className="text-white font-bold text-sm w-8 text-right">{h.score}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Top Findings */}
        <section>
          <h2 className="text-white font-bold text-lg mb-4">Top Findings by Financial Impact</h2>
          <div className="space-y-4">
            {visibleFindings.map((finding) => (
              <div key={finding.id} className="bg-panel border border-border rounded-xl p-5">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <SeverityBadge severity={finding.severity} />
                    <h3 className="text-white font-semibold text-sm">{finding.title}</h3>
                  </div>
                  <span className="text-teal font-bold">{formatImpact(finding.impactMonthly)}</span>
                </div>
                <p className="text-muted text-xs leading-relaxed mb-3">{finding.description}</p>
                {finding.evidence && (
                  <div className="bg-navy border border-border rounded-lg p-3 text-xs text-muted font-mono">
                    {Object.entries(finding.evidence).map(([k, v]) => (
                      <div key={k}>{k.replace(/([A-Z])/g, ' $1').trim()}: <span className="text-white">{String(v)}</span></div>
                    ))}
                  </div>
                )}
                <div className="flex gap-1.5 mt-3">
                  <Badge variant="outline">{finding.category.replace('_', ' ')}</Badge>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Gated content */}
        {hiddenCount > 0 && (
          <section className="relative">
            <h2 className="text-white font-bold text-lg mb-4">Remaining {hiddenCount} Findings</h2>
            <div className="relative">
              <div className="blur-md pointer-events-none select-none space-y-4 opacity-50">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="bg-panel border border-border rounded-xl p-5 h-24" />
                ))}
              </div>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <p className="text-white font-semibold mb-2">{hiddenCount} more findings hidden in this view...</p>
                <p className="text-muted text-sm mb-4 text-center max-w-md">
                  The full authenticated report includes all {audit.totalFindings || audit.findings.length} findings with evidence data, recommendations, and the complete roadmap.
                </p>
                <Button>Request full access</Button>
              </div>
            </div>
          </section>
        )}

        {/* Roadmap summary */}
        <section>
          <h2 className="text-white font-bold text-lg mb-1">Growth Roadmap Summary</h2>
          <p className="text-muted text-sm mb-4">Actions prioritized by financial impact and implementation effort.</p>
          <div className="grid md:grid-cols-3 gap-4">
            {[
              { phase: '30-Day Sprint', color: 'text-red-400', border: 'border-red-500/30', items: audit.roadmapItems.filter((r) => r.phase === 'DAY_30').slice(0, 4), impact: 2148 },
              { phase: '60-Day Scale', color: 'text-orange', border: 'border-orange/30', items: audit.roadmapItems.filter((r) => r.phase === 'DAY_60').slice(0, 3), impact: 1130 },
              { phase: '90-Day Scale', color: 'text-teal', border: 'border-teal/30', items: audit.roadmapItems.filter((r) => r.phase === 'DAY_90').slice(0, 3), impact: 380 },
            ].map((col) => (
              <div key={col.phase} className={`bg-panel border ${col.border} rounded-xl p-4`}>
                <h3 className={`font-bold text-sm mb-3 ${col.color}`}>{col.phase}</h3>
                <ul className="space-y-2 mb-4">
                  {col.items.map((item) => (
                    <li key={item.id} className="text-body text-xs flex items-start gap-2">
                      <CheckCircle size={12} className="text-teal shrink-0 mt-0.5" />
                      {item.title}
                    </li>
                  ))}
                </ul>
                <div className="text-muted text-[10px] uppercase tracking-wider">
                  {col.phase.split('-')[0]}-DAY IMPACT: <span className="text-teal font-bold">{formatImpact(col.impact)}</span>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Bottom CTA */}
        <section className="bg-gradient-to-r from-orange to-orange-2 rounded-2xl p-10 text-center">
          <h2 className="text-2xl font-bold text-white mb-6">
            Ready to fix these issues and recover {formatImpact(totalImpact)}?
          </h2>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link to="/"><Button size="lg" className="bg-white !text-orange hover:!bg-white/90">Run my free audit</Button></Link>
            <Button size="lg" variant="outline" className="!border-white !text-white hover:!bg-white/10">
              Book DFY consultation
            </Button>
          </div>
        </section>
      </div>

      {/* Footer */}
      <footer className="border-t border-border py-8 mt-12">
        <div className="max-w-5xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <Logo size="sm" />
          <div className="flex gap-6 text-muted text-xs">
            <a href="#" className="hover:text-white">HOW IT WORKS</a>
            <a href="#" className="hover:text-white">PRIVACY</a>
            <a href="#" className="hover:text-white">TERMS</a>
          </div>
          <span className="text-muted text-xs">Melbourne, AU</span>
        </div>
        <p className="text-muted text-[10px] text-center mt-4 max-w-2xl mx-auto">
          Financial estimates based on account data analysis. Actual results may vary. Data sourced from Google Ads API.
        </p>
      </footer>
    </div>
  );
}
