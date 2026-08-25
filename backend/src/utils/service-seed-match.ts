import { stripUrls, isGarbageCreativeText } from './service-relevance.js';

const SEED_STOP = new Set([
  'for',
  'and',
  'the',
  'with',
  'in',
  'of',
  'a',
  'an',
  'to',
  'your',
  'our',
]);

/** Generic bucket words — not required to appear in ad copy. */
const FILLER_TOKENS = new Set([
  'advertising',
  'ads',
  'ad',
  'services',
  'service',
  'marketing',
  'agency',
  'management',
  'company',
  'solutions',
  'solution',
  'online',
  'digital',
  'professional',
  'experts',
  'expert',
]);

/**
 * Phrase synonyms for core service tokens.
 * "PPC Advertising" ads often say "Google Ads" / "Pay Per Click" without the word "advertising".
 */
const TOKEN_SYNONYMS: Record<string, string[]> = {
  ppc: [
    'ppc',
    'pay per click',
    'pay-per-click',
    'google ads',
    'google adwords',
    'paid search',
    'search ads',
    'paid ads',
    'sem',
  ],
  sem: ['sem', 'ppc', 'pay per click', 'google ads', 'paid search', 'search engine marketing'],
  seo: [
    'seo',
    'search engine optimisation',
    'search engine optimization',
    'organic search',
    'search rankings',
  ],
  cro: ['cro', 'conversion rate', 'conversion optimisation', 'conversion optimization'],
  meta: ['meta ads', 'facebook ads', 'instagram ads', 'meta advertising'],
  linkedin: ['linkedin ads', 'linkedin advertising'],
  tiktok: ['tiktok ads', 'tiktok advertising'],
};

/** Significant tokens from a service label (e.g. "AI SEO" → ["ai","seo"]). */
export function extractServiceSeedTokens(service: string): string[] {
  return service
    .toLowerCase()
    .split(/\W+/)
    .filter((t) => t.length >= 2 && !SEED_STOP.has(t));
}

/** Core tokens that must be evidenced in copy (fillers dropped). */
export function extractCoreServiceTokens(service: string): string[] {
  const tokens = extractServiceSeedTokens(service).filter((t) => !FILLER_TOKENS.has(t));
  return tokens.length ? tokens : extractServiceSeedTokens(service);
}

function textHasTokenOrSynonym(text: string, token: string): boolean {
  const t = text.toLowerCase();
  if (t.includes(token)) return true;
  const syns = TOKEN_SYNONYMS[token];
  if (!syns) return false;
  return syns.some((s) => t.includes(s));
}

/**
 * Ahrefs / keyword-cluster gate: keyword must match the service seed.
 * "AI SEO" requires both "ai" AND "seo" — not generic "seo services".
 * Filler words like "advertising" are not required; PPC accepts Google Ads / pay-per-click.
 */
export function keywordMatchesServiceSeed(keyword: string, service: string): boolean {
  const kw = keyword.toLowerCase().trim();
  const svc = service.toLowerCase().trim();
  if (!kw || !svc) return false;
  if (kw.includes(svc)) return true;

  const tokens = extractCoreServiceTokens(service);
  if (!tokens.length) return kw.includes(svc);
  if (tokens.length === 1) return textHasTokenOrSynonym(kw, tokens[0]!);
  return tokens.every((tok) => textHasTokenOrSynonym(kw, tok));
}

/** Conflicting sibling modifiers for digital-marketing sub-services. */
const SIBLING_MODIFIERS: Record<string, string[]> = {
  ai: ['local', 'ecommerce', 'enterprise', 'technical', 'small'],
  local: ['ai', 'ecommerce', 'enterprise', 'technical'],
  ecommerce: ['ai', 'local', 'enterprise', 'technical'],
  enterprise: ['ai', 'local', 'ecommerce', 'technical', 'small'],
  technical: ['ai', 'local', 'ecommerce', 'enterprise'],
  ppc: ['social media', 'content marketing', 'email marketing', 'organic seo'],
  sem: ['social media', 'content marketing', 'organic seo'],
  meta: ['linkedin', 'pinterest', 'tiktok'],
  linkedin: ['meta', 'pinterest', 'tiktok', 'facebook'],
  pinterest: ['meta', 'linkedin', 'tiktok', 'facebook'],
  tiktok: ['meta', 'linkedin', 'pinterest', 'facebook'],
  b2b: ['b2c'],
  organic: ['paid', 'ppc'],
  display: ['search ads'],
  email: ['social', 'ppc'],
  content: ['ppc'],
};

