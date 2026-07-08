import { createClaudeMessage } from '../ai/anthropic-client.js';
import { extractJsonFromClaudeText } from '../utils/claude-json.js';
import { decodeHtmlEntitiesList } from '../utils/html-entities.js';
import { inferCountryFromLocation } from '../utils/region-codes.js';
import { analyzeWebsite, type WebsiteIntelligence } from './website-intelligence.service.js';
import {
  fetchSociaVaultCompetitorAd,
  isSociaVaultConfigured,
} from './sociavault-google-ad-library.service.js';
import {
  fetchExactTransparencyAdForCompetitor,
  mergeTransparencyAdsToRsa,
} from './google-ads-transparency.service.js';
import { withTimeout, withTimeoutFallback } from '../utils/withTimeout.js';

export interface CompetitorProfile {
  name: string;
  url: string;
  fetched: boolean;
  headlines: string[];
  descriptions: string[];
  offers: string[];
  services: string[];
  ctas: string[];
  trustSignals: string[];
  keywords: string[];
  keyMessages: string[];
  valuePropositions: string[];
  positioning?: string;
  error?: string;
}

export interface CompetitorAdPreview {
  name: string;
  url: string;
  displayUrl: string;
  displayPaths?: { path1?: string; path2?: string };
  headlines: string[];
  descriptions: string[];
  offers: string[];
  ctas: string[];
  trustSignals: string[];
  transparencyUrl?: string;
  creativeUrl?: string;
  advertiserName?: string;
  adSource?: 'sociavault' | 'transparency_center' | 'website_fallback';
  adLink?: string;
  previewImageUrl?: string;
}

export type GapCategory = 'messaging' | 'offers' | 'keywords' | 'trust_signals' | 'ctas';

export interface CompetitorGapRow {
  category: GapCategory;
  competitor: string;
  competitorHas: string;
  youHave: string;
  gap: string;
}

export interface CompetitorGapAnalysis {
  rows: CompetitorGapRow[];
  summary: {
    messagingGaps: number;
    offerGaps: number;
    keywordGaps: number;
    trustSignalGaps: number;
    ctaGaps: number;
  };
}

export interface CompetitorInsightSummary {
  name: string;
  url: string;
  keyMessages: string[];
  offers: string[];
  keywordOpportunities: string[];
}

export interface CompetitorIntelligence {
  competitors: CompetitorProfile[];
  insights: CompetitorInsightSummary[];
  adGallery: CompetitorAdPreview[];
  gapAnalysis: CompetitorGapAnalysis;
  keywordOpportunities: string[];
  messagingOpportunities: string[];
  missingOffers: string[];
  competitiveAdvantages: string[];
  missingFromYourAds: string[];
  source: 'sociavault' | 'transparency_center' | 'claude_and_crawl' | 'claude_only' | 'user_provided' | 'unavailable';
}

function normalizeUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function hostnameToName(url: string): string {
  try {
    const host = new URL(normalizeUrl(url)).hostname.replace(/^www\./, '');
    const base = host.split('.')[0] ?? 'Competitor';
    return base.charAt(0).toUpperCase() + base.slice(1);
  } catch {
    return 'Competitor';
  }
}

function displayHostFromUrl(url: string): string {
  try {
    return new URL(normalizeUrl(url)).hostname.replace(/^www\./, '');
  } catch {
    return 'competitor.com';
  }
}

function rsaHeadlinesFromProfile(c: CompetitorProfile): string[] {
  const pool = [...c.headlines, ...c.keyMessages, c.name]
    .map((h) => h.trim().slice(0, 30))
    .filter(Boolean);
  const unique: string[] = [];
  for (const h of pool) {
    if (!unique.includes(h)) unique.push(h);
    if (unique.length >= 5) break;
  }
  while (unique.length < 3) {
    unique.push(`${c.name} — Shop Now`.slice(0, 30));
    if (unique.length >= 3) break;
  }
  return unique;
}

