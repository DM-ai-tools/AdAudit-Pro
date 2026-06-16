import { Worker } from 'bullmq';
import { env } from '../config/env.js';
import { getConnection, isRedisConfigured } from '../queues/index.js';
import { getAuditStatus } from '../services/audit.service.js';

export function startWorkers() {
  if (env.useMockData) {
    console.log('⚠ Mock mode — skipping BullMQ workers');
    return;
  }

  if (!isRedisConfigured()) {
    console.log('⚠ Redis not configured — using in-memory audit simulation');
    return;
  }

  const connection = getConnection();
  if (!connection) {
    console.log('⚠ Redis not available — using in-memory audit simulation');
    return;
  }

  try {
    new Worker(
      'auditQueue',
      async (job) => {
        const { auditId } = job.data;
        await job.updateProgress(10);
        const audit = await getAuditStatus(auditId);
        if (!audit) throw new Error('Audit not found');
        await job.updateProgress(100);
        return { auditId, status: audit.status };
      },
      { connection, concurrency: 3 }
    );

    new Worker(
      'reportQueue',
      async (job) => {
        const { auditId } = job.data;
        await job.updateProgress(50);
        return { auditId, generated: true };
      },
      { connection, concurrency: 2 }
    );

    new Worker(
      'notificationQueue',
      async (job) => {
        const { email, auditId } = job.data;
        console.log(`📧 Notification queued for ${email} — audit ${auditId}`);
        return { sent: true };
      },
      { connection, concurrency: 5 }
    );

    console.log('✓ BullMQ workers started');
  } catch {
    console.log('⚠ BullMQ workers failed to start — using in-memory simulation');
  }
}
