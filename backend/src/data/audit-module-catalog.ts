export interface AuditModuleCatalogItem {
  id: string;
  name: string;
  description: string;
  icon: string;
  quickDefault: boolean;
}

export const AUDIT_MODULE_CATALOG: AuditModuleCatalogItem[] = [
  { id: 'campaign', name: 'Campaign Structure', description: 'Architecture, naming, and campaign type analysis', icon: 'layers', quickDefault: true },
  { id: 'keyword', name: 'Keyword Audit', description: 'Match types, duplicates, and relevance scoring', icon: 'search', quickDefault: true },
  { id: 'search-terms', name: 'Search Term Waste', description: 'Non-converting queries and negative keyword gaps', icon: 'target', quickDefault: true },
  { id: 'budget', name: 'Budget Analysis', description: 'Allocation, capped campaigns, and spend pacing', icon: 'dollar', quickDefault: true },
  { id: 'geo', name: 'Geo Analysis', description: 'Location targeting and geographic waste', icon: 'map', quickDefault: false },
  { id: 'audience', name: 'Audience Analysis', description: 'Remarketing, in-market, and observation layers', icon: 'users', quickDefault: false },
  { id: 'ad-copy', name: 'Ad Copy Analysis', description: 'RSA strength, messaging gaps, and AI review', icon: 'file', quickDefault: true },
  { id: 'landing-pages', name: 'Landing Page Analysis', description: 'Speed, relevance, and conversion path alignment', icon: 'layout', quickDefault: false },
  { id: 'bidding', name: 'Bidding Analysis', description: 'Smart bidding readiness and bid adjustments', icon: 'trending', quickDefault: false },
  { id: 'conversion', name: 'Conversion Tracking Audit', description: 'Tag health, attribution, and goal setup', icon: 'activity', quickDefault: true },
  { id: 'quality-score', name: 'Quality Score Audit', description: 'QS breakdown by keyword and landing page', icon: 'bar', quickDefault: false },
  { id: 'device', name: 'Device Performance Audit', description: 'Mobile vs desktop performance gaps', icon: 'smartphone', quickDefault: false },
];

export const QUICK_MODULE_IDS = AUDIT_MODULE_CATALOG.filter((m) => m.quickDefault).map((m) => m.id);

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
