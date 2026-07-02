import { randomUUID } from 'crypto';
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

const jobs = new Map<string, OptimizeAdJob>();
const JOB_TTL_MS = 60 * 60 * 1000;

function pruneStaleJobs(): void {
  const cutoff = Date.now() - JOB_TTL_MS;
  for (const [id, job] of jobs) {
    if (job.updatedAt < cutoff) jobs.delete(id);
  }
}

export function createOptimizeAdJob(userId: string): OptimizeAdJob {
  pruneStaleJobs();
  const job: OptimizeAdJob = {
    id: randomUUID(),
    userId,
    status: 'processing',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  jobs.set(job.id, job);
  return job;
}

export function getOptimizeAdJob(jobId: string): OptimizeAdJob | undefined {
  return jobs.get(jobId);
}

export function completeOptimizeAdJob(jobId: string, result: OptimizeAdResult): void {
  const job = jobs.get(jobId);
  if (!job) return;
  job.status = 'completed';
  job.result = result;
  job.updatedAt = Date.now();
}

export function failOptimizeAdJob(jobId: string, error: string): void {
  const job = jobs.get(jobId);
  if (!job) return;
  job.status = 'failed';
  job.error = error;
  job.updatedAt = Date.now();
}

export type { OptimizeAdRequest };
