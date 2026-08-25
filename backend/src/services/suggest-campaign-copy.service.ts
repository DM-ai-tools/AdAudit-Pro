import { claudeTextFromMessage, createClaudeMessage } from '../ai/anthropic-client.js';
import {
  ANTHROPIC_OPTIMIZE_MAX_TOKENS,
  ANTHROPIC_OPTIMIZE_MODEL_FALLBACKS,
} from '../ai/anthropic-models.js';
import { extractJsonFromClaudeText } from '../utils/claude-json.js';
import { getAuditReport } from './audit.service.js';
import { gatherAuditIntelligence } from './audit-intelligence.service.js';
import {
  analyzeCompetitors,
  type CompetitorAdPreview,
  type CompetitorIntelligence,
} from './competitor-intelligence.service.js';
import {
  campaignTypeLabel,
  defaultAdFormatLabel,
  normalizeAccountCampaignType,
} from '../utils/competitor-campaign-type.js';
import { countryToLocationLabel, resolveMarketCountry } from '../utils/region-codes.js';

export interface CampaignCopySuggestion {
  id: string;
  label: string;
  focusedCompetitor?: string;
  headlines: string[];
  descriptions: string[];
  displayPaths?: { path1?: string; path2?: string };
}

export interface SuggestCampaignCopyResult {
  campaignName?: string;
  adGroupName?: string;
  dailyBudget?: number;
  keywords: string[];
  finalUrl?: string;
  path1?: string;
  path2?: string;
  primary: CampaignCopySuggestion;
  variations: CampaignCopySuggestion[];
  competitorNames: string[];
  /** SociaVault / Transparency creatives matched to the service keyword */
  competitorAds: CompetitorAdPreview[];
  competitorSource?: CompetitorIntelligence['source'];
  serviceFocus?: string;
  stageNotes: string[];
}

function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const sliced = t.slice(0, max);
  const lastSpace = sliced.lastIndexOf(' ');
  return (lastSpace > max * 0.6 ? sliced.slice(0, lastSpace) : sliced).trim();
}

function normalizeList(values: unknown, max: number, maxLen: number): string[] {
  if (!Array.isArray(values)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    const text = clip(String(raw ?? ''), maxLen);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= max) break;
  }
  return out;
}

function isPlaceholderCompetitorName(name: string): boolean {
  const n = name.trim();
  if (!n) return true;
  return /^(competitor|rival|advertiser)\s*[a-d0-9]+$/i.test(n);
}

function realCompetitorNames(analysis: CompetitorIntelligence | null | undefined): string[] {
  if (!analysis) return [];
  const fromProfiles = (analysis.competitors ?? []).map((c) => c.name).filter(Boolean);
  const fromGallery = (analysis.adGallery ?? [])
    .map((g) => g.advertiserName || g.name || '')
    .filter(Boolean);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const name of [...fromProfiles, ...fromGallery]) {
    const cleaned = name.replace(/\s*[|\-–—:].*$/, '').trim();
    if (!cleaned || isPlaceholderCompetitorName(cleaned)) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
    if (out.length >= 4) break;
  }
  return out;
}

