import { existsSync } from 'fs';
import type { AuditRun, Finding, RoadmapItem } from '../types/index.js';
import { env } from '../config/env.js';
import {
  groupFindingsByModule,
  inferAuditScope,
  isFailureFinding,
  reportTitle,
} from '../utils/report-findings.js';
import type { AuditReportOptimization } from './aiOptimization.service.js';
import type { OptimizedAdContent, CurrentAdData } from './aiOptimization.service.js';

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

function renderFinding(f: Finding, optimization?: AuditReportOptimization): string {
  const optSnippet = optimization
    ? `<p class="rec"><strong>Make It Better (AI):</strong> ${escapeHtml(
        asDisplayText(
          (optimization.optimizedContent as OptimizedAdContent).improvementReasoning,
          optimization.improvementReasoning ?? ''
        )
      )} <em>— Full optimized ad copy is in the Make It Better section below.</em></p>`
    : '';
  return `
    <article class="finding">
      <div class="finding-head">
        <span class="severity" style="color:${severityColor(f.severity)}">${escapeHtml(f.severity)}</span>
        <span class="impact">${formatMoney(f.impactMonthly)}/mo</span>
      </div>
      <h4>${escapeHtml(f.title)}</h4>
      <p class="desc">${escapeHtml(f.description)}</p>
      ${f.recommendation ? `<p class="rec"><strong>Recommendation:</strong> ${escapeHtml(f.recommendation)}</p>` : ''}
      ${optSnippet}
      <div class="meta">
        <span>${escapeHtml(f.category.replace(/_/g, ' '))}</span>
        <span>Confidence ${f.confidence}%</span>
      </div>
    </article>`;
}

function asDisplayText(val: unknown, fallback = ''): string {
  if (val == null) return fallback;
  if (typeof val === 'string') return val.trim() || fallback;
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  if (typeof val === 'object') {
    const o = val as Record<string, unknown>;
    const text = o.text ?? o.linkText ?? o.label ?? o.name ?? o.headline ?? o.value;
    if (typeof text === 'string' && text.trim()) return text.trim();
  }
  return fallback;
}

function asStringList(val: unknown): string[] {
  return normalizeAdStrings(val);
}

/** Normalize headline/description arrays from DB JSON (strings or {text} objects). */
function normalizeAdStrings(val: unknown): string[] {
  if (!val) return [];
  if (Array.isArray(val)) return val.flatMap((item) => normalizeAdStrings(item));
  if (typeof val === 'string') return [val.trim()].filter(Boolean);
  if (typeof val === 'object') {
    const o = val as Record<string, unknown>;
    const text = o.text ?? o.linkText ?? o.label ?? o.name ?? o.headline ?? o.value;
    const url = o.url ?? o.finalUrl ?? o.href;
    if (typeof text === 'string' && text.trim()) {
      const label = text.trim();
      if (typeof url === 'string' && url.trim()) return [`${label} (${url.trim()})`];
      return [label];
    }
    if (typeof url === 'string' && url.trim()) return [url.trim()];
  }
  return [];
}

interface AdCopyColumnData {
  headlines: string[];
  longHeadlines?: string[];
  descriptions: string[];
  displayPath1?: string;
  displayPath2?: string;
  finalUrl?: string;
}

function resolveAdCopyForReport(
  original: CurrentAdData | null | undefined,
  optimized: OptimizedAdContent
): { current: AdCopyColumnData; optimized: AdCopyColumnData } {
  const optHeadlines = normalizeAdStrings(optimized.headlines);
  const optDescriptions = normalizeAdStrings(optimized.descriptions);
  const optLongHeadlines = normalizeAdStrings(optimized.longHeadlines);
  const curHeadlines = normalizeAdStrings(original?.headlines);
  const curDescriptions = normalizeAdStrings(original?.descriptions);
  const curLongHeadlines = normalizeAdStrings(original?.longHeadlines);

  return {
    current: {
      headlines: curHeadlines.length ? curHeadlines : optHeadlines.slice(0, 5),
      longHeadlines: curLongHeadlines,
      descriptions: curDescriptions.length ? curDescriptions : optDescriptions.slice(0, 2),
      displayPath1: original?.displayPath1,
      displayPath2: original?.displayPath2,
      finalUrl: original?.finalUrls?.[0],
    },
    optimized: {
      headlines: optHeadlines,
      longHeadlines: optLongHeadlines.length ? optLongHeadlines : undefined,
      descriptions: optDescriptions,
      displayPath1: optimized.displayPaths?.path1 ?? original?.displayPath1,
      displayPath2: optimized.displayPaths?.path2 ?? original?.displayPath2,
      finalUrl: original?.finalUrls?.[0],
    },
  };
}

