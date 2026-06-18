export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
export type AuditStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
export type ModuleStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';

export interface User {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string;
}

export interface AuditModule {
  id: string;
  name: string;
  slug: string;
  status: ModuleStatus;
  progress: number;
  findingsCount: number;
  order: number;
}

export interface Finding {
  id: string;
  severity: Severity;
  title: string;
  description: string;
  recommendation?: string;
  confidence: number;
  impactMonthly: number;
  evidence?: Record<string, unknown>;
  category: string;
  dimension: string;
  status: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';
}

export interface HealthScore {
  dimension: string;
  score: number;
  label?: string;
}

export interface RoadmapItem {
  id: string;
  phase: 'DAY_30' | 'DAY_60' | 'DAY_90';
  order: number;
  title: string;
  description?: string;
  effort: 'LOW' | 'MEDIUM' | 'HIGH';
  owner: 'CLIENT' | 'AGENCY' | 'SHARED';
  impactMonthly: number;
}

export interface AuditLog {
  id: string;
  message: string;
  level: string;
  createdAt: string;
}

export interface AuditRun {
  id: string;
  userId: string;
  accountId: string;
  accountName: string;
  status: AuditStatus;
  progress: number;
  modulesComplete: number;
  totalModules: number;
  dataWindowDays: number;
  engineVersion: string;
  executiveSummary?: string;
  startedAt?: string;
  completedAt?: string;
  estimatedMinutes?: number;
  monthlySpend: number;
  campaignCount: number;
  email?: string;
  goal?: string;
  googleAdsCustomerId?: string;
  websiteUrl?: string;
  selectedCampaignIds?: string[];
  auditScope?: 'account' | 'campaign';
  campaignId?: string;
  campaignName?: string;
  parentAuditId?: string;
  modules: AuditModule[];
  findings: Finding[];
  healthScores: HealthScore[];
  roadmapItems: RoadmapItem[];
  logs: AuditLog[];
  healthScore?: number;
  totalImpact?: number;
  criticalCount?: number;
  annualOpportunity?: number;
  totalFindings?: number;
  hiddenFindings?: number;
}

export interface SharedReport {
  id: string;
  token: string;
  auditRunId: string;
  createdAt: string;
}

export interface AuditSummary {
  id: string;
  accountName: string;
  baseAccountName: string;
  status: AuditStatus;
  progress: number;
  modulesComplete: number;
  totalModules: number;
  findingsCount: number;
  healthScore: number | null;
  totalImpact: number;
  criticalCount: number;
  dataWindowDays: number;
  googleAdsCustomerId?: string;
  auditScope: 'account' | 'campaign';
  campaignName?: string;
  monthlySpend: number;
  campaignCount: number;
  goal?: string;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
}
