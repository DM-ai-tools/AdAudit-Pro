import { env } from '../config/env.js';
import {
  AUDIT_MODULE_CATALOG,
  AUDIT_DEPTH_OPTIONS,
  AUDIT_WINDOW_OPTIONS,
  QUICK_MODULE_IDS,
} from '../data/audit-module-catalog.js';
import type { GoogleAdsAccountDto } from './google-ads.service.js';
import { fetchAccountInsights, isGoogleAdsConfigured } from './google-ads.service.js';

export type AuditDepth = 'quick' | 'standard' | 'deep';
export type AuditWindow = 30 | 90 | 365;

export interface AuditModuleConfig {
  id: string;
  name: string;
  description: string;
  icon: string;
  enabled: boolean;
  available: boolean;
  reason?: string;
}

export interface AccountAuditConfig {
  account: GoogleAdsAccountDto;
  source: 'google_ads_api' | 'mock';
  recommendedDepth: AuditDepth;
  recommendedWindow: AuditWindow;
  modules: AuditModuleConfig[];
  whatWeAnalyze: string[];
  stats: {
    activeCampaigns: number;
    campaignTypes: string[];
    spend30Days: number;
    spend90Days: number;
    spend365Days: number;
    conversionActions: number;
    landingPageCount: number;
  };
  depthOptions: typeof AUDIT_DEPTH_OPTIONS;
  windowOptions: typeof AUDIT_WINDOW_OPTIONS;
}

function bareId(customerId: string): string {
  return customerId.replace(/-/g, '');
}

function applyDepth(modules: AuditModuleConfig[], depth: AuditDepth): AuditModuleConfig[] {
  return modules.map((m) => {
    if (!m.available) return { ...m, enabled: false };
    if (depth === 'quick') return { ...m, enabled: QUICK_MODULE_IDS.includes(m.id) };
    return { ...m, enabled: true };
  });
}

function buildModulesFromInsights(insights: {
  channelTypes: Set<string>;
  activeCampaigns: number;
  landingPageCount: number;
  conversionActions: number;
}): AuditModuleConfig[] {
  const types = insights.channelTypes;
  const hasSearch = types.has('SEARCH');
  const hasDisplay = types.has('DISPLAY');
  const hasShopping = types.has('SHOPPING');
  const hasPmax = types.has('PERFORMANCE_MAX');
  const hasVideo = types.has('VIDEO') || types.has('DEMAND_GEN');
  const hasCampaigns = insights.activeCampaigns > 0;

  const rules: Record<string, { available: boolean; reason?: string; desc?: string }> = {
    campaign: {
      available: hasCampaigns,
      reason: hasCampaigns ? undefined : 'No active campaigns in this account',
      desc: hasCampaigns ? `${insights.activeCampaigns} active campaign(s) detected` : undefined,
    },
    keyword: {
      available: hasSearch || hasShopping,
      reason: 'Requires Search or Shopping campaigns',
      desc: hasSearch ? 'Search campaigns active' : undefined,
    },
    'search-terms': {
      available: hasSearch,
      reason: 'Requires Search campaigns',
    },
    budget: { available: hasCampaigns, reason: 'No campaign spend data' },
    geo: { available: hasCampaigns },
    audience: {
      available: hasDisplay || hasPmax || hasVideo,
      reason: 'Requires Display, Video, or Performance Max campaigns',
    },
    'ad-copy': {
      available: hasSearch || hasDisplay || hasPmax,
      reason: 'Requires Search, Display, or Performance Max campaigns',
    },
    'landing-pages': {
      available: insights.landingPageCount > 0,
      reason: 'No landing page URLs found in active ads',
      desc: insights.landingPageCount > 0 ? `${insights.landingPageCount} landing page(s) found` : undefined,
    },
    bidding: { available: hasCampaigns },
    conversion: {
      available: true,
      desc: insights.conversionActions > 0
        ? `${insights.conversionActions} conversion action(s) configured`
        : 'No conversion actions detected — audit will flag setup gaps',
    },
    'quality-score': {
      available: hasSearch,
      reason: 'Requires Search campaigns',
    },
    device: { available: hasCampaigns },
  };

  return AUDIT_MODULE_CATALOG.map((item) => {
    const rule = rules[item.id] ?? { available: true };
    return {
      id: item.id,
      name: item.name,
      description: rule.desc ?? item.description,
      icon: item.icon,
      available: rule.available,
      enabled: rule.available,
      reason: rule.available ? undefined : rule.reason,
    };
  });
}

