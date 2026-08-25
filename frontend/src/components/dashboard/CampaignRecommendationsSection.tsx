import { Lightbulb, Megaphone, FileText, Globe, Target, ChevronRight } from 'lucide-react';
import type { Finding, RoadmapItem } from '../../types';
import { findingMatchesModuleSlug } from '../../utils/findingFilters';
import { formatCurrency } from '../../utils/helpers';

interface CampaignRecommendationsSectionProps {
  findings: Finding[];
  roadmapItems: RoadmapItem[];
  campaignCount?: number;
  websiteUrl?: string;
  onJumpToFindings?: (moduleSlug: string) => void;
  onOpenCampaigns?: () => void;
}

interface RecCard {
  id: string;
  icon: typeof Megaphone;
  title: string;
  focus: string;
  how: string[];
  impact: number;
  moduleSlug: string;
  severity: Finding['severity'];
}

const SEVERITY_RANK: Record<Finding['severity'], number> = {
  CRITICAL: 4,
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
};

function topFindings(findings: Finding[], slug: string, limit = 3): Finding[] {
  return findings
    .filter((f) => findingMatchesModuleSlug(f, slug))
    .sort(
      (a, b) =>
        SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
        b.impactMonthly - a.impactMonthly
    )
    .slice(0, limit);
}

function howSteps(findings: Finding[], fallback: string): string[] {
  const recs = findings
    .map((f) => f.recommendation?.trim())
    .filter((r): r is string => Boolean(r))
    .slice(0, 4);
  return recs.length ? recs : [fallback];
}

export function buildCampaignRecommendations(
  findings: Finding[],
  roadmapItems: RoadmapItem[],
  opts?: { campaignCount?: number; websiteUrl?: string }
): RecCard[] {
  const cards: RecCard[] = [];

  const campaign = topFindings(findings, 'campaign');
  const adCopy = topFindings(findings, 'ad-copy');
  const landing = topFindings(findings, 'landing-pages');
  const keywords = topFindings(findings, 'keyword');
  const searchTerms = topFindings(findings, 'search-terms');
  const budget = topFindings(findings, 'budget');
  const bidding = topFindings(findings, 'bidding');

  if (campaign.length || budget.length || bidding.length) {
    const src = [...campaign, ...budget, ...bidding].slice(0, 4);
    cards.push({
      id: 'structure',
      icon: Megaphone,
      title: 'Campaigns to focus on',
      focus:
        opts?.campaignCount && opts.campaignCount > 0
          ? `This account has ${opts.campaignCount} campaign${opts.campaignCount === 1 ? '' : 's'}. Prioritise the ones with the biggest wasted-spend and structure gaps below.`
          : 'Tighten campaign structure before adding more spend.',
      how: howSteps(
        src,
        'Pause overlapping campaigns, split by intent (brand vs service), and give each service its own ad group.'
      ),
      impact: src.reduce((s, f) => s + (f.impactMonthly || 0), 0),
      moduleSlug: campaign.length ? 'campaign' : budget.length ? 'budget' : 'bidding',
      severity: src[0]?.severity ?? 'MEDIUM',
    });
  }

  if (adCopy.length) {
    cards.push({
      id: 'ads',
      icon: FileText,
      title: 'What ads to run in those campaigns',
      focus:
        'Write RSAs around the audited service — unique headlines, a clear offer, and proof. Do not recycle the same RSA across every ad group.',
      how: howSteps(
        adCopy,
        'Refresh headlines with service + location + offer; keep 8–15 unique headlines and 3–4 descriptions per RSA.'
      ),
      impact: adCopy.reduce((s, f) => s + (f.impactMonthly || 0), 0),
      moduleSlug: 'ad-copy',
      severity: adCopy[0]!.severity,
    });
  }

  if (landing.length) {
    cards.push({
      id: 'landing',
      icon: Globe,
      title: 'Align ads to the landing page',
      focus: opts?.websiteUrl
        ? `Match ad promise to ${opts.websiteUrl.replace(/^https?:\/\//, '')} — headline, offer, and form should continue the click.`
        : 'Send each service ad to a matching service page, not the homepage.',
      how: howSteps(
        landing,
        'Use a dedicated service URL as the final URL; repeat the ad offer above the fold and add a single primary CTA.'
      ),
      impact: landing.reduce((s, f) => s + (f.impactMonthly || 0), 0),
      moduleSlug: 'landing-pages',
      severity: landing[0]!.severity,
    });
  }

  if (keywords.length || searchTerms.length) {
    const src = [...keywords, ...searchTerms].slice(0, 4);
    cards.push({
      id: 'keywords',
      icon: Target,
      title: 'Keywords and search terms to act on',
      focus:
        'Keep only service-intent queries in the campaign. Add negatives for waste, and build ad groups around the winning themes.',
      how: howSteps(
        src,
        'Add exact/phrase service keywords, negative out irrelevant queries, and map each theme to its own RSA.'
      ),
      impact: src.reduce((s, f) => s + (f.impactMonthly || 0), 0),
      moduleSlug: keywords.length ? 'keyword' : 'search-terms',
      severity: src[0]?.severity ?? 'MEDIUM',
    });
  }

  if (!cards.length && roadmapItems.length) {
    const first = roadmapItems.slice(0, 3);
    cards.push({
      id: 'roadmap',
      icon: Lightbulb,
      title: 'Start with the 30-day roadmap',
      focus: 'No module findings were grouped yet — use the growth roadmap as the first campaign plan.',
      how: first.map((r) => r.description?.trim() || r.title),
      impact: first.reduce((s, r) => s + (r.impactMonthly || 0), 0),
      moduleSlug: 'campaign',
      severity: 'MEDIUM',
    });
  }

  return cards;
}

