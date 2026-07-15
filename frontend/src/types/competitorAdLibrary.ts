export type CompetitorCampaignTypeKey =
  | 'search'
  | 'display'
  | 'shopping'
  | 'video'
  | 'performance_max'
  | 'demand_gen'
  | 'app'
  | 'local_services';

export interface CompetitorLibraryAd {
  competitorName: string;
  competitorUrl: string;
  confidenceScore: number;
  adDurationDays: number;
  activeAdCount: number;
  totalAdCount: number;
  brandRating?: number;
  trustScore?: number;
  headlines: string[];
  descriptions: string[];
  offer?: string;
  cta?: string;
  firstSeen?: string;
  lastSeen?: string;
  displayUrl: string;
  previewImageUrl?: string;
  creativeUrl?: string;
  transparencyUrl?: string;
  format?: string;
  campaignType: CompetitorCampaignTypeKey;
  source: 'Google Ads Transparency Center';
  estimatedSuccessScore?: number;
}

export interface CampaignTypeInsights {
  topCompetitors: string[];
  mostActiveCompetitors: string[];
  longestRunningCompetitors: string[];
  mostTrustedCompetitors: string[];
  mostConsistentAdvertisers: string[];
}

export interface CampaignOpportunity {
  campaignType: CompetitorCampaignTypeKey;
  label: string;
  competitorAdoption: number;
  yourUsage: number;
  opportunity: 'High' | 'Medium' | 'Low' | 'None';
  reason: string;
}

export interface CampaignRecommendation {
  campaignType: CompetitorCampaignTypeKey;
  label: string;
  priority: 'High' | 'Medium' | 'Low';
  competitorAdoption: number;
  reason: string;
  expectedBenefits: string[];
  suggestedActions: string[];
}

export interface CompetitorAdLibraryAiInsights {
  whatCompetitorsDoDifferently: string;
  campaignTypePriorities: string;
  messaging: string;
  offers: string;
  trustSignals: string;
  campaignOpportunities: string;
}

export interface CompetitorAdLibraryReport {
  overview: {
    competitorsAnalyzed: number;
    totalCompetitorAds: number;
    activeCompetitorAds: number;
    averageAdDuration: number;
    averageConfidenceScore: number;
  };
  source: string;
  ads: CompetitorLibraryAd[];
  byCampaignType: Record<
    CompetitorCampaignTypeKey,
    {
      label: string;
      tabLabel: string;
      adCount: number;
      ads: CompetitorLibraryAd[];
      insights: CampaignTypeInsights;
    }
  >;
  opportunities: CampaignOpportunity[];
  recommendations: CampaignRecommendation[];
  aiInsights: CompetitorAdLibraryAiInsights | null;
  accountCampaignTypes: CompetitorCampaignTypeKey[];
  disclaimer: string;
}

export const COMPETITOR_CAMPAIGN_TAB_ORDER: CompetitorCampaignTypeKey[] = [
  'search',
  'display',
  'shopping',
  'video',
  'performance_max',
  'demand_gen',
  'app',
  'local_services',
];
