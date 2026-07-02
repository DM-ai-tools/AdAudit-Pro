import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.js';
import { env } from '../config/env.js';
import {
  optimizeAd,
  type OptimizationTone,
  type OptimizeAdRequest,
} from '../services/aiOptimization.service.js';
import {
  completeOptimizeAdJob,
  createOptimizeAdJob,
  failOptimizeAdJob,
  getOptimizeAdJob,
} from '../services/optimize-ad-jobs.service.js';
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

function mapOptimizeAdError(err: unknown): { status: number; message: string } {
  const message = err instanceof Error ? err.message : 'Failed to optimize ad';
  if (message.includes('not found') || message.includes('Not found')) {
    return { status: 404, message };
  }
  if (message.includes('JSON') || message.includes('parse')) {
    return { status: 502, message: 'AI returned an invalid response. Click Try Again.' };
  }
  if (message.includes('Anthropic') || message.includes('API keys')) {
    return {
      status: 503,
      message: 'AI service unavailable. Configure ANTHROPIC_API_KEY in backend/.env.',
    };
  }
  if (message.includes('Foreign key') || message.includes('User')) {
    return { status: 400, message: 'User session invalid. Sign out and sign in again.' };
  }
  return { status: 500, message };
}

function buildOptimizeAdRequest(
  req: AuthRequest,
  userId: string
): OptimizeAdRequest | { error: string; status: number } {
  const {
    auditId,
    findingId,
    tone,
    variation,
    customPrompt,
    regenerateOnly,
    findingSnapshot,
    auditFindingsSnapshot,
    accountContext,
  } = req.body as {
    auditId?: string;
    findingId?: string;
    tone?: OptimizationTone;
    variation?: 'regenerate' | 'shorter' | 'more-variations' | 'aggressive-cta';
    customPrompt?: string;
    regenerateOnly?: boolean;
    findingSnapshot?: Finding;
    auditFindingsSnapshot?: Finding[];
    accountContext?: OptimizeAdRequest['accountContext'];
  };

  if (!auditId || !findingId) {
    return { error: 'auditId and findingId are required', status: 400 };
  }

  if (tone && !VALID_TONES.includes(tone)) {
    return { error: 'Invalid tone', status: 400 };
  }

  return {
    userId,
    auditId,
    findingId,
    tone,
    variation,
    customPrompt,
    regenerateOnly,
    findingSnapshot,
    auditFindingsSnapshot,
    accountContext,
  };
}

function shouldRunAsync(req: AuthRequest): boolean {
  if (req.query.async === '1' || req.query.async === 'true') return true;
  if (req.body?.async === true) return true;
  return env.isProduction;
}

async function runOptimizeAdJob(jobId: string, request: OptimizeAdRequest): Promise<void> {
  try {
    const result = await optimizeAd(request);
    completeOptimizeAdJob(jobId, result);
  } catch (err) {
    const { message } = mapOptimizeAdError(err);
    console.error(`optimize-ad job ${jobId} failed:`, err);
    failOptimizeAdJob(jobId, message);
  }
}

export async function handleOptimizeAdStatus(req: AuthRequest, res: Response): Promise<void> {
  const job = getOptimizeAdJob(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: 'Optimization job not found or expired. Try again.' });
    return;
  }

  const userId = req.authUser?.userId ?? (req.query.userId as string | undefined);
  if (!userId || job.userId !== userId) {
    res.status(403).json({ error: 'Not authorized to view this optimization job.' });
    return;
  }

  if (job.status === 'completed' && job.result) {
    res.json({ status: 'completed', result: job.result });
    return;
  }

  if (job.status === 'failed') {
    res.status(500).json({ status: 'failed', error: job.error ?? 'Optimization failed' });
    return;
  }

  res.json({ status: 'processing' });
}

export async function handleOptimizeAd(req: AuthRequest, res: Response): Promise<void> {
  try {
    const {
      auditId,
      findingId,
    } = req.body as { auditId?: string; findingId?: string };

    if (!auditId || !findingId) {
      res.status(400).json({ error: 'auditId and findingId are required' });
      return;
    }

    const audit = await getAuditReport(auditId);
    const userId = req.authUser?.userId ?? audit?.userId ?? req.body?.accountContext?.userId;

    if (!userId) {
      res.status(401).json({
        error: 'Sign in to use AI optimization. Your Google account is needed to publish ads.',
      });
      return;
    }

    const built = buildOptimizeAdRequest(req, userId);
    if ('error' in built) {
      res.status(built.status).json({ error: built.error });
      return;
    }

    if (shouldRunAsync(req)) {
      const job = createOptimizeAdJob(userId);
      void runOptimizeAdJob(job.id, built);
      res.status(202).json({
        jobId: job.id,
        status: 'processing',
        message: 'Optimization started. Poll status until complete.',
      });
      return;
    }

    const result = await optimizeAd(built);
    res.json(result);
  } catch (err) {
    console.error('optimize-ad failed:', err);
    const { status, message } = mapOptimizeAdError(err);
    res.status(status).json({ error: message });
  }
}
