import type { Finding } from '../types/index.js';
import { AUDIT_MODULE_CATALOG } from '../data/audit-module-catalog.js';

const MODULE_DIMENSION_ALIASES: Record<string, string[]> = {
  campaign: ['Campaign Architecture', 'Campaign Structure'],
  keyword: ['Keyword Audit', 'Keywords'],
  'search-terms': ['Search Term Waste', 'Search Terms'],
  budget: ['Budget Analysis', 'Budget Efficiency'],
  geo: ['Geo Analysis', 'Geo Targeting Audit', 'Geographic'],
  audience: ['Audience Analysis', 'Audience Audit', 'Audiences'],
  'ad-copy': ['Ad Copy Review', 'Ad Copy Analysis', 'Ad Copy Analysis', 'Ad Copy Review (AI LLM)'],
  'landing-pages': ['Landing Page Analysis', 'Landing Page Alignment'],
  bidding: ['Bidding Analysis', 'Bidding Strategy Audit'],
  conversion: ['Conversion Tracking Audit'],
  'quality-score': ['Quality Score Audit', 'Quality Score Analysis'],
  device: ['Device Performance Audit'],
  'impression-share': ['Impression Share'],
  pmax: ['PMax', 'PMax Placements'],
};

const MODULE_CATEGORIES: Record<string, string[]> = {
  keyword: ['KEYWORDS'],
  'search-terms': ['SEARCH_TERMS'],
  budget: ['BUDGET'],
  geo: ['GEO'],
  audience: ['AUDIENCES'],
  'ad-copy': ['AD_COPY'],
  'landing-pages': ['LANDING_PAGES'],
  bidding: ['BIDDING'],
  'quality-score': ['QUALITY_SCORE'],
  'impression-share': ['IMPRESSION_SHARE'],
  pmax: ['PMAX'],
  campaign: ['CAMPAIGN'],
  device: ['CAMPAIGN'],
  conversion: ['CAMPAIGN'],
};

export function isFailureFinding(f: Finding): boolean {
  return /analysis incomplete|configure anthropic|configure API keys/i.test(f.title);
}

function getFindingModuleSlug(finding: Finding): string | undefined {
  const fromEvidence = finding.evidence?.module;
  if (typeof fromEvidence === 'string' && fromEvidence) return fromEvidence;
  for (const [slug, aliases] of Object.entries(MODULE_DIMENSION_ALIASES)) {
    if (aliases.some((a) => finding.dimension === a || finding.dimension.startsWith(a))) {
      return slug;
    }
  }
  return undefined;
}

export function findingMatchesModuleSlug(finding: Finding, slug: string): boolean {
  if (isFailureFinding(finding)) return false;
  const evidenceSlug = finding.evidence?.module;
  if (typeof evidenceSlug === 'string' && evidenceSlug === slug) return true;

  const aliases = MODULE_DIMENSION_ALIASES[slug] ?? [];
  if (aliases.some((a) => finding.dimension === a || finding.dimension.startsWith(a))) {
    return true;
  }

  const categories = MODULE_CATEGORIES[slug];
  if (categories?.includes(finding.category)) {
    if (slug === 'campaign' || slug === 'device' || slug === 'conversion') {
      return getFindingModuleSlug(finding) === slug;
    }
    return true;
  }

  return false;
}

export function groupFindingsByModule(findings: Finding[]): Array<{ slug: string; name: string; findings: Finding[] }> {
  const valid = findings.filter((f) => !isFailureFinding(f));
  const groups = AUDIT_MODULE_CATALOG.map((mod) => ({
    slug: mod.id,
    name: mod.name,
    findings: valid
      .filter((f) => findingMatchesModuleSlug(f, mod.id))
      .sort((a, b) => b.impactMonthly - a.impactMonthly),
  })).filter((g) => g.findings.length > 0);

  const assigned = new Set(groups.flatMap((g) => g.findings.map((f) => f.id)));
  const unassigned = valid.filter((f) => !assigned.has(f.id));
  if (unassigned.length) {
    groups.push({
      slug: 'other',
      name: 'Additional Findings',
      findings: unassigned.sort((a, b) => b.impactMonthly - a.impactMonthly),
    });
  }

  return groups;
}

export function inferAuditScope(audit: { auditScope?: string; campaignName?: string; accountName: string }) {
  if (audit.auditScope === 'campaign') return 'campaign' as const;
  if (audit.campaignName) return 'campaign' as const;
  if (audit.accountName.includes(' — ')) return 'campaign' as const;
  return 'account' as const;
}

export function reportTitle(audit: { accountName: string; campaignName?: string; auditScope?: string }) {
  const scope = inferAuditScope(audit);
  if (scope === 'campaign') {
    if (audit.campaignName) return audit.campaignName;
    const parts = audit.accountName.split(' — ');
    return parts.length > 1 ? parts[parts.length - 1] : audit.accountName;
  }
  return audit.accountName.split(' — ')[0] || audit.accountName;
}
