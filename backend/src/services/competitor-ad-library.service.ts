import { createClaudeMessage } from '../ai/anthropic-client.js';
import { extractJsonFromClaudeText } from '../utils/claude-json.js';
import {
  COMPETITOR_CAMPAIGN_TYPES,
  campaignTypeLabel,
  classifyCompetitorCreative,
  mapGoogleAdsChannelType,
  summarizeCreativeFormats,
  type CompetitorCampaignTypeKey,
} from '../utils/competitor-campaign-type.js';
import { getAuditReport } from './audit.service.js';
import { getMe } from './user.service.js';
import { fetchCampaignsForAccount } from './google-ads.service.js';
import {
  analyzeCompetitors,
  type CompetitorAdPreview,
  type CompetitorIntelligence,
  type CompetitorProfile,
} from './competitor-intelligence.service.js';
import {
  fetchSociaVaultAdvertiserLibrary,
  isSociaVaultConfigured,
} from './sociavault-google-ad-library.service.js';
import { withTimeoutFallback } from '../utils/withTimeout.js';
import { analyzeWebsite } from './website-intelligence.service.js';

export type { CompetitorCampaignTypeKey };

export interface CompetitorLibraryAd {
  competitorName: string;
  competitorUrl: string;
  confidenceScore: number;
  adDurationDays: number;
  activeAdCount: number;
  totalAdCount: number;
  brandRating?: number;
  trustScore?: number;
  headlines: string[];
  descriptions: string[];
  offer?: string;
  cta?: string;
  firstSeen?: string;
  lastSeen?: string;
  displayUrl: string;
  previewImageUrl?: string;
  creativeUrl?: string;
  transparencyUrl?: string;
  format?: string;
  campaignType: CompetitorCampaignTypeKey;
  source: 'Google Ads Transparency Center';
  estimatedSuccessScore?: number;
}

export interface CampaignTypeInsights {
  topCompetitors: string[];
  mostActiveCompetitors: string[];
  longestRunningCompetitors: string[];
  mostTrustedCompetitors: string[];
  mostConsistentAdvertisers: string[];
}

export interface CampaignOpportunity {
  campaignType: CompetitorCampaignTypeKey;
  label: string;
  competitorAdoption: number;
  yourUsage: number;
  opportunity: 'High' | 'Medium' | 'Low' | 'None';
  reason: string;
}

export interface CampaignRecommendation {
  campaignType: CompetitorCampaignTypeKey;
  label: string;
  priority: 'High' | 'Medium' | 'Low';
  competitorAdoption: number;
  reason: string;
  expectedBenefits: string[];
  suggestedActions: string[];
}

export interface CompetitorAdLibraryAiInsights {
  whatCompetitorsDoDifferently: string;
  campaignTypePriorities: string;
  messaging: string;
  offers: string;
  trustSignals: string;
  campaignOpportunities: string;
}

export interface CompetitorAdLibraryReport {
  overview: {
    competitorsAnalyzed: number;
    totalCompetitorAds: number;
    activeCompetitorAds: number;
    averageAdDuration: number;
    averageConfidenceScore: number;
  };
  source: CompetitorIntelligence['source'];
  ads: CompetitorLibraryAd[];
  byCampaignType: Record<
    CompetitorCampaignTypeKey,
    {
      label: string;
      tabLabel: string;
      adCount: number;
      ads: CompetitorLibraryAd[];
      insights: CampaignTypeInsights;
    }
  >;
  opportunities: CampaignOpportunity[];
  recommendations: CampaignRecommendation[];
  aiInsights: CompetitorAdLibraryAiInsights | null;
  accountCampaignTypes: CompetitorCampaignTypeKey[];
  disclaimer: string;
}

const cache = new Map<string, { expires: number; report: CompetitorAdLibraryReport }>();
const CACHE_MS = 15 * 60 * 1000;

