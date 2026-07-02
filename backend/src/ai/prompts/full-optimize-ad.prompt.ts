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
    .slice(0, 15)
    .map((f) => `- [${f.severity}] ${f.title}: ${f.description.slice(0, 280)}${f.recommendation ? ` → Fix: ${f.recommendation.slice(0, 160)}` : ''}`);
  return top.length ? top.join('\n') : 'No critical findings — optimize for growth.';
}

function trimJson(data: unknown[], max = 15): string {
  return JSON.stringify(data.slice(0, max), null, 0);
}

function formatWebsiteIntel(intelligence: AuditIntelligence): string {
  const w = intelligence.websiteAnalysis;
  if (!w) return 'Website not analyzed.';
  return JSON.stringify({
    url: w.url,
    title: w.title,
    metaDescription: w.metaDescription,
    headings: w.headings?.slice(0, 8),
    offers: w.offers,
    services: w.services,
    ctas: w.ctas,
    locations: w.locations,
    usps: w.usps,
    sample: w.rawTextSample?.slice(0, 600),
  }, null, 0);
}

function formatCompetitorIntel(intelligence: AuditIntelligence): string {
  const c = intelligence.competitorAnalysis;
  if (!c) return 'Competitor analysis unavailable.';
  return JSON.stringify({
    competitors: c.competitors?.slice(0, 4).map((x) => ({
      name: x.name,
      url: x.url,
      headlines: x.headlines?.slice(0, 5),
      offers: x.offers,
      services: x.services,
      ctas: x.ctas,
      positioning: x.positioning,
    })),
    keywordOpportunities: c.keywordOpportunities,
    messagingOpportunities: c.messagingOpportunities,
    missingOffers: c.missingOffers,
    competitiveAdvantages: c.competitiveAdvantages,
  }, null, 0);
}

