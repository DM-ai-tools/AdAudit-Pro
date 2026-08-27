import { createClaudeMessage } from '../ai/anthropic-client.js';
import { extractJsonFromClaudeText } from '../utils/claude-json.js';
import { decodeHtmlEntities, decodeHtmlEntitiesList } from '../utils/html-entities.js';
import { inferCountryFromLocation, inferCountryFromWebsiteUrl, countryToLocationLabel, resolveMarketCountry } from '../utils/region-codes.js';
import {
  filterCompetitorIntelligenceForMarket,
  hasUsableCompetitorIntel,
  competitorUrlMatchesCountry,
} from '../utils/competitor-region.js';
import { analyzeWebsite, type WebsiteIntelligence } from './website-intelligence.service.js';
import {
  discoverSociaVaultCompetitors,
  fetchSociaVaultCompetitorAd,
  fetchSociaVaultMatchingAds,
  getSociaVaultErrorState,
  isLikelyArticleAdvertiser,
  isSociaVaultConfigured,
  isSociaVaultCreditsExhausted,
  resetSociaVaultErrorState,
  resolveCompetitorViaSociaVault,
} from './sociavault-google-ad-library.service.js';
import {
  discoverTransparencyAdvertisersByQueries,
  fetchExactTransparencyAdForCompetitor,
} from './google-ads-transparency.service.js';
import { withTimeout, withTimeoutFallback } from '../utils/withTimeout.js';
import {
  getCachedCompetitorDiscovery,
  setCachedCompetitorDiscovery,
  type CompetitorDiscoverySource,
} from './competitor-discovery-cache.service.js';
import {
  buildCompetitorSearchQueries,
  buildKeywordClusterQueries,
  businessLevelRulesForPrompt,
  expandServiceSearchQueries,
  inferBusinessContext,
  inferCompetitorLevelFromText,
  isAggregatorProfile,
  isSameOrOneLevelAbove,
  prioritizeMarketQueries,
  scoreBusinessLevelMatch,
  type BusinessContext,
} from '../utils/competitor-level.js';
import {
  classifyAdDuration,
  computeCompetitorConfidence,
  formatDurationDays,
  normalizeInfluenceWeights,
  type CompetitorConfidenceBreakdown,
} from '../utils/competitor-confidence.js';
import { buildBrandAuthorityBundle } from '../utils/competitor-brand-authority.js';
import {
  advertiserConflictsWithService,
  advertiserLikelyMatchesService,
  creativeMatchesTargetService,
  hasConflictingService,
  isCommercialMortgageTarget,
  isGarbageCreativeText,
  matchesTargetService,
  primaryCreativeText,
  scoreServiceTextMatch,
} from '../utils/service-relevance.js';
import {
  adMatchesServiceAndSeeds,
  copyMatchesServiceSeed,
  filterSeedKeywordsForService,
  keywordMatchesServiceSeed,
  looksLikeEducationalCompetitorName,
  looksLikeQueryNotAdvertiser,
  looksLikeNonCommercialAdvertiser,
  copyConflictsWithLegalService,
} from '../utils/service-seed-match.js';
import {
  isAdRelevant,
  scoreAdsForKeywordRelevance,
  scoreAdvertisersForService,
  AD_RELEVANCE_THRESHOLD,
  type AdRelevanceInput,
} from '../utils/ad-keyword-relevance.js';
import { type DiscoveredSocialLinks } from './sociavault-social-presence.service.js';
import { resolveCompetitorSocialPresence } from './social-presence-discovery.service.js';
import {
  classifyCompetitorCreative,
  normalizeAccountCampaignType,
  type CompetitorCampaignTypeKey,
} from '../utils/competitor-campaign-type.js';

export type { CompetitorConfidenceBreakdown };

export interface CompetitorBrandReview {
  /** 0–100 quality score for learning from this brand's ads */
  score: number;
  /** Short headline verdict */
  summary: string;
  /** Multi-paragraph detailed brand review */
  detailedReview: string;
  /** Ad activity narrative (duration / active / total) */
  adActivityReview: string;
  /** Messaging & positioning review */
  messagingReview: string;
  /** Trust & proof review */
  trustReview: string;
  /** Offer & value proposition review */
  offerReview: string;
  /** How to beat this competitor in ad copy */
  howToBeat: string[];
  /** Strengths useful for ad-copy inspiration */
  strengths: string[];
  /** Weaknesses / gaps you can beat */
  weaknesses: string[];
  /** Average rating 0–5 when known */
  averageRating?: number;
  /** Approximate review count when known */
  reviewCount?: number;
  /** Trust score 0–100 */
  trustScore?: number;
  /** Customer sentiment label */
  sentiment?: 'Highly Positive' | 'Positive' | 'Mixed' | 'Negative' | 'Unknown';
  positiveThemes?: string[];
  negativeThemes?: string[];
  reviewVelocity?: string;
}

export interface CompetitorSocialPresence {
  /** Brand authority 0–100 derived from SociaVault ad footprint */
  brandAuthorityScore: number;
  /** Optional — only when SociaVault (or another source) returns it */
  employeeCount?: number;
  employeeCountEstimated?: boolean;
  linkedInFollowers?: number;
  facebookFollowers?: number;
  instagramFollowers?: number;
  youtubeSubscribers?: number;
  tiktokFollowers?: number;
  twitterFollowers?: number;
  totalSocialReach?: number;
  socialPresenceScore?: number;
  /** Profile URLs discovered on the competitor website */
  profileUrls?: {
    linkedin?: string;
    facebook?: string;
    instagram?: string;
    youtube?: string;
    tiktok?: string;
    twitter?: string;
  };
  source: 'sociavault_ad_library' | 'sociavault_social_profiles' | 'unavailable';
}

export type MarketPositionLabel =
  | 'Market Leader'
  | 'Established Competitor'
  | 'Growing Competitor'
  | 'Emerging Competitor';

export type CompanySizeLabel = 'Startup' | 'SMB' | 'Mid-Market' | 'Enterprise';
export type CompetitiveThreatLabel = 'Critical' | 'High' | 'Medium' | 'Low';

