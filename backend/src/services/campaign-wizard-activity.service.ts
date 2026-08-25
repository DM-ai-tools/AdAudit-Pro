import { prisma } from '../lib/prisma.js';

export type WizardCompetitorAdSnapshot = {
  headlines?: string[];
  descriptions?: string[];
};

export type WizardCompetitorSnapshot = {
  name: string;
  url?: string;
  isMostRelevant?: boolean;
  adCount?: number;
  activeAdCount?: number;
  adDurationDays?: number;
  confidenceScore?: number;
  sampleHeadlines?: string[];
  headlines?: string[];
  descriptions?: string[];
  ads?: WizardCompetitorAdSnapshot[];
};

export type WizardKeywordSnapshot = {
  keyword: string;
  matchType?: string;
  maxCpc?: number;
  role?: string;
  seed?: string;
  selected?: boolean;
  volume?: number;
};

export type WizardAdVariantSnapshot = {
  id: string;
  label: string;
  chosen: boolean;
  headlines?: string[];
  descriptions?: string[];
  keywords?: string[];
  focusedCompetitor?: string;
  displayPaths?: { path1?: string; path2?: string };
  finalUrl?: string;
};

export type WizardActivityProcess = {
  stepsCompleted: string[];
  services?: {
    discovered: string[];
    selected: string[];
    companyName?: string;
    industry?: string;
    why: string;
  };
  competitors?: {
    byService: Array<{
      service: string;
      competitors: WizardCompetitorSnapshot[];
    }>;
    why: string;
  };
  keywords?: {
    selected: WizardKeywordSnapshot[];
    skipped?: string[];
    negatives?: string[];
    recommendedCount?: number;
    dailyBudget?: number;
    bidStrategy?: string;
    bidStrategyAlternatives?: Array<{ id: string; label: string; chosen: boolean; why?: string }>;
    clusters?: Array<{
      service: string;
      topKeyword?: string;
      selected?: boolean;
      keywords: WizardKeywordSnapshot[];
    }>;
    why: string;
  };
  campaign?: {
    name?: string;
    type?: string;
    dailyBudget?: number;
    biddingStrategy?: string;
    locations?: string;
    resourceName?: string;
    why: string;
  };
  ads?: {
    generatedVariants: WizardAdVariantSnapshot[];
    selected?: {
      label?: string;
      headlines: string[];
      descriptions: string[];
      keywords?: string[];
      finalUrl?: string;
      displayPaths?: { path1?: string; path2?: string };
      focusedCompetitor?: string;
    };
    offer?: string;
    audience?: string;
    tone?: string;
    why: string;
  };
  approvals?: Record<string, boolean>;
  googleResult?: {
    campaignResourceName?: string;
    adResourceName?: string;
    adGroupResourceName?: string;
    keywordsAdded?: number;
    message?: string;
  };
};

export type WizardActivityStage = 'in_progress' | 'campaign_created' | 'completed';

export async function saveCampaignWizardActivity(input: {
  userId: string;
  auditRunId?: string;
  googleAdsCustomerId?: string;
  mode: 'campaign' | 'ad';
  stage: WizardActivityStage;
  title: string;
  summary?: string;
  process: WizardActivityProcess;
  campaignResourceName?: string;
  adResourceName?: string;
  campaignName?: string;
}): Promise<{ id: string } | null> {
  const auditRunId = await resolveAuditRunId(
    input.userId,
    input.auditRunId,
    input.googleAdsCustomerId
  );
  if (!auditRunId) {
    console.warn(
      '[wizard-activity] skipped — no audit run for user',
      input.userId,
      'auditRunId=',
      input.auditRunId,
      'customer=',
      input.googleAdsCustomerId
    );
    return null;
  }

  const userExists = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { id: true },
  });
  if (!userExists) {
    console.warn('[wizard-activity] skipped — user not found', input.userId);
    return null;
  }

  const payload = {
    googleAdsCustomerId: input.googleAdsCustomerId,
    mode: input.mode,
    stage: input.stage,
    title: input.title.slice(0, 200),
    summary: input.summary?.slice(0, 2000),
    processJson: JSON.parse(JSON.stringify(input.process)) as object,
    campaignResourceName: input.campaignResourceName,
    adResourceName: input.adResourceName,
    campaignName: input.campaignName?.slice(0, 200),
  };

  const existing = await prisma.campaignWizardActivity.findFirst({
    where: {
      userId: input.userId,
      auditRunId,
      mode: input.mode,
      OR: [
        ...(input.campaignResourceName ? [{ campaignResourceName: input.campaignResourceName }] : []),
        ...(input.campaignName
          ? [{ campaignName: input.campaignName, campaignResourceName: null }]
          : []),
        { stage: { in: ['in_progress', 'campaign_created'] } },
      ],
    },
    orderBy: { updatedAt: 'desc' },
  });

  try {
    if (existing) {
      const row = await prisma.campaignWizardActivity.update({
        where: { id: existing.id },
        data: payload,
      });
      console.log('[wizard-activity] updated', row.id, row.stage, row.title);
      return { id: row.id };
    }
    const row = await prisma.campaignWizardActivity.create({
      data: {
        userId: input.userId,
        auditRunId,
        ...payload,
      },
    });
    console.log('[wizard-activity] created', row.id, row.stage, row.title);
    return { id: row.id };
  } catch (err) {
    console.error('[wizard-activity] prisma save failed:', err instanceof Error ? err.message : err);
    throw err;
  }
}

