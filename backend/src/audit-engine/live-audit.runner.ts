import { mockStore, generateId } from '../services/mock-store.js';
import { fetchModuleGoogleAdsData, isGoogleAdsConfigured } from '../services/google-ads.service.js';
import { generateExecutiveSummary } from '../ai/claude.service.js';
import {
  generateModuleFindings,
  generateHealthScoresFromFindings,
} from '../ai/module-analysis.service.js';
import { dateRangeForWindow, estimateMinutes } from '../audit-engine/module-queries.js';
import type { Finding, RoadmapItem } from '../types/index.js';

export interface LiveAuditConfig {
  accountName: string;
  monthlySpend: number;
  campaignCount: number;
  websiteUrl?: string;
  email?: string;
  goal?: string;
  googleAdsCustomerId?: string;
  auditDepth?: string;
  auditWindow?: number;
  selectedModules?: string[];
  competitors?: string[];
}

const activeRuns = new Set<string>();

function createRoadmapFromFindings(findings: Finding[]): RoadmapItem[] {
  const sorted = [...findings]
    .sort((a, b) => b.impactMonthly - a.impactMonthly)
    .slice(0, 10);
  const phases: Array<'DAY_30' | 'DAY_60' | 'DAY_90'> = [
    'DAY_30', 'DAY_30', 'DAY_30', 'DAY_30',
    'DAY_60', 'DAY_60', 'DAY_60',
    'DAY_90', 'DAY_90', 'DAY_90',
  ];
  return sorted.map((f, i) => ({
    id: generateId('rm_'),
    phase: phases[i] ?? 'DAY_90',
    order: i + 1,
    title: f.recommendation?.slice(0, 120) || f.title,
    description: f.description,
    effort: f.severity === 'CRITICAL' || f.severity === 'HIGH' ? 'LOW' : 'MEDIUM',
    owner: 'AGENCY' as const,
    impactMonthly: f.impactMonthly,
  }));
}

function bumpProgress(auditId: string, slug: string, from: number, to: number) {
  const audit = mockStore.getAudit(auditId);
  const mod = audit?.modules.find((m) => m.slug === slug);
  if (!mod || mod.status !== 'RUNNING') return;
  const next = Math.min(to, mod.progress + 8);
  if (next > mod.progress) {
    mockStore.updateModule(auditId, slug, { progress: next });
  }
}

function refreshAuditProgress(auditId: string) {
  const audit = mockStore.getAudit(auditId);
  if (!audit) return;
  const complete = audit.modules.filter((m) => m.status === 'COMPLETED').length;
  const avgProgress = audit.modules.reduce((s, m) => s + m.progress, 0) / audit.modules.length;
  const remaining = Math.max(1, Math.ceil((audit.estimatedMinutes || 18) * (1 - complete / audit.totalModules)));
  mockStore.updateAudit(auditId, {
    modulesComplete: complete,
    progress: Math.round(avgProgress),
    estimatedMinutes: remaining,
  });
}

