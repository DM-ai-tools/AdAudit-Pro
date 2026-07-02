#!/usr/bin/env node
/**
 * Production entrypoint: apply Prisma schema to PostgreSQL, then start the API.
 * Railway Postgres starts empty — without db push the app crashes on prisma.user.count().
 */
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

async function main() {
  if (process.env.DATABASE_URL) {
    console.log('→ Syncing PostgreSQL schema (prisma db push)...');
    try {
      execSync('npx prisma db push --skip-generate', {
        cwd: root,
        stdio: 'inherit',
        env: process.env,
      });
      console.log('✓ Database schema up to date');
    } catch {
      console.error('✗ Failed to sync database schema');
      process.exit(1);
    }
  } else if (process.env.NODE_ENV === 'production') {
    console.error('✗ DATABASE_URL is required in production');
    process.exit(1);
  } else {
    console.warn('⚠ DATABASE_URL not set — skipping schema sync');
  }

  await import('../dist/index.js');
}

main().catch((err) => {
  console.error('Failed to start:', err);
  process.exit(1);
});