function rsaDescriptionsFromProfile(c: CompetitorProfile): string[] {
  const pool = [
    c.positioning,
    ...c.descriptions,
    ...c.valuePropositions,
    c.offers[0] ? `${c.name}: ${c.offers[0]}` : '',
  ]
    .filter((d): d is string => Boolean(d?.trim()))
    .map((d) => d.trim().slice(0, 90));
  const unique: string[] = [];
  for (const d of pool) {
    if (!unique.includes(d)) unique.push(d);
    if (unique.length >= 2) break;
  }
  while (unique.length < 2) {
    unique.push(`Visit ${c.name} for quality service. ${c.ctas[0] ?? 'Learn more'}.`.slice(0, 90));
    if (unique.length >= 2) break;
  }
  return unique;
}

const MIN_COMPETITORS = 4;

/** Fetch SociaVault ads for insight competitors missing from the gallery. */
export async function enrichAdGalleryFromInsights(
  insights: Array<{ name: string; url?: string }>,
  country: string | undefined,
  existing: CompetitorAdPreview[]
): Promise<CompetitorAdPreview[]> {
  const out = [...existing];
  const seen = new Set(
    existing.map((g) => (g.creativeUrl ?? g.adLink ?? g.url).toLowerCase())
  );
  const seenNames = new Set(existing.map((g) => g.name.toLowerCase()));

  for (const insight of insights) {
    const rawUrl = insight.url?.trim();
    if (!rawUrl) continue;
    const url = normalizeUrl(rawUrl);
    const dedupeKey = url.toLowerCase();
    if (seen.has(dedupeKey) || seenNames.has(insight.name.toLowerCase())) continue;

    const profile = profileFromWebsite(insight.name, url, null);
    const result = await fetchCompetitorGalleryForTarget(
      { name: insight.name, url },
      country,
      profile
    );
    if (result?.preview) {
      out.push(result.preview);
      seen.add((result.preview.creativeUrl ?? result.preview.adLink ?? url).toLowerCase());
      seenNames.add(insight.name.toLowerCase());
    }
  }

  return out;
}

function buildAdGallery(transparencyByUrl: Map<string, CompetitorAdPreview>): CompetitorAdPreview[] {
  return [...transparencyByUrl.values()].filter(
    (c) => c.adSource === 'sociavault' || c.adSource === 'transparency_center'
  );
}

function buildGapAnalysis(
  competitors: CompetitorProfile[],
  client: {
    headlines: string[];
    descriptions: string[];
    offers: string[];
    ctas: string[];
    trustSignals: string[];
    keywords: string[];
  }
): CompetitorGapAnalysis {
  const rows: CompetitorGapRow[] = [];
  const clientText = [
    ...client.headlines,
    ...client.descriptions,
    ...client.offers,
  ].join(' ').toLowerCase();

  const hasClient = (needle: string) => {
    const n = needle.toLowerCase().slice(0, 12);
    return n.length > 3 && clientText.includes(n);
  };

  for (const c of competitors) {
    for (const msg of c.keyMessages.slice(0, 3)) {
      if (!hasClient(msg)) {
        rows.push({
          category: 'messaging',
          competitor: c.name,
          competitorHas: msg,
          youHave: client.headlines[0] ?? '—',
          gap: 'Competitor leads with messaging your ads do not emphasize',
        });
      }
    }
    for (const offer of c.offers.slice(0, 3)) {
      if (!client.offers.some((o) => o.toLowerCase().includes(offer.toLowerCase().slice(0, 15)))) {
        rows.push({
          category: 'offers',
          competitor: c.name,
          competitorHas: offer,
          youHave: client.offers[0] ?? 'Not promoted in ads',
          gap: 'Offer gap — competitor promotes this prominently',
        });
      }
    }
    for (const kw of c.keywords.slice(0, 4)) {
      if (!client.keywords.includes(kw)) {
        rows.push({
          category: 'keywords',
          competitor: c.name,
          competitorHas: kw,
          youHave: client.keywords.slice(0, 3).join(', ') || '—',
          gap: 'Keyword theme competitors rank on that you underuse',
        });
      }
    }
    for (const ts of c.trustSignals.slice(0, 3)) {
      if (!client.trustSignals.some((t) => t.toLowerCase().includes(ts.toLowerCase().slice(0, 10)))) {
        rows.push({
          category: 'trust_signals',
          competitor: c.name,
          competitorHas: ts,
          youHave: client.trustSignals[0] ?? 'Not in your ad copy',
          gap: 'Trust signal competitors display that your ads lack',
        });
      }
    }
    for (const cta of c.ctas.slice(0, 3)) {
      if (!client.ctas.some((x) => x.toLowerCase().includes(cta.toLowerCase()))) {
        rows.push({
          category: 'ctas',
          competitor: c.name,
          competitorHas: cta,
          youHave: client.ctas[0] ?? 'Generic CTA',
          gap: 'CTA pattern competitors use to drive clicks',
        });
      }
    }
  }

  const limited = rows.slice(0, 25);
  return {
    rows: limited,
    summary: {
      messagingGaps: limited.filter((r) => r.category === 'messaging').length,
      offerGaps: limited.filter((r) => r.category === 'offers').length,
      keywordGaps: limited.filter((r) => r.category === 'keywords').length,
      trustSignalGaps: limited.filter((r) => r.category === 'trust_signals').length,
      ctaGaps: limited.filter((r) => r.category === 'ctas').length,
    },
  };
}

