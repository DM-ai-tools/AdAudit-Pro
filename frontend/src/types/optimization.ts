export type OptimizationMode = 'conservative' | 'balanced' | 'aggressive';

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

export interface CompetitiveOutperformance {
  messagingImprovements: string;
  keywordImprovements: string;
  trustSignalImprovements?: string;
  offerImprovements: string;
  conversionImprovements: string;
  ctaImprovements?: string;
  competitorStrategiesUsed?: string;
  competitorGapsExploited?: string;
}

export interface InfluencingCompetitor {
  name: string;
  influencePercent: number;
  reason: string;
}

export interface AdGenerationExplanation {
  competitorSignalsUsed: string[];
  topCompetitorsInfluencing: InfluencingCompetitor[];
  offersUsed: string[];
  trustSignalsUsed: string[];
  keywordsUsed: string[];
  reviewInsightsUsed: string[];
  socialAuthorityInsightsUsed: string[];
  marketPositioningUsed: string[];
  adDifferenceScore?: number;
}

export interface CompetitorBrandReview {
  score: number;
  summary: string;
  detailedReview: string;
  adActivityReview: string;
  messagingReview: string;
  trustReview: string;
  offerReview: string;
  howToBeat: string[];
  strengths: string[];
  weaknesses: string[];
  averageRating?: number;
  reviewCount?: number;
  trustScore?: number;
  sentiment?: 'Highly Positive' | 'Positive' | 'Mixed' | 'Negative' | 'Unknown';
  positiveThemes?: string[];
  negativeThemes?: string[];
  reviewVelocity?: string;
}

export interface CompetitorSocialPresence {
  brandAuthorityScore: number;
  employeeCount?: number;
  employeeCountEstimated?: boolean;
  linkedInFollowers?: number;
  facebookFollowers?: number;
  instagramFollowers?: number;
  youtubeSubscribers?: number;
  tiktokFollowers?: number;
  twitterFollowers?: number;
  totalSocialReach?: number;
  socialPresenceScore?: number;
  profileUrls?: {
    linkedin?: string;
    facebook?: string;
    instagram?: string;
    youtube?: string;
    tiktok?: string;
    twitter?: string;
  };
  source: 'sociavault_ad_library' | 'sociavault_social_profiles' | 'unavailable';
}

export type MarketPositionLabel =
  | 'Market Leader'
  | 'Established Competitor'
  | 'Growing Competitor'
  | 'Emerging Competitor';

export type CompanySizeLabel = 'Startup' | 'SMB' | 'Mid-Market' | 'Enterprise';
export type CompetitiveThreatLabel = 'Critical' | 'High' | 'Medium' | 'Low';

export interface CompetitorBrandAuthority {
  employeeCount?: number;
  employeeCountEstimated?: boolean;
  companySize: CompanySizeLabel;
  yearsInBusiness?: number;
  yearsInBusinessEstimated?: boolean;
  brandAuthorityScore: number;
  marketPosition: MarketPositionLabel;
  competitiveThreat: CompetitiveThreatLabel;
  brandStrengthScore: number;
  competitiveThreatScore: number;
}

export interface CompetitorAdvertisingStrength {
  adDurationDays: number;
  activeAdCount: number;
  totalAdCount: number;
  advertisingScore: number;
}

export interface CompetitorMarketAuthority {
  domainAuthority?: number;
  organicKeywords?: number;
  monthlyTraffic?: number;
  backlinks?: number;
  marketShare?: number;
  authorityScore: number;
  source: 'sociavault_derived' | 'unavailable';
}

export interface CompetitorOfferTrustAnalysis {
  offersUsed: string[];
  topPromotions: string[];
  uniqueSellingPoints: string[];
  trustSignals: string[];
  trustSignalScore: number;
  socialProofItems: string[];
  socialProofScore: number;
}

export interface CompetitorAiLearning {
  aiLearningValue: number;
  competitorScore: number;
  influencePercent: number;
  breakdown: {
    adDuration: number;
    activeAds: number;
    totalAds: number;
    brandReviews: number;
    trustScore: number;
    employeeCount: number;
    socialPresence: number;
    authorityScore: number;
    marketPosition: number;
  };
}

export interface CompetitiveMarketPatterns {
  topHeadlines: string[];
  topOffers: string[];
  topCtas: string[];
  topKeywords: string[];
  topValuePropositions: string[];
}

export interface CompetitorInsightCard {
  name: string;
  url?: string;
  keyMessages: string[];
  offers: string[];
  keywordOpportunities: string[];
  adDurationDays?: number;
  activeAdCount?: number;
  totalAdCount?: number;
  firstShown?: string;
  lastShown?: string;
  brandReview?: CompetitorBrandReview;
  confidenceScore?: number;
  influencePercent?: number;
  durationLabel?: string;
  brandAuthorityScore?: number;
  socialPresence?: CompetitorSocialPresence;
  advertiserId?: string;
}

