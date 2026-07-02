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
  logs: (id: string) => api.get<{ logs: AuditLog[] }>(`/audit/logs/${id}`),
  health: (id: string) =>
    api.get<{ overallScore: number; scores: HealthScore[]; totalImpact: number; criticalCount: number }>(
      `/audit/health/${id}`
    ),
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
      params: { inline: '1' },
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
    const url = window.URL.createObjectURL(blob);

    const opened = window.open(url, '_blank', 'noopener,noreferrer');
    if (!opened) {
      const safeName = (accountName || id).replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-') || 'report';
      const link = document.createElement('a');
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.download = `adaudit-${safeName}.${isPdf ? 'pdf' : 'html'}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
    }

    window.setTimeout(() => window.URL.revokeObjectURL(url), 60_000);
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
  adPreview: (optimizationId: string, device: 'mobile' | 'desktop' = 'mobile', variant: 'original' | 'optimized' = 'optimized') =>
    api.get(`/google-ads/ad-preview/${optimizationId}?device=${device}&variant=${variant}`),
};

export const aiApi = {
  optimizeAd: async (payload: {
    auditId: string;
    findingId: string;
    tone?: import('../types/optimization').OptimizationTone;
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
  }) => {
    type OptimizeAdResponse = import('../types/optimization').OptimizeAdResponse;

    const pollOptimizeAdJob = async (jobId: string): Promise<OptimizeAdResponse> => {
      const statusPaths = [
        `/ai/optimize-ad/status/${jobId}`,
        `/audit/optimize-ad/status/${jobId}`,
      ];
      const maxAttempts = 90;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, attempt === 0 ? 1500 : 2000));
        for (const path of statusPaths) {
          try {
            const { data } = await api.get<{
              status: 'processing' | 'completed' | 'failed';
              result?: OptimizeAdResponse;
              error?: string;
            }>(path, {
              params: payload.accountContext?.userId ? { userId: payload.accountContext.userId } : undefined,
              timeout: 20_000,
              validateStatus: (status) => status < 500 || status === 500,
            });
            if (data.status === 'completed' && data.result) return data.result;
            if (data.status === 'failed') {
              throw new Error(data.error ?? 'Optimization failed');
            }
            break;
          } catch (err) {
            if (axios.isAxiosError(err) && err.response?.status === 404) continue;
            if (axios.isAxiosError(err) && err.response?.status === 500) {
              const apiError = (err.response.data as { error?: string })?.error;
              throw new Error(apiError ?? 'Optimization failed');
            }
            if (attempt === maxAttempts - 1) throw err;
          }
        }
      }
      throw new Error('Optimization timed out — the AI is still working. Try again in a moment.');
    };

    const postPaths = ['/ai/optimize-ad', '/audit/optimize-ad'];
    let lastErr: unknown;
    for (const path of postPaths) {
      try {
        const res = await api.post<OptimizeAdResponse | { jobId: string; status: string }>(
          path,
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
      } catch (err) {
        lastErr = err;
        if (axios.isAxiosError(err) && err.response?.status === 404) continue;
        throw err;
      }
    }
    throw lastErr;
  },
};

export { getApiBaseUrl, getApiOrigin, isAdAuditHealthPayload } from './api-base';
export default api;
