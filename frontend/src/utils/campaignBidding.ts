export type NormalizedCampaignBid =
  | 'MANUAL_CPC'
  | 'MAXIMIZE_CONVERSIONS'
  | 'MAXIMIZE_CLICKS'
  | 'OTHER';

export function normalizeCampaignBid(raw?: string | null): NormalizedCampaignBid {
  const s = (raw || '').toUpperCase().replace(/\s+/g, '_');
  if (!s) return 'OTHER';
  if (s.includes('MANUAL_CPC') || s === 'ENHANCED_CPC' || s.includes('MANUAL_ECPC')) return 'MANUAL_CPC';
  if (s.includes('MAXIMIZE_CONVERSION_VALUE') || s.includes('TARGET_ROAS')) return 'OTHER';
  if (s.includes('MAXIMIZE_CONVERSIONS') || s.includes('TARGET_CPA')) return 'MAXIMIZE_CONVERSIONS';
  if (s.includes('MAXIMIZE_CLICKS') || s.includes('TARGET_SPEND')) return 'MAXIMIZE_CLICKS';
  return 'OTHER';
}

export function campaignBidLabel(raw?: string | null): string {
  const n = normalizeCampaignBid(raw);
  if (n === 'MANUAL_CPC') return 'Manual CPC (max CPC)';
  if (n === 'MAXIMIZE_CONVERSIONS') return 'Maximize conversions';
  if (n === 'MAXIMIZE_CLICKS') return 'Maximize clicks';
  if (raw) return raw.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  return 'Unknown';
}

/** Keyword-level max CPC is only honoured on Manual CPC. */
export function campaignHonorsKeywordBids(raw?: string | null): boolean {
  return normalizeCampaignBid(raw) === 'MANUAL_CPC';
}

export function campaignCanSwitchManualVsConversions(type?: string | null): boolean {
  const t = (type || '').toUpperCase();
  if (!t) return false;
  if (t.includes('PERFORMANCE_MAX') || t.includes('DEMAND_GEN') || t.includes('APP') || t.includes('SHOPPING')) {
    return false;
  }
  return t.includes('SEARCH');
}

export function budgetCpcFloor(dailyBudget: number): number {
  if (dailyBudget >= 80) return 1.2;
  if (dailyBudget >= 40) return 0.75;
  return 0.45;
}

export function budgetCpcCap(dailyBudget: number): number {
  const floor = budgetCpcFloor(dailyBudget);
  return Math.max(floor + 0.5, dailyBudget / 5);
}

/** Scale a market/account CPC down so it fits the daily budget wallet and keyword count. */
export function budgetSizedMaxCpc(
  rawCpc: number,
  dailyBudget: number,
  selectedKeywordCount: number
): number {
  if (!(dailyBudget > 0) || !(rawCpc > 0)) return rawCpc;
  const floor = budgetCpcFloor(dailyBudget);
  const cap = budgetCpcCap(dailyBudget);
  const shareCap = dailyBudget / Math.max(3, Math.min(selectedKeywordCount || 1, 12));
  return Math.round(Math.max(floor, Math.min(rawCpc, cap, shareCap)) * 100) / 100;
}

export function rawMarketCpc(k: {
  googlePlannerAvgCpc?: number;
  googlePlannerLowBid?: number;
  googlePlannerHighBid?: number;
  googleAccountAvgCpc?: number;
  googleAccountMaxCpc?: number;
  suggestedCpc?: number;
}): number | undefined {
  if (k.googleAccountMaxCpc != null && k.googleAccountMaxCpc > 0) return k.googleAccountMaxCpc;
  if (k.googleAccountAvgCpc != null && k.googleAccountAvgCpc > 0) return k.googleAccountAvgCpc;
  if (k.googlePlannerAvgCpc != null && k.googlePlannerAvgCpc > 0) return k.googlePlannerAvgCpc;
  if (k.googlePlannerLowBid != null && k.googlePlannerHighBid != null) {
    return Math.round(((k.googlePlannerLowBid + k.googlePlannerHighBid) / 2) * 100) / 100;
  }
  if (k.googlePlannerLowBid != null) return k.googlePlannerLowBid;
  if (k.googlePlannerHighBid != null) return k.googlePlannerHighBid;
  return k.suggestedCpc;
}

export function budgetScaledPlannerCpc(
  k: {
    googlePlannerAvgCpc?: number;
    googlePlannerLowBid?: number;
    googlePlannerHighBid?: number;
  },
  dailyBudget: number,
  selectedKeywordCount: number
): number | undefined {
  const raw =
    k.googlePlannerAvgCpc ??
    (k.googlePlannerLowBid != null && k.googlePlannerHighBid != null
      ? (k.googlePlannerLowBid + k.googlePlannerHighBid) / 2
      : k.googlePlannerLowBid ?? k.googlePlannerHighBid);
  if (raw == null || !(raw > 0)) return undefined;
  if (!(dailyBudget > 0)) return raw;
  return budgetSizedMaxCpc(raw, dailyBudget, selectedKeywordCount);
}
