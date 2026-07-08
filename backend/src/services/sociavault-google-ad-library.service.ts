import axios from 'axios';
import { env } from '../config/env.js';
import { decodeHtmlEntities } from '../utils/html-entities.js';

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

export interface SociaVaultCompetitorAdResult {
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

export function isSociaVaultConfigured(): boolean {
  return Boolean(env.sociavaultApiKey);
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

async function sociavaultGet<T>(path: string, params: Record<string, string | undefined>): Promise<T | null> {
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
    const payload = res.data as { success?: boolean; data?: T };
    return payload?.data ?? (res.data as T);
  } catch (err) {
    const msg = axios.isAxiosError(err)
      ? `${err.response?.status ?? ''} ${JSON.stringify(err.response?.data ?? err.message)}`
      : String(err);
    console.warn(`[SociaVault] ${path} failed:`, msg.slice(0, 240));
    return null;
  }
}

export async function searchSociaVaultAdvertisers(query: string): Promise<
  Array<{ name: string; advertiser_id: string; region?: string }>
> {
  const data = await sociavaultGet<{ advertisers?: Record<string, { name?: string; advertiser_id?: string; region?: string }> }>(
    '/search-advertisers',
    { query }
  );
  return objectValues(data?.advertisers)
    .filter((a) => a.advertiser_id)
    .map((a) => ({
      name: String(a.name ?? ''),
      advertiser_id: String(a.advertiser_id),
      region: a.region ? String(a.region) : undefined,
    }));
}

export async function fetchSociaVaultCompanyAds(options: {
  domain?: string;
  advertiserId?: string;
  region?: string;
}): Promise<SociaVaultCompanyAd[]> {
  const data = await sociavaultGet<{ ads?: Record<string, SociaVaultCompanyAd> }>('/company-ads', {
    domain: options.domain,
    advertiser_id: options.advertiserId,
    region: options.region,
    topic: 'all',
  });

  return objectValues(data?.ads).filter((a) => a?.adUrl);
}

export async function fetchSociaVaultAdDetails(adUrl: string): Promise<SociaVaultAdDetails | null> {
  const data = await sociavaultGet<{
    advertiserId?: string;
    creativeId?: string;
    url?: string;
    format?: string;
    variations?: Record<string, SociaVaultAdVariation>;
  }>('/ad-details', { url: adUrl });

  if (!data?.url && !adUrl) return null;

  const variations = objectValues(data?.variations).map((v) => ({
    headline: v.headline ? decodeHtmlEntities(v.headline) : undefined,
    description: v.description ? decodeHtmlEntities(v.description) : undefined,
    destinationUrl: v.destinationUrl,
    visibleUrl: v.visibleUrl,
    image: v.image,
    youtubeUrl: v.youtubeUrl,
  }));

  return {
    advertiserId: String(data?.advertiserId ?? ''),
    creativeId: String(data?.creativeId ?? ''),
    url: String(data?.url ?? adUrl),
    format: String(data?.format ?? 'unknown'),
    variations,
  };
}

function pickBestCompanyAd(ads: SociaVaultCompanyAd[]): SociaVaultCompanyAd | null {
  if (!ads.length) return null;
  const scored = ads.map((ad) => {
    let score = 0;
    if (ad.format === 'text') score += 100;
    if (ad.format === 'image') score += 40;
    if (ad.lastShown) score += 10;
    return { ad, score };
  });
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return (b.ad.lastShown ?? '').localeCompare(a.ad.lastShown ?? '');
  });
  return scored[0]?.ad ?? null;
}

function pickBestVariation(variations: SociaVaultAdVariation[]): SociaVaultAdVariation | null {
  return (
    variations.find((v) => v.headline?.trim() && v.description?.trim()) ??
    variations.find((v) => v.headline?.trim() || v.description?.trim()) ??
    null
  );
}

/**
 * Fetch one exact competitor ad via SociaVault Google Ad Library.
 * Flow: company-ads (by domain) → ad-details (headline + description via OCR).
 * @see https://docs.sociavault.com/api-reference/google-ad-library/ad-details
 */
export async function fetchSociaVaultCompetitorAd(options: {
  name: string;
  url: string;
  country?: string;
}): Promise<SociaVaultCompetitorAdResult | null> {
  if (!isSociaVaultConfigured()) return null;

  const domain = domainFromWebsiteUrl(options.url);
  const region = options.country ?? undefined;

  let ads = await fetchSociaVaultCompanyAds({ domain, region });

  if (!ads.length) {
    const advertisers = await searchSociaVaultAdvertisers(options.name || domain);
    const match =
      advertisers.find((a) => a.region === region) ??
      advertisers.find((a) => a.name.toLowerCase().includes(domain.split('.')[0] ?? '')) ??
      advertisers[0];
    if (match) {
      ads = await fetchSociaVaultCompanyAds({ advertiserId: match.advertiser_id, region });
    }
  }

  const companyAd = pickBestCompanyAd(ads);
  if (!companyAd?.adUrl) return null;

  const details = await fetchSociaVaultAdDetails(companyAd.adUrl);
  if (!details) return null;

  const variation = pickBestVariation(details.variations);
  const headline = variation?.headline?.trim() ?? '';
  const description = variation?.description?.trim() ?? '';

  if (!headline && !description && !companyAd.imageUrl && !variation?.image) {
    return null;
  }

  const allHeadlines = [...new Set(details.variations.map((v) => v.headline?.trim()).filter(Boolean) as string[])];
  const allDescriptions = [...new Set(details.variations.map((v) => v.description?.trim()).filter(Boolean) as string[])];

  const advertiserUrl = companyAd.advertiserId
    ? `https://adstransparency.google.com/advertiser/${companyAd.advertiserId}?region=${region ?? 'anywhere'}`
    : details.url;

  return {
    advertiserName: companyAd.advertiserName || options.name,
    headline,
    description,
    destinationUrl: variation?.destinationUrl ?? options.url,
    visibleUrl: variation?.visibleUrl ?? domain,
    adUrl: details.url,
    advertiserUrl,
    previewImageUrl: variation?.image ?? companyAd.imageUrl ?? undefined,
    format: details.format,
    allHeadlines,
    allDescriptions,
  };
}