export interface CompetitorBrandAuthority {
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

export interface CompetitorAdvertisingStrength {
  adDurationDays: number;
  activeAdCount: number;
  totalAdCount: number;
  advertisingScore: number;
}

export interface CompetitorMarketAuthority {
  domainAuthority?: number;
  organicKeywords?: number;
  monthlyTraffic?: number;
  backlinks?: number;
  marketShare?: number;
  authorityScore: number;
  source: 'sociavault_derived' | 'unavailable';
}

export interface CompetitorOfferTrustAnalysis {
  offersUsed: string[];
  topPromotions: string[];
  uniqueSellingPoints: string[];
  trustSignals: string[];
  trustSignalScore: number;
  socialProofItems: string[];
  socialProofScore: number;
}

export interface CompetitorAiLearning {
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

export interface CompetitiveMarketPatterns {
  topHeadlines: string[];
  topOffers: string[];
  topCtas: string[];
  topKeywords: string[];
  topValuePropositions: string[];
}

export interface CompetitorProfile {
  name: string;
  url: string;
  fetched: boolean;
  headlines: string[];
  descriptions: string[];
  offers: string[];
  services: string[];
  ctas: string[];
  trustSignals: string[];
  keywords: string[];
  keyMessages: string[];
  valuePropositions: string[];
  positioning?: string;
  /** Days advertising on Google Ads Transparency (SociaVault) */
  adDurationDays?: number;
  /** Creatives currently/recently active */
  activeAdCount?: number;
  totalAdCount?: number;
  firstShown?: string;
  lastShown?: string;
  brandReview?: CompetitorBrandReview;
  /** Competitor Confidence Score 0–100 */
  confidenceScore?: number;
  confidenceBreakdown?: CompetitorConfidenceBreakdown;
  durationClass?: 'new' | 'growing' | 'established' | 'dominant';
  durationLabel?: string;
  /** Claude influence weight % among top competitors */
  influencePercent?: number;
  industryMatch?: number;
  serviceMatch?: number;
  brandAuthorityScore?: number;
  socialPresence?: CompetitorSocialPresence;
  /** Social profile URLs discovered on the competitor website */
  socialLinks?: {
    linkedin?: string;
    facebook?: string;
    instagram?: string;
    youtube?: string;
    tiktok?: string;
    twitter?: string;
  };
  brandAuthority?: CompetitorBrandAuthority;
  advertisingStrength?: CompetitorAdvertisingStrength;
  marketAuthority?: CompetitorMarketAuthority;
  offerTrustAnalysis?: CompetitorOfferTrustAnalysis;
  aiLearning?: CompetitorAiLearning;
  advertisingScore?: number;
  aiLearningValue?: number;
  marketPosition?: MarketPositionLabel;
  competitiveThreat?: CompetitiveThreatLabel;
  adsEstimate?: number;
  /** SociaVault / Transparency advertiser id (AR…) — stable identity for metrics */
  advertiserId?: string;
  transparencyUrl?: string;
  error?: string;
}

export interface CompetitorAdPreview {
  name: string;
  url: string;
  displayUrl: string;
  displayPaths?: { path1?: string; path2?: string };
  headlines: string[];
  descriptions: string[];
  offers: string[];
  ctas: string[];
  trustSignals: string[];
  transparencyUrl?: string;
  creativeUrl?: string;
  advertiserName?: string;
  /** 0–100 semantic relevance to the selected service / keywords (LLM). */
  keywordRelevanceScore?: number;
  /** True when headlines/descriptions were invented from the company name (not Transparency OCR). */
  syntheticCopy?: boolean;
  adSource?: 'sociavault' | 'transparency_center' | 'website_fallback';
  adLink?: string;
  previewImageUrl?: string;
  /** SociaVault / Transparency creative format (text, image, video, …) */
  format?: string;
  /** Inferred Google Ads campaign-type bucket for Competitor Ad Library */
  campaignType?:
    | 'search'
    | 'display'
    | 'shopping'
    | 'video'
    | 'performance_max'
    | 'demand_gen'
    | 'app'
    | 'local_services'
    | 'call_ads';
  adDurationDays?: number;
  activeAdCount?: number;
  totalAdCount?: number;
  firstShown?: string;
  lastShown?: string;
  brandReview?: CompetitorBrandReview;
  confidenceScore?: number;
  durationClass?: 'new' | 'growing' | 'established' | 'dominant';
  durationLabel?: string;
  influencePercent?: number;
  industryMatch?: number;
  serviceMatch?: number;
  estimatedSuccessScore?: number;
  brandAuthorityScore?: number;
  socialPresence?: CompetitorSocialPresence;
  brandAuthority?: CompetitorBrandAuthority;
  advertisingStrength?: CompetitorAdvertisingStrength;
  marketAuthority?: CompetitorMarketAuthority;
  offerTrustAnalysis?: CompetitorOfferTrustAnalysis;
  aiLearning?: CompetitorAiLearning;
  advertisingScore?: number;
  aiLearningValue?: number;
  marketPosition?: MarketPositionLabel;
  competitiveThreat?: CompetitiveThreatLabel;
  /** Exact creative first/last seen */
  creativeFirstShown?: string;
  creativeLastShown?: string;
  isActive?: boolean;
  cta?: string;
  offer?: string;
  /** Landing page from SociaVault ad-details when available */
  destinationUrl?: string;
  /** SociaVault / Transparency advertiser id (AR…) */
  advertiserId?: string;
}

export type GapCategory = 'messaging' | 'offers' | 'keywords' | 'trust_signals' | 'ctas';

export interface CompetitorGapRow {
  category: GapCategory;
  competitor: string;
  competitorHas: string;
  youHave: string;
  gap: string;
}

export interface CompetitorGapAnalysis {
  rows: CompetitorGapRow[];
  summary: {
    messagingGaps: number;
    offerGaps: number;
    keywordGaps: number;
    trustSignalGaps: number;
    ctaGaps: number;
  };
}

export interface CompetitorInsightSummary {
  name: string;
  url: string;
  keyMessages: string[];
  offers: string[];
  keywordOpportunities: string[];
  adDurationDays?: number;
  activeAdCount?: number;
  totalAdCount?: number;
  firstShown?: string;
  lastShown?: string;
  brandReview?: CompetitorBrandReview;
  confidenceScore?: number;
  influencePercent?: number;
  durationLabel?: string;
  advertiserId?: string;
}

export interface CompetitorIntelligence {
  competitors: CompetitorProfile[];
  insights: CompetitorInsightSummary[];
  adGallery: CompetitorAdPreview[];
  gapAnalysis: CompetitorGapAnalysis;
  keywordOpportunities: string[];
  messagingOpportunities: string[];
  missingOffers: string[];
  competitiveAdvantages: string[];
  missingFromYourAds: string[];
  /** Ranked influence weights for Claude (driven by AI Learning Value) */
  influenceWeights?: Array<{
    name: string;
    score: number;
    aiLearningValue?: number;
    influencePercent: number;
  }>;
  /** Aggregated winning patterns mined from SociaVault ads */
  marketPatterns?: CompetitiveMarketPatterns;
  source: 'sociavault' | 'transparency_center' | 'claude_and_crawl' | 'claude_only' | 'user_provided' | 'unavailable';
  /** User-facing note when discovery was degraded (e.g. SociaVault credits exhausted). */
  discoveryWarning?: string;
}

function normalizeUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function hostnameToName(url: string): string {
  try {
    const host = new URL(normalizeUrl(url)).hostname.replace(/^www\./, '');
    const base = host.split('.')[0] ?? 'Competitor';
    return base.charAt(0).toUpperCase() + base.slice(1);
  } catch {
    return 'Competitor';
  }
}

function displayHostFromUrl(url: string): string {
  try {
    return new URL(normalizeUrl(url)).hostname.replace(/^www\./, '');
  } catch {
    return 'competitor.com';
  }
}

function advertiserIdFromTransparencyUrl(url?: string): string | undefined {
  if (!url) return undefined;
  const m = url.match(/advertiser\/(AR[\w-]+)/i);
  return m?.[1];
}

function buildTransparencyCenterUrl(advertiserId?: string, country?: string): string | undefined {
  const id = advertiserId?.trim();
  if (!id) return undefined;
  const region = country?.trim() || 'anywhere';
  return `https://adstransparency.google.com/advertiser/${id}?region=${region}`;
}

function attachTransparencyLink<T extends { advertiserId?: string; transparencyUrl?: string }>(
  item: T,
  country?: string
): T {
  const advertiserId =
    item.advertiserId ||
    advertiserIdFromTransparencyUrl(item.transparencyUrl);
  const transparencyUrl =
    item.transparencyUrl || buildTransparencyCenterUrl(advertiserId, country);
  if (advertiserId === item.advertiserId && transparencyUrl === item.transparencyUrl) return item;
  return { ...item, advertiserId, transparencyUrl };
}

/**
 * Unique competitor identity. Never key solely on adstransparency.google.com —
 * many SociaVault rivals share that host when domain is missing from company-ads.
 */
function competitorIdentityKey(opts: {
  name?: string;
  url?: string;
  advertiserId?: string;
  transparencyUrl?: string;
}): string {
  const adv =
    opts.advertiserId?.trim() ||
    advertiserIdFromTransparencyUrl(opts.transparencyUrl) ||
    advertiserIdFromTransparencyUrl(opts.url);
  if (adv) return `adv:${adv.toLowerCase()}`;

  const host = displayHostFromUrl(opts.url ?? '').toLowerCase();
  if (host && !/adstransparency\.google\.com$/i.test(host) && host !== 'competitor.com') {
    return `host:${host}`;
  }

  const name = (opts.name ?? '').trim().toLowerCase();
  return name ? `name:${name}` : `url:${(opts.url ?? '').toLowerCase()}`;
}

function sameCompetitor(
  a: { name?: string; url?: string; advertiserId?: string; transparencyUrl?: string; advertiserName?: string },
  b: { name?: string; url?: string; advertiserId?: string; transparencyUrl?: string; advertiserName?: string }
): boolean {
  return (
    competitorIdentityKey({
      name: a.advertiserName ?? a.name,
      url: a.url,
      advertiserId: a.advertiserId,
      transparencyUrl: a.transparencyUrl,
    }) ===
    competitorIdentityKey({
      name: b.advertiserName ?? b.name,
      url: b.url,
      advertiserId: b.advertiserId,
      transparencyUrl: b.transparencyUrl,
    })
  );
}

/** Prefer real SociaVault stats — never let an explicit 0 hide a positive library value. */
function preferLibraryStat(primary?: number, fallback?: number): number | undefined {
  if (primary != null && primary > 0) return primary;
  if (fallback != null && fallback > 0) return fallback;
  return primary ?? fallback;
}

function preferDate(a?: string, b?: string, prefer: 'earliest' | 'latest' = 'earliest'): string | undefined {
  if (a && b) {
    const ta = Date.parse(a);
    const tb = Date.parse(b);
    if (Number.isFinite(ta) && Number.isFinite(tb)) {
      return prefer === 'earliest' ? (ta <= tb ? a : b) : ta >= tb ? a : b;
    }
  }
  return a || b || undefined;
}

function siteDomainKey(url: string): string {
  return displayHostFromUrl(url).toLowerCase();
}

function rsaHeadlinesFromProfile(c: CompetitorProfile): string[] {
  const pool = [...c.headlines, ...c.keyMessages]
    .map((h) => h.trim().slice(0, 30))
    .filter(Boolean);
  const unique: string[] = [];
  for (const h of pool) {
    if (!unique.includes(h)) unique.push(h);
    if (unique.length >= 5) break;
  }
  return unique;
}

function rsaDescriptionsFromProfile(c: CompetitorProfile): string[] {
  const pool = [
    c.positioning,
    ...c.descriptions,
    ...c.valuePropositions,
    c.offers[0] ? `${c.name}: ${c.offers[0]}` : '',
  ]
    .filter((d): d is string => Boolean(d?.trim()))
    .map((d) => d.trim().slice(0, 90));
  const unique: string[] = [];
  for (const d of pool) {
    if (!unique.includes(d)) unique.push(d);
    if (unique.length >= 2) break;
  }
  return unique;
}

function isSyntheticAdCopy(
  headlines: string[] | undefined,
  descriptions: string[] | undefined,
  name?: string
): boolean {
  const hs = (headlines ?? []).map((h) => h.trim()).filter(Boolean);
  const ds = (descriptions ?? []).map((d) => d.trim()).filter(Boolean);
  if (!hs.length && !ds.length) return true;
  if (hs.some((h) => /—\s*shop now$/i.test(h))) return true;
  if (ds.some((d) => /^visit .+ for quality service/i.test(d))) return true;
  const nameNorm = (name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (nameNorm.length >= 8 && hs.length && !ds.length) {
    return hs.every((h) => {
      const hn = h.toLowerCase().replace(/[^a-z0-9]+/g, '');
      return !hn || nameNorm.includes(hn) || hn.includes(nameNorm.slice(0, 10));
    });
  }
  return false;
}

const MIN_COMPETITORS = 4;

function normalizeAdCopyKey(g: CompetitorAdPreview): string {
  return [...(g.headlines ?? []), ...(g.descriptions ?? [])]
    .map((s) => s.toLowerCase().replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('|')
    .slice(0, 220);
}

function galleryDedupeKey(g: CompetitorAdPreview): string {
  const copy = normalizeAdCopyKey(g);
  if (copy.length >= 24) {
    const host = (g.displayUrl ?? g.url ?? g.destinationUrl ?? '')
      .replace(/^https?:\/\//, '')
      .split('/')[0]
      ?.toLowerCase()
      .replace(/^www\./, '') ?? '';
    return `copy:${host}:${copy}`;
  }
  const creative = (g.creativeUrl ?? g.adLink ?? '').toLowerCase().trim();
  if (creative) return `creative:${creative}`;
  return competitorIdentityKey({
    name: g.advertiserName ?? g.name,
    url: g.url || g.displayUrl,
    advertiserId: g.advertiserId,
    transparencyUrl: g.transparencyUrl,
  });
}

function dedupeAdGallery(gallery: CompetitorAdPreview[]): CompetitorAdPreview[] {
  const out: CompetitorAdPreview[] = [];
  const seen = new Set<string>();
  for (const entry of gallery) {
    const key = galleryDedupeKey(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  return out;
}

function profileToGalleryPreview(
  profile: CompetitorProfile,
  target: { name: string; url: string }
): CompetitorAdPreview {
  const headlines = decodeHtmlEntitiesList(rsaHeadlinesFromProfile(profile));
  const descriptions = decodeHtmlEntitiesList(rsaDescriptionsFromProfile(profile));
  const brandReview = profile.brandReview ?? buildBrandReview(profile);
  return {
    name: target.name,
    url: target.url,
    displayUrl: displayHostFromUrl(target.url),
    headlines,
    descriptions,
    offers: profile.offers.slice(0, 4),
    ctas: profile.ctas.slice(0, 4),
    trustSignals: profile.trustSignals.slice(0, 4),
    advertiserName: target.name,
    advertiserId: profile.advertiserId,
    adSource: 'website_fallback',
    syntheticCopy: isSyntheticAdCopy(headlines, descriptions, target.name),
    adDurationDays: profile.adDurationDays ?? 0,
    activeAdCount: profile.activeAdCount ?? 0,
    totalAdCount: profile.totalAdCount ?? 0,
    firstShown: profile.firstShown,
    lastShown: profile.lastShown,
    brandReview,
    confidenceScore: profile.confidenceScore,
    influencePercent: profile.influencePercent,
    durationClass: profile.durationClass,
    durationLabel: profile.durationLabel,
    brandAuthorityScore: profile.brandAuthorityScore,
    socialPresence: profile.socialPresence,
    brandAuthority: profile.brandAuthority,
    advertisingStrength: profile.advertisingStrength,
    marketAuthority: profile.marketAuthority,
    offerTrustAnalysis: profile.offerTrustAnalysis,
    aiLearning: profile.aiLearning,
    advertisingScore: profile.advertisingScore,
    aiLearningValue: profile.aiLearningValue,
    marketPosition: profile.marketPosition,
    competitiveThreat: profile.competitiveThreat,
  };
}

/** Keep every gallery row populated with the same section payloads the Engine tabs render. */
function attachProfileSectionsToGallery(
  g: CompetitorAdPreview,
  profile: CompetitorProfile
): CompetitorAdPreview {
  return {
    ...g,
    advertiserId: g.advertiserId || profile.advertiserId,
    confidenceScore: profile.confidenceScore ?? g.confidenceScore,
    influencePercent: profile.influencePercent ?? g.influencePercent,
    durationClass: profile.durationClass ?? g.durationClass,
    durationLabel: profile.durationLabel ?? g.durationLabel,
    industryMatch: profile.industryMatch ?? g.industryMatch,
    serviceMatch: profile.serviceMatch ?? g.serviceMatch,
    brandReview: profile.brandReview ?? g.brandReview,
    adDurationDays: preferLibraryStat(profile.adDurationDays, g.adDurationDays) ?? g.adDurationDays,
    activeAdCount: preferLibraryStat(profile.activeAdCount, g.activeAdCount) ?? g.activeAdCount,
    totalAdCount: preferLibraryStat(profile.totalAdCount, g.totalAdCount) ?? g.totalAdCount,
    firstShown: preferDate(profile.firstShown, g.firstShown, 'earliest'),
    lastShown: preferDate(profile.lastShown, g.lastShown, 'latest'),
    brandAuthorityScore: profile.brandAuthorityScore ?? g.brandAuthorityScore,
    socialPresence: profile.socialPresence ?? g.socialPresence,
    brandAuthority: profile.brandAuthority ?? g.brandAuthority,
    advertisingStrength: profile.advertisingStrength ?? g.advertisingStrength,
    marketAuthority: profile.marketAuthority ?? g.marketAuthority,
    offerTrustAnalysis: profile.offerTrustAnalysis ?? g.offerTrustAnalysis,
    aiLearning: profile.aiLearning ?? g.aiLearning,
    advertisingScore: profile.advertisingScore ?? g.advertisingScore,
    aiLearningValue: profile.aiLearningValue ?? g.aiLearningValue,
    marketPosition: profile.marketPosition ?? g.marketPosition,
    competitiveThreat: profile.competitiveThreat ?? g.competitiveThreat,
    headlines: g.headlines?.length ? g.headlines : decodeHtmlEntitiesList(rsaHeadlinesFromProfile(profile)),
    descriptions: g.descriptions?.length
      ? g.descriptions
      : decodeHtmlEntitiesList(rsaDescriptionsFromProfile(profile)),
    offers: g.offers?.length ? g.offers : profile.offers.slice(0, 4),
    trustSignals: g.trustSignals?.length ? g.trustSignals : profile.trustSignals.slice(0, 4),
  };
}

function ensureGalleryHasSectionIntelligence(
  gallery: CompetitorAdPreview[],
  competitors: CompetitorProfile[]
): CompetitorAdPreview[] {
  return gallery.map((g) => {
    const profile = competitors.find((p) => sameCompetitor(p, g));
    if (profile) return attachProfileSectionsToGallery(g, profile);

    // Orphan gallery row — still derive Brand / Ads / Offers / Market / Learning so tabs aren't empty
    if (g.brandAuthority && g.offerTrustAnalysis && g.aiLearning && g.marketAuthority) return g;
    const brandReview = g.brandReview;
    const bundle = buildBrandAuthorityBundle({
      adDurationDays: g.adDurationDays,
      activeAdCount: g.activeAdCount,
      totalAdCount: g.totalAdCount,
      brandReviewScore: brandReview?.score,
      trustScore: brandReview?.trustScore ?? brandReview?.score,
      employeeCount: g.socialPresence?.employeeCount,
      linkedInFollowers: g.socialPresence?.linkedInFollowers,
      facebookFollowers: g.socialPresence?.facebookFollowers,
      instagramFollowers: g.socialPresence?.instagramFollowers,
      youtubeSubscribers: g.socialPresence?.youtubeSubscribers,
      tiktokFollowers: g.socialPresence?.tiktokFollowers,
      twitterFollowers: g.socialPresence?.twitterFollowers,
      offers: g.offers,
      trustSignals: g.trustSignals,
      valuePropositions: [],
      headlines: g.headlines,
      descriptions: g.descriptions,
      confidenceScore: g.confidenceScore,
    });
    return {
      ...g,
      brandAuthorityScore: bundle.brandAuthority.brandAuthorityScore,
      socialPresence: {
        brandAuthorityScore: bundle.brandAuthority.brandAuthorityScore,
        ...(g.socialPresence ?? {}),
        ...bundle.socialPresence,
        profileUrls: g.socialPresence?.profileUrls,
        source: g.socialPresence?.source ?? bundle.socialPresence.source,
      },
      brandAuthority: g.brandAuthority ?? bundle.brandAuthority,
      advertisingStrength: g.advertisingStrength ?? bundle.advertisingStrength,
      marketAuthority: g.marketAuthority ?? bundle.marketAuthority,
      offerTrustAnalysis: g.offerTrustAnalysis ?? bundle.offerTrustSocialProof,
      aiLearning: g.aiLearning
        ? g.aiLearning
        : {
            ...bundle.aiLearning,
            influencePercent: g.influencePercent ?? 0,
            competitorScore: g.confidenceScore ?? bundle.aiLearning.competitorScore,
          },
      advertisingScore: g.advertisingScore ?? bundle.advertisingStrength.advertisingScore,
      aiLearningValue: g.aiLearningValue ?? bundle.aiLearning.aiLearningValue,
      marketPosition: g.marketPosition ?? bundle.brandAuthority.marketPosition,
      competitiveThreat: g.competitiveThreat ?? bundle.brandAuthority.competitiveThreat,
    };
  });
}

function ensureMinimumAdGallery(
  gallery: CompetitorAdPreview[],
  competitors: CompetitorProfile[],
  targets: Array<{ name: string; url: string; advertiserId?: string }>,
  min = MIN_COMPETITORS
): CompetitorAdPreview[] {
  const out = dedupeAdGallery(gallery);
  const seenKeys = new Set(out.map(galleryDedupeKey));

  for (let i = 0; i < competitors.length && out.length < min; i++) {
    const profile = competitors[i]!;
    const target = targets[i] ?? { name: profile.name, url: profile.url };
    const identity = competitorIdentityKey({
      name: target.name,
      url: target.url,
      advertiserId: target.advertiserId,
    });
    if (seenKeys.has(identity) || seenKeys.has(galleryDedupeKey({ name: target.name, url: target.url, displayUrl: target.url } as CompetitorAdPreview))) {
      continue;
    }
    const fallback = profileToGalleryPreview(profile, target);
    if (!fallback.headlines.length && !fallback.descriptions.length) continue;
    out.push(fallback);
    seenKeys.add(galleryDedupeKey(fallback));
  }

  return out;
}

function buildInsightKeyMessages(profile: CompetitorProfile): string[] {
  const pool = [
    ...profile.keyMessages,
    ...profile.headlines,
    ...profile.descriptions,
    ...profile.valuePropositions,
    ...(profile.positioning ? [profile.positioning] : []),
    ...profile.offers,
  ]
    .map((s) => decodeHtmlEntities(s).trim())
    .filter(Boolean);
  return [...new Set(pool)].slice(0, 6);
}

function enrichInsightSummary(
  insight: CompetitorInsightSummary,
  profile: CompetitorProfile | undefined,
  galleryMatch: CompetitorAdPreview | undefined
): CompetitorInsightSummary {
  const fromGallery = [
    ...(galleryMatch?.headlines ?? []),
    ...(galleryMatch?.descriptions ?? []),
  ].map((s) => decodeHtmlEntities(s).trim()).filter(Boolean);

  const fromProfile = profile ? buildInsightKeyMessages(profile) : [];
  const keyMessages = [...new Set([...fromGallery, ...insight.keyMessages, ...fromProfile])].slice(0, 6);

  const offers = [...new Set([
    ...insight.offers,
    ...(profile?.offers ?? []),
    ...(galleryMatch?.offers ?? []),
  ])].slice(0, 6);

  const keywordOpportunities = [...new Set([
    ...insight.keywordOpportunities,
    ...(profile?.keywords ?? []),
  ])].slice(0, 8);

  return {
    name: insight.name,
    url: insight.url || profile?.url || galleryMatch?.url || '',
    keyMessages,
    offers,
    keywordOpportunities,
    adDurationDays: preferLibraryStat(profile?.adDurationDays, galleryMatch?.adDurationDays),
    activeAdCount: preferLibraryStat(profile?.activeAdCount, galleryMatch?.activeAdCount),
    totalAdCount: preferLibraryStat(profile?.totalAdCount, galleryMatch?.totalAdCount),
    firstShown: preferDate(profile?.firstShown, galleryMatch?.firstShown, 'earliest'),
    lastShown: preferDate(profile?.lastShown, galleryMatch?.lastShown, 'latest'),
    brandReview: profile?.brandReview ?? galleryMatch?.brandReview,
    confidenceScore: preferLibraryStat(profile?.confidenceScore, galleryMatch?.confidenceScore),
    influencePercent: preferLibraryStat(profile?.influencePercent, galleryMatch?.influencePercent),
    durationLabel: profile?.durationLabel || galleryMatch?.durationLabel,
    advertiserId:
      profile?.advertiserId ||
      galleryMatch?.advertiserId ||
      advertiserIdFromTransparencyUrl(galleryMatch?.transparencyUrl),
  };
}

function formatDateLabel(iso?: string): string {
  if (!iso) return 'unknown';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function buildBrandReview(
  profile: CompetitorProfile,
  activity?: {
    adDurationDays?: number;
    activeAdCount?: number;
    totalAdCount?: number;
    avgCreativeDurationDays?: number;
    firstShown?: string;
    lastShown?: string;
  }
): CompetitorBrandReview {
  const strengths: string[] = [];
  const weaknesses: string[] = [];
  const howToBeat: string[] = [];
  let score = 35;

  const duration = activity?.adDurationDays ?? profile.adDurationDays ?? 0;
  const active = activity?.activeAdCount ?? profile.activeAdCount ?? 0;
  const total = activity?.totalAdCount ?? profile.totalAdCount ?? 0;
  const avgCreative = activity?.avgCreativeDurationDays ?? 0;
  const firstShown = activity?.firstShown ?? profile.firstShown;
  const lastShown = activity?.lastShown ?? profile.lastShown;

  // --- Ad duration scoring ---
  if (duration >= 180) {
    score += 22;
    strengths.push(
      `Ad duration: ${duration} days of Google Ads history (first shown ${formatDateLabel(firstShown)} → last shown ${formatDateLabel(lastShown)}) — proven long-term advertiser`
    );
  } else if (duration >= 60) {
    score += 14;
    strengths.push(
      `Ad duration: ${duration} days on Transparency Center (from ${formatDateLabel(firstShown)} to ${formatDateLabel(lastShown)}) — established presence`
    );
  } else if (duration >= 21) {
    score += 7;
    strengths.push(`Ad duration: ${duration} days of campaign history — worth studying recent creatives`);
  } else if (duration > 0) {
    score += 2;
    weaknesses.push(
      `Short ad duration (${duration} days only) — messaging may still be experimental`
    );
  } else {
    weaknesses.push('Ad duration unavailable — limited Transparency Center history');
  }

  // --- Active ads scoring ---
  if (active >= 8) {
    score += 16;
    strengths.push(
      `Active ads: ${active} creatives with lastShown in the last ~45 days — heavy testing / rotation`
    );
  } else if (active >= 4) {
    score += 11;
    strengths.push(`Active ads: ${active} recently active creatives — solid A/B testing signal`);
  } else if (active >= 2) {
    score += 6;
    strengths.push(`Active ads: ${active} creatives currently/recently running`);
  } else if (active === 1) {
    score += 2;
    weaknesses.push('Active ads: only 1 creative recently active — limited angle diversity');
  } else {
    weaknesses.push('Active ads: none detected in the last ~45 days');
  }

  // --- Total ads scoring ---
  if (total >= 10) {
    score += 8;
    strengths.push(`Total ads: ${total} creatives in the Google Ads library — deep creative archive`);
  } else if (total >= 5) {
    score += 5;
    strengths.push(`Total ads: ${total} creatives in library — enough history to spot patterns`);
  } else if (total >= 2) {
    score += 2;
    strengths.push(`Total ads: ${total} creatives found in library`);
  } else if (total === 1) {
    weaknesses.push('Total ads: only 1 creative in library — thin competitive sample');
  } else {
    weaknesses.push('Total ads: no creatives returned from SociaVault library');
  }

  if (avgCreative >= 30) {
    score += 8;
    strengths.push(
      `Average creative lifespan ~${avgCreative} days — messaging that stays live longer tends to convert`
    );
  } else if (avgCreative > 0 && avgCreative < 14) {
    weaknesses.push(`Creatives turn over quickly (avg ~${avgCreative} days) — may be still testing`);
  }

  // --- Trust ---
  let trustReview: string;
  if (profile.trustSignals.length >= 3) {
    score += 10;
    strengths.push(`Trust signals: ${profile.trustSignals.slice(0, 3).join('; ')}`);
    trustReview = `${profile.name} leans on proof points such as ${profile.trustSignals.slice(0, 4).join(', ')}. Mirror comparable credibility in your ads (reviews, years, certifications) without copying their wording.`;
  } else if (profile.trustSignals.length) {
    score += 5;
    strengths.push(`Trust cue: ${profile.trustSignals[0]}`);
    trustReview = `${profile.name} shows limited trust cues (${profile.trustSignals.join(', ')}). You can win by stacking stronger proof — ratings, guarantees, or local credentials — in headlines and descriptions.`;
  } else {
    weaknesses.push('Weak public trust signals on site/ads');
    trustReview = `${profile.name} does not prominently display trust or social proof. This is a clear opening: lead with reviews, guarantees, licenses, or “trusted by” claims they omit.`;
    howToBeat.push('Add a concrete trust/proof headline they lack (reviews, years, guarantee)');
  }

  // --- Offers ---
  let offerReview: string;
  if (profile.offers.length >= 2) {
    score += 8;
    strengths.push(`Offers: ${profile.offers.slice(0, 3).join('; ')}`);
    offerReview = `${profile.name} promotes offers like “${profile.offers.slice(0, 3).join('”, “')}”. Match the commercial intent but differentiate with a sharper deal, urgency, or bundled value.`;
    howToBeat.push(`Counter their offer angle (“${profile.offers[0]}”) with a clearer or stronger value prop`);
  } else if (profile.offers.length === 1) {
    score += 4;
    strengths.push(`Offer: ${profile.offers[0]}`);
    offerReview = `${profile.name} leans on a single offer (“${profile.offers[0]}”). Expand beyond that one hook with complementary benefits or a stronger CTA.`;
    howToBeat.push(`Outshine their single offer (“${profile.offers[0]}”) with a more specific benefit`);
  } else {
    weaknesses.push('Offers not prominent — opportunity to lead with value');
    offerReview = `${profile.name} does not push clear promotional offers in visible copy. Lead with a concrete offer, discount, free consult, or outcome-based promise.`;
    howToBeat.push('Lead with a concrete offer or outcome they do not advertise');
  }

  // --- Messaging ---
  const messageSamples = [
    ...profile.headlines.slice(0, 3),
    ...profile.keyMessages.slice(0, 2),
  ].filter(Boolean);
  let messagingReview: string;
  if (messageSamples.length >= 3) {
    score += 6;
    strengths.push(`Messaging themes: ${messageSamples.slice(0, 2).join(' · ')}`);
    messagingReview = `${profile.name}’s dominant themes include “${messageSamples.slice(0, 3).join('”, “')}”. Study these as the baseline, then rewrite with clearer benefits, stronger CTAs, and brand-specific proof so your RSA does not sound generic.`;
    howToBeat.push(`Rewrite their theme “${messageSamples[0]}” with a more specific benefit + proof`);
  } else if (messageSamples.length) {
    score += 3;
    messagingReview = `${profile.name} uses limited messaging (“${messageSamples.join('”, “')}”). You can occupy more keyword and benefit angles they leave open.`;
    howToBeat.push('Cover benefit/keyword angles their thin messaging leaves open');
  } else {
    weaknesses.push('Thin messaging — easier to out-position with sharper copy');
    messagingReview = `${profile.name} has thin public ad/site messaging. Own the category with specific service + location + outcome headlines.`;
    howToBeat.push('Own specific service + outcome headlines they have not claimed');
  }

  if (profile.ctas.length) {
    strengths.push(`CTA patterns: ${profile.ctas.slice(0, 3).join(', ')}`);
    howToBeat.push(`Use a stronger CTA than “${profile.ctas[0]}” (urgency or next-step clarity)`);
  }

  if (profile.services.length) {
    strengths.push(`Services emphasized: ${profile.services.slice(0, 3).join(', ')}`);
  }

  score = Math.max(10, Math.min(98, score));

  const adActivityReview =
    `Ad duration: ${duration > 0 ? `${duration} days` : 'not available'} ` +
    `(earliest first shown → latest last shown` +
    `${firstShown || lastShown ? `: ${formatDateLabel(firstShown)} → ${formatDateLabel(lastShown)}` : ''}). ` +
    `Active ads: ${active} creative${active === 1 ? '' : 's'} with lastShown in the last ~45 days. ` +
    `Total ads: ${total} creative${total === 1 ? '' : 's'} in the Google Ads Transparency library` +
    `${avgCreative > 0 ? ` (avg creative lifespan ~${avgCreative} days)` : ''}.`;

  const durationLabel = duration > 0 ? `${duration}d` : 'n/a';
  const summary =
    score >= 75
      ? `${profile.name}: strong ad-copy benchmark — ${durationLabel} duration, ${active} active / ${total} total ads, brand score ${score}/100.`
      : score >= 55
        ? `${profile.name}: useful competitor — ${durationLabel} duration, ${active} active / ${total} total ads, brand score ${score}/100.`
        : `${profile.name}: lighter signal — ${durationLabel} duration, ${active} active / ${total} total ads, brand score ${score}/100.`;

  const detailedReview = [
    `${profile.name} brand review (score ${score}/100).`,
    adActivityReview,
    messagingReview,
    trustReview,
    offerReview,
    howToBeat.length
      ? `How to beat them in ad copy: ${howToBeat.slice(0, 4).map((h, i) => `${i + 1}) ${h}`).join(' ')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  // Do not invent Google ratings / review counts — only real library-backed narratives
  const hasLibrary = total > 0 || duration > 0;
  const sentiment: CompetitorBrandReview['sentiment'] = !hasLibrary
    ? 'Unknown'
    : score >= 75
      ? 'Highly Positive'
      : score >= 55
        ? 'Positive'
        : score >= 40
          ? 'Mixed'
          : 'Negative';

  const reviewVelocity =
    active >= 8
      ? 'High — frequent creative rotations'
      : active >= 3
        ? 'Steady — regular ad testing'
        : active >= 1
          ? 'Light — limited recent creative changes'
          : 'Low — little recent ad activity';

  return {
    score,
    summary,
    detailedReview,
    adActivityReview,
    messagingReview,
    trustReview,
    offerReview,
    howToBeat: howToBeat.slice(0, 5),
    strengths: strengths.slice(0, 8),
    weaknesses: weaknesses.slice(0, 6),
    trustScore: score,
    sentiment,
    positiveThemes: strengths.slice(0, 4).map((s) => s.replace(/^[^:]+:\s*/, '').slice(0, 80)),
    negativeThemes: weaknesses.slice(0, 3).map((w) => w.slice(0, 80)),
    reviewVelocity,
  };
}

/**
 * Deepen each competitor's brand review with a technical Claude analysis.
 * Keeps rule-based metrics; expands narrative sections.
 */
async function enrichBrandReviewsWithClaude(
  competitors: CompetitorProfile[],
  gallery: CompetitorAdPreview[]
): Promise<CompetitorProfile[]> {
  if (!competitors.length) return competitors;

  const payload = competitors.slice(0, 4).map((c) => {
    const g = gallery.find((x) => sameCompetitor(x, c));
    return {
      name: c.name,
      url: c.url,
      adDurationDays: preferLibraryStat(c.adDurationDays, g?.adDurationDays) ?? 0,
      activeAdCount: preferLibraryStat(c.activeAdCount, g?.activeAdCount) ?? 0,
      totalAdCount: preferLibraryStat(c.totalAdCount, g?.totalAdCount) ?? 0,
      firstShown: preferDate(c.firstShown, g?.firstShown, 'earliest'),
      lastShown: preferDate(c.lastShown, g?.lastShown, 'latest'),
      headlines: (g?.headlines?.length ? g.headlines : c.headlines).slice(0, 8),
      descriptions: (g?.descriptions?.length ? g.descriptions : c.descriptions).slice(0, 4),
      offers: c.offers.slice(0, 6),
      services: c.services.slice(0, 6),
      trustSignals: c.trustSignals.slice(0, 6),
      ctas: c.ctas.slice(0, 4),
      positioning: c.positioning,
      existingScore: c.brandReview?.score ?? 35,
    };
  });

  try {
    const response = await withTimeout(
      createClaudeMessage({
        max_tokens: 3500,
        messages: [
          {
            role: 'user',
            content: `You are a senior Google Ads competitive strategist. Write a TECHNICAL brand review for EACH competitor below for RSA ad-copy optimization.

For every competitor return:
- score (0-100 integer) — weight SociaVault ad duration, active ads, total ads, messaging clarity, trust, offers
- summary (1 sentence verdict naming THIS competitor only)
- detailedReview (3-5 sentences: who they are, how they advertise, what their brand stands for technically)
- adActivityReview (explicitly mention Ad duration days, Active ads count, Total ads count, and what that implies for creative testing)
- messagingReview (analyze their headlines/descriptions patterns, keywords, CTA style)
- trustReview (proof points / gaps)
- offerReview (commercial hooks / gaps)
- howToBeat (array of 3-5 specific RSA tactics to outrank them)
- strengths (array of 4-6 specific strengths)
- weaknesses (array of 3-5 specific gaps)

Rules:
- Use the EXACT competitor name from the input for that competitor — never swap names across cards
- Be specific and technical (RSA angles, proof, offers, keyword themes) — no generic filler
- If adDurationDays/activeAdCount/totalAdCount are 0, say Transparency data was limited and review from site/messaging instead

Return ONLY JSON:
{"reviews":[{"name":"...","score":0,"summary":"...","detailedReview":"...","adActivityReview":"...","messagingReview":"...","trustReview":"...","offerReview":"...","howToBeat":["..."],"strengths":["..."],"weaknesses":["..."]}]}

Competitors:
${JSON.stringify(payload)}`,
          },
        ],
      }),
      45_000,
      'brand-review-enrichment'
    );

    const block = response.content[0];
    if (block.type !== 'text') return competitors;
    const parsed = extractJsonFromClaudeText(block.text) as {
      reviews?: Array<{
        name?: string;
        score?: number;
        summary?: string;
        detailedReview?: string;
        adActivityReview?: string;
        messagingReview?: string;
        trustReview?: string;
        offerReview?: string;
        howToBeat?: string[];
        strengths?: string[];
        weaknesses?: string[];
      }>;
    };

    const byName = new Map(
      (parsed.reviews ?? [])
        .filter((r) => r.name)
        .map((r) => [String(r.name).toLowerCase(), r])
    );

    return competitors.map((c) => {
      const r = byName.get(c.name.toLowerCase());
      if (!r) return c;

      const base = c.brandReview ?? buildBrandReview(c);
      const enriched: CompetitorBrandReview = {
        score: typeof r.score === 'number' ? Math.max(10, Math.min(98, Math.round(r.score))) : base.score,
        summary: (r.summary?.trim() || base.summary).replace(/\bMoney Lender Australia\b/gi, c.name),
        detailedReview: r.detailedReview?.trim() || base.detailedReview,
        adActivityReview: r.adActivityReview?.trim() || base.adActivityReview,
        messagingReview: r.messagingReview?.trim() || base.messagingReview,
        trustReview: r.trustReview?.trim() || base.trustReview,
        offerReview: r.offerReview?.trim() || base.offerReview,
        howToBeat: (r.howToBeat?.length ? r.howToBeat : base.howToBeat).slice(0, 6),
        strengths: (r.strengths?.length ? r.strengths : base.strengths).slice(0, 8),
        weaknesses: (r.weaknesses?.length ? r.weaknesses : base.weaknesses).slice(0, 6),
      };
      // Ensure summary names this competitor
      if (!enriched.summary.toLowerCase().includes(c.name.toLowerCase().slice(0, 8))) {
        enriched.summary = `${c.name}: ${enriched.summary}`;
      }
      return { ...c, brandReview: enriched };
    });
  } catch (err) {
    console.warn('[competitors] brand review enrichment failed:', err instanceof Error ? err.message : err);
    return competitors;
  }
}

/** Fetch SociaVault ads for insight competitors missing from the gallery. */
export async function enrichAdGalleryFromInsights(
  insights: Array<{ name: string; url?: string }>,
  country: string | undefined,
  existing: CompetitorAdPreview[]
): Promise<CompetitorAdPreview[]> {
  const out = [...existing];
  const seen = new Set(
    existing.map((g) => (g.creativeUrl ?? g.adLink ?? g.url).toLowerCase())
  );
  const seenNames = new Set(existing.map((g) => g.name.toLowerCase()));

  for (const insight of insights) {
    const rawUrl = insight.url?.trim();
    if (!rawUrl) continue;
    const url = normalizeUrl(rawUrl);
    const dedupeKey = url.toLowerCase();
    if (seen.has(dedupeKey) || seenNames.has(insight.name.toLowerCase())) continue;

    const profile = profileFromWebsite(insight.name, url, null);
    const result = await fetchCompetitorGalleryForTarget(
      { name: insight.name, url },
      country,
      profile
    );
    if (result?.preview) {
      out.push(result.preview);
      seen.add((result.preview.creativeUrl ?? result.preview.adLink ?? url).toLowerCase());
      seenNames.add(insight.name.toLowerCase());
    }
  }

  return out;
}

function buildAdGallery(
  transparencyByUrl: Map<string, CompetitorAdPreview>,
  extraAdsByUrl?: Map<string, CompetitorAdPreview[]>
): CompetitorAdPreview[] {
  const out: CompetitorAdPreview[] = [];
  const seenUrls = new Set<string>();
  for (const [url, extras] of extraAdsByUrl ?? []) {
    seenUrls.add(url.toLowerCase());
    out.push(...extras);
  }
  for (const [url, preview] of transparencyByUrl) {
    if (seenUrls.has(url.toLowerCase())) continue;
    out.push(preview);
  }
  return out.filter(
    (c) => c.adSource === 'sociavault' || c.adSource === 'transparency_center'
  );
}

function storeGalleryFetchResult(
  targetUrl: string,
  result: {
    preview: CompetitorAdPreview;
    profile: CompetitorProfile;
    allPreviews?: CompetitorAdPreview[];
  },
  transparencyByUrl: Map<string, CompetitorAdPreview>,
  extraAdsByUrl: Map<string, CompetitorAdPreview[]>
): void {
  const key = targetUrl.toLowerCase();
  transparencyByUrl.set(key, result.preview);
  if (result.allPreviews?.length) {
    extraAdsByUrl.set(key, result.allPreviews);
  }
}

async function applyLlmRelevanceToFetchedAds(opts: {
  extraAdsByUrl: Map<string, CompetitorAdPreview[]>;
  transparencyByUrl: Map<string, CompetitorAdPreview>;
  service: string;
  keywords: string[];
}): Promise<boolean> {
  const items: Array<{ id: string; preview: CompetitorAdPreview; urlKey?: string }> = [];
  const seen = new Set<CompetitorAdPreview>();
  let i = 0;

  const push = (preview: CompetitorAdPreview, urlKey?: string) => {
    if (seen.has(preview)) return;
    if (
      preview.syntheticCopy ||
      isSyntheticAdCopy(preview.headlines, preview.descriptions, preview.name)
    ) {
      return;
    }
    seen.add(preview);
    items.push({ id: `ad${i++}`, preview, urlKey });
  };

  for (const [url, extras] of opts.extraAdsByUrl) {
    for (const preview of extras) push(preview, url);
  }
  for (const [url, preview] of opts.transparencyByUrl) {
    push(preview, url);
  }

  if (!items.length) return false;

  const payload: AdRelevanceInput[] = items.map((item) => ({
    id: item.id,
    advertiser: item.preview.advertiserName ?? item.preview.name,
    headlines: item.preview.headlines ?? [],
    descriptions: item.preview.descriptions ?? [],
  }));

  const scores = await scoreAdsForKeywordRelevance(payload, {
    service: opts.service,
    keywords: opts.keywords,
  });

  let keptCount = 0;
  for (const item of items) {
    const row = scores.get(item.id);
    const keep = isAdRelevant(row, false);
    if (row) item.preview.keywordRelevanceScore = row.score;
    if (keep) keptCount += 1;
  }

  if (!keptCount) {
    console.warn(
      `[CompetitorIntel] LLM marked 0/${items.length} ads relevant — dropping off-service creatives`
    );
    opts.extraAdsByUrl.clear();
    opts.transparencyByUrl.clear();
    return true;
  }

  for (const [url, extras] of [...opts.extraAdsByUrl.entries()]) {
    const kept = extras.filter((preview) => {
      const item = items.find((x) => x.preview === preview);
      return item ? isAdRelevant(scores.get(item.id), false) : false;
    });
    if (kept.length) opts.extraAdsByUrl.set(url, kept);
    else opts.extraAdsByUrl.delete(url);
  }

  for (const [url, preview] of [...opts.transparencyByUrl.entries()]) {
    const item = items.find((x) => x.preview === preview);
    if (item && !isAdRelevant(scores.get(item.id), false)) {
      const extras = opts.extraAdsByUrl.get(url);
      if (extras?.[0]) opts.transparencyByUrl.set(url, extras[0]!);
      else opts.transparencyByUrl.delete(url);
    }
  }

  console.log(
    `[CompetitorIntel] LLM relevance kept ${keptCount}/${items.length} ads for "${opts.service}"`
  );
  return true;
}

function buildGapAnalysis(
  competitors: CompetitorProfile[],
  client: {
    headlines: string[];
    descriptions: string[];
    offers: string[];
    ctas: string[];
    trustSignals: string[];
    keywords: string[];
  }
): CompetitorGapAnalysis {
  const rows: CompetitorGapRow[] = [];
  const clientText = [
    ...client.headlines,
    ...client.descriptions,
    ...client.offers,
  ].join(' ').toLowerCase();

  const hasClient = (needle: string) => {
    const n = needle.toLowerCase().slice(0, 12);
    return n.length > 3 && clientText.includes(n);
  };

  for (const c of competitors) {
    for (const msg of c.keyMessages.slice(0, 3)) {
      if (!hasClient(msg)) {
        rows.push({
          category: 'messaging',
          competitor: c.name,
          competitorHas: msg,
          youHave: client.headlines[0] ?? '—',
          gap: 'Competitor leads with messaging your ads do not emphasize',
        });
      }
    }
    for (const offer of c.offers.slice(0, 3)) {
      if (!client.offers.some((o) => o.toLowerCase().includes(offer.toLowerCase().slice(0, 15)))) {
        rows.push({
          category: 'offers',
          competitor: c.name,
          competitorHas: offer,
          youHave: client.offers[0] ?? 'Not promoted in ads',
          gap: 'Offer gap — competitor promotes this prominently',
        });
      }
    }
    for (const kw of c.keywords.slice(0, 4)) {
      if (!client.keywords.includes(kw)) {
        rows.push({
          category: 'keywords',
          competitor: c.name,
          competitorHas: kw,
          youHave: client.keywords.slice(0, 3).join(', ') || '—',
          gap: 'Keyword theme competitors rank on that you underuse',
        });
      }
    }
    for (const ts of c.trustSignals.slice(0, 3)) {
      if (!client.trustSignals.some((t) => t.toLowerCase().includes(ts.toLowerCase().slice(0, 10)))) {
        rows.push({
          category: 'trust_signals',
          competitor: c.name,
          competitorHas: ts,
          youHave: client.trustSignals[0] ?? 'Not in your ad copy',
          gap: 'Trust signal competitors display that your ads lack',
        });
      }
    }
    for (const cta of c.ctas.slice(0, 3)) {
      if (!client.ctas.some((x) => x.toLowerCase().includes(cta.toLowerCase()))) {
        rows.push({
          category: 'ctas',
          competitor: c.name,
          competitorHas: cta,
          youHave: client.ctas[0] ?? 'Generic CTA',
          gap: 'CTA pattern competitors use to drive clicks',
        });
      }
    }
  }

  const limited = rows.slice(0, 25);
  return {
    rows: limited,
    summary: {
      messagingGaps: limited.filter((r) => r.category === 'messaging').length,
      offerGaps: limited.filter((r) => r.category === 'offers').length,
      keywordGaps: limited.filter((r) => r.category === 'keywords').length,
      trustSignalGaps: limited.filter((r) => r.category === 'trust_signals').length,
      ctaGaps: limited.filter((r) => r.category === 'ctas').length,
    },
  };
}

function descriptionsFromSite(site: WebsiteIntelligence): string[] {
  const out: string[] = [];
  if (site.metaDescription?.trim()) out.push(site.metaDescription.trim().slice(0, 90));
  for (const h of site.headings) {
    if (out.length >= 4) break;
    const d = h.trim().slice(0, 90);
    if (d.length > 24 && !out.includes(d)) out.push(d);
  }
  return out;
}
function extractKeywordsFromSite(site: WebsiteIntelligence): string[] {
  const words = [
    ...site.headings,
    ...site.services,
    ...(site.title ? [site.title] : []),
    ...site.usps,
  ]
    .join(' ')
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w.length > 4);
  return [...new Set(words)].slice(0, 24);
}

function profileFromWebsite(name: string, url: string, site: WebsiteIntelligence | null): CompetitorProfile {
  if (!site?.fetched) {
    return {
      name,
      url,
      fetched: false,
      headlines: [],
      descriptions: [],
      offers: [],
      services: [],
      ctas: [],
      trustSignals: [],
      keywords: [],
      keyMessages: [],
      valuePropositions: [],
      error: site?.error ?? 'Could not fetch',
    };
  }

  const keywords = extractKeywordsFromSite(site);
  const valuePropositions = [
    site.metaDescription,
    ...site.usps.slice(0, 4),
    site.title,
  ].filter((v): v is string => Boolean(v?.trim()));

  const keyMessages = [
    ...site.headings.slice(0, 5),
    ...site.ctas.slice(0, 3),
  ].filter(Boolean);

  return {
    name,
    url,
    fetched: true,
    headlines: site.headings.slice(0, 10),
    descriptions: descriptionsFromSite(site),
    offers: site.offers,
    services: site.services,
    ctas: site.ctas,
    trustSignals: site.trustSignals ?? [],
    keywords,
    keyMessages: [...new Set(keyMessages)].slice(0, 8),
    valuePropositions: [...new Set(valuePropositions)].slice(0, 6),
    positioning: site.metaDescription ?? site.title,
    socialLinks: site.socialLinks && Object.keys(site.socialLinks).length ? site.socialLinks : undefined,
  };
}

async function identifyCompetitorUrls(options: {
  businessName: string;
  websiteUrl?: string;
  industry?: string;
  location?: string;
  productsServices?: string[];
  businessContext: BusinessContext;
  maxCount?: number;
}): Promise<Array<{ name: string; url: string }>> {
  const max = options.maxCount ?? 4;
  const services = (options.productsServices ?? []).filter(Boolean).slice(0, 12).join(', ');
  try {
    const response = await withTimeout(
      createClaudeMessage({
        max_tokens: 768,
        messages: [
          {
            role: 'user',
            content: `Identify up to ${max} direct competitors for Google Ads optimization in the SAME industry, service category, and business scale.
Return ONLY JSON:
{"competitors":[{"name":"Company Name","url":"https://example.com"}]}

Business: ${options.businessName}
Website: ${options.websiteUrl ?? 'unknown'}
Industry: ${options.industry ?? 'general'}
Location/market: ${options.location ?? 'infer from business context'}
Products/services offered: ${services || 'infer from industry and website'}

${businessLevelRulesForPrompt(options.businessContext)}

Rules:
- Competitors MUST sell the same or very similar services to the same customer type at a comparable business level
- Prefer well-known brands that actively run Google Search ads in this market (so Google Ads Transparency / SociaVault can find them)
- Use real company websites (https URLs only) — never invent domains
- Exclude unrelated brands that merely share a word in the name
- Exclude comparison portals, directories, and marketplaces unless the business is also one
- Service overlap is mandatory — a plumber's competitors must offer plumbing, not generic home services portals`,
          },
        ],
      }),
      14_000,
      'competitor-identification'
    );
    const block = response.content[0];
    if (block.type !== 'text') return [];
    const parsed = extractJsonFromClaudeText(block.text) as {
      competitors?: Array<{ name?: string; url?: string }>;
    };
    return (parsed.competitors ?? [])
      .filter((c) => c.url)
      .map((c) => ({
        name: (c.name ?? hostnameToName(String(c.url))).trim(),
        url: normalizeUrl(String(c.url)),
      }))
      .slice(0, max);
  } catch {
    return [];
  }
}

function buildInsightSummaries(competitors: CompetitorProfile[]): CompetitorInsightSummary[] {
  return competitors.map((c) => ({
    name: c.name,
    url: c.url,
    keyMessages: buildInsightKeyMessages(c),
    offers: c.offers.slice(0, 6),
    keywordOpportunities: c.keywords.slice(0, 8),
    adDurationDays: c.adDurationDays,
    activeAdCount: c.activeAdCount,
    totalAdCount: c.totalAdCount,
    firstShown: c.firstShown,
    lastShown: c.lastShown,
    brandReview: c.brandReview,
    advertiserId: c.advertiserId,
  }));
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/\W+/)
      .filter((w) => w.length >= 3)
  );
}

