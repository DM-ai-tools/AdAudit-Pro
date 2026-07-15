import { createClaudeMessage } from '../ai/anthropic-client.js';
import { extractJsonFromClaudeText } from '../utils/claude-json.js';
import { decodeHtmlEntities, decodeHtmlEntitiesList } from '../utils/html-entities.js';
import { inferCountryFromLocation } from '../utils/region-codes.js';
import { analyzeWebsite, type WebsiteIntelligence } from './website-intelligence.service.js';
import {
  discoverSociaVaultCompetitors,
  fetchSociaVaultCompetitorAd,
  isSociaVaultConfigured,
  resolveCompetitorViaSociaVault,
} from './sociavault-google-ad-library.service.js';
import {
  fetchExactTransparencyAdForCompetitor,
  mergeTransparencyAdsToRsa,
} from './google-ads-transparency.service.js';
import { withTimeout, withTimeoutFallback } from '../utils/withTimeout.js';
import {
  buildCompetitorSearchQueries,
  businessLevelRulesForPrompt,
  expandServiceSearchQueries,
  inferBusinessContext,
  inferCompetitorLevelFromText,
  isAggregatorProfile,
  isSameOrOneLevelAbove,
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
  isGarbageCreativeText,
  matchesTargetService,
  primaryCreativeText,
  scoreServiceTextMatch,
} from '../utils/service-relevance.js';
import { type DiscoveredSocialLinks } from './sociavault-social-presence.service.js';
import { resolveCompetitorSocialPresence } from './social-presence-discovery.service.js';

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
    | 'local_services';
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
  const pool = [...c.headlines, ...c.keyMessages, c.name]
    .map((h) => h.trim().slice(0, 30))
    .filter(Boolean);
  const unique: string[] = [];
  for (const h of pool) {
    if (!unique.includes(h)) unique.push(h);
    if (unique.length >= 5) break;
  }
  while (unique.length < 3) {
    unique.push(`${c.name} — Shop Now`.slice(0, 30));
    if (unique.length >= 3) break;
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
  while (unique.length < 2) {
    unique.push(`Visit ${c.name} for quality service. ${c.ctas[0] ?? 'Learn more'}.`.slice(0, 90));
    if (unique.length >= 2) break;
  }
  return unique;
}

const MIN_COMPETITORS = 4;

