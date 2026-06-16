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

export interface PublishAdResult {
  publishedId: string;
  status: 'PUBLISHED' | 'SIMULATED' | 'FAILED';
  message: string;
  resourceName?: string;
  rollbackAvailable?: boolean;
  scenario?: string;
}

export interface RollbackAdResult {
  success: boolean;
  message: string;
}

const GOOGLE_ADS_API_VERSIONS_LIST = [...GOOGLE_ADS_API_VERSIONS];

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

async function mutateAdGroupAds(
  accessToken: string,
  customerId: string,
  operations: unknown[]
): Promise<{ success: boolean; resourceName?: string; error?: string }> {
  for (const version of GOOGLE_ADS_API_VERSIONS_LIST) {
    const url = `https://googleads.googleapis.com/${version}/customers/${bareCustomerId(customerId)}/adGroupAds:mutate`;
    const res = await fetch(url, {
      method: 'POST',
      headers: googleAdsHeaders(accessToken),
      body: JSON.stringify({ operations }),
    });

    const responseBody = await res.text();
    if (isRetryableGoogleAdsVersionError(res.status, responseBody)) continue;

    if (!res.ok) {
      let errorMsg = `Google Ads API error (${res.status})`;
      try {
        const json = JSON.parse(responseBody) as { error?: { message?: string } };
        errorMsg = json.error?.message ?? errorMsg;
      } catch {
        errorMsg = responseBody.slice(0, 200);
      }
      return { success: false, error: errorMsg };
    }

    try {
      const json = JSON.parse(responseBody) as { results?: Array<{ resourceName?: string }> };
      return { success: true, resourceName: json.results?.[0]?.resourceName };
    } catch {
      return { success: true };
    }
  }
  return { success: false, error: 'No supported Google Ads API version available.' };
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

async function pauseAd(
  accessToken: string,
  customerId: string,
  adGroupAdResourceName: string
): Promise<boolean> {
  const result = await mutateAdGroupAds(accessToken, customerId, [
    {
      update: { resourceName: adGroupAdResourceName, status: 'PAUSED' },
      updateMask: 'status',
    },
  ]);
  return result.success;
}

async function createResponsiveSearchAd(
  accessToken: string,
  customerId: string,
  adGroupResourceName: string,
  content: PublishAdRequest['content'],
  finalUrl: string
): Promise<{ success: boolean; resourceName?: string; error?: string }> {
  return mutateAdGroupAds(accessToken, customerId, [
    {
      create: {
        adGroup: adGroupResourceName,
        status: 'PAUSED',
        ad: {
          responsiveSearchAd: {
            headlines: content.headlines.slice(0, 15).map((text) => ({ text: text.slice(0, 30) })),
            descriptions: content.descriptions.slice(0, 4).map((text) => ({ text: text.slice(0, 90) })),
          },
          finalUrls: [finalUrl.startsWith('http') ? finalUrl : `https://${finalUrl}`],
        },
      },
    },
  ]);
}

export async function publishOptimizedAd(request: PublishAdRequest): Promise<PublishAdResult> {
  const optimization = await prisma.aIOptimization.findFirst({
    where: { id: request.optimizationId, userId: request.userId },
  });
  if (!optimization) throw new Error('Optimization not found');

  const originalAd = optimization.originalAd as {
    adGroupAdResourceName?: string;
    adGroupResourceName?: string;
    finalUrls?: string[];
  };
  const scenario = optimization.scenario ?? 'CREATE_NEW';
  const previousAdResourceName =
    request.adGroupAdResourceName ?? originalAd.adGroupAdResourceName;

  const landingUrl =
    request.content.finalUrl ??
    originalAd.finalUrls?.[0] ??
    'https://www.example.com';

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
    },
  });

  const user = await getMe(request.userId);
  const validCustomerId =
    request.googleAdsCustomerId && request.googleAdsCustomerId !== '0000000000';

  const canPublishLive =
    isGoogleAdsConfigured() && !!user?.googleRefreshToken && !!validCustomerId;

  if (!canPublishLive) {
    const updated = await prisma.publishedAdVersion.update({
      where: { id: publishedRecord.id },
      data: { status: 'SIMULATED', publishedAt: new Date() },
    });
    await prisma.aIOptimization.update({
      where: { id: request.optimizationId },
      data: { status: 'APPROVED' },
    });
    return {
      publishedId: updated.id,
      status: 'SIMULATED',
      scenario,
      message: !user?.googleRefreshToken
        ? 'Sign in with Google to publish live. Optimized copy saved to your account.'
        : 'Optimized copy saved. Connect Google Ads to publish directly.',
      rollbackAvailable: false,
    };
  }

  const accessToken = await getGoogleAccessTokenForUser(request.userId);
  if (!accessToken) {
    await prisma.publishedAdVersion.update({
      where: { id: publishedRecord.id },
      data: { status: 'FAILED', errorMessage: 'Could not refresh Google access token.' },
    });
    throw new Error('Could not refresh Google access token. Reconnect your Google account.');
  }

  const adGroup = await findTargetAdGroup(
    accessToken,
    request.googleAdsCustomerId,
    optimization.adGroupResourceName ?? originalAd.adGroupResourceName
  );

  if (!adGroup) {
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
    return {
      publishedId: publishedRecord.id,
      status: 'SIMULATED',
      scenario,
      message:
        'Optimized copy saved. Create a Search campaign with an ad group, then publish again.',
      rollbackAvailable: false,
    };
  }

  // CASE 2: pause old ad before creating replacement (never overwrite in-place)
  if (scenario === 'REPLACE_EXISTING' && previousAdResourceName) {
    await pauseAd(accessToken, request.googleAdsCustomerId, previousAdResourceName);
  }

  const result = await createResponsiveSearchAd(
    accessToken,
    request.googleAdsCustomerId,
    adGroup,
    request.content,
    landingUrl
  );

  if (!result.success) {
    await prisma.publishedAdVersion.update({
      where: { id: publishedRecord.id },
      data: { status: 'FAILED', errorMessage: result.error },
    });
    return {
      publishedId: publishedRecord.id,
      status: 'FAILED',
      scenario,
      message: result.error ?? 'Publish failed',
    };
  }

  const updated = await prisma.publishedAdVersion.update({
    where: { id: publishedRecord.id },
    data: {
      status: 'PUBLISHED',
      adGroupAdResourceName: result.resourceName,
      newAdResourceName: result.resourceName,
      rollbackAvailable: scenario === 'REPLACE_EXISTING' && !!previousAdResourceName,
      publishedAt: new Date(),
      performanceMetrics: {
        publishedAt: new Date().toISOString(),
        scenario,
      },
    },
  });

  await prisma.aIOptimization.update({
    where: { id: request.optimizationId },
    data: { status: 'APPROVED' },
  });

  const action =
    scenario === 'REPLACE_EXISTING'
      ? 'Previous ad paused. New optimized ad created (paused — enable in Google Ads).'
      : 'New Responsive Search Ad created (paused — review and enable in Google Ads).';

  return {
    publishedId: updated.id,
    status: 'PUBLISHED',
    scenario,
    message: action,
    resourceName: result.resourceName,
    rollbackAvailable: updated.rollbackAvailable,
  };
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
    return { success: false, message: 'Reconnect Google to rollback.' };
  }

  if (version.newAdResourceName) {
    await pauseAd(accessToken, version.googleAdsCustomerId, version.newAdResourceName);
  }

  if (version.previousAdResourceName) {
    await mutateAdGroupAds(accessToken, version.googleAdsCustomerId, [
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