function scoreCompetitorRelevance(
  profile: CompetitorProfile,
  options: {
    industry?: string;
    productsServices?: string[];
    clientKeywords: Set<string>;
    businessContext: BusinessContext;
  }
): number {
  const industryTokens = tokenize(options.industry ?? '');
  const serviceTokens = tokenize((options.productsServices ?? []).join(' '));
  const competitorTokens = tokenize(
    [...profile.services, ...profile.headlines, ...profile.keyMessages, profile.positioning ?? ''].join(' ')
  );

  let overlap = 0;
  for (const t of industryTokens) if (competitorTokens.has(t)) overlap += 2;
  for (const t of serviceTokens) if (competitorTokens.has(t)) overlap += 5;
  for (const t of profile.keywords) if (options.clientKeywords.has(t)) overlap += 1;

  const competitorText = [
    profile.name,
    profile.url,
    ...profile.services,
    ...profile.headlines,
    ...profile.descriptions,
    profile.positioning ?? '',
  ].join(' ');

  // Strong vertical match (car vs home) — short cues like "car" must count
  const services = options.productsServices ?? [];
  if (services.length) {
    const svcScore = scoreServiceTextMatch(competitorText, services);
    overlap += Math.round(svcScore / 5); // 0–20
    if (advertiserConflictsWithService(profile.name, profile.url, services)) overlap -= 40;
    else if (advertiserLikelyMatchesService(profile.name, profile.url, services)) overlap += 18;
  }

  const competitorLevel = inferCompetitorLevelFromText(competitorText, profile.services.length);
  overlap += scoreBusinessLevelMatch(options.businessContext.level, competitorLevel);

  // Prefer competitors with longer ad tenure and more active creatives (better copy benchmarks)
  const duration = profile.adDurationDays ?? 0;
  if (duration >= 180) overlap += 14;
  else if (duration >= 60) overlap += 10;
  else if (duration >= 21) overlap += 6;
  else if (duration > 0) overlap += 2;

  const active = profile.activeAdCount ?? 0;
  if (active >= 8) overlap += 12;
  else if (active >= 4) overlap += 8;
  else if (active >= 2) overlap += 5;
  else if (active === 1) overlap += 1;
  else if (profile.fetched && duration === 0) overlap -= 3;

  const brandScore = profile.brandReview?.score ?? 0;
  if (brandScore >= 75) overlap += 12;
  else if (brandScore >= 55) overlap += 7;
  else if (brandScore >= 40) overlap += 3;
  else if (brandScore > 0 && brandScore < 35) overlap -= 4;

  if (isAggregatorProfile(profile.name, competitorText) && options.businessContext.level !== 'national') {
    overlap -= 12;
  }

  const aggregatorHints = ['compare', 'finder', 'marketplace', 'review site', 'aggregator'];
  const isAggregator = aggregatorHints.some((h) => profile.name.toLowerCase().includes(h.split(' ')[0] ?? h));
  const clientIsAggregator = [...industryTokens, ...serviceTokens].some((t) =>
    ['compare', 'comparison', 'marketplace', 'aggregator'].includes(t)
  );
  if (isAggregator && !clientIsAggregator) overlap -= 8;

  return overlap;
}

function applyTransparencyToProfile(
  profile: CompetitorProfile,
  headlines: string[],
  descriptions: string[],
  ctas: string[]
): CompetitorProfile {
  if (!headlines.length && !descriptions.length) return profile;
  return {
    ...profile,
    fetched: true,
    headlines: headlines.length ? headlines : profile.headlines,
    descriptions: descriptions.length ? descriptions : profile.descriptions,
    ctas: ctas.length ? ctas : profile.ctas,
    keyMessages: [...new Set([...headlines, ...profile.keyMessages])].slice(0, 8),
    valuePropositions: [...new Set([...descriptions, ...profile.valuePropositions])].slice(0, 6),
  };
}

async function fetchCompetitorGalleryForTarget(
  target: { name: string; url: string; advertiserId?: string },
  country: string | undefined,
  websiteProfile: CompetitorProfile,
  serviceTerms?: string[],
  serviceSeed?: { service: string; seedKeywords: string[] }
): Promise<{
  preview: CompetitorAdPreview;
  profile: CompetitorProfile;
  allPreviews?: CompetitorAdPreview[];
} | null> {
  const buildPreviewFromSv = (
    sv: Awaited<ReturnType<typeof fetchSociaVaultCompetitorAd>>,
    profileIn: CompetitorProfile,
    targetIn: { name: string; url: string; advertiserId?: string }
  ): { preview: CompetitorAdPreview; profile: CompetitorProfile } | null => {
    if (!sv) return null;
    const exactHeadlines = decodeHtmlEntitiesList(
      [...(sv.headline ? [sv.headline] : []), ...sv.allHeadlines].filter(Boolean)
    );
    const exactDescriptions = decodeHtmlEntitiesList(
      [...(sv.description ? [sv.description] : []), ...sv.allDescriptions].filter(Boolean)
    );
    const headlines = [...new Set(exactHeadlines)].slice(0, 15);
    const descriptions = [...new Set(exactDescriptions)].slice(0, 4);
    const hasExactCopy = headlines.length > 0 || descriptions.length > 0;

    let profile = applyTransparencyToProfile(
      profileIn,
      headlines,
      descriptions,
      hasExactCopy ? [] : profileIn.ctas
    );
    profile = {
      ...profile,
      name: sv.advertiserName || targetIn.name,
      advertiserId:
        targetIn.advertiserId ||
        advertiserIdFromTransparencyUrl(sv.advertiserUrl) ||
        profile.advertiserId,
      transparencyUrl: sv.advertiserUrl || profile.transparencyUrl,
      adDurationDays: sv.adDurationDays,
      activeAdCount: sv.activeAdCount,
      totalAdCount: sv.totalAdCount,
      firstShown: sv.firstShown,
      lastShown: sv.lastShown,
    };
    const brandReview = buildBrandReview(profile, {
      adDurationDays: sv.adDurationDays,
      activeAdCount: sv.activeAdCount,
      totalAdCount: sv.totalAdCount,
      avgCreativeDurationDays: sv.avgCreativeDurationDays,
      firstShown: sv.firstShown,
      lastShown: sv.lastShown,
    });

    const destinationUrl =
      sv.destinationUrl?.startsWith('http') &&
      !/adstransparency\.google\.com/i.test(sv.destinationUrl)
        ? sv.destinationUrl
        : undefined;
    let profileUrl = targetIn.url;
    if (destinationUrl) {
      try {
        profileUrl = new URL(destinationUrl).origin;
      } catch {
        profileUrl = destinationUrl;
      }
    } else if (sv.visibleUrl && !/adstransparency\.google\.com/i.test(sv.visibleUrl)) {
      const host = displayHostFromUrl(
        sv.visibleUrl.includes('://') ? sv.visibleUrl : `https://${sv.visibleUrl}`
      );
      if (host && host !== 'competitor.com') profileUrl = `https://${host}`;
    }

    profile = { ...profile, url: profileUrl, brandReview };

    const preview: CompetitorAdPreview = {
      name: sv.advertiserName || targetIn.name,
      url: destinationUrl || profileUrl,
      destinationUrl,
      displayUrl:
        sv.visibleUrl ||
        (destinationUrl ? displayHostFromUrl(destinationUrl) : displayHostFromUrl(profileUrl)),
      headlines,
      descriptions,
      offers: [],
      ctas: [],
      trustSignals: websiteProfile.trustSignals.slice(0, 4),
      transparencyUrl: sv.advertiserUrl,
      creativeUrl: sv.adUrl,
      adLink: sv.adUrl,
      advertiserName: sv.advertiserName || targetIn.name,
      advertiserId: targetIn.advertiserId || advertiserIdFromTransparencyUrl(sv.advertiserUrl),
      syntheticCopy: isSyntheticAdCopy(headlines, descriptions, sv.advertiserName || targetIn.name),
      adSource: 'sociavault',
      previewImageUrl: sv.previewImageUrl,
      format: sv.format,
      adDurationDays: sv.adDurationDays,
      activeAdCount: sv.activeAdCount,
      totalAdCount: sv.totalAdCount,
      firstShown: sv.firstShown,
      lastShown: sv.lastShown,
      creativeFirstShown: sv.firstShown,
      creativeLastShown: sv.lastShown,
      isActive: sv.activeAdCount > 0,
      brandReview,
    };
    return { preview, profile };
  };

  // Pull real RSA copy from SociaVault OCR + Google Ads Transparency in parallel.
  // Sequential 16s timeouts were returning before ad-details landed, so the UI
  // showed name/"Shop Now" stubs instead of Transparency creatives.
  const svMatchingPromise =
    serviceSeed && isSociaVaultConfigured() && !isSociaVaultCreditsExhausted()
      ? withTimeoutFallback(
          fetchSociaVaultMatchingAds({
            name: target.name,
            url: target.url,
            country,
            service: serviceSeed.service,
            seedKeywords: serviceSeed.seedKeywords,
            advertiserId: target.advertiserId,
            maxAdSamples: 20,
            requireLexicalMatch: false,
          }),
          35_000,
          [],
          `sociavault-strict-ads:${target.advertiserId ?? target.url}`
        )
      : Promise.resolve([]);

  const svSinglePromise =
    !serviceSeed && isSociaVaultConfigured() && !isSociaVaultCreditsExhausted()
      ? withTimeoutFallback(
          fetchSociaVaultCompetitorAd({
            name: target.name,
            url: target.url,
            country,
            serviceTerms: serviceTerms?.length ? serviceTerms : undefined,
            advertiserId: target.advertiserId,
          }),
          22_000,
          null,
          `sociavault:${target.advertiserId ?? target.url}`
        )
      : Promise.resolve(null);

  const transparencyPromise = withTimeoutFallback(
    fetchExactTransparencyAdForCompetitor({
      name: target.name,
      url: target.url,
      country,
      advertiserId: target.advertiserId,
    }),
    22_000,
    null,
    `transparency:${target.advertiserId ?? target.url}`
  );

  const [svMatches, svSingle, transparency] = await Promise.all([
    svMatchingPromise,
    svSinglePromise,
    transparencyPromise,
  ]);

  const builtFromSv = [
    ...svMatches.map((sv) => buildPreviewFromSv(sv, websiteProfile, target)),
    svSingle ? buildPreviewFromSv(svSingle, websiteProfile, target) : null,
  ].filter(Boolean) as Array<{ preview: CompetitorAdPreview; profile: CompetitorProfile }>;

  const realFromSv = builtFromSv.filter(
    (b) =>
      !b.preview.syntheticCopy &&
      !isSyntheticAdCopy(b.preview.headlines, b.preview.descriptions, b.preview.name)
  );

  const transparencyPreviews: CompetitorAdPreview[] = (transparency?.allAds ?? [])
    .filter((ad) => ad.headlines.length || ad.descriptions.length || ad.previewImageUrl)
    .map((ad) => ({
      name: transparency!.advertiser.name || target.name,
      url: ad.finalUrl?.startsWith('http') ? ad.finalUrl : target.url,
      displayUrl: ad.displayUrl ?? displayHostFromUrl(target.url),
      headlines: decodeHtmlEntitiesList(ad.headlines ?? []),
      descriptions: decodeHtmlEntitiesList(ad.descriptions ?? []),
      offers: [],
      ctas: [],
      trustSignals: [],
      transparencyUrl: transparency!.advertiser.transparencyUrl,
      creativeUrl: ad.creativeUrl,
      adLink: ad.creativeUrl,
      advertiserName: transparency!.advertiser.name,
      advertiserId: transparency!.advertiser.advertiserId,
      adSource: 'transparency_center' as const,
      previewImageUrl: ad.previewImageUrl,
      format: ad.format,
      syntheticCopy: false,
      creativeLastShown: ad.lastShown,
      isActive: true,
      activeAdCount: Math.max(1, transparency!.allAds.length),
      totalAdCount: transparency!.allAds.length,
    }))
    .filter(
      (preview) =>
        !isSyntheticAdCopy(preview.headlines, preview.descriptions, preview.name)
    );

  const dedupeCreative = (ads: CompetitorAdPreview[]): CompetitorAdPreview[] => {
    const seen = new Set<string>();
    const out: CompetitorAdPreview[] = [];
    for (const ad of ads) {
      const key = `${(ad.headlines ?? []).join('|')}|${(ad.descriptions ?? []).join('|')}`.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(ad);
    }
    return out;
  };

  if (realFromSv.length || transparencyPreviews.length) {
    const extras = dedupeCreative([
      ...realFromSv.map((b) => b.preview),
      ...transparencyPreviews,
    ]);
    const primary = realFromSv[0] ?? {
      preview: extras[0]!,
      profile: applyTransparencyToProfile(
        websiteProfile,
        extras[0]!.headlines,
        extras[0]!.descriptions,
        []
      ),
    };
    if (!realFromSv.length) {
      primary.profile = {
        ...primary.profile,
        advertiserId: transparency?.advertiser.advertiserId || primary.profile.advertiserId,
        transparencyUrl: transparency?.advertiser.transparencyUrl || primary.profile.transparencyUrl,
        activeAdCount: extras[0]!.activeAdCount,
        totalAdCount: extras[0]!.totalAdCount,
      };
    }
    return {
      preview: primary.preview,
      profile: primary.profile,
      allPreviews: extras,
    };
  }

  // Library activity without OCR — return metrics only (never invent RSA copy)
  if (builtFromSv.length) {
    const primary = builtFromSv[0]!;
    return {
      preview: { ...primary.preview, headlines: [], descriptions: [], syntheticCopy: true },
      profile: primary.profile,
      allPreviews: [],
    };
  }

  return null;
}

