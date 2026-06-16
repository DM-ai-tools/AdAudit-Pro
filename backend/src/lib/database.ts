import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { env } from '../config/env.js';
import { prisma } from './prisma.js';
import type { User } from '../types/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const USERS_JSON = join(__dirname, '../../.data/users.json');

export async function connectDatabase(): Promise<void> {
  if (!env.databaseUrl) {
    throw new Error(
      'DATABASE_URL is not set. Start PostgreSQL (docker compose --profile full up postgres -d) and add DATABASE_URL to backend/.env'
    );
  }

  await prisma.$connect();
  const count = await prisma.user.count();
  console.log(`✓ PostgreSQL connected (${count} user(s) in database)`);
}

/** One-time import from legacy users.json when PostgreSQL is empty. */
export async function importLegacyUsersIfEmpty(): Promise<void> {
  const count = await prisma.user.count();
  if (count > 0 || !existsSync(USERS_JSON)) return;

  try {
    const raw = readFileSync(USERS_JSON, 'utf-8');
    const parsed = JSON.parse(raw) as { users?: User[] };
    const legacyUsers = Array.isArray(parsed.users) ? parsed.users : [];
    if (legacyUsers.length === 0) return;

    for (const u of legacyUsers) {
      await prisma.user.upsert({
        where: { email: u.email.trim().toLowerCase() },
        create: {
          id: u.id,
          email: u.email.trim().toLowerCase(),
          name: u.name,
          avatarUrl: u.avatarUrl,
          googleId: u.googleId,
          googleRefreshToken: u.googleRefreshToken,
          googleAccessToken: u.googleAccessToken,
          googleTokenExpiry: u.googleTokenExpiry ? new Date(u.googleTokenExpiry) : undefined,
          createdAt: u.createdAt ? new Date(u.createdAt) : undefined,
        },
        update: {
          name: u.name,
          avatarUrl: u.avatarUrl,
          googleId: u.googleId,
          googleRefreshToken: u.googleRefreshToken,
          googleAccessToken: u.googleAccessToken,
          googleTokenExpiry: u.googleTokenExpiry ? new Date(u.googleTokenExpiry) : undefined,
        },
      });
    }
    console.log(`✓ Imported ${legacyUsers.length} user(s) from users.json into PostgreSQL`);
  } catch (err) {
    console.warn('Could not import legacy users.json:', err);
  }
}

export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
}