function scenarioLabel(scenario: string | null): string {
  if (scenario === 'REPLACE_EXISTING') return 'Optimize Existing Ads';
  if (scenario === 'CREATE_ADS') return 'Create Ads In Campaign';
  if (scenario === 'CREATE_STRATEGY') return 'New Campaign Strategy';
  return 'AI Optimization';
}

function renderStringList(title: string, items: string[], max = 15): string {
  const list = items.filter(Boolean).slice(0, max);
  if (!list.length) return '';
  return `
    <div class="opt-list-block">
      <p class="opt-subtitle">${escapeHtml(title)}</p>
      <ul>${list.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
    </div>`;
}

function renderAdCopyColumn(title: string, ad: AdCopyColumnData, variant: 'current' | 'optimized'): string {
  const headlines = ad.headlines;
  const longHeadlines = ad.longHeadlines ?? [];
  const descriptions = ad.descriptions;
  const accent = variant === 'current' ? '#dc2626' : '#0d9488';
  const variantClass = variant === 'current' ? 'opt-ad-col current' : 'opt-ad-col optimized';
  const textStyle = 'color:#1e293b';
  const pathStyle = 'color:#64748b;font-size:11px;margin:0 0 8px';
  const renderList = (items: string[]) =>
    items.length
      ? `<ol class="opt-headlines" style="${textStyle}">${items.map((h) => `<li style="${textStyle}">${escapeHtml(h)}</li>`).join('')}</ol>`
      : `<p style="${pathStyle}">No copy available.</p>`;

  return `
    <div class="${variantClass}" style="border-color:${accent};background:#f8f9fb;color:#1e293b">
      <h4 style="color:${accent}">${escapeHtml(title)}</h4>
      ${ad.finalUrl ? `<p style="${pathStyle}">Final URL: ${escapeHtml(ad.finalUrl)}</p>` : ''}
      ${ad.displayPath1 ? `<p style="${pathStyle}">Display path: ${escapeHtml([ad.displayPath1, ad.displayPath2].filter(Boolean).join(' / '))}</p>` : ''}
      <p class="opt-subtitle">Headlines (${headlines.length})</p>
      ${renderList(headlines)}
      ${longHeadlines.length ? `<p class="opt-subtitle">Long Headlines (${longHeadlines.length})</p>${renderList(longHeadlines)}` : ''}
      <p class="opt-subtitle">Descriptions (${descriptions.length})</p>
      ${descriptions.length
        ? `<ol class="opt-descriptions" style="${textStyle}">${descriptions.map((d) => `<li style="${textStyle}">${escapeHtml(d)}</li>`).join('')}</ol>`
        : `<p style="${pathStyle}">No descriptions available.</p>`}
    </div>`;
}

