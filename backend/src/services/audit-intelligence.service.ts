import { getAuditReport } from './audit.service.js';
import { getMe } from './user.service.js';
import { fetchModuleGoogleAdsData, isGoogleAdsConfigured } from './google-ads.service.js';
import type { Finding } from '../types/index.js';

export type OptimizationScenario = 'REPLACE_EXISTING' | 'CREATE_ADS' | 'CREATE_STRATEGY';

export interface LiveAdRow {
  campaignId?: string;
  campaignName?: string;
  campaignResourceName?: string;
  adGroupId?: string;
  adGroupName?: string;
  adGroupResourceName?: string;
  adGroupAdResourceName?: string;
  headlines: string[];
  descriptions: string[];
  finalUrls?: string[];
  adStrength?: string;
  impressions?: number;
  clicks?: number;
  conversions?: number;
  ctr?: number;
  costMicros?: number;
}

export interface AuditIntelligence {
  business: {
    name: string;
    goal?: string;
    websiteUrl?: string;
    monthlySpend?: number;
    campaignCount?: number;
  };
  findings: {
    critical: Finding[];
    high: Finding[];
    medium: Finding[];
    all: Finding[];
  };
  campaigns: unknown[];
  keywords: unknown[];
  searchTerms: unknown[];
  ads: LiveAdRow[];
  landingPages: unknown[];
  bidding: unknown[];
  qualityScores: unknown[];
  scenario: OptimizationScenario;
  primaryAd: LiveAdRow | null;
  dataSource: 'live' | 'audit_only';
}

const MODULE_SLUGS = [
  'campaign',
  'keyword',
  'search-terms',
  'ad-copy',
  'landing-pages',
  'bidding',
  'quality-score',
] as const;