function descriptionsFromSite(site: WebsiteIntelligence): string[] {
  const out: string[] = [];
  if (site.metaDescription?.trim()) out.push(site.metaDescription.trim().slice(0, 90));
  for (const h of site.headings) {
    if (out.length >= 4) break;
    const d = h.trim().slice(0, 90);
    if (d.length > 24 && !out.includes(d)) out.push(d);
  }
  return out;
}
function extractKeywordsFromSite(site: WebsiteIntelligence): string[] {
  const words = [
    ...site.headings,
    ...site.services,
    ...(site.title ? [site.title] : []),
    ...site.usps,
  ]
    .join(' ')
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w.length > 4);
  return [...new Set(words)].slice(0, 24);
}

function profileFromWebsite(name: string, url: string, site: WebsiteIntelligence | null): CompetitorProfile {
  if (!site?.fetched) {
    return {
      name,
      url,
      fetched: false,
      headlines: [],
      descriptions: [],
      offers: [],
      services: [],
      ctas: [],
      trustSignals: [],
      keywords: [],
      keyMessages: [],
      valuePropositions: [],
      error: site?.error ?? 'Could not fetch',
    };
  }

  const keywords = extractKeywordsFromSite(site);
  const valuePropositions = [
    site.metaDescription,
    ...site.usps.slice(0, 4),
    site.title,
  ].filter((v): v is string => Boolean(v?.trim()));

  const keyMessages = [
    ...site.headings.slice(0, 5),
    ...site.ctas.slice(0, 3),
  ].filter(Boolean);

  return {
    name,
    url,
    fetched: true,
    headlines: site.headings.slice(0, 10),
    descriptions: descriptionsFromSite(site),
    offers: site.offers,
    services: site.services,
    ctas: site.ctas,
    trustSignals: site.trustSignals ?? [],
    keywords,
    keyMessages: [...new Set(keyMessages)].slice(0, 8),
    valuePropositions: [...new Set(valuePropositions)].slice(0, 6),
    positioning: site.metaDescription ?? site.title,
  };
}

async function identifyCompetitorUrls(options: {
  businessName: string;
  websiteUrl?: string;
  industry?: string;
  location?: string;
  productsServices?: string[];
  maxCount?: number;
}): Promise<Array<{ name: string; url: string }>> {
  const max = options.maxCount ?? 4;
  const services = (options.productsServices ?? []).filter(Boolean).slice(0, 12).join(', ');
  try {
    const response = await withTimeout(
      createClaudeMessage({
        max_tokens: 768,
        messages: [
          {
            role: 'user',
            content: `Identify up to ${max} direct competitors for Google Ads optimization in the SAME industry and service category.
Return ONLY JSON:
{"competitors":[{"name":"Company Name","url":"https://example.com"}]}

Business: ${options.businessName}
Website: ${options.websiteUrl ?? 'unknown'}
Industry: ${options.industry ?? 'general'}
Location/market: ${options.location ?? 'infer from business context'}
Products/services offered: ${services || 'infer from industry and website'}

Rules:
- Competitors MUST sell the same or very similar services to the same customer type (not generic comparison portals unless the business is also a comparison/marketplace site)
- Prefer competitors in the same geography and service category as the business
- Use real company websites (https URLs only)
- Exclude unrelated brands that merely share a word in the name (e.g. do not return Finder/Canstar for a local plumber)
- For local service businesses, return other local/regional service providers — not national aggregators
- For SaaS/e-commerce, return direct product competitors in the same niche
- Include local/regional leaders when location is known`,
          },
        ],
      }),
      14_000,
      'competitor-identification'
    );
    const block = response.content[0];
    if (block.type !== 'text') return [];
    const parsed = extractJsonFromClaudeText(block.text) as {
      competitors?: Array<{ name?: string; url?: string }>;
    };
    return (parsed.competitors ?? [])
      .filter((c) => c.url)
      .map((c) => ({
        name: (c.name ?? hostnameToName(String(c.url))).trim(),
        url: normalizeUrl(String(c.url)),
      }))
      .slice(0, max);
  } catch {
    return [];
  }
}

