import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';
import { getMe } from '../services/audit.service.js';
import { getGoogleAdsAccountsForUser, isGoogleAdsConfigured } from '../services/google-ads.service.js';
import { getAccountAuditConfig } from '../services/account-audit-config.service.js';

const router = Router();

router.get('/accounts', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const user = getMe(req.authUser!.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const { accounts, source, reason, errorMessage } = await getGoogleAdsAccountsForUser(user.googleRefreshToken);
    res.json({
      accounts,
      source,
      reason,
      errorMessage,
      googleAdsConfigured: isGoogleAdsConfigured(),
      hasRefreshToken: !!user.googleRefreshToken,
    });
  } catch (err) {
    console.error('Failed to fetch Google Ads accounts:', err);
    res.status(500).json({ error: 'Failed to fetch accounts' });
  }
});

router.get('/accounts/:customerId/audit-config', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const user = getMe(req.authUser!.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const customerId = String(req.params.customerId);
    const { accounts } = await getGoogleAdsAccountsForUser(user.googleRefreshToken);
    const account = accounts.find(
      (a) => a.customerId === customerId || a.customerId.replace(/-/g, '') === customerId.replace(/-/g, '')
    );

    if (!account) {
      return res.status(404).json({ error: 'Account not found for this user' });
    }

    const config = await getAccountAuditConfig(customerId, user.googleRefreshToken, account);
    if (!config) {
      return res.status(502).json({ error: 'Could not load audit configuration for this account' });
    }

    res.json(config);
  } catch (err) {
    console.error('Failed to fetch audit config:', err);
    res.status(500).json({ error: 'Failed to fetch audit configuration' });
  }
});

router.get('/status', authMiddleware, (req: AuthRequest, res: Response) => {
  const user = getMe(req.authUser!.userId);
  res.json({
    googleAdsConfigured: isGoogleAdsConfigured(),
    hasRefreshToken: !!user?.googleRefreshToken,
    managerAccountId: process.env.GOOGLE_ADS_MANAGER_ACCOUNT_ID || null,
  });
});

export default router;
