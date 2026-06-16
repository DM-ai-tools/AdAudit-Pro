import { Router, Response } from 'express';
import { env } from '../config/env.js';
import { signToken, verifyToken, JwtPayload } from '../utils/jwt.js';
import { authMiddleware, optionalAuth, AuthRequest } from '../middleware/auth.js';
import { findOrCreateUser, getMe, getUserByEmail } from '../services/audit.service.js';
import {
  getGoogleAccessTokenForUser,
  saveGoogleOAuthTokens,
} from '../services/google-oauth.service.js';
import { getGoogleAdsAccountsForUser } from '../services/google-ads.service.js';

const router = Router();

const GOOGLE_ADS_SCOPE = 'https://www.googleapis.com/auth/adwords';

function encodeState(returnTo: string, ads: boolean, consent = false): string {
  return Buffer.from(JSON.stringify({ returnTo, ads, consent })).toString('base64url');
}

function decodeState(state: string): { returnTo: string; ads: boolean; consent: boolean } {
  try {
    const parsed = JSON.parse(Buffer.from(state, 'base64url').toString('utf-8'));
    const returnTo = typeof parsed.returnTo === 'string' ? parsed.returnTo : '/login';
    return {
      returnTo: returnTo.startsWith('/') ? returnTo : '/login',
      ads: !!parsed.ads,
      consent: !!parsed.consent,
    };
  } catch {
    return { returnTo: '/login', ads: false, consent: false };
  }
}

function buildGoogleScopes(includeAds: boolean): string {
  const scopes = ['openid', 'email', 'profile'];
  if (includeAds) scopes.push(GOOGLE_ADS_SCOPE);
  return scopes.join(' ');
}

function sanitizeUser(user: NonNullable<Awaited<ReturnType<typeof getMe>>>) {
  const { googleRefreshToken: _r, googleAccessToken: _a, googleTokenExpiry: _e, ...safeUser } = user;
  return safeUser;
}

