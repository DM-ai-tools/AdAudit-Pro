import { env } from '../config/env.js';
import {
  GOOGLE_ADS_API_VERSIONS,
  isRetryableGoogleAdsVersionError,
} from '../config/google-ads-api.js';
import { prisma } from '../lib/prisma.js';
import { getMe } from './user.service.js';
import {
  fetchCampaignsForAccount,
  getGoogleAdsAccountsForUser,
  isGoogleAdsConfigured,
  listManagerCustomerIds,
  resolveAccountLoginCustomerId,
  type CampaignAdDto,
} from './google-ads.service.js';
import { getGoogleAccessTokenForUser } from './google-oauth.service.js';
import { getMockCampaigns } from '../data/google-ads-campaigns.js';
import {
  campaignTypeLabel,
  defaultAdFormatLabel,
  normalizeAccountCampaignType,
  supportsAutomatedRsaCreate,
  toGoogleAdsAdvertisingChannelType,
  type AccountCampaignTypeKey,
} from '../utils/competitor-campaign-type.js';

export interface PublishAdRequest {
  userId: string;
  optimizationId: string;
  googleAdsCustomerId: string;
  adGroupAdResourceName?: string;
  /**
   * When true and replacing an existing ad, pause the previous ad after creating the new one.
   * Default false: create new ad and keep the existing ad active (no destructive pause).
   */
  pauseExistingAd?: boolean;
  /**
   * When true, update the existing RSA in place (same ad resource) instead of creating a new ad.
   * Used by the dashboard Edit Ads flow.
   */
  updateInPlace?: boolean;
  content: {
    headlines: string[];
    descriptions: string[];
    longHeadlines?: string[];
    displayPaths?: { path1?: string; path2?: string };
    finalUrl?: string;
  };
}

export type PublishStepStatus = 'pending' | 'running' | 'complete' | 'failed' | 'skipped';

export interface PublishStep {
  id: string;
  label: string;
  status: PublishStepStatus;
}

export interface PublishAdResult {
  publishedId: string;
  status: 'PUBLISHED' | 'SIMULATED' | 'FAILED';
  message: string;
  resourceName?: string;
  rollbackAvailable?: boolean;
  scenario?: string;
  campaignName?: string;
  accountName?: string;
  publishedAt?: string;
  versionSaved?: boolean;
  steps?: PublishStep[];
}

export interface PublishStatusResult {
  publishedId: string;
  status: string;
  steps: PublishStep[];
  message?: string;
  campaignName?: string;
  accountName?: string;
  publishedAt?: string;
  rollbackAvailable: boolean;
  rolledBackAt?: string;
  errorMessage?: string;
}

export interface RollbackAdResult {
  success: boolean;
  message: string;
}

export interface PublishingPermissions {
  canPublish: boolean;
  reason?: string;
}

const GOOGLE_ADS_API_VERSIONS_LIST = [...GOOGLE_ADS_API_VERSIONS];

const DEFAULT_STEPS: PublishStep[] = [
  { id: 'validate', label: 'Validating permissions', status: 'pending' },
  { id: 'token', label: 'Refreshing OAuth token', status: 'pending' },
  { id: 'resolve', label: 'Resolving campaign & ad group', status: 'pending' },
  { id: 'campaign', label: 'Creating campaign', status: 'pending' },
  { id: 'adgroup', label: 'Creating ad group', status: 'pending' },
  { id: 'keywords', label: 'Adding keywords', status: 'pending' },
  { id: 'pause', label: 'Pausing previous ad', status: 'pending' },
  { id: 'create_ad', label: 'Creating optimized ad', status: 'pending' },
  { id: 'save', label: 'Saving version history', status: 'pending' },
];

function bareCustomerId(id: string): string {
  return id.replace(/-/g, '');
}

/** `customers/123/adGroupAds/456~789` → `customers/123/adGroups/456` */
function adGroupResourceNameFromAdGroupAd(adGroupAdResourceName?: string | null): string | null {
  if (!adGroupAdResourceName) return null;
  const match = adGroupAdResourceName.match(
    /^(customers\/\d+)\/adGroupAds\/(\d+)~\d+$/i
  );
  if (!match) return null;
  return `${match[1]}/adGroups/${match[2]}`;
}

function googleAdsHeaders(
  accessToken: string,
  loginCustomerId?: string | null
): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'developer-token': env.googleAdsDeveloperToken,
    'Content-Type': 'application/json',
  };
  const loginId = (loginCustomerId || env.googleAdsManagerAccountId || '').replace(/-/g, '');
  if (loginId) {
    headers['login-customer-id'] = loginId;
  }
  return headers;
}

function parseGoogleAdsError(body: string, status: number): string {
  try {
    const json = JSON.parse(body) as {
      error?: {
        message?: string;
        status?: string;
        details?: Array<{
          errors?: Array<{
            message?: string;
            errorCode?: Record<string, string>;
            location?: { fieldPathElements?: Array<{ fieldName?: string; index?: number }> };
          }>;
        }>;
      };
    };
    const details = json.error?.details ?? [];
    const fieldErrors: string[] = [];
    for (const detail of details) {
      for (const err of detail.errors ?? []) {
        const code = err.errorCode ? Object.entries(err.errorCode).map(([k, v]) => `${k}:${v}`).join(',') : '';
        const path = (err.location?.fieldPathElements ?? [])
          .map((p) => (p.index !== undefined ? `${p.fieldName}[${p.index}]` : p.fieldName))
          .filter(Boolean)
          .join('.');
        const piece = [err.message, code && `(${code})`, path && `at ${path}`].filter(Boolean).join(' ');
        if (piece) fieldErrors.push(piece);
      }
    }
    if (fieldErrors.length) {
      return fieldErrors.slice(0, 3).join(' | ');
    }

    const msg = json.error?.message;
    if (msg) {
      if (msg.includes('invalid_grant') || msg.includes('Token has been expired or revoked')) {
        return 'Your Google session expired. Sign out and reconnect your Google account.';
      }
      if (
        msg.includes('USER_PERMISSION_DENIED') ||
        msg.includes('PERMISSION_DENIED') ||
        /caller does not have permission/i.test(msg)
      ) {
        return 'Your Google account does not have permission to modify this Google Ads account. Reconnect with Ads access and ensure you have Standard or Admin access.';
      }
      if (msg.includes('RESOURCE_NOT_FOUND') || msg.includes('NOT_FOUND')) {
        return 'Campaign or ad group not found in Google Ads. It may have been removed.';
      }
      return msg;
    }
  } catch {
    /* not JSON */
  }
  return `Google Ads API error (HTTP ${status})`;
}

/** Google Ads counts many non-Latin / symbol chars as width 2. */
function googleAdsCharWidth(text: string): number {
  let width = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    // ASCII + common Latin-1 punctuation count as 1; most symbols/CJK as 2
    if (code <= 0x00ff) width += 1;
    else width += 2;
  }
  return width;
}

function truncateGoogleAdsText(text: string, maxWidth: number): string {
  let width = 0;
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    const w = code <= 0x00ff ? 1 : 2;
    if (width + w > maxWidth) break;
    out += ch;
    width += w;
  }
  return out.trim();
}

function sanitizeRsaAssetText(text: string): string {
  return text
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2013\u2014\u2212]/g, '-')
    .replace(/[•·●▪◦‣∙]/g, '-')
    .replace(/\s*-\s*/g, ' - ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sanitizeDisplayPath(path?: string): string | undefined {
  if (!path) return undefined;
  const cleaned = path
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  if (!cleaned) return undefined;
  return truncateGoogleAdsText(cleaned, 15);
}

function buildResponsiveSearchAdPayload(content: PublishAdRequest['content']): {
  headlines: Array<{ text: string }>;
  descriptions: Array<{ text: string }>;
  path1?: string;
  path2?: string;
} {
  const seenHeadlines = new Set<string>();
  const headlines: Array<{ text: string }> = [];
  for (const raw of content.headlines ?? []) {
    const text = truncateGoogleAdsText(sanitizeRsaAssetText(raw), 30);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seenHeadlines.has(key)) continue;
    seenHeadlines.add(key);
    headlines.push({ text });
    if (headlines.length >= 15) break;
  }

  const seenDescriptions = new Set<string>();
  const descriptions: Array<{ text: string }> = [];
  for (const raw of content.descriptions ?? []) {
    const text = truncateGoogleAdsText(sanitizeRsaAssetText(raw), 90);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seenDescriptions.has(key)) continue;
    seenDescriptions.add(key);
    descriptions.push({ text });
    if (descriptions.length >= 4) break;
  }

  const path1 = sanitizeDisplayPath(content.displayPaths?.path1);
  const path2 = sanitizeDisplayPath(content.displayPaths?.path2);

  return {
    headlines,
    descriptions,
    ...(path1 ? { path1 } : {}),
    ...(path2 ? { path2 } : {}),
  };
}

async function searchGoogleAds<T>(
  accessToken: string,
  customerId: string,
  query: string,
  loginCustomerId?: string | null
): Promise<T[]> {
  for (const version of GOOGLE_ADS_API_VERSIONS_LIST) {
    const res = await fetch(
      `https://googleads.googleapis.com/${version}/customers/${bareCustomerId(customerId)}/googleAds:search`,
      {
        method: 'POST',
        headers: googleAdsHeaders(accessToken, loginCustomerId),
        body: JSON.stringify({ query }),
      }
    );
    const body = await res.text();
    if (isRetryableGoogleAdsVersionError(res.status, body)) continue;
    if (!res.ok) return [];
    const data = JSON.parse(body) as { results?: T[] };
    return data.results ?? [];
  }
  return [];
}

function isGoogleAdsPermissionDenied(error?: string): boolean {
  return Boolean(
    error &&
      /USER_PERMISSION_DENIED|PERMISSION_DENIED|does not have permission|login-customer-id/i.test(
        error
      )
  );
}

