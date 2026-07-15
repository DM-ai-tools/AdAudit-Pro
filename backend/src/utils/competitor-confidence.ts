export type AdvertiserDurationClass =
  | 'new'
  | 'growing'
  | 'established'
  | 'dominant';

export interface CompetitorConfidenceBreakdown {
  industryRelevance: number;
  serviceRelevance: number;
  advertisingDuration: number;
  activeAds: number;
  totalHistoricalAds: number;
  brandReview: number;
  socialBrandPresence: number;
}

export interface CompetitorConfidenceResult {
  /** 0–100 overall confidence */
  score: number;
  breakdown: CompetitorConfidenceBreakdown;
  durationClass: AdvertiserDurationClass;
  durationLabel: string;
  brandAuthorityScore: number;
  /** Share of Claude influence 0–1 (normalized later across top set) */
  rawInfluence: number;
}

/**
 * Spec weights:
 * Industry 20% | Service 15% | Ad Duration 20% | Active Ads 15%
 * Total Ads 10% | Brand Review 10% | Social & Brand Presence 10%
 */
const WEIGHTS = {
  industryRelevance: 0.2,
  serviceRelevance: 0.15,
  advertisingDuration: 0.2,
  activeAds: 0.15,
  totalHistoricalAds: 0.1,
  brandReview: 0.1,
  socialBrandPresence: 0.1,
} as const;

function clamp(n: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, Math.round(n)));
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/\W+/)
      .filter((w) => w.length >= 3)
  );
}

function overlapScore(a: Set<string>, b: Set<string>, max = 100): number {
  if (!a.size || !b.size) return 0;
  let hits = 0;
  for (const t of a) if (b.has(t)) hits += 1;
  return clamp((hits / Math.max(3, Math.min(a.size, 12))) * max);
}

export function classifyAdDuration(days: number): { class: AdvertiserDurationClass; label: string } {
  if (days >= 730) return { class: 'dominant', label: 'Dominant Advertiser (730+ Days)' };
  if (days >= 366) return { class: 'established', label: 'Established Advertiser (366–730 Days)' };
  if (days >= 91) return { class: 'growing', label: 'Growing Advertiser (91–365 Days)' };
  if (days > 0) return { class: 'new', label: 'New Advertiser (0–90 Days)' };
  return { class: 'new', label: 'New / Unknown Advertiser' };
}

export function scoreAdvertisingDuration(days: number): number {
  if (days <= 0) return 0;
  if (days >= 730) return 100;
  if (days >= 366) return 82 + ((days - 366) / (730 - 366)) * 18;
  if (days >= 91) return 55 + ((days - 91) / (366 - 91)) * 27;
  return 25 + (days / 90) * 30;
}

export function scoreActiveAds(active: number): number {
  if (active <= 0) return 0;
  if (active >= 50) return 100;
  if (active >= 20) return 88;
  if (active >= 8) return 75;
  if (active >= 4) return 62;
  if (active >= 2) return 48;
  return 32;
}

export function scoreTotalAds(total: number): number {
  if (total <= 0) return 0;
  if (total >= 200) return 100;
  if (total >= 80) return 90;
  if (total >= 40) return 82;
  if (total >= 20) return 72;
  if (total >= 10) return 60;
  if (total >= 4) return 48;
  return 30;
}

/** Brand Authority derived only from SociaVault ad-library signals (no LinkedIn/Similarweb). */
export function computeBrandAuthorityScore(input: {
  adDurationDays?: number;
  activeAdCount?: number;
  totalAdCount?: number;
  adsEstimate?: number;
  brandReviewScore?: number;
}): number {
  const duration = scoreAdvertisingDuration(input.adDurationDays ?? 0);
  const active = scoreActiveAds(input.activeAdCount ?? 0);
  const total = scoreTotalAds(Math.max(input.totalAdCount ?? 0, input.adsEstimate ?? 0));
  const brand = clamp(input.brandReviewScore ?? 50);
  return clamp(duration * 0.35 + active * 0.25 + total * 0.2 + brand * 0.2);
}

