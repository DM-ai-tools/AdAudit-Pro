/**
 * Service-family matching for ad-level competitor discovery.
 * Headline is authoritative — destination URLs / incidental asset lines cannot
 * turn a home-loan RSA into a car-loan match.
 */

export type ServiceFamily =
  | 'car_loan'
  | 'home_loan'
  | 'personal_loan'
  | 'business_loan'
  | 'commercial_mortgage'
  | 'insurance'
  | 'real_estate'
  | 'generic';

type ConcreteFamily = Exclude<ServiceFamily, 'generic'>;

const FAMILY_PATTERNS: Record<ConcreteFamily, RegExp> = {
  car_loan:
    /\b(car\s*[- ]?loans?|auto\s*[- ]?loans?|vehicle\s*[- ]?(?:loans?|finance)|automotive\s*[- ]?(?:loans?|finance)|motor\s*[- ]?(?:loans?|finance)|car\s*[- ]?finance|auto\s*[- ]?finance|used\s*car\s*[- ]?(?:loans?|finance)|new\s*car\s*[- ]?(?:loans?|finance)|car\s*title\s*[- ]?loans?|business\s*car\s*[- ]?loans?|company\s*vehicle\s*[- ]?finance)\b/i,
  home_loan:
    /\b(home\s*[- ]?loans?|mortgages?|house\s*[- ]?loans?|property\s*[- ]?loans?|investor\s*(?:home\s*)?[- ]?loans?|home\s*equity|refinance|stamp\s*duty|borrowing\s*power|first\s*home|owner[\s-]occupier|home\s*loan\s*tools?|property\s*insights?|\bLVR\b|variable\s*rate\s*investor|investment\s*propert)\b/i,
  personal_loan:
    /\b(personal\s*[- ]?loans?|payday\s*[- ]?loans?|cash\s*[- ]?loans?|unsecured\s*[- ]?loans?|line\s*of\s*credit|consumer\s*credit|quick\s*cash|home\s*renovation\s*loans?)\b/i,
  business_loan:
    /\b(business\s*[- ]?loans?|sme\s*[- ]?(?:loans?|finance)|working\s*capital|equipment\s*[- ]?(?:loans?|finance)|invoice\s*finance|merchant\s*cash|business\s*finance)\b/i,
  commercial_mortgage:
    /\b(commercial\s*[- ]?(?:mortgages?|property\s*[- ]?(?:finance|lending|loans?)|lending|finance\s*broker)|commercial\s*[- ]?mortgage\s*[- ]?broker|commercial\s*property\s*[- ]?(?:finance|loan|lending|mortgage)|smsf\s*commercial\s*property)\b/i,
  insurance:
    /\b(car\s*insurance|home\s*insurance|life\s*insurance|health\s*insurance|travel\s*insurance|insurance\s*quotes?)\b/i,
  real_estate:
    /\b(real\s*estate|realty|property\s*(?:portal|listings?|search|insights?)|homes?\s*for\s*sale|buy\s*a\s*(?:home|house)|rentals?)\b/i,
};

const FAMILY_CUES: Record<ConcreteFamily, RegExp> = {
  car_loan: /\b(car|auto|vehicle|automotive|motor(?:ing)?)\b/i,
  home_loan: /\b(home|house|mortgage|property|investor|realty|refinance|lvr)\b/i,
  personal_loan: /\b(personal|payday|unsecured|consumer|renovation)\b/i,
  business_loan: /\b(business|sme|merchant|invoice|working\s*capital|equipment)\b/i,
  commercial_mortgage: /\b(commercial|property\s*finance|property\s*lending)\b/i,
  insurance: /\b(insurance|insure|premium|cover)\b/i,
  real_estate: /\b(realestate|realty|property|listings?)\b/i,
};

const LOANISH = /\b(loans?|finance|financ(?:ing|ial)|lending|lender|credit)\b/i;

const CONFLICT_DOMAIN_HINTS: Partial<Record<ConcreteFamily, RegExp>> = {
  car_loan: /\b(realestate|domain\.com|homeloan|mortgage|realtor|property\.com)\b/i,
  home_loan: /\b(carloans?|autofinance|vehiclefinance)\b/i,
};

const PLACEHOLDER_CREATIVE =
  /<\s*(?:rating|reviews?|category|open\s*hours|distance)\s*>/i;

/** Remove URLs so path segments like /car-loans cannot override a home-loan headline. */
export function stripUrls(text: string): string {
  return text
    .replace(/https?:\/\/[^\s)]+/gi, ' ')
    .replace(/\bwww\.[^\s)]+/gi, ' ')
    .replace(/\b[\w-]+\.(?:com\.au|com|net|org|co\.nz|co\.uk)(?:\/[^\s)]*)?/gi, ' ');
}

function uniqueFamilies(items: ServiceFamily[]): ServiceFamily[] {
  return [...new Set(items)];
}