/** Resolve JWT from Authorization header or ?session= query (browser redirect cannot send headers). */
function resolveAuthUser(req: AuthRequest): JwtPayload | undefined {
  if (req.authUser) return req.authUser;
  const session = req.query.session;
  if (typeof session === 'string' && session) {
    try {
      return verifyToken(session);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function apiBaseUrl(): string {
  if (env.isProduction) {
    if (env.railwayPublicDomain) return `https://${env.railwayPublicDomain}`;
    return env.clientUrl.replace(/\/$/, '');
  }
  return `http://localhost:${env.port}`;
}

function buildGoogleOAuthUrl(options: {
  returnTo: string;
  includeAds: boolean;
  forceConsent: boolean;
  loginHint?: string;
}): string {
  const state = encodeState(options.returnTo, options.includeAds, options.forceConsent);
  const params = new URLSearchParams({
    client_id: env.googleClientId,
    redirect_uri: env.googleRedirectUri,
    response_type: 'code',
    scope: buildGoogleScopes(options.includeAds),
    access_type: 'offline',
    state,
  });

  // ONLY force consent when explicitly reconnecting or new-user retry from callback.
  // Never set prompt=select_account — it re-triggers Google login/OTP unnecessarily.
  if (options.forceConsent) {
    params.set('prompt', 'consent');
  }

  if (options.loginHint) {
    params.set('login_hint', options.loginHint);
  }

  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

/**
 * Google OAuth — default: access_type=offline only, NO prompt (avoids repeated OTP/consent).
 * prompt=consent ONLY when ?consent=true (new-user retry) or ?reconnect=true.
 */
router.get('/google', (req, res) => {
  if (!env.googleClientId || !env.googleClientSecret) {
    return res.json({
      mock: true,
      message: 'Google OAuth not configured. Use mock login.',
      url: `${env.clientUrl}/login?mock=true`,
    });
  }

  const returnTo = typeof req.query.returnTo === 'string' ? req.query.returnTo : '/login';
  const includeAds = req.query.ads === 'true';
  const forceReconnect = req.query.reconnect === 'true';
  const consentRequested = req.query.consent === 'true';
  const loginHint =
    typeof req.query.login_hint === 'string' ? req.query.login_hint.trim().toLowerCase() : undefined;

  const forceConsent = forceReconnect || consentRequested;

  const url = buildGoogleOAuthUrl({
    returnTo,
    includeAds,
    forceConsent,
    loginHint,
  });

  res.redirect(url);
});

router.get('/google/callback', async (req, res) => {
  const oauthState = req.query.state
    ? decodeState(String(req.query.state))
    : { returnTo: '/login', ads: false, consent: false };
  const { returnTo, ads: requestedAdsScope, consent: consentRequested } = oauthState;

  try {
    const { code, error } = req.query;
    if (error) {
      const errCode = String(error);
      return res.redirect(`${env.clientUrl}${returnTo}?error=${encodeURIComponent(errCode)}`);
    }
    if (!code || !env.googleClientId || !env.googleClientSecret) {
      return res.redirect(`${env.clientUrl}${returnTo}?error=oauth`);
    }

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: String(code),
        client_id: env.googleClientId,
        client_secret: env.googleClientSecret,
        redirect_uri: env.googleRedirectUri,
        grant_type: 'authorization_code',
      }),
    });

    const tokens = await tokenRes.json() as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      error?: string;
      error_description?: string;
    };

    if (!tokens.access_token) {
      const googleError = tokens.error || 'unknown';
      const googleDetail = tokens.error_description || '';
      console.error('Google token exchange failed:', googleError, googleDetail);
      const params = new URLSearchParams({
        error: 'oauth_token',
        google_error: googleError,
      });
      if (googleDetail) params.set('detail', googleDetail);
      return res.redirect(`${env.clientUrl}${returnTo}?${params.toString()}`);
    }

    const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const profile = await profileRes.json() as {
      email?: string;
      name?: string;
      id?: string;
      picture?: string;
    };

    if (!profile.email) {
      return res.redirect(`${env.clientUrl}${returnTo}?error=oauth_profile`);
    }

    const normalizedEmail = profile.email.trim().toLowerCase();

    // Identity check ONLY after Google confirms email (PostgreSQL lookup).
    const existingUser = await getUserByEmail(normalizedEmail);
    const isReturningUser = !!existingUser?.googleRefreshToken;

    const user = await findOrCreateUser(
      normalizedEmail,
      profile.name || normalizedEmail.split('@')[0],
      profile.id,
      profile.picture
    );

    await saveGoogleOAuthTokens(user.id, {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresIn: tokens.expires_in,
    });

    const updatedUser = await getMe(user.id);

    // New users only: retry once with consent to obtain refresh_token.
    // Returning users with stored refresh token skip this (token preserved above).
    if (requestedAdsScope && !updatedUser?.googleRefreshToken && !isReturningUser) {
      if (!consentRequested) {
        const retryParams = new URLSearchParams({
          returnTo,
          ads: 'true',
          consent: 'true',
          login_hint: normalizedEmail,
        });
        return res.redirect(`${apiBaseUrl()}/api/auth/google?${retryParams}`);
      }
      console.error(`New user ${profile.email} missing Google Ads refresh token after consent`);
      return res.redirect(`${env.clientUrl}${returnTo}?error=missing_ads_consent`);
    }

    if (requestedAdsScope && !updatedUser?.googleRefreshToken && isReturningUser) {
      console.error(`Returning user ${profile.email} refresh token invalid — re-grant required`);
      return res.redirect(`${env.clientUrl}${returnTo}?error=missing_ads_consent`);
    }

    if (isReturningUser) {
      console.log(`✓ Returning user (PostgreSQL): ${profile.email}`);
    } else {
      console.log(`✓ New user stored (PostgreSQL): ${profile.email}`);
    }

    const token = signToken({ userId: user.id, email: user.email });
    const redirectParams = new URLSearchParams({ token });
    if (isReturningUser) redirectParams.set('returning', '1');
    res.redirect(`${env.clientUrl}${returnTo}?${redirectParams.toString()}`);
  } catch (err) {
    console.error('Google OAuth callback error:', err);
    res.redirect(`${env.clientUrl}${returnTo}?error=oauth`);
  }
});

/**
 * Optional utility — NOT used before OAuth redirect.
 * User identity is confirmed by Google first; see /google/callback.
 */
router.post('/check-user', optionalAuth, async (req: AuthRequest, res: Response) => {
  const bodyEmail =
    typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : undefined;

  let user: Awaited<ReturnType<typeof getMe>> | undefined;

  if (bodyEmail) {
    user = await getUserByEmail(bodyEmail);
  } else if (req.authUser) {
    user = await getMe(req.authUser.userId);
  }

  if (!user) {
    return res.json({
      success: false,
      existingUser: false,
      requiresOAuth: true,
    });
  }

  if (!user.googleRefreshToken) {
    return res.json({
      success: false,
      existingUser: true,
      requiresOAuth: true,
      reason: 'no_refresh_token',
    });
  }

  const accessToken = await getGoogleAccessTokenForUser(user.id);
  if (!accessToken) {
    return res.json({
      success: false,
      existingUser: true,
      requiresOAuth: true,
      reason: 'refresh_failed',
    });
  }

  const adsResult = await getGoogleAdsAccountsForUser(user.googleRefreshToken, user.id);
  const token = signToken({ userId: user.id, email: user.email });

  console.log(`✓ Instant login (PostgreSQL): ${user.email}`);

  res.json({
    success: true,
    existingUser: true,
    requiresOAuth: false,
    token,
    user: sanitizeUser(user),
    accounts: adsResult.accounts,
    accountsSource: adsResult.source,
    accountsReason: adsResult.reason,
    accountsErrorDetail: adsResult.errorMessage,
  });
});

