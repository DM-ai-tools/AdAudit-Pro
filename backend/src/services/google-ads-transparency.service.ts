import axios from 'axios';
import { decodeHtmlEntities, decodeHtmlEntitiesList } from '../utils/html-entities.js';
import { transparencyRegionCode } from '../utils/region-codes.js';

const TRANSPARENCY_BASE = 'https://adstransparency.google.com/anji/_/rpc';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

export interface TransparencyAdvertiser {
  advertiserId: string;
  name: string;
  country?: string;
  adCount?: number;
  transparencyUrl: string;
}

export interface TransparencySearchAd {
  creativeId: string;
  headlines: string[];
  descriptions: string[];
  finalUrl?: string;
  displayUrl?: string;
  format: 'text' | 'image' | 'video' | 'unknown';
  previewImageUrl?: string;
  lastShown?: string;
  creativeUrl?: string;
}

export interface TransparencyAdBundle {
  advertiser: TransparencyAdvertiser;
  ads: TransparencySearchAd[];
  source: 'transparency_center';
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function domainFromUrl(url: string): string {
  try {
    return new URL(url.startsWith('http') ? url : `https://${url}`).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

function unescapeJsString(s: string): string {
  return s
    .replace(/\\x([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\u([0-9A-Fa-f]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\'/g, "'")
    .replace(/\\"/g, '"')
    .replace(/\\n/g, '\n')
    .replace(/\\\\/g, '\\');
}

async function transparencyRpc<T = unknown>(
  service: string,
  method: string,
  payload: Record<string, unknown>
): Promise<T> {
  const body = `f.req=${encodeURIComponent(JSON.stringify(payload))}`;
  const url = `${TRANSPARENCY_BASE}/${service}/${method}?authuser=0`;

  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await axios.post(url, body, {
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'User-Agent': USER_AGENT,
        },
        timeout: 22_000,
      });
      return res.data as T;
    } catch (err) {
      const status = axios.isAxiosError(err) ? err.response?.status : undefined;
      if (status === 429 && attempt < 3) {
        await sleep(2000 * (attempt + 1));
        continue;
      }
      throw err;
    }
  }
  throw new Error('Transparency RPC failed after retries');
}

interface SuggestionAdvertiser {
  name: string;
  advertiserId: string;
  country?: string;
  adCount?: number;
}

async function searchAdvertiserSuggestions(query: string): Promise<SuggestionAdvertiser[]> {
  const data = await transparencyRpc<Record<string, unknown>>('SearchService', 'SearchSuggestions', {
    1: query,
    2: 30,
    3: 30,
  });

  const rows = (data['1'] as unknown[]) ?? [];
  const out: SuggestionAdvertiser[] = [];

  for (const row of rows) {
    const entry = row as Record<string, unknown>;
    const adv = entry['1'] as Record<string, unknown> | undefined;
    if (!adv?.['2']) continue;
    const counts = adv['4'] as Record<string, unknown> | undefined;
    const countBlock = counts?.['2'] as Record<string, unknown> | undefined;
    out.push({
      name: String(adv['1'] ?? ''),
      advertiserId: String(adv['2']),
      country: adv['3'] ? String(adv['3']) : undefined,
      adCount: countBlock?.['2'] ? parseInt(String(countBlock['2']), 10) : undefined,
    });
  }
  return out;
}

function rankAdvertiser(
  candidates: SuggestionAdvertiser[],
  opts: { domain?: string; name?: string; country?: string }
): SuggestionAdvertiser | null {
  if (!candidates.length) return null;
  const domain = opts.domain?.toLowerCase() ?? '';
  const brand = (opts.name ?? '').toLowerCase();
  const brandToken = domain.split('.')[0] || brand.split(/\s+/)[0] || '';

  const scored = candidates.map((c) => {
    const n = c.name.toLowerCase();
    let score = 0;
    if (opts.country && c.country === opts.country) score += 60;
    if (domain && n.includes(brandToken) && brandToken.length > 2) score += 35;
    if (brand && (n.includes(brand) || brand.includes(n.split(' ')[0] ?? ''))) score += 25;
    if (domain.endsWith('.com.au') && (n.includes('pty') || c.country === 'AU')) score += 20;
    if (domain.endsWith('.co.uk') && c.country === 'GB') score += 20;
    score += Math.min((c.adCount ?? 0) / 200, 15);
    return { c, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.score > 20 ? scored[0].c : scored[0]?.c ?? null;
}

export async function resolveTransparencyAdvertiser(options: {
  name: string;
  url: string;
  country?: string;
}): Promise<TransparencyAdvertiser | null> {
  const domain = domainFromUrl(options.url);
  const queries = [...new Set([domain, options.name, domain.split('.')[0], `${options.name} ${options.country ?? ''}`.trim()])].filter(
    (q) => q.length > 2
  );

  let best: SuggestionAdvertiser | null = null;
  for (const q of queries) {
    const candidates = await searchAdvertiserSuggestions(q);
    const picked = rankAdvertiser(candidates, {
      domain,
      name: options.name,
      country: options.country,
    });
    if (picked && (!best || (picked.adCount ?? 0) > (best.adCount ?? 0))) {
      best = picked;
    }
    if (best && best.country === options.country) break;
    await sleep(400);
  }

  if (!best) return null;

  return {
    advertiserId: best.advertiserId,
    name: best.name,
    country: best.country,
    adCount: best.adCount,
    transparencyUrl: `https://adstransparency.google.com/advertiser/${best.advertiserId}?region=${options.country ?? 'anywhere'}`,
  };
}

function creativeTransparencyUrl(advertiserId: string, creativeId: string, country?: string): string {
  const region = country ?? 'anywhere';
  return `https://adstransparency.google.com/advertiser/${advertiserId}/creative/${creativeId}?region=${region}`;
}

function timestampToDate(ts?: { 1?: string; 2?: number }): string | undefined {
  if (!ts?.['1']) return undefined;
  const sec = parseInt(String(ts['1']), 10);
  if (!Number.isFinite(sec)) return undefined;
  return new Date(sec * 1000).toISOString().slice(0, 10);
}

function extractUrlsFromHtml(html: string): string[] {
  const urls = [...html.matchAll(/https?:\/\/[^\s"'<>]+/gi)].map((m) => m[0]);
  return [...new Set(urls)];
}

function extractTextFieldsFromHtml(html: string): { headlines: string[]; descriptions: string[]; urls: string[] } {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, '\n')
    .replace(/\s+/g, ' ')
    .trim();

  const lines = text
    .split(/\n|(?:\s{2,})/)
    .map((l) => decodeHtmlEntities(l.trim()))
    .filter((l) => l.length > 4 && l.length < 120);

  const headlines = lines.filter((l) => l.length <= 30).slice(0, 8);
  const descriptions = lines.filter((l) => l.length > 30 && l.length <= 120).slice(0, 4);
  const urls = extractUrlsFromHtml(html).map((u) => {
    try {
      return new URL(u).hostname.replace(/^www\./, '');
    } catch {
      return u;
    }
  });

  return { headlines, descriptions, urls };
}

async function decodePreviewContentJs(previewUrl: string): Promise<{
  headlines: string[];
  descriptions: string[];
  finalUrl?: string;
  format: TransparencySearchAd['format'];
  previewImageUrl?: string;
}> {
  const res = await axios.get(previewUrl, {
    timeout: 18_000,
    headers: { 'User-Agent': USER_AGENT },
  });
  const text = String(res.data);

  const htmlMatch = text.match(
    /previewservice\.insertPreviewHtmlContent\('fletch[^']+', 'fletch[^']+', '(.+?)'\)/
  );
  if (htmlMatch) {
    const html = unescapeJsString(htmlMatch[1]);
    const parsed = extractTextFieldsFromHtml(html);
    return {
      headlines: parsed.headlines,
      descriptions: parsed.descriptions,
      finalUrl: parsed.urls[0],
      format: 'text',
    };
  }

  const imgMatch = text.match(
    /insertPreviewImageContent\('fletch[^']+', 'fletch[^']+', '(https?:\/\/[^']+)'/
  );
  if (imgMatch) {
    const imgUrl = imgMatch[1];
    if (imgUrl.includes('ytimg.com')) {
      return { headlines: [], descriptions: [], format: 'video', previewImageUrl: imgUrl };
    }
    return { headlines: [], descriptions: [], format: 'image', previewImageUrl: imgUrl };
  }

  const searchUrlMatch = text.match(/(https:\/\/ads-rendering[^'"\s]+)/);
  if (searchUrlMatch) {
    try {
      const searchRes = await axios.get(searchUrlMatch[1], {
        timeout: 15_000,
        headers: { 'User-Agent': USER_AGENT },
      });
      const parsed = extractTextFieldsFromHtml(String(searchRes.data));
      if (parsed.headlines.length || parsed.descriptions.length) {
        return {
          headlines: parsed.headlines,
          descriptions: parsed.descriptions,
          finalUrl: parsed.urls[0],
          format: 'text',
        };
      }
    } catch {
      /* fall through */
    }
  }

  return { headlines: [], descriptions: [], format: 'unknown' };
}

async function fetchCreativeDetail(
  advertiserId: string,
  creativeId: string
): Promise<{ headlines: string[]; descriptions: string[]; finalUrl?: string } | null> {
  const payloads: Record<string, unknown>[] = [
    { 1: creativeId },
    { 1: { 1: creativeId, 2: advertiserId } },
    { 2: creativeId },
  ];

  for (const payload of payloads) {
    try {
      const data = await transparencyRpc<Record<string, unknown>>('LookupService', 'GetCreativeById', payload);
      const raw = JSON.stringify(data);
      const headlineMatches = [...raw.matchAll(/"([A-Za-z0-9][^"]{4,29})"/g)]
        .map((m) => decodeHtmlEntities(m[1]))
        .filter((s) => !s.includes('http') && !s.startsWith('AR') && !s.startsWith('CR'));
      const descMatches = [...raw.matchAll(/"([A-Za-z0-9][^"]{30,89})"/g)]
        .map((m) => decodeHtmlEntities(m[1]))
        .filter((s) => !s.includes('function'));

      if (headlineMatches.length || descMatches.length) {
        const urlMatch = raw.match(/https?:\\\/\\\/[^"\\]+/);
        return {
          headlines: [...new Set(headlineMatches)].slice(0, 8),
          descriptions: [...new Set(descMatches)].slice(0, 4),
          finalUrl: urlMatch ? urlMatch[0].replace(/\\\//g, '/') : undefined,
        };
      }
    } catch {
      /* try next payload */
    }
    await sleep(300);
  }
  return null;
}

async function fetchCreativesForAdvertiser(
  advertiserId: string,
  regionCode?: number,
  maxPages = 6
): Promise<unknown[]> {
  const all: unknown[] = [];
  let cursor: unknown;

  for (let page = 0; page < maxPages; page++) {
    const req: Record<string, unknown> = {
      2: 40,
      3: { 13: { 1: [advertiserId] }, 7: { 1: 1 } },
      7: { 1: 1 },
    };
    if (regionCode) {
      (req['3'] as Record<string, unknown>)['8'] = [regionCode];
    }
    if (cursor) req['4'] = cursor;

    const data = await transparencyRpc<Record<string, unknown>>('SearchService', 'SearchCreatives', req);
    const list = (data['1'] as unknown[]) ?? [];
    all.push(...list);
    cursor = data['2'];
    if (!cursor || !list.length) break;
    await sleep(450);
  }
  return all;
}

export async function fetchTransparencyAdsForCompetitor(options: {
  name: string;
  url: string;
  country?: string;
  maxAds?: number;
}): Promise<TransparencyAdBundle | null> {
  const regionCode = transparencyRegionCode(options.country);

  const advertiser = await resolveTransparencyAdvertiser({
    name: options.name,
    url: options.url,
    country: options.country,
  });
  if (!advertiser) return null;

  const creatives = await fetchCreativesForAdvertiser(advertiser.advertiserId, regionCode);
  const formatPriority = (fmt: number) => (fmt === 3 ? 0 : fmt === 2 ? 1 : 1);

  const sorted = [...creatives].sort((a, b) => {
    const fa = (a as Record<string, unknown>)['4'] as number;
    const fb = (b as Record<string, unknown>)['4'] as number;
    return formatPriority(fa) - formatPriority(fb);
  });

  const ads: TransparencySearchAd[] = [];
  const maxAds = options.maxAds ?? 12;

  for (const row of sorted) {
    if (ads.length >= maxAds) break;
    const c = row as Record<string, unknown>;
    const creativeId = String(c['2'] ?? '');
    if (!creativeId.startsWith('CR')) continue;

    const previewJs =
      (c['3'] as Record<string, unknown> | undefined)?.['1'] &&
      ((c['3'] as Record<string, unknown>)['1'] as Record<string, unknown>)['4'];
    const previewImg =
      (c['3'] as Record<string, unknown> | undefined)?.['3'] &&
      ((c['3'] as Record<string, unknown>)['3'] as Record<string, unknown>)['2'];

    let headlines: string[] = [];
    let descriptions: string[] = [];
    let finalUrl: string | undefined;
    let format: TransparencySearchAd['format'] = 'unknown';
    let previewImageUrl: string | undefined;

    if (typeof previewJs === 'string' && previewJs.includes('content.js')) {
      try {
        const decoded = await decodePreviewContentJs(previewJs);
        headlines = decoded.headlines;
        descriptions = decoded.descriptions;
        finalUrl = decoded.finalUrl;
        format = decoded.format;
        previewImageUrl = decoded.previewImageUrl;
      } catch {
        /* continue */
      }
    }

    if (!headlines.length && !descriptions.length) {
      const detail = await fetchCreativeDetail(advertiser.advertiserId, creativeId);
      if (detail) {
        headlines = detail.headlines;
        descriptions = detail.descriptions;
        finalUrl = detail.finalUrl;
        format = 'text';
      }
    }

    if (!headlines.length && typeof previewImg === 'string' && previewImg.includes('simgad')) {
      const imgMatch = previewImg.match(/src=\\"([^"\\]+)\\"/) ?? previewImg.match(/src="([^"]+)"/);
      previewImageUrl = imgMatch?.[1] ?? undefined;
      format = 'image';
    }

    if (!headlines.length && !descriptions.length && !previewImageUrl) continue;

    ads.push({
      creativeId,
      headlines: decodeHtmlEntitiesList(headlines),
      descriptions: decodeHtmlEntitiesList(descriptions),
      finalUrl: finalUrl ?? domainFromUrl(options.url),
      displayUrl: finalUrl ?? domainFromUrl(options.url),
      format,
      previewImageUrl,
      lastShown: timestampToDate(c['7'] as { 1?: string; 2?: number }),
      creativeUrl: creativeTransparencyUrl(advertiser.advertiserId, creativeId, options.country),
    });

    await sleep(250);
  }

  if (!ads.length) return null;

  return { advertiser, ads, source: 'transparency_center' };
}

/** Pick one exact live ad — prefer decoded search text ads, most recently shown. */
export function pickExactTransparencyAd(ads: TransparencySearchAd[]): TransparencySearchAd | null {
  if (!ads.length) return null;

  const scored = ads.map((ad) => {
    let score = 0;
    if (ad.format === 'text') score += 100;
    if (ad.headlines.length && ad.descriptions.length) score += 80;
    if (ad.headlines.length) score += 20;
    if (ad.previewImageUrl && ad.format === 'image') score += 30;
    if (ad.lastShown) score += 5;
    return { ad, score };
  });

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return (b.ad.lastShown ?? '').localeCompare(a.ad.lastShown ?? '');
  });

  return scored[0]?.ad ?? null;
}

export async function fetchExactTransparencyAdForCompetitor(options: {
  name: string;
  url: string;
  country?: string;
}): Promise<{ advertiser: TransparencyAdvertiser; exactAd: TransparencySearchAd; allAds: TransparencySearchAd[] } | null> {
  const bundle = await fetchTransparencyAdsForCompetitor({ ...options, maxAds: 20 });
  if (!bundle?.ads.length) return null;
  const exactAd = pickExactTransparencyAd(bundle.ads);
  if (!exactAd) return null;
  return { advertiser: bundle.advertiser, exactAd, allAds: bundle.ads };
}

/** Merge transparency ads for AI gap analysis only (not gallery display). */
export function mergeTransparencyAdsToRsa(ads: TransparencySearchAd[]): {
  headlines: string[];
  descriptions: string[];
  ctas: string[];
} {
  const headlines: string[] = [];
  const descriptions: string[] = [];
  const ctas: string[] = [];

  for (const ad of ads) {
    for (const h of ad.headlines) {
      const trimmed = h.slice(0, 30);
      if (trimmed && !headlines.includes(trimmed)) headlines.push(trimmed);
    }
    for (const d of ad.descriptions) {
      const trimmed = d.slice(0, 90);
      if (trimmed && !descriptions.includes(trimmed)) descriptions.push(trimmed);
    }
  }

  const ctaPatterns = /\b(get|book|call|shop|compare|save|free|start)\b[^.!?]{0,20}/gi;
  for (const ad of ads) {
    for (const d of ad.descriptions) {
      const matches = d.match(ctaPatterns) ?? [];
      for (const m of matches) {
        const c = m.trim().slice(0, 25);
        if (c && !ctas.includes(c)) ctas.push(c);
      }
    }
  }

  return {
    headlines: headlines.slice(0, 15),
    descriptions: descriptions.slice(0, 4),
    ctas: ctas.slice(0, 6),
  };
}
