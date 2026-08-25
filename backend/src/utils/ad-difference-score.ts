/**
 * Ad Difference Score (0–100): how different the AI-optimized ad is from the current ad.
 * Target for Gen 2.0: 90+ (visibly different side-by-side).
 */

export const AD_DIFFERENCE_TARGET = 90;

function normalizeLine(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(s: string): Set<string> {
  return new Set(
    normalizeLine(s)
      .split(' ')
      .filter((w) => w.length > 2)
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size && !b.size) return 1;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  const union = a.size + b.size - inter || 1;
  return inter / union;
}

/** Sorted token fingerprint — catches word-order-only clones. */
function tokenFingerprint(s: string): string {
  return [...tokens(s)].sort().join(' ');
}

/** Stricter near-dupe detection so "Melbourne Car Loan" ≈ "Car Loan Broker Melbourne". */
export function fuzzyContains(haystack: string[], needle: string): boolean {
  const n = normalizeLine(needle);
  if (!n) return false;
  const nTokens = tokens(n);
  const nFp = tokenFingerprint(n);
  for (const h of haystack) {
    const hn = normalizeLine(h);
    if (!hn) continue;
    if (hn === n) return true;
    if (tokenFingerprint(hn) === nFp && nFp.length > 0) return true;
    if (hn.includes(n) || n.includes(hn)) return true;
    // Share of tokens overlapping — catches word-order / synonym-lite swaps
    if (jaccard(tokens(hn), nTokens) >= 0.32) return true;
  }
  return false;
}

/**
 * Higher = more different from the current ad.
 * Weighted: headline uniqueness 55%, description uniqueness 25%, token divergence 20%.
 */
export function computeAdDifferenceScore(
  current: { headlines?: string[]; descriptions?: string[] },
  optimized: { headlines?: string[]; descriptions?: string[] }
): number {
  const curH = (current.headlines ?? []).map(normalizeLine).filter(Boolean);
  const optH = (optimized.headlines ?? []).map(normalizeLine).filter(Boolean);
  const curD = (current.descriptions ?? []).map(normalizeLine).filter(Boolean);
  const optD = (optimized.descriptions ?? []).map(normalizeLine).filter(Boolean);

  if (!optH.length && !optD.length) return 0;
  if (!curH.length && !curD.length) return 85; // greenfield — treat as highly new

  let uniqueHeadlines = 0;
  for (const h of optH) {
    if (!fuzzyContains(curH, h)) uniqueHeadlines += 1;
  }
  const headlineUniqueness = optH.length ? uniqueHeadlines / optH.length : 0;

  let uniqueDescs = 0;
  for (const d of optD) {
    if (!fuzzyContains(curD, d)) uniqueDescs += 1;
  }
  const descUniqueness = optD.length ? uniqueDescs / optD.length : headlineUniqueness;

  const curTokens = tokens([...curH, ...curD].join(' '));
  const optTokens = tokens([...optH, ...optD].join(' '));
  const tokenDivergence = 1 - jaccard(curTokens, optTokens);

  let raw =
    headlineUniqueness * 0.55 + descUniqueness * 0.25 + tokenDivergence * 0.2;

  // Hard penalty: if too many headlines are near-clones, score cannot look "ready"
  if (optH.length && uniqueHeadlines / optH.length < 0.85) {
    raw = Math.min(raw, 0.72);
  }
  if (optD.length && uniqueDescs / optD.length < 0.75) {
    raw = Math.min(raw, 0.78);
  }

  return Math.max(0, Math.min(100, Math.round(raw * 100)));
}

/** True when a human would say the AI ad looks like the current ad. */
export function isVisiblyTooSimilar(
  current: { headlines?: string[]; descriptions?: string[] },
  optimized: { headlines?: string[]; descriptions?: string[] }
): boolean {
  return computeAdDifferenceScore(current, optimized) < AD_DIFFERENCE_TARGET;
}

export function listNearDuplicateHeadlines(
  current: { headlines?: string[] },
  optimized: { headlines?: string[] }
): string[] {
  const curH = current.headlines ?? [];
  const dupes: string[] = [];
  for (const h of optimized.headlines ?? []) {
    if (h.trim() && fuzzyContains(curH, h)) dupes.push(h);
  }
  return dupes;
}
