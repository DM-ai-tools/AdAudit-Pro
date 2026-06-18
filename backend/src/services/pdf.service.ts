import { existsSync } from 'fs';
import type { AuditRun, Finding, RoadmapItem } from '../types/index.js';
import { env } from '../config/env.js';
import {
  groupFindingsByModule,
  inferAuditScope,
  isFailureFinding,
  reportTitle,
} from '../utils/report-findings.js';

const CHROME_CANDIDATES = [
  process.env.PUPPETEER_EXECUTABLE_PATH,
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter((p): p is string => Boolean(p));

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatMoney(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}

function severityColor(severity: string): string {
  const map: Record<string, string> = {
    CRITICAL: '#FF4444',
    HIGH: '#FF6B2B',
    MEDIUM: '#F8A51B',
    LOW: '#00C9A7',
  };
  return map[severity] || '#C0CCDB';
}

function renderFinding(f: Finding): string {
  return `
    <article class="finding">
      <div class="finding-head">
        <span class="severity" style="color:${severityColor(f.severity)}">${escapeHtml(f.severity)}</span>
        <span class="impact">${formatMoney(f.impactMonthly)}/mo</span>
      </div>
      <h4>${escapeHtml(f.title)}</h4>
      <p class="desc">${escapeHtml(f.description)}</p>
      ${f.recommendation ? `<p class="rec"><strong>Recommendation:</strong> ${escapeHtml(f.recommendation)}</p>` : ''}
      <div class="meta">
        <span>${escapeHtml(f.category.replace(/_/g, ' '))}</span>
        <span>Confidence ${f.confidence}%</span>
      </div>
    </article>`;
}

function renderRoadmapColumn(title: string, color: string, items: RoadmapItem[]): string {
  const cards = items.length
    ? items.map((item) => `
        <div class="roadmap-card">
          <div class="roadmap-num">${item.order}</div>
          <div>
            <p class="roadmap-title">${escapeHtml(item.title)}</p>
            ${item.description ? `<p class="roadmap-desc">${escapeHtml(item.description)}</p>` : ''}
            <div class="roadmap-tags">
              <span>${escapeHtml(item.effort)} effort</span>
              <span>${escapeHtml(item.owner)}</span>
              ${item.impactMonthly ? `<span>${formatMoney(item.impactMonthly)}/mo</span>` : ''}
            </div>
          </div>
        </div>`).join('')
    : '<p class="muted">No items in this phase.</p>';

  return `
    <div class="roadmap-col" style="border-color:${color}">
      <h3 style="color:${color}">${escapeHtml(title)}</h3>
      ${cards}
    </div>`;
}

export function buildReportHtml(audit: AuditRun): string {
  const validFindings = audit.findings.filter((f) => !isFailureFinding(f));
  const totalImpact = validFindings.reduce((s, f) => s + f.impactMonthly, 0);
  const healthScore = audit.healthScores.length
    ? Math.round(audit.healthScores.reduce((s, h) => s + h.score, 0) / audit.healthScores.length)
    : 50;
  const scope = inferAuditScope(audit);
  const title = reportTitle(audit);
  const accountLabel = scope === 'campaign'
    ? audit.accountName.split(' — ')[0] || audit.accountName
    : audit.accountName;
  const generatedAt = audit.completedAt
    ? new Date(audit.completedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  const summaryParagraphs = (audit.executiveSummary || 'Audit complete. Review module findings below.')
    .split(/\n\n+/)
    .map((p) => `<p>${escapeHtml(p.trim())}</p>`)
    .join('');

  const healthHtml = audit.healthScores.length
    ? audit.healthScores.map((h) => `
        <div class="health-card">
          <div class="health-label">${escapeHtml(h.dimension)}</div>
          <div class="health-score">${h.score}</div>
          <div class="health-bar"><span style="width:${Math.min(100, h.score)}%"></span></div>
        </div>`).join('')
    : '<p class="muted">Health scores were not generated for this audit.</p>';

  const moduleGroups = groupFindingsByModule(audit.findings);
  const modulesHtml = moduleGroups.length
    ? moduleGroups.map((group) => `
        <section class="module-section">
          <h2>${escapeHtml(group.name)}</h2>
          <p class="module-sub">${group.findings.length} Claude finding${group.findings.length === 1 ? '' : 's'}</p>
          ${group.findings.map(renderFinding).join('')}
        </section>`).join('')
    : '<p class="muted">No findings available for this audit.</p>';

  const roadmap30 = audit.roadmapItems.filter((r) => r.phase === 'DAY_30');
  const roadmap60 = audit.roadmapItems.filter((r) => r.phase === 'DAY_60');
  const roadmap90 = audit.roadmapItems.filter((r) => r.phase === 'DAY_90');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>AdAudit Pro — ${escapeHtml(title)}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      background: #07090F;
      color: #C0CCDB;
      margin: 0;
      padding: 0;
      line-height: 1.5;
    }
    .toolbar {
      position: sticky;
      top: 0;
      z-index: 10;
      background: #0B1220;
      border-bottom: 1px solid #1E2D48;
      padding: 12px 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
    }
    .toolbar button {
      background: #FF6B2B;
      color: #fff;
      border: none;
      border-radius: 8px;
      padding: 8px 16px;
      font-weight: 600;
      cursor: pointer;
    }
    .wrap { max-width: 960px; margin: 0 auto; padding: 32px 24px 64px; }
    h1 { color: #fff; font-size: 28px; margin: 0 0 8px; }
    h2 { color: #fff; font-size: 20px; margin: 32px 0 12px; border-bottom: 1px solid #1E2D48; padding-bottom: 8px; }
    h3 { margin: 0 0 12px; font-size: 16px; }
    h4 { color: #fff; margin: 0 0 8px; font-size: 15px; }
    .accent { color: #FF6B2B; }
    .badge {
      display: inline-block;
      background: rgba(255,107,43,0.15);
      color: #FF6B2B;
      border: 1px solid rgba(255,107,43,0.35);
      border-radius: 999px;
      padding: 4px 12px;
      font-size: 12px;
      font-weight: 600;
      margin-right: 8px;
    }
    .badge.teal {
      background: rgba(0,201,167,0.12);
      color: #00C9A7;
      border-color: rgba(0,201,167,0.35);
    }
    .meta-line { color: #6B7D96; font-size: 13px; margin-bottom: 24px; }
    .metrics {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 12px;
      margin: 24px 0;
    }
    .metric {
      background: #141C2E;
      border: 1px solid #1E2D48;
      border-radius: 12px;
      padding: 16px;
      text-align: center;
    }
    .metric-value { font-size: 24px; font-weight: 700; color: #fff; }
    .metric-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: #6B7D96; margin-top: 4px; }
    .summary { background: #141C2E; border: 1px solid #1E2D48; border-radius: 12px; padding: 20px; }
    .summary p { margin: 0 0 12px; }
    .summary p:last-child { margin-bottom: 0; }
    .health-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
      gap: 12px;
    }
    .health-card {
      background: #141C2E;
      border: 1px solid #1E2D48;
      border-radius: 12px;
      padding: 14px;
    }
    .health-label { font-size: 12px; color: #6B7D96; margin-bottom: 6px; }
    .health-score { font-size: 22px; font-weight: 700; color: #fff; margin-bottom: 8px; }
    .health-bar { height: 6px; background: #0B1220; border-radius: 999px; overflow: hidden; }
    .health-bar span { display: block; height: 100%; background: linear-gradient(90deg, #FF6B2B, #00C9A7); }
    .module-section { margin-top: 28px; page-break-inside: avoid; }
    .module-sub { color: #6B7D96; font-size: 13px; margin: -4px 0 16px; }
    .finding {
      background: #141C2E;
      border: 1px solid #1E2D48;
      border-radius: 12px;
      padding: 16px;
      margin-bottom: 12px;
      page-break-inside: avoid;
    }
    .finding-head { display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 12px; font-weight: 700; }
    .impact { color: #00C9A7; }
    .desc { margin: 0 0 8px; font-size: 13px; }
    .rec { margin: 0 0 8px; font-size: 13px; color: #8FE8D8; font-style: italic; }
    .meta { display: flex; gap: 12px; font-size: 11px; color: #6B7D96; }
    .roadmap {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 12px;
    }
    .roadmap-col {
      background: #141C2E;
      border: 1px solid #1E2D48;
      border-radius: 12px;
      padding: 16px;
    }
    .roadmap-card {
      display: flex;
      gap: 10px;
      background: #0B1220;
      border: 1px solid #1E2D48;
      border-radius: 8px;
      padding: 10px;
      margin-bottom: 8px;
    }
    .roadmap-num { color: #6B7D96; font-weight: 700; font-size: 12px; min-width: 18px; }
    .roadmap-title { color: #fff; font-size: 12px; font-weight: 600; margin: 0 0 4px; }
    .roadmap-desc { color: #6B7D96; font-size: 11px; margin: 0 0 6px; }
    .roadmap-tags { display: flex; flex-wrap: wrap; gap: 6px; font-size: 10px; color: #8FA3BE; }
    .muted { color: #6B7D96; font-size: 13px; }
    .footer { margin-top: 48px; padding-top: 16px; border-top: 1px solid #1E2D48; font-size: 11px; color: #6B7D96; }
    @media (max-width: 800px) {
      .metrics, .roadmap { grid-template-columns: 1fr 1fr; }
    }
    @media print {
      body { background: #fff; color: #111; }
      .toolbar { display: none; }
      .wrap { max-width: none; padding: 0; }
      h1, h2, h4, .metric-value, .health-score, .roadmap-title { color: #111; }
      .finding, .metric, .summary, .health-card, .roadmap-col, .roadmap-card {
        background: #fff;
        border-color: #ddd;
        break-inside: avoid;
      }
      .desc, .meta-line, .muted, .module-sub, .meta { color: #444; }
      .rec { color: #0d6e5f; }
    }
  </style>
</head>
<body>
  <div class="toolbar no-print">
    <strong>AdAudit Pro Report</strong>
    <button type="button" onclick="window.print()">Print / Save as PDF</button>
  </div>
  <div class="wrap">
    <span class="badge">${scope === 'campaign' ? 'Campaign Audit' : 'Account Audit'}</span>
    <span class="badge teal">Claude AI Analysis</span>
    <h1><span class="accent">${escapeHtml(title)}</span></h1>
    <p class="meta-line">
      ${scope === 'campaign' ? `Account: ${escapeHtml(accountLabel)} • ` : ''}
      Generated ${escapeHtml(generatedAt)} • ${audit.dataWindowDays}-day window • Engine v${escapeHtml(audit.engineVersion)}
      ${audit.goal ? ` • Goal: ${escapeHtml(audit.goal)}` : ''}
    </p>

    <div class="metrics">
      <div class="metric"><div class="metric-value" style="color:#FF6B2B">${validFindings.length}</div><div class="metric-label">Findings</div></div>
      <div class="metric"><div class="metric-value" style="color:#00C9A7">${formatMoney(totalImpact)}</div><div class="metric-label">Monthly Impact</div></div>
      <div class="metric"><div class="metric-value" style="color:#00C9A7">${formatMoney(totalImpact * 12)}</div><div class="metric-label">Annual Opportunity</div></div>
      <div class="metric"><div class="metric-value">${healthScore}/100</div><div class="metric-label">Health Score</div></div>
    </div>

    <h2>Executive Summary</h2>
    <div class="summary">${summaryParagraphs}</div>

    <h2>Account Health Breakdown</h2>
    <div class="health-grid">${healthHtml}</div>

    <h2>Module Findings (Claude)</h2>
    ${modulesHtml}

    <h2>30 / 60 / 90-Day Growth Roadmap</h2>
    <div class="roadmap">
      ${renderRoadmapColumn('30-Day Sprint', '#FF6B6B', roadmap30)}
      ${renderRoadmapColumn('60-Day Build', '#FF6B2B', roadmap60)}
      ${renderRoadmapColumn('90-Day Scale', '#00C9A7', roadmap90)}
    </div>

    <div class="footer">
      Generated by AdAudit Pro • ${escapeHtml(env.clientUrl || 'https://adaudit.pro')}
      • ${validFindings.length} findings across ${moduleGroups.length} modules
    </div>
  </div>
</body>
</html>`;
}

async function tryRenderPdf(html: string): Promise<Buffer | null> {
  try {
    const { default: puppeteer } = await import('puppeteer');
    const launchOptions = {
      headless: true as const,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    };

    const renderPage = async (executablePath?: string) => {
      const browser = await puppeteer.launch(
        executablePath ? { ...launchOptions, executablePath } : launchOptions
      );
      try {
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: 'domcontentloaded' });
        const pdf = await page.pdf({
          format: 'A4',
          printBackground: true,
          margin: { top: '14mm', bottom: '14mm', left: '12mm', right: '12mm' },
        });
        return Buffer.from(pdf);
      } finally {
        await browser.close();
      }
    };

    for (const candidate of CHROME_CANDIDATES) {
      if (!existsSync(candidate)) continue;
      try {
        return await renderPage(candidate);
      } catch {
        /* try next chrome path */
      }
    }

    return await renderPage();
  } catch (err) {
    console.warn('PDF render unavailable, serving HTML report:', err instanceof Error ? err.message : err);
    return null;
  }
}

export async function generatePdf(audit: AuditRun): Promise<{ buffer: Buffer; isPdf: boolean }> {
  const html = buildReportHtml(audit);
  const pdf = await tryRenderPdf(html);
  if (pdf) return { buffer: pdf, isPdf: true };
  return { buffer: Buffer.from(html, 'utf-8'), isPdf: false };
}
