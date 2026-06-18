import type { AuditIntelligence, LiveAdRow, OptimizationScenario } from '../../services/audit-intelligence.service.js';
import type { Finding } from '../../types/index.js';
import type { OptimizationTone } from './optimize-ad.prompt.js';
import { resolveBusinessName, displayPathFromWebsite } from '../../utils/business-identity.js';

export interface FullOptimizeAdContext {
  intelligence: AuditIntelligence;
  finding: Finding;
  currentAd: {
    headlines: string[];
    descriptions: string[];
    cta?: string;
    keywords?: string[];
    qualityScore?: number;
    ctr?: number;
    conversions?: number;
    adStrength?: string;
  };
  scenario: OptimizationScenario;
  tone?: OptimizationTone;
  variationHint?: string;
  customPrompt?: string;
}

const TONE_INSTRUCTIONS: Record<OptimizationTone, string> = {
  default: 'Balanced, professional, conversion-focused tone.',
  professional: 'Formal, trustworthy, enterprise-grade language.',
  luxury: 'Premium, aspirational, refined vocabulary.',
  'high-conversion': 'Direct-response, urgency, clear benefits, action-oriented.',
  aggressive: 'Bold CTAs, competitive positioning. Google Ads compliant.',
  shorter: 'Concise headlines (≤25 chars) and tight descriptions (≤80 chars).',
};

function summarizeFindings(intelligence: AuditIntelligence): string {
  const top = [...intelligence.findings.critical, ...intelligence.findings.high, ...intelligence.findings.medium]
    .slice(0, 12)
    .map((f) => `- [${f.severity}] ${f.title}: ${f.description.slice(0, 280)}${f.recommendation ? ` → Fix: ${f.recommendation.slice(0, 160)}` : ''}`);
  return top.length ? top.join('\n') : 'No critical findings — optimize for growth.';
}

function trimJson(data: unknown[], max = 12): string {
  return JSON.stringify(data.slice(0, max), null, 0);
}

