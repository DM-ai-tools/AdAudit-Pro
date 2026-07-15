import { useMemo, useState, type ReactNode } from 'react';
import { ExternalLink } from 'lucide-react';
import clsx from 'clsx';
import { CompetitorBrandReviewBlock } from './CompetitorBrandMetrics';
import type {
  CompetitorIntelligenceData,
  CompetitorBrandAuthority,
  CompetitorAdvertisingStrength,
  CompetitorMarketAuthority,
  CompetitorOfferTrustAnalysis,
  CompetitorAiLearning,
  CompetitorSocialPresence,
  CompetitorBrandReview,
} from '../../types/optimization';

type SortKey =
  | 'learning'
  | 'confidence'
  | 'duration'
  | 'active'
  | 'authority'
  | 'advertising'
  | 'threat';

type DashTab =
  | 'overview'
  | 'ads'
  | 'brand'
  | 'reviews'
  | 'social'
  | 'market'
  | 'offers'
  | 'learning';

const SORT_OPTIONS: Array<{ key: SortKey; label: string }> = [
  { key: 'learning', label: 'Highest AI Learning Value' },
  { key: 'confidence', label: 'Highest Confidence Score' },
  { key: 'duration', label: 'Longest Ad Duration' },
  { key: 'active', label: 'Most Active Ads' },
  { key: 'authority', label: 'Highest Brand Authority' },
  { key: 'advertising', label: 'Highest Advertising Score' },
  { key: 'threat', label: 'Highest Competitive Threat' },
];

const TABS: Array<{ key: DashTab; label: string }> = [
  { key: 'overview', label: 'Overview' },
  { key: 'ads', label: 'Ads' },
  { key: 'brand', label: 'Brand Authority' },
  { key: 'reviews', label: 'Reviews' },
  { key: 'social', label: 'Social Presence' },
  { key: 'market', label: 'Market Authority' },
  { key: 'offers', label: 'Offers & Trust' },
  { key: 'learning', label: 'AI Learning' },
];