/** Commercial property / mortgage lending — not owner-occupier home loans or SME working-capital. */
export function isCommercialMortgageContext(text: string): boolean {
  const t = stripUrls(text).toLowerCase();
  if (!/\bcommercial\b/.test(t)) return false;
  if (/\b(home\s*loan|owner[\s-]occupier|first\s*home|residential\s*home)\b/.test(t)) return false;
  return /\b(mortgage|property\s*(?:finance|lending|loan)|lending|finance\s*broker)\b/.test(t);
}

export function isCommercialMortgageTarget(services: string[]): boolean {
  const joined = services.filter(Boolean).join(' ').toLowerCase();
  if (isCommercialMortgageContext(joined)) return true;
  return targetServiceFamilies(services).includes('commercial_mortgage');
}

/** SME / working-capital business lending without commercial property mortgage intent. */
function isGenericBusinessLoanContext(text: string): boolean {
  if (isCommercialMortgageContext(text)) return false;
  return detectServiceFamilies(text).includes('business_loan');
}

export function detectServiceFamilies(text: string): ServiceFamily[] {
  const t = stripUrls(text).trim();
  if (!t) return [];
  if (isCommercialMortgageContext(t)) return ['commercial_mortgage'];
  const found: ServiceFamily[] = [];
  for (const [family, pattern] of Object.entries(FAMILY_PATTERNS) as Array<[ConcreteFamily, RegExp]>) {
    if (pattern.test(t)) found.push(family);
  }
  return uniqueFamilies(found);
}

export function targetServiceFamilies(services: string[]): ServiceFamily[] {
  const joined = services.filter(Boolean).join(' ');
  const detected = detectServiceFamilies(joined);
  if (detected.length) return detected;

  const cueHits: ServiceFamily[] = [];
  for (const [family, cue] of Object.entries(FAMILY_CUES) as Array<[ConcreteFamily, RegExp]>) {
    if (cue.test(joined) && (LOANISH.test(joined) || family === 'insurance' || family === 'real_estate')) {
      cueHits.push(family);
    }
  }
  if (cueHits.length) return uniqueFamilies(cueHits);
  return joined.trim() ? ['generic'] : [];
}

function concreteTargets(services: string[]): ConcreteFamily[] {
  return targetServiceFamilies(services).filter((f): f is ConcreteFamily => f !== 'generic');
}

export function primaryCreativeText(parts: {
  headline?: string;
  description?: string;
  headlines?: string[];
  descriptions?: string[];
}): string {
  const headline = (parts.headline ?? parts.headlines?.[0] ?? '').trim();
  const description = (parts.description ?? parts.descriptions?.[0] ?? '').trim();
  return `${headline} ${description}`.trim();
}

export function isGarbageCreativeText(text: string): boolean {
  const t = stripUrls(text).trim();
  if (!t) return true;
  if (PLACEHOLDER_CREATIVE.test(t)) return true;
  const letters = (t.match(/[a-z]/gi) ?? []).length;
  return letters < 12;
}

function earliestFamily(text: string): ConcreteFamily | null {
  const cleaned = stripUrls(text);
  let best: { family: ConcreteFamily; index: number } | null = null;
  for (const [family, pattern] of Object.entries(FAMILY_PATTERNS) as Array<[ConcreteFamily, RegExp]>) {
    const re = new RegExp(pattern.source, pattern.flags);
    const m = re.exec(cleaned);
    if (m && (best == null || m.index < best.index)) {
      best = { family, index: m.index };
    }
  }
  return best?.family ?? null;
}

export function hasConflictingService(text: string, targetServices: string[]): boolean {
  const targets = concreteTargets(targetServices);
  if (!targets.length) return false;
  const cleaned = stripUrls(text);
  const found = detectServiceFamilies(cleaned);
  if (!found.length) return false;

  const targetCommercial = targets.includes('commercial_mortgage');
  const targetBusiness = targets.includes('business_loan');
  if (targetCommercial && isGenericBusinessLoanContext(cleaned)) return true;
  if (targetBusiness && isCommercialMortgageContext(cleaned)) return true;

  const hasTarget = found.some((f) => targets.includes(f as ConcreteFamily));
  const others = found.filter((f) => f !== 'generic' && !targets.includes(f as ConcreteFamily));
  if (!others.length) return false;
  if (!hasTarget) return true;

  const dominant = earliestFamily(cleaned);
  if (dominant && !targets.includes(dominant)) return true;
  return isIncidentalTargetMention(cleaned, targets);
}

function isIncidentalTargetMention(text: string, targets: ConcreteFamily[]): boolean {
  const primary = text.slice(0, Math.min(text.length, 160));
  const primaryFamilies = detectServiceFamilies(primary);
  const primaryHasTarget = primaryFamilies.some((f) => targets.includes(f as ConcreteFamily));
  if (primaryHasTarget) return false;
  const fullHasTarget = detectServiceFamilies(text).some((f) =>
    targets.includes(f as ConcreteFamily)
  );
  return fullHasTarget && primaryFamilies.some((f) => f !== 'generic');
}

