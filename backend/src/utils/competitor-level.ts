import type { WebsiteIntelligence } from '../services/website-intelligence.service.js';

export type BusinessLevel = 'local' | 'regional' | 'national' | 'enterprise';

export interface BusinessContext {
  level: BusinessLevel;
  levelLabel: string;
  primaryServices: string[];
  location?: string;
  marketHint?: string;
  /** Optional industry label from optimization request / website intel */
  industry?: string;
}

const NATIONAL_SIGNALS =
  /\b(nationwide|countrywide|across\s+(?:the\s+)?(?:us|usa|uk|australia|canada)|all\s+50\s+states|global|worldwide|international)\b/i;
const REGIONAL_SIGNALS =
  /\b(statewide|multi[- ]state|across\s+\w+|serving\s+(?:all\s+of\s+)?\w+\s+(?:and|&)\s+\w+|franchise|locations\s+across)\b/i;
const LOCAL_SIGNALS =
  /\b(locally\s+owned|family\s+owned|serving\s+\w+\s+(?:area|metro)|near\s+you|your\s+local)\b/i;
const ENTERPRISE_SIGNALS =
  /\b(enterprise|fortune\s+500|b2b\s+saas|platform\s+for\s+teams|api\s+access|soc\s*2|iso\s+27001)\b/i;
const AGGREGATOR_SIGNALS =
  /\b(compare|comparison|finder|marketplace|directory|reviews?\s+site|top\s+\d+\s+best|aggregator)\b/i;

function uniqueStrings(items: string[], max = 12): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const trimmed = item.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
    if (out.length >= max) break;
  }
  return out;
}

function extractLocationParts(location?: string): { city?: string; region?: string } {
  if (!location?.trim()) return {};
  const parts = location.split(/[,|]/).map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return {};
  if (parts.length === 1) return { city: parts[0], region: parts[0] };
  return { city: parts[0], region: parts[parts.length - 1] };
}

function spendToBaseLevel(monthlySpend?: number): BusinessLevel {
  if (monthlySpend == null || monthlySpend <= 0) return 'local';
  if (monthlySpend >= 40_000) return 'enterprise';
  if (monthlySpend >= 12_000) return 'national';
  if (monthlySpend >= 3_000) return 'regional';
  return 'local';
}

function levelRank(level: BusinessLevel): number {
  return { local: 0, regional: 1, national: 2, enterprise: 3 }[level];
}

function normalizeServices(productsServices?: string[], websiteIntel?: WebsiteIntelligence | null): string[] {
  const fromSite = [
    ...(websiteIntel?.services ?? []),
    ...(websiteIntel?.headings ?? []).filter((h) => h.length < 60),
    websiteIntel?.title ?? '',
    websiteIntel?.metaDescription ?? '',
  ];
  return uniqueStrings([...(productsServices ?? []), ...fromSite], 10);
}

export function inferBusinessContext(options: {
  monthlySpend?: number;
  location?: string;
  industry?: string;
  productsServices?: string[];
  websiteIntel?: WebsiteIntelligence | null;
}): BusinessContext {
  const primaryServices = normalizeServices(options.productsServices, options.websiteIntel);
  const industry = options.industry?.trim() ?? '';
  const text = [
    industry,
    options.websiteIntel?.rawTextSample ?? '',
    ...(options.websiteIntel?.headings ?? []),
    options.websiteIntel?.metaDescription ?? '',
  ].join(' ');

  let level = spendToBaseLevel(options.monthlySpend);
  const { city, region } = extractLocationParts(options.location ?? options.websiteIntel?.locations?.[0]);

  if (ENTERPRISE_SIGNALS.test(text) || /saas|software|platform/i.test(industry)) {
    if (level === 'local') level = 'national';
    if (options.monthlySpend != null && options.monthlySpend >= 20_000) level = 'enterprise';
  }
  if (NATIONAL_SIGNALS.test(text)) level = levelRank(level) < levelRank('national') ? 'national' : level;
  if (REGIONAL_SIGNALS.test(text) && level === 'local') level = 'regional';
  if (LOCAL_SIGNALS.test(text) && levelRank(level) > levelRank('regional')) level = 'regional';
  if ((options.websiteIntel?.locations?.length ?? 0) <= 1 && levelRank(level) > levelRank('regional')) {
    level = 'regional';
  }

  const levelLabel =
    level === 'local'
      ? `local service provider${city ? ` in ${city}` : ''}`
      : level === 'regional'
        ? `regional provider${region ? ` in ${region}` : ''}`
        : level === 'national'
          ? 'national brand'
          : 'enterprise / high-scale brand';

  const marketHint = [city, region].filter(Boolean).join(', ') || options.location;

  return {
    level,
    levelLabel,
    primaryServices: primaryServices.length ? primaryServices : industry ? [industry] : [],
    location: options.location ?? options.websiteIntel?.locations?.[0],
    marketHint,
    industry: industry || undefined,
  };
}

