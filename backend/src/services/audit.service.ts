import { generateId } from './mock-store.js';
import { auditStore } from './audit-store.service.js';
import {
  findOrCreateUser,
  getMe,
  getUserByEmail,
  updateUser,
} from './user.service.js';
import type { AuditRun, Account } from '../types/index.js';
import { DEFAULT_ACCOUNT } from '../audit-engine/mock-data.js';
import { createModulesFromSelection, getAuditMetrics } from '../audit-engine/index.js';
import { estimateMinutes } from '../audit-engine/module-queries.js';
import { getParallelStreamCount } from '../ai/anthropic-pool.js';
import { resolveBusinessName } from '../utils/business-identity.js';
import { ALL_AUDIT_MODULE_IDS } from '../data/audit-module-catalog.js';
import { runLiveAudit, backfillMissingModules, type LiveAuditConfig } from '../audit-engine/live-audit.runner.js';

export interface StartAuditConfig {
  accountName?: string;
  monthlySpend?: number;
  campaignCount?: number;
  websiteUrl?: string;
  email?: string;
  name?: string;
  goal?: string;
  googleAdsCustomerId?: string;
  auditDepth?: string;
  auditWindow?: number;
  selectedModules?: string[];
  selectedCampaignIds?: string[];
  competitors?: string[];
  auditScope?: 'account' | 'campaign';
  campaignId?: string;
  campaignName?: string;
  parentAuditId?: string;
}

export { findOrCreateUser, getMe, getUserByEmail, updateUser };

export function saveUserGoogleTokens(userId: string, refreshToken?: string) {
  if (!refreshToken) return;
  void updateUser(userId, { googleRefreshToken: refreshToken });
}

function formatGoal(goal?: string): string {
  if (!goal) return 'Not specified';
  const labels: Record<string, string> = {
    leads: 'Lead generation',
    sales: 'Online sales',
    calls: 'Phone calls',
    traffic: 'Website traffic',
    awareness: 'Brand awareness',
  };
  return labels[goal] || goal;
}

export async function startAudit(
  userId: string,
  data: StartAuditConfig
): Promise<AuditRun> {
  const modules = createModulesFromSelection(data.selectedModules);
  const totalModules = modules.length;
  const dataWindowDays = data.auditWindow || 365;
  const depth = data.auditDepth || 'standard';

  const resolvedAccountName = resolveBusinessName(
    data.accountName || DEFAULT_ACCOUNT.name,
    data.websiteUrl
  );

  const account: Account = {
    id: generateId('acc_'),
    userId,
    name: resolvedAccountName,
    monthlySpend: data.monthlySpend ?? DEFAULT_ACCOUNT.monthlySpend,
    campaignCount: data.campaignCount ?? DEFAULT_ACCOUNT.campaignCount,
    websiteUrl: data.websiteUrl || DEFAULT_ACCOUNT.websiteUrl,
    goal: formatGoal(data.goal),
    isConnected: true,
  };
  await auditStore.saveAccount(account, data.googleAdsCustomerId);

  const auditId = generateId('aud_');
  const estimatedMinutes = estimateMinutes(totalModules, depth, getParallelStreamCount());

  const scope = data.auditScope ?? 'account';
  const displayName =
    scope === 'campaign' && data.campaignName
      ? `${resolvedAccountName} — ${data.campaignName}`
      : resolvedAccountName;

  const liveConfig: LiveAuditConfig = {
    accountName: displayName,
    monthlySpend: account.monthlySpend,
    campaignCount: data.campaignCount ?? account.campaignCount,
    websiteUrl: account.websiteUrl,
    email: data.email,
    goal: account.goal,
    googleAdsCustomerId: data.googleAdsCustomerId,
    auditDepth: depth,
    auditWindow: dataWindowDays,
    selectedModules: data.selectedModules,
    competitors: data.competitors,
    auditScope: scope,
    campaignId: data.campaignId,
    campaignName: data.campaignName,
    parentAuditId: data.parentAuditId,
  };

  const audit: AuditRun = {
    id: auditId,
    userId,
    accountId: account.id,
    accountName: displayName,
    status: 'RUNNING',
    progress: 0,
    modulesComplete: 0,
    totalModules,
    dataWindowDays,
    engineVersion: '2.4.1',
    startedAt: new Date().toISOString(),
    estimatedMinutes,
    monthlySpend: account.monthlySpend,
    campaignCount: account.campaignCount,
    email: data.email,
    goal: account.goal,
    googleAdsCustomerId: data.googleAdsCustomerId,
    websiteUrl: account.websiteUrl,
    auditScope: scope,
    campaignId: data.campaignId,
    campaignName: data.campaignName,
    parentAuditId: data.parentAuditId,
    selectedCampaignIds: data.selectedCampaignIds,
    modules,
    findings: [],
    healthScores: [],
    roadmapItems: [],
    logs: [
      {
        id: generateId('log_'),
        message: scope === 'campaign' && data.campaignName
          ? `Campaign audit initiated: ${data.campaignName}`
          : `Audit initiated for ${account.name}`,
        level: 'info',
        createdAt: new Date().toISOString(),
      },
      {
        id: generateId('log_'),
        message: 'Connecting to Google Ads API...',
        level: 'info',
        createdAt: new Date().toISOString(),
      },
      {
        id: generateId('log_'),
        message: `Account verified: ${account.campaignCount} campaigns, $${account.monthlySpend.toLocaleString()}/mo spend`,
        level: 'success',
        createdAt: new Date().toISOString(),
      },
    ],
  };

  await auditStore.saveAudit(audit);
  runLiveAudit(auditId, userId, liveConfig);
  return audit;
}