function buildInsightSummaries(competitors: CompetitorProfile[]): CompetitorInsightSummary[] {
  return competitors.map((c) => ({
    name: c.name,
    url: c.url,
    keyMessages: c.keyMessages.length
      ? c.keyMessages
      : c.headlines.slice(0, 4),
    offers: c.offers.slice(0, 6),
    keywordOpportunities: c.keywords.slice(0, 8),
  }));
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/\W+/)
      .filter((w) => w.length > 3)
  );
}

function scoreCompetitorRelevance(
  profile: CompetitorProfile,
  options: {
    industry?: string;
    productsServices?: string[];
    clientKeywords: Set<string>;
  }
): number {
  const industryTokens = tokenize(options.industry ?? '');
  const serviceTokens = tokenize((options.productsServices ?? []).join(' '));
  const competitorTokens = tokenize(
    [...profile.services, ...profile.headlines, ...profile.keyMessages, profile.positioning ?? ''].join(' ')
  );

  let overlap = 0;
  for (const t of industryTokens) if (competitorTokens.has(t)) overlap += 2;
  for (const t of serviceTokens) if (competitorTokens.has(t)) overlap += 3;
  for (const t of profile.keywords) if (options.clientKeywords.has(t)) overlap += 1;

  const aggregatorHints = ['compare', 'finder', 'marketplace', 'review site', 'aggregator'];
  const isAggregator = aggregatorHints.some((h) => profile.name.toLowerCase().includes(h.split(' ')[0] ?? h));
  const clientIsAggregator = [...industryTokens, ...serviceTokens].some((t) =>
    ['compare', 'comparison', 'marketplace', 'aggregator'].includes(t)
  );
  if (isAggregator && !clientIsAggregator) overlap -= 8;

  return overlap;
}

function applyTransparencyToProfile(
  profile: CompetitorProfile,
  headlines: string[],
  descriptions: string[],
  ctas: string[]
): CompetitorProfile {
  if (!headlines.length && !descriptions.length) return profile;
  return {
    ...profile,
    fetched: true,
    headlines: headlines.length ? headlines : profile.headlines,
    descriptions: descriptions.length ? descriptions : profile.descriptions,
    ctas: ctas.length ? ctas : profile.ctas,
    keyMessages: [...new Set([...headlines, ...profile.keyMessages])].slice(0, 8),
    valuePropositions: [...new Set([...descriptions, ...profile.valuePropositions])].slice(0, 6),
  };
}