function countryLabelFromLocation(location?: string): string | undefined {
  if (!location?.trim()) return undefined;
  const l = location.toLowerCase();
  if (/\baustralia\b|\bau\b|sydney|melbourne|brisbane|perth|adelaide/.test(l)) return 'Australia';
  if (/\bunited kingdom\b|\buk\b|london|england|scotland|wales/.test(l)) return 'UK';
  if (/\bunited states\b|\busa\b|\bus\b|america/.test(l)) return 'USA';
  if (/\bcanada\b|toronto|vancouver/.test(l)) return 'Canada';
  if (/\bnew zealand\b|\bnz\b|auckland|wellington/.test(l)) return 'New Zealand';
  return undefined;
}

/** When website crawl leaves primaryServices empty, still search the ad library by industry. */
function industryFallbackTerms(industry?: string): string[] {
  const i = (industry ?? '').toLowerCase();
  if (/financ|lend|loan|credit|mortgage|bank/.test(i)) {
    return ['personal loans', 'online loans', 'payday loans', 'consumer credit'];
  }
  if (/real estate|propert|realtor/.test(i)) return ['real estate agents', 'property management'];
  if (/saas|software|tech/.test(i)) return ['SaaS software', 'B2B software'];
  if (/health|dental|clinic|medical/.test(i)) return ['healthcare services', 'medical clinic'];
  if (/legal|law|attorney/.test(i)) return ['law firm', 'legal services'];
  if (/insur/.test(i)) return ['insurance', 'life insurance'];
  if (industry?.trim()) return [industry.trim()];
  return [];
}

export function buildCompetitorSearchQueries(
  ctx: BusinessContext,
  businessName: string
): string[] {
  const services = ctx.primaryServices.slice(0, 4);
  const location = ctx.location ?? ctx.marketHint ?? '';
  const { city, region } = extractLocationParts(location);
  const country = countryLabelFromLocation(location);
  const serviceTerms = services.length
    ? services
    : [...industryFallbackTerms(ctx.industry), businessName].filter(Boolean);

  const queries: string[] = [];

  for (const service of serviceTerms) {
    const term = service.replace(/\s+/g, ' ').trim().slice(0, 48);
    if (!term) continue;

    // Always combine service + region (city) AND country — metro rivals + national peers
    if (city) {
      queries.push(
        `${term} ${city}`,
        `best ${term} ${city}`,
        `${term} broker ${city}`,
        `${term} near ${city}`
      );
    }
    if (region && region.toLowerCase() !== city?.toLowerCase()) {
      queries.push(`${term} ${region}`, `best ${term} ${region}`);
    }
    if (country) {
      queries.push(`${term} ${country}`, `best ${term} ${country}`);
    }

    if (ctx.level === 'local') {
      if (!city && !region) queries.push(term);
    } else if (ctx.level === 'regional') {
      queries.push(term, `local ${term}`);
    } else if (ctx.level === 'national') {
      queries.push(term, `best ${term}`, `${term} services`);
    } else {
      queries.push(`${term} enterprise`, `${term} platform`, `best ${term} for business`);
    }
  }

  // Expand loan/finance verticals so ad-scoped discovery finds enough peer advertisers
  queries.push(...expandServiceSearchQueries(services, location));

  if (businessName.trim()) queries.push(businessName.trim());
  if (!queries.length) queries.push(businessName);
  return uniqueStrings(queries, 14);
}

/** Turn selected Ahrefs keyword-cluster seed terms into competitor search queries. */
export function buildKeywordClusterQueries(
  keywords: string[] | undefined,
  location?: string
): string[] {
  const out: string[] = [];
  for (const raw of (keywords ?? []).slice(0, 12)) {
    const term = raw.replace(/\s+/g, ' ').trim().slice(0, 48);
    if (!term || term.length < 3) continue;
    out.push(term);
  }
  return uniqueStrings(out, 12);
}

/**
 * Extra Transparency search strings for a primary service (ad-level Make This Ad Better).
 * Aimed at producing enough domain-backed advertisers to hit ~4 service-matched rivals.
 */
