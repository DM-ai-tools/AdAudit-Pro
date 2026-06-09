import { Router, Response } from 'express';
import { env } from '../config/env.js';
import { signToken } from '../utils/jwt.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';
import { findOrCreateUser, getMe, saveUserGoogleTokens } from '../services/audit.service.js';

const router = Router();

const GOOGLE_ADS_SCOPE = 'https://www.googleapis.com/auth/adwords';

function encodeState(returnTo: string, ads: boolean): string {
  return Buffer.from(JSON.stringify({ returnTo, ads })).toString('base64url');
}

function decodeState(state: string): { returnTo: string; ads: boolean } {
  try {
    const parsed = JSON.parse(Buffer.from(state, 'base64url').toString('utf-8'));
    const returnTo = typeof parsed.returnTo === 'string' ? parsed.returnTo : '/login';
    return {
      returnTo: returnTo.startsWith('/') ? returnTo : '/login',
      ads: !!parsed.ads,
    };
  } catch {
    return { returnTo: '/login', ads: false };
  }
}

function buildGoogleScopes(includeAds: boolean): string {
  const scopes = ['openid', 'email', 'profile'];
  if (includeAds) scopes.push(GOOGLE_ADS_SCOPE);
  return scopes.join(' ');
}

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
  const state = encodeState(returnTo, includeAds);

  const params = new URLSearchParams({
    client_id: env.googleClientId,
    redirect_uri: env.googleRedirectUri,
    response_type: 'code',
    scope: buildGoogleScopes(includeAds),
    access_type: 'offline',
    prompt: 'consent',
    state,
  });

  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

router.get('/google/callback', async (req, res) => {
  const oauthState = req.query.state
    ? decodeState(String(req.query.state))
    : { returnTo: '/login', ads: false };
  const { returnTo, ads: requestedAdsScope } = oauthState;

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

    const user = await findOrCreateUser(
      profile.email,
      profile.name || profile.email.split('@')[0],
      profile.id,
      profile.picture
    );

    if (tokens.refresh_token) {
      saveUserGoogleTokens(user.id, tokens.refresh_token);
    }

    const updatedUser = getMe(user.id);
    if (requestedAdsScope && !updatedUser?.googleRefreshToken) {
      return res.redirect(`${env.clientUrl}${returnTo}?error=missing_ads_consent`);
    }

    const token = signToken({ userId: user.id, email: user.email });
    res.redirect(`${env.clientUrl}${returnTo}?token=${encodeURIComponent(token)}`);
  } catch (err) {
    console.error('Google OAuth callback error:', err);
    res.redirect(`${env.clientUrl}${returnTo}?error=oauth`);
  }
});

router.post('/login', async (req, res) => {
  const { email, name } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });

  const user = await findOrCreateUser(email, name || email.split('@')[0]);
  const token = signToken({ userId: user.id, email: user.email });
  res.json({ token, user });
});

router.get('/me', authMiddleware, (req: AuthRequest, res: Response) => {
  const user = getMe(req.authUser!.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const { googleRefreshToken: _, ...safeUser } = user;
  res.json({ user: safeUser, hasGoogleAdsAccess: !!user.googleRefreshToken });
});

router.get('/config', (_req, res) => {
  res.json({
    googleOAuth: !!(env.googleClientId && env.googleClientSecret),
    googleAds: !!(env.googleAdsDeveloperToken && env.googleClientId && env.googleClientSecret),
    anthropic: !!env.anthropicApiKey,
    mockData: env.useMockData,
    redirectUri: env.googleRedirectUri,
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
          'Your developer token identifies AdAudit Pro as an approved API application.',
          'Each user must click "Continue with Google" and grant Google Ads permission.',
          'API calls use BOTH your developer token AND that user\'s OAuth token.',
          'Google only returns data for accounts that user owns or manages — never random accounts.',
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
