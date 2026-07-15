/**
 * Brand Authority & AI Learning framework.
 * Derives market/brand signals from SociaVault ad-library + crawl copy.
 * Social follower / DA / traffic fields stay undefined unless a real source provides them.
 */

function clamp(n: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, Math.round(n)));
}

export type MarketPositionLabel =
  | 'Market Leader'
  | 'Established Competitor'
  | 'Growing Competitor'
  | 'Emerging Competitor';

export type CompanySizeLabel = 'Startup' | 'SMB' | 'Mid-Market' | 'Enterprise';

export type CompetitiveThreatLabel = 'Critical' | 'High' | 'Medium' | 'Low';

export interface BrandAuthorityProfile {
  employeeCount?: number;
  employeeCountEstimated?: boolean;
  companySize: CompanySizeLabel;
  yearsInBusiness?: number;
  yearsInBusinessEstimated?: boolean;
  brandAuthorityScore: number;
  marketPosition: MarketPositionLabel;
  competitiveThreat: CompetitiveThreatLabel;
  brandStrengthScore: number;
  competitiveThreatScore: number;
}

export interface SocialPresenceMetrics {
  linkedInFollowers?: number;
  facebookFollowers?: number;
  instagramFollowers?: number;
  youtubeSubscribers?: number;
  tiktokFollowers?: number;
  twitterFollowers?: number;
  totalSocialReach?: number;
  socialPresenceScore: number;
  source: 'sociavault_ad_library' | 'sociavault_social_profiles' | 'unavailable';
}

export interface AdvertisingStrengthMetrics {
  adDurationDays: number;
  activeAdCount: number;
  totalAdCount: number;
  advertisingScore: number;
}

export interface MarketAuthorityMetrics {
  domainAuthority?: number;
  organicKeywords?: number;
  monthlyTraffic?: number;
  backlinks?: number;
  marketShare?: number;
  authorityScore: number;
  source: 'sociavault_derived' | 'unavailable';
}

export interface OfferTrustSocialProofAnalysis {
  offersUsed: string[];
  topPromotions: string[];
  uniqueSellingPoints: string[];
  trustSignals: string[];
  trustSignalScore: number;
  socialProofItems: string[];
  socialProofScore: number;
}

export interface AiLearningMetrics {
  aiLearningValue: number;
  competitorScore: number;
  influencePercent: number;
  breakdown: {
    adDuration: number;
    activeAds: number;
    totalAds: number;
    brandReviews: number;
    trustScore: number;
    employeeCount: number;
    socialPresence: number;
    authorityScore: number;
    marketPosition: number;
  };
}

import {
  scoreAdvertisingDuration,
  scoreActiveAds,
  scoreTotalAds,
  computeBrandAuthorityScore,
} from './competitor-confidence.js';

export function classifyCompanySize(input: {
  adDurationDays: number;
  activeAdCount: number;
  totalAdCount: number;
  employeeCount?: number;
}): CompanySizeLabel {
  if (input.employeeCount != null) {
    if (input.employeeCount >= 1000) return 'Enterprise';
    if (input.employeeCount >= 200) return 'Mid-Market';
    if (input.employeeCount >= 50) return 'SMB';
    return 'Startup';
  }
  const footprint =
    Math.min(40, (input.adDurationDays / 730) * 40) +
    Math.min(30, (input.activeAdCount / 50) * 30) +
    Math.min(30, (input.totalAdCount / 200) * 30);
  if (footprint >= 75) return 'Enterprise';
  if (footprint >= 50) return 'Mid-Market';
  if (footprint >= 25) return 'SMB';
  return 'Startup';
}

export function estimateEmployeeCount(size: CompanySizeLabel): number {
  switch (size) {
    case 'Enterprise':
      return 850;
    case 'Mid-Market':
      return 220;
    case 'SMB':
      return 65;
    default:
      return 18;
  }
}

export function estimateYearsInBusiness(adDurationDays: number): number {
  if (adDurationDays <= 0) return 1;
  // Ad library longevity is a lower bound on brand maturity
  const fromAds = Math.max(1, Math.round(adDurationDays / 365));
  return Math.min(40, Math.max(fromAds, fromAds >= 2 ? fromAds + 2 : fromAds));
}

