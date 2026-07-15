import axios from 'axios';
import { env } from '../config/env.js';
import { isSociaVaultConfigured } from './sociavault-google-ad-library.service.js';

const BASE = 'https://api.sociavault.com/v1/scrape';

export type SocialPlatform =
  | 'linkedin'
  | 'facebook'
  | 'instagram'
  | 'youtube'
  | 'tiktok'
  | 'twitter';

export interface DiscoveredSocialLinks {
  linkedin?: string;
  facebook?: string;
  instagram?: string;
  youtube?: string;
  tiktok?: string;
  twitter?: string;
}

export interface SociaVaultSocialPresenceResult {
  linkedInFollowers?: number;
  facebookFollowers?: number;
  instagramFollowers?: number;
  youtubeSubscribers?: number;
  tiktokFollowers?: number;
  twitterFollowers?: number;
  employeeCount?: number;
  yearsFounded?: number;
  companySizeLabel?: string;
  profileUrls: DiscoveredSocialLinks;
  platformsFetched: SocialPlatform[];
  platformsFailed: SocialPlatform[];
  source: 'sociavault_social_profiles';
}

function asRecord(val: unknown): Record<string, unknown> | null {
  if (!val || typeof val !== 'object' || Array.isArray(val)) return null;
  return val as Record<string, unknown>;
}

function pickNumber(...vals: unknown[]): number | undefined {
  for (const v of vals) {
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return Math.round(v);
    if (typeof v === 'string' && v.trim()) {
      const cleaned = v.replace(/,/g, '').trim();
      const m = cleaned.match(/^([\d.]+)\s*([kmb])?$/i);
      if (m) {
        const n = parseFloat(m[1]!);
        if (!Number.isFinite(n)) continue;
        const suf = (m[2] ?? '').toLowerCase();
        const mult = suf === 'k' ? 1_000 : suf === 'm' ? 1_000_000 : suf === 'b' ? 1_000_000_000 : 1;
        return Math.round(n * mult);
      }
      const plain = Number(cleaned);
      if (Number.isFinite(plain) && plain >= 0) return Math.round(plain);
    }
  }
  return undefined;
}

/** Deep-search common follower/subscriber keys in nested SociaVault payloads. */
function findMetric(
  root: unknown,
  keys: string[],
  depth = 0
): number | undefined {
  if (depth > 8 || root == null) return undefined;
  const o = asRecord(root);
  if (!o) {
    if (Array.isArray(root)) {
      for (const item of root) {
        const n = findMetric(item, keys, depth + 1);
        if (n != null) return n;
      }
    }
    return undefined;
  }
  for (const key of keys) {
    if (key in o) {
      const n = pickNumber(o[key]);
      if (n != null) return n;
      const nested = asRecord(o[key]);
      if (nested && 'count' in nested) {
        const c = pickNumber(nested.count);
        if (c != null) return c;
      }
    }
  }
  for (const val of Object.values(o)) {
    if (val && typeof val === 'object') {
      const n = findMetric(val, keys, depth + 1);
      if (n != null) return n;
    }
  }
  return undefined;
}

function unwrapData(payload: unknown): Record<string, unknown> {
  const top = asRecord(payload) ?? {};
  const data = asRecord(top.data) ?? top;
  const nested = asRecord(data.data);
  return nested ?? data;
}

