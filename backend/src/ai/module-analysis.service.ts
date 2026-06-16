import type { Finding, Severity, FindingCategory } from '../types/index.js';
import { getPrimaryApiKey } from './anthropic-pool.js';
import { createClaudeMessage, isAnalysisFailureFinding } from './anthropic-client.js';
import type { RoadmapItem } from '../types/index.js';
import { generateId } from '../services/mock-store.js';

export interface ModuleAnalysisInput {
  moduleSlug: string;
  moduleName: string;
  accountName: string;
  monthlySpend: number;
  campaignCount: number;
  dataWindowDays: number;
  goal?: string;
  googleAdsData: string;
  competitors?: string[];
  apiKey?: string;
}

const VALID_SEVERITIES: Severity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

function slugToCategory(slug: string): FindingCategory {
  const map: Record<string, FindingCategory> = {
    campaign: 'CAMPAIGN',
    keyword: 'KEYWORDS',
    'search-terms': 'SEARCH_TERMS',
    budget: 'BUDGET',
    geo: 'GEO',
    audience: 'AUDIENCES',
    'ad-copy': 'AD_COPY',
    'landing-pages': 'LANDING_PAGES',
    bidding: 'BIDDING',
    conversion: 'CAMPAIGN',
    'quality-score': 'QUALITY_SCORE',
    device: 'CAMPAIGN',
    'impression-share': 'IMPRESSION_SHARE',
    pmax: 'PMAX',
  };
  return map[slug] ?? 'CAMPAIGN';
}

function parseFindingsJson(raw: string, moduleName: string, slug: string): Omit<Finding, 'id'>[] {
  try {
    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) return [];
    const parsed = JSON.parse(match[0]) as Array<{
      severity?: string;
      title?: string;
      description?: string;
      recommendation?: string;
      confidence?: number;
      impactMonthly?: number;
    }>;
    return parsed.slice(0, 4).map((f) => ({
      severity: VALID_SEVERITIES.includes(f.severity as Severity) ? (f.severity as Severity) : 'MEDIUM',
      title: f.title || `${moduleName} issue detected`,
      description: f.description || 'Review recommended based on account data.',
      recommendation: f.recommendation,
      confidence: Math.min(100, Math.max(50, f.confidence ?? 75)),
      impactMonthly: Math.max(0, Math.round(f.impactMonthly ?? 0)),
      category: slugToCategory(slug),
      dimension: moduleName,
      status: 'OPEN' as const,
      evidence: { source: 'claude_analysis', module: slug },
    }));
  } catch {
    return [];
  }
}

export async function generateModuleFindings(
  input: ModuleAnalysisInput
): Promise<Omit<Finding, 'id'>[]> {
  const apiKey = input.apiKey || getPrimaryApiKey();
  const defaultCategory = slugToCategory(input.moduleSlug);

  if (!apiKey) {
    return [{
      severity: 'MEDIUM',
      title: `${input.moduleName} — configure Anthropic API keys for AI analysis`,
      description: 'Add ANTHROPIC_API_KEY (and optional _2/_3/_4) to backend/.env to enable Claude-powered findings.',
      recommendation: 'Set API keys and restart the backend server.',
      confidence: 100,
      impactMonthly: 0,
      category: defaultCategory,
      dimension: input.moduleName,
      status: 'OPEN',
    }];
  }

  try {
    const response = await createClaudeMessage({
      max_tokens: 1200,
      messages: [{
        role: 'user',
        content: `You are a Google Ads forensic auditor. Analyze this module and return ONLY a JSON array (no markdown) of 1-3 findings.

Account: ${input.accountName}
Monthly spend: $${input.monthlySpend}
Active campaigns: ${input.campaignCount}
Audit window: ${input.dataWindowDays} days
Goal: ${input.goal || 'Not specified'}
Module: ${input.moduleName} (${input.moduleSlug})
${input.competitors?.length ? `Competitors: ${input.competitors.join(', ')}` : ''}

Google Ads data (JSON rows from API):
${input.googleAdsData.slice(0, 12000)}

Each finding object must have:
- severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW"
- title: string (specific, under 100 chars)
- description: string (2-3 sentences referencing actual data numbers when available)
- recommendation: string (actionable)
- confidence: number 50-99
- impactMonthly: number (estimated USD monthly savings/opportunity, integer)

Base findings on the provided data. If data is sparse, note setup gaps. Return [] only if no issues found.`,
      }],
    }, apiKey);

    const block = response.content[0];
    if (block.type !== 'text') return [];
    const findings = parseFindingsJson(block.text, input.moduleName, input.moduleSlug);
    return findings.length ? findings : [{
      severity: 'LOW',
      title: `${input.moduleName} — no major issues detected`,
      description: `Claude analysis of ${input.accountName} found no critical issues in this module for the selected window.`,
      confidence: 70,
      impactMonthly: 0,
      category: defaultCategory,
      dimension: input.moduleName,
      status: 'OPEN',
    }];
  } catch (err) {
    console.error(`Claude analysis failed for ${input.moduleSlug}:`, err);
    const detail = err instanceof Error ? err.message.slice(0, 120) : 'Unknown error';
    return [{
      severity: 'MEDIUM',
      title: `${input.moduleName} analysis incomplete`,
      description: `Claude API request failed (${detail}). Verify Anthropic API keys and model access, then retry the audit.`,
      confidence: 50,
      impactMonthly: 0,
      category: defaultCategory,
      dimension: input.moduleName,
      status: 'OPEN',
    }];
  }
}