async function googleAdsMutate(
  accessToken: string,
  customerId: string,
  resource: string,
  operations: unknown[],
  loginCustomerId?: string | null
): Promise<{ success: boolean; resourceNames?: string[]; error?: string }> {
  for (const version of GOOGLE_ADS_API_VERSIONS_LIST) {
    const url = `https://googleads.googleapis.com/${version}/customers/${bareCustomerId(customerId)}/${resource}:mutate`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: googleAdsHeaders(accessToken, loginCustomerId),
        body: JSON.stringify({ operations }),
      });
    } catch (err) {
      console.warn(
        `[googleAdsMutate] ${resource} network error:`,
        err instanceof Error ? err.message : err
      );
      return {
        success: false,
        error: 'Could not reach Google Ads. Check your connection and try again.',
      };
    }

    const responseBody = await res.text();
    if (isRetryableGoogleAdsVersionError(res.status, responseBody)) continue;

    if (!res.ok) {
      console.error(`[googleAdsMutate] ${resource} failed HTTP ${res.status}:`, responseBody.slice(0, 2000));
      return { success: false, error: parseGoogleAdsError(responseBody, res.status) };
    }

    try {
      const json = JSON.parse(responseBody) as { results?: Array<{ resourceName?: string }> };
      return {
        success: true,
        resourceNames: json.results?.map((r) => r.resourceName).filter(Boolean) as string[],
      };
    } catch {
      return { success: true, resourceNames: [] };
    }
  }
  return { success: false, error: 'No supported Google Ads API version available.' };
}

async function collectPublishLoginCustomerIds(
  userId: string,
  googleAdsCustomerId: string
): Promise<Array<string | undefined>> {
  const ids: string[] = [];
  const seen = new Set<string>();
  const target = bareCustomerId(googleAdsCustomerId);

  const add = (id?: string | null) => {
    const bare = (id || '').replace(/-/g, '');
    if (!bare || bare === target || seen.has(bare)) return;
    seen.add(bare);
    ids.push(bare);
  };

  try {
    const user = await getMe(userId);
    if (user?.googleRefreshToken) {
      const { accounts } = await getGoogleAdsAccountsForUser(user.googleRefreshToken, userId);
      const account = accounts.find((a) => bareCustomerId(a.customerId) === target);
      if (account) add(resolveAccountLoginCustomerId(account, accounts));
      for (const mgr of listManagerCustomerIds(accounts)) add(mgr);
    }
  } catch (err) {
    console.warn('[publish] could not resolve account login-customer-id:', err);
  }

  add(env.googleAdsManagerAccountId);
  // Direct access last — some accounts do not need an MCC header
  return [...ids, undefined];
}

async function resolvePublishLoginCustomerId(
  userId: string,
  googleAdsCustomerId: string
): Promise<string | undefined> {
  const ids = await collectPublishLoginCustomerIds(userId, googleAdsCustomerId);
  return ids.find((id): id is string => Boolean(id));
}

async function googleAdsMutateWithLoginFallback(
  accessToken: string,
  customerId: string,
  resource: string,
  operations: unknown[],
  loginIds: Array<string | undefined>
): Promise<{
  success: boolean;
  resourceNames?: string[];
  error?: string;
  loginCustomerId?: string | null;
}> {
  let lastError: string | undefined;
  const tried = new Set<string>();

  for (const loginId of loginIds) {
    const key = loginId ?? '(none)';
    if (tried.has(key)) continue;
    tried.add(key);

    const result = await googleAdsMutate(
      accessToken,
      customerId,
      resource,
      operations,
      loginId
    );
    if (result.success) {
      console.log(`[googleAdsMutate] ${resource} ok with login-customer-id=${key}`);
      return { ...result, loginCustomerId: loginId };
    }
    lastError = result.error;
    if (!isGoogleAdsPermissionDenied(result.error)) {
      return { ...result, loginCustomerId: loginId };
    }
    console.warn(
      `[googleAdsMutate] ${resource} USER_PERMISSION_DENIED with login-customer-id=${key} — trying next MCC`
    );
  }

  return {
    success: false,
    error:
      lastError && isGoogleAdsPermissionDenied(lastError)
        ? 'Google Ads rejected this account (missing manager login-customer-id). Reconnect Google, pick the client account under your MCC, and retry. If you use a manager account, set GOOGLE_ADS_MANAGER_ACCOUNT_ID to that MCC id.'
        : lastError,
    loginCustomerId: loginIds[0],
  };
}

function cloneSteps(): PublishStep[] {
  return DEFAULT_STEPS.map((s) => ({ ...s }));
}

function setStep(steps: PublishStep[], id: string, status: PublishStepStatus): void {
  const step = steps.find((s) => s.id === id);
  if (step) step.status = status;
}

async function persistSteps(publishedId: string, steps: PublishStep[], extra?: Record<string, unknown>): Promise<void> {
  await prisma.publishedAdVersion.update({
    where: { id: publishedId },
    data: {
      performanceMetrics: { steps, ...extra } as object,
    },
  });
}

export async function validatePublishingPermissions(
  userId: string,
  googleAdsCustomerId: string
): Promise<PublishingPermissions> {
  if (!isGoogleAdsConfigured()) {
    return { canPublish: false, reason: 'Google Ads API is not configured on the server.' };
  }
  const user = await getMe(userId);
  if (!user?.googleRefreshToken) {
    return { canPublish: false, reason: 'Sign in with Google to publish ads.' };
  }
  if (!googleAdsCustomerId || googleAdsCustomerId === '0000000000') {
    return { canPublish: false, reason: 'Select a connected Google Ads account first.' };
  }
  return { canPublish: true };
}

async function findCampaignById(
  accessToken: string,
  customerId: string,
  campaignId: string,
  loginCustomerId?: string | null
): Promise<{ resourceName: string; name: string; type: string } | null> {
  const rows = await searchGoogleAds<{
    campaign?: { resourceName?: string; id?: string; name?: string; advertisingChannelType?: string };
  }>(
    accessToken,
    customerId,
    `SELECT campaign.resource_name, campaign.id, campaign.name, campaign.advertising_channel_type
     FROM campaign WHERE campaign.id = ${campaignId} AND campaign.status != 'REMOVED' LIMIT 1`,
    loginCustomerId
  );
  const c = rows[0]?.campaign;
  if (!c?.resourceName) return null;
  return { resourceName: c.resourceName, name: c.name ?? 'Campaign', type: c.advertisingChannelType ?? 'SEARCH' };
}

async function findAdGroupInCampaign(
  accessToken: string,
  customerId: string,
  campaignResourceName: string,
  loginCustomerId?: string | null
): Promise<string | null> {
  const rows = await searchGoogleAds<{ adGroup?: { resourceName?: string } }>(
    accessToken,
    customerId,
    `SELECT ad_group.resource_name FROM ad_group
     WHERE ad_group.campaign = '${campaignResourceName}'
     AND ad_group.status != 'REMOVED' LIMIT 1`,
    loginCustomerId
  );
  return rows[0]?.adGroup?.resourceName ?? null;
}

async function findTargetAdGroup(
  accessToken: string,
  customerId: string,
  adGroupResourceName?: string | null,
  loginCustomerId?: string | null
): Promise<string | null> {
  if (adGroupResourceName) return adGroupResourceName;
  const rows = await searchGoogleAds<{ adGroup?: { resourceName?: string } }>(
    accessToken,
    customerId,
    `SELECT ad_group.resource_name FROM ad_group
     WHERE ad_group.status != 'REMOVED' AND campaign.status != 'REMOVED'
     LIMIT 1`,
    loginCustomerId
  );
  return rows[0]?.adGroup?.resourceName ?? null;
}

export async function pauseExistingAd(
  accessToken: string,
  customerId: string,
  adGroupAdResourceName: string,
  loginCustomerId?: string | null
): Promise<boolean> {
  const result = await googleAdsMutate(
    accessToken,
    customerId,
    'adGroupAds',
    [
      {
        update: { resourceName: adGroupAdResourceName, status: 'PAUSED' },
        updateMask: 'status',
      },
    ],
    loginCustomerId
  );
  return result.success;
}

export async function createCampaign(
  accessToken: string,
  customerId: string,
  name: string,
  budgetResourceName: string,
  loginCustomerId?: string | null,
  options?: {
    biddingStrategy?: 'MANUAL_CPC' | 'MAXIMIZE_CLICKS' | 'MAXIMIZE_CONVERSIONS';
    advertisingChannelType?: string;
    cpcBidCeiling?: number;
    network?: {
      targetGoogleSearch?: boolean;
      targetSearchNetwork?: boolean;
      targetContentNetwork?: boolean;
      targetPartnerSearchNetwork?: boolean;
    };
    containsEuPoliticalAdvertising?: boolean;
  }
): Promise<{ success: boolean; resourceName?: string; error?: string }> {
  const channel = (options?.advertisingChannelType ?? 'SEARCH').toUpperCase();
  const biddingStrategy = options?.biddingStrategy ?? 'MANUAL_CPC';
  const network = options?.network ?? {};
  const createBody: Record<string, unknown> = {
    name: name.slice(0, 255),
    advertisingChannelType: channel,
    status: 'PAUSED',
    campaignBudget: budgetResourceName,
    containsEuPoliticalAdvertising: options?.containsEuPoliticalAdvertising
      ? 'CONTAINS_EU_POLITICAL_ADVERTISING'
      : 'DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING',
  };

  // Network settings apply to Search (and Search-based Call Ads). Other channels omit them.
  if (channel === 'SEARCH') {
    createBody.networkSettings = {
      targetGoogleSearch: network.targetGoogleSearch !== false,
      targetSearchNetwork: network.targetSearchNetwork !== false,
      targetContentNetwork: network.targetContentNetwork === true,
      targetPartnerSearchNetwork: network.targetPartnerSearchNetwork === true,
    };
  }

  if (channel === 'PERFORMANCE_MAX' || channel === 'DEMAND_GEN') {
    createBody.maximizeConversions = {};
  } else if (biddingStrategy === 'MAXIMIZE_CLICKS') {
    const ceiling = options?.cpcBidCeiling;
    createBody.targetSpend =
      ceiling && ceiling > 0
        ? { cpcBidCeilingMicros: String(Math.round(ceiling * 1_000_000)) }
        : {};
  } else if (biddingStrategy === 'MAXIMIZE_CONVERSIONS') {
    createBody.maximizeConversions = {};
  } else {
    createBody.manualCpc = {};
  }

  const result = await googleAdsMutate(
    accessToken,
    customerId,
    'campaigns',
    [{ create: createBody }],
    loginCustomerId
  );
  return {
    success: result.success,
    resourceName: result.resourceNames?.[0],
    error: result.error,
  };
}

