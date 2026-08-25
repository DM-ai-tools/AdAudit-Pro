import { env } from '../config/env.js';
import {
  GOOGLE_ADS_API_VERSIONS,
  isRetryableGoogleAdsVersionError,
} from '../config/google-ads-api.js';
import { MOCK_GOOGLE_ADS_ACCOUNTS } from '../data/google-ads-accounts.js';
import { accountRequiresEuPoliticalDeclaration } from '../utils/eu-political-advertising.js';
import { googleAdsGeoTargetConstant, resolveMarketCountry } from '../utils/region-codes.js';
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

export interface BudgetCampaignRow {
  campaignId: string;
  name: string;
  type: string;
  status: string;
  biddingStrategyType?: string;
  dailyBudget: number;
  periodBudget: number;
  spend: number;
  spendShare: number;
  budgetUtilization: number;
  leftover: number;
  impressions: number;
  clicks: number;
  conversions: number;
  ctr: number;
  avgCpc: number;
  conversionRate: number;
  costPerConversion: number;
  searchImpressionShare?: number;
  budgetLostIs?: number;
  rankLostIs?: number;
}

export interface BudgetAdRow {
  adId: string;
  campaignId: string;
  campaignName: string;
  adGroupName: string;
  status: string;
  headline: string;
  spend: number;
  spendShare: number;
  impressions: number;
  clicks: number;
  conversions: number;
  ctr: number;
  avgCpc: number;
  costPerConversion: number;
}

export interface BudgetKeywordRow {
  campaignId: string;
  campaignName: string;
  adGroupName: string;
  keyword: string;
  matchType: string;
  qualityScore?: number;
  spend: number;
  spendShare: number;
  impressions: number;
  clicks: number;
  conversions: number;
  ctr: number;
  avgCpc: number;
  costPerConversion: number;
}

export interface BudgetDailyRow {
  date: string;
  spend: number;
  clicks: number;
  conversions: number;
  impressions: number;
}

export interface BudgetAccountSummary {
  currency: string;
  timezone: string;
  windowDays: number;
  dateRange: string;
  totalSpend: number;
  totalDailyBudget: number;
  enabledDailyBudget: number;
  expectedSpend: number;
  pacePercent: number;
  leftover: number;
  clicks: number;
  impressions: number;
  conversions: number;
  ctr: number;
  avgCpc: number;
  conversionRate: number;
  costPerConversion: number;
  activeCampaigns: number;
  constrainedCampaigns: number;
  underspentCampaigns: number;
}

export interface AccountBudgetBreakdown {
  account: BudgetAccountSummary;
  campaigns: BudgetCampaignRow[];
  ads: BudgetAdRow[];
  keywords: BudgetKeywordRow[];
  daily: BudgetDailyRow[];
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

async function fetchGoogleAdsWithRetry(
  url: string,
  init: RequestInit,
  attempts = 3
): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fetch(url, init);
    } catch (err) {
      lastErr = err;
      console.warn(
        `Google Ads fetch failed (attempt ${i + 1}/${attempts}):`,
        err instanceof Error ? err.message : err
      );
      await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
  }
  throw lastErr;
}

