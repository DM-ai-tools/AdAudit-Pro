import { createRequire } from 'module';
import { Queue } from 'bullmq';
import { env } from '../config/env.js';

const require = createRequire(import.meta.url);

let connection: unknown = null;

function getConnection() {
  try {
    if (!connection) {
      const IORedis = require('ioredis');
      const RedisClass = IORedis.default || IORedis;
      connection = new RedisClass({
        host: env.redisHost,
        port: env.redisPort,
        password: env.redisPassword,
        maxRetriesPerRequest: null,
        lazyConnect: true,
        retryStrategy: () => null,
      });
    }
    return connection;
  } catch {
    return null;
  }
}

export const auditQueue = createQueue('auditQueue');
export const reportQueue = createQueue('reportQueue');
export const healthQueue = createQueue('healthQueue');
export const notificationQueue = createQueue('notificationQueue');

function createQueue(name: string): Queue | null {
  const conn = getConnection();
  if (!conn) return null;
  try {
    return new Queue(name, {
      connection: conn as Queue['opts']['connection'],
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 100,
        removeOnFail: 50,
      },
    });
  } catch {
    return null;
  }
}

export async function addAuditJob(auditId: string) {
  if (auditQueue) {
    await auditQueue.add('process-audit', { auditId }, { jobId: auditId });
  }
}

export async function addReportJob(auditId: string) {
  if (reportQueue) {
    await reportQueue.add('generate-report', { auditId });
  }
}

export async function addNotificationJob(email: string, auditId: string) {
  if (notificationQueue) {
    await notificationQueue.add('audit-complete', { email, auditId });
  }
}

export { getConnection };
