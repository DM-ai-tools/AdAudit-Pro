import { existsSync } from 'fs';
import type { AuditRun, Finding, RoadmapItem } from '../types/index.js';
import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import { getMockCampaigns } from '../data/google-ads-campaigns.js';
import { fetchCampaignsForAccount, type CampaignDto } from './google-ads.service.js';
import {
  groupFindingsByModule,
  inferAuditScope,
  isFailureFinding,
  reportTitle,
} from '../utils/report-findings.js';
import type { AuditReportOptimization } from './aiOptimization.service.js';
import type { OptimizedAdContent, CurrentAdData } from './aiOptimization.service.js';
import { listCampaignWizardActivitiesForReport } from './campaign-wizard-activity.service.js';
import type { PublishedAdHistoryItem } from './googleAdsPublishing.service.js';

const CHROME_CANDIDATES = [
  process.env.PUPPETEER_EXECUTABLE_PATH,
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter((p): p is string => Boolean(p));

const PDF_RENDER_TIMEOUT_MS = 12_000;

function withRenderTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`PDF render timed out after ${ms}ms`)), ms)
    ),
  ]);
}

async function loadCampaignsForReport(audit: AuditRun): Promise<CampaignDto[]> {
  const customerId = audit.googleAdsCustomerId?.replace(/\D/g, '');
  if (!customerId) return [];

  try {
    if (env.useMockData) {
      const mockCampaigns = getMockCampaigns(customerId);
      if (mockCampaigns.length) return mockCampaigns;
      // Real connected accounts often won't match demo mock IDs — fetch live ads for the report.
    }
    const user = await prisma.user.findUnique({
      where: { id: audit.userId },
      select: { googleRefreshToken: true },
    });
    if (!user?.googleRefreshToken) {
      if (env.useMockData) return getMockCampaigns('1234567890');
      return [];
    }
    return await withRenderTimeout(
      fetchCampaignsForAccount(user.googleRefreshToken, customerId, audit.userId, {
        dateWindowDays: audit.dataWindowDays ?? 30,
      }),
      18_000
    );
  } catch (err) {
    console.warn(
      '[pdf] campaign inventory skipped:',
      err instanceof Error ? err.message : err
    );
    if (env.useMockData) return getMockCampaigns('1234567890');
    return [];
  }
}

function renderAuditActivitySection(audit: AuditRun): string {
  const logs = audit.logs ?? [];
  const modules = audit.modules ?? [];

  const moduleRows = modules
    .map(
      (m) => `<tr>
        <td>${escapeHtml(m.name)}</td>
        <td>${escapeHtml(m.status)}</td>
        <td>${m.progress}%</td>
        <td>${m.findingsCount}</td>
      </tr>`
    )
    .join('');

  const logItems = logs.length
    ? logs
        .slice(-40)
        .map(
          (log) =>
            `<li><span class="log-time">${escapeHtml(new Date(log.createdAt).toLocaleString())}</span> <span class="log-level">${escapeHtml(log.level)}</span> ${escapeHtml(log.message)}</li>`
        )
        .join('')
    : '<li class="muted">No audit activity logs recorded for this run.</li>';

  return `
    <h2>Audit Activity</h2>
    <p class="module-sub">Module execution status and audit engine timeline</p>
    ${
      modules.length
        ? `<table class="opt-perf-table">
            <thead><tr><th>Module</th><th>Status</th><th>Progress</th><th>Findings</th></tr></thead>
            <tbody>${moduleRows}</tbody>
          </table>`
        : '<p class="muted">Module breakdown not available.</p>'
    }
    <div class="opt-list-block" style="margin-top:16px">
      <p class="opt-subtitle">Activity log (${logs.length} entries)</p>
      <ul class="activity-log">${logItems}</ul>
    </div>`;
}

function renderCampaignInventorySection(campaigns: CampaignDto[]): string {
  if (!campaigns.length) {
    return `
      <h2>Google Ads Campaign Inventory</h2>
      <p class="muted">No live campaign data was available when this report was generated. Connect Google Ads and re-download to include current ads.</p>`;
  }

  const blocks = campaigns
    .map((campaign) => {
      const ads = campaign.ads ?? [];
      const adBlocks = ads
        .slice(0, 40)
        .map((ad) => {
          const headlines = asStringList(ad.headlines);
          const descriptions = asStringList(ad.descriptions);
          return `
            <div class="campaign-ad-card">
              <p><strong>${escapeHtml(ad.adGroupName ?? 'Ad group')}</strong> · ${escapeHtml(ad.status ?? '—')} · ${escapeHtml(ad.adStrength ?? '—')} strength</p>
              ${ad.finalUrls?.[0] ? `<p class="opt-path">URL: ${escapeHtml(ad.finalUrls[0])}</p>` : ''}
              ${renderStringList('Headlines', headlines, 15)}
              ${renderStringList('Descriptions', descriptions, 4)}
              <p class="opt-path">Impr ${ad.impressions?.toLocaleString() ?? '—'} · Clicks ${ad.clicks?.toLocaleString() ?? '—'} · CTR ${ad.ctr != null ? `${ad.ctr}%` : '—'}</p>
            </div>`;
        })
        .join('');

      return `
        <article class="campaign-block">
          <h3>${escapeHtml(campaign.name)}</h3>
          <p class="opt-campaign">${escapeHtml(campaign.type.replace(/_/g, ' '))} · ${escapeHtml(campaign.status)} · Budget ${campaign.budgetDaily != null ? formatMoney(campaign.budgetDaily) + '/day' : '—'}</p>
          <p class="opt-path">Impressions ${campaign.impressions?.toLocaleString() ?? '—'} · Clicks ${campaign.clicks?.toLocaleString() ?? '—'} · Cost ${campaign.cost != null ? formatMoney(campaign.cost) : '—'} · ${campaign.adCount ?? ads.length} ad(s)</p>
          ${adBlocks || '<p class="muted">No responsive search ads in this campaign.</p>'}
        </article>`;
    })
    .join('');

  return `
    <h2>Google Ads Campaign Inventory</h2>
    <p class="module-sub">${campaigns.length} campaign${campaigns.length === 1 ? '' : 's'} with live ad copy and ${campaigns.reduce((s, c) => s + (c.ads?.length ?? 0), 0)} RSA snapshot(s)</p>
    ${blocks}`;
}

