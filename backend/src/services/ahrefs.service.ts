import { env } from '../config/env.js';

import { keywordMatchesServiceSeed } from '../utils/service-seed-match.js';

const AHREFS_BASE = 'https://api.ahrefs.com/v3';

function ahrefsHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${env.ahrefsApiKey}`,
    Accept: 'application/json',
  };
}

export function isAhrefsConfigured(): boolean {
  return env.ahrefsApiKey.length > 10;
}

let ahrefsQuotaExhausted = false;

export function isAhrefsQuotaExhausted(): boolean {
  return ahrefsQuotaExhausted;
}

function noteAhrefsFailure(status: number, body: string): void {
  if (status === 403 && /API units/i.test(body)) {
    ahrefsQuotaExhausted = true;
    console.warn('[ahrefs] API unit quota exhausted — skipping further Ahrefs calls this process');
  }
}

export interface AhrefsOrganicKeyword {
  keyword: string;
  volume: number;
  position: number;
  traffic: number;
  url: string;
  difficulty?: number;
  intent?: 'transactional' | 'commercial' | 'informational';
  matchSuggestion?: 'EXACT' | 'PHRASE';
  role?: 'primary' | 'secondary';
  seed?: string;
  suggestedCpc?: number;
}

export interface KeywordSeedTheme {
  seed: string;
  theme: string;
  intent: 'transactional' | 'commercial';
  primary: AhrefsOrganicKeyword[];
  secondary: AhrefsOrganicKeyword[];
}

export interface KeywordCluster {
  service: string;
  keywords: AhrefsOrganicKeyword[];
  seedThemes?: KeywordSeedTheme[];
  totalVolume: number;
  totalTraffic: number;
  topKeyword: string;
}

function stemWord(word: string): string {
  const w = word.toLowerCase();
  if (w.length <= 3) return w;
  if (w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (w.endsWith('es') && w.length > 4) return w.slice(0, -2);
  if (w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

/** Score how well a keyword matches a service name (0 = no match). */
export function serviceMatchScore(keyword: string, service: string): number {
  const kwLower = keyword.toLowerCase();
  const svcLower = service.toLowerCase().trim();
  if (!svcLower) return 0;

  if (kwLower.includes(svcLower)) return svcLower.length * 5;

  const svcWords = svcLower.split(/\s+/).filter((w) => w.length >= 2);
  if (svcWords.length > 1) {
    if (!keywordMatchesServiceSeed(keyword, service)) return 0;
    return svcWords.reduce((s, w) => s + w.length, 0) * 2;
  }

  if (svcWords.length === 1 && kwLower.includes(svcWords[0]!)) return svcWords[0]!.length * 2;

  let score = 0;
  for (const sw of svcWords) {
    if (sw.length >= 3 && kwLower.includes(sw)) score += sw.length;
    const stem = stemWord(sw);
    for (const kw of kwLower.split(/\s+/)) {
      if (stemWord(kw) === stem || kw.includes(stem)) score += 2;
    }
  }
  return score;
}

/** Keep only keywords that match the service seed (all significant tokens). */
export function filterKeywordsForServiceSeed(
  service: string,
  keywords: AhrefsOrganicKeyword[]
): AhrefsOrganicKeyword[] {
  const matched = keywords.filter((kw) => keywordMatchesServiceSeed(kw.keyword, service));
  return filterCommercialServiceKeywords(service, matched);
}

/**
 * Drop tool/guide/library noise that matches the service tokens but is not commercial
 * intent for advertising that service (e.g. "meta ads library" for Meta Ads agencies).
 */
export function filterCommercialServiceKeywords(
  service: string,
  keywords: AhrefsOrganicKeyword[]
): AhrefsOrganicKeyword[] {
  const svc = service.toLowerCase();
  const isAgencyLike =
    /\b(ads?|agency|marketing|seo|ppc|sem|social|content|media)\b/i.test(svc);
  if (!isAgencyLike) return keywords;

  const noise =
    /\b(ad library|ads library|meta ads library|facebook ad library|how to use|best practices|complete guide|tutorial|step[- ]by[- ]step|what is|definition)\b/i;

  const commercial = keywords.filter((kw) => {
    const k = kw.keyword.toLowerCase();
    if (noise.test(k)) return false;
    // Prefer buyer intent over research intent
    if (/\b(jobs?|salary|course|certification|training|internship)\b/i.test(k)) return false;
    return true;
  });

  return commercial.length >= 3 ? commercial : keywords.filter((kw) => !noise.test(kw.keyword));
}

export function classifyKeywordIntent(
  keyword: string
): 'transactional' | 'commercial' | 'informational' {
  const k = keyword.toLowerCase();
  if (
    /\b(what is|what's|how to|how do|guide|tutorial|definition|examples?|meaning|vs\b|versus|wiki|explained)\b/.test(
      k
    )
  ) {
    return 'informational';
  }
  if (
    /\b(buy|price|cost|quote|quotes|near me|hire|book|get|order|cheap|pricing|rates?|consultation|enquire|inquiry|contact|sign up|trial)\b/.test(
      k
    )
  ) {
    return 'transactional';
  }
  return 'commercial';
}

export function suggestKeywordMatch(keyword: string): 'EXACT' | 'PHRASE' {
  const words = keyword.trim().split(/\s+/).filter(Boolean).length;
  return words <= 2 ? 'EXACT' : 'PHRASE';
}

export function annotateKeyword(kw: AhrefsOrganicKeyword): AhrefsOrganicKeyword {
  return {
    ...kw,
    intent: kw.intent ?? classifyKeywordIntent(kw.keyword),
    matchSuggestion: kw.matchSuggestion ?? suggestKeywordMatch(kw.keyword),
  };
}

export function filterBuyerIntentKeywords(
  keywords: AhrefsOrganicKeyword[]
): AhrefsOrganicKeyword[] {
  const annotated = keywords.map(annotateKeyword);
  const buyer = annotated.filter((k) => k.intent !== 'informational');
  return buyer.length >= 4 ? buyer : annotated;
}

/** Prefer lower KD with usable volume given a daily budget (AUD/USD). */
export function scoreKeywordForBudget(
  kw: AhrefsOrganicKeyword,
  dailyBudget = 20
): number {
  const kd = kw.difficulty ?? 28;
  const vol = kw.volume ?? 0;
  const maxKd = dailyBudget >= 80 ? 45 : dailyBudget >= 40 ? 35 : 28;
  const sweetVol = dailyBudget >= 80 ? 2500 : dailyBudget >= 40 ? 900 : 400;
  if (vol < 10) return 0;
  const kdPenalty = kd > maxKd ? (kd - maxKd) * 4 : 0;
  const volFit = vol > sweetVol * 3 ? sweetVol : vol;
  const intentBoost = kw.intent === 'transactional' ? 1.25 : kw.intent === 'commercial' ? 1.1 : 0.6;
  return Math.max(0, (volFit / (kd + 8) - kdPenalty) * intentBoost);
}

function tokenSet(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/\W+/)
      .filter((t) => t.length >= 2 && !['for', 'and', 'the', 'with', 'in', 'of', 'a', 'an', 'to'].includes(t))
  );
}

function tokenOverlap(a: string, b: string): number {
  const A = tokenSet(a);
  const B = tokenSet(b);
  if (!A.size || !B.size) return 0;
  let n = 0;
  for (const t of A) if (B.has(t)) n += 1;
  return n / Math.min(A.size, B.size);
}

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Max CPC for Manual CPC given daily budget, KD, match type, and intent. */
export function suggestKeywordCpc(
  kw: AhrefsOrganicKeyword,
  dailyBudget = 20,
  accountAvgCpc?: number
): number {
  const kd = kw.difficulty ?? 22;
  const match = kw.matchSuggestion ?? suggestKeywordMatch(kw.keyword);
  const intent = kw.intent ?? classifyKeywordIntent(kw.keyword);
  const floor = dailyBudget >= 80 ? 1.2 : dailyBudget >= 40 ? 0.75 : 0.45;
  const cap = Math.max(floor + 0.5, dailyBudget / 5);
  const base =
    accountAvgCpc && accountAvgCpc > 0.2
      ? Math.min(accountAvgCpc * 1.08, cap)
      : Math.min(Math.max(dailyBudget / 12, floor), 3.2);
  const kdLift = 1 + Math.min(kd, 45) / 90;
  const matchLift = match === 'EXACT' ? 1.22 : 0.9;
  const intentLift = intent === 'transactional' ? 1.18 : 1;
  const roleLift = kw.role === 'primary' ? 1.12 : 0.86;
  return roundMoney(Math.min(cap, Math.max(floor, base * kdLift * matchLift * intentLift * roleLift)));
}

function seedSpecificityScore(keyword: string, seed: string): number {
  const kw = keyword.toLowerCase();
  const sd = seed.toLowerCase();
  const overlap = tokenOverlap(keyword, seed);
  const contains = kw.includes(sd) ? 3 : 0;
  const lengthBonus = seed.trim().split(/\s+/).length * 0.35;
  return overlap * 8 + contains + lengthBonus;
}

export function pickSeedKeywords(
  service: string,
  keywords: AhrefsOrganicKeyword[],
  maxSeeds = 4
): string[] {
  const target = Math.min(4, Math.max(3, maxSeeds));
  const ranked = [...keywords]
    .map(annotateKeyword)
    .filter((k) => k.intent !== 'informational')
    .sort(
      (a, b) =>
        scoreKeywordForBudget(b, 40) - scoreKeywordForBudget(a, 40) || b.volume - a.volume
    );

  const seeds: string[] = [];
  const tryAdd = (raw: string) => {
    const t = raw.trim();
    if (!t || seeds.length >= target) return;
    if (seeds.some((s) => s.toLowerCase() === t.toLowerCase())) return;
    // Keep clusters distinct — generic service names collapse everything into one group
    if (seeds.some((s) => tokenOverlap(s, t) >= 0.72)) return;
    seeds.push(t);
  };

  for (const kw of ranked) {
    const words = kw.keyword.trim().split(/\s+/).length;
    if (words < 2 || words > 6) continue;
    if (kw.keyword.toLowerCase() === service.trim().toLowerCase()) continue;
    tryAdd(kw.keyword);
  }

  const transactional = ranked.find(
    (k) =>
      k.intent === 'transactional' &&
      !seeds.some((s) => s.toLowerCase() === k.keyword.toLowerCase())
  );
  if (transactional) tryAdd(transactional.keyword);

  const modifiers = ['local', 'affordable', 'ecommerce', 'small business', 'agency', 'near me', 'white label'];
  for (const m of modifiers) {
    if (seeds.length >= target) break;
    const hit = ranked.find((k) => k.keyword.toLowerCase().includes(m));
    if (hit) tryAdd(hit.keyword);
  }

  if (seeds.length < 3) tryAdd(service);
  if (seeds.length < 3) {
    for (const extra of [`${service} near me`, `affordable ${service}`, `best ${service}`]) {
      tryAdd(extra);
    }
  }

  return seeds.slice(0, target);
}

export function buildSeedThemes(
  service: string,
  keywords: AhrefsOrganicKeyword[],
  dailyBudget = 20
): KeywordSeedTheme[] {
  const pool = filterBuyerIntentKeywords(keywords.map(annotateKeyword));
  const seeds = pickSeedKeywords(service, pool, 4);
  const buckets = new Map<string, AhrefsOrganicKeyword[]>();
  for (const seed of seeds) buckets.set(seed, []);

  for (const kw of pool) {
    let best = seeds[0] ?? service;
    let bestScore = -1;
    for (const seed of seeds) {
      const score = seedSpecificityScore(kw.keyword, seed);
      if (score > bestScore) {
        bestScore = score;
        best = seed;
      }
    }
    buckets.get(best)?.push(kw);
  }

  const themes: KeywordSeedTheme[] = [];
  for (const seed of seeds) {
    const members = dedupeKeywords(buckets.get(seed) ?? []).sort(
      (a, b) =>
        scoreKeywordForBudget(b, dailyBudget) - scoreKeywordForBudget(a, dailyBudget) ||
        b.volume - a.volume
    );
    if (!members.length) {
      const seedRow = pool.find((k) => k.keyword.toLowerCase() === seed.toLowerCase());
      members.push(
        seedRow ?? {
          keyword: seed,
          volume: 0,
          position: 0,
          traffic: 0,
          url: '',
          intent: classifyKeywordIntent(seed),
          matchSuggestion: suggestKeywordMatch(seed),
        }
      );
    }
    const tagged = members.slice(0, 10).map((k, i) => ({
      ...annotateKeyword(k),
      seed,
      role: (i < 2 ? 'primary' : 'secondary') as 'primary' | 'secondary',
      suggestedCpc: suggestKeywordCpc(
        { ...annotateKeyword(k), role: i < 2 ? 'primary' : 'secondary' },
        dailyBudget
      ),
    }));
    const intent =
      tagged.filter((t) => t.intent === 'transactional').length >= tagged.length / 2
        ? 'transactional'
        : 'commercial';
    themes.push({
      seed,
      theme: seed,
      intent,
      primary: tagged.filter((t) => t.role === 'primary').slice(0, 2),
      secondary: tagged.filter((t) => t.role === 'secondary').slice(0, 8),
    });
  }

  const filled = themes.filter((t) => t.primary.length + t.secondary.length > 0);
  return filled.slice(0, 4);
}

export function flattenSeedThemes(themes: KeywordSeedTheme[]): AhrefsOrganicKeyword[] {
  const out: AhrefsOrganicKeyword[] = [];
  for (const t of themes) {
    out.push(...t.primary, ...t.secondary);
  }
  return dedupeKeywords(out);
}

export function buildClusterFromKeywords(
  service: string,
  keywords: AhrefsOrganicKeyword[],
  dailyBudget = 20
): KeywordCluster {
  const buyer = filterBuyerIntentKeywords(keywords);
  const quickWins = filterQuickWinKeywords(buyer, { maxCount: 40, dailyBudget });
  const deduped = dedupeKeywords(quickWins.length ? quickWins : buyer.slice(0, 30));
  const seedThemes = buildSeedThemes(service, deduped, dailyBudget);
  const fromThemes = flattenSeedThemes(seedThemes);
  const sorted = (fromThemes.length ? fromThemes : deduped)
    .map((k) => ({
      ...k,
      suggestedCpc: k.suggestedCpc ?? suggestKeywordCpc(k, dailyBudget),
    }))
    .sort(
      (a, b) =>
        scoreKeywordForBudget(b, dailyBudget) - scoreKeywordForBudget(a, dailyBudget) || b.volume - a.volume
    );
  return {
    service,
    keywords: sorted.slice(0, 36),
    seedThemes,
    totalVolume: sorted.reduce((s, k) => s + k.volume, 0),
    totalTraffic: sorted.reduce((s, k) => s + k.traffic, 0),
    topKeyword: sorted[0]?.keyword ?? service,
  };
}

export function dedupeKeywords(keywords: AhrefsOrganicKeyword[]): AhrefsOrganicKeyword[] {
  const seen = new Set<string>();
  const out: AhrefsOrganicKeyword[] = [];
  for (const kw of keywords) {
    const key = kw.keyword.toLowerCase().trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(kw);
  }
  return out;
}

/**
 * Keep keywords that are realistic quick wins: lower difficulty, striking-distance rankings,
 * or moderate volume with clear commercial intent.
 */
export function filterQuickWinKeywords(
  keywords: AhrefsOrganicKeyword[],
  opts?: { maxCount?: number; dailyBudget?: number }
): AhrefsOrganicKeyword[] {
  const maxCount = opts?.maxCount ?? 25;
  const dailyBudget = opts?.dailyBudget ?? 20;

  type Scored = { kw: AhrefsOrganicKeyword; score: number };
  const scored: Scored[] = [];

  for (const raw of keywords) {
    const kw = annotateKeyword(raw);
    const kd = kw.difficulty ?? 0;
    const vol = kw.volume ?? 0;
    const pos = kw.position ?? 0;
    let score = scoreKeywordForBudget(kw, dailyBudget);

    if (pos >= 4 && pos <= 20 && vol >= 30) {
      score = Math.max(score, (vol * 3) / pos);
    } else if (kd > 0 && kd <= 30 && vol >= 50) {
      score = Math.max(score, vol / (kd + 1));
    } else if (kd > 0 && kd <= 20 && vol >= 20) {
      score = Math.max(score, (vol / (kd + 1)) * 1.5);
    } else if (kd === 0 && vol >= 40) {
      score = Math.max(score, vol * 0.45);
    }

    if (kw.intent === 'informational') score *= 0.35;
    if (score > 0) scored.push({ kw, score });
  }

  scored.sort((a, b) => b.score - a.score);
  let picked = scored.slice(0, maxCount).map((s) => s.kw);

  // Relax slightly if too few quick wins
  if (picked.length < 8) {
    const pickedSet = new Set(picked.map((k) => k.keyword.toLowerCase()));
    const relaxed = keywords
      .filter((kw) => {
        if (pickedSet.has(kw.keyword.toLowerCase())) return false;
        const kd = kw.difficulty ?? 50;
        const vol = kw.volume ?? 0;
        return vol >= 30 && (kd <= 40 || kw.position === 0);
      })
      .sort((a, b) => b.volume - a.volume)
      .slice(0, maxCount - picked.length);
    picked = [...picked, ...relaxed];
  }

  return picked.slice(0, maxCount);
}

/**
 * Fetch organic keywords for a domain from Ahrefs Site Explorer.
 */
export async function fetchOrganicKeywords(
  domain: string,
  opts?: { country?: string; limit?: number }
): Promise<AhrefsOrganicKeyword[]> {
  if (!isAhrefsConfigured() || ahrefsQuotaExhausted) {
    if (!isAhrefsConfigured()) console.warn('[ahrefs] API key not configured — returning empty');
    return [];
  }

  const target = domain.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  const limit = Math.min(opts?.limit ?? 1000, 10000);
  const country = opts?.country ?? 'au';
  const today = new Date();
  const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;

  const params = new URLSearchParams({
    select: 'keyword,volume,best_position,sum_traffic,keyword_difficulty',
    target: target!,
    date,
    country,
    mode: 'domain',
    limit: String(limit),
    order_by: 'sum_traffic:desc',
  });

  const url = `${AHREFS_BASE}/site-explorer/organic-keywords?${params}`;
  console.log(`[ahrefs] fetching organic keywords for ${target} (${country}, limit=${limit})`);

  const res = await fetch(url, { headers: ahrefsHeaders() });
  const body = await res.text();
  if (!res.ok) {
    noteAhrefsFailure(res.status, body);
    console.error(`[ahrefs] organic-keywords ${res.status}:`, body.slice(0, 500));
    return [];
  }

  const data = JSON.parse(body) as {
    keywords?: Array<{
      keyword: string;
      volume: number;
      best_position: number;
      sum_traffic: number;
      keyword_difficulty?: number;
    }>;
  };

  return (data.keywords ?? []).map((k) => ({
    keyword: k.keyword,
    volume: k.volume ?? 0,
    position: k.best_position ?? 0,
    traffic: k.sum_traffic ?? 0,
    url: '',
    difficulty: k.keyword_difficulty,
  }));
}

/**
 * Fetch keyword ideas for a service seed via Keywords Explorer matching-terms.
 */
export async function fetchMatchingKeywords(
  seed: string,
  opts?: { country?: string; limit?: number }
): Promise<AhrefsOrganicKeyword[]> {
  if (!isAhrefsConfigured() || !seed.trim() || ahrefsQuotaExhausted) return [];

  const country = opts?.country ?? 'au';
  const limit = Math.min(opts?.limit ?? 50, 100);

  const params = new URLSearchParams({
    select: 'keyword,volume,difficulty,traffic_potential',
    keywords: seed.trim(),
    country,
    limit: String(limit),
    order_by: 'volume:desc',
    match_mode: seed.trim().includes(' ') ? 'phrase' : 'terms',
  });

  const url = `${AHREFS_BASE}/keywords-explorer/matching-terms?${params}`;
  console.log(`[ahrefs] matching-terms for "${seed}" (${country})`);

  const res = await fetch(url, { headers: ahrefsHeaders() });
  const body = await res.text();
  if (!res.ok) {
    noteAhrefsFailure(res.status, body);
    console.warn(`[ahrefs] matching-terms ${res.status}:`, body.slice(0, 300));
    return [];
  }

  const data = JSON.parse(body) as {
    keywords?: Array<{
      keyword: string;
      volume: number;
      difficulty?: number;
      traffic_potential?: number;
    }>;
  };

  return (data.keywords ?? []).map((k) => ({
    keyword: k.keyword,
    volume: k.volume ?? 0,
    position: 0,
    traffic: k.traffic_potential ?? 0,
    url: '',
    difficulty: k.difficulty,
  }));
}

/**
 * Cluster organic keywords into service groups.
 * Only returns clusters for services that received at least one keyword.
 */
export function clusterKeywordsByService(
  keywords: AhrefsOrganicKeyword[],
  services: string[]
): KeywordCluster[] {
  if (!services.length) return [];

  const buckets = new Map<string, AhrefsOrganicKeyword[]>();
  for (const s of services) buckets.set(s, []);

  for (const kw of keywords) {
    let bestService = '';
    let bestScore = 0;
    for (const service of services) {
      if (!keywordMatchesServiceSeed(kw.keyword, service)) continue;
      const score = serviceMatchScore(kw.keyword, service);
      if (score > bestScore) {
        bestScore = score;
        bestService = service;
      }
    }
    if (bestService && bestScore >= 2) {
      buckets.get(bestService)!.push(kw);
    }
  }

  const clusters: KeywordCluster[] = [];
  for (const service of services) {
    const kws = buckets.get(service) ?? [];
    if (!kws.length) continue;
    clusters.push(buildClusterFromKeywords(service, kws));
  }

  return clusters.sort((a, b) => b.totalTraffic - a.totalTraffic);
}

/**
 * Get keyword overview/metrics from Ahrefs Keywords Explorer.
 */
export async function getKeywordOverview(
  keywords: string[],
  country = 'au'
): Promise<
  Array<{
    keyword: string;
    volume: number;
    difficulty: number;
    cpc: number;
    trafficPotential: number;
  }>
> {
  if (!isAhrefsConfigured() || !keywords.length) return [];

  const params = new URLSearchParams({
    select: 'keyword,volume,difficulty,cpc,traffic_potential',
    keywords: keywords.slice(0, 100).join(','),
    country,
  });

  const url = `${AHREFS_BASE}/keywords-explorer/overview?${params}`;
  const res = await fetch(url, { headers: ahrefsHeaders() });
  if (!res.ok) {
    console.warn(`[ahrefs] keyword-overview ${res.status}`);
    return [];
  }

  const data = (await res.json()) as {
    keywords?: Array<{
      keyword: string;
      volume: number;
      difficulty: number;
      cpc: number;
      traffic_potential: number;
    }>;
  };

  return (data.keywords ?? []).map((k) => ({
    keyword: k.keyword,
    volume: k.volume ?? 0,
    difficulty: k.difficulty ?? 0,
    cpc: k.cpc ?? 0,
    trafficPotential: k.traffic_potential ?? 0,
  }));
}
