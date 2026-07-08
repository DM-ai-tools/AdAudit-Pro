import type { AuditIntelligence, LiveAdRow, OptimizationScenario } from '../../services/audit-intelligence.service.js';
import type { Finding } from '../../types/index.js';
import type { OptimizationTone } from './optimize-ad.prompt.js';
import { resolveBusinessName, displayPathFromWebsite } from '../../utils/business-identity.js';

export type OptimizationMode = 'conservative' | 'balanced' | 'aggressive';

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
  previousOptimizedAd?: {
    headlines: string[];
    descriptions: string[];
  };
  scenario: OptimizationScenario;
  tone?: OptimizationTone;
  optimizationMode?: OptimizationMode;
  variationHint?: string;
  customPrompt?: string;
}

const MODE_INSTRUCTIONS: Record<OptimizationMode, string> = {
  conservative:
    'CONSERVATIVE MODE: Refine the current ad for clarity and QS, but still incorporate competitor Transparency Center angles where the client is clearly losing. At least 40% of headlines must use new phrasing vs the existing ad.',
  balanced:
    'BALANCED MODE: Study competitor Transparency Center ads (adGallery) and produce an ad that beats them on offers, trust, and keywords — while being clearly different from the EXISTING AD. Do NOT paraphrase current headlines; borrow competitor winning angles and improve them.',
  aggressive:
    'AGGRESSIVE MODE: Generate a radically different ad from the EXISTING AD. Heavily mine competitor Transparency Center ads for positioning, offers, trust signals, and keywords — then out-position the set with bold, distinct copy. Zero headline overlap with the current ad’s top messages.',
};

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
    source: c.source,
    competitors: c.competitors?.slice(0, 4).map((x) => ({
      name: x.name,
      url: x.url,
      headlines: x.headlines?.slice(0, 8),
      offers: x.offers,
      services: x.services,
      ctas: x.ctas,
      keywords: x.keywords?.slice(0, 12),
      keyMessages: x.keyMessages,
      valuePropositions: x.valuePropositions,
      positioning: x.positioning,
    })),
    insights: c.insights,
    keywordOpportunities: c.keywordOpportunities,
    messagingOpportunities: c.messagingOpportunities,
    missingOffers: c.missingOffers,
    competitiveAdvantages: c.competitiveAdvantages,
    missingFromYourAds: c.missingFromYourAds,
    adGallery: c.adGallery?.slice(0, 6).map((x) => ({
      name: x.name,
      advertiserName: x.advertiserName,
      headlines: x.headlines,
      descriptions: x.descriptions,
      creativeUrl: x.creativeUrl,
      transparencyUrl: x.transparencyUrl,
      adSource: x.adSource,
    })),
    gapAnalysisSummary: c.gapAnalysis?.summary,
  }, null, 0);
}

