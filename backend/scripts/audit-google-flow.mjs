/**
 * Full audit checklist for Google OAuth + PostgreSQL user flow.
 */
import dotenv from 'dotenv';
import { readFileSync } from 'fs';
import { PrismaClient } from '@prisma/client';

dotenv.config({ override: true });

const API = 'http://localhost:5000/api';
const prisma = new PrismaClient();

const checks = [];

function pass(name, detail = '') {
  checks.push({ name, ok: true, detail });
  console.log(`✓ ${name}${detail ? ` — ${detail}` : ''}`);
}
function fail(name, detail = '') {
  checks.push({ name, ok: false, detail });
  console.log(`✗ ${name}${detail ? ` — ${detail}` : ''}`);
}

console.log('=== Google OAuth + PostgreSQL audit ===\n');

// 1. PostgreSQL
try {
  await prisma.$connect();
  const count = await prisma.user.count();
  pass('PostgreSQL connected', `${count} user(s) in User table`);
  const users = await prisma.user.findMany({
    select: { email: true, name: true, googleRefreshToken: true, createdAt: true },
  });
  for (const u of users) {
    pass(`  User in DB: ${u.email}`, u.googleRefreshToken ? 'has refresh token' : 'no refresh token yet');
  }
} catch (e) {
  fail('PostgreSQL connected', e.message);
}

// 2. No silent-connect endpoint
try {
  const res = await fetch(`${API}/auth/google/silent-connect`, { method: 'POST' });
  if (res.status === 404) pass('Silent OAuth skip removed', '/auth/google/silent-connect returns 404');
  else fail('Silent OAuth skip removed', `unexpected status ${res.status}`);
} catch {
  fail('Silent OAuth skip removed', 'API not running on port 5000');
}

// 3. OAuth start requires Google sign-in
try {
  const res = await fetch(`${API}/auth/google?returnTo=/connect-account&ads=true`, { redirect: 'manual' });
  const loc = res.headers.get('location') || '';
  if (loc.includes('accounts.google.com')) {
    pass('Continue with Google redirects to Google OAuth');
  } else {
    fail('Continue with Google redirects to Google OAuth', loc);
  }
  if (!loc.includes('login_hint')) {
    pass('No login_hint on initial OAuth (user picks account at Google)');
  } else {
    fail('No login_hint on initial OAuth', 'login_hint present — would pre-fill account');
  }
  if (!loc.includes('session=')) {
    pass('No cached session token in OAuth URL');
  } else {
    fail('No cached session token in OAuth URL', 'session param found');
  }
} catch {
  fail('OAuth URL check', 'API not running');
}

// 4. Frontend source checks (static)
const connectPage = readFileSync('../frontend/src/pages/ConnectAccountPage.tsx', 'utf8');
const apiTs = readFileSync('../frontend/src/services/api.ts', 'utf8');
const authRoutes = readFileSync('./src/routes/auth.routes.ts', 'utf8');

if (!connectPage.includes('silentConnect')) pass('Frontend: no silentConnect call');
else fail('Frontend: no silentConnect call');

if (connectPage.includes('window.location.assign(url)')) pass('Frontend: handleGoogleLogin redirects to OAuth');
else fail('Frontend: handleGoogleLogin must redirect to OAuth');

if (connectPage.includes('verifiedReturning && googleProfile')) pass('Frontend: Welcome back only after OAuth (verifiedReturning)');
else fail('Frontend: Welcome back banner missing or wrong condition');

if (!connectPage.match(/isReturningUser && user/)) pass('Frontend: no welcome banner on Step 1 from cached JWT');
else fail('Frontend: Step 1 still shows welcome from cached auth');

if (authRoutes.includes('getUserByEmail(normalizedEmail)')) pass('Backend: returning user lookup from PostgreSQL before OAuth save');
else fail('Backend: PostgreSQL lookup missing in callback');

if (authRoutes.includes("redirectParams.set('returning', '1')")) pass('Backend: returning=1 flag after OAuth for welcome banner');
else fail('Backend: returning flag missing');

if (apiTs.includes('prisma') === false && readFileSync('./src/services/user.service.ts', 'utf8').includes('prisma.user')) {
  pass('Backend: users stored via Prisma/PostgreSQL');
} else if (readFileSync('./src/services/user.service.ts', 'utf8').includes('prisma.user')) {
  pass('Backend: users stored via Prisma/PostgreSQL');
}

// 5. Health
try {
  const health = await fetch(`${API}/health`).then((r) => r.json());
  if (health.database) pass('API health: database=true');
  else fail('API health: database=false');
} catch {
  fail('API health check', 'API not running');
}

console.log('\n=== Summary ===');
const failed = checks.filter((c) => !c.ok);
if (failed.length === 0) {
  console.log(`All ${checks.length} checks passed.`);
} else {
  console.log(`${failed.length}/${checks.length} checks FAILED.`);
  process.exit(1);
}

await prisma.$disconnect();
