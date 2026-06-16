import axios from 'axios';
import type { AuditRun, Finding, HealthScore, User, SharedReport, AuditLog } from '../types';

const api = axios.create({
  baseURL: '/api',
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
    const base = apiBase.replace(/\/$/, '');
    return base ? `${base}${path}` : path;
  },
};

export const auditApi = {
  startDemo: (data: Record<string, unknown>) =>
    api.post<{ audit: AuditRun; auditId: string }>('/audit/start-demo', data),
  start: (data: Record<string, unknown>) =>
    api.post<{ audit: AuditRun }>('/audit/start', data),
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
  shared: (token: string) =>
    api.get<{ report: SharedReport; audit: AuditRun }>(`/audit/shared/${token}`),
  pdfUrl: (id: string) => `/api/audit/pdf/${id}`,
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
  campaigns: (customerId: string) =>
    api.get<{
      account: {
        customerId: string;
        name: string;
        websiteUrl?: string;
        industry?: string;
        currency: string;
      };
      campaigns: import('../types/connect').GoogleAdsCampaign[];
      source: 'google_ads_api' | 'mock';
      hasCampaigns: boolean;
      hasAds: boolean;
    }>(`/google-ads/accounts/${encodeURIComponent(customerId)}/campaigns`),
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
  adPreview: (optimizationId: string, device: 'mobile' | 'desktop' = 'mobile', variant: 'original' | 'optimized' = 'optimized') =>
    api.get(`/google-ads/ad-preview/${optimizationId}?device=${device}&variant=${variant}`),
};

export const aiApi = {
  optimizeAd: async (payload: {
    auditId: string;
    findingId: string;
    tone?: import('../types/optimization').OptimizationTone;
    variation?: import('../types/optimization').OptimizationVariation;
    findingSnapshot?: import('../types').Finding;
    auditFindingsSnapshot?: import('../types').Finding[];
    accountContext?: {
      accountName?: string;
      goal?: string;
      monthlySpend?: number;
      googleAdsCustomerId?: string;
      websiteUrl?: string;
      userId?: string;
    };
  }) => {
    try {
      return await api.post<import('../types/optimization').OptimizeAdResponse>(
        '/ai/optimize-ad',
        payload
      );
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 404) {
        return api.post<import('../types/optimization').OptimizeAdResponse>(
          '/audit/optimize-ad',
          payload
        );
      }
      throw err;
    }
  },
};

export default api;
