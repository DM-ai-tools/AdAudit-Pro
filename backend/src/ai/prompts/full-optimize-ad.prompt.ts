import type { AuditIntelligence, LiveAdRow, OptimizationScenario } from '../../services/audit-intelligence.service.js';
import type { Finding } from '../../types/index.js';
import type { OptimizationTone } from './optimize-ad.prompt.js';

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
  const top = [...intelligence.findings.critical, ...intelligence.findings.high]
    .slice(0, 8)
    .map((f) => `- [${f.severity}] ${f.title}: ${f.description.slice(0, 200)}${f.recommendation ? ` → ${f.recommendation.slice(0, 120)}` : ''}`);
  return top.length ? top.join('\n') : 'No critical findings — optimize for growth.';
}

function trimJson(data: unknown[], max = 12): string {
  return JSON.stringify(data.slice(0, max), null, 0);
}

export function buildFullOptimizeAdPrompt(ctx: FullOptimizeAdContext): string {
  const { intelligence, finding, currentAd, scenario, tone, variationHint } = ctx;
  const biz = intelligence.business;
  const toneInstruction = TONE_INSTRUCTIONS[tone ?? 'default'];

  return `You are a Senior Google Ads Strategist at a top performance agency. Your goal: maximize CTR, conversions, quality score, and ad relevance while reducing wasted spend.

SCENARIO: ${scenario === 'CREATE_NEW' ? 'NO EXISTING ADS — generate brand-new Responsive Search Ads from scratch using audit intelligence.' : 'ADS EXIST — analyze weaknesses and generate optimized REPLACEMENT copy (do NOT suggest overwriting in-place; user will approve before publish).'}

BUSINESS
- Name: ${biz.name}
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
` : `NO LIVE ADS — generate starter RSA aligned to business + keywords.`}

TONE: ${toneInstruction}
${variationHint ? `VARIATION: ${variationHint}` : ''}

COMPLIANCE
- Headlines: max 30 chars, exactly 15 unique headlines
- Descriptions: max 90 chars, exactly 4 unique descriptions
- Display paths: max 15 chars each
- No ALL CAPS, misleading claims, or excessive punctuation
- Keyword-relevant, conversion-focused, publishable today

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

export function liveAdToCurrentAd(ad: LiveAdRow | null, fallbackBrand: string) {
  if (!ad) {
    const brand = fallbackBrand.split(' ')[0];
    return {
      headlines: [`${brand} — Get Started`, 'Trusted Experts', 'Free Consultation', 'Call Today', 'Book Online'],
      descriptions: [
        `${fallbackBrand} delivers results. Contact us for a free consultation.`,
        'Professional services tailored to your goals. Start today.',
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
