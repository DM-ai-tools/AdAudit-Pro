import { AUDIT_MODULE_CATALOG } from '../data/audit-module-catalog.js';

export const MODULE_GAQL: Record<string, (dateRange: string) => string> = {
  campaign: (d) =>
    `SELECT campaign.name, campaign.status, campaign.advertising_channel_type,
            metrics.cost_micros, metrics.clicks, metrics.conversions
     FROM campaign WHERE segments.date DURING ${d} LIMIT 40`,
  keyword: (d) =>
    `SELECT ad_group_criterion.keyword.text, metrics.cost_micros, metrics.conversions,
            ad_group_criterion.quality_info.quality_score
     FROM keyword_view WHERE segments.date DURING ${d}
     ORDER BY metrics.cost_micros DESC LIMIT 25`,
  'search-terms': (d) =>
    `SELECT search_term_view.search_term, metrics.cost_micros, metrics.conversions, metrics.clicks
     FROM search_term_view WHERE segments.date DURING ${d}
     ORDER BY metrics.cost_micros DESC LIMIT 25`,
  budget: (d) =>
    `SELECT campaign.name, campaign_budget.amount_micros, metrics.cost_micros,
            campaign.status
     FROM campaign WHERE segments.date DURING ${d} LIMIT 25`,
  geo: (d) =>
    `SELECT geographic_view.country_criterion_id, metrics.cost_micros, metrics.conversions
     FROM geographic_view WHERE segments.date DURING ${d}
     ORDER BY metrics.cost_micros DESC LIMIT 20`,
  audience: (d) =>
    `SELECT ad_group.name, metrics.cost_micros, metrics.conversions
     FROM ad_group WHERE segments.date DURING ${d}
     ORDER BY metrics.cost_micros DESC LIMIT 20`,
  'ad-copy': (d) =>
    `SELECT ad_group_ad.ad.responsive_search_ad.headlines, ad_group_ad.ad_strength,
            metrics.impressions, metrics.clicks, metrics.conversions
     FROM ad_group_ad WHERE segments.date DURING ${d} AND ad_group_ad.status = 'ENABLED'
     LIMIT 20`,
  'landing-pages': (d) =>
    `SELECT ad_group_ad.ad.final_urls, metrics.clicks, metrics.conversions, metrics.cost_micros
     FROM ad_group_ad WHERE segments.date DURING ${d} LIMIT 20`,
  bidding: (d) =>
    `SELECT campaign.name, campaign.bidding_strategy_type, metrics.cost_micros, metrics.conversions
     FROM campaign WHERE segments.date DURING ${d} LIMIT 20`,
  conversion: () =>
    `SELECT conversion_action.name, conversion_action.status, conversion_action.type,
            conversion_action.category
     FROM conversion_action LIMIT 20`,
  'quality-score': (d) =>
    `SELECT ad_group_criterion.keyword.text, ad_group_criterion.quality_info.quality_score,
            metrics.cost_micros
     FROM keyword_view WHERE segments.date DURING ${d}
     AND ad_group_criterion.quality_info.quality_score <= 5
     ORDER BY metrics.cost_micros DESC LIMIT 20`,
  device: (d) =>
    `SELECT segments.device, metrics.cost_micros, metrics.conversions, metrics.clicks
     FROM campaign WHERE segments.date DURING ${d} LIMIT 20`,
};

export function dateRangeForWindow(days: number): string {
  if (days >= 365) return 'LAST_365_DAYS';
  if (days >= 90) return 'LAST_90_DAYS';
  return 'LAST_30_DAYS';
}

export function getModuleName(slug: string): string {
  return AUDIT_MODULE_CATALOG.find((m) => m.id === slug)?.name ?? slug;
}

export function estimateMinutes(moduleCount: number, depth: string): number {
  const base = depth === 'quick' ? 8 : depth === 'deep' ? 32 : 18;
  return Math.max(5, Math.round(base * (moduleCount / 12)));
}
