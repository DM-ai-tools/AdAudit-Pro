import type { GoogleAdsCampaignAd } from '../types/connect';

/** Known finance / vertical service phrases (longest first for greedy match). */
const KNOWN_SERVICES = [
  'commercial mortgage broker',
  'commercial mortgage',
  'commercial property finance',
  'commercial property loan',
  'commercial lending',
  'property development finance',
  'property development',
  'commercial property finance',
  'asset finance',
  'equipment finance',
  'business loans',
  'business loan',
  'personal loans',
  'personal loan',
  'car loans',
  'car loan',
  'auto loans',
  'auto loan',
  'vehicle finance',
  'car finance',
  'home loans',
  'home loan',
  'first home buyer',
  'refinance',
  'investment property',
  'smsf lending',
  'smsf loan',
  'mortgage broker',
  'mortgage',
  'wealth management',
  'life insurance',
  'car insurance',
  'plumb',
  'roofing',
  'hvac',
  'dental',
  'legal services',
].sort((a, b) => b.length - a.length);

type ServiceFamily = 'car_loan' | 'home_loan' | 'personal_loan' | 'business_loan' | 'commercial_mortgage' | 'other';

const FLUFF =
  /^(get|free|quote|call|book|today|now|best|trusted|award|melbourne|sydney|brisbane|perth|australia|online)$/i;