async function sociavaultGet(
  path: string,
  params: Record<string, string>
): Promise<unknown | null> {
  if (!isSociaVaultConfigured() || !env.sociavaultApiKey) return null;
  try {
    const res = await axios.get(`${BASE}${path}`, {
      params,
      headers: { 'X-API-Key': env.sociavaultApiKey },
      timeout: 25_000,
      validateStatus: (s) => s < 500,
    });
    if (res.status >= 400) {
      console.warn(`[sociavault-social] ${path} status=${res.status}`);
      return null;
    }
    return res.data;
  } catch (err) {
    console.warn(
      `[sociavault-social] ${path} failed:`,
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

export function extractHandleFromUrl(url: string, platform: SocialPlatform): string | undefined {
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`);
    const parts = u.pathname.split('/').filter(Boolean);
    if (platform === 'youtube') {
      const at = parts.find((p) => p.startsWith('@'));
      if (at) return at.replace(/^@/, '');
      const channelIdx = parts.findIndex((p) => p === 'channel' || p === 'c' || p === 'user');
      if (channelIdx >= 0 && parts[channelIdx + 1]) return parts[channelIdx + 1];
      if (parts[0]?.startsWith('@')) return parts[0].slice(1);
      return parts[0];
    }
    if (platform === 'linkedin') {
      const companyIdx = parts.findIndex((p) => p === 'company' || p === 'in' || p === 'school');
      if (companyIdx >= 0 && parts[companyIdx + 1]) return parts[companyIdx + 1];
      return parts[0];
    }
    if (platform === 'tiktok' || platform === 'instagram' || platform === 'twitter') {
      const handle = parts[0]?.replace(/^@/, '');
      if (!handle || ['p', 'reel', 'reels', 'status', 'share', 'watch'].includes(handle.toLowerCase())) {
        return undefined;
      }
      return handle;
    }
    if (platform === 'facebook') {
      if (parts[0] === 'profile.php') return undefined;
      return parts[0];
    }
    return parts[0];
  } catch {
    return undefined;
  }
}

export function isLinkedInCompanyUrl(url: string): boolean {
  return /linkedin\.com\/company\//i.test(url);
}

async function fetchLinkedIn(url: string): Promise<{
  followers?: number;
  employees?: number;
  founded?: number;
  sizeLabel?: string;
} | null> {
  const path = isLinkedInCompanyUrl(url) ? '/linkedin/company' : '/linkedin/profile';
  const raw = await sociavaultGet(path, { url });
  if (!raw) return null;
  const data = unwrapData(raw);
  return {
    followers: findMetric(data, ['followers', 'followerCount', 'follower_count', 'follower']),
    employees: findMetric(data, ['employeeCount', 'employee_count', 'staffCount', 'staff_count']),
    founded: findMetric(data, ['founded', 'foundedYear', 'founded_year']),
    sizeLabel: typeof data.size === 'string' ? data.size : undefined,
  };
}

async function fetchFacebook(url: string): Promise<{ followers?: number } | null> {
  const raw = await sociavaultGet('/facebook/profile', { url });
  if (!raw) return null;
  const data = unwrapData(raw);
  return {
    followers:
      findMetric(data, ['followerCount', 'follower_count', 'followers', 'likeCount', 'like_count']) ??
      undefined,
  };
}

async function fetchInstagram(url: string): Promise<{ followers?: number } | null> {
  const handle = extractHandleFromUrl(url, 'instagram');
  if (!handle) return null;
  const raw = await sociavaultGet('/instagram/profile', { handle });
  if (!raw) return null;
  const data = unwrapData(raw);
  return {
    followers: findMetric(data, [
      'edge_followed_by',
      'follower_count',
      'followerCount',
      'followers',
      'followersCount',
    ]),
  };
}

async function fetchYouTube(url: string): Promise<{ subscribers?: number } | null> {
  const raw = await sociavaultGet('/youtube/channel', { url });
  if (!raw) return null;
  const data = unwrapData(raw);
  return {
    subscribers: findMetric(data, [
      'subscriberCount',
      'subscriber_count',
      'subscribers',
      'subscriberCountText',
    ]),
  };
}

async function fetchTikTok(url: string): Promise<{ followers?: number } | null> {
  const handle = extractHandleFromUrl(url, 'tiktok');
  if (!handle) return null;
  const raw = await sociavaultGet('/tiktok/profile', { handle });
  if (!raw) return null;
  const data = unwrapData(raw);
  return {
    followers: findMetric(data, ['followerCount', 'follower_count', 'followers']),
  };
}

async function fetchTwitter(url: string): Promise<{ followers?: number } | null> {
  const handle = extractHandleFromUrl(url, 'twitter');
  if (!handle) return null;
  const raw = await sociavaultGet('/twitter/profile', { handle });
  if (!raw) return null;
  const data = unwrapData(raw);
  return {
    followers: findMetric(data, ['followers', 'follower_count', 'followerCount', 'followers_count']),
  };
}

/**
 * Given social profile URLs discovered on a competitor website, fetch follower
 * metrics via SociaVault platform scrapers (1 credit each).
 */
export async function fetchSocialPresenceFromProfileUrls(
  links: DiscoveredSocialLinks,
  options?: { lightweight?: boolean }
): Promise<SociaVaultSocialPresenceResult | null> {
  if (!isSociaVaultConfigured()) return null;

  const platformsFetched: SocialPlatform[] = [];
  const platformsFailed: SocialPlatform[] = [];
  const result: SociaVaultSocialPresenceResult = {
    profileUrls: { ...links },
    platformsFetched,
    platformsFailed,
    source: 'sociavault_social_profiles',
  };

  const tasks: Array<Promise<void>> = [];

  const run = async (platform: SocialPlatform, fn: () => Promise<boolean>) => {
    try {
      const ok = await fn();
      if (ok) platformsFetched.push(platform);
      else platformsFailed.push(platform);
    } catch {
      platformsFailed.push(platform);
    }
  };

  if (links.linkedin) {
    tasks.push(
      run('linkedin', async () => {
        const r = await fetchLinkedIn(links.linkedin!);
        if (!r) return false;
        result.linkedInFollowers = r.followers;
        result.employeeCount = r.employees;
        result.yearsFounded = r.founded;
        result.companySizeLabel = r.sizeLabel;
        return r.followers != null || r.employees != null;
      })
    );
  }
  if (links.facebook) {
    tasks.push(
      run('facebook', async () => {
        const r = await fetchFacebook(links.facebook!);
        if (!r?.followers) return false;
        result.facebookFollowers = r.followers;
        return true;
      })
    );
  }
  if (links.instagram) {
    tasks.push(
      run('instagram', async () => {
        const r = await fetchInstagram(links.instagram!);
        if (!r?.followers) return false;
        result.instagramFollowers = r.followers;
        return true;
      })
    );
  }
  if (links.youtube && !options?.lightweight) {
    tasks.push(
      run('youtube', async () => {
        const r = await fetchYouTube(links.youtube!);
        if (!r?.subscribers) return false;
        result.youtubeSubscribers = r.subscribers;
        return true;
      })
    );
  }
  if (links.tiktok && !options?.lightweight) {
    tasks.push(
      run('tiktok', async () => {
        const r = await fetchTikTok(links.tiktok!);
        if (!r?.followers) return false;
        result.tiktokFollowers = r.followers;
        return true;
      })
    );
  }
  if (links.twitter && !options?.lightweight) {
    tasks.push(
      run('twitter', async () => {
        const r = await fetchTwitter(links.twitter!);
        if (!r?.followers) return false;
        result.twitterFollowers = r.followers;
        return true;
      })
    );
  }

  if (!tasks.length) return null;
  await Promise.all(tasks);

  const hasAny =
    result.linkedInFollowers != null ||
    result.facebookFollowers != null ||
    result.instagramFollowers != null ||
    result.youtubeSubscribers != null ||
    result.tiktokFollowers != null ||
    result.twitterFollowers != null ||
    result.employeeCount != null;

  return hasAny || Object.keys(links).length ? result : null;
}
