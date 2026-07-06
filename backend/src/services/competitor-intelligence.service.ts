import { createClaudeMessage } from '../ai/anthropic-client.js';
import { extractJsonFromClaudeText } from '../utils/claude-json.js';
import { analyzeWebsite, type WebsiteIntelligence } from './website-intelligence.service.js';
import { withTimeout, withTimeoutFallback } from '../utils/withTimeout.js';

export interface CompetitorProfile {
  name: string;
  url: string;
  fetched: boolean;
  headlines: string[];
  offers: string[];
  services: string[];
  ctas: string[];
  keywords: string[];
  keyMessages: string[];
  valuePropositions: string[];
  positioning?: string;
  error?: string;
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
  keywordOpportunities: string[];
  messagingOpportunities: string[];
  missingOffers: string[];
  competitiveAdvantages: string[];
  missingFromYourAds: string[];
  source: 'claude_and_crawl' | 'claude_only' | 'user_provided' | 'unavailable';
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
      offers: [],
      services: [],
      ctas: [],
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
    offers: site.offers,
    services: site.services,
    ctas: site.ctas,
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
  try {
    const services = (options.productsServices ?? []).filter(Boolean).slice(0, 12).join(', ');
    const response = await withTimeout(
      createClaudeMessage({
        max_tokens: 768,
        messages: [
          {
            role: 'user',
            content: `Identify up to ${max} realistic direct competitors for Google Ads optimization.
Return ONLY JSON:
{"competitors":[{"name":"Company Name","url":"https://example.com"}]}

Business: ${options.businessName}
Website: ${options.websiteUrl ?? 'unknown'}
Industry: ${options.industry ?? 'general'}
Location/market: ${options.location ?? 'infer from business context'}
Products/services: ${services || 'infer from industry and website'}

Rules:
- Prefer competitors in the same geography and service category
- Use real company websites (https URLs only)
- Avoid marketplaces unless the business is e-commerce
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
  lightweight?: boolean;
}): Promise<CompetitorIntelligence> {
  const empty: CompetitorIntelligence = {
    competitors: [],
    insights: [],
    keywordOpportunities: [],
    messagingOpportunities: [],
    missingOffers: [],
    competitiveAdvantages: [],
    missingFromYourAds: [],
    source: 'unavailable',
  };

  const userTargets = (options.competitorUrls ?? [])
    .map((url) => url.trim())
    .filter(Boolean)
    .map((url) => ({ name: hostnameToName(url), url: normalizeUrl(url) }));

  const autoNeeded = Math.max(0, 4 - userTargets.length);
  const autoTargets = autoNeeded
    ? await identifyCompetitorUrls({
        businessName: options.businessName,
        websiteUrl: options.websiteUrl,
        industry: options.industry,
        location: options.location,
        productsServices: options.productsServices,
        maxCount: autoNeeded,
      })
    : [];

  const seen = new Set<string>();
  const targets = [...userTargets, ...autoTargets].filter((t) => {
    const key = t.url.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 4);

  if (!targets.length) return empty;

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

  const clientOffers = new Set((options.websiteIntel?.offers ?? []).map((o) => o.toLowerCase()));
  const clientHeadlines = new Set(
    (options.websiteIntel?.headings ?? []).map((h) => h.toLowerCase())
  );
  const allCompetitorOffers = new Set(competitors.flatMap((c) => c.offers.map((o) => o.toLowerCase())));
  const missingOffers = [...allCompetitorOffers].filter((o) => !clientOffers.has(o)).slice(0, 8);

  const competitorKeywords = new Set(competitors.flatMap((c) => c.keywords));
  const clientSite: WebsiteIntelligence = options.websiteIntel ?? {
    url: options.websiteUrl ?? '',
    fetched: false,
    headings: [],
    offers: [],
    services: options.productsServices ?? [],
    ctas: [],
    locations: options.location ? [options.location] : [],
    usps: [],
    rawTextSample: '',
  };
  const clientKeywords = new Set(extractKeywordsFromSite(clientSite));
  const keywordOpportunities = [...competitorKeywords]
    .filter((k) => !clientKeywords.has(k))
    .slice(0, 15);

  const messagingOpportunities = competitors
    .flatMap((c) => [...c.valuePropositions, c.positioning].filter(Boolean) as string[])
    .slice(0, 8);

  const competitiveAdvantages: string[] = [];
  if (options.websiteIntel?.offers?.length) {
    competitiveAdvantages.push(`Your offers: ${options.websiteIntel.offers.slice(0, 3).join('; ')}`);
  }
  if (options.websiteIntel?.usps?.length) {
    competitiveAdvantages.push(`Your USPs: ${options.websiteIntel.usps.slice(0, 3).join('; ')}`);
  }
  for (const c of competitors) {
    if (c.offers.length && !c.offers.some((o) => clientOffers.has(o.toLowerCase()))) {
      competitiveAdvantages.push(`${c.name} promotes offers your site does not emphasize in ads`);
    }
  }

  const insights = buildInsightSummaries(competitors);
  const missingFromYourAds = deriveMissingFromYourAds(competitors, clientOffers, clientHeadlines);

  const source = userTargets.length && competitors.some((c) => c.fetched)
    ? 'user_provided'
    : competitors.some((c) => c.fetched)
      ? 'claude_and_crawl'
      : targets.length
        ? 'claude_only'
        : 'unavailable';

  return {
    competitors,
    insights,
    keywordOpportunities,
    messagingOpportunities,
    missingOffers,
    competitiveAdvantages: competitiveAdvantages.slice(0, 8),
    missingFromYourAds,
    source,
  };
}
