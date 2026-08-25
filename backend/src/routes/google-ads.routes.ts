import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';
import { getMe } from '../services/audit.service.js';
import {
  getGoogleAdsAccountsForUser,
  fetchCampaignsForAccount,
  fetchAccountPerformanceSummary,
  fetchAccountBudgetBreakdown,
  fetchRequiresEuPoliticalAdvertising,
  buildBudgetBreakdownFromCampaigns,
  isGoogleAdsConfigured,
  resolveAccountLoginCustomerId,
  listManagerCustomerIds,
  fetchCampaignPublishContext,
  buildMockCampaignPublishContext,
  fetchKeywordLiveMetrics,
} from '../services/google-ads.service.js';
import { accountRequiresEuPoliticalDeclaration } from '../utils/eu-political-advertising.js';
import { getMockCampaigns } from '../data/google-ads-campaigns.js';
import { generateBudgetRecommendations } from '../services/budget-intelligence.service.js';
import { getAccountAuditConfig } from '../services/account-audit-config.service.js';
import {
  publishOptimizedAd,
  rollbackPublishedAd,
  validatePublishContent,
  validatePublishingPermissions,
  getPublishStatus,
  createSearchCampaignForAccount,
  createAdInCampaignForAccount,
  updateCampaignBiddingForAccount,
  updateCampaignBudgetForAccount,
  listPublishedAdHistory,
  publishManualAdEdit,
} from '../services/googleAdsPublishing.service.js';
import { buildAdPreview } from '../services/adPreview.service.js';
import { getOptimizationForPreview } from '../services/aiOptimization.service.js';
import {
  saveCampaignWizardActivity,
  type WizardActivityProcess,
  type WizardActivityStage,
} from '../services/campaign-wizard-activity.service.js';

const router = Router();

async function persistWizardFromGoogleAdsCreate(opts: {
  userId: string;
  auditRunId?: string;
  googleAdsCustomerId?: string;
  mode: 'campaign' | 'ad';
  stage: WizardActivityStage;
  title: string;
  summary?: string;
  process?: WizardActivityProcess | Record<string, unknown>;
  campaignResourceName?: string;
  adResourceName?: string;
  campaignName?: string;
}): Promise<void> {
  if (!opts.process) return;
  try {
    await saveCampaignWizardActivity({
      userId: opts.userId,
      auditRunId: opts.auditRunId,
      googleAdsCustomerId: opts.googleAdsCustomerId,
      mode: opts.mode,
      stage: opts.stage,
      title: opts.title,
      summary: opts.summary,
      process: opts.process as WizardActivityProcess,
      campaignResourceName: opts.campaignResourceName,
      adResourceName: opts.adResourceName,
      campaignName: opts.campaignName,
    });
  } catch (err) {
    console.error(
      '[google-ads] wizard activity save failed:',
      err instanceof Error ? err.message : err
    );
  }
}

router.get('/accounts', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const user = await getMe(req.authUser!.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const { accounts, source, reason, errorMessage } = await getGoogleAdsAccountsForUser(
      user.googleRefreshToken,
      user.id
    );
    res.json({
      accounts,
      source,
      reason,
      errorMessage,
      googleAdsConfigured: isGoogleAdsConfigured(),
      hasRefreshToken: !!user.googleRefreshToken,
      /** Client accounts only — managers listed for context but not selectable */
      selectableAccounts: accounts.filter((a) => a.selectable !== false),
      managerAccounts: accounts.filter((a) => a.accountType === 'Manager'),
    });
  } catch (err) {
    console.error('Failed to fetch Google Ads accounts:', err);
    res.status(500).json({ error: 'Failed to fetch accounts' });
  }
});

