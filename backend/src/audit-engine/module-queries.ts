import { AUDIT_MODULE_CATALOG } from '../data/audit-module-catalog.js';

export interface GaqlQueryOptions {
  campaignId?: string;
}

function campaignFilter(campaignId?: string): string {
  if (!campaignId) return '';
  const id = campaignId.replace(/\D/g, '');
  return id ? ` AND campaign.id = ${id}` : '';
}

export const MODULE_GAQL: Record<string, (dateRange: string, opts?: GaqlQueryOptions) => string> = {
  campaign: (d, opts) =>
    `SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type,
            campaign.bidding_strategy_type, metrics.cost_micros, metrics.clicks, metrics.conversions,
            metrics.impressions, metrics.ctr, metrics.average_cpc, metrics.cost_per_conversion,
            metrics.search_impression_share
     FROM campaign WHERE segments.date DURING ${d}${campaignFilter(opts?.campaignId)} LIMIT 40`,
  keyword: (d, opts) =>
    `SELECT campaign.name, ad_group.name, ad_group_criterion.keyword.text, ad_group_criterion.match_type,
            metrics.cost_micros, metrics.conversions, metrics.clicks, metrics.impressions,
            ad_group_criterion.quality_info.quality_score
     FROM keyword_view WHERE segments.date DURING ${d}${campaignFilter(opts?.campaignId)}
     ORDER BY metrics.cost_micros DESC LIMIT 40`,
  'search-terms': (d, opts) =>
    `SELECT campaign.name, search_term_view.search_term, search_term_view.status,
            metrics.cost_micros, metrics.conversions, metrics.clicks, metrics.impressions
     FROM search_term_view WHERE segments.date DURING ${d}${campaignFilter(opts?.campaignId)}
     ORDER BY metrics.cost_micros DESC LIMIT 40`,
  budget: (d, opts) =>
    `SELECT campaign.id, campaign.name, campaign_budget.amount_micros, metrics.cost_micros,
            campaign.status, metrics.conversions
     FROM campaign WHERE segments.date DURING ${d}${campaignFilter(opts?.campaignId)} LIMIT 30`,
  geo: (d, opts) =>
    `SELECT campaign.name, geographic_view.country_criterion_id, metrics.cost_micros, metrics.conversions,
            metrics.clicks
     FROM geographic_view WHERE segments.date DURING ${d}${campaignFilter(opts?.campaignId)}
     ORDER BY metrics.cost_micros DESC LIMIT 30`,
  audience: (d, opts) =>
    `SELECT campaign.name, ad_group.name, ad_group_criterion.display_name,
            ad_group_criterion.type, metrics.cost_micros, metrics.conversions, metrics.clicks
     FROM ad_group_criterion WHERE segments.date DURING ${d}${campaignFilter(opts?.campaignId)}
     AND ad_group_criterion.type IN ('USER_LIST', 'USER_INTEREST', 'CUSTOM_AUDIENCE', 'COMBINED_AUDIENCE')
     ORDER BY metrics.cost_micros DESC LIMIT 30`,
  'ad-copy': (d, opts) =>
    `SELECT campaign.id, campaign.name, ad_group.name,
            ad_group_ad.resource_name, ad_group_ad.ad_strength,
            ad_group_ad.ad.responsive_search_ad.headlines,
            ad_group_ad.ad.responsive_search_ad.descriptions,
            ad_group_ad.ad.final_urls,
            metrics.impressions, metrics.clicks, metrics.conversions, metrics.cost_micros, metrics.ctr
     FROM ad_group_ad WHERE segments.date DURING ${d} AND ad_group_ad.status IN ('ENABLED', 'PAUSED')
     ${campaignFilter(opts?.campaignId)} LIMIT 30`,
  'landing-pages': (d, opts) =>
    `SELECT campaign.name, ad_group_ad.ad.final_urls, metrics.clicks, metrics.conversions,
            metrics.cost_micros, metrics.impressions
     FROM ad_group_ad WHERE segments.date DURING ${d}${campaignFilter(opts?.campaignId)} LIMIT 30`,
  bidding: (d, opts) =>
    `SELECT campaign.name, campaign.bidding_strategy_type, campaign.target_cpa.target_cpa_micros,
            metrics.cost_micros, metrics.conversions, metrics.clicks
     FROM campaign WHERE segments.date DURING ${d}${campaignFilter(opts?.campaignId)} LIMIT 30`,
  conversion: () =>
    `SELECT conversion_action.name, conversion_action.status, conversion_action.type,
            conversion_action.category
     FROM conversion_action LIMIT 20`,
  'quality-score': (d, opts) =>
    `SELECT campaign.name, ad_group.name, ad_group_criterion.keyword.text,
            ad_group_criterion.quality_info.quality_score, metrics.cost_micros, metrics.clicks,
            metrics.impressions, metrics.conversions
     FROM keyword_view WHERE segments.date DURING ${d}${campaignFilter(opts?.campaignId)}
     AND ad_group_criterion.quality_info.quality_score IS NOT NULL
     ORDER BY metrics.cost_micros DESC LIMIT 30`,
  device: (d, opts) =>
    `SELECT campaign.name, segments.device, metrics.cost_micros, metrics.conversions, metrics.clicks,
            metrics.impressions, metrics.ctr, metrics.average_cpc
     FROM campaign WHERE segments.date DURING ${d}${campaignFilter(opts?.campaignId)} LIMIT 30`,
  'impression-share': (d, opts) =>
    `SELECT campaign.name, metrics.search_impression_share, metrics.search_budget_lost_impression_share,
            metrics.cost_micros, metrics.conversions, metrics.clicks
     FROM campaign WHERE segments.date DURING ${d}${campaignFilter(opts?.campaignId)} LIMIT 30`,
  pmax: (d, opts) =>
    `SELECT campaign.name, campaign.advertising_channel_type, metrics.cost_micros, metrics.conversions,
            metrics.clicks, metrics.impressions
     FROM campaign WHERE campaign.advertising_channel_type = 'PERFORMANCE_MAX'
     AND segments.date DURING ${d}${campaignFilter(opts?.campaignId)} LIMIT 20`,
};

export function dateRangeForWindow(days: number): string {
  if (days >= 365) return 'LAST_365_DAYS';
  if (days >= 90) return 'LAST_90_DAYS';
  return 'LAST_30_DAYS';
}

export function getModuleName(slug: string): string {
  return AUDIT_MODULE_CATALOG.find((m) => m.id === slug)?.name ?? slug;
}

export function estimateMinutes(moduleCount: number, depth: string, parallelStreams = 1): number {
  const base = depth === 'quick' ? 8 : depth === 'deep' ? 32 : 18;
  const sequential = Math.max(5, Math.round(base * (moduleCount / 12)));
  return Math.max(2, Math.ceil(sequential / Math.max(1, parallelStreams)));
}