export function computeCompetitorConfidence(input: {
  industry?: string;
  clientServices?: string[];
  clientKeywords?: string[];
  competitorServices?: string[];
  competitorKeywords?: string[];
  competitorHeadlines?: string[];
  competitorText?: string;
  adDurationDays?: number;
  activeAdCount?: number;
  totalAdCount?: number;
  adsEstimate?: number;
  trustSignals?: string[];
  brandReviewScore?: number;
  reviewRating?: number;
  reviewCount?: number;
  /** Proven SociaVault advertiser already selected as a peer — floors relevance */
  sociavaultProven?: boolean;
  locationMatch?: boolean;
  isAggregator?: boolean;
}): CompetitorConfidenceResult {
  const industryTokens = tokenize(input.industry ?? '');
  const serviceTokens = tokenize((input.clientServices ?? []).join(' '));
  const clientKw = new Set((input.clientKeywords ?? []).map((k) => k.toLowerCase()));
  const competitorTokens = tokenize(
    [
      ...(input.competitorServices ?? []),
      ...(input.competitorHeadlines ?? []),
      ...(input.competitorKeywords ?? []),
      input.competitorText ?? '',
    ].join(' ')
  );

  let industryRelevance = industryTokens.size
    ? overlapScore(industryTokens, competitorTokens, 100)
    : overlapScore(serviceTokens, competitorTokens, 70);

  let serviceRelevance = overlapScore(serviceTokens, competitorTokens, 100);
  for (const kw of input.competitorKeywords ?? []) {
    if (clientKw.has(kw.toLowerCase())) serviceRelevance = Math.min(100, serviceRelevance + 5);
  }

  const hasAds = (input.totalAdCount ?? 0) > 0 || (input.adDurationDays ?? 0) > 0;
  // SociaVault-proven peers already passed industry/service gates — don't let weak NLP crush the score
  if (input.sociavaultProven && hasAds) {
    industryRelevance = Math.max(industryRelevance, input.locationMatch ? 88 : 78);
    serviceRelevance = Math.max(serviceRelevance, 72);
  }
  if (input.locationMatch) {
    industryRelevance = Math.min(100, industryRelevance + 8);
  }

  const effectiveTotal = Math.max(input.totalAdCount ?? 0, input.adsEstimate ?? 0);
  const advertisingDuration = scoreAdvertisingDuration(input.adDurationDays ?? 0);
  const activeAds = scoreActiveAds(input.activeAdCount ?? 0);
  const totalHistoricalAds = scoreTotalAds(effectiveTotal);

  const brandReview = clamp(
    (input.brandReviewScore ?? 50) * 0.85 + (input.trustSignals?.length ?? 0) * 5
  );

  // Social & Brand Presence — derived from SociaVault ad footprint + brand review (no external APIs)
  const brandAuthority = computeBrandAuthorityScore({
    adDurationDays: input.adDurationDays,
    activeAdCount: input.activeAdCount,
    totalAdCount: input.totalAdCount,
    adsEstimate: input.adsEstimate,
    brandReviewScore: input.brandReviewScore,
  });
  let socialBrandPresence = brandAuthority;
  if (input.reviewRating != null) {
    socialBrandPresence = clamp(
      socialBrandPresence * 0.7 +
        (input.reviewRating / 5) * 100 * 0.3 +
        Math.min(10, Math.log10(Math.max(1, input.reviewCount ?? 1)) * 4)
    );
  }

  if (input.isAggregator) {
    serviceRelevance = Math.max(0, serviceRelevance - 25);
    industryRelevance = Math.max(0, industryRelevance - 10);
  }

  let score = clamp(
    industryRelevance * WEIGHTS.industryRelevance +
      serviceRelevance * WEIGHTS.serviceRelevance +
      advertisingDuration * WEIGHTS.advertisingDuration +
      activeAds * WEIGHTS.activeAds +
      totalHistoricalAds * WEIGHTS.totalHistoricalAds +
      brandReview * WEIGHTS.brandReview +
      socialBrandPresence * WEIGHTS.socialBrandPresence
  );
  if (!hasAds) score = Math.min(score, 40);

  const { class: durationClass, label: durationLabel } = classifyAdDuration(input.adDurationDays ?? 0);

  return {
    score,
    breakdown: {
      industryRelevance: clamp(industryRelevance),
      serviceRelevance: clamp(serviceRelevance),
      advertisingDuration: clamp(advertisingDuration),
      activeAds: clamp(activeAds),
      totalHistoricalAds: clamp(totalHistoricalAds),
      brandReview: clamp(brandReview),
      socialBrandPresence: clamp(socialBrandPresence),
    },
    durationClass,
    durationLabel,
    brandAuthorityScore: brandAuthority,
    rawInfluence: Math.max(1, score),
  };
}

/** Normalize raw influence into percentages that sum to ~100. */
export function normalizeInfluenceWeights(
  scored: Array<{ name: string; score: number }>
): Array<{ name: string; score: number; influencePercent: number }> {
  const total = scored.reduce((s, x) => s + Math.max(1, x.score), 0) || 1;
  const mapped = scored.map((x) => ({
    name: x.name,
    score: x.score,
    influencePercent: Math.round((Math.max(1, x.score) / total) * 100),
  }));
  const drift = 100 - mapped.reduce((s, x) => s + x.influencePercent, 0);
  if (mapped[0]) mapped[0].influencePercent += drift;
  return mapped;
}

export function formatDurationDays(days: number): string {
  if (!days || days <= 0) return 'Not available';
  return `${days.toLocaleString('en-US')} Days`;
}