function scoreDimension(findings: Finding[], dimension: string): { dimension: string; score: number; label: string } {
  const modFindings = findings.filter((f) => f.dimension === dimension);
  const penalty = modFindings.filter((f) => f.severity === 'CRITICAL').length * 15
    + modFindings.filter((f) => f.severity === 'HIGH').length * 8
    + modFindings.filter((f) => f.severity === 'MEDIUM').length * 3;
  return { dimension, score: Math.max(15, 88 - penalty), label: 'AI scored' };
}

export async function generateHealthScoresFromFindings(
  findings: Finding[],
  accountName: string,
  apiKey?: string
): Promise<{ dimension: string; score: number; label?: string }[]> {
  const validFindings = findings.filter((f) => !isAnalysisFailureFinding(f.title));
  const dimensions = [...new Set(validFindings.map((f) => f.dimension))];
  if (!dimensions.length) return [];

  const key = apiKey || getPrimaryApiKey();
  if (!key || !validFindings.length) {
    return dimensions.map((d) => scoreDimension(validFindings, d));
  }

  try {
    const response = await createClaudeMessage({
      max_tokens: 600,
      messages: [{
        role: 'user',
        content: `Score each audit dimension 0-100 for ${accountName}. Return ONLY JSON array: [{"dimension":"...","score":number,"label":"..."}]
Findings summary: ${validFindings.map((f) => `${f.dimension}: ${f.severity} - ${f.title}`).join('; ')}`,
      }],
    }, apiKey);
    const block = response.content[0];
    if (block.type === 'text') {
      const match = block.text.match(/\[[\s\S]*\]/);
      if (match) return JSON.parse(match[0]);
    }
  } catch {
    /* fallback below */
  }
  return dimensions.map((d) => scoreDimension(validFindings, d));
}

export async function generateRoadmapWithClaude(
  findings: Finding[],
  accountName: string,
  apiKey?: string
): Promise<RoadmapItem[]> {
  const valid = findings.filter((f) => !isAnalysisFailureFinding(f.title));
  if (!valid.length) return [];

  const key = apiKey || getPrimaryApiKey();
  if (!key) return [];

  try {
    const response = await createClaudeMessage({
      max_tokens: 1200,
      messages: [{
        role: 'user',
        content: `Create a 30/60/90-day Google Ads optimization roadmap for ${accountName}. Return ONLY JSON array of 8-12 items:
[{"phase":"DAY_30"|"DAY_60"|"DAY_90","title":"...","description":"...","effort":"LOW"|"MEDIUM"|"HIGH","owner":"CLIENT"|"AGENCY"|"SHARED","impactMonthly":number}]
Base items on these findings: ${valid.map((f) => `${f.severity}: ${f.title} ($${f.impactMonthly}/mo)`).join('; ')}`,
      }],
    }, key);
    const block = response.content[0];
    if (block.type !== 'text') return [];
    const match = block.text.match(/\[[\s\S]*\]/);
    if (!match) return [];
    const parsed = JSON.parse(match[0]) as Array<{
      phase?: string;
      title?: string;
      description?: string;
      effort?: string;
      owner?: string;
      impactMonthly?: number;
    }>;
    return parsed.slice(0, 12).map((item, i) => ({
      id: generateId('rm_'),
      phase: (['DAY_30', 'DAY_60', 'DAY_90'].includes(item.phase || '') ? item.phase : 'DAY_30') as RoadmapItem['phase'],
      order: i + 1,
      title: item.title || 'Optimization action',
      description: item.description,
      effort: (['LOW', 'MEDIUM', 'HIGH'].includes(item.effort || '') ? item.effort : 'MEDIUM') as RoadmapItem['effort'],
      owner: (['CLIENT', 'AGENCY', 'SHARED'].includes(item.owner || '') ? item.owner : 'AGENCY') as RoadmapItem['owner'],
      impactMonthly: Math.max(0, Math.round(item.impactMonthly ?? 0)),
    }));
  } catch (err) {
    console.error('Claude roadmap generation failed:', err);
    return [];
  }
}
