import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  ConnectFormData,
  GoogleProfile,
  GoogleAdsAccount,
  AuditDepth,
  AuditWindow,
  ReportOptions,
  AuditModuleOption,
  AuditDepthOption,
} from '../types/connect';
import { DEFAULT_AUDIT_MODULES, AUDIT_DEPTH_OPTIONS, QUICK_MODULE_IDS } from '../data/auditModules';

export interface AccountAuditStats {
  activeCampaigns: number;
  campaignTypes: string[];
  spend30Days: number;
  spend90Days: number;
  spend365Days: number;
  conversionActions: number;
  landingPageCount: number;
}

interface ConnectState {
  landingData: ConnectFormData | null;
  googleProfile: GoogleProfile | null;
  selectedAccount: GoogleAdsAccount | null;
  auditDepth: AuditDepth;
  auditWindow: AuditWindow;
  modules: AuditModuleOption[];
  depthOptions: AuditDepthOption[];
  competitors: string[];
  reportOptions: ReportOptions;
  consent: boolean;
  wizardStep: number;
  configSource: 'google_ads_api' | 'mock' | null;
  whatWeAnalyze: string[];
  accountStats: AccountAuditStats | null;
  configLoading: boolean;

  setLandingData: (data: ConnectFormData) => void;
  setGoogleProfile: (profile: GoogleProfile | null) => void;
  setSelectedAccount: (account: GoogleAdsAccount | null) => void;
  setAuditDepth: (depth: AuditDepth) => void;
  setAuditWindow: (window: AuditWindow) => void;
  setModules: (modules: AuditModuleOption[]) => void;
  applyAuditConfig: (config: {
    account: GoogleAdsAccount;
    recommendedDepth: AuditDepth;
    recommendedWindow: AuditWindow;
    modules: AuditModuleOption[];
    whatWeAnalyze: string[];
    stats: AccountAuditStats;
    depthOptions?: AuditDepthOption[];
    source: 'google_ads_api' | 'mock';
  }) => void;
  setConfigLoading: (loading: boolean) => void;
  toggleModule: (id: string) => void;
  setCompetitors: (urls: string[]) => void;
  addCompetitor: () => void;
  updateCompetitor: (index: number, value: string) => void;
  removeCompetitor: (index: number) => void;
  setReportOption: (key: keyof ReportOptions, value: boolean) => void;
  setConsent: (value: boolean) => void;
  setWizardStep: (step: number) => void;
  resetToGoogleLogin: () => void;
  reset: () => void;
}

const defaultReportOptions: ReportOptions = {
  generatePdf: true,
  includeAiRecommendations: true,
  emailWhenComplete: true,
  includeLandingPageAnalysis: true,
};

function applyDepthToModules(modules: AuditModuleOption[], depth: AuditDepth): AuditModuleOption[] {
  return modules.map((m) => {
    if (m.available === false) return { ...m, enabled: false };
    if (depth === 'quick') return { ...m, enabled: QUICK_MODULE_IDS.includes(m.id) };
    return { ...m, enabled: true };
  });
}

const initialModules = DEFAULT_AUDIT_MODULES.map((m) => ({ ...m, available: true }));

export const useConnectStore = create<ConnectState>()(
  persist(
    (set, get) => ({
  landingData: null,
  googleProfile: null,
  selectedAccount: null,
  auditDepth: 'standard',
  auditWindow: 365,
  modules: initialModules.map((m) => ({ ...m })),
  depthOptions: AUDIT_DEPTH_OPTIONS.map((d) => ({ ...d })),
  competitors: [''],
  reportOptions: { ...defaultReportOptions },
  consent: false,
  wizardStep: 1,
  configSource: null,
  whatWeAnalyze: [],
  accountStats: null,
  configLoading: false,

  setLandingData: (data) => set({ landingData: data }),
  setGoogleProfile: (profile) => set({ googleProfile: profile }),
  setSelectedAccount: (account) => set({ selectedAccount: account }),
  setAuditDepth: (depth) =>
    set({
      auditDepth: depth,
      modules: applyDepthToModules(get().modules, depth),
      whatWeAnalyze: applyDepthToModules(get().modules, depth)
        .filter((m) => m.enabled)
        .map((m) => m.name),
    }),
  setAuditWindow: (window) => set({ auditWindow: window }),
  setModules: (modules) =>
    set({
      modules,
      whatWeAnalyze: modules.filter((m) => m.enabled).map((m) => m.name),
    }),
  applyAuditConfig: (config) => {
    const modules = applyDepthToModules(config.modules, config.recommendedDepth);
    set({
      selectedAccount: config.account,
      auditDepth: config.recommendedDepth,
      auditWindow: config.recommendedWindow,
      modules,
      depthOptions: config.depthOptions ?? get().depthOptions,
      whatWeAnalyze: modules.filter((m) => m.enabled).map((m) => m.name),
      accountStats: config.stats,
      configSource: config.source,
    });
  },
  setConfigLoading: (loading) => set({ configLoading: loading }),
  toggleModule: (id) => {
    const modules = get().modules.map((m) =>
      m.id === id && m.available !== false ? { ...m, enabled: !m.enabled } : m
    );
    set({
      modules,
      whatWeAnalyze: modules.filter((m) => m.enabled).map((m) => m.name),
    });
  },
  setCompetitors: (urls) => set({ competitors: urls }),
  addCompetitor: () => set({ competitors: [...get().competitors, ''] }),
  updateCompetitor: (index, value) => {
    const next = [...get().competitors];
    next[index] = value;
    set({ competitors: next });
  },
  removeCompetitor: (index) => {
    const next = get().competitors.filter((_, i) => i !== index);
    set({ competitors: next.length ? next : [''] });
  },
  setReportOption: (key, value) =>
    set({ reportOptions: { ...get().reportOptions, [key]: value } }),
  setConsent: (value) => set({ consent: value }),
  setWizardStep: (step) => set({ wizardStep: step }),
  resetToGoogleLogin: () =>
    set({
      googleProfile: null,
      selectedAccount: null,
      wizardStep: 1,
      configSource: null,
      accountStats: null,
      whatWeAnalyze: [],
      consent: false,
    }),
  reset: () =>
    set({
      landingData: null,
      googleProfile: null,
      selectedAccount: null,
      auditDepth: 'standard',
      auditWindow: 365,
      modules: initialModules.map((m) => ({ ...m })),
      depthOptions: AUDIT_DEPTH_OPTIONS.map((d) => ({ ...d })),
      competitors: [''],
      reportOptions: { ...defaultReportOptions },
      consent: false,
      wizardStep: 1,
      configSource: null,
      whatWeAnalyze: [],
      accountStats: null,
      configLoading: false,
    }),
}),
{
  name: 'adaudit-connect',
  partialize: (s) => ({
    auditDepth: s.auditDepth,
    auditWindow: s.auditWindow,
    landingData: s.landingData,
  }),
}
  )
);
