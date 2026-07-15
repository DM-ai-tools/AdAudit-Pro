/**
 * Ad Difference Score (0–100): how different the AI-optimized ad is from the current ad.
 * Target for Gen 2.0: 80+.
 */

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

/** Stricter near-dupe detection so "Melbourne Car Loan" ≈ "Car Loan Broker Melbourne". */
function fuzzyContains(haystack: string[], needle: string): boolean {
  const n = normalizeLine(needle);
  if (!n) return false;
  const nTokens = tokens(n);
  for (const h of haystack) {
    const hn = normalizeLine(h);
    if (!hn) continue;
    if (hn === n) return true;
    if (hn.includes(n) || n.includes(hn)) return true;
    // Share of tokens overlapping — catches word-order swaps
    if (jaccard(tokens(hn), nTokens) >= 0.55) return true;
  }
  return false;
}

/**
 * Higher = more different from the current ad.
 * Weighted: headline uniqueness 50%, description uniqueness 25%, token divergence 25%.
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

  const raw =
    headlineUniqueness * 0.5 + descUniqueness * 0.25 + tokenDivergence * 0.25;
  return Math.max(0, Math.min(100, Math.round(raw * 100)));
}

export const AD_DIFFERENCE_TARGET = 80;
