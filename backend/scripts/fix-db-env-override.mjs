import dotenv from 'dotenv';
import { readFileSync } from 'fs';
import { PrismaClient } from '@prisma/client';

const fileLine = readFileSync('.env', 'utf8')
  .split(/\r?\n/)
  .find((l) => l.trimStart().startsWith('DATABASE_URL='));

console.log('--- env source debug ---');
console.log('Before dotenv, process.env.DATABASE_URL set:', !!process.env.DATABASE_URL);
if (process.env.DATABASE_URL) {
  const p = new URL(process.env.DATABASE_URL);
  console.log('  Pre-dotenv password length:', decodeURIComponent(p.password).length);
}

dotenv.config({ override: true });

console.log('After dotenv override, from file line password is root:', fileLine?.includes(':root@'));
const envUrl = process.env.DATABASE_URL;
if (envUrl) {
  const p = new URL(envUrl);
  console.log('  Final password length:', decodeURIComponent(p.password).length);
  console.log('  Final password is root:', decodeURIComponent(p.password) === 'root');
}

const ADMIN = 'postgresql://postgres:root@localhost:5432/postgres';
const admin = new PrismaClient({ datasources: { db: { url: ADMIN } } });
await admin.$connect();
const exists = await admin.$queryRaw`SELECT 1 FROM pg_database WHERE datname = 'adaudit_pro'`;
if (!Array.isArray(exists) || exists.length === 0) {
  await admin.$executeRawUnsafe('CREATE DATABASE adaudit_pro');
  console.log('✓ Created database adaudit_pro');
} else {
  console.log('✓ Database adaudit_pro exists');
}
await admin.$disconnect();

const app = new PrismaClient({ datasources: { db: { url: envUrl } } });
await app.$connect();
const who = await app.$queryRaw`SELECT current_user, current_database()`;
console.log('✓ App DATABASE_URL connects:', who[0]);
await app.$disconnect();
