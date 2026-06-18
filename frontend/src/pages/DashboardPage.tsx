import { useState, useMemo, useCallback, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Share2, Download, ArrowLeft, Link2, ChevronRight,
  AlertTriangle, TrendingUp, Target, Heart, Megaphone,
  Search, Globe, Users, FileText, BarChart3, MapPin, Eye, Sparkles, History,
} from 'lucide-react';
import clsx from 'clsx';
import { Logo } from '../components/layout/Logo';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { HealthProgressBar } from '../components/ui/ProgressBar';
import { HealthChart } from '../charts/HealthChart';
import { SeverityDot } from '../components/ui/Severity';
import { formatImpact, formatCurrency, getHealthLabel } from '../utils/helpers';
import {
  filterFindings,
  countFindingsForModule,
  moduleLabelForSlug,
  isFailureFinding,
  SEVERITY_FILTERS,
  CATEGORY_FILTERS,
  FINDINGS_NAV_MODULES,
  type SeverityFilter,
  type CategoryFilterId,
} from '../utils/findingFilters';
import { useAuditReport } from '../hooks/useAuditPolling';
import { auditApi } from '../services/api';
import type { Finding } from '../types';
import { AIOptimizationModal, MakeItBetterButton, isOptimizableFinding } from '../components/optimization';
import { CampaignAuditsSection } from '../components/dashboard/CampaignAuditsSection';
import { AccountPerformanceStats } from '../components/dashboard/AccountPerformanceStats';
import { PreviousAuditsList } from '../components/dashboard/PreviousAuditsList';
import { usePreviousAudits } from '../hooks/usePreviousAudits';
import { useAuthStore } from '../store';

const MODULE_NAV_ICONS: Record<string, typeof FileText> = {
  'search-terms': Search,
  keywords: Target,
  quality: BarChart3,
  bidding: TrendingUp,
  'ad-copy': FileText,
  audiences: Users,
  geo: MapPin,
  landing: Globe,
  impression: Eye,
  pmax: Sparkles,
  campaign: Megaphone,
  budget: TrendingUp,
  conversion: Heart,
  device: BarChart3,
};

const baseNavItems: Array<{
  id: string;
  label: string;
  icon: typeof FileText;
  sectionId: string;
  badge?: boolean;
  sub?: string;
  moduleSlug?: string;
  accountOnly?: boolean;
}> = [
  { id: 'executive', label: 'Executive Summary', icon: FileText, sectionId: 'executive' },
  { id: 'previous-audits', label: 'Previous Audits', icon: History, sectionId: 'previous-audits' },
  { id: 'campaigns', label: 'Your Campaigns', icon: Megaphone, sectionId: 'campaign-audits', accountOnly: true },
  { id: 'findings', label: 'All Findings', icon: AlertTriangle, badge: true, sectionId: 'findings' },
  { id: 'roadmap', label: 'Growth Roadmap', icon: TrendingUp, sub: '30/60/90d', sectionId: 'roadmap' },
  { id: 'health', label: 'Account Health', icon: Heart, sectionId: 'health' },
  ...FINDINGS_NAV_MODULES.map((m) => ({
    id: m.id,
    label: m.label,
    icon: MODULE_NAV_ICONS[m.id] ?? FileText,
    sectionId: 'findings' as const,
    moduleSlug: m.slug,
  })),
];

