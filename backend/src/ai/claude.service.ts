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
  healthScore: number
): Promise<string> {
  const key = getPrimaryApiKey();
  if (!key) {
    return buildFallbackSummary(accountName, findings, healthScore);
  }

  const validFindings = findings.filter((f) => !isAnalysisFailureFinding(f.title));
  const totalImpact = validFindings.reduce((s, f) => s + f.impactMonthly, 0);
  const criticalCount = validFindings.filter((f) => f.severity === 'CRITICAL').length;

  try {
    const response = await createClaudeMessage({
      max_tokens: 800,
      messages: [{
        role: 'user',
        content: `Write a 3-paragraph executive summary for a Google Ads audit report.
Account: ${accountName}
Health Score: ${healthScore}/100
Total Findings: ${validFindings.length}
Critical Findings: ${criticalCount}
Estimated Monthly Impact: $${totalImpact.toLocaleString()}
Top issues: ${validFindings.slice(0, 5).map((f) => f.title).join('; ') || 'Account setup and optimization opportunities'}
Write in professional consulting tone. Include specific dollar figures from the findings.`,
      }],
    }, key);

    const block = response.content[0];
    if (block.type === 'text') return block.text;
    return buildFallbackSummary(accountName, validFindings, healthScore);
  } catch (err) {
    console.error('Anthropic executive summary failed:', err);
    return buildFallbackSummary(accountName, validFindings, healthScore);
  }
}

function buildFallbackSummary(accountName: string, findings: Finding[], healthScore: number): string {
  const totalImpact = findings.reduce((s, f) => s + f.impactMonthly, 0);
  const criticalCount = findings.filter((f) => f.severity === 'CRITICAL').length;
  return `This audit of ${accountName} identified ${findings.length} findings with an overall health score of ${healthScore}/100. Critical issues: ${criticalCount}. Estimated monthly optimization opportunity: $${totalImpact.toLocaleString()}.

Top priorities: ${findings.slice(0, 3).map((f) => f.title).join('; ') || 'Review module findings for actionable recommendations.'}

Implementing the recommended roadmap items can recover wasted spend and improve campaign efficiency over the next 30–90 days.`;
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
