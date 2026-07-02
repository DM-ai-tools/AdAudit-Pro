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
  positioning?: string;
  error?: string;
}

export interface CompetitorIntelligence {
  competitors: CompetitorProfile[];
  keywordOpportunities: string[];
  messagingOpportunities: string[];
  missingOffers: string[];
  competitiveAdvantages: string[];
  source: 'claude_and_crawl' | 'claude_only' | 'unavailable';
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
      error: site?.error ?? 'Could not fetch',
    };
  }
  const keywords = [
    ...site.headings,
    ...site.services,
    ...(site.title ? [site.title] : []),
  ]
    .join(' ')
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w.length > 4)
    .slice(0, 20);

  return {
    name,
    url,
    fetched: true,
    headlines: site.headings.slice(0, 8),
    offers: site.offers,
    services: site.services,
    ctas: site.ctas,
    keywords: [...new Set(keywords)],
    positioning: site.metaDescription ?? site.title,
  };
}

async function identifyCompetitorUrls(
  businessName: string,
  websiteUrl?: string,
  industry?: string
): Promise<Array<{ name: string; url: string }>> {
  try {
    const response = await withTimeout(
      createClaudeMessage({
        max_tokens: 512,
        messages: [
          {
            role: 'user',
            content: `Identify up to 2 realistic competitors for this business. Return ONLY JSON:
{"competitors":[{"name":"Company","url":"https://example.com"}]}

Business: ${businessName}
Website: ${websiteUrl ?? 'unknown'}
Industry: ${industry ?? 'general services'}`,
          },
        ],
      }),
      12_000,
      'competitor-identification'
    );
    const block = response.content[0];
    if (block.type !== 'text') return [];
    const parsed = extractJsonFromClaudeText(block.text) as {
      competitors?: Array<{ name?: string; url?: string }>;
    };
    return (parsed.competitors ?? [])
      .filter((c) => c.url)
      .map((c) => ({ name: c.name ?? 'Competitor', url: String(c.url) }))
      .slice(0, 2);
  } catch {
    return [];
  }
}

export async function analyzeCompetitors(options: {
  businessName: string;
  websiteUrl?: string;
  industry?: string;
  websiteIntel?: WebsiteIntelligence | null;
}): Promise<CompetitorIntelligence> {
  const targets = await identifyCompetitorUrls(
    options.businessName,
    options.websiteUrl,
    options.industry
  );

  if (!targets.length) {
    return {
      competitors: [],
      keywordOpportunities: [],
      messagingOpportunities: [],
      missingOffers: [],
      competitiveAdvantages: [],
      source: 'unavailable',
    };
  }

  const competitors: CompetitorProfile[] = await Promise.all(
    targets.map(async (t) => {
      const site = await withTimeoutFallback(
        analyzeWebsite(t.url),
        6_000,
        null,
        `competitor-crawl:${t.url}`
      );
      return profileFromWebsite(t.name, t.url, site);
    })
  );

  const allCompetitorOffers = new Set(competitors.flatMap((c) => c.offers.map((o) => o.toLowerCase())));
  const clientOffers = new Set((options.websiteIntel?.offers ?? []).map((o) => o.toLowerCase()));
  const missingOffers = [...allCompetitorOffers].filter((o) => !clientOffers.has(o)).slice(0, 6);

  const competitorKeywords = new Set(competitors.flatMap((c) => c.keywords));
  const clientKeywords = new Set(
    (options.websiteIntel?.headings ?? []).join(' ').toLowerCase().split(/\W+/).filter((w) => w.length > 4)
  );
  const keywordOpportunities = [...competitorKeywords]
    .filter((k) => !clientKeywords.has(k))
    .slice(0, 12);

  const messagingOpportunities = competitors
    .map((c) => c.positioning)
    .filter(Boolean)
    .slice(0, 5) as string[];

  const competitiveAdvantages: string[] = [];
  if (options.websiteIntel?.offers?.length) {
    competitiveAdvantages.push(`Client offers: ${options.websiteIntel.offers.slice(0, 3).join('; ')}`);
  }
  for (const c of competitors) {
    if (c.offers.length && !c.offers.some((o) => clientOffers.has(o.toLowerCase()))) {
      competitiveAdvantages.push(`${c.name} promotes offers your site does not highlight`);
    }
  }

  return {
    competitors,
    keywordOpportunities,
    messagingOpportunities,
    missingOffers,
    competitiveAdvantages: competitiveAdvantages.slice(0, 6),
    source: competitors.some((c) => c.fetched) ? 'claude_and_crawl' : 'claude_only',
  };
}
