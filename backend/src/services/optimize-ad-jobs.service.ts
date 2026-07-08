import { randomUUID } from 'crypto';
import { prisma } from '../lib/prisma.js';
import type { OptimizeAdRequest, OptimizeAdResult } from './aiOptimization.service.js';

export type OptimizeAdJobStatus = 'processing' | 'completed' | 'failed';

export interface OptimizeAdJob {
  id: string;
  userId: string;
  status: OptimizeAdJobStatus;
  result?: OptimizeAdResult;
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
  return {
    id: row.id,
    userId: row.userId,
    status: row.status as OptimizeAdJobStatus,
    result: (row.result as OptimizeAdResult | null) ?? undefined,
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
  if (cached) return cached;

  try {
    const row = await prisma.optimizeAdJob.findUnique({ where: { id: jobId } });
    if (!row) return undefined;
    const job = toMemoryJob(row);
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

export async function completeOptimizeAdJob(jobId: string, result: OptimizeAdResult): Promise<void> {
  const existing = memoryJobs.get(jobId);
  if (existing) {
    existing.status = 'completed';
    existing.result = result;
    existing.updatedAt = Date.now();
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
    if (!existing) {
      console.warn(
        '[optimize-ad-jobs] DB complete failed:',
        err instanceof Error ? err.message : err
      );
    }
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
