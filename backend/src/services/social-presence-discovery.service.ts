/**
 * Discover competitor social profile URLs from website HTML, secondary pages,
 * brand-slug guesses, and SociaVault Google search — then fetch follower metrics.
 */
import axios from 'axios';
import { env } from '../config/env.js';
import { isSociaVaultConfigured } from './sociavault-google-ad-library.service.js';
import {
  extractSocialLinksFromHtml,
  type WebsiteIntelligence,
} from './website-intelligence.service.js';
import {
  fetchSocialPresenceFromProfileUrls,
  type DiscoveredSocialLinks,
  type SociaVaultSocialPresenceResult,
} from './sociavault-social-presence.service.js';

const BASE = 'https://api.sociavault.com/v1/scrape';

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

function domainSlug(url: string): string {
  try {
    const host = new URL(url.startsWith('http') ? url : `https://${url}`).hostname
      .replace(/^www\./, '')
      .toLowerCase();
    return host.split('.')[0] ?? host;
  } catch {
    return url.replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 32);
  }
}

function brandSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(pty|ltd|limited|inc|llc|group|private|finance|financial|company|co)\b/g, '')
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 40);
}

function mergeLinks(...sets: DiscoveredSocialLinks[]): DiscoveredSocialLinks {
  const out: DiscoveredSocialLinks = {};
  for (const s of sets) {
    if (s.linkedin && !out.linkedin) out.linkedin = s.linkedin;
    if (s.facebook && !out.facebook) out.facebook = s.facebook;
    if (s.instagram && !out.instagram) out.instagram = s.instagram;
    if (s.youtube && !out.youtube) out.youtube = s.youtube;
    if (s.tiktok && !out.tiktok) out.tiktok = s.tiktok;
    if (s.twitter && !out.twitter) out.twitter = s.twitter;
  }
  return out;
}

function linkCount(links: DiscoveredSocialLinks): number {
  return Object.values(links).filter(Boolean).length;
}

function guessSocialLinksFromBrand(name: string, websiteUrl: string): DiscoveredSocialLinks {
  const slug = brandSlug(name) || domainSlug(websiteUrl);
  const domain = domainSlug(websiteUrl);
  // Prefer domain slug (matches most LinkedIn/Facebook vanity URLs)
  const candidates = [...new Set([domain, slug].filter((s) => s.length >= 3))];
  const links: DiscoveredSocialLinks = {};
  const primary = candidates[0]!;
  links.linkedin = `https://www.linkedin.com/company/${primary}`;
  // Try alternate company slug if brand differs from domain
  if (candidates[1] && candidates[1] !== primary) {
    // keep primary; fetch layer validates — alternate tried via Google search first
  }
  links.facebook = `https://www.facebook.com/${primary}`;
  links.instagram = `https://www.instagram.com/${primary}`;
  links.twitter = `https://x.com/${primary}`;
  return links;
}

async function fetchHtml(url: string, timeoutMs = 10_000): Promise<string | null> {
  try {
    const res = await axios.get<string>(url, {
      timeout: timeoutMs,
      maxRedirects: 4,
      responseType: 'text',
      headers: {
        'User-Agent': BROWSER_UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-AU,en;q=0.9',
      },
      validateStatus: (s) => s < 400,
    });
    return typeof res.data === 'string' ? res.data : null;
  } catch {
    return null;
  }
}

/** Crawl homepage + common secondary pages for social hrefs / embedded URLs. */
export async function discoverSocialLinksFromWebsite(
  websiteUrl: string,
  existing?: DiscoveredSocialLinks
): Promise<DiscoveredSocialLinks> {
  const base = websiteUrl.startsWith('http') ? websiteUrl : `https://${websiteUrl}`;
  let origin = base;
  try {
    origin = new URL(base).origin;
  } catch {
    /* keep base */
  }

  const paths = ['', '/contact', '/contact-us', '/about', '/about-us', '/company'];
  let merged: DiscoveredSocialLinks = { ...(existing ?? {}) };

  await Promise.all(
    paths.map(async (path) => {
      if (linkCount(merged) >= 4) return;
      const html = await fetchHtml(`${origin}${path}`);
      if (!html) return;
      merged = mergeLinks(merged, extractSocialLinksFromHtml(html, `${origin}${path || '/'}`));
    })
  );

  return merged;
}

function asRecord(val: unknown): Record<string, unknown> | null {
  if (!val || typeof val !== 'object' || Array.isArray(val)) return null;
  return val as Record<string, unknown>;
}

/** Use SociaVault Google Search to find LinkedIn/Facebook/Instagram/etc profile URLs. */
export async function discoverSocialLinksViaGoogleSearch(options: {
  brandName: string;
  websiteUrl: string;
  region?: string;
}): Promise<DiscoveredSocialLinks> {
  if (!isSociaVaultConfigured() || !env.sociavaultApiKey) return {};

  const domain = domainSlug(options.websiteUrl);
  const query = `${options.brandName} ${domain} linkedin facebook instagram`;
  try {
    const res = await axios.get(`${BASE}/google/search`, {
      params: { query, region: options.region ?? 'AU' },
      headers: { 'X-API-Key': env.sociavaultApiKey },
      timeout: 20_000,
      validateStatus: (s) => s < 500,
    });
    if (res.status >= 400) return {};

    const data = asRecord(res.data) ?? {};
    const inner = asRecord(data.data) ?? data;
    const resultsRaw = inner.results;
    const results: unknown[] = Array.isArray(resultsRaw)
      ? resultsRaw
      : resultsRaw && typeof resultsRaw === 'object'
        ? Object.values(resultsRaw as Record<string, unknown>)
        : [];

    const urls: string[] = [];
    for (const row of results) {
      const o = asRecord(row);
      const u = typeof o?.url === 'string' ? o.url : typeof o?.link === 'string' ? o.link : '';
      if (u) urls.push(u);
    }

    // Feed URLs through the same extractor
    const fakeHtml = urls.map((u) => `<a href="${u}">`).join('\n');
    return extractSocialLinksFromHtml(fakeHtml, options.websiteUrl);
  } catch (err) {
    console.warn(
      '[social-discovery] Google search failed:',
      err instanceof Error ? err.message : err
    );
    return {};
  }
}

