import axios from 'axios';
import { env } from '../config/env.js';
import { inferCountryFromWebsiteUrl } from '../utils/region-codes.js';
import { competitorUrlMatchesCountry, isEnglishAdCopy } from '../utils/competitor-region.js';
import { decodeHtmlEntities } from '../utils/html-entities.js';
import {
  creativeMatchesTargetService,
  hasConflictingService,
  isGarbageCreativeText,
  matchesTargetService,
} from '../utils/service-relevance.js';
import { adMatchesServiceAndSeeds } from '../utils/service-seed-match.js';

const BASE_URL = 'https://api.sociavault.com/v1/scrape/google-ad-library';
const SEARCH_BASE_URL = 'https://api.sociavault.com/v1/scrape';

/** Organic SERP hosts that are not advertising competitors. */
const NON_COMPETITOR_HOST_RE =
  /^(?:www\.)?(?:google|googleadservices|gstatic|doubleclick|googleapis|adstransparency|youtube|youtu\.be|facebook|fb\.com|instagram|linkedin|twitter|x\.com|tiktok|pinterest|reddit|quora|wikipedia|yelp|yellowpages|truelocal|hotfrog|productreview|trustpilot|sitejabber|glassdoor|indeed|seek|gumtree|amazon|ebay|microsoft|apple|maps\.app)\./i;

export interface SociaVaultCompanyAd {
  advertiserId: string;
  creativeId: string;
  format: string;
  adUrl: string;
  advertiserName: string;
  domain: string;
  imageUrl?: string | null;
  firstShown?: string;
  lastShown?: string;
}

export interface SociaVaultAdVariation {
  headline?: string;
  description?: string;
  destinationUrl?: string;
  visibleUrl?: string;
  image?: string | null;
  youtubeUrl?: string | null;
}

export interface SociaVaultAdDetails {
  advertiserId: string;
  creativeId: string;
  url: string;
  format: string;
  variations: SociaVaultAdVariation[];
}

export interface SociaVaultAdActivityMetrics {
  totalAdCount: number;
  activeAdCount: number;
  firstShown?: string;
  lastShown?: string;
  adDurationDays: number;
  avgCreativeDurationDays: number;
}

export interface SociaVaultCompetitorAdResult extends SociaVaultAdActivityMetrics {
  advertiserName: string;
  headline: string;
  description: string;
  destinationUrl: string;
  visibleUrl: string;
  adUrl: string;
  advertiserUrl: string;
  previewImageUrl?: string;
  format: string;
  allHeadlines: string[];
  allDescriptions: string[];
}

const ACTIVE_AD_WINDOW_MS = 45 * 24 * 60 * 60 * 1000;

export function isSociaVaultConfigured(): boolean {
  return Boolean(env.sociavaultApiKey);
}

function asRecord(val: unknown): Record<string, unknown> | null {
  if (!val || typeof val !== 'object' || Array.isArray(val)) return null;
  return val as Record<string, unknown>;
}

function objectValues<T>(val: Record<string, T> | T[] | null | undefined): T[] {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  return Object.values(val);
}

function domainFromWebsiteUrl(url: string): string {
  try {
    return new URL(url.startsWith('http') ? url : `https://${url}`).hostname.replace(/^www\./, '');
  } catch {
    return url.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0] ?? url;
  }
}

function siteDomain(url: string): string {
  return domainFromWebsiteUrl(url).toLowerCase();
}

/** Loose but safe advertiser name/domain brand match — never accept a random first hit. */
function advertiserNameLikelyMatch(
  advertiserName: string,
  targetName: string,
  domainBrand?: string
): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const a = norm(advertiserName);
  const t = norm(targetName);
  const brand = domainBrand ? norm(domainBrand) : '';
  if (!a) return false;
  if (t && (a === t || (t.length >= 4 && (a.includes(t) || t.includes(a))))) return true;
  if (brand.length >= 4 && (a.includes(brand) || brand.includes(a.slice(0, Math.min(a.length, brand.length))))) {
    return true;
  }
  return false;
}

function pickString(...vals: unknown[]): string | undefined {
  for (const v of vals) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return undefined;
}

function parseAdDate(value?: string | null): number | null {
  if (!value?.trim()) return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : null;
}

/** Normalize one company-ad row from camelCase or snake_case API payloads. */
function normalizeCompanyAd(raw: unknown): SociaVaultCompanyAd | null {
  const o = asRecord(raw);
  if (!o) return null;
  const adUrl = pickString(o.adUrl, o.ad_url, o.url);
  if (!adUrl) return null;
  return {
    advertiserId: pickString(o.advertiserId, o.advertiser_id) ?? '',
    creativeId: pickString(o.creativeId, o.creative_id) ?? '',
    format: pickString(o.format) ?? 'unknown',
    adUrl,
    advertiserName: pickString(o.advertiserName, o.advertiser_name) ?? '',
    domain: pickString(o.domain)?.replace(/^www\./, '') ?? '',
    imageUrl: (pickString(o.imageUrl, o.image_url) as string | undefined) ?? null,
    firstShown: pickString(o.firstShown, o.first_shown, o.startDate, o.start_date),
    lastShown: pickString(o.lastShown, o.last_shown, o.endDate, o.end_date),
  };
}

/** Extract ads array from varied SociaVault response shapes. */
function extractAdsPayload(payload: unknown): SociaVaultCompanyAd[] {
  const root = asRecord(payload);
  if (!root) return [];

  // Common: { success, data: { ads: {...} } } already unwrapped to data by sociavaultGet
  const candidates: unknown[] = [
    root.ads,
    asRecord(root.data)?.ads,
    asRecord(asRecord(root.data)?.data)?.ads,
    root.results,
    asRecord(root.data)?.results,
    Array.isArray(root) ? root : null,
    Array.isArray(asRecord(root.data)) ? root.data : null,
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const rows = objectValues(candidate as Record<string, unknown> | unknown[]);
    const normalized = rows.map(normalizeCompanyAd).filter((a): a is SociaVaultCompanyAd => Boolean(a));
    if (normalized.length) return normalized;
  }
  return [];
}