const SUGGESTED_ACTIONS: Record<CompetitorCampaignTypeKey, string[]> = {
  search: [
    'Add negative keywords',
    'Improve RSA headlines',
    'Add callout extensions',
    'Add structured snippets',
  ],
  display: [
    'Build responsive display creatives',
    'Create remarketing audiences',
    'Tighten placement exclusions',
    'Align landing pages to display offers',
  ],
  shopping: [
    'Improve product feed quality',
    'Add high-intent product titles',
    'Optimize product images',
    'Review Shopping bid strategy',
  ],
  video: [
    'Produce short YouTube creatives',
    'Build remarketing audiences from video views',
    'Test awareness vs conversion video formats',
    'Align offers with video CTAs',
  ],
  performance_max: [
    'Add image assets',
    'Add audience signals',
    'Add product feeds',
    'Improve conversion tracking',
  ],
  demand_gen: [
    'Build creative assets',
    'Create remarketing audiences',
    'Create offer-based creatives',
    'Test YouTube + Discover placements',
  ],
  app: [
    'Confirm app conversion tracking',
    'Prepare store listing assets',
    'Test install vs engagement goals',
    'Align creatives to store screenshots',
  ],
  local_services: [
    'Verify Google Guaranteed eligibility',
    'Improve local review velocity',
    'Align service categories',
    'Respond to lead quality issues',
  ],
};

const EXPECTED_BENEFITS: Record<CompetitorCampaignTypeKey, string[]> = {
  search: ['Higher intent clicks', 'Better keyword coverage', 'Stronger RSA relevance'],
  display: ['Broader reach', 'Remarketing coverage', 'Brand presence off-Search'],
  shopping: ['Product visibility', 'Lower-cost commerce traffic', 'Catalog coverage'],
  video: ['Awareness lift', 'Remarketing audiences', 'Storytelling for offers'],
  performance_max: ['Automated channel mix', 'Asset-driven reach', 'Conversion scale'],
  demand_gen: ['Upper-funnel demand', 'Visual engagement', 'Audience expansion'],
  app: ['Install growth', 'In-app engagement', 'Mobile acquisition'],
  local_services: ['Qualified local leads', 'Trust via Google Guaranteed', 'Service-area coverage'],
};

function emptyInsights(): CampaignTypeInsights {
  return {
    topCompetitors: [],
    mostActiveCompetitors: [],
    longestRunningCompetitors: [],
    mostTrustedCompetitors: [],
    mostConsistentAdvertisers: [],
  };
}

function emptyByType(): CompetitorAdLibraryReport['byCampaignType'] {
  const out = {} as CompetitorAdLibraryReport['byCampaignType'];
  for (const t of COMPETITOR_CAMPAIGN_TYPES) {
    out[t.key] = {
      label: t.label,
      tabLabel: t.tabLabel,
      adCount: 0,
      ads: [],
      insights: emptyInsights(),
    };
  }
  return out;
}

function opportunityLevel(adoption: number, yourUsage: number): CampaignOpportunity['opportunity'] {
  if (adoption < 20) return 'None';
  const gap = adoption - yourUsage;
  if (gap >= 50 && yourUsage === 0) return 'High';
  if (gap >= 35) return 'High';
  if (gap >= 15) return 'Medium';
  if (gap > 0) return 'Low';
  return 'None';
}

function opportunityReason(
  key: CompetitorCampaignTypeKey,
  adoption: number,
  yourUsage: number
): string {
  const label = campaignTypeLabel(key);
  if (adoption >= 60 && yourUsage === 0) {
    return `Most leading competitors are actively investing in ${label}.`;
  }
  if (adoption >= 40 && yourUsage === 0) {
    return `Competitors are using ${label} to expand reach and conversion coverage.`;
  }
  if (adoption > yourUsage) {
    return `Competitor adoption of ${label} (${adoption}%) exceeds your account usage (${yourUsage}%).`;
  }
  if (yourUsage > 0 && adoption > 0) {
    return `You already run ${label}; competitors also use it — focus on creative and targeting improvements.`;
  }
  return `Limited competitor signal for ${label} in Transparency creatives reviewed.`;
}