export function buildFullOptimizeAdPrompt(ctx: FullOptimizeAdContext): string {
  const { intelligence, finding, currentAd, scenario, tone, variationHint, customPrompt } = ctx;
  const biz = intelligence.business;
  const brandName = resolveBusinessName(biz.name, biz.websiteUrl);
  const toneInstruction = TONE_INSTRUCTIONS[tone ?? 'default'];
  const perf = intelligence.campaignPerformance;
  const selected = intelligence.selectedCampaign;
  const isPmax = selected?.isPerformanceMax ?? /PERFORMANCE_MAX/i.test(perf?.campaignType ?? '');
  const websiteNote = biz.websiteUrl
    ? `Brand name MUST be "${brandName}" (derived from ${biz.websiteUrl}). Use this in headlines, descriptions, and extensions. NEVER use contact-person names, Google Ads account IDs, or unrelated names in ad copy. Display paths should reflect real site sections (e.g. "${displayPathFromWebsite(biz.websiteUrl)}", "services").`
    : `Brand name for ads: "${brandName}". Never use Google Ads customer IDs or contact-person names in copy.`;

  const scenarioBlock =
    scenario === 'REPLACE_EXISTING'
      ? 'CASE 1 — EXISTING CAMPAIGNS + EXISTING ADS: Replace underperforming RSA with data-driven optimized copy and extensions.'
      : scenario === 'CREATE_ADS'
        ? selected?.hasExistingAds === false && isPmax
          ? 'CASE 2b — PERFORMANCE MAX CAMPAIGN WITH NO TEXT ASSETS: This campaign has no responsive search ads. Recommend Performance Max asset group copy (short headlines ≤30 chars, long headlines ≤90 chars, descriptions), listing group themes, audience signals, and final URL expansion strategy. Output RSA-style JSON for preview; note in reasoning these map to PMax asset groups.'
          : 'CASE 2 — CAMPAIGN EXISTS BUT NO ADS: Create full RSAs (or asset group copy for PMax) from campaign keywords, search terms, landing pages, and business context. Use the SELECTED CAMPAIGN details below.'
        : 'CASE 3 — NO CAMPAIGNS: Propose campaign strategy plus full RSA copy.';

  return `You are a Senior Google Ads Strategist — not a copywriter. Analyze the FULL account intelligence below, then produce publishable RSA ads AND strategic recommendations tied to real performance data.

YOUR ROLE
- Diagnose weak headlines, descriptions, CTAs, keyword relevance, quality score issues, wasted search terms, and landing page gaps
- Use audit findings, campaign metrics, website content, and competitor intelligence
- Generate ads that improve CTR, Quality Score, conversion rate, and reduce wasted spend
- Every recommendation must reference specific data from this analysis

SCENARIO: ${scenarioBlock}

SELECTED CAMPAIGN (optimize for this campaign only)
${selected ? JSON.stringify(selected, null, 0) : intelligence.selectedCampaignId ? `Campaign ID: ${intelligence.selectedCampaignId}` : 'Account-wide — no single campaign selected.'}

BUSINESS
- Brand: ${brandName}
- Account: ${biz.name}
- Goal: ${biz.goal ?? 'Lead generation / conversions'}
- Website: ${biz.websiteUrl ?? 'Not specified'}
- Monthly spend: ${biz.monthlySpend != null ? `$${biz.monthlySpend.toLocaleString()}` : 'Unknown'}
- Data source: ${intelligence.dataSource}

AUDIT HEALTH SCORE: ${intelligence.auditHealth.score}/100 (${intelligence.auditHealth.critical} critical, ${intelligence.auditHealth.high} high, ${intelligence.auditHealth.medium} medium findings)

SELECTED CAMPAIGN PERFORMANCE
${perf ? JSON.stringify(perf, null, 0) : 'No campaign metrics — use audit data.'}

TRIGGER FINDING
- [${finding.severity}] ${finding.title}: ${finding.description}
${finding.recommendation ? `- Recommendation: ${finding.recommendation}` : ''}
${intelligence.selectedCampaign ? `\nFOCUS: Optimize for campaign "${intelligence.selectedCampaign.name}" (${intelligence.selectedCampaign.type}, ${intelligence.selectedCampaign.status}).` : ''}
${finding.category === 'BUDGET' || finding.category === 'BIDDING' ? '\nNOTE: This finding is budget/bidding focused — prioritize budget, bidding, and campaign structure recommendations alongside ad copy.' : ''}

AUDIT FINDINGS (address these explicitly in strategistReasoning)
${summarizeFindings(intelligence)}

CAMPAIGN DATA
${trimJson(intelligence.campaigns)}

KEYWORD DATA (match types + performance)
${trimJson(intelligence.keywords)}

SEARCH TERMS (waste & opportunities)
${trimJson(intelligence.searchTerms)}

QUALITY SCORE DATA
${trimJson(intelligence.qualityScores)}

BIDDING / BUDGET
${trimJson(intelligence.bidding)}
${trimJson(intelligence.budgets)}

DEVICE PERFORMANCE
${trimJson(intelligence.devices)}

AUDIENCE TARGETING
${trimJson(intelligence.audiences)}

LANDING PAGES
${trimJson(intelligence.landingPages)}

WEBSITE ANALYSIS
${formatWebsiteIntel(intelligence)}

COMPETITOR INTELLIGENCE
${formatCompetitorIntel(intelligence)}

${scenario === 'REPLACE_EXISTING' ? `EXISTING AD
- Headlines: ${JSON.stringify(currentAd.headlines)}
- Descriptions: ${JSON.stringify(currentAd.descriptions)}
- CTR: ${currentAd.ctr ?? perf?.ctr ?? 'Unknown'}%
- Quality Score: ${currentAd.qualityScore ?? perf?.avgQualityScore ?? 'Unknown'}
- Conversions: ${currentAd.conversions ?? perf?.conversions ?? 'Unknown'}
- Ad strength: ${currentAd.adStrength ?? 'Unknown'}
` : ''}

TONE: ${toneInstruction}
${variationHint ? `VARIATION: ${variationHint}` : ''}
${customPrompt?.trim() ? `\nUSER INSTRUCTIONS:\n${customPrompt.trim()}\n` : ''}
${websiteNote}

COMPLIANCE
- Headlines: max 30 chars, exactly 15 unique
- Descriptions: max 90 chars, exactly 4 unique
- Display paths: max 15 chars each
- Google Ads compliant, publishable today

Return ONLY valid JSON (no markdown):
{
  "campaignId": "",
  "adGroupId": "",
  "headlines": ["15 headlines"],
  "descriptions": ["4 descriptions"],
  "displayPaths": ["path1", "path2"],
  "callouts": ["4 callouts"],
  "sitelinks": ["4 sitelinks"],
  "structuredSnippets": ["snippet values"],
  "reasoning": "3-5 sentence executive summary",
  "strategistReasoning": {
    "headlineChanges": "why headlines changed",
    "descriptionChanges": "why descriptions changed",
    "keywordRelevance": "how keyword alignment improved",
    "qualityScore": "why QS may improve",
    "conversionPotential": "why conversions may improve",
    "auditFindingsAddressed": ["finding 1 addressed", "finding 2"],
    "competitorInsightsUsed": ["insight 1", "insight 2"]
  },
  "recommendedKeywords": ["5-10 keywords"],
  "negativeKeywordSuggestions": ["5-15 negatives"],
  "recommendedExtensions": ["extension recommendations"],
  "landingPageRecommendations": ["2-4 LP improvements"],
  "budgetRecommendations": ["budget advice from data"],
  "biddingRecommendations": ["bidding advice"],
  "audienceRecommendations": ["audience advice"],
  "performanceEstimates": {
    "label": "AI Estimated Impact",
    "current": { "ctr": "", "qualityScore": "", "conversionRate": "", "cpa": "", "roas": "", "monthlyLeads": "", "monthlySavings": "" },
    "estimated": { "ctr": "", "qualityScore": "", "conversionRate": "", "cpa": "", "roas": "", "monthlyLeads": "", "monthlySavings": "" }
  },
  "campaignHealth": { "currentScore": 0, "predictedScore": 0, "explanation": "" },
  "accountImpact": {
    "currentAccountHealth": 0,
    "predictedAccountHealth": 0,
    "currentMonthlyLeads": "",
    "estimatedMonthlyLeads": "",
    "currentWastedSpend": "",
    "estimatedWastedSpend": "",
    "currentRoas": "",
    "estimatedRoas": ""
  },
  "predictedImprovements": { "ctr": "", "qualityScore": "", "conversionRate": "" }
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
