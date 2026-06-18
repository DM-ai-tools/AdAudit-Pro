import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.js';
import {
  optimizeAd,
  type OptimizationTone,
} from '../services/aiOptimization.service.js';
import { getAuditReport } from '../services/audit.service.js';
import type { Finding } from '../types/index.js';

const VALID_TONES: OptimizationTone[] = [
  'default',
  'professional',
  'luxury',
  'high-conversion',
  'aggressive',
  'shorter',
];

export async function handleOptimizeAd(req: AuthRequest, res: Response): Promise<void> {
  try {
    const {
      auditId,
      findingId,
      tone,
      variation,
      customPrompt,
      findingSnapshot,
      auditFindingsSnapshot,
      accountContext,
    } = req.body as {
      auditId?: string;
      findingId?: string;
      tone?: OptimizationTone;
      variation?: 'regenerate' | 'shorter' | 'more-variations' | 'aggressive-cta';
      customPrompt?: string;
      findingSnapshot?: Finding;
      auditFindingsSnapshot?: Finding[];
      accountContext?: {
        accountName?: string;
        goal?: string;
        monthlySpend?: number;
        googleAdsCustomerId?: string;
        websiteUrl?: string;
        userId?: string;
        campaignId?: string;
      };
    };

    if (!auditId || !findingId) {
      res.status(400).json({ error: 'auditId and findingId are required' });
      return;
    }

    if (tone && !VALID_TONES.includes(tone)) {
      res.status(400).json({ error: 'Invalid tone' });
      return;
    }

    const audit = await getAuditReport(auditId);
    const userId = req.authUser?.userId ?? audit?.userId ?? accountContext?.userId;

    if (!userId) {
      res.status(401).json({
        error: 'Sign in to use AI optimization. Your Google account is needed to publish ads.',
      });
      return;
    }

    const result = await optimizeAd({
      userId,
      auditId,
      findingId,
      tone,
      variation,
      customPrompt,
      findingSnapshot,
      auditFindingsSnapshot,
      accountContext,
    });

    res.json(result);
  } catch (err) {
    console.error('optimize-ad failed:', err);
    const message = err instanceof Error ? err.message : 'Failed to optimize ad';
    if (message.includes('not found') || message.includes('Not found')) {
      res.status(404).json({ error: message });
      return;
    }
    if (message.includes('JSON') || message.includes('parse')) {
      res.status(502).json({ error: 'AI returned an invalid response. Click Try Again.' });
      return;
    }
    if (message.includes('Anthropic') || message.includes('API keys')) {
      res.status(503).json({ error: 'AI service unavailable. Configure ANTHROPIC_API_KEY in backend/.env.' });
      return;
    }
    if (message.includes('Foreign key') || message.includes('User')) {
      res.status(400).json({ error: 'User session invalid. Sign out and sign in again.' });
      return;
    }
    res.status(500).json({ error: message });
  }
}
