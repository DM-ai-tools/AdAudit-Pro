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
    finalUrls?: string[];
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
  /** Ad-level Make This Ad Better — hard lock RSA to this service */
  adServiceLock?: {
    primaryService: string;
    productsServices: string[];
    landingPage?: string;
    originalHeadlines: string[];
    originalDescriptions: string[];
  };
}

const MODE_INSTRUCTIONS: Record<OptimizationMode, string> = {
  conservative:
    'CONSERVATIVE MODE: Refine the current ad for clarity and QS, but still incorporate competitor Transparency Center angles where the client is clearly losing. At least 50% of headlines must use new phrasing vs the existing ad.',
  balanced:
    'BALANCED MODE: Study competitor Transparency Center ads (adGallery) and produce an ad that beats them on offers, trust, and keywords — while being clearly different from the EXISTING AD. Do NOT paraphrase current headlines; borrow competitor winning angles and improve them. Target Ad Difference Score 70+.',
  aggressive:
    `AGGRESSIVE MODE (DEFAULT — AI OPTIMIZED AD GENERATION 2.0):
You are a senior Google Ads RSA strategist. Your job is to make the AI Optimized Ad OBVIOUSLY 10× stronger than the EXISTING AD and clearly better than every rival in adGallery.
DO NOT rewrite, polish, paraphrase, or rearrange the EXISTING AD. Treat it as a failing baseline to LEAVE BEHIND.
Study competitor Transparency ads: steal their winning OFFERS / TRUST / CTAs / PROOF angles (never verbatim copy), then invent stronger client-branded versions.
At least 90% of headlines must be net-new ideas (new benefits, new offers, new social proof, new geo hooks, new urgency) — not synonym swaps of the current ad.
Descriptions must introduce NEW commercial hooks (rate compare, approval speed, no-deposit, broker vs lender, local specialist, review proof) not present in the existing ad.
Include local/regional intent when the market/location is known (e.g. Melbourne car finance) WITHOUT cloning the current "City + Product" headline pattern.
Sitelinks must have DISTINCT labels AND DISTINCT destination URLs (quote, rates, about, contact) — never four copies of the same final URL.
Target Ad Difference Score 80+ (server-scored). Similar drafts are rejected and regenerated.`,
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

function trimJson(data: unknown[], max = 8): string {
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

  // Keep this payload lean — oversized competitor dumps cause Claude max_tokens truncations.
  const beatBrief = (c.adGallery ?? [])
    .slice(0, 4)
    .map((x) => {
      const name = x.advertiserName ?? x.name;
      const heads = (x.headlines ?? []).slice(0, 3).filter(Boolean);
      const offers = (x.offers ?? []).slice(0, 2).filter(Boolean);
      const trust = (x.trustSignals ?? []).slice(0, 2).filter(Boolean);
      return {
        competitor: name,
        influencePercent: x.influencePercent,
        adDurationDays: x.adDurationDays,
        winningHeadlines: heads,
        offers,
        trustSignals: trust,
        beatInstruction: `Beat "${name}" with stronger offer/trust/CTA (do not copy): ${heads.join(' | ') || 'use their positioning'}`,
      };
    });

  return JSON.stringify({
    source: c.source,
    selectionCriteria:
      'Ranked by AI Learning Value. Prefer same-region peers. Higher influencePercent rivals shape more copy. Never copy verbatim.',
    mandatoryCompetitorBeatBrief: beatBrief,
    influenceWeights: (c.influenceWeights ?? c.competitors?.slice(0, 4).map((x) => ({
      name: x.name,
      score: x.confidenceScore ?? 0,
      aiLearningValue: x.aiLearningValue ?? x.aiLearning?.aiLearningValue,
      influencePercent: x.influencePercent ?? 0,
    }))).slice(0, 4),
    marketPatterns: c.marketPatterns
      ? {
          topHeadlines: c.marketPatterns.topHeadlines?.slice(0, 4),
          topOffers: c.marketPatterns.topOffers?.slice(0, 4),
          topCtas: c.marketPatterns.topCtas?.slice(0, 3),
          topKeywords: c.marketPatterns.topKeywords?.slice(0, 6),
          topValuePropositions: c.marketPatterns.topValuePropositions?.slice(0, 3),
        }
      : undefined,
    competitors: c.competitors?.slice(0, 4).map((x) => ({
      name: x.name,
      confidenceScore: x.confidenceScore,
      aiLearningValue: x.aiLearningValue ?? x.aiLearning?.aiLearningValue,
      influencePercent: x.influencePercent,
      brandAuthorityScore: x.brandAuthorityScore ?? x.brandAuthority?.brandAuthorityScore,
      advertisingScore: x.advertisingScore ?? x.advertisingStrength?.advertisingScore,
      marketPosition: x.marketPosition ?? x.brandAuthority?.marketPosition,
      competitiveThreat: x.competitiveThreat ?? x.brandAuthority?.competitiveThreat,
      headlines: x.headlines?.slice(0, 5),
      offers: x.offers?.slice(0, 4),
      ctas: x.ctas?.slice(0, 3),
      trustSignals: x.trustSignals?.slice(0, 4),
      keyMessages: x.keyMessages?.slice(0, 4),
      adDurationDays: x.adDurationDays,
      activeAdCount: x.activeAdCount,
      totalAdCount: x.totalAdCount,
      offerTrustAnalysis: x.offerTrustAnalysis
        ? {
            offersUsed: x.offerTrustAnalysis.offersUsed?.slice(0, 4),
            trustSignals: x.offerTrustAnalysis.trustSignals?.slice(0, 4),
            uniqueSellingPoints: x.offerTrustAnalysis.uniqueSellingPoints?.slice(0, 3),
          }
        : undefined,
      brandReview: x.brandReview
        ? {
            score: x.brandReview.score,
            summary: x.brandReview.summary?.slice(0, 180),
            howToBeat: x.brandReview.howToBeat?.slice(0, 3),
            strengths: x.brandReview.strengths?.slice(0, 3),
            weaknesses: x.brandReview.weaknesses?.slice(0, 3),
            positiveThemes: x.brandReview.positiveThemes?.slice(0, 3),
            negativeThemes: x.brandReview.negativeThemes?.slice(0, 2),
          }
        : undefined,
    })),
    missingOffers: c.missingOffers?.slice(0, 6),
    missingFromYourAds: c.missingFromYourAds?.slice(0, 6),
    keywordOpportunities: c.keywordOpportunities?.slice(0, 8),
    adGallery: c.adGallery?.slice(0, 4).map((x) => ({
      advertiserName: x.advertiserName ?? x.name,
      headlines: (x.headlines ?? []).slice(0, 5),
      descriptions: (x.descriptions ?? []).slice(0, 2),
      offers: (x.offers ?? []).slice(0, 3),
      ctas: (x.ctas ?? []).slice(0, 3),
      trustSignals: (x.trustSignals ?? []).slice(0, 3),
      adDurationDays: x.adDurationDays,
      activeAdCount: x.activeAdCount,
      totalAdCount: x.totalAdCount,
      influencePercent: x.influencePercent,
      aiLearningValue: x.aiLearningValue,
      confidenceScore: x.confidenceScore,
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
    adServiceLock,
  } = ctx;
  const mode = optimizationMode ?? 'aggressive';
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

AI OPTIMIZED AD GENERATION 2.0 — NON-NEGOTIABLE
- The AI Optimized Ad must NOT be a simple rewrite of the current ad
- Users must immediately notice a major difference between Current Ad and AI Optimized Ad
- Do not be conservative: change messaging, CTAs, positioning, and offer strategy when competitor intelligence supports it
- Learn from the strongest competitors (AI Learning Value / influencePercent) — advertising success, trust, market authority, social presence, brand strength — then generate ads that outperform BOTH the current ad AND the competition
- Never copy competitors verbatim; synthesize stronger client-branded copy

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

MANDATORY USE OF COMPETITOR SUGGESTIONS
- Read mandatoryCompetitorBeatBrief carefully — each rival lists winningHeadlines / offers / trustSignals
- Across the 15 RSA headlines you MUST cover DISTINCT competitor-beating angles:
  (1) Offer they push that you lack (from missingOffers / gallery offers)
  (2) Trust / proof they use (reviews, licensed, years, broker status)
  (3) Speed / approval path they advertise
  (4) Geo specialist angle that beats their city headline (keep geo intent, change the hook)
  (5) Compare-and-win / rate advantage angle
  (6) Vehicle type / eligibility angle (new & used, no deposit, bad credit — only if true for the client)
- For each high-influence rival, name them in competitorInsightsUsed / topCompetitorsInfluencing and state which of their angles you adapted
- If missingFromYourAds is non-empty, convert at least 3 of those gaps into concrete headlines or description lines
- Do NOT output a near-twin of the current ad that merely reorders City + Product words

COMPETITIVE DIFFERENTIATION REQUIREMENTS (GENERATION 2.0 — 10× BETTER BAR)
- If optimizing a SINGLE AD for one service (e.g. Business Loan vs Car Loan), ONLY learn from competitors/gallery ads for that same service — never blend unrelated service messaging from campaign-wide rivals
- Prefer SAME-REGION rivals when location is known (e.g. Melbourne / VIC peers over generic national fluff) while still using strong national peers as offer benchmarks
- Identify Top Competitor Offers, Messaging, CTAs, Keywords, Trust Signals, Positioning, and Value Propositions from adGallery + marketPatterns + offerTrustAnalysis
- Ask: What is missing from the current ad? What are competitors doing better? What messaging wins consistently? What would make a shopper click THIS ad instead of theirs?
- The adGallery contains EXACT competitor ads from Google Transparency Center via SociaVault — treat these as the benchmark to BEAT, not templates to echo
- Do NOT treat competitors equally. Use influenceWeights / influencePercent (driven by aiLearningValue): a 40% influence rival should shape more headlines/offers than a 20% rival
- Prefer learning from competitors with higher aiLearningValue, advertisingScore, brandAuthorityScore, trustScore, longer adDurationDays, socialPresence, and market authority
- Use brandReview.strengths / positiveThemes / offerTrustAnalysis as angles to match or exceed; use brandReview.weaknesses / negativeThemes as gaps you can win
- Your output MUST look like a DIFFERENT campaign to any human comparing Current vs AI Optimized side-by-side
- FORBIDDEN patterns vs EXISTING AD: same headline with words reordered; "City Product" ↔ "Product City"; swapping "compares lenders" for "compares top lenders"; shallow synonym rewrites
- REQUIRED angles (include several of these across the 15 headlines): concrete offer, proof/trust, speed, local specialist, compare-to-win, approval path, fees transparency, vehicle type (new/used) when relevant
- Generate copy to outrank EACH competitor in adGallery — use their headlines/descriptions as the competitive baseline
- competitorInsights in JSON must ONLY name competitors from adGallery (exact same names)
- At least 90% of headlines must be net-new vs the existing ad; descriptions must introduce new value props or proof points
- Ads must out-position competitors while remaining unmistakably on-brand for the client
- In competitiveOutperformance / strategistReasoning / adGenerationExplanation, explain WHY Claude learned from each high-influence rival and WHY the new ad should outperform
- Fill adGenerationExplanation completely — users must see competitor signals, offers, trust, keywords, reviews, social authority, and market positioning used

${adServiceLock?.primaryService ? `
═══════════════════════════════════════════════════════════════════
AD-LEVEL SERVICE LOCK (HIGHEST PRIORITY — OVERRIDES CAMPAIGN / WEBSITE MIX)
═══════════════════════════════════════════════════════════════════
You are optimizing ONE selected RSA, NOT the whole campaign and NOT every product on the website.

LOCKED SERVICE (only product allowed in ALL RSA copy): "${adServiceLock.primaryService}"
Landing page / final URL for this ad: ${adServiceLock.landingPage ?? 'from selected ad'}
FORBIDDEN near-duplicates of the live ad (do NOT paraphrase these — invent stronger alternatives):
${adServiceLock.originalHeadlines.slice(0, 15).map((h) => `- ${h}`).join('\n')}
${adServiceLock.originalDescriptions.slice(0, 4).map((d) => `- ${d}`).join('\n')}

MANDATORY:
- Read the selected ad + landing URL and understand its motive: promote "${adServiceLock.primaryService}" only
- EVERY headline (all 15), EVERY description (all 4), sitelinks, callouts, and structured snippets MUST be about "${adServiceLock.primaryService}"
- displayPaths must reflect this service (e.g. car-loans / car-finance) — never another product path
- Learn ONLY from competitor adGallery creatives that advertise "${adServiceLock.primaryService}" (or the same family: car/auto/vehicle finance)
- When geo is present in the live ad or market context, keep geo INTENT but change the HOOK (offer/proof/CTA) so it is not a twin of the current ad

FORBIDDEN (will cause rejection):
- Business loans, SME loans, commercial loans, home loans, mortgages, personal loans, credit cards, insurance — unless the locked service IS that product
- Writing "business loans" when locked service is car/auto/vehicle loans (or vice versa)
- Campaign-wide messaging that ignores this ad's service
- Using website homepage fluff that pulls in other products
- Four sitelinks that all use the identical destination URL — each sitelink needs a distinct useful path (quote / rates / about / contact) under the same domain when possible

If the locked service is Car Loans / Auto / Vehicle finance: talk about cars, auto finance, vehicle loans, repayments, used/new cars, broker comparison for CAR finance — NEVER SME/business lending.
` : ''}
${scenario === 'REPLACE_EXISTING' ? `EXISTING AD (live in Google Ads — WEAK BASELINE TO BEAT, NOT A TEMPLATE)
- Headlines: ${JSON.stringify(currentAd.headlines)}
- Descriptions: ${JSON.stringify(currentAd.descriptions)}
- Final URLs: ${JSON.stringify(currentAd.finalUrls ?? [])}
- CTR: ${currentAd.ctr ?? perf?.ctr ?? 'Unknown'}%
- Quality Score: ${currentAd.qualityScore ?? perf?.avgQualityScore ?? 'Unknown'}
- Conversions: ${currentAd.conversions ?? perf?.conversions ?? 'Unknown'}
- Ad strength: ${currentAd.adStrength ?? 'Unknown'}
- A human must instantly see the AI Optimized Ad as a major upgrade: richer offers, sharper CTAs, stronger trust/proof, clearer regional/service hooks from competitor intel
- FORBIDDEN: producing headlines that are paraphrases or near-duplicates of the above
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

COMPLIANCE (PUBLISHABLE COPY — NON-NEGOTIABLE)
- Headlines: max 30 chars EACH, exactly 15 unique — every headline must be a COMPLETE phrase with COMPLETE words (never "Approv", "Consultati", mid-word cuts, or dangling hyphens)
- If a phrase cannot fit in 30 chars with full words, rewrite shorter (e.g. "Fast Approvals" not "Commercial Loans - Fast Approv")
- Descriptions: max 90 chars, exactly 4 unique — each a COMPLETE sentence (ends . ! ?), ideally 70-90 chars, never truncated mid-word
- Callouts: max 25 chars, complete words only
- Sitelinks: max 25 chars link text, COMPLETE words; return 4 objects {"label":"...","url":"..."} with DISTINCT destination URLs under the client domain when possible (e.g. /car-loans/, /get-a-quote/, /about/, /contact/) — never four sitelinks pointing at the identical URL
- Display paths: max 15 chars each, real site path segments
- Google Ads compliant, publishable today
- Keep ALL string fields concise (1 sentence max). Limit arrays to the counts shown — do not exceed.
- CRITICAL OUTPUT BUDGET: Return compact JSON only. No markdown. No prose outside JSON. Prefer short strings so the full object fits under ~6k tokens.

Return ONLY valid JSON (no markdown). Competitor profile cards are derived server-side — do NOT repeat full competitor crawl data.
{
  "headlines": ["exactly 15 headlines"],
  "descriptions": ["exactly 4 descriptions"],
  "displayPaths": ["path1", "path2"],
  "callouts": ["4 callouts max"],
  "sitelinks": [{"label":"Get a Quote","url":"https://example.com/quote"},{"label":"Compare Rates","url":"https://example.com/rates"},{"label":"About Us","url":"https://example.com/about"},{"label":"Contact","url":"https://example.com/contact"}],
  "structuredSnippets": ["4 snippet values max"],
  "reasoning": "2 sentence executive summary",
  "strategistReasoning": {
    "headlineChanges": "1 sentence",
    "descriptionChanges": "1 sentence",
    "keywordRelevance": "1 sentence",
    "qualityScore": "1 sentence",
    "conversionPotential": "1 sentence",
    "auditFindingsAddressed": ["max 3 bullets"],
    "competitorInsightsUsed": ["max 3 insights"],
    "competitiveOutperformance": {
      "messagingImprovements": "1 sentence",
      "keywordImprovements": "1 sentence",
      "trustSignalImprovements": "1 sentence",
      "offerImprovements": "1 sentence",
      "ctaImprovements": "1 sentence",
      "conversionImprovements": "1 sentence",
      "competitorStrategiesUsed": "short",
      "competitorGapsExploited": "short"
    }
  },
  "missingCompetitorAdvantages": ["max 4"],
  "adGenerationExplanation": {
    "competitorSignalsUsed": ["max 4"],
    "topCompetitorsInfluencing": [
      { "name": "exact gallery name", "influencePercent": 40, "reason": "short" }
    ],
    "offersUsed": ["max 4"],
    "trustSignalsUsed": ["max 4"],
    "keywordsUsed": ["max 5"],
    "reviewInsightsUsed": ["max 3"],
    "socialAuthorityInsightsUsed": ["max 2"],
    "marketPositioningUsed": ["max 2"]
  },
  "recommendedKeywords": ["max 6"],
  "negativeKeywordSuggestions": ["max 8"],
  "recommendedExtensions": ["max 3"],
  "landingPageRecommendations": ["max 2"],
  "budgetRecommendations": ["max 2"],
  "biddingRecommendations": ["max 2"],
  "audienceRecommendations": ["max 2"],
  "performanceEstimates": {
    "label": "AI Estimated Impact",
    "current": { "ctr": "", "qualityScore": "", "conversionRate": "", "cpa": "", "roas": "", "monthlyLeads": "" },
    "estimated": { "ctr": "", "qualityScore": "", "conversionRate": "", "cpa": "", "roas": "", "monthlyLeads": "" }
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
  const health = ctx.intelligence.auditHealth?.score ?? 50;
  const lock = ctx.adServiceLock;
  const serviceLock = lock?.primaryService
    ? `
SERVICE LOCK (CRITICAL): This is ONE ad for "${lock.primaryService}" only (landing: ${lock.landingPage ?? 'n/a'}).
Original ad: ${JSON.stringify(lock.originalHeadlines.slice(0, 8))} / ${JSON.stringify(lock.originalDescriptions.slice(0, 2))}
ALL 15 headlines + 4 descriptions + sitelinks + callouts MUST promote "${lock.primaryService}" only.
FORBIDDEN: any other loan vertical (business/home/personal/SME) unless that IS the locked service.
If locked service is Car Loans: write about car/auto/vehicle finance only — never business loans.
`
    : '';
  return `Return ONLY compact valid JSON for Google Ads RSA optimization. Brand: ${brandName}.
Scenario: ${ctx.scenario}. Finding: ${ctx.finding.title}. Mode: AGGRESSIVE Generation 2.0.${prevBlock}
${serviceLock}
CRITICAL: Produce a dramatically different ad from the existing/current copy — not a rewrite. Mine competitor adGallery for offers, trust, CTAs, keywords FOR THE LOCKED SERVICE ONLY. Prefer same-city rivals when location is known. At least 90% of headlines must be net-new vs the live ad. Sitelinks need distinct labels AND distinct URLs.

Required fields (all must be present — Make It Better UI depends on them):
- exactly 15 headlines (≤30 chars, COMPLETE words), 4 descriptions (≤90 chars), displayPaths [path1,path2] matching the locked service
- callouts (4), sitelinks (4 objects with label+url), reasoning (2 sentences)
- predictedImprovements {ctr, qualityScore, conversionRate} with values like "+18% est."
- performanceEstimates: { label:"AI Estimated Impact", current:{ctr,qualityScore,conversionRate,cpa,roas,monthlyLeads,monthlySavings}, estimated:{same keys with uplift strings} }
- campaignHealth: { currentScore:${health}, predictedScore:${Math.min(100, health + 18)}, explanation:"one sentence" }
- accountImpact: { currentAccountHealth:${health}, predictedAccountHealth:${Math.min(100, health + 18)}, currentMonthlyLeads, estimatedMonthlyLeads, currentWastedSpend, estimatedWastedSpend, currentRoas, estimatedRoas }
- strategistReasoning with competitiveOutperformance (short one-sentence fields) and competitorInsightsUsed (max 3)
- adGenerationExplanation with topCompetitorsInfluencing (max 3), offersUsed, trustSignalsUsed, competitorSignalsUsed, keywordsUsed
- missingCompetitorAdvantages (max 4), recommendedKeywords (max 6), negativeKeywordSuggestions (max 8)
- strategistRecommendations: { keywords, negativeKeywords, extensions, landingPage, budget, bidding, audience } — 2-4 short bullets each
NO markdown. NO empty strings for metrics (use "—" only if truly unknown). Keep the ENTIRE JSON under 5500 output tokens — short sentences only.`;
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
    finalUrls: ad.finalUrls,
  };
}
