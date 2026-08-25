import axios from 'axios';
import type { AuditRun, Finding, HealthScore, User, SharedReport, AuditLog, AuditSummary } from '../types';
import { getApiBaseUrl, getApiOrigin } from './api-base';

const api = axios.create({
  baseURL: getApiBaseUrl(),
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export const LAST_GOOGLE_EMAIL_KEY = 'lastGoogleEmail';

export const authApi = {
  login: (email: string, name?: string) =>
    api.post<{ token: string; user: User }>('/auth/login', { email, name }),
  me: () => api.get<{
    user: User;
    hasGoogleAdsAccess: boolean;
    isReturningUser: boolean;
    sessionValid?: boolean;
    authenticated?: boolean;
  }>('/auth/me'),
  session: () => api.get<{ authenticated: boolean; hasGoogleAdsAccess: boolean; isReturningUser: boolean; user: User }>('/auth/session'),
  logout: () => api.post('/auth/logout'),
  /** DB-first check before OAuth — instant login when refresh token exists in PostgreSQL. */
  checkUser: (email?: string) =>
    api.post<{
      success: boolean;
      existingUser: boolean;
      requiresOAuth: boolean;
      reason?: string;
      token?: string;
      user?: User;
      accounts?: import('../types/connect').GoogleAdsAccount[];
      accountsSource?: 'google_ads_api' | 'mock';
      accountsReason?: string;
      accountsErrorDetail?: string;
    }>('/auth/check-user', email ? { email } : {}),
  config: () => api.get<{
    googleOAuth: boolean;
    googleAds: boolean;
    anthropic: boolean;
    mockData: boolean;
    redirectUri?: string;
    oauthApiBase?: string;
  }>('/auth/config'),
  oauthSetup: () => api.get<{
    redirectUri: string;
    consentScreenUrl?: string;
    googleAdsConfigured: boolean;
    instructions: {
      howItWorks?: { title: string; points: string[] };
      publishApp?: { title: string; steps: string[] };
      redirectUris?: string[];
    };
  }>('/auth/oauth-setup'),
  silentConnect: () =>
    api.post<{
      user: User;
      hasGoogleAdsAccess: boolean;
      isReturningUser: boolean;
      verified: boolean;
    }>('/auth/google/silent-connect'),
  googleUrl: (
    returnTo = '/login',
    ads = false,
    options: {
      consent?: boolean;
      reconnect?: boolean;
      selectAccount?: boolean;
      apiBase?: string;
      sessionToken?: string | null;
      loginHint?: string | null;
    } = {}
  ) => {
    const { consent = false, reconnect = false, selectAccount = false, apiBase = '', sessionToken, loginHint } = options;
    const params = new URLSearchParams({ returnTo });
    if (ads) params.set('ads', 'true');
    if (consent) params.set('consent', 'true');
    if (reconnect) params.set('reconnect', 'true');
    if (selectAccount) params.set('select_account', 'true');
    if (sessionToken) params.set('session', sessionToken);
    if (loginHint) params.set('login_hint', loginHint);
    const path = `/api/auth/google?${params.toString()}`;
    const base = (apiBase || getApiOrigin()).replace(/\/$/, '');
    return base ? `${base}${path}` : path;
  },
};

export const auditApi = {
  startDemo: (data: Record<string, unknown>) =>
    api.post<{ audit: AuditRun; auditId: string }>('/audit/start-demo', data),
  start: (data: Record<string, unknown>) =>
    api.post<{ audit: AuditRun }>('/audit/start', data),
  list: () => api.get<{ audits: AuditSummary[]; userEmail: string }>('/audit/list'),
  startCampaign: (data: { parentAuditId: string; campaignId: string; campaignName: string }) =>
    api.post<{ audit: AuditRun; auditId: string }>('/audit/start-campaign', data),
  status: (id: string) => api.get<{ audit: AuditRun }>(`/audit/status/${id}`),
  findings: (id: string) => api.get<{ findings: Finding[] }>(`/audit/findings/${id}`),
  report: (id: string) => api.get<{ audit: AuditRun }>(`/audit/report/${id}`),
  competitorAdLibrary: (id: string) =>
    api.get<{ report: import('../types/competitorAdLibrary').CompetitorAdLibraryReport }>(
      `/audit/${id}/competitor-ad-library`
    ),
  companyServices: (id: string) =>
    api.get<{ services: string[]; websiteUrl: string | null; source: string }>(
      `/audit/${id}/company-services`
    ),
  logs: (id: string) => api.get<{ logs: AuditLog[] }>(`/audit/logs/${id}`),
  health: (id: string) =>
    api.get<{
      overallScore: number;
      scores: HealthScore[];
      totalImpact: number;
      criticalCount: number;
      annualOpportunity?: number;
      totalFindings?: number;
    }>(`/audit/health/${id}`),
  share: (auditRunId: string) =>
    api.post<{ report: SharedReport; url: string }>('/audit/share', { auditRunId }),
  shareDemo: (auditRunId: string) =>
    api.post<{ report: SharedReport; url: string }>('/audit/share-demo', { auditRunId }),
  backfillModules: (auditRunId: string) =>
    api.post<{ added: number; slugs: string[]; audit: AuditRun }>(`/audit/${auditRunId}/backfill-modules`),
  backfillModulesDemo: (auditRunId: string) =>
    api.post<{ added: number; slugs: string[]; audit: AuditRun }>(`/audit/${auditRunId}/backfill-demo`),
  shared: (token: string) =>
    api.get<{ report: SharedReport; audit: AuditRun }>(`/audit/shared/${token}`),
  pdfUrl: (id: string) => {
    const origin = getApiOrigin();
    return origin ? `${origin}/api/audit/pdf/${id}` : `/api/audit/pdf/${id}`;
  },
  downloadPdf: async (id: string, accountName?: string) => {
    const res = await api.get(`/audit/pdf/${id}`, {
      responseType: 'blob',
      timeout: 90_000,
      params: { download: '1' },
    });
    const contentType = String(res.headers['content-type'] || '');
    if (contentType.includes('application/json')) {
      const text = await (res.data as Blob).text();
      let message = 'Could not generate report';
      try {
        message = JSON.parse(text).error || message;
      } catch {
        /* ignore */
      }
      throw new Error(message);
    }

    const blob = res.data as Blob;
    const isPdf = contentType.includes('pdf') || blob.type.includes('pdf');
    const safeName = (accountName || id).replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-') || 'report';
    const filename = `adaudit-${safeName}.${isPdf ? 'pdf' : 'html'}`;
    const url = window.URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.rel = 'noopener noreferrer';
    document.body.appendChild(link);
    link.click();
    link.remove();

    // Also open HTML reports in a new tab for Print / Save as PDF
    if (!isPdf) {
      window.open(url, '_blank', 'noopener,noreferrer');
    }

    window.setTimeout(() => window.URL.revokeObjectURL(url), 120_000);
    return { isPdf, filename };
  },
};

export const googleAdsApi = {
  accounts: () =>
    api.get<{
      accounts: import('../types/connect').GoogleAdsAccount[];
      selectableAccounts?: import('../types/connect').GoogleAdsAccount[];
      managerAccounts?: import('../types/connect').GoogleAdsAccount[];
      source: 'google_ads_api' | 'mock';
      reason: string;
      errorMessage?: string;
      googleAdsConfigured: boolean;
      hasRefreshToken: boolean;
    }>('/google-ads/accounts'),
  campaigns: (customerId: string, windowDays = 30) =>
    api.get<{
      account: {
        customerId: string;
        name: string;
        websiteUrl?: string;
        industry?: string;
        currency: string;
        timezone?: string;
        requiresEuPoliticalAdvertising?: boolean;
      };
      campaigns: import('../types/connect').GoogleAdsCampaign[];
      performance: import('../types/connect').AccountPerformanceSummary | null;
      metricsWindowDays: number;
      source: 'google_ads_api' | 'mock';
      hasCampaigns: boolean;
      hasAds: boolean;
    }>(`/google-ads/accounts/${encodeURIComponent(customerId)}/campaigns`, {
      params: { window: windowDays },
    }),
  performance: (customerId: string, windowDays = 30) =>
    api.get<{
      account: { customerId: string; name: string; currency: string };
      performance: import('../types/connect').AccountPerformanceSummary;
      source: 'google_ads_api' | 'mock';
    }>(`/google-ads/accounts/${encodeURIComponent(customerId)}/performance`, {
      params: { window: windowDays },
    }),
  budgetIntelligence: (customerId: string, windowDays = 30) =>
    api.get<{
      account: { customerId: string; name: string; currency: string; timezone?: string };
      breakdown: import('../types/connect').AccountBudgetBreakdown;
      recommendations: import('../types/connect').BudgetRecommendations;
      source: 'google_ads_api' | 'mock';
    }>(`/google-ads/accounts/${encodeURIComponent(customerId)}/budget-intelligence`, {
      params: { window: windowDays },
      timeout: 90_000,
    }),
  status: () =>
    api.get<{ googleAdsConfigured: boolean; hasRefreshToken: boolean; managerAccountId: string | null }>(
      '/google-ads/status'
    ),
  auditConfig: (customerId: string) =>
    api.get<import('../types/connect').AccountAuditConfigResponse>(
      `/google-ads/accounts/${encodeURIComponent(customerId)}/audit-config`
    ),
  publishAd: (payload: {
    optimizationId: string;
    googleAdsCustomerId: string;
    adGroupAdResourceName?: string;
    /** Default false — create new ad and keep existing active */
    pauseExistingAd?: boolean;
    content: {
      headlines: string[];
      descriptions: string[];
      longHeadlines?: string[];
      displayPaths?: { path1?: string; path2?: string };
      finalUrl?: string;
    };
  }) => api.post<import('../types/optimization').PublishAdResponse>('/google-ads/publish-ad', payload),
  rollbackAd: (publishedId: string) =>
    api.post<import('../types/optimization').RollbackAdResponse>('/google-ads/rollback-ad', { publishedId }),
  publishStatus: (publishedId: string) =>
    api.get<import('../types/optimization').PublishStatusResponse>(`/google-ads/publish-status/${publishedId}`),
  publishedVersions: (params: {
    customerId?: string;
    campaignId?: string;
    windowDays?: number;
    limit?: number;
  } = {}) =>
    api.get<{
      versions: import('../types/published-ads').PublishedAdHistoryItem[];
      currency: string;
      metricsWindowDays: number;
    }>('/google-ads/published-versions', {
      params: {
        customerId: params.customerId,
        campaignId: params.campaignId,
        window: params.windowDays,
        limit: params.limit,
      },
    }),
  updateAd: (payload: {
    auditRunId: string;
    googleAdsCustomerId: string;
    campaignId: string;
    campaignName?: string;
    campaignResourceName: string;
    adGroupId?: string;
    adGroupName?: string;
    adGroupAdResourceName?: string;
    originalAd: {
      headlines: string[];
      descriptions: string[];
      finalUrls?: string[];
      displayPath1?: string;
      displayPath2?: string;
    };
    content: {
      headlines: string[];
      descriptions: string[];
      displayPaths?: { path1?: string; path2?: string };
      finalUrl: string;
    };
  }) =>
    api.post<import('../types/optimization').PublishAdResponse>('/google-ads/update-ad', payload),
  adPreview: (optimizationId: string, device: 'mobile' | 'desktop' = 'mobile', variant: 'original' | 'optimized' = 'optimized') =>
    api.get(`/google-ads/ad-preview/${optimizationId}?device=${device}&variant=${variant}`),
  campaignPublishContext: (customerId: string, campaignId: string, windowDays = 30) =>
    api.get<{
      context: import('../types/publish-workflow').CampaignPublishContext;
      source: 'google_ads_api' | 'mock';
    }>(
      `/google-ads/accounts/${encodeURIComponent(customerId)}/campaigns/${encodeURIComponent(campaignId)}/publish-context`,
      { params: { window: windowDays } }
    ),
  createCampaign: (payload: {
    googleAdsCustomerId: string;
    campaignName: string;
    dailyBudget: number;
    biddingStrategy: 'MANUAL_CPC' | 'MAXIMIZE_CLICKS' | 'MAXIMIZE_CONVERSIONS';
    campaignType: string;
    targetGoogleSearch: boolean;
    targetSearchNetwork: boolean;
    targetContentNetwork: boolean;
    containsEuPoliticalAdvertising: boolean;
    targetLocations?: string;
    clientApprovals: Record<string, boolean>;
    cpcBidCeiling?: number;
    auditRunId?: string;
    wizardProcess?: Record<string, unknown>;
  }) =>
    api.post<{
      success: boolean;
      status: 'CREATED' | 'FAILED';
      message: string;
      error?: string;
      campaignResourceName?: string;
      campaignName?: string;
      advertisingChannelType?: string;
      campaignType?: string;
      supportsAutomatedAds?: boolean;
    }>('/google-ads/create-campaign', payload),
  updateCampaignBidding: (payload: {
    googleAdsCustomerId: string;
    campaignResourceName: string;
    biddingStrategy: 'MANUAL_CPC' | 'MAXIMIZE_CONVERSIONS';
    clientApprovals: { authorizeBiddingSwitch: boolean };
  }) =>
    api.post<{
      success: boolean;
      status: 'UPDATED' | 'FAILED';
      message: string;
      error?: string;
    }>('/google-ads/update-campaign-bidding', payload),
  updateCampaignBudget: (payload: {
    googleAdsCustomerId: string;
    campaignResourceName: string;
    dailyBudget: number;
    clientApprovals: { authorizeBudgetChange: boolean };
  }) =>
    api.post<{
      success: boolean;
      status: 'UPDATED' | 'FAILED';
      message: string;
      error?: string;
    }>('/google-ads/update-campaign-budget', payload),
  keywordMetrics: (
    customerId: string,
    payload: {
      keywords: string[];
      country?: string;
      location?: string;
      websiteUrl?: string;
      windowDays?: number;
    }
  ) =>
    api.post<{
      metrics: Array<{
        keyword: string;
        accountAvgCpc?: number;
        accountMaxCpc?: number;
        accountImpressions?: number;
        accountClicks?: number;
        accountConversions?: number;
        qualityScore?: number;
        plannerAvgCpc?: number;
        plannerLowBid?: number;
        plannerHighBid?: number;
        plannerMonthlySearches?: number;
      }>;
      currency: string;
      plannerAvailable: boolean;
      source: 'google_ads_api';
    }>(`/google-ads/accounts/${encodeURIComponent(customerId)}/keyword-metrics`, payload, {
      timeout: 60_000,
    }),
  createAdInCampaign: (payload: {
    googleAdsCustomerId: string;
    campaignResourceName: string;
    adGroupName?: string;
    keywords?: string[];
    keywordMatchType?: 'BROAD' | 'PHRASE' | 'EXACT';
    keywordBids?: Array<{ keyword: string; matchType?: 'BROAD' | 'PHRASE' | 'EXACT'; cpc?: number }>;
    defaultCpc?: number;
    headlines: string[];
    descriptions: string[];
    finalUrl: string;
    path1?: string;
    path2?: string;
    clientApprovals: Record<string, boolean>;
    negativeKeywords?: string[];
    automatedBidding?: boolean;
    auditRunId?: string;
    campaignName?: string;
    wizardMode?: 'campaign' | 'ad';
    wizardProcess?: Record<string, unknown>;
  }) =>
    api.post<{
      success: boolean;
      status: 'CREATED' | 'FAILED';
      message: string;
      error?: string;
      campaignResourceName?: string;
      adGroupResourceName?: string;
      adResourceName?: string;
      keywordsAdded?: number;
    }>('/google-ads/create-ad-in-campaign', payload),
};

export const aiApi = {
  parseCompetitors: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return api.post<{
      success: boolean;
      filename?: string;
      textPreview?: string;
      competitors: Array<{ name: string; url?: string }>;
      competitorUrls: string[];
      competitorNames: string[];
    }>('/ai/parse-competitors', form, {
      headers: { 'Content-Type': undefined },
      timeout: 90_000,
      transformRequest: [
        (data, headers) => {
          if (data instanceof FormData && headers) {
            delete headers['Content-Type'];
          }
          return data;
        },
      ],
    });
  },
  optimizeAd: async (
    payload: {
      auditId: string;
      findingId: string;
      tone?: import('../types/optimization').OptimizationTone;
      optimizationMode?: import('../types/optimization').OptimizationMode;
      variation?: import('../types/optimization').OptimizationVariation;
      customPrompt?: string;
      regenerateOnly?: boolean;
      findingSnapshot?: import('../types').Finding;
      auditFindingsSnapshot?: import('../types').Finding[];
      accountContext?: {
        accountName?: string;
        goal?: string;
        monthlySpend?: number;
        googleAdsCustomerId?: string;
        websiteUrl?: string;
        userId?: string;
        industry?: string;
        location?: string;
        competitorUrls?: string[];
        competitorNames?: string[];
        competitorEntries?: Array<{ name: string; url?: string }>;
        competitorDiscoveryMode?: 'uploaded_only' | 'auto' | 'both';
        productsServices?: string[];
        /** Ad-level optimization: discover competitors for this service only */
        optimizationScope?: 'campaign' | 'ad';
        primaryService?: string;
        serviceKeywords?: string[];
        campaignId?: string;
        campaignName?: string;
        campaignType?: string;
        campaignStatus?: string;
        biddingStrategyType?: string;
        hasExistingAds?: boolean;
        adCount?: number;
        findingCategory?: string;
        findingTitle?: string;
        primaryAdSnapshot?: {
          headlines?: string[];
          descriptions?: string[];
          finalUrls?: string[];
          displayPath1?: string;
          displayPath2?: string;
          adStrength?: string;
          ctr?: number;
          conversions?: number;
          impressions?: number;
          clicks?: number;
          adGroupName?: string;
          resourceName?: string;
          adId?: string;
        };
        previousOptimizedSnapshot?: {
          headlines?: string[];
          descriptions?: string[];
        };
        campaignMetrics?: {
          impressions?: number;
          clicks?: number;
          ctr?: number;
          avgCpc?: number;
          conversions?: number;
          conversionRate?: number;
          costPerConversion?: number;
          cost?: number;
          budgetDaily?: number;
        };
      };
    },
    options?: {
      onProgress?: (update: {
        progress: number;
        stage: string;
        partial?: Partial<import('../types/optimization').OptimizeAdResponse>;
      }) => void;
    }
  ) => {
    type OptimizeAdResponse = import('../types/optimization').OptimizeAdResponse;

    const pollOptimizeAdJob = async (jobId: string): Promise<OptimizeAdResponse> => {
      const statusPath = `/ai/optimize-ad/status/${jobId}`;
      // ~18 minutes — crawl + Claude + difference retries can be long
      const maxAttempts = 600;
      let consecutiveNetworkErrors = 0;
      let lastProgress = -1;
      let lastStage = '';
      let stalledPolls = 0;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, attempt === 0 ? 1000 : 1800));
        try {
          const { data } = await api.get<{
            status: 'processing' | 'completed' | 'failed';
            result?: OptimizeAdResponse;
            error?: string;
            progress?: number;
            stage?: string;
            partial?: Partial<OptimizeAdResponse>;
          }>(statusPath, {
            params: payload.accountContext?.userId ? { userId: payload.accountContext.userId } : undefined,
            timeout: 25_000,
            validateStatus: (status) => status < 500 || status === 500,
          });
          consecutiveNetworkErrors = 0;
          if (data.status === 'completed' && data.result) return data.result;
          if (data.status === 'failed') {
            throw new Error(data.error ?? 'Optimization failed');
          }
          if (data.status === 'processing') {
            const progress = data.progress ?? 0;
            const stage = data.stage ?? 'Working…';
            if (progress === lastProgress && stage === lastStage) stalledPolls += 1;
            else {
              stalledPolls = 0;
              lastProgress = progress;
              lastStage = stage;
            }
            options?.onProgress?.({
              progress,
              stage:
                stalledPolls >= 100
                  ? `${stage} (still working — large competitor crawl can take several minutes)…`
                  : stage,
              partial: data.partial,
            });
            if (stalledPolls >= 270) {
              throw new Error(
                'Optimization appears stuck (no progress for several minutes). Restart the backend and try again — an old process may still be holding port 5001.'
              );
            }
          }
        } catch (err) {
          if (
            err instanceof Error &&
            !axios.isAxiosError(err) &&
            /appears stuck|Optimization failed/i.test(err.message)
          ) {
            throw err;
          }
          if (axios.isAxiosError(err) && err.response?.status === 404) {
            consecutiveNetworkErrors = 0;
            continue;
          }
          if (axios.isAxiosError(err) && err.response?.status === 500) {
            const apiError = (err.response.data as { error?: string })?.error;
            throw new Error(apiError ?? 'Optimization failed');
          }
          consecutiveNetworkErrors += 1;
          if (consecutiveNetworkErrors >= 8) {
            const hint = axios.isAxiosError(err)
              ? err.code === 'ERR_NETWORK' || err.message?.includes('Network Error')
                ? 'Cannot reach the API. Confirm the backend is running on port 5001, then hard-refresh and try again.'
                : err.message
              : 'Network error while polling optimization status.';
            throw new Error(hint);
          }
          if (attempt === maxAttempts - 1) throw err;
        }
      }
      throw new Error(
        'Optimization timed out — please try again. Restart the backend if port 5001 was stuck, and prefer a shorter competitor list if the crawl is very large.'
      );
    };

    const res = await api.post<OptimizeAdResponse | { jobId: string; status: string }>(
      '/ai/optimize-ad',
      payload,
      {
        timeout: 45_000,
        validateStatus: (status) => status === 200 || status === 202,
      }
    );
    if (res.status === 202 && res.data && 'jobId' in res.data) {
      const result = await pollOptimizeAdJob(res.data.jobId);
      return { data: result };
    }
    return res as { data: OptimizeAdResponse };
  },

  suggestCampaignCopy: async (
    payload: {
      auditId: string;
      serviceFocus?: string;
      websiteUrl?: string;
      adBrief?: {
        service?: string;
        adType?: string;
        campaignType?: string;
        offer?: string;
        audience?: string;
        tone?: string;
        ctaPreference?: string;
        mustInclude?: string;
        finalUrl?: string;
        locationFocus?: string;
      };
      campaignType?: string;
    },
    options?: { onProgress?: (update: { progress: number; stage: string }) => void }
  ) => {
    type SuggestResult = {
      campaignName?: string;
      adGroupName?: string;
      dailyBudget?: number;
      keywords: string[];
      finalUrl?: string;
      path1?: string;
      path2?: string;
      primary: {
        id: string;
        label: string;
        headlines: string[];
        descriptions: string[];
        displayPaths?: { path1?: string; path2?: string };
      };
      variations: Array<{
        id: string;
        label: string;
        focusedCompetitor?: string;
        headlines: string[];
        descriptions: string[];
        displayPaths?: { path1?: string; path2?: string };
      }>;
      competitorNames: string[];
      competitorAds: import('../types/optimization').CompetitorAdPreview[];
      competitorSource?: string;
      serviceFocus?: string;
      stageNotes: string[];
    };

    const res = await api.post<SuggestResult | { jobId: string; status: string }>(
      '/ai/suggest-campaign-copy',
      payload,
      {
        timeout: 45_000,
        validateStatus: (status) => status === 200 || status === 202,
      }
    );

    if (res.status === 202 && res.data && 'jobId' in res.data) {
      const jobId = res.data.jobId;
      const maxAttempts = 400;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        await new Promise((r) => setTimeout(r, attempt === 0 ? 1000 : 1800));
        const status = await api.get<{
          status: string;
          progress?: number;
          stage?: string;
          result?: SuggestResult;
          error?: string;
        }>(`/ai/suggest-campaign-copy/status/${jobId}`, { timeout: 25_000 });
        if (status.data.status === 'processing') {
          options?.onProgress?.({
            progress: status.data.progress ?? 0,
            stage: status.data.stage ?? 'Working…',
          });
          continue;
        }
        if (status.data.status === 'failed') {
          throw new Error(status.data.error ?? 'Campaign copy suggestion failed');
        }
        if (status.data.status === 'completed' && status.data.result) {
          return { data: status.data.result };
        }
      }
      throw new Error('Campaign copy suggestion timed out. Try again.');
    }

    return res as { data: SuggestResult };
  },
};