export async function startCampaignAudit(
  userId: string,
  parentAuditId: string,
  campaign: { id: string; name: string }
): Promise<AuditRun> {
  const parent = await getAuditReport(parentAuditId);
  if (!parent) throw new Error('Parent account audit not found');
  if (parent.userId !== userId) throw new Error('Not authorized for this audit');

  const moduleIds = ALL_AUDIT_MODULE_IDS;

  return startAudit(userId, {
    googleAdsCustomerId: parent.googleAdsCustomerId,
    accountName: parent.accountName.split(' — ')[0],
    monthlySpend: parent.monthlySpend,
    campaignCount: 1,
    websiteUrl: parent.websiteUrl,
    email: parent.email,
    goal: parent.goal,
    auditDepth: 'deep',
    auditWindow: parent.dataWindowDays as 30 | 90 | 365,
    selectedModules: moduleIds,
    selectedCampaignIds: [campaign.id],
    auditScope: 'campaign',
    campaignId: campaign.id,
    campaignName: campaign.name,
    parentAuditId,
  });
}

export async function getAuditStatus(id: string): Promise<AuditRun | null> {
  return auditStore.getAudit(id);
}

export async function getAuditReport(id: string): Promise<AuditRun | null> {
  return auditStore.getAudit(id);
}

export async function getAuditLogs(id: string) {
  const audit = await auditStore.getAudit(id);
  return audit?.logs || [];
}

export async function getAuditHealth(id: string) {
  const audit = await auditStore.getAudit(id);
  if (!audit) return null;
  const metrics = getAuditMetrics(audit.findings, audit.healthScores);
  return {
    overallScore: metrics.healthScore,
    scores: audit.healthScores,
    ...metrics,
  };
}

export async function createSharedReport(auditRunId: string, userId: string) {
  const audit = await auditStore.getAudit(auditRunId);
  if (!audit) throw new Error('Audit not found');
  if (audit.userId !== userId) throw new Error('Not authorized to share this audit');
  const token = generateId('shr_');
  const report = {
    id: generateId('sr_'),
    token,
    auditRunId,
    createdAt: new Date().toISOString(),
  };
  await auditStore.saveSharedReport({ ...report, userId });
  return report;
}

export async function getSharedReport(token: string) {
  const report = await auditStore.getSharedReport(token);
  if (!report) return null;
  const audit = await auditStore.getAudit(report.auditRunId);
  if (!audit) return null;
  return { report, audit };
}

export async function backfillAuditModules(auditRunId: string, userId: string): Promise<{ added: number; slugs: string[] }> {
  const audit = await auditStore.getAudit(auditRunId);
  if (!audit) throw new Error('Audit not found');
  if (audit.userId !== userId) throw new Error('Not authorized for this audit');
  if (audit.status !== 'COMPLETED') throw new Error('Audit must be completed before backfill');
  return backfillMissingModules(auditRunId, userId);
}

export async function backfillAuditModulesDemo(auditRunId: string): Promise<{ added: number; slugs: string[] }> {
  const audit = await auditStore.getAudit(auditRunId);
  if (!audit) throw new Error('Audit not found');
  if (audit.status !== 'COMPLETED') throw new Error('Audit must be completed before backfill');
  return backfillMissingModules(auditRunId, audit.userId);
}

export async function listUserAudits(userId: string, jwtEmail?: string) {
  const user = await getMe(userId);
  if (!user) throw new Error('User not found');
  if (jwtEmail && user.email.toLowerCase() !== jwtEmail.trim().toLowerCase()) {
    throw new Error('Not authorized');
  }
  const audits = await auditStore.listAuditsForUser(userId);
  return { audits, userEmail: user.email };
}