export interface CompetitorAdPreview {
  name: string;
  url: string;
  displayUrl: string;
  displayPaths?: { path1?: string; path2?: string };
  headlines: string[];
  descriptions: string[];
  offers: string[];
  ctas: string[];
  keywordRelevanceScore?: number;
  /** True when headlines were invented from the company name, not Transparency OCR. */
  syntheticCopy?: boolean;
  trustSignals: string[];
  transparencyUrl?: string;
  creativeUrl?: string;
  advertiserName?: string;
  adSource?: 'sociavault' | 'transparency_center' | 'website_fallback';
  adLink?: string;
  previewImageUrl?: string;
  adDurationDays?: number;
  activeAdCount?: number;
  totalAdCount?: number;
  firstShown?: string;
  lastShown?: string;
  brandReview?: CompetitorBrandReview;
  confidenceScore?: number;
  durationClass?: 'new' | 'growing' | 'established' | 'dominant';
  durationLabel?: string;
  influencePercent?: number;
  industryMatch?: number;
  serviceMatch?: number;
  estimatedSuccessScore?: number;
  brandAuthorityScore?: number;
  socialPresence?: CompetitorSocialPresence;
  brandAuthority?: CompetitorBrandAuthority;
  advertisingStrength?: CompetitorAdvertisingStrength;
  marketAuthority?: CompetitorMarketAuthority;
  offerTrustAnalysis?: CompetitorOfferTrustAnalysis;
  aiLearning?: CompetitorAiLearning;
  advertisingScore?: number;
  aiLearningValue?: number;
  marketPosition?: MarketPositionLabel;
  competitiveThreat?: CompetitiveThreatLabel;
  creativeFirstShown?: string;
  creativeLastShown?: string;
  isActive?: boolean;
  cta?: string;
  offer?: string;
  /** Landing / destination URL recovered from SociaVault ad-details */
  destinationUrl?: string;
  advertiserId?: string;
}

export type GapCategory = 'messaging' | 'offers' | 'keywords' | 'trust_signals' | 'ctas';

export interface CompetitorGapRow {
  category: GapCategory;
  competitor: string;
  competitorHas: string;
  youHave: string;
  gap: string;
}

export interface CompetitorGapAnalysis {
  rows: CompetitorGapRow[];
  summary: {
    messagingGaps: number;
    offerGaps: number;
    keywordGaps: number;
    trustSignalGaps: number;
    ctaGaps: number;
  };
}

export interface CompetitorIntelligenceData {
  competitors: Array<{
    name: string;
    url: string;
    fetched: boolean;
    headlines: string[];
    descriptions?: string[];
    offers: string[];
    keyMessages: string[];
    trustSignals?: string[];
    valuePropositions: string[];
    positioning?: string;
    adDurationDays?: number;
    activeAdCount?: number;
    totalAdCount?: number;
    firstShown?: string;
    lastShown?: string;
    brandReview?: CompetitorBrandReview;
    confidenceScore?: number;
    durationClass?: 'new' | 'growing' | 'established' | 'dominant';
    durationLabel?: string;
    influencePercent?: number;
    industryMatch?: number;
    serviceMatch?: number;
    brandAuthorityScore?: number;
    socialPresence?: CompetitorSocialPresence;
    brandAuthority?: CompetitorBrandAuthority;
    advertisingStrength?: CompetitorAdvertisingStrength;
    marketAuthority?: CompetitorMarketAuthority;
    offerTrustAnalysis?: CompetitorOfferTrustAnalysis;
    aiLearning?: CompetitorAiLearning;
    advertisingScore?: number;
    aiLearningValue?: number;
    marketPosition?: MarketPositionLabel;
    competitiveThreat?: CompetitiveThreatLabel;
    advertiserId?: string;
  }>;
  insights: CompetitorInsightCard[];
  adGallery: CompetitorAdPreview[];
  gapAnalysis: CompetitorGapAnalysis;
  keywordOpportunities: string[];
  messagingOpportunities: string[];
  missingOffers: string[];
  missingFromYourAds: string[];
  influenceWeights?: Array<{
    name: string;
    score: number;
    aiLearningValue?: number;
    influencePercent: number;
  }>;
  marketPatterns?: CompetitiveMarketPatterns;
  source: string;
  discoveryWarning?: string;
}

export interface StrategistReasoning {
  headlineChanges: string;
  descriptionChanges: string;
  keywordRelevance: string;
  qualityScore: string;
  conversionPotential: string;
  auditFindingsAddressed: string[];
  competitorInsightsUsed: string[];
  competitiveOutperformance?: CompetitiveOutperformance;
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
  competitorInsights?: CompetitorInsightCard[];
  missingCompetitorAdvantages?: string[];
  adGenerationExplanation?: AdGenerationExplanation;
  adDifferenceScore?: number;
  keywordImprovements?: string[];
  negativeKeywordSuggestions?: string[];
  landingPageRecommendations?: string[];
  variationLabel?: string;
  focusedCompetitor?: string;
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
  competitorAnalysis?: CompetitorIntelligenceData | null;
  /** Additional RSAs, each focused on beating a specific competitor from Make It Better */
  optimizedVariations?: OptimizedAdContent[];
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
