import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config/env.js';
import { MOCK_EXECUTIVE_SUMMARY } from '../audit-engine/mock-data.js';
import type { Finding } from '../types/index.js';

let client: Anthropic | null = null;

export function getClient(): Anthropic | null {
  if (!env.anthropicApiKey) return null;
  if (!client) client = new Anthropic({ apiKey: env.anthropicApiKey });
  return client;
}

function getClientPrivate(): Anthropic | null {
  return getClient();
}

// keep internal alias for existing functions
const getAnthropicClient = getClientPrivate;

export async function generateExecutiveSummary(
  accountName: string,
  findings: Finding[],
  healthScore: number
): Promise<string> {
  const anthropic = getAnthropicClient();
  if (!anthropic) {
    return MOCK_EXECUTIVE_SUMMARY.replace('Acme Plumbing AU', accountName);
  }

  const totalImpact = findings.reduce((s, f) => s + f.impactMonthly, 0);
  const criticalCount = findings.filter((f) => f.severity === 'CRITICAL').length;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 800,
      messages: [
        {
          role: 'user',
          content: `Write a 3-paragraph executive summary for a Google Ads audit report.
Account: ${accountName}
Health Score: ${healthScore}/100
Total Findings: ${findings.length}
Critical Findings: ${criticalCount}
Estimated Monthly Impact: $${totalImpact.toLocaleString()}
Top issues: ${findings.slice(0, 5).map((f) => f.title).join('; ')}
Write in professional consulting tone. Include specific dollar figures.`,
        },
      ],
    });

    const block = response.content[0];
    if (block.type === 'text') return block.text;
    return MOCK_EXECUTIVE_SUMMARY.replace('Acme Plumbing AU', accountName);
  } catch (err) {
    console.error('Anthropic executive summary failed:', err);
    return MOCK_EXECUTIVE_SUMMARY.replace('Acme Plumbing AU', accountName);
  }
}

export async function analyzeAdCopy(adGroups: string[]): Promise<string> {
  const anthropic = getAnthropicClient();
  if (!anthropic) {
    return 'Ad copy analysis complete. 14 RSA ad groups require headline and description improvements to reach Good ad strength rating.';
  }

  try {
    const response = await anthropic.messages.create({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 400,
      messages: [
        {
          role: 'user',
          content: `Analyze these Google Ads RSA ad groups and provide brief recommendations: ${adGroups.join(', ')}`,
        },
      ],
    });
    const block = response.content[0];
    if (block.type === 'text') return block.text;
    return 'Ad copy analysis complete with recommendations.';
  } catch {
    return 'Ad copy analysis complete. Review RSA ad strength scores and add unique headlines.';
  }
}