async function fetchCompetitorGalleryForTarget(
  target: { name: string; url: string },
  country: string | undefined,
  websiteProfile: CompetitorProfile
): Promise<{ preview: CompetitorAdPreview; profile: CompetitorProfile } | null> {
  // Primary: SociaVault Google Ad Library (Transparency Center ad-details)
  if (isSociaVaultConfigured()) {
    try {
      const sv = await withTimeout(
        fetchSociaVaultCompetitorAd({
          name: target.name,
          url: target.url,
          country,
        }),
        60_000,
        `sociavault:${target.url}`
      );
      if (sv && (sv.headline || sv.description || sv.previewImageUrl)) {
        const preview: CompetitorAdPreview = {
          name: sv.advertiserName || target.name,
          url: sv.destinationUrl?.startsWith('http') ? sv.destinationUrl : target.url,
          displayUrl: sv.visibleUrl || displayHostFromUrl(target.url),
          headlines: sv.headline ? [sv.headline] : [],
          descriptions: sv.description ? [sv.description] : [],
          offers: websiteProfile.offers.slice(0, 4),
          ctas: websiteProfile.ctas.slice(0, 4),
          trustSignals: websiteProfile.trustSignals.slice(0, 4),
          transparencyUrl: sv.advertiserUrl,
          creativeUrl: sv.adUrl,
          adLink: sv.adUrl,
          advertiserName: sv.advertiserName,
          adSource: 'sociavault',
          previewImageUrl: sv.previewImageUrl,
        };
        const profile = applyTransparencyToProfile(
          websiteProfile,
          sv.allHeadlines.length ? sv.allHeadlines : sv.headline ? [sv.headline] : [],
          sv.allDescriptions.length ? sv.allDescriptions : sv.description ? [sv.description] : [],
          websiteProfile.ctas
        );
        return { preview, profile };
      }
    } catch (err) {
      console.warn(`[competitors] SociaVault failed for ${target.url}:`, err instanceof Error ? err.message : err);
    }
  }

  // Fallback: direct Transparency Center RPC
  try {
    const result = await withTimeout(
      fetchExactTransparencyAdForCompetitor({
        name: target.name,
        url: target.url,
        country,
      }),
      28_000,
      `transparency:${target.url}`
    );
    if (!result) return null;

    const { advertiser, exactAd, allAds } = result;
    const rsa = mergeTransparencyAdsToRsa(allAds);
    const displayHost = displayHostFromUrl(target.url);
    const headline = exactAd.headlines[0] ?? '';
    const description = exactAd.descriptions[0] ?? '';

    if (!headline && !description && !exactAd.previewImageUrl) return null;

    const preview: CompetitorAdPreview = {
      name: advertiser.name || target.name,
      url: exactAd.finalUrl?.startsWith('http') ? exactAd.finalUrl : target.url,
      displayUrl: exactAd.displayUrl ?? displayHost,
      headlines: headline ? [headline] : [],
      descriptions: description ? [description] : [],
      offers: websiteProfile.offers.slice(0, 4),
      ctas: websiteProfile.ctas.slice(0, 4),
      trustSignals: websiteProfile.trustSignals.slice(0, 4),
      transparencyUrl: advertiser.transparencyUrl,
      creativeUrl: exactAd.creativeUrl,
      adLink: exactAd.creativeUrl,
      advertiserName: advertiser.name,
      adSource: 'transparency_center',
      previewImageUrl: exactAd.previewImageUrl,
    };

    const profile = applyTransparencyToProfile(websiteProfile, rsa.headlines, rsa.descriptions, rsa.ctas);
    return { preview, profile };
  } catch {
    return null;
  }
}

async function resolveCompetitorTargets(options: {
  businessName: string;
  websiteUrl?: string;
  industry?: string;
  location?: string;
  productsServices?: string[];
  competitorUrls?: string[];
}): Promise<Array<{ name: string; url: string }>> {
  const userTargets = (options.competitorUrls ?? [])
    .map((url) => url.trim())
    .filter(Boolean)
    .map((url) => ({ name: hostnameToName(url), url: normalizeUrl(url) }));

  const seen = new Set(userTargets.map((t) => t.url.toLowerCase()));
  const targets = [...userTargets];

  let attempts = 0;
  while (targets.length < MIN_COMPETITORS && attempts < 3) {
    const needed = MIN_COMPETITORS - targets.length + 2;
    const autoTargets = await identifyCompetitorUrls({
      businessName: options.businessName,
      websiteUrl: options.websiteUrl,
      industry: options.industry,
      location: options.location,
      productsServices: options.productsServices,
      maxCount: needed,
    });
    for (const t of autoTargets) {
      const key = t.url.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      targets.push(t);
      if (targets.length >= MIN_COMPETITORS + 2) break;
    }
    attempts += 1;
    if (!autoTargets.length) break;
  }

  return targets.slice(0, Math.max(MIN_COMPETITORS, targets.length));
}

function deriveMissingFromYourAds(
  competitors: CompetitorProfile[],
  clientOffers: Set<string>,
  clientHeadlines: Set<string>
): string[] {
  const gaps: string[] = [];
  for (const c of competitors) {
    for (const offer of c.offers) {
      const lower = offer.toLowerCase();
      if (!clientOffers.has(lower) && !gaps.some((g) => g.toLowerCase().includes(lower.slice(0, 20)))) {
        gaps.push(`${c.name}: "${offer}" — not highlighted in your current ads`);
      }
    }
    for (const msg of c.keyMessages.slice(0, 2)) {
      const lower = msg.toLowerCase();
      const covered = [...clientHeadlines].some((h) => h.includes(lower.slice(0, 12)) || lower.includes(h.slice(0, 12)));
      if (!covered && gaps.length < 10) {
        gaps.push(`${c.name} leads with "${msg}" — missing from your messaging`);
      }
    }
  }
  return gaps.slice(0, 8);
}

