/** Canonical Google Ads campaign buckets for Your Campaigns. */
export type AccountCampaignTypeKey =
  | 'search'
  | 'display'
  | 'video'
  | 'shopping'
  | 'performance_max'
  | 'app'
  | 'demand_gen'
  | 'local_services'
  | 'call_ads'
  | 'other';

export interface AccountCampaignTypeMeta {
  key: AccountCampaignTypeKey;
  label: string;
  shortLabel: string;
  description: string;
}

export const ACCOUNT_CAMPAIGN_TYPES: AccountCampaignTypeMeta[] = [
  {
    key: 'search',
    label: 'Google Search Ads',
    shortLabel: 'Search Ads',
    description:
      'Text-based ads that appear at the top or bottom of Google search engine results pages (SERP). They target users actively searching for specific keywords, making them highly effective for driving immediate sales and high-intent leads.',
  },
  {
    key: 'display',
    label: 'Google Display Ads',
    shortLabel: 'Display Ads',
    description:
      'Image, banner, or rich-media ads that appear across the Google Display Network, including websites, apps, and Google properties like Gmail. Ideal for brand awareness and retargeting past website visitors.',
  },
  {
    key: 'video',
    label: 'Google Video Ads',
    shortLabel: 'Video Ads',
    description:
      'Hosted on YouTube and the Google Video Partners network. Formats include skippable/non-skippable in-stream ads, bumper ads, and in-feed video ads — excellent for storytelling and reaching engaged audiences.',
  },
  {
    key: 'shopping',
    label: 'Google Shopping Ads',
    shortLabel: 'Shopping Ads',
    description:
      'Product-based ads that show an image, title, price, and merchant name on the SERP and Shopping tab. Essential for e-commerce and retail businesses.',
  },
  {
    key: 'performance_max',
    label: 'Performance Max',
    shortLabel: 'Performance Max',
    description:
      'A goal-based, automated campaign type. With your assets (text, images, videos) and goals, Google AI places ads across Search, Display, YouTube, Gmail, and Maps to maximize conversions.',
  },
  {
    key: 'app',
    label: 'App Campaigns',
    shortLabel: 'App Campaigns',
    description:
      'Designed to drive app downloads or increase in-app engagement. Ads appear across Google Search, the Google Play Store, YouTube, and the Display Network.',
  },
  {
    key: 'demand_gen',
    label: 'Demand Gen',
    shortLabel: 'Demand Gen',
    description:
      'AI-driven campaigns (replacing Discovery) designed to create demand visually across YouTube, the Google Discover feed, and Gmail.',
  },
  {
    key: 'local_services',
    label: 'Local Services Ads',
    shortLabel: 'Local Services',
    description:
      'Tailored for brick-and-mortar and service businesses. Ads appear at the top of Google Search and Maps, connecting local customers via call or message.',
  },
  {
    key: 'call_ads',
    label: 'Call Ads',
    shortLabel: 'Call Ads',
    description:
      'A mobile-focused format that prompts users to call your business directly from search results rather than clicking through to a landing page.',
  },
  {
    key: 'other',
    label: 'Other Campaigns',
    shortLabel: 'Other',
    description: 'Campaigns that do not map cleanly to a standard Google Ads channel type in this account.',
  },
];

const META_BY_KEY = Object.fromEntries(
  ACCOUNT_CAMPAIGN_TYPES.map((t) => [t.key, t])
) as Record<AccountCampaignTypeKey, AccountCampaignTypeMeta>;

export function getCampaignTypeMeta(key: AccountCampaignTypeKey): AccountCampaignTypeMeta {
  return META_BY_KEY[key] ?? META_BY_KEY.other;
}