function competitorBrief(analysis: CompetitorIntelligence | null | undefined): string {
  if (!analysis) return 'No competitor ads available.';
  const gallery = (analysis.adGallery ?? [])
    .filter(
      (g) =>
        ((g.headlines?.length ?? 0) > 0 || (g.descriptions?.length ?? 0) > 0) &&
        g.adSource !== 'website_fallback'
    )
    .slice(0, 6);
  if (!gallery.length) {
    const rivals = (analysis.competitors ?? []).slice(0, 4);
    if (!rivals.length) return 'No competitor ads available.';
    return `Top competitors (brand names only — no exact creatives yet):\n${rivals
      .map((c, i) => `${i + 1}. ${c.name}`)
      .join('\n')}`;
  }

  const creativeBlocks = gallery.map((g, i) => {
    const name = g.advertiserName ?? g.name ?? `Rival ${i + 1}`;
    const source =
      g.adSource === 'transparency_center'
        ? 'Google Ads Transparency Center'
        : g.adSource === 'sociavault'
          ? 'Google Ad Library (SociaVault → Transparency)'
          : g.adSource ?? 'live ads';
    const headlines = (g.headlines ?? []).map((h) => `    - ${h}`).join('\n') || '    - (none)';
    const descriptions =
      (g.descriptions ?? []).map((d) => `    - ${d}`).join('\n') || '    - (none)';
    return `${i + 1}. ${name} [${source}]
   creativeUrl: ${g.creativeUrl ?? g.adLink ?? 'n/a'}
   format: ${g.format ?? 'text'}
   EXACT Headlines (verbatim — do not invent rival copy):
${headlines}
   EXACT Descriptions (verbatim):
${descriptions}`;
  });

  return [
    'EXACT COMPETITOR CREATIVES FROM GOOGLE ADS TRANSPARENCY / AD LIBRARY',
    'These strings are the live creatives shown in the UI. Study angles/offers/CTAs/proof.',
    'Write ORIGINAL client ads for our service + campaign type — never paste rival brand names into our headlines/descriptions.',
    creativeBlocks.join('\n\n'),
  ].join('\n');
}

function applyRealCompetitorLabels(
  variations: CampaignCopySuggestion[],
  competitorNames: string[]
): CampaignCopySuggestion[] {
  return variations.map((v, i) => {
    const real = competitorNames[i];
    if (!real) return v;
    const focused =
      v.focusedCompetitor && !isPlaceholderCompetitorName(v.focusedCompetitor)
        ? v.focusedCompetitor
        : real;
    return {
      ...v,
      focusedCompetitor: focused,
      label: `Inspired by ${focused}`,
    };
  });
}