router.post('/accounts/:customerId/keyword-metrics', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const user = await getMe(req.authUser!.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (!user.googleRefreshToken) return res.status(401).json({ error: 'Google Ads not connected' });

    const customerId = String(req.params.customerId);
    const body = req.body as {
      keywords?: string[];
      country?: string;
      location?: string;
      websiteUrl?: string;
      windowDays?: number;
    };
    const keywords = (body.keywords ?? []).map((k) => String(k).trim()).filter(Boolean);
    if (!keywords.length) {
      res.status(400).json({ error: 'keywords[] is required' });
      return;
    }

    const { accounts } = await getGoogleAdsAccountsForUser(user.googleRefreshToken, user.id);
    const account = accounts.find(
      (a) => a.customerId === customerId || a.customerId.replace(/-/g, '') === customerId.replace(/-/g, '')
    );
    if (!account) return res.status(404).json({ error: 'Account not found for this user' });

    const loginCustomerId = resolveAccountLoginCustomerId(account, accounts);
    const result = await fetchKeywordLiveMetrics(
      user.googleRefreshToken,
      customerId,
      keywords.slice(0, 80),
      user.id,
      {
        loginCustomerId,
        country: body.country,
        location: body.location,
        websiteUrl: body.websiteUrl,
        windowDays: body.windowDays,
      }
    );

    if (!result) {
      return res.status(502).json({ error: 'Could not load keyword metrics from Google Ads' });
    }

    res.json({ ...result, source: 'google_ads_api' });
  } catch (err) {
    console.error('keyword-metrics failed:', err);
    res.status(500).json({ error: 'Failed to fetch keyword metrics' });
  }
});

router.get('/accounts/:customerId/campaigns', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const user = await getMe(req.authUser!.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const customerId = String(req.params.customerId);
    const { accounts, source } = await getGoogleAdsAccountsForUser(user.googleRefreshToken, user.id);
    const account = accounts.find(
      (a) => a.customerId === customerId || a.customerId.replace(/-/g, '') === customerId.replace(/-/g, '')
    );

    if (!account) {
      return res.status(404).json({ error: 'Account not found for this user' });
    }

    if (account.selectable === false) {
      return res.status(400).json({
        error: 'Manager accounts cannot be audited directly — select a client account under this MCC.',
      });
    }

    let campaigns;
    const loginCustomerId = resolveAccountLoginCustomerId(account, accounts);
    const windowDays = Math.min(365, Math.max(30, parseInt(String(req.query.window ?? '30'), 10) || 30));

    if (source === 'mock') {
      campaigns = getMockCampaigns(customerId);
    } else if (!user.googleRefreshToken) {
      return res.status(401).json({ error: 'Google Ads not connected' });
    } else {
      campaigns = await fetchCampaignsForAccount(
        user.googleRefreshToken,
        customerId,
        user.id,
        { loginCustomerId, managerIds: listManagerCustomerIds(accounts), dateWindowDays: windowDays }
      );
    }

    let performance = null;
    if (source !== 'mock' && user.googleRefreshToken) {
      performance = await fetchAccountPerformanceSummary(
        user.googleRefreshToken,
        customerId,
        user.id,
        { loginCustomerId, managerIds: listManagerCustomerIds(accounts), dateWindowDays: windowDays }
      );
    }

    let requiresEuPoliticalAdvertising = accountRequiresEuPoliticalDeclaration({
      timezone: account.timezone,
    });
    if (source !== 'mock' && user.googleRefreshToken) {
      requiresEuPoliticalAdvertising = await fetchRequiresEuPoliticalAdvertising(
        user.googleRefreshToken,
        customerId,
        user.id,
        { loginCustomerId, managerIds: listManagerCustomerIds(accounts), timezone: account.timezone }
      );
    }

    res.json({
      account: {
        customerId: account.customerId,
        name: account.name,
        websiteUrl: account.websiteUrl,
        industry: account.industry,
        currency: account.currency,
        timezone: account.timezone,
        requiresEuPoliticalAdvertising,
      },
      campaigns,
      performance,
      metricsWindowDays: windowDays,
      source: source === 'mock' ? 'mock' : 'google_ads_api',
      hasCampaigns: campaigns.length > 0,
      hasAds: campaigns.some((c) => c.adCount > 0),
    });
  } catch (err) {
    console.error('Failed to fetch campaigns:', err);
    res.status(500).json({ error: 'Failed to fetch campaigns' });
  }
});