async function createCampaignBudget(
  accessToken: string,
  customerId: string,
  dailyBudgetUsd: number,
  name: string,
  loginCustomerId?: string | null,
  loginIds?: Array<string | undefined>
): Promise<{
  success: boolean;
  resourceName?: string;
  error?: string;
  loginCustomerId?: string | null;
}> {
  const amountMicros = String(Math.max(1, Math.round(dailyBudgetUsd * 1_000_000)));
  const operations = [
    {
      create: {
        name: name.slice(0, 255),
        amountMicros,
        deliveryMethod: 'STANDARD',
        explicitlyShared: false,
      },
    },
  ];
  const result = loginIds?.length
    ? await googleAdsMutateWithLoginFallback(
        accessToken,
        customerId,
        'campaignBudgets',
        operations,
        loginIds
      )
    : await googleAdsMutate(accessToken, customerId, 'campaignBudgets', operations, loginCustomerId);
  return {
    success: result.success,
    resourceName: result.resourceNames?.[0],
    error: result.error,
    loginCustomerId:
      'loginCustomerId' in result
        ? (result.loginCustomerId as string | null | undefined)
        : loginCustomerId,
  };
}

export async function createAdGroup(
  accessToken: string,
  customerId: string,
  campaignResourceName: string,
  name: string,
  loginCustomerId?: string | null,
  defaultCpc?: number,
  automatedBidding?: boolean
): Promise<{ success: boolean; resourceName?: string; error?: string }> {
  const createBody: Record<string, unknown> = {
    name: name.slice(0, 255),
    campaign: campaignResourceName,
    status: 'ENABLED',
    type: 'SEARCH_STANDARD',
  };
  // With Maximize Conversions Google sets bids at campaign level; ad-group CPC is a legacy fallback only.
  if (!automatedBidding) {
    const cpc = defaultCpc && defaultCpc > 0 ? defaultCpc : 1;
    createBody.cpcBidMicros = String(Math.round(cpc * 1_000_000));
  }
  const result = await googleAdsMutate(
    accessToken,
    customerId,
    'adGroups',
    [{ create: createBody }],
    loginCustomerId
  );
  return {
    success: result.success,
    resourceName: result.resourceNames?.[0],
    error: result.error,
  };
}

async function createKeywords(
  accessToken: string,
  customerId: string,
  adGroupResourceName: string,
  keywords: string[],
  loginCustomerId?: string | null,
  matchType: 'BROAD' | 'PHRASE' | 'EXACT' = 'BROAD',
  keywordBids?: Array<{ keyword: string; matchType?: 'BROAD' | 'PHRASE' | 'EXACT'; cpc?: number }>
): Promise<{ success: boolean; added: number; error?: string }> {
  const bidByText = new Map(
    (keywordBids ?? []).map((b) => [b.keyword.trim().toLowerCase(), b])
  );
  const unique = [...new Set(keywords.map((k) => k.trim()).filter(Boolean))].slice(0, 50);
  if (!unique.length) return { success: true, added: 0 };

  const operations = unique.map((text) => {
    const bid = bidByText.get(text.toLowerCase());
    const row: Record<string, unknown> = {
      adGroup: adGroupResourceName,
      status: 'ENABLED',
      keyword: {
        text: text.slice(0, 80),
        matchType: bid?.matchType === 'PHRASE' || bid?.matchType === 'EXACT' || bid?.matchType === 'BROAD'
          ? bid.matchType
          : matchType,
      },
    };
    if (bid?.cpc && bid.cpc > 0) {
      row.cpcBidMicros = String(Math.round(bid.cpc * 1_000_000));
    }
    return { create: row };
  });

  const result = await googleAdsMutate(
    accessToken,
    customerId,
    'adGroupCriteria',
    operations,
    loginCustomerId
  );
  return {
    success: result.success,
    added: result.success ? unique.length : 0,
    error: result.error,
  };
}

async function createNegativeKeywords(
  accessToken: string,
  customerId: string,
  adGroupResourceName: string,
  negatives: string[],
  loginCustomerId?: string | null
): Promise<void> {
  const unique = [...new Set(negatives.map((k) => k.trim()).filter((k) => k.length >= 2))].slice(0, 25);
  if (!unique.length) return;
  const operations = unique.map((text) => ({
    create: {
      adGroup: adGroupResourceName,
      status: 'ENABLED',
      negative: true,
      keyword: { text: text.slice(0, 80), matchType: 'PHRASE' },
    },
  }));
  const result = await googleAdsMutate(
    accessToken,
    customerId,
    'adGroupCriteria',
    operations,
    loginCustomerId
  );
  if (!result.success) {
    console.warn('[create-ad-in-campaign] negative keywords failed:', result.error);
  }
}

function adResourceNameFromAdGroupAd(adGroupAdResourceName: string): string | null {
  const match = adGroupAdResourceName.match(/^(customers\/\d+)\/adGroupAds\/\d+~(\d+)$/i);
  if (!match) return null;
  return `${match[1]}/ads/${match[2]}`;
}

export async function updateResponsiveSearchAdInPlace(
  accessToken: string,
  customerId: string,
  adGroupAdResourceName: string,
  content: PublishAdRequest['content'],
  finalUrl: string,
  loginCustomerId?: string | null
): Promise<{ success: boolean; resourceName?: string; error?: string }> {
  const adResourceName = adResourceNameFromAdGroupAd(adGroupAdResourceName);
  if (!adResourceName) {
    return { success: false, error: 'Invalid ad resource name for in-place update.' };
  }

  const rsa = buildResponsiveSearchAdPayload(content);
  if (rsa.headlines.length < 3) {
    return { success: false, error: 'At least 3 valid headlines are required to publish.' };
  }
  if (rsa.descriptions.length < 2) {
    return { success: false, error: 'At least 2 valid descriptions are required to publish.' };
  }

  const normalizedUrl = finalUrl.startsWith('http') ? finalUrl : `https://${finalUrl}`;
  const updateMask = [
    'final_urls',
    'responsive_search_ad.headlines',
    'responsive_search_ad.descriptions',
  ];
  if (rsa.path1) updateMask.push('responsive_search_ad.path1');
  if (rsa.path2) updateMask.push('responsive_search_ad.path2');

  const result = await googleAdsMutate(
    accessToken,
    customerId,
    'ads',
    [
      {
        update: {
          resourceName: adResourceName,
          finalUrls: [normalizedUrl],
          responsiveSearchAd: rsa,
        },
        updateMask: updateMask.join(','),
      },
    ],
    loginCustomerId
  );

  return {
    success: result.success,
    resourceName: adGroupAdResourceName,
    error: result.error,
  };
}

export async function createResponsiveSearchAd(
  accessToken: string,
  customerId: string,
  adGroupResourceName: string,
  content: PublishAdRequest['content'],
  finalUrl: string,
  loginCustomerId?: string | null,
  options?: { status?: 'PAUSED' | 'ENABLED' }
): Promise<{ success: boolean; resourceName?: string; error?: string }> {
  const rsa = buildResponsiveSearchAdPayload(content);
  if (rsa.headlines.length < 3) {
    return { success: false, error: 'At least 3 valid headlines are required to publish.' };
  }
  if (rsa.descriptions.length < 2) {
    return { success: false, error: 'At least 2 valid descriptions are required to publish.' };
  }

  const normalizedUrl = finalUrl.startsWith('http') ? finalUrl : `https://${finalUrl}`;
  const status = options?.status ?? 'PAUSED';

  const result = await googleAdsMutate(
    accessToken,
    customerId,
    'adGroupAds',
    [
      {
        create: {
          adGroup: adGroupResourceName,
          status,
          ad: {
            responsiveSearchAd: rsa,
            finalUrls: [normalizedUrl],
          },
        },
      },
    ],
    loginCustomerId
  );
  return {
    success: result.success,
    resourceName: result.resourceNames?.[0],
    error: result.error,
  };
}

export async function getPublishStatus(
  userId: string,
  publishedId: string
): Promise<PublishStatusResult | null> {
  const version = await prisma.publishedAdVersion.findFirst({
    where: { id: publishedId, userId },
    include: {
      aiOptimization: {
        select: { scenario: true, auditContext: true },
      },
    },
  });
  if (!version) return null;

  const metrics = version.performanceMetrics as {
    steps?: PublishStep[];
    campaignName?: string;
    accountName?: string;
  } | null;

  const auditCtx = version.aiOptimization?.auditContext as {
    business?: { name?: string };
    selectedCampaign?: { name?: string };
  } | null;

  return {
    publishedId: version.id,
    status: version.status,
    steps: metrics?.steps ?? [],
    message: version.errorMessage ?? undefined,
    campaignName: metrics?.campaignName ?? auditCtx?.selectedCampaign?.name,
    accountName: metrics?.accountName ?? auditCtx?.business?.name,
    publishedAt: version.publishedAt?.toISOString(),
    rollbackAvailable: version.rollbackAvailable,
    rolledBackAt: version.rolledBackAt?.toISOString(),
    errorMessage: version.errorMessage ?? undefined,
  };
}

