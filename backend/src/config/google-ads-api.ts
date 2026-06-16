/** Newest first — v20 sunset June 10, 2026; v19 already retired. */
export const GOOGLE_ADS_API_VERSIONS = ['v24', 'v23', 'v22', 'v21'] as const;

export type GoogleAdsApiVersion = (typeof GOOGLE_ADS_API_VERSIONS)[number];

/** True when the caller should try the next API version (404, sunset, deprecated). */
export function isRetryableGoogleAdsVersionError(status: number, body: string): boolean {
  if (status === 404) return true;
  if (status !== 400) return false;
  return (
    body.includes('UNSUPPORTED_VERSION') ||
    body.includes('deprecated') ||
    body.includes('will be blocked')
  );
}
