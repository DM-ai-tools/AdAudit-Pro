import { env } from '../config/env.js';
import {
  GOOGLE_ADS_API_VERSIONS,
  isRetryableGoogleAdsVersionError,
} from '../config/google-ads-api.js';
import { MOCK_GOOGLE_ADS_ACCOUNTS } from '../data/google-ads-accounts.js';
import {
  getAccessTokenFromRefreshToken,
  getGoogleAccessTokenForUser,
} from './google-oauth.service.js';

/** Try newest first; sunset versions fall through automatically. */
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

async function resolveAccessToken(refreshToken: string, userId?: string): Promise<string | null> {
  if (userId) {
    const token = await getGoogleAccessTokenForUser(userId);
    if (token) return token;
  }
  return getAccessTokenFromRefreshToken(refreshToken, userId);
}

function googleAdsHeaders(
  accessToken: string,
  loginCustomerId?: string
): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'developer-token': env.googleAdsDeveloperToken,
    'Content-Type': 'application/json',
  };
  const loginId =
    loginCustomerId?.replace(/-/g, '') ||
    env.googleAdsManagerAccountId?.replace(/-/g, '');
  if (loginId) {
    headers['login-customer-id'] = loginId;
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

    const body = await res.text();

    if (isRetryableGoogleAdsVersionError(res.status, body)) {
      console.warn(`Google Ads API ${version} not available, trying next version...`);
      if (resolvedApiVersion === version) resolvedApiVersion = null;
      continue;
    }

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

async function searchCustomer<T>(
  accessToken: string,
  customerId: string,
  query: string,
  options?: { loginCustomerId?: string; silent?: boolean }
): Promise<T[]> {
  const bareId = bareCustomerId(customerId);
  const loginId = options?.loginCustomerId?.replace(/-/g, '');

  const versions = resolvedApiVersion
    ? [resolvedApiVersion, ...GOOGLE_ADS_API_VERSIONS.filter((v) => v !== resolvedApiVersion)]
    : [...GOOGLE_ADS_API_VERSIONS];

  for (const version of versions) {
    const res = await fetch(
      `https://googleads.googleapis.com/${version}/customers/${bareId}/googleAds:search`,
      {
        method: 'POST',
        headers: googleAdsHeaders(accessToken, loginId),
        body: JSON.stringify({ query }),
      }
    );

    const body = await res.text();

    if (isRetryableGoogleAdsVersionError(res.status, body)) {
      if (resolvedApiVersion === version) resolvedApiVersion = null;
      continue;
    }

    if (!res.ok) {
      if (!options?.silent) {
        if (res.status !== 403 && res.status !== 400) {
          console.warn(`Google Ads search failed for ${bareId}:`, res.status, body.slice(0, 200));
        }
      }
      return [];
    }

    resolvedApiVersion = version;
    const data = JSON.parse(body) as { results?: T[] };
    return data.results ?? [];
  }

  return [];
}

/** Sum spend for a date window — requires segments.date in SELECT when filtering by date. */
async function querySpend(
  accessToken: string,
  customerId: string,
  window: string,
  loginCustomerId?: string
): Promise<number> {
  const rows = await searchCustomer<{
    metrics?: { costMicros?: string };
  }>(
    accessToken,
    customerId,
    `SELECT metrics.cost_micros, segments.date
     FROM customer
     WHERE segments.date DURING ${window}`,
    { loginCustomerId, silent: true }
  );
  const totalMicros = rows.reduce(
    (sum, row) => sum + Number(row.metrics?.costMicros ?? 0),
    0
  );
  return Math.round(totalMicros / 1_000_000);
}

async function getCustomerMeta(
  accessToken: string,
  customerId: string,
  loginCustomerId?: string
): Promise<{
  descriptiveName?: string;
  currencyCode?: string;
  timeZone?: string;
  manager?: boolean;
} | null> {
  const [row] = await searchCustomer<{
    customer?: {
      descriptiveName?: string;
      currencyCode?: string;
      timeZone?: string;
      manager?: boolean;
    };
  }>(
    accessToken,
    customerId,
    `SELECT customer.descriptive_name, customer.currency_code,
            customer.time_zone, customer.manager
     FROM customer LIMIT 1`,
    { loginCustomerId, silent: true }
  );
  return row?.customer ?? null;
}

/** Client account names under an MCC — used when direct customer queries return no metadata. */
async function listManagedClientMeta(
  accessToken: string,
  managerCustomerId: string
): Promise<Map<string, {
  descriptiveName?: string;
  currencyCode?: string;
  timeZone?: string;
}>> {
  const map = new Map<string, {
    descriptiveName?: string;
    currencyCode?: string;
    timeZone?: string;
  }>();

  const rows = await searchCustomer<{
    customerClient?: {
      clientCustomer?: string;
      descriptiveName?: string;
      currencyCode?: string;
      timeZone?: string;
      level?: number;
      manager?: boolean;
    };
  }>(
    accessToken,
    managerCustomerId,
    `SELECT customer_client.client_customer, customer_client.descriptive_name,
            customer_client.currency_code, customer_client.time_zone,
            customer_client.level, customer_client.manager
     FROM customer_client`,
    { silent: true }
  );

  for (const row of rows) {
    const cc = row.customerClient;
    if (!cc?.clientCustomer || cc.manager) continue;
    const id = bareCustomerId(cc.clientCustomer);
    map.set(id, {
      descriptiveName: cc.descriptiveName,
      currencyCode: cc.currencyCode,
      timeZone: cc.timeZone,
    });
  }

  return map;
}

async function resolveManagerCustomerId(
  accessToken: string,
  resourceNames?: string[]
): Promise<string | undefined> {
  const fromEnv = env.googleAdsManagerAccountId?.replace(/-/g, '');
  if (fromEnv) return fromEnv;

  const names =
    resourceNames ??
    (await listAccessibleCustomerResourceNames(accessToken)).resourceNames ??
    [];

  for (const resourceName of names) {
    const id = bareCustomerId(resourceName);
    const meta = await getCustomerMeta(accessToken, id);
    if (meta?.manager) return id;
  }
  return undefined;
}

function loginCustomerIdForTarget(
  targetCustomerId: string,
  managerCustomerId?: string
): string | undefined {
  const bare = bareCustomerId(targetCustomerId);
  if (!managerCustomerId || bare === managerCustomerId) return undefined;
  return managerCustomerId;
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
  refreshToken: string,
  userId?: string
): Promise<{ accounts: GoogleAdsAccountDto[] | null; error?: string }> {
  if (!isGoogleAdsConfigured() || !refreshToken) {
    return { accounts: null, error: 'Google Ads credentials or user OAuth token missing.' };
  }

  try {
    const accessToken = await resolveAccessToken(refreshToken, userId);
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
    const managerCustomerId = await resolveManagerCustomerId(accessToken, resourceNames);
    const managedClientMeta = managerCustomerId
      ? await listManagedClientMeta(accessToken, managerCustomerId)
      : new Map();

    for (const resourceName of resourceNames) {
      const customerId = bareCustomerId(resourceName);
      try {
        const loginId = loginCustomerIdForTarget(customerId, managerCustomerId);

        let customer = await getCustomerMeta(accessToken, customerId, loginId);
        const managed = managedClientMeta.get(customerId);
        if (!customer?.descriptiveName && managed) {
          customer = { ...customer, ...managed, manager: false };
        }
        const base = accountFromResourceName(resourceName);

        let monthlySpend = 0;
        // Skip spend metrics on manager accounts — query client accounts instead
        if (!customer?.manager) {
          monthlySpend = await querySpend(
            accessToken,
            customerId,
            'LAST_30_DAYS',
            loginId
          );
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

    accounts.sort((a, b) => {
      const aManager = a.accountType === 'Manager' ? 1 : 0;
      const bManager = b.accountType === 'Manager' ? 1 : 0;
      if (aManager !== bManager) return aManager - bManager;
      const aGeneric = a.name.startsWith('Google Ads ') ? 1 : 0;
      const bGeneric = b.name.startsWith('Google Ads ') ? 1 : 0;
      if (aGeneric !== bGeneric) return aGeneric - bGeneric;
      return a.name.localeCompare(b.name);
    });

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
  refreshToken?: string,
  userId?: string
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

  const { accounts, error } = await listGoogleAdsAccounts(refreshToken, userId);
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

export async function fetchAccountInsights(
  refreshToken: string,
  customerId: string,
  userId?: string
): Promise<AccountInsights | null> {
  try {
    const accessToken = await resolveAccessToken(refreshToken, userId);
    if (!accessToken) return null;

    const { resourceNames } = await listAccessibleCustomerResourceNames(accessToken);
    const managerCustomerId = await resolveManagerCustomerId(
      accessToken,
      resourceNames ?? undefined
    );
    const loginId = loginCustomerIdForTarget(customerId, managerCustomerId);

    const customer = await getCustomerMeta(accessToken, customerId, loginId);

    const campaignRows = await searchCustomer<{
      campaign?: { advertisingChannelType?: string; status?: string };
    }>(
      accessToken,
      customerId,
      `SELECT campaign.advertising_channel_type, campaign.status
       FROM campaign
       WHERE campaign.status IN ('ENABLED', 'PAUSED')`,
      { loginCustomerId: loginId, silent: true }
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
      querySpend(accessToken, customerId, 'LAST_30_DAYS', loginId),
      querySpend(accessToken, customerId, 'LAST_90_DAYS', loginId),
      querySpend(accessToken, customerId, 'LAST_365_DAYS', loginId),
    ]);

    const conversionRows = await searchCustomer<{ conversionAction?: { status?: string } }>(
      accessToken,
      customerId,
      `SELECT conversion_action.status FROM conversion_action WHERE conversion_action.status = 'ENABLED'`,
      { loginCustomerId: loginId, silent: true }
    );

    const landingRows = await searchCustomer<{
      adGroupAd?: { ad?: { finalUrls?: string[] } };
    }>(
      accessToken,
      customerId,
      `SELECT ad_group_ad.ad.final_urls FROM ad_group_ad
       WHERE ad_group_ad.status = 'ENABLED' AND campaign.status = 'ENABLED'
       LIMIT 50`,
      { loginCustomerId: loginId, silent: true }
    );

    const landingUrls = new Set<string>();
    for (const row of landingRows) {
      for (const url of row.adGroupAd?.ad?.finalUrls ?? []) {
        landingUrls.add(url);
      }
    }

    return {
      accountName: customer?.descriptiveName ?? '',
      currency: customer?.currencyCode ?? 'USD',
      timezone: customer?.timeZone ?? 'UTC',
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
  dateRange: string,
  userId?: string
): Promise<string> {
  const { MODULE_GAQL } = await import('../audit-engine/module-queries.js');
  const queryFn = MODULE_GAQL[slug];
  if (!queryFn) {
    return JSON.stringify({ note: `No GAQL query configured for module ${slug}` });
  }

  try {
    const accessToken = await resolveAccessToken(refreshToken, userId);
    if (!accessToken) return '';

    const { resourceNames } = await listAccessibleCustomerResourceNames(accessToken);
    const managerCustomerId = await resolveManagerCustomerId(
      accessToken,
      resourceNames ?? undefined
    );
    const loginId = loginCustomerIdForTarget(customerId, managerCustomerId);

    const rows = await searchCustomer<Record<string, unknown>>(
      accessToken,
      customerId,
      queryFn(dateRange),
      { loginCustomerId: loginId, silent: true }
    );
    return JSON.stringify(rows.slice(0, 25), null, 0);
  } catch (err) {
    console.warn(`fetchModuleGoogleAdsData(${slug}) failed:`, err);
    return '';
  }
}