function buildTypeInsights(
  ads: CompetitorLibraryAd[],
  profiles: CompetitorProfile[]
): CampaignTypeInsights {
  const byName = new Map<string, CompetitorLibraryAd[]>();
  for (const ad of ads) {
    const list = byName.get(ad.competitorName) ?? [];
    list.push(ad);
    byName.set(ad.competitorName, list);
  }

  const names = [...byName.keys()];
  const ranked = names.map((name) => {
    const group = byName.get(name)!;
    const profile = profiles.find((p) => p.name.toLowerCase() === name.toLowerCase());
    const first = group[0]!;
    return {
      name,
      confidence: first.confidenceScore || profile?.confidenceScore || 0,
      active: first.activeAdCount || profile?.activeAdCount || 0,
      duration: first.adDurationDays || profile?.adDurationDays || 0,
      trust: first.trustScore || profile?.brandReview?.trustScore || profile?.brandReview?.score || 0,
      total: first.totalAdCount || profile?.totalAdCount || 0,
    };
  });

  const top = [...ranked].sort((a, b) => b.confidence - a.confidence).map((r) => r.name);
  const active = [...ranked].sort((a, b) => b.active - a.active).map((r) => r.name);
  const longest = [...ranked].sort((a, b) => b.duration - a.duration).map((r) => r.name);
  const trusted = [...ranked].sort((a, b) => b.trust - a.trust).map((r) => r.name);
  const consistent = [...ranked]
    .sort((a, b) => b.duration - a.duration || b.total - a.total)
    .map((r) => r.name);

  return {
    topCompetitors: top.slice(0, 5),
    mostActiveCompetitors: active.slice(0, 5),
    longestRunningCompetitors: longest.slice(0, 5),
    mostTrustedCompetitors: trusted.slice(0, 5),
    mostConsistentAdvertisers: consistent.slice(0, 5),
  };
}

async function enrichFormatFlags(
  competitors: CompetitorProfile[]
): Promise<Map<string, ReturnType<typeof summarizeCreativeFormats>>> {
  const map = new Map<string, ReturnType<typeof summarizeCreativeFormats>>();
  if (!isSociaVaultConfigured()) return map;

  const targets = competitors.slice(0, 5);
  await Promise.all(
    targets.map(async (c) => {
      try {
        const { ads } = await withTimeoutFallback(
          fetchSociaVaultAdvertiserLibrary({ name: c.name, url: c.url }),
          35_000,
          {
            ads: [],
            activity: {
              adDurationDays: 0,
              activeAdCount: 0,
              totalAdCount: 0,
              avgCreativeDurationDays: 0,
            },
          },
          `library-formats:${c.url}`
        );
        map.set(
          c.name.toLowerCase(),
          summarizeCreativeFormats(ads.map((a) => a.format || 'unknown'))
        );
      } catch {
        /* best-effort */
      }
    })
  );
  return map;
}

function toLibraryAd(
  preview: CompetitorAdPreview,
  profile: CompetitorProfile | undefined,
  formatFlags: ReturnType<typeof summarizeCreativeFormats> | undefined
): CompetitorLibraryAd {
  const campaignType = classifyCompetitorCreative({
    format: preview.format,
    headlines: preview.headlines,
    descriptions: preview.descriptions,
    previewImageUrl: preview.previewImageUrl,
    destinationUrl: preview.url,
    hasTextCreatives: formatFlags?.hasTextCreatives,
    hasImageCreatives: formatFlags?.hasImageCreatives,
    hasVideoCreatives: formatFlags?.hasVideoCreatives,
  });

  return {
    competitorName: preview.advertiserName || preview.name,
    competitorUrl: profile?.url || preview.url,
    confidenceScore: preview.confidenceScore ?? profile?.confidenceScore ?? 0,
    adDurationDays: preview.adDurationDays ?? profile?.adDurationDays ?? 0,
    activeAdCount: preview.activeAdCount ?? profile?.activeAdCount ?? 0,
    totalAdCount: preview.totalAdCount ?? profile?.totalAdCount ?? 0,
    brandRating: preview.brandReview?.averageRating ?? profile?.brandReview?.averageRating,
    trustScore:
      preview.brandReview?.trustScore ??
      profile?.brandReview?.trustScore ??
      preview.brandReview?.score ??
      profile?.brandReview?.score,
    headlines: preview.headlines ?? [],
    descriptions: preview.descriptions ?? [],
    offer: preview.offer ?? preview.offers?.[0] ?? profile?.offers?.[0],
    cta: preview.cta ?? preview.ctas?.[0] ?? profile?.ctas?.[0],
    firstSeen: preview.firstShown ?? preview.creativeFirstShown ?? profile?.firstShown,
    lastSeen: preview.lastShown ?? preview.creativeLastShown ?? profile?.lastShown,
    displayUrl: preview.displayUrl,
    previewImageUrl: preview.previewImageUrl,
    creativeUrl: preview.creativeUrl ?? preview.adLink,
    transparencyUrl: preview.transparencyUrl,
    format: preview.format,
    campaignType,
    source: 'Google Ads Transparency Center',
    estimatedSuccessScore: preview.estimatedSuccessScore,
  };
}

