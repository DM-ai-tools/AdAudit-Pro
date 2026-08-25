import { AlertTriangle } from 'lucide-react';
import type { Finding } from '../../types';
import type { CompetitorIntelligenceData, CurrentAdData, OptimizedAdContent } from '../../types/optimization';

interface WhyImproveThisAdProps {
  originalAd?: CurrentAdData | null;
  competitorAnalysis?: CompetitorIntelligenceData | null;
  optimized?: OptimizedAdContent | null;
  findings?: Finding[];
}

export function WhyImproveThisAd({
  originalAd,
  competitorAnalysis,
  optimized,
  findings = [],
}: WhyImproveThisAdProps) {
  const reasons: string[] = [];

  if (originalAd?.ctr != null && originalAd.ctr < 3) {
    reasons.push(`Current CTR is ${originalAd.ctr}% — room to improve click appeal vs market peers.`);
  }
  if (originalAd?.adStrength && /POOR|AVERAGE/i.test(originalAd.adStrength)) {
    reasons.push(`Ad strength is ${originalAd.adStrength.replace(/_/g, ' ')} — RSA variety/relevance likely weak.`);
  }

  const gaps = competitorAnalysis?.gapAnalysis?.rows?.slice(0, 4) ?? [];
  for (const g of gaps) {
    if (g.gap) reasons.push(g.gap);
  }
  for (const miss of (competitorAnalysis?.missingFromYourAds ?? []).slice(0, 3)) {
    reasons.push(`Missing vs competitors: ${miss}`);
  }
  for (const f of findings
    .filter((x) => ['AD_COPY', 'QUALITY_SCORE', 'KEYWORDS', 'LANDING_PAGES'].includes(x.category))
    .slice(0, 3)) {
    reasons.push(f.title);
  }

  if (optimized?.adDifferenceScore != null && optimized.adDifferenceScore < 70) {
    reasons.push('Latest AI draft is still too similar to the current ad — regenerate a stronger alternative.');
  }

  const unique = [...new Set(reasons.map((r) => r.trim()).filter(Boolean))].slice(0, 8);
  if (!unique.length) {
    unique.push(
      'Strengthen keyword alignment, offers, trust signals, and CTAs using competitor and audit insights.'
    );
  }

  return (
    <div className="bg-panel border border-amber-400/25 rounded-2xl p-5 space-y-3">
      <h3 className="text-white font-semibold flex items-center gap-2">
        <AlertTriangle size={16} className="text-amber-300" />
        Why we are changing this ad
      </h3>
      <ul className="space-y-2">
        {unique.map((r) => (
          <li key={r} className="text-sm text-muted flex gap-2">
            <span className="text-amber-300 shrink-0">•</span>
            <span>{r}</span>
          </li>
        ))}
      </ul>
      <p className="text-[10px] text-muted">
        Based on Google Ads performance, AdAudit findings, competitor gaps, and landing-page context — not invented
        claims.
      </p>
    </div>
  );
}
