import { env } from '../config/env.js';
import { MOCK_GOOGLE_ADS_ACCOUNTS } from '../data/google-ads-accounts.js';

/** Try newest first; v19 is not a valid Google Ads API version (returns 404) */
const GOOGLE_ADS_API_VERSIONS = ['v20', 'v18', 'v17'];
let resolvedApiVersion: string | null = null;

export interface GoogleAdsAccountDto {
  id: string;
  customerId: string;
  name: string;
  currency: string;
  timezone: string;
  accountType: string;
  monthlySpend: number;
}

export function isGoogleAdsConfigured(): boolean {
  return !!(env.googleClientId && env.googleClientSecret && env.googleAdsDeveloperToken);
}

function formatCustomerId(resourceName: string): string {
  const id = resourceName.replace('customers/', '').replace(/-/g, '');
  if (id.length === 10) {
    return `${id.slice(0, 3)}-${id.slice(3, 6)}-${id.slice(6)}`;
  }
  return id;
}

function bareCustomerId(resourceName: string): string {
  return resourceName.replace('customers/', '').replace(/-/g, '');
}

function parseGoogleAdsError(body: string, status: number): string {
  try {
    const json = JSON.parse(body) as {
      error?: { message?: string; status?: string; details?: Array<{ message?: string }> };
    };
    const msg = json.error?.message;
    if (msg) {
      if (msg.includes('DEVELOPER_TOKEN') || json.error?.status === 'PERMISSION_DENIED') {
        return `${msg} Apply for a developer token in Google Ads → Tools → API Center (Test access works with your own accounts).`;
      }
      return msg;
    }
  } catch {
    /* not JSON */
  }
  if (body.includes('404') || status === 404) {
    return 'Google Ads API endpoint not found — check API version configuration.';
  }
  return `Google Ads API error (HTTP ${status})`;
}

async function getAccessToken(refreshToken: string): Promise<string | null> {
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
    error?: string;
    error_description?: string;
  };

  if (!tokens.access_token) {
    console.error('Failed to refresh Google access token:', tokens.error, tokens.error_description);
    return null;
  }
  return tokens.access_token;
}

function googleAdsHeaders(accessToken: string): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'developer-token': env.googleAdsDeveloperToken,
    'Content-Type': 'application/json',
  };
  if (env.googleAdsManagerAccountId) {
    headers['login-customer-id'] = env.googleAdsManagerAccountId.replace(/-/g, '');
  }
  return headers;
}

async function listAccessibleCustomerResourceNames(
  accessToken: string
): Promise<{ resourceNames: string[] | null; error?: string; apiVersion?: string }> {
  const versions = resolvedApiVersion
    ? [resolvedApiVersion, ...GOOGLE_ADS_API_VERSIONS.filter((v) => v !== resolvedApiVersion)]
    : GOOGLE_ADS_API_VERSIONS;

  for (const version of versions) {
    const res = await fetch(
      `https://googleads.googleapis.com/${version}/customers:listAccessibleCustomers`,
      { headers: googleAdsHeaders(accessToken) }
    );

    if (res.status === 404) {
      console.warn(`Google Ads API ${version} not available, trying next version...`);
      continue;
    }

    const body = await res.text();
    if (!res.ok) {
      console.error(`listAccessibleCustomers failed (${version}):`, res.status, body);
      return { resourceNames: null, error: parseGoogleAdsError(body, res.status) };
    }

    resolvedApiVersion = version;
    const data = JSON.parse(body) as { resourceNames?: string[] };
    console.log(`✓ Google Ads API ${version} — found ${data.resourceNames?.length ?? 0} accessible account(s)`);
    return { resourceNames: data.resourceNames ?? [], apiVersion: version };
  }

  return {
    resourceNames: null,
    error: 'No supported Google Ads API version responded. Enable Google Ads API in Cloud Console.',
  };
}

function getApiVersion(): string {
  return resolvedApiVersion ?? GOOGLE_ADS_API_VERSIONS[0];
}

async function searchCustomer<T>(
  accessToken: string,
  customerId: string,
  query: string
): Promise<T[]> {
  const version = getApiVersion();
  const res = await fetch(
    `https://googleads.googleapis.com/${version}/customers/${bareCustomerId(customerId)}/googleAds:search`,
    {
      method: 'POST',
      headers: googleAdsHeaders(accessToken),
      body: JSON.stringify({ query }),
    }
  );

  if (!res.ok) {
    const body = await res.text();
    console.warn(`Google Ads search failed for ${customerId}:`, res.status, body.slice(0, 300));
    return [];
  }

  const data = await res.json() as { results?: T[] };
  return data.results ?? [];
}