function snapshotToAdCopy(raw: unknown): AdCopyColumnData {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const displayPaths =
    obj.displayPaths && typeof obj.displayPaths === 'object'
      ? (obj.displayPaths as { path1?: string; path2?: string })
      : {};
  const finalUrls = asStringList(obj.finalUrls);
  return {
    headlines: asStringList(obj.headlines),
    longHeadlines: asStringList(obj.longHeadlines),
    descriptions: asStringList(obj.descriptions),
    displayPath1:
      (typeof obj.displayPath1 === 'string' ? obj.displayPath1 : undefined) ?? displayPaths.path1,
    displayPath2:
      (typeof obj.displayPath2 === 'string' ? obj.displayPath2 : undefined) ?? displayPaths.path2,
    finalUrl:
      (typeof obj.finalUrl === 'string' ? obj.finalUrl : undefined) ?? finalUrls[0],
  };
}

function renderPublishedActivityHtml(
  activity: AuditReportOptimization['publishedActivity']
): string {
  if (!activity?.length) return '';
  const blocks = activity
    .map((a) => {
      const original = snapshotToAdCopy(a.originalAd);
      const published = snapshotToAdCopy(a.publishedAd);
      const hasCopy = original.headlines.length || published.headlines.length;
      return `
        <div class="campaign-ad-card">
          <p><strong>${escapeHtml(a.status)}</strong>
            ${a.campaignName ? ` · ${escapeHtml(a.campaignName)}` : ''}
            · ${a.publishedAt ? escapeHtml(new Date(a.publishedAt).toLocaleString()) : escapeHtml(new Date(a.createdAt).toLocaleString())}
            · Rollback ${a.rollbackAvailable ? 'available' : 'no'}</p>
          ${a.errorMessage ? `<p class="opt-path">Notes: ${escapeHtml(a.errorMessage)}</p>` : ''}
          ${
            hasCopy
              ? `<div class="opt-ad-compare">
                  ${renderAdCopyColumn('Original / previous ad', original, 'current')}
                  ${renderAdCopyColumn('Published ad copy', published, 'optimized')}
                </div>`
              : '<p class="muted">Published copy snapshot was not stored for this version.</p>'
          }
        </div>`;
    })
    .join('');
  return `
    <div class="opt-perf">
      <p class="opt-subtitle">Published ad copy</p>
      ${blocks}
    </div>`;
}

function renderCompetitorProfilesHtml(competitorAnalysis?: AuditReportOptimization['competitorAnalysis']): string {
  const competitors = competitorAnalysis?.competitors ?? [];
  if (!competitors.length) return '';

  const cards = competitors
    .slice(0, 30)
    .map((c) => {
      const name = asDisplayText(c.name, 'Competitor');
      return `
        <div class="opt-competitor-card">
          <h4 style="color:#7c3aed">${escapeHtml(name)}</h4>
          ${c.url ? `<p class="opt-path">${escapeHtml(c.url)}</p>` : ''}
          <p class="opt-path">Ads: ${c.totalAdCount ?? '—'} total · ${c.activeAdCount ?? '—'} active · ${c.adDurationDays ?? '—'} days · Confidence ${c.confidenceScore ?? '—'}/100</p>
          ${renderStringList('Headlines', asStringList(c.headlines), 15)}
          ${renderStringList('Offers', asStringList(c.offers), 10)}
          ${renderStringList('Key messages', asStringList(c.keyMessages), 10)}
        </div>`;
    })
    .join('');

  return `
    <div class="opt-competitor-section">
      <p class="opt-subtitle">Ranked competitors (${competitors.length})</p>
      <div class="opt-competitor-grid">${cards}</div>
    </div>`;
}

function renderVariationBlocks(
  variations: OptimizedAdContent[] | undefined,
  original: CurrentAdData
): string {
  if (!variations?.length) return '';
  return variations
    .map((v, i) => {
      const adCopy = resolveAdCopyForReport(original, v);
      const label = v.variationLabel ?? v.focusedCompetitor ?? `Variation ${i + 2}`;
      return `
        <div class="opt-variation-block">
          <p class="opt-subtitle">${escapeHtml(label)}</p>
          ${renderAdCopyColumn('AI Variation', adCopy.optimized, 'optimized')}
        </div>`;
    })
    .join('');
}

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