function competitorAdoptionByType(
  ads: CompetitorLibraryAd[],
  competitorCount: number,
  formatFlagsByCompetitor: Map<string, ReturnType<typeof summarizeCreativeFormats>>
): Record<CompetitorCampaignTypeKey, number> {
  const result = {} as Record<CompetitorCampaignTypeKey, number>;
  const denom = Math.max(1, competitorCount);

  for (const t of COMPETITOR_CAMPAIGN_TYPES) {
    const withType = new Set(
      ads.filter((a) => a.campaignType === t.key).map((a) => a.competitorName.toLowerCase())
    );

    // Multi-format inventory → PMax / Demand Gen signal even if single preview classified elsewhere
    if (t.key === 'performance_max' || t.key === 'demand_gen') {
      for (const [name, flags] of formatFlagsByCompetitor) {
        if (flags.hasTextCreatives && flags.hasImageCreatives) {
          withType.add(name);
        }
      }
    }
    if (t.key === 'video') {
      for (const [name, flags] of formatFlagsByCompetitor) {
        if (flags.hasVideoCreatives) withType.add(name);
      }
    }
    if (t.key === 'display') {
      for (const [name, flags] of formatFlagsByCompetitor) {
        if (flags.hasImageCreatives) withType.add(name);
      }
    }
    if (t.key === 'search') {
      for (const [name, flags] of formatFlagsByCompetitor) {
        if (flags.hasTextCreatives) withType.add(name);
      }
    }

    result[t.key] = Math.round((withType.size / denom) * 100);
  }
  return result;
}

function yourUsageByType(
  accountTypes: CompetitorCampaignTypeKey[]
): Record<CompetitorCampaignTypeKey, number> {
  const set = new Set(accountTypes);
  const result = {} as Record<CompetitorCampaignTypeKey, number>;
  for (const t of COMPETITOR_CAMPAIGN_TYPES) {
    result[t.key] = set.has(t.key) ? 100 : 0;
  }
  return result;
}

function buildRecommendations(
  opportunities: CampaignOpportunity[],
  findings: Array<{ title: string; category?: string; severity?: string }>
): CampaignRecommendation[] {
  const findingText = findings
    .slice(0, 40)
    .map((f) => `${f.category ?? ''} ${f.title}`.toLowerCase())
    .join(' ');

  return opportunities
    .filter((o) => o.opportunity !== 'None')
    .map((o) => {
      let priority: CampaignRecommendation['priority'] =
        o.opportunity === 'High' ? 'High' : o.opportunity === 'Medium' ? 'Medium' : 'Low';

      // Raise priority when audit findings align with the campaign type
      if (
        (o.campaignType === 'search' && /keyword|search term|rsa|ad copy|quality score/.test(findingText)) ||
        (o.campaignType === 'performance_max' && /pmax|performance max|asset/.test(findingText)) ||
        (o.campaignType === 'video' && /video|youtube|awareness/.test(findingText)) ||
        (o.campaignType === 'shopping' && /shopping|feed|merchant/.test(findingText))
      ) {
        priority = priority === 'Low' ? 'Medium' : 'High';
      }

      return {
        campaignType: o.campaignType,
        label: o.label,
        priority,
        competitorAdoption: o.competitorAdoption,
        reason: o.reason,
        expectedBenefits: EXPECTED_BENEFITS[o.campaignType],
        suggestedActions: SUGGESTED_ACTIONS[o.campaignType],
      };
    })
    .sort((a, b) => {
      const rank = { High: 0, Medium: 1, Low: 2 };
      return rank[a.priority] - rank[b.priority] || b.competitorAdoption - a.competitorAdoption;
    });
}