export async function publishOptimizedAd(request: PublishAdRequest): Promise<PublishAdResult> {
  const optimization = await prisma.aIOptimization.findFirst({
    where: { id: request.optimizationId, userId: request.userId },
  });
  if (!optimization) throw new Error('Optimization not found');

  const originalAd = optimization.originalAd as {
    adGroupAdResourceName?: string;
    adGroupResourceName?: string;
    campaignResourceName?: string;
    campaignName?: string;
    finalUrls?: string[];
  };
  const optimizedContent = optimization.optimizedContent as {
    campaignStrategy?: {
      campaignName?: string;
      dailyBudget?: number;
      adGroups?: Array<{ name: string; keywords: string[] }>;
    };
    keywordSuggestions?: string[];
    displayPaths?: { path1?: string; path2?: string };
  };

  const scenario = optimization.scenario ?? 'CREATE_ADS';
  const previousAdResourceName =
    request.adGroupAdResourceName ?? originalAd.adGroupAdResourceName;

  const landingUrl =
    request.content.finalUrl ??
    originalAd.finalUrls?.[0] ??
    'https://www.example.com';

  const auditCtx = optimization.auditContext as { business?: { name?: string } } | null;
  const accountName = auditCtx?.business?.name ?? 'Google Ads Account';

  const steps = cloneSteps();
  for (const s of ['campaign', 'adgroup', 'keywords', 'pause'] as const) {
    setStep(steps, s, 'skipped');
  }

  const publishedRecord = await prisma.publishedAdVersion.create({
    data: {
      userId: request.userId,
      aiOptimizationId: request.optimizationId,
      googleAdsCustomerId: request.googleAdsCustomerId,
      campaignId: optimization.campaignId,
      adGroupId: optimization.adGroupId,
      previousAdResourceName: scenario === 'REPLACE_EXISTING' ? previousAdResourceName : null,
      originalAdSnapshot: optimization.originalAd as object,
      optimizedAdSnapshot: request.content as object,
      publishedContent: request.content as object,
      status: 'PENDING',
      performanceMetrics: { steps, accountName } as object,
    },
  });

  const permissions = await validatePublishingPermissions(request.userId, request.googleAdsCustomerId);
  setStep(steps, 'validate', permissions.canPublish ? 'complete' : 'failed');
  await persistSteps(publishedRecord.id, steps);

  if (!permissions.canPublish) {
    const updated = await prisma.publishedAdVersion.update({
      where: { id: publishedRecord.id },
      data: {
        status: 'SIMULATED',
        publishedAt: new Date(),
        errorMessage: permissions.reason,
      },
    });
    await prisma.aIOptimization.update({
      where: { id: request.optimizationId },
      data: { status: 'APPROVED' },
    });
    setStep(steps, 'save', 'complete');
    return {
      publishedId: updated.id,
      status: 'SIMULATED',
      scenario,
      message: permissions.reason ?? 'Cannot publish live.',
      accountName,
      versionSaved: true,
      steps,
    };
  }

  setStep(steps, 'token', 'running');
  await persistSteps(publishedRecord.id, steps);

  const accessToken = await getGoogleAccessTokenForUser(request.userId);
  if (!accessToken) {
    setStep(steps, 'token', 'failed');
    await prisma.publishedAdVersion.update({
      where: { id: publishedRecord.id },
      data: { status: 'FAILED', errorMessage: 'Could not refresh Google access token.' },
    });
    throw new Error('Could not refresh Google access token. Reconnect your Google account.');
  }
  setStep(steps, 'token', 'complete');

  const loginCustomerId = await resolvePublishLoginCustomerId(
    request.userId,
    request.googleAdsCustomerId
  );
  console.log(
    `[publish] customer=${bareCustomerId(request.googleAdsCustomerId)} login-customer-id=${loginCustomerId ?? '(none)'}`
  );

  setStep(steps, 'resolve', 'running');
  await persistSteps(publishedRecord.id, steps);

  let campaignResourceName = optimization.campaignResourceName ?? originalAd.campaignResourceName;
  let campaignName = originalAd.campaignName ?? optimizedContent.campaignStrategy?.campaignName ?? 'Campaign';
  let adGroupResourceName: string | null =
    optimization.adGroupResourceName ??
    originalAd.adGroupResourceName ??
    adGroupResourceNameFromAdGroupAd(previousAdResourceName);

  const customerId = request.googleAdsCustomerId;

  if (scenario === 'CREATE_STRATEGY') {
    setStep(steps, 'campaign', 'running');
    setStep(steps, 'adgroup', 'pending');
    setStep(steps, 'keywords', 'pending');
    await persistSteps(publishedRecord.id, steps);

    const strategyName = optimizedContent.campaignStrategy?.campaignName ?? `AI Campaign ${new Date().toISOString().slice(0, 10)}`;
    const dailyBudget = optimizedContent.campaignStrategy?.dailyBudget ?? 10;

    const budgetResult = await createCampaignBudget(
      accessToken,
      customerId,
      dailyBudget,
      `Budget — ${strategyName}`,
      loginCustomerId
    );
    if (!budgetResult.success || !budgetResult.resourceName) {
      setStep(steps, 'campaign', 'failed');
      await prisma.publishedAdVersion.update({
        where: { id: publishedRecord.id },
        data: { status: 'FAILED', errorMessage: budgetResult.error },
      });
      return {
        publishedId: publishedRecord.id,
        status: 'FAILED',
        scenario,
        message: budgetResult.error ?? 'Failed to create campaign budget.',
        steps,
      };
    }

    const campaignResult = await createCampaign(
      accessToken,
      customerId,
      strategyName,
      budgetResult.resourceName,
      loginCustomerId
    );
    if (!campaignResult.success || !campaignResult.resourceName) {
      setStep(steps, 'campaign', 'failed');
      await prisma.publishedAdVersion.update({
        where: { id: publishedRecord.id },
        data: { status: 'FAILED', errorMessage: campaignResult.error },
      });
      return {
        publishedId: publishedRecord.id,
        status: 'FAILED',
        scenario,
        message: campaignResult.error ?? 'Failed to create campaign.',
        steps,
      };
    }
    campaignResourceName = campaignResult.resourceName;
    campaignName = strategyName;
    setStep(steps, 'campaign', 'complete');

    setStep(steps, 'adgroup', 'running');
    await persistSteps(publishedRecord.id, steps, { campaignName, accountName });

    const adGroupName =
      optimizedContent.campaignStrategy?.adGroups?.[0]?.name ?? 'Core Services';
    const adGroupResult = await createAdGroup(
      accessToken,
      customerId,
      campaignResourceName,
      adGroupName,
      loginCustomerId
    );
    if (!adGroupResult.success || !adGroupResult.resourceName) {
      setStep(steps, 'adgroup', 'failed');
      await prisma.publishedAdVersion.update({
        where: { id: publishedRecord.id },
        data: { status: 'FAILED', errorMessage: adGroupResult.error },
      });
      return {
        publishedId: publishedRecord.id,
        status: 'FAILED',
        scenario,
        message: adGroupResult.error ?? 'Failed to create ad group.',
        campaignName,
        steps,
      };
    }
    adGroupResourceName = adGroupResult.resourceName;
    setStep(steps, 'adgroup', 'complete');

    const keywords =
      optimizedContent.campaignStrategy?.adGroups?.[0]?.keywords ??
      optimizedContent.keywordSuggestions ??
      [];
    if (keywords.length) {
      setStep(steps, 'keywords', 'running');
      await persistSteps(publishedRecord.id, steps, { campaignName, accountName });
      const kwResult = await createKeywords(
        accessToken,
        customerId,
        adGroupResourceName,
        keywords,
        loginCustomerId
      );
      setStep(steps, 'keywords', kwResult.success ? 'complete' : 'failed');
      if (!kwResult.success) {
        console.warn('[publish] keyword creation failed:', kwResult.error);
      }
    } else {
      setStep(steps, 'keywords', 'skipped');
    }
  } else if (scenario === 'CREATE_ADS' || scenario === 'REPLACE_EXISTING') {
    setStep(steps, 'campaign', 'skipped');

    if (optimization.campaignId) {
      const found = await findCampaignById(
        accessToken,
        customerId,
        optimization.campaignId,
        loginCustomerId
      );
      if (found) {
        if (/PERFORMANCE_MAX/i.test(found.type)) {
          setStep(steps, 'resolve', 'failed');
          await prisma.publishedAdVersion.update({
            where: { id: publishedRecord.id },
            data: {
              status: 'SIMULATED',
              publishedAt: new Date(),
              errorMessage: 'Performance Max asset publishing is not yet automated.',
            },
          });
          await prisma.aIOptimization.update({
            where: { id: request.optimizationId },
            data: { status: 'APPROVED' },
          });
          setStep(steps, 'save', 'complete');
          return {
            publishedId: publishedRecord.id,
            status: 'SIMULATED',
            scenario,
            campaignName: found.name,
            accountName,
            message:
              'Optimized PMax copy saved. Asset group publishing requires manual setup in Google Ads — use the generated headlines and descriptions there.',
            versionSaved: true,
            steps,
          };
        }
        campaignResourceName = found.resourceName;
        campaignName = found.name;
      }
    }

    if (!adGroupResourceName && campaignResourceName) {
      setStep(steps, 'adgroup', 'running');
      adGroupResourceName = await findAdGroupInCampaign(
        accessToken,
        customerId,
        campaignResourceName,
        loginCustomerId
      );
      if (!adGroupResourceName && scenario === 'CREATE_ADS') {
        const adGroupName =
          optimizedContent.campaignStrategy?.adGroups?.[0]?.name ?? 'AI Optimized Ads';
        const adGroupResult = await createAdGroup(
          accessToken,
          customerId,
          campaignResourceName,
          adGroupName,
          loginCustomerId
        );
        if (!adGroupResult.success || !adGroupResult.resourceName) {
          setStep(steps, 'adgroup', 'failed');
          await prisma.publishedAdVersion.update({
            where: { id: publishedRecord.id },
            data: { status: 'FAILED', errorMessage: adGroupResult.error },
          });
          return {
            publishedId: publishedRecord.id,
            status: 'FAILED',
            scenario,
            message: adGroupResult.error ?? 'Failed to create ad group in campaign.',
            campaignName,
            steps,
          };
        }
        adGroupResourceName = adGroupResult.resourceName;
      }
      setStep(steps, 'adgroup', adGroupResourceName ? 'complete' : 'failed');

      const keywords =
        optimizedContent.campaignStrategy?.adGroups?.[0]?.keywords ??
        optimizedContent.keywordSuggestions ??
        [];
      if (keywords.length && adGroupResourceName && scenario === 'CREATE_ADS') {
        setStep(steps, 'keywords', 'running');
        const kwResult = await createKeywords(
          accessToken,
          customerId,
          adGroupResourceName,
          keywords,
          loginCustomerId
        );
        setStep(steps, 'keywords', kwResult.success ? 'complete' : 'skipped');
      } else {
        setStep(steps, 'keywords', 'skipped');
      }
    } else {
      setStep(steps, 'adgroup', adGroupResourceName ? 'complete' : 'skipped');
      setStep(steps, 'keywords', 'skipped');
    }

    if (!adGroupResourceName) {
      adGroupResourceName = await findTargetAdGroup(
        accessToken,
        customerId,
        adGroupResourceName,
        loginCustomerId
      );
    }
  } else {
    setStep(steps, 'campaign', 'skipped');
    setStep(steps, 'adgroup', adGroupResourceName ? 'complete' : 'skipped');
    setStep(steps, 'keywords', 'skipped');
    adGroupResourceName = await findTargetAdGroup(
      accessToken,
      customerId,
      adGroupResourceName,
      loginCustomerId
    );
  }

  setStep(steps, 'resolve', 'complete');
  await persistSteps(publishedRecord.id, steps, { campaignName, accountName });

  if (!adGroupResourceName) {
    setStep(steps, 'create_ad', 'failed');
    await prisma.publishedAdVersion.update({
      where: { id: publishedRecord.id },
      data: {
        status: 'SIMULATED',
        publishedAt: new Date(),
        errorMessage: 'No enabled ad group found.',
      },
    });
    await prisma.aIOptimization.update({
      where: { id: request.optimizationId },
      data: { status: 'APPROVED' },
    });
    setStep(steps, 'save', 'complete');
    return {
      publishedId: publishedRecord.id,
      status: 'SIMULATED',
      scenario,
      campaignName,
      accountName,
      message:
        scenario === 'CREATE_STRATEGY'
          ? 'Campaign created but ad group setup incomplete. Try publishing again.'
          : 'Optimized copy saved. Create a Search campaign with an ad group, then publish again.',
      versionSaved: true,
      steps,
    };
  }

  setStep(steps, 'create_ad', 'running');
  await persistSteps(publishedRecord.id, steps, { campaignName, accountName });

  let result: { success: boolean; resourceName?: string; error?: string };
  let updatedInPlace = false;
  let replacedViaNewAd = false;

  if (request.updateInPlace && previousAdResourceName) {
    setStep(steps, 'pause', 'skipped');
    result = await updateResponsiveSearchAdInPlace(
      accessToken,
      customerId,
      previousAdResourceName,
      request.content,
      landingUrl,
      loginCustomerId
    );
    if (result.success) {
      updatedInPlace = true;
    } else {
      console.warn(
        '[publish] in-place RSA update failed, falling back to replace:',
        result.error
      );
      // Google sometimes blocks RSA in-place edits — create enabled replacement + pause old.
      const paused = await pauseExistingAd(
        accessToken,
        customerId,
        previousAdResourceName,
        loginCustomerId
      );
      setStep(steps, 'pause', paused ? 'complete' : 'failed');
      result = await createResponsiveSearchAd(
        accessToken,
        customerId,
        adGroupResourceName,
        request.content,
        landingUrl,
        loginCustomerId,
        { status: 'ENABLED' }
      );
      replacedViaNewAd = result.success;
    }
  } else {
    if (scenario === 'REPLACE_EXISTING' && previousAdResourceName && request.pauseExistingAd) {
      setStep(steps, 'pause', 'running');
      await persistSteps(publishedRecord.id, steps, { campaignName, accountName });
      const paused = await pauseExistingAd(
        accessToken,
        customerId,
        previousAdResourceName,
        loginCustomerId
      );
      setStep(steps, 'pause', paused ? 'complete' : 'failed');
      if (!paused) {
        console.warn('[publish] could not pause previous ad:', previousAdResourceName);
      }
    } else if (scenario === 'REPLACE_EXISTING' && previousAdResourceName && !request.pauseExistingAd) {
      setStep(steps, 'pause', 'skipped');
      console.log('[publish] keeping existing ad active (pauseExistingAd=false)');
    }

    result = await createResponsiveSearchAd(
      accessToken,
      customerId,
      adGroupResourceName,
      request.content,
      landingUrl,
      loginCustomerId
    );
  }

  if (!result.success) {
    setStep(steps, 'create_ad', 'failed');
    await prisma.publishedAdVersion.update({
      where: { id: publishedRecord.id },
      data: { status: 'FAILED', errorMessage: result.error },
    });
    return {
      publishedId: publishedRecord.id,
      status: 'FAILED',
      scenario,
      campaignName,
      accountName,
      message: result.error ?? 'Publish failed',
      steps,
    };
  }

  setStep(steps, 'create_ad', 'complete');
  setStep(steps, 'save', 'running');
  await persistSteps(publishedRecord.id, steps, { campaignName, accountName });

  const publishedAt = new Date();
  const publishedResourceName = result.resourceName ?? previousAdResourceName;
  const updated = await prisma.publishedAdVersion.update({
    where: { id: publishedRecord.id },
    data: {
      status: 'PUBLISHED',
      adGroupAdResourceName: publishedResourceName,
      newAdResourceName: publishedResourceName,
      previousAdResourceName:
        updatedInPlace
          ? previousAdResourceName
          : scenario === 'REPLACE_EXISTING' || replacedViaNewAd
            ? previousAdResourceName
            : undefined,
      campaignId: optimization.campaignId,
      rollbackAvailable:
        !updatedInPlace &&
        (scenario === 'REPLACE_EXISTING' || replacedViaNewAd) &&
        !!previousAdResourceName,
      publishedAt,
      performanceMetrics: {
        steps: steps.map((s) => (s.id === 'save' ? { ...s, status: 'complete' as const } : s)),
        campaignName,
        accountName,
        scenario,
        updatedInPlace,
        publishedAt: publishedAt.toISOString(),
      } as object,
    },
  });

  await prisma.aIOptimization.update({
    where: { id: request.optimizationId },
    data: {
      status: 'APPROVED',
      campaignResourceName: campaignResourceName ?? optimization.campaignResourceName,
      adGroupResourceName,
    },
  });

  setStep(steps, 'save', 'complete');

  const action = updatedInPlace
    ? 'Existing ad updated with your new copy (same Google Ads ad — not a duplicate).'
    : replacedViaNewAd
      ? 'Previous ad paused and replaced with your updated copy.'
      : scenario === 'REPLACE_EXISTING'
        ? 'Previous ad paused. New optimized ad created (paused — enable in Google Ads).'
        : scenario === 'CREATE_STRATEGY'
          ? 'New campaign, ad group, and Responsive Search Ad created (paused — review and enable in Google Ads).'
          : 'New Responsive Search Ad created (paused — review and enable in Google Ads).';

  return {
    publishedId: updated.id,
    status: 'PUBLISHED',
    scenario,
    campaignName,
    accountName,
    publishedAt: publishedAt.toISOString(),
    versionSaved: true,
    message: action,
    resourceName: publishedResourceName,
    rollbackAvailable: updated.rollbackAvailable,
    steps,
  };
}