export function buildFullOptimizeAdPrompt(ctx: FullOptimizeAdContext): string {
  const {
    intelligence,
    finding,
    currentAd,
    previousOptimizedAd,
    scenario,
    tone,
    optimizationMode,
    variationHint,
    customPrompt,
  } = ctx;
  const mode = optimizationMode ?? 'balanced';
  const modeInstruction = MODE_INSTRUCTIONS[mode];
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

COMPETITOR INTELLIGENCE (use aggressively — do NOT produce generic headline rewrites)
${formatCompetitorIntel(intelligence)}

COMPETITIVE DIFFERENTIATION REQUIREMENTS
- The adGallery contains EXACT competitor ads from Google Transparency Center — treat these as the benchmark to beat
- Your output MUST be substantially different from the EXISTING AD above (no paraphrasing, no swapping word order)
- Generate copy to outrank EACH competitor in adGallery — use their headlines/descriptions as the competitive baseline
- competitorInsights in JSON must ONLY name competitors from adGallery (exact same names)
- At least 70% of headlines must be net-new vs the existing ad; descriptions must introduce new value props or proof points
- Ads must out-position competitors while remaining unmistakably on-brand for the client

${scenario === 'REPLACE_EXISTING' ? `EXISTING AD (live in Google Ads — benchmark only)
- Headlines: ${JSON.stringify(currentAd.headlines)}
- Descriptions: ${JSON.stringify(currentAd.descriptions)}
- CTR: ${currentAd.ctr ?? perf?.ctr ?? 'Unknown'}%
- Quality Score: ${currentAd.qualityScore ?? perf?.avgQualityScore ?? 'Unknown'}
- Conversions: ${currentAd.conversions ?? perf?.conversions ?? 'Unknown'}
- Ad strength: ${currentAd.adStrength ?? 'Unknown'}
` : ''}
${previousOptimizedAd?.headlines?.length ? `
PREVIOUS AI OPTIMIZATION (DO NOT REPEAT — generate fresh competitor-driven alternatives)
- Headlines: ${JSON.stringify(previousOptimizedAd.headlines.slice(0, 15))}
- Descriptions: ${JSON.stringify(previousOptimizedAd.descriptions.slice(0, 4))}
- At least 80% of new headlines must use different wording vs this previous AI version
- Mine competitor adGallery for NEW angles, offers, and trust signals not used above
` : ''}

TONE: ${toneInstruction}
OPTIMIZATION MODE: ${modeInstruction}
${variationHint ? `VARIATION: ${variationHint}` : ''}
${customPrompt?.trim() ? `\nUSER INSTRUCTIONS:\n${customPrompt.trim()}\n` : ''}
${websiteNote}

COMPLIANCE
- Headlines: max 30 chars, exactly 15 unique
- Descriptions: max 90 chars, exactly 4 unique — each a COMPLETE sentence (ends . ! ?), 70-90 chars, never truncated mid-word
- Display paths: max 15 chars each
- Google Ads compliant, publishable today
- Keep ALL string fields concise (1-2 sentences max). Limit arrays to the counts shown — do not exceed.

Return ONLY valid JSON (no markdown). Competitor profile cards are derived server-side — do NOT repeat full competitor crawl data.
{
  "headlines": ["exactly 15 headlines"],
  "descriptions": ["exactly 4 descriptions"],
  "displayPaths": ["path1", "path2"],
  "callouts": ["4 callouts max"],
  "sitelinks": ["4 sitelinks max"],
  "structuredSnippets": ["4 snippet values max"],
  "reasoning": "2-3 sentence executive summary",
  "strategistReasoning": {
    "headlineChanges": "1-2 sentences",
    "descriptionChanges": "1-2 sentences",
    "keywordRelevance": "1-2 sentences",
    "qualityScore": "1 sentence",
    "conversionPotential": "1-2 sentences",
    "auditFindingsAddressed": ["max 4 bullets"],
    "competitorInsightsUsed": ["max 4 specific competitor insights applied"],
    "competitiveOutperformance": {
      "messagingImprovements": "1-2 sentences vs competitors",
      "keywordImprovements": "1-2 sentences",
      "offerImprovements": "1-2 sentences",
      "conversionImprovements": "1-2 sentences"
    }
  },
  "missingCompetitorAdvantages": ["max 5 gaps vs competitors"],
  "recommendedKeywords": ["max 8 keywords"],
  "negativeKeywordSuggestions": ["max 10 negatives"],
  "recommendedExtensions": ["max 4"],
  "landingPageRecommendations": ["max 3"],
  "budgetRecommendations": ["max 2"],
  "biddingRecommendations": ["max 2"],
  "audienceRecommendations": ["max 2"],
  "performanceEstimates": {
    "label": "AI Estimated Impact",
    "current": { "ctr": "", "qualityScore": "", "conversionRate": "", "cpa": "" },
    "estimated": { "ctr": "", "qualityScore": "", "conversionRate": "", "cpa": "" }
  },
  "campaignHealth": { "currentScore": 0, "predictedScore": 0, "explanation": "1 sentence" },
  "predictedImprovements": { "ctr": "", "qualityScore": "", "conversionRate": "" }
}`;
}

/** Shorter retry prompt when the first Claude response was truncated or invalid JSON. */
export function buildCompactOptimizeRetryPrompt(ctx: FullOptimizeAdContext): string {
  const brandName = resolveBusinessName(ctx.intelligence.business.name, ctx.intelligence.business.websiteUrl);
  const prevBlock = ctx.previousOptimizedAd?.headlines?.length
    ? `\nDo NOT repeat previous AI headlines: ${JSON.stringify(ctx.previousOptimizedAd.headlines.slice(0, 8))}. Use fresh competitor-driven angles from adGallery.`
    : '';
  return `Return ONLY compact valid JSON for Google Ads RSA optimization. Brand: ${brandName}.
Scenario: ${ctx.scenario}. Finding: ${ctx.finding.title}.${prevBlock}

Required: exactly 15 headlines (≤30 chars), 4 descriptions (≤90 chars), displayPaths [path1,path2].
Include brief strategistReasoning with competitiveOutperformance (4 one-sentence fields) and competitorInsightsUsed (max 3).
Include missingCompetitorAdvantages (max 4), recommendedKeywords (max 6), negativeKeywordSuggestions (max 8).
Include callouts (4), sitelinks (4), reasoning (2 sentences), predictedImprovements {ctr, qualityScore, conversionRate}.
NO markdown. NO extra text. Stay under 3500 tokens total output.`;
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
