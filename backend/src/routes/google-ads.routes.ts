import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';
import { getMe } from '../services/audit.service.js';
import {
  getGoogleAdsAccountsForUser,
  fetchCampaignsForAccount,
  isGoogleAdsConfigured,
} from '../services/google-ads.service.js';
import { getMockCampaigns } from '../data/google-ads-campaigns.js';
import { env } from '../config/env.js';
import { getAccountAuditConfig } from '../services/account-audit-config.service.js';
import {
  publishOptimizedAd,
  rollbackPublishedAd,
  validatePublishContent,
} from '../services/googleAdsPublishing.service.js';
import { buildAdPreview } from '../services/adPreview.service.js';
import { getOptimizationForPreview } from '../services/aiOptimization.service.js';

const router = Router();

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
    if (source === 'mock' || env.useMockData) {
      campaigns = getMockCampaigns(customerId);
    } else if (!user.googleRefreshToken) {
      return res.status(401).json({ error: 'Google Ads not connected' });
    } else {
      campaigns = await fetchCampaignsForAccount(user.googleRefreshToken, customerId, user.id);
    }

    res.json({
      account: {
        customerId: account.customerId,
        name: account.name,
        websiteUrl: account.websiteUrl,
        industry: account.industry,
        currency: account.currency,
      },
      campaigns,
      source: source === 'mock' || env.useMockData ? 'mock' : 'google_ads_api',
      hasCampaigns: campaigns.length > 0,
      hasAds: campaigns.some((c) => c.adCount > 0),
    });
  } catch (err) {
    console.error('Failed to fetch campaigns:', err);
    res.status(500).json({ error: 'Failed to fetch campaigns' });
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

router.post('/publish-ad', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { optimizationId, googleAdsCustomerId, adGroupAdResourceName, content } = req.body as {
      optimizationId?: string;
      googleAdsCustomerId?: string;
      adGroupAdResourceName?: string;
      content?: {
        headlines: string[];
        descriptions: string[];
        longHeadlines?: string[];
        displayPaths?: { path1?: string; path2?: string };
        finalUrl?: string;
      };
    };

    if (!optimizationId || !googleAdsCustomerId || !content) {
      return res.status(400).json({
        error: 'optimizationId, googleAdsCustomerId, and content are required',
      });
    }

    const validationError = validatePublishContent(content);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    const result = await publishOptimizedAd({
      userId: req.authUser!.userId,
      optimizationId,
      googleAdsCustomerId,
      adGroupAdResourceName,
      content,
    });

    res.json(result);
  } catch (err) {
    console.error('publish-ad failed:', err);
    const message = err instanceof Error ? err.message : 'Failed to publish ad';
    if (message.includes('not found')) {
      return res.status(404).json({ error: message });
    }
    res.status(500).json({ error: message });
  }
});

router.post('/rollback-ad', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { publishedId } = req.body as { publishedId?: string };
    if (!publishedId) return res.status(400).json({ error: 'publishedId is required' });

    const result = await rollbackPublishedAd(req.authUser!.userId, publishedId);
    if (!result.success) return res.status(400).json({ error: result.message });
    res.json(result);
  } catch (err) {
    console.error('rollback-ad failed:', err);
    res.status(500).json({ error: 'Rollback failed' });
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