function renderOptimizationBlock(
  opt: AuditReportOptimization,
  findingTitle: string
): string {
  const optimized = opt.optimizedContent as OptimizedAdContent;
  const original = (opt.originalAd ?? {}) as CurrentAdData;
  const adCopy = resolveAdCopyForReport(original, optimized);
  const reasoning = optimized.strategistReasoning;
  const recs = optimized.strategistRecommendations;
  const extensions = optimized.adExtensions;
  const strategy = optimized.campaignStrategy;

  const reasoningHtml = reasoning
    ? `
      <div class="opt-reasoning">
        <p class="opt-subtitle">Why This Ad Is Better</p>
        ${[
          { label: 'Headlines', text: reasoning.headlineChanges },
          { label: 'Descriptions', text: reasoning.descriptionChanges },
          { label: 'Keyword relevance', text: reasoning.keywordRelevance },
          { label: 'Quality Score', text: reasoning.qualityScore },
          { label: 'Conversion potential', text: reasoning.conversionPotential },
        ]
          .filter((s) => asDisplayText(s.text))
          .map(
            (s) => `
          <div class="opt-reason-row">
            <span class="opt-reason-label">${escapeHtml(s.label)}</span>
            <p>${escapeHtml(asDisplayText(s.text))}</p>
          </div>`
          )
          .join('')}
        ${renderStringList('Audit findings addressed', asStringList(reasoning.auditFindingsAddressed))}
        ${renderStringList('Competitor insights used', asStringList(reasoning.competitorInsightsUsed))}
      </div>`
    : '';

  const recsHtml = recs
    ? [
        renderStringList('Recommended keywords', asStringList(recs.keywords)),
        renderStringList('Negative keywords', asStringList(recs.negativeKeywords)),
        renderStringList('Ad extensions', asStringList(recs.extensions)),
        renderStringList('Landing page', asStringList(recs.landingPage)),
        renderStringList('Budget', asStringList(recs.budget)),
        renderStringList('Bidding', asStringList(recs.bidding)),
        renderStringList('Audience', asStringList(recs.audience)),
      ].join('')
    : '';

  const extensionsHtml = extensions
    ? [
        renderStringList('Sitelinks', asStringList(extensions.sitelinks)),
        renderStringList('Callouts', asStringList(extensions.callouts)),
        renderStringList('Structured snippets', asStringList(extensions.structuredSnippets)),
      ].join('')
    : '';

  const strategyHtml = strategy
    ? `
      <div class="opt-strategy">
        <p class="opt-subtitle">Campaign Strategy</p>
        ${strategy.campaignName ? `<p><strong>Campaign:</strong> ${escapeHtml(strategy.campaignName)}</p>` : ''}
        ${strategy.dailyBudget != null ? `<p><strong>Daily budget:</strong> ${formatMoney(strategy.dailyBudget)}</p>` : ''}
        ${(strategy.adGroups ?? [])
          .map(
            (ag) => `
          <div class="opt-adgroup">
            <p><strong>Ad group:</strong> ${escapeHtml(ag.name)}</p>
            ${renderStringList('Keywords', asStringList(ag.keywords), 12)}
          </div>`
          )
          .join('')}
        ${renderStringList('Negative keywords', asStringList(strategy.negativeKeywords))}
        ${renderStringList('Competitor insights', asStringList(strategy.competitorInsights))}
      </div>`
    : '';

  const impactHtml = `
    <div class="opt-impact-grid">
      <div class="opt-impact-card"><span>CTR</span><strong>${escapeHtml(optimized.predictedImpact?.ctrIncrease ?? '—')}</strong></div>
      <div class="opt-impact-card"><span>Conversions</span><strong>${escapeHtml(optimized.predictedImpact?.conversionImprovement ?? '—')}</strong></div>
      <div class="opt-impact-card"><span>Quality Score</span><strong>${escapeHtml(optimized.predictedImpact?.qualityScoreIncrease ?? '—')}</strong></div>
    </div>`;

  const perf = optimized.performanceEstimates;
  const perfLabel = perf?.label && perf.label.length > 80
    ? `${perf.label.slice(0, 77)}…`
    : perf?.label;
  const perfHtml = perf
    ? `
      <div class="opt-perf">
        <p class="opt-subtitle">AI Estimated Performance${perfLabel ? ` — ${escapeHtml(perfLabel)}` : ''}</p>
        <table class="opt-perf-table">
          <thead><tr><th>Metric</th><th>Current</th><th>Estimated</th></tr></thead>
          <tbody>
            ${[
              ['CTR', perf.current.ctr, perf.estimated.ctr],
              ['Quality Score', perf.current.qualityScore, perf.estimated.qualityScore],
              ['Conversion Rate', perf.current.conversionRate, perf.estimated.conversionRate],
              ['CPA', perf.current.cpa, perf.estimated.cpa],
              ['ROAS', perf.current.roas, perf.estimated.roas],
            ]
              .filter(([, cur, est]) => cur || est)
              .map(
                ([label, cur, est]) =>
                  `<tr><td>${escapeHtml(String(label))}</td><td>${escapeHtml(cur ?? '—')}</td><td class="est">${escapeHtml(est ?? '—')}</td></tr>`
              )
              .join('')}
          </tbody>
        </table>
      </div>`
    : '';

  const campaignLabel =
    original.campaignName ??
    strategy?.campaignName ??
    (opt.campaignId ? `Campaign ${opt.campaignId}` : 'Account-wide');

  return `
    <article class="optimization-block">
      <div class="opt-head">
        <div>
          <span class="badge teal">Make It Better</span>
          <span class="badge">${escapeHtml(scenarioLabel(opt.scenario))}</span>
          ${opt.tone ? `<span class="badge">${escapeHtml(opt.tone)} tone</span>` : ''}
        </div>
        <span class="opt-date">${escapeHtml(new Date(opt.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }))}</span>
      </div>
      <h3>${escapeHtml(findingTitle)}</h3>
      <p class="opt-campaign">${escapeHtml(campaignLabel)}</p>
      <p class="opt-summary">${escapeHtml(
        asDisplayText(optimized.improvementReasoning, opt.improvementReasoning ?? 'AI-generated ad optimization.')
      )}</p>
      ${impactHtml}
      ${perfHtml}
      <div class="opt-ad-compare">
        ${renderAdCopyColumn('Current Ad', adCopy.current, 'current')}
        ${renderAdCopyColumn('AI Optimized Ad', adCopy.optimized, 'optimized')}
      </div>
      ${renderStringList('CTA suggestions', asStringList(optimized.ctaSuggestions))}
      ${renderStringList('Keyword suggestions', asStringList(optimized.keywordSuggestions))}
      ${extensionsHtml}
      ${reasoningHtml}
      ${recsHtml}
      ${strategyHtml}
    </article>`;
}

