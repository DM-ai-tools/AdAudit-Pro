import type { CompetitorAdPreview, CompetitorIntelligenceData } from '../types/optimization';

function hostFromUrl(url?: string): string {
  if (!url) return '';
  try {
    return new URL(url.startsWith('http') ? url : `https://${url}`).hostname.replace(/^www\./, '');
  } catch {
    return url.replace(/^https?:\/\//, '').split('/')[0] ?? url;
  }
}

function advertiserIdFrom(c: {
  advertiserId?: string;
  transparencyUrl?: string;
  url?: string;
  adLink?: string;
  creativeUrl?: string;
}): string {
  const direct = c.advertiserId?.trim();
  if (direct) return direct;
  const blob = `${c.transparencyUrl ?? ''} ${c.adLink ?? ''} ${c.creativeUrl ?? ''} ${c.url ?? ''}`;
  const m = blob.match(/advertiser\/(AR[\w-]+)/i);
  return m?.[1] ?? '';
}

function normalizeCompetitorName(name?: string): string {
  return (name ?? '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(pty|ltd|llc|inc|incorporated|co|company|the|group|limited)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function usableHost(url?: string): string {
  const host = hostFromUrl(url).toLowerCase();
  if (!host || /adstransparency\.google\.com$/i.test(host)) return '';
  return host;
}

/** One card per advertiser — never one card per creative. */
export function competitorIdentityKey(c: {
  name?: string;
  advertiserName?: string;
  url?: string;
  destinationUrl?: string;
  displayUrl?: string;
  advertiserId?: string;
  transparencyUrl?: string;
  adLink?: string;
  creativeUrl?: string;
}): string {
  const adv = advertiserIdFrom(c);
  if (adv) return `adv:${adv.toLowerCase()}`;
  const host =
    usableHost(c.destinationUrl) ||
    usableHost(c.url) ||
    usableHost(c.displayUrl) ||
    usableHost(c.transparencyUrl);
  if (host) return `host:${host}`;
  const name = normalizeCompetitorName(c.advertiserName ?? c.name);
  return `name:${name || 'unknown'}`;
}

function uniqueStrings(lists: Array<string[] | undefined>, max: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of lists) {
    for (const raw of list ?? []) {
      const text = raw.replace(/\s+/g, ' ').trim();
      if (!text) continue;
      const key = text.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(text);
      if (out.length >= max) return out;
    }
  }
  return out;
}

function sourceRank(source?: CompetitorAdPreview['adSource']): number {
  if (source === 'sociavault') return 3;
  if (source === 'transparency_center') return 2;
  if (source === 'website_fallback') return 0;
  return 1;
}

function preferStat(a?: number, b?: number): number | undefined {
  if (a != null && a > 0) return a;
  if (b != null && b > 0) return b;
  return a ?? b;
}

function mergeCompetitorPreviews(a: CompetitorAdPreview, b: CompetitorAdPreview): CompetitorAdPreview {
  const preferB = sourceRank(b.adSource) > sourceRank(a.adSource);
  const primary = preferB ? b : a;
  const secondary = preferB ? a : b;
  return {
    ...secondary,
    ...primary,
    name: primary.advertiserName || primary.name || secondary.advertiserName || secondary.name,
    advertiserName: primary.advertiserName || secondary.advertiserName || primary.name,
    advertiserId: primary.advertiserId || secondary.advertiserId,
    url: primary.destinationUrl || primary.url || secondary.destinationUrl || secondary.url,
    destinationUrl: primary.destinationUrl || secondary.destinationUrl,
    displayUrl: primary.displayUrl || secondary.displayUrl,
    headlines: uniqueStrings([primary.headlines, secondary.headlines], 15),
    descriptions: uniqueStrings([primary.descriptions, secondary.descriptions], 4),
    offers: uniqueStrings([primary.offers, secondary.offers], 8),
    ctas: uniqueStrings([primary.ctas, secondary.ctas], 6),
    trustSignals: uniqueStrings([primary.trustSignals, secondary.trustSignals], 8),
    totalAdCount: preferStat(primary.totalAdCount, secondary.totalAdCount),
    activeAdCount: preferStat(primary.activeAdCount, secondary.activeAdCount),
    adDurationDays: preferStat(primary.adDurationDays, secondary.adDurationDays),
    confidenceScore: preferStat(primary.confidenceScore, secondary.confidenceScore),
    influencePercent: preferStat(primary.influencePercent, secondary.influencePercent),
    previewImageUrl: primary.previewImageUrl || secondary.previewImageUrl,
    brandReview: primary.brandReview ?? secondary.brandReview,
    offer: primary.offer || secondary.offer,
    cta: primary.cta || secondary.cta,
    adSource: sourceRank(primary.adSource) >= sourceRank(secondary.adSource)
      ? primary.adSource
      : secondary.adSource,
  };
}

export function collapseCompetitorsToOne(items: CompetitorAdPreview[]): CompetitorAdPreview[] {
  const byKey = new Map<string, CompetitorAdPreview>();
  for (const item of items) {
    const key = competitorIdentityKey(item);
    const prev = byKey.get(key);
    byKey.set(key, prev ? mergeCompetitorPreviews(prev, item) : item);
  }
  return [...byKey.values()];
}

function hasDisplayableCreative(c: CompetitorAdPreview): boolean {
  return (
    (c.totalAdCount ?? 0) > 0 ||
    (c.headlines?.length ?? 0) > 0 ||
    (c.descriptions?.length ?? 0) > 0 ||
    Boolean(c.previewImageUrl) ||
    (c.adDurationDays ?? 0) > 0
  );
}

/**
 * Prefer SociaVault / Transparency gallery creatives, then pad with competitor
 * profiles so every discovered rival appears once in Make It Better.
 */
export function buildCompetitorGalleryItems(
  analysis: CompetitorIntelligenceData | null | undefined
): CompetitorAdPreview[] {
  if (!analysis) return [];

  const gallery = (analysis.adGallery ?? []).filter(hasDisplayableCreative);
  const merged: CompetitorAdPreview[] = [...gallery];
  const seen = new Set(gallery.map((g) => competitorIdentityKey(g)));

  for (const c of analysis.competitors ?? []) {
    const headlines = (c.headlines?.length ? c.headlines : c.keyMessages) ?? [];
    const descriptions = c.descriptions ?? [];
    if (
      !headlines.length &&
      !descriptions.length &&
      !(c.totalAdCount ?? 0) &&
      !(c.adDurationDays ?? 0)
    ) {
      continue;
    }
    const host = hostFromUrl(c.url);
    const preview: CompetitorAdPreview = {
      name: c.name,
      url: c.url,
      displayUrl: host || c.url,
      headlines,
      descriptions,
      offers: c.offers ?? [],
      ctas: [],
      trustSignals: c.trustSignals ?? [],
      advertiserName: c.name,
      advertiserId: c.advertiserId,
      adSource:
        (c.totalAdCount ?? 0) > 0 || (c.adDurationDays ?? 0) > 0
          ? 'sociavault'
          : 'website_fallback',
      totalAdCount: c.totalAdCount,
      activeAdCount: c.activeAdCount,
      adDurationDays: c.adDurationDays,
      brandReview: c.brandReview,
      confidenceScore: c.confidenceScore,
      influencePercent: c.influencePercent,
    };
    const key = competitorIdentityKey(preview);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(preview);
  }

  return merged.filter(hasDisplayableCreative);
}
