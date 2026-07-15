/** Google Ads campaign-type keys used in Competitor Ad Library (recommendations only). */
export type CompetitorCampaignTypeKey =
  | 'search'
  | 'display'
  | 'shopping'
  | 'video'
  | 'performance_max'
  | 'demand_gen'
  | 'app'
  | 'local_services';

export const COMPETITOR_CAMPAIGN_TYPES: Array<{
  key: CompetitorCampaignTypeKey;
  label: string;
  tabLabel: string;
}> = [
  { key: 'search', label: 'Google Search Ads', tabLabel: 'Search Ads' },
  { key: 'display', label: 'Google Display Ads', tabLabel: 'Display Ads' },
  { key: 'shopping', label: 'Google Shopping Ads', tabLabel: 'Shopping Ads' },
  { key: 'video', label: 'Video Ads', tabLabel: 'Video Ads' },
  { key: 'performance_max', label: 'Performance Max', tabLabel: 'Performance Max' },
  { key: 'demand_gen', label: 'Demand Gen', tabLabel: 'Demand Gen' },
  { key: 'app', label: 'App Campaigns', tabLabel: 'App Campaigns' },
  { key: 'local_services', label: 'Local Services Ads', tabLabel: 'Local Services Ads' },
];

export function campaignTypeLabel(key: CompetitorCampaignTypeKey): string {
  return COMPETITOR_CAMPAIGN_TYPES.find((t) => t.key === key)?.label ?? key;
}

/** Map Google Ads advertisingChannelType → library key. */
export function mapGoogleAdsChannelType(channelType?: string): CompetitorCampaignTypeKey | null {
  const t = (channelType ?? '').toUpperCase().replace(/\s+/g, '_');
  if (t.includes('SEARCH')) return 'search';
  if (t.includes('DISPLAY')) return 'display';
  if (t.includes('SHOPPING')) return 'shopping';
  if (t.includes('VIDEO')) return 'video';
  if (t.includes('PERFORMANCE_MAX') || t === 'PERFORMANCE_MAX') return 'performance_max';
  if (t.includes('DEMAND_GEN')) return 'demand_gen';
  if (t.includes('MULTI_CHANNEL') || t.includes('APP')) return 'app';
  if (t.includes('LOCAL_SERVICES') || t.includes('LOCAL')) return 'local_services';
  return null;
}

/**
 * Infer campaign type from SociaVault / Transparency creative signals.
 * Transparency Center exposes creative format (text/image/video), not Google Ads channel types —
 * classification is best-effort from format + creative content.
 */
export function classifyCompetitorCreative(input: {
  format?: string;
  headlines?: string[];
  descriptions?: string[];
  previewImageUrl?: string;
  youtubeUrl?: string | null;
  destinationUrl?: string;
  hasTextCreatives?: boolean;
  hasImageCreatives?: boolean;
  hasVideoCreatives?: boolean;
}): CompetitorCampaignTypeKey {
  const format = (input.format ?? '').toLowerCase();
  const text = [
    ...(input.headlines ?? []),
    ...(input.descriptions ?? []),
    input.destinationUrl ?? '',
  ]
    .join(' ')
    .toLowerCase();

  if (
    format.includes('video') ||
    input.youtubeUrl ||
    input.hasVideoCreatives ||
    /youtube\.com|youtu\.be/.test(text)
  ) {
    return 'video';
  }

  if (/local.?service|google.?guaranteed|\blsa\b/.test(text)) {
    return 'local_services';
  }

  if (/play\.google|apps\.apple|app.?install|download the app|\bios\b|\bandroid\b/.test(text)) {
    return 'app';
  }

  if (
    (/shopping|merchant|product.?feed|free shipping|shop now|buy now|\$\d/.test(text) &&
      (format.includes('image') || !!input.previewImageUrl)) ||
    /google\.com\/shopping/.test(text)
  ) {
    return 'shopping';
  }

  // Strong multi-format advertisers often run Performance Max / Demand Gen alongside Search
  if (input.hasTextCreatives && input.hasImageCreatives && (input.hasVideoCreatives || format.includes('image'))) {
    if (/discover|youtube|demand.?gen|audience/.test(text)) return 'demand_gen';
    return 'performance_max';
  }

  if (format.includes('image') || (!!input.previewImageUrl && !(input.headlines?.length))) {
    if (/remarket|retarget|awareness|demand/.test(text)) return 'demand_gen';
    return 'display';
  }

  if (format.includes('text') || (input.headlines?.length && input.descriptions?.length)) {
    return 'search';
  }

  if (input.previewImageUrl) return 'display';
  return 'search';
}

/** Aggregate formats from a raw SociaVault company-ads list into format flags. */
export function summarizeCreativeFormats(
  formats: string[]
): { hasTextCreatives: boolean; hasImageCreatives: boolean; hasVideoCreatives: boolean } {
  const normalized = formats.map((f) => f.toLowerCase());
  return {
    hasTextCreatives: normalized.some((f) => f.includes('text')),
    hasImageCreatives: normalized.some((f) => f.includes('image')),
    hasVideoCreatives: normalized.some((f) => f.includes('video')),
  };
}
