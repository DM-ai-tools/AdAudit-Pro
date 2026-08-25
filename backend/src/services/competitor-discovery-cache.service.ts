import { createHash } from 'crypto';
import { prisma } from '../lib/prisma.js';
import type { CompetitorIntelligence } from './competitor-intelligence.service.js';

export type CompetitorDiscoverySource = 'document' | 'sociavault' | 'auto' | 'both';

export interface CompetitorCacheLookup {
  websiteUrl?: string;
  businessName?: string;
  primaryService?: string;
  productsServices?: string[];
  offer?: string;
  discoverySource?: CompetitorDiscoverySource;
  country?: string;
  preferredCampaignType?: string;
  userProvidedOnly?: boolean;
  competitorUrls?: string[];
  competitorNames?: string[];
  competitorEntries?: Array<{ name: string; url?: string }>;
  /** Ahrefs seed keywords — included in cache key so generic SEO results are not reused for AI SEO */
  searchKeywords?: string[];
  /** Create Campaign strict service + seed matching */
  strictServiceSeed?: boolean;
  skipCache?: boolean;
}

const MEMORY = new Map<string, { expires: number; payload: CompetitorIntelligence }>();
const MEMORY_TTL_MS = 15 * 60 * 1000;

function hostFrom(urlOrName?: string): string {
  if (!urlOrName?.trim()) return '';
  try {
    const u = urlOrName.startsWith('http') ? urlOrName : `https://${urlOrName}`;
    return new URL(u).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return urlOrName
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .split('/')[0]!
      .toLowerCase();
  }
}

function normalizeService(lookup: CompetitorCacheLookup): string {
  const svc =
    lookup.primaryService?.trim() ||
    lookup.productsServices?.find((s) => s.trim())?.trim() ||
    '';
  return svc.toLowerCase();
}

function documentFingerprint(lookup: CompetitorCacheLookup): string {
  const parts = [
    ...(lookup.competitorEntries ?? []).map((e) => `${e.name.trim().toLowerCase()}|${hostFrom(e.url)}`),
    ...(lookup.competitorUrls ?? []).map((u) => hostFrom(u)),
    ...(lookup.competitorNames ?? []).map((n) => n.trim().toLowerCase()),
  ]
    .filter(Boolean)
    .sort();
  if (!parts.length) return '';
  return createHash('sha256').update(parts.join(';')).digest('hex').slice(0, 16);
}

export function resolveDiscoverySource(lookup: CompetitorCacheLookup): CompetitorDiscoverySource {
  if (lookup.discoverySource) return lookup.discoverySource;
  if (lookup.userProvidedOnly) return 'document';
  const hasUpload =
    (lookup.competitorEntries?.length ?? 0) > 0 ||
    (lookup.competitorUrls?.length ?? 0) > 0 ||
    (lookup.competitorNames?.length ?? 0) > 0;
  return hasUpload ? 'both' : 'sociavault';
}

function dbTtlMs(source: CompetitorDiscoverySource): number {
  switch (source) {
    case 'document':
      return 7 * 24 * 60 * 60 * 1000;
    case 'both':
      return 48 * 60 * 60 * 1000;
    case 'sociavault':
    case 'auto':
    default:
      return 48 * 60 * 60 * 1000;
  }
}

function keywordsFingerprint(lookup: CompetitorCacheLookup): string {
  const parts = (lookup.searchKeywords ?? [])
    .map((k) => k.trim().toLowerCase())
    .filter((k) => k.length >= 3)
    .sort();
  if (!parts.length) return '';
  return createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 12);
}

export function buildCompetitorCacheKey(lookup: CompetitorCacheLookup): string | null {
  const companyHost = hostFrom(lookup.websiteUrl) || hostFrom(lookup.businessName);
  const service = normalizeService(lookup);
  if (!companyHost || !service) return null;

  const source = resolveDiscoverySource(lookup);
  const docFp =
    source === 'document' || source === 'both' ? documentFingerprint(lookup) : '';
  // Same uploaded document for this company + service reuses DB rivals (ignore keyword drift).
  // Auto-discovery reuses when company + service + keywords match.
  const payload = {
    companyHost,
    service,
    source,
    country: (lookup.country ?? 'au').toLowerCase(),
    documentFingerprint: docFp,
    keywordsFingerprint: docFp ? '' : keywordsFingerprint(lookup),
  };

  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export async function getCachedCompetitorDiscovery(
  lookup: CompetitorCacheLookup
): Promise<CompetitorIntelligence | null> {
  if (lookup.skipCache) return null;

  const cacheKey = buildCompetitorCacheKey(lookup);
  if (!cacheKey) return null;

  const mem = MEMORY.get(cacheKey);
  if (mem && mem.expires > Date.now()) {
    console.log(`[competitor-cache] memory hit ${lookup.primaryService ?? lookup.productsServices?.[0]} (${resolveDiscoverySource(lookup)})`);
    return mem.payload;
  }

  try {
    const row = await prisma.competitorDiscoveryCache.findUnique({
      where: { cacheKey },
    });
    if (!row || row.expiresAt < new Date()) {
      if (row) {
        void prisma.competitorDiscoveryCache.delete({ where: { cacheKey } }).catch(() => {});
      }
      return null;
    }

    const payload = row.payload as CompetitorIntelligence;
    MEMORY.set(cacheKey, { expires: Date.now() + MEMORY_TTL_MS, payload });
    console.log(
      `[competitor-cache] db hit ${row.companyHost} · ${row.service} (${row.source}) — returning stored competitors + ads`
    );
    return payload;
  } catch (err) {
    console.warn('[competitor-cache] read failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

export async function setCachedCompetitorDiscovery(
  lookup: CompetitorCacheLookup,
  payload: CompetitorIntelligence
): Promise<void> {
  if (lookup.skipCache) return;

  const cacheKey = buildCompetitorCacheKey(lookup);
  if (!cacheKey) return;

  const source = resolveDiscoverySource(lookup);
  const companyHost = hostFrom(lookup.websiteUrl) || hostFrom(lookup.businessName);
  const service = normalizeService(lookup);
  const expiresAt = new Date(Date.now() + dbTtlMs(source));

  MEMORY.set(cacheKey, { expires: Date.now() + MEMORY_TTL_MS, payload });

  try {
    await prisma.competitorDiscoveryCache.upsert({
      where: { cacheKey },
      create: {
        cacheKey,
        companyHost,
        service,
        offer: (lookup.offer ?? '').trim(),
        source,
        country: (lookup.country ?? 'au').toLowerCase(),
        preferredCampaignType: lookup.preferredCampaignType ?? null,
        documentFingerprint: documentFingerprint(lookup) || null,
        payload: payload as object,
        expiresAt,
      },
      update: {
        payload: payload as object,
        expiresAt,
        offer: (lookup.offer ?? '').trim(),
        documentFingerprint: documentFingerprint(lookup) || null,
      },
    });
    console.log(
      `[competitor-cache] stored ${companyHost} · ${service} (${source}, keywords=${keywordsFingerprint(lookup) || 'none'}, doc=${documentFingerprint(lookup) || 'none'})`
    );
  } catch (err) {
    console.warn('[competitor-cache] write failed:', err instanceof Error ? err.message : err);
  }
}
