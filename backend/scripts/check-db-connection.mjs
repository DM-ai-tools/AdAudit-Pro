import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

dotenv.config();

async function tryConnect(label, databaseUrl) {
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  try {
    await prisma.$connect();
    await prisma.$queryRaw`SELECT 1 AS ok`;
    console.log(`${label}: connected successfully`);
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message.split('\n')[0] : String(err);
    console.log(`${label}: ${msg}`);
    return false;
  } finally {
    await prisma.$disconnect();
  }
}

const base = process.env.DATABASE_URL;
if (!base) {
  console.log('DATABASE_URL is not set in backend/.env');
  process.exit(1);
}

const parsed = new URL(base);
const alt = new URL(base);
alt.hostname = alt.hostname === 'localhost' ? '127.0.0.1' : 'localhost';

console.log('Testing PostgreSQL credentials...\n');
const ok = (await tryConnect('localhost', base)) || (await tryConnect('127.0.0.1', alt.toString()));

if (!ok) {
  console.log('\nAuthentication still failing. Verify in pgAdmin/psql:');
  console.log(`  User: ${parsed.username}`);
  console.log(`  Database: ${parsed.pathname.replace(/^\//, '')}`);
  console.log('  Password must match exactly (URL-encode special chars if any).');
  process.exit(1);
}