/**
 * Strict copy match (URLs stripped). Requires target family phrase in the text,
 * not merely cue+loan (which over-matches banks).
 */
export function matchesTargetService(text: string, targetServices: string[]): boolean {
  const cleaned = stripUrls(text).trim();
  if (!cleaned || isGarbageCreativeText(cleaned)) return false;

  const targets = concreteTargets(targetServices);
  if (!targets.length) {
    const tokens = targetServices
      .join(' ')
      .toLowerCase()
      .split(/\W+/)
      .filter((t) => t.length >= 3);
    if (!tokens.length) return true;
    const lower = cleaned.toLowerCase();
    const hits = tokens.filter((t) => lower.includes(t)).length;
    return hits >= Math.min(2, tokens.length) || (tokens.length === 1 && hits === 1);
  }

  if (hasConflictingService(cleaned, targetServices)) return false;

  const primary = cleaned.slice(0, Math.min(cleaned.length, 200));
  const primaryFound = detectServiceFamilies(primary);
  if (primaryFound.some((f) => targets.includes(f as ConcreteFamily))) {
    const dominant = earliestFamily(primary);
    if (!dominant || targets.includes(dominant)) return true;
    return false;
  }
  return false;
}

export function scoreServiceTextMatch(text: string, targetServices: string[]): number {
  if (!targetServices.length) return 50;
  if (isGarbageCreativeText(text)) return 0;
  if (hasConflictingService(text, targetServices)) return 0;
  if (matchesTargetService(text, targetServices)) {
    const found = detectServiceFamilies(stripUrls(text).slice(0, 180));
    const targets = concreteTargets(targetServices);
    const exact = found.some((f) => f !== 'generic' && targets.includes(f as ConcreteFamily));
    return exact ? 100 : 78;
  }
  const tokens = targetServices
    .join(' ')
    .toLowerCase()
    .split(/\W+/)
    .filter((t) => t.length >= 3 && !['loan', 'loans', 'with', 'from', 'your', 'the'].includes(t));
  if (!tokens.length) return 40;
  const lower = stripUrls(text).toLowerCase();
  const hits = tokens.filter((t) => lower.includes(t)).length;
  return Math.round((hits / tokens.length) * 40);
}

export function advertiserConflictsWithService(
  name: string,
  url: string,
  targetServices: string[]
): boolean {
  const identity = `${name} ${url}`.toLowerCase();
  if (hasConflictingService(identity, targetServices)) return true;
  const targets = concreteTargets(targetServices);
  for (const family of targets) {
    const hint = CONFLICT_DOMAIN_HINTS[family];
    if (hint?.test(identity)) return true;
  }
  if (targets.includes('car_loan') && /\brealestate\.com\.au\b|\bdomain\.com\.au\b|\bhousing\b/i.test(identity)) {
    return true;
  }
  return false;
}

export function advertiserLikelyMatchesService(
  name: string,
  url: string,
  targetServices: string[]
): boolean {
  if (advertiserConflictsWithService(name, url, targetServices)) return false;
  return matchesTargetService(`${name} ${stripUrls(url)}`, targetServices);
}

/**
 * Gallery gate: headline must itself be about the target service.
 * Description may support, but cannot override a conflicting headline.
 * Destination URLs are ignored for the final decision.
 */
export function creativeMatchesTargetService(
  creative: {
    headline?: string;
    description?: string;
    headlines?: string[];
    descriptions?: string[];
    destinationUrl?: string;
  },
  targetServices: string[]
): boolean {
  const headline = stripUrls((creative.headline ?? creative.headlines?.[0] ?? '').trim());
  const description = stripUrls((creative.description ?? creative.descriptions?.[0] ?? '').trim());
  if (isGarbageCreativeText(`${headline} ${description}`.trim() || headline)) return false;

  const targets = concreteTargets(targetServices);
  if (!targets.length) {
    return matchesTargetService(`${headline} ${description}`, targetServices);
  }

  if (headline) {
    const headFamilies = detectServiceFamilies(headline);
    if (headFamilies.some((f) => f !== 'generic' && !targets.includes(f as ConcreteFamily))) {
      return false;
    }
    if (headFamilies.some((f) => targets.includes(f as ConcreteFamily))) {
      return true;
    }
    // Headline present but no family — reject; do not rely on description/URL soft cues
    // unless description itself is a clear exclusive target match with no conflict.
    if (!description) return false;
    if (hasConflictingService(description, targetServices)) return false;
    return detectServiceFamilies(description).some((f) => targets.includes(f as ConcreteFamily));
  }

  if (!description) return false;
  if (hasConflictingService(description, targetServices)) return false;
  return detectServiceFamilies(description).some((f) => targets.includes(f as ConcreteFamily));
}