async function buildAiInsights(input: {
  accountName: string;
  ads: CompetitorLibraryAd[];
  opportunities: CampaignOpportunity[];
  findings: Array<{ title: string; severity?: string }>;
  marketPatterns?: CompetitorIntelligence['marketPatterns'];
}): Promise<CompetitorAdLibraryAiInsights | null> {
  try {
    const payload = {
      account: input.accountName,
      competitors: [...new Set(input.ads.map((a) => a.competitorName))].slice(0, 6),
      sampleAds: input.ads.slice(0, 8).map((a) => ({
        name: a.competitorName,
        campaignType: a.campaignType,
        headlines: a.headlines.slice(0, 3),
        descriptions: a.descriptions.slice(0, 2),
        offer: a.offer,
        cta: a.cta,
        confidence: a.confidenceScore,
      })),
      opportunities: input.opportunities.filter((o) => o.opportunity !== 'None').slice(0, 6),
      findings: input.findings.slice(0, 8).map((f) => f.title),
      marketPatterns: input.marketPatterns,
    };

    const msg = await createClaudeMessage({
      max_tokens: 900,
      messages: [
        {
          role: 'user',
          content: `You are a Google Ads competitive intelligence analyst. Summarize competitor advertising for an audit report.
Do NOT create or publish campaigns. Recommendations-only framing.
Return ONLY valid JSON:
{
  "whatCompetitorsDoDifferently": "2-3 sentences",
  "campaignTypePriorities": "2 sentences on campaign-type mix",
  "messaging": "2 sentences on messaging themes",
  "offers": "1-2 sentences on offers",
  "trustSignals": "1-2 sentences on trust/proof",
  "campaignOpportunities": "2 sentences on missing opportunities for this account"
}

DATA:
${JSON.stringify(payload)}`,
        },
      ],
    });

    const text = msg.content
      .map((b) => (b.type === 'text' ? b.text : ''))
      .filter(Boolean)
      .join('\n');
    const parsed = extractJsonFromClaudeText(text) as Partial<CompetitorAdLibraryAiInsights> | null;
    if (!parsed) return null;
    return {
      whatCompetitorsDoDifferently: String(parsed.whatCompetitorsDoDifferently ?? ''),
      campaignTypePriorities: String(parsed.campaignTypePriorities ?? ''),
      messaging: String(parsed.messaging ?? ''),
      offers: String(parsed.offers ?? ''),
      trustSignals: String(parsed.trustSignals ?? ''),
      campaignOpportunities: String(parsed.campaignOpportunities ?? ''),
    };
  } catch (err) {
    console.warn(
      '[CompetitorAdLibrary] Claude insights failed:',
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

export async function buildCompetitorAdLibraryForAudit(
  auditId: string
): Promise<CompetitorAdLibraryReport> {
  const cached = cache.get(auditId);
  if (cached && cached.expires > Date.now()) return cached.report;

  const audit = await getAuditReport(auditId);
  if (!audit) throw new Error('Audit not found');

  const websiteUrl = audit.websiteUrl;
  const websiteIntel = websiteUrl
    ? await withTimeoutFallback(analyzeWebsite(websiteUrl), 8_000, null, 'website-for-library')
    : null;

  const intel = await analyzeCompetitors({
    businessName: audit.accountName,
    websiteUrl,
    monthlySpend: audit.monthlySpend,
    productsServices: websiteIntel?.services ?? [],
    websiteIntel,
    lightweight: false,
  });

  // Real SociaVault-backed ads only
  const realGallery = (intel.adGallery ?? []).filter(
    (g) =>
      (g.totalAdCount ?? 0) > 0 ||
      g.adSource === 'sociavault' ||
      g.adSource === 'transparency_center'
  );

  const formatFlags = await enrichFormatFlags(intel.competitors);

  const ads: CompetitorLibraryAd[] = realGallery.map((g) => {
    const profile = intel.competitors.find(
      (p) =>
        p.name.toLowerCase() === g.name.toLowerCase() ||
        p.name.toLowerCase() === (g.advertiserName ?? '').toLowerCase()
    );
    const flags = formatFlags.get((g.advertiserName || g.name).toLowerCase());
    return toLibraryAd(g, profile, flags);
  });

  // Account campaign mix (your usage)
  const accountCampaignTypes: CompetitorCampaignTypeKey[] = [];
  if (audit.googleAdsCustomerId) {
    try {
      const user = await getMe(audit.userId);
      if (user?.googleRefreshToken) {
        const campaigns = await fetchCampaignsForAccount(
          user.googleRefreshToken,
          audit.googleAdsCustomerId,
          audit.userId,
          { dateWindowDays: audit.dataWindowDays || 30 }
        );
        for (const c of campaigns) {
          const mapped = mapGoogleAdsChannelType(c.type);
          if (mapped && !accountCampaignTypes.includes(mapped)) accountCampaignTypes.push(mapped);
        }
      }
    } catch (err) {
      console.warn(
        '[CompetitorAdLibrary] account campaigns unavailable:',
        err instanceof Error ? err.message : err
      );
    }
  }

  const byCampaignType = emptyByType();
  for (const ad of ads) {
    byCampaignType[ad.campaignType].ads.push(ad);
  }
  for (const t of COMPETITOR_CAMPAIGN_TYPES) {
    const bucket = byCampaignType[t.key];
    bucket.adCount = bucket.ads.length;
    bucket.insights = buildTypeInsights(bucket.ads, intel.competitors);
  }

  const adoption = competitorAdoptionByType(ads, Math.max(1, intel.competitors.length), formatFlags);
  const usage = yourUsageByType(accountCampaignTypes);

  const opportunities: CampaignOpportunity[] = COMPETITOR_CAMPAIGN_TYPES.map((t) => {
    const competitorAdoption = adoption[t.key];
    const yourUsage = usage[t.key];
    return {
      campaignType: t.key,
      label: t.label,
      competitorAdoption,
      yourUsage,
      opportunity: opportunityLevel(competitorAdoption, yourUsage),
      reason: opportunityReason(t.key, competitorAdoption, yourUsage),
    };
  }).sort((a, b) => {
    const rank = { High: 0, Medium: 1, Low: 2, None: 3 };
    return rank[a.opportunity] - rank[b.opportunity] || b.competitorAdoption - a.competitorAdoption;
  });

  const recommendations = buildRecommendations(
    opportunities,
    (audit.findings ?? []).map((f) => ({
      title: f.title,
      category: f.category,
      severity: f.severity,
    }))
  );

  const durations = intel.competitors.map((c) => c.adDurationDays ?? 0).filter((d) => d > 0);
  const confidences = intel.competitors.map((c) => c.confidenceScore ?? 0).filter((c) => c > 0);
  const totalAds = intel.competitors.reduce((s, c) => s + (c.totalAdCount ?? 0), 0);
  const activeAds = intel.competitors.reduce((s, c) => s + (c.activeAdCount ?? 0), 0);

  const aiInsights = await buildAiInsights({
    accountName: audit.accountName,
    ads,
    opportunities,
    findings: (audit.findings ?? []).map((f) => ({ title: f.title, severity: f.severity })),
    marketPatterns: intel.marketPatterns,
  });

  const report: CompetitorAdLibraryReport = {
    overview: {
      competitorsAnalyzed: intel.competitors.length,
      totalCompetitorAds: totalAds || ads.length,
      activeCompetitorAds: activeAds,
      averageAdDuration: durations.length
        ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
        : 0,
      averageConfidenceScore: confidences.length
        ? Math.round(confidences.reduce((a, b) => a + b, 0) / confidences.length)
        : 0,
    },
    source: intel.source,
    ads,
    byCampaignType,
    opportunities,
    recommendations,
    aiInsights,
    accountCampaignTypes,
    disclaimer:
      'Campaign types for competitor creatives are inferred from Google Ads Transparency Center / SociaVault creative formats (text, image, video) and messaging signals. This section provides recommendations only — it does not create or publish campaigns.',
  };

  cache.set(auditId, { expires: Date.now() + CACHE_MS, report });
  return report;
}