function accountFromResourceName(resourceName: string): GoogleAdsAccountDto {
  const customerId = bareCustomerId(resourceName);
  return {
    id: `gads_${customerId}`,
    customerId: formatCustomerId(resourceName),
    name: `Google Ads ${formatCustomerId(resourceName)}`,
    currency: 'USD',
    timezone: 'UTC',
    accountType: 'Standard',
    monthlySpend: 0,
  };
}

export async function listGoogleAdsAccounts(
  refreshToken: string
): Promise<{ accounts: GoogleAdsAccountDto[] | null; error?: string }> {
  if (!isGoogleAdsConfigured() || !refreshToken) {
    return { accounts: null, error: 'Google Ads credentials or user OAuth token missing.' };
  }

  try {
    const accessToken = await getAccessToken(refreshToken);
    if (!accessToken) {
      return { accounts: null, error: 'Could not refresh Google access token. Reconnect your Google account.' };
    }

    const { resourceNames, error } = await listAccessibleCustomerResourceNames(accessToken);
    if (resourceNames === null) {
      return { accounts: null, error: error ?? 'Failed to list Google Ads accounts.' };
    }
    if (!resourceNames.length) {
      return { accounts: [] };
    }

    const accounts: GoogleAdsAccountDto[] = [];

    for (const resourceName of resourceNames) {
      const customerId = bareCustomerId(resourceName);
      try {
        const [infoRow] = await searchCustomer<{
          customer?: {
            descriptiveName?: string;
            currencyCode?: string;
            timeZone?: string;
            manager?: boolean;
          };
        }>(
          accessToken,
          customerId,
          `SELECT customer.id, customer.descriptive_name, customer.currency_code,
                  customer.time_zone, customer.manager FROM customer LIMIT 1`
        );

        const customer = infoRow?.customer;
        const base = accountFromResourceName(resourceName);

        let monthlySpend = 0;
        const [metricsRow] = await searchCustomer<{
          metrics?: { costMicros?: string };
        }>(
          accessToken,
          customerId,
          `SELECT metrics.cost_micros FROM customer
           WHERE segments.date DURING LAST_30_DAYS LIMIT 1`
        );
        if (metricsRow?.metrics?.costMicros) {
          monthlySpend = Math.round(Number(metricsRow.metrics.costMicros) / 1_000_000);
        }

        accounts.push({
          ...base,
          name: customer?.descriptiveName || base.name,
          currency: customer?.currencyCode || base.currency,
          timezone: customer?.timeZone || base.timezone,
          accountType: customer?.manager ? 'Manager' : 'Standard',
          monthlySpend,
        });
      } catch (err) {
        console.warn(`Skipping customer ${customerId}:`, err instanceof Error ? err.message : err);
        accounts.push(accountFromResourceName(resourceName));
      }
    }

    return { accounts };
  } catch (err) {
    console.error('Google Ads API list accounts failed:', err);
    return { accounts: null, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

export type GoogleAdsAccountsReason =
  | 'live'
  | 'missing_refresh_token'
  | 'not_configured'
  | 'api_error'
  | 'no_accounts'
  | 'mock_mode';

export interface GoogleAdsAccountsResult {
  accounts: GoogleAdsAccountDto[];
  source: 'google_ads_api' | 'mock';
  reason: GoogleAdsAccountsReason;
  errorMessage?: string;
}

export async function getGoogleAdsAccountsForUser(
  refreshToken?: string
): Promise<GoogleAdsAccountsResult> {
  if (!isGoogleAdsConfigured()) {
    if (env.useMockData) {
      return { accounts: MOCK_GOOGLE_ADS_ACCOUNTS, source: 'mock', reason: 'mock_mode' };
    }
    return { accounts: [], source: 'mock', reason: 'not_configured' };
  }

  if (!refreshToken) {
    return { accounts: [], source: 'google_ads_api', reason: 'missing_refresh_token' };
  }

  const { accounts, error } = await listGoogleAdsAccounts(refreshToken);
  if (accounts === null) {
    return {
      accounts: [],
      source: 'google_ads_api',
      reason: 'api_error',
      errorMessage: error,
    };
  }
  if (!accounts.length) {
    return { accounts: [], source: 'google_ads_api', reason: 'no_accounts' };
  }
  return { accounts, source: 'google_ads_api', reason: 'live' };
}

export interface AccountInsights {
  accountName: string;
  currency: string;
  timezone: string;
  activeCampaigns: number;
  channelTypes: Set<string>;
  spend30Days: number;
  spend90Days: number;
  spend365Days: number;
  conversionActions: number;
  landingPageCount: number;
}

async function querySpend(
  accessToken: string,
  customerId: string,
  window: string
): Promise<number> {
  const [row] = await searchCustomer<{ metrics?: { costMicros?: string } }>(
    accessToken,
    customerId,
    `SELECT metrics.cost_micros FROM customer WHERE segments.date DURING ${window}`
  );
  return Math.round(Number(row?.metrics?.costMicros ?? 0) / 1_000_000);
}

export async function fetchAccountInsights(
  refreshToken: string,
  customerId: string
): Promise<AccountInsights | null> {
  try {
    const accessToken = await getAccessToken(refreshToken);
    if (!accessToken) return null;

    // Ensure API version is resolved
    await listAccessibleCustomerResourceNames(accessToken);

    const [infoRow] = await searchCustomer<{
      customer?: {
        descriptiveName?: string;
        currencyCode?: string;
        timeZone?: string;
      };
    }>(
      accessToken,
      customerId,
      `SELECT customer.descriptive_name, customer.currency_code, customer.time_zone FROM customer LIMIT 1`
    );

    const campaignRows = await searchCustomer<{
      campaign?: { advertisingChannelType?: string; status?: string };
    }>(
      accessToken,
      customerId,
      `SELECT campaign.advertising_channel_type, campaign.status
       FROM campaign
       WHERE campaign.status IN ('ENABLED', 'PAUSED')`
    );

    const channelTypes = new Set<string>();
    let activeCampaigns = 0;
    for (const row of campaignRows) {
      const type = row.campaign?.advertisingChannelType;
      const status = row.campaign?.status;
      if (type) channelTypes.add(type);
      if (status === 'ENABLED') activeCampaigns++;
    }

    const [spend30Days, spend90Days, spend365Days] = await Promise.all([
      querySpend(accessToken, customerId, 'LAST_30_DAYS'),
      querySpend(accessToken, customerId, 'LAST_90_DAYS'),
      querySpend(accessToken, customerId, 'LAST_365_DAYS'),
    ]);

    const conversionRows = await searchCustomer<{ conversionAction?: { status?: string } }>(
      accessToken,
      customerId,
      `SELECT conversion_action.status FROM conversion_action WHERE conversion_action.status = 'ENABLED'`
    );

    const landingRows = await searchCustomer<{
      adGroupAd?: { ad?: { finalUrls?: string[] } };
    }>(
      accessToken,
      customerId,
      `SELECT ad_group_ad.ad.final_urls FROM ad_group_ad
       WHERE ad_group_ad.status = 'ENABLED' AND campaign.status = 'ENABLED'
       LIMIT 50`
    );

    const landingUrls = new Set<string>();
    for (const row of landingRows) {
      for (const url of row.adGroupAd?.ad?.finalUrls ?? []) {
        landingUrls.add(url);
      }
    }

    return {
      accountName: infoRow?.customer?.descriptiveName ?? '',
      currency: infoRow?.customer?.currencyCode ?? 'USD',
      timezone: infoRow?.customer?.timeZone ?? 'UTC',
      activeCampaigns,
      channelTypes,
      spend30Days,
      spend90Days,
      spend365Days,
      conversionActions: conversionRows.length,
      landingPageCount: landingUrls.size,
    };
  } catch (err) {
    console.error('fetchAccountInsights failed:', err);
    return null;
  }
}

export async function fetchModuleGoogleAdsData(
  refreshToken: string,
  customerId: string,
  slug: string,
  dateRange: string
): Promise<string> {
  const { MODULE_GAQL } = await import('../audit-engine/module-queries.js');
  const queryFn = MODULE_GAQL[slug];
  if (!queryFn) {
    return JSON.stringify({ note: `No GAQL query configured for module ${slug}` });
  }

  try {
    const accessToken = await getAccessToken(refreshToken);
    if (!accessToken) return '';

    await listAccessibleCustomerResourceNames(accessToken);
    const rows = await searchCustomer<Record<string, unknown>>(
      accessToken,
      customerId,
      queryFn(dateRange)
    );
    return JSON.stringify(rows.slice(0, 25), null, 0);
  } catch (err) {
    console.warn(`fetchModuleGoogleAdsData(${slug}) failed:`, err);
    return '';
  }
}
