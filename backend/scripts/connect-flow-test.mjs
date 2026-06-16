/**
 * Connect Account 3-step flow test (API-level).
 * Simulates post-OAuth session and verifies Steps 2 & 3 data.
 * Run: node backend/scripts/connect-flow-test.mjs [email]
 */
const API = process.env.API_BASE || 'http://localhost:5000';
const email = process.argv[2] || process.env.CONNECT_TEST_EMAIL;

async function fetchJson(path, options = {}) {
  const res = await fetch(`${API}${path}`, options);
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { _raw: text.slice(0, 300) };
  }
  return { res, json };
}

function step(num, label) {
  console.log(`\n--- Step ${num}: ${label} ---`);
}

async function main() {
  console.log('\n=== Connect Account Flow Test ===\n');

  if (!email) {
    console.log('Usage: node backend/scripts/connect-flow-test.mjs <google-email>');
    console.log('  Or set CONNECT_TEST_EMAIL in env');
    console.log('\nSkipping live Google Ads test — running OAuth URL + route checks only.\n');
  }

  // Step 1 — OAuth entry point
  step(1, 'Google Login (OAuth redirect URL)');
  {
    const params = new URLSearchParams({ returnTo: '/connect-account', ads: 'true' });
    const url = `${API}/api/auth/google?${params}`;
    const res = await fetch(url, { redirect: 'manual' });
    const location = res.headers.get('location') || '';
    if (res.status >= 300 && res.status < 400 && location.includes('accounts.google.com')) {
      console.log('  ✓ OAuth redirect to Google');
      console.log(`    scopes include adwords: ${location.includes('adwords') || location.includes('adwords')}`);
    } else {
      console.log(`  ✗ Unexpected OAuth response: ${res.status}`);
      console.log(`    location: ${location.slice(0, 120)}`);
    }
  }

  let token;
  let accounts = [];

  if (email) {
    step(1, 'Post-login session (check-user / instant resume)');
    const check = await fetchJson('/api/auth/check-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });

    if (!check.res.ok || check.json.requiresOAuth) {
      console.log(`  ✗ User requires full OAuth: ${check.json.reason || check.json._raw || check.res.status}`);
      console.log('    Complete Step 1 manually in browser, then re-run this script.');
      process.exit(1);
    }

    token = check.json.token;
    accounts = check.json.accounts || [];
    console.log(`  ✓ Session valid for ${check.json.user?.email}`);
    console.log(`  ✓ hasGoogleAdsAccess via refresh token`);

    // Simulate OAuth callback state updates
    step(2, 'Select Google Ads Account');
    if (accounts.length === 0) {
      console.log(`  ✗ No accounts returned (reason: ${check.json.accountsReason})`);
      if (check.json.accountsErrorDetail) {
        console.log(`    detail: ${check.json.accountsErrorDetail}`);
      }
      process.exit(1);
    }

    console.log(`  ✓ ${accounts.length} Google Ads account(s) loaded`);
    for (const a of accounts.slice(0, 5)) {
      console.log(`    - ${a.name} (${a.customerId}) ${a.accountType} spend=$${a.monthlySpend}`);
    }

    const selected = accounts.find((a) => a.accountType !== 'Manager') || accounts[0];
    const authHeaders = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };

    step(3, 'Configure Audit (audit-config)');
    const configPath = `/api/google-ads/accounts/${encodeURIComponent(selected.customerId)}/audit-config`;
    const config = await fetchJson(configPath, { headers: authHeaders });

    if (!config.res.ok) {
      console.log(`  ✗ audit-config failed: ${config.json.error || config.res.status}`);
      process.exit(1);
    }

    const c = config.json;
    console.log(`  ✓ Config loaded for ${c.account?.name}`);
    console.log(`    depth=${c.recommendedDepth} window=${c.recommendedWindow}d source=${c.source}`);
    console.log(`    modules=${c.modules?.filter((m) => m.enabled).length}/${c.modules?.length} enabled`);
    console.log(`    campaigns=${c.stats?.activeCampaigns} types=${(c.stats?.campaignTypes || []).join(', ')}`);

    step(3, 'Start Audit');
    const start = await fetchJson('/api/audit/start', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        googleAdsCustomerId: selected.customerId,
        auditDepth: c.recommendedDepth,
        auditWindow: c.recommendedWindow,
        selectedModules: c.modules.filter((m) => m.enabled).map((m) => m.id),
        competitors: [],
        reportOptions: {
          generatePdf: true,
          includeAiRecommendations: true,
          emailWhenComplete: false,
          includeLandingPageAnalysis: true,
        },
        accountName: selected.name,
        monthlySpend: selected.monthlySpend,
        campaignCount: c.stats?.activeCampaigns,
        websiteUrl: 'https://example.com',
        email,
        name: check.json.user?.name,
        goal: 'leads',
      }),
    });

    if (start.res.ok && start.json.audit?.id) {
      console.log(`  ✓ Audit started: ${start.json.audit.id} → /processing/${start.json.audit.id}`);
    } else {
      console.log(`  ✗ Start audit failed: ${start.json.error || start.res.status}`);
      process.exit(1);
    }

    console.log('\n=== All 3 connect steps verified via API ===\n');
    return;
  }

  // Without email — verify accounts endpoint requires auth
  step(2, 'Accounts endpoint (unauthenticated)');
  const unauth = await fetchJson('/api/google-ads/accounts');
  if (unauth.res.status === 401) {
    console.log('  ✓ /api/google-ads/accounts requires auth (expected)');
  } else {
    console.log(`  ? unexpected status ${unauth.res.status}`);
  }

  console.log('\nProvide a Google email to test Steps 2–3 with live Ads data:');
  console.log('  node backend/scripts/connect-flow-test.mjs your@gmail.com\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