export default function DashboardPage() {
  const { auditId } = useParams<{ auditId: string }>();
  const { audit, loading, backfilling } = useAuditReport(auditId);
  const authUser = useAuthStore((s) => s.user);
  const { audits: previousAudits, userEmail: previousAuditsEmail, loading: previousAuditsLoading, error: previousAuditsError } = usePreviousAudits(!!authUser);
  const [activeSection, setActiveSection] = useState('executive');
  const [activeSeverity, setActiveSeverity] = useState<SeverityFilter>('All');
  const [activeCategory, setActiveCategory] = useState<CategoryFilterId | null>(null);
  const [activeModuleSlug, setActiveModuleSlug] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  const [shareCopied, setShareCopied] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [optimizeFinding, setOptimizeFinding] = useState<Finding | null>(null);
  const [optimizeCampaignId, setOptimizeCampaignId] = useState<string | undefined>();
  const mainRef = useRef<HTMLDivElement>(null);

  const validFindings = useMemo(
    () => (audit?.findings ?? []).filter((f) => !isFailureFinding(f)),
    [audit]
  );

  const filteredFindings = useMemo(
    () => filterFindings(validFindings, {
      moduleSlug: activeModuleSlug,
      severityFilter: activeSeverity,
      categoryFilter: activeCategory,
    }),
    [validFindings, activeModuleSlug, activeSeverity, activeCategory]
  );

  const findingsSectionTitle = activeModuleSlug
    ? `${moduleLabelForSlug(activeModuleSlug)} Findings`
    : activeCategory
      ? `${activeCategory} Findings`
      : 'All Findings';

  const healthScore = audit?.healthScore
    ?? (audit?.healthScores?.length
      ? Math.round(audit.healthScores.reduce((s, h) => s + h.score, 0) / audit.healthScores.length)
      : null);
  const totalImpact = audit?.totalImpact ?? validFindings.reduce((s, f) => s + f.impactMonthly, 0);
  const healthLabel = getHealthLabel(healthScore ?? 50);

  const navItems = useMemo(() => {
    const showCampaigns = audit?.status === 'COMPLETED' && audit.auditScope !== 'campaign';
    return baseNavItems.filter((item) => !('accountOnly' in item && item.accountOnly) || showCampaigns);
  }, [audit?.status, audit?.auditScope]);

  const scrollToSection = useCallback((sectionId: string) => {
    const el = document.getElementById(sectionId);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const handleNavClick = (item: (typeof baseNavItems)[number]) => {
    setActiveSection(item.id);
    if (item.moduleSlug) {
      setActiveModuleSlug(item.moduleSlug);
      setActiveCategory(null);
      setActiveSeverity('All');
    } else if (item.id === 'findings') {
      setActiveModuleSlug(null);
      setActiveCategory(null);
      setActiveSeverity('All');
    } else {
      setActiveModuleSlug(null);
      setActiveCategory(null);
    }
    scrollToSection(item.sectionId);
  };

  const clearFindingsFilters = () => {
    setActiveModuleSlug(null);
    setActiveCategory(null);
    setActiveSeverity('All');
    setActiveSection('findings');
    scrollToSection('findings');
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

  const handleDownloadPdf = async () => {
    if (!auditId) return;
    setPdfError(null);
    setPdfLoading(true);
    try {
      await auditApi.downloadPdf(auditId, audit?.accountName);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not open audit report';
      setPdfError(message);
      try {
        window.open(`${auditApi.pdfUrl(auditId)}?inline=1`, '_blank', 'noopener,noreferrer');
      } catch {
        /* popup blocked */
      }
    } finally {
      setPdfLoading(false);
    }
  };

  if (loading || !audit) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center">
        <div className="text-center space-y-3">
          <div className="skeleton w-64 h-8 rounded mx-auto" />
          {backfilling && (
            <p className="text-muted text-sm">Generating missing module findings with Claude...</p>
          )}
        </div>
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
          {navItems.map((item) => {
            const moduleCount = item.moduleSlug
              ? countFindingsForModule(validFindings, item.moduleSlug)
              : 0;
            return (
            <button
              key={item.id}
              type="button"
              onClick={() => handleNavClick(item)}
              className={clsx(
                'w-full flex items-center gap-2.5 px-4 py-2.5 text-left text-sm transition-colors',
                activeSection === item.id
                  || (item.id === 'findings' && !activeModuleSlug && !activeCategory && activeSeverity === 'All')
                  || (item.moduleSlug != null && activeModuleSlug === item.moduleSlug)
                  ? 'bg-orange/10 text-white border-l-2 border-orange'
                  : 'text-muted hover:text-white hover:bg-panel/50 border-l-2 border-transparent',
                item.moduleSlug && moduleCount === 0 && 'opacity-60'
              )}
            >
              <item.icon size={16} />
              <span className="flex-1">{item.label}</span>
              {item.badge && validFindings.length > 0 && (
                <span className="bg-red-500/20 text-red-400 text-[10px] font-bold px-1.5 py-0.5 rounded">
                  {validFindings.length}
                </span>
              )}
              {item.moduleSlug && moduleCount > 0 && (
                <span className="bg-orange/15 text-orange text-[10px] font-bold px-1.5 py-0.5 rounded">
                  {moduleCount}
                </span>
              )}
              {item.sub && <span className="text-[9px] text-muted">{item.sub}</span>}
            </button>
            );
          })}
        </nav>

        <div className="p-4 space-y-2 border-t border-border">
          <Button variant="outline" size="sm" className="w-full" onClick={handleShare}>
            <Link2 size={14} /> {shareCopied ? 'Link copied!' : 'Share report link'}
          </Button>
          <Button variant="secondary" size="sm" className="w-full" onClick={handleDownloadPdf} disabled={pdfLoading}>
            <Download size={14} /> {pdfLoading ? 'Opening report...' : 'View PDF Report'}
          </Button>
          {pdfError && (
            <p className="text-red-400 text-[10px]">{pdfError}</p>
          )}
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
                <h1 className="text-white font-bold text-lg">
                  {audit.auditScope === 'campaign' ? 'Campaign Audit' : 'Audit Report'} • {audit.accountName}
                </h1>
                <Badge variant="teal">✓ Audit Complete • {audit.modulesComplete}/{audit.totalModules} modules</Badge>
                {audit.auditScope === 'campaign' && (
                  <Badge variant="orange">Campaign deep-dive</Badge>
                )}
              </div>
              <p className="text-muted text-xs mt-1">
                Generated {audit.completedAt ? new Date(audit.completedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'} • {audit.dataWindowDays}-day data window • Engine v{audit.engineVersion}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Link to="/connect-account" className="text-muted text-sm hover:text-white flex items-center gap-1">
                <ArrowLeft size={14} /> New audit
              </Link>
              <button
                type="button"
                onClick={() => handleNavClick({ id: 'previous-audits', label: 'Previous Audits', icon: History, sectionId: 'previous-audits' })}
                className="text-muted text-sm hover:text-white flex items-center gap-1"
              >
                <History size={14} /> Previous audits
              </button>
              <Button size="sm" onClick={handleShare}><Share2 size={14} /> Share</Button>
            </div>
          </div>
        </header>

        <div className="px-8 py-6 space-y-8 max-w-5xl">
          {backfilling && (
            <div className="bg-orange/10 border border-orange/30 rounded-xl p-4 text-sm text-orange">
              Generating missing module findings with Claude (Quality Score, Bidding, Audiences, etc.)...
            </div>
          )}
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

            {audit.googleAdsCustomerId && audit.status === 'COMPLETED' && (
              <div className="mb-6">
                <AccountPerformanceStats
                  googleAdsCustomerId={audit.googleAdsCustomerId}
                  dataWindowDays={audit.dataWindowDays}
                />
              </div>
            )}

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

          <section id="previous-audits" className="scroll-mt-24">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-white font-bold text-xl">Previous Audits</h2>
                <p className="text-muted text-sm">
                  All audits run while signed in as {previousAuditsEmail || authUser?.email || 'your Google account'}
                </p>
              </div>
              <Link to="/connect-account">
                <Button size="sm" variant="outline">Start new audit</Button>
              </Link>
            </div>
            <PreviousAuditsList
              audits={previousAudits}
              loading={previousAuditsLoading}
              error={previousAuditsError}
              userEmail={previousAuditsEmail || authUser?.email}
              currentAuditId={auditId}
              emptyMessage="No other audits found for this Gmail account."
            />
          </section>

          {audit.status === 'COMPLETED' && (
            <CampaignAuditsSection
              auditId={auditId!}
              googleAdsCustomerId={audit.googleAdsCustomerId}
              dataWindowDays={audit.dataWindowDays}
              auditScope={audit.auditScope}
              parentAuditId={audit.parentAuditId}
              campaignName={audit.campaignName}
              onOptimizeCampaign={(finding, campaignId) => {
                setOptimizeCampaignId(campaignId);
                setOptimizeFinding(finding);
              }}
            />
          )}

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
              <h2 className="text-white font-bold text-xl">{findingsSectionTitle}</h2>
              <p className="text-muted text-sm">
                {filteredFindings.length} findings • sorted by financial impact
                {(activeModuleSlug || activeCategory || activeSeverity !== 'All') && (
                  <button type="button" onClick={clearFindingsFilters} className="ml-2 text-orange hover:underline">
                    Clear filters
                  </button>
                )}
              </p>
            </div>

            <div className="flex gap-2 overflow-x-auto pb-3 mb-2">
              {SEVERITY_FILTERS.map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => {
                    setActiveSeverity(f);
                    setActiveSection('findings');
                    scrollToSection('findings');
                  }}
                  className={clsx(
                    'px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap border transition-colors',
                    activeSeverity === f && !activeCategory && !activeModuleSlug
                      ? 'bg-orange/15 text-orange border-orange/30'
                      : activeSeverity === f
                        ? 'bg-orange/10 text-orange border-orange/20'
                        : 'bg-panel text-muted border-border hover:text-white'
                  )}
                >
                  {f}
                  {f === 'All' && ` (${validFindings.length})`}
                  {f === 'Critical' && ` (${validFindings.filter((x) => x.severity === 'CRITICAL').length})`}
                  {f === 'High' && ` (${validFindings.filter((x) => x.severity === 'HIGH').length})`}
                  {f === 'Medium' && ` (${validFindings.filter((x) => x.severity === 'MEDIUM').length})`}
                  {f === 'Low' && ` (${validFindings.filter((x) => x.severity === 'LOW').length})`}
                </button>
              ))}
            </div>

            <div className="flex gap-2 overflow-x-auto pb-3 mb-4">
              {CATEGORY_FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => {
                    setActiveCategory(activeCategory === f.id ? null : f.id);
                    setActiveModuleSlug(null);
                    setActiveSection('findings');
                    scrollToSection('findings');
                  }}
                  className={clsx(
                    'px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap border transition-colors',
                    activeCategory === f.id
                      ? 'bg-teal/15 text-teal border-teal/30'
                      : 'bg-panel text-muted border-border hover:text-white'
                  )}
                >
                  {f.id}
                </button>
              ))}
            </div>

            <div className="space-y-3">
              {filteredFindings.length === 0 ? (
                <p className="text-muted text-sm py-8 text-center">
                  {activeModuleSlug
                    ? `No findings for ${moduleLabelForSlug(activeModuleSlug)} in this audit.`
                    : activeCategory
                      ? `No findings in the ${activeCategory} category for this audit.`
                      : 'No findings match the current filters.'}
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
          onClose={() => {
            setOptimizeFinding(null);
            setOptimizeCampaignId(undefined);
          }}
          auditId={auditId}
          finding={optimizeFinding}
          auditFindings={validFindings}
          accountName={audit.accountName}
          googleAdsCustomerId={audit.googleAdsCustomerId}
          websiteUrl={audit.websiteUrl}
          goal={audit.goal}
          monthlySpend={audit.monthlySpend}
          userId={audit.userId}
          initialCampaignId={optimizeCampaignId}
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
