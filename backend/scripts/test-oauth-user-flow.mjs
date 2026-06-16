/**
 * Smoke test: OAuth URL + PostgreSQL user lookup.
 * Run: DATABASE_URL=... node scripts/test-oauth-user-flow.mjs
 */
const API = 'http://localhost:5000/api';
const EMAIL = 'analytics@ctanalytics.net.au';

async function main() {
  const health = await fetch(`${API}/health`).then((r) => r.json());
  if (!health.database) {
    throw new Error('PostgreSQL not connected — set DATABASE_URL and run: npm run db:push --prefix backend');
  }
  console.log('✓ PostgreSQL health check passed');

  const oauthRes = await fetch(`${API}/auth/google?returnTo=/connect-account&ads=true`, {
    redirect: 'manual',
  });
  const location = oauthRes.headers.get('location') || '';
  if (!location.includes('accounts.google.com')) {
    throw new Error(`expected Google OAuth redirect, got: ${location}`);
  }
  if (location.includes('prompt=consent')) {
    throw new Error('initial OAuth must not force consent — user picks account first');
  }
  if (location.includes('login_hint')) {
    throw new Error('initial OAuth must not pre-fill account — user selects Gmail at Google');
  }
  console.log('✓ OAuth start URL requires Google sign-in (no silent skip)');

  const loginRes = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL }),
  });
  const { token } = await loginRes.json();

  const me = await fetch(`${API}/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then((r) => r.json());
  console.log('✓ PostgreSQL user lookup:', me.user.email, 'hasGoogleAdsAccess=', me.hasGoogleAdsAccess);

  console.log('\nAll OAuth + PostgreSQL checks passed.');
}

main().catch((err) => {
  console.error('FAIL:', err.message);
  process.exit(1);
});