export function classifyMarketPosition(input: {
  brandAuthorityScore: number;
  adDurationDays: number;
  activeAdCount: number;
  totalAdCount: number;
}): MarketPositionLabel {
  const { brandAuthorityScore: a, adDurationDays: d, activeAdCount: act, totalAdCount: tot } = input;
  if (a >= 85 && d >= 730 && act >= 40) return 'Market Leader';
  if (a >= 70 && d >= 366) return 'Established Competitor';
  if (a >= 55 && (d >= 91 || act >= 8 || tot >= 20)) return 'Growing Competitor';
  return 'Emerging Competitor';
}

export function marketPositionScore(position: MarketPositionLabel): number {
  switch (position) {
    case 'Market Leader':
      return 95;
    case 'Established Competitor':
      return 78;
    case 'Growing Competitor':
      return 58;
    default:
      return 35;
  }
}

export function classifyCompetitiveThreat(score: number): CompetitiveThreatLabel {
  if (score >= 85) return 'Critical';
  if (score >= 70) return 'High';
  if (score >= 50) return 'Medium';
  return 'Low';
}

export function computeCompetitiveThreatScore(input: {
  brandAuthorityScore: number;
  advertisingScore: number;
  trustScore: number;
  marketPositionScore: number;
  activeAdCount: number;
}): number {
  return clamp(
    input.brandAuthorityScore * 0.3 +
      input.advertisingScore * 0.3 +
      input.trustScore * 0.2 +
      input.marketPositionScore * 0.15 +
      Math.min(100, input.activeAdCount * 1.5) * 0.05
  );
}

export function computeAdvertisingScore(input: {
  adDurationDays: number;
  activeAdCount: number;
  totalAdCount: number;
}): number {
  return clamp(
    scoreAdvertisingDuration(input.adDurationDays) * 0.4 +
      scoreActiveAds(input.activeAdCount) * 0.35 +
      scoreTotalAds(input.totalAdCount) * 0.25
  );
}

export function computeSocialPresenceScore(input: {
  linkedInFollowers?: number;
  facebookFollowers?: number;
  instagramFollowers?: number;
  youtubeSubscribers?: number;
  tiktokFollowers?: number;
  twitterFollowers?: number;
  /** Fallback when no follower data — ad-library brand authority proxy */
  brandAuthorityFallback?: number;
}): { score: number; totalSocialReach?: number; source: SocialPresenceMetrics['source'] } {
  const parts = [
    input.linkedInFollowers,
    input.facebookFollowers,
    input.instagramFollowers,
    input.youtubeSubscribers,
    input.tiktokFollowers,
    input.twitterFollowers,
  ].filter((n): n is number => typeof n === 'number' && n > 0);

  if (!parts.length) {
    return {
      score: clamp(input.brandAuthorityFallback ?? 0),
      source: 'unavailable',
    };
  }

  const total = parts.reduce((s, n) => s + n, 0);
  // log-scale reach → 0–100
  const score = clamp(20 + Math.log10(Math.max(1, total)) * 18);
  return { score, totalSocialReach: total, source: 'sociavault_social_profiles' };
}

export function computeMarketAuthorityScore(input: {
  advertisingScore: number;
  brandAuthorityScore: number;
  trustScore: number;
  domainAuthority?: number;
  organicKeywords?: number;
  monthlyTraffic?: number;
  backlinks?: number;
}): MarketAuthorityMetrics {
  const hasExternal =
    input.domainAuthority != null ||
    input.organicKeywords != null ||
    input.monthlyTraffic != null ||
    input.backlinks != null;

  let authorityScore: number;
  if (hasExternal) {
    const da = input.domainAuthority != null ? clamp(input.domainAuthority) : 50;
    const kw = input.organicKeywords != null ? clamp(Math.log10(Math.max(1, input.organicKeywords)) * 22) : 50;
    const traffic =
      input.monthlyTraffic != null ? clamp(Math.log10(Math.max(1, input.monthlyTraffic)) * 16) : 50;
    const links = input.backlinks != null ? clamp(Math.log10(Math.max(1, input.backlinks)) * 18) : 50;
    authorityScore = clamp(da * 0.35 + kw * 0.2 + traffic * 0.25 + links * 0.2);
  } else {
    authorityScore = clamp(
      input.advertisingScore * 0.4 + input.brandAuthorityScore * 0.35 + input.trustScore * 0.25
    );
  }

  return {
    domainAuthority: input.domainAuthority,
    organicKeywords: input.organicKeywords,
    monthlyTraffic: input.monthlyTraffic,
    backlinks: input.backlinks,
    authorityScore,
    source: hasExternal ? 'sociavault_derived' : 'unavailable',
  };
}

