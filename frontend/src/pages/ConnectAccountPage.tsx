import { useEffect, useState } from 'react';
import { useNavigate, useLocation, useSearchParams, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft, ArrowRight, CheckCircle, Loader2, Plus, Trash2, User,
} from 'lucide-react';
import { Logo } from '../components/layout/Logo';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { StepWizard } from '../components/connect/StepWizard';
import { AccountCard } from '../components/connect/AccountCard';
import { AuditModuleCard } from '../components/connect/AuditModuleCard';
import { ConfigSelector } from '../components/connect/ConfigSelector';
import { ToggleSwitch } from '../components/connect/ToggleSwitch';
import { SecurityCard } from '../components/connect/SecurityCard';
import { WhatWeAnalyze } from '../components/connect/WhatWeAnalyze';
import { SummaryCard, ProgressPreview } from '../components/connect/SummaryCard';
import { useConnectStore } from '../store/connectStore';
import { auditApi, authApi, googleAdsApi } from '../services/api';
import { useAuthStore } from '../store';
import { AUDIT_WINDOW_OPTIONS } from '../data/auditModules';
import type { ConnectFormData } from '../types/connect';

const WIZARD_STEPS = [
  { id: 1, label: 'Google Login' },
  { id: 2, label: 'Select Account' },
  { id: 3, label: 'Configure Audit' },
];

const slideVariants = {
  enter: { opacity: 0, x: 24 },
  center: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -24 },
};

function GoogleIcon() {
  return (
    <svg className="w-5 h-5" viewBox="0 0 24 24">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  );
}

