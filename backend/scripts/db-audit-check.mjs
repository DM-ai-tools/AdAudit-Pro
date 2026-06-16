import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

dotenv.config();

const prisma = new PrismaClient();

async function main() {
  try {
    await prisma.$connect();
    await prisma.$queryRaw`SELECT 1 AS ok`;

    const counts = {
      users: await prisma.user.count(),
      accounts: await prisma.account.count(),
      auditRuns: await prisma.auditRun.count(),
      findings: await prisma.finding.count(),
      healthScores: await prisma.healthScore.count(),
      auditLogs: await prisma.auditLog.count(),
      sharedReports: await prisma.sharedReport.count(),
      aiOptimizations: await prisma.aIOptimization.count(),
      publishedAdVersions: await prisma.publishedAdVersion.count(),
    };

    const recentUsers = await prisma.user.findMany({
      select: { email: true, name: true, googleRefreshToken: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });

    console.log(JSON.stringify({ connected: true, databaseUrl: maskUrl(process.env.DATABASE_URL), counts, recentUsers: recentUsers.map(u => ({ ...u, hasGoogleToken: !!u.googleRefreshToken, googleRefreshToken: undefined })) }, null, 2));
  } catch (err) {
    console.log(JSON.stringify({ connected: false, error: err instanceof Error ? err.message : String(err) }, null, 2));
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

function maskUrl(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.password) u.password = '****';
    return u.toString();
  } catch {
    return '(invalid url)';
  }
}

main();
