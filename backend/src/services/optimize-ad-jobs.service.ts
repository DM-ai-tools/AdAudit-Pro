import { randomUUID } from 'crypto';
import { prisma } from '../lib/prisma.js';
import type { OptimizeAdRequest, OptimizeAdResult } from './aiOptimization.service.js';

export type OptimizeAdJobStatus = 'processing' | 'completed' | 'failed';

export interface OptimizeAdJobPartial {
  progress: number;
  stage: string;
  originalAd?: OptimizeAdResult['originalAd'];
  competitorAnalysis?: OptimizeAdResult['competitorAnalysis'];
  optimized?: OptimizeAdResult['optimized'];
  optimizedVariations?: OptimizeAdResult['optimizedVariations'];
  intelligenceSummary?: OptimizeAdResult['intelligenceSummary'];
  analysisSources?: OptimizeAdResult['analysisSources'];
  campaignPerformance?: OptimizeAdResult['campaignPerformance'];
  auditHealthScore?: OptimizeAdResult['auditHealthScore'];
  scenario?: OptimizeAdResult['scenario'];
  dataSource?: OptimizeAdResult['dataSource'];
  finding?: OptimizeAdResult['finding'];
}

export interface OptimizeAdJob {
  id: string;
  userId: string;
  status: OptimizeAdJobStatus;
  result?: OptimizeAdResult;
  partial?: OptimizeAdJobPartial;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

/** In-memory cache for fast same-instance reads; Postgres is source of truth on Railway. */
const memoryJobs = new Map<string, OptimizeAdJob>();
const JOB_TTL_MS = 60 * 60 * 1000;

function toMemoryJob(row: {
  id: string;
  userId: string;
  status: string;
  result: unknown;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
}): OptimizeAdJob {
  const result = row.result as OptimizeAdResult | (OptimizeAdJobPartial & { __partial?: boolean }) | null;
  const isPartial =
    result != null &&
    typeof result === 'object' &&
    '__partial' in (result as object) &&
    (result as { __partial?: boolean }).__partial === true;

  return {
    id: row.id,
    userId: row.userId,
    status: row.status as OptimizeAdJobStatus,
    result: !isPartial ? ((result as OptimizeAdResult | null) ?? undefined) : undefined,
    partial: isPartial
      ? {
          progress: Number((result as OptimizeAdJobPartial).progress) || 0,
          stage: String((result as OptimizeAdJobPartial).stage || 'Working…'),
          originalAd: (result as OptimizeAdJobPartial).originalAd,
          competitorAnalysis: (result as OptimizeAdJobPartial).competitorAnalysis,
          optimized: (result as OptimizeAdJobPartial).optimized,
          optimizedVariations: (result as OptimizeAdJobPartial).optimizedVariations,
          intelligenceSummary: (result as OptimizeAdJobPartial).intelligenceSummary,
          analysisSources: (result as OptimizeAdJobPartial).analysisSources,
          campaignPerformance: (result as OptimizeAdJobPartial).campaignPerformance,
          auditHealthScore: (result as OptimizeAdJobPartial).auditHealthScore,
          scenario: (result as OptimizeAdJobPartial).scenario,
          dataSource: (result as OptimizeAdJobPartial).dataSource,
          finding: (result as OptimizeAdJobPartial).finding,
        }
      : undefined,
    error: row.error ?? undefined,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  };
}

function pruneStaleMemoryJobs(): void {
  const cutoff = Date.now() - JOB_TTL_MS;
  for (const [id, job] of memoryJobs) {
    if (job.updatedAt < cutoff) memoryJobs.delete(id);
  }
}

export async function createOptimizeAdJob(userId: string): Promise<OptimizeAdJob> {
  pruneStaleMemoryJobs();
  const id = randomUUID();
  const now = new Date();

  try {
    const row = await prisma.optimizeAdJob.create({
      data: {
        id,
        userId,
        status: 'processing',
        createdAt: now,
        updatedAt: now,
      },
    });
    const job = toMemoryJob(row);
    memoryJobs.set(job.id, job);
    return job;
  } catch (err) {
    console.warn(
      '[optimize-ad-jobs] DB create failed — using memory only:',
      err instanceof Error ? err.message : err
    );
    const job: OptimizeAdJob = {
      id,
      userId,
      status: 'processing',
      createdAt: now.getTime(),
      updatedAt: now.getTime(),
    };
    memoryJobs.set(job.id, job);
    return job;
  }
}

export async function getOptimizeAdJob(jobId: string): Promise<OptimizeAdJob | undefined> {
  const cached = memoryJobs.get(jobId);
  // Prefer memory while processing so live partials show immediately on same instance
  if (cached && (cached.status === 'processing' || cached.partial || cached.result)) {
    return cached;
  }

  try {
    const row = await prisma.optimizeAdJob.findUnique({ where: { id: jobId } });
    if (!row) return cached;
    const job = toMemoryJob(row);
    if (cached?.partial && job.status === 'processing') {
      job.partial = {
        ...job.partial,
        ...cached.partial,
        progress: Math.max(job.partial?.progress ?? 0, cached.partial.progress),
        stage: cached.partial.stage || job.partial?.stage || 'Working…',
      };
    }
    memoryJobs.set(job.id, job);
    return job;
  } catch (err) {
    console.warn(
      '[optimize-ad-jobs] DB read failed:',
      err instanceof Error ? err.message : err
    );
    return memoryJobs.get(jobId);
  }
}

export async function updateOptimizeAdJobProgress(
  jobId: string,
  update: OptimizeAdJobPartial
): Promise<void> {
  const existing = memoryJobs.get(jobId);
  const nextPartial: OptimizeAdJobPartial = {
    ...(existing?.partial ?? { progress: 0, stage: 'Starting…' }),
    ...update,
    progress: Math.max(0, Math.min(100, Math.round(update.progress))),
    stage: update.stage,
  };

  if (existing) {
    existing.status = 'processing';
    existing.partial = nextPartial;
    existing.updatedAt = Date.now();
  } else {
    memoryJobs.set(jobId, {
      id: jobId,
      userId: '',
      status: 'processing',
      partial: nextPartial,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  }

  try {
    await prisma.optimizeAdJob.update({
      where: { id: jobId },
      data: {
        status: 'processing',
        result: { __partial: true, ...nextPartial } as object,
        updatedAt: new Date(),
      },
    });
  } catch {
    // Memory progress is enough for same-process polling
  }
}

export async function completeOptimizeAdJob(jobId: string, result: OptimizeAdResult): Promise<void> {
  const existing = memoryJobs.get(jobId);
  if (existing) {
    existing.status = 'completed';
    existing.result = result;
    existing.partial = undefined;
    existing.updatedAt = Date.now();
  } else {
    memoryJobs.set(jobId, {
      id: jobId,
      userId: '',
      status: 'completed',
      result,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  }

  try {
    await prisma.optimizeAdJob.update({
      where: { id: jobId },
      data: {
        status: 'completed',
        result: result as object,
        error: null,
        updatedAt: new Date(),
      },
    });
  } catch (err) {
    console.warn(
      '[optimize-ad-jobs] DB complete skipped (memory job is updated):',
      err instanceof Error ? err.message.split('\n')[0] : err
    );
  }
}

export async function failOptimizeAdJob(jobId: string, error: string): Promise<void> {
  const existing = memoryJobs.get(jobId);
  if (existing) {
    existing.status = 'failed';
    existing.error = error;
    existing.updatedAt = Date.now();
  }

  try {
    await prisma.optimizeAdJob.update({
      where: { id: jobId },
      data: {
        status: 'failed',
        error,
        updatedAt: new Date(),
      },
    });
  } catch (err) {
    if (!existing) {
      console.warn(
        '[optimize-ad-jobs] DB fail update failed:',
        err instanceof Error ? err.message : err
      );
    }
  }
}

export type { OptimizeAdRequest };
