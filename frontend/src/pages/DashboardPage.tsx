import { useState, useMemo, useCallback, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Share2, Download, ArrowLeft, Link2, ChevronRight,
  AlertTriangle, TrendingUp, Target, Heart,
  Search, Globe, Users, FileText, BarChart3, MapPin, Eye, Sparkles,
} from 'lucide-react';
import clsx from 'clsx';
import { Logo } from '../components/layout/Logo';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { HealthProgressBar } from '../components/ui/ProgressBar';
import { HealthChart } from '../charts/HealthChart';
import { SeverityDot } from '../components/ui/Severity';
import { formatImpact, formatCurrency, getHealthLabel } from '../utils/helpers';
import { useAuditReport } from '../hooks/useAuditPolling';
import { auditApi } from '../services/api';
import type { Finding } from '../types';
import { AIOptimizationModal, MakeItBetterButton, isOptimizableFinding } from '../components/optimization';

const navItems = [
  { id: 'executive', label: 'Executive Summary', icon: FileText, sectionId: 'executive' },
  { id: 'findings', label: 'All Findings', icon: AlertTriangle, badge: true, sectionId: 'findings' },
  { id: 'roadmap', label: 'Growth Roadmap', icon: TrendingUp, sub: '30/60/90d', sectionId: 'roadmap' },
  { id: 'health', label: 'Account Health', icon: Heart, sectionId: 'health' },
  { id: 'search-terms', label: 'Search Term Waste', icon: Search, moduleFilter: 'Search Term Waste', sectionId: 'findings' },
  { id: 'keywords', label: 'Keyword Analysis', icon: Target, moduleFilter: 'Keyword Audit', sectionId: 'findings' },
  { id: 'quality', label: 'Quality Score', icon: BarChart3, moduleFilter: 'Quality Score Audit', sectionId: 'findings' },
  { id: 'bidding', label: 'Bidding Strategy', icon: TrendingUp, moduleFilter: 'Bidding Analysis', sectionId: 'findings' },
  { id: 'ad-copy', label: 'Ad Copy Review', icon: FileText, moduleFilter: 'Ad Copy Review', sectionId: 'findings' },
  { id: 'audiences', label: 'Audiences', icon: Users, moduleFilter: 'Audience Analysis', sectionId: 'findings' },
  { id: 'geo', label: 'Geographic', icon: MapPin, moduleFilter: 'Geo Analysis', sectionId: 'findings' },
  { id: 'landing', label: 'Landing Pages', icon: Globe, moduleFilter: 'Landing Page Analysis', sectionId: 'findings' },
  { id: 'impression', label: 'Impression Share', icon: Eye, moduleFilter: 'Impression Share', sectionId: 'findings' },
  { id: 'pmax', label: 'PMax Placements', icon: Sparkles, moduleFilter: 'PMax', sectionId: 'findings' },
];

const filters = ['All', 'Critical', 'High', 'Medium', 'Low', 'Keywords', 'Bidding', 'Audiences', 'Ad Copy'];

function isFailureFinding(f: Finding): boolean {
  return /analysis incomplete|configure anthropic|configure API keys/i.test(f.title);
}