export async function rollbackAdVersion(
  userId: string,
  publishedId: string
): Promise<RollbackAdResult> {
  return rollbackPublishedAd(userId, publishedId);
}

export async function rollbackPublishedAd(
  userId: string,
  publishedId: string
): Promise<RollbackAdResult> {
  const version = await prisma.publishedAdVersion.findFirst({
    where: { id: publishedId, userId },
  });
  if (!version) return { success: false, message: 'Published version not found.' };
  if (!version.rollbackAvailable) {
    return { success: false, message: 'Rollback not available for this publish.' };
  }
  if (version.rolledBackAt) {
    return { success: false, message: 'Already rolled back.' };
  }

  const accessToken = await getGoogleAccessTokenForUser(userId);
  if (!accessToken) {
    return { success: false, message: 'Your Google session expired. Reconnect your Google account.' };
  }

  const loginCustomerId = await resolvePublishLoginCustomerId(userId, version.googleAdsCustomerId);

  if (version.newAdResourceName) {
    await pauseExistingAd(
      accessToken,
      version.googleAdsCustomerId,
      version.newAdResourceName,
      loginCustomerId
    );
  }

  if (version.previousAdResourceName) {
    await googleAdsMutate(
      accessToken,
      version.googleAdsCustomerId,
      'adGroupAds',
      [
        {
          update: { resourceName: version.previousAdResourceName, status: 'ENABLED' },
          updateMask: 'status',
        },
      ],
      loginCustomerId
    );
  }

  await prisma.publishedAdVersion.update({
    where: { id: publishedId },
    data: { rolledBackAt: new Date(), rollbackAvailable: false },
  });

  return {
    success: true,
    message: 'Rollback complete — previous ad re-enabled, optimized ad paused.',
  };
}

export interface CreateSearchCampaignRequest {
  userId: string;
  googleAdsCustomerId: string;
  campaignName: string;
  dailyBudget: number;
  biddingStrategy: 'MANUAL_CPC' | 'MAXIMIZE_CLICKS' | 'MAXIMIZE_CONVERSIONS';
  /** Account campaign bucket: search | display | video | … */
  campaignType?: string;
  targetGoogleSearch: boolean;
  targetSearchNetwork: boolean;
  targetContentNetwork: boolean;
  containsEuPoliticalAdvertising: boolean;
  targetLocations?: string;
  cpcBidCeiling?: number;
}

export interface CreateSearchCampaignResult {
  success: boolean;
  status: 'CREATED' | 'FAILED';
  message: string;
  campaignResourceName?: string;
  campaignName?: string;
  advertisingChannelType?: string;
  campaignType?: string;
  supportsAutomatedAds?: boolean;
}