function hasSiblingConflict(text: string, serviceTokens: string[]): boolean {
  const t = text.toLowerCase();
  for (const tok of serviceTokens) {
    const conflicts = SIBLING_MODIFIERS[tok];
    if (!conflicts) continue;
    for (const c of conflicts) {
      if (t.includes(c) && !serviceTokens.some((st) => c.includes(st) || st.includes(c))) {
        return true;
      }
    }
  }
  return false;
}

/** Ad copy / advertiser text must match the specific service — not generic sibling offers. */
export function copyMatchesServiceSeed(text: string, service: string): boolean {
  const t = stripUrls(text).toLowerCase().trim();
  const svc = service.toLowerCase().trim();
  if (!t || !svc) return false;
  if (t.includes(svc)) return true;

  // Common rewrites of the full service label
  if (/\bppc\b/.test(svc) && /\b(pay[\s-]?per[\s-]?click|google ads|paid search|sem)\b/.test(t)) {
    return !hasSiblingConflict(t, extractCoreServiceTokens(service));
  }
  if (/\bseo\b/.test(svc) && !/\bai\b/.test(svc) && /\b(search engine optimi[sz]ation|organic search)\b/.test(t)) {
    return !hasSiblingConflict(t, extractCoreServiceTokens(service));
  }

  const tokens = extractCoreServiceTokens(service);
  if (!tokens.length) return false;
  if (tokens.length === 1) {
    if (!textHasTokenOrSynonym(t, tokens[0]!)) return false;
    return !hasSiblingConflict(t, tokens);
  }
  if (!tokens.every((tok) => textHasTokenOrSynonym(t, tok))) return false;
  return !hasSiblingConflict(t, tokens);
}

/** Keep only keywords that match the service seed tokens. */
export function filterSeedKeywordsForService(service: string, keywords: string[]): string[] {
  return keywords
    .map((k) => k.trim())
    .filter((k) => k.length >= 3 && keywordMatchesServiceSeed(k, service));
}

/** Educational / SERP-style titles that are not advertising competitors. */
export function looksLikeEducationalCompetitorName(name: string): boolean {
  const n = name.toLowerCase().trim();
  if (!n) return true;
  if (/^(what is|what are|how to|how does|learn |guide to|basics of|explained|definition)/i.test(n)) {
    return true;
  }
  if (/\b(basics explained|learn the basics|complete guide|for beginners)\b/i.test(n)) return true;
  if (/\?$/.test(n.trim())) return true;
  return false;
}

export function adMatchesServiceAndSeeds(
  creative: {
    headline?: string;
    description?: string;
    headlines?: string[];
    descriptions?: string[];
    destinationUrl?: string;
  },
  service: string,
  seedKeywords: string[] = []
): boolean {
  const parts = [
    creative.headline ?? '',
    ...(creative.headlines ?? []),
    creative.description ?? '',
    ...(creative.descriptions ?? []),
  ]
    .map((s) => stripUrls(s).trim())
    .filter(Boolean);

  const blob = parts.join(' ').trim();
  if (!blob || isGarbageCreativeText(blob)) return false;
  if (!copyMatchesServiceSeed(blob, service)) return false;

  // Seeds that are only the service label (or empty) don't add a second gate
  const meaningfulSeeds = seedKeywords
    .map((s) => s.trim())
    .filter((s) => s.length >= 3 && s.toLowerCase() !== service.toLowerCase().trim());
  if (!meaningfulSeeds.length) return true;

  return meaningfulSeeds.some(
    (seed) =>
      keywordMatchesServiceSeed(blob, seed) ||
      copyMatchesServiceSeed(blob, seed) ||
      blob.includes(seed.toLowerCase().trim())
  );
}