function recommendWindow(spend30: number, spend90: number, spend365: number): AuditWindow {
  if (spend365 > 0) return 365;
  if (spend90 > 0) return 90;
  return 30;
}

function recommendDepth(activeCampaigns: number, spend30: number): AuditDepth {
  if (activeCampaigns > 25 || spend30 > 50000) return 'deep';
  if (activeCampaigns > 8 || spend30 > 10000) return 'standard';
  return 'quick';
}

function mockConfig(account: GoogleAdsAccountDto): AccountAuditConfig {
  const modules = applyDepth(
    AUDIT_MODULE_CATALOG.map((m) => ({
      ...m,
      available: true,
      enabled: true,
    })),
    'standard'
  );

  return {
    account,
    source: 'mock',
    recommendedDepth: 'standard',
    recommendedWindow: 365,
    modules,
    whatWeAnalyze: modules.filter((m) => m.enabled).map((m) => m.name),
    stats: {
      activeCampaigns: 12,
      campaignTypes: ['SEARCH', 'DISPLAY'],
      spend30Days: account.monthlySpend,
      spend90Days: account.monthlySpend * 3,
      spend365Days: account.monthlySpend * 12,
      conversionActions: 3,
      landingPageCount: 5,
    },
    depthOptions: AUDIT_DEPTH_OPTIONS,
    windowOptions: AUDIT_WINDOW_OPTIONS,
  };
}

export async function getAccountAuditConfig(
  customerId: string,
  refreshToken: string | undefined,
  fallbackAccount?: GoogleAdsAccountDto
): Promise<AccountAuditConfig | null> {
  if (!fallbackAccount) return null;

  if (!refreshToken || !isGoogleAdsConfigured()) {
    if (env.useMockData) return mockConfig(fallbackAccount);
    return null;
  }

  const insights = await fetchAccountInsights(refreshToken, bareId(customerId));
  if (!insights) {
    if (env.useMockData) return mockConfig(fallbackAccount);
    return null;
  }

  const modules = buildModulesFromInsights(insights);
  const recommendedDepth = recommendDepth(insights.activeCampaigns, insights.spend30Days);
  const recommendedWindow = recommendWindow(
    insights.spend30Days,
    insights.spend90Days,
    insights.spend365Days
  );

  const enabledModules = applyDepth(modules, recommendedDepth);

  return {
    account: {
      ...fallbackAccount,
      name: insights.accountName || fallbackAccount.name,
      currency: insights.currency || fallbackAccount.currency,
      timezone: insights.timezone || fallbackAccount.timezone,
      monthlySpend: insights.spend30Days,
    },
    source: 'google_ads_api',
    recommendedDepth,
    recommendedWindow,
    modules: enabledModules,
    whatWeAnalyze: enabledModules.filter((m) => m.enabled).map((m) => m.name),
    stats: {
      activeCampaigns: insights.activeCampaigns,
      campaignTypes: [...insights.channelTypes],
      spend30Days: insights.spend30Days,
      spend90Days: insights.spend90Days,
      spend365Days: insights.spend365Days,
      conversionActions: insights.conversionActions,
      landingPageCount: insights.landingPageCount,
    },
    depthOptions: AUDIT_DEPTH_OPTIONS.map((d) => ({
      ...d,
      modules: d.id === 'quick'
        ? QUICK_MODULE_IDS.filter((id) => modules.find((m) => m.id === id)?.available).length
        : modules.filter((m) => m.available).length,
    })),
    windowOptions: AUDIT_WINDOW_OPTIONS,
  };
}

export function applyAuditDepthToModules(
  modules: AuditModuleConfig[],
  depth: AuditDepth
): AuditModuleConfig[] {
  return applyDepth(modules, depth);
}