type CompetitorTarget = {
  name: string;
  url: string;
  /** SociaVault advertiser id — fetch creatives even when domain is missing */
  advertiserId?: string;
  /** Pre-scored SociaVault activity from discovery (if known) */
  activity?: {
    totalAdCount: number;
    activeAdCount: number;
    adDurationDays: number;
    firstShown?: string;
    lastShown?: string;
    avgCreativeDurationDays?: number;
  };
};

/** Known domain fallbacks when Transparency omits domains for a vertical (AU focus). */
function seedCompetitorsForServices(services: string[], location?: string): CompetitorTarget[] {
  const joined = services.filter(Boolean).join(' ').toLowerCase();
  const au =
    !location ||
    /\baustralia\b|\bau\b|sydney|melbourne|brisbane|perth|adelaide/i.test(location);

  if (!au) return [];

  if (/\b(law|lawyer|solicitor|legal|conveyanc)\b/.test(joined)) {
    return [
      { name: 'Maurice Blackburn', url: 'https://www.mauriceblackburn.com.au' },
      { name: 'DLA Piper', url: 'https://www.dlapiper.com' },
      { name: 'King & Wood Mallesons', url: 'https://www.kwm.com' },
      { name: 'Corrs Chambers Westgarth', url: 'https://www.corrs.com.au' },
      { name: 'Turtons Lawyers', url: 'https://www.turtons.com.au' },
      { name: 'MinterEllison', url: 'https://www.minterellison.com' },
      { name: 'Allens', url: 'https://www.allens.com.au' },
      { name: 'Clayton Utz', url: 'https://www.claytonutz.com' },
    ];
  }
  if (/\bcar\b|\bauto\b|\bvehicle\b/.test(joined)) {
    const national = [
      { name: 'Loans.com.au', url: 'https://www.loans.com.au' },
      { name: 'MoneyPlace', url: 'https://www.moneyplace.com.au' },
      { name: 'Plenti', url: 'https://www.plenti.com.au' },
      { name: 'SocietyOne', url: 'https://www.societyone.com.au' },
      { name: 'Wisr', url: 'https://www.wisr.com.au' },
      { name: 'OurMoneyMarket', url: 'https://www.ourmoneymarket.com.au' },
      { name: 'iLoan', url: 'https://www.iloan.com.au' },
      { name: 'CarClarity', url: 'https://www.carclarity.com.au' },
    ];
    // Prefer metro car-finance brokers when city is known (same-region rivals)
    const melbourne = [
      { name: 'Car Loan 4U', url: 'https://www.carloans4u.com.au' },
      { name: 'VIC Car Loans', url: 'https://www.viccarloans.com.au' },
      { name: 'Car Finance Australia', url: 'https://www.carfinanceaustralia.com.au' },
      { name: 'Stratton Finance', url: 'https://www.strattonfinance.com.au' },
      { name: 'AutoCarLoans', url: 'https://www.autocarloans.com.au' },
    ];
    const sydney = [
      { name: 'Stratton Finance', url: 'https://www.strattonfinance.com.au' },
      { name: 'CarClarity', url: 'https://www.carclarity.com.au' },
      { name: 'Loans.com.au', url: 'https://www.loans.com.au' },
    ];
    if (/\bmelbourne\b|\bvic\b|victoria/i.test(location ?? '')) {
      return [...melbourne, ...national].slice(0, 10);
    }
    if (/\bsydney\b|\bnsw\b/i.test(location ?? '')) {
      return [...sydney, ...national].slice(0, 10);
    }
    return national;
  }
  if (/\bcommercial\b/.test(joined) && /\b(mortgage|property|lending|finance)\b/.test(joined)) {
    return [
      { name: 'Balmain', url: 'https://www.balmain.com.au' },
      { name: 'Pepper Money', url: 'https://www.pepper.com.au' },
      { name: 'Liberty Financial', url: 'https://www.liberty.com.au' },
      { name: 'Think Tank Group', url: 'https://www.thinktank.net.au' },
      { name: 'CBRE Capital Markets', url: 'https://www.cbre.com.au' },
    ];
  }
  if (/\bhome\b|\bmortgage\b/.test(joined) && !/\bcommercial\b/.test(joined)) {
    return [
      { name: 'Loan Market', url: 'https://www.loanmarket.com.au' },
      { name: 'Mortgage Choice', url: 'https://www.mortgagechoice.com.au' },
      { name: 'Aussie', url: 'https://www.aussie.com.au' },
      { name: 'Finsure', url: 'https://www.finsure.com.au' },
    ];
  }
  if (/\bpersonal\b/.test(joined)) {
    return [
      { name: 'MoneyPlace', url: 'https://www.moneyplace.com.au' },
      { name: 'Plenti', url: 'https://www.plenti.com.au' },
      { name: 'Wisr', url: 'https://www.wisr.com.au' },
      { name: 'SocietyOne', url: 'https://www.societyone.com.au' },
    ];
  }
  return [];
}

function normalizeBrandKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/[^a-z0-9]/g, '');
}

function brandsMatch(a: string, b: string): boolean {
  const na = normalizeBrandKey(a);
  const nb = normalizeBrandKey(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.length >= 4 && nb.length >= 4 && (na.includes(nb) || nb.includes(na))) return true;
  return false;
}

function matchesUploadedAllowList(
  candidate: { name?: string; url?: string; advertiserName?: string },
  allow: { names: string[]; urls: string[]; keys: Set<string>; domains: Set<string> }
): boolean {
  // Domain is the source of truth when the document listed websites
  if (allow.domains.size > 0 && candidate.url) {
    const dk = siteDomainKey(candidate.url);
    if (allow.domains.has(dk)) return true;
    // Reject different domains even if brand names vaguely match
    for (const d of allow.domains) {
      if (dk === d || dk.endsWith(`.${d}`) || d.endsWith(`.${dk}`)) return true;
    }
    return false;
  }

  const blobs = [
    candidate.name,
    candidate.advertiserName,
    candidate.url,
    candidate.url ? hostnameToName(candidate.url) : '',
  ]
    .filter(Boolean)
    .map((v) => String(v));
  for (const blob of blobs) {
    const key = normalizeBrandKey(blob);
    if (allow.keys.has(key)) return true;
    for (const name of allow.names) {
      // Exact brand key only — no loose substring (prevents BizIQ → BIZIQ Academy)
      if (normalizeBrandKey(name) === key) return true;
    }
  }
  return false;
}

function uploadedAllowList(options: {
  competitorUrls?: string[];
  competitorNames?: string[];
  competitorEntries?: Array<{ name: string; url?: string }>;
}): { names: string[]; urls: string[]; keys: Set<string>; domains: Set<string> } {
  const names: string[] = [];
  const urls: string[] = [];
  const keys = new Set<string>();
  const domains = new Set<string>();

  if (options.competitorEntries?.length) {
    for (const e of options.competitorEntries) {
      if (e.name?.trim()) {
        names.push(e.name.trim());
        keys.add(normalizeBrandKey(e.name));
      }
      if (e.url?.trim()) {
        const u = normalizeUrl(e.url.trim());
        urls.push(u);
        domains.add(siteDomainKey(u));
        keys.add(normalizeBrandKey(hostnameToName(u)));
      }
    }
  } else {
    for (const n of options.competitorNames ?? []) {
      if (!n.trim()) continue;
      names.push(n.trim());
      keys.add(normalizeBrandKey(n));
    }
    for (const u of options.competitorUrls ?? []) {
      if (!u.trim()) continue;
      const url = normalizeUrl(u.trim());
      urls.push(url);
      domains.add(siteDomainKey(url));
      keys.add(normalizeBrandKey(hostnameToName(url)));
    }
  }
  return { names, urls, keys, domains };
}

function looksLikeDomainOrUrl(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  if (/^https?:\/\//i.test(v)) return true;
  return /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}(?:\/\S*)?$/i.test(v);
}

function parseUserCompetitorEntry(raw: string): CompetitorTarget | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (looksLikeDomainOrUrl(trimmed)) {
    const url = normalizeUrl(trimmed);
    return { name: hostnameToName(url), url };
  }
  // Name-only: placeholder domain; SociaVault discovery below will enrich/replace when possible
  const slug = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 40);
  if (!slug) return null;
  return { name: trimmed, url: `https://www.${slug}.com` };
}

