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
  websiteUrl?: string;
  industry?: string;
  /** False for MCC/manager shells — user must pick a client account to audit */
  selectable: boolean;
  parentManagerId?: string;
  managerName?: string;
}

export interface CampaignDto {
  id: string;
  resourceName: string;
  name: string;
  type: string;
  status: string;
  budgetDaily: number;
  impressions: number;
  clicks: number;
  conversions: number;
  ctr: number;
  cost: number;
  adCount: number;
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
    selectable: true,
  };
}

async function fetchPrimaryWebsiteUrl(
  accessToken: string,
  customerId: string,
  loginCustomerId?: string
): Promise<string | undefined> {
  const rows = await searchCustomer<{
    adGroupAd?: { ad?: { finalUrls?: string[] } };
  }>(
    accessToken,
    customerId,
    `SELECT ad_group_ad.ad.final_urls
     FROM ad_group_ad
     WHERE ad_group_ad.status = 'ENABLED' AND campaign.status = 'ENABLED'
     ORDER BY metrics.impressions DESC
     LIMIT 1`,
    { loginCustomerId, silent: true }
  );
  const raw = rows[0]?.adGroupAd?.ad?.finalUrls?.[0];
  if (!raw) return undefined;
  try {
    const parsed = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
    return parsed.origin;
  } catch {
    return raw;
  }
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
          selectable: !customer?.manager,
        });
      } catch (err) {
        console.warn(`Skipping customer ${customerId}:`, err instanceof Error ? err.message : err);
        accounts.push(accountFromResourceName(resourceName));
      }
    }

    // Expand MCC: add child client accounts under each manager
    const seenIds = new Set(accounts.map((a) => bareCustomerId(a.customerId)));
    const managers = accounts.filter((a) => a.accountType === 'Manager');

    for (const manager of managers) {
      const managerBare = bareCustomerId(manager.customerId);
      const clientMap = await listManagedClientMeta(accessToken, managerBare);

      for (const [clientId, meta] of clientMap) {
        if (seenIds.has(clientId)) continue;
        seenIds.add(clientId);

        const loginId = managerBare;
        let monthlySpend = 0;
        try {
          monthlySpend = await querySpend(accessToken, clientId, 'LAST_30_DAYS', loginId);
        } catch {
          /* skip spend */
        }

        let websiteUrl: string | undefined;
        try {
          websiteUrl = await fetchPrimaryWebsiteUrl(accessToken, clientId, loginId);
        } catch {
          /* skip */
        }

        accounts.push({
          id: `gads_${clientId}`,
          customerId: formatCustomerId(`customers/${clientId}`),
          name: meta.descriptiveName || `Google Ads ${formatCustomerId(`customers/${clientId}`)}`,
          currency: meta.currencyCode || manager.currency || 'USD',
          timezone: meta.timeZone || manager.timezone || 'UTC',
          accountType: 'Client',
          monthlySpend,
          websiteUrl,
          selectable: true,
          parentManagerId: manager.customerId,
          managerName: manager.name,
        });
      }
    }

    // Enrich selectable accounts with website URL from live ads
    await Promise.all(
      accounts
        .filter((a) => a.selectable && !a.websiteUrl)
        .slice(0, 20)
        .map(async (account) => {
          const loginId = loginCustomerIdForTarget(account.customerId, managerCustomerId);
          account.websiteUrl = await fetchPrimaryWebsiteUrl(
            accessToken,
            account.customerId,
            loginId
          );
        })
    );

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

export async function fetchCampaignsForAccount(
  refreshToken: string,
  customerId: string,
  userId?: string
): Promise<CampaignDto[]> {
  try {
    const accessToken = await resolveAccessToken(refreshToken, userId);
    if (!accessToken) return [];

    const { resourceNames } = await listAccessibleCustomerResourceNames(accessToken);
    const managerCustomerId = await resolveManagerCustomerId(
      accessToken,
      resourceNames ?? undefined
    );
    const loginId = loginCustomerIdForTarget(customerId, managerCustomerId);

    const campaignRows = await searchCustomer<{
      campaign?: {
        id?: string;
        name?: string;
        resourceName?: string;
        advertisingChannelType?: string;
        status?: string;
      };
      campaignBudget?: { amountMicros?: string };
      metrics?: {
        impressions?: string;
        clicks?: string;
        conversions?: number;
        costMicros?: string;
      };
    }>(
      accessToken,
      customerId,
      `SELECT campaign.id, campaign.name, campaign.resource_name,
              campaign.advertising_channel_type, campaign.status,
              campaign_budget.amount_micros,
              metrics.impressions, metrics.clicks, metrics.conversions, metrics.cost_micros
       FROM campaign
       WHERE campaign.status IN ('ENABLED', 'PAUSED')
       AND segments.date DURING LAST_30_DAYS`,
      { loginCustomerId: loginId, silent: true }
    );

    const adCountRows = await searchCustomer<{
      campaign?: { id?: string };
    }>(
      accessToken,
      customerId,
      `SELECT campaign.id
       FROM ad_group_ad
       WHERE ad_group_ad.status IN ('ENABLED', 'PAUSED')
       AND campaign.status IN ('ENABLED', 'PAUSED')`,
      { loginCustomerId: loginId, silent: true }
    );

    const adCounts = new Map<string, number>();
    for (const row of adCountRows) {
      const id = row.campaign?.id;
      if (!id) continue;
      adCounts.set(id, (adCounts.get(id) ?? 0) + 1);
    }

    const byCampaign = new Map<string, CampaignDto>();
    for (const row of campaignRows) {
      const c = row.campaign;
      if (!c?.id) continue;
      const impressions = Number(row.metrics?.impressions ?? 0);
      const clicks = Number(row.metrics?.clicks ?? 0);
      const existing = byCampaign.get(c.id);
      if (existing) {
        existing.impressions += impressions;
        existing.clicks += clicks;
        existing.conversions += Number(row.metrics?.conversions ?? 0);
        existing.cost += Number(row.metrics?.costMicros ?? 0) / 1_000_000;
      } else {
        byCampaign.set(c.id, {
          id: c.id,
          resourceName: c.resourceName ?? '',
          name: c.name ?? `Campaign ${c.id}`,
          type: c.advertisingChannelType ?? 'UNKNOWN',
          status: c.status ?? 'UNKNOWN',
          budgetDaily: Math.round(Number(row.campaignBudget?.amountMicros ?? 0) / 1_000_000),
          impressions,
          clicks,
          conversions: Number(row.metrics?.conversions ?? 0),
          ctr: impressions > 0 ? Math.round((clicks / impressions) * 1000) / 10 : 0,
          cost: Math.round(Number(row.metrics?.costMicros ?? 0) / 1_000_000),
          adCount: adCounts.get(c.id) ?? 0,
        });
      }
    }

    return [...byCampaign.values()].sort((a, b) => b.cost - a.cost);
  } catch (err) {
    console.error('fetchCampaignsForAccount failed:', err);
    return [];
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
