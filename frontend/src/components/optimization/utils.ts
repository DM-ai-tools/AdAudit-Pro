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

export function finalizeHeadline(text: string, max = 30): string {
  const completions = [
    'Approval',
    'Approvals',
    'Approved',
    'Consultation',
    'Guaranteed',
    'Australian',
    'Financing',
    'Refinance',
    'Commercial',
    'Mortgage',
    'Businesses',
    'Specialists',
    'Experts',
    'Brokers',
    'Lenders',
    'Application',
    'Pre-Approval',
  ];

  let s = text
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[–—]/g, '-')
    .replace(/\s*-\s*/g, ' - ');
  if (!s) return s;

  const repair = (candidate: string): string => {
    let out = candidate.trim();
    if (out.length > max) {
      let cut = out.slice(0, max);
      const lastSpace = cut.lastIndexOf(' ');
      if (lastSpace >= Math.floor(max * 0.4)) cut = cut.slice(0, lastSpace);
      out = cut.replace(/[\s\-|,;:/]+$/g, '').trim();
    }
    const parts = out.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      const last = parts[parts.length - 1]!;
      const stem = last.replace(/[^a-zA-Z0-9']/g, '');
      const lower = stem.toLowerCase();
      let fixed: string | null = null;
      for (const full of completions) {
        const f = full.toLowerCase();
        if (f === lower) {
          fixed = null;
          break;
        }
        if (f.startsWith(lower) && lower.length >= 4 && lower.length < f.length) {
          fixed = full;
          break;
        }
      }
      if (fixed) {
        const attempt = `${parts.slice(0, -1).join(' ')} ${fixed}`;
        if (attempt.length <= max) {
          out = attempt;
        } else if (parts.length >= 2) {
          const short = `${parts[parts.length - 2]} ${fixed}`;
          out = short.length <= max ? short : fixed.length <= max ? fixed : parts.slice(0, -1).join(' ');
        } else {
          out = parts.slice(0, -1).join(' ');
        }
      } else if (
        stem.length >= 5 &&
        /^[A-Za-z]+$/.test(stem) &&
        !/[aeiouy]{2}|ing$|ed$|ly$|er$|ers$|est$|tion$|sion$|ment$|ness$|able$|ful$|ous$/i.test(stem)
      ) {
        out = parts.slice(0, -1).join(' ');
      }
    }
    out = out.replace(/[\s\-|,;:/]+$/g, '').trim();
    if (out.length > max) {
      let cut = out.slice(0, max);
      const lastSpace = cut.lastIndexOf(' ');
      if (lastSpace >= Math.floor(max * 0.4)) cut = cut.slice(0, lastSpace);
      out = cut.replace(/[\s\-|,;:/]+$/g, '').trim();
    }
    return out.slice(0, max);
  };

  return repair(s);
}

export function finalizeDescription(text: string, max = 90): string {
  let s = text.trim().replace(/\s+/g, ' ').replace(/[–—]/g, '-');
  if (!s) return s;
  if (s.length > max) {
    s = s.slice(0, max);
    const lastSpace = s.lastIndexOf(' ');
    if (lastSpace > 55) s = s.slice(0, lastSpace);
  }
  s = s.replace(/[,;\s\-]+$/, '');
  if (!/[.!?]$/.test(s)) s += '.';
  if (s.length > max) {
    s = s.slice(0, max);
    const lastSpace = s.lastIndexOf(' ');
    if (lastSpace > 55) s = s.slice(0, lastSpace);
    s = s.replace(/[,;\s\-]+$/, '');
    if (!/[.!?]$/.test(s)) s += '.';
  }
  return s.slice(0, max);
}

/** @deprecated Prefer finalizeHeadline — never mid-word truncate for Google Ads. */
export function truncateHeadline(text: string, max = 30): string {
  return finalizeHeadline(text, max);
}

/** @deprecated Prefer finalizeDescription */
export function truncateDescription(text: string, max = 90): string {
  return finalizeDescription(text, max);
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

export const MODE_OPTIONS = [
  { id: 'conservative' as const, label: 'Conservative', desc: 'Subtle refinements, minimal change' },
  { id: 'balanced' as const, label: 'Balanced', desc: 'Audit + competitor-informed improvements' },
  { id: 'aggressive' as const, label: 'Aggressive', desc: 'Bold differentiation vs competitors' },
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