export async function createSearchCampaignForAccount(
  request: CreateSearchCampaignRequest
): Promise<CreateSearchCampaignResult> {
  const permissions = await validatePublishingPermissions(
    request.userId,
    request.googleAdsCustomerId
  );
  if (!permissions.canPublish) {
    return {
      success: false,
      status: 'FAILED',
      message: permissions.reason ?? 'Cannot create campaign.',
    };
  }

  const campaignName = request.campaignName.trim();
  if (!campaignName) {
    return { success: false, status: 'FAILED', message: 'Campaign name is required.' };
  }
  if (!(request.dailyBudget > 0)) {
    return { success: false, status: 'FAILED', message: 'Daily budget must be greater than 0.' };
  }

  const campaignType: AccountCampaignTypeKey =
    normalizeAccountCampaignType(request.campaignType) ?? 'search';
  const advertisingChannelType = toGoogleAdsAdvertisingChannelType(campaignType);
  const isSearchLike = supportsAutomatedRsaCreate(campaignType);

  if (isSearchLike && !request.targetGoogleSearch) {
    return {
      success: false,
      status: 'FAILED',
      message: 'Google Search network must be enabled for Search / Call Ads campaigns.',
    };
  }

  if (campaignType === 'shopping') {
    return {
      success: false,
      status: 'FAILED',
      message:
        'Shopping campaigns need a linked Merchant Center. Create Shopping in Google Ads, or pick Search / Performance Max here.',
      campaignType,
      advertisingChannelType,
      supportsAutomatedAds: false,
    };
  }

  if (campaignType === 'local_services') {
    return {
      success: false,
      status: 'FAILED',
      message:
        'Local Services Ads are managed through Google Local Services, not standard campaign create. Pick Search for automated RSA create.',
      campaignType,
      advertisingChannelType,
      supportsAutomatedAds: false,
    };
  }

  if (campaignType === 'app') {
    return {
      success: false,
      status: 'FAILED',
      message:
        'App campaigns require app store assets in Google Ads. Pick Search or Performance Max for automated create in AdAudit Pro.',
      campaignType,
      advertisingChannelType,
      supportsAutomatedAds: false,
    };
  }

  const accessToken = await getGoogleAccessTokenForUser(request.userId);
  if (!accessToken) {
    return {
      success: false,
      status: 'FAILED',
      message: 'Could not refresh Google access token. Reconnect your Google account.',
    };
  }

  const loginIds = await collectPublishLoginCustomerIds(
    request.userId,
    request.googleAdsCustomerId
  );
  const customerId = request.googleAdsCustomerId;
  console.log(
    `[create-campaign] customer=${bareCustomerId(customerId)} login-customer-id candidates=${loginIds
      .map((id) => id ?? '(none)')
      .join(', ')}`
  );

  const budgetResult = await createCampaignBudget(
    accessToken,
    customerId,
    request.dailyBudget,
    `Budget — ${campaignName}`,
    loginIds[0],
    loginIds
  );
  if (!budgetResult.success || !budgetResult.resourceName) {
    return {
      success: false,
      status: 'FAILED',
      message: budgetResult.error ?? 'Failed to create campaign budget.',
    };
  }
  const loginCustomerId = budgetResult.loginCustomerId ?? loginIds[0];

  const biddingStrategy =
    campaignType === 'performance_max' || campaignType === 'demand_gen'
      ? 'MAXIMIZE_CONVERSIONS'
      : request.biddingStrategy === 'MAXIMIZE_CLICKS'
        ? 'MAXIMIZE_CLICKS'
        : request.biddingStrategy === 'MAXIMIZE_CONVERSIONS'
          ? 'MAXIMIZE_CONVERSIONS'
          : 'MANUAL_CPC';

  const campaignResult = await createCampaign(
    accessToken,
    customerId,
    campaignName,
    budgetResult.resourceName,
    loginCustomerId,
    {
      biddingStrategy,
      advertisingChannelType,
      network: {
        targetGoogleSearch: isSearchLike ? true : false,
        targetSearchNetwork: isSearchLike ? request.targetSearchNetwork : false,
        targetContentNetwork: isSearchLike ? request.targetContentNetwork : false,
        targetPartnerSearchNetwork: false,
      },
      containsEuPoliticalAdvertising: request.containsEuPoliticalAdvertising,
      cpcBidCeiling: request.cpcBidCeiling,
    }
  );
  if (!campaignResult.success || !campaignResult.resourceName) {
    return {
      success: false,
      status: 'FAILED',
      message:
        campaignResult.error ??
        `Failed to create ${defaultAdFormatLabel(campaignType)} campaign in Google Ads.`,
      campaignType,
      advertisingChannelType,
      supportsAutomatedAds: isSearchLike,
    };
  }

  const locationNote = request.targetLocations?.trim()
    ? ` Set location targeting (“${request.targetLocations.trim()}”) before enabling.`
    : '';

  const typeNote = isSearchLike
    ? ` Next: generate ${defaultAdFormatLabel(campaignType)} copy for your service and add a paused ad.`
    : ` Campaign shell created as ${advertisingChannelType}. Next: generate ${defaultAdFormatLabel(campaignType)} assets from your service brief — full asset upload for this channel may need Google Ads UI.`;

  return {
    success: true,
    status: 'CREATED',
    message: `Paused ${campaignTypeLabel(campaignType)} campaign created.${typeNote}${locationNote}`,
    campaignResourceName: campaignResult.resourceName,
    campaignName,
    advertisingChannelType,
    campaignType,
    supportsAutomatedAds: isSearchLike,
  };
}

export interface UpdateCampaignBiddingRequest {
  userId: string;
  googleAdsCustomerId: string;
  campaignResourceName: string;
  biddingStrategy: 'MANUAL_CPC' | 'MAXIMIZE_CONVERSIONS';
}

export async function updateCampaignBiddingForAccount(
  request: UpdateCampaignBiddingRequest
): Promise<{ success: boolean; status: 'UPDATED' | 'FAILED'; message: string; error?: string }> {
  const permissions = await validatePublishingPermissions(
    request.userId,
    request.googleAdsCustomerId
  );
  if (!permissions.canPublish) {
    return { success: false, status: 'FAILED', message: permissions.reason ?? 'Cannot update campaign.' };
  }
  if (!request.campaignResourceName?.includes('/campaigns/')) {
    return { success: false, status: 'FAILED', message: 'Valid campaignResourceName is required.' };
  }

  const accessToken = await getGoogleAccessTokenForUser(request.userId);
  if (!accessToken) {
    return { success: false, status: 'FAILED', message: 'Could not refresh Google Ads access.' };
  }

  const loginIds = await collectPublishLoginCustomerIds(request.userId, request.googleAdsCustomerId);
  const toManual = request.biddingStrategy === 'MANUAL_CPC';
  const update = toManual
    ? {
        resourceName: request.campaignResourceName,
        manualCpc: { enhancedCpcEnabled: false },
      }
    : {
        resourceName: request.campaignResourceName,
        maximizeConversions: {},
      };
  const updateMask = toManual ? 'manualCpc' : 'maximizeConversions';

  const result = await googleAdsMutateWithLoginFallback(
    accessToken,
    request.googleAdsCustomerId,
    'campaigns',
    [{ update, updateMask }],
    loginIds
  );

  if (!result.success) {
    return {
      success: false,
      status: 'FAILED',
      message: result.error ?? 'Google Ads rejected the bidding strategy change.',
      error: result.error,
    };
  }

  return {
    success: true,
    status: 'UPDATED',
    message: toManual
      ? 'Campaign bidding is now Manual CPC. Keyword max CPC bids will be used.'
      : 'Campaign bidding is now Maximize Conversions. Google will set click prices inside the daily budget.',
  };
}

export interface UpdateCampaignBudgetRequest {
  userId: string;
  googleAdsCustomerId: string;
  campaignResourceName: string;
  dailyBudget: number;
}

export async function updateCampaignBudgetForAccount(
  request: UpdateCampaignBudgetRequest
): Promise<{ success: boolean; status: 'UPDATED' | 'FAILED'; message: string; error?: string }> {
  const permissions = await validatePublishingPermissions(
    request.userId,
    request.googleAdsCustomerId
  );
  if (!permissions.canPublish) {
    return { success: false, status: 'FAILED', message: permissions.reason ?? 'Cannot update campaign.' };
  }
  if (!request.campaignResourceName?.includes('/campaigns/')) {
    return { success: false, status: 'FAILED', message: 'Valid campaignResourceName is required.' };
  }
  if (!(request.dailyBudget > 0)) {
    return { success: false, status: 'FAILED', message: 'Daily budget must be greater than 0.' };
  }

  const accessToken = await getGoogleAccessTokenForUser(request.userId);
  if (!accessToken) {
    return { success: false, status: 'FAILED', message: 'Could not refresh Google Ads access.' };
  }

  const loginIds = await collectPublishLoginCustomerIds(request.userId, request.googleAdsCustomerId);
  const campaignId = request.campaignResourceName.split('/campaigns/')[1];
  let budgetResourceName: string | undefined;
  let shared = false;
  let currentMicros = 0;

  for (const loginId of loginIds) {
    const rows = await searchGoogleAds<{
      campaignBudget?: {
        resourceName?: string;
        amountMicros?: string;
        explicitlyShared?: boolean;
      };
    }>(
      accessToken,
      request.googleAdsCustomerId,
      `SELECT campaign_budget.resource_name, campaign_budget.amount_micros,
              campaign_budget.explicitly_shared
       FROM campaign
       WHERE campaign.id = ${campaignId.replace(/\D/g, '')}
       LIMIT 1`,
      loginId
    );
    const budget = rows[0]?.campaignBudget;
    if (budget?.resourceName) {
      budgetResourceName = budget.resourceName;
      shared = budget.explicitlyShared === true;
      currentMicros = Number(budget.amountMicros ?? 0);
      break;
    }
  }

  if (!budgetResourceName) {
    return {
      success: false,
      status: 'FAILED',
      message: 'Could not find this campaign’s Google Ads budget. Refresh campaigns and try again.',
    };
  }

  const amountMicros = String(Math.round(request.dailyBudget * 1_000_000));
  if (String(currentMicros) === amountMicros) {
    return { success: true, status: 'UPDATED', message: 'Daily budget is already set to that amount.' };
  }

  const result = await googleAdsMutateWithLoginFallback(
    accessToken,
    request.googleAdsCustomerId,
    'campaignBudgets',
    [
      {
        update: { resourceName: budgetResourceName, amountMicros },
        updateMask: 'amountMicros',
      },
    ],
    loginIds
  );

  if (!result.success) {
    return {
      success: false,
      status: 'FAILED',
      message: result.error ?? 'Google Ads rejected the daily budget change.',
      error: result.error,
    };
  }

  const sharedNote = shared
    ? ' This budget is shared with other campaigns, so their daily cap changes too.'
    : '';
  return {
    success: true,
    status: 'UPDATED',
    message: `Daily budget updated to ${request.dailyBudget}.${sharedNote}`,
  };
}