const OFFER_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /\bfree\s+consultation\b/i, label: 'Free Consultation' },
  { re: /\bfree\s+quote\b/i, label: 'Free Quote' },
  { re: /\bsame[- ]day\b/i, label: 'Same Day Service' },
  { re: /\bprice\s+match\b/i, label: 'Price Match Guarantee' },
  { re: /\bfree\s+delivery\b|\bfree\s+shipping\b/i, label: 'Free Delivery' },
  { re: /\b24\/7\b|\b24-7\b/i, label: '24/7 Support' },
  { re: /\bno\s+(?:credit\s+)?check\b/i, label: 'No Credit Check' },
  { re: /\bfast\s+approv/i, label: 'Fast Approvals' },
  { re: /\blow\s+rate/i, label: 'Low Rates' },
  { re: /\bmoney[- ]back\b/i, label: 'Money Back Guarantee' },
  { re: /\bfirst\s+(?:loan|month)\s+free\b/i, label: 'First Period Free' },
  { re: /\binstant\s+(?:approval|decision)\b/i, label: 'Instant Approval' },
];

const TRUST_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /\b(\d+)\+?\s*years?\s+(?:of\s+)?experience\b/i, label: 'Years Experience' },
  { re: /\b(\d[\d,]*)\+?\s*customers?\b/i, label: 'Customers Served' },
  { re: /\baward[- ]winning\b/i, label: 'Award Winning' },
  { re: /\blicensed\b|\baccredited\b/i, label: 'Licensed Experts' },
  { re: /\baustralian\s+owned\b|\baustralian\s+company\b/i, label: 'Australian Owned' },
  { re: /\bmoney[- ]back\s+guarantee\b/i, label: 'Money Back Guarantee' },
  { re: /\bb\s*corp\b/i, label: 'B Corp Certified' },
  { re: /\basic\b|\biso\b/i, label: 'Industry Certified' },
  { re: /\bsecure\b|\bssl\b|\bencrypted\b/i, label: 'Secure & Encrypted' },
  { re: /\btrustpilot\b|\bgoogle\s+reviews?\b/i, label: 'Verified Reviews' },
];

const SOCIAL_PROOF_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /\b(\d[\d,]*)\+?\s*customers?\b/i, label: 'Customers' },
  { re: /\b(\d[\d,]*)\+?\s*reviews?\b/i, label: 'Reviews' },
  { re: /\bfeatured\s+in\b|\bas\s+seen\s+(?:in|on)\b/i, label: 'Featured In Major Publications' },
  { re: /\bcertif(?:ied|ication)s?\b/i, label: 'Industry Certifications' },
  { re: /\b(\d[\d,]*)\+?\s*(?:monthly\s+)?visitors?\b/i, label: 'Monthly Visitors' },
  { re: /\btrusted\s+by\b/i, label: 'Trusted By Leading Brands' },
  { re: /\b#?1\b|\btop[- ]rated\b/i, label: 'Top Rated' },
];

