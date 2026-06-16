import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CheckCircle, Loader2, Clock, Terminal, Mail,
  Activity,
} from 'lucide-react';
import { Logo } from '../components/layout/Logo';
import { Badge } from '../components/ui/Badge';
import { ProgressBar } from '../components/ui/ProgressBar';
import { SeverityBadge } from '../components/ui/Severity';
import { formatImpact } from '../utils/helpers';
import { useAuditPolling } from '../hooks/useAuditPolling';
import clsx from 'clsx';

export default function ProcessingPage() {
  const { auditId } = useParams<{ auditId: string }>();
  const navigate = useNavigate();
  const { audit, loading } = useAuditPolling(auditId, 2500);

  useEffect(() => {
    if (audit?.status === 'COMPLETED') {
      const timer = setTimeout(() => navigate(`/dashboard/${auditId}`), 2000);
      return () => clearTimeout(timer);
    }
  }, [audit?.status, auditId, navigate]);

  if (loading && !audit) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center">
        <Loader2 className="animate-spin text-orange" size={32} />
      </div>
    );
  }

  const totalImpact = audit?.totalImpact ?? audit?.findings.reduce((s, f) => s + f.impactMonthly, 0) ?? 0;
  const criticalCount = audit?.criticalCount ?? audit?.findings.filter((f) => f.severity === 'CRITICAL').length ?? 0;
  const runningModules = audit?.modules.filter((m) => m.status === 'RUNNING') || [];

  return (
    <div className="min-h-screen bg-bg">
      {/* Header */}
      <header className="border-b border-border bg-navy/50 backdrop-blur-md">
        <div className="max-w-[1400px] mx-auto px-6 py-3 flex items-center justify-between">
          <Logo size="sm" />
          <div className="text-sm text-body">
            Auditing: <span className="text-white font-semibold">{audit?.accountName}</span>
            <span className="text-muted ml-2 hidden sm:inline">ads.google.com/...</span>
          </div>
          <Badge variant="orange" className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-orange animate-pulse-glow" />
            AUDIT RUNNING • {audit?.modulesComplete || 0} / {audit?.totalModules || 12} MODULES COMPLETE
          </Badge>
        </div>
      </header>

      <div className="max-w-[1400px] mx-auto px-6 py-8 grid lg:grid-cols-[1fr_380px] gap-8">
        {/* Left column */}
        <div className="space-y-6">
          <div>
            <h1 className="text-2xl font-bold text-white mb-2">Auditing your Google Ads account</h1>
            <p className="text-muted text-sm leading-relaxed">
              Claude is analyzing {audit?.totalModules || 0} modules in parallel
              {audit?.totalModules === 12 ? ' (3 API streams × 4 modules each)' : ''}.
              Findings and logs update live as each module completes.
            </p>
          </div>

          {/* Account badges */}
          <div className="flex flex-wrap gap-2">
            {[
              { label: 'ACCOUNT', value: audit?.accountName },
              { label: 'SPEND', value: `$${(audit?.monthlySpend || 0).toLocaleString()} / mo` },
              { label: 'CAMPAIGNS', value: `${audit?.campaignCount || 0} active` },
              { label: 'WINDOW', value: `${audit?.dataWindowDays || 365} days` },
              { label: 'GOAL', value: audit?.goal || 'Not specified' },
            ].map((b) => (
              <div key={b.label} className="bg-panel border border-border rounded-lg px-3 py-1.5 text-xs">
                <span className="text-orange font-bold mr-1.5">{b.label}</span>
                <span className="text-white">{b.value}</span>
              </div>
            ))}
          </div>

          {/* Overall progress */}
          <div className="bg-panel border border-border rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-white font-semibold text-sm">
                Overall audit progress: {audit?.progress || 0}% — {audit?.modulesComplete || 0} of {audit?.totalModules || 12} modules
              </span>
            </div>
            <ProgressBar value={audit?.progress || 0} height="h-2.5" />
            <div className="flex gap-6 mt-3 text-xs text-muted">
              <span>Started: {audit?.startedAt ? new Date(audit.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}</span>
              <span>Findings so far: <span className="text-orange font-bold">{audit?.findings.length || 0}</span></span>
              <span>Est. remaining: ~{audit?.estimatedMinutes || 18} min</span>
            </div>
          </div>

          {/* Modules list */}
          <div className="space-y-2">
            {audit?.modules.map((mod) => (
              <motion.div
                key={mod.id}
                layout
                className={clsx(
                  'bg-panel border rounded-lg p-4 transition-colors',
                  mod.status === 'RUNNING' ? 'border-orange/40 glow-orange' :
                  mod.status === 'COMPLETED' ? 'border-teal/30' : 'border-border opacity-60'
                )}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    {mod.status === 'COMPLETED' && <CheckCircle size={16} className="text-teal" />}
                    {mod.status === 'RUNNING' && <Loader2 size={16} className="text-orange animate-spin" />}
                    {mod.status === 'PENDING' && <Clock size={16} className="text-muted" />}
                    <span className={clsx('text-sm font-medium', mod.status === 'PENDING' ? 'text-muted' : 'text-white')}>
                      {mod.name}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {mod.status === 'COMPLETED' && (
                      <span className="text-teal text-xs font-semibold">✓ Complete • {mod.findingsCount} findings</span>
                    )}
                    {mod.status === 'RUNNING' && (
                      <span className="text-orange text-xs font-semibold animate-pulse-glow">
                        {mod.progress < 50 ? 'Analysing...' : 'Reviewing...'} {mod.progress}%
                      </span>
                    )}
                    {mod.status === 'PENDING' && <span className="text-muted text-xs">Pending</span>}
                  </div>
                </div>
                {mod.status !== 'PENDING' && (
                  <ProgressBar
                    value={mod.progress}
                    color={mod.status === 'COMPLETED' ? 'teal' : 'orange'}
                    height="h-1"
                  />
                )}
              </motion.div>
            ))}
          </div>

          {/* Audit log */}
          <div className="bg-navy border border-border rounded-xl overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-panel/50">
              <Terminal size={14} className="text-muted" />
              <span className="text-muted text-xs font-mono uppercase tracking-wider">Audit Log</span>
            </div>
            <div className="p-4 h-48 overflow-y-auto font-mono text-xs space-y-1">
              <AnimatePresence>
                {audit?.logs.map((log) => (
                  <motion.div
                    key={log.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    className={clsx(
                      log.level === 'success' ? 'text-teal' :
                      log.level === 'finding' ? 'text-orange' : 'text-muted'
                    )}
                  >
                    <span className="text-muted/50">
                      {new Date(log.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </span>{' '}
                    {log.message}
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </div>
        </div>

        {/* Right column */}
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3">
            {[
              { label: 'Findings So Far', value: audit?.findings.length || 0, color: 'text-orange' },
              { label: 'Est. Monthly Impact', value: formatImpact(totalImpact), color: 'text-teal' },
              { label: 'Critical Findings', value: criticalCount, color: 'text-red-400' },
            ].map((m) => (
              <div key={m.label} className="bg-panel border border-border rounded-xl p-4 text-center">
                <div className={`text-3xl font-bold ${m.color}`}>{m.value}</div>
                <div className="text-muted text-[10px] uppercase tracking-wider mt-1">{m.label}</div>
              </div>
            ))}
          </div>

          <div className="bg-panel border border-border rounded-xl p-4 text-center glow-orange">
            <div className="text-orange text-2xl font-bold">~{audit?.estimatedMinutes || 18} min</div>
            <div className="text-muted text-[10px] uppercase tracking-wider">Remaining</div>
            {runningModules.length > 0 && (
              <p className="text-muted text-xs mt-2">
                Running: {runningModules.map((m) => m.name).join(', ')}
              </p>
            )}
          </div>

          {/* Live findings */}
          <div className="bg-panel border border-border rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center gap-2">
              <Activity size={14} className="text-orange" />
              <span className="text-white text-sm font-semibold">Live Findings</span>
            </div>
            <div className="max-h-[400px] overflow-y-auto p-3 space-y-3">
              <AnimatePresence>
                {audit?.findings.slice().reverse().map((finding) => (
                  <motion.div
                    key={finding.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-navy border border-border rounded-lg p-3"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-white text-xs font-semibold truncate flex-1">{finding.title}</span>
                      <span className="text-teal text-xs font-bold ml-2">{formatImpact(finding.impactMonthly)}</span>
                    </div>
                    <p className="text-muted text-[11px] line-clamp-2 mb-2">{finding.description}</p>
                    <div className="flex gap-1.5">
                      <SeverityBadge severity={finding.severity} />
                      <Badge variant="outline">{finding.category}</Badge>
                      <Badge variant="teal">NEW</Badge>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
              {(!audit?.findings.length) && (
                <p className="text-muted text-xs text-center py-8">Waiting for first findings...</p>
              )}
            </div>
            {audit?.status === 'RUNNING' && (audit?.modulesComplete || 0) < (audit?.totalModules || 0) && (
              <div className="px-4 py-2 border-t border-border text-muted text-[10px] text-center">
                More findings incoming — {runningModules.length} module{runningModules.length === 1 ? '' : 's'} running in parallel...
              </div>
            )}
          </div>
        </div>
      </div>

      {audit?.email && (
        <div className="fixed bottom-6 right-6 glass rounded-xl px-5 py-3 flex items-center gap-3 max-w-sm">
          <Mail size={18} className="text-orange shrink-0" />
          <p className="text-xs text-body">
            We'll email the full audit report to{' '}
            <span className="text-white font-semibold">{audit.email}</span> the moment it's ready...
          </p>
        </div>
      )}
    </div>
  );
}