function hostFromUrl(url?: string): string {
  if (!url) return '';
  try {
    return new URL(url.startsWith('http') ? url : `https://${url}`).hostname.replace(/^www\./, '');
  } catch {
    return url.replace(/^https?:\/\//, '').split('/')[0] ?? url;
  }
}

function advertiserIdFromUrl(url?: string): string | undefined {
  if (!url) return undefined;
  const m = url.match(/advertiser\/(AR[\w-]+)/i);
  return m?.[1];
}

/** Prefer advertiser id / name so Transparency-host rivals don't collapse into one card. */
function dashboardCompetitorKey(opts: {
  name: string;
  url?: string;
  advertiserId?: string;
}): string {
  const adv = opts.advertiserId?.trim() || advertiserIdFromUrl(opts.url);
  if (adv) return `adv:${adv.toLowerCase()}`;
  const host = hostFromUrl(opts.url).toLowerCase();
  if (host && !/adstransparency\.google\.com$/i.test(host)) return `host:${host}`;
  return `name:${opts.name.trim().toLowerCase()}`;
}

function preferLibraryStat(a?: number, b?: number): number {
  if (a != null && a > 0) return a;
  if (b != null && b > 0) return b;
  return a ?? b ?? 0;
}

function formatDays(days: number): string {
  if (!days) return 'Not available';
  return `${days.toLocaleString('en-US')} Days`;
}

function formatNum(n?: number | null, fallback = '—'): string {
  if (n == null || Number.isNaN(n)) return fallback;
  return n.toLocaleString('en-US');
}

function formatScore(n?: number | null, max = 100): string {
  if (n == null) return '—';
  return `${n}/${max}`;
}

interface DashboardCard {
  name: string;
  url: string;
  advertiserId?: string;
  confidenceScore: number;
  influencePercent: number;
  adDurationDays: number;
  activeAdCount: number;
  totalAdCount: number;
  durationLabel?: string;
  industryMatch?: number;
  serviceMatch?: number;
  brandRating?: number;
  reviewCount?: number;
  trustScore?: number;
  brandAuthorityScore?: number;
  advertisingScore?: number;
  aiLearningValue?: number;
  marketPosition?: string;
  competitiveThreat?: string;
  socialPresence?: CompetitorSocialPresence;
  brandAuthority?: CompetitorBrandAuthority;
  advertisingStrength?: CompetitorAdvertisingStrength;
  marketAuthority?: CompetitorMarketAuthority;
  offerTrustAnalysis?: CompetitorOfferTrustAnalysis;
  aiLearning?: CompetitorAiLearning;
  brandReview?: CompetitorBrandReview;
  headlines?: string[];
  descriptions?: string[];
  offers?: string[];
  keywords?: string[];
}

function buildCards(data: CompetitorIntelligenceData): DashboardCard[] {
  const byKey = new Map<string, DashboardCard>();

  const upsert = (
    partial: Partial<DashboardCard> & { name: string; url?: string; advertiserId?: string }
  ) => {
    const key = dashboardCompetitorKey({
      name: partial.name,
      url: partial.url,
      advertiserId: partial.advertiserId,
    });
    const prev = byKey.get(key);
    // Prefer real SociaVault numbers — never let an explicit 0 wipe a positive prior value
    byKey.set(key, {
      name: partial.name || prev?.name || 'Competitor',
      url: partial.url || prev?.url || '',
      advertiserId: partial.advertiserId || prev?.advertiserId,
      confidenceScore: preferLibraryStat(partial.confidenceScore, prev?.confidenceScore),
      influencePercent: preferLibraryStat(partial.influencePercent, prev?.influencePercent),
      adDurationDays: preferLibraryStat(partial.adDurationDays, prev?.adDurationDays),
      activeAdCount: preferLibraryStat(partial.activeAdCount, prev?.activeAdCount),
      totalAdCount: preferLibraryStat(partial.totalAdCount, prev?.totalAdCount),
      durationLabel: partial.durationLabel || prev?.durationLabel,
      industryMatch: preferLibraryStat(partial.industryMatch, prev?.industryMatch) || undefined,
      serviceMatch: preferLibraryStat(partial.serviceMatch, prev?.serviceMatch) || undefined,
      brandRating: preferLibraryStat(partial.brandRating, prev?.brandRating) || undefined,
      reviewCount: preferLibraryStat(partial.reviewCount, prev?.reviewCount) || undefined,
      trustScore: preferLibraryStat(partial.trustScore, prev?.trustScore) || undefined,
      brandAuthorityScore:
        preferLibraryStat(partial.brandAuthorityScore, prev?.brandAuthorityScore) || undefined,
      advertisingScore:
        preferLibraryStat(partial.advertisingScore, prev?.advertisingScore) || undefined,
      aiLearningValue:
        preferLibraryStat(partial.aiLearningValue, prev?.aiLearningValue) || undefined,
      marketPosition: partial.marketPosition ?? prev?.marketPosition,
      competitiveThreat: partial.competitiveThreat ?? prev?.competitiveThreat,
      socialPresence: partial.socialPresence ?? prev?.socialPresence,
      brandAuthority: partial.brandAuthority ?? prev?.brandAuthority,
      advertisingStrength: partial.advertisingStrength ?? prev?.advertisingStrength,
      marketAuthority: partial.marketAuthority ?? prev?.marketAuthority,
      offerTrustAnalysis: partial.offerTrustAnalysis ?? prev?.offerTrustAnalysis,
      aiLearning: partial.aiLearning ?? prev?.aiLearning,
      brandReview: partial.brandReview ?? prev?.brandReview,
      headlines: partial.headlines ?? prev?.headlines,
      descriptions: partial.descriptions ?? prev?.descriptions,
      offers: partial.offers ?? prev?.offers,
      keywords: partial.keywords ?? prev?.keywords,
    });
  };

  for (const c of data.competitors ?? []) {
    upsert({
      name: c.name,
      url: c.url,
      advertiserId: c.advertiserId,
      confidenceScore: c.confidenceScore,
      influencePercent: c.influencePercent,
      adDurationDays: c.adDurationDays,
      activeAdCount: c.activeAdCount,
      totalAdCount: c.totalAdCount,
      durationLabel: c.durationLabel,
      industryMatch: c.industryMatch,
      serviceMatch: c.serviceMatch,
      brandRating: c.brandReview?.averageRating,
      reviewCount: c.brandReview?.reviewCount,
      trustScore: c.brandReview?.trustScore ?? c.brandReview?.score,
      brandAuthorityScore: c.brandAuthorityScore ?? c.brandAuthority?.brandAuthorityScore,
      advertisingScore: c.advertisingScore ?? c.advertisingStrength?.advertisingScore,
      aiLearningValue: c.aiLearningValue ?? c.aiLearning?.aiLearningValue,
      marketPosition: c.marketPosition ?? c.brandAuthority?.marketPosition,
      competitiveThreat: c.competitiveThreat ?? c.brandAuthority?.competitiveThreat,
      socialPresence: c.socialPresence,
      brandAuthority: c.brandAuthority,
      advertisingStrength: c.advertisingStrength,
      marketAuthority: c.marketAuthority,
      offerTrustAnalysis: c.offerTrustAnalysis,
      aiLearning: c.aiLearning,
      brandReview: c.brandReview,
      headlines: c.headlines,
      descriptions: c.descriptions,
      offers: c.offers,
      keywords: undefined,
    });
  }

  for (const g of data.adGallery ?? []) {
    upsert({
      name: g.advertiserName ?? g.name,
      url: g.destinationUrl ?? g.url,
      advertiserId: g.advertiserId,
      confidenceScore: g.confidenceScore,
      influencePercent: g.influencePercent,
      adDurationDays: g.adDurationDays,
      activeAdCount: g.activeAdCount,
      totalAdCount: g.totalAdCount,
      durationLabel: g.durationLabel,
      industryMatch: g.industryMatch,
      serviceMatch: g.serviceMatch,
      brandRating: g.brandReview?.averageRating,
      reviewCount: g.brandReview?.reviewCount,
      trustScore: g.brandReview?.trustScore ?? g.brandReview?.score,
      brandAuthorityScore: g.brandAuthorityScore ?? g.brandAuthority?.brandAuthorityScore,
      advertisingScore: g.advertisingScore ?? g.advertisingStrength?.advertisingScore,
      aiLearningValue: g.aiLearningValue ?? g.aiLearning?.aiLearningValue,
      marketPosition: g.marketPosition ?? g.brandAuthority?.marketPosition,
      competitiveThreat: g.competitiveThreat ?? g.brandAuthority?.competitiveThreat,
      socialPresence: g.socialPresence,
      brandAuthority: g.brandAuthority,
      advertisingStrength: g.advertisingStrength,
      marketAuthority: g.marketAuthority,
      offerTrustAnalysis: g.offerTrustAnalysis,
      aiLearning: g.aiLearning,
      brandReview: g.brandReview,
      headlines: g.headlines,
      descriptions: g.descriptions,
      offers: g.offers,
    });
  }

  for (const w of data.influenceWeights ?? []) {
    const existing = [...byKey.values()].find((c) => c.name.toLowerCase() === w.name.toLowerCase());
    if (existing) {
      existing.influencePercent = w.influencePercent || existing.influencePercent;
      existing.confidenceScore = w.score || existing.confidenceScore;
      if (w.aiLearningValue != null) existing.aiLearningValue = w.aiLearningValue;
    }
  }

  const all = [...byKey.values()];
  // Prefer library-backed rivals, but never hide the section when profiles exist
  const withAds = all.filter(
    (c) =>
      (c.totalAdCount ?? 0) > 0 ||
      (c.adDurationDays ?? 0) > 0 ||
      (c.confidenceScore ?? 0) > 0 ||
      (c.headlines?.length ?? 0) > 0
  );
  return withAds.length ? withAds : all;
}

function sortCards(cards: DashboardCard[], sortKey: SortKey): DashboardCard[] {
  const sorted = [...cards];
  sorted.sort((a, b) => {
    switch (sortKey) {
      case 'duration':
        return b.adDurationDays - a.adDurationDays;
      case 'active':
        return b.activeAdCount - a.activeAdCount;
      case 'authority':
        return (b.brandAuthorityScore ?? 0) - (a.brandAuthorityScore ?? 0);
      case 'advertising':
        return (b.advertisingScore ?? 0) - (a.advertisingScore ?? 0);
      case 'threat':
        return (
          (b.brandAuthority?.competitiveThreatScore ?? 0) -
          (a.brandAuthority?.competitiveThreatScore ?? 0)
        );
      case 'confidence':
        return b.confidenceScore - a.confidenceScore;
      case 'learning':
      default:
        return (
          (b.aiLearningValue ?? 0) - (a.aiLearningValue ?? 0) ||
          b.influencePercent - a.influencePercent
        );
    }
  });
  return sorted;
}

/** Ensure every tab has payloads — synthesize from flat metrics when nested objects are missing. */
function hydrateCardSections(card: DashboardCard): DashboardCard {
  const adDurationDays = card.adDurationDays ?? 0;
  const activeAdCount = card.activeAdCount ?? 0;
  const totalAdCount = card.totalAdCount ?? 0;
  const brandAuthorityScore = card.brandAuthorityScore ?? card.brandAuthority?.brandAuthorityScore ?? card.confidenceScore ?? 0;
  const advertisingScore =
    card.advertisingScore ??
    card.advertisingStrength?.advertisingScore ??
    Math.min(
      100,
      Math.round(
        Math.min(40, (adDurationDays / 730) * 40) +
          Math.min(35, (activeAdCount / 50) * 35) +
          Math.min(25, (totalAdCount / 200) * 25)
      )
    );
  const trustScore = card.trustScore ?? card.brandReview?.trustScore ?? card.brandReview?.score ?? 50;
  const aiLearningValue = card.aiLearningValue ?? card.aiLearning?.aiLearningValue ?? brandAuthorityScore;

  const brandAuthority: CompetitorBrandAuthority =
    card.brandAuthority ??
    ({
      employeeCount: card.socialPresence?.employeeCount,
      employeeCountEstimated: true,
      companySize:
        advertisingScore >= 75 ? 'Enterprise' : advertisingScore >= 50 ? 'Mid-Market' : advertisingScore >= 25 ? 'SMB' : 'Startup',
      yearsInBusiness: Math.max(1, Math.round(adDurationDays / 365)),
      yearsInBusinessEstimated: true,
      brandAuthorityScore,
      marketPosition: (card.marketPosition as CompetitorBrandAuthority['marketPosition']) ?? 'Emerging Competitor',
      competitiveThreat: (card.competitiveThreat as CompetitorBrandAuthority['competitiveThreat']) ?? 'Medium',
      brandStrengthScore: brandAuthorityScore,
      competitiveThreatScore: Math.min(100, Math.round(brandAuthorityScore * 0.6 + advertisingScore * 0.4)),
    } satisfies CompetitorBrandAuthority);

  const advertisingStrength: CompetitorAdvertisingStrength = card.advertisingStrength ?? {
    adDurationDays,
    activeAdCount,
    totalAdCount,
    advertisingScore,
  };

  const marketAuthority: CompetitorMarketAuthority = card.marketAuthority ?? {
    authorityScore: Math.min(100, Math.round(advertisingScore * 0.4 + brandAuthorityScore * 0.35 + trustScore * 0.25)),
    source: 'unavailable',
  };

  const offerTrustAnalysis: CompetitorOfferTrustAnalysis = card.offerTrustAnalysis ?? {
    offersUsed: card.offers ?? [],
    topPromotions: (card.offers ?? []).slice(0, 3),
    uniqueSellingPoints: (card.headlines ?? []).slice(0, 3),
    trustSignals: card.brandReview?.strengths?.slice(0, 4) ?? [],
    trustSignalScore: trustScore,
    socialProofItems: card.brandReview?.positiveThemes?.slice(0, 3) ?? [],
    socialProofScore: Math.min(100, trustScore),
  };

  const socialPresence: CompetitorSocialPresence = card.socialPresence ?? {
    brandAuthorityScore,
    socialPresenceScore: Math.min(100, Math.round(brandAuthorityScore * 0.7)),
    source: 'unavailable',
  };

  const aiLearning: CompetitorAiLearning =
    card.aiLearning ??
    ({
      aiLearningValue,
      competitorScore: card.confidenceScore,
      influencePercent: card.influencePercent,
      breakdown: {
        adDuration: Math.min(100, Math.round((adDurationDays / 730) * 100)),
        activeAds: Math.min(100, Math.round((activeAdCount / 40) * 100)),
        totalAds: Math.min(100, Math.round((totalAdCount / 100) * 100)),
        brandReviews: trustScore,
        trustScore,
        employeeCount: socialPresence.employeeCount != null ? Math.min(100, socialPresence.employeeCount / 5) : 40,
        socialPresence: socialPresence.socialPresenceScore ?? 40,
        authorityScore: marketAuthority.authorityScore,
        marketPosition: brandAuthorityScore,
      },
    } satisfies CompetitorAiLearning);

  const brandReview = card.brandReview
    ? {
        ...card.brandReview,
        positiveThemes:
          card.brandReview.positiveThemes?.length
            ? card.brandReview.positiveThemes
            : card.brandReview.strengths?.slice(0, 4) ?? [],
        negativeThemes:
          card.brandReview.negativeThemes?.length
            ? card.brandReview.negativeThemes
            : card.brandReview.weaknesses?.slice(0, 3) ?? [],
        reviewVelocity:
          card.brandReview.reviewVelocity ??
          (activeAdCount >= 8
            ? 'High — frequent creative rotations'
            : activeAdCount >= 3
              ? 'Steady — regular ad testing'
              : activeAdCount >= 1
                ? 'Light — limited recent creative changes'
                : 'Low — little recent ad activity'),
      }
    : card.brandReview;

  return {
    ...card,
    brandAuthorityScore,
    advertisingScore,
    aiLearningValue,
    trustScore,
    marketPosition: card.marketPosition ?? brandAuthority.marketPosition,
    competitiveThreat: card.competitiveThreat ?? brandAuthority.competitiveThreat,
    brandAuthority,
    advertisingStrength,
    marketAuthority,
    offerTrustAnalysis,
    socialPresence,
    aiLearning,
    brandReview,
  };
}

function MetricTile({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-white/5 px-2.5 py-2">
      <p className="text-muted text-[10px] uppercase tracking-wider">{label}</p>
      <p className={clsx('text-sm font-medium mt-0.5', accent ? 'text-teal' : 'text-white')}>
        {value}
      </p>
    </div>
  );
}

function CheckList({
  items,
  variant,
}: {
  items: string[];
  variant: 'love' | 'dislike' | 'ok';
}) {
  if (!items.length) {
    return <p className="text-muted text-[11px]">No themes extracted yet.</p>;
  }
  const mark = variant === 'dislike' ? '✗' : '✓';
  const color =
    variant === 'dislike' ? 'text-rose-300' : variant === 'love' ? 'text-emerald-300' : 'text-teal';
  return (
    <ul className="space-y-1">
      {items.map((item, i) => (
        <li key={`${i}-${item.slice(0, 48)}`} className={clsx('text-[11px] text-white/90', color)}>
          {mark} {item}
        </li>
      ))}
    </ul>
  );
}

function CompetitorCardShell({
  card,
  children,
}: {
  card: DashboardCard;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-navy/40 p-3 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-white text-sm font-semibold truncate">{card.name}</p>
              {card.url && (
            <a
              href={card.url.startsWith('http') ? card.url : `https://${card.url}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-teal text-[11px] hover:underline inline-flex items-center gap-1 mt-0.5 break-all"
            >
              {/adstransparency\.google\.com/i.test(card.url)
                ? 'Google Ads Transparency profile'
                : hostFromUrl(card.url) || card.url}
              <ExternalLink size={11} className="shrink-0" />
            </a>
          )}
          {(card.marketPosition || card.competitiveThreat) && (
            <p className="text-[10px] text-muted mt-1">
              {card.marketPosition}
              {card.marketPosition && card.competitiveThreat ? ' · ' : ''}
              {card.competitiveThreat ? `Threat: ${card.competitiveThreat}` : ''}
            </p>
          )}
        </div>
        <div className="text-right shrink-0 space-y-1">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted">AI Learning</p>
            <p className="text-teal text-lg font-semibold leading-none">
              {formatScore(card.aiLearningValue ?? card.aiLearning?.aiLearningValue)}
            </p>
          </div>
          {card.influencePercent > 0 && (
            <p className="text-[10px] text-purple-300">{card.influencePercent}% Claude influence</p>
          )}
        </div>
      </div>
      {children}
    </div>
  );
}

function OverviewTab({ card }: { card: DashboardCard }) {
  const ba = card.brandAuthority;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        <MetricTile label="Confidence" value={formatScore(card.confidenceScore)} accent />
        <MetricTile
          label="AI Learning Value"
          value={formatScore(card.aiLearningValue ?? card.aiLearning?.aiLearningValue)}
          accent
        />
        <MetricTile label="Claude Influence" value={`${card.influencePercent}%`} accent />
        <MetricTile
          label="Brand Authority"
          value={formatScore(card.brandAuthorityScore ?? ba?.brandAuthorityScore)}
        />
        <MetricTile
          label="Advertising Score"
          value={formatScore(card.advertisingScore ?? card.advertisingStrength?.advertisingScore)}
        />
        <MetricTile label="Trust Score" value={formatScore(card.trustScore)} />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <MetricTile label="Ad Duration" value={formatDays(card.adDurationDays)} />
        <MetricTile label="Active Ads" value={formatNum(card.activeAdCount)} />
        <MetricTile label="Total Ads" value={formatNum(card.totalAdCount)} />
      </div>
      {card.durationLabel && (
        <span className="text-[10px] px-2 py-0.5 rounded-full border border-teal/30 text-teal bg-teal/5 inline-block">
          {card.durationLabel}
        </span>
      )}
    </div>
  );
}

function AdsTab({ card }: { card: DashboardCard }) {
  const ads = card.advertisingStrength;
  return (
    <div className="space-y-3">
      <p className="text-[10px] uppercase tracking-wider text-purple-300">Advertising Strength</p>
      <div className="grid grid-cols-2 gap-2">
        <MetricTile label="Ad Duration" value={formatDays(ads?.adDurationDays ?? card.adDurationDays)} />
        <MetricTile label="Active Ads" value={formatNum(ads?.activeAdCount ?? card.activeAdCount)} />
        <MetricTile label="Total Ads" value={formatNum(ads?.totalAdCount ?? card.totalAdCount)} />
        <MetricTile
          label="Advertising Score"
          value={formatScore(ads?.advertisingScore ?? card.advertisingScore)}
          accent
        />
      </div>
      {card.headlines?.length ? (
        <div>
          <p className="text-muted text-[10px] uppercase tracking-wider mb-1">Sample headlines</p>
          <ul className="text-[11px] text-white/90 space-y-0.5">
            {card.headlines.slice(0, 4).map((h, i) => (
              <li key={`${i}-${h.slice(0, 40)}`}>• {h}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {card.descriptions?.length ? (
        <div>
          <p className="text-muted text-[10px] uppercase tracking-wider mb-1">Sample descriptions</p>
          <ul className="text-[11px] text-white/90 space-y-0.5">
            {card.descriptions.slice(0, 2).map((d, i) => (
              <li key={`${i}-${d.slice(0, 40)}`}>• {d}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {card.durationLabel && (
        <span className="text-[10px] px-2 py-0.5 rounded-full border border-teal/30 text-teal bg-teal/5 inline-block">
          {card.durationLabel}
        </span>
      )}
    </div>
  );
}

function BrandTab({ card }: { card: DashboardCard }) {
  const ba = card.brandAuthority;
  return (
    <div className="space-y-3">
      <p className="text-[10px] uppercase tracking-wider text-purple-300">Brand Authority</p>
      <div className="grid grid-cols-2 gap-2">
        <MetricTile
          label="Employees"
          value={
            ba?.employeeCount != null
              ? `${formatNum(ba.employeeCount)}${ba.employeeCountEstimated ? ' (est.)' : ''}`
              : '—'
          }
        />
        <MetricTile label="Company Size" value={ba?.companySize ?? '—'} />
        <MetricTile
          label="Years In Business"
          value={
            ba?.yearsInBusiness != null
              ? `${ba.yearsInBusiness}${ba.yearsInBusinessEstimated ? ' (est.)' : ''}`
              : '—'
          }
        />
        <MetricTile
          label="Brand Authority Score"
          value={formatScore(ba?.brandAuthorityScore ?? card.brandAuthorityScore)}
          accent
        />
        <MetricTile label="Market Position" value={ba?.marketPosition ?? card.marketPosition ?? '—'} />
        <MetricTile
          label="Competitive Threat"
          value={ba?.competitiveThreat ?? card.competitiveThreat ?? '—'}
          accent
        />
        <MetricTile label="Brand Strength" value={formatScore(ba?.brandStrengthScore)} />
        <MetricTile label="Threat Score" value={formatScore(ba?.competitiveThreatScore)} />
      </div>
    </div>
  );
}

function ReviewsTab({ card }: { card: DashboardCard }) {
  const r = card.brandReview;
  return (
    <div className="space-y-3">
      <p className="text-[10px] uppercase tracking-wider text-purple-300">Review Intelligence</p>
      <div className="grid grid-cols-2 gap-2">
        <MetricTile
          label="Verified Rating"
          value={r?.averageRating != null ? `${r.averageRating}/5` : '—'}
        />
        <MetricTile
          label="Brand Score"
          value={r?.score != null ? formatScore(r.score) : '—'}
          accent
        />
        <MetricTile
          label="Review Count"
          value={r?.reviewCount != null && r.reviewCount > 0 ? formatNum(r.reviewCount) : '—'}
        />
        <MetricTile label="Review Velocity" value={r?.reviewVelocity ?? '—'} />
        <MetricTile label="Ad Trust Score" value={formatScore(r?.trustScore ?? card.trustScore)} accent />
        <MetricTile label="Customer Sentiment" value={r?.sentiment ?? '—'} />
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="rounded-lg border border-border/60 bg-white/5 p-2.5">
          <p className="text-muted text-[10px] uppercase tracking-wider mb-1.5">Customers Love</p>
          <CheckList
            items={
              r?.positiveThemes?.length
                ? r.positiveThemes
                : r?.strengths?.slice(0, 4) ?? []
            }
            variant="love"
          />
        </div>
        <div className="rounded-lg border border-border/60 bg-white/5 p-2.5">
          <p className="text-muted text-[10px] uppercase tracking-wider mb-1.5">Customers Dislike</p>
          <CheckList
            items={
              r?.negativeThemes?.length
                ? r.negativeThemes
                : r?.weaknesses?.slice(0, 3) ?? []
            }
            variant="dislike"
          />
        </div>
      </div>
      {r?.howToBeat?.length ? (
        <div className="rounded-lg border border-border/60 bg-white/5 p-2.5">
          <p className="text-muted text-[10px] uppercase tracking-wider mb-1.5">How to beat them</p>
          <CheckList items={r.howToBeat.slice(0, 4)} variant="ok" />
        </div>
      ) : null}
      {r && <CompetitorBrandReviewBlock review={r} expanded={false} />}
    </div>
  );
}

function SocialTab({ card }: { card: DashboardCard }) {
  const s = card.socialPresence;
  const urls = s?.profileUrls;
  const hasFollowers = Boolean(
    s?.linkedInFollowers ||
      s?.facebookFollowers ||
      s?.instagramFollowers ||
      s?.youtubeSubscribers ||
      s?.tiktokFollowers ||
      s?.twitterFollowers
  );
  const hasUrls = Boolean(
    urls?.linkedin || urls?.facebook || urls?.instagram || urls?.youtube || urls?.tiktok || urls?.twitter
  );

  return (
    <div className="space-y-3">
      <p className="text-[10px] uppercase tracking-wider text-purple-300">Social Media Presence</p>
      {s?.source === 'sociavault_social_profiles' && hasFollowers ? (
        <p className="text-[11px] text-emerald-300/90">
          Live follower metrics via SociaVault (profile URLs from website crawl + Google discovery)
        </p>
      ) : hasUrls && !hasFollowers ? (
        <p className="text-[11px] text-amber-300/90">
          Social profile URLs found — follower fetch pending or unavailable for one or more
          platforms.
        </p>
      ) : (
        <p className="text-[11px] text-muted">
          Resolving social profiles from the competitor website and public search. If still empty
          after a fresh Make It Better run, the brand may not have public profiles.
        </p>
      )}
      <div className="grid grid-cols-2 gap-2">
        <MetricTile label="LinkedIn" value={formatNum(s?.linkedInFollowers)} />
        <MetricTile label="Facebook" value={formatNum(s?.facebookFollowers)} />
        <MetricTile label="Instagram" value={formatNum(s?.instagramFollowers)} />
        <MetricTile label="YouTube" value={formatNum(s?.youtubeSubscribers)} />
        <MetricTile label="TikTok" value={formatNum(s?.tiktokFollowers)} />
        <MetricTile label="X / Twitter" value={formatNum(s?.twitterFollowers)} />
        <MetricTile label="Total Social Reach" value={formatNum(s?.totalSocialReach)} />
        <MetricTile
          label="Social Presence Score"
          value={formatScore(s?.socialPresenceScore)}
          accent
        />
      </div>
      {hasUrls && (
        <div className="rounded-lg border border-border/60 bg-white/5 p-2.5 space-y-1">
          <p className="text-muted text-[10px] uppercase tracking-wider mb-1">Profile URLs</p>
          {(
            [
              ['LinkedIn', urls?.linkedin],
              ['Facebook', urls?.facebook],
              ['Instagram', urls?.instagram],
              ['YouTube', urls?.youtube],
              ['TikTok', urls?.tiktok],
              ['X / Twitter', urls?.twitter],
            ] as Array<[string, string | undefined]>
          )
            .filter(([, u]) => Boolean(u))
            .map(([label, u]) => (
              <a
                key={label}
                href={u}
                target="_blank"
                rel="noopener noreferrer"
                className="block text-[11px] text-teal hover:underline truncate"
              >
                {label}: {u}
              </a>
            ))}
        </div>
      )}
    </div>
  );
}

function MarketTab({ card }: { card: DashboardCard }) {
  const m = card.marketAuthority;
  return (
    <div className="space-y-3">
      <p className="text-[10px] uppercase tracking-wider text-purple-300">Market Authority</p>
      {m?.source === 'unavailable' && (
        <p className="text-[11px] text-muted">
          Domain / traffic metrics are not available via SociaVault. Authority Score is derived from
          advertising strength, brand authority, and trust.
        </p>
      )}
      <div className="grid grid-cols-2 gap-2">
        <MetricTile label="Domain Authority" value={formatNum(m?.domainAuthority)} />
        <MetricTile label="Organic Keywords" value={formatNum(m?.organicKeywords)} />
        <MetricTile
          label="Monthly Traffic"
          value={m?.monthlyTraffic != null ? formatNum(m.monthlyTraffic) : '—'}
        />
        <MetricTile label="Backlinks" value={formatNum(m?.backlinks)} />
        <MetricTile label="Market Share" value={m?.marketShare != null ? `${m.marketShare}%` : '—'} />
        <MetricTile label="Authority Score" value={formatScore(m?.authorityScore)} accent />
      </div>
    </div>
  );
}

function OffersTab({ card }: { card: DashboardCard }) {
  const o = card.offerTrustAnalysis;
  const offers = o?.offersUsed?.length ? o.offersUsed : card.offers ?? [];
  const usps = o?.uniqueSellingPoints?.length
    ? o.uniqueSellingPoints
    : (card.headlines ?? []).slice(0, 3);
  const trust = o?.trustSignals?.length
    ? o.trustSignals
    : card.brandReview?.strengths?.slice(0, 4) ?? [];
  const proof = o?.socialProofItems?.length
    ? o.socialProofItems
    : card.brandReview?.positiveThemes?.slice(0, 3) ?? [];

  return (
    <div className="space-y-3">
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="rounded-lg border border-border/60 bg-white/5 p-2.5 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-muted text-[10px] uppercase tracking-wider">Offers & Promotions</p>
          </div>
          <CheckList items={offers} variant="ok" />
          {usps.length ? (
            <>
              <p className="text-muted text-[10px] uppercase tracking-wider pt-1">USPs</p>
              <CheckList items={usps} variant="ok" />
            </>
          ) : null}
        </div>
        <div className="rounded-lg border border-border/60 bg-white/5 p-2.5 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-muted text-[10px] uppercase tracking-wider">Trust Signals</p>
            <span className="text-teal text-[10px]">{formatScore(o?.trustSignalScore ?? card.trustScore)}</span>
          </div>
          <CheckList items={trust} variant="ok" />
          <div className="flex items-center justify-between gap-2 pt-1">
            <p className="text-muted text-[10px] uppercase tracking-wider">Social Proof</p>
            <span className="text-teal text-[10px]">{formatScore(o?.socialProofScore ?? card.trustScore)}</span>
          </div>
          <CheckList items={proof} variant="ok" />
        </div>
      </div>
    </div>
  );
}

function LearningTab({ card }: { card: DashboardCard }) {
  const a = card.aiLearning;
  const rows = a?.breakdown
    ? [
        { label: 'Ad Duration (20%)', value: a.breakdown.adDuration },
        { label: 'Active Ads (20%)', value: a.breakdown.activeAds },
        { label: 'Total Ads (10%)', value: a.breakdown.totalAds },
        { label: 'Brand Reviews (15%)', value: a.breakdown.brandReviews },
        { label: 'Trust Score (10%)', value: a.breakdown.trustScore },
        { label: 'Employee Count (5%)', value: a.breakdown.employeeCount },
        { label: 'Social Presence (5%)', value: a.breakdown.socialPresence },
        { label: 'Authority Score (10%)', value: a.breakdown.authorityScore },
        { label: 'Market Position (5%)', value: a.breakdown.marketPosition },
      ]
    : [];

  return (
    <div className="space-y-3">
      <p className="text-[10px] uppercase tracking-wider text-purple-300">AI Learning Value</p>
      <div className="grid grid-cols-3 gap-2">
        <MetricTile label="Competitor Score" value={formatScore(a?.competitorScore ?? card.confidenceScore)} />
        <MetricTile
          label="AI Learning Value"
          value={formatScore(a?.aiLearningValue ?? card.aiLearningValue)}
          accent
        />
        <MetricTile
          label="Claude Influence"
          value={`${a?.influencePercent ?? card.influencePercent}%`}
          accent
        />
      </div>
      {rows.length > 0 && (
        <div className="rounded-lg border border-border/60 bg-white/5 p-2.5 space-y-1.5">
          <p className="text-muted text-[10px] uppercase tracking-wider mb-1">Learning breakdown</p>
          {rows.map((row) => (
            <div key={row.label} className="flex items-center justify-between gap-2 text-[11px]">
              <span className="text-white/80">{row.label}</span>
              <span className="text-teal font-medium">{row.value}/100</span>
            </div>
          ))}
        </div>
      )}
      <p className="text-[11px] text-muted leading-relaxed">
        Claude weights this competitor at {card.influencePercent}% when generating optimized ads —
        learning from advertising longevity, trust, and brand strength rather than copying creatives
        verbatim.
      </p>
    </div>
  );
}

function renderTab(tab: DashTab, card: DashboardCard) {
  switch (tab) {
    case 'ads':
      return <AdsTab card={card} />;
    case 'brand':
      return <BrandTab card={card} />;
    case 'reviews':
      return <ReviewsTab card={card} />;
    case 'social':
      return <SocialTab card={card} />;
    case 'market':
      return <MarketTab card={card} />;
    case 'offers':
      return <OffersTab card={card} />;
    case 'learning':
      return <LearningTab card={card} />;
    case 'overview':
    default:
      return <OverviewTab card={card} />;
  }
}

interface CompetitorIntelligenceDashboardProps {
  competitorAnalysis?: CompetitorIntelligenceData | null;
}

export function CompetitorIntelligenceDashboard({
  competitorAnalysis,
}: CompetitorIntelligenceDashboardProps) {
  const [sortKey, setSortKey] = useState<SortKey>('learning');
  const [tab, setTab] = useState<DashTab>('overview');

  const cards = useMemo(() => {
    if (!competitorAnalysis) return [];
    return sortCards(buildCards(competitorAnalysis).map(hydrateCardSections), sortKey);
  }, [competitorAnalysis, sortKey]);

  const patterns = competitorAnalysis?.marketPatterns;
  const weights = competitorAnalysis?.influenceWeights;

  if (!competitorAnalysis) {
    return (
      <div className="bg-panel border border-teal/25 rounded-xl p-4 space-y-2">
        <p className="text-white text-sm font-semibold">Competitor Intelligence Engine</p>
        <p className="text-muted text-xs">
          Competitor intelligence will appear after Make It Better finishes discovering SociaVault rivals.
        </p>
      </div>
    );
  }

  if (!cards.length && !patterns) {
    return (
      <div className="bg-panel border border-teal/25 rounded-xl p-4 space-y-2">
        <p className="text-white text-sm font-semibold">Competitor Intelligence Engine</p>
        <p className="text-muted text-xs">
          No ranked competitor cards yet for this run. Gallery-backed rivals will populate this engine when SociaVault returns ad activity.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-panel border border-teal/25 rounded-xl p-4 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-white text-sm font-semibold">Competitor Intelligence Engine</p>
          <p className="text-muted text-[11px] mt-0.5">
            Brand Authority & AI Learning — Claude learns from the strongest market rivals
          </p>
        </div>
        <label className="text-[10px] text-muted uppercase tracking-wider flex flex-col gap-1">
          Filter / sort
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            className="bg-navy border border-border rounded-lg px-2.5 py-1.5 text-xs text-white outline-none focus:border-teal/50"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex flex-wrap gap-1.5 border-b border-border/60 pb-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={clsx(
              'px-2.5 py-1 rounded-md text-[11px] transition-colors',
              tab === t.key
                ? 'bg-teal/20 text-teal border border-teal/40'
                : 'text-muted hover:text-white border border-transparent'
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between gap-2">
        <p className="text-muted text-[10px] uppercase tracking-wider">
          Ranked competitors ({cards.length})
        </p>
        {cards.length < 4 && (
          <p className="text-amber-300/90 text-[10px]">
            Fewer than 4 SociaVault-proven advertisers found for this market
          </p>
        )}
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        {cards.map((c) => (
          <CompetitorCardShell
            key={
              dashboardCompetitorKey({
                name: c.name,
                url: c.url,
                advertiserId: c.advertiserId,
              }) || `card-${c.name}-${c.adDurationDays}-${c.totalAdCount}`
            }
            card={c}
          >
            {renderTab(tab, c)}
          </CompetitorCardShell>
        ))}
      </div>

      {tab === 'learning' && weights?.length ? (
        <div className="rounded-xl border border-purple-400/20 bg-navy/40 p-3 space-y-2">
          <p className="text-purple-300 text-[10px] uppercase tracking-wider font-medium">
            Claude Competitor Weighting
          </p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {weights.map((w, i) => (
              <div
                key={`${i}-${w.name}`}
                className="rounded-lg border border-border/60 bg-white/5 px-2.5 py-2 space-y-1"
              >
                <p className="text-white text-xs font-medium truncate">{w.name}</p>
                <p className="text-[11px] text-muted">
                  Competitor Score: <span className="text-white">{w.score}/100</span>
                </p>
                <p className="text-[11px] text-muted">
                  AI Learning Value:{' '}
                  <span className="text-white">{w.aiLearningValue ?? w.score}/100</span>
                </p>
                <p className="text-[11px] text-teal font-medium">
                  Claude Influence: {w.influencePercent}%
                </p>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {patterns && (tab === 'overview' || tab === 'offers') && (
        <div className="rounded-xl border border-purple-400/20 bg-navy/40 p-3 space-y-2">
          <p className="text-purple-300 text-[10px] uppercase tracking-wider font-medium">
            Winning patterns from SociaVault ads
          </p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2 text-[11px]">
            {[
              { label: 'Top Headlines', items: patterns.topHeadlines },
              { label: 'Top Offers', items: patterns.topOffers },
              { label: 'Top CTAs', items: patterns.topCtas },
              { label: 'Top Keywords', items: patterns.topKeywords },
              { label: 'Value Propositions', items: patterns.topValuePropositions },
            ].map((block) =>
              block.items?.length ? (
                <div key={block.label} className="rounded-lg border border-border/60 bg-white/5 px-2.5 py-2">
                  <p className="text-muted text-[10px] uppercase tracking-wider mb-1">{block.label}</p>
                  <ul className="text-white/90 space-y-0.5">
                    {block.items.slice(0, 4).map((item, i) => (
                      <li key={`${block.label}-${i}-${item.slice(0, 40)}`} className="break-words">
                        • {item}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null
            )}
          </div>
        </div>
      )}
    </div>
  );
}
