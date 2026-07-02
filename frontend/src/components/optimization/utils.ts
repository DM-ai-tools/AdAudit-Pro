import type { Finding } from '../../types';

const OPTIMIZABLE_KEYWORDS = [
  'ctr',
  'click-through',
  'ad copy',
  'ad strength',
  'headline',
  'description',
  'quality score',
  'conversion',
  'relevance',
  'rsa',
  'weak',
  'poor',
  'ad relevance',
  'responsive search',
];

const OPTIMIZABLE_CATEGORIES = new Set([
  'AD_COPY',
  'QUALITY_SCORE',
  'KEYWORDS',
  'LANDING_PAGES',
]);

export function isOptimizableFinding(finding: Finding): boolean {
  if (finding.status !== 'OPEN') return false;
  if (OPTIMIZABLE_CATEGORIES.has(finding.category)) return true;
  const text = `${finding.title} ${finding.description} ${finding.recommendation ?? ''}`.toLowerCase();
  if (OPTIMIZABLE_KEYWORDS.some((k) => text.includes(k))) return true;
  // Budget, bidding, and campaign-structure findings get strategy-focused recommendations
  return ['BUDGET', 'BIDDING', 'CAMPAIGNS', 'CAMPAIGN', 'CONVERSIONS'].includes(finding.category);
}

export function truncateHeadline(text: string, max = 30): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function truncateDescription(text: string, max = 90): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export const THINKING_STEPS = [
  'Fetching live Google Ads campaign data…',
  'Analyzing audit findings & health score…',
  'Reviewing keywords, search terms & quality scores…',
  'Crawling website & competitor intelligence…',
  'Evaluating ad copy, extensions & landing pages…',
  'Building strategist recommendations…',
  'Generating optimized ads & impact projections…',
];

export const TONE_OPTIONS = [
  { id: 'default' as const, label: 'Balanced' },
  { id: 'professional' as const, label: 'Professional Tone' },
  { id: 'luxury' as const, label: 'Luxury Tone' },
  { id: 'high-conversion' as const, label: 'High Conversion Tone' },
  { id: 'aggressive' as const, label: 'More Aggressive CTA' },
  { id: 'shorter' as const, label: 'Shorter Headlines' },
];

/** Coerce Claude/Google Ads extension shapes into plain strings safe for React text nodes. */
export function normalizeRenderableStrings(val: unknown): string[] {
  if (val == null) return [];
  if (typeof val === 'string') {
    const s = val.trim();
    return s ? [s] : [];
  }
  if (typeof val === 'number' || typeof val === 'boolean') {
    return [String(val)];
  }
  if (Array.isArray(val)) {
    return val.flatMap((item) => normalizeRenderableStrings(item));
  }
  if (typeof val === 'object') {
    const o = val as Record<string, unknown>;
    const text = o.text ?? o.linkText ?? o.label ?? o.name ?? o.headline ?? o.value ?? o.description;
    const url = o.url ?? o.finalUrl ?? o.href;
    if (typeof text === 'string' && text.trim()) {
      const label = text.trim();
      if (typeof url === 'string' && url.trim()) {
        return [`${label} (${url.trim()})`];
      }
      return [label];
    }
    if (typeof url === 'string' && url.trim()) {
      return [url.trim()];
    }
  }
  return [];
}

/** Safe single value for JSX text nodes — never pass raw objects to React children. */
export function asDisplayText(val: unknown, fallback = ''): string {
  if (val == null) return fallback;
  if (typeof val === 'string') return val;
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  const fromList = normalizeRenderableStrings(val);
  if (fromList.length) return fromList.join(', ');
  if (typeof val === 'object') {
    try {
      return JSON.stringify(val);
    } catch {
      return fallback;
    }
  }
  return fallback;
}
