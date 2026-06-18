/** API origin without trailing slash, e.g. http://localhost:5001 */
export function getApiOrigin(): string {
  const fromEnv = import.meta.env.VITE_API_URL?.replace(/\/$/, '');
  if (fromEnv) return fromEnv.replace(/\/api\/?$/, '');

  if (import.meta.env.DEV) {
    const port = import.meta.env.VITE_API_PORT || '5001';
    return `http://localhost:${port}`;
  }

  return '';
}

/** Axios baseURL — always ends with /api */
export function getApiBaseUrl(): string {
  const origin = getApiOrigin();
  return origin ? `${origin}/api` : '/api';
}

/** True when response looks like AdAudit Pro (not another app on the same port). */
export function isAdAuditHealthPayload(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false;
  const d = data as { status?: string; version?: string; success?: boolean };
  if (d.success === false) return false;
  return d.status === 'ok' || d.status === 'degraded' || typeof d.version === 'string';
}
