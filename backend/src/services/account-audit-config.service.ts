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
  const hasCampaigns = insights.activeCampaigns > 0;

  const hints: Record<string, string | undefined> = {
    campaign: hasCampaigns ? `${insights.activeCampaigns} active campaign(s) detected` : 'No active campaigns — Claude will flag setup gaps',
    keyword: hasSearch ? 'Search campaigns active' : 'Limited Search data — analysis based on account profile',
    'search-terms': hasSearch ? undefined : 'No Search campaigns — will review negative keyword strategy gaps',
    conversion: insights.conversionActions > 0
      ? `${insights.conversionActions} conversion action(s) configured`
      : 'No conversion actions detected — audit will flag setup gaps',
    'landing-pages': insights.landingPageCount > 0
      ? `${insights.landingPageCount} landing page(s) found`
      : 'No landing page URLs found in active ads',
  };

  return AUDIT_MODULE_CATALOG.map((item) => {
    const hint = hints[item.id];
    return {
      id: item.id,
      name: item.name,
      description: hint ?? item.description,
      icon: item.icon,
      available: true,
      enabled: true,
      reason: undefined,
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
  if (activeCampaigns === 0 && spend30 === 0) return 'standard';
  if (activeCampaigns > 8 || spend30 > 10000) return 'standard';
  return 'standard';
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
  fallbackAccount?: GoogleAdsAccountDto,
  userId?: string
): Promise<AccountAuditConfig | null> {
  if (!fallbackAccount) return null;

  if (!refreshToken || !isGoogleAdsConfigured()) {
    if (env.useMockData) return mockConfig(fallbackAccount);
    return null;
  }

  const insights = await fetchAccountInsights(refreshToken, bareId(customerId), userId);
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
        ? QUICK_MODULE_IDS.length
        : AUDIT_MODULE_CATALOG.length,
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
