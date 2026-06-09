import type { Finding, HealthScore, RoadmapItem, AuditModule } from '../types/index.js';
import { generateId } from '../services/mock-store.js';

export const AUDIT_MODULES: Omit<AuditModule, 'id' | 'status' | 'progress' | 'findingsCount'>[] = [
  { name: 'Campaign Architecture', slug: 'campaign', order: 1 },
  { name: 'Keyword Audit', slug: 'keyword', order: 2 },
  { name: 'Search Term Waste', slug: 'search-terms', order: 3 },
  { name: 'Quality Score Analysis', slug: 'quality-score', order: 4 },
  { name: 'Ad Copy Review (AI LLM)', slug: 'ad-copy', order: 5 },
  { name: 'Bidding Strategy Audit', slug: 'bidding', order: 6 },
  { name: 'Budget Efficiency', slug: 'budget', order: 7 },
  { name: 'Geo Targeting Audit', slug: 'geo', order: 8 },
  { name: 'Audience Audit', slug: 'audience', order: 9 },
  { name: 'Impression Share', slug: 'impression-share', order: 10 },
  { name: 'Landing Page Alignment', slug: 'landing-pages', order: 11 },
  { name: 'PMax Placements', slug: 'pmax', order: 12 },
];

export const MOCK_FINDINGS: Omit<Finding, 'id'>[] = [
  {
    severity: 'CRITICAL',
    title: 'Search term waste — 847 non-converting queries burning budget',
    description:
      'Analysis identified 847 search queries with zero conversions over 365 days, consuming $2,140/month in wasted spend. Top offenders include broad match terms triggering irrelevant searches.',
    recommendation: 'Build a comprehensive negative keyword list from the search term report. Switch high-spend broad match keywords to phrase or exact match.',
    confidence: 92,
    impactMonthly: 2140,
    evidence: { nonConvertingQueries: 847, wastedSpend: 2140, topWasteTerms: ['plumber jobs', 'diy plumbing', 'free quote template'] },
    category: 'SEARCH_TERMS',
    dimension: 'Search Term Waste',
    status: 'OPEN',
  },
  {
    severity: 'CRITICAL',
    title: 'Quality Score collapse on 23 high-volume keywords',
    description:
      '23 keywords with combined monthly spend of $3,400 have Quality Scores below 4, inflating CPCs by an estimated 40-60%. Landing page experience is the primary drag factor.',
    recommendation: 'Create dedicated landing pages for top 10 keywords. Improve ad relevance with tighter ad groups (max 5-10 keywords per group).',
    confidence: 88,
    impactMonthly: 980,
    evidence: { keywordsAffected: 23, avgQualityScore: 3.2, estimatedCpcInflation: '47%' },
    category: 'QUALITY_SCORE',
    dimension: 'Quality Score',
    status: 'OPEN',
  },
  {
    severity: 'CRITICAL',
    title: 'Smart Bidding on low-conversion campaigns',
    description:
      '4 campaigns using Target CPA with fewer than 15 conversions/month. Smart Bidding requires 30+ conversions/month for optimal performance.',
    recommendation: 'Switch to Maximize Conversions with target CPA cap, or revert to Manual CPC until conversion volume increases.',
    confidence: 85,
    impactMonthly: 720,
    evidence: { campaignsAffected: 4, avgMonthlyConversions: 8 },
    category: 'BIDDING',
    dimension: 'Bidding Strategy',
    status: 'OPEN',
  },
  {
    severity: 'CRITICAL',
    title: 'Budget capped on top-performing campaign',
    description:
      'Your highest ROAS campaign (Emergency Plumber - Search) is losing 34% impression share due to budget constraints.',
    recommendation: 'Increase daily budget by $45/day and monitor for 2 weeks. Consider budget reallocation from underperforming Display campaigns.',
    confidence: 91,
    impactMonthly: 540,
    evidence: { lostImpressionShareBudget: '34%', currentDailyBudget: 120, recommendedIncrease: 45 },
    category: 'BUDGET',
    dimension: 'Budget Efficiency',
    status: 'OPEN',
  },
  {
    severity: 'CRITICAL',
    title: 'Zero conversion tracking on 3 active campaigns',
    description:
      '3 campaigns totaling $1,800/month spend have broken or missing conversion tracking, making optimization impossible.',
    recommendation: 'Verify Google Ads conversion tags via Tag Assistant. Re-enable primary conversion actions.',
    confidence: 95,
    impactMonthly: 0,
    evidence: { campaignsAffected: 3, monthlySpendUntracked: 1800 },
    category: 'CAMPAIGN',
    dimension: 'Account Health',
    status: 'ACKNOWLEDGED',
  },
  {
    severity: 'HIGH',
    title: '14 RSA ad groups with "Poor" ad strength',
    description:
      '14 responsive search ad groups rated "Poor" or "Average" ad strength. Google recommends "Good" or "Excellent" for optimal auction performance.',
    recommendation: 'Add 2-3 more unique headlines and descriptions per RSA. Include keywords in headlines. Test pinning sparingly.',
    confidence: 82,
    impactMonthly: 380,
    evidence: { adGroupsAffected: 14, poorStrength: 9, averageStrength: 5 },
    category: 'AD_COPY',
    dimension: 'Ad Copy Review',
    status: 'OPEN',
  },
  {
    severity: 'HIGH',
    title: 'Geographic waste — 18% spend outside service area',
    description:
      'Location report shows $2,556/month spent on clicks from postcodes outside your defined service radius.',
    recommendation: 'Add location exclusions for non-service postcodes. Enable location bid adjustments for high-converting suburbs.',
    confidence: 87,
    impactMonthly: 510,
    evidence: { spendOutsideArea: 2556, percentageOfTotal: '18%' },
    category: 'GEO',
    dimension: 'Geographic',
    status: 'OPEN',
  },
  {
    severity: 'HIGH',
    title: 'No audience layering on Search campaigns',
    description:
      'Zero audience segments applied as observation layers on Search campaigns, missing remarketing and in-market targeting opportunities.',
    recommendation: 'Add website visitor remarketing lists and in-market audiences as observation layers with bid adjustments.',
    confidence: 78,
    impactMonthly: 290,
    evidence: { campaignsWithoutAudiences: 12 },
    category: 'AUDIENCES',
    dimension: 'Audiences',
    status: 'OPEN',
  },
  {
    severity: 'HIGH',
    title: 'Duplicate keywords across 6 ad groups',
    description:
      '47 keywords appear in multiple ad groups within the same campaign, causing internal competition and inflated CPCs.',
    recommendation: 'Consolidate duplicate keywords into single best-performing ad groups. Use negative keywords to prevent cross-group triggering.',
    confidence: 90,
    impactMonthly: 340,
    evidence: { duplicateKeywords: 47, adGroupsAffected: 6 },
    category: 'KEYWORDS',
    dimension: 'Keyword Analysis',
    status: 'OPEN',
  },
  {
    severity: 'HIGH',
    title: 'PMax brand cannibalization detected',
    description:
      'Performance Max campaign is capturing 62% of branded search traffic, inflating reported PMax ROAS while Search campaign impression share drops.',
    recommendation: 'Add brand terms as negative keywords in PMax. Create dedicated Brand Search campaign with exact match.',
    confidence: 84,
    impactMonthly: 420,
    evidence: { brandTrafficInPmax: '62%', brandCpcIncrease: '23%' },
    category: 'PMAX',
    dimension: 'PMax Placements',
    status: 'OPEN',
  },
  {
    severity: 'MEDIUM',
    title: 'Ad schedule misalignment with conversion patterns',
    description:
      'Campaigns run 24/7 but 78% of conversions occur between 7am-7pm weekdays. Off-hours spend shows 0.3% conversion rate vs 4.2% during business hours.',
    recommendation: 'Apply ad schedule bid adjustments: -50% overnight, +20% during peak conversion hours (10am-2pm).',
    confidence: 76,
    impactMonthly: 180,
    evidence: { offHoursConversionRate: '0.3%', peakConversionRate: '4.2%' },
    category: 'BIDDING',
    dimension: 'Bidding Strategy',
    status: 'OPEN',
  },
  {
    severity: 'MEDIUM',
    title: 'Landing page load time exceeds 4 seconds on mobile',
    description:
      'Mobile landing pages average 4.3s load time. Google recommends under 3 seconds. Estimated 12% conversion rate loss.',
    recommendation: 'Compress images, enable lazy loading, and consider AMP or a lightweight mobile landing page variant.',
    confidence: 71,
    impactMonthly: 220,
    evidence: { avgMobileLoadTime: '4.3s', estimatedConversionLoss: '12%' },
    category: 'LANDING_PAGES',
    dimension: 'Landing Pages',
    status: 'OPEN',
  },
  {
    severity: 'MEDIUM',
    title: 'Low impression share on competitor terms',
    description:
      'Competitor brand keywords show only 22% impression share despite strong ad relevance scores.',
    recommendation: 'Increase bids on top 5 competitor terms by 15-20%. Improve ad copy differentiation.',
    confidence: 68,
    impactMonthly: 150,
    evidence: { competitorImpressionShare: '22%', keywordsAffected: 8 },
    category: 'KEYWORDS',
    dimension: 'Keyword Analysis',
    status: 'OPEN',
  },
  {
    severity: 'LOW',
    title: 'Sitelink extensions missing on 4 campaigns',
    description:
      '4 active Search campaigns lack sitelink extensions, reducing ad real estate and CTR potential.',
    recommendation: 'Add 4-6 sitelinks per campaign linking to key service pages, reviews, and contact.',
    confidence: 65,
    impactMonthly: 80,
    evidence: { campaignsMissingSitelinks: 4 },
    category: 'AD_COPY',
    dimension: 'Ad Copy Review',
    status: 'OPEN',
  },
  {
    severity: 'LOW',
    title: 'Call extension hours not synced with business hours',
    description:
      'Call extensions show as active 24/7 but business operates Mon-Fri 7am-6pm only.',
    recommendation: 'Update call extension schedule to match business hours. Add call reporting.',
    confidence: 70,
    impactMonthly: 40,
    evidence: { missedCallsEstimate: 12 },
    category: 'CAMPAIGN',
    dimension: 'Account Health',
    status: 'OPEN',
  },
];

