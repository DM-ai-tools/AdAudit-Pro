import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import { readFileSync } from 'fs';

dotenv.config();

async function test(label, url) {
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    await prisma.$connect();
    const rows = await prisma.$queryRaw`SELECT current_user AS u, current_database() AS db`;
    console.log(`${label}: OK`, rows[0]);
    return true;
  } catch (e) {
    const msg = e instanceof Error ? e.message.split('\n')[0] : String(e);
    console.log(`${label}: FAIL — ${msg}`);
    return false;
  } finally {
    await prisma.$disconnect();
  }
}

const line = readFileSync('.env', 'utf8')
  .split(/\r?\n/)
  .find((l) => l.trimStart().startsWith('DATABASE_URL'));

const envUrl = process.env.DATABASE_URL;
const parsed = envUrl ? new URL(envUrl) : null;

console.log('--- .env analysis (no secrets printed) ---');
console.log('DATABASE_URL line found:', !!line);
console.log('Has trailing whitespace on line:', line ? /\s$/.test(line) : false);
if (parsed) {
  const pwd = decodeURIComponent(parsed.password);
  console.log('Loaded user:', parsed.username);
  console.log('Loaded host:', parsed.hostname);
  console.log('Loaded port:', parsed.port || '5432');
  console.log('Loaded database:', parsed.pathname.slice(1));
  console.log('Loaded password length:', pwd.length);
  console.log('Loaded password matches "root":', pwd === 'root');
  if (pwd !== 'root') {
    console.log('MISMATCH: .env password is NOT "root" — update backend/.env');
  }
}

console.log('\n--- connection tests ---');
const results = await Promise.all([
  test('1) .env DATABASE_URL', envUrl),
  test('2) explicit postgres:root@localhost/adaudit_pro', 'postgresql://postgres:root@localhost:5432/adaudit_pro'),
  test('3) explicit postgres:root@127.0.0.1/adaudit_pro', 'postgresql://postgres:root@127.0.0.1:5432/adaudit_pro'),
  test('4) explicit postgres:root@localhost/postgres', 'postgresql://postgres:root@localhost:5432/postgres'),
]);

if (!results.some(Boolean)) {
  console.log('\nAll tests failed. pgAdmin may use a different user/host/port than postgres@localhost:5432');
  process.exit(1);
}
