import axios from 'axios';
import { env } from '../config/env.js';
import { decodeHtmlEntities } from '../utils/html-entities.js';
import {
  creativeMatchesTargetService,
  hasConflictingService,
  isGarbageCreativeText,
  matchesTargetService,
} from '../utils/service-relevance.js';

const BASE_URL = 'https://api.sociavault.com/v1/scrape/google-ad-library';

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

async function sociavaultGet(path: string, params: Record<string, string | undefined>): Promise<unknown | null> {
  if (!env.sociavaultApiKey) return null;

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

function pickBestVariation(
  variations: SociaVaultAdVariation[],
  serviceTerms?: string[]
): SociaVaultAdVariation | null {
  if (serviceTerms?.length) {
    // Strict: never fall back to an unmatched variation when filtering by service
    return (
      variations.find((v) =>
        creativeMatchesTargetService(
          {
            headline: v.headline,
            description: v.description,
            // Intentionally omit destinationUrl — path segments must not override headlines
          },
          serviceTerms
        )
      ) ?? null
    );
  }
  return (
    variations.find(
      (v) =>
        v.headline?.trim() &&
        v.description?.trim() &&
        !isGarbageCreativeText(`${v.headline} ${v.description}`)
    ) ??
    variations.find((v) => v.headline?.trim() || v.description?.trim()) ??
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
  if (!isSociaVaultConfigured()) return empty;

  const domain = domainFromWebsiteUrl(options.url);
  const region = options.country || undefined;
  let ads: SociaVaultCompanyAd[] = [];

  // 0) Direct advertiser id — required when Transparency company-ads omit domain
  if (options.advertiserId) {
    if (region) {
      ads = await fetchSociaVaultCompanyAds({
        advertiserId: options.advertiserId,
        region,
        maxPages: 2,
      });
    }
    if (!ads.length) {
      ads = await fetchSociaVaultCompanyAds({
        advertiserId: options.advertiserId,
        maxPages: 2,
      });
    }
  }

  // 1) domain + region (skip placeholder transparency hosts)
  if (!ads.length && isUsableAdvertiserHost(domain) && region) {
    ads = await fetchSociaVaultCompanyAds({ domain, region, maxPages: 3 });
  }
  // 2) domain anywhere
  if (!ads.length && isUsableAdvertiserHost(domain)) {
    ads = await fetchSociaVaultCompanyAds({ domain, maxPages: 3 });
  }
  // 3) advertiser search by name / domain brand — require a name/brand match (no advertisers[0])
  if (!ads.length) {
    const brand = (domain.split('.')[0] ?? '').toLowerCase();
    const queries = [options.name, brand].filter((q) => q && q.trim().length > 2);
    for (const q of queries) {
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

export async function discoverSociaVaultCompetitors(options: {
  siteUrl: string;
  searchQueries: string[];
  region?: string;
  maxCount?: number;
  /** Stop after this many consecutive queries that add zero new domains (default: no early stop). */
  maxEmptyQueries?: number;
}): Promise<
  Array<{
    name: string;
    url: string;
    score: number;
    activity: SociaVaultAdActivityMetrics;
    advertiserId?: string;
  }>
> {
  if (!isSociaVaultConfigured()) return [];

  const max = options.maxCount ?? 6;
  const ownDomain = siteDomain(options.siteUrl);
  const results = new Map<
    string,
    {
      name: string;
      url: string;
      score: number;
      activity: SociaVaultAdActivityMetrics;
      advertiserId?: string;
    }
  >();
  let emptyStreak = 0;
  const emptyCap = options.maxEmptyQueries ?? 0;

  for (let qi = 0; qi < options.searchQueries.length; qi++) {
    const query = options.searchQueries[qi]?.trim();
    if (!query) continue;

    const before = results.size;
    const advertisers = await searchSociaVaultAdvertisers(query);
    console.log(`[SociaVault] search "${query}" → ${advertisers.length} advertiser(s)`);

    // Prefer advertisers with the highest estimated ad volume from search
    const rankedAdvertisers = [...advertisers].sort((a, b) => {
      const ae = (a as { number_of_ads_estimate?: number }).number_of_ads_estimate ?? 0;
      const be = (b as { number_of_ads_estimate?: number }).number_of_ads_estimate ?? 0;
      return be - ae;
    });

    for (const advertiser of rankedAdvertisers.slice(0, 6)) {
      let ads = await fetchSociaVaultCompanyAds({
        advertiserId: advertiser.advertiser_id,
        region: options.region ?? advertiser.region,
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
      // Avoid expensive ad-details probes for every search hit — keep advertiserId instead.
      // Domain recovery still happens later when loading gallery creatives if needed.

      const activity = computeSociaVaultAdActivity(ads);
      if (activity.totalAdCount === 0) continue;

      const queryBoost = Math.max(1, options.searchQueries.length - qi);
      const activityScore = scoreSociaVaultAdActivity(activity);
      const estimateBoost = Math.min(
        12,
        Math.round(((advertiser as { number_of_ads_estimate?: number }).number_of_ads_estimate ?? 0) / 100)
      );
      const score = queryBoost * 4 + activityScore + estimateBoost;
      const name = advertiser.name.trim() || resolvedDomain.split('.')[0] || 'Competitor';

      // Prefer advertiser-id key so distinct AR accounts never collapse onto one domain
      if (resolvedDomain && isUsableAdvertiserHost(resolvedDomain)) {
        if (siteDomain(resolvedDomain) === ownDomain) continue;
        const url = `https://${resolvedDomain}`;
        const key = `adv:${advertiser.advertiser_id}`;
        const existing = results.get(key);
        if (!existing || score > existing.score) {
          results.set(key, {
            name,
            url,
            score: (existing?.score ?? 0) + score,
            activity,
            advertiserId: advertiser.advertiser_id,
          });
        }
      } else {
        console.warn(
          `[SociaVault] advertiser ${advertiser.name} (${advertiser.advertiser_id}) has ${ads.length} ads — keeping via advertiser id (no domain on creatives)`
        );
        const key = `adv:${advertiser.advertiser_id}`;
        const url = `https://adstransparency.google.com/advertiser/${advertiser.advertiser_id}`;
        const existing = results.get(key);
        if (!existing || score > existing.score) {
          results.set(key, {
            name,
            url,
            score: (existing?.score ?? 0) + score,
            activity,
            advertiserId: advertiser.advertiser_id,
          });
        }
      }
    }
    if (results.size >= max + 2) break;

    if (results.size === before) {
      emptyStreak += 1;
      if (emptyCap > 0 && emptyStreak >= emptyCap && results.size === 0) {
        console.warn(
          `[SociaVault] early-stop discovery after ${emptyStreak} empty quer(y/ies) (no rivals yet)`
        );
        break;
      }
    } else {
      emptyStreak = 0;
    }
  }

  console.log(
    `[SociaVault] discovery found ${results.size} competitor(s) from ${options.searchQueries.length} quer(y/ies)`
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

/**
 * Fetch competitor ad copy + library activity via SociaVault.
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
  if (!isSociaVaultConfigured()) return null;

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
    let matched = false;

    try {
      const details = await fetchSociaVaultAdDetails(companyAd.adUrl);
      if (details) {
        const variation = pickBestVariation(
          details.variations,
          requireService ? serviceTerms : undefined
        );
        if (!variation && requireService) {
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

        if (requireService) {
          matched = creativeMatchesTargetService(
            { headline, description },
            serviceTerms
          );
        } else {
          matched = true;
        }
      }
    } catch (err) {
      console.warn(`[SociaVault] ad-details failed for ${companyAd.adUrl}:`, err instanceof Error ? err.message : err);
      if (requireService) continue;
    }

    if (requireService && !matched) continue;
    if (requireService && isGarbageCreativeText(`${headline} ${description}`)) continue;
    // Hard safety: never return a conflicting vertical creative when service-scoped
    if (
      requireService &&
      !creativeMatchesTargetService({ headline, description }, serviceTerms)
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
      console.log(
        `[SociaVault] name-matched service fallback for ${options.name} (no OCR "${serviceTerms[0]}" creative)`
      );
      return {
        advertiserName: companyAd.advertiserName || options.name,
        headline: options.name.slice(0, 30),
        description: `${options.name} — live Google Ads Transparency creatives for ${serviceTerms[0]}.`,
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
        allHeadlines: [options.name.slice(0, 30)],
        allDescriptions: [
          `${options.name} — live Google Ads Transparency creatives for ${serviceTerms[0]}.`,
        ],
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
