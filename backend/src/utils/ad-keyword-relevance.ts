import { claudeTextFromMessage, createClaudeMessage } from '../ai/anthropic-client.js';
import { extractJsonFromClaudeText } from './claude-json.js';
import { withTimeoutFallback } from './withTimeout.js';

export interface AdRelevanceInput {
  id: string;
  advertiser: string;
  headlines: string[];
  descriptions: string[];
}

export interface AdRelevanceResult {
  id: string;
  relevant: boolean;
  score: number;
}

/** Semantic relevance threshold — ads need not contain exact service keywords. */
export const AD_RELEVANCE_THRESHOLD = 50;
const MAX_ADS_PER_CALL = 40;

/**
 * Semantic relevance: an ad can be about the service without using those exact words
 * (e.g. "Run Google Ads that convert" is relevant to "PPC Advertising").
 */
export async function scoreAdsForKeywordRelevance(
  ads: AdRelevanceInput[],
  opts: { service: string; keywords: string[] }
): Promise<Map<string, AdRelevanceResult>> {
  const out = new Map<string, AdRelevanceResult>();
  if (!ads.length) return out;

  const service = opts.service.trim();
  const keywords = [...new Set(opts.keywords.map((k) => k.trim()).filter(Boolean))].slice(0, 24);
  if (!service && !keywords.length) {
    for (const ad of ads) out.set(ad.id, { id: ad.id, relevant: true, score: 70 });
    return out;
  }

  const chunks: AdRelevanceInput[][] = [];
  for (let i = 0; i < ads.length; i += MAX_ADS_PER_CALL) {
    chunks.push(ads.slice(i, i + MAX_ADS_PER_CALL));
  }

  for (const chunk of chunks) {
    const scored = await scoreChunk(chunk, service, keywords);
    for (const [id, row] of scored) out.set(id, row);
  }

  return out;
}

export function isAdRelevant(result: AdRelevanceResult | undefined, fallback = true): boolean {
  if (!result) return fallback;
  return result.relevant || result.score >= AD_RELEVANCE_THRESHOLD;
}

async function scoreChunk(
  ads: AdRelevanceInput[],
  service: string,
  keywords: string[]
): Promise<Map<string, AdRelevanceResult>> {
  const fallback = new Map<string, AdRelevanceResult>();
  // Neutral fallback — neither auto-keep nor auto-drop everything if Claude times out
  for (const ad of ads) {
    fallback.set(ad.id, { id: ad.id, relevant: true, score: 58 });
  }

  const compact = ads.map((ad) => ({
    id: ad.id,
    advertiser: ad.advertiser.slice(0, 80),
    headlines: ad.headlines.slice(0, 5).map((h) => h.slice(0, 90)),
    descriptions: ad.descriptions.slice(0, 3).map((d) => d.slice(0, 140)),
  }));

  const parsed = await withTimeoutFallback(
    (async () => {
      const response = await createClaudeMessage({
        max_tokens: 1200,
        messages: [
          {
            role: 'user',
            content: `You are a Google Ads analyst. Score whether each Search ad is RELATED to the target service.

Target service: ${service || '(unspecified)'}
Related keyword intent (hints only — NOT required verbatim in the ad):
${keywords.length ? keywords.map((k) => `- ${k}`).join('\n') : `- ${service}`}

CRITICAL RULES:
1. Judge SEMANTIC relatedness to the service — do NOT require the exact service name or keywords in the copy.
2. PPC Advertising / paid search examples that ARE relevant even without "PPC":
   - Google Ads, Google AdWords, paid search, search ads, paid ads, SEM, CPC, bid management, ad spend, ROAS, conversions from ads, "get more leads from Google"
3. SEO examples without "SEO": "rank on Google", "get found locally", "organic traffic"
4. Mark NOT relevant when:
   - Different vertical (e.g. plumbing when service is PPC)
   - Educational / blog / "what is…" content, not an advertiser selling the service
   - Job listings, news publishers, or unrelated brand ads
   - Empty / garbage copy with no signal
5. Prefer true competitors selling the same service over loosely related marketing content.

Return ONLY JSON:
{"ads":[{"id":"string","relevant":true,"score":0}]}

score is 0–100. Set relevant=true when score >= ${AD_RELEVANCE_THRESHOLD}.

Ads:
${JSON.stringify(compact)}`,
          },
        ],
      });
      const text = claudeTextFromMessage(response);
      return extractJsonFromClaudeText(text) as {
        ads?: Array<{ id?: string; relevant?: boolean; score?: number }>;
      };
    })(),
    35_000,
    { ads: [] },
    'ad-keyword-relevance'
  );

  const rows = parsed.ads ?? [];
  if (!rows.length) {
    console.warn('[ad-relevance] LLM returned no scores — keeping fetched ads for a later pass');
    return fallback;
  }

  const result = new Map<string, AdRelevanceResult>();
  for (const ad of ads) {
    const row = rows.find((r) => String(r.id) === ad.id);
    if (!row) {
      result.set(ad.id, { id: ad.id, relevant: true, score: 55 });
      continue;
    }
    const score = Math.max(0, Math.min(100, Number(row.score) || 0));
    const relevant = row.relevant === true || score >= AD_RELEVANCE_THRESHOLD;
    result.set(ad.id, { id: ad.id, relevant, score });
  }
  return result;
}