export function runLiveAudit(auditId: string, userId: string, config: LiveAuditConfig): void {
  if (activeRuns.has(auditId)) return;
  activeRuns.add(auditId);

  void (async () => {
    try {
      const user = mockStore.getUser(userId);
      const refreshToken = user?.googleRefreshToken;
      const customerId = config.googleAdsCustomerId?.replace(/-/g, '');
      const windowDays = config.auditWindow || 365;
      const dateRange = dateRangeForWindow(windowDays);
      const audit = mockStore.getAudit(auditId);
      if (!audit) return;

      if (refreshToken && customerId && isGoogleAdsConfigured()) {
        mockStore.addLog(auditId, {
          id: generateId('log_'),
          message: 'Google Ads API connected — fetching live account data...',
          level: 'success',
          createdAt: new Date().toISOString(),
        });
      } else {
        mockStore.addLog(auditId, {
          id: generateId('log_'),
          message: 'Using account profile data — connect Google Ads for deeper API metrics.',
          level: 'info',
          createdAt: new Date().toISOString(),
        });
      }

      mockStore.addLog(auditId, {
        id: generateId('log_'),
        message: 'Claude AI engine initialized — analyzing modules sequentially...',
        level: 'info',
        createdAt: new Date().toISOString(),
      });

      for (const mod of audit.modules) {
        const slug = mod.slug;
        mockStore.updateModule(auditId, slug, { status: 'RUNNING', progress: 15 });
        mockStore.addLog(auditId, {
          id: generateId('log_'),
          message: `▶ Starting ${mod.name}...`,
          level: 'info',
          createdAt: new Date().toISOString(),
        });

        let googleAdsData = '';
        if (refreshToken && customerId && isGoogleAdsConfigured()) {
          mockStore.addLog(auditId, {
            id: generateId('log_'),
            message: `Fetching Google Ads data for ${mod.name}...`,
            level: 'info',
            createdAt: new Date().toISOString(),
          });
          googleAdsData = await fetchModuleGoogleAdsData(refreshToken, customerId, slug, dateRange);
          bumpProgress(auditId, slug, 15, 45);
        }

        if (!googleAdsData) {
          googleAdsData = JSON.stringify({
            accountName: config.accountName,
            monthlySpend: config.monthlySpend,
            campaignCount: config.campaignCount,
            dataWindowDays: windowDays,
            goal: config.goal,
            websiteUrl: config.websiteUrl,
            note: 'Limited Google Ads API rows — analysis based on account profile.',
          });
        }

        mockStore.updateModule(auditId, slug, { progress: 50 });
        mockStore.addLog(auditId, {
          id: generateId('log_'),
          message: `Claude AI analyzing ${mod.name}...`,
          level: 'info',
          createdAt: new Date().toISOString(),
        });

        const rawFindings = await generateModuleFindings({
          moduleSlug: slug,
          moduleName: mod.name,
          accountName: config.accountName,
          monthlySpend: config.monthlySpend,
          campaignCount: config.campaignCount,
          dataWindowDays: windowDays,
          goal: config.goal,
          googleAdsData,
          competitors: config.competitors,
        });

        mockStore.updateModule(auditId, slug, { progress: 85 });

        for (const f of rawFindings) {
          const finding = { ...f, id: generateId('find_') };
          mockStore.addFinding(auditId, finding);
          mockStore.addLog(auditId, {
            id: generateId('log_'),
            message: `⚡ Finding: ${finding.title.slice(0, 70)}${finding.title.length > 70 ? '...' : ''}`,
            level: 'finding',
            createdAt: new Date().toISOString(),
          });
        }

        mockStore.updateModule(auditId, slug, {
          status: 'COMPLETED',
          progress: 100,
          findingsCount: rawFindings.length,
        });
        mockStore.addLog(auditId, {
          id: generateId('log_'),
          message: `✓ ${mod.name} complete — ${rawFindings.length} finding${rawFindings.length === 1 ? '' : 's'}`,
          level: 'success',
          createdAt: new Date().toISOString(),
        });
        refreshAuditProgress(auditId);
      }

      const finalAudit = mockStore.getAudit(auditId)!;
      const healthScores = await generateHealthScoresFromFindings(
        finalAudit.findings,
        config.accountName
      );
      const roadmap = createRoadmapFromFindings(finalAudit.findings);
      const healthScore = healthScores.length
        ? Math.round(healthScores.reduce((s, h) => s + h.score, 0) / healthScores.length)
        : 50;

      mockStore.setHealthScores(auditId, healthScores);
      mockStore.setRoadmap(auditId, roadmap);

      mockStore.addLog(auditId, {
        id: generateId('log_'),
        message: 'Generating executive summary with Claude...',
        level: 'info',
        createdAt: new Date().toISOString(),
      });

      const summary = await generateExecutiveSummary(
        config.accountName,
        finalAudit.findings,
        healthScore
      );

      mockStore.updateAudit(auditId, {
        status: 'COMPLETED',
        progress: 100,
        modulesComplete: finalAudit.totalModules,
        completedAt: new Date().toISOString(),
        executiveSummary: summary,
        estimatedMinutes: 0,
      });

      mockStore.addLog(auditId, {
        id: generateId('log_'),
        message: '✓ Audit complete — report ready.',
        level: 'success',
        createdAt: new Date().toISOString(),
      });
    } catch (err) {
      console.error('Live audit failed:', err);
      mockStore.updateAudit(auditId, { status: 'FAILED' });
      mockStore.addLog(auditId, {
        id: generateId('log_'),
        message: `Audit failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
        level: 'error',
        createdAt: new Date().toISOString(),
      });
    } finally {
      activeRuns.delete(auditId);
    }
  })();
}
