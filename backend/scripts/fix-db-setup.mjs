import { readFileSync, writeFileSync } from 'fs';
import { PrismaClient } from '@prisma/client';

const CORRECT_URL = 'postgresql://postgres:root@localhost:5432/adaudit_pro';
const ADMIN_URL = 'postgresql://postgres:root@localhost:5432/postgres';

// Fix DATABASE_URL in .env
const envPath = '.env';
let envContent = readFileSync(envPath, 'utf8');
if (/^DATABASE_URL=/m.test(envContent)) {
  envContent = envContent.replace(/^DATABASE_URL=.*/m, `DATABASE_URL=${CORRECT_URL}`);
} else {
  envContent += `\nDATABASE_URL=${CORRECT_URL}\n`;
}
writeFileSync(envPath, envContent);
console.log('✓ Updated DATABASE_URL in backend/.env (postgres:root@localhost/adaudit_pro)');

// Create database if missing
const admin = new PrismaClient({ datasources: { db: { url: ADMIN_URL } } });
try {
  await admin.$connect();
  const exists = await admin.$queryRaw`
    SELECT 1 FROM pg_database WHERE datname = 'adaudit_pro'
  `;
  if (Array.isArray(exists) && exists.length === 0) {
    await admin.$executeRawUnsafe('CREATE DATABASE adaudit_pro');
    console.log('✓ Created database adaudit_pro');
  } else {
    console.log('✓ Database adaudit_pro already exists');
  }
} finally {
  await admin.$disconnect();
}

console.log('Done. Run: npm run db:push && npm run db:check');