function extractLabeled(text: string, patterns: Array<{ re: RegExp; label: string }>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const { re, label } of patterns) {
    const m = text.match(re);
    if (!m) continue;
    let item = label;
    if (m[1] && /years/i.test(label)) item = `${m[1]} Years Experience`;
    else if (m[1] && /customers/i.test(label)) item = `${m[1]}+ Customers`;
    else if (m[1] && /reviews/i.test(label)) item = `${m[1]}+ Reviews`;
    else if (m[1] && /visitors/i.test(label)) item = `${m[1]}+ Monthly Visitors`;
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

export function analyzeOffersTrustSocialProof(input: {
  offers?: string[];
  trustSignals?: string[];
  valuePropositions?: string[];
  headlines?: string[];
  descriptions?: string[];
  keyMessages?: string[];
}): OfferTrustSocialProofAnalysis {
  const blob = [
    ...(input.offers ?? []),
    ...(input.trustSignals ?? []),
    ...(input.valuePropositions ?? []),
    ...(input.headlines ?? []),
    ...(input.descriptions ?? []),
    ...(input.keyMessages ?? []),
  ].join(' | ');

  const fromOffers = (input.offers ?? []).map((o) => o.trim()).filter(Boolean).slice(0, 8);
  const extractedOffers = extractLabeled(blob, OFFER_PATTERNS);
  const offersUsed = [...new Set([...fromOffers, ...extractedOffers])].slice(0, 10);

  const trustFromProfile = (input.trustSignals ?? []).map((t) => t.trim()).filter(Boolean);
  const trustExtracted = extractLabeled(blob, TRUST_PATTERNS);
  const trustSignals = [...new Set([...trustFromProfile, ...trustExtracted])].slice(0, 10);

  const socialProofItems = extractLabeled(blob, SOCIAL_PROOF_PATTERNS).slice(0, 8);
  const usps = (input.valuePropositions ?? [])
    .map((v) => v.trim())
    .filter((v) => v.length >= 4 && v.length <= 80)
    .slice(0, 6);

  const trustSignalScore = clamp(35 + trustSignals.length * 10 + (trustFromProfile.length ? 10 : 0));
  const socialProofScore = clamp(30 + socialProofItems.length * 12 + Math.min(20, offersUsed.length * 3));

  return {
    offersUsed,
    topPromotions: offersUsed.slice(0, 6),
    uniqueSellingPoints: usps.length ? usps : offersUsed.slice(0, 4),
    trustSignals,
    trustSignalScore,
    socialProofItems,
    socialProofScore,
  };
}

/**
 * AI Learning Value — how much Claude should learn from this competitor.
 * Ad Duration 20% | Active Ads 20% | Total Ads 10% | Brand Reviews 15% |
 * Trust 10% | Employees 5% | Social 5% | Authority 10% | Market Position 5%
 */
export function computeAiLearningValue(input: {
  adDurationDays: number;
  activeAdCount: number;
  totalAdCount: number;
  brandReviewScore: number;
  trustScore: number;
  employeeCount?: number;
  socialPresenceScore: number;
  authorityScore: number;
  marketPosition: MarketPositionLabel;
}): AiLearningMetrics {
  const adDuration = scoreAdvertisingDuration(input.adDurationDays);
  const activeAds = scoreActiveAds(input.activeAdCount);
  const totalAds = scoreTotalAds(input.totalAdCount);
  const brandReviews = clamp(input.brandReviewScore);
  const trustScore = clamp(input.trustScore);
  const employeeCount = input.employeeCount != null
    ? clamp(Math.log10(Math.max(1, input.employeeCount)) * 28)
    : clamp(adDuration * 0.5 + activeAds * 0.5);
  const socialPresence = clamp(input.socialPresenceScore);
  const authorityScore = clamp(input.authorityScore);
  const marketPosition = marketPositionScore(input.marketPosition);

  const aiLearningValue = clamp(
    adDuration * 0.2 +
      activeAds * 0.2 +
      totalAds * 0.1 +
      brandReviews * 0.15 +
      trustScore * 0.1 +
      employeeCount * 0.05 +
      socialPresence * 0.05 +
      authorityScore * 0.1 +
      marketPosition * 0.05
  );

  return {
    aiLearningValue,
    competitorScore: 0, // filled by caller (confidence)
    influencePercent: 0,
    breakdown: {
      adDuration: clamp(adDuration),
      activeAds: clamp(activeAds),
      totalAds: clamp(totalAds),
      brandReviews,
      trustScore,
      employeeCount: clamp(employeeCount),
      socialPresence,
      authorityScore,
      marketPosition,
    },
  };
}

export function buildBrandAuthorityBundle(input: {
  adDurationDays?: number;
  activeAdCount?: number;
  totalAdCount?: number;
  brandReviewScore?: number;
  trustScore?: number;
  employeeCount?: number;
  linkedInFollowers?: number;
  facebookFollowers?: number;
  instagramFollowers?: number;
  youtubeSubscribers?: number;
  tiktokFollowers?: number;
  twitterFollowers?: number;
  domainAuthority?: number;
  organicKeywords?: number;
  monthlyTraffic?: number;
  backlinks?: number;
  offers?: string[];
  trustSignals?: string[];
  valuePropositions?: string[];
  headlines?: string[];
  descriptions?: string[];
  keyMessages?: string[];
  confidenceScore?: number;
}): {
  brandAuthority: BrandAuthorityProfile;
  socialPresence: SocialPresenceMetrics;
  advertisingStrength: AdvertisingStrengthMetrics;
  marketAuthority: MarketAuthorityMetrics;
  offerTrustSocialProof: OfferTrustSocialProofAnalysis;
  aiLearning: AiLearningMetrics;
} {
  const adDurationDays = input.adDurationDays ?? 0;
  const activeAdCount = input.activeAdCount ?? 0;
  const totalAdCount = input.totalAdCount ?? 0;
  const brandReviewScore = input.brandReviewScore ?? 50;
  const trustScore = input.trustScore ?? brandReviewScore;

  const brandAuthorityScore = computeBrandAuthorityScore({
    adDurationDays,
    activeAdCount,
    totalAdCount,
    brandReviewScore,
  });

  const companySize = classifyCompanySize({
    adDurationDays,
    activeAdCount,
    totalAdCount,
    employeeCount: input.employeeCount,
  });

  const employeeEstimated = input.employeeCount == null;
  const employeeCount = input.employeeCount ?? estimateEmployeeCount(companySize);
  const yearsInBusiness = estimateYearsInBusiness(adDurationDays);

  const advertisingScore = computeAdvertisingScore({ adDurationDays, activeAdCount, totalAdCount });
  const marketPosition = classifyMarketPosition({
    brandAuthorityScore,
    adDurationDays,
    activeAdCount,
    totalAdCount,
  });
  const posScore = marketPositionScore(marketPosition);
  const competitiveThreatScore = computeCompetitiveThreatScore({
    brandAuthorityScore,
    advertisingScore,
    trustScore,
    marketPositionScore: posScore,
    activeAdCount,
  });

  const social = computeSocialPresenceScore({
    linkedInFollowers: input.linkedInFollowers,
    facebookFollowers: input.facebookFollowers,
    instagramFollowers: input.instagramFollowers,
    youtubeSubscribers: input.youtubeSubscribers,
    tiktokFollowers: input.tiktokFollowers,
    twitterFollowers: input.twitterFollowers,
    brandAuthorityFallback: brandAuthorityScore,
  });

  const marketAuthority = computeMarketAuthorityScore({
    advertisingScore,
    brandAuthorityScore,
    trustScore,
    domainAuthority: input.domainAuthority,
    organicKeywords: input.organicKeywords,
    monthlyTraffic: input.monthlyTraffic,
    backlinks: input.backlinks,
  });

  const offerTrustSocialProof = analyzeOffersTrustSocialProof(input);

  const aiLearning = computeAiLearningValue({
    adDurationDays,
    activeAdCount,
    totalAdCount,
    brandReviewScore,
    trustScore,
    employeeCount,
    socialPresenceScore: social.score,
    authorityScore: marketAuthority.authorityScore,
    marketPosition,
  });
  aiLearning.competitorScore = clamp(input.confidenceScore ?? brandAuthorityScore);

  return {
    brandAuthority: {
      employeeCount,
      employeeCountEstimated: employeeEstimated,
      companySize,
      yearsInBusiness,
      yearsInBusinessEstimated: true,
      brandAuthorityScore,
      marketPosition,
      competitiveThreat: classifyCompetitiveThreat(competitiveThreatScore),
      brandStrengthScore: brandAuthorityScore,
      competitiveThreatScore,
    },
    socialPresence: {
      linkedInFollowers: input.linkedInFollowers,
      facebookFollowers: input.facebookFollowers,
      instagramFollowers: input.instagramFollowers,
      youtubeSubscribers: input.youtubeSubscribers,
      tiktokFollowers: input.tiktokFollowers,
      twitterFollowers: input.twitterFollowers,
      totalSocialReach: social.totalSocialReach,
      socialPresenceScore: social.score,
      source: social.source,
    },
    advertisingStrength: {
      adDurationDays,
      activeAdCount,
      totalAdCount,
      advertisingScore,
    },
    marketAuthority,
    offerTrustSocialProof,
    aiLearning,
  };
}