function renderEvidence(evidence?: Record<string, unknown>): string {
  if (!evidence || typeof evidence !== 'object') return '';
  const rows = Object.entries(evidence)
    .filter(([, v]) => v != null && v !== '')
    .slice(0, 20)
    .map(([key, value]) => {
      const label = key.replace(/_/g, ' ');
      let text = '';
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        text = String(value);
      } else if (Array.isArray(value)) {
        text = value.map((item) => asDisplayText(item, '')).filter(Boolean).join(', ');
      } else if (typeof value === 'object') {
        text = asDisplayText(value, JSON.stringify(value));
      }
      if (!text) return '';
      return `<tr><td>${escapeHtml(label)}</td><td>${escapeHtml(text)}</td></tr>`;
    })
    .filter(Boolean)
    .join('');
  if (!rows) return '';
  return `
    <table class="opt-perf-table" style="margin-top:10px">
      <thead><tr><th>Evidence</th><th>Detail</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
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
      ${renderEvidence(f.evidence)}
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

interface PdfCompetitorAdPreview {
  name?: string;
  url?: string;
  headlines?: unknown;
  descriptions?: unknown;
  adSource?: string;
  adLink?: string;
  transparencyUrl?: string;
  creativeUrl?: string;
}

interface PdfGapRow {
  category?: string;
  competitor?: string;
  competitorHas?: string;
  youHave?: string;
  gap?: string;
}

function renderCompetitorAdGalleryHtml(
  galleryRaw: unknown,
  fallbackInsights: OptimizedAdContent['competitorInsights']
): string {
  const gallery = Array.isArray(galleryRaw) ? (galleryRaw as PdfCompetitorAdPreview[]) : [];
  const cardsFromGallery = gallery
    .map((ad) => {
      const name = asDisplayText(ad.name, 'Competitor');
      const website = asDisplayText(ad.url);
      const rawSource = asDisplayText(ad.adSource).replace(/_/g, ' ').toLowerCase();
      const source =
        rawSource.includes('sociavault') || rawSource.includes('transparency')
          ? 'Live competitor ad'
          : rawSource.includes('website')
            ? 'Website'
            : rawSource
              ? 'Live competitor ad'
              : '';
      const adLink = asDisplayText(ad.adLink) || asDisplayText(ad.transparencyUrl) || asDisplayText(ad.creativeUrl);
      const headlines = asStringList(ad.headlines);
      const descriptions = asStringList(ad.descriptions);
      if (!headlines.length && !descriptions.length) return '';
      return `
        <div class="opt-competitor-card">
          <h4 style="color:#7c3aed">${escapeHtml(name)}</h4>
          ${website ? `<p class="opt-path">Website: ${escapeHtml(website)}</p>` : ''}
          ${source ? `<p class="opt-path">Source: ${escapeHtml(source)}</p>` : ''}
          ${adLink ? `<p class="opt-path">Ad link: ${escapeHtml(adLink)}</p>` : ''}
          ${renderStringList('Headlines', headlines, 15)}
          ${renderStringList('Descriptions', descriptions, 8)}
        </div>`;
    })
    .filter(Boolean)
    .join('');

  if (cardsFromGallery) {
    return `
      <div class="opt-competitor-section">
        <p class="opt-subtitle">Competitor Ad Gallery</p>
        <div class="opt-competitor-grid">${cardsFromGallery}</div>
      </div>`;
  }

  const cardsFromInsights = (fallbackInsights ?? [])
    .map(
      (c) => `
      <div class="opt-competitor-card">
        <h4 style="color:#7c3aed">${escapeHtml(c.name)}</h4>
        ${c.url ? `<p class="opt-path">Website: ${escapeHtml(c.url)}</p>` : ''}
        ${renderStringList('Key messages', asStringList(c.keyMessages), 5)}
        ${renderStringList('Offers', asStringList(c.offers), 5)}
        ${renderStringList('Keyword opportunities', asStringList(c.keywordOpportunities), 8)}
      </div>`
    )
    .join('');

  return cardsFromInsights
    ? `
      <div class="opt-competitor-section">
        <p class="opt-subtitle">Competitor Insights</p>
        <div class="opt-competitor-grid">${cardsFromInsights}</div>
      </div>`
    : '';
}

function renderGapAnalysisHtml(gapRowsRaw: unknown): string {
  const rows = Array.isArray(gapRowsRaw) ? (gapRowsRaw as PdfGapRow[]) : [];
  if (!rows.length) return '';
  const body = rows
    .map((row) => {
      const category = asDisplayText(row.category, '—').replace(/_/g, ' ');
      const competitor = asDisplayText(row.competitor, '—');
      const competitorHas = asDisplayText(row.competitorHas, '—');
      const youHave = asDisplayText(row.youHave, '—');
      const gap = asDisplayText(row.gap, '—');
      return `<tr>
        <td>${escapeHtml(category)}</td>
        <td>${escapeHtml(competitor)}</td>
        <td>${escapeHtml(competitorHas)}</td>
        <td>${escapeHtml(youHave)}</td>
        <td>${escapeHtml(gap)}</td>
      </tr>`;
    })
    .join('');
  return `
    <div class="opt-perf">
      <p class="opt-subtitle">Competitor Gap Analysis</p>
      <table class="opt-perf-table opt-gap-table">
        <thead><tr><th>Category</th><th>Competitor</th><th>Competitor Has</th><th>You Have</th><th>Gap</th></tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>`;
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

function renderCompetitorInsightsHtml(optimized: OptimizedAdContent): string {
  const insights = optimized.competitorInsights ?? [];
  const missing = asStringList(optimized.missingCompetitorAdvantages);
  const outperform = optimized.strategistReasoning?.competitiveOutperformance;

  const cards = insights.length ? renderCompetitorAdGalleryHtml([], insights) : '';

  const outperformHtml = outperform
    ? `
      <div class="opt-reasoning">
        <p class="opt-subtitle">Why This Ad Will Outperform Competitors</p>
        ${[
          { label: 'Messaging', text: outperform.messagingImprovements },
          { label: 'Keywords', text: outperform.keywordImprovements },
          { label: 'Offers', text: outperform.offerImprovements },
          { label: 'Conversions', text: outperform.conversionImprovements },
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
      </div>`
    : '';

  if (!cards && !missing.length && !outperformHtml) return '';

  return `
    ${cards}
    ${outperformHtml}
    ${missing.length ? `<div class="opt-missing-advantages"><p class="opt-subtitle">Competitor Advantages Missing From Your Ads</p><ul class="opt-list-block">${missing.map((m) => `<li style="color:#1e293b">${escapeHtml(m)}</li>`).join('')}</ul></div>` : ''}`;
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
  const competitorGalleryHtml = renderCompetitorAdGalleryHtml(
    opt.competitorAnalysis?.adGallery,
    optimized.competitorInsights
  );
  const gapAnalysisHtml = renderGapAnalysisHtml(opt.competitorAnalysis?.gapAnalysis?.rows);
  const competitorProfilesHtml = renderCompetitorProfilesHtml(opt.competitorAnalysis);
  const variationsHtml = renderVariationBlocks(opt.optimizedVariations, original);
  const publishedHtml = renderPublishedActivityHtml(opt.publishedActivity);
  const extraOptHtml = [
    renderStringList('Keyword improvements', asStringList(optimized.keywordImprovements), 40),
    renderStringList('Negative keyword suggestions', asStringList(optimized.negativeKeywordSuggestions), 40),
    renderStringList('Landing page recommendations', asStringList(optimized.landingPageRecommendations), 20),
  ].join('');
  const explanation = optimized.adGenerationExplanation;
  const explanationHtml = explanation
    ? `
      <div class="opt-reasoning">
        <p class="opt-subtitle">Why this ad was generated</p>
        ${optimized.adDifferenceScore != null ? `<p><strong>Ad difference score:</strong> ${escapeHtml(String(optimized.adDifferenceScore))}/100</p>` : ''}
        ${renderStringList('Competitor signals used', asStringList(explanation.competitorSignalsUsed), 20)}
        ${renderStringList('Offers used', asStringList(explanation.offersUsed), 12)}
        ${renderStringList('Trust signals used', asStringList(explanation.trustSignalsUsed), 12)}
        ${renderStringList('Keywords used', asStringList(explanation.keywordsUsed), 20)}
        ${
          explanation.topCompetitorsInfluencing?.length
            ? `<p class="opt-subtitle">Top competitors influencing copy</p><ul>${explanation.topCompetitorsInfluencing
                .map(
                  (c) =>
                    `<li>${escapeHtml(c.name)} — ${escapeHtml(String(c.influencePercent))}% · ${escapeHtml(c.reason)}</li>`
                )
                .join('')}</ul>`
            : ''
        }
      </div>`
    : '';
  const accountImpact = optimized.accountImpact;
  const accountImpactHtml = accountImpact
    ? `
      <div class="opt-impact-grid">
        ${accountImpact.currentAccountHealth != null || accountImpact.predictedAccountHealth != null
          ? `<div class="opt-impact-card"><span>Account health</span><strong>${escapeHtml(String(accountImpact.currentAccountHealth ?? '—'))} → ${escapeHtml(String(accountImpact.predictedAccountHealth ?? '—'))}</strong></div>`
          : ''}
        ${accountImpact.currentMonthlyLeads || accountImpact.estimatedMonthlyLeads
          ? `<div class="opt-impact-card"><span>Monthly leads</span><strong>${escapeHtml(accountImpact.currentMonthlyLeads ?? '—')} → ${escapeHtml(accountImpact.estimatedMonthlyLeads ?? '—')}</strong></div>`
          : ''}
        ${accountImpact.currentRoas || accountImpact.estimatedRoas
          ? `<div class="opt-impact-card"><span>ROAS</span><strong>${escapeHtml(accountImpact.currentRoas ?? '—')} → ${escapeHtml(accountImpact.estimatedRoas ?? '—')}</strong></div>`
          : ''}
      </div>`
    : '';

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
      ${accountImpactHtml}
      ${perfHtml}
      <div class="opt-ad-compare">
        ${renderAdCopyColumn('Current Ad', adCopy.current, 'current')}
        ${renderAdCopyColumn('AI Optimized Ad', adCopy.optimized, 'optimized')}
      </div>
      ${variationsHtml}
      ${renderStringList('CTA suggestions', asStringList(optimized.ctaSuggestions))}
      ${renderStringList('Keyword suggestions', asStringList(optimized.keywordSuggestions))}
      ${extensionsHtml}
      ${extraOptHtml}
      ${explanationHtml}
      ${competitorGalleryHtml}
      ${competitorProfilesHtml}
      ${gapAnalysisHtml}
      ${publishedHtml}
      ${renderCompetitorInsightsHtml(optimized)}
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
    <p class="module-sub">${optimizations.length} AI-generated optimization${optimizations.length === 1 ? '' : 's'} included in this report</p>
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

function renderWizardStep(num: string, title: string, body: string): string {
  if (!body.trim()) return '';
  return `
    <div class="wizard-step">
      <p class="opt-subtitle"><span class="wizard-step-num">${escapeHtml(num)}</span> ${escapeHtml(title)}</p>
      ${body}
    </div>`;
}

function renderWizardCompetitorCard(c: {
  name: string;
  url?: string;
  isMostRelevant?: boolean;
  adCount?: number;
  activeAdCount?: number;
  adDurationDays?: number;
  confidenceScore?: number;
  sampleHeadlines?: string[];
  headlines?: string[];
  descriptions?: string[];
  ads?: Array<{ headlines?: string[]; descriptions?: string[] }>;
}): string {
  const headlines = asStringList(c.headlines?.length ? c.headlines : c.sampleHeadlines);
  const descriptions = asStringList(c.descriptions);
  const nestedAds = (c.ads ?? [])
    .map((ad, i) => {
      const h = asStringList(ad.headlines);
      const d = asStringList(ad.descriptions);
      if (!h.length && !d.length) return '';
      return `
        <div class="campaign-ad-card">
          <p><strong>Competitor ad ${i + 1}</strong></p>
          ${renderStringList('Headlines', h, 15)}
          ${renderStringList('Descriptions', d, 8)}
        </div>`;
    })
    .join('');
  return `
    <div class="opt-competitor-card">
      <h4 style="color:#7c3aed">${escapeHtml(c.name)}${c.isMostRelevant ? ' · Most relevant' : ''}</h4>
      ${c.url ? `<p class="opt-path">${escapeHtml(c.url)}</p>` : ''}
      <p class="opt-path">Ads: ${c.adCount ?? '—'} total · ${c.activeAdCount ?? '—'} active · ${c.adDurationDays ?? '—'} days · Confidence ${c.confidenceScore ?? '—'}</p>
      ${renderStringList('Headlines', headlines, 15)}
      ${renderStringList('Descriptions', descriptions, 8)}
      ${nestedAds}
    </div>`;
}

function renderWizardActivitySection(
  activities: Awaited<ReturnType<typeof listCampaignWizardActivitiesForReport>>
): string {
  if (!activities.length) {
    return `
    <h2>Created Campaign — Service → Competitor → Keyword → Ad</h2>
    <p class="muted">No Create Campaign or Create Ad wizard runs were saved for this audit yet. Complete the wizard from the dashboard and download the report again to include the full process, competitor ads, keywords, and published copy.</p>`;
  }

  const blocks = activities
    .map((a) => {
      const p = a.process;
      const servicesSelected = (p.services?.selected ?? []).map((s) => escapeHtml(s)).join(', ');
      const servicesSkipped = (p.services?.discovered ?? [])
        .filter((d) => !(p.services?.selected ?? []).includes(d))
        .map((s) => escapeHtml(s))
        .join(', ');

      const competitorBlocks = (p.competitors?.byService ?? [])
        .map((svc) => {
          const cards = (svc.competitors ?? []).map((c) => renderWizardCompetitorCard(c)).join('');
          return `
            <p class="opt-subtitle">${escapeHtml(svc.service)} — ${svc.competitors?.length ?? 0} competitor${
              (svc.competitors?.length ?? 0) === 1 ? '' : 's'
            }</p>
            <div class="opt-competitor-grid">${cards || '<p class="muted">None</p>'}</div>`;
        })
        .join('');

      const kwSelected = (p.keywords?.selected ?? [])
        .map(
          (k) =>
            `<tr><td>${escapeHtml(k.keyword)}</td><td>${escapeHtml(k.matchType ?? '—')}</td><td>${
              k.maxCpc != null ? escapeHtml(String(k.maxCpc)) : '—'
            }</td><td>${escapeHtml(k.role ?? '—')}</td><td>${k.volume != null ? escapeHtml(String(k.volume)) : '—'}</td><td>${escapeHtml(k.seed ?? '—')}</td></tr>`
        )
        .join('');
      const kwSkipped = (p.keywords?.skipped ?? []).map((k) => escapeHtml(k)).join(', ');
      const strategyRows = (p.keywords?.bidStrategyAlternatives ?? [])
        .map(
          (s) =>
            `<li>${s.chosen ? '<strong>✓ Chosen: </strong>' : 'Not chosen: '}${escapeHtml(s.label)}${
              s.why ? ` — ${escapeHtml(s.why)}` : ''
            }</li>`
        )
        .join('');
      const clusterBlocks = (p.keywords?.clusters ?? [])
        .map((cluster) => {
          const rows = (cluster.keywords ?? [])
            .map(
              (k) =>
                `<tr><td>${escapeHtml(k.keyword)}</td><td>${k.selected === false ? 'Skipped' : 'Selected'}</td><td>${escapeHtml(
                  k.matchType ?? '—'
                )}</td><td>${k.maxCpc != null ? escapeHtml(String(k.maxCpc)) : '—'}</td><td>${
                  k.volume != null ? escapeHtml(String(k.volume)) : '—'
                }</td></tr>`
            )
            .join('');
          return `
            <p class="opt-subtitle">${escapeHtml(cluster.service)}${
              cluster.topKeyword ? ` · top: ${escapeHtml(cluster.topKeyword)}` : ''
            }</p>
            ${
              rows
                ? `<table class="opt-perf-table"><thead><tr><th>Keyword</th><th>Status</th><th>Match</th><th>Max CPC</th><th>Volume</th></tr></thead><tbody>${rows}</tbody></table>`
                : ''
            }`;
        })
        .join('');

      const variantBlocks = (p.ads?.generatedVariants ?? [])
        .map((v) => {
          const copy = snapshotToAdCopy({
            headlines: v.headlines,
            descriptions: v.descriptions,
            displayPaths: v.displayPaths,
            finalUrl: v.finalUrl ?? p.ads?.selected?.finalUrl,
          });
          const hasCopy = copy.headlines.length || copy.descriptions.length;
          return `
            <div class="opt-variation-block">
              <p class="opt-subtitle">${v.chosen ? '✓ Selected — ' : ''}${escapeHtml(v.label || v.id)}</p>
              ${v.focusedCompetitor ? `<p class="opt-path">Focused competitor: ${escapeHtml(v.focusedCompetitor)}</p>` : ''}
              ${renderStringList('Keywords on this ad', asStringList(v.keywords), 30)}
              ${hasCopy ? renderAdCopyColumn(v.chosen ? 'Published / selected copy' : 'Generated variant', copy, v.chosen ? 'optimized' : 'current') : '<p class="muted">Copy for this variant was not stored.</p>'}
            </div>`;
        })
        .join('');

      const selectedAd = p.ads?.selected;
      const selectedCopy = selectedAd
        ? renderAdCopyColumn(
            'Published ad copy (created in Google Ads, paused)',
            snapshotToAdCopy({
              headlines: selectedAd.headlines,
              descriptions: selectedAd.descriptions,
              displayPaths: selectedAd.displayPaths,
              finalUrl: selectedAd.finalUrl,
            }),
            'optimized'
          )
        : '';

      const approvalRows = p.approvals
        ? Object.entries(p.approvals)
            .map(([key, ok]) => `<li>${ok ? '✓' : '○'} ${escapeHtml(key.replace(/([A-Z])/g, ' $1'))}</li>`)
            .join('')
        : '';

      return `
      <article class="campaign-block campaign-block-full">
        <h3>${escapeHtml(a.title)}</h3>
        <p class="opt-campaign">${escapeHtml(a.mode === 'ad' ? 'Create Ad' : 'Create Campaign')} · ${escapeHtml(
          a.stage
        )} · ${escapeHtml(new Date(a.createdAt).toLocaleString())}</p>
        ${a.summary ? `<p>${escapeHtml(a.summary)}</p>` : ''}
        ${a.campaignName ? `<p class="opt-path">Campaign: ${escapeHtml(a.campaignName)}</p>` : ''}
        ${
          a.campaignResourceName
            ? `<p class="opt-path">Campaign resource: ${escapeHtml(a.campaignResourceName)}</p>`
            : ''
        }
        ${a.adResourceName ? `<p class="opt-path">Ad resource: ${escapeHtml(a.adResourceName)}</p>` : ''}

        ${renderWizardStep('Process', 'Steps completed', `<ul>${(p.stepsCompleted ?? []).map((s) => `<li>${escapeHtml(s)}</li>`).join('') || '<li class="muted">—</li>'}</ul>`)}

        ${renderWizardStep(
          '1',
          'Services discovered & selected',
          p.services
            ? `${p.services.companyName ? `<p><strong>Company:</strong> ${escapeHtml(p.services.companyName)}</p>` : ''}
               ${p.services.industry ? `<p><strong>Industry:</strong> ${escapeHtml(p.services.industry)}</p>` : ''}
               <p><strong>Selected services:</strong> ${servicesSelected || '—'}</p>
               ${servicesSkipped ? `<p><strong>Discovered but not chosen:</strong> ${servicesSkipped}</p>` : ''}
               ${renderStringList('All discovered services', p.services.discovered ?? [], 40)}
               <p class="muted">${escapeHtml(p.services.why)}</p>`
            : ''
        )}

        ${renderWizardStep(
          '2',
          'Competitor ads by service',
          p.competitors
            ? `${competitorBlocks || '<p class="muted">—</p>'}<p class="muted">${escapeHtml(p.competitors.why)}</p>`
            : ''
        )}

        ${renderWizardStep(
          '3',
          'Keywords & bidding',
          p.keywords
            ? `<p><strong>Daily budget:</strong> ${
                p.keywords.dailyBudget != null ? formatMoney(p.keywords.dailyBudget) + '/day' : '—'
              } · <strong>Strategy:</strong> ${escapeHtml(p.keywords.bidStrategy ?? '—')}
              ${p.keywords.recommendedCount != null ? ` · <strong>Recommended keyword count:</strong> ${p.keywords.recommendedCount}` : ''}</p>
               ${strategyRows ? `<ul>${strategyRows}</ul>` : ''}
               ${clusterBlocks}
               ${
                 kwSelected
                   ? `<p class="opt-subtitle">Selected keywords (${p.keywords.selected.length})</p>
                      <table class="opt-perf-table"><thead><tr><th>Keyword</th><th>Match</th><th>Max CPC</th><th>Role</th><th>Volume</th><th>Seed</th></tr></thead><tbody>${kwSelected}</tbody></table>`
                   : ''
               }
               ${kwSkipped ? `<p><strong>Not selected (over budget / lower priority):</strong> ${kwSkipped}</p>` : ''}
               ${
                 p.keywords.negatives?.length
                   ? renderStringList('Negative keywords', p.keywords.negatives, 80)
                   : ''
               }
               <p class="muted">${escapeHtml(p.keywords.why)}</p>`
            : ''
        )}

        ${renderWizardStep(
          '4',
          'Campaign settings',
          p.campaign
            ? `<p>${escapeHtml(p.campaign.name ?? '—')} · ${escapeHtml(p.campaign.type ?? '—')} · ${
                p.campaign.dailyBudget != null ? formatMoney(p.campaign.dailyBudget) + '/day' : '—'
              } · ${escapeHtml(p.campaign.biddingStrategy ?? '—')}</p>
               ${
                 p.campaign.locations
                   ? `<p class="opt-path">Locations: ${escapeHtml(p.campaign.locations)}</p>`
                   : ''
               }
               ${
                 p.campaign.resourceName
                   ? `<p class="opt-path">Resource: ${escapeHtml(p.campaign.resourceName)}</p>`
                   : ''
               }
               <p class="muted">${escapeHtml(p.campaign.why)}</p>
               ${approvalRows ? `<p class="opt-subtitle">Approvals</p><ul>${approvalRows}</ul>` : ''}`
            : ''
        )}

        ${renderWizardStep(
          '5',
          'Generated ads & published copy',
          p.ads
            ? `${p.ads.offer ? `<p><strong>Offer:</strong> ${escapeHtml(p.ads.offer)}</p>` : ''}
               ${p.ads.audience ? `<p><strong>Audience:</strong> ${escapeHtml(p.ads.audience)}</p>` : ''}
               ${p.ads.tone ? `<p><strong>Tone:</strong> ${escapeHtml(p.ads.tone)}</p>` : ''}
               ${selectedCopy}
               ${variantBlocks}
               <p class="muted">${escapeHtml(p.ads.why)}</p>`
            : ''
        )}

        ${
          p.googleResult
            ? `<p class="opt-subtitle">Google Ads result</p>
               ${p.googleResult.message ? `<p>${escapeHtml(p.googleResult.message)}</p>` : ''}
               ${p.googleResult.campaignResourceName ? `<p class="opt-path">Campaign: ${escapeHtml(p.googleResult.campaignResourceName)}</p>` : ''}
               ${p.googleResult.adGroupResourceName ? `<p class="opt-path">Ad group: ${escapeHtml(p.googleResult.adGroupResourceName)}</p>` : ''}
               ${p.googleResult.adResourceName ? `<p class="opt-path">Ad: ${escapeHtml(p.googleResult.adResourceName)}</p>` : ''}
               ${p.googleResult.keywordsAdded != null ? `<p class="opt-path">Keywords added: ${p.googleResult.keywordsAdded}</p>` : ''}`
            : ''
        }
      </article>`;
    })
    .join('');

  return `
    <h2>Created Campaign — Service → Competitor → Keyword → Ad</h2>
    <p class="module-sub">${activities.length} wizard run${
      activities.length === 1 ? '' : 's'
    } — full process: services, competitor ads, keywords, campaign settings, generated variants, and published ad copy</p>
    ${blocks}`;
}

function renderPublishedAdsSection(
  publishedAds: PublishedAdHistoryItem[],
  wizardActivities: Awaited<ReturnType<typeof listCampaignWizardActivitiesForReport>>
): string {
  const wizardPublished = wizardActivities
    .map((a) => {
      const selected = a.process.ads?.selected;
      if (!selected?.headlines?.length) return '';
      return `
        <article class="campaign-block campaign-block-full">
          <h3>${escapeHtml(a.campaignName || a.title)}</h3>
          <p class="opt-campaign">Create Campaign / Ad wizard · ${escapeHtml(a.stage)} · ${escapeHtml(
            new Date(a.createdAt).toLocaleString()
          )}</p>
          ${a.process.ads?.offer ? `<p class="opt-path">Offer: ${escapeHtml(a.process.ads.offer)}</p>` : ''}
          ${renderAdCopyColumn(
            'Published ad copy (wizard)',
            snapshotToAdCopy({
              headlines: selected.headlines,
              descriptions: selected.descriptions,
              displayPaths: selected.displayPaths,
              finalUrl: selected.finalUrl,
            }),
            'optimized'
          )}
          ${renderStringList('Keywords on published ad', asStringList(selected.keywords), 40)}
        </article>`;
    })
    .filter(Boolean)
    .join('');

  const makeItBetter = publishedAds
    .map((ad) => {
      const original = snapshotToAdCopy(ad.originalAd);
      const published = snapshotToAdCopy(ad.publishedAd);
      const sourceLabel = ad.source === 'manual_edit' ? 'Edit Ads' : 'Make It Better';
      return `
        <article class="campaign-block campaign-block-full">
          <h3>${escapeHtml(ad.campaignName || 'Published ad')}</h3>
          <p class="opt-campaign">${escapeHtml(sourceLabel)} · ${escapeHtml(ad.status)} · ${
            ad.publishedAt
              ? escapeHtml(new Date(ad.publishedAt).toLocaleString())
              : escapeHtml(new Date(ad.createdAt).toLocaleString())
          }${ad.scenario ? ` · ${escapeHtml(scenarioLabel(ad.scenario))}` : ''}</p>
          ${ad.newAdResourceName ? `<p class="opt-path">Ad resource: ${escapeHtml(ad.newAdResourceName)}</p>` : ''}
          <div class="opt-ad-compare">
            ${renderAdCopyColumn('Original / previous ad', original, 'current')}
            ${renderAdCopyColumn('Published ad copy', published, 'optimized')}
          </div>
          ${
            ad.liveMetrics
              ? `<p class="opt-path">Live: Impr ${ad.liveMetrics.impressions.toLocaleString()} · Clicks ${ad.liveMetrics.clicks.toLocaleString()} · CTR ${ad.liveMetrics.ctr}% · Cost ${formatMoney(ad.liveMetrics.cost)}</p>`
              : ''
          }
        </article>`;
    })
    .join('');

  if (!wizardPublished && !makeItBetter) {
    return `
      <h2>Published Ad Copy</h2>
      <p class="muted">No ads have been published or created from this audit yet. Publish from Make It Better, Edit Ads, or Create Campaign and download the report again.</p>`;
  }

  return `
    <h2>Published Ad Copy</h2>
    <p class="module-sub">Every created and published RSA from this audit — wizard ads plus Make It Better / Edit Ads versions</p>
    ${wizardPublished}
    ${makeItBetter}`;
}

export function buildReportHtml(
  audit: AuditRun,
  optimizations: AuditReportOptimization[] = [],
  campaigns: CampaignDto[] = [],
  wizardActivities: Awaited<ReturnType<typeof listCampaignWizardActivitiesForReport>> = [],
  publishedAds: PublishedAdHistoryItem[] = []
): string {
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
          <p class="module-sub">${group.findings.length} finding${group.findings.length === 1 ? '' : 's'}</p>
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
    .opt-competitor-section { margin-top: 18px; padding-top: 16px; border-top: 1px solid var(--border); }
    .opt-competitor-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 10px; }
    .opt-competitor-card {
      background: #faf5ff;
      border: 1px solid #e9d5ff;
      border-radius: 8px;
      padding: 14px;
    }
    .opt-competitor-card h4 { margin: 0 0 8px; font-size: 13px; }
    .opt-missing-advantages {
      margin-top: 16px;
      padding: 14px;
      background: #fff7ed;
      border: 1px solid #fed7aa;
      border-radius: 8px;
    }
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
    .activity-log { margin: 8px 0 0; padding-left: 18px; font-size: 12px; color: var(--text); max-height: 320px; overflow: hidden; }
    .activity-log li { margin-bottom: 6px; line-height: 1.5; }
    .log-time { color: var(--text-muted); font-size: 10px; margin-right: 6px; }
    .log-level { color: var(--accent); font-size: 10px; font-weight: 700; margin-right: 6px; text-transform: uppercase; }
    .campaign-block {
      background: var(--bg-subtle);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 16px;
      page-break-inside: avoid;
    }
    .campaign-block-full { page-break-inside: auto; }
    .wizard-step {
      margin-top: 18px;
      padding-top: 14px;
      border-top: 1px solid var(--border);
    }
    .wizard-step-num {
      display: inline-block;
      background: var(--accent-soft);
      color: var(--accent);
      font-weight: 800;
      font-size: 10px;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      padding: 2px 8px;
      border-radius: 999px;
      margin-right: 6px;
    }
    .campaign-ad-card {
      background: #fff;
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 12px;
      margin-top: 10px;
    }
    .opt-variation-block {
      margin: 16px 0;
      padding: 14px;
      border: 1px dashed var(--border-strong);
      border-radius: 8px;
      background: #f8fafc;
    }
    .footer {
      margin-top: 48px;
      padding-top: 16px;
      border-top: 1px solid var(--border);
      font-size: 11px;
      color: var(--text-muted);
      text-align: center;
    }
    @media (max-width: 800px) {
      .metrics, .roadmap, .opt-ad-compare, .opt-impact-grid, .opt-competitor-grid { grid-template-columns: 1fr; }
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
        <span class="badge teal">AI Analysis</span>
      </div>
      <h1><span class="accent">${escapeHtml(title)}</span></h1>
      <p class="meta-line">
        ${scope === 'campaign' ? `Account: ${escapeHtml(accountLabel)} · ` : ''}
        Generated ${escapeHtml(generatedAt)} · ${audit.dataWindowDays}-day data window
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

    ${renderAuditActivitySection(audit)}

    ${renderWizardActivitySection(wizardActivities)}

    ${renderPublishedAdsSection(publishedAds, wizardActivities)}

    ${renderCampaignInventorySection(campaigns)}

    <h2>Module Findings</h2>
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
      ${wizardActivities.length ? ` • ${wizardActivities.length} campaign/ad creation run${wizardActivities.length === 1 ? '' : 's'}` : ''}
      ${publishedAds.length ? ` • ${publishedAds.length} published ad version${publishedAds.length === 1 ? '' : 's'}` : ''}
    </div>
  </div>
</body>
</html>`;
}

async function tryRenderPdf(html: string): Promise<Buffer | null> {
  // Default to HTML reports — Puppeteer can hang the Node process on Windows.
  if (process.env.PDF_USE_PUPPETEER !== 'true') {
    return null;
  }

  const chromePath = CHROME_CANDIDATES.find((p) => existsSync(p));
  if (!chromePath) {
    console.log('[pdf] PDF_USE_PUPPETEER=true but no Chrome path found (serving HTML report)');
    return null;
  }

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
        await page.setContent(html, { waitUntil: 'load', timeout: PDF_RENDER_TIMEOUT_MS });
        const pdf = await page.pdf({
          format: 'A4',
          printBackground: true,
          preferCSSPageSize: false,
          margin: { top: '16mm', bottom: '16mm', left: '14mm', right: '14mm' },
          timeout: PDF_RENDER_TIMEOUT_MS,
        });
        return Buffer.from(pdf);
      } finally {
        await browser.close();
      }
    };

    if (chromePath) {
      try {
        return await withRenderTimeout(renderPage(chromePath), PDF_RENDER_TIMEOUT_MS);
      } catch (err) {
        console.warn('[pdf] Chrome render failed:', err instanceof Error ? err.message : err);
      }
    }

    if (process.env.PDF_USE_PUPPETEER === 'true') {
      return await withRenderTimeout(renderPage(), PDF_RENDER_TIMEOUT_MS);
    }

    return null;
  } catch (err) {
    console.warn('PDF render unavailable, serving HTML report:', err instanceof Error ? err.message : err);
    return null;
  }
}

