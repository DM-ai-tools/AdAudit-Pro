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

export interface CampaignAdDto {
  id: string;
  resourceName: string;
  adGroupName: string;
  adType: string;
  status: string;
  adStrength?: string;
  headlines: string[];
  descriptions: string[];
  finalUrls: string[];
  displayPath1?: string;
  displayPath2?: string;
  impressions: number;
  clicks: number;
  conversions: number;
  ctr: number;
  cost: number;
  avgCpc: number;
}

export interface CampaignDto {
  id: string;
  resourceName: string;
  name: string;
  type: string;
  status: string;
  budgetDaily: number;
  biddingStrategyType?: string;
  impressions: number;
  clicks: number;
  conversions: number;
  ctr: number;
  avgCpc: number;
  conversionRate: number;
  costPerConversion: number;
  cost: number;
  adCount: number;
  metricsWindowDays: number;
  ads: CampaignAdDto[];
}

export interface AccountPerformanceSummary {
  currency: string;
  timezone: string;
  windowDays: number;
  dateRange: string;
  clicks: number;
  impressions: number;
  conversions: number;
  cost: number;
  ctr: number;
  avgCpc: number;
  conversionRate: number;
  costPerConversion: number;
  activeCampaigns: number;
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

export function dateRangeForDays(days: number): string {
  if (days >= 365) return 'LAST_365_DAYS';
  if (days >= 90) return 'LAST_90_DAYS';
  return 'LAST_30_DAYS';
}

function parseAdTextAssets(assets?: Array<{ text?: string } | string> | null): string[] {
  if (!assets?.length) return [];
  return assets
    .map((a) => (typeof a === 'string' ? a : a.text))
    .filter((t): t is string => !!t);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function computeRates(metrics: {
  impressions: number;
  clicks: number;
  conversions: number;
  cost: number;
}): { ctr: number; avgCpc: number; conversionRate: number; costPerConversion: number } {
  const { impressions, clicks, conversions, cost } = metrics;
  return {
    ctr: impressions > 0 ? round2((clicks / impressions) * 100) : 0,
    avgCpc: clicks > 0 ? round2(cost / clicks) : 0,
    conversionRate: clicks > 0 ? round2((conversions / clicks) * 100) : 0,
    costPerConversion: conversions > 0 ? round2(cost / conversions) : 0,
  };
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
  const loginId = loginCustomerId?.replace(/-/g, '');
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

/** login-customer-id for API calls — prefers MCC parent on the account DTO. */
export function resolveAccountLoginCustomerId(
  account: GoogleAdsAccountDto,
  allAccounts?: GoogleAdsAccountDto[]
): string | undefined {
  if (account.parentManagerId) {
    return bareCustomerId(account.parentManagerId);
  }
  if (allAccounts?.length) {
    const managers = allAccounts.filter((a) => a.accountType === 'Manager');
    if (managers.length === 1) {
      return bareCustomerId(managers[0].customerId);
    }
  }
  return undefined;
}

export function listManagerCustomerIds(accounts: GoogleAdsAccountDto[]): string[] {
  return accounts
    .filter((a) => a.accountType === 'Manager')
    .map((a) => bareCustomerId(a.customerId));
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
          parentManagerId: !customer?.manager && managerCustomerId && customerId !== managerCustomerId
            ? formatCustomerId(`customers/${managerCustomerId}`)
            : undefined,
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
  userId?: string,
  options?: { loginCustomerId?: string; managerIds?: string[]; dateWindowDays?: number }
): Promise<CampaignDto[]> {
  const windowDays = options?.dateWindowDays ?? 30;
  const dateRange = dateRangeForDays(windowDays);

  try {
    const accessToken = await resolveAccessToken(refreshToken, userId);
    if (!accessToken) return [];

    const loginIdsToTry: Array<string | undefined> = [];
    const seen = new Set<string>();

    const addLoginId = (id?: string) => {
      const bare = id?.replace(/-/g, '');
      if (!bare || bare === bareCustomerId(customerId)) return;
      if (seen.has(bare)) return;
      seen.add(bare);
      loginIdsToTry.push(bare);
    };

    addLoginId(options?.loginCustomerId);
    for (const mgr of options?.managerIds ?? []) addLoginId(mgr);

    const { resourceNames } = await listAccessibleCustomerResourceNames(accessToken);
    const managerCustomerId = await resolveManagerCustomerId(
      accessToken,
      resourceNames ?? undefined
    );
    addLoginId(managerCustomerId);
    loginIdsToTry.push(undefined);

    for (const loginId of loginIdsToTry) {
      const campaigns = await queryCampaignsForAccount(
        accessToken,
        customerId,
        loginId,
        dateRange,
        windowDays
      );
      if (campaigns.length) {
        return campaigns;
      }
    }

    console.warn(
      `fetchCampaignsForAccount: no campaigns for ${customerId} after ${loginIdsToTry.length} login-customer-id attempt(s)`
    );
    return [];
  } catch (err) {
    console.error('fetchCampaignsForAccount failed:', err);
    return [];
  }
}

async function queryCampaignsForAccount(
  accessToken: string,
  customerId: string,
  loginId: string | undefined,
  dateRange: string,
  windowDays: number
): Promise<CampaignDto[]> {
  const campaignRows = await searchCustomer<{
    campaign?: {
      id?: string;
      name?: string;
      resourceName?: string;
      advertisingChannelType?: string;
      status?: string;
      biddingStrategyType?: string;
    };
    campaignBudget?: { amountMicros?: string };
  }>(
    accessToken,
    customerId,
    `SELECT campaign.id, campaign.name, campaign.resource_name,
            campaign.advertising_channel_type, campaign.status,
            campaign.bidding_strategy_type,
            campaign_budget.amount_micros
     FROM campaign
     WHERE campaign.status IN ('ENABLED', 'PAUSED')
     ORDER BY campaign.name`,
    { loginCustomerId: loginId, silent: true }
  );

  if (!campaignRows.length) {
    const fallbackRows = await searchCustomer<{
      campaign?: {
        id?: string;
        name?: string;
        resourceName?: string;
        advertisingChannelType?: string;
        status?: string;
        biddingStrategyType?: string;
      };
    }>(
      accessToken,
      customerId,
      `SELECT campaign.id, campaign.name, campaign.resource_name,
              campaign.advertising_channel_type, campaign.status,
              campaign.bidding_strategy_type
       FROM campaign
       ORDER BY campaign.name
       LIMIT 100`,
      { loginCustomerId: loginId, silent: true }
    );
    if (!fallbackRows.length) return [];
    return buildCampaignDtos(
      accessToken,
      customerId,
      loginId,
      fallbackRows,
      new Map(),
      dateRange,
      windowDays
    );
  }

  const metricRows = await searchCustomer<{
    campaign?: { id?: string };
    metrics?: {
      impressions?: string;
      clicks?: string;
      conversions?: number;
      costMicros?: string;
    };
  }>(
    accessToken,
    customerId,
    `SELECT campaign.id,
            metrics.impressions, metrics.clicks, metrics.conversions, metrics.cost_micros
     FROM campaign
     WHERE campaign.status IN ('ENABLED', 'PAUSED')
     AND segments.date DURING ${dateRange}`,
    { loginCustomerId: loginId, silent: true }
  );

  const metricsByCampaign = new Map<string, {
    impressions: number;
    clicks: number;
    conversions: number;
    cost: number;
  }>();
  for (const row of metricRows) {
    const id = row.campaign?.id;
    if (!id) continue;
    const impressions = Number(row.metrics?.impressions ?? 0);
    const clicks = Number(row.metrics?.clicks ?? 0);
    const costMicros = Number(row.metrics?.costMicros ?? 0);
    const conversions = Number(row.metrics?.conversions ?? 0);
    const existing = metricsByCampaign.get(id);
    if (existing) {
      existing.impressions += impressions;
      existing.clicks += clicks;
      existing.conversions += conversions;
      existing.cost += costMicros / 1_000_000;
    } else {
      metricsByCampaign.set(id, {
        impressions,
        clicks,
        conversions,
        cost: costMicros / 1_000_000,
      });
    }
  }

  return buildCampaignDtos(
    accessToken,
    customerId,
    loginId,
    campaignRows,
    metricsByCampaign,
    dateRange,
    windowDays
  );
}

async function buildCampaignDtos(
  accessToken: string,
  customerId: string,
  loginId: string | undefined,
  campaignRows: Array<{
    campaign?: {
      id?: string;
      name?: string;
      resourceName?: string;
      advertisingChannelType?: string;
      status?: string;
      biddingStrategyType?: string;
    };
    campaignBudget?: { amountMicros?: string };
  }>,
  metricsByCampaign: Map<string, { impressions: number; clicks: number; conversions: number; cost: number }>,
  dateRange: string,
  windowDays: number
): Promise<CampaignDto[]> {
  const adsByCampaign = await fetchAdsByCampaign(accessToken, customerId, loginId, dateRange);

  const campaigns: CampaignDto[] = campaignRows
    .filter((row) => row.campaign?.id)
    .map((row) => {
      const c = row.campaign!;
      const id = c.id!;
      const m = metricsByCampaign.get(id) ?? { impressions: 0, clicks: 0, conversions: 0, cost: 0 };
      const rates = computeRates(m);
      const ads = adsByCampaign.get(id) ?? [];

      return {
        id,
        resourceName: c.resourceName ?? '',
        name: c.name ?? `Campaign ${id}`,
        type: c.advertisingChannelType ?? 'UNKNOWN',
        status: c.status ?? 'UNKNOWN',
        budgetDaily: round2(Number(row.campaignBudget?.amountMicros ?? 0) / 1_000_000),
        biddingStrategyType: c.biddingStrategyType,
        impressions: m.impressions,
        clicks: m.clicks,
        conversions: round2(m.conversions),
        ctr: rates.ctr,
        avgCpc: rates.avgCpc,
        conversionRate: rates.conversionRate,
        costPerConversion: rates.costPerConversion,
        cost: round2(m.cost),
        adCount: ads.length,
        metricsWindowDays: windowDays,
        ads,
      };
    });

  return campaigns.sort((a, b) => b.cost - a.cost || a.name.localeCompare(b.name));
}

async function fetchAdsByCampaign(
  accessToken: string,
  customerId: string,
  loginId: string | undefined,
  dateRange: string
): Promise<Map<string, CampaignAdDto[]>> {
  const adRows = await searchCustomer<{
    campaign?: { id?: string };
    adGroup?: { name?: string };
    adGroupAd?: {
      resourceName?: string;
      status?: string;
      adStrength?: string;
      ad?: {
        id?: string;
        type?: string;
        finalUrls?: string[];
        responsiveSearchAd?: {
          headlines?: Array<{ text?: string }>;
          descriptions?: Array<{ text?: string }>;
          path1?: string;
          path2?: string;
        };
      };
    };
    metrics?: {
      impressions?: string;
      clicks?: string;
      conversions?: number;
      costMicros?: string;
      ctr?: number;
      averageCpc?: number;
    };
  }>(
    accessToken,
    customerId,
    `SELECT campaign.id, ad_group.name, ad_group_ad.resource_name, ad_group_ad.status,
            ad_group_ad.ad_strength, ad_group_ad.ad.id, ad_group_ad.ad.type,
            ad_group_ad.ad.final_urls,
            ad_group_ad.ad.responsive_search_ad.headlines,
            ad_group_ad.ad.responsive_search_ad.descriptions,
            ad_group_ad.ad.responsive_search_ad.path1,
            ad_group_ad.ad.responsive_search_ad.path2,
            metrics.impressions, metrics.clicks, metrics.conversions,
            metrics.cost_micros, metrics.ctr, metrics.average_cpc
     FROM ad_group_ad
     WHERE ad_group_ad.status IN ('ENABLED', 'PAUSED')
     AND campaign.status IN ('ENABLED', 'PAUSED')
     AND segments.date DURING ${dateRange}
     ORDER BY metrics.impressions DESC
     LIMIT 200`,
    { loginCustomerId: loginId, silent: true }
  );

  const map = new Map<string, CampaignAdDto[]>();
  const seen = new Map<string, Set<string>>();

  for (const row of adRows) {
    const campaignId = row.campaign?.id;
    const adId = row.adGroupAd?.ad?.id;
    if (!campaignId || !adId) continue;

    const dedupeKey = `${campaignId}:${adId}`;
    const campaignSeen = seen.get(campaignId) ?? new Set<string>();
    if (campaignSeen.has(dedupeKey)) continue;
    campaignSeen.add(dedupeKey);
    seen.set(campaignId, campaignSeen);

    const impressions = Number(row.metrics?.impressions ?? 0);
    const clicks = Number(row.metrics?.clicks ?? 0);
    const cost = Number(row.metrics?.costMicros ?? 0) / 1_000_000;
    const rsa = row.adGroupAd?.ad?.responsiveSearchAd;

    const ad: CampaignAdDto = {
      id: adId,
      resourceName: row.adGroupAd?.resourceName ?? '',
      adGroupName: row.adGroup?.name ?? 'Ad group',
      adType: row.adGroupAd?.ad?.type ?? 'UNKNOWN',
      status: row.adGroupAd?.status ?? 'UNKNOWN',
      adStrength: row.adGroupAd?.adStrength,
      headlines: parseAdTextAssets(rsa?.headlines),
      descriptions: parseAdTextAssets(rsa?.descriptions),
      finalUrls: row.adGroupAd?.ad?.finalUrls ?? [],
      displayPath1: rsa?.path1,
      displayPath2: rsa?.path2,
      impressions,
      clicks,
      conversions: round2(Number(row.metrics?.conversions ?? 0)),
      ctr: impressions > 0 ? round2((clicks / impressions) * 100) : round2(Number(row.metrics?.ctr ?? 0) * 100),
      cost: round2(cost),
      avgCpc: clicks > 0 ? round2(cost / clicks) : round2(Number(row.metrics?.averageCpc ?? 0) / 1_000_000),
    };

    const list = map.get(campaignId) ?? [];
    list.push(ad);
    map.set(campaignId, list);
  }

  return map;
}

export async function fetchAccountPerformanceSummary(
  refreshToken: string,
  customerId: string,
  userId?: string,
  options?: { loginCustomerId?: string; managerIds?: string[]; dateWindowDays?: number }
): Promise<AccountPerformanceSummary | null> {
  try {
    const accessToken = await resolveAccessToken(refreshToken, userId);
    if (!accessToken) return null;

    const windowDays = options?.dateWindowDays ?? 30;
    const dateRange = dateRangeForDays(windowDays);

    let loginId = options?.loginCustomerId?.replace(/-/g, '');
    if (!loginId) {
      const { resourceNames } = await listAccessibleCustomerResourceNames(accessToken);
      const managerCustomerId = await resolveManagerCustomerId(
        accessToken,
        resourceNames ?? undefined
      );
      loginId = loginCustomerIdForTarget(customerId, managerCustomerId);
    }

    const customer = await getCustomerMeta(accessToken, customerId, loginId);

    const rows = await searchCustomer<{
      campaign?: { status?: string };
      metrics?: {
        impressions?: string;
        clicks?: string;
        conversions?: number;
        costMicros?: string;
      };
    }>(
      accessToken,
      customerId,
      `SELECT campaign.status,
              metrics.impressions, metrics.clicks, metrics.conversions, metrics.cost_micros
       FROM campaign
       WHERE campaign.status IN ('ENABLED', 'PAUSED')
       AND segments.date DURING ${dateRange}`,
      { loginCustomerId: loginId, silent: true }
    );

    let impressions = 0;
    let clicks = 0;
    let conversions = 0;
    let cost = 0;

    for (const row of rows) {
      impressions += Number(row.metrics?.impressions ?? 0);
      clicks += Number(row.metrics?.clicks ?? 0);
      conversions += Number(row.metrics?.conversions ?? 0);
      cost += Number(row.metrics?.costMicros ?? 0) / 1_000_000;
    }

    const campaignCountRows = await searchCustomer<{ campaign?: { id?: string } }>(
      accessToken,
      customerId,
      `SELECT campaign.id FROM campaign WHERE campaign.status = 'ENABLED'`,
      { loginCustomerId: loginId, silent: true }
    );
    const enabledCampaigns = new Set(
      campaignCountRows.filter((r) => r.campaign?.id).map((r) => r.campaign!.id!)
    );

    const rates = computeRates({ impressions, clicks, conversions, cost });

    return {
      currency: customer?.currencyCode ?? 'USD',
      timezone: customer?.timeZone ?? 'UTC',
      windowDays,
      dateRange,
      clicks,
      impressions,
      conversions: round2(conversions),
      cost: round2(cost),
      ctr: rates.ctr,
      avgCpc: rates.avgCpc,
      conversionRate: rates.conversionRate,
      costPerConversion: rates.costPerConversion,
      activeCampaigns: enabledCampaigns.size,
    };
  } catch (err) {
    console.error('fetchAccountPerformanceSummary failed:', err);
    return null;
  }
}

/** Rich campaign snapshot for campaign-scoped audits (ad groups, keywords, ads, search terms). */
export async function fetchCampaignAuditContext(
  refreshToken: string,
  customerId: string,
  campaignId: string,
  userId?: string,
  options?: { loginCustomerId?: string; dateRange?: string }
): Promise<string> {
  const cid = campaignId.replace(/\D/g, '');
  if (!cid) return '';

  try {
    const accessToken = await resolveAccessToken(refreshToken, userId);
    if (!accessToken) return '';

    let loginId = options?.loginCustomerId?.replace(/-/g, '');
    if (!loginId) {
      const { resourceNames } = await listAccessibleCustomerResourceNames(accessToken);
      const managerCustomerId = await resolveManagerCustomerId(
        accessToken,
        resourceNames ?? undefined
      );
      loginId = loginCustomerIdForTarget(customerId, managerCustomerId);
    }

    const dateRange = options?.dateRange ?? 'LAST_90_DAYS';
    const searchOpts = { loginCustomerId: loginId, silent: true as const };
    const campaignClause = ` AND campaign.id = ${cid}`;

    const [campaignRows, adGroupRows, keywordRows, searchTermRows, adRows, deviceRows] =
      await Promise.all([
        searchCustomer<Record<string, unknown>>(
          accessToken,
          customerId,
          `SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type,
                  campaign.bidding_strategy_type, campaign_budget.amount_micros,
                  metrics.cost_micros, metrics.clicks, metrics.conversions, metrics.impressions,
                  metrics.ctr, metrics.average_cpc, metrics.search_impression_share
           FROM campaign WHERE segments.date DURING ${dateRange}${campaignClause} LIMIT 5`,
          searchOpts
        ),
        searchCustomer<Record<string, unknown>>(
          accessToken,
          customerId,
          `SELECT ad_group.id, ad_group.name, ad_group.status, metrics.cost_micros,
                  metrics.conversions, metrics.clicks, metrics.impressions
           FROM ad_group WHERE segments.date DURING ${dateRange}${campaignClause}
           ORDER BY metrics.cost_micros DESC LIMIT 20`,
          searchOpts
        ),
        searchCustomer<Record<string, unknown>>(
          accessToken,
          customerId,
          `SELECT ad_group.name, ad_group_criterion.keyword.text, ad_group_criterion.match_type,
                  ad_group_criterion.quality_info.quality_score,
                  metrics.cost_micros, metrics.conversions, metrics.clicks
           FROM keyword_view WHERE segments.date DURING ${dateRange}${campaignClause}
           ORDER BY metrics.cost_micros DESC LIMIT 25`,
          searchOpts
        ),
        searchCustomer<Record<string, unknown>>(
          accessToken,
          customerId,
          `SELECT search_term_view.search_term, search_term_view.status,
                  metrics.cost_micros, metrics.conversions, metrics.clicks
           FROM search_term_view WHERE segments.date DURING ${dateRange}${campaignClause}
           ORDER BY metrics.cost_micros DESC LIMIT 25`,
          searchOpts
        ),
        searchCustomer<Record<string, unknown>>(
          accessToken,
          customerId,
          `SELECT ad_group.name, ad_group_ad.ad_strength,
                  ad_group_ad.ad.responsive_search_ad.headlines,
                  ad_group_ad.ad.responsive_search_ad.descriptions,
                  ad_group_ad.ad.final_urls,
                  metrics.impressions, metrics.clicks, metrics.conversions, metrics.cost_micros, metrics.ctr
           FROM ad_group_ad WHERE segments.date DURING ${dateRange}
           AND ad_group_ad.status IN ('ENABLED', 'PAUSED')${campaignClause}
           ORDER BY metrics.impressions DESC LIMIT 15`,
          searchOpts
        ),
        searchCustomer<Record<string, unknown>>(
          accessToken,
          customerId,
          `SELECT segments.device, metrics.cost_micros, metrics.conversions, metrics.clicks,
                  metrics.impressions
           FROM campaign WHERE segments.date DURING ${dateRange}${campaignClause} LIMIT 10`,
          searchOpts
        ),
      ]);

    let impressions = 0;
    let clicks = 0;
    let conversions = 0;
    let cost = 0;
    for (const row of campaignRows) {
      const m = row.metrics as {
        impressions?: string;
        clicks?: string;
        conversions?: number;
        costMicros?: string;
      } | undefined;
      impressions += Number(m?.impressions ?? 0);
      clicks += Number(m?.clicks ?? 0);
      conversions += Number(m?.conversions ?? 0);
      cost += Number(m?.costMicros ?? 0) / 1_000_000;
    }
    const campaignPerformance = {
      ...computeRates({ impressions, clicks, conversions, cost }),
      impressions,
      clicks,
      conversions: round2(conversions),
      cost: round2(cost),
      dateRange,
      note: 'Aggregated campaign metrics matching Google Ads campaigns table (clicks, impressions, CTR, avg CPC, cost, conversions, conv rate, cost/conv).',
    };

    return JSON.stringify({
      campaignId: cid,
      dateRange,
      campaignPerformance,
      campaign: campaignRows,
      adGroups: adGroupRows,
      keywords: keywordRows,
      searchTerms: searchTermRows,
      ads: adRows,
      deviceBreakdown: deviceRows,
    });
  } catch (err) {
    console.warn('fetchCampaignAuditContext failed:', err);
    return '';
  }
}

export async function fetchModuleGoogleAdsData(
  refreshToken: string,
  customerId: string,
  slug: string,
  dateRange: string,
  userId?: string,
  campaignId?: string
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
      queryFn(dateRange, { campaignId }),
      { loginCustomerId: loginId, silent: true }
    );
    const limit = campaignId ? 40 : 30;
    return JSON.stringify(rows.slice(0, limit), null, 0);
  } catch (err) {
    console.warn(`fetchModuleGoogleAdsData(${slug}) failed:`, err);
    return '';
  }
}