export function buildFullOptimizeAdPrompt(ctx: FullOptimizeAdContext): string {
  const { intelligence, finding, currentAd, scenario, tone, variationHint, customPrompt } = ctx;
  const biz = intelligence.business;
  const brandName = resolveBusinessName(biz.name, biz.websiteUrl);
  const toneInstruction = TONE_INSTRUCTIONS[tone ?? 'default'];
  const websiteNote = biz.websiteUrl
    ? `Brand name MUST be "${brandName}" (derived from ${biz.websiteUrl}). Use this in headlines, descriptions, and extensions. NEVER use contact-person names, Google Ads account IDs, or unrelated names in ad copy. Display paths should reflect real site sections (e.g. "${displayPathFromWebsite(biz.websiteUrl)}", "services").`
    : `Brand name for ads: "${brandName}". Never use Google Ads customer IDs or contact-person names in copy.`;

  return `You are a Senior Google Ads Strategist at a top performance agency. Your goal: maximize CTR, conversions, quality score, and ad relevance while reducing wasted spend.

SCENARIO: ${
    scenario === 'REPLACE_EXISTING'
      ? 'CASE 1 — EXISTING CAMPAIGNS + EXISTING ADS: Analyze live ads, keywords, search terms, quality scores, and audit findings. Generate improved headlines, descriptions, CTAs, and extensions to boost performance.'
      : scenario === 'CREATE_ADS'
        ? 'CASE 2 — CAMPAIGN EXISTS BUT NO ADS: Generate complete Responsive Search Ads (15 headlines, 4 descriptions, display paths, extensions) based on campaign objective, keywords, landing page, and business context.'
        : 'CASE 3 — NO CAMPAIGNS: Research the business website, services, location, and industry. Propose campaign strategy, ad groups, keyword clusters, negative keywords, competitor angles, and full RSA copy.'
  }

BUSINESS
- Brand name (use in ALL ad copy): ${brandName}
- Google Ads account label: ${biz.name}
- Goal: ${biz.goal ?? 'Lead generation / conversions'}
- Website: ${biz.websiteUrl ?? 'Not specified'}
- Monthly spend: ${biz.monthlySpend != null ? `$${biz.monthlySpend.toLocaleString()}` : 'Unknown'}
- Campaigns: ${biz.campaignCount ?? 'Unknown'}
- Data source: ${intelligence.dataSource}

TRIGGER FINDING (user clicked Make It Better on this)
- Category: ${finding.category}
- Title: ${finding.title}
- Description: ${finding.description}
${finding.recommendation ? `- Recommendation: ${finding.recommendation}` : ''}

TOP AUDIT FINDINGS
${summarizeFindings(intelligence)}

CAMPAIGN DATA (from Google Ads API / audit)
${trimJson(intelligence.campaigns)}

KEYWORD DATA
${trimJson(intelligence.keywords)}

SEARCH TERMS (waste & opportunity)
${trimJson(intelligence.searchTerms)}

QUALITY SCORE ISSUES
${trimJson(intelligence.qualityScores)}

BIDDING / BUDGET CONTEXT
${trimJson(intelligence.bidding)}

LANDING PAGES
${trimJson(intelligence.landingPages)}

${scenario === 'REPLACE_EXISTING' ? `EXISTING AD TO IMPROVE
- Headlines: ${JSON.stringify(currentAd.headlines)}
- Descriptions: ${JSON.stringify(currentAd.descriptions)}
- CTR: ${currentAd.ctr ?? 'Unknown'}%
- Quality Score: ${currentAd.qualityScore ?? 'Unknown'}
- Conversions: ${currentAd.conversions ?? 'Unknown'}
- Ad strength: ${currentAd.adStrength ?? 'Unknown'}
` : scenario === 'CREATE_ADS' ? `CAMPAIGNS EXIST BUT NO RSA ADS — create full Responsive Search Ads for the best-matching campaign using keyword and landing page data.` : `NO CAMPAIGNS — include a "campaignStrategy" object in JSON with recommended campaign name, type, daily budget, ad groups, keyword themes, and negative keywords.`}

TONE: ${toneInstruction}
${variationHint ? `VARIATION: ${variationHint}` : ''}
${customPrompt?.trim() ? `\nUSER CUSTOM INSTRUCTIONS (follow closely):\n${customPrompt.trim()}\n` : ''}
${websiteNote}

COMPLIANCE
- Headlines: max 30 chars, exactly 15 unique headlines
- Descriptions: max 90 chars, exactly 4 unique descriptions
- Display paths: max 15 chars each, derived from website/service pages (not account IDs)
- No ALL CAPS, misleading claims, or excessive punctuation
- Keyword-relevant, conversion-focused, publishable today
- ALWAYS include "headlines" (15 items) and "descriptions" (4 items) even for CREATE_STRATEGY scenario
- Reference specific services, value props, and audit findings in descriptions — be detailed and specific to this business
- Include 4 sitelinks, 4 callouts, and structured snippets relevant to ${brandName}
- "reasoning" must be 3-5 sentences explaining strategy tied to audit data

Return ONLY a single valid JSON object with no markdown fences and no text before or after:
{
  "campaignId": "string or empty",
  "adGroupId": "string or empty",
  "headlines": ["15 headlines"],
  "descriptions": ["4 descriptions"],
  "displayPaths": ["path1", "path2"],
  "callouts": ["4 callouts"],
  "sitelinks": ["4 sitelink titles"],
  "structuredSnippets": ["snippet values"],
  "reasoning": "2-4 sentences on strategy and changes",
  "predictedImprovements": {
    "ctr": "+X% Estimated CTR",
    "qualityScore": "+X Quality Score",
    "conversionRate": "+X% Conversion Potential"
  }
}`;
}

export function liveAdToCurrentAd(ad: LiveAdRow | null, fallbackBrand: string, websiteUrl?: string) {
  const bizName = resolveBusinessName(fallbackBrand, websiteUrl);
  const brand = bizName.split(' ')[0];
  if (!ad) {
    return {
      headlines: [`${brand} — Get Started`, 'Trusted Experts', 'Free Consultation', 'Call Today', 'Book Online'],
      descriptions: [
        `${bizName} delivers measurable results. Visit us online for a free consultation today.`,
        'Professional services tailored to your goals. Start improving performance now.',
      ],
      keywords: [brand.toLowerCase()],
      qualityScore: 0,
      ctr: 0,
      conversions: 0,
      adStrength: 'NONE',
    };
  }
  return {
    headlines: ad.headlines,
    descriptions: ad.descriptions,
    keywords: [],
    qualityScore: undefined,
    ctr: ad.ctr,
    conversions: ad.conversions,
    adStrength: ad.adStrength,
  };
}
