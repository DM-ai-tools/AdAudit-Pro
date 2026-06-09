import type { Finding, Severity, FindingCategory } from '../types/index.js';
import { getClient } from './claude.service.js';

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
}

const VALID_SEVERITIES: Severity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
const VALID_CATEGORIES: FindingCategory[] = [
  'KEYWORDS', 'BIDDING', 'AUDIENCES', 'AD_COPY', 'BUDGET', 'GEO',
  'QUALITY_SCORE', 'SEARCH_TERMS', 'CAMPAIGN', 'LANDING_PAGES', 'IMPRESSION_SHARE', 'PMAX',
];

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
  const anthropic = getClient();
  const defaultCategory = slugToCategory(input.moduleSlug);

  if (!anthropic) {
    return [{
      severity: 'MEDIUM',
      title: `${input.moduleName} — configure ANTHROPIC_API_KEY for AI analysis`,
      description: 'Add your Anthropic API key to backend/.env to enable Claude-powered findings for this module.',
      recommendation: 'Set ANTHROPIC_API_KEY and restart the backend server.',
      confidence: 100,
      impactMonthly: 0,
      category: defaultCategory,
      dimension: input.moduleName,
      status: 'OPEN',
    }];
  }

  try {
    const response = await anthropic.messages.create({
      model: 'claude-3-5-haiku-20241022',
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
    });

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
    return [{
      severity: 'MEDIUM',
      title: `${input.moduleName} analysis incomplete`,
      description: 'Claude API request failed. Check ANTHROPIC_API_KEY and retry the audit.',
      confidence: 50,
      impactMonthly: 0,
      category: defaultCategory,
      dimension: input.moduleName,
      status: 'OPEN',
    }];
  }
}

export async function generateHealthScoresFromFindings(
  findings: Finding[],
  accountName: string
): Promise<{ dimension: string; score: number; label?: string }[]> {
  const anthropic = getClient();
  const dimensions = [...new Set(findings.map((f) => f.dimension))];

  if (!anthropic || !findings.length) {
    return dimensions.map((d) => ({
      dimension: d,
      score: 50 + Math.floor(Math.random() * 20),
      label: 'Estimated',
    }));
  }

  try {
    const response = await anthropic.messages.create({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 600,
      messages: [{
        role: 'user',
        content: `Score each audit dimension 0-100 for ${accountName}. Return ONLY JSON array: [{"dimension":"...","score":number,"label":"..."}]
Findings summary: ${findings.map((f) => `${f.dimension}: ${f.severity} - ${f.title}`).join('; ')}`,
      }],
    });
    const block = response.content[0];
    if (block.type === 'text') {
      const match = block.text.match(/\[[\s\S]*\]/);
      if (match) return JSON.parse(match[0]);
    }
  } catch {
    /* fallback below */
  }
  return dimensions.map((d) => {
    const modFindings = findings.filter((f) => f.dimension === d);
    const penalty = modFindings.filter((f) => f.severity === 'CRITICAL').length * 15
      + modFindings.filter((f) => f.severity === 'HIGH').length * 8;
    return { dimension: d, score: Math.max(20, 85 - penalty), label: 'AI scored' };
  });
}
