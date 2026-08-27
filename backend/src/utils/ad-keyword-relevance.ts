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

/** Strict same-service gate — ads below this are hidden from Create Campaign. */
export const AD_RELEVANCE_THRESHOLD = 70;
const MAX_ADS_PER_CALL = 40;

/**
 * LLM judges whether each Search ad is selling the SAME service as the campaign.
 * Fail closed: timeout / missing scores are treated as not relevant.
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
    for (const ad of ads) out.set(ad.id, { id: ad.id, relevant: false, score: 0 });
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

export function isAdRelevant(result: AdRelevanceResult | undefined, fallback = false): boolean {
  if (!result) return fallback;
  return result.relevant === true && result.score >= AD_RELEVANCE_THRESHOLD;
}

async function scoreChunk(
  ads: AdRelevanceInput[],
  service: string,
  keywords: string[]
): Promise<Map<string, AdRelevanceResult>> {
  const fallback = new Map<string, AdRelevanceResult>();
  for (const ad of ads) {
    fallback.set(ad.id, { id: ad.id, relevant: false, score: 0 });
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
        max_tokens: 1400,
        messages: [
          {
            role: 'user',
            content: `You are a Google Ads analyst. For EACH ad, decide if it is advertising THE SAME SERVICE as the target. Be strict.

Target service: ${service || '(unspecified)'}
Search intent hints (do not treat these as extra services):
${keywords.length ? keywords.map((k) => `- ${k}`).join('\n') : `- ${service}`}

HOW TO JUDGE
- Read the headlines and descriptions. The COPY is the source of truth, not the advertiser name.
- Ask: would someone searching for "${service}" consider this ad a match for that need?
- If the ad is mainly about a different product, practice area, job, course, or brand, it is NOT relevant — even if the company also offers "${service}" somewhere else.

SAME SERVICE (relevant=true) only when the ad is selling that service or the same client job:
- Property Law: conveyancing, property transfer/settlement, property solicitor, real estate / land titles / strata legal work. NOT home loans, family law, or injury law.
- First Home Buyer: first home owner grant (FHOG), stamp duty, first-home conveyancing, first home loans, mortgages for first buyers, buyer’s-agent first-home ads.
- Home loans / mortgage: home loans, refinance, brokers, lenders — NOT car loans or personal loans.
- PPC Advertising: Google Ads, paid search, SEM, search ads
- Do NOT stretch to unrelated sibling categories

NOT THE SAME SERVICE (relevant=false):
- A different product than the target (e.g. family law when target is Property Law; car loans when target is First Home Buyer)
- Job ads, recruitment, university courses, textbooks, directories, news
- Empty, garbage, or unrelated brand ads
- When unsure, mark NOT relevant

Return ONLY JSON:
{"ads":[{"id":"string","relevant":true,"score":0}]}

score is 0–100. Set relevant=true ONLY when score >= ${AD_RELEVANCE_THRESHOLD}.

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
    console.warn('[ad-relevance] LLM returned no scores — dropping unscored ads (strict service match)');
    return fallback;
  }

  const result = new Map<string, AdRelevanceResult>();
  for (const ad of ads) {
    const row = rows.find((r) => String(r.id) === ad.id);
    if (!row) {
      result.set(ad.id, { id: ad.id, relevant: false, score: 0 });
      continue;
    }
    const score = Math.max(0, Math.min(100, Number(row.score) || 0));
    const relevant = row.relevant === true && score >= AD_RELEVANCE_THRESHOLD;
    result.set(ad.id, { id: ad.id, relevant, score });
  }
  return result;
}

export interface AdvertiserRelevanceInput {
  id: string;
  name: string;
  url?: string;
  headlines?: string[];
  descriptions?: string[];
}

/**
 * Score whether an advertiser's sampled ads are selling the target service.
 */
export async function scoreAdvertisersForService(
  advertisers: AdvertiserRelevanceInput[],
  opts: { service: string; keywords: string[] }
): Promise<Map<string, AdRelevanceResult>> {
  const out = new Map<string, AdRelevanceResult>();
  if (!advertisers.length) return out;

  const service = opts.service.trim();
  const keywords = [...new Set(opts.keywords.map((k) => k.trim()).filter(Boolean))].slice(0, 16);
  const fallback = new Map<string, AdRelevanceResult>();
  for (const row of advertisers) {
    fallback.set(row.id, { id: row.id, relevant: false, score: 0 });
  }
  if (!service) return fallback;

  const compact = advertisers.map((row) => ({
    id: row.id,
    name: row.name.slice(0, 80),
    url: (row.url ?? '').slice(0, 120),
    headlines: (row.headlines ?? []).slice(0, 4).map((h) => h.slice(0, 80)),
    descriptions: (row.descriptions ?? []).slice(0, 2).map((d) => d.slice(0, 120)),
  }));

  const parsed = await withTimeoutFallback(
    (async () => {
      const response = await createClaudeMessage({
        max_tokens: 1400,
        messages: [
          {
            role: 'user',
            content: `You are a Google Ads competitor analyst. Decide whether each advertiser is running ads for THE SAME SERVICE as the target. Be strict.

Target service: ${service}
Intent hints:
${keywords.length ? keywords.map((k) => `- ${k}`).join('\n') : `- ${service}`}

RULES:
1. Judge from the sampled ad headlines/descriptions. If copy is missing, judge only if the NAME clearly sells this service (e.g. "KRG Conveyancing" for Property Law, "Aussie" / "Lendi" for First Home Buyer / home loans). Otherwise mark NOT relevant.
2. Same service as the target:
   - Property Law: conveyancing, property solicitors, land titles, strata legal — NOT family, injury, or generic "lawyers".
   - First Home Buyer / home loans: mortgage brokers, home-loan lenders, first-home grants, stamp duty, first-home conveyancing.
3. A full-service firm is relevant ONLY if the sampled ads are about this service.
4. Mark NOT relevant: universities, courses, job boards, directories, recruitment, service-label names with no firm ("Property Law"). Banks and insurers are relevant only when the target is home loans / first home buyer / insurance.
5. When unsure, mark NOT relevant.

Return ONLY JSON:
{"advertisers":[{"id":"string","relevant":true,"score":0}]}

score is 0–100. Set relevant=true ONLY when score >= ${AD_RELEVANCE_THRESHOLD}.

Advertisers:
${JSON.stringify(compact)}`,
          },
        ],
      });
      const text = claudeTextFromMessage(response);
      return extractJsonFromClaudeText(text) as {
        advertisers?: Array<{ id?: string; relevant?: boolean; score?: number }>;
      };
    })(),
    35_000,
    { advertisers: [] },
    'advertiser-service-relevance'
  );

  const rows = parsed.advertisers ?? [];
  if (!rows.length) {
    console.warn('[advertiser-relevance] LLM returned no scores — dropping unscored advertisers');
    return fallback;
  }

  for (const advertiser of advertisers) {
    const row = rows.find((r) => String(r.id) === advertiser.id);
    if (!row) {
      out.set(advertiser.id, { id: advertiser.id, relevant: false, score: 0 });
      continue;
    }
    const score = Math.max(0, Math.min(100, Number(row.score) || 0));
    const relevant = row.relevant === true && score >= AD_RELEVANCE_THRESHOLD;
    out.set(advertiser.id, { id: advertiser.id, relevant, score });
  }
  return out;
}
