export type OptimizationTone =
  | 'default'
  | 'professional'
  | 'luxury'
  | 'high-conversion'
  | 'aggressive'
  | 'shorter';

export type OptimizationVariation =
  | 'regenerate'
  | 'shorter'
  | 'more-variations'
  | 'aggressive-cta';

export type OptimizationScenario = 'REPLACE_EXISTING' | 'CREATE_ADS' | 'CREATE_STRATEGY';

export interface CurrentAdData {
  headlines: string[];
  longHeadlines?: string[];
  descriptions: string[];
  cta?: string;
  keywords?: string[];
  displayPath1?: string;
  displayPath2?: string;
  qualityScore?: number;
  ctr?: number;
  conversions?: number;
  adStrength?: string;
  adGroupAdResourceName?: string;
  campaignId?: string;
  adGroupId?: string;
  campaignName?: string;
  adGroupName?: string;
  finalUrls?: string[];
}

export interface OptimizedAdContent {
  campaignId?: string;
  adGroupId?: string;
  headlines: string[];
  longHeadlines?: string[];
  descriptions: string[];
  ctaSuggestions: string[];
  keywordSuggestions: string[];
  displayPaths?: { path1?: string; path2?: string };
  adExtensions?: {
    sitelinks?: string[];
    callouts?: string[];
    structuredSnippets?: string[];
  };
  campaignStrategy?: {
    campaignName?: string;
    campaignType?: string;
    dailyBudget?: number;
    adGroups?: Array<{ name: string; keywords: string[] }>;
    negativeKeywords?: string[];
    competitorInsights?: string[];
  };
  improvementReasoning: string;
  predictedImpact: {
    ctrIncrease: string;
    qualityScoreIncrease: string;
    conversionImprovement: string;
  };
}

export interface IntelligenceSummary {
  findingsAnalyzed: number;
  campaignsLoaded: number;
  keywordsLoaded: number;
  searchTermsLoaded: number;
  adsFound: number;
}

export interface OptimizeAdResponse {
  optimizationId: string;
  scenario: OptimizationScenario;
  dataSource: 'live' | 'audit_only';
  originalAd: CurrentAdData;
  optimized: OptimizedAdContent;
  finding: {
    id: string;
    title: string;
    category: string;
    dimension: string;
  };
  intelligenceSummary: IntelligenceSummary;
}

export interface PublishAdResponse {
  publishedId: string;
  status: 'PUBLISHED' | 'SIMULATED' | 'FAILED';
  message: string;
  resourceName?: string;
  rollbackAvailable?: boolean;
  scenario?: string;
}

export interface RollbackAdResponse {
  success: boolean;
  message: string;
}

export type PreviewDevice = 'mobile' | 'desktop';