export function createMockFindings(count = 31): Finding[] {
  const findings: Finding[] = [];
  for (let i = 0; i < count; i++) {
    const template = MOCK_FINDINGS[i % MOCK_FINDINGS.length];
    findings.push({
      ...template,
      id: generateId('fnd_'),
      title: i >= MOCK_FINDINGS.length ? `${template.title} (variant ${Math.floor(i / MOCK_FINDINGS.length) + 1})` : template.title,
      impactMonthly: Math.round(template.impactMonthly * (0.8 + Math.random() * 0.4)),
    });
  }
  return findings.sort((a, b) => b.impactMonthly - a.impactMonthly);
}

export const MOCK_HEALTH_SCORES: HealthScore[] = [
  { dimension: 'Waste Rate', score: 22, label: 'Critical' },
  { dimension: 'Quality Score', score: 41, label: 'Below Average' },
  { dimension: 'Bidding Health', score: 35, label: 'Poor' },
  { dimension: 'Audience Coverage', score: 48, label: 'Fair' },
  { dimension: 'Budget Efficiency', score: 52, label: 'Fair' },
];

export function createMockRoadmap(): RoadmapItem[] {
  return [
    { id: generateId('rm_'), phase: 'DAY_30', order: 1, title: 'Build negative keyword list from 847 waste terms', effort: 'LOW', owner: 'CLIENT', impactMonthly: 2140 },
    { id: generateId('rm_'), phase: 'DAY_30', order: 2, title: 'Fix conversion tracking on 3 campaigns', effort: 'LOW', owner: 'CLIENT', impactMonthly: 0 },
    { id: generateId('rm_'), phase: 'DAY_30', order: 3, title: 'Increase budget on top ROAS campaign', effort: 'LOW', owner: 'CLIENT', impactMonthly: 540 },
    { id: generateId('rm_'), phase: 'DAY_30', order: 4, title: 'Add geo exclusions for non-service areas', effort: 'LOW', owner: 'CLIENT', impactMonthly: 510 },
    { id: generateId('rm_'), phase: 'DAY_30', order: 5, title: 'Switch low-volume Smart Bidding to Manual CPC', effort: 'MEDIUM', owner: 'AGENCY', impactMonthly: 720 },
    { id: generateId('rm_'), phase: 'DAY_60', order: 6, title: 'Rewrite 14 RSA ad groups to Good/Excellent strength', effort: 'MEDIUM', owner: 'AGENCY', impactMonthly: 380 },
    { id: generateId('rm_'), phase: 'DAY_60', order: 7, title: 'Create dedicated landing pages for top 10 keywords', effort: 'HIGH', owner: 'AGENCY', impactMonthly: 980 },
    { id: generateId('rm_'), phase: 'DAY_60', order: 8, title: 'Add audience observation layers to Search campaigns', effort: 'MEDIUM', owner: 'AGENCY', impactMonthly: 290 },
    { id: generateId('rm_'), phase: 'DAY_60', order: 9, title: 'Consolidate 47 duplicate keywords', effort: 'MEDIUM', owner: 'CLIENT', impactMonthly: 340 },
    { id: generateId('rm_'), phase: 'DAY_90', order: 10, title: 'Build dedicated Brand Search campaign', effort: 'MEDIUM', owner: 'AGENCY', impactMonthly: 420 },
    { id: generateId('rm_'), phase: 'DAY_90', order: 11, title: 'Optimize mobile landing page performance', effort: 'HIGH', owner: 'AGENCY', impactMonthly: 220 },
    { id: generateId('rm_'), phase: 'DAY_90', order: 12, title: 'Implement ad schedule bid adjustments', effort: 'LOW', owner: 'CLIENT', impactMonthly: 180 },
    { id: generateId('rm_'), phase: 'DAY_90', order: 13, title: 'Launch PMax with brand exclusions', effort: 'HIGH', owner: 'AGENCY', impactMonthly: 380 },
  ];
}

export const MOCK_EXECUTIVE_SUMMARY = `This comprehensive audit of the Acme Plumbing AU Google Ads account reveals significant opportunities to recover wasted spend and improve campaign efficiency. Our AI-powered analysis across 12 audit modules identified 31 actionable findings with an estimated monthly financial impact of $4,820 — representing $57,840 in annual recoverable opportunity.

The account's overall health score of 38/100 indicates below-average performance relative to industry benchmarks for local service businesses. The most critical issues center around search term waste ($2,140/mo), quality score deficiencies affecting 23 high-volume keywords, and smart bidding misconfiguration on low-conversion campaigns.

Immediate action on the 30-day sprint items — particularly negative keyword implementation and conversion tracking fixes — could recover over $2,600/month within the first month. The 60-day optimization phase focuses on ad copy improvements and landing page alignment, while the 90-day scale phase positions the account for sustainable growth through brand protection and Performance Max optimization.`;

export const DEFAULT_ACCOUNT = {
  name: 'Acme Plumbing AU',
  monthlySpend: 14200,
  campaignCount: 18,
  websiteUrl: 'https://acmeplumbing.com.au',
  goal: 'Lead generation',
};