// ─── Campaign wizard API ────────────────────────────────────────

export const campaignWizardApi = {
  discoverServices: (websiteUrl: string) =>
    api.post<{
      companyName: string;
      industry: string;
      services: string[];
      scrapeStatus?: 'ok' | 'blocked' | 'empty' | 'inferred';
    }>(
      '/ai/campaign-wizard/discover-services',
      { websiteUrl },
      { timeout: 90_000 }
    ),
  keywordClusters: (payload: {
    websiteUrl: string;
    services: string[];
    country?: string;
    offer?: string;
    dailyBudget?: number;
    competitorSeeds?: Record<string, string[]>;
    competitorNames?: string[];
    competitorAdTexts?: string[];
  }) =>
    api.post<{
      clusters: Array<{
        service: string;
        keywords: Array<{
          keyword: string;
          volume: number;
          position: number;
          traffic: number;
          url: string;
          difficulty?: number;
          intent?: 'transactional' | 'commercial' | 'informational';
          matchSuggestion?: 'EXACT' | 'PHRASE';
          role?: 'primary' | 'secondary';
          seed?: string;
        }>;
        seedThemes?: Array<{
          seed: string;
          theme: string;
          intent: 'transactional' | 'commercial';
          primary: Array<{
            keyword: string;
            volume: number;
            difficulty?: number;
            matchSuggestion?: 'EXACT' | 'PHRASE';
            suggestedCpc?: number;
          }>;
          secondary: Array<{
            keyword: string;
            volume: number;
            difficulty?: number;
            matchSuggestion?: 'EXACT' | 'PHRASE';
            suggestedCpc?: number;
          }>;
        }>;
        totalVolume: number;
        totalTraffic: number;
        topKeyword: string;
      }>;
      ahrefsAvailable: boolean;
      totalKeywords: number;
      suggestedNegatives?: string[];
    }>('/ai/campaign-wizard/keyword-clusters', payload, { timeout: 90_000 }),
  keywordRecommendations: (payload: {
    clusters: unknown[];
    dailyBudget?: number;
    campaignType?: string;
    location?: string;
    preferredStrategy?: 'MANUAL_CPC' | 'MAXIMIZE_CONVERSIONS';
    budgetContext?: {
      totalSpend?: number;
      enabledDailyBudget?: number;
      leftover?: number;
      costPerConversion?: number;
      avgCpc?: number;
      pacePercent?: number;
      constrainedCampaigns?: number;
      conversions?: number;
      windowDays?: number;
      currency?: string;
    };
  }) =>
    api.post<{
      summary: string;
      bidStrategy: 'MANUAL_CPC' | 'MAXIMIZE_CLICKS' | 'MAXIMIZE_CONVERSIONS';
      bidStrategyWhy: string;
      suggestedDailyBudget?: number;
      recommendedMaxCpc?: number;
      keywordCount: number;
      recommendedKeywordCount: number;
      maxAffordableKeywords: number;
      avgKeywordCpc: number;
      estClicksPerDay: number;
      selectionNote: string;
      defaultMatchType: 'EXACT' | 'PHRASE';
      accountBudgetNote?: string;
      strategyOptions: Array<{
        id: 'MANUAL_CPC' | 'MAXIMIZE_CONVERSIONS';
        label: string;
        recommended: boolean;
        recommendedDailyBudget: number;
        recommendedMaxCpc?: number;
        typicalCpc?: number;
        expectedClicks?: number;
        expectedConversions?: number;
        usesKeywordMaxCpc: boolean;
        situation: string;
        howSpendWorks: string;
      }>;
      themes: Array<{
        service: string;
        seed: string;
        intent: 'transactional' | 'commercial';
        primary: string[];
        secondary: string[];
        phrase: string[];
        exact: string[];
        suggestedCpc?: number;
        recommended?: boolean;
      }>;
      recommendedKeywords: Array<{
        keyword: string;
        seed?: string;
        role: 'primary' | 'secondary';
        matchType: 'EXACT' | 'PHRASE';
        intent: 'transactional' | 'commercial';
        suggestedCpc: number;
        recommended?: boolean;
        why: string;
      }>;
    }>('/ai/campaign-wizard/keyword-recommendations', payload, { timeout: 30_000 }),
  discoverCompetitors: (
    payload: {
      websiteUrl: string;
      service: string;
      keywords: string[];
      country?: string;
      offer?: string;
      forceRefresh?: boolean;
    },
    opts?: { signal?: AbortSignal }
  ) =>
    api.post<{
      competitors: Array<{
        name: string;
        url: string;
        advertiserId?: string;
        headlines: string[];
        descriptions: string[];
        totalAdCount: number;
        activeAdCount: number;
        adDurationDays: number;
        previewImageUrl?: string;
        transparencyUrl?: string;
        creativeUrl?: string;
        adLink?: string;
        adSource?: string;
        confidenceScore?: number;
        isMostRelevant: boolean;
        allAds: import('../types/optimization').CompetitorAdPreview[];
      }>;
      allAds: import('../types/optimization').CompetitorAdPreview[];
      source: string;
    }>('/ai/campaign-wizard/discover-competitors', payload, {
      timeout: 180_000,
      signal: opts?.signal,
    }),
  generateAds: (payload: {
    companyName: string;
    websiteUrl: string;
    service: string;
    keywords: string[];
    competitors: Array<{
      name: string;
      headlines: string[];
      descriptions: string[];
      totalAdCount: number;
      adDurationDays: number;
      isMostRelevant: boolean;
    }>;
    offer?: string;
    audience?: string;
    tone?: string;
    finalUrl?: string;
    locationFocus?: string;
  }) =>
    api.post<{
      ads: Array<{
        id: string;
        label: string;
        headlines: string[];
        descriptions: string[];
        displayPaths?: { path1?: string; path2?: string };
        keywords: string[];
        focusedCompetitor?: string;
      }>;
    }>('/ai/campaign-wizard/generate-ads', payload, { timeout: 60_000 }),
  refineAd: (payload: {
    companyName: string;
    websiteUrl: string;
    service: string;
    keywords?: string[];
    offer?: string;
    locationFocus?: string;
    instruction: string;
    currentAd: {
      id: string;
      label: string;
      headlines: string[];
      descriptions: string[];
      displayPaths?: { path1?: string; path2?: string };
      keywords: string[];
      focusedCompetitor?: string;
    };
    chatHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
  }) =>
    api.post<{
      ad: {
        id: string;
        label: string;
        headlines: string[];
        descriptions: string[];
        displayPaths?: { path1?: string; path2?: string };
        keywords: string[];
        focusedCompetitor?: string;
      };
      reply: string;
    }>('/ai/campaign-wizard/refine-ad', payload, { timeout: 60_000 }),
  saveActivity: (payload: {
    auditRunId?: string;
    googleAdsCustomerId?: string;
    mode: 'campaign' | 'ad';
    stage: 'in_progress' | 'campaign_created' | 'completed';
    title: string;
    summary?: string;
    process: Record<string, unknown>;
    campaignResourceName?: string;
    adResourceName?: string;
    campaignName?: string;
  }) =>
    api.post<{ success: boolean; id: string }>('/ai/campaign-wizard/activity', payload, {
      timeout: 30_000,
    }),
};

export { getApiBaseUrl, getApiOrigin, isAdAuditHealthPayload } from './api-base';
export default api;
