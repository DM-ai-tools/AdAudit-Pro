import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.js';
import { getAuditReport } from '../services/audit.service.js';
import { suggestCampaignCopy } from '../services/suggest-campaign-copy.service.js';
import {
  completeOptimizeAdJob,
  createOptimizeAdJob,
  failOptimizeAdJob,
  getOptimizeAdJob,
  updateOptimizeAdJobProgress,
} from '../services/optimize-ad-jobs.service.js';

async function runSuggestJob(
  jobId: string,
  input: {
    auditId: string;
    userId: string;
    serviceFocus?: string;
    websiteUrl?: string;
    campaignType?: string;
    adBrief?: {
      service?: string;
      adType?: string;
      campaignType?: string;
      offer?: string;
      audience?: string;
      tone?: string;
      ctaPreference?: string;
      mustInclude?: string;
      finalUrl?: string;
      locationFocus?: string;
    };
  }
): Promise<void> {
  try {
    await updateOptimizeAdJobProgress(jobId, {
      progress: 5,
      stage: 'Starting campaign copy generation…',
    });
    const result = await suggestCampaignCopy({
      ...input,
      onProgress: async (update) => {
        await updateOptimizeAdJobProgress(jobId, update);
      },
    });
    await completeOptimizeAdJob(jobId, result as unknown as import('../services/aiOptimization.service.js').OptimizeAdResult);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to generate campaign copy';
    console.error(`suggest-campaign-copy job ${jobId} failed:`, err);
    await failOptimizeAdJob(jobId, message);
  }
}

export async function handleSuggestCampaignCopyStatus(req: AuthRequest, res: Response): Promise<void> {
  const job = await getOptimizeAdJob(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: 'Suggestion job not found or expired. Try again.' });
    return;
  }
  const userId = req.authUser?.userId ?? (req.query.userId as string | undefined);
  if (!userId || job.userId !== userId) {
    res.status(403).json({ error: 'Not authorized to view this job.' });
    return;
  }
  if (job.status === 'completed' && job.result) {
    res.json({ status: 'completed', result: job.result });
    return;
  }
  if (job.status === 'failed') {
    res.status(500).json({ status: 'failed', error: job.error ?? 'Suggestion failed' });
    return;
  }
  res.json({
    status: 'processing',
    progress: job.partial?.progress ?? 0,
    stage: job.partial?.stage ?? 'Working…',
  });
}

export async function handleSuggestCampaignCopy(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { auditId, serviceFocus, websiteUrl, campaignType, adBrief } = req.body as {
      auditId?: string;
      serviceFocus?: string;
      websiteUrl?: string;
      campaignType?: string;
      adBrief?: {
        service?: string;
        adType?: string;
        campaignType?: string;
        offer?: string;
        audience?: string;
        tone?: string;
        ctaPreference?: string;
        mustInclude?: string;
        finalUrl?: string;
        locationFocus?: string;
      };
    };
    if (!auditId) {
      res.status(400).json({ error: 'auditId is required' });
      return;
    }

    const audit = await getAuditReport(auditId);
    const userId = req.authUser?.userId ?? audit?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Sign in to generate campaign copy suggestions.' });
      return;
    }

    const job = await createOptimizeAdJob(userId);
    void runSuggestJob(job.id, {
      auditId,
      userId,
      serviceFocus: serviceFocus || adBrief?.service,
      websiteUrl: websiteUrl || audit?.websiteUrl,
      campaignType: campaignType || adBrief?.campaignType,
      adBrief: {
        ...adBrief,
        campaignType: adBrief?.campaignType || campaignType,
      },
    });
    res.status(202).json({
      jobId: job.id,
      status: 'processing',
      message: 'Campaign copy generation started.',
    });
  } catch (err) {
    console.error('suggest-campaign-copy failed:', err);
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to start campaign copy generation',
    });
  }
}
