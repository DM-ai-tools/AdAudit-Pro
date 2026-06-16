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
  if (OPTIMIZABLE_CATEGORIES.has(finding.category)) return true;
  const text = `${finding.title} ${finding.description}`.toLowerCase();
  return OPTIMIZABLE_KEYWORDS.some((k) => text.includes(k));
}

export function truncateHeadline(text: string, max = 30): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function truncateDescription(text: string, max = 90): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export const THINKING_STEPS = [
  'Analyzing full audit report…',
  'Reviewing campaign performance…',
  'Evaluating keyword & search term data…',
  'Analyzing existing ad copy…',
  'Checking landing page alignment…',
  'Optimizing conversion intent…',
  'Generating publishable RSA copy…',
];

export const TONE_OPTIONS = [
  { id: 'default' as const, label: 'Balanced' },
  { id: 'professional' as const, label: 'Professional Tone' },
  { id: 'luxury' as const, label: 'Luxury Tone' },
  { id: 'high-conversion' as const, label: 'High Conversion Tone' },
  { id: 'aggressive' as const, label: 'More Aggressive CTA' },
  { id: 'shorter' as const, label: 'Shorter Headlines' },
];