export async function generatePdf(audit: AuditRun): Promise<{ buffer: Buffer; isPdf: boolean }> {
  const { getOptimizationsForAuditReport } = await import('./aiOptimization.service.js');
  const { listPublishedAdsForAuditReport } = await import('./googleAdsPublishing.service.js');
  const [optimizations, campaigns, wizardActivities, publishedAds] = await Promise.all([
    getOptimizationsForAuditReport(audit.id),
    loadCampaignsForReport(audit),
    listCampaignWizardActivitiesForReport({
      auditRunId: audit.id,
      userId: audit.userId,
      googleAdsCustomerId: audit.googleAdsCustomerId,
    }),
    listPublishedAdsForAuditReport(audit.id, {
      userId: audit.userId,
      googleAdsCustomerId: audit.googleAdsCustomerId,
    }).catch((err) => {
      console.warn('[pdf] published ads skipped:', err instanceof Error ? err.message : err);
      return [] as PublishedAdHistoryItem[];
    }),
  ]);
  const html = buildReportHtml(audit, optimizations, campaigns, wizardActivities, publishedAds);
  console.log(
    '[pdf] report extras',
    `wizard=${wizardActivities.length}`,
    `published=${publishedAds.length}`,
    `optimizations=${optimizations.length}`,
    `campaigns=${campaigns.length}`
  );
  const pdf = await tryRenderPdf(html);
  if (pdf) return { buffer: pdf, isPdf: true };
  return { buffer: Buffer.from(html, 'utf-8'), isPdf: false };
}
