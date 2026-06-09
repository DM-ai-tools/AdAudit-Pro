import type { AuditModuleOption } from '../types/connect';

export const DEFAULT_AUDIT_MODULES: AuditModuleOption[] = [
  { id: 'campaign', name: 'Campaign Structure', description: 'Architecture, naming, and campaign type analysis', icon: 'layers', enabled: true },
  { id: 'keyword', name: 'Keyword Audit', description: 'Match types, duplicates, and relevance scoring', icon: 'search', enabled: true },
  { id: 'search-terms', name: 'Search Term Waste', description: 'Non-converting queries and negative keyword gaps', icon: 'target', enabled: true },
  { id: 'budget', name: 'Budget Analysis', description: 'Allocation, capped campaigns, and spend pacing', icon: 'dollar', enabled: true },
  { id: 'geo', name: 'Geo Analysis', description: 'Location targeting and geographic waste', icon: 'map', enabled: true },
  { id: 'audience', name: 'Audience Analysis', description: 'Remarketing, in-market, and observation layers', icon: 'users', enabled: true },
  { id: 'ad-copy', name: 'Ad Copy Analysis', description: 'RSA strength, messaging gaps, and AI review', icon: 'file', enabled: true },
  { id: 'landing-pages', name: 'Landing Page Analysis', description: 'Speed, relevance, and conversion path alignment', icon: 'layout', enabled: true },
  { id: 'bidding', name: 'Bidding Analysis', description: 'Smart bidding readiness and bid adjustments', icon: 'trending', enabled: true },
  { id: 'conversion', name: 'Conversion Tracking Audit', description: 'Tag health, attribution, and goal setup', icon: 'activity', enabled: true },
  { id: 'quality-score', name: 'Quality Score Audit', description: 'QS breakdown by keyword and landing page', icon: 'bar', enabled: true },
  { id: 'device', name: 'Device Performance Audit', description: 'Mobile vs desktop performance gaps', icon: 'smartphone', enabled: true },
];

export const QUICK_MODULE_IDS = DEFAULT_AUDIT_MODULES.filter((_, i) => [0, 1, 2, 3, 6, 9].includes(i)).map((m) => m.id);

export const AUDIT_DEPTH_OPTIONS = [
  { id: 'quick' as const, title: 'Quick Scan', description: 'Fast overview of top issues and wasted spend', modules: 6, estimatedMinutes: 8 },
  { id: 'standard' as const, title: 'Standard Audit', description: 'Recommended full forensic audit for your account', modules: 12, estimatedMinutes: 18 },
  { id: 'deep' as const, title: 'Deep Audit', description: 'Advanced forensic analysis with AI deep-dives', modules: 12, estimatedMinutes: 32 },
];

export const AUDIT_WINDOW_OPTIONS = [
  { value: 30 as const, label: 'Last 30 Days' },
  { value: 90 as const, label: 'Last 90 Days' },
  { value: 365 as const, label: 'Last 365 Days' },
];

export const WHAT_WE_ANALYZE = [
  'Campaign structure',
  'Budget waste',
  'Search terms',
  'Quality score',
  'Ad relevance',
  'Landing page alignment',
  'Audience targeting',
  'Device performance',
];
