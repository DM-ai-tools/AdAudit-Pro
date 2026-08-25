/** Google Ads campaign-type keys used in Competitor Ad Library (recommendations only). */
export type CompetitorCampaignTypeKey =
  | 'search'
  | 'display'
  | 'shopping'
  | 'video'
  | 'performance_max'
  | 'demand_gen'
  | 'app'
  | 'local_services'
  | 'call_ads';

export type AccountCampaignTypeKey =
  | CompetitorCampaignTypeKey
  | 'other';

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
  { key: 'call_ads', label: 'Call Ads', tabLabel: 'Call Ads' },
];

export function campaignTypeLabel(key: CompetitorCampaignTypeKey | AccountCampaignTypeKey): string {
  if (key === 'other') return 'Other Campaigns';
  return COMPETITOR_CAMPAIGN_TYPES.find((t) => t.key === key)?.label ?? key;
}

/** Map Google Ads advertisingChannelType → library / create key. */
export function mapGoogleAdsChannelType(channelType?: string): CompetitorCampaignTypeKey | null {
  const t = (channelType ?? '').toUpperCase().replace(/\s+/g, '_');
  if (t.includes('PERFORMANCE_MAX') || t === 'PERFORMANCE_MAX') return 'performance_max';
  if (t.includes('DEMAND_GEN') || t.includes('DISCOVERY')) return 'demand_gen';
  if (t.includes('SHOPPING')) return 'shopping';
  if (t.includes('VIDEO')) return 'video';
  if (t.includes('DISPLAY')) return 'display';
  if (t.includes('MULTI_CHANNEL') || t.includes('APP')) return 'app';
  if (t.includes('LOCAL_SERVICES') || t === 'LOCAL') return 'local_services';
  if (t.includes('SEARCH')) return 'search';
  return null;
}

/** Normalize UI / free-text campaign type → account bucket. */
export function normalizeAccountCampaignType(
  raw?: string | null
): AccountCampaignTypeKey | null {
  if (!raw?.trim()) return null;
  const t = raw.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (t === 'search' || t.includes('search_ad')) return 'search';
  if (t === 'display' || t.includes('display')) return 'display';
  if (t === 'video' || t.includes('youtube') || t.includes('video')) return 'video';
  if (t === 'shopping' || t.includes('shopping')) return 'shopping';
  if (t === 'performance_max' || t.includes('pmax') || t.includes('performance_max')) {
    return 'performance_max';
  }
  if (t === 'app' || t.includes('app_campaign')) return 'app';
  if (t === 'demand_gen' || t.includes('demand')) return 'demand_gen';
  if (t === 'local_services' || t.includes('local_service')) return 'local_services';
  if (t === 'call_ads' || t.includes('call')) return 'call_ads';
  return mapGoogleAdsChannelType(raw) ?? null;
}

/**
 * Google Ads API advertisingChannelType for campaign create.
 * Call ads are Search campaigns with call-focused creatives.
 */
export function toGoogleAdsAdvertisingChannelType(
  type: AccountCampaignTypeKey
): string {
  switch (type) {
    case 'display':
      return 'DISPLAY';
    case 'video':
      return 'VIDEO';
    case 'shopping':
      return 'SHOPPING';
    case 'performance_max':
      return 'PERFORMANCE_MAX';
    case 'app':
      return 'MULTI_CHANNEL';
    case 'demand_gen':
      return 'DEMAND_GEN';
    case 'local_services':
      return 'LOCAL_SERVICES';
    case 'call_ads':
    case 'search':
    case 'other':
    default:
      return 'SEARCH';
  }
}

export function supportsAutomatedRsaCreate(type: AccountCampaignTypeKey): boolean {
  return type === 'search' || type === 'call_ads' || type === 'other';
}

export function defaultAdFormatLabel(type: AccountCampaignTypeKey): string {
  switch (type) {
    case 'display':
      return 'Responsive Display Ad';
    case 'video':
      return 'YouTube / Video Ad';
    case 'shopping':
      return 'Shopping product ad';
    case 'performance_max':
      return 'Performance Max text assets';
    case 'app':
      return 'App campaign creatives';
    case 'demand_gen':
      return 'Demand Gen creatives';
    case 'local_services':
      return 'Local Services Ad';
    case 'call_ads':
      return 'Call Ad';
    case 'search':
    default:
      return 'Responsive Search Ad';
  }
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
