import { ExternalLink, Swords, Target, TrendingUp } from 'lucide-react';
import clsx from 'clsx';
import { normalizeRenderableStrings, asDisplayText } from './utils';
import { CompetitorAdActivityMetrics, CompetitorBrandReviewBlock } from './CompetitorBrandMetrics';
import { competitorCreativeMatchesService } from '../../utils/serviceRelevance';
import type {
  CompetitorIntelligenceData,
  CompetitorInsightCard,
  CompetitiveOutperformance,
  OptimizedAdContent,
  CompetitorAdPreview,
} from '../../types/optimization';

interface CompetitorIntelligencePanelsProps {
  competitorAnalysis?: CompetitorIntelligenceData | null;
  optimized: OptimizedAdContent;
  primaryService?: string;
}

function advertiserIdFromUrl(url?: string): string | undefined {
  if (!url) return undefined;
  const m = url.match(/advertiser\/(AR[\w-]+)/i);
  return m?.[1];
}

function hostFromUrl(url?: string): string {
  if (!url) return '';
  try {
    return new URL(url.startsWith('http') ? url : `https://${url}`).hostname.replace(/^www\./, '');
  } catch {
    return url.replace(/^https?:\/\//, '').split('/')[0] ?? url;
  }
}

/** Same identity rules as the dashboard — never collapse Transparency-host rivals. */
function insightIdentityKey(opts: {
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

function preferLibraryStat(a?: number, b?: number): number | undefined {
  if (a != null && a > 0) return a;
  if (b != null && b > 0) return b;
  return a ?? b;
}

function preferDate(a?: string, b?: string, prefer: 'earliest' | 'latest' = 'earliest'): string | undefined {
  if (a && b) {
    const ta = Date.parse(a);
    const tb = Date.parse(b);
    if (Number.isFinite(ta) && Number.isFinite(tb)) {
      return prefer === 'earliest' ? (ta <= tb ? a : b) : ta >= tb ? a : b;
    }
  }
  return a || b || undefined;
}

function mergeInsightCards(
  optimized: OptimizedAdContent,
  competitorAnalysis?: CompetitorIntelligenceData | null,
  primaryService?: string
): CompetitorInsightCard[] {
  const MIN_INSIGHTS = 4;

  const gallery = (competitorAnalysis?.adGallery ?? []).filter(
    (g) =>
      ((g.totalAdCount ?? 0) > 0 || g.adSource === 'sociavault') &&
      competitorCreativeMatchesService(g, primaryService)
  );
  const galleryByKey = new Map<string, CompetitorAdPreview>();
  for (const g of gallery) {
    const key = insightIdentityKey({
      name: g.advertiserName ?? g.name,
      url: g.destinationUrl ?? g.url,
      advertiserId: g.advertiserId,
    });
    const prev = galleryByKey.get(key);
    // Keep the row with stronger library signal — never overwrite good stats with zeros
    if (
      !prev ||
      (g.totalAdCount ?? 0) > (prev.totalAdCount ?? 0) ||
      (g.adDurationDays ?? 0) > (prev.adDurationDays ?? 0)
    ) {
      galleryByKey.set(key, g);
    }
  }

  const findGallery = (name: string, url?: string, advertiserId?: string) => {
    const exact = galleryByKey.get(insightIdentityKey({ name, url, advertiserId }));
    if (exact) return exact;
    // Fallback name-only only when unique in gallery
    const nameHits = gallery.filter(
      (g) => (g.advertiserName ?? g.name).toLowerCase() === name.toLowerCase()
    );
    return nameHits.length === 1 ? nameHits[0] : undefined;
  };

  const fromAnalysis = (competitorAnalysis?.insights ?? []).filter(
    (i) =>
      (i.totalAdCount ?? 0) > 0 ||
      (i.adDurationDays ?? 0) > 0 ||
      (i.keyMessages?.length ?? 0) > 0 ||
      (i.confidenceScore ?? 0) > 0 ||
      Boolean(findGallery(i.name, i.url, i.advertiserId))
  );
  const fromOptimized = (optimized.competitorInsights ?? []).filter(
    (opt) =>
      (opt.totalAdCount ?? 0) > 0 ||
      (opt.adDurationDays ?? 0) > 0 ||
      (opt.keyMessages?.length ?? 0) > 0 ||
      fromAnalysis.some((f) => f.name.toLowerCase() === opt.name.toLowerCase()) ||
      Boolean(findGallery(opt.name, opt.url, opt.advertiserId))
  );

  const cardFromGallery = (g: CompetitorAdPreview): CompetitorInsightCard => ({
    name: g.advertiserName ?? g.name,
    url: g.destinationUrl ?? g.url,
    keyMessages: [...(g.headlines ?? []), ...(g.descriptions ?? [])].filter(Boolean).slice(0, 6),
    offers: g.offers ?? [],
    keywordOpportunities: [],
    adDurationDays: g.adDurationDays,
    activeAdCount: g.activeAdCount,
    totalAdCount: g.totalAdCount,
    firstShown: g.firstShown,
    lastShown: g.lastShown,
    brandReview: g.brandReview,
    confidenceScore: g.confidenceScore,
    influencePercent: g.influencePercent,
    durationLabel: g.durationLabel,
    advertiserId: g.advertiserId,
  });

  const attachGalleryMetrics = (card: CompetitorInsightCard): CompetitorInsightCard => {
    const g = findGallery(card.name, card.url, card.advertiserId);
    if (!g) return card;
    return {
      ...card,
      url: g.destinationUrl ?? g.url ?? card.url,
      advertiserId: card.advertiserId ?? g.advertiserId,
      // Prefer whichever side has the real SociaVault number — never clobber with 0
      adDurationDays: preferLibraryStat(g.adDurationDays, card.adDurationDays),
      activeAdCount: preferLibraryStat(g.activeAdCount, card.activeAdCount),
      totalAdCount: preferLibraryStat(g.totalAdCount, card.totalAdCount),
      firstShown: preferDate(g.firstShown, card.firstShown, 'earliest'),
      lastShown: preferDate(g.lastShown, card.lastShown, 'latest'),
      brandReview: g.brandReview ?? card.brandReview,
      confidenceScore: preferLibraryStat(g.confidenceScore, card.confidenceScore),
      influencePercent: preferLibraryStat(g.influencePercent, card.influencePercent),
      durationLabel: g.durationLabel || card.durationLabel,
      keyMessages:
        card.keyMessages.length > 0
          ? card.keyMessages
          : [...(g.headlines ?? []), ...(g.descriptions ?? [])].filter(Boolean).slice(0, 6),
    };
  };

  // Prefer SociaVault analysis cards; only enrich text from Claude for the same names.
  // Uploaded-document mode: never invent rivals from Claude-only insight cards.
  const documentOnly = competitorAnalysis?.source === 'user_provided';
  const source = documentOnly
    ? fromAnalysis
    : fromAnalysis.length
      ? fromAnalysis
      : fromOptimized;
  let merged: CompetitorInsightCard[] = [];

  if (!source.length && gallery.length) {
    merged = gallery.slice(0, documentOnly ? gallery.length : 8).map(cardFromGallery);
  } else {
    merged = source.map((base) => {
      const opt = fromOptimized.find((o) => o.name.toLowerCase() === base.name.toLowerCase());
      return attachGalleryMetrics({
        name: base.name,
        url: base.url ?? opt?.url,
        advertiserId: (base as { advertiserId?: string }).advertiserId,
        keyMessages: base.keyMessages.length ? base.keyMessages : (opt?.keyMessages ?? []),
        offers: base.offers.length ? base.offers : (opt?.offers ?? []),
        keywordOpportunities: base.keywordOpportunities.length
          ? base.keywordOpportunities
          : (opt?.keywordOpportunities ?? []),
        adDurationDays: preferLibraryStat(base.adDurationDays, opt?.adDurationDays),
        activeAdCount: preferLibraryStat(base.activeAdCount, opt?.activeAdCount),
        totalAdCount: preferLibraryStat(base.totalAdCount, opt?.totalAdCount),
        firstShown: preferDate(base.firstShown, opt?.firstShown, 'earliest'),
        lastShown: preferDate(base.lastShown, opt?.lastShown, 'latest'),
        brandReview: base.brandReview ?? opt?.brandReview,
        confidenceScore: preferLibraryStat(base.confidenceScore, opt?.confidenceScore),
        influencePercent: preferLibraryStat(base.influencePercent, opt?.influencePercent),
        durationLabel: base.durationLabel || opt?.durationLabel,
      });
    });
  }

  merged = merged.map((card) => attachGalleryMetrics(card));

  const withSignal = merged.filter(
    (c) =>
      (c.totalAdCount ?? 0) > 0 ||
      (c.adDurationDays ?? 0) > 0 ||
      (c.keyMessages?.length ?? 0) > 0 ||
      (c.confidenceScore ?? 0) > 0 ||
      Boolean(findGallery(c.name, c.url, c.advertiserId))
  );
  if (withSignal.length >= MIN_INSIGHTS) {
    merged = withSignal;
  } else if (withSignal.length > 0) {
    const signalKeys = new Set(
      withSignal.map((c) => insightIdentityKey({ name: c.name, url: c.url, advertiserId: c.advertiserId }))
    );
    merged = [
      ...withSignal,
      ...merged.filter(
        (c) =>
          !signalKeys.has(insightIdentityKey({ name: c.name, url: c.url, advertiserId: c.advertiserId }))
      ),
    ];
  }

  // Pad to at least 4 Competitor Insights cards from gallery / competitors (backend floor)
  if (merged.length < MIN_INSIGHTS) {
    const seen = new Set(
      merged.map((c) => insightIdentityKey({ name: c.name, url: c.url, advertiserId: c.advertiserId }))
    );
    for (const g of gallery) {
      if (merged.length >= MIN_INSIGHTS) break;
      const key = insightIdentityKey({
        name: g.advertiserName ?? g.name,
        url: g.destinationUrl ?? g.url,
        advertiserId: g.advertiserId,
      });
      if (seen.has(key)) continue;
      merged.push(cardFromGallery(g));
      seen.add(key);
    }
    if (merged.length < MIN_INSIGHTS) {
      for (const g of competitorAnalysis?.adGallery ?? []) {
        if (merged.length >= MIN_INSIGHTS) break;
        if ((g.totalAdCount ?? 0) <= 0 && g.adSource !== 'sociavault') continue;
        if (primaryService && !competitorCreativeMatchesService(g, primaryService)) continue;
        const key = insightIdentityKey({
          name: g.advertiserName ?? g.name,
          url: g.destinationUrl ?? g.url,
          advertiserId: g.advertiserId,
        });
        if (seen.has(key)) continue;
        merged.push(cardFromGallery(g));
        seen.add(key);
      }
    }
    for (const c of competitorAnalysis?.competitors ?? []) {
      if (merged.length >= MIN_INSIGHTS) break;
      const key = insightIdentityKey({
        name: c.name,
        url: c.url,
        advertiserId: (c as { advertiserId?: string }).advertiserId,
      });
      if (seen.has(key)) continue;
      if ((c.totalAdCount ?? 0) <= 0 && (c.adDurationDays ?? 0) <= 0) continue;
      merged.push({
        name: c.name,
        url: c.url,
        advertiserId: (c as { advertiserId?: string }).advertiserId,
        keyMessages: [...(c.headlines ?? []), ...(c.descriptions ?? [])].filter(Boolean).slice(0, 6),
        offers: c.offers ?? [],
        keywordOpportunities: [],
        adDurationDays: c.adDurationDays,
        activeAdCount: c.activeAdCount,
        totalAdCount: c.totalAdCount,
        firstShown: c.firstShown,
        lastShown: c.lastShown,
        brandReview: c.brandReview,
        confidenceScore: c.confidenceScore,
        influencePercent: c.influencePercent,
        durationLabel: c.durationLabel,
      });
      seen.add(key);
    }
  }

  if (merged.length < MIN_INSIGHTS && (competitorAnalysis?.competitors?.length ?? 0) >= MIN_INSIGHTS) {
    const seen = new Set(
      merged.map((c) => insightIdentityKey({ name: c.name, url: c.url, advertiserId: c.advertiserId }))
    );
    for (const c of competitorAnalysis!.competitors!) {
      if (merged.length >= MIN_INSIGHTS) break;
      const key = insightIdentityKey({
        name: c.name,
        url: c.url,
        advertiserId: (c as { advertiserId?: string }).advertiserId,
      });
      if (seen.has(key)) continue;
      merged.push({
        name: c.name,
        url: c.url,
        advertiserId: (c as { advertiserId?: string }).advertiserId,
        keyMessages: [...(c.headlines ?? []), ...(c.descriptions ?? [])].filter(Boolean).slice(0, 6),
        offers: c.offers ?? [],
        keywordOpportunities: [],
        adDurationDays: c.adDurationDays,
        activeAdCount: c.activeAdCount,
        totalAdCount: c.totalAdCount,
        firstShown: c.firstShown,
        lastShown: c.lastShown,
        brandReview: c.brandReview,
        confidenceScore: c.confidenceScore,
        influencePercent: c.influencePercent,
        durationLabel: c.durationLabel,
      });
      seen.add(key);
    }
  }

  return merged.slice(0, Math.min(8, Math.max(merged.length, 0)));
}

function InsightCard({ insight }: { insight: CompetitorInsightCard }) {
  return (
    <div className="bg-navy/50 border border-border rounded-lg p-3 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-white text-sm font-semibold">{insight.name}</p>
          {(insight.confidenceScore != null || insight.influencePercent != null) && (
            <p className="text-[10px] text-teal mt-0.5">
              {insight.confidenceScore != null ? `${insight.confidenceScore}/100 confidence` : ''}
              {insight.confidenceScore != null && insight.influencePercent != null ? ' · ' : ''}
              {insight.influencePercent != null ? `${insight.influencePercent}% influence` : ''}
            </p>
          )}
          {insight.durationLabel && (
            <p className="text-[10px] text-muted mt-0.5">{insight.durationLabel}</p>
          )}
          {insight.url && !/adstransparency\.google\.com/i.test(insight.url) && (
            <p className="text-[10px] text-teal/80 mt-0.5 truncate" title={insight.url}>
              {insight.url.replace(/^https?:\/\//, '')}
            </p>
          )}
        </div>
        {insight.url && (
          <a
            href={insight.url.startsWith('http') ? insight.url : `https://${insight.url}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-teal hover:text-teal/80 shrink-0"
            aria-label={`Open ${insight.name} website`}
          >
            <ExternalLink size={14} />
          </a>
        )}
      </div>

      <CompetitorAdActivityMetrics
        adDurationDays={insight.adDurationDays}
        activeAdCount={insight.activeAdCount}
        totalAdCount={insight.totalAdCount}
        firstShown={insight.firstShown}
        lastShown={insight.lastShown}
        compact
      />

      {insight.brandReview && <CompetitorBrandReviewBlock review={insight.brandReview} />}

      {insight.keyMessages.length > 0 && (
        <div>
          <p className="text-orange text-[10px] uppercase tracking-wider mb-1">Key messages</p>
          <ul className="text-muted text-[11px] space-y-0.5">
            {insight.keyMessages.map((m, i) => (
              <li key={i} className="break-words whitespace-normal">• {m}</li>
            ))}
          </ul>
        </div>
      )}
      {insight.offers.length > 0 && (
        <div>
          <p className="text-orange text-[10px] uppercase tracking-wider mb-1">Offers</p>
          <ul className="text-muted text-[11px] space-y-0.5">
            {insight.offers.map((o, i) => (
              <li key={i} className="break-words whitespace-normal">• {o}</li>
            ))}
          </ul>
        </div>
      )}
      {insight.keywordOpportunities.length > 0 && (
        <div>
          <p className="text-teal text-[10px] uppercase tracking-wider mb-1">Keyword opportunities</p>
          <div className="flex flex-wrap gap-1">
            {insight.keywordOpportunities.slice(0, 6).map((k, i) => (
              <span key={`${i}-${k}`} className="text-[10px] px-2 py-0.5 rounded-full bg-teal/10 text-teal border border-teal/20">
                {k}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function OutperformSection({ data }: { data: CompetitiveOutperformance }) {
  const rows = [
    { title: 'Competitor Strategies Used', text: data.competitorStrategiesUsed, icon: Swords },
    { title: 'Messaging Improvements', text: data.messagingImprovements, icon: Swords },
    { title: 'Keyword Improvements', text: data.keywordImprovements, icon: Target },
    { title: 'Offer Improvements', text: data.offerImprovements, icon: TrendingUp },
    { title: 'Trust Signal Improvements', text: data.trustSignalImprovements, icon: Target },
    { title: 'CTA Improvements', text: data.ctaImprovements, icon: Target },
    { title: 'Conversion Improvements', text: data.conversionImprovements, icon: TrendingUp },
    { title: 'Competitor Gaps Exploited', text: data.competitorGapsExploited, icon: Target },
  ].filter((r) => r.text);

  if (!rows.length) return null;

  return (
    <div className="bg-panel border border-orange/25 rounded-xl p-4 space-y-3">
      <p className="text-white text-sm font-semibold">Why This Ad Will Outperform Competitors</p>
      {rows.map((row) => (
        <div key={row.title} className="flex gap-3">
          <row.icon className="text-orange shrink-0 mt-0.5" size={16} />
          <div>
            <p className="text-orange text-[10px] uppercase tracking-wider">{row.title}</p>
            <p className="text-muted text-xs leading-relaxed">{asDisplayText(row.text)}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

export function CompetitorIntelligencePanels({
  competitorAnalysis,
  optimized,
  primaryService,
}: CompetitorIntelligencePanelsProps) {
  const insights = mergeInsightCards(optimized, competitorAnalysis, primaryService);

  const missingAdvantages = normalizeRenderableStrings(
    optimized.missingCompetitorAdvantages?.length
      ? optimized.missingCompetitorAdvantages
      : competitorAnalysis?.missingFromYourAds ?? []
  );

  const keywordOpportunities = normalizeRenderableStrings(
    competitorAnalysis?.keywordOpportunities ?? []
  );

  const hasContent =
    insights.length > 0 ||
    missingAdvantages.length > 0 ||
    optimized.strategistReasoning?.competitiveOutperformance ||
    Boolean(competitorAnalysis?.competitors?.length) ||
    Boolean(competitorAnalysis?.adGallery?.length);

  if (!hasContent) {
    return (
      <div className="bg-panel border border-purple-400/20 rounded-xl p-4 space-y-2">
        <p className="text-white text-sm font-semibold">Competitor Insights</p>
        <p className="text-muted text-xs">
          Competitor insight cards will appear once live library-backed rivals are found for this service.
          Re-run Make It Better if this section is empty after a completed run.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {insights.length > 0 ? (
        <div className="bg-panel border border-purple-400/20 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-white text-sm font-semibold">Competitor Insights</p>
            {competitorAnalysis?.source && (
              <span className={clsx(
                'text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border',
                competitorAnalysis.source === 'unavailable'
                  ? 'border-border text-muted'
                  : 'border-purple-400/30 text-purple-300'
              )}>
                {competitorAnalysis.source.replace(/_/g, ' ')}
              </span>
            )}
          </div>
          <div className="grid md:grid-cols-2 gap-3">
            {insights.slice(0, 8).map((insight, i) => (
              <InsightCard key={`${i}-${insight.name}-${insight.url ?? ''}`} insight={insight} />
            ))}
          </div>
          {keywordOpportunities.length > 0 && (
            <div className="pt-2 border-t border-border/50">
              <p className="text-teal text-[10px] uppercase tracking-wider mb-2">Account-wide keyword opportunities</p>
              <div className="flex flex-wrap gap-1.5">
                {keywordOpportunities.slice(0, 12).map((k, i) => (
                  <span key={`${i}-${k}`} className="text-[10px] px-2 py-0.5 rounded-full bg-teal/10 text-teal border border-teal/20">
                    {k}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="bg-panel border border-purple-400/20 rounded-xl p-4 space-y-2">
          <p className="text-white text-sm font-semibold">Competitor Insights</p>
          <p className="text-muted text-xs">
            Rivals were found but insight cards need library metrics. Check the Competitor Ad Gallery and Intelligence Engine below.
          </p>
        </div>
      )}

      {optimized.strategistReasoning?.competitiveOutperformance && (
        <OutperformSection data={optimized.strategistReasoning.competitiveOutperformance} />
      )}

      {missingAdvantages.length > 0 && (
        <div className="bg-panel border border-red-500/25 rounded-xl p-4 space-y-2">
          <p className="text-white text-sm font-semibold">Competitor Advantages Missing From Your Ads</p>
          <p className="text-muted text-[11px]">
            Proven competitor hooks and offers your current ads do not emphasize — use these to close the gap.
          </p>
          <ul className="text-muted text-xs space-y-1.5">
            {missingAdvantages.map((item, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-teal shrink-0">✓</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
