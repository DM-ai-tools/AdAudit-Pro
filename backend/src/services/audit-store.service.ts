import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import type {
  Account,
  AuditLog,
  AuditModule,
  AuditRun,
  Finding,
  HealthScore,
  RoadmapItem,
  SharedReport,
} from '../types/index.js';
import { generateId } from './mock-store.js';
import { resolveBusinessName } from '../utils/business-identity.js';

const auditInclude = {
  account: true,
  modules: { orderBy: { order: 'asc' as const } },
  findings: { orderBy: { createdAt: 'asc' as const } },
  healthScores: true,
  roadmapItems: { orderBy: { order: 'asc' as const } },
  auditLogs: { orderBy: { createdAt: 'asc' as const } },
} satisfies Prisma.AuditRunInclude;

type AuditRow = Prisma.AuditRunGetPayload<{ include: typeof auditInclude }>;

const cache = new Map<string, AuditRun>();

function normalizeAuditBrand(audit: AuditRun): AuditRun {
  const accountName = resolveBusinessName(audit.accountName, audit.websiteUrl);
  return accountName === audit.accountName ? audit : { ...audit, accountName };
}

function mapRowToAuditRun(row: AuditRow): AuditRun {
  return normalizeAuditBrand({
    id: row.id,
    userId: row.userId,
    accountId: row.accountId,
    accountName: resolveBusinessName(row.account.name, row.account.websiteUrl ?? undefined),
    status: row.status,
    progress: row.progress,
    modulesComplete: row.modulesComplete,
    totalModules: row.totalModules,
    dataWindowDays: row.dataWindowDays,
    engineVersion: row.engineVersion,
    executiveSummary: row.executiveSummary ?? undefined,
    startedAt: row.startedAt?.toISOString(),
    completedAt: row.completedAt?.toISOString(),
    estimatedMinutes: row.estimatedMinutes ?? undefined,
    monthlySpend: row.account.monthlySpend,
    campaignCount: row.account.campaignCount,
    email: row.email ?? undefined,
    goal: row.account.goal ?? undefined,
    googleAdsCustomerId: row.googleAdsCustomerId ?? row.account.googleAdsId ?? undefined,
    websiteUrl: row.account.websiteUrl ?? undefined,
    modules: row.modules.map((m) => ({
      id: m.id,
      name: m.name,
      slug: m.slug,
      status: m.status,
      progress: m.progress,
      findingsCount: m.findingsCount,
      order: m.order,
    })),
    findings: row.findings.map((f) => ({
      id: f.id,
      severity: f.severity,
      title: f.title,
      description: f.description,
      recommendation: f.recommendation ?? undefined,
      confidence: f.confidence,
      impactMonthly: f.impactMonthly,
      evidence: (f.evidence as Record<string, unknown> | null) ?? undefined,
      category: f.category,
      dimension: f.dimension,
      status: f.status,
    })),
    healthScores: row.healthScores.map((h) => ({
      dimension: h.dimension,
      score: h.score,
      label: h.label ?? undefined,
    })),
    roadmapItems: row.roadmapItems.map((r) => ({
      id: r.id,
      phase: r.phase,
      order: r.order,
      title: r.title,
      description: r.description ?? undefined,
      effort: r.effort,
      owner: r.owner,
      impactMonthly: r.impactMonthly,
    })),
    logs: row.auditLogs.map((l) => ({
      id: l.id,
      message: l.message,
      level: l.level,
      createdAt: l.createdAt.toISOString(),
    })),
  });
}

function getCachedOrNull(id: string): AuditRun | null {
  return cache.get(id) ?? null;
}

function patchCache(id: string, patch: Partial<AuditRun>): AuditRun | null {
  const existing = cache.get(id);
  if (!existing) return null;
  const updated = { ...existing, ...patch };
  cache.set(id, updated);
  return updated;
}

async function loadAudit(id: string): Promise<AuditRun | null> {
  const row = await prisma.auditRun.findUnique({
    where: { id },
    include: auditInclude,
  });
  if (!row) return null;
  const audit = mapRowToAuditRun(row);
  cache.set(id, audit);
  return audit;
}