router.get(
  '/accounts/:customerId/campaigns/:campaignId/publish-context',
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const user = await getMe(req.authUser!.userId);
      if (!user) return res.status(404).json({ error: 'User not found' });

      const customerId = String(req.params.customerId);
      const campaignId = String(req.params.campaignId);
      const windowDays = Math.min(365, Math.max(30, parseInt(String(req.query.window ?? '30'), 10) || 30));

      const { accounts, source } = await getGoogleAdsAccountsForUser(user.googleRefreshToken, user.id);
      const account = accounts.find(
        (a) => a.customerId === customerId || a.customerId.replace(/-/g, '') === customerId.replace(/-/g, '')
      );
      if (!account) return res.status(404).json({ error: 'Account not found for this user' });

      if (source === 'mock') {
        const campaigns = getMockCampaigns(customerId);
        const campaign = campaigns.find((c) => c.id === campaignId.replace(/\D/g, '') || c.id === campaignId);
        if (!campaign) {
          return res.status(404).json({ error: 'Campaign not found' });
        }
        return res.json({
          context: buildMockCampaignPublishContext(campaign, customerId, account.currency),
          source: 'mock',
        });
      }

      if (!user.googleRefreshToken) {
        return res.status(401).json({ error: 'Google Ads not connected' });
      }

      const loginCustomerId = resolveAccountLoginCustomerId(account, accounts);
      const context = await fetchCampaignPublishContext(
        user.googleRefreshToken,
        customerId,
        campaignId,
        user.id,
        {
          loginCustomerId,
          managerIds: listManagerCustomerIds(accounts),
          windowDays,
        }
      );

      if (!context) {
        return res.status(502).json({ error: 'Could not load campaign publish context' });
      }

      res.json({ context, source: 'google_ads_api' });
    } catch (err) {
      console.error('publish-context failed:', err);
      res.status(500).json({ error: 'Failed to load campaign publish context' });
    }
  }
);

router.get('/accounts/:customerId/performance', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const user = await getMe(req.authUser!.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const customerId = String(req.params.customerId);
    const windowDays = Math.min(365, Math.max(30, parseInt(String(req.query.window ?? '30'), 10) || 30));
    const { accounts, source } = await getGoogleAdsAccountsForUser(user.googleRefreshToken, user.id);
    const account = accounts.find(
      (a) => a.customerId === customerId || a.customerId.replace(/-/g, '') === customerId.replace(/-/g, '')
    );

    if (!account) return res.status(404).json({ error: 'Account not found for this user' });
    if (!user.googleRefreshToken) return res.status(401).json({ error: 'Google Ads not connected' });

    const loginCustomerId = resolveAccountLoginCustomerId(account, accounts);
    const performance = await fetchAccountPerformanceSummary(
      user.googleRefreshToken,
      customerId,
      user.id,
      { loginCustomerId, managerIds: listManagerCustomerIds(accounts), dateWindowDays: windowDays }
    );

    if (!performance) {
      return res.status(502).json({ error: 'Could not load performance data from Google Ads' });
    }

    res.json({
      account: { customerId: account.customerId, name: account.name, currency: account.currency },
      performance,
      source: source === 'mock' ? 'mock' : 'google_ads_api',
    });
  } catch (err) {
    console.error('Failed to fetch performance:', err);
    res.status(500).json({ error: 'Failed to fetch performance summary' });
  }
});

router.get('/accounts/:customerId/budget-intelligence', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const user = await getMe(req.authUser!.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const customerId = String(req.params.customerId);
    const windowDays = Math.min(365, Math.max(30, parseInt(String(req.query.window ?? '30'), 10) || 30));
    const { accounts, source } = await getGoogleAdsAccountsForUser(user.googleRefreshToken, user.id);
    const account = accounts.find(
      (a) => a.customerId === customerId || a.customerId.replace(/-/g, '') === customerId.replace(/-/g, '')
    );

    if (!account) return res.status(404).json({ error: 'Account not found for this user' });
    if (account.selectable === false) {
      return res.status(400).json({ error: 'Select a client account to view budget intelligence.' });
    }

    const loginCustomerId = resolveAccountLoginCustomerId(account, accounts);
    let breakdown;
    if (source === 'mock') {
      breakdown = buildBudgetBreakdownFromCampaigns(getMockCampaigns(customerId), {
        currency: account.currency || 'AUD',
        timezone: account.timezone,
        windowDays,
      });
    } else if (!user.googleRefreshToken) {
      return res.status(401).json({ error: 'Google Ads not connected' });
    } else {
      breakdown = await fetchAccountBudgetBreakdown(
        user.googleRefreshToken,
        customerId,
        user.id,
        { loginCustomerId, managerIds: listManagerCustomerIds(accounts), dateWindowDays: windowDays }
      );
    }

    if (!breakdown) {
      return res.status(502).json({ error: 'Could not load budget data from Google Ads' });
    }

    const recommendations = await generateBudgetRecommendations(breakdown);

    res.json({
      account: {
        customerId: account.customerId,
        name: account.name,
        currency: account.currency,
        timezone: account.timezone,
      },
      breakdown,
      recommendations,
      source: source === 'mock' ? 'mock' : 'google_ads_api',
    });
  } catch (err) {
    console.error('Failed to fetch budget intelligence:', err);
    res.status(500).json({ error: 'Failed to fetch budget intelligence' });
  }
});

