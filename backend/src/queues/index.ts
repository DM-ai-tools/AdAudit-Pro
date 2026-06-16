import { createRequire } from 'module';
import { Queue } from 'bullmq';
import { env, isRedisConfigured } from '../config/env.js';

const require = createRequire(import.meta.url);

let connection: unknown = null;
const queueCache = new Map<string, Queue>();

function getConnection() {
  if (!isRedisConfigured()) return null;

  try {
    if (!connection) {
      const IORedis = require('ioredis');
      const RedisClass = IORedis.default || IORedis;
      const client = new RedisClass({
        host: env.redisHost,
        port: env.redisPort,
        password: env.redisPassword,
        maxRetriesPerRequest: null,
        lazyConnect: true,
        retryStrategy: () => null,
        enableOfflineQueue: false,
      });
      client.on('error', () => {
        /* handled by callers — avoid crashing on missing Redis */
      });
      connection = client;
    }
    return connection;
  } catch {
    return null;
  }
}

function getQueue(name: string): Queue | null {
  if (!isRedisConfigured()) return null;

  const cached = queueCache.get(name);
  if (cached) return cached;

  const conn = getConnection();
  if (!conn) return null;

  try {
    const queue = new Queue(name, {
      connection: conn as Queue['opts']['connection'],
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 100,
        removeOnFail: 50,
      },
    });
    queueCache.set(name, queue);
    return queue;
  } catch {
    return null;
  }
}

export async function addAuditJob(auditId: string) {
  const auditQueue = getQueue('auditQueue');
  if (auditQueue) {
    await auditQueue.add('process-audit', { auditId }, { jobId: auditId });
  }
}

export async function addReportJob(auditId: string) {
  const reportQueue = getQueue('reportQueue');
  if (reportQueue) {
    await reportQueue.add('generate-report', { auditId });
  }
}

export async function addNotificationJob(email: string, auditId: string) {
  const notificationQueue = getQueue('notificationQueue');
  if (notificationQueue) {
    await notificationQueue.add('audit-complete', { email, auditId });
  }
}

export { getConnection, getQueue, isRedisConfigured };