async function resolveAuditRunId(
  userId: string,
  auditRunId?: string,
  googleAdsCustomerId?: string
): Promise<string | null> {
  if (auditRunId?.trim()) {
    const exact = await prisma.auditRun.findFirst({
      where: { id: auditRunId.trim() },
      select: { id: true },
    });
    if (exact) return exact.id;
  }

  const customerId = googleAdsCustomerId?.replace(/\D/g, '');
  const latest = await prisma.auditRun.findFirst({
    where: {
      userId,
      ...(customerId
        ? {
            OR: [
              { googleAdsCustomerId: customerId },
              { googleAdsCustomerId: googleAdsCustomerId },
            ],
          }
        : {}),
    },
    orderBy: [{ completedAt: 'desc' }, { createdAt: 'desc' }],
    select: { id: true },
  });
  return latest?.id ?? null;
}

export async function listCampaignWizardActivitiesForAudit(auditRunId: string): Promise<
  Array<{
    id: string;
    mode: string;
    stage: string;
    title: string;
    summary: string | null;
    process: WizardActivityProcess;
    campaignResourceName: string | null;
    adResourceName: string | null;
    campaignName: string | null;
    createdAt: string;
  }>
> {
  const rows = await prisma.campaignWizardActivity.findMany({
    where: { auditRunId },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map((r) => ({
    id: r.id,
    mode: r.mode,
    stage: r.stage,
    title: r.title,
    summary: r.summary,
    process: (r.processJson ?? {}) as WizardActivityProcess,
    campaignResourceName: r.campaignResourceName,
    adResourceName: r.adResourceName,
    campaignName: r.campaignName,
    createdAt: r.createdAt.toISOString(),
  }));
}

/** Include wizard runs saved on sibling audits of the same Google Ads account. */
export async function listCampaignWizardActivitiesForReport(opts: {
  auditRunId: string;
  userId: string;
  googleAdsCustomerId?: string | null;
}): Promise<Awaited<ReturnType<typeof listCampaignWizardActivitiesForAudit>>> {
  const primary = await listCampaignWizardActivitiesForAudit(opts.auditRunId);
  const customerId = opts.googleAdsCustomerId?.replace(/\D/g, '');
  if (!customerId) return primary;

  const extras = await prisma.campaignWizardActivity.findMany({
    where: {
      userId: opts.userId,
      auditRunId: { not: opts.auditRunId },
      OR: [
        { googleAdsCustomerId: customerId },
        { googleAdsCustomerId: opts.googleAdsCustomerId ?? undefined },
      ],
    },
    orderBy: { createdAt: 'asc' },
  });

  const seen = new Set(primary.map((r) => r.id));
  const mapped = extras
    .filter((r) => !seen.has(r.id))
    .map((r) => ({
      id: r.id,
      mode: r.mode,
      stage: r.stage,
      title: r.title,
      summary: r.summary,
      process: (r.processJson ?? {}) as WizardActivityProcess,
      campaignResourceName: r.campaignResourceName,
      adResourceName: r.adResourceName,
      campaignName: r.campaignName,
      createdAt: r.createdAt.toISOString(),
    }));

  return [...primary, ...mapped].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );
}