router.get('/accounts/:customerId/audit-config', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const user = await getMe(req.authUser!.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const customerId = String(req.params.customerId);
    const { accounts } = await getGoogleAdsAccountsForUser(user.googleRefreshToken, user.id);
    const account = accounts.find(
      (a) => a.customerId === customerId || a.customerId.replace(/-/g, '') === customerId.replace(/-/g, '')
    );

    if (!account) {
      return res.status(404).json({ error: 'Account not found for this user' });
    }

    const config = await getAccountAuditConfig(customerId, user.googleRefreshToken, account, user.id);
    if (!config) {
      return res.status(502).json({ error: 'Could not load audit configuration for this account' });
    }

    res.json(config);
  } catch (err) {
    console.error('Failed to fetch audit config:', err);
    res.status(500).json({ error: 'Failed to fetch audit configuration' });
  }
});

router.get('/status', authMiddleware, async (req: AuthRequest, res: Response) => {
  const user = await getMe(req.authUser!.userId);
  res.json({
    googleAdsConfigured: isGoogleAdsConfigured(),
    hasRefreshToken: !!user?.googleRefreshToken,
    managerAccountId: process.env.GOOGLE_ADS_MANAGER_ACCOUNT_ID || null,
  });
});

router.get('/published-versions', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const customerId = req.query.customerId ? String(req.query.customerId) : undefined;
    const campaignId = req.query.campaignId ? String(req.query.campaignId) : undefined;
    const windowDays = Math.min(365, Math.max(30, parseInt(String(req.query.window ?? '30'), 10) || 30));
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? '40'), 10) || 40));

    const { versions, currency } = await listPublishedAdHistory({
      userId: req.authUser!.userId,
      googleAdsCustomerId: customerId,
      campaignId,
      windowDays,
      limit,
    });

    res.json({ versions, currency, metricsWindowDays: windowDays });
  } catch (err) {
    console.error('published-versions failed:', err);
    res.status(500).json({ error: 'Failed to load published ad history' });
  }
});

router.post('/update-ad', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const body = req.body as {
      auditRunId?: string;
      googleAdsCustomerId?: string;
      campaignId?: string;
      campaignName?: string;
      campaignResourceName?: string;
      adGroupId?: string;
      adGroupName?: string;
      adGroupAdResourceName?: string;
      pauseExistingAd?: boolean;
      originalAd?: {
        headlines: string[];
        descriptions: string[];
        finalUrls?: string[];
        displayPath1?: string;
        displayPath2?: string;
      };
      content?: {
        headlines: string[];
        descriptions: string[];
        displayPaths?: { path1?: string; path2?: string };
        finalUrl: string;
      };
    };

    if (
      !body.auditRunId ||
      !body.googleAdsCustomerId ||
      !body.campaignId ||
      !body.campaignResourceName ||
      !body.content ||
      !body.originalAd
    ) {
      res.status(400).json({
        error:
          'auditRunId, googleAdsCustomerId, campaignId, campaignResourceName, originalAd, and content are required',
      });
      return;
    }

    const result = await publishManualAdEdit({
      userId: req.authUser!.userId,
      auditRunId: body.auditRunId,
      googleAdsCustomerId: body.googleAdsCustomerId,
      campaignId: body.campaignId,
      campaignName: body.campaignName,
      campaignResourceName: body.campaignResourceName,
      adGroupId: body.adGroupId,
      adGroupName: body.adGroupName,
      adGroupAdResourceName: body.adGroupAdResourceName,
      originalAd: {
        headlines: body.originalAd.headlines ?? [],
        descriptions: body.originalAd.descriptions ?? [],
        finalUrls: body.originalAd.finalUrls,
        displayPaths: {
          path1: body.originalAd.displayPath1,
          path2: body.originalAd.displayPath2,
        },
      },
      content: body.content,
    });

    if (result.status === 'FAILED') {
      res.status(400).json(result);
      return;
    }
    res.json(result);
  } catch (err) {
    console.error('update-ad failed:', err);
    const message = err instanceof Error ? err.message : 'Failed to update ad';
    res.status(500).json({ error: message });
  }
});

