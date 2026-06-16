import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

dotenv.config();
const prisma = new PrismaClient();

try {
  await prisma.$connect();
  const counts = {
    users: await prisma.user.count(),
    accounts: await prisma.account.count(),
    auditRuns: await prisma.auditRun.count(),
    findings: await prisma.finding.count(),
    aiOptimizations: await prisma.aIOptimization.count(),
  };
  console.log('PostgreSQL connected');
  console.log(JSON.stringify(counts, null, 2));
} catch (e) {
  console.error('PostgreSQL error:', e.message);
  process.exit(1);
} finally {
  await prisma.$disconnect();
}
