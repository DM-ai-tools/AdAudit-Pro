import { generateId } from '../services/mock-store.js';
import { auditStore } from '../services/audit-store.service.js';
import { getMe } from '../services/user.service.js';
import { fetchModuleGoogleAdsData, fetchCampaignAuditContext, isGoogleAdsConfigured } from '../services/google-ads.service.js';
import { generateExecutiveSummary } from '../ai/claude.service.js';
import { getParallelApiKeys, getParallelStreamCount, getPrimaryApiKey } from '../ai/anthropic-pool.js';
import {
  generateModuleFindings,
  generateHealthScoresFromFindings,
  generateRoadmapWithClaude,
} from '../ai/module-analysis.service.js';
import { dateRangeForWindow, estimateMinutes } from '../audit-engine/module-queries.js';
import { ALL_AUDIT_MODULE_IDS, getModuleCatalogName } from '../data/audit-module-catalog.js';
import type { AuditModule, Finding, RoadmapItem } from '../types/index.js';

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
  auditScope?: 'account' | 'campaign';
  campaignId?: string;
  campaignName?: string;
  parentAuditId?: string;
  campaignContext?: string;
}

const activeRuns = new Set<string>();

function enrichModuleData(raw: string, config: LiveAuditConfig): string {
  if (!raw) return raw;
  if (config.campaignContext && config.auditScope === 'campaign') {
    try {
      const moduleRows = JSON.parse(raw);
      const campaignContext = JSON.parse(config.campaignContext);
      return JSON.stringify({ campaignContext, moduleRows }, null, 0);
    } catch {
      return raw;
    }
  }
  return raw;
}

function chunkSequential<T>(arr: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += chunkSize) {
    chunks.push(arr.slice(i, i + chunkSize));
  }
  return chunks;
}