/** Map Google Ads advertisingChannelType (+ call-ad detection) → UI bucket. */
export function resolveAccountCampaignType(input: {
  type: string;
  name?: string;
  ads?: Array<{ adType?: string }>;
}): AccountCampaignTypeKey {
  const ads = input.ads ?? [];
  const hasCallAd = ads.some((a) => /CALL/i.test(a.adType ?? ''));
  const allCall =
    ads.length > 0 && ads.every((a) => /CALL/i.test(a.adType ?? ''));
  const nameSuggestsCall = /\bcall(?:\s|-)?only\b|\bcall ads?\b/i.test(input.name ?? '');

  if (allCall || (hasCallAd && nameSuggestsCall) || (hasCallAd && ads.length <= 2 && nameSuggestsCall)) {
    return 'call_ads';
  }
  // Prefer explicit Call Ads bucket when campaign is predominantly call ads
  if (hasCallAd && ads.filter((a) => /CALL/i.test(a.adType ?? '')).length >= Math.ceil(ads.length / 2)) {
    return 'call_ads';
  }

  const t = (input.type ?? '').toUpperCase().replace(/\s+/g, '_');
  if (t.includes('PERFORMANCE_MAX')) return 'performance_max';
  if (t.includes('DEMAND_GEN') || t.includes('DISCOVERY')) return 'demand_gen';
  if (t.includes('SHOPPING')) return 'shopping';
  if (t.includes('VIDEO')) return 'video';
  if (t.includes('DISPLAY')) return 'display';
  if (t.includes('MULTI_CHANNEL') || t.includes('APP')) return 'app';
  if (t.includes('LOCAL_SERVICES')) return 'local_services';
  if (t === 'LOCAL' || t.includes('LOCAL_CAMPAIGN')) return 'local_services';
  if (t.includes('SEARCH')) return 'search';
  if (hasCallAd) return 'call_ads';
  return 'other';
}

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'your', 'our', 'campaign', 'brand',
  'search', 'display', 'video', 'shopping', 'pmax', 'ads', 'ad', 'group',
  'australia', 'sydney', 'melbourne', 'brisbane', 'perth',
  'near', 'best', 'free', 'get', 'now', 'new', 'online',
  'services', 'service', 'offer', 'contact', 'about', 'home', 'faq', 'faqs',
]);

const FLUFF_SERVICE =
  /^(services we offer|our services|contact(?: for services)?|why choose(?: us)?|faqs?|home|about(?: us)?|blog|news|privacy|terms|login|book a|get in touch|learn more|award|excellence|process|panel of|how it works|testimonials?|reviews?|get started|free consultation|contact us|our three step|our panel)/i;

function isUsefulServiceLabel(label: string): boolean {
  const t = label.trim();
  if (t.length < 3 || t.length > 55) return false;
  if (FLUFF_SERVICE.test(t)) return false;
  if (/\?$/.test(t)) return false;
  if (/^\d+\+?\s/.test(t)) return false;
  if (STOP_WORDS.has(t.toLowerCase())) return false;
  return true;
}

/**
 * Service chips come from the audited landing page / website services only.
 * Campaign copy is used for matching, not for inventing service labels.
 */
export function deriveServiceFilters(
  websiteServices: string[],
  _campaigns?: Array<{
    name: string;
    ads?: Array<{ headlines?: string[]; descriptions?: string[]; finalUrls?: string[] }>;
  }>
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of websiteServices) {
    const s = raw.replace(/\s+/g, ' ').trim();
    if (!isUsefulServiceLabel(s)) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= 12) break;
  }
  return out;
}

export function campaignMatchesService(
  campaign: {
    name: string;
    ads?: Array<{ headlines?: string[]; descriptions?: string[]; finalUrls?: string[] }>;
  },
  service: string
): boolean {
  const needle = service.toLowerCase().trim();
  if (!needle) return true;
  const tokens = needle
    .split(/\W+/)
    .filter((t) => t.length > 2 && !STOP_WORDS.has(t));

  // Prefer landing-page / final URL match, then campaign name + ad copy
  const landingHay = (campaign.ads ?? [])
    .flatMap((a) => a.finalUrls ?? [])
    .join(' ')
    .toLowerCase();
  const copyHay = [
    campaign.name,
    ...(campaign.ads ?? []).flatMap((a) => [
      ...(a.headlines ?? []),
      ...(a.descriptions ?? []),
    ]),
  ]
    .join(' ')
    .toLowerCase();

  const hay = `${landingHay} ${copyHay}`;

  if (landingHay.includes(needle) || copyHay.includes(needle)) return true;
  if (!tokens.length) return false;

  const landingHits = tokens.filter((t) => landingHay.includes(t)).length;
  if (landingHits >= Math.min(tokens.length, Math.max(1, Math.ceil(tokens.length * 0.5)))) {
    return true;
  }

  const hits = tokens.filter((t) => hay.includes(t)).length;
  return hits >= Math.min(tokens.length, Math.max(1, Math.ceil(tokens.length * 0.6)));
}