export function computeSociaVaultAdActivity(ads: SociaVaultCompanyAd[]): SociaVaultAdActivityMetrics {
  const now = Date.now();
  let earliest: number | null = null;
  let latest: number | null = null;
  let creativeDurationSum = 0;
  let creativeDurationCount = 0;
  let activeAdCount = 0;

  for (const ad of ads) {
    const first = parseAdDate(ad.firstShown);
    const last = parseAdDate(ad.lastShown);
    if (first != null) earliest = earliest == null ? first : Math.min(earliest, first);
    if (last != null) latest = latest == null ? last : Math.max(latest, last);
    if (first != null && last != null && last >= first) {
      creativeDurationSum += Math.max(1, Math.round((last - first) / (24 * 60 * 60 * 1000)));
      creativeDurationCount += 1;
    }
    // If lastShown missing, still count as active (library often omits dates on some rows)
    if (last == null || now - last <= ACTIVE_AD_WINDOW_MS) {
      activeAdCount += 1;
    }
  }

  // If we have ads but no dates, still report total; duration stays 0
  const adDurationDays =
    earliest != null && latest != null && latest >= earliest
      ? Math.max(1, Math.round((latest - earliest) / (24 * 60 * 60 * 1000)))
      : 0;

  return {
    totalAdCount: ads.length,
    activeAdCount: ads.length ? activeAdCount : 0,
    firstShown: earliest != null ? new Date(earliest).toISOString() : undefined,
    lastShown: latest != null ? new Date(latest).toISOString() : undefined,
    adDurationDays,
    avgCreativeDurationDays:
      creativeDurationCount > 0 ? Math.round(creativeDurationSum / creativeDurationCount) : adDurationDays,
  };
}

export function scoreSociaVaultAdActivity(metrics: SociaVaultAdActivityMetrics): number {
  const durationScore = Math.min(24, Math.round(metrics.adDurationDays / 15));
  const volumeScore = Math.min(16, metrics.activeAdCount * 2 + Math.min(metrics.totalAdCount, 8));
  const longevityBonus = metrics.avgCreativeDurationDays >= 30 ? 6 : metrics.avgCreativeDurationDays >= 14 ? 3 : 0;
  return durationScore + volumeScore + longevityBonus;
}

let lastSociaVaultError: { status?: number; message?: string } | null = null;
let creditsExhaustedUntil = 0;

export function isSociaVaultCreditsExhausted(): boolean {
  return Date.now() < creditsExhaustedUntil || lastSociaVaultError?.status === 402;
}

export function resetSociaVaultErrorState(): void {
  // Never clear a 402 — keep skipping API calls until the cooldown ends
  if (isSociaVaultCreditsExhausted()) return;
  lastSociaVaultError = null;
}

export function getSociaVaultErrorState(): { creditsExhausted: boolean; message?: string } {
  return {
    creditsExhausted: isSociaVaultCreditsExhausted(),
    message: lastSociaVaultError?.message,
  };
}

async function sociavaultGet(path: string, params: Record<string, string | undefined>): Promise<unknown | null> {
  if (!env.sociavaultApiKey) return null;
  if (isSociaVaultCreditsExhausted()) {
    console.warn(`[SociaVault] skip ${path} — credits exhausted, not calling API`);
    return null;
  }

  const cleanParams = Object.fromEntries(
    Object.entries(params).filter(([, v]) => v != null && v !== '')
  ) as Record<string, string>;

  try {
    const res = await axios.get(`${BASE_URL}${path}`, {
      params: cleanParams,
      headers: { 'X-API-Key': env.sociavaultApiKey },
      timeout: 55_000,
    });
    const body = res.data;
    const root = asRecord(body);
    if (root && 'data' in root && root.data != null) return root.data;
    return body;
  } catch (err) {
    const msg = axios.isAxiosError(err)
      ? `${err.response?.status ?? ''} ${JSON.stringify(err.response?.data ?? err.message)}`
      : String(err);
    if (axios.isAxiosError(err)) {
      lastSociaVaultError = {
        status: err.response?.status,
        message: typeof err.response?.data === 'object'
          ? JSON.stringify(err.response.data)
          : String(err.response?.data ?? err.message),
      };
      if (err.response?.status === 402) {
        creditsExhaustedUntil = Date.now() + 30 * 60 * 1000;
        console.warn('[SociaVault] credits exhausted (402) — pausing all SociaVault calls for 30 minutes');
      }
    } else {
      lastSociaVaultError = { message: msg };
    }
    console.warn(`[SociaVault] ${path} failed:`, msg.slice(0, 240));
    return null;
  }
}

export async function searchSociaVaultAdvertisers(query: string): Promise<
  Array<{ name: string; advertiser_id: string; region?: string; number_of_ads_estimate?: number }>
> {
  const data = await sociavaultGet('/search-advertisers', { query });
  const root = asRecord(data);
  const advertisers =
    root?.advertisers ??
    asRecord(root?.data)?.advertisers ??
    root?.results ??
    (Array.isArray(data) ? data : null);

  return objectValues(advertisers as Record<string, unknown> | unknown[] | null | undefined)
    .map((raw) => {
      const a = asRecord(raw);
      if (!a) return null;
      const advertiser_id = pickString(a.advertiser_id, a.advertiserId, a.id);
      if (!advertiser_id) return null;
      const region = pickString(a.region);
      const estimateRaw = a.number_of_ads_estimate ?? a.numberOfAdsEstimate ?? a.adCount;
      const number_of_ads_estimate =
        typeof estimateRaw === 'number'
          ? estimateRaw
          : typeof estimateRaw === 'string' && estimateRaw.trim()
            ? parseInt(estimateRaw, 10)
            : undefined;
      return {
        name: pickString(a.name, a.advertiserName, a.advertiser_name) ?? '',
        advertiser_id,
        ...(region ? { region } : {}),
        ...(Number.isFinite(number_of_ads_estimate) ? { number_of_ads_estimate } : {}),
      };
    })
    .filter(
      (a): a is { name: string; advertiser_id: string; region?: string; number_of_ads_estimate?: number } =>
        a != null
    );
}