function createRoadmapFromFindings(findings: Finding[]): RoadmapItem[] {
  const sorted = [...findings]
    .filter((f) => !/analysis incomplete|configure anthropic/i.test(f.title))
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

async function refreshAuditProgress(auditId: string, totalModules: number, depth: string) {
  const audit = await auditStore.getAudit(auditId);
  if (!audit) return;
  const complete = audit.modules.filter((m) => m.status === 'COMPLETED').length;
  const avgProgress = audit.modules.reduce((s, m) => s + m.progress, 0) / audit.modules.length;
  const parallelStreams = getParallelStreamCount();
  const baseEstimate = estimateMinutes(totalModules, depth || 'standard', parallelStreams);
  const remaining = complete >= totalModules
    ? 0
    : Math.max(1, Math.ceil(baseEstimate * (1 - complete / totalModules)));
  await auditStore.updateAudit(auditId, {
    modulesComplete: complete,
    progress: Math.round(avgProgress),
    estimatedMinutes: remaining,
  });
}

async function processSingleModule(
  auditId: string,
  mod: AuditModule,
  config: LiveAuditConfig,
  apiKey: string,
  refreshToken: string | undefined,
  customerId: string | undefined,
  dateRange: string,
  windowDays: number,
  userId: string
): Promise<void> {
  const slug = mod.slug;

  await auditStore.updateModule(auditId, slug, { status: 'RUNNING', progress: 15 });
  await auditStore.addLog(auditId, {
    id: generateId('log_'),
    message: `▶ Starting ${mod.name}...`,
    level: 'info',
    createdAt: new Date().toISOString(),
  });

  let googleAdsData = '';
  if (refreshToken && customerId && isGoogleAdsConfigured()) {
    await auditStore.addLog(auditId, {
      id: generateId('log_'),
      message: `Fetching Google Ads data for ${mod.name}...`,
      level: 'info',
      createdAt: new Date().toISOString(),
    });
    googleAdsData = await fetchModuleGoogleAdsData(
      refreshToken,
      customerId,
      slug,
      dateRange,
      userId,
      config.campaignId
    );
    googleAdsData = enrichModuleData(googleAdsData, config);
    await auditStore.updateModule(auditId, slug, { progress: 40 });
  }

  if (!googleAdsData) {
    googleAdsData = JSON.stringify({
      accountName: config.accountName,
      monthlySpend: config.monthlySpend,
      campaignCount: config.campaignCount,
      dataWindowDays: windowDays,
      goal: config.goal,
      websiteUrl: config.websiteUrl,
      auditScope: config.auditScope ?? 'account',
      campaignId: config.campaignId,
      campaignName: config.campaignName,
      note: config.campaignId
        ? `Campaign-scoped audit for ${config.campaignName ?? config.campaignId}.`
        : 'Limited Google Ads API rows — analysis based on account profile.',
    });
  }

  await auditStore.updateModule(auditId, slug, { progress: 55 });
  await auditStore.addLog(auditId, {
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
    apiKey,
    auditScope: config.auditScope,
    campaignName: config.campaignName,
    auditDepth: config.auditDepth,
  });

  await auditStore.updateModule(auditId, slug, { progress: 90 });

  for (const f of rawFindings) {
    const finding = { ...f, id: generateId('find_') };
    await auditStore.addFinding(auditId, finding);
    await auditStore.addLog(auditId, {
      id: generateId('log_'),
      message: `⚡ Finding: ${finding.title.slice(0, 70)}${finding.title.length > 70 ? '...' : ''}`,
      level: 'finding',
      createdAt: new Date().toISOString(),
    });
  }

  await auditStore.updateModule(auditId, slug, {
    status: 'COMPLETED',
    progress: 100,
    findingsCount: rawFindings.length,
  });
  await auditStore.addLog(auditId, {
    id: generateId('log_'),
    message: `✓ ${mod.name} complete — ${rawFindings.length} finding${rawFindings.length === 1 ? '' : 's'}`,
    level: 'success',
    createdAt: new Date().toISOString(),
  });
  const current = await auditStore.getAudit(auditId);
  if (current) {
    await refreshAuditProgress(auditId, current.totalModules, config.auditDepth || 'standard');
  }
}

async function processModuleChunk(
  auditId: string,
  modules: AuditModule[],
  apiKey: string,
  streamIndex: number,
  config: LiveAuditConfig,
  refreshToken: string | undefined,
  customerId: string | undefined,
  dateRange: string,
  windowDays: number,
  userId: string
): Promise<void> {
  await auditStore.addLog(auditId, {
    id: generateId('log_'),
    message: `Parallel stream ${streamIndex + 1} started (${modules.length} module${modules.length === 1 ? '' : 's'})...`,
    level: 'info',
    createdAt: new Date().toISOString(),
  });

  await Promise.all(
    modules.map((mod) =>
      processSingleModule(auditId, mod, config, apiKey, refreshToken, customerId, dateRange, windowDays, userId)
    )
  );
}

export function runLiveAudit(auditId: string, userId: string, config: LiveAuditConfig): void {
  if (activeRuns.has(auditId)) return;
  activeRuns.add(auditId);

  void (async () => {
    try {
      const user = await getMe(userId);
      const refreshToken = user?.googleRefreshToken;
      const customerId = config.googleAdsCustomerId?.replace(/-/g, '');
      const windowDays = config.auditWindow || 365;
      const dateRange = dateRangeForWindow(windowDays);
      const audit = await auditStore.getAudit(auditId);
      if (!audit) return;

      const parallelKeys = getParallelApiKeys();
      const streamCount = parallelKeys.length;

      if (refreshToken && customerId && isGoogleAdsConfigured()) {
        await auditStore.addLog(auditId, {
          id: generateId('log_'),
          message: config.auditScope === 'campaign' && config.campaignName
            ? `Google Ads API connected — fetching live data for campaign "${config.campaignName}"...`
            : 'Google Ads API connected — fetching live account data...',
          level: 'success',
          createdAt: new Date().toISOString(),
        });

        if (config.auditScope === 'campaign' && config.campaignId) {
          config.campaignContext = await fetchCampaignAuditContext(
            refreshToken,
            customerId,
            config.campaignId,
            userId,
            { dateRange }
          );
          if (config.campaignContext) {
            await auditStore.addLog(auditId, {
              id: generateId('log_'),
              message: 'Campaign context loaded — ad groups, keywords, ads, and search terms.',
              level: 'info',
              createdAt: new Date().toISOString(),
            });
          }
        }
      } else {
        await auditStore.addLog(auditId, {
          id: generateId('log_'),
          message: 'Using account profile data — connect Google Ads for deeper API metrics.',
          level: 'info',
          createdAt: new Date().toISOString(),
        });
      }

      await auditStore.addLog(auditId, {
        id: generateId('log_'),
        message: streamCount >= 3
          ? `Claude AI engine initialized — ${streamCount} parallel streams (${Math.ceil(audit.modules.length / streamCount)} modules each)...`
          : `Claude AI engine initialized — analyzing ${audit.modules.length} modules...`,
        level: 'info',
        createdAt: new Date().toISOString(),
      });

      if (streamCount >= 2) {
        const chunkSize = Math.ceil(audit.modules.length / streamCount);
        const chunks = chunkSequential(audit.modules, chunkSize);
        await Promise.all(
          chunks.map((chunk, idx) =>
            processModuleChunk(
              auditId,
              chunk,
              parallelKeys[idx] || parallelKeys[0],
              idx,
              config,
              refreshToken,
              customerId,
              dateRange,
              windowDays,
              userId
            )
          )
        );
      } else {
        const key = parallelKeys[0] || getPrimaryApiKey() || '';
        for (const mod of audit.modules) {
          await processSingleModule(
            auditId,
            mod,
            config,
            key,
            refreshToken,
            customerId,
            dateRange,
            windowDays,
            userId
          );
        }
      }

      const finalAudit = await auditStore.getAudit(auditId);
      if (!finalAudit) return;

      const summaryKey = getPrimaryApiKey() || parallelKeys[0];
      const healthScores = await generateHealthScoresFromFindings(
        finalAudit.findings,
        config.accountName,
        summaryKey
      );
      let roadmap = await generateRoadmapWithClaude(
        finalAudit.findings,
        config.accountName,
        summaryKey,
        { auditScope: config.auditScope, campaignName: config.campaignName }
      );
      if (!roadmap.length) {
        roadmap = createRoadmapFromFindings(finalAudit.findings);
      }
      const healthScore = healthScores.length
        ? Math.round(healthScores.reduce((s, h) => s + h.score, 0) / healthScores.length)
        : 50;

      await auditStore.setHealthScores(auditId, healthScores);
      await auditStore.setRoadmap(auditId, roadmap);

      await auditStore.addLog(auditId, {
        id: generateId('log_'),
        message: 'Generating executive summary with Claude...',
        level: 'info',
        createdAt: new Date().toISOString(),
      });

      const summary = await generateExecutiveSummary(
        config.accountName,
        finalAudit.findings,
        healthScore,
        { auditScope: config.auditScope, campaignName: config.campaignName }
      );

      await auditStore.updateAudit(auditId, {
        status: 'COMPLETED',
        progress: 100,
        modulesComplete: finalAudit.totalModules,
        completedAt: new Date().toISOString(),
        executiveSummary: summary,
        estimatedMinutes: 0,
      });

      await auditStore.addLog(auditId, {
        id: generateId('log_'),
        message: '✓ Audit complete — report ready.',
        level: 'success',
        createdAt: new Date().toISOString(),
      });
    } catch (err) {
      console.error('Live audit failed:', err);
      await auditStore.updateAudit(auditId, { status: 'FAILED' });
      await auditStore.addLog(auditId, {
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

function isSkippedFinding(f: Finding): boolean {
  return /analysis incomplete|configure anthropic/i.test(f.title);
}

function findingMatchesModuleSlug(finding: Finding, slug: string): boolean {
  if (isSkippedFinding(finding)) return false;
  const evidenceSlug = finding.evidence?.module;
  if (typeof evidenceSlug === 'string' && evidenceSlug === slug) return true;
  const name = getModuleCatalogName(slug);
  if (finding.dimension === name || finding.dimension.startsWith(name)) return true;
  return false;
}

function slugsMissingFindings(findings: Finding[]): string[] {
  return ALL_AUDIT_MODULE_IDS.filter((slug) => !findings.some((f) => findingMatchesModuleSlug(f, slug)));
}

export async function backfillMissingModules(
  auditRunId: string,
  userId: string
): Promise<{ added: number; slugs: string[] }> {
  const audit = await auditStore.getAudit(auditRunId);
  if (!audit) throw new Error('Audit not found');

  const missingSlugs = slugsMissingFindings(audit.findings);
  if (!missingSlugs.length) return { added: 0, slugs: [] };

  const user = await getMe(userId);
  const refreshToken = user?.googleRefreshToken;
  const customerId = audit.googleAdsCustomerId?.replace(/-/g, '');
  const windowDays = audit.dataWindowDays || 365;
  const dateRange = dateRangeForWindow(windowDays);

  const config: LiveAuditConfig = {
    accountName: audit.accountName,
    monthlySpend: audit.monthlySpend,
    campaignCount: audit.campaignCount,
    websiteUrl: audit.websiteUrl,
    goal: audit.goal,
    googleAdsCustomerId: audit.googleAdsCustomerId,
    auditDepth: 'deep',
    auditWindow: windowDays,
    auditScope: audit.auditScope,
    campaignId: audit.campaignId,
    campaignName: audit.campaignName,
    parentAuditId: audit.parentAuditId,
  };

  if (config.auditScope === 'campaign' && config.campaignId && refreshToken && customerId && isGoogleAdsConfigured()) {
    config.campaignContext = await fetchCampaignAuditContext(
      refreshToken,
      customerId,
      config.campaignId,
      userId,
      { dateRange }
    );
  }

  const apiKey = getPrimaryApiKey() || '';
  let added = 0;

  await auditStore.addLog(auditRunId, {
    id: generateId('log_'),
    message: `Backfilling ${missingSlugs.length} module${missingSlugs.length === 1 ? '' : 's'} with Claude...`,
    level: 'info',
    createdAt: new Date().toISOString(),
  });

  for (const slug of missingSlugs) {
    const name = getModuleCatalogName(slug);
    const mod = await auditStore.ensureModule(auditRunId, slug, name);
    await processSingleModule(
      auditRunId,
      mod,
      config,
      apiKey,
      refreshToken,
      customerId,
      dateRange,
      windowDays,
      userId
    );
    added += 1;
  }

  await auditStore.addLog(auditRunId, {
    id: generateId('log_'),
    message: `✓ Backfill complete — ${added} module${added === 1 ? '' : 's'} analyzed.`,
    level: 'success',
    createdAt: new Date().toISOString(),
  });

  return { added, slugs: missingSlugs };
}