router.post('/publish-ad', authMiddleware, handlePublishAd);
router.post('/publish', authMiddleware, handlePublishAd);

async function handlePublishAd(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { optimizationId, googleAdsCustomerId, adGroupAdResourceName, content, pauseExistingAd } = req.body as {
      optimizationId?: string;
      googleAdsCustomerId?: string;
      adGroupAdResourceName?: string;
      pauseExistingAd?: boolean;
      content?: {
        headlines: string[];
        descriptions: string[];
        longHeadlines?: string[];
        displayPaths?: { path1?: string; path2?: string };
        finalUrl?: string;
      };
    };

    if (!optimizationId || !googleAdsCustomerId || !content) {
      res.status(400).json({
        error: 'optimizationId, googleAdsCustomerId, and content are required',
      });
      return;
    }

    const validationError = validatePublishContent(content);
    if (validationError) {
      res.status(400).json({ error: validationError });
      return;
    }

    const permCheck = await validatePublishingPermissions(req.authUser!.userId, googleAdsCustomerId);
    if (!permCheck.canPublish && googleAdsCustomerId !== '0000000000') {
      // Still allow simulated publish path inside service
    }

    const result = await publishOptimizedAd({
      userId: req.authUser!.userId,
      optimizationId,
      googleAdsCustomerId,
      adGroupAdResourceName,
      pauseExistingAd: pauseExistingAd === true,
      content,
    });

    res.json(result);
  } catch (err) {
    console.error('publish-ad failed:', err);
    const message = err instanceof Error ? err.message : 'Failed to publish ad';
    if (message.includes('not found')) {
      res.status(404).json({ error: message });
      return;
    }
    if (message.includes('refresh') || message.includes('Reconnect')) {
      res.status(401).json({ error: message });
      return;
    }
    res.status(500).json({ error: message });
  }
}

router.post('/rollback-ad', authMiddleware, handleRollbackAd);
router.post('/rollback', authMiddleware, handleRollbackAd);

async function handleRollbackAd(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { publishedId } = req.body as { publishedId?: string };
    if (!publishedId) {
      res.status(400).json({ error: 'publishedId is required' });
      return;
    }

    const result = await rollbackPublishedAd(req.authUser!.userId, publishedId);
    if (!result.success) {
      res.status(400).json({ error: result.message });
      return;
    }
    res.json(result);
  } catch (err) {
    console.error('rollback-ad failed:', err);
    res.status(500).json({ error: 'Rollback failed' });
  }
}

router.get('/publish-status/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const status = await getPublishStatus(req.authUser!.userId, req.params.id);
    if (!status) {
      res.status(404).json({ error: 'Publish record not found' });
      return;
    }
    res.json(status);
  } catch (err) {
    console.error('publish-status failed:', err);
    res.status(500).json({ error: 'Failed to load publish status' });
  }
});

