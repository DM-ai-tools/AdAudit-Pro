import type { Finding } from '../types/index.js';
import { getModuleCatalogName } from '../data/audit-module-catalog.js';

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

export function isAnalysisFailureFinding(title: string): boolean {
  return /analysis incomplete|configure anthropic|configure API keys/i.test(title);
}

export function getFindingModuleSlug(finding: Finding): string | undefined {
  const fromEvidence = finding.evidence?.module;
  if (typeof fromEvidence === 'string' && fromEvidence) return fromEvidence;

  const catalogHit = Object.keys(MODULE_DIMENSION_ALIASES).find((slug) => {
    const name = getModuleCatalogName(slug);
    return finding.dimension === name || finding.dimension.startsWith(name);
  });
  if (catalogHit) return catalogHit;

  for (const [slug, aliases] of Object.entries(MODULE_DIMENSION_ALIASES)) {
    if (aliases.some((a) => finding.dimension === a || finding.dimension.startsWith(a))) {
      return slug;
    }
  }
  return undefined;
}

export function findingMatchesModuleSlug(finding: Finding, slug: string): boolean {
  if (isAnalysisFailureFinding(finding.title)) return false;

  const evidenceSlug = finding.evidence?.module;
  if (typeof evidenceSlug === 'string' && evidenceSlug === slug) return true;

  const catalogName = getModuleCatalogName(slug);
  if (finding.dimension === catalogName || finding.dimension.startsWith(catalogName)) return true;

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
