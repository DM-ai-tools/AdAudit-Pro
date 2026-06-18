import type { Finding } from '../types';

/** Maps module slug → finding.dimension labels seen in live + legacy audits */
const MODULE_DIMENSION_ALIASES: Record<string, string[]> = {
  campaign: ['Campaign Architecture', 'Campaign Structure'],
  keyword: ['Keyword Audit', 'Keywords'],
  'search-terms': ['Search Term Waste', 'Search Terms'],
  budget: ['Budget Analysis', 'Budget Efficiency'],
  geo: ['Geo Analysis', 'Geo Targeting Audit', 'Geographic'],
  audience: ['Audience Analysis', 'Audience Audit', 'Audiences'],
  'ad-copy': ['Ad Copy Review', 'Ad Copy Analysis', 'Ad Copy Review (AI LLM)'],
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

export const SEVERITY_FILTERS = ['All', 'Critical', 'High', 'Medium', 'Low'] as const;

export const CATEGORY_FILTERS = [
  { id: 'Keywords', categories: ['KEYWORDS'], slugs: ['keyword'] },
  { id: 'Bidding', categories: ['BIDDING'], slugs: ['bidding'] },
  { id: 'Audiences', categories: ['AUDIENCES'], slugs: ['audience'] },
  { id: 'Ad Copy', categories: ['AD_COPY'], slugs: ['ad-copy'] },
  { id: 'Search Terms', categories: ['SEARCH_TERMS'], slugs: ['search-terms'] },
  { id: 'Budget', categories: ['BUDGET'], slugs: ['budget'] },
  { id: 'Geo', categories: ['GEO'], slugs: ['geo'] },
  { id: 'Quality Score', categories: ['QUALITY_SCORE'], slugs: ['quality-score'] },
] as const;

export type SeverityFilter = (typeof SEVERITY_FILTERS)[number];
export type CategoryFilterId = (typeof CATEGORY_FILTERS)[number]['id'];

export const FINDINGS_NAV_MODULES = [
  { id: 'search-terms', label: 'Search Term Waste', slug: 'search-terms' },
  { id: 'keywords', label: 'Keyword Analysis', slug: 'keyword' },
  { id: 'quality', label: 'Quality Score', slug: 'quality-score' },
  { id: 'bidding', label: 'Bidding Strategy', slug: 'bidding' },
  { id: 'ad-copy', label: 'Ad Copy Review', slug: 'ad-copy' },
  { id: 'audiences', label: 'Audiences', slug: 'audience' },
  { id: 'geo', label: 'Geographic', slug: 'geo' },
  { id: 'landing', label: 'Landing Pages', slug: 'landing-pages' },
  { id: 'impression', label: 'Impression Share', slug: 'impression-share' },
  { id: 'pmax', label: 'PMax Placements', slug: 'pmax' },
  { id: 'campaign', label: 'Campaign Structure', slug: 'campaign' },
  { id: 'budget', label: 'Budget Analysis', slug: 'budget' },
  { id: 'conversion', label: 'Conversion Tracking', slug: 'conversion' },
  { id: 'device', label: 'Device Performance', slug: 'device' },
] as const;

export function getFindingModuleSlug(finding: Finding): string | undefined {
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

export function countFindingsForModule(findings: Finding[], slug: string): number {
  return findings.filter((f) => findingMatchesModuleSlug(f, slug)).length;
}

export function isFailureFinding(f: Finding): boolean {
  return /analysis incomplete|configure anthropic|configure API keys/i.test(f.title);
}

export function filterFindings(
  findings: Finding[],
  options: {
    moduleSlug?: string | null;
    severityFilter?: SeverityFilter;
    categoryFilter?: CategoryFilterId | null;
  }
): Finding[] {
  let items = [...findings];

  if (options.moduleSlug) {
    items = items.filter((f) => findingMatchesModuleSlug(f, options.moduleSlug!));
  }

  const severity = options.severityFilter ?? 'All';
  if (severity === 'Critical') items = items.filter((f) => f.severity === 'CRITICAL');
  else if (severity === 'High') items = items.filter((f) => f.severity === 'HIGH');
  else if (severity === 'Medium') items = items.filter((f) => f.severity === 'MEDIUM');
  else if (severity === 'Low') items = items.filter((f) => f.severity === 'LOW');

  if (options.categoryFilter) {
    const def = CATEGORY_FILTERS.find((c) => c.id === options.categoryFilter);
    if (def) {
      items = items.filter(
        (f) =>
          (def.categories as readonly string[]).includes(f.category) ||
          def.slugs.some((slug) => findingMatchesModuleSlug(f, slug))
      );
    }
  }

  return items.sort((a, b) => b.impactMonthly - a.impactMonthly);
}

export function moduleLabelForSlug(slug: string): string {
  return FINDINGS_NAV_MODULES.find((m) => m.slug === slug)?.label ?? slug;
}
