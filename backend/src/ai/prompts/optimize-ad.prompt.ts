export type OptimizationTone =
  | 'default'
  | 'professional'
  | 'luxury'
  | 'high-conversion'
  | 'aggressive'
  | 'shorter';

export interface OptimizeAdContext {
  accountName: string;
  businessGoal?: string;
  websiteUrl?: string;
  monthlySpend?: number;
  campaignType?: string;
  findingTitle: string;
  findingDescription: string;
  findingRecommendation?: string;
  findingCategory: string;
  currentAd: {
    headlines: string[];
    longHeadlines?: string[];
    descriptions: string[];
    cta?: string;
    keywords?: string[];
    displayPath1?: string;
    displayPath2?: string;
    qualityScore?: number;
    ctr?: number;
    conversions?: number;
    adStrength?: string;
  };
  targetKeywords?: string[];
  tone?: OptimizationTone;
  variationHint?: string;
}

const TONE_INSTRUCTIONS: Record<OptimizationTone, string> = {
  default: 'Balanced, professional, conversion-focused tone.',
  professional: 'Formal, trustworthy, enterprise-grade language. Avoid hype.',
  luxury: 'Premium, aspirational, refined vocabulary. Emphasize exclusivity and quality.',
  'high-conversion': 'Direct-response copy. Strong urgency, clear benefits, action-oriented.',
  aggressive: 'Bold CTAs, strong urgency, competitive positioning. Still Google Ads compliant.',
  shorter: 'Concise headlines (≤25 chars where possible) and tight descriptions (≤80 chars).',
};

export function buildOptimizeAdPrompt(ctx: OptimizeAdContext): string {
  const tone = ctx.tone ?? 'default';
  const toneInstruction = TONE_INSTRUCTIONS[tone];

  return `You are an elite Google Ads copywriter and performance marketer. Generate optimized Responsive Search Ad (RSA) copy that is directly publishable to Google Ads.

ACCOUNT CONTEXT
- Account: ${ctx.accountName}
- Business goal: ${ctx.businessGoal ?? 'Lead generation / conversions'}
- Website: ${ctx.websiteUrl ?? 'Not specified'}
- Monthly spend: ${ctx.monthlySpend ? `$${ctx.monthlySpend.toLocaleString()}` : 'Unknown'}
- Campaign type: ${ctx.campaignType ?? 'Search'}

AUDIT FINDING
- Category: ${ctx.findingCategory}
- Issue: ${ctx.findingTitle}
- Details: ${ctx.findingDescription}
${ctx.findingRecommendation ? `- Recommendation: ${ctx.findingRecommendation}` : ''}

CURRENT AD PERFORMANCE
- Headlines: ${JSON.stringify(ctx.currentAd.headlines)}
- Descriptions: ${JSON.stringify(ctx.currentAd.descriptions)}
${ctx.currentAd.longHeadlines?.length ? `- Long headlines: ${JSON.stringify(ctx.currentAd.longHeadlines)}` : ''}
- CTA: ${ctx.currentAd.cta ?? 'Learn More'}
- Keywords: ${JSON.stringify(ctx.currentAd.keywords ?? ctx.targetKeywords ?? [])}
- Quality Score: ${ctx.currentAd.qualityScore ?? 'Unknown'}
- CTR: ${ctx.currentAd.ctr != null ? `${ctx.currentAd.ctr}%` : 'Unknown'}
- Conversions (30d): ${ctx.currentAd.conversions ?? 'Unknown'}
- Ad strength: ${ctx.currentAd.adStrength ?? 'Unknown'}

TONE: ${toneInstruction}
${ctx.variationHint ? `VARIATION: ${ctx.variationHint}` : ''}

GOOGLE ADS COMPLIANCE RULES
- Headlines: max 30 characters each. Provide 10-15 unique headlines.
- Long headlines: max 90 characters each. Provide 2-3 if relevant.
- Descriptions: max 90 characters each. Provide 3-4 unique descriptions.
- No excessive punctuation, ALL CAPS, or misleading claims.
- Include target keywords naturally in headlines.
- Each headline/description must be unique (Google RSA requirement).

Return ONLY valid JSON (no markdown fences):
{
  "headlines": ["string"],
  "longHeadlines": ["string"],
  "descriptions": ["string"],
  "ctaSuggestions": ["string"],
  "keywordSuggestions": ["string"],
  "displayPaths": { "path1": "string", "path2": "string" },
  "adExtensions": {
    "sitelinks": ["string"],
    "callouts": ["string"],
    "structuredSnippets": ["string"]
  },
  "improvementReasoning": "2-3 sentences explaining key changes",
  "predictedImpact": {
    "ctrIncrease": "+X% Estimated CTR",
    "qualityScoreIncrease": "+X Quality Score Improvement",
    "conversionImprovement": "+X% Conversion Potential"
  }
}`;
}