async function listAccessibleCustomerResourceNames(
  accessToken: string
): Promise<{ resourceNames: string[] | null; error?: string; apiVersion?: string }> {
  const versions = resolvedApiVersion
    ? [resolvedApiVersion, ...GOOGLE_ADS_API_VERSIONS.filter((v) => v !== resolvedApiVersion)]
    : GOOGLE_ADS_API_VERSIONS;

  for (const version of versions) {
    const res = await fetchGoogleAdsWithRetry(
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

const accountsCache = new Map<string, { at: number; result: GoogleAdsAccountsResult }>();
const ACCOUNTS_CACHE_MS = 15 * 60 * 1000;

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
    const cached = userId ? accountsCache.get(userId) : undefined;
    if (cached && Date.now() - cached.at < ACCOUNTS_CACHE_MS && cached.result.accounts.length) {
      console.warn(
        '[google-ads] list accounts failed — using cached MCC/account list so login-customer-id still resolves'
      );
      return cached.result;
    }
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
  const result: GoogleAdsAccountsResult = {
    accounts,
    source: 'google_ads_api',
    reason: 'live',
  };
  if (userId) accountsCache.set(userId, { at: Date.now(), result });
  return result;
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

/** True when this account must declare EU political advertising (timezone and/or existing campaign flags). */
export async function fetchRequiresEuPoliticalAdvertising(
  refreshToken: string,
  customerId: string,
  userId?: string,
  options?: { loginCustomerId?: string; managerIds?: string[]; timezone?: string }
): Promise<boolean> {
  try {
    const accessToken = await resolveAccessToken(refreshToken, userId);
    if (!accessToken) {
      return accountRequiresEuPoliticalDeclaration({ timezone: options?.timezone });
    }

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
    const timezone = customer?.timeZone || options?.timezone;

    const rows = await searchCustomer<{
      campaign?: { containsEuPoliticalAdvertising?: string };
    }>(
      accessToken,
      customerId,
      `SELECT campaign.contains_eu_political_advertising
       FROM campaign
       WHERE campaign.status IN ('ENABLED', 'PAUSED')
       LIMIT 80`,
      { loginCustomerId: loginId, silent: true }
    );

    const flags = rows.map((r) => r.campaign?.containsEuPoliticalAdvertising);
    return accountRequiresEuPoliticalDeclaration({
      timezone,
      containsEuPoliticalAdvertisingFlags: flags,
    });
  } catch (err) {
    console.warn('fetchRequiresEuPoliticalAdvertising failed:', err);
    return accountRequiresEuPoliticalDeclaration({ timezone: options?.timezone });
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

function fractionToPct(v: unknown): number | undefined {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return round2(n <= 1 ? n * 100 : n);
}

export function buildBudgetBreakdownFromCampaigns(
  campaigns: CampaignDto[],
  opts: { currency: string; timezone?: string; windowDays: number }
): AccountBudgetBreakdown {
  const windowDays = opts.windowDays;
  const dateRange = dateRangeForDays(windowDays);
  const totalSpend = campaigns.reduce((s, c) => s + (c.cost ?? 0), 0);
  const enabled = campaigns.filter((c) => c.status === 'ENABLED');
  const totalDailyBudget = campaigns.reduce((s, c) => s + (c.budgetDaily ?? 0), 0);
  const enabledDailyBudget = enabled.reduce((s, c) => s + (c.budgetDaily ?? 0), 0);
  const expectedSpend = enabledDailyBudget * windowDays;
  const clicks = campaigns.reduce((s, c) => s + c.clicks, 0);
  const impressions = campaigns.reduce((s, c) => s + c.impressions, 0);
  const conversions = campaigns.reduce((s, c) => s + c.conversions, 0);
  const rates = computeRates({ impressions, clicks, conversions, cost: totalSpend });

  const campaignRows: BudgetCampaignRow[] = campaigns.map((c) => {
    const periodBudget = round2((c.budgetDaily ?? 0) * windowDays);
    const spend = round2(c.cost ?? 0);
    const util = periodBudget > 0 ? round2((spend / periodBudget) * 100) : 0;
    return {
      campaignId: c.id,
      name: c.name,
      type: c.type,
      status: c.status,
      biddingStrategyType: c.biddingStrategyType,
      dailyBudget: round2(c.budgetDaily ?? 0),
      periodBudget,
      spend,
      spendShare: totalSpend > 0 ? round2((spend / totalSpend) * 100) : 0,
      budgetUtilization: util,
      leftover: round2(Math.max(0, periodBudget - spend)),
      impressions: c.impressions,
      clicks: c.clicks,
      conversions: round2(c.conversions),
      ctr: c.ctr,
      avgCpc: c.avgCpc,
      conversionRate: c.conversionRate,
      costPerConversion: c.costPerConversion,
    };
  });

  const adRows: BudgetAdRow[] = campaigns
    .flatMap((c) =>
      (c.ads ?? []).map((ad) => ({
        adId: ad.id,
        campaignId: c.id,
        campaignName: c.name,
        adGroupName: ad.adGroupName,
        status: ad.status,
        headline: ad.headlines[0] ?? `${c.name} RSA`,
        spend: round2(ad.cost),
        spendShare: 0,
        impressions: ad.impressions,
        clicks: ad.clicks,
        conversions: round2(ad.conversions),
        ctr: ad.ctr,
        avgCpc: ad.avgCpc,
        costPerConversion: ad.conversions > 0 ? round2(ad.cost / ad.conversions) : 0,
      }))
    )
    .sort((a, b) => b.spend - a.spend);
  for (const ad of adRows) {
    ad.spendShare = totalSpend > 0 ? round2((ad.spend / totalSpend) * 100) : 0;
  }

  const keywordRows: BudgetKeywordRow[] = [];
  const daily: BudgetDailyRow[] = [];
  const perDay = windowDays > 0 ? totalSpend / windowDays : 0;
  const perDayClicks = windowDays > 0 ? clicks / windowDays : 0;
  const perDayConv = windowDays > 0 ? conversions / windowDays : 0;
  const perDayImpr = windowDays > 0 ? impressions / windowDays : 0;
  for (let i = windowDays - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    daily.push({
      date: d.toISOString().slice(0, 10),
      spend: round2(perDay),
      clicks: Math.round(perDayClicks),
      conversions: round2(perDayConv),
      impressions: Math.round(perDayImpr),
    });
  }

  const constrainedCampaigns = campaignRows.filter(
    (c) => c.status === 'ENABLED' && c.dailyBudget > 0 && c.budgetUtilization >= 95
  ).length;
  const underspentCampaigns = campaignRows.filter(
    (c) => c.status === 'ENABLED' && c.dailyBudget > 0 && c.budgetUtilization < 70
  ).length;

  return {
    account: {
      currency: opts.currency,
      timezone: opts.timezone ?? 'UTC',
      windowDays,
      dateRange,
      totalSpend: round2(totalSpend),
      totalDailyBudget: round2(totalDailyBudget),
      enabledDailyBudget: round2(enabledDailyBudget),
      expectedSpend: round2(expectedSpend),
      pacePercent: expectedSpend > 0 ? round2((totalSpend / expectedSpend) * 100) : 0,
      leftover: round2(Math.max(0, expectedSpend - totalSpend)),
      clicks,
      impressions,
      conversions: round2(conversions),
      ctr: rates.ctr,
      avgCpc: rates.avgCpc,
      conversionRate: rates.conversionRate,
      costPerConversion: rates.costPerConversion,
      activeCampaigns: enabled.length,
      constrainedCampaigns,
      underspentCampaigns,
    },
    campaigns: campaignRows.sort((a, b) => b.spend - a.spend),
    ads: adRows.slice(0, 40),
    keywords: keywordRows,
    daily,
  };
}

export async function fetchAccountBudgetBreakdown(
  refreshToken: string,
  customerId: string,
  userId?: string,
  options?: { loginCustomerId?: string; managerIds?: string[]; dateWindowDays?: number }
): Promise<AccountBudgetBreakdown | null> {
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

    const searchOpts = { loginCustomerId: loginId, silent: true as const };
    const customer = await getCustomerMeta(accessToken, customerId, loginId);
    const currency = customer?.currencyCode ?? 'USD';
    const timezone = customer?.timeZone ?? 'UTC';

    const metricQueryWithIs = `SELECT campaign.id,
            metrics.impressions, metrics.clicks, metrics.conversions, metrics.cost_micros,
            metrics.search_impression_share, metrics.search_budget_lost_impression_share,
            metrics.search_rank_lost_impression_share
     FROM campaign
     WHERE campaign.status IN ('ENABLED', 'PAUSED')
     AND segments.date DURING ${dateRange}`;
    const metricQueryPlain = `SELECT campaign.id,
            metrics.impressions, metrics.clicks, metrics.conversions, metrics.cost_micros
     FROM campaign
     WHERE campaign.status IN ('ENABLED', 'PAUSED')
     AND segments.date DURING ${dateRange}`;

    let [budgetRows, metricRows, adRows, keywordRows, dailyRows] = await Promise.all([
      searchCustomer<{
        campaign?: {
          id?: string;
          name?: string;
          status?: string;
          advertisingChannelType?: string;
          biddingStrategyType?: string;
        };
        campaignBudget?: { amountMicros?: string };
      }>(
        accessToken,
        customerId,
        `SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type,
                campaign.bidding_strategy_type, campaign_budget.amount_micros
         FROM campaign
         WHERE campaign.status IN ('ENABLED', 'PAUSED')`,
        searchOpts
      ),
      searchCustomer<{
        campaign?: { id?: string };
        metrics?: {
          impressions?: string;
          clicks?: string;
          conversions?: number;
          costMicros?: string;
          searchImpressionShare?: number;
          searchBudgetLostImpressionShare?: number;
          searchRankLostImpressionShare?: number;
        };
      }>(accessToken, customerId, metricQueryWithIs, searchOpts),
      searchCustomer<{
        campaign?: { id?: string; name?: string };
        adGroup?: { name?: string };
        adGroupAd?: {
          status?: string;
          ad?: {
            id?: string;
            responsiveSearchAd?: { headlines?: Array<{ text?: string }> };
          };
        };
        metrics?: {
          impressions?: string;
          clicks?: string;
          conversions?: number;
          costMicros?: string;
        };
      }>(
        accessToken,
        customerId,
        `SELECT campaign.id, campaign.name, ad_group.name, ad_group_ad.status, ad_group_ad.ad.id,
                ad_group_ad.ad.responsive_search_ad.headlines,
                metrics.impressions, metrics.clicks, metrics.conversions, metrics.cost_micros
         FROM ad_group_ad
         WHERE ad_group_ad.status IN ('ENABLED', 'PAUSED')
         AND campaign.status IN ('ENABLED', 'PAUSED')
         AND segments.date DURING ${dateRange}
         LIMIT 2000`,
        searchOpts
      ),
      searchCustomer<{
        campaign?: { id?: string; name?: string };
        adGroup?: { name?: string };
        adGroupCriterion?: {
          keyword?: { text?: string; matchType?: string };
          qualityInfo?: { qualityScore?: number };
        };
        metrics?: {
          impressions?: string;
          clicks?: string;
          conversions?: number;
          costMicros?: string;
        };
      }>(
        accessToken,
        customerId,
        `SELECT campaign.id, campaign.name, ad_group.name,
                ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type,
                ad_group_criterion.quality_info.quality_score,
                metrics.impressions, metrics.clicks, metrics.conversions, metrics.cost_micros
         FROM keyword_view
         WHERE campaign.status IN ('ENABLED', 'PAUSED')
         AND ad_group_criterion.status != 'REMOVED'
         AND segments.date DURING ${dateRange}
         LIMIT 3000`,
        searchOpts
      ),
      searchCustomer<{
        segments?: { date?: string };
        metrics?: {
          impressions?: string;
          clicks?: string;
          conversions?: number;
          costMicros?: string;
        };
      }>(
        accessToken,
        customerId,
        `SELECT segments.date, metrics.impressions, metrics.clicks, metrics.conversions, metrics.cost_micros
         FROM customer
         WHERE segments.date DURING ${dateRange}`,
        searchOpts
      ),
    ]);

    if (budgetRows.length && !metricRows.length) {
      metricRows = await searchCustomer(accessToken, customerId, metricQueryPlain, searchOpts);
    }

    const metricsByCampaign = new Map<
      string,
      {
        impressions: number;
        clicks: number;
        conversions: number;
        cost: number;
        isWeighted: number;
        isWeight: number;
        budgetLostWeighted: number;
        rankLostWeighted: number;
      }
    >();
    for (const row of metricRows) {
      const id = row.campaign?.id;
      if (!id) continue;
      const impressions = Number(row.metrics?.impressions ?? 0);
      const existing = metricsByCampaign.get(id) ?? {
        impressions: 0,
        clicks: 0,
        conversions: 0,
        cost: 0,
        isWeighted: 0,
        isWeight: 0,
        budgetLostWeighted: 0,
        rankLostWeighted: 0,
      };
      existing.impressions += impressions;
      existing.clicks += Number(row.metrics?.clicks ?? 0);
      existing.conversions += Number(row.metrics?.conversions ?? 0);
      existing.cost += Number(row.metrics?.costMicros ?? 0) / 1_000_000;
      const isPct = fractionToPct(row.metrics?.searchImpressionShare);
      const budgetLost = fractionToPct(row.metrics?.searchBudgetLostImpressionShare);
      const rankLost = fractionToPct(row.metrics?.searchRankLostImpressionShare);
      const w = impressions || 1;
      if (isPct != null) {
        existing.isWeighted += isPct * w;
        existing.isWeight += w;
      }
      if (budgetLost != null) existing.budgetLostWeighted += budgetLost * w;
      if (rankLost != null) existing.rankLostWeighted += rankLost * w;
      metricsByCampaign.set(id, existing);
    }

    const seenCampaign = new Set<string>();
    const campaignRows: BudgetCampaignRow[] = [];
    for (const row of budgetRows) {
      const id = row.campaign?.id;
      if (!id || seenCampaign.has(id)) continue;
      seenCampaign.add(id);
      const m = metricsByCampaign.get(id) ?? {
        impressions: 0,
        clicks: 0,
        conversions: 0,
        cost: 0,
        isWeighted: 0,
        isWeight: 0,
        budgetLostWeighted: 0,
        rankLostWeighted: 0,
      };
      const rates = computeRates(m);
      const dailyBudget = round2(Number(row.campaignBudget?.amountMicros ?? 0) / 1_000_000);
      const periodBudget = round2(dailyBudget * windowDays);
      const spend = round2(m.cost);
      campaignRows.push({
        campaignId: id,
        name: row.campaign?.name ?? `Campaign ${id}`,
        type: row.campaign?.advertisingChannelType ?? 'UNKNOWN',
        status: row.campaign?.status ?? 'UNKNOWN',
        biddingStrategyType: row.campaign?.biddingStrategyType,
        dailyBudget,
        periodBudget,
        spend,
        spendShare: 0,
        budgetUtilization: periodBudget > 0 ? round2((spend / periodBudget) * 100) : 0,
        leftover: round2(Math.max(0, periodBudget - spend)),
        impressions: m.impressions,
        clicks: m.clicks,
        conversions: round2(m.conversions),
        ctr: rates.ctr,
        avgCpc: rates.avgCpc,
        conversionRate: rates.conversionRate,
        costPerConversion: rates.costPerConversion,
        searchImpressionShare:
          m.isWeight > 0 ? round2(m.isWeighted / m.isWeight) : undefined,
        budgetLostIs: m.isWeight > 0 ? round2(m.budgetLostWeighted / m.isWeight) : undefined,
        rankLostIs: m.isWeight > 0 ? round2(m.rankLostWeighted / m.isWeight) : undefined,
      });
    }

    const totalSpend = campaignRows.reduce((s, c) => s + c.spend, 0);
    for (const c of campaignRows) {
      c.spendShare = totalSpend > 0 ? round2((c.spend / totalSpend) * 100) : 0;
    }
    campaignRows.sort((a, b) => b.spend - a.spend);

    const adAgg = new Map<string, BudgetAdRow>();
    for (const row of adRows) {
      const adId = row.adGroupAd?.ad?.id;
      const campaignId = row.campaign?.id;
      if (!adId || !campaignId) continue;
      const key = `${campaignId}:${adId}`;
      const spend = Number(row.metrics?.costMicros ?? 0) / 1_000_000;
      const existing = adAgg.get(key);
      if (existing) {
        existing.spend += spend;
        existing.impressions += Number(row.metrics?.impressions ?? 0);
        existing.clicks += Number(row.metrics?.clicks ?? 0);
        existing.conversions += Number(row.metrics?.conversions ?? 0);
        continue;
      }
      const headlines = parseAdTextAssets(row.adGroupAd?.ad?.responsiveSearchAd?.headlines);
      adAgg.set(key, {
        adId,
        campaignId,
        campaignName: row.campaign?.name ?? '',
        adGroupName: row.adGroup?.name ?? 'Ad group',
        status: row.adGroupAd?.status ?? 'UNKNOWN',
        headline: headlines[0] ?? `Ad ${adId}`,
        spend,
        spendShare: 0,
        impressions: Number(row.metrics?.impressions ?? 0),
        clicks: Number(row.metrics?.clicks ?? 0),
        conversions: Number(row.metrics?.conversions ?? 0),
        ctr: 0,
        avgCpc: 0,
        costPerConversion: 0,
      });
    }
    const ads = [...adAgg.values()]
      .map((ad) => {
        const rates = computeRates(ad);
        return {
          ...ad,
          spend: round2(ad.spend),
          conversions: round2(ad.conversions),
          spendShare: totalSpend > 0 ? round2((ad.spend / totalSpend) * 100) : 0,
          ctr: rates.ctr,
          avgCpc: rates.avgCpc,
          costPerConversion: rates.costPerConversion,
        };
      })
      .sort((a, b) => b.spend - a.spend)
      .slice(0, 40);

    const kwAgg = new Map<string, BudgetKeywordRow>();
    for (const row of keywordRows) {
      const text = row.adGroupCriterion?.keyword?.text?.trim();
      const campaignId = row.campaign?.id;
      if (!text || !campaignId) continue;
      const matchType = row.adGroupCriterion?.keyword?.matchType ?? 'UNKNOWN';
      const key = `${campaignId}:${row.adGroup?.name ?? ''}:${text}:${matchType}`.toLowerCase();
      const spend = Number(row.metrics?.costMicros ?? 0) / 1_000_000;
      const existing = kwAgg.get(key);
      if (existing) {
        existing.spend += spend;
        existing.impressions += Number(row.metrics?.impressions ?? 0);
        existing.clicks += Number(row.metrics?.clicks ?? 0);
        existing.conversions += Number(row.metrics?.conversions ?? 0);
        continue;
      }
      kwAgg.set(key, {
        campaignId,
        campaignName: row.campaign?.name ?? '',
        adGroupName: row.adGroup?.name ?? 'Ad group',
        keyword: text,
        matchType,
        qualityScore: row.adGroupCriterion?.qualityInfo?.qualityScore,
        spend,
        spendShare: 0,
        impressions: Number(row.metrics?.impressions ?? 0),
        clicks: Number(row.metrics?.clicks ?? 0),
        conversions: Number(row.metrics?.conversions ?? 0),
        ctr: 0,
        avgCpc: 0,
        costPerConversion: 0,
      });
    }
    const keywords = [...kwAgg.values()]
      .map((kw) => {
        const rates = computeRates(kw);
        return {
          ...kw,
          spend: round2(kw.spend),
          conversions: round2(kw.conversions),
          spendShare: totalSpend > 0 ? round2((kw.spend / totalSpend) * 100) : 0,
          ctr: rates.ctr,
          avgCpc: rates.avgCpc,
          costPerConversion: rates.costPerConversion,
        };
      })
      .sort((a, b) => b.spend - a.spend)
      .slice(0, 50);

    const dailyMap = new Map<string, BudgetDailyRow>();
    for (const row of dailyRows) {
      const date = row.segments?.date;
      if (!date) continue;
      const existing = dailyMap.get(date) ?? {
        date,
        spend: 0,
        clicks: 0,
        conversions: 0,
        impressions: 0,
      };
      existing.spend += Number(row.metrics?.costMicros ?? 0) / 1_000_000;
      existing.clicks += Number(row.metrics?.clicks ?? 0);
      existing.conversions += Number(row.metrics?.conversions ?? 0);
      existing.impressions += Number(row.metrics?.impressions ?? 0);
      dailyMap.set(date, existing);
    }
    const daily = [...dailyMap.values()]
      .map((d) => ({
        ...d,
        spend: round2(d.spend),
        conversions: round2(d.conversions),
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const enabled = campaignRows.filter((c) => c.status === 'ENABLED');
    const enabledDailyBudget = enabled.reduce((s, c) => s + c.dailyBudget, 0);
    const totalDailyBudget = campaignRows.reduce((s, c) => s + c.dailyBudget, 0);
    const expectedSpend = enabledDailyBudget * windowDays;
    const clicks = campaignRows.reduce((s, c) => s + c.clicks, 0);
    const impressions = campaignRows.reduce((s, c) => s + c.impressions, 0);
    const conversions = campaignRows.reduce((s, c) => s + c.conversions, 0);
    const rates = computeRates({ impressions, clicks, conversions, cost: totalSpend });

    return {
      account: {
        currency,
        timezone,
        windowDays,
        dateRange,
        totalSpend: round2(totalSpend),
        totalDailyBudget: round2(totalDailyBudget),
        enabledDailyBudget: round2(enabledDailyBudget),
        expectedSpend: round2(expectedSpend),
        pacePercent: expectedSpend > 0 ? round2((totalSpend / expectedSpend) * 100) : 0,
        leftover: round2(Math.max(0, expectedSpend - totalSpend)),
        clicks,
        impressions,
        conversions: round2(conversions),
        ctr: rates.ctr,
        avgCpc: rates.avgCpc,
        conversionRate: rates.conversionRate,
        costPerConversion: rates.costPerConversion,
        activeCampaigns: enabled.length,
        constrainedCampaigns: enabled.filter((c) => c.dailyBudget > 0 && c.budgetUtilization >= 95)
          .length,
        underspentCampaigns: enabled.filter((c) => c.dailyBudget > 0 && c.budgetUtilization < 70)
          .length,
      },
      campaigns: campaignRows,
      ads,
      keywords,
      daily,
    };
  } catch (err) {
    console.error('fetchAccountBudgetBreakdown failed:', err);
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

export interface CampaignPublishContextDto {
  source: 'google_ads_api' | 'mock' | 'unavailable';
  currency: string;
  windowDays: number;
  oauth: {
    googleAdsConfigured: boolean;
    hasRefreshToken: boolean;
  };
  campaign: {
    id: string;
    name: string;
    status: string;
    channelType?: string;
  };
  budget: {
    dailyBudget?: number;
    periodSpend?: number;
    utilizationPercent?: number;
  };
  bidding: {
    strategyType?: string;
    targetCpa?: number;
    targetRoas?: number;
  };
  locations: Array<{ name: string; excluded?: boolean }>;
  keywords: Array<{ text: string; matchType?: string; adGroupName?: string }>;
  campaignNegativeKeywords: Array<{ text: string; matchType?: string }>;
  conversions: Array<{ name: string; type?: string; status?: string; category?: string }>;
  devices: Array<{
    device: string;
    impressions: number;
    clicks: number;
    conversions: number;
    ctr: number;
    cost: number;
    conversionSharePercent?: number;
  }>;
  adSchedule: Array<{ day?: string; startHour?: number; endHour?: number }>;
  networks: {
    targetGoogleSearch?: boolean;
    targetSearchNetwork?: boolean;
    targetContentNetwork?: boolean;
  };
  tracking: {
    healthy: boolean;
    warnings: string[];
    enabledConversionCount: number;
  };
  connection: {
    customerId: string;
    accountName?: string;
  };
  errors?: string[];
}

function microsToCurrency(micros?: string | number | null): number | undefined {
  if (micros == null || micros === '') return undefined;
  const n = Number(micros);
  if (!Number.isFinite(n)) return undefined;
  return round2(n / 1_000_000);
}

/** Live Google Ads settings for Make It Better publish review (no hardcoded campaign data). */
export async function fetchCampaignPublishContext(
  refreshToken: string | undefined,
  customerId: string,
  campaignId: string,
  userId?: string,
  options?: { loginCustomerId?: string; managerIds?: string[]; windowDays?: number }
): Promise<CampaignPublishContextDto | null> {
  const cid = campaignId.replace(/\D/g, '');
  if (!cid) return null;

  const windowDays = options?.windowDays ?? 30;
  const dateRange = dateRangeForDays(windowDays);
  const bareCustomer = bareCustomerId(customerId);

  const baseErrors: string[] = [];
  const oauth = {
    googleAdsConfigured: isGoogleAdsConfigured(),
    hasRefreshToken: !!refreshToken,
  };

  if (!oauth.googleAdsConfigured || !refreshToken) {
    return {
      source: 'unavailable',
      currency: 'USD',
      windowDays,
      oauth,
      campaign: { id: cid, name: '', status: 'UNKNOWN' },
      budget: {},
      bidding: {},
      locations: [],
      keywords: [],
      campaignNegativeKeywords: [],
      conversions: [],
      devices: [],
      adSchedule: [],
      networks: {},
      tracking: { healthy: false, warnings: ['Google Ads not connected'], enabledConversionCount: 0 },
      connection: { customerId: bareCustomer },
      errors: ['Connect Google Ads to load live campaign settings.'],
    };
  }

  try {
    const accessToken = await resolveAccessToken(refreshToken, userId);
    if (!accessToken) {
      return null;
    }

    let loginId = options?.loginCustomerId?.replace(/-/g, '');
    if (!loginId) {
      const { resourceNames } = await listAccessibleCustomerResourceNames(accessToken);
      const managerCustomerId = await resolveManagerCustomerId(
        accessToken,
        resourceNames ?? undefined
      );
      loginId = loginCustomerIdForTarget(customerId, managerCustomerId);
    }

    const searchOpts = { loginCustomerId: loginId, silent: true as const };
    const campaignClause = ` AND campaign.id = ${cid}`;

    const customerMeta = await getCustomerMeta(accessToken, customerId, loginId);
    const currency = customerMeta?.currencyCode ?? 'USD';

    const [
      campaignRows,
      keywordRows,
      negativeRows,
      locationRows,
      scheduleRows,
      deviceRows,
      conversionRows,
    ] = await Promise.all([
      searchCustomer<Record<string, unknown>>(
        accessToken,
        customerId,
        `SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type,
                campaign.bidding_strategy_type, campaign.network_settings.target_google_search,
                campaign.network_settings.target_search_network,
                campaign.network_settings.target_content_network,
                campaign.maximize_conversions.target_cpa_micros,
                campaign.target_cpa.target_cpa_micros,
                campaign.target_roas.target_roas,
                campaign_budget.amount_micros,
                metrics.cost_micros
         FROM campaign
         WHERE segments.date DURING ${dateRange}${campaignClause}
         LIMIT 5`,
        searchOpts
      ),
      searchCustomer<Record<string, unknown>>(
        accessToken,
        customerId,
        `SELECT ad_group.name, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type,
                metrics.clicks, metrics.conversions
         FROM keyword_view
         WHERE segments.date DURING ${dateRange}${campaignClause}
         ORDER BY metrics.clicks DESC
         LIMIT 40`,
        searchOpts
      ),
      searchCustomer<Record<string, unknown>>(
        accessToken,
        customerId,
        `SELECT campaign_criterion.keyword.text, campaign_criterion.keyword.match_type
         FROM campaign_criterion
         WHERE campaign.id = ${cid}
           AND campaign_criterion.type = 'KEYWORD'
           AND campaign_criterion.negative = true
         LIMIT 50`,
        searchOpts
      ),
      searchCustomer<Record<string, unknown>>(
        accessToken,
        customerId,
        `SELECT campaign_criterion.negative, geo_target_constant.name, geo_target_constant.canonical_name
         FROM campaign_criterion
         WHERE campaign.id = ${cid} AND campaign_criterion.type = 'LOCATION'
         LIMIT 40`,
        searchOpts
      ),
      searchCustomer<Record<string, unknown>>(
        accessToken,
        customerId,
        `SELECT campaign_criterion.ad_schedule.day_of_week,
                campaign_criterion.ad_schedule.start_hour,
                campaign_criterion.ad_schedule.end_hour
         FROM campaign_criterion
         WHERE campaign.id = ${cid} AND campaign_criterion.type = 'AD_SCHEDULE'
         LIMIT 20`,
        searchOpts
      ),
      searchCustomer<Record<string, unknown>>(
        accessToken,
        customerId,
        `SELECT segments.device, metrics.impressions, metrics.clicks, metrics.conversions, metrics.cost_micros
         FROM campaign
         WHERE segments.date DURING ${dateRange}${campaignClause}`,
        searchOpts
      ),
      searchCustomer<Record<string, unknown>>(
        accessToken,
        customerId,
        `SELECT conversion_action.name, conversion_action.type, conversion_action.status,
                conversion_action.category
         FROM conversion_action
         WHERE conversion_action.status = 'ENABLED'
         LIMIT 20`,
        searchOpts
      ),
    ]);

    const camp0 = campaignRows[0] ?? {};
    const campaign = camp0.campaign as {
      name?: string;
      status?: string;
      advertisingChannelType?: string;
      biddingStrategyType?: string;
      networkSettings?: {
        targetGoogleSearch?: boolean;
        targetSearchNetwork?: boolean;
        targetContentNetwork?: boolean;
      };
      maximizeConversions?: { targetCpaMicros?: string };
      targetCpa?: { targetCpaMicros?: string };
      targetRoas?: { targetRoas?: number };
    } | undefined;
    const campaignBudget = camp0.campaignBudget as { amountMicros?: string } | undefined;
    let periodSpend = 0;
    for (const row of campaignRows) {
      const m = row.metrics as { costMicros?: string } | undefined;
      periodSpend += Number(m?.costMicros ?? 0) / 1_000_000;
    }
    periodSpend = round2(periodSpend);
    const dailyBudget = microsToCurrency(campaignBudget?.amountMicros);
    const utilizationPercent =
      dailyBudget && dailyBudget > 0 && windowDays > 0
        ? round2((periodSpend / (dailyBudget * windowDays)) * 100)
        : undefined;

    const targetCpaMicros =
      campaign?.targetCpa?.targetCpaMicros ?? campaign?.maximizeConversions?.targetCpaMicros;

    const keywords: CampaignPublishContextDto['keywords'] = [];
    const seenKw = new Set<string>();
    for (const row of keywordRows) {
      const ag = row.adGroup as { name?: string } | undefined;
      const crit = row.adGroupCriterion as {
        keyword?: { text?: string; matchType?: string };
      } | undefined;
      const text = crit?.keyword?.text?.trim();
      if (!text) continue;
      const key = text.toLowerCase();
      if (seenKw.has(key)) continue;
      seenKw.add(key);
      keywords.push({
        text,
        matchType: crit?.keyword?.matchType,
        adGroupName: ag?.name,
      });
    }

    const campaignNegativeKeywords: CampaignPublishContextDto['campaignNegativeKeywords'] = [];
    for (const row of negativeRows) {
      const crit = row.campaignCriterion as {
        keyword?: { text?: string; matchType?: string };
      } | undefined;
      const text = crit?.keyword?.text?.trim();
      if (text) {
        campaignNegativeKeywords.push({
          text,
          matchType: crit?.keyword?.matchType,
        });
      }
    }

    const locations: CampaignPublishContextDto['locations'] = [];
    for (const row of locationRows) {
      const crit = row.campaignCriterion as { negative?: boolean } | undefined;
      const geo = row.geoTargetConstant as { name?: string; canonicalName?: string } | undefined;
      const name = geo?.canonicalName ?? geo?.name;
      if (name) {
        locations.push({ name, excluded: crit?.negative === true });
      }
    }

    const adSchedule: CampaignPublishContextDto['adSchedule'] = [];
    for (const row of scheduleRows) {
      const crit = row.campaignCriterion as {
        adSchedule?: { dayOfWeek?: string; startHour?: number; endHour?: number };
      } | undefined;
      const s = crit?.adSchedule;
      if (s) {
        adSchedule.push({
          day: s.dayOfWeek,
          startHour: s.startHour,
          endHour: s.endHour,
        });
      }
    }

    const deviceAgg = new Map<
      string,
      { impressions: number; clicks: number; conversions: number; cost: number }
    >();
    for (const row of deviceRows) {
      const device = String((row.segments as { device?: string } | undefined)?.device ?? 'UNKNOWN');
      const m = row.metrics as {
        impressions?: string;
        clicks?: string;
        conversions?: number;
        costMicros?: string;
      } | undefined;
      const prev = deviceAgg.get(device) ?? {
        impressions: 0,
        clicks: 0,
        conversions: 0,
        cost: 0,
      };
      prev.impressions += Number(m?.impressions ?? 0);
      prev.clicks += Number(m?.clicks ?? 0);
      prev.conversions += Number(m?.conversions ?? 0);
      prev.cost += Number(m?.costMicros ?? 0) / 1_000_000;
      deviceAgg.set(device, prev);
    }
    const totalConv = [...deviceAgg.values()].reduce((s, d) => s + d.conversions, 0);
    const devices: CampaignPublishContextDto['devices'] = [...deviceAgg.entries()].map(
      ([device, d]) => ({
        device,
        impressions: d.impressions,
        clicks: d.clicks,
        conversions: round2(d.conversions),
        ctr: d.impressions > 0 ? round2((d.clicks / d.impressions) * 100) : 0,
        cost: round2(d.cost),
        conversionSharePercent:
          totalConv > 0 ? round2((d.conversions / totalConv) * 100) : undefined,
      })
    );

    const conversions: CampaignPublishContextDto['conversions'] = [];
    for (const row of conversionRows) {
      const ca = row.conversionAction as {
        name?: string;
        type?: string;
        status?: string;
        category?: string;
      } | undefined;
      if (ca?.name) {
        conversions.push({
          name: ca.name,
          type: ca.type,
          status: ca.status,
          category: ca.category,
        });
      }
    }

    const trackingWarnings: string[] = [];
    if (conversions.length === 0) {
      trackingWarnings.push('No enabled conversion actions found in this account.');
    }
    const healthy = conversions.length > 0 && trackingWarnings.length === 0;

    return {
      source: 'google_ads_api',
      currency,
      windowDays,
      oauth,
      campaign: {
        id: cid,
        name: campaign?.name ?? '',
        status: campaign?.status ?? 'UNKNOWN',
        channelType: campaign?.advertisingChannelType,
      },
      budget: {
        dailyBudget,
        periodSpend,
        utilizationPercent,
      },
      bidding: {
        strategyType: campaign?.biddingStrategyType,
        targetCpa: microsToCurrency(targetCpaMicros),
        targetRoas: campaign?.targetRoas?.targetRoas,
      },
      locations,
      keywords,
      campaignNegativeKeywords,
      conversions,
      devices,
      adSchedule,
      networks: {
        targetGoogleSearch: campaign?.networkSettings?.targetGoogleSearch,
        targetSearchNetwork: campaign?.networkSettings?.targetSearchNetwork,
        targetContentNetwork: campaign?.networkSettings?.targetContentNetwork,
      },
      tracking: {
        healthy,
        warnings: trackingWarnings,
        enabledConversionCount: conversions.length,
      },
      connection: {
        customerId: bareCustomer,
        accountName: customerMeta?.descriptiveName,
      },
      errors: baseErrors.length ? baseErrors : undefined,
    };
  } catch (err) {
    console.warn('fetchCampaignPublishContext failed:', err);
    return {
      source: 'unavailable',
      currency: 'USD',
      windowDays,
      oauth,
      campaign: { id: cid, name: '', status: 'UNKNOWN' },
      budget: {},
      bidding: {},
      locations: [],
      keywords: [],
      campaignNegativeKeywords: [],
      conversions: [],
      devices: [],
      adSchedule: [],
      networks: {},
      tracking: {
        healthy: false,
        warnings: ['Could not load settings from Google Ads API.'],
        enabledConversionCount: 0,
      },
      connection: { customerId: bareCustomer },
      errors: [err instanceof Error ? err.message : 'Google Ads API error'],
    };
  }
}

export function buildMockCampaignPublishContext(
  campaign: CampaignDto,
  customerId: string,
  currency = 'AUD'
): CampaignPublishContextDto {
  const utilization =
    campaign.budgetDaily > 0 && campaign.metricsWindowDays > 0
      ? round2((campaign.cost / (campaign.budgetDaily * campaign.metricsWindowDays)) * 100)
      : undefined;
  return {
    source: 'mock',
    currency,
    windowDays: campaign.metricsWindowDays ?? 30,
    oauth: { googleAdsConfigured: true, hasRefreshToken: true },
    campaign: {
      id: campaign.id,
      name: campaign.name,
      status: campaign.status,
      channelType: campaign.type,
    },
    budget: {
      dailyBudget: campaign.budgetDaily,
      periodSpend: campaign.cost,
      utilizationPercent: utilization,
    },
    bidding: {
      strategyType: campaign.biddingStrategyType,
    },
    locations: [],
    keywords: [],
    campaignNegativeKeywords: [],
    conversions: [{ name: 'Lead Form Submission', type: 'WEBPAGE', status: 'ENABLED' }],
    devices: [
      {
        device: 'MOBILE',
        impressions: Math.round(campaign.impressions * 0.55),
        clicks: Math.round(campaign.clicks * 0.52),
        conversions: round2(campaign.conversions * 0.68),
        ctr: campaign.ctr,
        cost: round2(campaign.cost * 0.5),
        conversionSharePercent: 68,
      },
      {
        device: 'DESKTOP',
        impressions: Math.round(campaign.impressions * 0.4),
        clicks: Math.round(campaign.clicks * 0.42),
        conversions: round2(campaign.conversions * 0.29),
        ctr: campaign.ctr,
        cost: round2(campaign.cost * 0.45),
        conversionSharePercent: 29,
      },
      {
        device: 'TABLET',
        impressions: Math.round(campaign.impressions * 0.05),
        clicks: Math.round(campaign.clicks * 0.06),
        conversions: round2(campaign.conversions * 0.03),
        ctr: campaign.ctr,
        cost: round2(campaign.cost * 0.05),
        conversionSharePercent: 3,
      },
    ],
    adSchedule: [],
    networks: {
      targetGoogleSearch: campaign.type === 'SEARCH',
      targetSearchNetwork: campaign.type === 'SEARCH',
    },
    tracking: { healthy: true, warnings: [], enabledConversionCount: 1 },
    connection: { customerId: bareCustomerId(customerId), accountName: 'Mock account' },
  };
}

export interface KeywordLiveMetric {
  keyword: string;
  /** Historical avg CPC from this account (keyword_view). */
  accountAvgCpc?: number;
  /** Current max CPC bid set in Google Ads for this keyword. */
  accountMaxCpc?: number;
  accountImpressions?: number;
  accountClicks?: number;
  accountConversions?: number;
  qualityScore?: number;
  /** Keyword Planner average CPC (market estimate). */
  plannerAvgCpc?: number;
  plannerLowBid?: number;
  plannerHighBid?: number;
  plannerMonthlySearches?: number;
}

function microsToMoney(micros: unknown): number | undefined {
  const n = Number(micros);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return round2(n / 1_000_000);
}

async function generateKeywordHistoricalMetrics(
  accessToken: string,
  customerId: string,
  keywords: string[],
  loginCustomerId?: string,
  country?: string
): Promise<Map<string, Omit<KeywordLiveMetric, 'keyword'>>> {
  const map = new Map<string, Omit<KeywordLiveMetric, 'keyword'>>();
  const unique = [...new Set(keywords.map((k) => k.trim()).filter(Boolean))].slice(0, 80);
  if (!unique.length) return map;

  const geo = googleAdsGeoTargetConstant(country);
  const body: Record<string, unknown> = {
    keywords: unique,
    keywordPlanNetwork: 'GOOGLE_SEARCH',
    language: 'languageConstants/1000',
  };
  if (geo) body.geoTargetConstants = [geo];

  const bareId = bareCustomerId(customerId);
  const versions = resolvedApiVersion
    ? [resolvedApiVersion, ...GOOGLE_ADS_API_VERSIONS.filter((v) => v !== resolvedApiVersion)]
    : [...GOOGLE_ADS_API_VERSIONS];

  for (const version of versions) {
    const res = await fetch(
      `https://googleads.googleapis.com/${version}/customers/${bareId}:generateKeywordHistoricalMetrics`,
      {
        method: 'POST',
        headers: googleAdsHeaders(accessToken, loginCustomerId),
        body: JSON.stringify(body),
      }
    );
    const text = await res.text();
    if (isRetryableGoogleAdsVersionError(res.status, text)) {
      if (resolvedApiVersion === version) resolvedApiVersion = null;
      continue;
    }
    if (!res.ok) {
      console.warn('[keyword-metrics] planner failed:', res.status, text.slice(0, 400));
      return map;
    }
    resolvedApiVersion = version;
    const json = JSON.parse(text) as {
      results?: Array<{
        text?: string;
        keywordMetrics?: {
          averageCpcMicros?: string;
          avgMonthlySearches?: string;
          lowTopOfPageBidMicros?: string;
          highTopOfPageBidMicros?: string;
        };
      }>;
    };
    for (const row of json.results ?? []) {
      const key = (row.text ?? '').trim().toLowerCase();
      if (!key) continue;
      const m = row.keywordMetrics;
      map.set(key, {
        plannerAvgCpc: microsToMoney(m?.averageCpcMicros),
        plannerLowBid: microsToMoney(m?.lowTopOfPageBidMicros),
        plannerHighBid: microsToMoney(m?.highTopOfPageBidMicros),
        plannerMonthlySearches: m?.avgMonthlySearches
          ? Number(m.avgMonthlySearches) || undefined
          : undefined,
      });
    }
    break;
  }
  return map;
}

/** Live CPC / bid data from Google Ads (account history + Keyword Planner). */
export async function fetchKeywordLiveMetrics(
  refreshToken: string,
  customerId: string,
  keywords: string[],
  userId?: string,
  options?: { loginCustomerId?: string; country?: string; location?: string; websiteUrl?: string; windowDays?: number }
): Promise<{ metrics: KeywordLiveMetric[]; currency: string; plannerAvailable: boolean } | null> {
  try {
    const accessToken = await resolveAccessToken(refreshToken, userId);
    if (!accessToken) return null;

    const loginId = options?.loginCustomerId?.replace(/-/g, '');
    const customer = await getCustomerMeta(accessToken, customerId, loginId);
    const currency = customer?.currencyCode ?? 'USD';
    const windowDays = options?.windowDays ?? 90;
    const dateRange = dateRangeForDays(windowDays);

    const wanted = new Set(keywords.map((k) => k.trim().toLowerCase()).filter(Boolean));
    const byKeyword = new Map<string, KeywordLiveMetric>();

    const accountRows = await searchCustomer<{
      adGroupCriterion?: {
        keyword?: { text?: string };
        cpcBidMicros?: string;
        qualityInfo?: { qualityScore?: number };
      };
      metrics?: {
        impressions?: string;
        clicks?: string;
        conversions?: number;
        averageCpc?: number;
        costMicros?: string;
      };
    }>(
      accessToken,
      customerId,
      `SELECT ad_group_criterion.keyword.text, ad_group_criterion.cpc_bid_micros,
              ad_group_criterion.quality_info.quality_score,
              metrics.impressions, metrics.clicks, metrics.conversions,
              metrics.average_cpc, metrics.cost_micros
       FROM keyword_view
       WHERE ad_group_criterion.status != 'REMOVED'
       AND campaign.status IN ('ENABLED', 'PAUSED')
       AND segments.date DURING ${dateRange}
       LIMIT 5000`,
      { loginCustomerId: loginId, silent: true }
    );

    for (const row of accountRows) {
      const text = row.adGroupCriterion?.keyword?.text?.trim();
      if (!text) continue;
      const key = text.toLowerCase();
      if (!wanted.has(key)) continue;
      const impressions = Number(row.metrics?.impressions ?? 0);
      const clicks = Number(row.metrics?.clicks ?? 0);
      const conversions = Number(row.metrics?.conversions ?? 0);
      const cost = Number(row.metrics?.costMicros ?? 0) / 1_000_000;
      const avgCpc =
        row.metrics?.averageCpc != null && row.metrics.averageCpc > 0
          ? round2(row.metrics.averageCpc)
          : clicks > 0
            ? round2(cost / clicks)
            : undefined;
      const existing = byKeyword.get(key);
      if (existing) {
        existing.accountImpressions = (existing.accountImpressions ?? 0) + impressions;
        existing.accountClicks = (existing.accountClicks ?? 0) + clicks;
        existing.accountConversions = round2((existing.accountConversions ?? 0) + conversions);
        if (avgCpc != null) existing.accountAvgCpc = avgCpc;
      } else {
        byKeyword.set(key, {
          keyword: text,
          accountAvgCpc: avgCpc,
          accountMaxCpc: microsToMoney(row.adGroupCriterion?.cpcBidMicros),
          accountImpressions: impressions,
          accountClicks: clicks,
          accountConversions: conversions,
          qualityScore: row.adGroupCriterion?.qualityInfo?.qualityScore,
        });
      }
    }

    const country =
      options?.country ||
      resolveMarketCountry({
        location: options?.location,
        websiteUrl: options?.websiteUrl,
      }) ||
      'AU';
    const plannerMap = await generateKeywordHistoricalMetrics(
      accessToken,
      customerId,
      keywords,
      loginId,
      country
    );

    for (const kw of keywords) {
      const key = kw.trim().toLowerCase();
      if (!key) continue;
      const planner = plannerMap.get(key);
      const existing = byKeyword.get(key);
      if (existing && planner) {
        byKeyword.set(key, { ...existing, ...planner });
      } else if (planner) {
        byKeyword.set(key, { keyword: kw.trim(), ...planner });
      } else if (!existing) {
        byKeyword.set(key, { keyword: kw.trim() });
      }
    }

    return {
      metrics: [...byKeyword.values()],
      currency,
      plannerAvailable: plannerMap.size > 0,
    };
  } catch (err) {
    console.error('fetchKeywordLiveMetrics failed:', err);
    return null;
  }
}
