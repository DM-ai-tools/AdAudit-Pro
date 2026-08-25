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
    'BALANCED MODE: (1) Read the CURRENT AD. (2) Note competitor adGallery creatives. (3) Produce a stronger CLIENT-focused RSA that is clearly different from the CURRENT AD. Do NOT paraphrase current headlines; do NOT name or degrade rivals in ad copy. Target Ad Difference Score 90+. Every headline and description must be grammatically correct English.',
  aggressive:
    `AGGRESSIVE MODE (DEFAULT — AI OPTIMIZED AD GENERATION 2.0):
You are a senior Google Ads RSA strategist. Workflow is FIXED:
(1) READ THE CURRENT AD first — diagnose what it already says and what is weak/generic.
(2) NOTE COMPETITOR ADS from adGallery — list winning offers / trust / CTAs / proof / keywords.
(3) SUGGEST a new RSA that is OBVIOUSLY different from the current ad AND stronger than rival angles — without naming or attacking rivals in the ad.
DO NOT rewrite, polish, paraphrase, or rearrange the EXISTING AD. Treat it as a failing baseline to LEAVE BEHIND.
At least 90% of headlines must be net-new ideas (new benefits, new offers, new social proof, new geo hooks, new urgency) — not synonym swaps of the current ad.
Descriptions must introduce NEW commercial hooks (rate compare, approval speed, broker vs lender choice, local specialist, review proof) not present in the existing ad — professional and verifiable only (no "0%" hype).
Include local/regional intent when the market/location is known (e.g. Melbourne car finance) WITHOUT cloning the current "City + Product" headline pattern.
Sitelinks must have DISTINCT labels AND DISTINCT destination URLs (quote, rates, about, contact) — never four copies of the same final URL.
Target Ad Difference Score 90+ (server-scored). Near-clone drafts are rejected and regenerated.`,
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

  const documentOnly = c.source === 'user_provided';
  // Document uploads are a curated shortlist — send more of their ads/intel into the generator
  const rivalLimit = documentOnly ? 10 : 4;
  const gallery = c.adGallery ?? [];
  const profiles = c.competitors ?? [];

  const beatBrief = gallery.slice(0, rivalLimit).map((x) => {
    const name = x.advertiserName ?? x.name;
    const heads = (x.headlines ?? []).slice(0, documentOnly ? 5 : 3).filter(Boolean);
    const descs = (x.descriptions ?? []).slice(0, 2).filter(Boolean);
    const offers = (x.offers ?? []).slice(0, documentOnly ? 4 : 2).filter(Boolean);
    const trust = (x.trustSignals ?? x.offerTrustAnalysis?.trustSignals ?? []).slice(0, 3).filter(Boolean);
    const ctas = (x.ctas ?? []).slice(0, 3).filter(Boolean);
    return {
      competitor: name,
      domain: x.url,
      influencePercent: x.influencePercent,
      adDurationDays: x.adDurationDays,
      activeAdCount: x.activeAdCount,
      totalAdCount: x.totalAdCount,
      winningHeadlines: heads,
      winningDescriptions: descs,
      offers,
      ctas,
      trustSignals: trust,
      beatInstruction: `Use "${name}" ads as inspiration only — write stronger CLIENT-branded offers/trust/CTAs. Never name "${name}" or say you beat them in the ad copy: ${
        heads.join(' | ') || descs.join(' | ') || offers.join(' | ') || 'out-position their messaging professionally'
      }`,
    };
  });

  // If gallery creatives are thin, still force learning from uploaded competitor profiles
  if (documentOnly && beatBrief.length < profiles.length) {
    for (const p of profiles) {
      if (beatBrief.some((b) => b.competitor.toLowerCase() === p.name.toLowerCase())) continue;
      beatBrief.push({
        competitor: p.name,
        domain: p.url,
        influencePercent: p.influencePercent,
        adDurationDays: p.adDurationDays,
        activeAdCount: p.activeAdCount,
        totalAdCount: p.totalAdCount,
        winningHeadlines: (p.headlines ?? p.keyMessages ?? []).slice(0, 5).filter(Boolean),
        winningDescriptions: (p.descriptions ?? []).slice(0, 2).filter(Boolean),
        offers: (p.offers ?? p.offerTrustAnalysis?.offersUsed ?? []).slice(0, 4).filter(Boolean),
        ctas: (p.ctas ?? []).slice(0, 3).filter(Boolean),
        trustSignals: (p.trustSignals ?? p.offerTrustAnalysis?.trustSignals ?? []).slice(0, 3).filter(Boolean),
        beatInstruction: `Use uploaded rival "${p.name}" offers/trust/key messages as inspiration only. Write professional CLIENT-focused copy — never name or degrade "${p.name}" in the ad.`,
      });
      if (beatBrief.length >= rivalLimit) break;
    }
  }

  return JSON.stringify({
    source: c.source,
    documentUploadedCompetitors: documentOnly,
    selectionCriteria: documentOnly
      ? 'USER-UPLOADED DOCUMENT ONLY. Generate the AI Optimized Ad exclusively against these rivals and their Transparency/SociaVault ads. Do not invent other competitors.'
      : 'Ranked by AI Learning Value. Prefer same-region peers. Higher influencePercent rivals shape more copy. Never copy verbatim.',
    mandatoryCompetitorBeatBrief: beatBrief,
    influenceWeights: (c.influenceWeights ?? profiles.slice(0, rivalLimit).map((x) => ({
      name: x.name,
      score: x.confidenceScore ?? 0,
      aiLearningValue: x.aiLearningValue ?? x.aiLearning?.aiLearningValue,
      influencePercent: x.influencePercent ?? 0,
    }))).slice(0, rivalLimit),
    marketPatterns: c.marketPatterns
      ? {
          topHeadlines: c.marketPatterns.topHeadlines?.slice(0, documentOnly ? 8 : 4),
          topOffers: c.marketPatterns.topOffers?.slice(0, documentOnly ? 8 : 4),
          topCtas: c.marketPatterns.topCtas?.slice(0, documentOnly ? 6 : 3),
          topKeywords: c.marketPatterns.topKeywords?.slice(0, documentOnly ? 10 : 6),
          topValuePropositions: c.marketPatterns.topValuePropositions?.slice(0, documentOnly ? 6 : 3),
        }
      : undefined,
    competitors: profiles.slice(0, rivalLimit).map((x) => ({
      name: x.name,
      url: x.url,
      confidenceScore: x.confidenceScore,
      aiLearningValue: x.aiLearningValue ?? x.aiLearning?.aiLearningValue,
      influencePercent: x.influencePercent,
      brandAuthorityScore: x.brandAuthorityScore ?? x.brandAuthority?.brandAuthorityScore,
      advertisingScore: x.advertisingScore ?? x.advertisingStrength?.advertisingScore,
      marketPosition: x.marketPosition ?? x.brandAuthority?.marketPosition,
      competitiveThreat: x.competitiveThreat ?? x.brandAuthority?.competitiveThreat,
      headlines: x.headlines?.slice(0, documentOnly ? 8 : 5),
      descriptions: x.descriptions?.slice(0, 3),
      offers: x.offers?.slice(0, documentOnly ? 6 : 4),
      ctas: x.ctas?.slice(0, 4),
      trustSignals: x.trustSignals?.slice(0, documentOnly ? 6 : 4),
      keyMessages: x.keyMessages?.slice(0, documentOnly ? 6 : 4),
      adDurationDays: x.adDurationDays,
      activeAdCount: x.activeAdCount,
      totalAdCount: x.totalAdCount,
      offerTrustAnalysis: x.offerTrustAnalysis
        ? {
            offersUsed: x.offerTrustAnalysis.offersUsed?.slice(0, 5),
            trustSignals: x.offerTrustAnalysis.trustSignals?.slice(0, 5),
            uniqueSellingPoints: x.offerTrustAnalysis.uniqueSellingPoints?.slice(0, 4),
          }
        : undefined,
      brandReview: x.brandReview
        ? {
            score: x.brandReview.score,
            summary: x.brandReview.summary?.slice(0, 220),
            howToBeat: x.brandReview.howToBeat?.slice(0, 4),
            strengths: x.brandReview.strengths?.slice(0, 4),
            weaknesses: x.brandReview.weaknesses?.slice(0, 4),
            positiveThemes: x.brandReview.positiveThemes?.slice(0, 4),
            negativeThemes: x.brandReview.negativeThemes?.slice(0, 3),
          }
        : undefined,
      aiLearning: x.aiLearning
        ? {
            aiLearningValue: x.aiLearning.aiLearningValue,
            competitorScore: x.aiLearning.competitorScore,
            influencePercent: x.aiLearning.influencePercent,
          }
        : undefined,
    })),
    missingOffers: c.missingOffers?.slice(0, documentOnly ? 10 : 6),
    missingFromYourAds: c.missingFromYourAds?.slice(0, documentOnly ? 10 : 6),
    keywordOpportunities: c.keywordOpportunities?.slice(0, documentOnly ? 12 : 8),
    messagingOpportunities: c.messagingOpportunities?.slice(0, 8),
    adGallery: gallery.slice(0, rivalLimit).map((x) => ({
      advertiserName: x.advertiserName ?? x.name,
      url: x.url,
      headlines: (x.headlines ?? []).slice(0, documentOnly ? 8 : 5),
      descriptions: (x.descriptions ?? []).slice(0, documentOnly ? 3 : 2),
      offers: (x.offers ?? []).slice(0, documentOnly ? 5 : 3),
      ctas: (x.ctas ?? []).slice(0, 4),
      trustSignals: (x.trustSignals ?? []).slice(0, 4),
      adDurationDays: x.adDurationDays,
      activeAdCount: x.activeAdCount,
      totalAdCount: x.totalAdCount,
      influencePercent: x.influencePercent,
      aiLearningValue: x.aiLearningValue,
      confidenceScore: x.confidenceScore,
    })),
    gapAnalysisSummary: c.gapAnalysis?.summary,
    gapAnalysisRows: documentOnly
      ? (c.gapAnalysis?.rows ?? []).slice(0, 8).map((r) => ({
          category: r.category,
          competitor: r.competitor,
          competitorHas: r.competitorHas?.slice(0, 120),
          youHave: r.youHave?.slice(0, 120),
          gap: r.gap?.slice(0, 160),
        }))
      : undefined,
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
  const documentCompetitorsOnly = intelligence.competitorAnalysis?.source === 'user_provided';
  const uploadedRivalNames = documentCompetitorsOnly
    ? [
        ...(intelligence.competitorAnalysis?.competitors ?? []).map((c) => c.name),
        ...(intelligence.competitorAnalysis?.adGallery ?? []).map((g) => g.advertiserName ?? g.name),
      ]
        .map((n) => String(n ?? '').trim())
        .filter(Boolean)
        .filter((n, i, arr) => arr.findIndex((x) => x.toLowerCase() === n.toLowerCase()) === i)
        .slice(0, 12)
    : [];
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

  const documentBeatBlock = documentCompetitorsOnly
    ? `
═══════════════════════════════════════════════════════════════════
UPLOADED DOCUMENT COMPETITORS (HIGHEST PRIORITY — MAKE IT BETTER PAGE)
═══════════════════════════════════════════════════════════════════
The user uploaded a competitor list for this ad. Make It Better shows ONLY these rivals.
Generate the AI Optimized Ad using their Transparency/SociaVault ads, offers, trust signals, CTAs, gap analysis, and missingFromYourAds as private inspiration.

UPLOADED RIVALS (inspiration only — never put these names in ad copy): ${uploadedRivalNames.join(', ') || '(see COMPETITOR INTELLIGENCE JSON)'}

MANDATORY:
- Study adGallery + mandatoryCompetitorBeatBrief for EACH uploaded rival — their live headlines, descriptions, offers, CTAs, trustSignals
- Convert gapAnalysisRows + missingFromYourAds + missingOffers into concrete CLIENT-benefit RSA headlines/descriptions
- In competitorInsightsUsed / topCompetitorsInfluencing / adGenerationExplanation you MAY name these rivals (metadata only)
- In headlines, descriptions, callouts, and sitelinks: NEVER name rivals, never say you "beat" them
- Do NOT invent, discover, or learn from competitors outside this uploaded list
- If a rival has thin creatives, still improve using their profile offers / keyMessages / brandReview / offerTrustAnalysis

FORBIDDEN:
- Generic industry fluff unrelated to these rivals' ads
- Competitor brand names inside publishable ad copy
- "beats [rival]", "better than [rival]", unverifiable "0%" fee/interest claims
- Ignoring gap analysis opportunities shown on Make It Better
`
    : '';

  return `You are a Senior Google Ads Strategist — not a copywriter. Analyze the FULL account intelligence below, then produce publishable RSA ads AND strategic recommendations tied to real performance data.

AI OPTIMIZED AD GENERATION 2.0 — NON-NEGOTIABLE
- The AI Optimized Ad must NOT be a simple rewrite of the current ad
- Users must immediately notice a major difference between Current Ad and AI Optimized Ad
- Do not be conservative: change messaging, CTAs, positioning, and offer strategy when competitor intelligence supports it
- Learn from the strongest competitors (AI Learning Value / influencePercent) — advertising success, trust, market authority, social presence, brand strength — then generate ads that outperform BOTH the current ad AND the competition
- Never copy competitors verbatim; synthesize stronger client-branded copy
${documentCompetitorsOnly ? '- DOCUMENT MODE: Use uploaded Make It Better rivals as the sole competitive baseline — improve client positioning from their insights without naming or degrading them in ad copy' : ''}

MANDATORY WORKFLOW (FOLLOW IN ORDER — DO NOT SKIP)
1) CURRENT AD FIRST: Read the EXISTING / CURRENT AD headlines and descriptions carefully. Note what it already says (geo, product, CTA, proof). Treat it as the baseline you must LEAVE BEHIND — not polish.
2) NOTE COMPETITOR ADS: Read adGallery + mandatoryCompetitorBeatBrief. Write a private mental list of rival headlines, offers, trust signals, CTAs, and keywords that win clicks (and what the current ad is missing vs those).
3) IMPACT BRIEF: Decide which competitor pros to develop into YOUR brand voice (never name rivals in publishable copy). Explicitly list gaps: "Current ad lacks X/Y/Z that rivals use."
4) SUGGEST A NEW RSA: Only AFTER steps 1–3, write 15 headlines + 4 descriptions that a human comparing side-by-side would immediately see as DIFFERENT — new hooks, offers, proof, CTAs, and positioning. Forbidden: paraphrases, word-order swaps, synonym tweaks, or "City + Product" twins of the current ad.

YOUR ROLE
- Diagnose weak headlines, descriptions, CTAs, keyword relevance, quality score issues, wasted search terms, and landing page gaps
- Use audit findings, campaign metrics, website content, and competitor intelligence
- Generate ads that improve CTR, Quality Score, conversion rate, and reduce wasted spend
- Every recommendation must reference specific data from this analysis

SCENARIO: ${scenarioBlock}
${documentBeatBlock}
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

═══════════════════════════════════════════════════════════════════
STEP 1 — CURRENT AD (READ THIS FIRST — BASELINE TO LEAVE BEHIND)
═══════════════════════════════════════════════════════════════════
${currentAd.headlines?.length ? `Live RSA headlines: ${JSON.stringify(currentAd.headlines)}
Live RSA descriptions: ${JSON.stringify(currentAd.descriptions)}
Final URLs: ${JSON.stringify(currentAd.finalUrls ?? [])}
CTR: ${currentAd.ctr ?? perf?.ctr ?? 'Unknown'}% | QS: ${currentAd.qualityScore ?? perf?.avgQualityScore ?? 'Unknown'} | Conversions: ${currentAd.conversions ?? perf?.conversions ?? 'Unknown'} | Strength: ${currentAd.adStrength ?? 'Unknown'}
BEFORE writing any new copy: diagnose what this ad already says and what shoppers will still miss vs rivals.` : 'No live RSA baseline — invent a strong service-focused RSA from competitor + account intel.'}

COMPETITOR INTELLIGENCE (STEP 2 — NOTE THESE ADS BEFORE YOU WRITE)
${formatCompetitorIntel(intelligence)}

MANDATORY USE OF COMPETITOR SUGGESTIONS
- After diagnosing the current ad, read mandatoryCompetitorBeatBrief carefully — each rival lists winningHeadlines / offers / trustSignals
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
${scenario === 'REPLACE_EXISTING' ? `EXISTING AD REMINDER (already shown in STEP 1 — do not clone)
- STEP 2: Note competitor pros from adGallery that the current ad lacks
- STEP 3: Generate an AI Optimized Ad that a human would never confuse with the STEP 1 lines
- FORBIDDEN: producing headlines that are paraphrases, near-duplicates, or word-order swaps of STEP 1
- REQUIRED: new commercial hooks drawn from competitor adGallery (offers/trust/CTAs/keywords) expressed as client benefits
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
${customPrompt?.trim() ? `
CRITICAL CLIENT INSTRUCTIONS (HIGHEST PRIORITY — MUST FOLLOW)
The client typed explicit instructions below. You MUST reshape the RSA to satisfy them.
- Apply these instructions to headlines, descriptions, CTAs, display paths, and sitelinks where relevant
- If they conflict with tone/mode defaults, CLIENT INSTRUCTIONS WIN
- Do not ignore, soften, or partially skip them
CLIENT INSTRUCTIONS:
${customPrompt.trim()}
` : ''}
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

PROFESSIONAL CLIENT-FOCUSED COPY (NON-NEGOTIABLE)
- Ads must sell the CLIENT brand to searchers — never attack, name, or "beat" rival brands in headlines/descriptions/callouts/sitelinks
- FORBIDDEN in ad copy: competitor company names, "beats [rival]", "better than [rival]", "unlike [rival]", "vs [rival]", disparaging comparisons
- Learn from competitor insights privately, then express stronger CLIENT benefits (speed, trust, choice, local expertise, clear process)
- FORBIDDEN unverifiable / misleading offer claims: "0%", "0% fees", "0% interest", "free forever", absolute guarantees you cannot prove from website intel
- Prefer concrete professional hooks: compare lenders, free quote, fast approval path, licensed broker, local specialist, no obligation — only if true for the client
- Tone: attention-grabbing but professional; benefit-led; searcher-first; never cheap hard-sell hype

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
    "headlineChanges": "1 sentence — what changed vs current ad",
    "descriptionChanges": "1 sentence — what changed vs current ad",
    "keywordRelevance": "1 sentence",
    "qualityScore": "1 sentence",
    "conversionPotential": "1 sentence",
    "auditFindingsAddressed": ["max 3 bullets"],
    "competitorInsightsUsed": ["max 3 insights naming rivals + angles learned"],
    "competitiveOutperformance": {
      "messagingImprovements": "1 sentence comparing vs current ad gaps",
      "keywordImprovements": "1 sentence",
      "trustSignalImprovements": "1 sentence from competitor notes",
      "offerImprovements": "1 sentence from competitor notes",
      "ctaImprovements": "1 sentence",
      "conversionImprovements": "1 sentence",
      "competitorStrategiesUsed": "short — what you noted from rival ads",
      "competitorGapsExploited": "short — what current ad lacked that you fixed"
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
  const documentOnly = ctx.intelligence.competitorAnalysis?.source === 'user_provided';
  const rivalLimit = documentOnly ? 8 : 4;
  const galleryBeat = (ctx.intelligence.competitorAnalysis?.adGallery ?? [])
    .slice(0, rivalLimit)
    .map((g) => {
      const name = g.advertiserName ?? g.name;
      const heads = (g.headlines ?? []).slice(0, 3).join(' | ');
      const offers = (g.offers ?? []).slice(0, 2).join(', ');
      return `${name}: ${heads}${offers ? ` / offers: ${offers}` : ''}`;
    })
    .filter(Boolean);
  const profileBeat =
    documentOnly && galleryBeat.length < 2
      ? (ctx.intelligence.competitorAnalysis?.competitors ?? [])
          .slice(0, rivalLimit)
          .map((p) => `${p.name}: ${(p.headlines ?? p.keyMessages ?? []).slice(0, 3).join(' | ')} / offers=${(p.offers ?? []).slice(0, 2).join(', ')}`)
      : [];
  const beatLines = [...galleryBeat, ...profileBeat];
  const documentBlock = documentOnly
    ? `
DOCUMENT MODE: Use ONLY these uploaded Make It Better rivals as inspiration (do not invent others):
${beatLines.join('\n') || '(see competitor profiles)'}
Write professional CLIENT-focused RSA copy. Never name rivals or say you "beat" them in headlines/descriptions. No "0%" / unverifiable fee claims.
`
    : beatLines.length
      ? `\nCompetitor insights to improve on (do not name rivals in ad copy):\n${beatLines.join('\n')}\n`
      : '';
  const serviceLock = lock?.primaryService
    ? `
SERVICE LOCK (CRITICAL): This is ONE ad for "${lock.primaryService}" only (landing: ${lock.landingPage ?? 'n/a'}).
Original ad: ${JSON.stringify(lock.originalHeadlines.slice(0, 8))} / ${JSON.stringify(lock.originalDescriptions.slice(0, 2))}
ALL 15 headlines + 4 descriptions + sitelinks + callouts MUST promote "${lock.primaryService}" only.
FORBIDDEN: any other loan vertical (business/home/personal/SME) unless that IS the locked service.
If locked service is Car Loans: write about car/auto/vehicle finance only — never business loans.
`
    : '';
  const clientInstructions = ctx.customPrompt?.trim()
    ? `
CRITICAL CLIENT INSTRUCTIONS (HIGHEST PRIORITY — MUST FOLLOW):
${ctx.customPrompt.trim()}
Apply these to every headline and description. Client instructions override conflicting defaults.
`
    : '';
  return `Return ONLY compact valid JSON for Google Ads RSA optimization. Brand: ${brandName}.
Scenario: ${ctx.scenario}. Finding: ${ctx.finding.title}. Mode: AGGRESSIVE Generation 2.0.${prevBlock}
${serviceLock}${documentBlock}${clientInstructions}
CRITICAL: Workflow = (1) read current ad (2) note competitor ads (3) suggest a dramatically different RSA — not a rewrite. Mine competitor adGallery for offers, trust, CTAs, keywords${documentOnly ? ' from the UPLOADED rivals only' : lock?.primaryService ? ' FOR THE LOCKED SERVICE ONLY' : ''}. Prefer same-city rivals when location is known. At least 90% of headlines must be net-new vs the live ad. Sitelinks need distinct labels AND distinct URLs.

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
