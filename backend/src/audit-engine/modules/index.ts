import type { Finding } from '../../types/index.js';
import { generateId } from '../../services/mock-store.js';

export function runCampaignAudit(): Omit<Finding, 'id'>[] {
  return [{
    severity: 'CRITICAL',
    title: 'Zero conversion tracking on 3 active campaigns',
    description: '3 campaigns totaling $1,800/month spend have broken or missing conversion tracking.',
    recommendation: 'Verify Google Ads conversion tags via Tag Assistant.',
    confidence: 95,
    impactMonthly: 0,
    evidence: { campaignsAffected: 3 },
    category: 'CAMPAIGN',
    dimension: 'Account Health',
    status: 'ACKNOWLEDGED',
  }];
}

export function runKeywordAudit(): Omit<Finding, 'id'>[] {
  return [{
    severity: 'HIGH',
    title: 'Duplicate keywords across 6 ad groups',
    description: '47 keywords appear in multiple ad groups within the same campaign.',
    recommendation: 'Consolidate duplicate keywords into single best-performing ad groups.',
    confidence: 90,
    impactMonthly: 340,
    category: 'KEYWORDS',
    dimension: 'Keyword Analysis',
    status: 'OPEN',
  }];
}

export function runSearchTermAudit(): Omit<Finding, 'id'>[] {
  return [{
    severity: 'CRITICAL',
    title: 'Search term waste — 847 non-converting queries burning budget',
    description: '847 search queries with zero conversions consuming $2,140/month in wasted spend.',
    recommendation: 'Build comprehensive negative keyword list from search term report.',
    confidence: 92,
    impactMonthly: 2140,
    evidence: { nonConvertingQueries: 847 },
    category: 'SEARCH_TERMS',
    dimension: 'Search Term Waste',
    status: 'OPEN',
  }];
}

export function attachIds(findings: Omit<Finding, 'id'>[]): Finding[] {
  return findings.map((f) => ({ ...f, id: generateId('fnd_') }));
}
