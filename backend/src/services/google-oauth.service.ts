import { env } from '../config/env.js';
import { updateUser, getMe } from './user.service.js';

export interface GoogleTokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
}

const EXPIRY_BUFFER_MS = 60_000;

export async function saveGoogleOAuthTokens(userId: string, tokens: GoogleTokenSet): Promise<void> {
  const partial: {
    googleAccessToken?: string;
    googleRefreshToken?: string;
    googleTokenExpiry?: string;
  } = {};

  if (tokens.accessToken) {
    partial.googleAccessToken = tokens.accessToken;
    const expiresIn = tokens.expiresIn ?? 3600;
    partial.googleTokenExpiry = new Date(Date.now() + expiresIn * 1000).toISOString();
  }

  if (tokens.refreshToken) {
    partial.googleRefreshToken = tokens.refreshToken;
  }

  await updateUser(userId, partial);
}

export async function refreshGoogleAccessToken(
  refreshToken: string
): Promise<{ accessToken: string; expiresIn: number } | null> {
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.googleClientId,
      client_secret: env.googleClientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  const tokens = await tokenRes.json() as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };

  if (!tokens.access_token) {
    console.error('Failed to refresh Google access token:', tokens.error, tokens.error_description);
    return null;
  }

  return {
    accessToken: tokens.access_token,
    expiresIn: tokens.expires_in ?? 3600,
  };
}

function accessTokenStillValid(expiryIso?: string): boolean {
  if (!expiryIso) return false;
  const expiry = new Date(expiryIso).getTime();
  return expiry - Date.now() > EXPIRY_BUFFER_MS;
}

/** Returns a valid Google access token, refreshing silently via stored refresh_token when needed. */
export async function getGoogleAccessTokenForUser(userId: string): Promise<string | null> {
  const user = await getMe(userId);
  if (!user?.googleRefreshToken) return null;

  if (user.googleAccessToken && accessTokenStillValid(user.googleTokenExpiry)) {
    return user.googleAccessToken;
  }

  const refreshed = await refreshGoogleAccessToken(user.googleRefreshToken);
  if (!refreshed) return null;

  await saveGoogleOAuthTokens(userId, {
    accessToken: refreshed.accessToken,
    expiresIn: refreshed.expiresIn,
  });

  return refreshed.accessToken;
}

/** Legacy helper — refresh by refresh token string directly (updates user if userId provided). */
export async function getAccessTokenFromRefreshToken(
  refreshToken: string,
  userId?: string
): Promise<string | null> {
  const refreshed = await refreshGoogleAccessToken(refreshToken);
  if (!refreshed) return null;

  if (userId) {
    await saveGoogleOAuthTokens(userId, {
      accessToken: refreshed.accessToken,
      expiresIn: refreshed.expiresIn,
    });
  }

  return refreshed.accessToken;
}
