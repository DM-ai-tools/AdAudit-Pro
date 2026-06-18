import { useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation, useSearchParams, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft, ArrowRight, Loader2, Plus, Trash2, History,
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
import { auditApi, authApi, googleAdsApi, LAST_GOOGLE_EMAIL_KEY, getApiOrigin, isAdAuditHealthPayload } from '../services/api';
import axios from 'axios';
import { useAuthStore } from '../store';
import { AUDIT_WINDOW_OPTIONS } from '../data/auditModules';
import type { ConnectFormData } from '../types/connect';
import { usePreviousAudits } from '../hooks/usePreviousAudits';
import { PreviousAuditsList } from '../components/dashboard/PreviousAuditsList';

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

const CONNECT_OAUTH_DONE_KEY = 'adaudit_connect_oauth_done';

export default function ConnectAccountPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { setAuth, hasGoogleAdsAccess, authReady, user: authUser } = useAuthStore();
  const {
    landingData, googleProfile, selectedAccount, auditDepth, auditWindow,
    modules, depthOptions, competitors, reportOptions, consent, wizardStep,
    whatWeAnalyze, accountStats, configSource, configLoading,
    setLandingData, setGoogleProfile, setSelectedAccount, setAuditDepth,
    setAuditWindow, toggleModule, addCompetitor, updateCompetitor,
    removeCompetitor, setReportOption, setConsent, setWizardStep,
    applyAuditConfig, setConfigLoading, resetToGoogleLogin,
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
  const [oauthErrorCode, setOauthErrorCode] = useState<string | null>(null);
  const [redirectUri, setRedirectUri] = useState<string | null>(null);
  const [oauthApiBase, setOauthApiBase] = useState('');
  /** True only after Google OAuth callback confirms returning user (?returning=1). */
  const [verifiedReturning, setVerifiedReturning] = useState(false);
  const [sessionChecked, setSessionChecked] = useState(false);
  const sessionInitialized = useRef(false);
  const processedOAuthToken = useRef<string | null>(null);
  /** Only load audits after Google OAuth completes and user is on step 2 */
  const canShowPreviousAudits = wizardStep === 2 && !!googleProfile?.email;
  const { audits: previousAudits, userEmail: previousAuditsEmail, loading: previousAuditsLoading, error: previousAuditsError, reload: reloadPreviousAudits } = usePreviousAudits(canShowPreviousAudits);

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

  const handleGoogleLogin = (forceReconnect = false) => {
    if (!backendOnline) {
      setOauthError(
        'Backend API is not running. Run `npm run dev` from the project root and wait for "AdAudit Pro API running on port 5001".'
      );
      return;
    }
    if (oauthConfigured) {
      setOauthError(null);
      setOauthErrorCode(null);
      sessionStorage.removeItem(CONNECT_OAUTH_DONE_KEY);
      useAuthStore.getState().logout();

      // Always send user through Google OAuth so they pick the correct account.
      const url = authApi.googleUrl('/connect-account', true, {
        consent: true,
        reconnect: forceReconnect,
        selectAccount: !forceReconnect,
        apiBase: oauthApiBase,
        loginHint: forceReconnect ? localStorage.getItem(LAST_GOOGLE_EMAIL_KEY) ?? undefined : undefined,
      });
      window.location.assign(url);
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

  const tokenFromUrl = searchParams.get('token');
  const oauthProcessing = !!tokenFromUrl || googleLoading;
  /** Wizard step drives the UI — never skip Step 1 based on cached JWT alone. */
  const effectiveStep = wizardStep;
  const onAccountSelectStep = wizardStep >= 2;

  useEffect(() => {
    const apiOrigin = getApiOrigin();
    axios
      .get(`${apiOrigin}/api/health`, { timeout: 5000 })
      .then(({ data }) => {
        if (!isAdAuditHealthPayload(data)) {
          throw new Error('wrong_app');
        }
        setBackendOnline(true);
        return authApi.config();
      })
      .then((res) => {
        if (!res) return;
        const { data } = res;
        setOauthConfigured(data.googleOAuth);
        setMockDataMode(data.mockData);
        if (data.redirectUri) setRedirectUri(data.redirectUri);
        if (data.oauthApiBase) setOauthApiBase(data.oauthApiBase);
      })
      .catch((err) => {
        setBackendOnline(false);
        const wrongApp = err?.message === 'wrong_app';
        const unreachable = axios.isAxiosError(err) && !err.response;
        setOauthError(
          wrongApp
            ? 'Port 5000 is used by another app (not AdAudit Pro). AdAudit runs on port 5001 — restart with: npm run dev from the project root. Add http://localhost:5001/api/auth/google/callback to Google Cloud Console redirect URIs for OAuth.'
            : unreachable
              ? `Cannot reach AdAudit Pro API at ${getApiOrigin()}. Run "npm run dev" from the project root and wait for "AdAudit Pro API running on port 5001".`
              : 'AdAudit Pro API is not responding. Restart the backend with npm run dev from the project root.'
        );
      });
  }, []);

  // Remember Gmail for instant login on next visit (DB check before OAuth).
  useEffect(() => {
    if (authUser?.email) {
      localStorage.setItem(LAST_GOOGLE_EMAIL_KEY, authUser.email);
    }
  }, [authUser?.email]);

  // Initialize wizard once — always Step 1 unless handling OAuth callback params.
  useEffect(() => {
    if (!authReady || sessionInitialized.current) return;
    sessionInitialized.current = true;

    const tokenParam = searchParams.get('token');
    const errorParam = searchParams.get('error');
    if (tokenParam || errorParam) {
      setSessionChecked(true);
      return;
    }

    sessionStorage.removeItem(CONNECT_OAUTH_DONE_KEY);
    resetToGoogleLogin();
    setVerifiedReturning(false);
    setWizardStep(1);
    setSessionChecked(true);
  }, [authReady, searchParams, resetToGoogleLogin, setWizardStep]);

  // Handle Google OAuth callback
  useEffect(() => {
    const token = searchParams.get('token');
    const error = searchParams.get('error');

    if (error) {
      const detail = searchParams.get('detail');
      const googleError = searchParams.get('google_error');
      setOauthErrorCode(error);
      const messages: Record<string, string> = {
        access_denied:
          'Google blocked sign-in (403 access_denied). AdAudit Pro is in Testing mode — your Gmail must be added as a Test user in Google Cloud Console before you can sign in.',
        missing_ads_consent:
          'Google Ads permission was not granted or no refresh token was issued. Click Continue with Google again, choose your account, and approve all permissions (including Google Ads). If this persists, revoke AdAudit Pro at myaccount.google.com/permissions and try again.',
        oauth_token:
          'Google token exchange failed. Add the exact redirect URI below to Google Cloud Console → Credentials → your OAuth client → Authorized redirect URIs.',
        oauth:
          'Google sign-in failed. Add the exact redirect URI below to Google Cloud Console → Credentials → OAuth client → Authorized redirect URIs.',
        redirect_uri_mismatch:
          'Google redirect URI mismatch. Copy the redirect URI below into Google Cloud Console → Credentials → your OAuth client → Authorized redirect URIs, then try again.',
      };
      let message = messages[error] ?? messages.oauth;
      if (detail) message += ` (${detail})`;
      if (googleError === 'invalid_client') {
        setOauthErrorCode('invalid_client');
        message = 'Invalid Google OAuth client secret. Copy a fresh Client Secret from Google Cloud Console into backend/.env and restart the server.';
      }
      setOauthError(message);
      resetToGoogleLogin();
      setWizardStep(1);
      setSearchParams({}, { replace: true });
      return;
    }

    setOauthErrorCode(null);

    if (!token) return;
    if (processedOAuthToken.current === token) return;
    processedOAuthToken.current = token;

    const returningVerified = searchParams.get('returning') === '1';
    setGoogleLoading(true);
    localStorage.setItem('token', token);
    authApi.me()
      .then(({ data }) => {
        if (!data.hasGoogleAdsAccess) {
          setOauthError('Google Ads permission was not granted. Please connect again and approve Google Ads access.');
          resetToGoogleLogin();
          setWizardStep(1);
          setVerifiedReturning(false);
          processedOAuthToken.current = null;
          setSearchParams({}, { replace: true });
          return;
        }
        setAuth(token, data.user, data.hasGoogleAdsAccess, data.isReturningUser);
        setGoogleProfile({
          name: data.user.name,
          email: data.user.email,
          avatarUrl: data.user.avatarUrl,
        });
        localStorage.setItem(LAST_GOOGLE_EMAIL_KEY, data.user.email);
        setVerifiedReturning(returningVerified);
        setWizardStep(2);
        sessionStorage.setItem(CONNECT_OAUTH_DONE_KEY, '1');
        fetchAccounts();
        void reloadPreviousAudits();
        setSearchParams({}, { replace: true });
      })
      .catch(() => {
        setOauthError('Could not verify Google account.');
        processedOAuthToken.current = null;
      })
      .finally(() => setGoogleLoading(false));
  }, [searchParams, setAuth, setGoogleProfile, setSearchParams, setWizardStep, resetToGoogleLogin]);

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
    if (canShowPreviousAudits) {
      void reloadPreviousAudits();
    }
  }, [canShowPreviousAudits, reloadPreviousAudits]);

  useEffect(() => {
    if (wizardStep !== 2) return;
    fetchAccounts();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load accounts when entering Step 2
  }, [wizardStep]);

  useEffect(() => {
    if (effectiveStep === 2 && !selectedAccount && accounts.length && !accountsLoading) {
      const selectable = accounts.filter((a) => a.selectable !== false && a.accountType !== 'Manager');
      const preferred = selectable[0] ?? accounts.find((a) => a.selectable !== false);
      if (preferred) setSelectedAccount(preferred);
    }
  }, [effectiveStep, selectedAccount, setSelectedAccount, accounts, accountsLoading]);

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
      campaignCount: accountStats?.activeCampaigns ?? 0,
      websiteUrl: selectedAccount.websiteUrl || landingData?.website || '',
      email: landingData?.email || googleProfile?.email,
      name: landingData?.name || googleProfile?.name,
      goal: landingData?.goal,
      auditScope: 'account' as const,
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

  const canProceedStep2 = !!selectedAccount && selectedAccount.selectable !== false;

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
  const canStart = onAccountSelectStep && consent && selectedAccount && googleProfile && hasGoogleAdsAccess;

  if (!authReady || !sessionChecked || oauthProcessing) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center flex-col gap-3">
        <Loader2 className="animate-spin text-orange" size={28} />
        {oauthProcessing && (
          <p className="text-muted text-sm">Completing Google sign-in…</p>
        )}
      </div>
    );
  }

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
          <Badge variant="orange" className="mb-3">Step {effectiveStep} of 3</Badge>
          <h1 className="text-2xl lg:text-3xl font-bold text-white mb-2">
            Connect Your Google Ads Account
          </h1>
          <p className="text-muted text-sm max-w-2xl">
            Securely connect your Google Ads account so our AI engine can begin the forensic audit.
          </p>
          <div className="mt-6 max-w-xl">
            <StepWizard steps={WIZARD_STEPS} currentStep={effectiveStep} />
          </div>
        </div>

        <div className="grid lg:grid-cols-[1fr_340px] gap-8 items-start">
          {/* Main wizard card */}
          <div className="glass rounded-2xl p-6 lg:p-8 glow-orange min-h-[480px]">
            <AnimatePresence mode="wait">
              {/* STEP 1 — Google Login */}
              {effectiveStep === 1 && (
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
                    Sign in with Google to connect your Google Ads account. You&apos;ll choose which
                    Google account to use — we never skip this step for new audits.
                  </p>
                  <div className="max-w-md">
                    {oauthError && (
                      <div className="text-red-400 text-sm mb-3 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 space-y-3">
                        <p>{oauthError}</p>
                        {oauthErrorCode === 'access_denied' && (
                          <div className="text-xs text-body space-y-2 border-t border-red-500/20 pt-2">
                            <p className="text-white font-semibold">How to fix (Testing mode)</p>
                            <ol className="list-decimal list-inside space-y-1 text-muted">
                              <li>
                                Open{' '}
                                <a
                                  href="https://console.cloud.google.com/apis/credentials/consent"
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-teal underline"
                                >
                                  Google Cloud → OAuth consent screen
                                </a>
                              </li>
                              <li>Under <span className="text-white">Test users</span>, click <span className="text-white">Add users</span></li>
                              <li>Add the exact Gmail you sign in with (e.g. nitishanaga127@gmail.com)</li>
                              <li>Save, wait ~1 minute, then click Continue with Google again</li>
                            </ol>
                            <p className="text-muted">
                              Or click <span className="text-white">Publish app</span> on that page to allow any Google account (may require Google verification for Ads scope).
                            </p>
                          </div>
                        )}
                        {redirectUri && oauthErrorCode !== 'access_denied' && (
                          <p className="text-xs text-body font-mono break-all">
                            Required redirect URI: <span className="text-white">{redirectUri}</span>
                          </p>
                        )}
                      </div>
                    )}

                    <Button
                      type="button"
                      variant="secondary"
                      size="lg"
                      className="w-full !bg-white !text-gray-800 hover:!bg-gray-100 border-0"
                      onClick={() => handleGoogleLogin()}
                      loading={googleLoading}
                    >
                      {!googleLoading && <GoogleIcon />}
                      Continue with Google
                    </Button>
                    <p className="text-muted text-xs mt-4 text-center">
                      Read-only Google Ads access. Your data is never shared with other users.
                    </p>
                  </div>
                </motion.div>
              )}

              {/* STEP 2 — Select Account */}
              {effectiveStep === 2 && (
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
                        Choose the account for a full account-wide audit. You can run individual campaign audits after the report is ready.
                      </p>
                    </div>
                    <Badge variant={accountsSource === 'google_ads_api' ? 'teal' : 'muted'}>
                      {accountsSource === 'google_ads_api' ? 'Your Google Ads accounts' : 'Demo mode'}
                    </Badge>
                  </div>

                  {verifiedReturning && selectedAccount && (
                    <div className="mb-6 bg-teal/10 border border-teal/30 rounded-xl p-4">
                      <p className="text-teal font-semibold text-sm">Welcome back!</p>
                      <p className="text-muted text-xs mt-1">
                        Signed in as <span className="text-white">{googleProfile?.email}</span>. Select the Google Ads business account you want to audit below.
                      </p>
                    </div>
                  )}

                  {!verifiedReturning && googleProfile?.email && (
                    <div className="mb-4 bg-panel/50 border border-border rounded-lg px-3 py-2 text-xs text-muted">
                      Signed in as <span className="text-white font-medium">{googleProfile.email}</span>
                    </div>
                  )}

                  {!verifiedReturning && (
                    <p className="text-muted text-xs mb-4">
                      <button type="button" className="text-orange hover:underline" onClick={() => handleGoogleLogin(true)}>
                        Switch Google account
                      </button>
                    </p>
                  )}

                  {accountsLoading ? (
                    <div className="flex items-center justify-center py-12 text-muted">
                      <Loader2 className="animate-spin mr-2" size={20} /> Loading your Google Ads accounts...
                    </div>
                  ) : accounts.length === 0 ? (
                    <div className="text-center py-12 space-y-4">
                      <p className="text-muted text-sm">{accountsEmptyMessage}</p>
                      <Button
                        variant="secondary"
                        size="lg"
                        className="w-full max-w-md mx-auto !bg-white !text-gray-800 hover:!bg-gray-100 border-0"
                        onClick={() => handleGoogleLogin(true)}
                        loading={googleLoading}
                      >
                        {!googleLoading && <GoogleIcon />}
                        Continue with Google
                      </Button>
                      {(accountsReason === 'missing_refresh_token' || accountsReason === 'api_error') && (
                        <p className="text-xs text-muted">
                          Or try reconnecting with full Google Ads permissions.
                        </p>
                      )}
                    </div>
                  ) : (
                  <div className="space-y-3">
                    {accounts.map((account) => (
                      <AccountCard
                        key={account.id}
                        account={account}
                        selected={selectedAccount?.id === account.id}
                        onSelect={() => account.selectable !== false && account.accountType !== 'Manager' && setSelectedAccount(account)}
                        onboardingWebsite={landingData?.website ? `https://${landingData.website.replace(/^https?:\/\//, '')}` : undefined}
                      />
                    ))}
                  </div>
                  )}

                  {googleProfile?.email && (
                    <div className="mt-8 pt-6 border-t border-border">
                      <div className="flex items-center gap-2 mb-1">
                        <History size={16} className="text-orange" />
                        <h3 className="text-white font-semibold text-sm">Your Previous Audits</h3>
                      </div>
                      <p className="text-muted text-xs mb-4">
                        Only audits you ran while signed in as <span className="text-white">{previousAuditsEmail || googleProfile.email}</span>
                      </p>
                      <PreviousAuditsList
                        audits={previousAudits}
                        loading={previousAuditsLoading}
                        error={previousAuditsError}
                        userEmail={previousAuditsEmail || googleProfile.email}
                        emptyMessage="No audits yet for this Gmail account. Select a Google Ads account above to start your first audit."
                      />
                    </div>
                  )}

                  <div className="flex justify-between mt-8 pt-6 border-t border-border">
                    <Button variant="ghost" onClick={() => {
                      useAuthStore.getState().logout();
                      resetToGoogleLogin();
                    }}>
                      <ArrowLeft size={16} /> Back to Google login
                    </Button>
                    <Button
                      onClick={() => void goToConfigureStep()}
                      disabled={!canProceedStep2}
                    >
                      Configure Account Audit <ArrowRight size={16} />
                    </Button>
                  </div>
                </motion.div>
              )}

              {/* STEP 3 — Configure Audit */}
              {effectiveStep === 3 && (
                <motion.div
                  key="step3-config"
                  variants={slideVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={{ duration: 0.3 }}
                  className="space-y-8"
                >
                  <div>
                    <h2 className="text-white font-bold text-lg mb-1">Configure Account Audit</h2>
                    <p className="text-muted text-sm">
                      {configLoading
                        ? 'Loading account data from Google Ads...'
                        : `Full account audit for ${selectedAccount?.name ?? 'your account'}${
                            accountStats
                              ? ` — ${accountStats.activeCampaigns} active campaign(s), ${accountStats.campaignTypes.join(', ') || 'no channel data'}`
                              : ''
                          }. Campaign-level audits are available after this completes.`}
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
                      onClick={() => void handleStartAudit()}
                      loading={startLoading}
                      disabled={!canStart}
                    >
                      {startLoading ? (
                        <><Loader2 size={18} className="animate-spin" /> Starting...</>
                      ) : (
                        <>Start Account Audit <ArrowRight size={18} /></>
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