function renderOptimizationsSection(
  audit: AuditRun,
  optimizations: AuditReportOptimization[]
): string {
  if (!optimizations.length) {
    return `
      <h2>Make It Better — AI Ad Optimizations</h2>
      <p class="muted">No Make It Better optimizations have been generated for this audit yet. Run optimizations from the dashboard and download the report again to include AI ad copy.</p>`;
  }

  const findingTitleById = new Map(audit.findings.map((f) => [f.id, f.title]));

  const blocks = optimizations
    .map((opt) => {
      const title =
        findingTitleById.get(opt.findingId) ??
        opt.originalAd.campaignName ??
        `Optimization ${opt.findingId}`;
      return renderOptimizationBlock(opt, title);
    })
    .join('');

  return `
    <h2>Make It Better — AI Ad Optimizations</h2>
    <p class="module-sub">${optimizations.length} Claude-generated optimization${optimizations.length === 1 ? '' : 's'} included in this report</p>
    ${blocks}`;
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

export function buildReportHtml(audit: AuditRun, optimizations: AuditReportOptimization[] = []): string {
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

  const optimizationByFinding = new Map(
    optimizations.map((o) => [o.findingId, o] as const)
  );

  const moduleGroups = groupFindingsByModule(audit.findings);
  const modulesHtml = moduleGroups.length
    ? moduleGroups.map((group) => `
        <section class="module-section">
          <h2>${escapeHtml(group.name)}</h2>
          <p class="module-sub">${group.findings.length} Claude finding${group.findings.length === 1 ? '' : 's'}</p>
          ${group.findings.map((f) => renderFinding(f, optimizationByFinding.get(f.id))).join('')}
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
  <meta name="color-scheme" content="light">
  <title>AdAudit Pro — ${escapeHtml(title)}</title>
  <style>
    :root {
      --bg: #ffffff;
      --bg-subtle: #f8f9fb;
      --bg-card: #ffffff;
      --border: #e2e8f0;
      --border-strong: #cbd5e1;
      --text: #1e293b;
      --text-muted: #64748b;
      --text-light: #94a3b8;
      --heading: #0f172a;
      --accent: #ea580c;
      --accent-soft: #fff7ed;
      --teal: #0d9488;
      --teal-soft: #f0fdfa;
      --red: #dc2626;
      --orange: #ea580c;
      --amber: #d97706;
      --green: #059669;
    }
    * { box-sizing: border-box; }
    body {
      font-family: 'Segoe UI', system-ui, -apple-system, Roboto, Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      margin: 0;
      padding: 0;
      line-height: 1.6;
      font-size: 14px;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .toolbar {
      position: sticky;
      top: 0;
      z-index: 10;
      background: var(--heading);
      color: #fff;
      padding: 12px 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
    }
    .toolbar button {
      background: var(--accent);
      color: #fff;
      border: none;
      border-radius: 6px;
      padding: 8px 16px;
      font-weight: 600;
      cursor: pointer;
      font-size: 13px;
    }
    .wrap { max-width: 900px; margin: 0 auto; padding: 40px 32px 64px; }
    .report-header {
      border-bottom: 3px solid var(--accent);
      padding-bottom: 24px;
      margin-bottom: 32px;
    }
    .brand { font-size: 11px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--accent); margin-bottom: 8px; }
    h1 { color: var(--heading); font-size: 26px; margin: 0 0 8px; font-weight: 700; line-height: 1.25; }
    h1 .accent { color: var(--accent); }
    h2 {
      color: var(--heading);
      font-size: 18px;
      font-weight: 700;
      margin: 36px 0 16px;
      padding-bottom: 8px;
      border-bottom: 2px solid var(--border);
      page-break-after: avoid;
    }
    h3 { color: var(--heading); margin: 0 0 12px; font-size: 15px; font-weight: 600; }
    h4 { color: var(--heading); margin: 0 0 8px; font-size: 14px; font-weight: 600; }
    .badge {
      display: inline-block;
      background: var(--accent-soft);
      color: var(--accent);
      border: 1px solid #fed7aa;
      border-radius: 4px;
      padding: 3px 10px;
      font-size: 11px;
      font-weight: 600;
      margin-right: 6px;
      margin-bottom: 4px;
    }
    .badge.teal { background: var(--teal-soft); color: var(--teal); border-color: #99f6e4; }
    .meta-line { color: var(--text-muted); font-size: 13px; margin-bottom: 0; }
    .metrics {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 12px;
      margin: 28px 0;
    }
    .metric {
      background: var(--bg-subtle);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px 12px;
      text-align: center;
    }
    .metric-value { font-size: 22px; font-weight: 700; color: var(--heading); }
    .metric-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-muted); margin-top: 4px; font-weight: 600; }
    .summary {
      background: var(--bg-subtle);
      border: 1px solid var(--border);
      border-left: 4px solid var(--accent);
      border-radius: 8px;
      padding: 20px 24px;
      color: var(--text);
    }
    .summary p { margin: 0 0 12px; color: var(--text); line-height: 1.7; }
    .summary p:last-child { margin-bottom: 0; }
    .health-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
      gap: 10px;
    }
    .health-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 14px;
    }
    .health-label { font-size: 11px; color: var(--text-muted); margin-bottom: 4px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
    .health-score { font-size: 24px; font-weight: 700; color: var(--heading); margin-bottom: 8px; }
    .health-bar { height: 5px; background: var(--border); border-radius: 999px; overflow: hidden; }
    .health-bar span { display: block; height: 100%; background: linear-gradient(90deg, var(--accent), var(--teal)); }
    .module-section { margin-top: 8px; page-break-inside: avoid; }
    .module-sub { color: var(--text-muted); font-size: 12px; margin: -8px 0 14px; }
    .finding {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px 18px;
      margin-bottom: 10px;
      page-break-inside: avoid;
    }
    .finding-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; }
    .impact { color: var(--teal); font-weight: 700; }
    .desc { margin: 0 0 8px; font-size: 13px; color: var(--text); line-height: 1.6; }
    .rec { margin: 0 0 8px; font-size: 13px; color: #0f766e; line-height: 1.6; }
    .rec strong { color: #0d9488; }
    .meta { display: flex; gap: 12px; font-size: 11px; color: var(--text-muted); margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--border); }
    .roadmap { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
    .roadmap-col {
      background: var(--bg-subtle);
      border: 1px solid var(--border);
      border-top: 3px solid;
      border-radius: 8px;
      padding: 14px;
    }
    .roadmap-card {
      display: flex;
      gap: 10px;
      background: #fff;
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 10px;
      margin-bottom: 8px;
    }
    .roadmap-num { color: var(--text-light); font-weight: 700; font-size: 12px; min-width: 18px; }
    .roadmap-title { color: var(--heading); font-size: 12px; font-weight: 600; margin: 0 0 4px; }
    .roadmap-desc { color: var(--text-muted); font-size: 11px; margin: 0 0 6px; line-height: 1.5; }
    .roadmap-tags { display: flex; flex-wrap: wrap; gap: 6px; font-size: 10px; color: var(--text-muted); }
    .muted { color: var(--text-muted); font-size: 13px; line-height: 1.6; }
    .optimization-block {
      background: #fff;
      border: 1px solid var(--border);
      border-left: 4px solid var(--accent);
      border-radius: 8px;
      padding: 24px;
      margin-bottom: 24px;
      page-break-inside: avoid;
      box-shadow: 0 1px 3px rgba(15,23,42,0.06);
    }
    .opt-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 12px; flex-wrap: wrap; }
    .opt-date { color: var(--text-muted); font-size: 11px; }
    .optimization-block h3 { color: var(--heading); margin: 0 0 4px; font-size: 16px; }
    .opt-campaign { color: var(--text-muted); font-size: 12px; margin: 0 0 12px; font-weight: 500; }
    .opt-summary { font-size: 13px; margin: 0 0 18px; line-height: 1.7; color: var(--text); }
    .opt-impact-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 18px; }
    .opt-impact-card {
      background: var(--bg-subtle);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 12px;
      text-align: center;
    }
    .opt-impact-card span { display: block; font-size: 10px; text-transform: uppercase; color: var(--text-muted); margin-bottom: 4px; font-weight: 600; letter-spacing: 0.04em; }
    .opt-impact-card strong { color: var(--teal); font-size: 15px; font-weight: 700; }
    .opt-ad-compare { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin: 18px 0; }
    .opt-ad-col {
      background: var(--bg-subtle);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px;
    }
    .opt-ad-col.current { border-left: 3px solid #dc2626; }
    .opt-ad-col.optimized { border-left: 3px solid #0d9488; }
    .opt-ad-col h4 { margin: 0 0 10px; font-size: 13px; font-weight: 700; }
    .opt-path { font-size: 11px; color: var(--text-muted); margin: 0 0 8px; }
    .opt-subtitle {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--accent);
      margin: 14px 0 6px;
      font-weight: 700;
    }
    .opt-headlines, .opt-descriptions { margin: 0 0 10px; padding-left: 20px; font-size: 12px; color: var(--text); }
    .opt-headlines li, .opt-descriptions li { margin-bottom: 5px; line-height: 1.5; color: var(--text); }
    .opt-list-block { margin-bottom: 12px; }
    .opt-list-block ul { margin: 4px 0 0; padding-left: 20px; font-size: 12px; color: var(--text); }
    .opt-list-block li { margin-bottom: 4px; line-height: 1.5; color: var(--text); }
    .opt-reasoning, .opt-strategy, .opt-perf {
      margin-top: 18px;
      padding-top: 16px;
      border-top: 1px solid var(--border);
    }
    .opt-reason-row { margin-bottom: 12px; }
    .opt-reason-label { display: block; font-size: 10px; text-transform: uppercase; color: var(--accent); margin-bottom: 4px; font-weight: 700; letter-spacing: 0.06em; }
    .opt-reason-row p { margin: 0; font-size: 13px; color: var(--text); line-height: 1.6; }
    .opt-strategy p, .opt-adgroup p { font-size: 13px; color: var(--text); margin: 0 0 6px; }
    .opt-perf-table { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 10px; }
    .opt-perf-table th, .opt-perf-table td {
      border: 1px solid var(--border);
      padding: 8px 10px;
      text-align: left;
      color: var(--text);
    }
    .opt-perf-table th { background: var(--bg-subtle); color: var(--heading); font-weight: 700; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; }
    .opt-perf-table td.est { color: var(--teal); font-weight: 700; }
    .opt-perf-table tbody tr:nth-child(even) { background: #fafbfc; }
    .footer {
      margin-top: 48px;
      padding-top: 16px;
      border-top: 1px solid var(--border);
      font-size: 11px;
      color: var(--text-muted);
      text-align: center;
    }
    @media (max-width: 800px) {
      .metrics, .roadmap, .opt-ad-compare, .opt-impact-grid { grid-template-columns: 1fr; }
    }
    @media print {
      .toolbar { display: none !important; }
      .wrap { padding: 0; max-width: none; }
      .optimization-block, .finding { break-inside: avoid; }
    }
  </style>
</head>
<body>
  <div class="toolbar no-print">
    <strong>AdAudit Pro Report</strong>
    <button type="button" onclick="window.print()">Print / Save as PDF</button>
  </div>
  <div class="wrap">
    <header class="report-header">
      <div class="brand">AdAudit Pro</div>
      <div style="margin-bottom:12px">
        <span class="badge">${scope === 'campaign' ? 'Campaign Audit' : 'Account Audit'}</span>
        <span class="badge teal">Claude AI Analysis</span>
      </div>
      <h1><span class="accent">${escapeHtml(title)}</span></h1>
      <p class="meta-line">
        ${scope === 'campaign' ? `Account: ${escapeHtml(accountLabel)} · ` : ''}
        Generated ${escapeHtml(generatedAt)} · ${audit.dataWindowDays}-day data window · Engine v${escapeHtml(audit.engineVersion)}
        ${audit.goal ? ` · Goal: ${escapeHtml(audit.goal)}` : ''}
      </p>
    </header>

    <div class="metrics">
      <div class="metric"><div class="metric-value" style="color:var(--accent)">${validFindings.length}</div><div class="metric-label">Findings</div></div>
      <div class="metric"><div class="metric-value" style="color:var(--teal)">${formatMoney(totalImpact)}</div><div class="metric-label">Monthly Impact</div></div>
      <div class="metric"><div class="metric-value" style="color:var(--teal)">${formatMoney(totalImpact * 12)}</div><div class="metric-label">Annual Opportunity</div></div>
      <div class="metric"><div class="metric-value">${healthScore}/100</div><div class="metric-label">Health Score</div></div>
    </div>

    <h2>Executive Summary</h2>
    <div class="summary">${summaryParagraphs}</div>

    <h2>Account Health Breakdown</h2>
    <div class="health-grid">${healthHtml}</div>

    <h2>Module Findings (Claude)</h2>
    ${modulesHtml}

    ${renderOptimizationsSection(audit, optimizations)}

    <h2>30 / 60 / 90-Day Growth Roadmap</h2>
    <div class="roadmap">
      ${renderRoadmapColumn('30-Day Sprint', '#FF6B6B', roadmap30)}
      ${renderRoadmapColumn('60-Day Build', '#FF6B2B', roadmap60)}
      ${renderRoadmapColumn('90-Day Scale', '#00C9A7', roadmap90)}
    </div>

    <div class="footer">
      Generated by AdAudit Pro • ${escapeHtml(env.clientUrl || 'https://adaudit.pro')}
      • ${validFindings.length} findings across ${moduleGroups.length} modules
      ${optimizations.length ? ` • ${optimizations.length} Make It Better optimization${optimizations.length === 1 ? '' : 's'}` : ''}
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
        await page.emulateMediaType('screen');
        await page.setContent(html, { waitUntil: 'load' });
        const pdf = await page.pdf({
          format: 'A4',
          printBackground: true,
          preferCSSPageSize: false,
          margin: { top: '16mm', bottom: '16mm', left: '14mm', right: '14mm' },
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
  const { getOptimizationsForAuditReport } = await import('./aiOptimization.service.js');
  const optimizations = await getOptimizationsForAuditReport(audit.id);
  const html = buildReportHtml(audit, optimizations);
  const pdf = await tryRenderPdf(html);
  if (pdf) return { buffer: pdf, isPdf: true };
  return { buffer: Buffer.from(html, 'utf-8'), isPdf: false };
}