export async function analyzeCompetitors(options: {
  businessName: string;
  websiteUrl?: string;
  industry?: string;
  location?: string;
  productsServices?: string[];
  competitorUrls?: string[];
  websiteIntel?: WebsiteIntelligence | null;
  currentAd?: { headlines?: string[]; descriptions?: string[] };
  lightweight?: boolean;
}): Promise<CompetitorIntelligence> {
  const emptyGap: CompetitorGapAnalysis = {
    rows: [],
    summary: { messagingGaps: 0, offerGaps: 0, keywordGaps: 0, trustSignalGaps: 0, ctaGaps: 0 },
  };
  const empty: CompetitorIntelligence = {
    competitors: [],
    insights: [],
    adGallery: [],
    gapAnalysis: emptyGap,
    keywordOpportunities: [],
    messagingOpportunities: [],
    missingOffers: [],
    competitiveAdvantages: [],
    missingFromYourAds: [],
    source: 'unavailable',
  };

  const targets = await resolveCompetitorTargets({
    businessName: options.businessName,
    websiteUrl: options.websiteUrl,
    industry: options.industry,
    location: options.location,
    productsServices: options.productsServices,
    competitorUrls: options.competitorUrls,
  });

  if (!targets.length) return empty;

  const country = inferCountryFromLocation(options.location);
  const crawlTimeout = options.lightweight ? 5_000 : 8_000;
  const competitors: CompetitorProfile[] = await Promise.all(
    targets.map(async (t) => {
      const site = await withTimeoutFallback(
        analyzeWebsite(t.url),
        crawlTimeout,
        null,
        `competitor-crawl:${t.url}`
      );
      return profileFromWebsite(t.name, t.url, site);
    })
  );

  const clientSite: WebsiteIntelligence = options.websiteIntel ?? {
    url: options.websiteUrl ?? '',
    fetched: false,
    headings: [],
    offers: [],
    services: options.productsServices ?? [],
    ctas: [],
    locations: options.location ? [options.location] : [],
    usps: [],
    trustSignals: [],
    rawTextSample: '',
  };
  const clientKeywords = new Set(extractKeywordsFromSite(clientSite));

  const relevanceScored = competitors
    .map((c, i) => ({
      profile: c,
      target: targets[i]!,
      relevance: scoreCompetitorRelevance(c, {
        industry: options.industry,
        productsServices: options.productsServices,
        clientKeywords,
      }),
    }))
    .sort((a, b) => b.relevance - a.relevance);

  let selected = relevanceScored.filter((x) => x.relevance >= -4).slice(0, Math.max(MIN_COMPETITORS, targets.length));
  if (selected.length < MIN_COMPETITORS) {
    selected = relevanceScored.slice(0, MIN_COMPETITORS);
  }
  selected = selected.slice(0, Math.max(MIN_COMPETITORS, selected.length));

  let filteredTargets = selected.map((x) => x.target);
  let filteredCompetitors = selected.map((x) => x.profile);

  const transparencyByUrl = new Map<string, CompetitorAdPreview>();
  let transparencyHits = 0;

  for (let i = 0; i < filteredTargets.length; i++) {
    const target = filteredTargets[i]!;
    const websiteProfile = filteredCompetitors[i]!;
    const result = await fetchCompetitorGalleryForTarget(target, country, websiteProfile);
    if (result) {
      transparencyByUrl.set(target.url.toLowerCase(), result.preview);
      filteredCompetitors[i] = result.profile;
      transparencyHits += 1;
    }
  }

  // Backfill if fewer than MIN_COMPETITORS transparency ads — try remaining targets
  if (transparencyByUrl.size < MIN_COMPETITORS) {
    const used = new Set(filteredTargets.map((t) => t.url.toLowerCase()));
    const extras = relevanceScored
      .map((x) => x.target)
      .filter((t) => !used.has(t.url.toLowerCase()));

    for (const target of extras) {
      if (transparencyByUrl.size >= MIN_COMPETITORS) break;
      const site = await withTimeoutFallback(
        analyzeWebsite(target.url),
        crawlTimeout,
        null,
        `competitor-crawl:${target.url}`
      );
      const profile = profileFromWebsite(target.name, target.url, site);
      const result = await fetchCompetitorGalleryForTarget(target, country, profile);
      if (result) {
        transparencyByUrl.set(target.url.toLowerCase(), result.preview);
        filteredTargets.push(target);
        filteredCompetitors.push(result.profile);
        transparencyHits += 1;
      }
    }
  }

  const clientOffers = new Set((options.websiteIntel?.offers ?? []).map((o) => o.toLowerCase()));
  const clientHeadlines = new Set(
    (options.websiteIntel?.headings ?? []).map((h) => h.toLowerCase())
  );
  const allCompetitorOffers = new Set(filteredCompetitors.flatMap((c) => c.offers.map((o) => o.toLowerCase())));
  const missingOffers = [...allCompetitorOffers].filter((o) => !clientOffers.has(o)).slice(0, 8);

  const competitorKeywords = new Set(filteredCompetitors.flatMap((c) => c.keywords));
  const keywordOpportunities = [...competitorKeywords]
    .filter((k) => !clientKeywords.has(k))
    .slice(0, 15);

  const messagingOpportunities = filteredCompetitors
    .flatMap((c) => [...c.valuePropositions, c.positioning].filter(Boolean) as string[])
    .slice(0, 8);

  const competitiveAdvantages: string[] = [];
  if (options.websiteIntel?.offers?.length) {
    competitiveAdvantages.push(`Your offers: ${options.websiteIntel.offers.slice(0, 3).join('; ')}`);
  }
  if (options.websiteIntel?.usps?.length) {
    competitiveAdvantages.push(`Your USPs: ${options.websiteIntel.usps.slice(0, 3).join('; ')}`);
  }
  for (const c of filteredCompetitors) {
    if (c.offers.length && !c.offers.some((o) => clientOffers.has(o.toLowerCase()))) {
      competitiveAdvantages.push(`${c.name} promotes offers your site does not emphasize in ads`);
    }
  }

  const insights = buildInsightSummaries(filteredCompetitors);
  let adGallery = buildAdGallery(transparencyByUrl);
  adGallery = await enrichAdGalleryFromInsights(insights, country, adGallery);
  for (const insight of insights) {
    const match = adGallery.find(
      (g) =>
        g.name.toLowerCase() === insight.name.toLowerCase() ||
        (insight.url && g.url.toLowerCase().includes(insight.url.replace(/^https?:\/\//, '').split('/')[0] ?? ''))
    );
    if (match?.headlines[0]) {
      insight.keyMessages = [
        match.headlines[0],
        ...(match.descriptions[0] ? [match.descriptions[0]] : []),
        ...insight.keyMessages,
      ].slice(0, 4);
    }
  }
  const missingFromYourAds = deriveMissingFromYourAds(filteredCompetitors, clientOffers, clientHeadlines);
  const gapAnalysis = buildGapAnalysis(filteredCompetitors, {
    headlines: options.currentAd?.headlines ?? options.websiteIntel?.headings ?? [],
    descriptions: options.currentAd?.descriptions ?? descriptionsFromSite(clientSite),
    offers: options.websiteIntel?.offers ?? [],
    ctas: options.websiteIntel?.ctas ?? [],
    trustSignals: options.websiteIntel?.trustSignals ?? [],
    keywords: [...clientKeywords],
  });

  const source =
    transparencyByUrl.size > 0 && [...transparencyByUrl.values()].some((c) => c.adSource === 'sociavault')
      ? 'sociavault'
      : transparencyHits > 0
        ? 'transparency_center'
    : (options.competitorUrls?.length ?? 0) > 0 && filteredCompetitors.some((c) => c.fetched)
      ? 'user_provided'
      : filteredCompetitors.some((c) => c.fetched)
        ? 'claude_and_crawl'
        : filteredTargets.length
          ? 'claude_only'
          : 'unavailable';

  return {
    competitors: filteredCompetitors,
    insights,
    adGallery,
    gapAnalysis,
    keywordOpportunities,
    messagingOpportunities,
    missingOffers,
    competitiveAdvantages: competitiveAdvantages.slice(0, 8),
    missingFromYourAds,
    source,
  };
}