export interface CreateAdInCampaignRequest {
  userId: string;
  googleAdsCustomerId: string;
  campaignResourceName: string;
  adGroupName: string;
  keywords: string[];
  keywordMatchType: 'BROAD' | 'PHRASE' | 'EXACT';
  keywordBids?: Array<{ keyword: string; matchType?: 'BROAD' | 'PHRASE' | 'EXACT'; cpc?: number }>;
  defaultCpc?: number;
  headlines: string[];
  descriptions: string[];
  finalUrl: string;
  path1?: string;
  path2?: string;
  negativeKeywords?: string[];
  /** When true (Maximize Conversions), keywords are added without per-keyword CPC — Google auto-bids. */
  automatedBidding?: boolean;
}

export interface CreateAdInCampaignResult {
  success: boolean;
  status: 'CREATED' | 'FAILED';
  message: string;
  campaignResourceName?: string;
  adGroupResourceName?: string;
  adResourceName?: string;
  keywordsAdded?: number;
}

export async function createAdInCampaignForAccount(
  request: CreateAdInCampaignRequest
): Promise<CreateAdInCampaignResult> {
  const permissions = await validatePublishingPermissions(
    request.userId,
    request.googleAdsCustomerId
  );
  if (!permissions.canPublish) {
    return {
      success: false,
      status: 'FAILED',
      message: permissions.reason ?? 'Cannot create ad.',
    };
  }

  if (!request.campaignResourceName?.includes('/campaigns/')) {
    return { success: false, status: 'FAILED', message: 'Valid campaignResourceName is required.' };
  }

  const contentCheck = validatePublishContent({
    headlines: request.headlines,
    descriptions: request.descriptions,
    displayPaths: { path1: request.path1, path2: request.path2 },
    finalUrl: request.finalUrl,
  });
  if (contentCheck) {
    return { success: false, status: 'FAILED', message: contentCheck };
  }
  if (!request.finalUrl?.trim()) {
    return { success: false, status: 'FAILED', message: 'Final URL is required.' };
  }

  const accessToken = await getGoogleAccessTokenForUser(request.userId);
  if (!accessToken) {
    return {
      success: false,
      status: 'FAILED',
      message: 'Could not refresh Google access token. Reconnect your Google account.',
    };
  }

  const loginCustomerId = await resolvePublishLoginCustomerId(
    request.userId,
    request.googleAdsCustomerId
  );
  const customerId = request.googleAdsCustomerId;

  let adGroupResourceName = await findAdGroupInCampaign(
    accessToken,
    customerId,
    request.campaignResourceName,
    loginCustomerId
  );

  if (!adGroupResourceName) {
    const adGroupResult = await createAdGroup(
      accessToken,
      customerId,
      request.campaignResourceName,
      request.adGroupName.trim() || 'Ad group 1',
      loginCustomerId,
      request.automatedBidding ? undefined : request.defaultCpc,
      request.automatedBidding
    );
    if (!adGroupResult.success || !adGroupResult.resourceName) {
      return {
        success: false,
        status: 'FAILED',
        message: adGroupResult.error ?? 'Failed to create ad group in campaign.',
        campaignResourceName: request.campaignResourceName,
      };
    }
    adGroupResourceName = adGroupResult.resourceName;
  }

  const keywords = request.keywords.map((k) => k.trim()).filter(Boolean);
  let keywordsAdded = 0;
  if (keywords.length) {
    const kwResult = await createKeywords(
      accessToken,
      customerId,
      adGroupResourceName,
      keywords,
      loginCustomerId,
      request.keywordMatchType,
      request.automatedBidding ? undefined : request.keywordBids
    );
    keywordsAdded = kwResult.added;
    if (!kwResult.success) {
      console.warn('[create-ad-in-campaign] keyword creation failed:', kwResult.error);
    }
  }

  if (request.negativeKeywords?.length) {
    await createNegativeKeywords(
      accessToken,
      customerId,
      adGroupResourceName,
      request.negativeKeywords,
      loginCustomerId
    );
  }

  const adResult = await createResponsiveSearchAd(
    accessToken,
    customerId,
    adGroupResourceName,
    {
      headlines: request.headlines,
      descriptions: request.descriptions,
      displayPaths: { path1: request.path1, path2: request.path2 },
      finalUrl: request.finalUrl,
    },
    request.finalUrl,
    loginCustomerId
  );
  if (!adResult.success) {
    return {
      success: false,
      status: 'FAILED',
      message: adResult.error ?? 'Failed to create Responsive Search Ad.',
      campaignResourceName: request.campaignResourceName,
      adGroupResourceName,
      keywordsAdded,
    };
  }

  return {
    success: true,
    status: 'CREATED',
    message: `Paused Responsive Search Ad created in the campaign (ad group ready, ${keywordsAdded} keyword(s) added). Enable in Google Ads when ready.`,
    campaignResourceName: request.campaignResourceName,
    adGroupResourceName,
    adResourceName: adResult.resourceName,
    keywordsAdded,
  };
}

export function validatePublishContent(content: PublishAdRequest['content']): string | null {
  if (!content.headlines?.length || content.headlines.length < 3) {
    return 'At least 3 headlines are required.';
  }
  if (!content.descriptions?.length || content.descriptions.length < 2) {
    return 'At least 2 descriptions are required.';
  }
  for (const h of content.headlines) {
    if (h.length > 30) return `Headline exceeds 30 characters: "${h.slice(0, 20)}..."`;
  }
  for (const d of content.descriptions) {
    if (d.length > 90) return `Description exceeds 90 characters: "${d.slice(0, 30)}..."`;
  }
  return null;
}

export type AdCopySnapshot = {
  headlines: string[];
  descriptions: string[];
  longHeadlines?: string[];
  displayPaths?: { path1?: string; path2?: string };
  finalUrl?: string;
  finalUrls?: string[];
  status?: string;
  campaignName?: string;
  adGroupName?: string;
};

export type LiveAdMetrics = {
  impressions: number;
  clicks: number;
  conversions: number;
  ctr: number;
  cost: number;
  avgCpc: number;
  status?: string;
  adStrength?: string;
};

export type PublishedAdHistoryItem = {
  id: string;
  status: string;
  publishedAt: string | null;
  createdAt: string;
  googleAdsCustomerId: string;
  campaignId: string | null;
  campaignName?: string;
  accountName?: string;
  scenario?: string | null;
  rollbackAvailable: boolean;
  rolledBackAt?: string | null;
  errorMessage?: string | null;
  newAdResourceName?: string | null;
  previousAdResourceName?: string | null;
  originalAd: AdCopySnapshot;
  publishedAd: AdCopySnapshot;
  /** Live stats for the previous / original ad resource (when still present). */
  previousLiveMetrics: LiveAdMetrics | null;
  /** Live stats for the posted / current ad resource. */
  liveMetrics: LiveAdMetrics | null;
  source: 'make_it_better' | 'manual_edit';
};

function asCopySnapshot(raw: unknown): AdCopySnapshot {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const headlines = Array.isArray(obj.headlines)
    ? obj.headlines.filter((h): h is string => typeof h === 'string')
    : [];
  const descriptions = Array.isArray(obj.descriptions)
    ? obj.descriptions.filter((d): d is string => typeof d === 'string')
    : [];
  const longHeadlines = Array.isArray(obj.longHeadlines)
    ? obj.longHeadlines.filter((h): h is string => typeof h === 'string')
    : undefined;
  const displayPaths =
    obj.displayPaths && typeof obj.displayPaths === 'object'
      ? (obj.displayPaths as { path1?: string; path2?: string })
      : {
          path1: typeof obj.displayPath1 === 'string' ? obj.displayPath1 : undefined,
          path2: typeof obj.displayPath2 === 'string' ? obj.displayPath2 : undefined,
        };
  const finalUrls = Array.isArray(obj.finalUrls)
    ? obj.finalUrls.filter((u): u is string => typeof u === 'string')
    : undefined;
  const finalUrl =
    typeof obj.finalUrl === 'string'
      ? obj.finalUrl
      : finalUrls?.[0];
  return {
    headlines,
    descriptions,
    longHeadlines,
    displayPaths,
    finalUrl,
    finalUrls,
    status: typeof obj.status === 'string' ? obj.status : undefined,
    campaignName: typeof obj.campaignName === 'string' ? obj.campaignName : undefined,
    adGroupName: typeof obj.adGroupName === 'string' ? obj.adGroupName : undefined,
  };
}

function metricsFromAd(ad: CampaignAdDto | undefined): LiveAdMetrics | null {
  if (!ad) return null;
  return {
    impressions: ad.impressions ?? 0,
    clicks: ad.clicks ?? 0,
    conversions: ad.conversions ?? 0,
    ctr: ad.ctr ?? 0,
    cost: ad.cost ?? 0,
    avgCpc: ad.avgCpc ?? 0,
    status: ad.status,
    adStrength: ad.adStrength,
  };
}