export async function fetchSociaVaultCompanyAds(options: {
  domain?: string;
  advertiserId?: string;
  region?: string;
  maxPages?: number;
}): Promise<SociaVaultCompanyAd[]> {
  const maxPages = options.maxPages ?? 1;
  const all: SociaVaultCompanyAd[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < maxPages; page++) {
    const data = await sociavaultGet('/company-ads', {
      domain: options.domain,
      advertiser_id: options.advertiserId,
      region: options.region,
      topic: 'all',
      cursor,
    });
    if (!data) break;

    const pageAds = extractAdsPayload(data);
    all.push(...pageAds);

    const root = asRecord(data);
    const nextCursor = pickString(root?.cursor, asRecord(root?.data)?.cursor);
    if (!nextCursor || !pageAds.length) break;
    cursor = nextCursor;
  }

  // Dedupe by creativeId/adUrl
  const seen = new Set<string>();
  return all.filter((ad) => {
    const key = (ad.creativeId || ad.adUrl).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function fetchSociaVaultAdDetails(adUrl: string): Promise<SociaVaultAdDetails | null> {
  const data = await sociavaultGet('/ad-details', { url: adUrl });
  const root = asRecord(data);
  if (!root && !adUrl) return null;

  const variationsRaw =
    root?.variations ??
    asRecord(root?.data)?.variations ??
    [];

  const variations = objectValues(variationsRaw as Record<string, unknown> | unknown[]).map((raw) => {
    const v = asRecord(raw) ?? {};
    return {
      headline: pickString(v.headline) ? decodeHtmlEntities(String(v.headline)) : undefined,
      description: pickString(v.description) ? decodeHtmlEntities(String(v.description)) : undefined,
      destinationUrl: pickString(v.destinationUrl, v.destination_url),
      visibleUrl: pickString(v.visibleUrl, v.visible_url),
      image: pickString(v.image, v.imageUrl, v.image_url) ?? null,
      youtubeUrl: pickString(v.youtubeUrl, v.youtube_url) ?? null,
    };
  });

  return {
    advertiserId: pickString(root?.advertiserId, root?.advertiser_id) ?? '',
    creativeId: pickString(root?.creativeId, root?.creative_id) ?? '',
    url: pickString(root?.url) ?? adUrl,
    format: pickString(root?.format) ?? 'unknown',
    variations,
  };
}

function scoreCompanyAdBase(ad: SociaVaultCompanyAd): number {
  let score = 0;
  if (ad.format === 'text') score += 100;
  if (ad.format === 'image') score += 40;
  const now = Date.now();
  const first = parseAdDate(ad.firstShown);
  const last = parseAdDate(ad.lastShown);
  if (last != null && now - last <= ACTIVE_AD_WINDOW_MS) score += 25;
  if (first != null && last != null && last >= first) {
    const days = (last - first) / (24 * 60 * 60 * 1000);
    score += Math.min(40, Math.round(days / 7));
  } else if (ad.lastShown) {
    score += 10;
  }
  return score;
}

function rankCompanyAds(ads: SociaVaultCompanyAd[]): SociaVaultCompanyAd[] {
  return [...ads]
    .map((ad) => ({ ad, score: scoreCompanyAdBase(ad) }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (b.ad.lastShown ?? '').localeCompare(a.ad.lastShown ?? '');
    })
    .map((x) => x.ad);
}

/** Prefer a real advertiser website host — skip Google/CDN hosts. */
function isUsableAdvertiserHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^www\./, '');
  if (!h || !h.includes('.')) return false;
  if (
    /google|gstatic|doubleclick|googleusercontent|googleapis|adstransparency|youtube|ggpht/i.test(h)
  ) {
    return false;
  }
  return true;
}

/**
 * Many Transparency advertisers return company-ads with blank `domain`.
 * Recover the landing domain from ad-details destination/visible URLs so discovery can continue.
 */
async function resolveDomainFromCompanyAds(ads: SociaVaultCompanyAd[]): Promise<string | null> {
  const fromField = ads.find((a) => a.domain?.trim())?.domain?.replace(/^www\./, '');
  if (fromField && isUsableAdvertiserHost(fromField)) return fromField;

  for (const ad of rankCompanyAds(ads).slice(0, 2)) {
    if (!ad.adUrl) continue;
    try {
      const details = await fetchSociaVaultAdDetails(ad.adUrl);
      for (const v of details?.variations ?? []) {
        for (const candidate of [v.destinationUrl, v.visibleUrl]) {
          if (!candidate?.trim()) continue;
          const host = domainFromWebsiteUrl(candidate);
          if (isUsableAdvertiserHost(host)) return host.replace(/^www\./, '');
        }
      }
    } catch {
      /* try next creative */
    }
  }
  return null;
}

function pickBestCompanyAd(ads: SociaVaultCompanyAd[]): SociaVaultCompanyAd | null {
  return rankCompanyAds(ads)[0] ?? null;
}

function englishVariations(variations: SociaVaultAdVariation[]): SociaVaultAdVariation[] {
  return variations.filter((v) =>
    isEnglishAdCopy([v.headline ?? ''], [v.description ?? ''])
  );
}

function pickBestVariation(
  variations: SociaVaultAdVariation[],
  serviceTerms?: string[]
): SociaVaultAdVariation | null {
  const pool = englishVariations(variations);
  const source = pool.length ? pool : variations;

  if (serviceTerms?.length) {
    // Prefer a family match, but keep a usable English variation for LLM relevance.
    const matched = source.find((v) =>
      creativeMatchesTargetService(
        {
          headline: v.headline,
          description: v.description,
        },
        serviceTerms
      )
    );
    if (matched) return matched;
  }
  return (
    source.find(
      (v) =>
        v.headline?.trim() &&
        v.description?.trim() &&
        !isGarbageCreativeText(`${v.headline} ${v.description}`)
    ) ??
    source.find((v) => v.headline?.trim() || v.description?.trim()) ??
    null
  );
}

/**
 * Load all company ads for a competitor (domain → advertiser search), with and without region.
 * Returns ads + activity metrics even when OCR/ad-details later fails.
 */
export async function fetchSociaVaultAdvertiserLibrary(options: {
  name: string;
  url: string;
  country?: string;
  /** When known from discovery, fetch company-ads by advertiser id (works even without domain). */
  advertiserId?: string;
}): Promise<{ ads: SociaVaultCompanyAd[]; activity: SociaVaultAdActivityMetrics }> {
  const empty = { ads: [] as SociaVaultCompanyAd[], activity: computeSociaVaultAdActivity([]) };
  if (!isSociaVaultConfigured() || isSociaVaultCreditsExhausted()) return empty;

  const domain = domainFromWebsiteUrl(options.url);
  const region = options.country || undefined;
  let ads: SociaVaultCompanyAd[] = [];

  // 0) Direct advertiser id — required when Transparency company-ads omit domain
  if (options.advertiserId) {
    if (region) {
      ads = await fetchSociaVaultCompanyAds({
        advertiserId: options.advertiserId,
        region,
        maxPages: 1,
      });
    }
    if (!ads.length && !isSociaVaultCreditsExhausted()) {
      ads = await fetchSociaVaultCompanyAds({
        advertiserId: options.advertiserId,
        maxPages: 1,
      });
    }
  }

  // 1) domain + region (skip placeholder transparency hosts)
  if (!ads.length && isUsableAdvertiserHost(domain) && region && !isSociaVaultCreditsExhausted()) {
    ads = await fetchSociaVaultCompanyAds({ domain, region, maxPages: 1 });
  }
  // 2) domain anywhere
  if (!ads.length && isUsableAdvertiserHost(domain) && !isSociaVaultCreditsExhausted()) {
    ads = await fetchSociaVaultCompanyAds({ domain, maxPages: 1 });
  }
  // 3) advertiser search by name / domain brand — require a name/brand match (no advertisers[0])
  if (!ads.length && !isSociaVaultCreditsExhausted()) {
    const brand = (domain.split('.')[0] ?? '').toLowerCase();
    const queries = [options.name, brand].filter((q) => q && q.trim().length > 2);
    for (const q of queries) {
      if (isSociaVaultCreditsExhausted()) break;
      const advertisers = await searchSociaVaultAdvertisers(q);
      const ranked = advertisers.filter((a) =>
        advertiserNameLikelyMatch(a.name, options.name, brand)
      );
      const match =
        (region ? ranked.find((a) => a.region === region) : undefined) ?? ranked[0];
      if (!match) {
        console.warn(
          `[SociaVault] skip name search "${q}": no advertiser matched "${options.name}" / ${brand}`
        );
        continue;
      }
      ads = await fetchSociaVaultCompanyAds({
        advertiserId: match.advertiser_id,
        region: region ?? match.region,
        maxPages: 1,
      });
      if (!ads.length) {
        ads = await fetchSociaVaultCompanyAds({ advertiserId: match.advertiser_id, maxPages: 1 });
      }
      if (ads.length) break;
    }
  }

  if (ads.length && !ads.some((a) => a.domain?.trim())) {
    const recovered = await resolveDomainFromCompanyAds(ads);
    if (recovered) {
      ads = ads.map((a) => (a.domain?.trim() ? a : { ...a, domain: recovered }));
    }
  }

  console.log(
    `[SociaVault] library ${options.advertiserId ? `id=${options.advertiserId}` : domain}: ${ads.length} ads, duration=${computeSociaVaultAdActivity(ads).adDurationDays}d, active=${computeSociaVaultAdActivity(ads).activeAdCount}`
  );

  return { ads, activity: computeSociaVaultAdActivity(ads) };
}

type DiscoveredCompetitor = {
  name: string;
  url: string;
  score: number;
  activity: SociaVaultAdActivityMetrics;
  advertiserId?: string;
};

function isCompetitorSerpHost(host: string, ownDomain: string): boolean {
  const h = host.toLowerCase().replace(/^www\./, '');
  if (!isUsableAdvertiserHost(h)) return false;
  if (h === ownDomain || h.endsWith(`.${ownDomain}`) || ownDomain.endsWith(`.${h}`)) return false;
  const blocked = [
    'google.com',
    'google.com.au',
    'facebook.com',
    'instagram.com',
    'linkedin.com',
    'youtube.com',
    'youtu.be',
    'twitter.com',
    'x.com',
    'tiktok.com',
    'pinterest.com',
    'reddit.com',
    'quora.com',
    'wikipedia.org',
    'yelp.com',
    'yellowpages.com.au',
    'truelocal.com.au',
    'productreview.com.au',
    'trustpilot.com',
    'indeed.com',
    'seek.com.au',
    'gumtree.com.au',
    'amazon.com',
    'ebay.com.au',
    'apple.com',
    'microsoft.com',
  ];
  if (blocked.some((b) => h === b || h.endsWith(`.${b}`))) return false;
  if (NON_COMPETITOR_HOST_RE.test(h)) return false;
  return true;
}

function hostnameToDisplayName(host: string): string {
  const brand = host.replace(/^www\./, '').split('.')[0] ?? host;
  return brand
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

/**
 * SociaVault Google Ads Transparency `/company-ads` needs a domain (or advertiser_id),
 * not keywords. Use SociaVault Google Search with service keywords to find rival domains,
 * then fetch ads by domain.
 */
export async function discoverCompetitorDomainsViaWebSearch(options: {
  searchQueries: string[];
  siteUrl: string;
  region?: string;
  maxDomains?: number;
  maxQueries?: number;
}): Promise<Array<{ domain: string; name: string; query: string; rank: number }>> {
  if (!isSociaVaultConfigured() || !env.sociavaultApiKey) return [];

  const ownDomain = siteDomain(options.siteUrl);
  const maxDomains = options.maxDomains ?? 12;
  const maxQueries = options.maxQueries ?? Math.min(8, options.searchQueries.length);
  const found = new Map<string, { domain: string; name: string; query: string; rank: number }>();

  const queries = [...new Set(options.searchQueries.map((q) => q.trim()).filter(Boolean))].slice(
    0,
    maxQueries
  );

  for (let qi = 0; qi < queries.length; qi++) {
    const query = queries[qi]!;
    try {
      const res = await axios.get(`${SEARCH_BASE_URL}/google/search`, {
        params: { query, region: options.region ?? 'AU' },
        headers: { 'X-API-Key': env.sociavaultApiKey },
        timeout: 25_000,
        validateStatus: (s) => s < 500,
      });
      if (res.status >= 400) {
        console.warn(`[SociaVault] google/search "${query}" → HTTP ${res.status}`);
        continue;
      }

      const data = asRecord(res.data) ?? {};
      const inner = asRecord(data.data) ?? data;
      const resultsRaw = inner.results ?? inner.organic_results ?? inner.items;
      const rows: unknown[] = Array.isArray(resultsRaw)
        ? resultsRaw
        : resultsRaw && typeof resultsRaw === 'object'
          ? Object.values(resultsRaw as Record<string, unknown>)
          : [];

      let added = 0;
      for (let ri = 0; ri < rows.length; ri++) {
        const row = asRecord(rows[ri]);
        const link =
          pickString(row?.url, row?.link, row?.href, row?.displayed_link, row?.displayUrl) ?? '';
        if (!link) continue;
        let host = '';
        try {
          host = domainFromWebsiteUrl(link);
        } catch {
          continue;
        }
        if (!isCompetitorSerpHost(host, ownDomain)) continue;
        if (options.region && !competitorUrlMatchesCountry(`https://${host}`, options.region)) {
          continue;
        }
        const key = host.toLowerCase();
        if (found.has(key)) continue;
        const title = pickString(row?.title, row?.name) ?? hostnameToDisplayName(host);
        found.set(key, {
          domain: host,
          name: title.replace(/\s*[|\-–—].*$/, '').trim() || hostnameToDisplayName(host),
          query,
          rank: qi * 20 + ri,
        });
        added += 1;
        if (found.size >= maxDomains) break;
      }
      console.log(
        `[SociaVault] web search "${query}" → ${rows.length} result(s), ${added} new competitor domain(s)`
      );
    } catch (err) {
      console.warn(
        `[SociaVault] web search "${query}" failed:`,
        err instanceof Error ? err.message : err
      );
    }
    if (found.size >= maxDomains) break;
  }

  console.log(
    `[SociaVault] web search collected ${found.size} competitor domain(s) from ${queries.length} keyword quer(y/ies)`
  );
  return [...found.values()].sort((a, b) => a.rank - b.rank);
}

async function addDomainBackedCompetitor(
  results: Map<string, DiscoveredCompetitor>,
  options: {
    domain: string;
    name?: string;
    region?: string;
    ownDomain: string;
    scoreBoost?: number;
  }
): Promise<boolean> {
  const domain = options.domain.toLowerCase().replace(/^www\./, '');
  if (!isUsableAdvertiserHost(domain) || domain === options.ownDomain) return false;
  if (results.has(`dom:${domain}`)) return false;

  let ads = await fetchSociaVaultCompanyAds({
    domain,
    region: options.region,
    maxPages: 2,
  });
  if (!ads.length && options.region) {
    ads = await fetchSociaVaultCompanyAds({ domain, maxPages: 2 });
  }
  if (!ads.length) {
    console.log(`[SociaVault] company-ads domain=${domain} → 0 ads (skip)`);
    return false;
  }

  const activity = computeSociaVaultAdActivity(ads);
  if (activity.totalAdCount <= 0) return false;

  const advertiserId = ads.find((a) => a.advertiserId)?.advertiserId;
  const name =
    options.name?.trim() ||
    ads.find((a) => a.advertiserName?.trim())?.advertiserName?.trim() ||
    hostnameToDisplayName(domain);
  const score = (options.scoreBoost ?? 10) + scoreSociaVaultAdActivity(activity);
  const key = advertiserId ? `adv:${advertiserId}` : `dom:${domain}`;
  const existing = results.get(key);
  if (!existing || score > existing.score) {
    results.set(key, {
      name,
      url: `https://${domain}`,
      score: (existing?.score ?? 0) + score,
      activity,
      advertiserId,
    });
  }
  console.log(
    `[SociaVault] domain=${domain} → ${activity.totalAdCount} ads (active=${activity.activeAdCount}) as "${name}"`
  );
  return true;
}

export async function discoverSociaVaultCompetitors(options: {
  siteUrl: string;
  searchQueries: string[];
  region?: string;
  maxCount?: number;
  /** Stop after this many consecutive advertiser-search queries that add zero rivals (default: no early stop). */
  maxEmptyQueries?: number;
}): Promise<DiscoveredCompetitor[]> {
  if (!isSociaVaultConfigured() || isSociaVaultCreditsExhausted()) return [];

  const max = options.maxCount ?? 6;
  const ownDomain = siteDomain(options.siteUrl);
  const region =
    options.region ?? inferCountryFromWebsiteUrl(options.siteUrl) ?? 'AU';
  const results = new Map<string, DiscoveredCompetitor>();
  const queries = [...new Set(options.searchQueries.map((q) => q.trim()).filter(Boolean))];

  // ── Primary: keyword web search → competitor domains → company-ads by domain ──
  // Transparency /company-ads cannot take keywords; domains come from organic SERP.
  const webDomains = await discoverCompetitorDomainsViaWebSearch({
    searchQueries: queries,
    siteUrl: options.siteUrl,
    region,
    maxDomains: Math.max(max + 6, 12),
    maxQueries: Math.min(queries.length, 8),
  });

  for (let i = 0; i < webDomains.length; i++) {
    const hit = webDomains[i]!;
    if (region && !competitorUrlMatchesCountry(`https://${hit.domain}`, region)) continue;
    await addDomainBackedCompetitor(results, {
      domain: hit.domain,
      name: hit.name,
      region,
      ownDomain,
      scoreBoost: Math.max(4, 20 - i),
    });
    if (results.size >= max + 2) break;
  }

  console.log(
    `[SociaVault] after web→domain path: ${results.size} rival(s) with ads (need ${max})`
  );

  // ── Fallback: advertiser keyword search (may return IDs without useful domains) ──
  if (results.size < max) {
    let emptyStreak = 0;
    const emptyCap = options.maxEmptyQueries ?? 0;

    for (let qi = 0; qi < queries.length; qi++) {
      if (results.size >= max + 2) break;
      const query = queries[qi]!;
      const before = results.size;
      const advertisers = await searchSociaVaultAdvertisers(query);
      console.log(`[SociaVault] advertiser-search "${query}" → ${advertisers.length} hit(s)`);

      const rankedAdvertisers = [...advertisers].sort((a, b) => {
        const ae = a.number_of_ads_estimate ?? 0;
        const be = b.number_of_ads_estimate ?? 0;
        return be - ae;
      });

      for (const advertiser of rankedAdvertisers.slice(0, 6)) {
        if (region && advertiser.region && advertiser.region !== region) continue;
        let ads = await fetchSociaVaultCompanyAds({
          advertiserId: advertiser.advertiser_id,
          region: region ?? advertiser.region,
          maxPages: 2,
        });
        if (!ads.length) {
          ads = await fetchSociaVaultCompanyAds({
            advertiserId: advertiser.advertiser_id,
            maxPages: 2,
          });
        }
        if (!ads.length) continue;

        let resolvedDomain =
          ads.find((a) => a.domain?.trim())?.domain?.replace(/^www\./, '') ?? '';
        if (!resolvedDomain || !isUsableAdvertiserHost(resolvedDomain)) {
          const recovered = await resolveDomainFromCompanyAds(ads);
          if (recovered) resolvedDomain = recovered;
        }

        const activity = computeSociaVaultAdActivity(ads);
        if (activity.totalAdCount === 0) continue;

        const queryBoost = Math.max(1, queries.length - qi);
        const activityScore = scoreSociaVaultAdActivity(activity);
        const estimateBoost = Math.min(12, Math.round((advertiser.number_of_ads_estimate ?? 0) / 100));
        const score = queryBoost * 2 + activityScore + estimateBoost;
        const name = advertiser.name.trim() || resolvedDomain.split('.')[0] || 'Competitor';

        if (resolvedDomain && isUsableAdvertiserHost(resolvedDomain)) {
          if (siteDomain(resolvedDomain) === ownDomain) continue;
          if (region && !competitorUrlMatchesCountry(`https://${resolvedDomain}`, region)) continue;
          // Prefer domain-backed company-ads path for this host when we only have an ID
          const added = await addDomainBackedCompetitor(results, {
            domain: resolvedDomain,
            name,
            region: options.region,
            ownDomain,
            scoreBoost: score,
          });
          if (!added) {
            const key = `adv:${advertiser.advertiser_id}`;
            const existing = results.get(key);
            if (!existing || score > existing.score) {
              results.set(key, {
                name,
                url: `https://${resolvedDomain}`,
                score: (existing?.score ?? 0) + score,
                activity,
                advertiserId: advertiser.advertiser_id,
              });
            }
          }
        } else {
          const key = `adv:${advertiser.advertiser_id}`;
          const existing = results.get(key);
          if (!existing || score > existing.score) {
            results.set(key, {
              name,
              url: `https://adstransparency.google.com/advertiser/${advertiser.advertiser_id}`,
              score: (existing?.score ?? 0) + score,
              activity,
              advertiserId: advertiser.advertiser_id,
            });
          }
        }
        if (results.size >= max + 2) break;
      }

      if (results.size === before) {
        emptyStreak += 1;
        // Only early-stop advertiser-search fallback once we already have some web rivals,
        // or after several empties — never after a single empty query.
        if (emptyCap > 0 && emptyStreak >= Math.max(emptyCap, 3) && results.size === 0) {
          console.warn(
            `[SociaVault] early-stop advertiser-search after ${emptyStreak} empty quer(y/ies)`
          );
          break;
        }
      } else {
        emptyStreak = 0;
      }
    }
  }

  console.log(
    `[SociaVault] discovery found ${results.size} competitor(s) from ${queries.length} keyword quer(y/ies) (web+ads)`
  );

  return [...results.values()]
    .sort((a, b) => b.score - a.score || b.activity.adDurationDays - a.activity.adDurationDays)
    .slice(0, max);
}

/**
 * Resolve a competitor name/URL to a SociaVault library hit with real activity metrics.
 * Prefer domain lookup; fall back to advertiser name search and use the domain from ads.
 */
export async function resolveCompetitorViaSociaVault(options: {
  name: string;
  url: string;
  country?: string;
}): Promise<{
  name: string;
  url: string;
  activity: SociaVaultAdActivityMetrics;
} | null> {
  if (!isSociaVaultConfigured()) return null;

  const library = await fetchSociaVaultAdvertiserLibrary(options);
  if (library.activity.totalAdCount > 0) {
    const domain =
      library.ads.find((a) => a.domain?.trim())?.domain?.replace(/^www\./, '') ??
      domainFromWebsiteUrl(options.url);
    return {
      name: library.ads[0]?.advertiserName || options.name,
      url: `https://${domain}`,
      activity: library.activity,
    };
  }

  // Name-only recovery: search advertisers, load company-ads, keep first validated match
  const queries = [options.name, domainFromWebsiteUrl(options.url).split('.')[0] ?? ''].filter(
    (q) => q.trim().length > 2
  );
  const brand = domainFromWebsiteUrl(options.url).split('.')[0] ?? '';
  for (const q of queries) {
    const advertisers = await searchSociaVaultAdvertisers(q);
    const ranked = advertisers.filter((a) => advertiserNameLikelyMatch(a.name, options.name, brand));
    for (const advertiser of ranked.slice(0, 4)) {
      let ads = await fetchSociaVaultCompanyAds({
        advertiserId: advertiser.advertiser_id,
        region: options.country ?? advertiser.region,
        maxPages: 1,
      });
      if (!ads.length) {
        ads = await fetchSociaVaultCompanyAds({ advertiserId: advertiser.advertiser_id, maxPages: 1 });
      }
      const domain = ads.find((a) => a.domain?.trim())?.domain?.replace(/^www\./, '');
      if (!domain || !ads.length) continue;
      return {
        name: advertiser.name || options.name,
        url: `https://${domain}`,
        activity: computeSociaVaultAdActivity(ads),
      };
    }
  }

  return null;
}

/** Blog/article SERP titles mistaken for advertisers — not real companies. */
export function isLikelyArticleAdvertiser(name: string): boolean {
  const n = name.trim();
  if (!n || n.length < 4) return true;
  if (/^\d+\s/.test(n)) return true;
  if (/\b(best|top|guide|ranked|reviewed|tools for)\b/i.test(n) && /\b20\d{2}\b/.test(n)) return true;
  if (/\(\s*tested|ranked\s*&\s*ranked|people actually use\)/i.test(n)) return true;
  if (/\byour guide for\b/i.test(n)) return true;
  return false;
}

/**
 * Activity metrics are returned even if OCR/ad-details fails (as long as company-ads succeeded).
 * When serviceTerms are provided, samples multiple creatives until the *primary* copy matches.
 */
export async function fetchSociaVaultCompetitorAd(options: {
  name: string;
  url: string;
  country?: string;
  /** Prefer creatives whose OCR copy matches these service labels (e.g. ["Car Loans"]) */
  serviceTerms?: string[];
  /** Max ad-details lookups when filtering by service (default 6) */
  maxServiceAdSamples?: number;
  advertiserId?: string;
}): Promise<SociaVaultCompetitorAdResult | null> {
  if (!isSociaVaultConfigured() || isSociaVaultCreditsExhausted()) return null;

  const domain = domainFromWebsiteUrl(options.url);
  const region = options.country ?? undefined;
  const { ads, activity } = await fetchSociaVaultAdvertiserLibrary(options);

  if (!ads.length) return null;

  const serviceTerms = (options.serviceTerms ?? []).map((s) => s.trim()).filter(Boolean);
  const requireService = serviceTerms.length > 0;

  const ranked = rankCompanyAds(ads);
  const sampleLimit = requireService
    ? Math.min(options.maxServiceAdSamples ?? 4, Math.max(ranked.length, 1))
    : 1;
  const candidates = ranked.slice(0, Math.max(1, sampleLimit));

  for (const companyAd of candidates) {
    if (!companyAd.adUrl) continue;

    let headline = '';
    let description = '';
    let previewImageUrl: string | undefined = companyAd.imageUrl ?? undefined;
    let destinationUrl = options.url;
    let visibleUrl = companyAd.domain || domain;
    let adUrl = companyAd.adUrl;
    let format = companyAd.format;
    let allHeadlines: string[] = [];
    let allDescriptions: string[] = [];

    try {
      const details = await fetchSociaVaultAdDetails(companyAd.adUrl);
      if (details) {
        const variation = pickBestVariation(
          details.variations,
          requireService ? serviceTerms : undefined
        );
        if (!variation && requireService && !details.variations.length) {
          continue;
        }
        const chosen =
          variation ??
          details.variations.find((v) => v.headline?.trim() || v.description?.trim()) ??
          null;
        headline = chosen?.headline?.trim() ?? '';
        description = chosen?.description?.trim() ?? '';
        destinationUrl = chosen?.destinationUrl ?? options.url;
        visibleUrl = chosen?.visibleUrl ?? (companyAd.domain || domain);
        adUrl = details.url || companyAd.adUrl;
        format = details.format || companyAd.format;
        previewImageUrl = chosen?.image ?? companyAd.imageUrl ?? undefined;

        const matchedVariations = requireService
          ? details.variations.filter((v) =>
              creativeMatchesTargetService(
                { headline: v.headline, description: v.description },
                serviceTerms
              )
            )
          : details.variations;
        const sourceVars = requireService
          ? matchedVariations.length
            ? matchedVariations
            : chosen
              ? [chosen]
              : []
          : details.variations;
        allHeadlines = [
          ...new Set(sourceVars.map((v) => v.headline?.trim()).filter(Boolean) as string[]),
        ];
        allDescriptions = [
          ...new Set(sourceVars.map((v) => v.description?.trim()).filter(Boolean) as string[]),
        ];

      }
    } catch (err) {
      console.warn(`[SociaVault] ad-details failed for ${companyAd.adUrl}:`, err instanceof Error ? err.message : err);
      if (requireService) continue;
    }

    if (requireService && isGarbageCreativeText(`${headline} ${description}`)) continue;
    if (
      region &&
      !isEnglishAdCopy(
        allHeadlines.length ? allHeadlines : headline ? [headline] : [],
        allDescriptions.length ? allDescriptions : description ? [description] : []
      )
    ) {
      continue;
    }
    const advertiserKey = options.advertiserId || companyAd.advertiserId;
    const advertiserUrl = advertiserKey
      ? `https://adstransparency.google.com/advertiser/${advertiserKey}?region=${region ?? 'anywhere'}`
      : adUrl;

    if (requireService) {
      console.log(
        `[SociaVault] service-matched creative for ${options.name} → "${(headline || allHeadlines[0] || '').slice(0, 60)}"`
      );
    }

    return {
      advertiserName: companyAd.advertiserName || options.name,
      headline,
      description,
      destinationUrl,
      visibleUrl,
      adUrl,
      advertiserUrl,
      previewImageUrl,
      format,
      allHeadlines,
      allDescriptions,
      ...activity,
    };
  }

  if (requireService) {
    // Advertiser name itself may lock the vertical (e.g. "GB Car Loans") even when OCR is empty.
    // Still surface them in Make It Better gallery with activity + best creative image.
    const nameOk =
      matchesTargetService(options.name, serviceTerms) &&
      !hasConflictingService(options.name, serviceTerms);
    const companyAd = ranked[0];
    if (nameOk && companyAd?.adUrl) {
      if (region && !competitorUrlMatchesCountry(options.url, region)) {
        console.log(
          `[SociaVault] skip name-matched fallback for ${options.name} — outside ${region} market`
        );
        return null;
      }
      console.log(
        `[SociaVault] name-matched service fallback for ${options.name} (no OCR "${serviceTerms[0]}" creative)`
      );
      return {
        advertiserName: companyAd.advertiserName || options.name,
        headline: '',
        description: '',
        destinationUrl: companyAd.domain ? `https://${companyAd.domain}` : options.url,
        visibleUrl: companyAd.domain || domain,
        adUrl: companyAd.adUrl,
        advertiserUrl: (() => {
          const advertiserKey = options.advertiserId || companyAd.advertiserId;
          return advertiserKey
            ? `https://adstransparency.google.com/advertiser/${advertiserKey}?region=${region ?? 'anywhere'}`
            : companyAd.adUrl;
        })(),
        previewImageUrl: companyAd.imageUrl ?? undefined,
        format: companyAd.format,
        allHeadlines: [],
        allDescriptions: [],
        ...activity,
      };
    }
    console.log(
      `[SociaVault] no "${serviceTerms[0]}" creative found for ${options.name} after ${candidates.length} sample(s) — skipping`
    );
    return null;
  }

  // Non-service path: activity-only fallback from top company ad
  const companyAd = ranked[0];
  if (!companyAd?.adUrl) return null;
  return {
    advertiserName: companyAd.advertiserName || options.name,
    headline: '',
    description: '',
    destinationUrl: options.url,
    visibleUrl: companyAd.domain || domain,
    adUrl: companyAd.adUrl,
    advertiserUrl: (() => {
      const advertiserKey = options.advertiserId || companyAd.advertiserId;
      return advertiserKey
        ? `https://adstransparency.google.com/advertiser/${advertiserKey}?region=${region ?? 'anywhere'}`
        : companyAd.adUrl;
    })(),
    previewImageUrl: companyAd.imageUrl ?? undefined,
    format: companyAd.format,
    allHeadlines: [],
    allDescriptions: [],
    ...activity,
  };
}

/**
 * Fetch creatives for an advertiser. By default does NOT require exact service keywords —
 * Claude semantic scoring in CompetitorIntel decides relatedness afterward.
 */
export async function fetchSociaVaultMatchingAds(options: {
  name: string;
  url: string;
  country?: string;
  service: string;
  seedKeywords?: string[];
  advertiserId?: string;
  maxAdSamples?: number;
  /** When true, require lexical seed match before return (legacy). Default false — Claude filters later. */
  requireLexicalMatch?: boolean;
}): Promise<SociaVaultCompetitorAdResult[]> {
  if (!isSociaVaultConfigured() || isSociaVaultCreditsExhausted()) return [];

  const domain = domainFromWebsiteUrl(options.url);
  const region = options.country ?? undefined;
  const service = options.service.trim();
  const requireLexical = options.requireLexicalMatch === true;
  const { ads, activity } = await fetchSociaVaultAdvertiserLibrary(options);
  if (!ads.length) return [];

  const ranked = rankCompanyAds(ads);
  const sampleLimit = Math.min(options.maxAdSamples ?? 16, ranked.length);
  const out: SociaVaultCompetitorAdResult[] = [];
  const seenCreative = new Set<string>();
  const samples = ranked.slice(0, sampleLimit).filter((companyAd) => Boolean(companyAd.adUrl));

  const detailed = await Promise.all(
    samples.map(async (companyAd) => {
      const adUrl = companyAd.adUrl;
      if (!adUrl) return { companyAd, details: null };
      try {
        const details = await fetchSociaVaultAdDetails(adUrl);
        return { companyAd, details };
      } catch {
        return { companyAd, details: null };
      }
    })
  );

  const pushVariation = (
    companyAd: SociaVaultCompanyAd,
    details: NonNullable<Awaited<ReturnType<typeof fetchSociaVaultAdDetails>>>,
    v: { headline?: string; description?: string; destinationUrl?: string; visibleUrl?: string; image?: string | null },
    force = false
  ) => {
    const headline = v.headline?.trim() ?? '';
    const description = v.description?.trim() ?? '';
    if (!headline && !description) return;
    if (isGarbageCreativeText(`${headline} ${description}`)) return;
    if (
      requireLexical &&
      !force &&
      !adMatchesServiceAndSeeds(
        {
          headlines: headline ? [headline] : [],
          descriptions: description ? [description] : [],
          destinationUrl: v.destinationUrl ?? options.url,
        },
        service,
        options.seedKeywords ?? []
      )
    ) {
      return;
    }
    if (
      region &&
      !isEnglishAdCopy(headline ? [headline] : [], description ? [description] : [])
    ) {
      return;
    }
    const key = `${headline}|${description}`.toLowerCase();
    if (seenCreative.has(key)) return;
    seenCreative.add(key);

    const advertiserKey = options.advertiserId || companyAd.advertiserId;
    out.push({
      advertiserName: companyAd.advertiserName || options.name,
      headline,
      description,
      destinationUrl: v.destinationUrl ?? options.url,
      visibleUrl: v.visibleUrl ?? (companyAd.domain || domain),
      adUrl: details.url || companyAd.adUrl,
      advertiserUrl: advertiserKey
        ? `https://adstransparency.google.com/advertiser/${advertiserKey}?region=${region ?? 'anywhere'}`
        : details.url || companyAd.adUrl,
      previewImageUrl: v.image ?? companyAd.imageUrl ?? undefined,
      format: details.format || companyAd.format,
      allHeadlines: headline ? [headline] : [],
      allDescriptions: description ? [description] : [],
      ...activity,
    });
  };

  for (const { companyAd, details } of detailed) {
    if (!details?.variations?.length) continue;
    for (const v of details.variations) {
      pushVariation(companyAd, details, v);
    }
  }

  // Lexical mode empty → soft synonym pass
  if (!out.length && requireLexical) {
    for (const { companyAd, details } of detailed) {
      if (!details?.variations?.length) continue;
      for (const v of details.variations) {
        pushVariation(companyAd, details, v, true);
        if (out.length >= 4) break;
      }
      if (out.length >= 4) break;
    }
  }

  if (out.length) {
    console.log(
      `[SociaVault] ${out.length} creative(s) sampled for ${options.name} (${service}) — Claude will score relatedness`
    );
  }
  return out;
}