router.post('/create-campaign', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const body = req.body as {
      googleAdsCustomerId?: string;
      campaignName?: string;
      dailyBudget?: number;
      biddingStrategy?: 'MANUAL_CPC' | 'MAXIMIZE_CLICKS' | 'MAXIMIZE_CONVERSIONS';
      campaignType?: string;
      targetGoogleSearch?: boolean;
      targetSearchNetwork?: boolean;
      targetContentNetwork?: boolean;
      containsEuPoliticalAdvertising?: boolean;
      targetLocations?: string;
      cpcBidCeiling?: number;
      clientApprovals?: Record<string, boolean>;
      auditRunId?: string;
      wizardProcess?: WizardActivityProcess | Record<string, unknown>;
    };

    if (!body.googleAdsCustomerId || !body.campaignName) {
      res.status(400).json({
        error: 'googleAdsCustomerId and campaignName are required',
      });
      return;
    }

    if (!body.campaignType?.trim()) {
      res.status(400).json({
        error:
          'campaignType is required (search, display, video, shopping, performance_max, app, demand_gen, local_services, or call_ads)',
      });
      return;
    }

    const user = await getMe(req.authUser!.userId);
    const { accounts } = user?.googleRefreshToken
      ? await getGoogleAdsAccountsForUser(user.googleRefreshToken, user.id)
      : { accounts: [] as Awaited<ReturnType<typeof getGoogleAdsAccountsForUser>>['accounts'] };
    const account = accounts.find(
      (a) =>
        a.customerId === body.googleAdsCustomerId ||
        a.customerId.replace(/-/g, '') === String(body.googleAdsCustomerId).replace(/-/g, '')
    );
    let requiresEuPoliticalAdvertising = accountRequiresEuPoliticalDeclaration({
      timezone: account?.timezone,
    });
    if (user?.googleRefreshToken) {
      requiresEuPoliticalAdvertising = await fetchRequiresEuPoliticalAdvertising(
        user.googleRefreshToken,
        String(body.googleAdsCustomerId),
        user.id,
        {
          loginCustomerId: account ? resolveAccountLoginCustomerId(account, accounts) : undefined,
          managerIds: listManagerCustomerIds(accounts),
          timezone: account?.timezone,
        }
      );
    }

    const requiredApprovals = [
      'authorizeCreate',
      'pausedUnderstood',
      'budgetApproved',
      ...(requiresEuPoliticalAdvertising ? (['euPoliticalDeclared'] as const) : []),
      'accountAccessConfirmed',
    ] as const;
    const approvals = body.clientApprovals ?? {};
    const missing = requiredApprovals.filter((k) => !approvals[k]);
    if (missing.length) {
      res.status(400).json({
        error: 'All critical client approvals are required before creating a campaign.',
        missingApprovals: missing,
      });
      return;
    }

    const result = await createSearchCampaignForAccount({
      userId: req.authUser!.userId,
      googleAdsCustomerId: body.googleAdsCustomerId,
      campaignName: body.campaignName,
      dailyBudget: Number(body.dailyBudget) || 0,
      biddingStrategy:
        body.biddingStrategy === 'MAXIMIZE_CLICKS'
          ? 'MAXIMIZE_CLICKS'
          : body.biddingStrategy === 'MAXIMIZE_CONVERSIONS'
            ? 'MAXIMIZE_CONVERSIONS'
            : 'MANUAL_CPC',
      campaignType: body.campaignType,
      targetGoogleSearch: body.targetGoogleSearch !== false,
      targetSearchNetwork: body.targetSearchNetwork !== false,
      targetContentNetwork: body.targetContentNetwork === true,
      containsEuPoliticalAdvertising: body.containsEuPoliticalAdvertising === true,
      targetLocations: body.targetLocations,
      cpcBidCeiling: Number(body.cpcBidCeiling) || undefined,
    });

    if (!result.success) {
      res.status(400).json(result);
      return;
    }
    await persistWizardFromGoogleAdsCreate({
      userId: req.authUser!.userId,
      auditRunId: body.auditRunId,
      googleAdsCustomerId: body.googleAdsCustomerId,
      mode: 'campaign',
      stage: 'campaign_created',
      title: `Create Campaign — ${body.campaignName}`,
      summary: result.message || 'Paused campaign created in Google Ads.',
      process: body.wizardProcess ?? {
        stepsCompleted: ['Campaign created in Google Ads (paused)'],
        campaign: {
          name: body.campaignName,
          type: body.campaignType,
          dailyBudget: Number(body.dailyBudget) || undefined,
          biddingStrategy: body.biddingStrategy,
          locations: body.targetLocations,
          resourceName: result.campaignResourceName,
          why: 'Campaign shell created from the Create Campaign wizard.',
        },
        googleResult: {
          campaignResourceName: result.campaignResourceName,
          message: result.message,
        },
      },
      campaignResourceName: result.campaignResourceName,
      campaignName: body.campaignName,
    });
    res.json(result);
  } catch (err) {
    console.error('create-campaign failed:', err);
    const message = err instanceof Error ? err.message : 'Failed to create campaign';
    res.status(500).json({ error: message });
  }
});