async function resolveCompetitorTargets(options: {
  businessName: string;
  websiteUrl?: string;
  industry?: string;
  location?: string;
  productsServices?: string[];
  competitorUrls?: string[];
  /** Brand names from user upload when URLs were not provided */
  competitorNames?: string[];
  /** Paired document rows — preferred when present */
  competitorEntries?: Array<{ name: string; url?: string }>;
  monthlySpend?: number;
  websiteIntel?: WebsiteIntelligence | null;
  country?: string;
  lightweight?: boolean;
  serviceScoped?: boolean;
  /** When true, only analyze competitors from the uploaded document (no auto-discovery / seeding). */
  userProvidedOnly?: boolean;
  /** Keyword-cluster terms from Create Campaign / Ahrefs */
  searchKeywords?: string[];
  /** Minimum rivals to aim for during discovery (default MIN_COMPETITORS) */
  minCompetitors?: number;
  /** Match only primary service + seed keywords (Create Campaign) */
  strictServiceSeed?: boolean;
}): Promise<CompetitorTarget[]> {
  const minNeeded = Math.max(MIN_COMPETITORS, options.minCompetitors ?? MIN_COMPETITORS);
  const strictSeedMode =
    options.strictServiceSeed && (options.searchKeywords?.length ?? 0) > 0;
  const primaryService =
    options.productsServices?.[0]?.trim() ||
    options.websiteIntel?.services?.[0]?.trim() ||
    '';
  const seedKeywords = (() => {
    const raw = (options.searchKeywords ?? [])
      .map((k) => k.trim())
      .filter((k) => k.length >= 3);
    const filtered = primaryService ? filterSeedKeywordsForService(primaryService, raw) : raw;
    if (filtered.length) return filtered;
    return primaryService ? [primaryService] : raw;
  })();
  const businessContext = inferBusinessContext({
    monthlySpend: options.monthlySpend,
    location: options.location,
    industry: options.industry,
    productsServices: options.productsServices,
    websiteIntel: options.websiteIntel,
  });

  const userTargets: CompetitorTarget[] = [];
  const seenDomains = new Set<string>();
  const seenNames = new Set<string>();

  const pushTarget = (name: string, url?: string) => {
    const cleanedName = name.trim();
    const cleanedUrl = url?.trim() ? normalizeUrl(url.trim()) : undefined;
    if (!cleanedName && !cleanedUrl) return;

    if (cleanedUrl) {
      const dk = siteDomainKey(cleanedUrl);
      if (seenDomains.has(dk)) return;
      seenDomains.add(dk);
      const displayName = cleanedName || hostnameToName(cleanedUrl);
      seenNames.add(normalizeBrandKey(displayName));
      userTargets.push({ name: displayName, url: cleanedUrl });
      return;
    }

    const nk = normalizeBrandKey(cleanedName);
    if (!nk || seenNames.has(nk)) return;
    // Name-only: skip if a domain entry already covers this brand
    if (
      userTargets.some(
        (u) =>
          normalizeBrandKey(u.name) === nk ||
          normalizeBrandKey(hostnameToName(u.url)) === nk
      )
    ) {
      return;
    }
    const t = parseUserCompetitorEntry(cleanedName);
    if (!t) return;
    if (seenDomains.has(siteDomainKey(t.url))) return;
    seenDomains.add(siteDomainKey(t.url));
    seenNames.add(nk);
    userTargets.push(t);
  };

  // Preferred: paired entries from the uploaded document
  if (options.competitorEntries?.length) {
    for (const row of options.competitorEntries) {
      pushTarget(row.name ?? '', row.url);
    }
  } else {
    // Legacy: zip urls with names when lengths match; otherwise urls first then leftover names
    const urls = (options.competitorUrls ?? []).map((u) => u.trim()).filter(Boolean);
    const names = (options.competitorNames ?? []).map((n) => n.trim()).filter(Boolean);
    if (urls.length && names.length && urls.length === names.length) {
      for (let i = 0; i < urls.length; i++) pushTarget(names[i]!, urls[i]);
    } else {
      for (const url of urls) pushTarget(hostnameToName(url), url);
      for (const name of names) pushTarget(name);
    }
  }

  // Enrich ONLY by the document domain — never name-search for alternate advertisers.
  // Keep document name + document domain as the identity forever.
  if (isSociaVaultConfigured() && userTargets.length) {
    for (let i = 0; i < userTargets.length; i++) {
      const t = userTargets[i]!;
      const isGuess = /https:\/\/www\.[a-z0-9]+\.com$/i.test(t.url);
      // Name-only placeholders: try domain-less resolve carefully, but reject domain swaps
      if (isGuess) {
        try {
          const resolved = await withTimeout(
            resolveCompetitorViaSociaVault({
              name: t.name,
              url: t.url,
              country: options.country,
            }),
            options.lightweight ? 20_000 : 35_000,
            `sociavault-resolve-name:${t.name}`
          ).catch(() => null);
          if (resolved && resolved.activity.totalAdCount > 0) {
            const resolvedDomain = siteDomainKey(resolved.url);
            // Accept only if brand tokens strongly match document name
            const nameOk =
              normalizeBrandKey(resolved.name) === normalizeBrandKey(t.name) ||
              normalizeBrandKey(hostnameToName(resolved.url)) === normalizeBrandKey(t.name);
            if (nameOk && !seenDomains.has(resolvedDomain)) {
              seenDomains.delete(siteDomainKey(t.url));
              seenDomains.add(resolvedDomain);
              userTargets[i] = {
                name: t.name, // keep document spelling (BizIQ not BIZIQ Academy)
                url: `https://${resolvedDomain}`,
                advertiserId: t.advertiserId,
                activity: {
                  totalAdCount: resolved.activity.totalAdCount,
                  activeAdCount: resolved.activity.activeAdCount,
                  adDurationDays: resolved.activity.adDurationDays,
                  firstShown: resolved.activity.firstShown,
                  lastShown: resolved.activity.lastShown,
                  avgCreativeDurationDays: resolved.activity.avgCreativeDurationDays,
                },
              };
            }
          }
        } catch {
          /* keep placeholder */
        }
        continue;
      }

      // Real document domain: fetch library metrics for THIS domain only
      try {
        const resolved = await withTimeout(
          resolveCompetitorViaSociaVault({
            name: t.name,
            url: t.url,
            country: options.country,
          }),
          options.lightweight ? 20_000 : 35_000,
          `sociavault-resolve-domain:${siteDomainKey(t.url)}`
        ).catch(() => null);
        if (resolved && resolved.activity.totalAdCount > 0) {
          const resolvedDomain = siteDomainKey(resolved.url);
          const docDomain = siteDomainKey(t.url);
          // Reject if SociaVault returned a different company's domain
          if (resolvedDomain !== docDomain && !resolvedDomain.endsWith(`.${docDomain}`) && !docDomain.endsWith(`.${resolvedDomain}`)) {
            console.log(
              `[competitors] reject domain swap for "${t.name}": doc=${docDomain} sociavault=${resolvedDomain}`
            );
            continue;
          }
          userTargets[i] = {
            name: t.name, // always keep document brand label
            url: t.url, // always keep document domain
            advertiserId: t.advertiserId,
            activity: {
              totalAdCount: resolved.activity.totalAdCount,
              activeAdCount: resolved.activity.activeAdCount,
              adDurationDays: resolved.activity.adDurationDays,
              firstShown: resolved.activity.firstShown,
              lastShown: resolved.activity.lastShown,
              avgCreativeDurationDays: resolved.activity.avgCreativeDurationDays,
            },
          };
        }
      } catch {
        /* keep document identity without metrics */
      }
    }
  }

  // Final domain dedupe (guards against any enrichment edge cases)
  const deduped: CompetitorTarget[] = [];
  const finalDomains = new Set<string>();
  for (const t of userTargets) {
    const dk = siteDomainKey(t.url);
    if (finalDomains.has(dk)) {
      console.log(`[competitors] drop duplicate domain ${dk} (${t.name})`);
      continue;
    }
    finalDomains.add(dk);
    deduped.push(t);
  }

  // Uploaded-document mode: never invent or seed extra rivals
  if (options.userProvidedOnly && deduped.length) {
    console.log(
      `[competitors] userProvidedOnly: analyzing ${deduped.length} uploaded competitor(s) — skip auto-discovery`,
      deduped.map((t) => `${t.name}<${siteDomainKey(t.url)}>`).join(', ')
    );
    return deduped.slice(0, 20);
  }

  const targets: CompetitorTarget[] = [...deduped];
  const seen = new Set(deduped.map((t) => t.url.toLowerCase()));
  for (const t of deduped) seen.add(siteDomainKey(t.url));

  // Prefer SociaVault discovery FIRST — these already have ad duration / active / total counts
  resetSociaVaultErrorState();
  if (isSociaVaultConfigured() && options.websiteUrl && !isSociaVaultCreditsExhausted()) {
    const serviceHints = businessContext.primaryServices.slice(0, 1);
    const keywordQueries = buildKeywordClusterQueries(options.searchKeywords, options.location)
      .filter((q) =>
        strictSeedMode && primaryService
          ? keywordMatchesServiceSeed(q, primaryService)
          : true
      );
    const baseQueries = strictSeedMode
      ? prioritizeMarketQueries(
          [
            ...(primaryService ? expandServiceSearchQueries([primaryService], options.location) : []),
            ...(primaryService ? [primaryService] : []),
            ...keywordQueries,
          ],
          options.location
        )
      : prioritizeMarketQueries(
          [
            ...keywordQueries,
            ...buildCompetitorSearchQueries(businessContext, options.businessName),
          ],
          options.location
        );
    // Lightweight / service-scoped: smaller budget so Make This Ad Better finishes in UI poll window
    // Keyword clusters + Create Campaign min=5 → allow a larger query budget
    const queryBudget = options.lightweight
      ? Math.min(12, Math.max(6, keywordQueries.length ? 10 : serviceHints.length ? 6 : 8))
      : Math.min(18, Math.max(10, keywordQueries.length ? 14 : serviceHints.length ? 10 : 16));
    const uniqueQueries = [...new Set(baseQueries.map((q) => q.trim()).filter(Boolean))].slice(
      0,
      queryBudget
    );
    console.log(
      `[competitors] SociaVault discovery queries (${uniqueQueries.length}): ${uniqueQueries.join(' | ')}`
    );
    const sociavaultTargets = await discoverSociaVaultCompetitors({
      siteUrl: options.websiteUrl,
      searchQueries: uniqueQueries,
      region: options.country,
      maxCount: minNeeded + 8,
      // Web-search path runs first; advertiser-search early-stop only after several empties
      maxEmptyQueries: options.lightweight ? 4 : 0,
    });
    // Highest activity first, but prefer name/domain that match the target service
    const ranked = [...sociavaultTargets]
      .filter((t) => {
        if (isLikelyArticleAdvertiser(t.name)) {
          console.log(`[competitors] discovery skip article-like name: ${t.name}`);
          return false;
        }
        if (looksLikeNonCommercialAdvertiser(t.name, t.url)) {
          console.log(`[competitors] discovery skip non-commercial: ${t.name} (${t.url})`);
          return false;
        }
        if (looksLikeQueryNotAdvertiser(t.name, primaryService)) {
          console.log(`[competitors] discovery skip query-title: ${t.name}`);
          return false;
        }
        if (options.country && !competitorUrlMatchesCountry(t.url, options.country)) {
          console.log(`[competitors] discovery skip foreign TLD: ${t.name} (${t.url})`);
          return false;
        }
        if (!serviceHints.length) return true;
        if (advertiserConflictsWithService(t.name, t.url, serviceHints)) {
          console.log(`[competitors] discovery skip conflict: ${t.name} vs "${serviceHints[0]}"`);
          return false;
        }
        return true;
      })
      .sort((a, b) => {
        const aSvc = serviceHints.length
          ? scoreServiceTextMatch(`${a.name} ${a.url}`, serviceHints)
          : 50;
        const bSvc = serviceHints.length
          ? scoreServiceTextMatch(`${b.name} ${b.url}`, serviceHints)
          : 50;
        return (
          bSvc - aSvc ||
          b.activity.adDurationDays - a.activity.adDurationDays ||
          b.activity.activeAdCount - a.activity.activeAdCount ||
          b.activity.totalAdCount - a.activity.totalAdCount
        );
      });
    for (const t of ranked) {
      const key = (t.advertiserId ? `adv:${t.advertiserId}` : t.url).toLowerCase();
      if (seen.has(key)) continue;
      if (t.activity.totalAdCount <= 0) continue;
      seen.add(key);
      targets.push({
        name: t.name,
        url: t.url,
        advertiserId: t.advertiserId,
        activity: {
          totalAdCount: t.activity.totalAdCount,
          activeAdCount: t.activity.activeAdCount,
          adDurationDays: t.activity.adDurationDays,
          firstShown: t.activity.firstShown,
          lastShown: t.activity.lastShown,
          avgCreativeDurationDays: t.activity.avgCreativeDurationDays,
        },
      });
      if (targets.length >= minNeeded + 8) break;
    }
  }

  const withAds = () => targets.filter((t) => (t.activity?.totalAdCount ?? 0) > 0).length;

  const svStatus = getSociaVaultErrorState();
  if (
    withAds() < minNeeded &&
    (svStatus.creditsExhausted || !isSociaVaultConfigured())
  ) {
    const fallbackQueries = [
      ...new Set(
        [
          ...(primaryService ? expandServiceSearchQueries([primaryService], options.location) : []),
          ...expandServiceSearchQueries(businessContext.primaryServices, options.location),
          ...buildKeywordClusterQueries(options.searchKeywords, options.location),
          ...(primaryService ? [primaryService, `${primaryService} ${options.location ?? ''}`.trim()] : []),
        ]
          .map((q) => q.trim())
          .filter((q) => q.length >= 3)
      ),
    ].slice(0, 12);
    console.log(
      `[competitors] Transparency Center fallback (${fallbackQueries.length} queries) — SociaVault ${svStatus.creditsExhausted ? 'credits exhausted' : 'unavailable'}`
    );
    const transparencyAdvertisers = await discoverTransparencyAdvertisersByQueries(
      fallbackQueries,
      options.country,
      minNeeded + 4
    );
    for (const adv of transparencyAdvertisers) {
      const key = `adv:${adv.advertiserId.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      targets.push({
        name: adv.name,
        url: adv.transparencyUrl,
        advertiserId: adv.advertiserId,
      });
      if (targets.length >= minNeeded + 6) break;
    }
  }

  // Seed known AU market domains when search returns too few domain-backed rivals
  // so gallery can still populate while advertiser-id creatives are fetched.
  if (targets.length < minNeeded || withAds() < minNeeded) {
    const seeds = seedCompetitorsForServices(businessContext.primaryServices, options.location);
    for (const seed of seeds) {
      const key = seed.url.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      targets.push(seed);
      if (targets.length >= minNeeded + 4) break;
    }
    if (seeds.length) {
      console.log(
        `[competitors] seeded ${seeds.length} known domain(s) for "${businessContext.primaryServices[0] ?? 'service'}"`
      );
    }
  }

  // Claude fill only if we still lack enough SociaVault-backed competitors.
  // Then VERIFY each Claude candidate against SociaVault — fake/dead domains become 0-metric noise.
  // Skip Claude competitor invent+verify on lightweight (too slow for Make This Ad Better poll window)
  if (!options.lightweight && withAds() < minNeeded) {
    let attempts = 0;
    const pendingClaude: Array<{ name: string; url: string }> = [];
    while (targets.length < minNeeded + 2 && attempts < 2) {
      const needed = minNeeded - withAds() + 2;
      const autoTargets = await identifyCompetitorUrls({
        businessName: options.businessName,
        websiteUrl: options.websiteUrl,
        industry: options.industry,
        location: options.location,
        productsServices: options.productsServices,
        businessContext,
        maxCount: needed,
      });
      for (const t of autoTargets) {
        const key = t.url.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        pendingClaude.push(t);
      }
      attempts += 1;
      if (!autoTargets.length) break;
    }

    if (pendingClaude.length && isSociaVaultConfigured() && !isSociaVaultCreditsExhausted()) {
      const verified = await Promise.all(
        pendingClaude.map(async (t) => {
          try {
            const resolved = await withTimeout(
              resolveCompetitorViaSociaVault({
                name: t.name,
                url: t.url,
                country: options.country,
              }),
              35_000,
              `sociavault-resolve:${t.url}`
            );
            return resolved;
          } catch {
            return null;
          }
        })
      );
      for (const r of verified) {
        if (!r || r.activity.totalAdCount <= 0) continue;
        const key = r.url.toLowerCase();
        if (seen.has(key) && targets.some((t) => t.url.toLowerCase() === key && (t.activity?.totalAdCount ?? 0) > 0)) {
          continue;
        }
        seen.add(key);
        targets.push({
          name: r.name,
          url: r.url,
          activity: {
            totalAdCount: r.activity.totalAdCount,
            activeAdCount: r.activity.activeAdCount,
            adDurationDays: r.activity.adDurationDays,
            firstShown: r.activity.firstShown,
            lastShown: r.activity.lastShown,
            avgCreativeDurationDays: r.activity.avgCreativeDurationDays,
          },
        });
        if (withAds() >= MIN_COMPETITORS + 2) break;
      }
    } else if (pendingClaude.length) {
      console.log(
        `[competitors] keeping ${pendingClaude.length} LLM-identified rival(s) (ad library unavailable)`
      );
      for (const t of pendingClaude) {
        if (targets.length >= minNeeded + 4) break;
        targets.push({ name: t.name, url: t.url });
      }
    }
  }

  // Seeded domains have no activity until we look them up — otherwise they are dropped
  const unresolved = targets.filter((t) => (t.activity?.totalAdCount ?? 0) <= 0);
  if (
    unresolved.length &&
    isSociaVaultConfigured() &&
    !isSociaVaultCreditsExhausted() &&
    !options.lightweight
  ) {
    console.log(`[competitors] resolving ${unresolved.length} seed domain(s) against the ad library`);
    const verified = await Promise.all(
      unresolved.slice(0, 10).map(async (t) => {
        try {
          const resolved = await withTimeout(
            resolveCompetitorViaSociaVault({
              name: t.name,
              url: t.url,
              country: options.country,
            }),
            35_000,
            `sociavault-resolve-seed:${t.url}`
          );
          return { original: t, resolved };
        } catch {
          return { original: t, resolved: null };
        }
      })
    );
    for (const { original, resolved } of verified) {
      if (!resolved || resolved.activity.totalAdCount <= 0) continue;
      const idx = targets.findIndex((t) => t.url.toLowerCase() === original.url.toLowerCase());
      const next = {
        name: resolved.name || original.name,
        url: resolved.url || original.url,
        advertiserId: original.advertiserId,
        activity: {
          totalAdCount: resolved.activity.totalAdCount,
          activeAdCount: resolved.activity.activeAdCount,
          adDurationDays: resolved.activity.adDurationDays,
          firstShown: resolved.activity.firstShown,
          lastShown: resolved.activity.lastShown,
          avgCreativeDurationDays: resolved.activity.avgCreativeDurationDays,
        },
      };
      if (idx >= 0) targets[idx] = next;
      else targets.push(next);
    }
  }

  // Prefer SociaVault-backed rivals; when credits are exhausted keep Transparency / LLM / seed names
  const proven = targets.filter((t) => (t.activity?.totalAdCount ?? 0) > 0);
  const keepUnproven =
    proven.length < minNeeded &&
    (isSociaVaultCreditsExhausted() || !isSociaVaultConfigured());
  const sorted = (proven.length && !keepUnproven ? proven : targets).sort(
    (a, b) =>
      (b.activity?.adDurationDays ?? 0) - (a.activity?.adDurationDays ?? 0) ||
      (b.activity?.activeAdCount ?? 0) - (a.activity?.activeAdCount ?? 0) ||
      (b.activity?.totalAdCount ?? 0) - (a.activity?.totalAdCount ?? 0)
  );

  console.log(
    `[competitors] resolveTargets: ${sorted.filter((t) => (t.activity?.totalAdCount ?? 0) > 0).length} with SociaVault ads / ${sorted.length} total`
  );

  return sorted.slice(0, Math.max(MIN_COMPETITORS + 2, Math.min(sorted.length, 14)));
}

function deriveMissingFromYourAds(
  competitors: CompetitorProfile[],
  clientOffers: Set<string>,
  clientHeadlines: Set<string>
): string[] {
  const gaps: string[] = [];
  for (const c of competitors) {
    for (const offer of c.offers) {
      const lower = offer.toLowerCase();
      if (!clientOffers.has(lower) && !gaps.some((g) => g.toLowerCase().includes(lower.slice(0, 20)))) {
        gaps.push(`${c.name}: "${offer}" — not highlighted in your current ads`);
      }
    }
    for (const msg of c.keyMessages.slice(0, 2)) {
      const lower = msg.toLowerCase();
      const covered = [...clientHeadlines].some((h) => h.includes(lower.slice(0, 12)) || lower.includes(h.slice(0, 12)));
      if (!covered && gaps.length < 10) {
        gaps.push(`${c.name} leads with "${msg}" — missing from your messaging`);
      }
    }
  }
  return gaps.slice(0, 8);
}

/** Drop OCR junk, non-English blobs, and off-topic creatives from Winning Patterns. */
function isUsablePatternText(
  text: string,
  relevanceTokens: string[]
): boolean {
  const cleaned = decodeHtmlEntities(text);
  if (cleaned.length < 4 || cleaned.length > 180) return false;
  // Prefer Latin/English ad copy — reject dense non-Latin (e.g. Polish perfume OCR noise)
  const latinChars = (cleaned.match(/[A-Za-z]/g) ?? []).length;
  if (latinChars < Math.min(8, cleaned.length * 0.55)) return false;
  const lower = cleaned.toLowerCase();
  if (/\b(cookie|privacy policy|terms of use|javascript|undefined|null)\b/.test(lower)) return false;
  if (!relevanceTokens.length) return true;
  return relevanceTokens.some((t) => t.length >= 3 && lower.includes(t));
}

function industryPatternBoostTokens(industry?: string, services?: string[]): string[] {
  const blob = `${industry ?? ''} ${(services ?? []).join(' ')}`.toLowerCase();
  if (/financ|lend|loan|credit|mortgage|bank/.test(blob)) {
    return ['loan', 'loans', 'credit', 'finance', 'rate', 'rates', 'approval', 'apply', 'money', 'bank', 'lending', 'borrow', 'cash', 'card', 'debt'];
  }
  if (/real estate|propert|realtor/.test(blob)) return ['property', 'home', 'house', 'rent', 'buy', 'sell', 'agent'];
  if (/saas|software|tech/.test(blob)) return ['software', 'platform', 'cloud', 'automation', 'crm'];
  if (/health|dental|clinic|medical/.test(blob)) return ['health', 'care', 'clinic', 'dental', 'medical', 'treatment'];
  if (/legal|law|attorney/.test(blob)) return ['legal', 'lawyer', 'attorney', 'law', 'claim'];
  if (/insur/.test(blob)) return ['insurance', 'cover', 'policy', 'premium', 'claim'];
  return [];
}

function extractMarketPatterns(
  competitors: CompetitorProfile[],
  adGallery: CompetitorAdPreview[],
  client: { industry?: string; services?: string[]; keywords?: string[] }
): CompetitiveMarketPatterns {
  const relevanceTokens = [
    ...(client.industry ?? '').toLowerCase().split(/[^a-z0-9]+/),
    ...(client.services ?? []).flatMap((s) => s.toLowerCase().split(/[^a-z0-9]+/)),
    ...(client.keywords ?? []).flatMap((k) => k.toLowerCase().split(/[^a-z0-9]+/)),
    ...industryPatternBoostTokens(client.industry, client.services),
  ].filter((t) => t.length >= 3);

  // Winning Patterns must come from SociaVault ad creatives — not website crawl headings
  // (crawl often injects unrelated nav/meta/OCR noise into competitor profiles).
  const galleryAds = adGallery.filter((a) => a.isActive !== false);
  const pickTexts = (raw: string[], requireRelevance: boolean) =>
    raw
      .map(decodeHtmlEntities)
      .filter((t) =>
        requireRelevance ? isUsablePatternText(t, relevanceTokens) : isUsablePatternText(t, [])
      );

  const galleryHeadlines = galleryAds.flatMap((a) => a.headlines ?? []);
  const galleryDescriptions = galleryAds.flatMap((a) => a.descriptions ?? []);
  const galleryOffers = galleryAds.flatMap((a) => [
    ...(a.offers ?? []),
    ...(a.offer ? [a.offer] : []),
  ]);
  const galleryCtas = galleryAds.flatMap((a) => [
    ...(a.ctas ?? []),
    ...(a.cta ? [a.cta] : []),
  ]);

  let headlines = pickTexts(galleryHeadlines, true);
  let offers = pickTexts(galleryOffers, true);
  const ctas = galleryCtas
    .map(decodeHtmlEntities)
    .filter((c) => {
      const t = c.toLowerCase();
      if (t === 'contact us' || t === 'learn more' || t === 'click here') return false;
      return c.length >= 2 && c.length <= 40;
    });
  let keywords = pickTexts(
    competitors.flatMap((c) => c.keywords),
    true
  );
  let valueProps = pickTexts(
    [...galleryDescriptions, ...competitors.flatMap((c) => c.valuePropositions)],
    true
  );

  // If industry tokens were too strict, keep Latin-only SociaVault creatives (still no crawl junk)
  if (!headlines.length) headlines = pickTexts(galleryHeadlines, false);
  if (!offers.length) offers = pickTexts(galleryOffers, false);
  if (!keywords.length) keywords = pickTexts(competitors.flatMap((c) => c.keywords), false);
  if (!valueProps.length) {
    valueProps = pickTexts(
      [...galleryDescriptions, ...competitors.flatMap((c) => c.valuePropositions)],
      false
    );
  }

  const uniq = (items: string[], max: number) => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const item of items) {
      const key = item.toLowerCase().trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(item.trim());
      if (out.length >= max) break;
    }
    return out;
  };

  return {
    topHeadlines: uniq(headlines, 8),
    topOffers: uniq(offers, 6),
    topCtas: uniq(ctas.length ? ctas : ['Apply Now', 'Get Started', 'Check Your Rate'], 6),
    topKeywords: uniq(keywords, 10),
    topValuePropositions: uniq(valueProps, 6),
  };
}

/**
 * Discover social profile URLs on each competitor website (and via Google/slug
 * fallbacks), then fetch follower metrics via SociaVault platform scrapers.
 */
async function enrichCompetitorsWithSocialPresence(
  competitors: CompetitorProfile[],
  options?: { lightweight?: boolean; location?: string }
): Promise<CompetitorProfile[]> {
  if (!isSociaVaultConfigured() || !competitors.length) return competitors;

  const region = /\baustralia\b|\bau\b|sydney|melbourne/i.test(options?.location ?? '')
    ? 'AU'
    : undefined;

  return Promise.all(
    competitors.map(async (c) => {
      try {
        const resolved = await withTimeoutFallback(
          resolveCompetitorSocialPresence({
            name: c.name,
            websiteUrl: c.url,
            existingLinks: c.socialLinks,
            lightweight: options?.lightweight,
            region,
          }),
          options?.lightweight ? 45_000 : 75_000,
          null,
          `social-presence:${c.url}`
        );

        if (!resolved) return c;

        const { links, metrics } = resolved;
        const hasLinks = Object.keys(links).some((k) => Boolean((links as Record<string, string | undefined>)[k]));

        if (!metrics && !hasLinks) return c;

        console.log(
          `[competitors] social presence for ${c.name}:`,
          [
            metrics?.linkedInFollowers != null ? `LI=${metrics.linkedInFollowers}` : links.linkedin ? 'LI=url' : null,
            metrics?.facebookFollowers != null ? `FB=${metrics.facebookFollowers}` : links.facebook ? 'FB=url' : null,
            metrics?.instagramFollowers != null ? `IG=${metrics.instagramFollowers}` : links.instagram ? 'IG=url' : null,
            metrics?.youtubeSubscribers != null ? `YT=${metrics.youtubeSubscribers}` : null,
            metrics?.tiktokFollowers != null ? `TT=${metrics.tiktokFollowers}` : null,
            metrics?.twitterFollowers != null ? `X=${metrics.twitterFollowers}` : null,
            metrics?.employeeCount != null ? `emps=${metrics.employeeCount}` : null,
          ]
            .filter(Boolean)
            .join(', ') || 'none'
        );

        const yearsFromFounded =
          metrics?.yearsFounded && metrics.yearsFounded > 1800
            ? new Date().getFullYear() - metrics.yearsFounded
            : undefined;

        return {
          ...c,
          socialLinks: hasLinks ? links : c.socialLinks,
          socialPresence: {
            brandAuthorityScore: c.brandAuthorityScore ?? 0,
            employeeCount: metrics?.employeeCount,
            employeeCountEstimated: metrics?.employeeCount == null,
            linkedInFollowers: metrics?.linkedInFollowers,
            facebookFollowers: metrics?.facebookFollowers,
            instagramFollowers: metrics?.instagramFollowers,
            youtubeSubscribers: metrics?.youtubeSubscribers,
            tiktokFollowers: metrics?.tiktokFollowers,
            twitterFollowers: metrics?.twitterFollowers,
            profileUrls: metrics?.profileUrls ?? links,
            source: metrics
              ? 'sociavault_social_profiles'
              : hasLinks
                ? 'unavailable'
                : 'unavailable',
          },
          brandAuthority: c.brandAuthority
            ? {
                ...c.brandAuthority,
                employeeCount: metrics?.employeeCount ?? c.brandAuthority.employeeCount,
                employeeCountEstimated: metrics?.employeeCount == null,
                yearsInBusiness: yearsFromFounded ?? c.brandAuthority.yearsInBusiness,
                yearsInBusinessEstimated: yearsFromFounded == null,
              }
            : c.brandAuthority,
        };
      } catch (err) {
        console.warn(
          `[competitors] social enrichment failed for ${c.name}:`,
          err instanceof Error ? err.message : err
        );
        return c;
      }
    })
  );
}

function applyConfidenceScores(
  competitors: CompetitorProfile[],
  adGallery: CompetitorAdPreview[],
  client: { industry?: string; services?: string[]; keywords?: string[]; location?: string }
): {
  competitors: CompetitorProfile[];
  adGallery: CompetitorAdPreview[];
  influenceWeights: Array<{
    name: string;
    score: number;
    aiLearningValue?: number;
    influencePercent: number;
  }>;
} {
  const scored = competitors.map((c) => {
    const conf = computeCompetitorConfidence({
      industry: client.industry,
      clientServices: client.services,
      clientKeywords: client.keywords,
      competitorServices: c.services,
      competitorKeywords: c.keywords,
      competitorHeadlines: c.headlines,
      competitorText: [c.positioning, ...c.keyMessages, ...c.valuePropositions].filter(Boolean).join(' '),
      adDurationDays: c.adDurationDays,
      activeAdCount: c.activeAdCount,
      totalAdCount: c.totalAdCount,
      trustSignals: c.trustSignals,
      brandReviewScore: c.brandReview?.score,
      reviewRating: c.brandReview?.averageRating,
      reviewCount: c.brandReview?.reviewCount,
      sociavaultProven:
        (c.totalAdCount ?? 0) > 0 &&
        !(client.services?.length
          ? hasConflictingService(
              [c.name, c.url, ...c.services, ...c.headlines, ...c.descriptions].join(' '),
              client.services
            )
          : false),
      locationMatch: Boolean(client.location),
      isAggregator: isAggregatorProfile(
        c.name,
        [c.url, ...c.services, ...c.headlines, ...c.keywords].join(' ')
      ),
    });
    const { class: durationClass, label: durationLabel } = classifyAdDuration(c.adDurationDays ?? 0);

    const brandReview = c.brandReview
      ? {
          ...c.brandReview,
          trustScore: c.brandReview.trustScore ?? conf.breakdown.brandReview,
          sentiment:
            c.brandReview.sentiment ??
            (conf.breakdown.socialBrandPresence >= 80
              ? 'Highly Positive'
              : conf.breakdown.socialBrandPresence >= 65
                ? 'Positive'
                : conf.breakdown.socialBrandPresence >= 50
                  ? 'Mixed'
                  : 'Negative'),
          positiveThemes: c.brandReview.positiveThemes?.length
            ? c.brandReview.positiveThemes
            : c.brandReview.strengths.slice(0, 4),
          negativeThemes: c.brandReview.negativeThemes?.length
            ? c.brandReview.negativeThemes
            : c.brandReview.weaknesses.slice(0, 3),
        }
      : undefined;

    const bundle = buildBrandAuthorityBundle({
      adDurationDays: c.adDurationDays,
      activeAdCount: c.activeAdCount,
      totalAdCount: c.totalAdCount,
      brandReviewScore: brandReview?.score ?? conf.brandAuthorityScore,
      trustScore: brandReview?.trustScore ?? conf.breakdown.brandReview,
      employeeCount: c.socialPresence?.employeeCount,
      linkedInFollowers: c.socialPresence?.linkedInFollowers,
      facebookFollowers: c.socialPresence?.facebookFollowers,
      instagramFollowers: c.socialPresence?.instagramFollowers,
      youtubeSubscribers: c.socialPresence?.youtubeSubscribers,
      tiktokFollowers: c.socialPresence?.tiktokFollowers,
      twitterFollowers: c.socialPresence?.twitterFollowers,
      offers: c.offers,
      trustSignals: c.trustSignals,
      valuePropositions: c.valuePropositions,
      headlines: c.headlines,
      descriptions: c.descriptions,
      keyMessages: c.keyMessages,
      confidenceScore: conf.score,
    });

    const hasLiveSocial =
      c.socialPresence?.source === 'sociavault_social_profiles' &&
      (c.socialPresence.linkedInFollowers != null ||
        c.socialPresence.facebookFollowers != null ||
        c.socialPresence.instagramFollowers != null ||
        c.socialPresence.youtubeSubscribers != null ||
        c.socialPresence.tiktokFollowers != null ||
        c.socialPresence.twitterFollowers != null);

    const socialPresence: CompetitorSocialPresence = {
      brandAuthorityScore: bundle.brandAuthority.brandAuthorityScore,
      employeeCount: c.socialPresence?.employeeCount ?? bundle.brandAuthority.employeeCount,
      employeeCountEstimated:
        c.socialPresence?.employeeCount != null
          ? false
          : bundle.brandAuthority.employeeCountEstimated,
      linkedInFollowers: c.socialPresence?.linkedInFollowers ?? bundle.socialPresence.linkedInFollowers,
      facebookFollowers: c.socialPresence?.facebookFollowers ?? bundle.socialPresence.facebookFollowers,
      instagramFollowers:
        c.socialPresence?.instagramFollowers ?? bundle.socialPresence.instagramFollowers,
      youtubeSubscribers:
        c.socialPresence?.youtubeSubscribers ?? bundle.socialPresence.youtubeSubscribers,
      tiktokFollowers: c.socialPresence?.tiktokFollowers ?? bundle.socialPresence.tiktokFollowers,
      twitterFollowers: c.socialPresence?.twitterFollowers,
      totalSocialReach:
        [
          c.socialPresence?.linkedInFollowers,
          c.socialPresence?.facebookFollowers,
          c.socialPresence?.instagramFollowers,
          c.socialPresence?.youtubeSubscribers,
          c.socialPresence?.tiktokFollowers,
          c.socialPresence?.twitterFollowers,
        ]
          .filter((n): n is number => typeof n === 'number' && n > 0)
          .reduce((a, b) => a + b, 0) || bundle.socialPresence.totalSocialReach,
      socialPresenceScore: bundle.socialPresence.socialPresenceScore,
      profileUrls: c.socialPresence?.profileUrls ?? c.socialLinks,
      source: hasLiveSocial
        ? 'sociavault_social_profiles'
        : bundle.socialPresence.source === 'unavailable'
          ? 'unavailable'
          : 'sociavault_ad_library',
    };

    // Prefer LinkedIn-founded years when we already enriched
    const brandAuthority = {
      ...bundle.brandAuthority,
      employeeCount: socialPresence.employeeCount ?? bundle.brandAuthority.employeeCount,
      employeeCountEstimated: socialPresence.employeeCountEstimated ?? true,
      yearsInBusiness: c.brandAuthority?.yearsInBusiness ?? bundle.brandAuthority.yearsInBusiness,
      yearsInBusinessEstimated:
        c.brandAuthority?.yearsInBusinessEstimated ?? bundle.brandAuthority.yearsInBusinessEstimated,
    };

    return {
      ...c,
      confidenceScore: conf.score,
      confidenceBreakdown: conf.breakdown,
      industryMatch: conf.breakdown.industryRelevance,
      serviceMatch: conf.breakdown.serviceRelevance,
      durationClass,
      durationLabel,
      influencePercent: 0,
      brandAuthorityScore: bundle.brandAuthority.brandAuthorityScore,
      socialPresence,
      brandAuthority,
      advertisingStrength: bundle.advertisingStrength,
      marketAuthority: bundle.marketAuthority,
      offerTrustAnalysis: bundle.offerTrustSocialProof,
      aiLearning: bundle.aiLearning,
      advertisingScore: bundle.advertisingStrength.advertisingScore,
      aiLearningValue: bundle.aiLearning.aiLearningValue,
      marketPosition: bundle.brandAuthority.marketPosition,
      competitiveThreat: bundle.brandAuthority.competitiveThreat,
      brandReview,
    };
  });

  scored.sort(
    (a, b) =>
      (b.aiLearningValue ?? 0) - (a.aiLearningValue ?? 0) ||
      (b.confidenceScore ?? 0) - (a.confidenceScore ?? 0) ||
      (b.adDurationDays ?? 0) - (a.adDurationDays ?? 0) ||
      (b.activeAdCount ?? 0) - (a.activeAdCount ?? 0)
  );

  // Claude influence driven by AI Learning Value (not raw confidence alone)
  const weights = normalizeInfluenceWeights(
    scored.map((c) => ({ name: c.name, score: c.aiLearningValue ?? c.confidenceScore ?? 0 }))
  ).map((w) => {
    const profile = scored.find((c) => c.name.toLowerCase() === w.name.toLowerCase());
    return {
      ...w,
      score: profile?.confidenceScore ?? w.score,
      aiLearningValue: profile?.aiLearningValue ?? w.score,
    };
  });
  const weightByName = new Map(weights.map((w) => [w.name.toLowerCase(), w.influencePercent]));
  const withInfluence = scored.map((c) => {
    const influencePercent = weightByName.get(c.name.toLowerCase()) ?? 0;
    return {
      ...c,
      influencePercent,
      aiLearning: c.aiLearning
        ? { ...c.aiLearning, competitorScore: c.confidenceScore ?? 0, influencePercent }
        : c.aiLearning,
    };
  });

  const gallery = adGallery.map((g) => {
    const profile = withInfluence.find((p) => sameCompetitor(p, g));
    if (!profile) return g;
    const successBase =
      (profile.aiLearningValue ?? profile.confidenceScore ?? 0) * 0.55 +
      Math.min(30, (profile.activeAdCount ?? 0) * 1.2) +
      Math.min(15, (profile.adDurationDays ?? 0) / 50);
    return {
      ...g,
      confidenceScore: profile.confidenceScore,
      durationClass: profile.durationClass,
      durationLabel: profile.durationLabel,
      influencePercent: profile.influencePercent,
      industryMatch: profile.industryMatch,
      serviceMatch: profile.serviceMatch,
      brandReview: profile.brandReview ?? g.brandReview,
      adDurationDays: preferLibraryStat(profile.adDurationDays, g.adDurationDays),
      activeAdCount: preferLibraryStat(profile.activeAdCount, g.activeAdCount),
      totalAdCount: preferLibraryStat(profile.totalAdCount, g.totalAdCount),
      firstShown: preferDate(profile.firstShown, g.firstShown, 'earliest'),
      lastShown: preferDate(profile.lastShown, g.lastShown, 'latest'),
      advertiserId: profile.advertiserId || g.advertiserId,
      brandAuthorityScore: profile.brandAuthorityScore,
      socialPresence: profile.socialPresence,
      brandAuthority: profile.brandAuthority,
      advertisingStrength: profile.advertisingStrength,
      marketAuthority: profile.marketAuthority,
      offerTrustAnalysis: profile.offerTrustAnalysis,
      aiLearning: profile.aiLearning,
      advertisingScore: profile.advertisingScore,
      aiLearningValue: profile.aiLearningValue,
      marketPosition: profile.marketPosition,
      competitiveThreat: profile.competitiveThreat,
      cta: g.cta ?? profile.ctas[0],
      offer: g.offer ?? profile.offers[0],
      isActive:
        g.isActive ??
        (g.creativeLastShown
          ? Date.now() - Date.parse(g.creativeLastShown) <= 45 * 24 * 60 * 60 * 1000
          : (profile.activeAdCount ?? 0) > 0),
      estimatedSuccessScore: Math.max(10, Math.min(98, Math.round(successBase))),
    };
  });

  gallery.sort(
    (a, b) =>
      (b.aiLearningValue ?? b.confidenceScore ?? 0) - (a.aiLearningValue ?? a.confidenceScore ?? 0) ||
      (b.adDurationDays ?? 0) - (a.adDurationDays ?? 0) ||
      (b.activeAdCount ?? 0) - (a.activeAdCount ?? 0)
  );

  return {
    competitors: withInfluence,
    adGallery: gallery,
    influenceWeights: weights,
  };
}

function ensureTransparencyLinks(
  intel: CompetitorIntelligence,
  country?: string
): CompetitorIntelligence {
  return {
    ...intel,
    competitors: intel.competitors.map((c) => attachTransparencyLink(c, country)),
    adGallery: (intel.adGallery ?? []).map((g) => attachTransparencyLink(g, country)),
    insights: (intel.insights ?? []).map((insight) => attachTransparencyLink(insight, country)),
  };
}

function hasTransparencyCreatives(intel: CompetitorIntelligence): boolean {
  const ads = intel.adGallery ?? [];
  const withCopy = ads.filter(
    (g) =>
      (g.adSource === 'transparency_center' || g.adSource === 'sociavault') &&
      !g.syntheticCopy &&
      ((g.headlines?.length ?? 0) > 0 || (g.descriptions?.length ?? 0) > 0 || Boolean(g.previewImageUrl))
  );
  // Enough real creatives to skip a second Transparency hydrate (avoids 400 spam on cache hits)
  return withCopy.length >= Math.min(3, Math.max(1, intel.competitors.length));
}

function transparencyAdsToPreviews(
  competitor: { name: string; url: string; advertiserId?: string },
  bundle: NonNullable<Awaited<ReturnType<typeof fetchExactTransparencyAdForCompetitor>>>,
  country?: string
): CompetitorAdPreview[] {
  const advertiserId = bundle.advertiser.advertiserId || competitor.advertiserId;
  const transparencyUrl =
    bundle.advertiser.transparencyUrl || buildTransparencyCenterUrl(advertiserId, country);
  return bundle.allAds
    .filter((ad) => ad.headlines.length || ad.descriptions.length || ad.previewImageUrl)
    .map((ad) => ({
      name: bundle.advertiser.name || competitor.name,
      url: ad.finalUrl?.startsWith('http') ? ad.finalUrl : competitor.url,
      displayUrl: ad.displayUrl ?? displayHostFromUrl(competitor.url),
      headlines: decodeHtmlEntitiesList(ad.headlines ?? []),
      descriptions: decodeHtmlEntitiesList(ad.descriptions ?? []),
      offers: [],
      ctas: [],
      trustSignals: [],
      transparencyUrl,
      creativeUrl: ad.creativeUrl,
      adLink: ad.creativeUrl,
      advertiserName: bundle.advertiser.name,
      advertiserId,
      adSource: 'transparency_center' as const,
      previewImageUrl: ad.previewImageUrl,
      format: ad.format,
      syntheticCopy: false,
      creativeLastShown: ad.lastShown,
      isActive: true,
      activeAdCount: Math.max(1, bundle.allAds.length),
      totalAdCount: bundle.allAds.length,
    }))
    .filter((preview) => !isSyntheticAdCopy(preview.headlines, preview.descriptions, preview.name));
}

/** Fetch live Google Ads Transparency creatives for cached/incomplete rival cards. */
async function hydrateTransparencyCreatives(
  intel: CompetitorIntelligence,
  country: string | undefined,
  opts: { service?: string; keywords?: string[] }
): Promise<CompetitorIntelligence> {
  const targets = intel.competitors.slice(0, 8);
  if (!targets.length) return ensureTransparencyLinks(intel, country);

  const fetched = await Promise.all(
    targets.map(async (competitor) => {
      const advertiserId =
        competitor.advertiserId || advertiserIdFromTransparencyUrl(competitor.transparencyUrl);
      const bundle = await withTimeoutFallback(
        fetchExactTransparencyAdForCompetitor({
          name: competitor.name,
          url: competitor.url,
          country,
          advertiserId,
        }),
        22_000,
        null,
        `transparency-hydrate:${advertiserId ?? competitor.name}`
      );
      return { competitor, bundle };
    })
  );

  const extraAdsByUrl = new Map<string, CompetitorAdPreview[]>();
  const transparencyByUrl = new Map<string, CompetitorAdPreview>();
  const nextCompetitors = intel.competitors.map((c) => ({ ...c }));

  for (const { competitor, bundle } of fetched) {
    const key = competitor.url.toLowerCase() || competitor.name.toLowerCase();
    const advertiserId =
      bundle?.advertiser.advertiserId ||
      competitor.advertiserId ||
      advertiserIdFromTransparencyUrl(competitor.transparencyUrl);
    const transparencyUrl =
      bundle?.advertiser.transparencyUrl ||
      competitor.transparencyUrl ||
      buildTransparencyCenterUrl(advertiserId, country);

    const idx = nextCompetitors.findIndex((c) => sameCompetitor(c, competitor));
    if (idx >= 0) {
      nextCompetitors[idx] = {
        ...nextCompetitors[idx]!,
        advertiserId: advertiserId || nextCompetitors[idx]!.advertiserId,
        transparencyUrl,
      };
    }

    const tcAds = bundle ? transparencyAdsToPreviews(competitor, bundle, country) : [];
    const existing = (intel.adGallery ?? []).filter(
      (g) =>
        sameCompetitor(g, competitor) &&
        !g.syntheticCopy &&
        !isSyntheticAdCopy(g.headlines, g.descriptions, g.name)
    );
    const merged = [...tcAds, ...existing.filter((g) => g.adSource !== 'transparency_center')];
    const seen = new Set<string>();
    const unique: CompetitorAdPreview[] = [];
    for (const ad of merged) {
      const copyKey = `${(ad.headlines ?? []).join('|')}|${(ad.descriptions ?? []).join('|')}`.toLowerCase();
      if (seen.has(copyKey)) continue;
      seen.add(copyKey);
      unique.push(attachTransparencyLink({ ...ad, advertiserId: ad.advertiserId || advertiserId, transparencyUrl: ad.transparencyUrl || transparencyUrl }, country));
    }
    if (unique.length) {
      extraAdsByUrl.set(key, unique);
      transparencyByUrl.set(key, unique[0]!);
    }
  }

  if (opts.service && (extraAdsByUrl.size || transparencyByUrl.size)) {
    await applyLlmRelevanceToFetchedAds({
      extraAdsByUrl,
      transparencyByUrl,
      service: opts.service,
      keywords: opts.keywords ?? [],
    });
  }

  const nextGallery = buildAdGallery(transparencyByUrl, extraAdsByUrl);
  const leftover = (intel.adGallery ?? []).filter((g) => {
    return !nextCompetitors.some((c) => sameCompetitor(c, g));
  });

  console.log(
    `[CompetitorIntel] Transparency hydrate — ${nextGallery.length} live creatives across ${nextCompetitors.length} rivals`
  );

  return ensureTransparencyLinks(
    {
      ...intel,
      competitors: nextCompetitors,
      adGallery: [...nextGallery, ...leftover],
    },
    country
  );
}

export async function analyzeCompetitors(options: {
  businessName: string;
  websiteUrl?: string;
  industry?: string;
  location?: string;
  monthlySpend?: number;
  productsServices?: string[];
  competitorUrls?: string[];
  competitorNames?: string[];
  competitorEntries?: Array<{ name: string; url?: string }>;
  websiteIntel?: WebsiteIntelligence | null;
  currentAd?: { headlines?: string[]; descriptions?: string[] };
  lightweight?: boolean;
  /** When true, discover & keep only competitors for productsServices / primaryService */
  serviceScoped?: boolean;
  primaryService?: string;
  /** Skip social follower enrichment (faster when only ad copy/gallery is needed). */
  skipSocialPresence?: boolean;
  /** Restrict analysis to uploaded document competitors only */
  userProvidedOnly?: boolean;
  /**
   * Prefer competitor creatives matching this Google Ads channel
   * (search / display / video / performance_max / …). Used by Make It Better + create-campaign.
   */
  preferredCampaignType?: string;
  /** Promo/offer text — part of cache key */
  offer?: string;
  /** document | sociavault | auto | both — determines cache bucket and TTL */
  discoverySource?: CompetitorDiscoverySource;
  /** Skip reading/writing competitor discovery cache */
  skipCache?: boolean;
  /** Keyword-cluster terms (Create Campaign) — used in SociaVault / Transparency queries */
  searchKeywords?: string[];
  /** Minimum rivals to discover (Create Campaign uses 5) */
  minCompetitors?: number;
  /** When true, match only the primary service seed + keyword cluster (not sibling services) */
  strictServiceSeed?: boolean;
}): Promise<CompetitorIntelligence> {
  const emptyGap: CompetitorGapAnalysis = {
    rows: [],
    summary: { messagingGaps: 0, offerGaps: 0, keywordGaps: 0, trustSignalGaps: 0, ctaGaps: 0 },
  };
  const empty: CompetitorIntelligence = {
    competitors: [],
    insights: [],
    adGallery: [],
    gapAnalysis: emptyGap,
    keywordOpportunities: [],
    messagingOpportunities: [],
    missingOffers: [],
    competitiveAdvantages: [],
    missingFromYourAds: [],
    source: 'unavailable',
  };

  const country = resolveMarketCountry({
    location: options.location,
    websiteUrl: options.websiteUrl,
  });
  const effectiveLocation =
    options.location?.trim() ||
    countryToLocationLabel(country) ||
    options.location;

  const cacheLookup = {
    websiteUrl: options.websiteUrl,
    businessName: options.businessName,
    primaryService: options.primaryService,
    productsServices: options.productsServices,
    offer: options.offer,
    discoverySource: options.discoverySource,
    country: country ?? 'au',
    preferredCampaignType: options.preferredCampaignType,
    userProvidedOnly: options.userProvidedOnly,
    competitorUrls: options.competitorUrls,
    competitorNames: options.competitorNames,
    competitorEntries: options.competitorEntries,
    skipCache: options.skipCache,
    searchKeywords: options.searchKeywords,
    strictServiceSeed: options.strictServiceSeed,
  };

  if (!options.skipCache) {
    const cached = await getCachedCompetitorDiscovery(cacheLookup);
    if (cached) {
      const filtered = filterCompetitorIntelligenceForMarket(
        cached,
        options.websiteUrl,
        country
      );
      const serviceLabel = options.primaryService ?? options.productsServices?.[0];
      const displayableCached = (filtered.competitors ?? []).filter(
        (c) => !looksLikeQueryNotAdvertiser(c.name, serviceLabel)
      );
      if (hasUsableCompetitorIntel(filtered) && displayableCached.length > 0) {
        console.log(
          `[CompetitorIntel] cache hit (${country ?? 'global'}) — ${filtered.competitors.length} regional English rivals`
        );
        let hydrated = ensureTransparencyLinks(
          {
            ...filtered,
            competitors: displayableCached,
            adGallery: (filtered.adGallery ?? []).filter(
              (g) => !looksLikeQueryNotAdvertiser(g.advertiserName ?? g.name, serviceLabel)
            ),
          },
          country
        );
        if (!hasTransparencyCreatives(hydrated)) {
          hydrated = await hydrateTransparencyCreatives(hydrated, country, {
            service: options.primaryService ?? options.productsServices?.[0],
            keywords: options.searchKeywords,
          });
          if (hasUsableCompetitorIntel(hydrated)) {
            await setCachedCompetitorDiscovery(cacheLookup, hydrated);
          }
        }
        return hydrated;
      }
      if ((filtered.competitors?.length ?? 0) > 0 && displayableCached.length === 0) {
        console.log(
          '[CompetitorIntel] cache hit skipped — query/course titles only, fetching live rivals'
        );
      } else {
        console.log('[CompetitorIntel] cache hit rejected — wrong region or non-English ads');
      }
    }
  }

  const scopedServiceList = [
    ...(options.primaryService ? [options.primaryService] : []),
    ...(options.productsServices ?? []),
  ].filter(Boolean);
  const uniqueScoped = [...new Set(scopedServiceList.map((s) => s.trim()).filter(Boolean))];
  const neededRivals = Math.max(MIN_COMPETITORS, options.minCompetitors ?? MIN_COMPETITORS);
  // Create Campaign only: hide rivals without an LLM-approved same-service ad.
  // Make It Better is lightweight and must still show library-backed competitors.
  const requireLlmApprovedAds = Boolean(options.strictServiceSeed) && !options.lightweight;
  const serviceTermsForMatch =
    options.serviceScoped && uniqueScoped.length
      ? options.strictServiceSeed && options.primaryService
        ? [options.primaryService]
        : uniqueScoped.slice(0, 4)
      : [];
  const seedKeywords = (() => {
    const service = options.primaryService ?? uniqueScoped[0] ?? '';
    const raw = (options.searchKeywords ?? [])
      .map((k) => k.trim())
      .filter((k) => k.length >= 3);
    const filtered = service ? filterSeedKeywordsForService(service, raw) : raw;
    if (filtered.length) return filtered;
    return service ? [service] : raw;
  })();
  const serviceSeedOption =
    options.strictServiceSeed && (options.primaryService ?? uniqueScoped[0])
      ? {
          service: options.primaryService ?? uniqueScoped[0]!,
          seedKeywords,
        }
      : undefined;
  const extraAdsByUrl = new Map<string, CompetitorAdPreview[]>();

  const scopedWebsiteIntel =
    options.serviceScoped && uniqueScoped.length
      ? options.websiteIntel
        ? {
            ...options.websiteIntel,
            services: uniqueScoped.slice(0, 6),
            headings: uniqueScoped.slice(0, 4),
            // Prevent site-wide nav labels (Mortgage / Home Loans) from leaking into search queries
            title: uniqueScoped[0] ?? options.websiteIntel.title,
            metaDescription: uniqueScoped.slice(0, 2).join(', '),
            rawTextSample: uniqueScoped.join(' '),
          }
        : {
            url: options.websiteUrl ?? '',
            fetched: false,
            headings: uniqueScoped.slice(0, 4),
            offers: [],
            services: uniqueScoped.slice(0, 6),
            ctas: [],
            locations: options.location ? [options.location] : [],
            usps: [],
            trustSignals: [],
            rawTextSample: uniqueScoped.join(' '),
          }
      : options.websiteIntel;

  const discoveryProducts =
    options.serviceScoped && uniqueScoped.length
      ? options.strictServiceSeed && options.primaryService
        ? [options.primaryService]
        : uniqueScoped.slice(0, 4)
      : options.productsServices;

  const businessContext = inferBusinessContext({
    monthlySpend: options.monthlySpend,
    location: effectiveLocation,
    industry: options.industry,
    productsServices: discoveryProducts,
    websiteIntel: scopedWebsiteIntel,
  });

  if (options.serviceScoped) {
    console.log(
      `[CompetitorIntel] Service-scoped discovery for: ${uniqueScoped.slice(0, 4).join(' | ') || 'n/a'}`
    );
  }

  const targets = await resolveCompetitorTargets({
    businessName: options.businessName,
    websiteUrl: options.websiteUrl,
    industry: options.industry,
    location: effectiveLocation,
    productsServices: discoveryProducts,
    competitorUrls: options.competitorUrls,
    competitorNames: options.competitorNames,
    competitorEntries: options.competitorEntries,
    monthlySpend: options.monthlySpend,
    websiteIntel: scopedWebsiteIntel,
    country,
    lightweight: options.lightweight,
    serviceScoped: options.serviceScoped,
    userProvidedOnly: options.userProvidedOnly,
    searchKeywords: options.searchKeywords,
    minCompetitors: options.minCompetitors,
    strictServiceSeed: options.strictServiceSeed,
  });

  if (!targets.length) return empty;

  if (options.userProvidedOnly) {
    console.log(
      `[CompetitorIntel] Uploaded-document mode: ${targets.length} competitor(s) from file`
    );
  }

  const crawlTimeout = options.lightweight ? 4_000 : 7_000;
  const competitors: CompetitorProfile[] = await Promise.all(
    targets.map(async (t) => {
      const site = await withTimeoutFallback(
        analyzeWebsite(t.url),
        crawlTimeout,
        null,
        `competitor-crawl:${t.url}`
      );
      let profile = profileFromWebsite(t.name, t.url, site);
      // Seed SociaVault activity from discovery so ranking prefers real advertisers early
      if (t.activity && t.activity.totalAdCount > 0) {
        profile = {
          ...profile,
          adDurationDays: t.activity.adDurationDays,
          activeAdCount: t.activity.activeAdCount,
          totalAdCount: t.activity.totalAdCount,
          firstShown: t.activity.firstShown,
          lastShown: t.activity.lastShown,
        };
      }
      return {
        ...profile,
        brandReview: buildBrandReview(profile, t.activity),
      };
    })
  );

  const clientSite: WebsiteIntelligence = scopedWebsiteIntel ?? {
    url: options.websiteUrl ?? '',
    fetched: false,
    headings: [],
    offers: [],
    services: discoveryProducts ?? [],
    ctas: [],
    locations: options.location ? [options.location] : [],
    usps: [],
    trustSignals: [],
    rawTextSample: '',
  };
  const clientKeywords = new Set(extractKeywordsFromSite(clientSite));

  // Rank by service match + known SociaVault activity (duration / active / brand)
  const relevanceScored = competitors
    .map((c, i) => ({
      profile: c,
      target: targets[i]!,
      relevance: scoreCompetitorRelevance(c, {
        industry: options.industry,
        productsServices: discoveryProducts,
        clientKeywords,
        businessContext,
      }),
      serviceScore: serviceTermsForMatch.length
        ? scoreServiceTextMatch(
            [c.name, c.url, ...c.services, ...c.headlines, ...c.descriptions].join(' '),
            serviceTermsForMatch
          )
        : 50,
    }))
    .filter((x) => {
      if (!serviceTermsForMatch.length) return true;
      if (advertiserConflictsWithService(x.profile.name, x.profile.url, serviceTermsForMatch)) {
        console.log(
          `[CompetitorIntel] pre-select drop conflict: ${x.profile.name} vs "${serviceTermsForMatch[0]}"`
        );
        return false;
      }
      return true;
    })
    .sort((a, b) => {
      // Ad-scoped: service match first, then ad activity
      if (serviceTermsForMatch.length) {
        return (
          b.serviceScore - a.serviceScore ||
          b.relevance - a.relevance ||
          (b.profile.adDurationDays ?? 0) - (a.profile.adDurationDays ?? 0) ||
          (b.profile.activeAdCount ?? 0) - (a.profile.activeAdCount ?? 0) ||
          (b.profile.totalAdCount ?? 0) - (a.profile.totalAdCount ?? 0)
        );
      }
      return (
        (b.profile.totalAdCount ?? 0) - (a.profile.totalAdCount ?? 0) ||
        (b.profile.adDurationDays ?? 0) - (a.profile.adDurationDays ?? 0) ||
        (b.profile.activeAdCount ?? 0) - (a.profile.activeAdCount ?? 0) ||
        b.relevance - a.relevance ||
        (b.profile.brandReview?.score ?? 0) - (a.profile.brandReview?.score ?? 0)
      );
    });

  // Prefer targets that already have SociaVault ads; cast a wide net when service-scoped
  // because many high-volume multi-product advertisers will be dropped after creative match.
  // Uploaded-document mode: keep every extracted competitor (up to 20).
  const selectPool = options.userProvidedOnly
    ? Math.min(20, Math.max(targets.length, relevanceScored.length))
    : serviceTermsForMatch.length
      ? 18
      : 6;
  let selected = options.userProvidedOnly
    ? relevanceScored.slice(0, selectPool)
    : relevanceScored.filter((x) => (x.profile.totalAdCount ?? 0) > 0).slice(0, selectPool);
  if (!options.userProvidedOnly && selected.length < MIN_COMPETITORS) {
    const extras = relevanceScored
      .filter((x) => !(x.profile.totalAdCount ?? 0))
      .slice(0, MIN_COMPETITORS - selected.length + 1);
    selected = [...selected, ...extras];
  }
  selected = selected.slice(0, selectPool);

  let filteredTargets = selected.map((x) => x.target);
  let filteredCompetitors = selected.map((x) => x.profile);

  const transparencyByUrl = new Map<string, CompetitorAdPreview>();
  let transparencyHits = 0;

  // PARALLEL SociaVault fetches — sequential was timing out before metrics landed
  const fetchResults = await Promise.all(
    filteredTargets.map(async (target, i) => {
      const websiteProfile = filteredCompetitors[i]!;
      try {
        const result = await withTimeout(
          fetchCompetitorGalleryForTarget(
            target,
            country,
            websiteProfile,
            serviceTermsForMatch.length ? serviceTermsForMatch : undefined,
            serviceSeedOption
          ),
          options.lightweight ? 55_000 : 50_000,
          `competitor-gallery:${target.url}`
        );
        return { i, target, result };
      } catch {
        return { i, target, result: null };
      }
    })
  );

  for (const { i, target, result } of fetchResults) {
    if (!result) continue;
    const dedupeKey = galleryDedupeKey(result.preview);
    const already = [...transparencyByUrl.values()].some((g) => galleryDedupeKey(g) === dedupeKey);
    if (already) continue;
    storeGalleryFetchResult(target.url, result, transparencyByUrl, extraAdsByUrl);
    filteredCompetitors[i] = result.profile;
    transparencyHits += 1;
  }

  let llmRelevanceApplied = false;
  if (!options.userProvidedOnly && (serviceTermsForMatch.length || seedKeywords.length)) {
    llmRelevanceApplied = await applyLlmRelevanceToFetchedAds({
      extraAdsByUrl,
      transparencyByUrl,
      service: options.primaryService ?? serviceTermsForMatch[0] ?? '',
      keywords: seedKeywords,
    });
  }

  // Prefer SociaVault library presence; keep ≥ MIN_COMPETITORS even when creative match is soft
  const preferLocalTld = /\baustralia\b|\bau\b|sydney|melbourne|brisbane|perth|adelaide/i.test(
    options.location ?? ''
  );
  const locationCity =
    (options.location ?? '').match(
      /\b(melbourne|sydney|brisbane|perth|adelaide|canberra|hobart|gold coast)\b/i
    )?.[1]?.toLowerCase() ?? '';
  type LibraryRow = {
    target: (typeof filteredTargets)[number];
    profile: CompetitorProfile;
    preview: CompetitorAdPreview | undefined;
  };
  const libraryPool: LibraryRow[] = filteredTargets.map((target, i) => ({
    target,
    profile: filteredCompetitors[i]!,
    preview: transparencyByUrl.get(target.url.toLowerCase()),
  }));

  const advertiserLlmScores = new Map<string, { relevant: boolean; score: number }>();
  if (libraryPool.length && (serviceTermsForMatch.length || seedKeywords.length) && !options.userProvidedOnly) {
    const scored = await scoreAdvertisersForService(
      libraryPool.map((x, i) => ({
        id: String(i),
        name: x.profile.name,
        url: x.profile.url || x.target.url,
        headlines: x.preview?.headlines ?? x.profile.headlines,
        descriptions: x.preview?.descriptions ?? x.profile.descriptions,
      })),
      {
        service: options.primaryService ?? serviceTermsForMatch[0] ?? '',
        keywords: seedKeywords,
      }
    );
    libraryPool.forEach((x, i) => {
      const row = scored.get(String(i));
      if (row) advertiserLlmScores.set(competitorIdentityKey(x.profile), row);
    });
    console.log(
      `[CompetitorIntel] LLM advertiser scoring: ${[...advertiserLlmScores.values()].filter((r) => r.relevant).length}/${libraryPool.length} related to "${options.primaryService ?? serviceTermsForMatch[0]}"`
    );
  }

  const hasLibraryPresence = (x: LibraryRow) =>
    (x.profile.totalAdCount ?? 0) > 0 ||
    (x.preview?.totalAdCount ?? 0) > 0 ||
    Boolean(x.preview) ||
    Boolean(x.profile.advertiserId) ||
    Boolean(x.target.advertiserId);

  const regionMatchScore = (x: LibraryRow): number => {
    if (!locationCity) return 0;
    const blob = [
      x.profile.name,
      x.profile.url,
      x.target.name,
      ...(x.preview?.headlines ?? x.profile.headlines),
      ...(x.preview?.descriptions ?? x.profile.descriptions),
    ]
      .join(' ')
      .toLowerCase();
    if (blob.includes(locationCity)) return 3;
    // Same state aliases
    if (locationCity === 'melbourne' && /\bvic\b|victoria/i.test(blob)) return 2;
    if (locationCity === 'sydney' && /\bnsw\b/i.test(blob)) return 2;
    if (locationCity === 'brisbane' && /\bqld\b|queensland/i.test(blob)) return 2;
    return 0;
  };

  const sortLibraryRows = (rows: LibraryRow[]) =>
    [...rows].sort((a, b) => {
      const aRegion = regionMatchScore(a);
      const bRegion = regionMatchScore(b);
      const aAu =
        preferLocalTld && /\.com\.au\b/i.test(a.target.url || a.profile.url || '') ? 1 : 0;
      const bAu =
        preferLocalTld && /\.com\.au\b/i.test(b.target.url || b.profile.url || '') ? 1 : 0;
      const aSvc = serviceTermsForMatch.length
        ? scoreServiceTextMatch(
            [
              a.profile.name,
              a.profile.url,
              ...(a.preview?.headlines ?? a.profile.headlines),
              ...(a.preview?.descriptions ?? a.profile.descriptions),
            ].join(' '),
            serviceTermsForMatch
          )
        : 50;
      const bSvc = serviceTermsForMatch.length
        ? scoreServiceTextMatch(
            [
              b.profile.name,
              b.profile.url,
              ...(b.preview?.headlines ?? b.profile.headlines),
              ...(b.preview?.descriptions ?? b.profile.descriptions),
            ].join(' '),
            serviceTermsForMatch
          )
        : 50;
      return (
        bRegion - aRegion ||
        bSvc - aSvc ||
        bAu - aAu ||
        (b.profile.adDurationDays ?? b.preview?.adDurationDays ?? 0) -
          (a.profile.adDurationDays ?? a.preview?.adDurationDays ?? 0) ||
        (b.profile.activeAdCount ?? b.preview?.activeAdCount ?? 0) -
          (a.profile.activeAdCount ?? a.preview?.activeAdCount ?? 0) ||
        (b.profile.totalAdCount ?? b.preview?.totalAdCount ?? 0) -
          (a.profile.totalAdCount ?? a.preview?.totalAdCount ?? 0) ||
        (b.profile.brandReview?.score ?? 0) - (a.profile.brandReview?.score ?? 0)
      );
    });

  const strictMatches = libraryPool.filter((x) => {
    if (!hasLibraryPresence(x)) return false;
    // Uploaded competitors: keep them even if creative doesn't match the ad's service lock
    if (options.userProvidedOnly) return true;
    if (!serviceTermsForMatch.length) return true;
    if (looksLikeQueryNotAdvertiser(x.profile.name, serviceTermsForMatch[0])) {
      console.log(`[CompetitorIntel] drop ${x.profile.name}: query/service title, not an advertiser`);
      return false;
    }
    if (looksLikeNonCommercialAdvertiser(x.profile.name, x.profile.url || x.target.url)) {
      console.log(`[CompetitorIntel] drop ${x.profile.name}: non-commercial (edu/gov/association)`);
      return false;
    }
    if (advertiserConflictsWithService(x.profile.name, x.profile.url, serviceTermsForMatch)) {
      console.log(
        `[CompetitorIntel] drop ${x.profile.name}: advertiser conflicts with "${serviceTermsForMatch[0]}"`
      );
      return false;
    }
    const extras = extraAdsByUrl.get(x.target.url.toLowerCase()) ?? [];
    const previewsToCheck = [...extras, ...(x.preview ? [x.preview] : [])];
    const hasOnServiceAd = previewsToCheck.some(
      (p) =>
        typeof p.keywordRelevanceScore === 'number' &&
        p.keywordRelevanceScore >= AD_RELEVANCE_THRESHOLD
    );

    const llmAdvertiser = advertiserLlmScores.get(competitorIdentityKey(x.profile));
    if (
      requireLlmApprovedAds &&
      llmAdvertiser &&
      !(llmAdvertiser.relevant && llmAdvertiser.score >= AD_RELEVANCE_THRESHOLD)
    ) {
      console.log(
        `[CompetitorIntel] drop ${x.profile.name}: LLM says not related to "${serviceTermsForMatch[0]}" (${llmAdvertiser.score})`
      );
      return false;
    }

    // Create Campaign: keep only rivals with at least one same-service ad
    if (requireLlmApprovedAds) {
      if (hasOnServiceAd) return true;
      console.log(
        `[CompetitorIntel] drop ${x.profile.name}: no LLM-approved "${serviceTermsForMatch[0]}" ad`
      );
      return false;
    }

    if (options.serviceScoped && llmRelevanceApplied && hasOnServiceAd) return true;

    if (hasLibraryPresence(x) || previewsToCheck.length) return true;
    console.log(
      `[CompetitorIntel] drop ${x.profile.name}: no library ads for "${serviceTermsForMatch[0]}"`
    );
    return false;
  });

  // Soft fill: pad toward target count with library-backed rivals (Claude-scored when available)
  let withLibraryAds = sortLibraryRows(strictMatches);
  if (
    !options.userProvidedOnly &&
    !options.strictServiceSeed &&
    serviceTermsForMatch.length &&
    withLibraryAds.length < neededRivals
  ) {
    const used = new Set(withLibraryAds.map((x) => competitorIdentityKey(x.profile)));
    const soft = sortLibraryRows(
      libraryPool.filter((x) => {
        if (used.has(competitorIdentityKey(x.profile))) return false;
        if (!hasLibraryPresence(x)) return false;
        if (looksLikeEducationalCompetitorName(x.profile.name)) return false;
        if (advertiserConflictsWithService(x.profile.name, x.profile.url, serviceTermsForMatch)) {
          return false;
        }
        const llm = advertiserLlmScores.get(competitorIdentityKey(x.profile));
        if (llm) return llm.relevant || llm.score >= AD_RELEVANCE_THRESHOLD;
        const extras = extraAdsByUrl.get(x.target.url.toLowerCase()) ?? [];
        if (x.preview || extras.length) return true;
        return (x.profile.totalAdCount ?? 0) > 0;
      })
    ).slice(0, neededRivals - withLibraryAds.length);
    if (soft.length) {
      console.log(
        `[CompetitorIntel] soft-fill ${soft.length} rival(s) to hit target=${neededRivals}:`,
        soft.map((x) => x.profile.name)
      );
      withLibraryAds = [...withLibraryAds, ...soft];
    }
  }

  // Uploaded-document mode: always keep every uploaded rival (even without library ads yet)
  if (options.userProvidedOnly && withLibraryAds.length < libraryPool.length) {
    const used = new Set(withLibraryAds.map((x) => competitorIdentityKey(x.profile)));
    const missing = libraryPool.filter((x) => !used.has(competitorIdentityKey(x.profile)));
    withLibraryAds = [...withLibraryAds, ...missing];
  }

  if (withLibraryAds.length === 0 && libraryPool.length && !options.userProvidedOnly) {
    const llmKept = libraryPool.filter((x) => {
      if (looksLikeEducationalCompetitorName(x.profile.name)) return false;
      if (
        serviceTermsForMatch.length &&
        advertiserConflictsWithService(x.profile.name, x.profile.url, serviceTermsForMatch)
      ) {
        return false;
      }
      const llm = advertiserLlmScores.get(competitorIdentityKey(x.profile));
      if (llm) return llm.relevant || llm.score >= AD_RELEVANCE_THRESHOLD;
      return hasLibraryPresence(x);
    });
    if (llmKept.length) {
      console.log(
        `[CompetitorIntel] keeping ${llmKept.length} Transparency/LLM rival(s) without SociaVault metrics`
      );
      withLibraryAds = sortLibraryRows(llmKept);
    }
  }

  if (withLibraryAds.length > 0) {
    // Prefer same level or one level above the client (helps ads without drowning out peers)
    const levelFiltered =
      options.userProvidedOnly || !serviceTermsForMatch.length
        ? withLibraryAds
        : withLibraryAds.filter((x) => {
            const text = [
              x.profile.name,
              x.profile.url,
              ...(x.preview?.headlines ?? x.profile.headlines),
              ...(x.preview?.descriptions ?? x.profile.descriptions),
            ].join(' ');
            const competitorLevel = inferCompetitorLevelFromText(text, x.profile.services?.length ?? 0);
            return isSameOrOneLevelAbove(businessContext.level, competitorLevel);
          });
    const levelPool =
      options.userProvidedOnly || levelFiltered.length >= MIN_COMPETITORS
        ? levelFiltered
        : withLibraryAds;
    if (
      !options.userProvidedOnly &&
      serviceTermsForMatch.length &&
      levelFiltered.length < withLibraryAds.length
    ) {
      console.log(
        `[CompetitorIntel] level filter: ${levelFiltered.length}/${withLibraryAds.length} same-or-one-above (using ${levelPool.length})`
      );
    }

    // Always surface more rivals for the wizard when available (Claude filters quality)
    // Uploaded list: keep all extracted competitors. Auto discovery: up to 14.
    const top = options.userProvidedOnly
      ? levelPool.slice(0, Math.min(20, levelPool.length))
      : levelPool.slice(
          0,
          Math.max(
            Math.max(MIN_COMPETITORS, options.minCompetitors ?? MIN_COMPETITORS),
            Math.min(14, levelPool.length)
          )
        );
    filteredTargets = top.map((x) => x.target);
    filteredCompetitors = top.map((x) => x.profile);
    const preservedExtras = new Map(extraAdsByUrl);
    transparencyByUrl.clear();
    extraAdsByUrl.clear();
    for (const x of top) {
      const urlKey = x.target.url.toLowerCase();
      if (x.preview) {
        transparencyByUrl.set(urlKey, x.preview);
      } else {
        // Discovery had metrics but OCR/gallery fetch missed — still surface activity in UI
        const seeded = profileToGalleryPreview(x.profile, x.target);
        seeded.adSource = 'sociavault';
        seeded.adDurationDays = x.profile.adDurationDays ?? 0;
        seeded.activeAdCount = x.profile.activeAdCount ?? 0;
        seeded.totalAdCount = x.profile.totalAdCount ?? 0;
        seeded.firstShown = x.profile.firstShown;
        seeded.lastShown = x.profile.lastShown;
        seeded.brandReview = x.profile.brandReview;
        transparencyByUrl.set(urlKey, seeded);
      }
      const extras = preservedExtras.get(urlKey);
      if (extras?.length) extraAdsByUrl.set(urlKey, extras);
    }
    console.log(
      `[competitors] selected ${top.length} SociaVault-backed rivals:`,
      top.map(
        (x) =>
          `${x.profile.name} (duration=${x.profile.adDurationDays ?? 0}d, active=${x.profile.activeAdCount ?? 0}, total=${x.profile.totalAdCount ?? 0}, brand=${x.profile.brandReview?.score ?? 0})`
      )
    );
  } else if (options.userProvidedOnly) {
    // Keep uploaded rivals even when SociaVault returned no library metrics yet
    console.warn(
      '[competitors] uploaded competitors had no SociaVault library hits — keeping file list for Insights / Engine'
    );
    filteredTargets = relevanceScored.map((x) => x.target);
    filteredCompetitors = relevanceScored.map((x) => x.profile);
  } else if (isSociaVaultCreditsExhausted() || !isSociaVaultConfigured()) {
    console.warn(
      '[competitors] ad library unavailable — skipping empty recovery so Transparency/LLM rivals can display'
    );
  } else {
    // Do NOT keep Claude-invented domains with 0 library metrics — they render as zeros in Make It Better
    console.warn(
      '[competitors] no SociaVault library hits on first pass — retrying discovery by advertiser name'
    );
    filteredTargets = [];
    filteredCompetitors = [];
    transparencyByUrl.clear();
    extraAdsByUrl.clear();

    // Aggressive recovery: search SociaVault by seed keywords (strict) or name queries
    // Skip on lightweight — recovery alone can exceed the Make This Ad Better UI poll window
    if (isSociaVaultConfigured() && !options.lightweight) {
      const nameQueries = options.strictServiceSeed
        ? prioritizeMarketQueries(
            [
              ...(options.primaryService
                ? expandServiceSearchQueries([options.primaryService], options.location)
                : []),
              ...(options.primaryService ? [options.primaryService] : []),
              ...buildKeywordClusterQueries(seedKeywords, options.location),
            ],
            options.location
          )
        : [
            ...relevanceScored.slice(0, 6).map((x) => x.target.name),
            ...buildCompetitorSearchQueries(businessContext, options.businessName),
          ].filter(Boolean);
      const recovered = (
        await discoverSociaVaultCompetitors({
          siteUrl: options.websiteUrl || options.businessName,
          searchQueries: [...new Set(nameQueries)].slice(0, 10),
          region: country,
          maxCount: neededRivals + 6,
          maxEmptyQueries: 2,
        })
      ).filter((t) => {
        if (isLikelyArticleAdvertiser(t.name)) {
          console.log(`[competitors] recovery skip article-like name: ${t.name}`);
          return false;
        }
        if (looksLikeNonCommercialAdvertiser(t.name, t.url)) {
          console.log(`[competitors] recovery skip non-commercial: ${t.name}`);
          return false;
        }
        if (looksLikeQueryNotAdvertiser(t.name, options.primaryService)) return false;
        if (country && !competitorUrlMatchesCountry(t.url, country)) return false;
        return t.activity.totalAdCount > 0;
      });

      if (recovered.length) {
        const recoverFetches = await Promise.all(
          recovered.slice(0, neededRivals + 4).map(async (t) => {
            const site = await withTimeoutFallback(
              analyzeWebsite(t.url),
              crawlTimeout,
              null,
              `competitor-crawl-recover:${t.url}`
            );
            let profile = profileFromWebsite(t.name, t.url, site);
            profile = {
              ...profile,
              adDurationDays: t.activity.adDurationDays,
              activeAdCount: t.activity.activeAdCount,
              totalAdCount: t.activity.totalAdCount,
              firstShown: t.activity.firstShown,
              lastShown: t.activity.lastShown,
              brandReview: buildBrandReview(profile, t.activity),
            };
            try {
              const result = await withTimeout(
                fetchCompetitorGalleryForTarget(
                  { name: t.name, url: t.url, advertiserId: t.advertiserId },
                  country,
                  profile,
                  serviceTermsForMatch.length ? serviceTermsForMatch : undefined,
                  serviceSeedOption
                ),
                55_000,
                `competitor-gallery-recover:${t.url}`
              );
              return { target: { name: t.name, url: t.url, activity: t.activity, advertiserId: t.advertiserId }, profile, result };
            } catch {
              return {
                target: { name: t.name, url: t.url, activity: t.activity },
                profile,
                result: null as Awaited<ReturnType<typeof fetchCompetitorGalleryForTarget>>,
              };
            }
          })
        );

        for (const row of recoverFetches) {
          if (isLikelyArticleAdvertiser(row.target.name)) continue;

          const strictLabel = options.primaryService ?? serviceTermsForMatch[0] ?? '';
          if (options.strictServiceSeed && strictLabel) {
            const matchingAds = row.result?.allPreviews ?? [];
            const previewOk =
              row.result?.preview &&
              adMatchesServiceAndSeeds(
                {
                  headlines: row.result.preview.headlines,
                  descriptions: row.result.preview.descriptions,
                },
                strictLabel,
                seedKeywords
              );
            if (!matchingAds.length && !previewOk) {
              console.log(
                `[competitors] recovery drop ${row.target.name}: no "${strictLabel}" seed-matched ads`
              );
              continue;
            }
          }

          if ((row.profile.totalAdCount ?? 0) <= 0 && (row.result?.profile.totalAdCount ?? 0) <= 0) {
            continue;
          }
          const profile = row.result?.profile ?? row.profile;
          const preview =
            row.result?.preview ??
            (() => {
              const seeded = profileToGalleryPreview(profile, row.target);
              seeded.adSource = 'sociavault';
              seeded.adDurationDays = profile.adDurationDays ?? 0;
              seeded.activeAdCount = profile.activeAdCount ?? 0;
              seeded.totalAdCount = profile.totalAdCount ?? 0;
              seeded.firstShown = profile.firstShown;
              seeded.lastShown = profile.lastShown;
              seeded.brandReview = profile.brandReview;
              return seeded;
            })();
          if ((preview.totalAdCount ?? 0) <= 0 && !(row.result?.allPreviews?.length ?? 0)) continue;
          filteredTargets.push(row.target);
          filteredCompetitors.push(profile);
          if (row.result) {
            storeGalleryFetchResult(row.target.url, row.result, transparencyByUrl, extraAdsByUrl);
          } else {
            transparencyByUrl.set(row.target.url.toLowerCase(), preview);
          }
          transparencyHits += 1;
        }

        if (filteredTargets.length) {
          console.log(
            `[competitors] recovery found ${filteredTargets.length} SociaVault-backed rivals:`,
            filteredCompetitors.map(
              (p) =>
                `${p.name} (duration=${p.adDurationDays ?? 0}d, active=${p.activeAdCount ?? 0}, total=${p.totalAdCount ?? 0})`
            )
          );
        }
      }
    }

    if (!filteredTargets.length) {
      console.warn(
        options.lightweight
          ? '[competitors] no SociaVault library hits (lightweight — skip long recovery)'
          : '[competitors] SociaVault recovery failed — returning empty competitor intelligence (no zero stubs)'
      );
    }
  }

  const serviceLabel = serviceTermsForMatch[0] ?? options.primaryService ?? '';
  const commercialPairs = filteredTargets
    .map((t, i) => ({ t, c: filteredCompetitors[i] }))
    .filter(({ t, c }) => {
      const name = c?.name ?? t.name;
      return (
        !looksLikeQueryNotAdvertiser(name, serviceLabel) &&
        !looksLikeNonCommercialAdvertiser(name, t.url)
      );
    });
  if (commercialPairs.length < filteredTargets.length) {
    console.log(
      `[competitors] dropped ${filteredTargets.length - commercialPairs.length} non-commercial library hit(s) — continuing search`
    );
    filteredTargets = commercialPairs.map((x) => x.t);
    filteredCompetitors = commercialPairs.map((x) => x.c).filter((c): c is NonNullable<typeof c> => Boolean(c));
  }

  // Only skip extra search when we already have commercial (displayable) rivals
  const enoughToReturn =
    Boolean(options.minCompetitors) && filteredTargets.length >= Math.min(6, neededRivals);
  if (enoughToReturn) {
    console.log(
      `[competitors] ${filteredTargets.length} commercial rival(s) — skipping extra library search so results reach the UI`
    );
  }

  // Create Campaign (minCompetitors set): keep searching until we hit the target, including strict mode
  if (
    !options.userProvidedOnly &&
    serviceTermsForMatch.length &&
    isSociaVaultConfigured() &&
    filteredTargets.length < neededRivals &&
    !enoughToReturn
  ) {
    const needed = neededRivals - filteredTargets.length;
    console.log(
      `[competitors] service backfill: have ${filteredTargets.length}, need ${needed} more for "${serviceTermsForMatch[0]}"`
    );
    const used = new Set(filteredTargets.map((t) => t.url.toLowerCase()));
    const backfillQueries = [
      ...expandServiceSearchQueries(serviceTermsForMatch, options.location),
      ...buildCompetitorSearchQueries(businessContext, options.businessName),
    ];
    const uniqueBackfill = [...new Set(backfillQueries.map((q) => q.trim()).filter(Boolean))].slice(
      0,
      options.lightweight ? 3 : 8
    );
    const recovered = await discoverSociaVaultCompetitors({
      siteUrl: options.websiteUrl || options.businessName,
      searchQueries: uniqueBackfill,
      region: country,
      maxCount: neededRivals + 6,
      maxEmptyQueries: options.lightweight ? 2 : 0,
    });

    const candidates = recovered
      .filter((t) => {
        if (used.has(t.url.toLowerCase())) return false;
        if (t.activity.totalAdCount <= 0) return false;
        if (looksLikeNonCommercialAdvertiser(t.name, t.url)) return false;
        if (looksLikeQueryNotAdvertiser(t.name, serviceTermsForMatch[0])) return false;
        if (advertiserConflictsWithService(t.name, t.url, serviceTermsForMatch)) return false;
        return true;
      })
      .sort(
        (a, b) =>
          scoreServiceTextMatch(`${b.name} ${b.url}`, serviceTermsForMatch) -
            scoreServiceTextMatch(`${a.name} ${a.url}`, serviceTermsForMatch) ||
          b.activity.adDurationDays - a.activity.adDurationDays
      )
      .slice(0, 8);

    for (const t of candidates) {
      if (filteredTargets.length >= neededRivals) break;
      if (used.has(t.url.toLowerCase())) continue;

      const site = await withTimeoutFallback(
        analyzeWebsite(t.url),
        crawlTimeout,
        null,
        `competitor-crawl-backfill:${t.url}`
      );
      let profile = profileFromWebsite(t.name, t.url, site);
      profile = {
        ...profile,
        adDurationDays: t.activity.adDurationDays,
        activeAdCount: t.activity.activeAdCount,
        totalAdCount: t.activity.totalAdCount,
        firstShown: t.activity.firstShown,
        lastShown: t.activity.lastShown,
        brandReview: buildBrandReview(profile, t.activity),
      };

      let result: Awaited<ReturnType<typeof fetchCompetitorGalleryForTarget>> = null;
      try {
        result = await withTimeout(
          fetchCompetitorGalleryForTarget(
            { name: t.name, url: t.url },
            country,
            profile,
            serviceTermsForMatch
          ),
          40_000,
          `competitor-gallery-backfill:${t.url}`
        );
      } catch {
        result = null;
      }

      if (!result?.preview) {
        console.log(
          `[competitors] backfill skip ${t.name}: no service-matched "${serviceTermsForMatch[0]}" creative`
        );
        continue;
      }
      if (
        !creativeMatchesTargetService(
          {
            headlines: result.preview.headlines,
            descriptions: result.preview.descriptions,
          },
          serviceTermsForMatch
        )
      ) {
        continue;
      }

      used.add(t.url.toLowerCase());
      filteredTargets.push({ name: t.name, url: t.url, activity: t.activity });
      filteredCompetitors.push(result.profile);
      transparencyByUrl.set(t.url.toLowerCase(), result.preview);
      transparencyHits += 1;
      console.log(
        `[competitors] backfill added ${t.name} (${filteredTargets.length}/${neededRivals})`
      );
    }

    console.log(
      `[competitors] after service backfill: ${filteredTargets.length} rivals for "${serviceTermsForMatch[0]}"`
    );
  }

  // Backfill only with other targets that have SociaVault ads (never pad with 0-ad stubs)
  // Lightweight Make It Better: skip second-wave fetches once any gallery hit exists.
  // Create Campaign: skip further library fetches once 3+ scored rivals exist.
  if (
    transparencyByUrl.size < neededRivals &&
    !enoughToReturn &&
    !(options.lightweight && !options.minCompetitors && transparencyByUrl.size > 0)
  ) {
    const used = new Set(filteredTargets.map((t) => t.url.toLowerCase()));
    const extras = relevanceScored
      .map((x) => x.target)
      .filter((t) => {
        if (used.has(t.url.toLowerCase())) return false;
        if ((t.activity?.totalAdCount ?? 0) <= 0) return false;
        if (
          serviceTermsForMatch.length &&
          advertiserConflictsWithService(t.name, t.url, serviceTermsForMatch)
        ) {
          return false;
        }
        return true;
      })
      .slice(0, options.lightweight && !options.minCompetitors ? 4 : 10);

    const extraFetches = await Promise.all(
      extras.map(async (target) => {
        const site = await withTimeoutFallback(
          analyzeWebsite(target.url),
          crawlTimeout,
          null,
          `competitor-crawl:${target.url}`
        );
        const profile = profileFromWebsite(target.name, target.url, site);
        try {
          const result = await withTimeout(
            fetchCompetitorGalleryForTarget(
              target,
              country,
              profile,
              serviceTermsForMatch.length ? serviceTermsForMatch : undefined,
              serviceSeedOption
            ),
            55_000,
            `competitor-gallery-extra:${target.url}`
          );
          return { target, result };
        } catch {
          return { target, result: null };
        }
      })
    );

    for (const { target, result } of extraFetches) {
      if (transparencyByUrl.size >= neededRivals) break;
      if (!result || (result.profile.totalAdCount ?? 0) <= 0) continue;
      if (
        serviceTermsForMatch.length &&
        !creativeMatchesTargetService(
          {
            headlines: result.preview.headlines,
            descriptions: result.preview.descriptions,
          },
          serviceTermsForMatch
        )
      ) {
        continue;
      }
      const dedupeKey = galleryDedupeKey(result.preview);
      const already = [...transparencyByUrl.values()].some((g) => galleryDedupeKey(g) === dedupeKey);
      if (already) continue;
      storeGalleryFetchResult(target.url, result, transparencyByUrl, extraAdsByUrl);
      filteredTargets.push(target);
      filteredCompetitors.push(result.profile);
      transparencyHits += 1;
    }
  }

  const clientOffers = new Set((options.websiteIntel?.offers ?? []).map((o) => o.toLowerCase()));
  const clientHeadlines = new Set(
    (options.websiteIntel?.headings ?? []).map((h) => h.toLowerCase())
  );
  const allCompetitorOffers = new Set(filteredCompetitors.flatMap((c) => c.offers.map((o) => o.toLowerCase())));
  const missingOffers = [...allCompetitorOffers].filter((o) => !clientOffers.has(o)).slice(0, 8);

  const competitorKeywords = new Set(filteredCompetitors.flatMap((c) => c.keywords));
  const keywordOpportunities = [...competitorKeywords]
    .filter((k) => !clientKeywords.has(k))
    .slice(0, 15);

  const messagingOpportunities = filteredCompetitors
    .flatMap((c) => [...c.valuePropositions, c.positioning].filter(Boolean) as string[])
    .slice(0, 8);

  const competitiveAdvantages: string[] = [];
  if (options.websiteIntel?.offers?.length) {
    competitiveAdvantages.push(`Your offers: ${options.websiteIntel.offers.slice(0, 3).join('; ')}`);
  }
  if (options.websiteIntel?.usps?.length) {
    competitiveAdvantages.push(`Your USPs: ${options.websiteIntel.usps.slice(0, 3).join('; ')}`);
  }
  for (const c of filteredCompetitors) {
    if (c.offers.length && !c.offers.some((o) => clientOffers.has(o.toLowerCase()))) {
      competitiveAdvantages.push(`${c.name} promotes offers your site does not emphasize in ads`);
    }
  }

  let insights = buildInsightSummaries(filteredCompetitors);
  // Keep library-backed creatives and activity stubs (duration/count) — never drop rivals here
  let adGallery = dedupeAdGallery(buildAdGallery(transparencyByUrl, extraAdsByUrl)).filter(
    (g) =>
      (g.totalAdCount ?? 0) > 0 ||
      (g.adDurationDays ?? 0) > 0 ||
      (g.headlines?.length ?? 0) > 0 ||
      (g.descriptions?.length ?? 0) > 0 ||
      Boolean(g.previewImageUrl)
  );
  adGallery = adGallery.map((g) => {
    const profile = filteredCompetitors.find((p) => sameCompetitor(p, g));
    if (!profile) return g;
    return {
      ...g,
      adDurationDays: g.adDurationDays || profile.adDurationDays,
      activeAdCount: g.activeAdCount || profile.activeAdCount,
      totalAdCount: g.totalAdCount || profile.totalAdCount,
      firstShown: g.firstShown ?? profile.firstShown,
      lastShown: g.lastShown ?? profile.lastShown,
      brandReview: profile.brandReview ?? g.brandReview,
    };
  });
  // Deepen brand reviews with Claude for technical detail (best-effort)
  // Ad-scoped / lightweight: skip Claude brand enrich to avoid wall-clock timeouts
  if (!options.serviceScoped && !options.lightweight) {
    filteredCompetitors = await enrichBrandReviewsWithClaude(filteredCompetitors, adGallery);
  }

  // Website → social profile URLs → SociaVault platform scrapers (followers / employees)
  // Ad-level runs use lightweight mode so Social Presence still fills without long timeouts
  if (!options.skipSocialPresence) {
    filteredCompetitors = await enrichCompetitorsWithSocialPresence(filteredCompetitors, {
      lightweight: options.lightweight || options.serviceScoped,
      location: options.location,
    });
  }

  // Ensure every rival has a brand review before scoring (feeds Reviews + AI Learning tabs)
  filteredCompetitors = filteredCompetitors.map((c) => ({
    ...c,
    brandReview: c.brandReview ?? buildBrandReview(c),
  }));

  // Competitor Intelligence 2.0 — confidence score + Claude influence weights
  const scored = applyConfidenceScores(filteredCompetitors, adGallery, {
    industry: options.industry,
    services: serviceTermsForMatch.length ? serviceTermsForMatch : options.productsServices,
    keywords: [...clientKeywords],
    location: options.location,
  });
  filteredCompetitors = scored.competitors;
  adGallery = scored.adGallery;
  const influenceWeights = scored.influenceWeights;

  // Ad-level / service-scoped: keep only competitors & creatives that match the selected service
  if (options.serviceScoped && uniqueScoped.length) {
    const beforeCompetitors = [...filteredCompetitors];
    const beforeGallery = [...adGallery];
    const strictServiceLabel = options.primaryService ?? uniqueScoped[0] ?? '';
    const useStrictSeedMatch = Boolean(options.strictServiceSeed && strictServiceLabel);

    const creativeMatchesScope = (creative: {
      headlines?: string[];
      descriptions?: string[];
      destinationUrl?: string;
      keywordRelevanceScore?: number;
    }): boolean => {
      if (typeof creative.keywordRelevanceScore === 'number') {
        return creative.keywordRelevanceScore >= AD_RELEVANCE_THRESHOLD;
      }
      if (requireLlmApprovedAds) return false;
      if (useStrictSeedMatch) {
        return adMatchesServiceAndSeeds(creative, strictServiceLabel, seedKeywords);
      }
      return creativeMatchesTargetService(creative, uniqueScoped);
    };

    const passesServiceGate = (c: CompetitorProfile): boolean => {
      if (looksLikeQueryNotAdvertiser(c.name, strictServiceLabel || uniqueScoped[0])) return false;
      if (looksLikeNonCommercialAdvertiser(c.name, c.url)) return false;
      if (looksLikeEducationalCompetitorName(c.name)) return false;
      if (advertiserConflictsWithService(c.name, c.url, uniqueScoped)) return false;
      const galleryAds = adGallery.filter((g) => sameCompetitor(g, c));
      const hasOnServiceAd = galleryAds.some((g) =>
        creativeMatchesScope({
          headlines: g.headlines,
          descriptions: g.descriptions,
          destinationUrl: g.destinationUrl ?? g.url,
          keywordRelevanceScore: g.keywordRelevanceScore,
        })
      );
      const llmAdvertiser = advertiserLlmScores.get(competitorIdentityKey(c));
      if (
        requireLlmApprovedAds &&
        llmAdvertiser &&
        !(llmAdvertiser.relevant && llmAdvertiser.score >= AD_RELEVANCE_THRESHOLD)
      ) {
        return false;
      }
      if (requireLlmApprovedAds) {
        return hasOnServiceAd;
      }
      if (hasOnServiceAd) return true;
      // Name / profile copy matches the selected service (common when ad OCR fails).
      // Never treat the service label itself as a competitor name.
      if (
        useStrictSeedMatch &&
        !looksLikeQueryNotAdvertiser(c.name, strictServiceLabel) &&
        copyMatchesServiceSeed(
          `${c.name} ${c.url} ${(c.headlines ?? []).join(' ')} ${(c.descriptions ?? []).join(' ')}`,
          strictServiceLabel
        ) &&
        !copyConflictsWithLegalService(
          `${c.name} ${(c.headlines ?? []).join(' ')} ${(c.descriptions ?? []).join(' ')}`,
          strictServiceLabel
        )
      ) {
        return true;
      }
      if (llmRelevanceApplied) {
        // Strict wizard mode: never keep a rival just because it has *some* ads
        if (useStrictSeedMatch) return false;
        return galleryAds.length > 0 || (c.totalAdCount ?? 0) > 0;
      }
      if (useStrictSeedMatch) {
        return adMatchesServiceAndSeeds(
          { headlines: c.headlines, descriptions: c.descriptions },
          strictServiceLabel,
          seedKeywords
        );
      }
      if (
        matchesTargetService(c.name, uniqueScoped) &&
        !hasConflictingService(c.name, uniqueScoped)
      ) {
        return true;
      }
      return advertiserLikelyMatchesService(c.name, c.url, uniqueScoped);
    };

    let kept = beforeCompetitors.filter(passesServiceGate);

    if (!kept.length && beforeCompetitors.length && !options.strictServiceSeed) {
      console.warn(
        `[CompetitorIntel] service gate would drop all ${beforeCompetitors.length} selected rival(s) — keeping them for UI`
      );
      kept = beforeCompetitors;
    } else if (!kept.length && beforeCompetitors.length && options.strictServiceSeed) {
      console.warn(
        `[CompetitorIntel] strict service gate dropped all ${beforeCompetitors.length} rival(s) for "${strictServiceLabel}" — returning empty rather than off-service rivals`
      );
    }

    // Never pad with off-service rivals in Create Campaign (strict seed)
    if (
      kept.length < neededRivals &&
      !requireLlmApprovedAds &&
      !isCommercialMortgageTarget(uniqueScoped)
    ) {
      const keptKeys = new Set(kept.map((c) => competitorIdentityKey(c)));
      const restore = beforeCompetitors
        .filter((c) => !keptKeys.has(competitorIdentityKey(c)))
        .filter((c) => !advertiserConflictsWithService(c.name, c.url, uniqueScoped))
        .sort(
          (a, b) =>
            (b.totalAdCount ?? 0) - (a.totalAdCount ?? 0) ||
            (b.adDurationDays ?? 0) - (a.adDurationDays ?? 0)
        )
        .slice(0, neededRivals - kept.length);
      if (restore.length) {
        console.log(
          `[CompetitorIntel] restoring ${restore.length} rival(s) to hit target=${neededRivals}:`,
          restore.map((c) => c.name)
        );
        kept = [...kept, ...restore];
      }
    }

    // Absolute floor: pad from any non-conflicting library rival still on the board
    if (
      kept.length < neededRivals &&
      !requireLlmApprovedAds &&
      !isCommercialMortgageTarget(uniqueScoped)
    ) {
      const keptKeys = new Set(kept.map((c) => competitorIdentityKey(c)));
      const floorPad = beforeCompetitors
        .filter((c) => !keptKeys.has(competitorIdentityKey(c)))
        .filter((c) => (c.totalAdCount ?? 0) > 0 || (c.adDurationDays ?? 0) > 0)
        .filter((c) => !advertiserConflictsWithService(c.name, c.url, uniqueScoped))
        .slice(0, neededRivals - kept.length);
      if (floorPad.length) {
        console.log(
          `[CompetitorIntel] floor-pad ${floorPad.length} rival(s) → ${kept.length + floorPad.length}/${neededRivals}:`,
          floorPad.map((c) => c.name)
        );
        kept = [...kept, ...floorPad];
      }
    }

    filteredCompetitors = kept;

    const keptKeys = new Set(filteredCompetitors.map((c) => competitorIdentityKey(c)));
    let nextGallery = beforeGallery.filter((g) => {
      const inKept = keptKeys.has(
        competitorIdentityKey({
          name: g.advertiserName ?? g.name,
          url: g.url,
          advertiserId: g.advertiserId,
          transparencyUrl: g.transparencyUrl,
        })
      );
      if (!inKept) return false;
      if (
        creativeMatchesScope({
          headlines: g.headlines,
          descriptions: g.descriptions,
          destinationUrl: g.destinationUrl ?? g.url,
          keywordRelevanceScore: g.keywordRelevanceScore,
        })
      ) {
        return true;
      }
      if (requireLlmApprovedAds) return false;
      return (
        matchesTargetService(g.advertiserName ?? g.name, uniqueScoped) &&
        !hasConflictingService(g.advertiserName ?? g.name, uniqueScoped)
      );
    });

    // Pad gallery cards to match retained competitors (Create Campaign needs ≥6 cards)
    if (nextGallery.length < neededRivals && !requireLlmApprovedAds) {
      const galleryKeys = new Set(
        nextGallery.map((g) =>
          competitorIdentityKey({
            name: g.advertiserName ?? g.name,
            url: g.url,
            advertiserId: g.advertiserId,
            transparencyUrl: g.transparencyUrl,
          })
        )
      );
      for (const g of beforeGallery) {
        if (nextGallery.length >= neededRivals) break;
        const key = competitorIdentityKey({
          name: g.advertiserName ?? g.name,
          url: g.url,
          advertiserId: g.advertiserId,
          transparencyUrl: g.transparencyUrl,
        });
        if (galleryKeys.has(key)) continue;
        if (!keptKeys.has(key)) continue;
        if (advertiserConflictsWithService(g.advertiserName ?? g.name, g.url, uniqueScoped)) continue;
        nextGallery.push(g);
        galleryKeys.add(key);
      }
      // Still short? Seed gallery rows from kept competitor profiles (include all Engine sections)
      if (nextGallery.length < neededRivals) {
        for (const c of filteredCompetitors) {
          if (nextGallery.length >= neededRivals) break;
          const key = competitorIdentityKey(c);
          if (galleryKeys.has(key)) continue;
          const seeded = attachProfileSectionsToGallery(
            profileToGalleryPreview(c, { name: c.name, url: c.url }),
            c
          );
          seeded.adSource = 'sociavault';
          nextGallery.push(seeded);
          galleryKeys.add(key);
        }
      }
    }

    // Strict Create Campaign: never invent creatives or fake LLM scores
    if (requireLlmApprovedAds && kept.length && !nextGallery.length) {
      console.warn(
        `[CompetitorIntel] ${kept.length} rival(s) kept but 0 LLM-approved "${strictServiceLabel}" ads — not seeding fake copy`
      );
    }

    // Make It Better / non-strict: seed gallery rows so competitor cards still render
    if (!nextGallery.length && kept.length && !requireLlmApprovedAds) {
      console.warn(
        `[CompetitorIntel] service gallery empty — seeding ${kept.length} selected rival(s) for UI`
      );
      nextGallery = kept.map((c) => {
        const seeded = attachProfileSectionsToGallery(
          profileToGalleryPreview(c, { name: c.name, url: c.url }),
          c
        );
        seeded.adSource = 'sociavault';
        return seeded;
      });
    }

    // Under Create Campaign strict mode, drop rivals still without any gallery row
    if (requireLlmApprovedAds) {
      filteredCompetitors = filteredCompetitors.filter((c) => !looksLikeEducationalCompetitorName(c.name));
      if (nextGallery.length) {
        const withAds = new Set(
          nextGallery.map((g) =>
            competitorIdentityKey({
              name: g.advertiserName ?? g.name,
              url: g.url,
              advertiserId: g.advertiserId,
              transparencyUrl: g.transparencyUrl,
            })
          )
        );
        filteredCompetitors = filteredCompetitors.filter((c) => withAds.has(competitorIdentityKey(c)));
      }
    }

    adGallery = ensureGalleryHasSectionIntelligence(nextGallery, filteredCompetitors);
    console.log(
      `[CompetitorIntel] Service filter retained ${filteredCompetitors.length} competitors / ${adGallery.length} gallery ads for "${uniqueScoped[0]}"`
    );
  }

  const marketPatterns = extractMarketPatterns(filteredCompetitors, adGallery, {
    industry: options.industry,
    services: options.productsServices,
    keywords: [...clientKeywords],
  });

  // Rebuild insights from confidence-ranked profiles (match by name/URL — never by index)
  insights = buildInsightSummaries(filteredCompetitors).map((insight) => {
    const profile = filteredCompetitors.find((p) => sameCompetitor(p, insight));
    const matchIdx = adGallery.findIndex(
      (g) => sameCompetitor(g, insight) || (profile ? sameCompetitor(g, profile) : false)
    );
    if (profile && matchIdx >= 0) {
      adGallery[matchIdx] = attachProfileSectionsToGallery(adGallery[matchIdx]!, profile);
    }
    const match = matchIdx >= 0 ? adGallery[matchIdx] : undefined;
    return enrichInsightSummary(insight, profile, match);
  });

  // Final pass — every Engine tab (Brand / Reviews / Social / Market / Offers / Learning) needs payloads
  adGallery = ensureGalleryHasSectionIntelligence(adGallery, filteredCompetitors);

  // Relative market share among ranked rivals (fills Market Authority when DA/traffic unavailable)
  const learningTotal =
    filteredCompetitors.reduce((sum, c) => sum + (c.aiLearningValue ?? c.confidenceScore ?? 0), 0) ||
    1;
  filteredCompetitors = filteredCompetitors.map((c) => {
    const share = Math.max(
      1,
      Math.round(((c.aiLearningValue ?? c.confidenceScore ?? 0) / learningTotal) * 100)
    );
    return {
      ...c,
      marketAuthority: c.marketAuthority
        ? { ...c.marketAuthority, marketShare: c.marketAuthority.marketShare ?? share }
        : c.marketAuthority,
    };
  });
  adGallery = adGallery.map((g) => {
    const profile = filteredCompetitors.find((p) => sameCompetitor(p, g));
    if (!profile?.marketAuthority) return g;
    return {
      ...g,
      marketAuthority: {
        ...(g.marketAuthority ?? profile.marketAuthority),
        marketShare: profile.marketAuthority.marketShare,
      },
    };
  });

  // Hard guarantee: uploaded-document mode never surfaces rivals outside the file
  if (options.userProvidedOnly) {
    const allow = uploadedAllowList({
      competitorUrls: options.competitorUrls,
      competitorNames: options.competitorNames,
      competitorEntries: options.competitorEntries,
    });
    const beforeCount = filteredCompetitors.length;
    filteredCompetitors = filteredCompetitors.filter((c) => matchesUploadedAllowList(c, allow));
    adGallery = adGallery.filter((g) =>
      matchesUploadedAllowList(
        { name: g.name, advertiserName: g.advertiserName, url: g.url },
        allow
      )
    );
    // Re-stamp document brand names onto gallery/profile rows (never show SociaVault legal entity names)
    const nameByDomain = new Map<string, string>();
    for (const e of options.competitorEntries ?? []) {
      if (e.url) nameByDomain.set(siteDomainKey(normalizeUrl(e.url)), e.name);
    }
    for (let i = 0; i < Math.min(options.competitorUrls?.length ?? 0, options.competitorNames?.length ?? 0); i++) {
      const u = options.competitorUrls![i]!;
      const n = options.competitorNames![i]!;
      nameByDomain.set(siteDomainKey(normalizeUrl(u)), n);
    }
    filteredCompetitors = filteredCompetitors.map((c) => {
      const docName = nameByDomain.get(siteDomainKey(c.url));
      return docName ? { ...c, name: docName } : c;
    });
    adGallery = adGallery.map((g) => {
      const docName = nameByDomain.get(siteDomainKey(g.url));
      return docName ? { ...g, name: docName, advertiserName: docName } : g;
    });
    insights = insights
      .filter((i) => matchesUploadedAllowList(i, allow))
      .map((i) => {
        const docName = i.url ? nameByDomain.get(siteDomainKey(i.url)) : undefined;
        return docName ? { ...i, name: docName } : i;
      });
    // Domain dedupe on final gallery / competitors
    const seenD = new Set<string>();
    filteredCompetitors = filteredCompetitors.filter((c) => {
      const d = siteDomainKey(c.url);
      if (seenD.has(d)) return false;
      seenD.add(d);
      return true;
    });
    const seenG = new Set<string>();
    adGallery = adGallery.filter((g) => {
      const d = siteDomainKey(g.url);
      if (seenG.has(d)) return false;
      seenG.add(d);
      return true;
    });
    console.log(
      `[CompetitorIntel] document-only filter: ${filteredCompetitors.length}/${beforeCount} competitors kept (${allow.domains.size} domains from file)`,
      filteredCompetitors.map((c) => `${c.name}<${siteDomainKey(c.url)}>`).join(', ')
    );
  }

  const missingFromYourAds = deriveMissingFromYourAds(filteredCompetitors, clientOffers, clientHeadlines);
  const gapAnalysis = buildGapAnalysis(filteredCompetitors, {
    headlines: options.currentAd?.headlines ?? options.websiteIntel?.headings ?? [],
    descriptions: options.currentAd?.descriptions ?? descriptionsFromSite(clientSite),
    offers: options.websiteIntel?.offers ?? [],
    ctas: options.websiteIntel?.ctas ?? [],
    trustSignals: options.websiteIntel?.trustSignals ?? [],
    keywords: [...clientKeywords],
  });

  const source = options.userProvidedOnly
    ? 'user_provided'
    : transparencyByUrl.size > 0 && [...transparencyByUrl.values()].some((c) => c.adSource === 'sociavault')
      ? 'sociavault'
      : transparencyHits > 0
        ? 'transparency_center'
    : (options.competitorUrls?.length ?? 0) > 0 && filteredCompetitors.some((c) => c.fetched)
      ? 'user_provided'
      : filteredCompetitors.some((c) => c.fetched)
        ? 'claude_and_crawl'
        : filteredTargets.length
          ? 'claude_only'
          : 'unavailable';

  console.log(
    `[CompetitorIntel] Confidence ranking: ${filteredCompetitors
      .map(
        (c) =>
          `${c.name}=${c.confidenceScore ?? 0}/100 (${c.influencePercent ?? 0}% influence, ${c.durationClass ?? 'n/a'}, ${formatDurationDays(c.adDurationDays ?? 0)})`
      )
      .join(' | ')}`
  );

  const svStatus = getSociaVaultErrorState();
  const discoveryWarning = svStatus.creditsExhausted
    ? 'SociaVault API credits are exhausted — add credits to restore full competitor metrics. Using Google Ads Transparency Center where possible.'
    : undefined;

  const preferredType = normalizeAccountCampaignType(options.preferredCampaignType);
  if (preferredType && preferredType !== 'other') {
    const typedPreferred = preferredType as CompetitorCampaignTypeKey;
    const withType = adGallery.map((g) => {
      const inferred =
        g.campaignType ??
        classifyCompetitorCreative({
          format: g.format,
          headlines: g.headlines,
          descriptions: g.descriptions,
          previewImageUrl: g.previewImageUrl,
          destinationUrl: g.url,
        });
      return { ...g, campaignType: inferred };
    });
    // Sort same-channel creatives first — never drop rivals from Make It Better gallery
    const matching = withType.filter((g) => g.campaignType === typedPreferred);
    const others = withType.filter((g) => g.campaignType !== typedPreferred);
    adGallery = [...matching, ...others];
    console.log(
      `[CompetitorIntel] preferredCampaignType=${typedPreferred} → ${matching.length} matching / ${withType.length} gallery (sort only)`
    );
  }

  const result: CompetitorIntelligence = filterCompetitorIntelligenceForMarket(
    {
      competitors: filteredCompetitors,
      insights,
      adGallery,
      gapAnalysis,
      keywordOpportunities,
      messagingOpportunities,
      missingOffers,
      competitiveAdvantages: competitiveAdvantages.slice(0, 8),
      missingFromYourAds,
      influenceWeights,
      marketPatterns,
      source,
      discoveryWarning,
    },
    options.websiteUrl,
    country
  );

  let finalResult = ensureTransparencyLinks(result, country);
  if (!hasTransparencyCreatives(finalResult)) {
    finalResult = await hydrateTransparencyCreatives(finalResult, country, {
      service: options.primaryService ?? uniqueScoped[0],
      keywords: seedKeywords,
    });
  }

  console.log(
    `[CompetitorIntel] returning ${finalResult.competitors.length} competitors / ${finalResult.adGallery.length} ads to UI (${finalResult.source})`,
    finalResult.competitors.map((c) => c.name).join(', ') || '(none)'
  );

  if (!options.skipCache && hasUsableCompetitorIntel(finalResult)) {
    await setCachedCompetitorDiscovery(cacheLookup, finalResult);
  }

  return finalResult;
}
