export type AdCopySnapshot = {
  headlines: string[];
  descriptions: string[];
  longHeadlines?: string[];
  displayPaths?: { path1?: string; path2?: string };
  finalUrl?: string;
  finalUrls?: string[];
  status?: string;
  campaignName?: string;
  adGroupName?: string;
};

export type LiveAdMetrics = {
  impressions: number;
  clicks: number;
  conversions: number;
  ctr: number;
  cost: number;
  avgCpc: number;
  status?: string;
  adStrength?: string;
};

export type PublishedAdHistoryItem = {
  id: string;
  status: string;
  publishedAt: string | null;
  createdAt: string;
  googleAdsCustomerId: string;
  campaignId: string | null;
  campaignName?: string;
  accountName?: string;
  scenario?: string | null;
  rollbackAvailable: boolean;
  rolledBackAt?: string | null;
  errorMessage?: string | null;
  newAdResourceName?: string | null;
  previousAdResourceName?: string | null;
  originalAd: AdCopySnapshot;
  publishedAd: AdCopySnapshot;
  previousLiveMetrics: LiveAdMetrics | null;
  liveMetrics: LiveAdMetrics | null;
  source: 'make_it_better' | 'manual_edit';
};
