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
import { runLiveAudit, type LiveAuditConfig } from '../audit-engine/live-audit.runner.js';

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

  const account: Account = {
    id: generateId('acc_'),
    userId,
    name: data.accountName || DEFAULT_ACCOUNT.name,
    monthlySpend: data.monthlySpend ?? DEFAULT_ACCOUNT.monthlySpend,
    campaignCount: data.campaignCount ?? DEFAULT_ACCOUNT.campaignCount,
    websiteUrl: data.websiteUrl || DEFAULT_ACCOUNT.websiteUrl,
    goal: formatGoal(data.goal),
    isConnected: true,
  };
  await auditStore.saveAccount(account, data.googleAdsCustomerId);

  const auditId = generateId('aud_');
  const estimatedMinutes = estimateMinutes(totalModules, depth, getParallelStreamCount());

  const liveConfig: LiveAuditConfig = {
    accountName: account.name,
    monthlySpend: account.monthlySpend,
    campaignCount: account.campaignCount,
    websiteUrl: account.websiteUrl,
    email: data.email,
    goal: account.goal,
    googleAdsCustomerId: data.googleAdsCustomerId,
    auditDepth: depth,
    auditWindow: dataWindowDays,
    selectedModules: data.selectedModules,
    competitors: data.competitors,
  };

  const audit: AuditRun = {
    id: auditId,
    userId,
    accountId: account.id,
    accountName: account.name,
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
    modules,
    findings: [],
    healthScores: [],
    roadmapItems: [],
    logs: [
      {
        id: generateId('log_'),
        message: `Audit initiated for ${account.name}`,
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