function galleryDedupeKey(g: CompetitorAdPreview): string {
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

function buildAdGallery(transparencyByUrl: Map<string, CompetitorAdPreview>): CompetitorAdPreview[] {
  return [...transparencyByUrl.values()].filter(
    (c) => c.adSource === 'sociavault' || c.adSource === 'transparency_center'
  );
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
  serviceTerms?: string[]
): Promise<{ preview: CompetitorAdPreview; profile: CompetitorProfile } | null> {
  // Primary: SociaVault Google Ad Library (company-ads activity + optional OCR copy)
  if (isSociaVaultConfigured()) {
    try {
      const sv = await withTimeout(
        fetchSociaVaultCompetitorAd({
          name: target.name,
          url: target.url,
          country,
          serviceTerms: serviceTerms?.length ? serviceTerms : undefined,
          advertiserId: target.advertiserId,
        }),
        40_000,
        `sociavault:${target.advertiserId ?? target.url}`
      );
      // Accept results with library activity even when OCR text is empty
      if (sv && (sv.totalAdCount > 0 || sv.headline || sv.description || sv.previewImageUrl)) {
        const headlines = decodeHtmlEntitiesList(
          sv.allHeadlines.length
            ? sv.allHeadlines
            : sv.headline
              ? [sv.headline]
              : websiteProfile.headlines.slice(0, 5)
        );
        const descriptions = decodeHtmlEntitiesList(
          sv.allDescriptions.length
            ? sv.allDescriptions
            : sv.description
              ? [sv.description]
              : websiteProfile.descriptions.slice(0, 2)
        );
        let profile = applyTransparencyToProfile(
          websiteProfile,
          headlines,
          descriptions,
          websiteProfile.ctas
        );
        profile = {
          ...profile,
          name: sv.advertiserName || target.name,
          advertiserId:
            target.advertiserId ||
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
        let profileUrl = target.url;
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

        profile = {
          ...profile,
          url: profileUrl,
          brandReview,
        };

        const preview: CompetitorAdPreview = {
          name: sv.advertiserName || target.name,
          url: destinationUrl || profileUrl,
          destinationUrl,
          displayUrl:
            sv.visibleUrl ||
            (destinationUrl ? displayHostFromUrl(destinationUrl) : displayHostFromUrl(profileUrl)),
          headlines,
          descriptions,
          offers: websiteProfile.offers.slice(0, 4),
          ctas: websiteProfile.ctas.slice(0, 4),
          trustSignals: websiteProfile.trustSignals.slice(0, 4),
          transparencyUrl: sv.advertiserUrl,
          creativeUrl: sv.adUrl,
          adLink: sv.adUrl,
          advertiserName: sv.advertiserName || target.name,
          advertiserId: target.advertiserId || advertiserIdFromTransparencyUrl(sv.advertiserUrl),
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
          cta: websiteProfile.ctas[0],
          offer: websiteProfile.offers[0],
          brandReview,
        };
        return { preview, profile };
      }
    } catch (err) {
      console.warn(`[competitors] SociaVault failed for ${target.url}:`, err instanceof Error ? err.message : err);
    }
  }

  // Fallback: direct Transparency Center RPC
  try {
    const result = await withTimeout(
      fetchExactTransparencyAdForCompetitor({
        name: target.name,
        url: target.url,
        country,
      }),
      28_000,
      `transparency:${target.url}`
    );
    if (!result) return null;

    const { advertiser, exactAd, allAds } = result;
    const rsa = mergeTransparencyAdsToRsa(allAds);
    const displayHost = displayHostFromUrl(target.url);
    const headlines = decodeHtmlEntitiesList(
      rsa.headlines.length ? rsa.headlines : exactAd.headlines
    );
    const descriptions = decodeHtmlEntitiesList(
      rsa.descriptions.length ? rsa.descriptions : exactAd.descriptions
    );

    if (!headlines.length && !descriptions.length && !exactAd.previewImageUrl) return null;

    const preview: CompetitorAdPreview = {
      name: advertiser.name || target.name,
      url: exactAd.finalUrl?.startsWith('http') ? exactAd.finalUrl : target.url,
      displayUrl: exactAd.displayUrl ?? displayHost,
      headlines,
      descriptions,
      offers: websiteProfile.offers.slice(0, 4),
      ctas: websiteProfile.ctas.slice(0, 4),
      trustSignals: websiteProfile.trustSignals.slice(0, 4),
      transparencyUrl: advertiser.transparencyUrl,
      creativeUrl: exactAd.creativeUrl,
      adLink: exactAd.creativeUrl,
      advertiserName: advertiser.name,
      adSource: 'transparency_center',
      previewImageUrl: exactAd.previewImageUrl,
      activeAdCount: Math.max(1, allAds.length),
      totalAdCount: allAds.length,
    };

    let profile = applyTransparencyToProfile(websiteProfile, rsa.headlines, rsa.descriptions, rsa.ctas);
    profile = {
      ...profile,
      activeAdCount: preview.activeAdCount,
      totalAdCount: preview.totalAdCount,
    };
    const brandReview = buildBrandReview(profile);
    profile = { ...profile, brandReview };
    preview.brandReview = brandReview;
    return { preview, profile };
  } catch {
    return null;
  }
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
  if (/\bhome\b|\bmortgage\b/.test(joined)) {
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

async function resolveCompetitorTargets(options: {
  businessName: string;
  websiteUrl?: string;
  industry?: string;
  location?: string;
  productsServices?: string[];
  competitorUrls?: string[];
  monthlySpend?: number;
  websiteIntel?: WebsiteIntelligence | null;
  country?: string;
  lightweight?: boolean;
  serviceScoped?: boolean;
}): Promise<CompetitorTarget[]> {
  const businessContext = inferBusinessContext({
    monthlySpend: options.monthlySpend,
    location: options.location,
    industry: options.industry,
    productsServices: options.productsServices,
    websiteIntel: options.websiteIntel,
  });

  const userTargets: CompetitorTarget[] = (options.competitorUrls ?? [])
    .map((url) => url.trim())
    .filter(Boolean)
    .map((url) => ({ name: hostnameToName(url), url: normalizeUrl(url) }));

  const seen = new Set(userTargets.map((t) => t.url.toLowerCase()));
  const targets: CompetitorTarget[] = [...userTargets];

  // Prefer SociaVault discovery FIRST — these already have ad duration / active / total counts
  if (isSociaVaultConfigured() && options.websiteUrl) {
    const serviceHints = businessContext.primaryServices.slice(0, 4);
    const baseQueries = buildCompetitorSearchQueries(businessContext, options.businessName);
    // Lightweight / service-scoped: smaller budget so Make This Ad Better finishes in UI poll window
    const queryBudget = options.lightweight
      ? serviceHints.length
        ? 4
        : 6
      : serviceHints.length
        ? 8
        : 16;
    const uniqueQueries = [...new Set(baseQueries.map((q) => q.trim()).filter(Boolean))].slice(
      0,
      queryBudget
    );
    const sociavaultTargets = await discoverSociaVaultCompetitors({
      siteUrl: options.websiteUrl,
      searchQueries: uniqueQueries,
      region: options.country,
      maxCount: serviceHints.length ? MIN_COMPETITORS + 6 : MIN_COMPETITORS + 8,
      maxEmptyQueries: options.lightweight ? 2 : 0,
    });
    // Highest activity first, but prefer name/domain that match the target service
    const ranked = [...sociavaultTargets]
      .filter((t) => {
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
      if (targets.length >= MIN_COMPETITORS + 8) break;
    }
  }

  const withAds = () => targets.filter((t) => (t.activity?.totalAdCount ?? 0) > 0).length;

  // Seed known AU market domains when search returns too few domain-backed rivals
  // so gallery can still populate while advertiser-id creatives are fetched.
  if (targets.length < MIN_COMPETITORS || withAds() < MIN_COMPETITORS) {
    const seeds = seedCompetitorsForServices(businessContext.primaryServices, options.location);
    for (const seed of seeds) {
      const key = seed.url.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      targets.push(seed);
      if (targets.length >= MIN_COMPETITORS + 4) break;
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
  if (!options.lightweight && withAds() < MIN_COMPETITORS) {
    let attempts = 0;
    const pendingClaude: Array<{ name: string; url: string }> = [];
    while (targets.length < MIN_COMPETITORS + 2 && attempts < 2) {
      const needed = MIN_COMPETITORS - withAds() + 2;
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

    if (pendingClaude.length && isSociaVaultConfigured()) {
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
    }
  }

  // Drop any remaining candidates that never got SociaVault activity — they render as zeros in the UI
  const proven = targets.filter((t) => (t.activity?.totalAdCount ?? 0) > 0);
  const sorted = (proven.length ? proven : targets).sort(
    (a, b) =>
      (b.activity?.adDurationDays ?? 0) - (a.activity?.adDurationDays ?? 0) ||
      (b.activity?.activeAdCount ?? 0) - (a.activity?.activeAdCount ?? 0) ||
      (b.activity?.totalAdCount ?? 0) - (a.activity?.totalAdCount ?? 0)
  );

  console.log(
    `[competitors] resolveTargets: ${sorted.filter((t) => (t.activity?.totalAdCount ?? 0) > 0).length} with SociaVault ads / ${sorted.length} total`
  );

  return sorted.slice(0, Math.max(MIN_COMPETITORS + 2, Math.min(sorted.length, 8)));
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

export async function analyzeCompetitors(options: {
  businessName: string;
  websiteUrl?: string;
  industry?: string;
  location?: string;
  monthlySpend?: number;
  productsServices?: string[];
  competitorUrls?: string[];
  websiteIntel?: WebsiteIntelligence | null;
  currentAd?: { headlines?: string[]; descriptions?: string[] };
  lightweight?: boolean;
  /** When true, discover & keep only competitors for productsServices / primaryService */
  serviceScoped?: boolean;
  primaryService?: string;
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

  const country = inferCountryFromLocation(options.location);
  const scopedServiceList = [
    ...(options.primaryService ? [options.primaryService] : []),
    ...(options.productsServices ?? []),
  ].filter(Boolean);
  const uniqueScoped = [...new Set(scopedServiceList.map((s) => s.trim()).filter(Boolean))];
  const serviceTermsForMatch =
    options.serviceScoped && uniqueScoped.length ? uniqueScoped.slice(0, 4) : [];

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
      ? uniqueScoped.slice(0, 4)
      : options.productsServices;

  const businessContext = inferBusinessContext({
    monthlySpend: options.monthlySpend,
    location: options.location,
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
    location: options.location,
    productsServices: discoveryProducts,
    competitorUrls: options.competitorUrls,
    monthlySpend: options.monthlySpend,
    websiteIntel: scopedWebsiteIntel,
    country,
    lightweight: options.lightweight,
    serviceScoped: options.serviceScoped,
  });

  if (!targets.length) return empty;

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
  const selectPool = serviceTermsForMatch.length ? 14 : 6;
  let selected = relevanceScored.filter((x) => (x.profile.totalAdCount ?? 0) > 0).slice(0, selectPool);
  if (selected.length < MIN_COMPETITORS) {
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
            serviceTermsForMatch.length ? serviceTermsForMatch : undefined
          ),
          options.lightweight ? 35_000 : 50_000,
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
    transparencyByUrl.set(target.url.toLowerCase(), result.preview);
    filteredCompetitors[i] = result.profile;
    transparencyHits += 1;
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

  const hasLibraryPresence = (x: LibraryRow) =>
    (x.profile.totalAdCount ?? 0) > 0 || (x.preview?.totalAdCount ?? 0) > 0;

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
    if (!serviceTermsForMatch.length) return true;
    if (advertiserConflictsWithService(x.profile.name, x.profile.url, serviceTermsForMatch)) {
      console.log(
        `[CompetitorIntel] drop ${x.profile.name}: advertiser conflicts with "${serviceTermsForMatch[0]}"`
      );
      return false;
    }
    if (!x.preview) {
      console.log(
        `[CompetitorIntel] drop ${x.profile.name}: no service-matched "${serviceTermsForMatch[0]}" creative`
      );
      return false;
    }
    const ok = creativeMatchesTargetService(
      {
        headlines: x.preview.headlines,
        descriptions: x.preview.descriptions,
        destinationUrl: x.preview.url,
      },
      serviceTermsForMatch
    );
    const primary = primaryCreativeText({
      headlines: x.preview.headlines,
      descriptions: x.preview.descriptions,
    });
    if (!ok || isGarbageCreativeText(primary)) {
      console.log(
        `[CompetitorIntel] drop ${x.profile.name}: creative not matching "${serviceTermsForMatch[0]}" → "${primary.slice(0, 50)}"`
      );
      return false;
    }
    return true;
  });

  // Soft fill: library-backed, non-conflicting rivals so Insights always hits ≥4
  let withLibraryAds = sortLibraryRows(strictMatches);
  if (serviceTermsForMatch.length && withLibraryAds.length < MIN_COMPETITORS) {
    const used = new Set(withLibraryAds.map((x) => competitorIdentityKey(x.profile)));
    const soft = sortLibraryRows(
      libraryPool.filter((x) => {
        if (used.has(competitorIdentityKey(x.profile))) return false;
        if (!hasLibraryPresence(x)) return false;
        if (advertiserConflictsWithService(x.profile.name, x.profile.url, serviceTermsForMatch)) {
          return false;
        }
        // Prefer rows that at least have a preview; name/domain soft-match is OK for fill
        return (
          Boolean(x.preview) ||
          matchesTargetService(x.profile.name, serviceTermsForMatch) ||
          advertiserLikelyMatchesService(x.profile.name, x.profile.url, serviceTermsForMatch)
        );
      })
    ).slice(0, MIN_COMPETITORS - withLibraryAds.length);
    if (soft.length) {
      console.log(
        `[CompetitorIntel] soft-fill ${soft.length} rival(s) to hit MIN_COMPETITORS=${MIN_COMPETITORS}:`,
        soft.map((x) => x.profile.name)
      );
      withLibraryAds = [...withLibraryAds, ...soft];
    }
  }

  if (withLibraryAds.length > 0) {
    // Prefer same level or one level above the client (helps ads without drowning out peers)
    const levelFiltered = serviceTermsForMatch.length
      ? withLibraryAds.filter((x) => {
          const text = [
            x.profile.name,
            x.profile.url,
            ...(x.preview?.headlines ?? x.profile.headlines),
            ...(x.preview?.descriptions ?? x.profile.descriptions),
          ].join(' ');
          const competitorLevel = inferCompetitorLevelFromText(text, x.profile.services?.length ?? 0);
          return isSameOrOneLevelAbove(businessContext.level, competitorLevel);
        })
      : withLibraryAds;
    const levelPool =
      levelFiltered.length >= MIN_COMPETITORS ? levelFiltered : withLibraryAds;
    if (serviceTermsForMatch.length && levelFiltered.length < withLibraryAds.length) {
      console.log(
        `[CompetitorIntel] level filter: ${levelFiltered.length}/${withLibraryAds.length} same-or-one-above (using ${levelPool.length})`
      );
    }

    // Always surface at least MIN_COMPETITORS when available (never cap below 4)
    const top = levelPool.slice(0, Math.max(MIN_COMPETITORS, Math.min(6, levelPool.length)));
    filteredTargets = top.map((x) => x.target);
    filteredCompetitors = top.map((x) => x.profile);
    transparencyByUrl.clear();
    for (const x of top) {
      if (x.preview) {
        transparencyByUrl.set(x.target.url.toLowerCase(), x.preview);
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
        transparencyByUrl.set(x.target.url.toLowerCase(), seeded);
      }
    }
    console.log(
      `[competitors] selected ${top.length} SociaVault-backed rivals:`,
      top.map(
        (x) =>
          `${x.profile.name} (duration=${x.profile.adDurationDays ?? 0}d, active=${x.profile.activeAdCount ?? 0}, total=${x.profile.totalAdCount ?? 0}, brand=${x.profile.brandReview?.score ?? 0})`
      )
    );
  } else {
    // Do NOT keep Claude-invented domains with 0 library metrics — they render as zeros in Make It Better
    console.warn(
      '[competitors] no SociaVault library hits on first pass — retrying discovery by advertiser name'
    );
    filteredTargets = [];
    filteredCompetitors = [];
    transparencyByUrl.clear();

    // Aggressive recovery: search SociaVault by Claude competitor NAMES + service queries
    // Skip on lightweight — recovery alone can exceed the Make This Ad Better UI poll window
    if (isSociaVaultConfigured() && !options.lightweight) {
      const nameQueries = [
        ...relevanceScored.slice(0, 6).map((x) => x.target.name),
        ...buildCompetitorSearchQueries(businessContext, options.businessName),
      ].filter(Boolean);
      const recovered = await discoverSociaVaultCompetitors({
        siteUrl: options.websiteUrl || options.businessName,
        searchQueries: [...new Set(nameQueries)].slice(0, 8),
        region: country,
        maxCount: MIN_COMPETITORS + 2,
        maxEmptyQueries: 2,
      });

      if (recovered.length) {
        const recoverFetches = await Promise.all(
          recovered.slice(0, MIN_COMPETITORS + 1).map(async (t) => {
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
                  { name: t.name, url: t.url },
                  country,
                  profile,
                  serviceTermsForMatch.length ? serviceTermsForMatch : undefined
                ),
                40_000,
                `competitor-gallery-recover:${t.url}`
              );
              return { target: { name: t.name, url: t.url, activity: t.activity }, profile, result };
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
          if ((preview.totalAdCount ?? 0) <= 0) continue;
          filteredTargets.push(row.target);
          filteredCompetitors.push(profile);
          transparencyByUrl.set(row.target.url.toLowerCase(), preview);
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

  // Ad-scoped: if we have fewer than 4 service-matched rivals, keep searching until we hit 4
  if (
    serviceTermsForMatch.length &&
    isSociaVaultConfigured() &&
    filteredTargets.length < MIN_COMPETITORS
  ) {
    const needed = MIN_COMPETITORS - filteredTargets.length;
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
      options.lightweight ? 3 : 6
    );
    const recovered = await discoverSociaVaultCompetitors({
      siteUrl: options.websiteUrl || options.businessName,
      searchQueries: uniqueBackfill,
      region: country,
      maxCount: MIN_COMPETITORS + 6,
      maxEmptyQueries: options.lightweight ? 2 : 0,
    });

    const candidates = recovered
      .filter((t) => {
        if (used.has(t.url.toLowerCase())) return false;
        if (t.activity.totalAdCount <= 0) return false;
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
      if (filteredTargets.length >= MIN_COMPETITORS) break;
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
        `[competitors] backfill added ${t.name} (${filteredTargets.length}/${MIN_COMPETITORS})`
      );
    }

    console.log(
      `[competitors] after service backfill: ${filteredTargets.length} rivals for "${serviceTermsForMatch[0]}"`
    );
  }

  // Backfill only with other targets that have SociaVault ads (never pad with 0-ad stubs)
  // Lightweight with any gallery hits: skip second-wave gallery fetches (main timeout cause)
  if (
    transparencyByUrl.size < MIN_COMPETITORS &&
    !(options.lightweight && transparencyByUrl.size > 0)
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
      .slice(0, options.lightweight ? 4 : 8);

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
              serviceTermsForMatch.length ? serviceTermsForMatch : undefined
            ),
            35_000,
            `competitor-gallery-extra:${target.url}`
          );
          return { target, result };
        } catch {
          return { target, result: null };
        }
      })
    );

    for (const { target, result } of extraFetches) {
      if (transparencyByUrl.size >= MIN_COMPETITORS) break;
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
      transparencyByUrl.set(target.url.toLowerCase(), result.preview);
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
  // Only competitors with real SociaVault library counts — never surface 0/0/0 stubs
  let adGallery = dedupeAdGallery(buildAdGallery(transparencyByUrl)).filter(
    (g) => (g.totalAdCount ?? 0) > 0
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
  filteredCompetitors = await enrichCompetitorsWithSocialPresence(filteredCompetitors, {
    lightweight: options.lightweight || options.serviceScoped,
    location: options.location,
  });

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

    const passesServiceGate = (c: CompetitorProfile): boolean => {
      if (advertiserConflictsWithService(c.name, c.url, uniqueScoped)) return false;
      const gallery = adGallery.find((g) => sameCompetitor(g, c));
      if (gallery) {
        if (
          creativeMatchesTargetService(
            {
              headlines: gallery.headlines,
              descriptions: gallery.descriptions,
              destinationUrl: gallery.destinationUrl ?? gallery.url,
            },
            uniqueScoped
          )
        ) {
          return true;
        }
        // Soft keep: advertiser identity is the locked vertical (e.g. "Car Loan 4U")
        return (
          matchesTargetService(c.name, uniqueScoped) &&
          !hasConflictingService(c.name, uniqueScoped)
        );
      }
      return advertiserLikelyMatchesService(c.name, c.url, uniqueScoped);
    };

    let kept = beforeCompetitors.filter(passesServiceGate);

    // Never drop below MIN_COMPETITORS when we already selected library-backed rivals
    if (kept.length < MIN_COMPETITORS) {
      const keptKeys = new Set(kept.map((c) => competitorIdentityKey(c)));
      const restore = beforeCompetitors
        .filter((c) => !keptKeys.has(competitorIdentityKey(c)))
        .filter((c) => !advertiserConflictsWithService(c.name, c.url, uniqueScoped))
        .sort(
          (a, b) =>
            (b.totalAdCount ?? 0) - (a.totalAdCount ?? 0) ||
            (b.adDurationDays ?? 0) - (a.adDurationDays ?? 0)
        )
        .slice(0, MIN_COMPETITORS - kept.length);
      if (restore.length) {
        console.log(
          `[CompetitorIntel] restoring ${restore.length} rival(s) to hit MIN_COMPETITORS=${MIN_COMPETITORS}:`,
          restore.map((c) => c.name)
        );
        kept = [...kept, ...restore];
      }
    }

    // Absolute floor: pad from any non-conflicting library rival still on the board
    if (kept.length < MIN_COMPETITORS) {
      const keptKeys = new Set(kept.map((c) => competitorIdentityKey(c)));
      const floorPad = beforeCompetitors
        .filter((c) => !keptKeys.has(competitorIdentityKey(c)))
        .filter((c) => (c.totalAdCount ?? 0) > 0 || (c.adDurationDays ?? 0) > 0)
        .filter((c) => !advertiserConflictsWithService(c.name, c.url, uniqueScoped))
        .slice(0, MIN_COMPETITORS - kept.length);
      if (floorPad.length) {
        console.log(
          `[CompetitorIntel] floor-pad ${floorPad.length} rival(s) → ${kept.length + floorPad.length}/${MIN_COMPETITORS}:`,
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
        creativeMatchesTargetService(
          {
            headlines: g.headlines,
            descriptions: g.descriptions,
            destinationUrl: g.destinationUrl ?? g.url,
          },
          uniqueScoped
        )
      ) {
        return true;
      }
      return (
        matchesTargetService(g.advertiserName ?? g.name, uniqueScoped) &&
        !hasConflictingService(g.advertiserName ?? g.name, uniqueScoped)
      );
    });

    // Pad gallery cards to match retained competitors (Insights needs ≥4 cards)
    if (nextGallery.length < MIN_COMPETITORS) {
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
        if (nextGallery.length >= MIN_COMPETITORS) break;
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
      if (nextGallery.length < MIN_COMPETITORS) {
        for (const c of filteredCompetitors) {
          if (nextGallery.length >= MIN_COMPETITORS) break;
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

  const missingFromYourAds = deriveMissingFromYourAds(filteredCompetitors, clientOffers, clientHeadlines);
  const gapAnalysis = buildGapAnalysis(filteredCompetitors, {
    headlines: options.currentAd?.headlines ?? options.websiteIntel?.headings ?? [],
    descriptions: options.currentAd?.descriptions ?? descriptionsFromSite(clientSite),
    offers: options.websiteIntel?.offers ?? [],
    ctas: options.websiteIntel?.ctas ?? [],
    trustSignals: options.websiteIntel?.trustSignals ?? [],
    keywords: [...clientKeywords],
  });

  const source =
    transparencyByUrl.size > 0 && [...transparencyByUrl.values()].some((c) => c.adSource === 'sociavault')
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

  return {
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
  };
}