export default function DashboardPage() {
  const { auditId } = useParams<{ auditId: string }>();
  const { audit, loading } = useAuditReport(auditId);
  const [activeSection, setActiveSection] = useState('executive');
  const [activeFilter, setActiveFilter] = useState('All');
  const [moduleFilter, setModuleFilter] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  const [shareCopied, setShareCopied] = useState(false);
  const [optimizeFinding, setOptimizeFinding] = useState<Finding | null>(null);
  const mainRef = useRef<HTMLDivElement>(null);

  const validFindings = useMemo(
    () => (audit?.findings ?? []).filter((f) => !isFailureFinding(f)),
    [audit]
  );

  const filteredFindings = useMemo(() => {
    let items = moduleFilter
      ? validFindings.filter((f) =>
          f.dimension === moduleFilter ||
          f.dimension.startsWith(moduleFilter) ||
          (moduleFilter === 'Ad Copy Review' && f.category === 'AD_COPY')
        )
      : [...validFindings];

    if (activeFilter === 'Critical') items = items.filter((f) => f.severity === 'CRITICAL');
    else if (activeFilter === 'High') items = items.filter((f) => f.severity === 'HIGH');
    else if (activeFilter === 'Medium') items = items.filter((f) => f.severity === 'MEDIUM');
    else if (activeFilter === 'Low') items = items.filter((f) => f.severity === 'LOW');
    else if (activeFilter !== 'All') {
      items = items.filter((f) => f.category.includes(activeFilter.toUpperCase().replace(' ', '_')));
    }
    return items.sort((a, b) => b.impactMonthly - a.impactMonthly);
  }, [validFindings, activeFilter, moduleFilter]);

  const healthScore = audit?.healthScore
    ?? (audit?.healthScores?.length
      ? Math.round(audit.healthScores.reduce((s, h) => s + h.score, 0) / audit.healthScores.length)
      : null);
  const totalImpact = audit?.totalImpact ?? validFindings.reduce((s, f) => s + f.impactMonthly, 0);
  const healthLabel = getHealthLabel(healthScore ?? 50);

  const scrollToSection = useCallback((sectionId: string) => {
    const el = document.getElementById(sectionId);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const handleNavClick = (item: typeof navItems[number]) => {
    setActiveSection(item.id);
    if (item.moduleFilter) {
      setModuleFilter(item.moduleFilter);
      setActiveFilter('All');
    } else {
      setModuleFilter(null);
    }
    scrollToSection(item.sectionId);
  };

  const copyShareUrl = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2500);
    } catch {
      /* clipboard may be blocked */
    }
  };

  const handleShare = async () => {
    if (!auditId) return;
    setShareError(null);
    setShareCopied(false);
    try {
      let url: string;
      try {
        const { data } = await auditApi.share(auditId);
        url = `${window.location.origin}${data.url}`;
      } catch {
        const { data } = await auditApi.shareDemo(auditId);
        url = `${window.location.origin}${data.url}`;
      }
      setShareUrl(url);
      await copyShareUrl(url);
    } catch {
      setShareError('Could not create share link. Try again or sign in.');
    }
  };

  const handleDownloadPdf = () => {
    if (auditId) window.open(auditApi.pdfUrl(auditId), '_blank', 'noopener,noreferrer');
  };

  if (loading || !audit) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center">
        <div className="skeleton w-64 h-8 rounded" />
      </div>
    );
  }

  const failureFindings = audit.findings.filter(isFailureFinding);
  const roadmap30 = audit.roadmapItems.filter((r) => r.phase === 'DAY_30');
  const roadmap60 = audit.roadmapItems.filter((r) => r.phase === 'DAY_60');
  const roadmap90 = audit.roadmapItems.filter((r) => r.phase === 'DAY_90');

  return (
    <div className="min-h-screen bg-bg flex">
      <aside className="w-64 shrink-0 border-r border-border bg-navy/50 flex flex-col fixed h-full z-40">
        <div className="p-4 border-b border-border">
          <Logo size="sm" />
        </div>

        <div className="p-4 border-b border-border">
          <div className="text-white font-semibold text-sm">{audit.accountName}</div>
          <div className="text-muted text-xs mt-1">
            ${audit.monthlySpend.toLocaleString()}/mo • {audit.campaignCount} campaigns •{' '}
            {audit.completedAt ? new Date(audit.completedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'In progress'}
          </div>
        </div>

        <div className="p-4 border-b border-border">
          <div className="text-muted text-[10px] uppercase tracking-wider mb-2">Account Health Score</div>
          <div className="text-4xl font-bold text-orange">{healthScore ?? '—'}<span className="text-muted text-lg">/100</span></div>
          <div className={`text-xs mt-1 ${healthLabel.color}`}>{healthLabel.label}</div>
        </div>

        <nav className="flex-1 overflow-y-auto py-2">
          <div className="px-4 text-[10px] text-muted uppercase tracking-wider mb-2">Report Sections</div>
          {navItems.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => handleNavClick(item)}
              className={clsx(
                'w-full flex items-center gap-2.5 px-4 py-2.5 text-left text-sm transition-colors',
                activeSection === item.id
                  ? 'bg-orange/10 text-white border-l-2 border-orange'
                  : 'text-muted hover:text-white hover:bg-panel/50 border-l-2 border-transparent'
              )}
            >
              <item.icon size={16} />
              <span className="flex-1">{item.label}</span>
              {item.badge && validFindings.length > 0 && (
                <span className="bg-red-500/20 text-red-400 text-[10px] font-bold px-1.5 py-0.5 rounded">
                  {validFindings.length}
                </span>
              )}
              {item.sub && <span className="text-[9px] text-muted">{item.sub}</span>}
            </button>
          ))}
        </nav>

        <div className="p-4 space-y-2 border-t border-border">
          <Button variant="outline" size="sm" className="w-full" onClick={handleShare}>
            <Link2 size={14} /> {shareCopied ? 'Link copied!' : 'Share report link'}
          </Button>
          <Button variant="secondary" size="sm" className="w-full" onClick={handleDownloadPdf}>
            <Download size={14} /> Download PDF
          </Button>
          {shareUrl && (
            <p className="text-teal text-[10px] break-all">{shareUrl}</p>
          )}
          {shareError && (
            <p className="text-red-400 text-[10px]">{shareError}</p>
          )}
        </div>
      </aside>

      <main className="flex-1 ml-64" ref={mainRef}>
        <header className="border-b border-border bg-navy/30 backdrop-blur-md sticky top-0 z-30 px-8 py-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-white font-bold text-lg">Audit Report • {audit.accountName}</h1>
                <Badge variant="teal">✓ Audit Complete • {audit.modulesComplete}/{audit.totalModules} modules</Badge>
              </div>
              <p className="text-muted text-xs mt-1">
                Generated {audit.completedAt ? new Date(audit.completedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'} • {audit.dataWindowDays}-day data window • Engine v{audit.engineVersion}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Link to="/" className="text-muted text-sm hover:text-white flex items-center gap-1">
                <ArrowLeft size={14} /> All audits
              </Link>
              <Button size="sm" onClick={handleShare}><Share2 size={14} /> Share</Button>
            </div>
          </div>
        </header>

        <div className="px-8 py-6 space-y-8 max-w-5xl">
          {failureFindings.length > 0 && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-sm text-red-300">
              {failureFindings.length} module{failureFindings.length === 1 ? '' : 's'} could not complete Claude analysis.
              Check Anthropic API keys in backend/.env and run a new audit.
            </div>
          )}

          <section id="executive" className="scroll-mt-24">
            <div className="flex items-center gap-2 mb-4">
              <h2 className="text-white font-bold text-xl">Executive Summary</h2>
              <Badge variant="orange">AI Generated</Badge>
            </div>
            <div className="text-body text-sm leading-relaxed space-y-4 mb-6">
              {(audit.executiveSummary || 'Executive summary will appear when the audit completes.').split('\n\n').map((p, i) => (
                <p key={i}>{p}</p>
              ))}
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: 'TOTAL FINDINGS', value: validFindings.length, color: 'text-red-400' },
                { label: 'MONTHLY IMPACT', value: formatCurrency(totalImpact), color: 'text-orange' },
                { label: 'ANNUAL OPPORTUNITY', value: formatCurrency(totalImpact * 12), color: 'text-teal' },
                { label: 'ACCOUNT HEALTH /100', value: healthScore ?? '—', color: 'text-teal' },
              ].map((m) => (
                <motion.div key={m.label} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="bg-panel border border-border rounded-xl p-4 text-center">
                  <div className={`text-2xl font-bold ${m.color}`}>{m.value}</div>
                  <div className="text-muted text-[10px] uppercase tracking-wider mt-1">{m.label}</div>
                </motion.div>
              ))}
            </div>
          </section>

          <section id="health" className="scroll-mt-24">
            <h2 className="text-white font-bold text-xl mb-4">Health Score Breakdown</h2>
            {audit.healthScores.length === 0 ? (
              <p className="text-muted text-sm">Health scores will appear when module analysis completes.</p>
            ) : (
              <>
                <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3">
                  {audit.healthScores.map((h) => (
                    <div key={h.dimension} className="bg-panel border border-border rounded-xl p-4">
                      <div className="text-muted text-xs mb-1">{h.dimension}</div>
                      <div className="text-white font-bold text-lg mb-2">{h.score}</div>
                      <HealthProgressBar score={h.score} />
                    </div>
                  ))}
                </div>
                <div className="mt-6 bg-panel border border-border rounded-xl p-4 hidden lg:block">
                  <HealthChart scores={audit.healthScores} />
                </div>
              </>
            )}
          </section>

          <section id="findings" className="scroll-mt-24">
            <div className="mb-4">
              <h2 className="text-white font-bold text-xl">
                {moduleFilter ? `${moduleFilter} Findings` : 'All Findings'}
              </h2>
              <p className="text-muted text-sm">
                {filteredFindings.length} findings • sorted by financial impact
                {moduleFilter && (
                  <button type="button" onClick={() => { setModuleFilter(null); setActiveSection('findings'); }} className="ml-2 text-orange hover:underline">
                    Clear filter
                  </button>
                )}
              </p>
            </div>

            <div className="flex gap-2 overflow-x-auto pb-3 mb-4">
              {filters.map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => { setActiveFilter(f); setModuleFilter(null); }}
                  className={clsx(
                    'px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap border transition-colors',
                    activeFilter === f && !moduleFilter
                      ? 'bg-orange/15 text-orange border-orange/30'
                      : 'bg-panel text-muted border-border hover:text-white'
                  )}
                >
                  {f} {f === 'All' ? `(${validFindings.length})` : f === 'Critical' ? `(${validFindings.filter((x) => x.severity === 'CRITICAL').length})` : ''}
                </button>
              ))}
            </div>

            <div className="space-y-3">
              {filteredFindings.length === 0 ? (
                <p className="text-muted text-sm py-8 text-center">
                  {moduleFilter ? `No findings for ${moduleFilter} in this audit.` : 'No findings match this filter.'}
                </p>
              ) : (
                filteredFindings.map((finding, i) => (
                  <FindingRow
                    key={finding.id}
                    finding={finding}
                    index={i}
                    onMakeItBetter={isOptimizableFinding(finding) ? () => setOptimizeFinding(finding) : undefined}
                  />
                ))
              )}
            </div>
          </section>

          <section id="roadmap" className="scroll-mt-24">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-white font-bold text-xl">30 / 60 / 90-Day Growth Roadmap</h2>
              <span className="text-muted text-sm">
                Total impact: {formatImpact(totalImpact)} • {formatCurrency(totalImpact * 12)}/yr
              </span>
            </div>
            <div className="grid md:grid-cols-3 gap-4">
              <RoadmapColumn title="30-Day Sprint" color="red" items={roadmap30} />
              <RoadmapColumn title="60-Day Build" color="orange" items={roadmap60} />
              <RoadmapColumn title="90-Day Scale" color="teal" items={roadmap90} />
            </div>
            {audit.roadmapItems.length === 0 && (
              <p className="text-muted text-sm mt-4 text-center">Roadmap items will appear after Claude analyzes your findings.</p>
            )}
          </section>

          <section className="bg-panel border border-orange/30 rounded-2xl p-8 glow-orange text-center">
            <h3 className="text-white font-bold text-xl mb-2">Want Traffic Radius to implement all of this for you?</h3>
            <p className="text-muted text-sm mb-6 max-w-lg mx-auto">
              Our Done-For-You service handles every recommendation in your roadmap — from negative keywords to landing page rebuilds.
            </p>
            <Link to="/connect"><Button size="lg">Start a new audit <ChevronRight size={18} /></Button></Link>
          </section>
        </div>
      </main>

      {optimizeFinding && auditId && audit && (
        <AIOptimizationModal
          open={!!optimizeFinding}
          onClose={() => setOptimizeFinding(null)}
          auditId={auditId}
          finding={optimizeFinding}
          auditFindings={validFindings}
          accountName={audit.accountName}
          googleAdsCustomerId={audit.googleAdsCustomerId}
          goal={audit.goal}
          monthlySpend={audit.monthlySpend}
          userId={audit.userId}
        />
      )}
    </div>
  );
}