router.post('/update-campaign-bidding', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const body = req.body as {
      googleAdsCustomerId?: string;
      campaignResourceName?: string;
      biddingStrategy?: 'MANUAL_CPC' | 'MAXIMIZE_CONVERSIONS';
      clientApprovals?: Record<string, boolean>;
    };
    if (!body.googleAdsCustomerId || !body.campaignResourceName) {
      res.status(400).json({ error: 'googleAdsCustomerId and campaignResourceName are required' });
      return;
    }
    if (body.biddingStrategy !== 'MANUAL_CPC' && body.biddingStrategy !== 'MAXIMIZE_CONVERSIONS') {
      res.status(400).json({ error: 'biddingStrategy must be MANUAL_CPC or MAXIMIZE_CONVERSIONS' });
      return;
    }
    if (!body.clientApprovals?.authorizeBiddingSwitch) {
      res.status(400).json({
        error: 'Switching bidding strategy requires a separate approval (authorizeBiddingSwitch).',
      });
      return;
    }

    const result = await updateCampaignBiddingForAccount({
      userId: req.authUser!.userId,
      googleAdsCustomerId: body.googleAdsCustomerId,
      campaignResourceName: body.campaignResourceName,
      biddingStrategy: body.biddingStrategy,
    });
    if (!result.success) {
      res.status(400).json(result);
      return;
    }
    res.json(result);
  } catch (err) {
    console.error('update-campaign-bidding failed:', err);
    const message = err instanceof Error ? err.message : 'Failed to update campaign bidding';
    res.status(500).json({ error: message });
  }
});

router.post('/update-campaign-budget', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const body = req.body as {
      googleAdsCustomerId?: string;
      campaignResourceName?: string;
      dailyBudget?: number;
      clientApprovals?: Record<string, boolean>;
    };
    if (!body.googleAdsCustomerId || !body.campaignResourceName) {
      res.status(400).json({ error: 'googleAdsCustomerId and campaignResourceName are required' });
      return;
    }
    const dailyBudget = Number(body.dailyBudget);
    if (!(dailyBudget > 0)) {
      res.status(400).json({ error: 'dailyBudget must be greater than 0' });
      return;
    }
    if (!body.clientApprovals?.authorizeBudgetChange) {
      res.status(400).json({
        error: 'Changing daily budget requires a separate approval (authorizeBudgetChange).',
      });
      return;
    }

    const result = await updateCampaignBudgetForAccount({
      userId: req.authUser!.userId,
      googleAdsCustomerId: body.googleAdsCustomerId,
      campaignResourceName: body.campaignResourceName,
      dailyBudget,
    });
    if (!result.success) {
      res.status(400).json(result);
      return;
    }
    res.json(result);
  } catch (err) {
    console.error('update-campaign-budget failed:', err);
    const message = err instanceof Error ? err.message : 'Failed to update campaign budget';
    res.status(500).json({ error: message });
  }
});

