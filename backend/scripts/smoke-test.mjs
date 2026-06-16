/**
 * AdAudit Pro smoke test — API workflow + page availability checks.
 * Run: node backend/scripts/smoke-test.mjs
 */
const API = process.env.API_BASE || 'http://localhost:5000';
const WEB = process.env.WEB_BASE || 'http://localhost:5173';

const results = [];

function pass(name, detail = '') {
  results.push({ name, ok: true, detail });
  console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`);
}

function fail(name, detail = '') {
  results.push({ name, ok: false, detail });
  console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
}

async function fetchJson(path, options = {}) {
  const res = await fetch(`${API}${path}`, options);
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { _raw: text.slice(0, 200) };
  }
  return { res, json, text };
}

async function checkPage(path, label) {
  try {
    const res = await fetch(`${WEB}${path}`);
    const html = await res.text();
    const hasRoot = html.includes('id="root"') || html.includes("id='root'");
    const hasScript = html.includes('/src/main.tsx') || html.includes('/assets/');
    if (res.ok && hasRoot && hasScript) {
      pass(`Page ${label}`, `${path} (${res.status})`);
      return true;
    }
    fail(`Page ${label}`, `${path} status=${res.status} root=${hasRoot}`);
    return false;
  } catch (err) {
    fail(`Page ${label}`, `${path} — ${err.message}`);
    return false;
  }
}

async function main() {
  console.log('\n=== AdAudit Pro Smoke Test ===\n');
  console.log(`API: ${API}`);
  console.log(`WEB: ${WEB}\n`);

  // --- Health & config ---
  console.log('--- Backend health ---');
  try {
    const { res, json } = await fetchJson('/api/health');
    if (res.ok && json.status) pass('GET /api/health', json.status);
    else fail('GET /api/health', `status ${res.status}`);
  } catch (e) {
    fail('GET /api/health', e.message);
    console.error('\nBackend not reachable. Start with: npm run dev\n');
    process.exit(1);
  }

  const { json: config } = await fetchJson('/api/auth/config');
  if (config.googleOAuth) pass('Auth config', 'Google OAuth configured');
  else fail('Auth config', 'Google OAuth missing');

  // --- Demo audit workflow (no auth) ---
  console.log('\n--- Audit workflow (demo) ---');
  const demoPayload = {
    googleAdsCustomerId: '123-456-7890',
    auditDepth: 'standard',
    auditWindow: 365,
    selectedModules: ['account-structure', 'keywords', 'ad-copy'],
    competitors: [],
    reportOptions: { generatePdf: true, includeAiRecommendations: true, emailWhenComplete: false, includeLandingPageAnalysis: true },
    accountName: 'Smoke Test Account',
    monthlySpend: 5000,
    websiteUrl: 'https://example.com',
    email: 'smoke@test.com',
    name: 'Smoke Tester',
    goal: 'leads',
  };

  let auditId;
  {
    const { res, json } = await fetchJson('/api/audit/start-demo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(demoPayload),
    });
    auditId = json.auditId || json.audit?.id;
    if (res.ok && auditId) pass('POST /api/audit/start-demo', `auditId=${auditId}`);
    else fail('POST /api/audit/start-demo', json.error || res.status);
  }

  if (auditId) {
    for (const [label, path] of [
      ['status', `/api/audit/status/${auditId}`],
      ['findings', `/api/audit/findings/${auditId}`],
      ['health', `/api/audit/health/${auditId}`],
      ['report', `/api/audit/report/${auditId}`],
      ['logs', `/api/audit/logs/${auditId}`],
    ]) {
      const { res, json } = await fetchJson(path);
      if (res.ok) {
        const extra =
          label === 'findings' ? `${json.findings?.length ?? 0} findings` :
          label === 'health' ? `score=${json.overallScore ?? 'n/a'}` :
          label === 'status' ? `status=${json.audit?.status ?? 'n/a'}` :
          '';
        pass(`GET /api/audit/${label}/:id`, extra);
      } else {
        fail(`GET /api/audit/${label}/:id`, json.error || res.status);
      }
    }

    // Share demo report
    {
      const { res, json } = await fetchJson('/api/audit/share-demo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ auditRunId: auditId }),
      });
      const shareToken = json.report?.token;
      if (res.ok && shareToken) {
        pass('POST /api/audit/share-demo', `token=${shareToken}`);
        const shared = await fetchJson(`/api/audit/shared/${shareToken}`);
        if (shared.res.ok) pass('GET /api/audit/shared/:token');
        else fail('GET /api/audit/shared/:token', shared.json.error);
      } else {
        fail('POST /api/audit/share-demo', json.error || res.status);
      }
    }
  }

  // --- Mock login + authenticated routes ---
  console.log('\n--- Auth workflow ---');
  let token;
  {
    const { res, json } = await fetchJson('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'smoke-test@adaudit.pro', name: 'Smoke Test User' }),
    });
    token = json.token;
    if (res.ok && token) pass('POST /api/auth/login', 'JWT issued');
    else fail('POST /api/auth/login', json.error || res.status);
  }

  if (token) {
    const authHeaders = { Authorization: `Bearer ${token}` };
    const me = await fetchJson('/api/auth/me', { headers: authHeaders });
    if (me.res.ok && me.json.user) pass('GET /api/auth/me', me.json.user.email);
    else fail('GET /api/auth/me', me.json.error);

    const accounts = await fetchJson('/api/google-ads/accounts', { headers: authHeaders });
    if (accounts.res.ok) {
      pass(
        'GET /api/google-ads/accounts',
        `${accounts.json.accounts?.length ?? 0} accounts (${accounts.json.source}, ${accounts.json.reason})`
      );
    } else {
      fail('GET /api/google-ads/accounts', accounts.json.error);
    }
  }

  // --- AI routes (structure check) ---
  console.log('\n--- AI routes ---');
  {
    const { res } = await fetchJson('/api/ai/optimize-ad', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    // Expect 401 without auth or 400 with validation — not 404
    if (res.status === 404) fail('POST /api/ai/optimize-ad', 'route not found');
    else pass('POST /api/ai/optimize-ad', `registered (HTTP ${res.status})`);
  }

  // --- Frontend pages ---
  console.log('\n--- Frontend pages ---');
  const webOk = await fetch(WEB).then((r) => r.ok).catch(() => false);
  if (!webOk) {
    fail('Frontend server', `${WEB} not reachable — run npm run dev`);
  } else {
    pass('Frontend server', WEB);
    await checkPage('/', 'Landing');
    await checkPage('/connect-account', 'Connect Account');
    await checkPage('/login', 'Login');
    if (auditId) {
      await checkPage(`/processing/${auditId}`, 'Processing');
      await checkPage(`/dashboard/${auditId}`, 'Dashboard');
    }
    await checkPage('/settings', 'Settings');
    await checkPage('/shared/demo-token', 'Shared Report (shell)');
  }

  // --- Summary ---
  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);
  console.log('\n=== Summary ===');
  console.log(`${passed}/${results.length} checks passed`);
  if (failed.length) {
    console.log('\nFailed:');
    for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`);
    process.exit(1);
  }
  console.log('\nAll smoke tests passed.\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
