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

export interface GoogleAdsCampaign {
  id: string;
  resourceName: string;
  name: string;
  type: string;
  status: string;
  budgetDaily: number;
  impressions: number;
  clicks: number;
  conversions: number;
  ctr: number;
  cost: number;
  adCount: number;
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
  websiteUrl?: string;
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