/**
 * Full pipeline: website crawl → Google search → brand guesses → SociaVault profile scrapes.
 */
export async function resolveCompetitorSocialPresence(options: {
  name: string;
  websiteUrl: string;
  existingLinks?: DiscoveredSocialLinks;
  websiteIntel?: WebsiteIntelligence | null;
  lightweight?: boolean;
  region?: string;
}): Promise<{
  links: DiscoveredSocialLinks;
  metrics: SociaVaultSocialPresenceResult | null;
}> {
  let links = mergeLinks(
    options.existingLinks ?? {},
    options.websiteIntel?.socialLinks ?? {}
  );

  // 1) Deep website crawl if thin
  if (linkCount(links) < 2) {
    const crawled = await discoverSocialLinksFromWebsite(options.websiteUrl, links);
    links = mergeLinks(links, crawled);
  }

  // 2) SociaVault Google search for missing platforms
  if (linkCount(links) < 2 && isSociaVaultConfigured()) {
    const fromGoogle = await discoverSocialLinksViaGoogleSearch({
      brandName: options.name,
      websiteUrl: options.websiteUrl,
      region: options.region,
    });
    links = mergeLinks(links, fromGoogle);
  }

  // 3) Brand/domain slug guesses for remaining gaps (validated by profile fetch)
  const guesses = guessSocialLinksFromBrand(options.name, options.websiteUrl);
  links = {
    linkedin: links.linkedin ?? guesses.linkedin,
    facebook: links.facebook ?? guesses.facebook,
    instagram: links.instagram ?? guesses.instagram,
    youtube: links.youtube,
    tiktok: links.tiktok,
    twitter: links.twitter ?? guesses.twitter,
  };

  if (!linkCount(links)) {
    return { links: {}, metrics: null };
  }

  const metrics = await fetchSocialPresenceFromProfileUrls(links, {
    lightweight: options.lightweight,
  });

  // Keep only profile URLs that actually returned metrics (avoid showing bad guesses)
  const validated: DiscoveredSocialLinks = { ...(metrics?.profileUrls ?? {}) };
  if (metrics?.linkedInFollowers != null || metrics?.employeeCount != null) {
    validated.linkedin = links.linkedin;
  }
  if (metrics?.facebookFollowers != null) validated.facebook = links.facebook;
  if (metrics?.instagramFollowers != null) validated.instagram = links.instagram;
  if (metrics?.youtubeSubscribers != null) validated.youtube = links.youtube;
  if (metrics?.tiktokFollowers != null) validated.tiktok = links.tiktok;
  if (metrics?.twitterFollowers != null) validated.twitter = links.twitter;

  // Prefer discovered non-guess URLs even if fetch failed (show URL, dash for count)
  const discoveredOnly = mergeLinks(
    options.existingLinks ?? {},
    options.websiteIntel?.socialLinks ?? {}
  );
  const finalLinks = mergeLinks(validated, discoveredOnly, {
    linkedin: metrics?.linkedInFollowers != null ? links.linkedin : discoveredOnly.linkedin,
    facebook: metrics?.facebookFollowers != null ? links.facebook : discoveredOnly.facebook,
    instagram: metrics?.instagramFollowers != null ? links.instagram : discoveredOnly.instagram,
    youtube: metrics?.youtubeSubscribers != null ? links.youtube : discoveredOnly.youtube,
    tiktok: metrics?.tiktokFollowers != null ? links.tiktok : discoveredOnly.tiktok,
    twitter: metrics?.twitterFollowers != null ? links.twitter : discoveredOnly.twitter,
  });

  // If we got metrics, also keep the URLs we successfully fetched
  if (metrics) {
    return {
      links: mergeLinks(finalLinks, {
        linkedin: metrics.linkedInFollowers != null || metrics.employeeCount != null ? links.linkedin : finalLinks.linkedin,
        facebook: metrics.facebookFollowers != null ? links.facebook : finalLinks.facebook,
        instagram: metrics.instagramFollowers != null ? links.instagram : finalLinks.instagram,
        youtube: metrics.youtubeSubscribers != null ? links.youtube : finalLinks.youtube,
        tiktok: metrics.tiktokFollowers != null ? links.tiktok : finalLinks.tiktok,
        twitter: metrics.twitterFollowers != null ? links.twitter : finalLinks.twitter,
      }),
      metrics: {
        ...metrics,
        profileUrls: mergeLinks(metrics.profileUrls, finalLinks, {
          linkedin: metrics.linkedInFollowers != null || metrics.employeeCount != null ? links.linkedin : undefined,
          facebook: metrics.facebookFollowers != null ? links.facebook : undefined,
          instagram: metrics.instagramFollowers != null ? links.instagram : undefined,
          youtube: metrics.youtubeSubscribers != null ? links.youtube : undefined,
          tiktok: metrics.tiktokFollowers != null ? links.tiktok : undefined,
          twitter: metrics.twitterFollowers != null ? links.twitter : undefined,
        }),
      },
    };
  }

  return { links: finalLinks, metrics: null };
}