export const auditStore = {
  async saveAccount(account: Account, googleAdsCustomerId?: string): Promise<Account> {
    const googleAdsId = googleAdsCustomerId?.replace(/-/g, '') || undefined;
    await prisma.account.upsert({
      where: { id: account.id },
      create: {
        id: account.id,
        userId: account.userId,
        name: account.name,
        monthlySpend: account.monthlySpend,
        campaignCount: account.campaignCount,
        websiteUrl: account.websiteUrl,
        goal: account.goal,
        isConnected: account.isConnected,
        googleAdsId,
      },
      update: {
        name: account.name,
        monthlySpend: account.monthlySpend,
        campaignCount: account.campaignCount,
        websiteUrl: account.websiteUrl,
        goal: account.goal,
        isConnected: account.isConnected,
        googleAdsId,
      },
    });
    return account;
  },

  async saveAudit(audit: AuditRun): Promise<AuditRun> {
    cache.set(audit.id, audit);

    await prisma.auditRun.create({
      data: {
        id: audit.id,
        userId: audit.userId,
        accountId: audit.accountId,
        status: audit.status,
        progress: audit.progress,
        modulesComplete: audit.modulesComplete,
        totalModules: audit.totalModules,
        dataWindowDays: audit.dataWindowDays,
        engineVersion: audit.engineVersion,
        executiveSummary: audit.executiveSummary,
        email: audit.email,
        googleAdsCustomerId: audit.googleAdsCustomerId?.replace(/-/g, ''),
        startedAt: audit.startedAt ? new Date(audit.startedAt) : undefined,
        completedAt: audit.completedAt ? new Date(audit.completedAt) : undefined,
        estimatedMinutes: audit.estimatedMinutes,
        modules: {
          create: audit.modules.map((m) => ({
            id: m.id,
            name: m.name,
            slug: m.slug,
            status: m.status,
            progress: m.progress,
            findingsCount: m.findingsCount,
            order: m.order,
          })),
        },
        auditLogs: {
          create: audit.logs.map((l) => ({
            id: l.id,
            message: l.message,
            level: l.level,
            createdAt: new Date(l.createdAt),
          })),
        },
      },
    });

    return audit;
  },

  async getAudit(id: string): Promise<AuditRun | null> {
    const cached = getCachedOrNull(id);
    const audit = cached ?? (await loadAudit(id));
    if (!audit) return null;
    const normalized = normalizeAuditBrand(audit);
    if (normalized !== audit) cache.set(id, normalized);
    return normalized;
  },

  async updateAudit(id: string, partial: Partial<AuditRun>): Promise<AuditRun | null> {
    const existing = cache.get(id) ?? (await loadAudit(id));
    if (!existing) return null;

    const updated = { ...existing, ...partial };
    cache.set(id, updated);

    const data: Prisma.AuditRunUpdateInput = {};
    if (partial.status !== undefined) data.status = partial.status;
    if (partial.progress !== undefined) data.progress = partial.progress;
    if (partial.modulesComplete !== undefined) data.modulesComplete = partial.modulesComplete;
    if (partial.executiveSummary !== undefined) data.executiveSummary = partial.executiveSummary;
    if (partial.estimatedMinutes !== undefined) data.estimatedMinutes = partial.estimatedMinutes;
    if (partial.completedAt !== undefined) {
      data.completedAt = partial.completedAt ? new Date(partial.completedAt) : null;
    }

    if (Object.keys(data).length > 0) {
      await prisma.auditRun.update({ where: { id }, data });
    }

    return updated;
  },

  async addFinding(auditId: string, finding: Finding): Promise<void> {
    let audit = getCachedOrNull(auditId);
    if (!audit) audit = await loadAudit(auditId);
    if (!audit) return;

    audit.findings.push(finding);
    cache.set(auditId, audit);

    await prisma.finding.create({
      data: {
        id: finding.id,
        auditRunId: auditId,
        severity: finding.severity,
        title: finding.title,
        description: finding.description,
        recommendation: finding.recommendation,
        confidence: finding.confidence,
        impactMonthly: finding.impactMonthly,
        evidence: (finding.evidence ?? undefined) as Prisma.InputJsonValue | undefined,
        category: finding.category,
        dimension: finding.dimension,
        status: finding.status,
      },
    });
  },

  async addLog(auditId: string, log: AuditLog): Promise<void> {
    let audit = getCachedOrNull(auditId);
    if (!audit) audit = await loadAudit(auditId);
    if (!audit) return;

    audit.logs.push(log);
    cache.set(auditId, audit);

    await prisma.auditLog.create({
      data: {
        id: log.id,
        auditRunId: auditId,
        message: log.message,
        level: log.level,
        createdAt: new Date(log.createdAt),
      },
    });
  },

  async ensureModule(auditId: string, slug: string, name: string): Promise<AuditModule> {
    let audit = getCachedOrNull(auditId);
    if (!audit) audit = await loadAudit(auditId);
    if (!audit) throw new Error('Audit not found');

    const existing = audit.modules.find((m) => m.slug === slug);
    if (existing) return existing;

    const mod: AuditModule = {
      id: generateId('mod_'),
      name,
      slug,
      status: 'PENDING',
      progress: 0,
      findingsCount: 0,
      order: audit.modules.length + 1,
    };

    audit.modules.push(mod);
    cache.set(auditId, audit);

    await prisma.auditModule.create({
      data: {
        id: mod.id,
        auditRunId: auditId,
        name: mod.name,
        slug: mod.slug,
        status: mod.status,
        progress: mod.progress,
        findingsCount: mod.findingsCount,
        order: mod.order,
      },
    });

    await prisma.auditRun.update({
      where: { id: auditId },
      data: { totalModules: audit.modules.length },
    });

    return mod;
  },

  async updateModule(
    auditId: string,
    slug: string,
    partial: Partial<AuditModule>
  ): Promise<void> {
    let audit = getCachedOrNull(auditId);
    if (!audit) audit = await loadAudit(auditId);
    if (!audit) return;

    audit.modules = audit.modules.map((m) => (m.slug === slug ? { ...m, ...partial } : m));
    cache.set(auditId, audit);

    const mod = audit.modules.find((m) => m.slug === slug);
    if (!mod) return;

    const data: Prisma.AuditModuleUpdateInput = {};
    if (partial.status !== undefined) data.status = partial.status;
    if (partial.progress !== undefined) data.progress = partial.progress;
    if (partial.findingsCount !== undefined) data.findingsCount = partial.findingsCount;

    if (Object.keys(data).length > 0) {
      await prisma.auditModule.update({ where: { id: mod.id }, data });
    }
  },

  async setHealthScores(auditId: string, scores: HealthScore[]): Promise<void> {
    patchCache(auditId, { healthScores: scores });

    await prisma.healthScore.deleteMany({ where: { auditRunId: auditId } });
    if (scores.length) {
      await prisma.healthScore.createMany({
        data: scores.map((s) => ({
          id: generateId('hs_'),
          auditRunId: auditId,
          dimension: s.dimension,
          score: s.score,
          label: s.label,
        })),
      });
    }
  },

  async setRoadmap(auditId: string, items: RoadmapItem[]): Promise<void> {
    patchCache(auditId, { roadmapItems: items });

    await prisma.roadmapItem.deleteMany({ where: { auditRunId: auditId } });
    if (items.length) {
      await prisma.roadmapItem.createMany({
        data: items.map((item) => ({
          id: item.id,
          auditRunId: auditId,
          phase: item.phase,
          order: item.order,
          title: item.title,
          description: item.description,
          effort: item.effort,
          owner: item.owner,
          impactMonthly: item.impactMonthly,
        })),
      });
    }
  },

  async saveSharedReport(report: SharedReport & { userId: string }): Promise<SharedReport> {
    await prisma.sharedReport.create({
      data: {
        id: report.id,
        token: report.token,
        auditRunId: report.auditRunId,
        userId: report.userId,
      },
    });
    return report;
  },

  async getSharedReport(token: string): Promise<SharedReport | null> {
    const row = await prisma.sharedReport.findUnique({ where: { token } });
    if (!row) return null;
    return {
      id: row.id,
      token: row.token,
      auditRunId: row.auditRunId,
      createdAt: row.createdAt.toISOString(),
    };
  },

  async listAuditsForUser(userId: string) {
    const rows = await prisma.auditRun.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: {
        account: true,
        healthScores: { select: { score: true } },
        auditLogs: {
          where: { message: { startsWith: 'Campaign audit initiated:' } },
          take: 1,
          orderBy: { createdAt: 'asc' },
        },
        findings: { select: { impactMonthly: true, severity: true, title: true } },
      },
    });

    return rows.map((row) => {
      const validFindings = row.findings.filter(
        (f) => !/analysis incomplete|configure anthropic/i.test(f.title)
      );
      const totalImpact = validFindings.reduce((s, f) => s + f.impactMonthly, 0);
      const criticalCount = validFindings.filter((f) => f.severity === 'CRITICAL').length;
      const healthScore = row.healthScores.length
        ? Math.round(row.healthScores.reduce((s, h) => s + h.score, 0) / row.healthScores.length)
        : null;
      const campaignLog = row.auditLogs[0]?.message;
      const campaignName = campaignLog
        ? campaignLog.replace(/^Campaign audit initiated:\s*/i, '').trim()
        : undefined;
      const auditScope = campaignName ? ('campaign' as const) : ('account' as const);
      const accountName = resolveBusinessName(row.account.name, row.account.websiteUrl ?? undefined);
      const displayName =
        auditScope === 'campaign' && campaignName
          ? `${accountName} — ${campaignName}`
          : accountName;

      return {
        id: row.id,
        accountName: displayName,
        baseAccountName: accountName,
        status: row.status,
        progress: row.progress,
        modulesComplete: row.modulesComplete,
        totalModules: row.totalModules,
        findingsCount: validFindings.length,
        healthScore,
        totalImpact,
        criticalCount,
        dataWindowDays: row.dataWindowDays,
        googleAdsCustomerId: row.googleAdsCustomerId ?? row.account.googleAdsId ?? undefined,
        auditScope,
        campaignName,
        monthlySpend: row.account.monthlySpend,
        campaignCount: row.account.campaignCount,
        goal: row.account.goal ?? undefined,
        startedAt: row.startedAt?.toISOString(),
        completedAt: row.completedAt?.toISOString(),
        createdAt: row.createdAt.toISOString(),
      };
    });
  },
};