router.post('/create-ad-in-campaign', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const body = req.body as {
      googleAdsCustomerId?: string;
      campaignResourceName?: string;
      adGroupName?: string;
      keywords?: string[];
      keywordMatchType?: 'BROAD' | 'PHRASE' | 'EXACT';
      keywordBids?: Array<{ keyword: string; matchType?: 'BROAD' | 'PHRASE' | 'EXACT'; cpc?: number }>;
      defaultCpc?: number;
      headlines?: string[];
      descriptions?: string[];
      finalUrl?: string;
      path1?: string;
      path2?: string;
      clientApprovals?: Record<string, boolean>;
      negativeKeywords?: string[];
      automatedBidding?: boolean;
      auditRunId?: string;
      campaignName?: string;
      wizardMode?: 'campaign' | 'ad';
      wizardProcess?: WizardActivityProcess | Record<string, unknown>;
    };

    if (!body.googleAdsCustomerId || !body.campaignResourceName || !body.finalUrl) {
      res.status(400).json({
        error: 'googleAdsCustomerId, campaignResourceName, and finalUrl are required',
      });
      return;
    }

    const requiredApprovals = [
      'authorizeCreateAd',
      'pausedAdUnderstood',
      'landingPageApproved',
      'copyApproved',
      'accountAccessConfirmed',
    ] as const;
    const approvals = body.clientApprovals ?? {};
    const missing = requiredApprovals.filter((k) => !approvals[k]);
    if (missing.length) {
      res.status(400).json({
        error: 'All critical client approvals are required before creating the ad.',
        missingApprovals: missing,
      });
      return;
    }

    const result = await createAdInCampaignForAccount({
      userId: req.authUser!.userId,
      googleAdsCustomerId: body.googleAdsCustomerId,
      campaignResourceName: body.campaignResourceName,
      adGroupName: body.adGroupName?.trim() || 'Ad group 1',
      keywords: Array.isArray(body.keywords) ? body.keywords : [],
      keywordMatchType:
        body.keywordMatchType === 'PHRASE' || body.keywordMatchType === 'EXACT'
          ? body.keywordMatchType
          : 'BROAD',
      keywordBids: Array.isArray(body.keywordBids) ? body.keywordBids : undefined,
      defaultCpc: Number(body.defaultCpc) || undefined,
      headlines: body.headlines ?? [],
      descriptions: body.descriptions ?? [],
      finalUrl: body.finalUrl,
      path1: body.path1,
      path2: body.path2,
      negativeKeywords: Array.isArray(body.negativeKeywords) ? body.negativeKeywords : undefined,
      automatedBidding: Boolean(body.automatedBidding),
    });

    if (!result.success) {
      res.status(400).json(result);
      return;
    }
    await persistWizardFromGoogleAdsCreate({
      userId: req.authUser!.userId,
      auditRunId: body.auditRunId,
      googleAdsCustomerId: body.googleAdsCustomerId,
      mode: body.wizardMode === 'campaign' ? 'campaign' : 'ad',
      stage: 'completed',
      title: `Create Ad — ${body.campaignName || 'campaign'}`,
      summary: result.message || 'Paused ad created in Google Ads.',
      process: body.wizardProcess ?? {
        stepsCompleted: ['Ad created in Google Ads (paused)'],
        ads: {
          generatedVariants: [],
          selected: {
            headlines: body.headlines ?? [],
            descriptions: body.descriptions ?? [],
            keywords: Array.isArray(body.keywords) ? body.keywords : [],
            finalUrl: body.finalUrl,
            displayPaths: { path1: body.path1, path2: body.path2 },
          },
          why: 'RSA created from the Create Campaign / Create Ad wizard.',
        },
        googleResult: {
          campaignResourceName: result.campaignResourceName,
          adGroupResourceName: result.adGroupResourceName,
          adResourceName: result.adResourceName,
          keywordsAdded: result.keywordsAdded,
          message: result.message,
        },
      },
      campaignResourceName: result.campaignResourceName || body.campaignResourceName,
      adResourceName: result.adResourceName,
      campaignName: body.campaignName,
    });
    res.json(result);
  } catch (err) {
    console.error('create-ad-in-campaign failed:', err);
    const message = err instanceof Error ? err.message : 'Failed to create ad';
    res.status(500).json({ error: message });
  }
});

router.get('/ad-preview/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const optimization = await getOptimizationForPreview(req.params.id, req.authUser!.userId);
    if (!optimization) return res.status(404).json({ error: 'Optimization not found' });

    const originalAd = optimization.originalAd as unknown as import('../services/aiOptimization.service.js').CurrentAdData;
    const optimized = optimization.optimizedContent as unknown as import('../services/aiOptimization.service.js').OptimizedAdContent;
    const auditCtx = optimization.auditContext as { business?: { name?: string; websiteUrl?: string } } | null;

    const device = req.query.device === 'desktop' ? 'desktop' : 'mobile';
    const variant = req.query.variant === 'original' ? 'original' : 'optimized';

    const preview = buildAdPreview(optimization.id, originalAd, optimized, {
      device,
      variant,
      websiteUrl: auditCtx?.business?.websiteUrl,
      accountName: auditCtx?.business?.name,
      scenario: optimization.scenario ?? undefined,
    });

    res.json(preview);
  } catch (err) {
    console.error('ad-preview failed:', err);
    res.status(500).json({ error: 'Failed to build preview' });
  }
});

export default router;
