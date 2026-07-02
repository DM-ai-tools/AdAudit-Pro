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

export interface PerformanceMetrics {
  ctr?: string;
  qualityScore?: string;
  conversionRate?: string;
  cpa?: string;
  roas?: string;
  monthlyLeads?: string;
  monthlySavings?: string;
}

export interface PerformanceEstimates {
  label: string;
  current: PerformanceMetrics;
  estimated: PerformanceMetrics;
}

export interface StrategistReasoning {
  headlineChanges: string;
  descriptionChanges: string;
  keywordRelevance: string;
  qualityScore: string;
  conversionPotential: string;
  auditFindingsAddressed: string[];
  competitorInsightsUsed: string[];
}

export interface AccountImpact {
  currentAccountHealth?: number;
  predictedAccountHealth?: number;
  currentMonthlyLeads?: string;
  estimatedMonthlyLeads?: string;
  currentWastedSpend?: string;
  estimatedWastedSpend?: string;
  currentRoas?: string;
  estimatedRoas?: string;
}

export interface AnalysisSources {
  campaignData: boolean;
  auditFindings: boolean;
  websiteAnalysis: boolean;
  competitorAnalysis: boolean;
  keywordAnalysis: boolean;
  searchTerms: boolean;
  landingPageAnalysis: boolean;
}

export interface StrategistRecommendations {
  keywords: string[];
  negativeKeywords: string[];
  extensions: string[];
  landingPage: string[];
  budget: string[];
  bidding: string[];
  audience: string[];
}

export interface CampaignPerformanceSummary {
  campaignId?: string;
  campaignName?: string;
  impressions: number;
  clicks: number;
  ctr: number;
  avgCpc: number;
  conversions: number;
  conversionRate: number;
  costPerConversion: number;
  cost: number;
  avgQualityScore?: number;
  biddingStrategy?: string;
  budgetDaily?: number;
  status?: string;
  campaignType?: string;
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
  performanceEstimates?: PerformanceEstimates;
  campaignHealth?: { currentScore: number; predictedScore: number; explanation: string };
  accountImpact?: AccountImpact;
  strategistReasoning?: StrategistReasoning;
  strategistRecommendations?: StrategistRecommendations;
  keywordImprovements?: string[];
  negativeKeywordSuggestions?: string[];
  landingPageRecommendations?: string[];
}

export interface IntelligenceSummary {
  findingsAnalyzed: number;
  campaignsLoaded: number;
  keywordsLoaded: number;
  searchTermsLoaded: number;
  adsFound: number;
  devicesLoaded?: number;
  audiencesLoaded?: number;
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
  analysisSources?: AnalysisSources;
  campaignPerformance?: CampaignPerformanceSummary | null;
  auditHealthScore?: number;
}

export type PublishStepStatus = 'pending' | 'running' | 'complete' | 'failed' | 'skipped';

export interface PublishStep {
  id: string;
  label: string;
  status: PublishStepStatus;
}

export interface PublishAdResponse {
  publishedId: string;
  status: 'PUBLISHED' | 'SIMULATED' | 'FAILED';
  message: string;
  resourceName?: string;
  rollbackAvailable?: boolean;
  scenario?: string;
  campaignName?: string;
  accountName?: string;
  publishedAt?: string;
  versionSaved?: boolean;
  steps?: PublishStep[];
}

export interface PublishStatusResponse {
  publishedId: string;
  status: string;
  steps: PublishStep[];
  message?: string;
  campaignName?: string;
  accountName?: string;
  publishedAt?: string;
  rollbackAvailable: boolean;
  rolledBackAt?: string;
  errorMessage?: string;
}

export interface RollbackAdResponse {
  success: boolean;
  message: string;
}

export type PreviewDevice = 'mobile' | 'desktop';
