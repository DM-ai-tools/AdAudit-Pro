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

export const authApi = {
  login: (email: string, name?: string) =>
    api.post<{ token: string; user: User }>('/auth/login', { email, name }),
  me: () => api.get<{ user: User; hasGoogleAdsAccess: boolean }>('/auth/me'),
  logout: () => api.post('/auth/logout'),
  config: () => api.get<{
    googleOAuth: boolean;
    googleAds: boolean;
    anthropic: boolean;
    mockData: boolean;
    redirectUri?: string;
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
  googleUrl: (returnTo = '/login', ads = false) =>
    `/api/auth/google?returnTo=${encodeURIComponent(returnTo)}${ads ? '&ads=true' : ''}`,
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
  shared: (token: string) =>
    api.get<{ report: SharedReport; audit: AuditRun }>(`/audit/shared/${token}`),
  pdfUrl: (id: string) => `/api/audit/pdf/${id}`,
};

export const googleAdsApi = {
  accounts: () =>
    api.get<{
      accounts: import('../types/connect').GoogleAdsAccount[];
      source: 'google_ads_api' | 'mock';
      reason: string;
      errorMessage?: string;
      googleAdsConfigured: boolean;
      hasRefreshToken: boolean;
    }>('/google-ads/accounts'),
  status: () =>
    api.get<{ googleAdsConfigured: boolean; hasRefreshToken: boolean; managerAccountId: string | null }>(
      '/google-ads/status'
    ),
  auditConfig: (customerId: string) =>
    api.get<import('../types/connect').AccountAuditConfigResponse>(
      `/google-ads/accounts/${encodeURIComponent(customerId)}/audit-config`
    ),
};

export default api;