export function expandServiceSearchQueries(services: string[], location?: string): string[] {
  const country = countryLabelFromLocation(location);
  const { city } = extractLocationParts(location);
  const joined = services.filter(Boolean).join(' ').toLowerCase();
  const out: string[] = [];

  const add = (term: string) => {
    const t = term.trim();
    if (!t) return;
    out.push(t);
    if (city) out.push(`${t} ${city}`, `${t} broker ${city}`);
    if (country) out.push(`${t} ${country}`);
  };

  if (/\bcar\b|\bauto\b|\bvehicle\b/.test(joined)) {
    for (const t of [
      'car loan',
      'car loans',
      'car finance',
      'auto loan',
      'auto finance',
      'vehicle finance',
      'vehicle loan',
      'car finance broker',
      'novated lease',
    ]) {
      add(t);
    }
  } else if (/\bcommercial\b/.test(joined) && /\b(mortgage|property|lending|finance)\b/.test(joined)) {
    for (const t of [
      'commercial mortgage',
      'commercial mortgage broker',
      'commercial property finance',
      'commercial lending',
      'commercial property loan',
    ]) {
      add(t);
    }
  } else if (/\bhome\b|\bmortgage\b|\bproperty\b/.test(joined)) {
    for (const t of ['home loan', 'mortgage', 'home loan broker', 'refinance home loan']) add(t);
  } else if (/\bpersonal\b/.test(joined)) {
    for (const t of ['personal loan', 'personal loans', 'unsecured loan']) add(t);
  } else if (/\bbusiness\b|\bsme\b/.test(joined)) {
    for (const t of ['business loan', 'business finance', 'sme finance']) add(t);
  } else if (
    /\bseo\b|search engine optimization|digital marketing|\bppc\b|\bsem\b|google ads/.test(joined)
  ) {
    for (const t of [
      'seo agency',
      'seo services',
      'search engine optimization',
      'digital marketing agency',
      'google ads agency',
      'ppc agency',
    ]) {
      add(t);
    }
  } else {
    for (const s of services.slice(0, 3)) add(s);
  }

  return uniqueStrings(out, 12);
}

/** Put country/metro-specific queries first so lightweight discovery still searches the right market. */
export function prioritizeMarketQueries(queries: string[], location?: string): string[] {
  const country = countryLabelFromLocation(location);
  const loc = (location ?? '').trim().toLowerCase();
  const prioritized = queries.filter((q) => {
    const ql = q.toLowerCase();
    if (country && ql.includes(country.toLowerCase())) return true;
    if (loc && loc.length > 2 && ql.includes(loc)) return true;
    return false;
  });
  const rest = queries.filter((q) => !prioritized.includes(q));
  return uniqueStrings([...prioritized, ...rest], queries.length + prioritized.length);
}

export function inferCompetitorLevelFromText(text: string, locationCount = 0): BusinessLevel {
  if (ENTERPRISE_SIGNALS.test(text)) return 'enterprise';
  if (NATIONAL_SIGNALS.test(text)) return 'national';
  if (REGIONAL_SIGNALS.test(text) || locationCount >= 3) return 'regional';
  if (LOCAL_SIGNALS.test(text) || locationCount <= 1) return 'local';
  return 'regional';
}

export function scoreBusinessLevelMatch(clientLevel: BusinessLevel, competitorLevel: BusinessLevel): number {
  const diff = Math.abs(levelRank(clientLevel) - levelRank(competitorLevel));
  if (diff === 0) return 12;
  if (diff === 1) return 4;
  if (diff === 2) return -6;
  return -14;
}

/** Peer or one notch larger (e.g. regional client → national competitor). */
export function isSameOrOneLevelAbove(clientLevel: BusinessLevel, competitorLevel: BusinessLevel): boolean {
  const diff = levelRank(competitorLevel) - levelRank(clientLevel);
  return diff === 0 || diff === 1;
}

export function isAggregatorProfile(name: string, text: string): boolean {
  const combined = `${name} ${text}`.toLowerCase();
  return AGGREGATOR_SIGNALS.test(combined);
}

export function businessLevelRulesForPrompt(ctx: BusinessContext): string {
  const services = ctx.primaryServices.slice(0, 6).join(', ') || 'infer from website';
  const base = `Business level: ${ctx.level} (${ctx.levelLabel})
Core services: ${services}
Market: ${ctx.marketHint ?? 'infer from website'}`;

  switch (ctx.level) {
    case 'local':
      return `${base}
- Return ONLY direct local/regional competitors offering the SAME services in the same city/metro
- Exclude national directories, comparison sites, and franchises unless the business is also a franchise
- Match competitor scale to a local operator (not HomeAdvisor, Yelp, or national chains unless they are true local rivals)`;
    case 'regional':
      return `${base}
- Return competitors serving the same state/region with matching services
- Prefer regional specialists over national aggregators
- Exclude unrelated national marketplaces unless the business competes at marketplace level`;
    case 'national':
      return `${base}
- Return national direct competitors in the same service/product category
- Match brand scale — not hyper-local sole operators unless they dominate the niche nationally`;
    case 'enterprise':
      return `${base}
- Return enterprise-scale competitors with similar product scope and buyer profile
- Focus on platform/SaaS or high-ticket B2B peers, not SMB local providers`;
  }
}