function FindingRow({
  finding,
  index,
  onMakeItBetter,
}: {
  finding: Finding;
  index: number;
  onMakeItBetter?: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.03 }}
      className="bg-panel border border-border rounded-xl p-4 hover:border-orange/20 transition-colors"
    >
      <div className="flex items-start gap-4">
        <SeverityDot severity={finding.severity} className="mt-1.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <h3 className="text-white font-semibold text-sm mb-1">{finding.title}</h3>
          <p className="text-muted text-xs leading-relaxed mb-2">{finding.description}</p>
          {finding.recommendation && (
            <p className="text-teal/80 text-xs leading-relaxed mb-2 italic">{finding.recommendation}</p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{finding.category.replace('_', ' ')}</Badge>
            <span className="text-muted text-[10px]">{finding.dimension}</span>
            {onMakeItBetter && <MakeItBetterButton onClick={onMakeItBetter} />}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-teal font-bold text-sm">{formatImpact(finding.impactMonthly)}</div>
          <div className="text-muted text-[10px] mt-1">Confidence {finding.confidence}%</div>
          <div className="w-16 h-1 bg-navy rounded-full mt-1 ml-auto overflow-hidden">
            <div className="h-full bg-teal rounded-full" style={{ width: `${finding.confidence}%` }} />
          </div>
          <div className={clsx('text-[10px] font-semibold mt-2', finding.status === 'OPEN' ? 'text-orange' : 'text-teal')}>
            {finding.status}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function RoadmapColumn({ title, color, items }: { title: string; color: string; items: { id: string; order: number; title: string; effort: string; owner: string }[] }) {
  const borderColor = color === 'red' ? 'border-red-500/30' : color === 'orange' ? 'border-orange/30' : 'border-teal/30';
  const titleColor = color === 'red' ? 'text-red-400' : color === 'orange' ? 'text-orange' : 'text-teal';

  return (
    <div className={`bg-panel border ${borderColor} rounded-xl p-4`}>
      <h3 className={`font-bold text-sm mb-4 ${titleColor}`}>{title}</h3>
      <div className="space-y-2">
        {items.length === 0 ? (
          <p className="text-muted text-xs">No items yet</p>
        ) : items.map((item) => (
          <div key={item.id} className="bg-navy border border-border rounded-lg p-3">
            <div className="flex items-start gap-2">
              <span className="text-muted text-xs font-bold">{item.order}</span>
              <div>
                <p className="text-white text-xs font-medium">{item.title}</p>
                <div className="flex gap-1.5 mt-1.5">
                  <Badge variant="muted">{item.effort} effort</Badge>
                  <Badge variant="outline">{item.owner}</Badge>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