export async function listPublishedAdHistory(opts: {
  userId: string;
  googleAdsCustomerId?: string;
  campaignId?: string;
  windowDays?: number;
  limit?: number;
}): Promise<{ versions: PublishedAdHistoryItem[]; currency: string }> {
  const customerId = opts.googleAdsCustomerId?.replace(/\D/g, '');
  const windowDays = Math.min(365, Math.max(30, opts.windowDays ?? 30));
  const limit = Math.min(100, Math.max(1, opts.limit ?? 40));

  const rows = await prisma.publishedAdVersion.findMany({
    where: {
      userId: opts.userId,
      status: { in: ['PUBLISHED', 'SIMULATED'] },
      ...(customerId
        ? {
            OR: [
              { googleAdsCustomerId: customerId },
              { googleAdsCustomerId: opts.googleAdsCustomerId! },
            ],
          }
        : {}),
      ...(opts.campaignId
        ? {
            OR: [
              { campaignId: opts.campaignId },
              { campaignId: opts.campaignId.replace(/\D/g, '') },
            ],
          }
        : {}),
    },
    orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
    take: limit,
    include: {
      aiOptimization: {
        select: {
          scenario: true,
          findingId: true,
          originalAd: true,
        },
      },
    },
  });

  const metricsByResource = new Map<string, CampaignAdDto>();
  let currency = 'AUD';

  if (customerId) {
    try {
      const user = await getMe(opts.userId);
      const { accounts, source } = await getGoogleAdsAccountsForUser(
        user?.googleRefreshToken,
        opts.userId
      );
      const account = accounts.find(
        (a) => a.customerId.replace(/\D/g, '') === customerId
      );
      if (account) currency = account.currency || currency;

      let campaigns =
        source === 'mock' || env.useMockData
          ? getMockCampaigns(customerId)
          : [];

      if ((!campaigns.length || source !== 'mock') && user?.googleRefreshToken && account) {
        const loginCustomerId = resolveAccountLoginCustomerId(account, accounts);
        campaigns = await fetchCampaignsForAccount(
          user.googleRefreshToken,
          customerId,
          opts.userId,
          {
            loginCustomerId,
            managerIds: listManagerCustomerIds(accounts),
            dateWindowDays: windowDays,
          }
        );
      }

      for (const campaign of campaigns) {
        for (const ad of campaign.ads ?? []) {
          if (ad.resourceName) metricsByResource.set(ad.resourceName, ad);
          if (ad.id) metricsByResource.set(ad.id, ad);
        }
      }
    } catch (err) {
      console.warn(
        '[published-history] live metrics join skipped:',
        err instanceof Error ? err.message : err
      );
    }
  }

  const versions: PublishedAdHistoryItem[] = rows.map((row) => {
    const meta = (row.performanceMetrics && typeof row.performanceMetrics === 'object'
      ? row.performanceMetrics
      : {}) as { accountName?: string; campaignName?: string; scenario?: string };
    const originalAd = asCopySnapshot(row.originalAdSnapshot ?? row.aiOptimization.originalAd);
    const publishedAd = asCopySnapshot(row.publishedContent ?? row.optimizedAdSnapshot);
    const resourceKey = row.newAdResourceName ?? row.adGroupAdResourceName ?? undefined;
    const liveAd =
      (resourceKey ? metricsByResource.get(resourceKey) : undefined) ??
      (row.newAdResourceName
        ? metricsByResource.get(row.newAdResourceName.split('/').pop() ?? '')
        : undefined);
    const previousKey = row.previousAdResourceName ?? undefined;
    const previousAd =
      (previousKey ? metricsByResource.get(previousKey) : undefined) ??
      (previousKey
        ? metricsByResource.get(previousKey.split('/').pop() ?? '')
        : undefined);

    return {
      id: row.id,
      status: row.status,
      publishedAt: row.publishedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      googleAdsCustomerId: row.googleAdsCustomerId,
      campaignId: row.campaignId,
      campaignName: meta.campaignName ?? publishedAd.campaignName ?? originalAd.campaignName,
      accountName: meta.accountName,
      scenario: row.aiOptimization.scenario ?? meta.scenario ?? null,
      rollbackAvailable: row.rollbackAvailable,
      rolledBackAt: row.rolledBackAt?.toISOString() ?? null,
      errorMessage: row.errorMessage,
      newAdResourceName: row.newAdResourceName,
      previousAdResourceName: row.previousAdResourceName,
      originalAd,
      publishedAd,
      previousLiveMetrics: metricsFromAd(previousAd),
      liveMetrics: metricsFromAd(liveAd),
      source:
        row.aiOptimization.findingId?.startsWith('manual-edit') ||
        row.aiOptimization.findingId === 'manual-edit'
          ? 'manual_edit'
          : 'make_it_better',
    };
  });

  return { versions, currency };
}

/** Snapshot-only published ads for an audit report (no live Google Ads fetch). */
export async function listPublishedAdsForAuditReport(
  auditRunId: string,
  opts?: { userId?: string; googleAdsCustomerId?: string | null }
): Promise<PublishedAdHistoryItem[]> {
  const customerId = opts?.googleAdsCustomerId?.replace(/\D/g, '');
  const rows = await prisma.publishedAdVersion.findMany({
    where: {
      status: { in: ['PUBLISHED', 'SIMULATED'] },
      OR: [
        { aiOptimization: { auditRunId } },
        ...(opts?.userId && customerId
          ? [
              {
                userId: opts.userId,
                OR: [
                  { googleAdsCustomerId: customerId },
                  { googleAdsCustomerId: opts.googleAdsCustomerId ?? customerId },
                ],
              },
            ]
          : []),
      ],
    },
    orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
    take: 80,
    include: {
      aiOptimization: {
        select: {
          scenario: true,
          findingId: true,
          originalAd: true,
        },
      },
    },
  });

  return rows.map((row) => {
    const meta =
      row.performanceMetrics && typeof row.performanceMetrics === 'object'
        ? (row.performanceMetrics as { accountName?: string; campaignName?: string; scenario?: string })
        : {};
    const originalAd = asCopySnapshot(row.originalAdSnapshot ?? row.aiOptimization.originalAd);
    const publishedAd = asCopySnapshot(row.publishedContent ?? row.optimizedAdSnapshot);
    return {
      id: row.id,
      status: row.status,
      publishedAt: row.publishedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      googleAdsCustomerId: row.googleAdsCustomerId,
      campaignId: row.campaignId,
      campaignName: meta.campaignName ?? publishedAd.campaignName ?? originalAd.campaignName,
      accountName: meta.accountName,
      scenario: row.aiOptimization.scenario ?? meta.scenario ?? null,
      rollbackAvailable: row.rollbackAvailable,
      rolledBackAt: row.rolledBackAt?.toISOString() ?? null,
      errorMessage: row.errorMessage,
      newAdResourceName: row.newAdResourceName,
      previousAdResourceName: row.previousAdResourceName,
      originalAd,
      publishedAd,
      previousLiveMetrics: null,
      liveMetrics: null,
      source:
        row.aiOptimization.findingId?.startsWith('manual-edit') ||
        row.aiOptimization.findingId === 'manual-edit'
          ? 'manual_edit'
          : 'make_it_better',
    };
  });
}

export type ManualAdEditRequest = {
  userId: string;
  auditRunId: string;
  googleAdsCustomerId: string;
  campaignId: string;
  campaignName?: string;
  campaignResourceName: string;
  adGroupId?: string;
  adGroupName?: string;
  adGroupAdResourceName?: string;
  /** @deprecated Edit Ads always updates/replaces in place; ignored. */
  pauseExistingAd?: boolean;
  originalAd: AdCopySnapshot;
  content: {
    headlines: string[];
    descriptions: string[];
    displayPaths?: { path1?: string; path2?: string };
    finalUrl: string;
  };
};

export async function publishManualAdEdit(
  request: ManualAdEditRequest
): Promise<PublishAdResult> {
  const contentCheck = validatePublishContent(request.content);
  if (contentCheck) {
    return {
      publishedId: '',
      status: 'FAILED',
      message: contentCheck,
    };
  }

  if (!request.adGroupAdResourceName) {
    return {
      publishedId: '',
      status: 'FAILED',
      message: 'Select an existing ad to edit. Edit Ads updates the current ad rather than creating a new one.',
    };
  }

  const audit = await prisma.auditRun.findFirst({
    where: { id: request.auditRunId, userId: request.userId },
    select: { id: true },
  });
  if (!audit) {
    return { publishedId: '', status: 'FAILED', message: 'Audit not found for this user.' };
  }

  const optimization = await prisma.aIOptimization.create({
    data: {
      userId: request.userId,
      auditRunId: request.auditRunId,
      findingId: `manual-edit-${request.campaignId}-${Date.now()}`,
      campaignId: request.campaignId,
      adGroupId: request.adGroupId,
      campaignResourceName: request.campaignResourceName,
      scenario: 'REPLACE_EXISTING',
      originalAd: {
        ...request.originalAd,
        campaignName: request.campaignName,
        adGroupName: request.adGroupName,
        adGroupAdResourceName: request.adGroupAdResourceName,
        finalUrls: request.originalAd.finalUrls ??
          (request.originalAd.finalUrl ? [request.originalAd.finalUrl] : []),
      } as object,
      optimizedContent: {
        headlines: request.content.headlines,
        descriptions: request.content.descriptions,
        displayPaths: request.content.displayPaths,
        finalUrl: request.content.finalUrl,
        improvementReasoning: 'Manual edit from dashboard (Google Ads–style editor).',
      } as object,
      improvementReasoning: 'Manual edit from dashboard.',
      status: 'DRAFT',
    },
  });

  return publishOptimizedAd({
    userId: request.userId,
    optimizationId: optimization.id,
    googleAdsCustomerId: request.googleAdsCustomerId,
    adGroupAdResourceName: request.adGroupAdResourceName,
    updateInPlace: true,
    pauseExistingAd: true,
    content: {
      headlines: request.content.headlines,
      descriptions: request.content.descriptions,
      displayPaths: request.content.displayPaths,
      finalUrl: request.content.finalUrl,
    },
  });
}
