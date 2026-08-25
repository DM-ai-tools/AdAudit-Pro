export type AuditDepth = 'quick' | 'standard' | 'deep';
export type AuditWindow = 30 | 90 | 365;

export interface GoogleProfile {
  name: string;
  email: string;
  avatarUrl?: string;
}

export interface GoogleAdsAccount {
  id: string;
  customerId: string;
  name: string;
  currency: string;
  timezone: string;
  accountType: string;
  monthlySpend: number;
  websiteUrl?: string;
  industry?: string;
  selectable?: boolean;
  parentManagerId?: string;
  managerName?: string;
}

export interface GoogleAdsCampaignAd {
  id: string;
  resourceName: string;
  adGroupName: string;
  adType: string;
  status: string;
  adStrength?: string;
  headlines: string[];
  descriptions: string[];
  finalUrls: string[];
  displayPath1?: string;
  displayPath2?: string;
  impressions: number;
  clicks: number;
  conversions: number;
  ctr: number;
  cost: number;
  avgCpc: number;
}

export interface GoogleAdsCampaign {
  id: string;
  resourceName: string;
  name: string;
  type: string;
  status: string;
  budgetDaily: number;
  biddingStrategyType?: string;
  impressions: number;
  clicks: number;
  conversions: number;
  ctr: number;
  avgCpc: number;
  conversionRate: number;
  costPerConversion: number;
  cost: number;
  adCount: number;
  metricsWindowDays: number;
  ads: GoogleAdsCampaignAd[];
}

export interface AccountPerformanceSummary {
  currency: string;
  timezone: string;
  windowDays: number;
  dateRange: string;
  clicks: number;
  impressions: number;
  conversions: number;
  cost: number;
  ctr: number;
  avgCpc: number;
  conversionRate: number;
  costPerConversion: number;
  activeCampaigns: number;
}

export interface BudgetCampaignRow {
  campaignId: string;
  name: string;
  type: string;
  status: string;
  biddingStrategyType?: string;
  dailyBudget: number;
  periodBudget: number;
  spend: number;
  spendShare: number;
  budgetUtilization: number;
  leftover: number;
  impressions: number;
  clicks: number;
  conversions: number;
  ctr: number;
  avgCpc: number;
  conversionRate: number;
  costPerConversion: number;
  searchImpressionShare?: number;
  budgetLostIs?: number;
  rankLostIs?: number;
}

export interface BudgetAdRow {
  adId: string;
  campaignId: string;
  campaignName: string;
  adGroupName: string;
  status: string;
  headline: string;
  spend: number;
  spendShare: number;
  impressions: number;
  clicks: number;
  conversions: number;
  ctr: number;
  avgCpc: number;
  costPerConversion: number;
}

export interface BudgetKeywordRow {
  campaignId: string;
  campaignName: string;
  adGroupName: string;
  keyword: string;
  matchType: string;
  qualityScore?: number;
  spend: number;
  spendShare: number;
  impressions: number;
  clicks: number;
  conversions: number;
  ctr: number;
  avgCpc: number;
  costPerConversion: number;
}

export interface BudgetDailyRow {
  date: string;
  spend: number;
  clicks: number;
  conversions: number;
  impressions: number;
}

export interface BudgetAccountSummary {
  currency: string;
  timezone: string;
  windowDays: number;
  dateRange: string;
  totalSpend: number;
  totalDailyBudget: number;
  enabledDailyBudget: number;
  expectedSpend: number;
  pacePercent: number;
  leftover: number;
  clicks: number;
  impressions: number;
  conversions: number;
  ctr: number;
  avgCpc: number;
  conversionRate: number;
  costPerConversion: number;
  activeCampaigns: number;
  constrainedCampaigns: number;
  underspentCampaigns: number;
}

export interface AccountBudgetBreakdown {
  account: BudgetAccountSummary;
  campaigns: BudgetCampaignRow[];
  ads: BudgetAdRow[];
  keywords: BudgetKeywordRow[];
  daily: BudgetDailyRow[];
}

export interface BudgetRecommendationAction {
  priority: 'critical' | 'high' | 'medium';
  title: string;
  detail: string;
  moveFrom?: string;
  moveTo?: string;
  amount?: number;
  expectedImpact?: string;
}

export interface BudgetReallocationRow {
  entityType: 'campaign' | 'keyword' | 'ad';
  name: string;
  currentDaily: number;
  recommendedDaily: number;
  rationale: string;
}

export interface BudgetRecommendations {
  summary: string;
  actions: BudgetRecommendationAction[];
  reallocation: BudgetReallocationRow[];
}

export interface AuditModuleOption {
  id: string;
  name: string;
  description: string;
  icon: string;
  enabled: boolean;
  available?: boolean;
  reason?: string;
}

export interface ReportOptions {
  generatePdf: boolean;
  includeAiRecommendations: boolean;
  emailWhenComplete: boolean;
  includeLandingPageAnalysis: boolean;
}

export interface ConnectFormData {
  website: string;
  spend: string;
  goal: string;
  name: string;
  email: string;
}

export interface StartAuditPayload {
  googleAdsCustomerId: string;
  auditDepth: AuditDepth;
  auditWindow: AuditWindow;
  selectedModules: string[];
  competitors: string[];
  reportOptions: ReportOptions;
  accountName?: string;
  monthlySpend?: number;
  websiteUrl?: string;
  email?: string;
  name?: string;
  goal?: string;
  campaignCount?: number;
  selectedCampaignIds?: string[];
}

export interface AuditDepthOption {
  id: AuditDepth;
  title: string;
  description: string;
  modules: number;
  estimatedMinutes: number;
}

export interface AccountAuditStats {
  activeCampaigns: number;
  campaignTypes: string[];
  spend30Days: number;
  spend90Days: number;
  spend365Days: number;
  conversionActions: number;
  landingPageCount: number;
}

export interface AccountAuditConfigResponse {
  account: GoogleAdsAccount;
  source: 'google_ads_api' | 'mock';
  recommendedDepth: AuditDepth;
  recommendedWindow: AuditWindow;
  modules: AuditModuleOption[];
  whatWeAnalyze: string[];
  stats: AccountAuditStats;
  depthOptions: AuditDepthOption[];
  windowOptions: { value: AuditWindow; label: string }[];
}