export default function ConnectAccountPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { setAuth } = useAuthStore();
  const {
    landingData, googleProfile, selectedAccount, auditDepth, auditWindow,
    modules, depthOptions, competitors, reportOptions, consent, wizardStep,
    whatWeAnalyze, accountStats, configSource, configLoading,
    setLandingData, setGoogleProfile, setSelectedAccount, setAuditDepth,
    setAuditWindow, toggleModule, addCompetitor, updateCompetitor,
    removeCompetitor, setReportOption, setConsent, setWizardStep,
    applyAuditConfig, setConfigLoading,
  } = useConnectStore();

  const [accounts, setAccounts] = useState<import('../types/connect').GoogleAdsAccount[]>([]);
  const [accountsSource, setAccountsSource] = useState<'google_ads_api' | 'mock'>('mock');
  const [accountsReason, setAccountsReason] = useState<string | null>(null);
  const [accountsErrorDetail, setAccountsErrorDetail] = useState<string | null>(null);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [startLoading, setStartLoading] = useState(false);
  const [oauthConfigured, setOauthConfigured] = useState(true);
  const [mockDataMode, setMockDataMode] = useState(false);
  const [backendOnline, setBackendOnline] = useState(true);
  const [oauthError, setOauthError] = useState<string | null>(null);
  const [redirectUri, setRedirectUri] = useState<string | null>(null);

  const fetchAccounts = async () => {
    setAccountsLoading(true);
    setAccountsReason(null);
    setAccountsErrorDetail(null);
    try {
      const { data } = await googleAdsApi.accounts();
      setAccounts(data.accounts);
      setAccountsSource(data.source);
      setAccountsReason(data.reason);
      setAccountsErrorDetail(data.errorMessage ?? null);
    } catch {
      setAccounts([]);
      setAccountsSource('mock');
      setAccountsReason('api_error');
    } finally {
      setAccountsLoading(false);
    }
  };

  useEffect(() => {
    authApi.config()
      .then(({ data }) => {
        setBackendOnline(true);
        setOauthConfigured(data.googleOAuth);
        setMockDataMode(data.mockData);
        if (data.redirectUri) setRedirectUri(data.redirectUri);
      })
      .catch(() => {
        setBackendOnline(false);
        setOauthError(
          'Cannot reach the API server on port 5000. From the project root run: npm run dev — then wait for "AdAudit Pro API running on http://localhost:5000".'
        );
      });
  }, []);

  // Handle Google OAuth callback
  useEffect(() => {
    const token = searchParams.get('token');
    const error = searchParams.get('error');

    if (error) {
      const detail = searchParams.get('detail');
      const googleError = searchParams.get('google_error');
      const messages: Record<string, string> = {
        access_denied:
          'Sign-in was denied. Publish your OAuth app to Production in Google Cloud Console so users can grant access.',
        missing_ads_consent:
          'Google Ads permission was not granted. Click Continue with Google again and approve access to your Google Ads data.',
        oauth_token:
          'Google token exchange failed. Add the exact redirect URI below to Google Cloud Console → Credentials → your OAuth client → Authorized redirect URIs.',
        oauth:
          'Google sign-in failed. Verify OAuth redirect URI settings in Google Cloud Console.',
      };
      let message = messages[error] ?? messages.oauth;
      if (detail) message += ` (${detail})`;
      if (googleError === 'invalid_client') {
        message = 'Invalid Google OAuth client secret. Copy a fresh Client Secret from Google Cloud Console into backend/.env and restart the server.';
      }
      setOauthError(message);
      setSearchParams({}, { replace: true });
      return;
    }

    if (!token) return;

    setGoogleLoading(true);
    localStorage.setItem('token', token);
    authApi.me()
      .then(({ data }) => {
        if (!data.hasGoogleAdsAccess) {
          setOauthError('Google Ads permission was not granted. Please connect again and approve Google Ads access.');
          setSearchParams({}, { replace: true });
          return;
        }
        setAuth(token, data.user);
        setGoogleProfile({
          name: data.user.name,
          email: data.user.email,
          avatarUrl: data.user.avatarUrl,
        });
        setWizardStep(2);
        setSearchParams({}, { replace: true });
        fetchAccounts();
      })
      .catch(() => setOauthError('Could not verify Google account.'))
      .finally(() => setGoogleLoading(false));
  }, [searchParams, setAuth, setGoogleProfile, setSearchParams, setWizardStep]);

  useEffect(() => {
    const state = location.state as { formData?: ConnectFormData } | null;
    if (state?.formData) {
      setLandingData(state.formData);
    } else if (!landingData) {
      setLandingData({
        website: '',
        spend: '14200',
        goal: 'leads',
        name: '',
        email: '',
      });
    }
  }, [location.state, landingData, setLandingData]);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token && googleProfile && wizardStep >= 2) {
      fetchAccounts();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refetch accounts when resuming wizard
  }, [googleProfile, wizardStep]);

  useEffect(() => {
    if (wizardStep === 2 && !selectedAccount && accounts[0] && !accountsLoading) {
      setSelectedAccount(accounts[0]);
    }
  }, [wizardStep, selectedAccount, setSelectedAccount, accounts, accountsLoading]);

  const enabledModules = modules.filter((m) => m.enabled);
  const availableModules = modules.filter((m) => m.available !== false);

  const loadAuditConfig = async (customerId: string) => {
    setConfigLoading(true);
    try {
      const { data } = await googleAdsApi.auditConfig(customerId);
      applyAuditConfig({
        account: data.account,
        recommendedDepth: data.recommendedDepth,
        recommendedWindow: data.recommendedWindow,
        modules: data.modules,
        whatWeAnalyze: data.whatWeAnalyze,
        stats: data.stats,
        depthOptions: data.depthOptions,
        source: data.source,
      });
    } catch {
      /* keep prior config if fetch fails */
    } finally {
      setConfigLoading(false);
    }
  };

  const goToConfigureStep = async () => {
    if (!selectedAccount) return;
    setWizardStep(3);
    await loadAuditConfig(selectedAccount.customerId);
  };

  const handleGoogleLogin = () => {
    if (!backendOnline) {
      setOauthError(
        'Backend API is not running. Run `npm run dev` from the project root and wait for the server to start on port 5000.'
      );
      return;
    }
    if (oauthConfigured) {
      setOauthError(null);
      window.location.href = authApi.googleUrl('/connect-account', true);
      return;
    }
    if (!mockDataMode) {
      setOauthError('Google OAuth is not configured on the server.');
      return;
    }
    setGoogleLoading(true);
    setOauthError(null);
    setTimeout(() => {
      setGoogleProfile({
        name: landingData?.name || 'Jane Smith',
        email: landingData?.email || 'jane@acmeplumbing.com.au',
      });
      setGoogleLoading(false);
      setWizardStep(2);
      fetchAccounts();
    }, 400);
  };

  const handleStartAudit = async () => {
    if (!consent || !selectedAccount) return;
    setStartLoading(true);
    const payload = {
      googleAdsCustomerId: selectedAccount.customerId,
      auditDepth,
      auditWindow,
      selectedModules: enabledModules.map((m) => m.id),
      competitors: competitors.filter(Boolean),
      reportOptions,
      accountName: selectedAccount.name,
      monthlySpend: selectedAccount.monthlySpend,
      campaignCount: accountStats?.activeCampaigns,
      websiteUrl: landingData?.website || '',
      email: landingData?.email || googleProfile?.email,
      name: landingData?.name || googleProfile?.name,
      goal: landingData?.goal,
    };

    try {
      const token = localStorage.getItem('token');
      let auditId: string;
      if (token) {
        const { data } = await auditApi.start(payload);
        auditId = data.audit.id;
      } else {
        const { data } = await auditApi.startDemo(payload);
        auditId = data.auditId;
      }
      navigate(`/processing/${auditId}`);
    } catch {
      navigate('/processing/demo-audit');
    } finally {
      setStartLoading(false);
    }
  };

  const canProceedStep2 = !!selectedAccount;

  const accountsEmptyMessage = (() => {
    switch (accountsReason) {
      case 'missing_refresh_token':
        return 'Google Ads permission was not granted. Go back and click Continue with Google to approve access.';
      case 'no_accounts':
        return 'No Google Ads accounts are linked to this Google account.';
      case 'api_error':
        return accountsErrorDetail
          ? `Could not load Google Ads accounts: ${accountsErrorDetail}`
          : 'Could not load your Google Ads accounts. Ensure Google Ads API is enabled and your developer token is active, then reconnect.';
      case 'not_configured':
        return 'Google Ads API credentials are missing on the server.';
      default:
        return accounts.length ? null : 'No accounts available yet.';
    }
  })();
  const canStart = consent && selectedAccount && googleProfile;

  return (
    <div className="min-h-screen bg-bg">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(255,107,43,0.06),transparent_50%)] pointer-events-none" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_left,rgba(0,201,167,0.04),transparent_50%)] pointer-events-none" />

      {/* Header */}
      <header className="border-b border-border bg-navy/60 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <Logo size="sm" />
          <Link to="/" className="text-muted text-sm hover:text-white flex items-center gap-1 transition-colors">
            <ArrowLeft size={14} /> Back to home
          </Link>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-6 py-8 lg:py-12">
        {/* Page title */}
        <div className="mb-8">
          <Badge variant="orange" className="mb-3">Step 2 of 3</Badge>
          <h1 className="text-2xl lg:text-3xl font-bold text-white mb-2">
            Connect Your Google Ads Account
          </h1>
          <p className="text-muted text-sm max-w-2xl">
            Securely connect your Google Ads account so our AI engine can begin the forensic audit.
          </p>
          <div className="mt-6 max-w-xl">
            <StepWizard steps={WIZARD_STEPS} currentStep={wizardStep} />
          </div>
        </div>

        <div className="grid lg:grid-cols-[1fr_340px] gap-8 items-start">
          {/* Main wizard card */}
          <div className="glass rounded-2xl p-6 lg:p-8 glow-orange min-h-[480px]">
            <AnimatePresence mode="wait">
              {/* STEP 1 — Google Login */}
              {wizardStep === 1 && (
                <motion.div
                  key="step1"
                  variants={slideVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={{ duration: 0.3 }}
                >
                  <h2 className="text-white font-bold text-lg mb-1">Authenticate with Google</h2>
                  <p className="text-muted text-sm mb-4">
                    Sign in with Google and grant Google Ads access. We only read accounts you
                    authorize — never anyone else&apos;s data.
                  </p>

                  {!googleProfile ? (
                    <div className="max-w-md">
                      {oauthError && (
                        <div className="text-red-400 text-sm mb-3 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 space-y-2">
                          <p>{oauthError}</p>
                          {redirectUri && (
                            <p className="text-xs text-body font-mono break-all">
                              Required redirect URI: <span className="text-white">{redirectUri}</span>
                            </p>
                          )}
                        </div>
                      )}

                      <Button
                        variant="secondary"
                        size="lg"
                        className="w-full !bg-white !text-gray-800 hover:!bg-gray-100 border-0"
                        onClick={handleGoogleLogin}
                        loading={googleLoading}
                      >
                        {!googleLoading && <GoogleIcon />}
                        Continue with Google
                      </Button>
                      <p className="text-muted text-xs mt-4 text-center">
                        Read-only Google Ads access. Your data is never shared with other users.
                      </p>
                    </div>
                  ) : (
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="max-w-md bg-navy border border-teal/30 rounded-xl p-4"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-full bg-orange/10 border border-orange/20 flex items-center justify-center">
                          <User size={24} className="text-orange" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-white font-semibold">{googleProfile.name}</span>
                            <Badge variant="teal">Connected</Badge>
                          </div>
                          <p className="text-muted text-sm">{googleProfile.email}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 mt-3 text-teal text-xs">
                        <CheckCircle size={14} /> Google authentication successful
                      </div>
                    </motion.div>
                  )}

                  <div className="flex justify-end mt-8 pt-6 border-t border-border">
                    <Button
                      onClick={() => setWizardStep(2)}
                      disabled={!googleProfile}
                    >
                      Continue <ArrowRight size={16} />
                    </Button>
                  </div>
                </motion.div>
              )}

              {/* STEP 2 — Select Account */}
              {wizardStep === 2 && (
                <motion.div
                  key="step2"
                  variants={slideVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={{ duration: 0.3 }}
                >
                  <div className="flex items-center justify-between mb-6">
                    <div>
                      <h2 className="text-white font-bold text-lg mb-1">Select Google Ads Account</h2>
                      <p className="text-muted text-sm">
                        Choose the account you want to audit. You can run additional audits later.
                      </p>
                    </div>
                    <Badge variant={accountsSource === 'google_ads_api' ? 'teal' : 'muted'}>
                      {accountsSource === 'google_ads_api' ? 'Your Google Ads accounts' : 'Demo mode'}
                    </Badge>
                  </div>

                  {accountsLoading ? (
                    <div className="flex items-center justify-center py-12 text-muted">
                      <Loader2 className="animate-spin mr-2" size={20} /> Loading your Google Ads accounts...
                    </div>
                  ) : accounts.length === 0 ? (
                    <div className="text-center py-12 space-y-4">
                      <p className="text-muted text-sm">{accountsEmptyMessage}</p>
                      {(accountsReason === 'missing_refresh_token' || accountsReason === 'api_error') && (
                        <Button variant="outline" onClick={() => { setWizardStep(1); handleGoogleLogin(); }}>
                          Reconnect Google
                        </Button>
                      )}
                    </div>
                  ) : (
                  <div className="space-y-3">
                    {accounts.map((account) => (
                      <AccountCard
                        key={account.id}
                        account={account}
                        selected={selectedAccount?.id === account.id}
                        onSelect={() => setSelectedAccount(account)}
                      />
                    ))}
                  </div>
                  )}

                  <div className="flex justify-between mt-8 pt-6 border-t border-border">
                    <Button variant="ghost" onClick={() => setWizardStep(1)}>
                      <ArrowLeft size={16} /> Back
                    </Button>
                    <Button
                      onClick={goToConfigureStep}
                      disabled={!canProceedStep2 || configLoading}
                      loading={configLoading}
                    >
                      Configure Audit <ArrowRight size={16} />
                    </Button>
                  </div>
                </motion.div>
              )}

              {/* STEP 3 — Configure Audit */}
              {wizardStep === 3 && (
                <motion.div
                  key="step3"
                  variants={slideVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={{ duration: 0.3 }}
                  className="space-y-8"
                >
                  <div>
                    <h2 className="text-white font-bold text-lg mb-1">Audit Configuration</h2>
                    <p className="text-muted text-sm">
                      {configLoading
                        ? 'Loading account data from Google Ads...'
                        : `Settings tailored for ${selectedAccount?.name ?? 'your account'}${
                            accountStats
                              ? ` — ${accountStats.activeCampaigns} active campaign(s), ${accountStats.campaignTypes.join(', ') || 'no channel data'}`
                              : ''
                          }.`}
                    </p>
                  </div>

                  {configLoading ? (
                    <div className="flex items-center justify-center py-16 text-muted">
                      <Loader2 className="animate-spin mr-2" size={20} />
                      Fetching campaigns, spend, and module availability...
                    </div>
                  ) : (
                  <>
                  {/* Audit Depth */}
                  <section>
                    <h3 className="text-[10px] font-bold uppercase tracking-wider text-body mb-3">
                      Audit Depth
                    </h3>
                    <ConfigSelector
                      options={depthOptions.map((d) => ({
                        value: d.id,
                        label: d.title,
                        description: `${d.description} (${d.modules} modules)`,
                      }))}
                      value={auditDepth}
                      onChange={setAuditDepth}
                    />
                  </section>

                  {/* Historical Window */}
                  <section>
                    <h3 className="text-[10px] font-bold uppercase tracking-wider text-body mb-3">
                      Historical Window
                    </h3>
                    <ConfigSelector
                      layout="segmented"
                      options={AUDIT_WINDOW_OPTIONS.map((w) => ({
                        value: w.value,
                        label: w.label,
                      }))}
                      value={auditWindow}
                      onChange={setAuditWindow}
                    />
                  </section>

                  {/* Modules */}
                  <section>
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-[10px] font-bold uppercase tracking-wider text-body">
                        Audit Modules
                      </h3>
                      <span className="text-teal text-xs font-semibold">
                        {enabledModules.length} enabled
                      </span>
                    </div>
                    <div className="grid sm:grid-cols-2 gap-2">
                      {modules.map((mod) => (
                        <AuditModuleCard
                          key={mod.id}
                          module={mod}
                          onToggle={() => toggleModule(mod.id)}
                        />
                      ))}
                    </div>
                  </section>

                  {/* Competitor URLs */}
                  <section>
                    <h3 className="text-[10px] font-bold uppercase tracking-wider text-body mb-3">
                      Competitor URLs <span className="text-muted normal-case font-normal">(optional)</span>
                    </h3>
                    <div className="space-y-2">
                      {competitors.map((url, i) => (
                        <div key={i} className="flex gap-2">
                          <input
                            type="url"
                            placeholder="https://competitor.com.au"
                            value={url}
                            onChange={(e) => updateCompetitor(i, e.target.value)}
                            className="flex-1 bg-navy border border-border rounded-lg px-4 py-2.5 text-white text-sm placeholder:text-muted/70 focus:outline-none focus:border-orange/50"
                          />
                          {competitors.length > 1 && (
                            <button
                              type="button"
                              onClick={() => removeCompetitor(i)}
                              className="p-2.5 rounded-lg border border-border text-muted hover:text-red-400 hover:border-red-400/30 transition-colors"
                            >
                              <Trash2 size={16} />
                            </button>
                          )}
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={addCompetitor}
                        className="flex items-center gap-1.5 text-orange text-xs font-semibold hover:underline"
                      >
                        <Plus size={14} /> Add competitor URL
                      </button>
                    </div>
                  </section>

                  {/* Report Options */}
                  <section className="bg-navy border border-border rounded-xl p-4 divide-y divide-border">
                    <h3 className="text-[10px] font-bold uppercase tracking-wider text-body mb-3 pb-0">
                      Report Options
                    </h3>
                    <ToggleSwitch
                      label="Generate PDF Report"
                      checked={reportOptions.generatePdf}
                      onChange={(v) => setReportOption('generatePdf', v)}
                    />
                    <ToggleSwitch
                      label="Include AI Recommendations"
                      checked={reportOptions.includeAiRecommendations}
                      onChange={(v) => setReportOption('includeAiRecommendations', v)}
                    />
                    <ToggleSwitch
                      label="Email Report When Complete"
                      description={landingData?.email || googleProfile?.email}
                      checked={reportOptions.emailWhenComplete}
                      onChange={(v) => setReportOption('emailWhenComplete', v)}
                    />
                    <ToggleSwitch
                      label="Include Landing Page Analysis"
                      checked={reportOptions.includeLandingPageAnalysis}
                      onChange={(v) => setReportOption('includeLandingPageAnalysis', v)}
                    />
                  </section>

                  {/* Consent */}
                  <label className="flex items-start gap-3 cursor-pointer group">
                    <input
                      type="checkbox"
                      checked={consent}
                      onChange={(e) => setConsent(e.target.checked)}
                      className="mt-1 w-4 h-4 rounded border-border bg-navy accent-orange"
                    />
                    <span className="text-sm text-body group-hover:text-white transition-colors">
                      I authorize AdAudit Pro to securely access my Google Ads data for audit purposes.
                      <span className="text-red-400"> *</span>
                    </span>
                  </label>

                  <div className="flex justify-between pt-6 border-t border-border">
                    <Button variant="ghost" onClick={() => setWizardStep(2)}>
                      <ArrowLeft size={16} /> Back
                    </Button>
                    <Button
                      size="lg"
                      className="glow-orange uppercase tracking-wide"
                      onClick={handleStartAudit}
                      loading={startLoading}
                      disabled={!canStart}
                    >
                      {startLoading ? (
                        <><Loader2 size={18} className="animate-spin" /> Starting...</>
                      ) : (
                        <>Start Audit Processing <ArrowRight size={18} /></>
                      )}
                    </Button>
                  </div>
                  </>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Right sidebar */}
          <aside className="space-y-4 lg:sticky lg:top-24">
            <SummaryCard
              accountName={selectedAccount?.name}
              auditDepth={auditDepth}
              modulesEnabled={enabledModules.length}
              totalModules={availableModules.length}
              auditWindow={auditWindow}
              monthlySpend={selectedAccount?.monthlySpend}
              currency={selectedAccount?.currency}
              activeCampaigns={accountStats?.activeCampaigns}
              configSource={configSource}
            />
            <WhatWeAnalyze items={whatWeAnalyze} />
            <SecurityCard />
            <ProgressPreview modules={modules.map((m) => ({ name: m.name, enabled: m.enabled }))} />
          </aside>
        </div>
      </div>
    </div>
  );
}