export async function suggestCampaignCopy(options: {
  auditId: string;
  userId: string;
  serviceFocus?: string;
  websiteUrl?: string;
  campaignType?: string;
  adBrief?: {
    service?: string;
    adType?: string;
    campaignType?: string;
    offer?: string;
    audience?: string;
    tone?: string;
    ctaPreference?: string;
    mustInclude?: string;
    finalUrl?: string;
    locationFocus?: string;
  };
  onProgress?: (update: { progress: number; stage: string }) => void | Promise<void>;
}): Promise<SuggestCampaignCopyResult> {
  const emit = async (progress: number, stage: string) => {
    try {
      await options.onProgress?.({ progress, stage });
    } catch {
      /* ignore */
    }
  };

  const audit = await getAuditReport(options.auditId);
  if (!audit) throw new Error('Audit not found. Refresh the report and try again.');

  await emit(10, 'Loading account audit intelligence…');

  const serviceFocus =
    options.adBrief?.service?.trim() ||
    options.serviceFocus?.trim() ||
    '';

  // Skip competitors inside gather — a 120s timeout was discarding real rivals mid-run
  // and Claude then invented "Competitor A/B/C". We await analyzeCompetitors below.
  const intelligence = await gatherAuditIntelligence({
    auditId: options.auditId,
    userId: options.userId,
    dataWindowDays: audit.dataWindowDays,
    accountContext: {
      accountName: audit.accountName,
      googleAdsCustomerId: audit.googleAdsCustomerId,
      websiteUrl: options.websiteUrl || audit.websiteUrl,
      goal: audit.goal,
      monthlySpend: audit.monthlySpend,
      ...(serviceFocus
        ? {
            primaryService: serviceFocus,
            productsServices: [serviceFocus],
            location: options.adBrief?.locationFocus?.trim() || undefined,
          }
        : {}),
    },
    auditFindingsSnapshot: audit.findings,
    lightweight: true,
    skipCompetitorAnalysis: true,
  });

  const business = intelligence.business;
  const website = intelligence.websiteAnalysis;
  const resolvedServiceFocus =
    serviceFocus ||
    website?.services?.[0] ||
    'core services from the business website';

  await emit(25, `Finding competitors for “${resolvedServiceFocus}” via web search → domains → Google ads…`);

  const resolvedCampaignType =
    normalizeAccountCampaignType(options.campaignType) ||
    normalizeAccountCampaignType(options.adBrief?.campaignType) ||
    'search';
  const formatLabel = defaultAdFormatLabel(resolvedCampaignType);

  const competitorAnalysis = await analyzeCompetitors({
    businessName: business.name || audit.accountName,
    websiteUrl: options.websiteUrl || business.websiteUrl || audit.websiteUrl,
    industry: undefined,
    location:
      options.adBrief?.locationFocus?.trim() ||
      countryToLocationLabel(
        resolveMarketCountry({
          location: website?.locations?.[0],
          websiteUrl: options.websiteUrl || business.websiteUrl || audit.websiteUrl,
        })
      ) ||
      website?.locations?.[0],
    monthlySpend: business.monthlySpend ?? audit.monthlySpend,
    productsServices: [resolvedServiceFocus],
    primaryService: resolvedServiceFocus,
    serviceScoped: true,
    preferredCampaignType: resolvedCampaignType,
    offer: options.adBrief?.offer?.trim() || undefined,
    discoverySource: 'sociavault',
    websiteIntel: website
      ? {
          ...website,
          services: [resolvedServiceFocus],
          headings: [resolvedServiceFocus],
          title: resolvedServiceFocus,
          metaDescription: resolvedServiceFocus,
          rawTextSample: resolvedServiceFocus,
        }
      : {
          url: options.websiteUrl || business.websiteUrl || audit.websiteUrl || '',
          fetched: false,
          headings: [resolvedServiceFocus],
          offers: [],
          services: [resolvedServiceFocus],
          ctas: [],
          locations: options.adBrief?.locationFocus ? [options.adBrief.locationFocus] : [],
          usps: [],
          trustSignals: [],
          rawTextSample: resolvedServiceFocus,
        },
    lightweight: true,
    skipSocialPresence: true,
  });

  const competitorNames = realCompetitorNames(competitorAnalysis);
  console.log(
    `[suggest-campaign-copy] competitors for "${resolvedServiceFocus}": ${
      competitorNames.join(' · ') || '(none)'
    }`
  );
  await emit(
    55,
    competitorNames.length
      ? `Found ${competitorNames.length} competitors: ${competitorNames.join(' · ')}`
      : 'No live competitors found — drafting from audit only…'
  );

  const findings = (audit.findings ?? [])
    .filter((f) => f.severity === 'CRITICAL' || f.severity === 'HIGH')
    .slice(0, 8)
    .map((f) => `- [${f.severity}] ${f.title}: ${f.recommendation || f.description}`)
    .join('\n');

  const brief = options.adBrief;
  const briefBlock = brief
    ? `
CLIENT AD BRIEF (must follow)
- Service to advertise: ${brief.service || resolvedServiceFocus}
- Campaign type focus: ${campaignTypeLabel(resolvedCampaignType)} (${resolvedCampaignType})
- Ad type / format intent: ${brief.adType || formatLabel}
- Offer / promo: ${brief.offer || 'n/a'}
- Target audience: ${brief.audience || 'n/a'}
- Tone: ${brief.tone || 'professional high-conversion'}
- Preferred CTA: ${brief.ctaPreference || 'n/a'}
- Must include phrases/proof: ${brief.mustInclude || 'n/a'}
- Preferred final URL: ${brief.finalUrl || options.websiteUrl || business.websiteUrl || audit.websiteUrl || 'n/a'}
- Location focus: ${brief.locationFocus || 'n/a'}
`
    : '';

  const namedRivalList =
    competitorNames.length > 0
      ? competitorNames.map((n, i) => `${i + 1}. ${n}`).join('\n')
      : '(none found)';

  await emit(60, `Claude is drafting ${formatLabel} copy for ${campaignTypeLabel(resolvedCampaignType)}…`);

  const prompt = `You are a senior Google Ads strategist specializing in ${campaignTypeLabel(resolvedCampaignType)}.

Create a NEW ${formatLabel} package for this advertiser using BOTH:
1) Account audit findings
2) Competitor ad intelligence matched to the SAME campaign type (${resolvedCampaignType}) when possible
${brief ? '3) The client ad brief below (highest priority for service, offer, audience, CTA, campaign type)' : ''}

IMPORTANT CAMPAIGN-TYPE RULES
- Focus channel: ${campaignTypeLabel(resolvedCampaignType)}
- Prefer competitor angles from ${resolvedCampaignType} creatives (Search text RSAs if search; visual/offer angles if display/pmax/video).
- Still return JSON with headlines (up to 15, ≤30 chars) and descriptions (up to 4, ≤90 chars) so AdAudit Pro can preview and store assets.
- For Call Ads: emphasize phone/call CTAs in headlines and descriptions.
- For Performance Max / Demand Gen / Display / Video: write text assets that fit that channel (still headline/description fields).
- Stay locked to the service “${resolvedServiceFocus}”.

BUSINESS
- Name: ${business.name || audit.accountName}
- Website: ${options.websiteUrl || business.websiteUrl || audit.websiteUrl || 'n/a'}
- Services: ${(website?.services ?? []).slice(0, 6).join(', ') || resolvedServiceFocus}
- Goal: ${audit.goal || 'leads'}
- Location hints: ${(website?.locations ?? []).slice(0, 4).join(', ') || options.adBrief?.locationFocus || 'n/a'}
- Focus service for this ad: ${resolvedServiceFocus}
${briefBlock}

AUDIT FINDINGS (use as opportunity/pain hooks — do not invent policy violations)
${findings || '- Improve RSA relevance, CTR, and conversion messaging.'}

REAL COMPETITOR BRANDS (use these EXACT names in focusedCompetitor — NEVER "Competitor A/B/C")
${namedRivalList}

${competitorBrief(competitorAnalysis)}

OUTPUT RULES
- Return ONLY valid JSON (no markdown)
- Primary RSA = best overall for OUR service + campaign type, using audit gaps + patterns from the EXACT competitor creatives above
- variations = exactly 3 alternate RSAs, each responding to themes from a different REAL competitor creative when available
- Study the EXACT Headlines/Descriptions blocks — match their competitive angles (proof, CTA, offer style), but write original copy for “${resolvedServiceFocus}”
- focusedCompetitor MUST be the exact brand name from REAL COMPETITOR BRANDS — never placeholders like "Competitor A"
- label MUST be "Inspired by {exact brand name}"
- 15 headlines (≤30 chars, complete words), 4 descriptions (≤90 chars, complete sentences)
- keywords: 8-15 commercial intent phrases for the focus service
- Never use rival brand names, "beats X", "0% interest", or truncated sentences inside headlines/descriptions
- displayPaths: short URL paths ≤15 chars, letters/numbers/hyphens only
- Stay locked to service “${resolvedServiceFocus}” and campaign type ${campaignTypeLabel(resolvedCampaignType)}

JSON SCHEMA:
{
  "campaignName": "string",
  "adGroupName": "string",
  "dailyBudget": number,
  "keywords": ["..."],
  "finalUrl": "https://...",
  "path1": "string",
  "path2": "string",
  "primary": {
    "label": "Primary — audit + competitors",
    "headlines": ["15 headlines"],
    "descriptions": ["4 descriptions"]
  },
  "variations": [
    {
      "label": "Inspired by Exact Brand Name",
      "focusedCompetitor": "Exact Brand Name",
      "headlines": ["15 headlines"],
      "descriptions": ["4 descriptions"],
      "path1": "optional",
      "path2": "optional"
    }
  ]
}`;

  const response = await createClaudeMessage(
    {
      max_tokens: Math.min(ANTHROPIC_OPTIMIZE_MAX_TOKENS, 8000),
      temperature: 0.7,
      messages: [{ role: 'user', content: prompt }],
    },
    undefined,
    ANTHROPIC_OPTIMIZE_MODEL_FALLBACKS
  );

  const text = claudeTextFromMessage(response);

  const parsed = extractJsonFromClaudeText(text) as Record<string, unknown>;
  const primaryRaw = (parsed.primary ?? parsed) as Record<string, unknown>;
  const primaryHeadlines = normalizeList(primaryRaw.headlines ?? parsed.headlines, 15, 30);
  const primaryDescriptions = normalizeList(primaryRaw.descriptions ?? parsed.descriptions, 4, 90);

  if (primaryHeadlines.length < 3 || primaryDescriptions.length < 2) {
    throw new Error('AI returned incomplete ad copy. Try Generate again.');
  }

  const primary: CampaignCopySuggestion = {
    id: 'primary',
    label: String(primaryRaw.label ?? 'Primary — audit + competitors'),
    headlines: primaryHeadlines,
    descriptions: primaryDescriptions,
    displayPaths: {
      path1: clip(String(parsed.path1 ?? primaryRaw.path1 ?? ''), 15) || undefined,
      path2: clip(String(parsed.path2 ?? primaryRaw.path2 ?? ''), 15) || undefined,
    },
  };

  const variationsRaw = Array.isArray(parsed.variations) ? parsed.variations : [];
  const variationsParsed: CampaignCopySuggestion[] = [];
  for (const [i, v] of variationsRaw.entries()) {
    const row = (v ?? {}) as Record<string, unknown>;
    const headlines = normalizeList(row.headlines, 15, 30);
    const descriptions = normalizeList(row.descriptions, 4, 90);
    if (headlines.length < 3 || descriptions.length < 2) continue;
    const focused = String(row.focusedCompetitor ?? competitorNames[i] ?? '').trim();
    variationsParsed.push({
      id: `variation-${i}`,
      label: String(row.label ?? (focused ? `Inspired by ${focused}` : `Variation ${i + 2}`)),
      focusedCompetitor: focused || undefined,
      headlines,
      descriptions,
      displayPaths: {
        path1: clip(String(row.path1 ?? ''), 15) || undefined,
        path2: clip(String(row.path2 ?? ''), 15) || undefined,
      },
    });
    if (variationsParsed.length >= 3) break;
  }

  // Always stamp real discovered brand names — Claude often invents "Competitor A/B/C"
  const variations = applyRealCompetitorLabels(variationsParsed, competitorNames);

  const websiteUrl =
    options.websiteUrl ||
    business.websiteUrl ||
    audit.websiteUrl ||
    String(parsed.finalUrl ?? '');

  await emit(100, 'Campaign copy suggestions ready');

  const competitorAds = (competitorAnalysis.adGallery ?? [])
    .filter(
      (g) =>
        g.adSource !== 'website_fallback' &&
        ((g.headlines?.length ?? 0) > 0 ||
          (g.descriptions?.length ?? 0) > 0 ||
          Boolean(g.previewImageUrl))
    )
    .slice(0, 6);

  return {
    campaignName: String(parsed.campaignName ?? '').trim() || undefined,
    adGroupName: String(parsed.adGroupName ?? '').trim() || undefined,
    dailyBudget:
      typeof parsed.dailyBudget === 'number' && parsed.dailyBudget > 0
        ? Math.round(parsed.dailyBudget)
        : undefined,
    keywords: normalizeList(parsed.keywords, 20, 80),
    finalUrl: websiteUrl || undefined,
    path1: primary.displayPaths?.path1,
    path2: primary.displayPaths?.path2,
    primary,
    variations,
    competitorNames,
    competitorAds,
    competitorSource: competitorAnalysis.source,
    serviceFocus: resolvedServiceFocus,
    stageNotes: [
      `Audit findings used: ${(audit.findings ?? []).length}`,
      `Competitors used: ${competitorNames.length}`,
      `SociaVault ads shown: ${competitorAds.length}`,
      `Ad copies: ${1 + variations.length}`,
    ],
  };
}
