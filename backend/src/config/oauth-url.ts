import type { Request } from 'express';
import { env } from './env.js';

function hostFromRequest(req: Request): { origin: string; host: string } | null {
  const host = req.get('x-forwarded-host')?.split(',')[0]?.trim() || req.get('host')?.trim();
  if (!host || /^localhost(:\d+)?$/i.test(host) || host.startsWith('127.0.0.1')) {
    return null;
  }
  const proto = req.get('x-forwarded-proto')?.split(',')[0]?.trim() || 'https';
  return { host, origin: `${proto}://${host}` };
}

/** OAuth callback URL — must match Google Cloud Console Authorized redirect URIs exactly. */
export function resolveOAuthRedirectUri(req?: Request): string {
  const explicit = (process.env.GOOGLE_REDIRECT_URI || '').trim();
  if (explicit) return explicit;

  if (req && env.isProduction) {
    const fromReq = hostFromRequest(req);
    if (fromReq) return `${fromReq.origin}/api/auth/google/callback`;
  }

  return env.googleRedirectUri;
}

/** Public API origin used to start OAuth (same host the user opened in the browser). */
export function resolveOAuthApiBase(req?: Request): string {
  if (req && env.isProduction) {
    const fromReq = hostFromRequest(req);
    if (fromReq) return fromReq.origin;
  }

  if (env.railwayPublicDomain) return `https://${env.railwayPublicDomain}`;
  return env.clientUrl.replace(/\/$/, '');
}