function titleCase(s: string): string {
  return s
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

function isCommercialMortgageService(service: string): boolean {
  const s = service.toLowerCase();
  return /\bcommercial\b/.test(s) && /\b(mortgage|property|lending|finance|broker)\b/.test(s);
}

function familyOf(service: string): ServiceFamily {
  const s = service.toLowerCase();
  if (isCommercialMortgageService(s)) return 'commercial_mortgage';
  if (/\b(car|auto|vehicle)\b/.test(s) && /\b(loan|finance|lease)\b/.test(s)) return 'car_loan';
  if (/\b(home|owner[\s-]occupier|first\s*home|refinance)\b/.test(s) && /\b(loan|mortgage)\b/.test(s)) {
    return 'home_loan';
  }
  if (/\b(mortgage|property)\b/.test(s) && !/\bcommercial\b/.test(s)) return 'home_loan';
  if (/\bpersonal\b/.test(s) && /\bloan/.test(s)) return 'personal_loan';
  if (/\b(business|sme|equipment|asset|working\s*capital|invoice)\b/.test(s)) return 'business_loan';
  return 'other';
}

function pathServices(urls: string[]): string[] {
  const out: string[] = [];
  for (const raw of urls) {
    try {
      const path = new URL(raw.startsWith('http') ? raw : `https://${raw}`).pathname;
      for (const seg of path.split('/').filter(Boolean)) {
        const cleaned = decodeURIComponent(seg)
          .replace(/[-_]+/g, ' ')
          .replace(/\.(html?|php)$/i, '')
          .trim();
        if (cleaned.length < 3 || cleaned.length > 48 || FLUFF.test(cleaned)) continue;
        if (/^(about|contact|blog|faq|home|services|index)$/i.test(cleaned)) continue;
        // Prefer canonical known phrases from path segments (car loans, business loans, …)
        const lower = cleaned.toLowerCase();
        const known = KNOWN_SERVICES.find((p) => lower === p || lower.includes(p) || p.includes(lower));
        out.push(titleCase(known ?? cleaned));
      }
    } catch {
      /* ignore */
    }
  }
  return out;
}

function extractKeywords(texts: string[], primaryService: string): string[] {
  const stop = new Set(
    'the and for with your our from that this get free call book today best near you online Australia'.toLowerCase().split(/\s+/)
  );
  const primaryTokens = new Set(primaryService.toLowerCase().split(/\W+/).filter((t) => t.length > 2));
  const scored = new Map<string, number>();

  for (const text of texts) {
    for (const raw of text.toLowerCase().split(/[^a-z0-9+]+/)) {
      const w = raw.trim();
      if (w.length < 4 || stop.has(w) || FLUFF.test(w)) continue;
      scored.set(w, (scored.get(w) ?? 0) + (primaryTokens.has(w) ? 3 : 1));
    }
  }

  const keywords = [primaryService];
  for (const [w] of [...scored.entries()].sort((a, b) => b[1] - a[1])) {
    if (keywords.some((k) => k.toLowerCase() === w)) continue;
    keywords.push(titleCase(w));
    if (keywords.length >= 10) break;
  }
  return keywords;
}

function matchKnownInText(text: string): string[] {
  const lower = text.toLowerCase();
  const matched: string[] = [];
  for (const phrase of KNOWN_SERVICES) {
    if (lower.includes(phrase)) matched.push(titleCase(phrase));
  }
  return matched;
}

/**
 * Identify the primary service promoted by a single RSA.
 * Landing-page path wins when it clearly names a product (e.g. /car-loans/),
 * so campaign-wide “Business Loans” fluff never overrides this ad’s intent.
 */
export function inferServiceFromAd(ad: Pick<
  GoogleAdsCampaignAd,
  'headlines' | 'descriptions' | 'finalUrls' | 'displayPath1' | 'displayPath2' | 'adGroupName'
>): {
  primaryService: string;
  services: string[];
  keywords: string[];
  landingPage?: string;
  serviceFamily: ServiceFamily;
} {
  const pathMatches = pathServices(ad.finalUrls ?? [])
    .flatMap((p) => matchKnownInText(p).length ? matchKnownInText(p) : [p]);

  const copyBlob = [
    ...ad.headlines,
    ...ad.descriptions,
    ad.displayPath1 ?? '',
    ad.displayPath2 ?? '',
  ].join(' ');
  const copyMatches = matchKnownInText(copyBlob);

  const groupMatches = matchKnownInText(ad.adGroupName ?? '');

  // Path is highest signal for RSA intent (final URL = where the ad sends traffic)
  const pathFamilyHit = pathMatches.find((m) => familyOf(m) !== 'other');
  let primaryService = pathFamilyHit ?? copyMatches[0] ?? groupMatches[0];

  if (!primaryService) {
    const candidate =
      ad.headlines.find((h) => h.trim().length >= 8 && h.trim().length <= 40) ??
      ad.adGroupName ??
      'Core Service';
    const cleaned = candidate
      .replace(/\b(get|free|quote|call|today|now)\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
    primaryService = cleaned || 'Core Service';
  }

  // Canonicalize: "Car Loan" → prefer plural product label for discovery
  const canon = primaryService.toLowerCase();
  if (canon === 'car loan') primaryService = 'Car Loans';
  if (canon === 'business loan') primaryService = 'Business Loans';
  if (canon === 'personal loan') primaryService = 'Personal Loans';
  if (canon === 'home loan') primaryService = 'Home Loans';
  if (canon === 'auto loan') primaryService = 'Car Loans';
  if (canon === 'auto loans') primaryService = 'Car Loans';
  if (canon === 'car finance' || canon === 'vehicle finance') primaryService = 'Car Loans';
  if (canon === 'commercial mortgage') primaryService = 'Commercial Mortgage';
  if (canon === 'commercial mortgage broker') primaryService = 'Commercial Mortgage Broker';
  if (canon === 'commercial property finance') primaryService = 'Commercial Property Finance';

  const serviceFamily = familyOf(primaryService);

  // Ad-scoped products list: primary only (+ same-family synonyms), never rival verticals
  const sameFamily = [...pathMatches, ...copyMatches, ...groupMatches]
    .filter((s) => familyOf(s) === serviceFamily || familyOf(s) === 'other')
    .filter((s) => familyOf(s) === serviceFamily);
  const services = [...new Set([primaryService, ...sameFamily.map((s) => titleCase(s))])].slice(0, 3);

  const keywords = extractKeywords(
    [...ad.headlines, ...ad.descriptions, ad.adGroupName ?? '', primaryService],
    primaryService
  );

  return {
    primaryService,
    services,
    keywords,
    landingPage: ad.finalUrls?.[0],
    serviceFamily,
  };
}

const AU_CITIES =
  /\b(melbourne|sydney|brisbane|perth|adelaide|canberra|hobart|gold coast|newcastle|geelong|wollongong)\b/i;

/**
 * Infer geo for competitor discovery from ad copy, paths, and ad group name.
 * e.g. "Car Loan Broker Melbourne" → "Melbourne, Australia"
 */
export function inferLocationFromAd(ad: {
  headlines?: string[];
  descriptions?: string[];
  adGroupName?: string;
  finalUrls?: string[];
}): string | undefined {
  const blob = [
    ...(ad.headlines ?? []),
    ...(ad.descriptions ?? []),
    ad.adGroupName ?? '',
    ...(ad.finalUrls ?? []),
  ].join(' ');
  const m = blob.match(AU_CITIES);
  if (m?.[1]) {
    const city = m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase();
    return `${city}, Australia`;
  }
  if (/\baustralia\b|\b\.com\.au\b/i.test(blob)) return 'Australia';
  return undefined;
}

export function buildAdOptimizeFinding(
  campaignId: string,
  campaignName: string,
  ad: GoogleAdsCampaignAd,
  primaryService: string
): import('../types').Finding {
  return {
    id: `ad-opt-${campaignId}-${ad.id}`,
    severity: 'HIGH',
    title: `Optimize ad: ${primaryService}`,
    description: `Ad-level AI optimization for “${ad.headlines[0] ?? ad.adGroupName}” promoting ${primaryService} in campaign ${campaignName}. Discover service-specific competitors only.`,
    recommendation: `Generate improved RSA copy for this ${primaryService} ad using competitors that advertise the same service.`,
    confidence: 88,
    impactMonthly: 0,
    category: 'AD_COPY',
    dimension: 'Ad Copy Review',
    status: 'OPEN',
  };
}