/** @deprecated Use POST /check-user — kept for compatibility */
router.post('/google/silent-connect', authMiddleware, async (req: AuthRequest, res: Response) => {
  const user = await getMe(req.authUser!.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  if (!user.googleRefreshToken) {
    return res.status(401).json({
      error: 'no_google_ads_access',
      message: 'No linked Google Ads account — full OAuth required',
    });
  }

  const accessToken = await getGoogleAccessTokenForUser(user.id);
  if (!accessToken) {
    return res.status(401).json({
      error: 'google_token_expired',
      message: 'Stored Google session expired — full sign-in required',
    });
  }

  console.log(`✓ Silent reconnect (PostgreSQL): ${user.email}`);
  res.json({
    user: sanitizeUser(user),
    hasGoogleAdsAccess: true,
    isReturningUser: true,
    verified: true,
  });
});

router.post('/login', async (req, res) => {
  const { email, name } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });

  const user = await findOrCreateUser(email, name || email.split('@')[0]);
  const token = signToken({ userId: user.id, email: user.email });
  res.json({ token, user: sanitizeUser(user) });
});

router.get('/me', authMiddleware, async (req: AuthRequest, res: Response) => {
  const user = await getMe(req.authUser!.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const hasGoogleAdsAccess = !!user.googleRefreshToken;

  // Confirm refresh token still works (silent refresh) for returning users.
  let sessionValid = false;
  if (hasGoogleAdsAccess) {
    sessionValid = !!(await getGoogleAccessTokenForUser(user.id));
  }

  res.json({
    user: sanitizeUser(user),
    hasGoogleAdsAccess,
    isReturningUser: hasGoogleAdsAccess,
    sessionValid,
    authenticated: true,
  });
});

router.get('/session', authMiddleware, async (req: AuthRequest, res: Response) => {
  const user = await getMe(req.authUser!.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const hasGoogleAdsAccess = !!user.googleRefreshToken;
  res.json({
    authenticated: true,
    hasGoogleAdsAccess,
    isReturningUser: hasGoogleAdsAccess,
    user: sanitizeUser(user),
  });
});

router.get('/config', (_req, res) => {
  res.json({
    googleOAuth: !!(env.googleClientId && env.googleClientSecret),
    googleAds: !!(env.googleAdsDeveloperToken && env.googleClientId && env.googleClientSecret),
    anthropic: !!(env.anthropicApiKey || env.anthropicParallelKeys.length),
    anthropicParallelKeys: env.anthropicParallelKeys.length,
    mockData: env.useMockData,
    database: !!env.databaseUrl,
    redirectUri: env.googleRedirectUri,
    oauthApiBase: apiBaseUrl(),
    authorizedOrigins: [env.clientUrl, `http://localhost:${env.port}`],
  });
});

router.get('/oauth-setup', (_req, res) => {
  res.json({
    clientId: env.googleClientId ? `${env.googleClientId.slice(0, 12)}...` : null,
    redirectUri: env.googleRedirectUri,
    googleAdsConfigured: !!env.googleAdsDeveloperToken,
    consentScreenUrl: 'https://console.cloud.google.com/apis/credentials/consent',
    instructions: {
      howItWorks: {
        title: 'How Google Ads access works',
        points: [
          'Click Continue with Google — you pick your Gmail account at Google.',
          'After Google confirms your email, we check PostgreSQL for an existing account.',
          'Returning users: welcome back + your Ads accounts (no repeated permissions if refresh token valid).',
          'New users: complete OTP + permissions once; tokens saved in PostgreSQL.',
        ],
      },
      addTestUsers: {
        title: 'Fix "Access blocked" / Error 403 access_denied (Testing mode)',
        steps: [
          'Open Google Cloud Console → APIs & Services → OAuth consent screen',
          'Confirm Publishing status is "Testing" (default for new apps)',
          'Scroll to Test users → click ADD USERS',
          'Add every Gmail that needs to sign in (e.g. nitishanaga127@gmail.com, analytics@ctanalytics.net.au)',
          'Save and wait ~1 minute, then retry Continue with Google in AdAudit Pro',
        ],
      },
      publishApp: {
        title: 'Allow any user to sign in (no per-user test list)',
        steps: [
          'Open Google Cloud Console → APIs & Services → OAuth consent screen',
          'Complete app name, support email, and scopes (include Google Ads API)',
          'Click "PUBLISH APP" to move from Testing → Production',
          'Any Google user can then grant permission to their own Google Ads accounts',
          'Google Ads API scope may require app verification for production use',
        ],
      },
      redirectUris: [
        env.googleRedirectUri,
        `${env.clientUrl}/api/auth/google/callback`,
        'http://127.0.0.1:5000/api/auth/google/callback',
        'http://127.0.0.1:5173/api/auth/google/callback',
      ],
    },
  });
});

router.post('/logout', (_req, res) => {
  res.json({ success: true });
});

export default router;
