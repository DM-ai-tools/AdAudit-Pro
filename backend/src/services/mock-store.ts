import type {
  AuditRun,
  User,
  Account,
  SharedReport,
  Finding,
  HealthScore,
  RoadmapItem,
  AuditModule,
  AuditLog,
} from '../types/index.js';

const users = new Map<string, User>();
const accounts = new Map<string, Account>();
const auditRuns = new Map<string, AuditRun>();
const sharedReports = new Map<string, SharedReport>();

export const mockStore = {
  users,
  accounts,
  auditRuns,
  sharedReports,

  getUser(id: string) {
    return users.get(id);
  },

  getUserByEmail(email: string) {
    return [...users.values()].find((u) => u.email === email);
  },

  saveUser(user: User) {
    users.set(user.id, user);
    return user;
  },

  updateUser(id: string, partial: Partial<User>) {
    const user = users.get(id);
    if (!user) return null;
    const updated = { ...user, ...partial };
    users.set(id, updated);
    return updated;
  },

  saveAccount(account: Account) {
    accounts.set(account.id, account);
    return account;
  },

  getAudit(id: string) {
    return auditRuns.get(id);
  },

  saveAudit(audit: AuditRun) {
    auditRuns.set(audit.id, audit);
    return audit;
  },

  updateAudit(id: string, partial: Partial<AuditRun>) {
    const existing = auditRuns.get(id);
    if (!existing) return null;
    const updated = { ...existing, ...partial };
    auditRuns.set(id, updated);
    return updated;
  },

  addFinding(auditId: string, finding: Finding) {
    const audit = auditRuns.get(auditId);
    if (!audit) return;
    audit.findings.push(finding);
    auditRuns.set(auditId, audit);
  },

  addLog(auditId: string, log: AuditLog) {
    const audit = auditRuns.get(auditId);
    if (!audit) return;
    audit.logs.push(log);
    auditRuns.set(auditId, audit);
  },

  updateModule(auditId: string, slug: string, partial: Partial<AuditModule>) {
    const audit = auditRuns.get(auditId);
    if (!audit) return;
    audit.modules = audit.modules.map((m) =>
      m.slug === slug ? { ...m, ...partial } : m
    );
    auditRuns.set(auditId, audit);
  },

  setHealthScores(auditId: string, scores: HealthScore[]) {
    const audit = auditRuns.get(auditId);
    if (!audit) return;
    audit.healthScores = scores;
    auditRuns.set(auditId, audit);
  },

  setRoadmap(auditId: string, items: RoadmapItem[]) {
    const audit = auditRuns.get(auditId);
    if (!audit) return;
    audit.roadmapItems = items;
    auditRuns.set(auditId, audit);
  },

  saveSharedReport(report: SharedReport) {
    sharedReports.set(report.token, report);
    return report;
  },

  getSharedReport(token: string) {
    return sharedReports.get(token);
  },
};

export function generateId(prefix = ''): string {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`;
}
