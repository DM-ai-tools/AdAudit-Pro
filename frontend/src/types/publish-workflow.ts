/** Mirrors backend CampaignPublishContextDto */
export interface CampaignPublishContext {
  source: 'google_ads_api' | 'mock' | 'unavailable';
  currency: string;
  windowDays: number;
  oauth: {
    googleAdsConfigured: boolean;
    hasRefreshToken: boolean;
  };
  campaign: {
    id: string;
    name: string;
    status: string;
    channelType?: string;
  };
  budget: {
    dailyBudget?: number;
    periodSpend?: number;
    utilizationPercent?: number;
  };
  bidding: {
    strategyType?: string;
    targetCpa?: number;
    targetRoas?: number;
  };
  locations: Array<{ name: string; excluded?: boolean }>;
  keywords: Array<{ text: string; matchType?: string; adGroupName?: string }>;
  campaignNegativeKeywords: Array<{ text: string; matchType?: string }>;
  conversions: Array<{ name: string; type?: string; status?: string; category?: string }>;
  devices: Array<{
    device: string;
    impressions: number;
    clicks: number;
    conversions: number;
    ctr: number;
    cost: number;
    conversionSharePercent?: number;
  }>;
  adSchedule: Array<{ day?: string; startHour?: number; endHour?: number }>;
  networks: {
    targetGoogleSearch?: boolean;
    targetSearchNetwork?: boolean;
    targetContentNetwork?: boolean;
  };
  tracking: {
    healthy: boolean;
    warnings: string[];
    enabledConversionCount: number;
  };
  connection: {
    customerId: string;
    accountName?: string;
  };
  errors?: string[];
}

export type ApprovalLineState =
  | 'current'
  | 'ai_recommendation'
  | 'client_edited'
  | 'client_approved'
  | 'ready'
  | 'published'
  | 'failed';

export interface AiNegativeKeywordRow {
  keyword: string;
  reason: string;
  approved: boolean;
}
