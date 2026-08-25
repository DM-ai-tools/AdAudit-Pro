/**
 * Lightweight client-side service filter for competitor previews.
 * Rejects clear wrong-vertical creatives (home/personal) on car-loan runs.
 * Trusts backend gallery for positive car matches — only blocks conflicts.
 */

const HOME_LOAN =
  /\b(home\s*[- ]?loans?|mortgages?|house\s*[- ]?loans?|property\s*[- ]?loans?|investor\s*(?:home\s*)?[- ]?loans?|stamp\s*duty|borrowing\s*power|home\s*loan\s*tools?|property\s*insights?|\bLVR\b|variable\s*rate\s*investor|investment\s*propert|refinance)\b/i;

const PERSONAL_LOAN =
  /\b(personal\s*[- ]?loans?|payday\s*[- ]?loans?|cash\s*[- ]?loans?|unsecured\s*[- ]?loans?|home\s*renovation\s*loans?)\b/i;

const CAR_LOAN =
  /\b(car\s*[- ]?loans?|auto\s*[- ]?loans?|vehicle\s*[- ]?(?:loans?|finance)|automotive\s*[- ]?(?:loans?|finance)|motor\s*[- ]?(?:loans?|finance)|car\s*[- ]?finance|auto\s*[- ]?finance|business\s*car\s*[- ]?loans?|company\s*vehicle\s*[- ]?finance)\b/i;

function isCarLoanService(service?: string): boolean {
  return Boolean(service && /\bcar\b|\bauto\b|\bvehicle\b/i.test(service) && /\bloan|finance/i.test(service));
}

export function competitorCreativeMatchesService(
  creative: {
    headlines?: string[];
    descriptions?: string[];
    totalAdCount?: number;
    adDurationDays?: number;
  },
  primaryService?: string
): boolean {
  if (!primaryService?.trim()) return true;

  const headline = (creative.headlines?.[0] ?? '').trim();
  const description = (creative.descriptions?.[0] ?? '').trim();
  const text = `${headline} ${description}`;
  const libraryBacked =
    (creative.totalAdCount ?? 0) > 0 || (creative.adDurationDays ?? 0) > 0;

  if (isCarLoanService(primaryService)) {
    if (HOME_LOAN.test(headline) || HOME_LOAN.test(text)) return false;
    if (PERSONAL_LOAN.test(headline) && !CAR_LOAN.test(headline)) return false;
    if (!headline && !description) return true;
    if (CAR_LOAN.test(headline) || CAR_LOAN.test(description)) return true;
    return !HOME_LOAN.test(text) && !PERSONAL_LOAN.test(text);
  }

  // Empty OCR — backend already scoped the advertiser
  if (!headline && !description) return true;
  // Backend-selected library rivals must stay visible even when OCR copy is generic
  if (libraryBacked) return true;

  const svc = primaryService.toLowerCase().trim();
  const blob = text.toLowerCase();
  if (blob.includes(svc)) return true;

  const stop = new Set([
    'for', 'and', 'the', 'with', 'in', 'of', 'a', 'an', 'to',
    'services', 'service', 'agency', 'marketing', 'solutions', 'company',
  ]);
  const tokens = svc.split(/\W+/).filter((t) => t.length >= 2 && !stop.has(t));
  if (!tokens.length) return true;
  if (tokens.length === 1) return blob.includes(tokens[0]!);
  return tokens.every((t) => blob.includes(t));
}