export function CampaignRecommendationsSection({
  findings,
  roadmapItems,
  campaignCount,
  websiteUrl,
  onJumpToFindings,
  onOpenCampaigns,
}: CampaignRecommendationsSectionProps) {
  const recs = buildCampaignRecommendations(findings, roadmapItems, {
    campaignCount,
    websiteUrl,
  });

  if (!recs.length) return null;

  return (
    <section id="campaign-recommendations" className="scroll-mt-24">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="text-white font-bold text-xl flex items-center gap-2">
            <Lightbulb size={20} className="text-orange" />
            Campaign recommendations
          </h2>
          <p className="text-muted text-sm mt-1">
            Built from this Google Ads audit (campaigns, ads, keywords) and the landing-page review.
            Use these to decide what to fix first and which ads to focus on.
          </p>
        </div>
        {onOpenCampaigns && (
          <button
            type="button"
            onClick={onOpenCampaigns}
            className="text-orange text-xs hover:underline flex items-center gap-1 shrink-0"
          >
            Open campaigns <ChevronRight size={12} />
          </button>
        )}
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {recs.map((rec) => {
          const Icon = rec.icon;
          return (
            <div
              key={rec.id}
              className="rounded-xl border border-border bg-panel p-4 space-y-3"
            >
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-white text-sm font-semibold flex items-center gap-2">
                  <Icon size={16} className="text-teal shrink-0" />
                  {rec.title}
                </h3>
                {rec.impact > 0 && (
                  <span className="text-[10px] text-orange shrink-0">
                    {formatCurrency(rec.impact)}/mo
                  </span>
                )}
              </div>
              <p className="text-muted text-xs leading-relaxed">{rec.focus}</p>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-teal mb-1">How to do it</p>
                <ul className="space-y-1.5">
                  {rec.how.map((step, i) => (
                    <li key={i} className="text-white/80 text-xs leading-relaxed pl-3 relative">
                      <span className="absolute left-0 top-1.5 w-1.5 h-1.5 rounded-full bg-teal/70" />
                      {step}
                    </li>
                  ))}
                </ul>
              </div>
              {onJumpToFindings && (
                <button
                  type="button"
                  onClick={() => onJumpToFindings(rec.moduleSlug)}
                  className="text-[11px] text-orange hover:underline"
                >
                  View related findings →
                </button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
