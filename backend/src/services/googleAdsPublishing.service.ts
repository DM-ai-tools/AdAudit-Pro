import { env } from '../config/env.js';
import {
  GOOGLE_ADS_API_VERSIONS,
  isRetryableGoogleAdsVersionError,
} from '../config/google-ads-api.js';
import { prisma } from '../lib/prisma.js';
import { getMe } from './user.service.js';
import { isGoogleAdsConfigured } from './google-ads.service.js';
import { getGoogleAccessTokenForUser } from './google-oauth.service.js';

export interface PublishAdRequest {
  userId: string;
  optimizationId: string;
  googleAdsCustomerId: string;
  adGroupAdResourceName?: string;
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

function parseGoogleAdsError(body: string, status: number): string {
  try {
    const json = JSON.parse(body) as { error?: { message?: string; status?: string } };
    const msg = json.error?.message;
    if (msg) {
      if (msg.includes('invalid_grant') || msg.includes('Token has been expired or revoked')) {
        return 'Your Google session expired. Sign out and reconnect your Google account.';
      }
      if (msg.includes('USER_PERMISSION_DENIED') || msg.includes('PERMISSION_DENIED')) {
        return 'Your Google account does not have permission to modify this Google Ads account.';
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

async function searchGoogleAds<T>(
  accessToken: string,
  customerId: string,
  query: string
): Promise<T[]> {
  for (const version of GOOGLE_ADS_API_VERSIONS_LIST) {
    const res = await fetch(
      `https://googleads.googleapis.com/${version}/customers/${bareCustomerId(customerId)}/googleAds:search`,
      {
        method: 'POST',
        headers: googleAdsHeaders(accessToken),
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

async function googleAdsMutate(
  accessToken: string,
  customerId: string,
  resource: string,
  operations: unknown[]
): Promise<{ success: boolean; resourceNames?: string[]; error?: string }> {
  for (const version of GOOGLE_ADS_API_VERSIONS_LIST) {
    const url = `https://googleads.googleapis.com/${version}/customers/${bareCustomerId(customerId)}/${resource}:mutate`;
    const res = await fetch(url, {
      method: 'POST',
      headers: googleAdsHeaders(accessToken),
      body: JSON.stringify({ operations }),
    });

    const responseBody = await res.text();
    if (isRetryableGoogleAdsVersionError(res.status, responseBody)) continue;

    if (!res.ok) {
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
  campaignId: string
): Promise<{ resourceName: string; name: string; type: string } | null> {
  const rows = await searchGoogleAds<{
    campaign?: { resourceName?: string; id?: string; name?: string; advertisingChannelType?: string };
  }>(
    accessToken,
    customerId,
    `SELECT campaign.resource_name, campaign.id, campaign.name, campaign.advertising_channel_type
     FROM campaign WHERE campaign.id = ${campaignId} AND campaign.status != 'REMOVED' LIMIT 1`
  );
  const c = rows[0]?.campaign;
  if (!c?.resourceName) return null;
  return { resourceName: c.resourceName, name: c.name ?? 'Campaign', type: c.advertisingChannelType ?? 'SEARCH' };
}

async function findAdGroupInCampaign(
  accessToken: string,
  customerId: string,
  campaignResourceName: string
): Promise<string | null> {
  const rows = await searchGoogleAds<{ adGroup?: { resourceName?: string } }>(
    accessToken,
    customerId,
    `SELECT ad_group.resource_name FROM ad_group
     WHERE ad_group.campaign = '${campaignResourceName}'
     AND ad_group.status = 'ENABLED' LIMIT 1`
  );
  return rows[0]?.adGroup?.resourceName ?? null;
}

async function findTargetAdGroup(
  accessToken: string,
  customerId: string,
  adGroupResourceName?: string | null
): Promise<string | null> {
  if (adGroupResourceName) return adGroupResourceName;
  const rows = await searchGoogleAds<{ adGroup?: { resourceName?: string } }>(
    accessToken,
    customerId,
    `SELECT ad_group.resource_name FROM ad_group
     WHERE ad_group.status = 'ENABLED' AND campaign.status = 'ENABLED'
     LIMIT 1`
  );
  return rows[0]?.adGroup?.resourceName ?? null;
}

export async function pauseExistingAd(
  accessToken: string,
  customerId: string,
  adGroupAdResourceName: string
): Promise<boolean> {
  const result = await googleAdsMutate(accessToken, customerId, 'adGroupAds', [
    {
      update: { resourceName: adGroupAdResourceName, status: 'PAUSED' },
      updateMask: 'status',
    },
  ]);
  return result.success;
}

export async function createCampaign(
  accessToken: string,
  customerId: string,
  name: string,
  budgetResourceName: string
): Promise<{ success: boolean; resourceName?: string; error?: string }> {
  const result = await googleAdsMutate(accessToken, customerId, 'campaigns', [
    {
      create: {
        name: name.slice(0, 255),
        advertisingChannelType: 'SEARCH',
        status: 'PAUSED',
        campaignBudget: budgetResourceName,
        manualCpc: {},
        networkSettings: {
          targetGoogleSearch: true,
          targetSearchNetwork: true,
          targetContentNetwork: false,
          targetPartnerSearchNetwork: false,
        },
        containsEuPoliticalAdvertising: 'DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING',
      },
    },
  ]);
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
  name: string
): Promise<{ success: boolean; resourceName?: string; error?: string }> {
  const amountMicros = String(Math.max(1, Math.round(dailyBudgetUsd * 1_000_000)));
  const result = await googleAdsMutate(accessToken, customerId, 'campaignBudgets', [
    {
      create: {
        name: name.slice(0, 255),
        amountMicros,
        deliveryMethod: 'STANDARD',
        explicitlyShared: false,
      },
    },
  ]);
  return {
    success: result.success,
    resourceName: result.resourceNames?.[0],
    error: result.error,
  };
}

export async function createAdGroup(
  accessToken: string,
  customerId: string,
  campaignResourceName: string,
  name: string
): Promise<{ success: boolean; resourceName?: string; error?: string }> {
  const result = await googleAdsMutate(accessToken, customerId, 'adGroups', [
    {
      create: {
        name: name.slice(0, 255),
        campaign: campaignResourceName,
        status: 'ENABLED',
        type: 'SEARCH_STANDARD',
        cpcBidMicros: '1000000',
      },
    },
  ]);
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
  keywords: string[]
): Promise<{ success: boolean; added: number; error?: string }> {
  const unique = [...new Set(keywords.map((k) => k.trim()).filter(Boolean))].slice(0, 20);
  if (!unique.length) return { success: true, added: 0 };

  const operations = unique.map((text) => ({
    create: {
      adGroup: adGroupResourceName,
      status: 'ENABLED',
      keyword: { text: text.slice(0, 80), matchType: 'BROAD' },
    },
  }));

  const result = await googleAdsMutate(accessToken, customerId, 'adGroupCriteria', operations);
  return {
    success: result.success,
    added: result.success ? unique.length : 0,
    error: result.error,
  };
}

export async function createResponsiveSearchAd(
  accessToken: string,
  customerId: string,
  adGroupResourceName: string,
  content: PublishAdRequest['content'],
  finalUrl: string
): Promise<{ success: boolean; resourceName?: string; error?: string }> {
  const rsa: Record<string, unknown> = {
    headlines: content.headlines.slice(0, 15).map((text) => ({ text: text.slice(0, 30) })),
    descriptions: content.descriptions.slice(0, 4).map((text) => ({ text: text.slice(0, 90) })),
  };
  if (content.displayPaths?.path1) rsa.path1 = content.displayPaths.path1.slice(0, 15);
  if (content.displayPaths?.path2) rsa.path2 = content.displayPaths.path2.slice(0, 15);

  const result = await googleAdsMutate(accessToken, customerId, 'adGroupAds', [
    {
      create: {
        adGroup: adGroupResourceName,
        status: 'PAUSED',
        ad: {
          responsiveSearchAd: rsa,
          finalUrls: [finalUrl.startsWith('http') ? finalUrl : `https://${finalUrl}`],
        },
      },
    },
  ]);
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

  setStep(steps, 'resolve', 'running');
  await persistSteps(publishedRecord.id, steps);

  let campaignResourceName = optimization.campaignResourceName ?? originalAd.campaignResourceName;
  let campaignName = originalAd.campaignName ?? optimizedContent.campaignStrategy?.campaignName ?? 'Campaign';
  let adGroupResourceName: string | null =
    optimization.adGroupResourceName ?? originalAd.adGroupResourceName ?? null;

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
      `Budget — ${strategyName}`
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
      budgetResult.resourceName
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
      adGroupName
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
      const kwResult = await createKeywords(accessToken, customerId, adGroupResourceName, keywords);
      setStep(steps, 'keywords', kwResult.success ? 'complete' : 'failed');
      if (!kwResult.success) {
        console.warn('[publish] keyword creation failed:', kwResult.error);
      }
    } else {
      setStep(steps, 'keywords', 'skipped');
    }
  } else if (scenario === 'CREATE_ADS') {
    setStep(steps, 'campaign', 'skipped');

    if (optimization.campaignId) {
      const found = await findCampaignById(accessToken, customerId, optimization.campaignId);
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

    if (campaignResourceName && !adGroupResourceName) {
      setStep(steps, 'adgroup', 'running');
      adGroupResourceName = await findAdGroupInCampaign(accessToken, customerId, campaignResourceName);
      if (!adGroupResourceName) {
        const adGroupName =
          optimizedContent.campaignStrategy?.adGroups?.[0]?.name ?? 'AI Optimized Ads';
        const adGroupResult = await createAdGroup(
          accessToken,
          customerId,
          campaignResourceName,
          adGroupName
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
      setStep(steps, 'adgroup', 'complete');

      const keywords =
        optimizedContent.campaignStrategy?.adGroups?.[0]?.keywords ??
        optimizedContent.keywordSuggestions ??
        [];
      if (keywords.length && adGroupResourceName) {
        setStep(steps, 'keywords', 'running');
        const kwResult = await createKeywords(accessToken, customerId, adGroupResourceName, keywords);
        setStep(steps, 'keywords', kwResult.success ? 'complete' : 'skipped');
      }
    } else {
      setStep(steps, 'adgroup', 'skipped');
      setStep(steps, 'keywords', 'skipped');
    }

    if (!adGroupResourceName) {
      adGroupResourceName = await findTargetAdGroup(accessToken, customerId, adGroupResourceName);
    }
  } else {
    setStep(steps, 'campaign', 'skipped');
    setStep(steps, 'adgroup', 'skipped');
    setStep(steps, 'keywords', 'skipped');
    adGroupResourceName = await findTargetAdGroup(
      accessToken,
      customerId,
      adGroupResourceName
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

  if (scenario === 'REPLACE_EXISTING' && previousAdResourceName) {
    setStep(steps, 'pause', 'running');
    await persistSteps(publishedRecord.id, steps, { campaignName, accountName });
    const paused = await pauseExistingAd(accessToken, customerId, previousAdResourceName);
    setStep(steps, 'pause', paused ? 'complete' : 'failed');
    if (!paused) {
      console.warn('[publish] could not pause previous ad:', previousAdResourceName);
    }
  }

  setStep(steps, 'create_ad', 'running');
  await persistSteps(publishedRecord.id, steps, { campaignName, accountName });

  const result = await createResponsiveSearchAd(
    accessToken,
    customerId,
    adGroupResourceName,
    request.content,
    landingUrl
  );

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
  const updated = await prisma.publishedAdVersion.update({
    where: { id: publishedRecord.id },
    data: {
      status: 'PUBLISHED',
      adGroupAdResourceName: result.resourceName,
      newAdResourceName: result.resourceName,
      campaignId: optimization.campaignId,
      rollbackAvailable: scenario === 'REPLACE_EXISTING' && !!previousAdResourceName,
      publishedAt,
      performanceMetrics: {
        steps: steps.map((s) => (s.id === 'save' ? { ...s, status: 'complete' as const } : s)),
        campaignName,
        accountName,
        scenario,
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

  const action =
    scenario === 'REPLACE_EXISTING'
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
    resourceName: result.resourceName,
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

  if (version.newAdResourceName) {
    await pauseExistingAd(accessToken, version.googleAdsCustomerId, version.newAdResourceName);
  }

  if (version.previousAdResourceName) {
    await googleAdsMutate(accessToken, version.googleAdsCustomerId, 'adGroupAds', [
      {
        update: { resourceName: version.previousAdResourceName, status: 'ENABLED' },
        updateMask: 'status',
      },
    ]);
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
