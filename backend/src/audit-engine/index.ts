import type { Finding, AuditModule } from '../types/index.js';
import {
  AUDIT_MODULES,
  createMockFindings,
  MOCK_HEALTH_SCORES,
  createMockRoadmap,
} from './mock-data.js';
import { generateId } from '../services/mock-store.js';

const MODULE_FINDING_MAP: Record<string, number[]> = {
  campaign: [4, 14],
  keyword: [8, 12],
  'search-terms': [0],
  'quality-score': [1],
  'ad-copy': [5, 13],
  bidding: [2, 10],
  budget: [3],
  geo: [6],
  audience: [7],
  'impression-share': [12],
  'landing-pages': [11],
  pmax: [9],
};

import { AUDIT_MODULE_CATALOG } from '../data/audit-module-catalog.js';

const MODULE_DISPLAY_NAMES: Record<string, string> = {
  campaign: 'Campaign Architecture',
  keyword: 'Keyword Audit',
  'search-terms': 'Search Term Waste',
  'quality-score': 'Quality Score Analysis',
  'ad-copy': 'Ad Copy Review (AI LLM)',
  bidding: 'Bidding Strategy Audit',
  budget: 'Budget Efficiency',
  geo: 'Geo Targeting Audit',
  audience: 'Audience Audit',
  'landing-pages': 'Landing Page Alignment',
  conversion: 'Conversion Tracking Audit',
  device: 'Device Performance Audit',
  'impression-share': 'Impression Share',
  pmax: 'PMax Placements',
};

export function createModulesFromSelection(selectedIds?: string[]): import('../types/index.js').AuditModule[] {
  const ids = selectedIds?.length
    ? selectedIds
    : AUDIT_MODULE_CATALOG.map((m) => m.id);

  return ids.map((id, index) => {
    const catalog = AUDIT_MODULE_CATALOG.find((m) => m.id === id);
    return {
      id: generateId('mod_'),
      name: MODULE_DISPLAY_NAMES[id] || catalog?.name || id,
      slug: id,
      status: 'PENDING' as const,
      progress: 0,
      findingsCount: 0,
      order: index + 1,
    };
  });
}

export function createInitialModules(): AuditModule[] {
  return AUDIT_MODULES.map((m) => ({
    ...m,
    id: generateId('mod_'),
    status: 'PENDING' as const,
    progress: 0,
    findingsCount: 0,
  }));
}

export function getFindingsForModule(slug: string, allFindings: Finding[]): Finding[] {
  const indices = MODULE_FINDING_MAP[slug] || [];
  return indices.map((i) => allFindings[i]).filter(Boolean);
}

export function calculateHealthScore(scores: { score: number }[]): number {
  if (!scores.length) return 38;
  return Math.round(scores.reduce((s, h) => s + h.score, 0) / scores.length);
}

export function getAuditMetrics(findings: Finding[], healthScores?: { score: number }[]) {
  const totalImpact = findings.reduce((s, f) => s + f.impactMonthly, 0);
  const criticalCount = findings.filter((f) => f.severity === 'CRITICAL').length;
  let healthScore: number;
  if (healthScores?.length) {
    healthScore = calculateHealthScore(healthScores);
  } else if (findings.length) {
    const penalty = criticalCount * 10
      + findings.filter((f) => f.severity === 'HIGH').length * 5
      + findings.filter((f) => f.severity === 'MEDIUM').length * 2;
    healthScore = Math.max(15, 90 - penalty);
  } else {
    healthScore = 50;
  }
  return { totalImpact, criticalCount, healthScore, annualOpportunity: totalImpact * 12 };
}

export { createMockFindings, MOCK_HEALTH_SCORES, createMockRoadmap, AUDIT_MODULES };
