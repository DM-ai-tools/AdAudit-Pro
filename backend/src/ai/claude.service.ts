import Anthropic from '@anthropic-ai/sdk';
import type { Finding } from '../types/index.js';
import { createClaudeMessage, isAnalysisFailureFinding } from './anthropic-client.js';
import { getPrimaryApiKey, getParallelApiKeys } from './anthropic-pool.js';

let primaryClient: Anthropic | null = null;

export function getClient(): Anthropic | null {
  const key = getPrimaryApiKey();
  if (!key) return null;
  if (!primaryClient) primaryClient = new Anthropic({ apiKey: key });
  return primaryClient;
}

export async function generateExecutiveSummary(
  accountName: string,
  findings: Finding[],
  healthScore: number,
  options?: { auditScope?: 'account' | 'campaign'; campaignName?: string }
): Promise<string> {
  const key = getPrimaryApiKey();
  if (!key) {
    return buildFallbackSummary(accountName, findings, healthScore, options);
  }

  const validFindings = findings.filter((f) => !isAnalysisFailureFinding(f.title));
  const totalImpact = validFindings.reduce((s, f) => s + f.impactMonthly, 0);
  const criticalCount = validFindings.filter((f) => f.severity === 'CRITICAL').length;
  const isCampaign = options?.auditScope === 'campaign';

  const scopeIntro = isCampaign
    ? `This is a CAMPAIGN-LEVEL audit report for the "${options?.campaignName ?? 'selected'}" campaign within ${accountName}.`
    : `This is a full ACCOUNT-LEVEL Google Ads audit for ${accountName}.`;

  try {
    const response = await createClaudeMessage({
      max_tokens: 1200,
      messages: [{
        role: 'user',
        content: `Write a detailed executive summary (4-5 paragraphs) for a Google Ads audit report.
${scopeIntro}
Health Score: ${healthScore}/100
Total Findings: ${validFindings.length}
Critical Findings: ${criticalCount}
Estimated Monthly Impact: $${totalImpact.toLocaleString()}
Top issues: ${validFindings.slice(0, 8).map((f) => `${f.severity}: ${f.title}`).join('; ') || 'Optimization opportunities identified'}

Structure:
1. Opening paragraph — overall ${isCampaign ? 'campaign' : 'account'} health assessment with health score
2. Key findings paragraph — cite specific issues with dollar impact where available
3. Priority actions paragraph — top 3 immediate fixes ranked by ROI
4. ${isCampaign ? 'Campaign-specific' : 'Strategic'} outlook paragraph — 30-90 day improvement potential

Write in professional consulting tone. Include specific dollar figures and entity names from the findings.

IMPORTANT: Use plain prose paragraphs only. Do not use markdown syntax (no # headings, no **bold**, no bullet lists). Separate paragraphs with blank lines.`,
      }],
    }, key);

    const block = response.content[0];
    if (block.type === 'text') return block.text;
    return buildFallbackSummary(accountName, validFindings, healthScore, options);
  } catch (err) {
    console.error('Anthropic executive summary failed:', err);
    return buildFallbackSummary(accountName, validFindings, healthScore, options);
  }
}

function buildFallbackSummary(
  accountName: string,
  findings: Finding[],
  healthScore: number,
  options?: { auditScope?: 'account' | 'campaign'; campaignName?: string }
): string {
  const totalImpact = findings.reduce((s, f) => s + f.impactMonthly, 0);
  const criticalCount = findings.filter((f) => f.severity === 'CRITICAL').length;
  const isCampaign = options?.auditScope === 'campaign';
  const subject = isCampaign
    ? `campaign "${options?.campaignName ?? 'selected'}" in ${accountName}`
    : accountName;

  return `This ${isCampaign ? 'campaign-level' : 'account'} audit of ${subject} identified ${findings.length} findings with an overall health score of ${healthScore}/100. Critical issues: ${criticalCount}. Estimated monthly optimization opportunity: $${totalImpact.toLocaleString()}.

Top priorities: ${findings.slice(0, 5).map((f) => f.title).join('; ') || 'Review module findings for actionable recommendations.'}

Implementing the recommended roadmap items can recover wasted spend and improve ${isCampaign ? 'this campaign\'s' : 'account'} efficiency over the next 30–90 days.`;
}

export async function analyzeAdCopy(adGroups: string[], apiKey?: string): Promise<string> {
  const key = apiKey || getPrimaryApiKey();
  if (!key) {
    return 'Ad copy analysis requires an Anthropic API key in backend/.env.';
  }

  try {
    const response = await createClaudeMessage({
      max_tokens: 400,
      messages: [{
        role: 'user',
        content: `Analyze these Google Ads RSA ad groups and provide brief recommendations: ${adGroups.join(', ')}`,
      }],
    }, key);
    const block = response.content[0];
    if (block.type === 'text') return block.text;
    return 'Ad copy analysis complete with recommendations.';
  } catch {
    return 'Ad copy analysis could not be completed. Check API keys and retry.';
  }
}

export { getParallelApiKeys };