function parseGaqlJson(raw: string): unknown[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseAdRows(rows: unknown[]): LiveAdRow[] {
  const ads: LiveAdRow[] = [];
  for (const row of rows) {
    const r = row as {
      campaign?: { id?: string; name?: string; resourceName?: string };
      adGroup?: { id?: string; name?: string; resourceName?: string };
      adGroupAd?: {
        resourceName?: string;
        adStrength?: string;
        ad?: {
          responsiveSearchAd?: {
            headlines?: Array<{ text?: string }>;
            descriptions?: Array<{ text?: string }>;
          };
          finalUrls?: string[];
        };
      };
      metrics?: {
        impressions?: string;
        clicks?: string;
        conversions?: number;
        costMicros?: string;
      };
    };

    const rsa = r.adGroupAd?.ad?.responsiveSearchAd;
    const headlines = (rsa?.headlines ?? []).map((h) => h.text ?? '').filter(Boolean);
    const descriptions = (rsa?.descriptions ?? []).map((d) => d.text ?? '').filter(Boolean);

    if (!headlines.length && !descriptions.length) continue;

    const impressions = Number(r.metrics?.impressions ?? 0);
    const clicks = Number(r.metrics?.clicks ?? 0);

    ads.push({
      campaignId: r.campaign?.id,
      campaignName: r.campaign?.name,
      campaignResourceName: r.campaign?.resourceName,
      adGroupId: r.adGroup?.id,
      adGroupName: r.adGroup?.name,
      adGroupResourceName: r.adGroup?.resourceName,
      adGroupAdResourceName: r.adGroupAd?.resourceName,
      headlines,
      descriptions,
      finalUrls: r.adGroupAd?.ad?.finalUrls,
      adStrength: r.adGroupAd?.adStrength,
      impressions,
      clicks,
      conversions: r.metrics?.conversions,
      ctr: impressions > 0 ? Math.round((clicks / impressions) * 1000) / 10 : 0,
      costMicros: Number(r.metrics?.costMicros ?? 0),
    });
  }
  return ads;
}

function buildFindingsFromAudit(auditFindings: Finding[]) {
  return {
    critical: auditFindings.filter((f) => f.severity === 'CRITICAL'),
    high: auditFindings.filter((f) => f.severity === 'HIGH'),
    medium: auditFindings.filter((f) => f.severity === 'MEDIUM'),
    all: auditFindings,
  };
}

export async function gatherAuditIntelligence(options: {
  auditId: string;
  userId: string;
  dataWindowDays?: number;
  campaignId?: string;
  accountContext?: {
    accountName?: string;
    goal?: string;
    monthlySpend?: number;
    googleAdsCustomerId?: string;
    websiteUrl?: string;
    industry?: string;
  };
  auditFindingsSnapshot?: Finding[];
}): Promise<AuditIntelligence> {
  const stored = await getAuditReport(options.auditId);
  const findings = buildFindingsFromAudit(
    stored?.findings ?? options.auditFindingsSnapshot ?? []
  );

  const business = {
    name: stored?.accountName ?? options.accountContext?.accountName ?? 'Account',
    goal: stored?.goal ?? options.accountContext?.goal,
    websiteUrl: options.accountContext?.websiteUrl,
    monthlySpend: stored?.monthlySpend ?? options.accountContext?.monthlySpend,
    campaignCount: stored?.campaignCount,
  };

  const customerId = stored?.googleAdsCustomerId ?? options.accountContext?.googleAdsCustomerId;
  const windowDays = stored?.dataWindowDays ?? options.dataWindowDays ?? 30;
  const dateRange = windowDays >= 365 ? 'LAST_365_DAYS' : windowDays >= 90 ? 'LAST_90_DAYS' : 'LAST_30_DAYS';

  let campaigns: unknown[] = [];
  let keywords: unknown[] = [];
  let searchTerms: unknown[] = [];
  let ads: LiveAdRow[] = [];
  let landingPages: unknown[] = [];
  let bidding: unknown[] = [];
  let qualityScores: unknown[] = [];
  let dataSource: 'live' | 'audit_only' = 'audit_only';

  const user = await getMe(options.userId);
  if (user?.googleRefreshToken && customerId && isGoogleAdsConfigured()) {
    const fetches = await Promise.all(
      MODULE_SLUGS.map(async (slug) => {
        const raw = await fetchModuleGoogleAdsData(
          user.googleRefreshToken!,
          customerId,
          slug,
          dateRange,
          options.userId
        );
        return { slug, rows: parseGaqlJson(raw) };
      })
    );

    for (const { slug, rows } of fetches) {
      if (!rows.length) continue;
      dataSource = 'live';
      switch (slug) {
        case 'campaign':
          campaigns = rows;
          break;
        case 'keyword':
          keywords = rows;
          break;
        case 'search-terms':
          searchTerms = rows;
          break;
        case 'ad-copy':
          ads = parseAdRows(rows);
          break;
        case 'landing-pages':
          landingPages = rows;
          break;
        case 'bidding':
          bidding = rows;
          break;
        case 'quality-score':
          qualityScores = rows;
          break;
      }
    }
  }

  if (options.campaignId && campaigns.length) {
    campaigns = campaigns.filter((row) => {
      const r = row as { campaign?: { id?: string } };
      return r.campaign?.id === options.campaignId;
    });
    ads = ads.filter((a) => a.campaignId === options.campaignId);
    keywords = keywords.filter((row) => {
      const r = row as { campaign?: { id?: string } };
      return r.campaign?.id === options.campaignId;
    });
  }

  let scenario: OptimizationScenario = 'CREATE_STRATEGY';
  if (ads.length > 0) scenario = 'REPLACE_EXISTING';
  else if (campaigns.length > 0) scenario = 'CREATE_ADS';

  const primaryAd =
    ads.length > 0
      ? [...ads].sort((a, b) => (b.impressions ?? 0) - (a.impressions ?? 0))[0]
      : null;

  return {
    business,
    findings,
    campaigns,
    keywords,
    searchTerms,
    ads,
    landingPages,
    bidding,
    qualityScores,
    scenario,
    primaryAd,
    dataSource,
  };
}
