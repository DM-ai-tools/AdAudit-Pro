import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Globe,
  Loader2,
  MessageSquare,
  Plus,
  RefreshCw,
  Search,
  Send,
  Sparkles,
  Star,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { Button } from '../ui/Button';
import { AdPreviewPanel } from '../optimization/AdPreviewPanel';
import { campaignWizardApi, googleAdsApi } from '../../services/api';
import type { CompetitorAdPreview, PreviewDevice } from '../../types/optimization';
import {
  ACCOUNT_CAMPAIGN_TYPES,
  getCampaignTypeMeta,
  resolveAccountCampaignType,
  type AccountCampaignTypeKey,
} from '../../utils/campaignTypes';
import {
  campaignBidLabel,
  campaignHonorsKeywordBids,
  budgetScaledPlannerCpc,
  budgetSizedMaxCpc,
  rawMarketCpc,
} from '../../utils/campaignBidding';

type WizardStep =
  | 'services'
  | 'competitors'
  | 'keywords'
  | 'campaign-settings'
  | 'generate-ads'
  | 'done';

type CampaignApprovalKey =
  | 'authorizeCreate'
  | 'pausedUnderstood'
  | 'budgetApproved'
  | 'euPoliticalDeclared'
  | 'accountAccessConfirmed';

const CREATABLE_TYPES = ACCOUNT_CAMPAIGN_TYPES.filter((t) => t.key !== 'other');

const CAMPAIGN_APPROVALS: Array<{ key: CampaignApprovalKey; label: string }> = [
  { key: 'authorizeCreate', label: 'I authorize AdAudit Pro to create this campaign' },
  { key: 'pausedUnderstood', label: 'Campaign will be created as PAUSED' },
  { key: 'budgetApproved', label: 'I approve the daily budget' },
  { key: 'euPoliticalDeclared', label: 'EU political advertising declaration is accurate' },
  { key: 'accountAccessConfirmed', label: 'I have Standard/Admin access' },
];

type AdApprovalKey =
  | 'authorizeCreateAd'
  | 'pausedAdUnderstood'
  | 'landingPageApproved'
  | 'copyApproved'
  | 'accountAccessConfirmed';

const AD_APPROVALS: Array<{ key: AdApprovalKey; label: string }> = [
  { key: 'authorizeCreateAd', label: 'I authorize AdAudit Pro to create this ad' },
  { key: 'pausedAdUnderstood', label: 'Ad will be created as PAUSED' },
  { key: 'landingPageApproved', label: 'I approve the landing page / final URL' },
  { key: 'copyApproved', label: 'I will review AI copy before enabling' },
  { key: 'accountAccessConfirmed', label: 'I have Standard/Admin access' },
];

export interface ExistingCampaignForAd {
  id: string;
  resourceName: string;
  name: string;
  type: string;
  biddingStrategyType?: string;
  budgetDaily?: number;
  status?: string;
}

interface KeywordItem {
  keyword: string;
  volume: number;
  traffic: number;
  position: number;
  selected: boolean;
  difficulty?: number;
  intent?: 'transactional' | 'commercial' | 'informational';
  matchSuggestion?: 'EXACT' | 'PHRASE';
  role?: 'primary' | 'secondary';
  seed?: string;
  suggestedCpc?: number;
  /** Your chosen max CPC (defaults from Google / planner / suggestion). */
  userMaxCpc?: number;
  /** User manually edited max CPC — skip auto-rescale on budget changes. */
  userEditedCpc?: boolean;
  googleAccountAvgCpc?: number;
  googleAccountMaxCpc?: number;
  googlePlannerAvgCpc?: number;
  googlePlannerLowBid?: number;
  googlePlannerHighBid?: number;
  googlePlannerSearches?: number;
  googleAccountClicks?: number;
  googleQualityScore?: number;
}

interface KeywordSeedTheme {
  seed: string;
  theme: string;
  intent: 'transactional' | 'commercial';
  primary: Array<{
    keyword: string;
    volume: number;
    difficulty?: number;
    matchSuggestion?: 'EXACT' | 'PHRASE';
    suggestedCpc?: number;
  }>;
  secondary: Array<{
    keyword: string;
    volume: number;
    difficulty?: number;
    matchSuggestion?: 'EXACT' | 'PHRASE';
    suggestedCpc?: number;
  }>;
}

interface KeywordCluster {
  service: string;
  keywords: KeywordItem[];
  seedThemes?: KeywordSeedTheme[];
  totalVolume: number;
  totalTraffic: number;
  topKeyword: string;
  selected: boolean;
}

type BidStrategy = 'MANUAL_CPC' | 'MAXIMIZE_CLICKS' | 'MAXIMIZE_CONVERSIONS';

type KeywordBidRecommendation = Awaited<
  ReturnType<typeof campaignWizardApi.keywordRecommendations>
>['data'];

type BudgetContextPayload = {
  totalSpend?: number;
  enabledDailyBudget?: number;
  leftover?: number;
  costPerConversion?: number;
  avgCpc?: number;
  pacePercent?: number;
  constrainedCampaigns?: number;
  conversions?: number;
  windowDays?: number;
  currency?: string;
};

interface WizardCompetitor {
  name: string;
  url: string;
  advertiserId?: string;
  headlines: string[];
  descriptions: string[];
  totalAdCount: number;
  activeAdCount: number;
  adDurationDays: number;
  previewImageUrl?: string;
  transparencyUrl?: string;
  adSource?: string;
  confidenceScore?: number;
  isMostRelevant: boolean;
  allAds: CompetitorAdPreview[];
}

interface GeneratedAd {
  id: string;
  label: string;
  headlines: string[];
  descriptions: string[];
  displayPaths?: { path1?: string; path2?: string };
  keywords: string[];
  focusedCompetitor?: string;
}

function extractPhrasesFromCompetitorAds(
  ads: Array<{ headlines?: string[]; descriptions?: string[] }>,
  service: string
): string[] {
  const svcTokens = service
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length >= 2);
  const stop = new Set(['the', 'and', 'for', 'you', 'your', 'our', 'with', 'from', 'best', 'free', 'now']);
  const out = new Set<string>();
  for (const ad of ads) {
    const texts = [...(ad.headlines ?? []), ...(ad.descriptions ?? [])];
    for (const raw of texts) {
      const words = raw
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length >= 2 && !stop.has(w));
      for (let n = 2; n <= 5; n++) {
        for (let i = 0; i + n <= words.length; i++) {
          const phrase = words.slice(i, i + n).join(' ');
          if (phrase.length >= 6 && svcTokens.some((t) => phrase.includes(t))) out.add(phrase);
        }
      }
    }
  }
  return [...out].slice(0, 20);
}

function pickBudgetSizedMaxCpc(
  k: KeywordItem,
  dailyBudget: number,
  selectedKeywordCount: number
): number | undefined {
  if (k.userEditedCpc && k.userMaxCpc != null && k.userMaxCpc > 0) return k.userMaxCpc;
  const raw = rawMarketCpc(k);
  if (raw == null || !(raw > 0)) return k.suggestedCpc;
  if (!(dailyBudget > 0)) return raw;
  return budgetSizedMaxCpc(raw, dailyBudget, selectedKeywordCount);
}

function rescaleKeywordBidsForBudget(
  clusters: KeywordCluster[],
  dailyBudget: number,
  strategy: 'MANUAL_CPC' | 'MAXIMIZE_CONVERSIONS'
): KeywordCluster[] {
  const selectedCount =
    clusters.flatMap((c) => c.keywords.filter((k) => k.selected)).length || 1;
  return clusters.map((c) => ({
    ...c,
    keywords: c.keywords.map((k) => {
      if (strategy === 'MAXIMIZE_CONVERSIONS') {
        if (k.userEditedCpc) return k;
        return { ...k, userMaxCpc: undefined };
      }
      if (k.userEditedCpc) return k;
      const sized = pickBudgetSizedMaxCpc(k, dailyBudget, selectedCount);
      return sized != null ? { ...k, userMaxCpc: sized, suggestedCpc: sized } : k;
    }),
  }));
}

function hostFromUrl(url: string): string {
  try {
    return new URL(url.startsWith('http') ? url : `https://${url}`).hostname.replace(/^www\./, '');
  } catch {
    return url.replace(/^https?:\/\//, '').split('/')[0] ?? 'example.com';
  }
}

function isDisplayableCompetitorAd(ad: {
  headlines?: string[];
  descriptions?: string[];
  previewImageUrl?: string;
  syntheticCopy?: boolean;
}): boolean {
  if (ad.syntheticCopy) return false;
  const headlines = (ad.headlines ?? []).filter((h) => h.trim() && !/shop now/i.test(h));
  const descriptions = (ad.descriptions ?? []).filter(
    (d) => d.trim() && !/^visit .+ for quality service/i.test(d)
  );
  return headlines.length > 0 || descriptions.length > 0 || Boolean(ad.previewImageUrl);
}

function transparencyCenterHref(c: {
  transparencyUrl?: string;
  advertiserId?: string;
  name?: string;
  allAds?: Array<{ transparencyUrl?: string; advertiserId?: string; creativeUrl?: string; adLink?: string }>;
}): string {
  if (c.transparencyUrl) return c.transparencyUrl;
  const fromAd = c.allAds?.find((a) => a.transparencyUrl)?.transparencyUrl;
  if (fromAd) return fromAd;
  const advertiserId =
    c.advertiserId || c.allAds?.find((a) => a.advertiserId)?.advertiserId;
  if (advertiserId) {
    return `https://adstransparency.google.com/advertiser/${advertiserId}?region=AU`;
  }
  return `https://adstransparency.google.com/?region=AU&query=${encodeURIComponent(c.name ?? '')}`;
}

interface CreateCampaignModalProps {
  open: boolean;
  onClose: () => void;
  auditId: string;
  googleAdsCustomerId: string;
  websiteUrl?: string;
  accountName?: string;
  typeCounts?: Partial<Record<AccountCampaignTypeKey, number>>;
  onCreated?: () => void;
  /** Default campaign create. `ad` reuses the same research flow inside an existing campaign. */
  mode?: 'campaign' | 'ad';
  existingCampaign?: ExistingCampaignForAd;
}

function resolveCampaignResourceName(
  googleAdsCustomerId: string,
  campaign?: ExistingCampaignForAd
): string | null {
  if (!campaign) return null;
  if (campaign.resourceName?.includes('/campaigns/')) return campaign.resourceName;
  const customer = googleAdsCustomerId.replace(/\D/g, '');
  const id = campaign.id.replace(/\D/g, '');
  if (!customer || !id) return null;
  return `customers/${customer}/campaigns/${id}`;
}

export function CreateCampaignModal({
  open,
  onClose,
  auditId,
  googleAdsCustomerId,
  websiteUrl,
  accountName,
  typeCounts,
  onCreated,
  mode = 'campaign',
  existingCampaign,
}: CreateCampaignModalProps) {
  const isAdMode = mode === 'ad' && Boolean(existingCampaign);
  // ── Wizard state ──
  const [step, setStep] = useState<WizardStep>('services');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Step 1: Services
  const [companyName, setCompanyName] = useState('');
  const [industry, setIndustry] = useState('');
  const [discoveredServices, setDiscoveredServices] = useState<string[]>([]);
  const [selectedServices, setSelectedServices] = useState<string[]>([]);
  const [customService, setCustomService] = useState('');
  const [offer, setOffer] = useState('');
  const [servicesScanned, setServicesScanned] = useState(false);
  const [scrapeStatus, setScrapeStatus] = useState<'ok' | 'blocked' | 'empty' | 'inferred' | null>(null);

  // Step 2: Keywords
  const [clusters, setClusters] = useState<KeywordCluster[]>([]);
  const [ahrefsAvailable, setAhrefsAvailable] = useState(true);
  const [newKeyword, setNewKeyword] = useState('');
  const [editingCluster, setEditingCluster] = useState<string | null>(null);

  // Step 3: Campaign settings
  const [campaignType, setCampaignType] = useState<AccountCampaignTypeKey>('search');
  const [campaignName, setCampaignName] = useState('');
  const [dailyBudget, setDailyBudget] = useState('');
  const [biddingStrategy, setBiddingStrategy] = useState<BidStrategy>('MANUAL_CPC');
  const [targetLocations, setTargetLocations] = useState('');
  const [keywordRecs, setKeywordRecs] = useState<KeywordBidRecommendation | null>(null);
  const [recsLoading, setRecsLoading] = useState(false);
  const [budgetContext, setBudgetContext] = useState<BudgetContextPayload | undefined>();
  const recsBudgetKeyRef = useRef('');
  const autoAppliedRecsKeyRef = useRef('');
  const [chosenStrategy, setChosenStrategy] = useState<'MANUAL_CPC' | 'MAXIMIZE_CONVERSIONS'>(
    'MANUAL_CPC'
  );
  const [biddingSwitchDecision, setBiddingSwitchDecision] = useState<'keep' | 'switch' | null>(null);
  const [biddingSwitchApproved, setBiddingSwitchApproved] = useState(false);
  const [finalUrl, setFinalUrl] = useState(websiteUrl ?? '');
  const [audience, setAudience] = useState('');
  const [tone, setTone] = useState('Professional / high-conversion');
  const [campaignApprovals, setCampaignApprovals] = useState<Record<CampaignApprovalKey, boolean>>({
    authorizeCreate: false,
    pausedUnderstood: false,
    budgetApproved: false,
    euPoliticalDeclared: false,
    accountAccessConfirmed: false,
  });
  const [requiresEuPoliticalAdvertising, setRequiresEuPoliticalAdvertising] = useState(false);
  const [euPolicyLoaded, setEuPolicyLoaded] = useState(false);
  const [adApprovals, setAdApprovals] = useState<Record<AdApprovalKey, boolean>>({
    authorizeCreateAd: false,
    pausedAdUnderstood: false,
    landingPageApproved: false,
    copyApproved: false,
    accountAccessConfirmed: false,
  });
  const [createdCampaignResourceName, setCreatedCampaignResourceName] = useState<string | null>(null);
  const [negativeKeywords, setNegativeKeywords] = useState<string[]>([]);
  const [newNegative, setNewNegative] = useState('');
  const [googleMetricsLoading, setGoogleMetricsLoading] = useState(false);
  const [googleMetricsCurrency, setGoogleMetricsCurrency] = useState('AUD');
  const [googlePlannerAvailable, setGooglePlannerAvailable] = useState(false);

  // Step 4: Competitors — per selected service
  const [competitorsByService, setCompetitorsByService] = useState<
    Record<string, WizardCompetitor[]>
  >({});
  const [competitorLoading, setCompetitorLoading] = useState<string | null>(null);
  const [allCompetitorAds, setAllCompetitorAds] = useState<CompetitorAdPreview[]>([]);
  const [fetchLog, setFetchLog] = useState<string[]>([]);
  const [fetchingLive, setFetchingLive] = useState(false);
  const fetchAbortRef = useRef<AbortController | null>(null);

  const pushFetchLog = (line: string) => {
    const stamp = new Date().toLocaleTimeString();
    setFetchLog((prev) => [...prev.slice(-40), `${stamp}  ${line}`]);
  };

  const stopCompetitorFetch = (reason = 'Stopped competitor fetch.') => {
    fetchAbortRef.current?.abort();
    fetchAbortRef.current = null;
    setFetchingLive(false);
    setCompetitorLoading(null);
    pushFetchLog(reason);
  };

  // Step 5: Generated ads
  const [generatedAds, setGeneratedAds] = useState<GeneratedAd[]>([]);
  const [selectedAdId, setSelectedAdId] = useState<string | null>(null);
  const [adChatById, setAdChatById] = useState<
    Record<string, Array<{ role: 'user' | 'assistant'; content: string }>>
  >({});
  const [adChatInput, setAdChatInput] = useState('');
  const [refiningAd, setRefiningAd] = useState(false);
  const [previewDevice, setPreviewDevice] = useState<PreviewDevice>('mobile');

  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStep('services');
    setError(null);
    setSuccess(null);
    setDiscoveredServices([]);
    setSelectedServices([]);
    setServicesScanned(false);
    setScrapeStatus(null);
    setClusters([]);
    setKeywordRecs(null);
    setBudgetContext(undefined);
    recsBudgetKeyRef.current = '';
    setChosenStrategy('MANUAL_CPC');
    setDailyBudget(
      isAdMode && existingCampaign?.budgetDaily && existingCampaign.budgetDaily > 0
        ? String(existingCampaign.budgetDaily)
        : ''
    );
    setNegativeKeywords([]);
    setNewNegative('');
    setGoogleMetricsLoading(false);
    setGooglePlannerAvailable(false);
    setBiddingSwitchDecision(null);
    setBiddingSwitchApproved(false);
    setCompetitorsByService({});
    setFetchLog([]);
    setFetchingLive(false);
    fetchAbortRef.current?.abort();
    fetchAbortRef.current = null;
    setGeneratedAds([]);
    setSelectedAdId(null);
    setAdChatById({});
    setAdChatInput('');
    setRefiningAd(false);
    setCreatedCampaignResourceName(
      isAdMode ? resolveCampaignResourceName(googleAdsCustomerId, existingCampaign) : null
    );
    setCampaignName(isAdMode ? existingCampaign?.name ?? '' : '');
    if (existingCampaign) {
      setCampaignType(
        resolveAccountCampaignType({ type: existingCampaign.type, name: existingCampaign.name })
      );
    }
    setLoading(false);
    setFinalUrl(websiteUrl ?? '');
    setCampaignApprovals({
      authorizeCreate: false,
      pausedUnderstood: false,
      budgetApproved: false,
      euPoliticalDeclared: false,
      accountAccessConfirmed: false,
    });
    setAdApprovals({
      authorizeCreateAd: false,
      pausedAdUnderstood: false,
      landingPageApproved: false,
      copyApproved: false,
      accountAccessConfirmed: false,
    });
  }, [open, isAdMode, existingCampaign, googleAdsCustomerId, websiteUrl]);

  useEffect(() => {
    if (!open || isAdMode || !googleAdsCustomerId) {
      setRequiresEuPoliticalAdvertising(false);
      setEuPolicyLoaded(isAdMode || !open);
      return;
    }
    let cancelled = false;
    setEuPolicyLoaded(false);
    googleAdsApi
      .campaigns(googleAdsCustomerId, 30)
      .then(({ data }) => {
        if (!cancelled) {
          setRequiresEuPoliticalAdvertising(Boolean(data.account?.requiresEuPoliticalAdvertising));
          setEuPolicyLoaded(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRequiresEuPoliticalAdvertising(false);
          setEuPolicyLoaded(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, isAdMode, googleAdsCustomerId]);

  useEffect(() => {
    if (open && websiteUrl) setFinalUrl(websiteUrl);
  }, [open, websiteUrl]);

  // ── Selected service clusters (checked) ──
  const selectedClusters = useMemo(
    () => clusters.filter((c) => c.selected),
    [clusters]
  );

  const allSelectedKeywords = useMemo(
    () =>
      selectedClusters.flatMap((c) =>
        c.keywords.filter((k) => k.selected).map((k) => k.keyword)
      ),
    [selectedClusters]
  );

  const selectedKeywordRows = useMemo(
    () => selectedClusters.flatMap((c) => c.keywords.filter((k) => k.selected)),
    [selectedClusters]
  );

  const keywordBudgetStats = useMemo(() => {
    const budget = Number(dailyBudget);
    if (!(budget > 0) || !selectedKeywordRows.length) return null;
    const selectedCount = selectedKeywordRows.length;
    if (chosenStrategy === 'MAXIMIZE_CONVERSIONS') {
      const cpa = budgetContext?.costPerConversion;
      const estConv = cpa != null && cpa > 0 ? Math.max(1, Math.round(budget / cpa)) : null;
      return {
        mode: 'conversions' as const,
        count: selectedCount,
        estConversions: estConv,
        typicalCpc: budgetContext?.avgCpc,
      };
    }
    const cpcs = selectedKeywordRows
      .map((k) => pickBudgetSizedMaxCpc(k, budget, selectedCount))
      .filter((n): n is number => typeof n === 'number' && n > 0);
    if (!cpcs.length) return null;
    const avg = cpcs.reduce((s, n) => s + n, 0) / cpcs.length;
    const max = Math.max(...cpcs);
    return {
      mode: 'manual' as const,
      count: selectedCount,
      avgCpc: avg,
      maxCpc: max,
      estClicksAtAvg: Math.max(1, Math.floor(budget / avg)),
      estClicksAtMax: Math.max(1, Math.floor(budget / max)),
    };
  }, [dailyBudget, selectedKeywordRows, chosenStrategy, budgetContext]);

  const mergeGoogleKeywordMetrics = (
    nextClusters: KeywordCluster[],
    metrics: Array<{
      keyword: string;
      accountAvgCpc?: number;
      accountMaxCpc?: number;
      accountImpressions?: number;
      accountClicks?: number;
      accountConversions?: number;
      qualityScore?: number;
      plannerAvgCpc?: number;
      plannerLowBid?: number;
      plannerHighBid?: number;
      plannerMonthlySearches?: number;
    }>,
    strategy = chosenStrategy,
    budget = Number(dailyBudget)
  ): KeywordCluster[] => {
    const selectedCount =
      nextClusters.flatMap((c) => c.keywords.filter((k) => k.selected)).length || 1;
    const map = new Map(metrics.map((m) => [m.keyword.toLowerCase(), m]));
    return nextClusters.map((c) => ({
      ...c,
      keywords: c.keywords.map((k) => {
        const g = map.get(k.keyword.toLowerCase());
        if (!g) return k;
        const merged: KeywordItem = {
          ...k,
          googleAccountAvgCpc: g.accountAvgCpc,
          googleAccountMaxCpc: g.accountMaxCpc,
          googleAccountClicks: g.accountClicks,
          googleQualityScore: g.qualityScore,
          googlePlannerAvgCpc: g.plannerAvgCpc,
          googlePlannerLowBid: g.plannerLowBid,
          googlePlannerHighBid: g.plannerHighBid,
          googlePlannerSearches: g.plannerMonthlySearches,
        };
        if (strategy === 'MAXIMIZE_CONVERSIONS' && !merged.userEditedCpc) {
          return { ...merged, userMaxCpc: undefined };
        }
        if (merged.userEditedCpc) return merged;
        const userMaxCpc = pickBudgetSizedMaxCpc(merged, budget, selectedCount);
        return userMaxCpc != null ? { ...merged, userMaxCpc, suggestedCpc: userMaxCpc } : merged;
      }),
    }));
  };

  const loadGoogleKeywordMetrics = async (nextClusters: KeywordCluster[]) => {
    if (!googleAdsCustomerId) return;
    const keywords = nextClusters.flatMap((c) => c.keywords.map((k) => k.keyword)).slice(0, 80);
    if (!keywords.length) return;
    setGoogleMetricsLoading(true);
    try {
      const { data } = await googleAdsApi.keywordMetrics(googleAdsCustomerId, {
        keywords,
        location: targetLocations.trim() || undefined,
        websiteUrl: websiteUrl ?? undefined,
        windowDays: 90,
      });
      setGoogleMetricsCurrency(data.currency || 'AUD');
      setGooglePlannerAvailable(data.plannerAvailable);
      setClusters((prev) => mergeGoogleKeywordMetrics(prev, data.metrics));
    } catch {
      // Ahrefs + local sizing still work without Google metrics.
    } finally {
      setGoogleMetricsLoading(false);
    }
  };

  const applyKeywordSelectionFromRecs = (
    recs: KeywordBidRecommendation['recommendedKeywords']
  ) => {
    if (!recs.length) return;
    const recSet = new Set(
      recs.filter((k) => k.recommended !== false).map((k) => k.keyword.toLowerCase())
    );
    setClusters((prev) =>
      prev.map((c) => {
        const keywords = c.keywords.map((k) => ({
          ...k,
          selected: recSet.has(k.keyword.toLowerCase()),
        }));
        return {
          ...c,
          selected: keywords.some((k) => k.selected),
          keywords,
        };
      })
    );
  };

  const loadKeywordRecommendations = async (
    nextClusters: KeywordCluster[],
    budget = Number(dailyBudget),
    ctx = budgetContext,
    strategy: 'MANUAL_CPC' | 'MAXIMIZE_CONVERSIONS' = chosenStrategy
  ) => {
    if (!nextClusters.length || !(budget > 0)) return;
    const key = `${budget}|${strategy}|${nextClusters.map((c) => c.service).join(',')}|${nextClusters.flatMap((c) => c.keywords.map((k) => k.keyword)).join(',')}`;
    if (recsBudgetKeyRef.current === key && keywordRecs) return;
    recsBudgetKeyRef.current = key;
    if (!keywordRecs) setRecsLoading(true);
    try {
      const { data } = await campaignWizardApi.keywordRecommendations({
        clusters: nextClusters.map((c) => ({
          service: c.service,
          keywords: c.keywords.map((k) => ({
            keyword: k.keyword,
            volume: k.volume,
            position: k.position,
            traffic: k.traffic,
            url: '',
            difficulty: k.difficulty,
            intent: k.intent,
            matchSuggestion: k.matchSuggestion,
            role: k.role,
            seed: k.seed,
            suggestedCpc: k.userMaxCpc ?? k.suggestedCpc,
            googlePlannerAvgCpc: k.googlePlannerAvgCpc,
            googlePlannerLowBid: k.googlePlannerLowBid,
            googlePlannerHighBid: k.googlePlannerHighBid,
            googleAccountAvgCpc: k.googleAccountAvgCpc,
            googleAccountMaxCpc: k.googleAccountMaxCpc,
          })),
          seedThemes: c.seedThemes,
          totalVolume: c.totalVolume,
          totalTraffic: c.totalTraffic,
          topKeyword: c.topKeyword,
        })),
        dailyBudget: budget,
        campaignType,
        location: targetLocations.trim() || undefined,
        preferredStrategy: strategy,
        budgetContext: ctx,
      });
      setKeywordRecs(data);
      const applyKey = `${key}|${data.recommendedKeywordCount}`;
      if (autoAppliedRecsKeyRef.current !== applyKey) {
        autoAppliedRecsKeyRef.current = applyKey;
        applyKeywordSelectionFromRecs(data.recommendedKeywords);
      }
    } catch {
      // Keep whatever is already on screen — never blank the recs panel.
    } finally {
      setRecsLoading(false);
    }
  };

  const applyChosenStrategy = (id: 'MANUAL_CPC' | 'MAXIMIZE_CONVERSIONS') => {
    setChosenStrategy(id);
    setBiddingStrategy(id);
    recsBudgetKeyRef.current = '';
    autoAppliedRecsKeyRef.current = '';
    const n = Number(dailyBudget);
    if (n > 0) {
      setClusters((prev) => rescaleKeywordBidsForBudget(prev, n, id));
      void loadKeywordRecommendations(clusters, n, budgetContext, id);
    }
  };

  const applyKeywordRecommendations = () => {
    if (!keywordRecs?.recommendedKeywords.length) return;
    applyKeywordSelectionFromRecs(keywordRecs.recommendedKeywords);
  };

  useEffect(() => {
    if (step !== 'keywords' && step !== 'campaign-settings') return;
    if (!clusters.length) return;
    const n = Number(dailyBudget);
    if (!(n > 0)) return;
    setClusters((prev) => rescaleKeywordBidsForBudget(prev, n, chosenStrategy));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dailyBudget, chosenStrategy, selectedKeywordRows.length, step]);

  useEffect(() => {
    if (step !== 'keywords' && step !== 'campaign-settings') return;
    if (!clusters.length) return;
    const n = Number(dailyBudget);
    if (!(n > 0)) return;
    const timer = window.setTimeout(() => {
      void loadKeywordRecommendations(clusters, n, budgetContext, chosenStrategy);
    }, 450);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dailyBudget, step, clusters, chosenStrategy]);

  const campaignUsesKeywordBids = campaignHonorsKeywordBids(existingCampaign?.biddingStrategyType);
  const recsWantManualCpc =
    (keywordRecs?.strategyOptions?.find((o) => o.recommended)?.id ?? keywordRecs?.bidStrategy) ===
    'MANUAL_CPC';
  const showAdBidSwitchWarning =
    isAdMode && Boolean(keywordRecs) && !campaignUsesKeywordBids && recsWantManualCpc;

  const selectedTypeMeta = getCampaignTypeMeta(campaignType);
  const budgetNumber = Number(dailyBudget);
  const selectedKwCount = Math.max(1, selectedKeywordRows.length);
  const showKeywordMaxCpc = isAdMode
    ? campaignUsesKeywordBids || biddingSwitchDecision === 'switch'
    : chosenStrategy === 'MANUAL_CPC';
  const recommendedKeywordSet = useMemo(
    () =>
      new Set(
        (keywordRecs?.recommendedKeywords ?? [])
          .filter((k) => k.recommended !== false)
          .map((k) => k.keyword.toLowerCase())
      ),
    [keywordRecs]
  );
  const campaignApprovalItems = CAMPAIGN_APPROVALS.filter(
    (item) => item.key !== 'euPoliticalDeclared' || requiresEuPoliticalAdvertising
  );
  const allApprovals = campaignApprovalItems.every((a) => campaignApprovals[a.key]);
  const allAdApprovals = AD_APPROVALS.every((a) => adApprovals[a.key]);

  const selectedAd = generatedAds.find((a) => a.id === selectedAdId) ?? generatedAds[0];

  const renderKeywordStrategyPanel = () => {
    const recs = keywordRecs?.recommendedKeywords ?? [];
    const currency = budgetContext?.currency || 'AUD';
    return (
    <div className="rounded-xl border border-orange/30 bg-orange/5 p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="text-white text-sm font-semibold flex items-center gap-2">
            <Sparkles size={14} className="text-orange" />
            AI keyword & bid recommendations
          </h4>
          <p className="text-muted text-[11px] mt-1">
            We recommend how many keywords fit your daily budget at planner/max CPC — checkboxes
            update when budget or bidding strategy changes.
          </p>
        </div>
        {keywordRecs && keywordRecs.recommendedKeywordCount > 0 ? (
          <button
            type="button"
            onClick={applyKeywordRecommendations}
            className="shrink-0 text-[11px] px-2.5 py-1 rounded-md border border-orange/40 text-orange hover:bg-orange/10"
          >
            Re-apply {keywordRecs.recommendedKeywordCount} keywords
          </button>
        ) : recs.filter((k) => k.recommended !== false).length ? (
          <button
            type="button"
            onClick={applyKeywordRecommendations}
            className="shrink-0 text-[11px] px-2.5 py-1 rounded-md border border-orange/40 text-orange hover:bg-orange/10"
          >
            Apply recommended keywords
          </button>
        ) : null}
      </div>
      {keywordRecs?.selectionNote && (
        <div className="rounded-lg border border-teal/30 bg-teal/5 px-3 py-2 text-[11px] text-white/90 space-y-1">
          <p className="font-semibold text-teal">
            Select {keywordRecs.recommendedKeywordCount} of {keywordRecs.recommendedKeywords.length}{' '}
            keywords (max {keywordRecs.maxAffordableKeywords} fit {currency}{' '}
            {Number(dailyBudget) > 0 ? dailyBudget : '—'}/day)
          </p>
          <p className="text-muted leading-relaxed">{keywordRecs.selectionNote}</p>
          {showKeywordMaxCpc && keywordRecs.avgKeywordCpc > 0 && (
            <p>
              Avg max CPC{' '}
              <span className="text-orange font-semibold">
                {currency} {keywordRecs.avgKeywordCpc.toFixed(2)}
              </span>
              {' · '}
              ~{keywordRecs.estClicksPerDay} clicks/day at that bid
            </p>
          )}
          {!showKeywordMaxCpc && (
            <p className="text-teal/90">
              Maximize Conversions — Google sets bids inside your daily budget (same as Google Ads).
              Keywords are added without max CPC; only the campaign budget caps spend.
            </p>
          )}
        </div>
      )}
      {recsLoading && !keywordRecs && (
        <p className="text-muted text-xs flex items-center gap-2">
          <Loader2 size={12} className="animate-spin" /> Scoring keywords against budget…
        </p>
      )}
      {keywordRecs && (
        <>
          {keywordRecs.accountBudgetNote && (
            <p className="text-[11px] text-muted">{keywordRecs.accountBudgetNote}</p>
          )}
          {isAdMode && existingCampaign && (
            <div className="rounded-lg border border-teal/25 bg-navy/40 px-3 py-2 text-[12px] text-white/90">
              This campaign currently uses{' '}
              <span className="text-orange font-semibold">
                {campaignBidLabel(existingCampaign.biddingStrategyType)}
              </span>
              {existingCampaign.budgetDaily != null
                ? ` · daily budget ${currency} ${existingCampaign.budgetDaily}`
                : ''}
              .
              {campaignUsesKeywordBids
                ? ' Keyword max CPC bids will be written on the new ad group.'
                : ' Google sets click prices automatically — writing max CPC on keywords will not change that unless you switch bidding.'}
            </div>
          )}
          {showAdBidSwitchWarning && (
            <div className="rounded-xl border border-orange/40 bg-orange/10 px-3 py-3 space-y-2">
              <p className="text-[12px] text-white leading-relaxed">
                ⚠️ Your campaign currently uses Maximize Conversions (or another auto strategy).
                Individual keyword bids are controlled automatically by Google. To use the
                AI-recommended keyword bids, you would need to switch this campaign to Manual CPC.
              </p>
              <p className="text-[11px] text-muted">
                Current: {campaignBidLabel(existingCampaign?.biddingStrategyType)}
                <br />
                Recommended: Manual CPC
                <br />
                Reason: Allows direct control over keyword Max CPC bids.
              </p>
              <p className="text-[11px] text-muted">
                Switching bidding is a significant campaign change and is approved separately from ad
                copy.
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setBiddingSwitchDecision('keep');
                    setBiddingSwitchApproved(false);
                  }}
                  className={`text-[11px] px-2.5 py-1 rounded-md border ${
                    biddingSwitchDecision === 'keep'
                      ? 'border-teal text-teal bg-teal/10'
                      : 'border-border text-muted'
                  }`}
                >
                  Keep Maximize Conversions
                </button>
                <button
                  type="button"
                  onClick={() => setBiddingSwitchDecision('switch')}
                  className={`text-[11px] px-2.5 py-1 rounded-md border ${
                    biddingSwitchDecision === 'switch'
                      ? 'border-orange text-orange bg-orange/10'
                      : 'border-border text-muted'
                  }`}
                >
                  Review switch to Manual CPC
                </button>
              </div>
            </div>
          )}
          {!isAdMode && (
          <div className="grid sm:grid-cols-2 gap-2">
            {(keywordRecs.strategyOptions ?? []).map((opt) => {
              const selected = chosenStrategy === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => applyChosenStrategy(opt.id)}
                  className={`text-left rounded-xl border px-3 py-3 space-y-2 transition-colors ${
                    selected
                      ? 'border-orange bg-orange/10'
                      : 'border-border/70 bg-navy/40 hover:border-orange/40'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-white text-sm font-semibold">{opt.label}</p>
                    {opt.recommended ? (
                      <span className="text-[9px] uppercase tracking-wider text-teal">Suggested</span>
                    ) : null}
                  </div>
                  <p className="text-[11px] text-orange font-semibold">
                    Daily budget {currency} {Number(dailyBudget) > 0 ? dailyBudget : '—'}
                    {opt.id === 'MANUAL_CPC' && opt.recommendedMaxCpc != null
                      ? ` · avg max CPC ${currency} ${opt.recommendedMaxCpc.toFixed(2)}`
                      : opt.id === 'MAXIMIZE_CONVERSIONS' && opt.expectedConversions != null
                        ? ` · ~${opt.expectedConversions} conv/day`
                        : opt.id === 'MAXIMIZE_CONVERSIONS' && opt.typicalCpc != null
                          ? ` · typical CPC ~${currency} ${opt.typicalCpc.toFixed(2)}`
                          : ''}
                  </p>
                  {opt.id === 'MANUAL_CPC' && opt.expectedClicks != null && (
                    <p className="text-[10px] text-muted">
                      ~{opt.expectedClicks} clicks/day at the avg keyword bid
                    </p>
                  )}
                  {opt.id === 'MAXIMIZE_CONVERSIONS' && (
                    <p className="text-[10px] text-teal">
                      Google sets bids automatically — no per-keyword max CPC
                    </p>
                  )}
                  <p className="text-[11px] text-white/85 leading-relaxed">{opt.situation}</p>
                  <p className="text-[10px] text-muted leading-relaxed">{opt.howSpendWorks}</p>
                  {selected && (
                    <p className="text-[10px] text-orange font-semibold uppercase tracking-wider">Selected</p>
                  )}
                </button>
              );
            })}
          </div>
          )}
          <p className="text-white/90 text-xs leading-relaxed">{keywordRecs.summary}</p>
          <div className="grid sm:grid-cols-2 gap-2">
            {keywordRecs.themes.slice(0, 4).map((t) => (
              <div key={`${t.service}-${t.seed}`} className="rounded-lg border border-border/70 bg-navy/40 px-3 py-2">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-[11px] text-white font-medium leading-snug">
                    {t.seed}
                    <span className="text-muted font-normal"> · {t.intent}</span>
                  </p>
                  <span className="shrink-0 text-[10px] text-orange font-semibold">
                    {currency} {(t.suggestedCpc ?? 0).toFixed(2)}
                  </span>
                </div>
                {t.exact.length > 0 && (
                  <p className="text-[10px] text-muted mt-1">Exact: {t.exact.join(', ')}</p>
                )}
                {t.phrase.length > 0 && (
                  <p className="text-[10px] text-muted">Phrase: {t.phrase.join(', ')}</p>
                )}
                {t.primary.length > 0 && (
                  <p className="text-[10px] text-teal mt-0.5">Primary: {t.primary.join(', ')}</p>
                )}
              </div>
            ))}
          </div>
          <div className="overflow-x-auto rounded-lg border border-border/70">
            <table className="w-full text-[11px]">
              <thead className="bg-navy/60 text-muted uppercase tracking-wider">
                <tr>
                  <th className="text-left px-2 py-1.5 font-medium">Use</th>
                  <th className="text-left px-2 py-1.5 font-medium">Keyword</th>
                  <th className="text-left px-2 py-1.5 font-medium">Seed cluster</th>
                  <th className="text-left px-2 py-1.5 font-medium">Match</th>
                  <th className="text-right px-2 py-1.5 font-medium">G Ads avg</th>
                  <th className="text-right px-2 py-1.5 font-medium">Planner</th>
                  <th className="text-right px-2 py-1.5 font-medium">Your max CPC</th>
                </tr>
              </thead>
              <tbody>
                {recs.map((k) => {
                  const row = clusters
                    .flatMap((c) => c.keywords)
                    .find((kw) => kw.keyword.toLowerCase() === k.keyword.toLowerCase());
                  const maxCpc = showKeywordMaxCpc
                    ? row
                      ? pickBudgetSizedMaxCpc(row, budgetNumber, selectedKwCount)
                      : k.suggestedCpc
                    : undefined;
                  const plannerAtBudget =
                    row && budgetNumber > 0
                      ? budgetScaledPlannerCpc(row, budgetNumber, selectedKwCount)
                      : row?.googlePlannerAvgCpc;
                  const plannerRaw =
                    row?.googlePlannerAvgCpc ??
                    (row?.googlePlannerLowBid != null && row?.googlePlannerHighBid != null
                      ? (row.googlePlannerLowBid + row.googlePlannerHighBid) / 2
                      : undefined);
                  return (
                  <tr key={`${k.keyword}-${k.matchType}`} className="border-t border-border/50">
                    <td className="px-2 py-1.5">
                      <span className={k.recommended !== false ? 'text-teal' : 'text-muted'}>
                        {k.recommended !== false ? 'Select' : 'Skip'}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-white">
                      {k.keyword}
                      <span className="text-muted"> · {k.role}</span>
                    </td>
                    <td className="px-2 py-1.5 text-muted">{k.seed || '—'}</td>
                    <td className="px-2 py-1.5 text-muted">{k.matchType}</td>
                    <td className="px-2 py-1.5 text-right text-teal tabular-nums">
                      {row?.googleAccountAvgCpc != null
                        ? `${currency} ${row.googleAccountAvgCpc.toFixed(2)}`
                        : '—'}
                    </td>
                    <td className="px-2 py-1.5 text-right text-muted tabular-nums">
                      {plannerAtBudget != null ? (
                        <>
                          {currency} {plannerAtBudget.toFixed(2)}
                          {plannerRaw != null &&
                            budgetNumber > 0 &&
                            Math.abs(plannerRaw - plannerAtBudget) > 0.02 && (
                              <span className="block text-[9px] text-muted/80">
                                market {currency} {plannerRaw.toFixed(2)}
                              </span>
                            )}
                        </>
                      ) : row?.googlePlannerLowBid != null && row?.googlePlannerHighBid != null ? (
                        `${currency} ${row.googlePlannerLowBid.toFixed(2)}–${row.googlePlannerHighBid.toFixed(2)}`
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-right text-orange font-semibold tabular-nums">
                      {!showKeywordMaxCpc ? (
                        <span className="text-teal">Auto</span>
                      ) : maxCpc != null ? (
                        `${currency} ${Number(maxCpc).toFixed(2)}`
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                );})}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
    );
  };

  if (!open) return null;

  // ── Step 1: Discover services ──
  const handleDiscoverServices = async () => {
    if (!websiteUrl?.trim()) {
      setError('Website URL is required');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { data } = await campaignWizardApi.discoverServices(websiteUrl.trim());
      setCompanyName(data.companyName || accountName || '');
      setIndustry(data.industry || '');
      setScrapeStatus(data.scrapeStatus ?? null);
      const services = data.services ?? [];
      setDiscoveredServices(services);
      setSelectedServices(services);
      setServicesScanned(true);
      if (!services.length) {
        setError(
          data.scrapeStatus === 'blocked'
            ? 'Website blocked automated scraping — we could not read the Services section. Add each service subsection manually below.'
            : 'No service subsections were found in the website Services section. Add the services you want to advertise below.'
        );
      }
    } catch {
      setServicesScanned(true);
      setError('Could not reach the website scanner. Add your services manually below.');
    } finally {
      setLoading(false);
    }
  };

  const addCustomService = () => {
    const s = customService.trim();
    if (!s) return;
    if (!discoveredServices.includes(s)) setDiscoveredServices((prev) => [...prev, s]);
    if (!selectedServices.includes(s)) setSelectedServices((prev) => [...prev, s]);
    setCustomService('');
  };

  // ── Fetch keyword clusters from competitor ads + Ahrefs ──
  const handleFetchKeywords = async () => {
    if (!selectedServices.length) {
      setError('Select at least one service');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const budgetNum = Number(dailyBudget);
      const competitorSeeds: Record<string, string[]> = {};
      const competitorNames: string[] = [];
      const competitorAdTexts: string[] = [];
      for (const svc of selectedServices) {
        const list = competitorsByService[svc] ?? [];
        const ads = list.flatMap((c) => c.allAds ?? []);
        competitorSeeds[svc] = extractPhrasesFromCompetitorAds(
          ads.length ? ads : list.map((c) => ({ headlines: c.headlines, descriptions: c.descriptions })),
          svc
        );
        competitorNames.push(...list.map((c) => c.name));
        competitorAdTexts.push(
          ...list.flatMap((c) => [...(c.headlines ?? []), ...(c.descriptions ?? [])])
        );
      }
      const { data } = await campaignWizardApi.keywordClusters({
        websiteUrl: websiteUrl!,
        services: selectedServices,
        offer: offer.trim() || undefined,
        dailyBudget: budgetNum > 0 ? budgetNum : undefined,
        competitorSeeds,
        competitorNames,
        competitorAdTexts,
      });
      setAhrefsAvailable(data.ahrefsAvailable);
      setNegativeKeywords(data.suggestedNegatives ?? []);
      const nextClusters: KeywordCluster[] = (data.clusters ?? []).map((c) => ({
        ...c,
        seedThemes: c.seedThemes,
        keywords: c.keywords.map((k) => ({
          keyword: k.keyword,
          volume: k.volume,
          traffic: k.traffic,
          position: k.position,
          selected: true,
          difficulty: k.difficulty,
          intent: k.intent,
          matchSuggestion: k.matchSuggestion,
          role: k.role,
          seed: k.seed,
          suggestedCpc: k.suggestedCpc,
        })),
        selected: true,
      }));
      if (!nextClusters.length) {
        setError('No keyword clusters could be built. Try a more specific service name.');
        return;
      }
      setClusters(nextClusters);
      setStep('keywords');
      void loadGoogleKeywordMetrics(nextClusters);
      if (budgetNum > 0) void loadKeywordRecommendations(nextClusters, budgetNum);
      if (googleAdsCustomerId) {
        void googleAdsApi
          .budgetIntelligence(googleAdsCustomerId, 30)
          .then(({ data: budgetData }) => {
            const account = budgetData.breakdown?.account;
            if (!account) return;
            const ctx: BudgetContextPayload = {
              totalSpend: account.totalSpend,
              enabledDailyBudget: account.enabledDailyBudget,
              leftover: account.leftover,
              costPerConversion: account.costPerConversion,
              avgCpc: account.avgCpc,
              pacePercent: account.pacePercent,
              constrainedCampaigns: account.constrainedCampaigns,
              conversions: account.conversions,
              windowDays: account.windowDays,
              currency: account.currency,
            };
            setBudgetContext(ctx);
            if (budgetNum > 0) void loadKeywordRecommendations(nextClusters, budgetNum, ctx);
          })
          .catch(() => undefined);
      }
      void persistWizardActivity({
        stage: 'in_progress',
        message: 'Keyword clusters built from competitor ads and budget.',
      });
    } catch {
      setError('Failed to fetch keywords. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  // ── Discover competitors for each selected service ──
  const handleDiscoverAllCompetitors = async (opts?: { forceRefresh?: boolean }) => {
    setError(null);
    const forceRefresh = Boolean(opts?.forceRefresh);
    const services = selectedServices;
    const allAds: CompetitorAdPreview[] = [];
    const results: Record<string, WizardCompetitor[]> = {};

    fetchAbortRef.current?.abort();
    const ac = new AbortController();
    fetchAbortRef.current = ac;

    setFetchingLive(true);
    setFetchLog([]);
    setCompetitorsByService(
      Object.fromEntries(services.map((svc) => [svc, [] as WizardCompetitor[]]))
    );
    pushFetchLog(
      forceRefresh
        ? `Finding new competitors (skipping saved results) for ${services.length} service(s)…`
        : `Starting competitor fetch for ${services.length} service(s)…`
    );

    for (const svc of services) {
      if (ac.signal.aborted) break;
      setCompetitorLoading(svc);
      pushFetchLog(`Fetching competitor ads for “${svc}”…`);
      try {
        const keywords = [svc, ...(offer.trim() ? [offer.trim()] : [])].filter(Boolean);
        const { data } = await campaignWizardApi.discoverCompetitors(
          {
            websiteUrl: websiteUrl!,
            service: svc,
            keywords,
            offer: offer.trim() || undefined,
            country: targetLocations.trim() || undefined,
            forceRefresh,
          },
          { signal: ac.signal }
        );
        if (ac.signal.aborted) break;
        const list = data.competitors ?? [];
        results[svc] = list;
        allAds.push(...(data.allAds ?? []));
        setCompetitorsByService((prev) => ({ ...prev, [svc]: list }));
        pushFetchLog(
          list.length
            ? `“${svc}” — ${list.length} competitor${list.length === 1 ? '' : 's'} with relevant ads.`
            : `“${svc}” — no matching competitor ads yet.`
        );
      } catch (err) {
        if (ac.signal.aborted || (err as { code?: string })?.code === 'ERR_CANCELED') {
          pushFetchLog(`Fetch stopped for “${svc}”.`);
          break;
        }
        console.error(`Competitor discovery failed for ${svc}:`, err);
        results[svc] = [];
        setCompetitorsByService((prev) => ({ ...prev, [svc]: [] }));
        pushFetchLog(`“${svc}” — fetch failed. Check backend logs.`);
      }
    }

    setCompetitorLoading(null);
    setFetchingLive(false);
    setAllCompetitorAds(allAds);
    if (ac.signal.aborted) {
      setSuccess('Competitor fetch stopped. Any ads already found are shown below.');
      return;
    }
    const underMin = Object.entries(results).filter(([, list]) => list.length < 5);
    const totalFound = Object.values(results).reduce((n, list) => n + list.length, 0);
    if (totalFound === 0 && services.length > 0) {
      setError(
        `No competitors found in your market (${targetLocations.trim() || 'detected from website region'}). Try Find new competitors, or a more specific service / location.`
      );
      pushFetchLog('Finished — 0 competitors displayed.');
    } else if (underMin.length > 0) {
      setSuccess(
        isAdMode
          ? `Found ${totalFound} competitor${totalFound === 1 ? '' : 's'} with relevant ads (aiming for 8 per service).`
          : `Found ${totalFound} competitor${totalFound === 1 ? '' : 's'} with relevant ads.`
      );
      pushFetchLog(`Finished — displaying ${totalFound} competitor(s).`);
    } else {
      setSuccess(`Found ${totalFound} competitors with relevant ads.`);
      pushFetchLog(`Finished — displaying ${totalFound} competitor(s).`);
    }
    void persistWizardActivity({
      stage: 'in_progress',
      message: `Competitors reviewed for ${services.length} service(s).`,
    });
  };

  // ── After details: generate ads (campaign already exists or will exist) ──
  const handleContinueToGenerateAds = async () => {
    if (isAdMode && biddingSwitchDecision === 'switch' && !biddingSwitchApproved) {
      setError('Approve the bidding strategy switch separately, or keep Maximize Conversions.');
      return;
    }
    setError(null);
    if (!finalUrl.trim()) {
      setError('Final URL is required.');
      return;
    }
    if (!allAdApprovals) {
      setError('Approve all conditions before generating ads.');
      return;
    }
    const resourceName = resolveCampaignResourceName(googleAdsCustomerId, existingCampaign);
    if (!resourceName) {
      setError('This campaign is missing a Google Ads resource name. Refresh campaigns and try again.');
      return;
    }
    setCreatedCampaignResourceName(resourceName);
    await handleGenerateAds();
  };

  const buildWizardProcessSnapshot = (stage: 'in_progress' | 'campaign_created' | 'completed') => {
    const recommendedSet = new Set(
      (keywordRecs?.recommendedKeywords ?? [])
        .filter((k) => k.recommended !== false)
        .map((k) => k.keyword.toLowerCase())
    );
    const selectedKw = selectedClusters.flatMap((c) =>
      c.keywords
        .filter((k) => k.selected)
        .map((k) => ({
          keyword: k.keyword,
          matchType: k.matchSuggestion,
          maxCpc: pickBudgetSizedMaxCpc(k, Number(dailyBudget) || 0, selectedKwCount),
          role: k.role,
          seed: k.seed,
        }))
    );
    const skippedKw = selectedClusters
      .flatMap((c) => c.keywords)
      .filter((k) => !k.selected)
      .map((k) => k.keyword);

    const strategyAlternatives = (keywordRecs?.strategyOptions ?? []).map((o) => ({
      id: o.id,
      label: o.label,
      chosen: o.id === chosenStrategy,
      why: o.id === chosenStrategy ? o.situation : o.howSpendWorks,
    }));

    const stepsCompleted = [
      '1. Discover core services',
      '2. Competitor ads by service',
      '3. Keywords & bid strategy sized to daily budget',
      isAdMode ? '4. Ad details & approvals' : '4. Campaign details & create (paused)',
      ...(stage === 'completed' ? ['5. Generate ads & create RSA in Google Ads (paused)'] : []),
    ];

    return {
      stepsCompleted,
      services: {
        discovered: discoveredServices,
        selected: selectedServices,
        companyName: companyName || undefined,
        industry: industry || undefined,
        why: 'Only core leaf services were offered; parent buckets were excluded. Selected services drive competitor and keyword research.',
      },
      competitors: {
        byService: Object.entries(competitorsByService).map(([service, list]) => ({
          service,
          competitors: list.map((c) => ({
            name: c.name,
            url: c.url,
            isMostRelevant: c.isMostRelevant,
            adCount: c.totalAdCount,
            activeAdCount: c.activeAdCount,
            adDurationDays: c.adDurationDays,
            confidenceScore: c.confidenceScore,
            sampleHeadlines: (c.headlines ?? []).slice(0, 15),
            headlines: (c.headlines ?? []).slice(0, 15),
            descriptions: (c.descriptions ?? []).slice(0, 8),
            ads: (c.allAds ?? []).slice(0, 8).map((ad) => ({
              headlines: (ad.headlines ?? []).slice(0, 15),
              descriptions: (ad.descriptions ?? []).slice(0, 4),
            })),
          })),
        })),
        why: 'Competitors and creatives were matched to each selected service. The most relevant rivals were preferred for ad inspiration.',
      },
      keywords: {
        selected: selectedKw,
        skipped: skippedKw,
        negatives: negativeKeywords,
        recommendedCount: keywordRecs?.recommendedKeywordCount,
        dailyBudget: Number(dailyBudget) || undefined,
        bidStrategy: chosenStrategy,
        bidStrategyAlternatives: strategyAlternatives,
        clusters: selectedClusters.map((c) => ({
          service: c.service,
          topKeyword: c.topKeyword,
          selected: c.selected,
          keywords: c.keywords.map((k) => ({
            keyword: k.keyword,
            matchType: k.matchSuggestion,
            maxCpc: pickBudgetSizedMaxCpc(k, Number(dailyBudget) || 0, selectedKwCount),
            role: k.role,
            seed: k.seed,
            selected: k.selected,
            volume: k.volume,
          })),
        })),
        why:
          chosenStrategy === 'MAXIMIZE_CONVERSIONS'
            ? 'Maximize Conversions was chosen so Google auto-bids inside the daily budget (no per-keyword max CPC). Keywords were selected for conversion learning density.'
            : `Manual / Maximum CPC was chosen so each keyword keeps a budget-sized max CPC. ${
                recommendedSet.size
                  ? `${recommendedSet.size} keywords were recommended for the daily budget; others were left unselected.`
                  : 'Keyword selection was sized to the daily budget and planner CPC.'
              }`,
      },
      campaign: {
        name: isAdMode ? existingCampaign?.name : campaignName.trim(),
        type: campaignType,
        dailyBudget: Number(dailyBudget) || undefined,
        biddingStrategy: chosenStrategy,
        locations: targetLocations.trim() || undefined,
        resourceName: createdCampaignResourceName || undefined,
        why: isAdMode
          ? `Ad created inside existing campaign “${existingCampaign?.name ?? 'campaign'}” without creating a new campaign shell.`
          : `New ${campaignType} campaign created paused in Google Ads with daily budget ${dailyBudget} and bidding ${chosenStrategy}.`,
      },
      ads:
        generatedAds.length || selectedAd
          ? {
              generatedVariants: generatedAds.map((a) => ({
                id: a.id,
                label: a.label,
                chosen: Boolean(selectedAd && a.id === selectedAd.id),
                headlines: a.headlines,
                descriptions: a.descriptions,
                keywords: a.keywords,
                focusedCompetitor: a.focusedCompetitor,
                displayPaths: a.displayPaths,
                finalUrl: finalUrl.trim() || undefined,
              })),
              selected: selectedAd
                ? {
                    label: selectedAd.label,
                    headlines: selectedAd.headlines,
                    descriptions: selectedAd.descriptions,
                    keywords: selectedAd.keywords,
                    finalUrl: finalUrl.trim(),
                    displayPaths: selectedAd.displayPaths,
                    focusedCompetitor: selectedAd.focusedCompetitor,
                  }
                : undefined,
              offer: offer.trim() || undefined,
              audience: audience.trim() || undefined,
              tone: tone.trim() || undefined,
              why: selectedAd
                ? `Selected ad variant “${selectedAd.label}” over ${Math.max(
                    0,
                    generatedAds.length - 1
                  )} other generated option(s) for publish.`
                : 'Ad variants were generated; none selected yet.',
            }
          : undefined,
      approvals: isAdMode ? adApprovals : campaignApprovals,
    };
  };

  const persistWizardActivity = async (opts: {
    stage: 'in_progress' | 'campaign_created' | 'completed';
    campaignResourceName?: string;
    adResourceName?: string;
    adGroupResourceName?: string;
    keywordsAdded?: number;
    message?: string;
  }) => {
    try {
      const process = {
        ...buildWizardProcessSnapshot(opts.stage),
        googleResult: {
          campaignResourceName: opts.campaignResourceName || createdCampaignResourceName || undefined,
          adResourceName: opts.adResourceName,
          adGroupResourceName: opts.adGroupResourceName,
          keywordsAdded: opts.keywordsAdded,
          message: opts.message,
        },
      };
      await campaignWizardApi.saveActivity({
        auditRunId: auditId || undefined,
        googleAdsCustomerId,
        mode: isAdMode ? 'ad' : 'campaign',
        stage: opts.stage,
        title: isAdMode
          ? `Create Ad — ${existingCampaign?.name ?? 'campaign'}`
          : `Create Campaign — ${campaignName.trim() || selectedServices.join(' + ') || 'new campaign'}`,
        summary:
          opts.message ||
          (opts.stage === 'completed'
            ? 'Wizard completed: campaign/ad created paused in Google Ads with the choices below.'
            : opts.stage === 'campaign_created'
              ? 'Campaign shell created paused; ad generation followed.'
              : `Wizard in progress — ${opts.stage}.`),
        process,
        campaignResourceName: opts.campaignResourceName || createdCampaignResourceName || undefined,
        adResourceName: opts.adResourceName,
        campaignName: isAdMode ? existingCampaign?.name : campaignName.trim() || undefined,
      });
    } catch (err) {
      console.warn('[wizard] failed to save activity for report:', err);
    }
  };

  // ── Create campaign, then generate ads ──
  const handleCreateCampaign = async () => {
    setError(null);
    if (!campaignName.trim() || !(budgetNumber > 0) || !allApprovals || !euPolicyLoaded) {
      setError('Fill all required fields, enter a daily budget, and approve all conditions.');
      return;
    }
    setSubmitting(true);
    try {
      const { data } = await googleAdsApi.createCampaign({
        googleAdsCustomerId,
        campaignName: campaignName.trim(),
        dailyBudget: budgetNumber,
        biddingStrategy,
        campaignType,
        targetGoogleSearch: true,
        targetSearchNetwork: true,
        targetContentNetwork: false,
        containsEuPoliticalAdvertising: false,
        targetLocations: targetLocations.trim() || undefined,
        clientApprovals: {
          ...campaignApprovals,
          euPoliticalDeclared: requiresEuPoliticalAdvertising
            ? campaignApprovals.euPoliticalDeclared
            : true,
        },
        cpcBidCeiling: chosenStrategy === 'MANUAL_CPC' ? keywordRecs?.recommendedMaxCpc : undefined,
        auditRunId: auditId || undefined,
        wizardProcess: {
          ...buildWizardProcessSnapshot('campaign_created'),
          googleResult: {
            message: 'Paused campaign created in Google Ads.',
          },
        },
      });
      if (!data.success || !data.campaignResourceName) {
        setError(data.message || data.error || 'Campaign creation failed.');
        return;
      }
      setCreatedCampaignResourceName(data.campaignResourceName);
      setSuccess('Campaign created (paused). Generating ads…');
      setSubmitting(false);
      void persistWizardActivity({
        stage: 'campaign_created',
        campaignResourceName: data.campaignResourceName,
        message: data.message || 'Paused campaign created in Google Ads.',
      });
      await handleGenerateAds();
    } catch (err) {
      const data = (err as { response?: { data?: { error?: string; message?: string } } })?.response
        ?.data;
      const msg = data?.message || data?.error || 'Campaign creation failed.';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  // ── Step 5: Generate ads ──
  const handleGenerateAds = async () => {
    setLoading(true);
    setError(null);
    try {
      const allCompetitors = Object.values(competitorsByService).flat();
      const topCompetitors = allCompetitors
        .sort((a, b) => (b.confidenceScore ?? 0) - (a.confidenceScore ?? 0))
        .slice(0, 5);

      const { data } = await campaignWizardApi.generateAds({
        companyName,
        websiteUrl: websiteUrl!,
        service: selectedClusters.map((c) => c.service).join(', '),
        keywords: allSelectedKeywords.slice(0, 30),
        competitors: topCompetitors.map((c) => ({
          name: c.name,
          headlines: c.headlines,
          descriptions: c.descriptions,
          totalAdCount: c.totalAdCount,
          adDurationDays: c.adDurationDays,
          isMostRelevant: c.isMostRelevant,
        })),
        offer: offer.trim() || undefined,
        audience: audience.trim() || undefined,
        tone: tone.trim() || undefined,
        finalUrl: finalUrl.trim() || undefined,
        locationFocus: targetLocations.trim() || undefined,
      });
      setGeneratedAds(data.ads ?? []);
      setSelectedAdId(data.ads?.[0]?.id ?? null);
      setAdChatById({});
      setAdChatInput('');
      setStep('generate-ads');
      void persistWizardActivity({
        stage: createdCampaignResourceName ? 'campaign_created' : 'in_progress',
        campaignResourceName: createdCampaignResourceName || undefined,
        message: 'AI ad variants generated.',
      });
    } catch {
      setError('Failed to generate ads. Try again.');
    } finally {
      setLoading(false);
    }
  };

  const updateSelectedAdField = (
    field: 'headlines' | 'descriptions',
    index: number,
    value: string
  ) => {
    if (!selectedAd) return;
    const maxLen = field === 'headlines' ? 30 : 90;
    const nextValue = value.slice(0, maxLen);
    setGeneratedAds((prev) =>
      prev.map((ad) => {
        if (ad.id !== selectedAd.id) return ad;
        const list = [...(ad[field] ?? [])];
        list[index] = nextValue;
        return { ...ad, [field]: list };
      })
    );
  };

  const addSelectedAdField = (field: 'headlines' | 'descriptions') => {
    if (!selectedAd) return;
    const maxCount = field === 'headlines' ? 15 : 4;
    if ((selectedAd[field] ?? []).length >= maxCount) return;
    setGeneratedAds((prev) =>
      prev.map((ad) =>
        ad.id === selectedAd.id ? { ...ad, [field]: [...(ad[field] ?? []), ''] } : ad
      )
    );
  };

  const removeSelectedAdField = (field: 'headlines' | 'descriptions', index: number) => {
    if (!selectedAd) return;
    const minCount = field === 'headlines' ? 3 : 1;
    if ((selectedAd[field] ?? []).length <= minCount) return;
    setGeneratedAds((prev) =>
      prev.map((ad) =>
        ad.id === selectedAd.id
          ? { ...ad, [field]: (ad[field] ?? []).filter((_, i) => i !== index) }
          : ad
      )
    );
  };

  const handleAdChatSend = async () => {
    if (!selectedAd || !adChatInput.trim() || refiningAd) return;
    const instruction = adChatInput.trim();
    const adId = selectedAd.id;
    const history = adChatById[adId] ?? [];

    setAdChatInput('');
    setAdChatById((prev) => ({
      ...prev,
      [adId]: [...(prev[adId] ?? []), { role: 'user', content: instruction }],
    }));
    setRefiningAd(true);
    setError(null);

    try {
      const { data } = await campaignWizardApi.refineAd({
        companyName,
        websiteUrl: websiteUrl!,
        service: selectedClusters.map((c) => c.service).join(', '),
        keywords: allSelectedKeywords.slice(0, 20),
        offer: offer.trim() || undefined,
        locationFocus: targetLocations.trim() || undefined,
        instruction,
        currentAd: {
          id: selectedAd.id,
          label: selectedAd.label,
          headlines: selectedAd.headlines,
          descriptions: selectedAd.descriptions,
          displayPaths: selectedAd.displayPaths,
          keywords: selectedAd.keywords,
          focusedCompetitor: selectedAd.focusedCompetitor,
        },
        chatHistory: history,
      });

      setGeneratedAds((prev) =>
        prev.map((ad) => (ad.id === adId ? { ...ad, ...data.ad, id: adId } : ad))
      );
      setAdChatById((prev) => ({
        ...prev,
        [adId]: [
          ...(prev[adId] ?? []),
          { role: 'assistant', content: data.reply || 'Updated the ad copy.' },
        ],
      }));
    } catch {
      setAdChatById((prev) => ({
        ...prev,
        [adId]: [
          ...(prev[adId] ?? []),
          {
            role: 'assistant',
            content: 'Sorry — I could not update the ad. Try again with a clearer request.',
          },
        ],
      }));
      setError('Failed to refine ad copy. Try again.');
    } finally {
      setRefiningAd(false);
    }
  };

  // ── Create ad in campaign ──
  const handleCreateAd = async () => {
    if (!createdCampaignResourceName || !selectedAd) return;
    setSubmitting(true);
    setError(null);
    try {
      const willSwitch =
        isAdMode && biddingSwitchDecision === 'switch' && biddingSwitchApproved;
      if (willSwitch && createdCampaignResourceName) {
        const switchRes = await googleAdsApi.updateCampaignBidding({
          googleAdsCustomerId,
          campaignResourceName: createdCampaignResourceName,
          biddingStrategy: 'MANUAL_CPC',
          clientApprovals: { authorizeBiddingSwitch: true },
        });
        if (!switchRes.data.success) {
          setError(switchRes.data.message || 'Could not switch campaign bidding. Ad was not created.');
          return;
        }
      }
      const writeKeywordBids = isAdMode
        ? campaignUsesKeywordBids || willSwitch
        : chosenStrategy === 'MANUAL_CPC';
      const { data } = await googleAdsApi.createAdInCampaign({
        googleAdsCustomerId,
        campaignResourceName: createdCampaignResourceName,
        adGroupName: `${selectedClusters[0]?.service ?? 'Core Services'}`,
        keywords: selectedAd.keywords.length ? selectedAd.keywords : allSelectedKeywords.slice(0, 20),
        keywordMatchType: keywordRecs?.defaultMatchType ?? 'PHRASE',
        keywordBids: writeKeywordBids
          ? selectedClusters
              .flatMap((c) => c.keywords.filter((k) => k.selected))
              .map((k) => ({
                keyword: k.keyword,
                matchType: (k.matchSuggestion ?? keywordRecs?.defaultMatchType ?? 'PHRASE') as
                  | 'EXACT'
                  | 'PHRASE',
                cpc: pickBudgetSizedMaxCpc(k, budgetNumber, selectedKwCount),
              }))
              .filter((k) => k.cpc != null && k.cpc > 0)
          : undefined,
        defaultCpc: writeKeywordBids ? keywordRecs?.recommendedMaxCpc : undefined,
        automatedBidding: isAdMode
          ? !(campaignUsesKeywordBids || willSwitch)
          : chosenStrategy === 'MAXIMIZE_CONVERSIONS',
        headlines: selectedAd.headlines,
        descriptions: selectedAd.descriptions,
        finalUrl: finalUrl.trim(),
        path1: selectedAd.displayPaths?.path1,
        path2: selectedAd.displayPaths?.path2,
        negativeKeywords: negativeKeywords.filter(Boolean),
        clientApprovals: isAdMode
          ? adApprovals
          : {
              authorizeCreateAd: true,
              pausedAdUnderstood: true,
              landingPageApproved: true,
              copyApproved: true,
              accountAccessConfirmed: true,
            },
        auditRunId: auditId || undefined,
        campaignName: isAdMode ? existingCampaign?.name : campaignName.trim(),
        wizardMode: isAdMode ? 'ad' : 'campaign',
        wizardProcess: {
          ...buildWizardProcessSnapshot('completed'),
          googleResult: {
            campaignResourceName: createdCampaignResourceName || undefined,
            message: 'Paused ad created in Google Ads.',
          },
        },
      });
      if (!data.success) {
        setError(data.message || 'Ad creation failed.');
        return;
      }
      setSuccess(
        isAdMode
          ? `Paused ad created in “${existingCampaign?.name ?? 'campaign'}”. Enable it in Google Ads when ready.`
          : 'Campaign + ad created successfully in Google Ads (paused).'
      );
      setStep('done');
      await persistWizardActivity({
        stage: 'completed',
        campaignResourceName: createdCampaignResourceName || data.campaignResourceName || undefined,
        adResourceName: data.adResourceName,
        adGroupResourceName: data.adGroupResourceName,
        keywordsAdded: data.keywordsAdded,
        message: data.message,
      });
      onCreated?.();
    } catch (err) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        'Ad creation failed.';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const stepLabels: Record<WizardStep, string> = {
    services: 'Step 1 — Discover services',
    competitors: 'Step 2 — Competitor ads',
    keywords: 'Step 3 — Keywords & bids',
    'campaign-settings': isAdMode
      ? 'Step 4 — Ad details'
      : 'Step 4 — Campaign details & create',
    'generate-ads': 'Step 5 — AI-generated ads',
    done: 'Complete',
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/70">
      <div className="w-full max-w-5xl max-h-[92vh] overflow-y-auto rounded-2xl border border-border bg-navy shadow-2xl">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-border bg-navy/95 px-5 py-4 backdrop-blur">
          <div>
            <h2 className="text-white font-bold text-lg flex items-center gap-2">
              <Plus size={18} className="text-orange" />
              {isAdMode ? 'Create Ad' : 'Create Campaign'}
            </h2>
            <p className="text-muted text-xs mt-1">
              {isAdMode && existingCampaign
                ? `${existingCampaign.name} · `
                : accountName
                  ? `${accountName} · `
                  : ''}
              {stepLabels[step]}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted hover:text-white p-2 rounded-lg hover:bg-panel"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-6">
          {/* ── STEP 1: Services ── */}
          {step === 'services' && (
            <>
              <section className="space-y-3">
                <h3 className="text-white text-sm font-semibold flex items-center gap-2">
                  <Globe size={16} className="text-teal" />
                  Discover your company's services
                </h3>
                <p className="text-muted text-xs">
                  We&apos;ll read the website{' '}
                  <strong className="text-white/90">Services</strong> menu and keep only{' '}
                  <strong className="text-white/90">core offerings</strong> (e.g. AI SEO, Local SEO)
                  — not parent buckets like &quot;SEO Services&quot; — for{' '}
                  <span className="text-white">{websiteUrl || 'your website'}</span>.
                  Industry/location pages and case studies are excluded.
                </p>

                {!servicesScanned && (
                  <Button onClick={() => void handleDiscoverServices()} loading={loading} disabled={loading}>
                    {loading ? 'Scanning website…' : 'Scan website for services'}
                  </Button>
                )}

                {servicesScanned && (
                  <div className="space-y-3">
                    {companyName && (
                      <p className="text-xs text-white">
                        <span className="text-muted">Company:</span> {companyName}
                        {industry && <span className="text-muted"> · {industry}</span>}
                        {scrapeStatus === 'inferred' && (
                          <span className="text-orange ml-1">(could not read Services section — verify below)</span>
                        )}
                      </p>
                    )}
                    <p className="text-xs text-muted">
                      {discoveredServices.length > 0
                        ? isAdMode
                          ? 'Select the services you want to create ads for. You can add or remove any.'
                          : 'Select the services you want to create campaigns for. You can add or remove any.'
                        : isAdMode
                          ? 'Add the services you want to advertise. You can add multiple.'
                          : 'Add the services you want to advertise. You can add multiple.'}
                    </p>
                    {discoveredServices.length > 0 && (
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setSelectedServices([...discoveredServices])}
                          className="text-[10px] text-teal underline"
                        >
                          Select all services
                        </button>
                        <span className="text-muted text-[10px]">·</span>
                        <button
                          type="button"
                          onClick={() => setSelectedServices([])}
                          className="text-[10px] text-orange underline"
                        >
                          Deselect all services
                        </button>
                      </div>
                    )}
                    {discoveredServices.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {discoveredServices.map((s) => {
                          const checked = selectedServices.includes(s);
                          return (
                            <button
                              key={s}
                              type="button"
                              onClick={() =>
                                setSelectedServices((prev) =>
                                  checked ? prev.filter((x) => x !== s) : [...prev, s]
                                )
                              }
                              className={`px-3 py-1.5 rounded-lg border text-xs transition-colors ${
                                checked
                                  ? 'border-teal bg-teal/15 text-white'
                                  : 'border-border bg-panel/50 text-muted hover:border-teal/40'
                              }`}
                            >
                              {checked && <CheckCircle2 size={12} className="inline mr-1 text-teal" />}
                              {s}
                            </button>
                          );
                        })}
                      </div>
                    )}
                    <div className="flex gap-2">
                      <input
                        value={customService}
                        onChange={(e) => setCustomService(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && addCustomService()}
                        placeholder="Add a service (e.g. Home Loans, Car Finance)…"
                        className="flex-1 rounded-lg border border-border bg-panel px-3 py-2 text-xs text-white"
                      />
                      <Button size="sm" variant="outline" onClick={addCustomService}>
                        <Plus size={14} /> Add
                      </Button>
                    </div>

                    {selectedServices.length > 0 && (
                      <div className="rounded-lg border border-teal/25 bg-teal/5 px-3 py-2">
                        <p className="text-[10px] uppercase tracking-wider text-teal mb-1">
                          Selected ({selectedServices.length})
                        </p>
                        <p className="text-xs text-white">{selectedServices.join(' · ')}</p>
                      </div>
                    )}

                    <label className="block">
                      <span className="text-[11px] text-muted uppercase tracking-wider">
                        Special offer / promo (optional)
                      </span>
                      <input
                        value={offer}
                        onChange={(e) => setOffer(e.target.value)}
                        placeholder="e.g. Free quote, 20% off first month"
                        className="mt-1 w-full rounded-lg border border-border bg-panel px-3 py-2 text-xs text-white"
                      />
                    </label>

                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setServicesScanned(false);
                        setDiscoveredServices([]);
                        setSelectedServices([]);
                        setScrapeStatus(null);
                        setError(null);
                      }}
                    >
                      Rescan website
                    </Button>
                  </div>
                )}
              </section>
            </>
          )}

          {/* ── STEP 2: Keywords ── */}
          {step === 'keywords' && (
            <section className="space-y-4">
              <h3 className="text-white text-sm font-semibold flex items-center gap-2">
                <Search size={16} className="text-orange" />
                Keyword clusters by service
                {!ahrefsAvailable && (
                  <span className="text-orange text-[10px] font-normal ml-2">
                    (Keyword research limited — live Google Ads data still applies)
                  </span>
                )}
              </h3>
              <p className="text-muted text-xs">
                Phrase and exact clusters from competitor ad copy plus search-volume research. When Google Ads is
                connected, we pull live avg CPC from your account (if the keyword already runs)
                and Keyword Planner estimates for new terms. Enter your daily budget — max CPCs
                and click estimates are sized to that amount.
              </p>

              {googleMetricsLoading && (
                <p className="text-[11px] text-teal flex items-center gap-2">
                  <Loader2 size={12} className="animate-spin" />
                  Loading live CPC data from Google Ads…
                </p>
              )}
              {googleAdsCustomerId && !googleMetricsLoading && googlePlannerAvailable && (
                <p className="text-[11px] text-teal/90">
                  Google Ads Keyword Planner metrics loaded ({googleMetricsCurrency}). Planner and max
                  CPC values scale to your daily budget{showKeywordMaxCpc ? ' — edit max CPC per keyword below' : ' — auto-bidding selected'}.
                </p>
              )}

              {keywordBudgetStats && (
                <div className="rounded-xl border border-teal/25 bg-teal/5 px-3 py-2 text-[11px] text-white/90 grid sm:grid-cols-3 gap-2">
                  <p>
                    <span className="text-muted">Selected keywords</span>{' '}
                    <span className="font-semibold">{keywordBudgetStats.count}</span>
                  </p>
                  {keywordBudgetStats.mode === 'manual' ? (
                    <>
                      <p>
                        <span className="text-muted">Avg max CPC</span>{' '}
                        <span className="font-semibold text-orange">
                          {googleMetricsCurrency} {keywordBudgetStats.avgCpc.toFixed(2)}
                        </span>
                      </p>
                      <p>
                        <span className="text-muted">Est. clicks/day</span>{' '}
                        <span className="font-semibold">
                          ~{keywordBudgetStats.estClicksAtAvg} at avg bid · ~{keywordBudgetStats.estClicksAtMax}{' '}
                          at highest bid
                        </span>
                      </p>
                    </>
                  ) : (
                    <>
                      <p>
                        <span className="text-muted">Typical CPC</span>{' '}
                        <span className="font-semibold text-teal">
                          {keywordBudgetStats.typicalCpc != null
                            ? `${googleMetricsCurrency} ${keywordBudgetStats.typicalCpc.toFixed(2)}`
                            : '—'}
                        </span>
                      </p>
                      <p>
                        <span className="text-muted">Est. conversions/day</span>{' '}
                        <span className="font-semibold">
                          {keywordBudgetStats.estConversions != null
                            ? `~${keywordBudgetStats.estConversions} (Google auto-bids)`
                            : 'Google sets bids within your budget'}
                        </span>
                      </p>
                    </>
                  )}
                </div>
              )}

              <label className="block max-w-xs">
                <span className="text-[11px] text-muted uppercase tracking-wider">
                  {isAdMode ? 'Daily budget (for bid sizing) *' : 'Daily budget *'}
                </span>
                <input
                  type="number"
                  min={1}
                  step={0.01}
                  value={dailyBudget}
                  onChange={(e) => {
                    setDailyBudget(e.target.value);
                    setKeywordRecs(null);
                    recsBudgetKeyRef.current = '';
                    autoAppliedRecsKeyRef.current = '';
                  }}
                  placeholder="Enter daily budget"
                  className="mt-1 w-full rounded-lg border border-border bg-panel px-3 py-2 text-sm text-white"
                />
                <span className="text-[10px] text-muted mt-1 block">
                  {isAdMode && existingCampaign?.budgetDaily
                    ? `This campaign’s Google Ads budget is ${budgetContext?.currency || 'AUD'} ${existingCampaign.budgetDaily}/day. Change it here only to size keyword bids.`
                    : 'Required. We do not pick a default budget.'}
                </span>
              </label>

              <div className="rounded-xl border border-border bg-panel/40 p-3 space-y-2">
                  <p className="text-[11px] uppercase tracking-wider text-muted">
                    Negative keywords
                  </p>
                  <p className="text-[11px] text-muted">
                    Suggested from competitor brands and informational ad copy. Click a term to
                    remove it, or add more.
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {negativeKeywords.map((term) => (
                      <button
                        key={term}
                        type="button"
                        onClick={() =>
                          setNegativeKeywords((prev) => prev.filter((t) => t !== term))
                        }
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-orange/30 text-[11px] text-orange"
                      >
                        − {term}
                        <X size={10} />
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <input
                      value={newNegative}
                      onChange={(e) => setNewNegative(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && newNegative.trim()) {
                          setNegativeKeywords((prev) =>
                            prev.includes(newNegative.trim()) ? prev : [...prev, newNegative.trim()]
                          );
                          setNewNegative('');
                        }
                      }}
                      placeholder="Add negative keyword…"
                      className="flex-1 rounded-md border border-border bg-navy px-2 py-1 text-[11px] text-white"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        if (!newNegative.trim()) return;
                        setNegativeKeywords((prev) =>
                          prev.includes(newNegative.trim()) ? prev : [...prev, newNegative.trim()]
                        );
                        setNewNegative('');
                      }}
                    >
                      Add
                    </Button>
                  </div>
                </div>

              {renderKeywordStrategyPanel()}

              {clusters.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setClusters((prev) =>
                        prev.map((c) => ({
                          ...c,
                          selected: true,
                          keywords: c.keywords.map((k) => ({ ...k, selected: true })),
                        }))
                      )
                    }
                    className="text-[11px] text-teal hover:underline"
                  >
                    Select all
                  </button>
                  <span className="text-muted text-[11px]">·</span>
                  <button
                    type="button"
                    onClick={() =>
                      setClusters((prev) =>
                        prev.map((c) => ({
                          ...c,
                          selected: false,
                          keywords: c.keywords.map((k) => ({ ...k, selected: false })),
                        }))
                      )
                    }
                    className="text-[11px] text-orange hover:underline"
                  >
                    Deselect all keywords
                  </button>
                </div>
              )}

              {clusters.length === 0 && (
                <p className="text-muted text-sm py-4">No keyword clusters found. Try adding more specific services.</p>
              )}

              {clusters.map((cluster, ci) => (
                <div
                  key={cluster.service}
                  className={`rounded-xl border p-4 space-y-2 transition-colors ${
                    cluster.selected
                      ? 'border-teal/40 bg-teal/5'
                      : 'border-border bg-panel/30 opacity-60'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={cluster.selected}
                        onChange={() =>
                          setClusters((prev) =>
                            prev.map((c, i) =>
                              i === ci ? { ...c, selected: !c.selected } : c
                            )
                          )
                        }
                        className="accent-teal"
                      />
                      <span className="text-white text-sm font-medium">{cluster.service}</span>
                    </label>
                    <div className="flex gap-3 text-[10px] text-muted">
                      <span>
                        {cluster.keywords.filter((k) => k.selected).length}/{cluster.keywords.length}{' '}
                        keywords
                      </span>
                      <span>Vol: {cluster.totalVolume.toLocaleString()}</span>
                      <span>Traffic: {cluster.totalTraffic.toLocaleString()}</span>
                    </div>
                  </div>

                  {cluster.selected && (
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 pb-0.5">
                        <button
                          type="button"
                          onClick={() =>
                            setClusters((prev) =>
                              prev.map((c, i) =>
                                i === ci
                                  ? {
                                      ...c,
                                      keywords: c.keywords.map((k) => ({ ...k, selected: true })),
                                    }
                                  : c
                              )
                            )
                          }
                          className="text-[10px] text-teal hover:underline"
                        >
                          Select all
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setClusters((prev) =>
                              prev.map((c, i) =>
                                i === ci
                                  ? {
                                      ...c,
                                      keywords: c.keywords.map((k) => ({ ...k, selected: false })),
                                    }
                                  : c
                              )
                            )
                          }
                          className="text-[10px] text-orange hover:underline"
                        >
                          Deselect all keywords
                        </button>
                      </div>
                      {(() => {
                        const themes = (cluster.seedThemes ?? []).slice(0, 4);
                        const assigned = new Set(
                          themes.flatMap((t) =>
                            [...t.primary, ...t.secondary].map((k) => k.keyword.toLowerCase())
                          )
                        );
                        const groups =
                          themes.length >= 2
                            ? [
                                ...themes.map((theme) => ({
                                  seed: theme.seed,
                                  intent: theme.intent,
                                  keywords: cluster.keywords.filter(
                                    (k) =>
                                      k.seed?.toLowerCase() === theme.seed.toLowerCase() ||
                                      theme.primary.some((p) => p.keyword.toLowerCase() === k.keyword.toLowerCase()) ||
                                      theme.secondary.some((p) => p.keyword.toLowerCase() === k.keyword.toLowerCase())
                                  ),
                                })),
                                {
                                  seed: 'Other related',
                                  intent: 'commercial' as const,
                                  keywords: cluster.keywords.filter((k) => !assigned.has(k.keyword.toLowerCase())),
                                },
                              ].filter((g) => g.keywords.length)
                            : [{ seed: cluster.service, intent: 'commercial' as const, keywords: cluster.keywords }];
                        const toggleKw = (keyword: string) =>
                          setClusters((prev) =>
                            prev.map((c, i) =>
                              i === ci
                                ? {
                                    ...c,
                                    keywords: c.keywords.map((k) =>
                                      k.keyword === keyword ? { ...k, selected: !k.selected } : k
                                    ),
                                  }
                                : c
                            )
                          );
                        return (
                          <div className="space-y-2">
                            {groups.map((group) => (
                              <div key={group.seed} className="rounded-lg border border-border/60 bg-navy/30 px-2.5 py-2">
                                <p className="text-[10px] text-white font-medium mb-1.5">
                                  Seed: {group.seed}
                                  <span className="text-muted font-normal"> · {group.intent} · exact + phrase</span>
                                </p>
                                <div className="flex flex-wrap gap-1.5">
                                  {group.keywords.map((kw) => (
                                    <div
                                      key={kw.keyword}
                                      className={`inline-flex flex-col gap-1 px-2 py-1 rounded-md border text-[11px] min-w-[140px] ${
                                        kw.selected
                                          ? 'bg-navy border-teal/40 text-white'
                                          : 'bg-panel/40 border-border text-muted'
                                      }`}
                                    >
                                      <label className="flex items-center gap-1 cursor-pointer">
                                        <input
                                          type="checkbox"
                                          checked={kw.selected}
                                          onChange={() => toggleKw(kw.keyword)}
                                          className="accent-teal"
                                        />
                                        <span className="font-medium">{kw.keyword}</span>
                                        {recommendedKeywordSet.has(kw.keyword.toLowerCase()) && (
                                          <span className="text-[8px] uppercase tracking-wider text-teal font-semibold">
                                            Recommended
                                          </span>
                                        )}
                                        {!recommendedKeywordSet.has(kw.keyword.toLowerCase()) &&
                                          keywordRecs &&
                                          kw.selected && (
                                            <span className="text-[8px] uppercase tracking-wider text-muted">
                                              Over budget
                                            </span>
                                          )}
                                      </label>
                                      <div className="flex flex-wrap items-center gap-1 text-[9px] pl-5">
                                        <span className="text-muted">({kw.volume || kw.googlePlannerSearches || 0})</span>
                                        {kw.matchSuggestion ? (
                                          <span className="text-teal/80 uppercase">{kw.matchSuggestion}</span>
                                        ) : null}
                                      </div>
                                      {(kw.googleAccountAvgCpc != null ||
                                        kw.googlePlannerAvgCpc != null ||
                                        kw.googleAccountMaxCpc != null) && (
                                        <div className="text-[9px] pl-5 space-y-0.5 text-muted">
                                          {kw.googleAccountAvgCpc != null && (
                                            <p>
                                              Account avg{' '}
                                              <span className="text-teal">
                                                {googleMetricsCurrency} {kw.googleAccountAvgCpc.toFixed(2)}
                                              </span>
                                              {kw.googleAccountClicks ? ` · ${kw.googleAccountClicks} clicks` : ''}
                                            </p>
                                          )}
                                          {kw.googlePlannerAvgCpc != null && (
                                            <p>
                                              Planner at budget{' '}
                                              <span className="text-teal">
                                                {googleMetricsCurrency}{' '}
                                                {(budgetNumber > 0
                                                  ? budgetScaledPlannerCpc(kw, budgetNumber, selectedKwCount)
                                                  : kw.googlePlannerAvgCpc
                                                )?.toFixed(2) ?? kw.googlePlannerAvgCpc.toFixed(2)}
                                              </span>
                                              {budgetNumber > 0 &&
                                                Math.abs(
                                                  kw.googlePlannerAvgCpc -
                                                    (budgetScaledPlannerCpc(kw, budgetNumber, selectedKwCount) ??
                                                      kw.googlePlannerAvgCpc)
                                                ) > 0.02 && (
                                                  <span className="text-muted/80">
                                                    {' '}
                                                    (market {googleMetricsCurrency}{' '}
                                                    {kw.googlePlannerAvgCpc.toFixed(2)})
                                                  </span>
                                                )}
                                            </p>
                                          )}
                                          {kw.googlePlannerLowBid != null && kw.googlePlannerHighBid != null && (
                                            <p>
                                              Bid range {googleMetricsCurrency}{' '}
                                              {kw.googlePlannerLowBid.toFixed(2)}–
                                              {kw.googlePlannerHighBid.toFixed(2)}
                                            </p>
                                          )}
                                        </div>
                                      )}
                                      {showKeywordMaxCpc ? (
                                        <label className="flex items-center gap-1 pl-5 text-[10px]">
                                          <span className="text-muted shrink-0">Max CPC</span>
                                          <input
                                            type="number"
                                            min={0.01}
                                            step={0.01}
                                            value={
                                              pickBudgetSizedMaxCpc(kw, budgetNumber, selectedKwCount) ?? ''
                                            }
                                            onChange={(e) => {
                                              const v = Number(e.target.value);
                                              if (!(v > 0)) return;
                                              setClusters((prev) =>
                                                prev.map((c, i) =>
                                                  i === ci
                                                    ? {
                                                        ...c,
                                                        keywords: c.keywords.map((k) =>
                                                          k.keyword === kw.keyword
                                                            ? {
                                                                ...k,
                                                                userMaxCpc: v,
                                                                suggestedCpc: v,
                                                                userEditedCpc: true,
                                                              }
                                                            : k
                                                        ),
                                                      }
                                                    : c
                                                )
                                              );
                                            }}
                                            className="w-16 rounded border border-border bg-navy px-1 py-0.5 text-orange tabular-nums"
                                          />
                                        </label>
                                      ) : (
                                        <p className="pl-5 text-[10px] text-teal">Max CPC — Auto (Google sets bids)</p>
                                      )}
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setClusters((prev) =>
                                            prev.map((c, i) =>
                                              i === ci
                                                ? {
                                                    ...c,
                                                    keywords: c.keywords.filter((k) => k.keyword !== kw.keyword),
                                                  }
                                                : c
                                            )
                                          )
                                        }
                                        className="text-[9px] text-muted hover:text-red-400 pl-5 text-left"
                                      >
                                        Remove
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        );
                      })()}
                      <div className="flex gap-2 pt-1">
                        <input
                          value={editingCluster === cluster.service ? newKeyword : ''}
                          onChange={(e) => {
                            setEditingCluster(cluster.service);
                            setNewKeyword(e.target.value);
                          }}
                          onFocus={() => setEditingCluster(cluster.service)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && newKeyword.trim()) {
                              setClusters((prev) =>
                                prev.map((c, i) =>
                                  i === ci
                                    ? {
                                        ...c,
                                        keywords: [
                                          ...c.keywords,
                                          {
                                            keyword: newKeyword.trim(),
                                            volume: 0,
                                            traffic: 0,
                                            position: 0,
                                            selected: true,
                                          },
                                        ],
                                      }
                                    : c
                                )
                              );
                              setNewKeyword('');
                            }
                          }}
                          placeholder="Add keyword…"
                          className="flex-1 min-w-0 rounded-md border border-border bg-navy px-2 py-1 text-[11px] text-white"
                        />
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </section>
          )}

          {/* ── STEP 3: Campaign settings (or ad settings in ad mode) ── */}
          {step === 'campaign-settings' && (
            <>
              {isAdMode && existingCampaign && (
                <section className="rounded-xl border border-teal/30 bg-teal/5 px-4 py-3 space-y-1">
                  <p className="text-[11px] uppercase tracking-wider text-muted">Target campaign</p>
                  <p className="text-white text-sm font-semibold">{existingCampaign.name}</p>
                  <p className="text-muted text-xs">
                    {getCampaignTypeMeta(
                      resolveAccountCampaignType({
                        type: existingCampaign.type,
                        name: existingCampaign.name,
                      })
                    ).label}{' '}
                    · a paused RSA will be added to this campaign
                  </p>
                  <p className="text-[11px] text-orange mt-1">
                    Bidding from Google Ads: {campaignBidLabel(existingCampaign.biddingStrategyType)}
                  </p>
                </section>
              )}

              {isAdMode && biddingSwitchDecision === 'switch' && (
                <section className="rounded-xl border border-orange/40 bg-orange/10 px-4 py-3 space-y-2">
                  <p className="text-white text-sm font-semibold">Separate bidding approval</p>
                  <p className="text-[12px] text-white/85 leading-relaxed">
                    Approving ad copy does not switch bidding. Confirm here to change this campaign
                    from {campaignBidLabel(existingCampaign?.biddingStrategyType)} to Manual CPC, then
                    write the AI keyword max CPC bids.
                  </p>
                  <label className="flex items-start gap-2 text-sm text-white cursor-pointer">
                    <input
                      type="checkbox"
                      checked={biddingSwitchApproved}
                      onChange={() => setBiddingSwitchApproved((v) => !v)}
                      className="accent-orange mt-0.5"
                    />
                    I authorize switching this campaign to Manual CPC
                  </label>
                </section>
              )}

              {!isAdMode && (
                <section className="space-y-3">
                  <h3 className="text-white text-sm font-semibold">Campaign type</h3>
                  <div className="grid sm:grid-cols-2 gap-2">
                    {CREATABLE_TYPES.map((t) => {
                      const count = typeCounts?.[t.key] ?? 0;
                      const selected = campaignType === t.key;
                      return (
                        <button
                          key={t.key}
                          type="button"
                          onClick={() => setCampaignType(t.key)}
                          className={`text-left rounded-xl border px-3 py-2 transition-colors ${
                            selected
                              ? 'border-orange bg-orange/10'
                              : 'border-border bg-panel/50 hover:border-orange/40'
                          }`}
                        >
                          <span className="text-white text-sm font-medium">
                            {t.shortLabel}
                            <span className="text-muted font-normal"> ({count})</span>
                          </span>
                          {selected && (
                            <span className="text-[10px] ml-2 uppercase tracking-wider text-orange font-semibold">
                              Selected
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </section>
              )}

              <section className="space-y-3">
                <h3 className="text-white text-sm font-semibold">
                  {isAdMode ? 'Ad details' : 'Campaign details'}
                </h3>
                {!isAdMode && keywordRecs && (
                  <div className="rounded-xl border border-teal/25 bg-teal/5 px-3 py-2 text-[11px] text-white/85">
                    Plan from keywords:{' '}
                    <span className="text-teal font-semibold">
                      {chosenStrategy === 'MAXIMIZE_CONVERSIONS' ? 'Maximize conversions' : 'Maximum CPC'}
                    </span>
                    {' · '}
                    daily budget {budgetContext?.currency || 'AUD'} {dailyBudget}
                    {chosenStrategy === 'MANUAL_CPC' && keywordRecs.recommendedMaxCpc
                      ? ` · max CPC ${(budgetContext?.currency || 'AUD')} ${keywordRecs.recommendedMaxCpc.toFixed(2)}`
                      : ''}
                    . You can still edit budget below.
                  </div>
                )}
                <div className="grid sm:grid-cols-2 gap-3">
                  {!isAdMode && (
                    <>
                      <label className="block sm:col-span-2">
                        <span className="text-[11px] text-muted uppercase tracking-wider">Campaign name *</span>
                        <input
                          value={campaignName}
                          onChange={(e) => setCampaignName(e.target.value)}
                          className="mt-1 w-full rounded-lg border border-border bg-panel px-3 py-2 text-sm text-white"
                          placeholder={`e.g. ${selectedTypeMeta.shortLabel} — ${selectedClusters[0]?.service ?? 'Core Services'}`}
                        />
                      </label>
                      <label className="block sm:col-span-2">
                        <span className="text-[11px] text-muted uppercase tracking-wider">Daily budget *</span>
                        <input
                          type="number"
                          min={1}
                          value={dailyBudget}
                          onChange={(e) => setDailyBudget(e.target.value)}
                          className="mt-1 w-full rounded-lg border border-border bg-panel px-3 py-2 text-sm text-white"
                        />
                      </label>
                    </>
                  )}
                  <label className="block sm:col-span-2">
                    <span className="text-[11px] text-muted uppercase tracking-wider">Target locations</span>
                    <input
                      value={targetLocations}
                      onChange={(e) => setTargetLocations(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-border bg-panel px-3 py-2 text-sm text-white"
                      placeholder="e.g. Melbourne VIC, Australia"
                    />
                  </label>
                  <label className="block sm:col-span-2">
                    <span className="text-[11px] text-muted uppercase tracking-wider">Final URL *</span>
                    <input
                      value={finalUrl}
                      onChange={(e) => setFinalUrl(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-border bg-panel px-3 py-2 text-sm text-white"
                      placeholder="https://"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[11px] text-muted uppercase tracking-wider">Audience</span>
                    <input
                      value={audience}
                      onChange={(e) => setAudience(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-border bg-panel px-3 py-2 text-sm text-white"
                      placeholder="e.g. Homeowners in Melbourne"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[11px] text-muted uppercase tracking-wider">Tone</span>
                    <input
                      value={tone}
                      onChange={(e) => setTone(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-border bg-panel px-3 py-2 text-sm text-white"
                    />
                  </label>
                </div>
              </section>

              <section className="space-y-2">
                <h3 className="text-white text-sm font-semibold flex items-center gap-2">
                  <AlertTriangle size={16} className="text-orange" />
                  Critical client approvals
                </h3>
                {!isAdMode && !euPolicyLoaded && (
                  <p className="text-[11px] text-muted">Checking EU political advertising status for this account…</p>
                )}
                {(isAdMode ? AD_APPROVALS : campaignApprovalItems).map((item) => (
                  <label
                    key={item.key}
                    className="flex items-center gap-3 rounded-xl border border-border bg-panel/50 p-3 cursor-pointer hover:border-orange/30 text-sm text-white"
                  >
                    <input
                      type="checkbox"
                      checked={
                        isAdMode
                          ? adApprovals[item.key as AdApprovalKey]
                          : campaignApprovals[item.key as CampaignApprovalKey]
                      }
                      onChange={() => {
                        if (isAdMode) {
                          const key = item.key as AdApprovalKey;
                          setAdApprovals((prev) => ({ ...prev, [key]: !prev[key] }));
                        } else {
                          const key = item.key as CampaignApprovalKey;
                          setCampaignApprovals((prev) => ({ ...prev, [key]: !prev[key] }));
                        }
                      }}
                      className="accent-orange"
                    />
                    {item.label}
                  </label>
                ))}
              </section>
            </>
          )}

          {/* ── STEP 4: Competitors ── */}
          {step === 'competitors' && (
            <section className="space-y-4">
              <h3 className="text-white text-sm font-semibold flex items-center gap-2">
                <Users size={16} className="text-purple-400" />
                Competitor ads by service
              </h3>
              <p className="text-muted text-xs">
                Competitors and ads are matched to each selected core service
                (related offerings — exact keywords not required). English ads only,
                region-matched rivals. Aim for up to 8 relevant advertisers per service when
                available.
                <span className="text-yellow-400"> ⭐ Gold</span> = most relevant for that service.
              </p>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={fetchingLive || !selectedServices.length}
                  onClick={() => void handleDiscoverAllCompetitors({ forceRefresh: true })}
                  className="gap-1.5"
                >
                  {fetchingLive ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <RefreshCw size={14} />
                  )}
                  Find new competitors
                </Button>
                <span className="text-[10px] text-muted">
                  Skips saved results and discovers fresh rivals for your selected services
                </span>
              </div>

              {(fetchingLive || fetchLog.length > 0) && (
                <div className="rounded-xl border border-purple-400/25 bg-purple-400/5 p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-white text-xs font-semibold flex items-center gap-2">
                      {fetchingLive ? (
                        <Loader2 size={14} className="animate-spin text-purple-300" />
                      ) : (
                        <CheckCircle2 size={14} className="text-teal" />
                      )}
                      {fetchingLive
                        ? `Live fetch — ${competitorLoading ? `“${competitorLoading}”` : 'running'}…`
                        : 'Competitor fetch complete'}
                    </p>
                    {fetchingLive && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => stopCompetitorFetch('Stopped by user.')}
                      >
                        Stop fetching
                      </Button>
                    )}
                  </div>
                  <div className="max-h-36 overflow-y-auto rounded-lg border border-border/50 bg-navy/60 px-2 py-1.5 font-mono text-[10px] text-muted space-y-0.5">
                    {fetchLog.map((line, i) => (
                      <p key={`${line}-${i}`} className="leading-relaxed">
                        {line}
                      </p>
                    ))}
                  </div>
                </div>
              )}

              {Object.entries(competitorsByService).map(([svc, competitors]) => (
                <div key={svc} className="space-y-2">
                  <p className="text-white text-sm font-medium border-b border-border pb-1 flex items-center justify-between gap-2">
                    <span>{svc}</span>
                    <span
                      className={`text-[10px] font-normal px-1.5 py-0.5 rounded-full border ${
                        competitors.length >= 8
                          ? 'border-teal/40 text-teal bg-teal/10'
                          : 'border-orange/40 text-orange bg-orange/10'
                      }`}
                    >
                      {competitors.length}/8 competitors
                    </span>
                  </p>
                  {competitors.length === 0 && (
                    <p className="text-muted text-xs">No competitors found for this service.</p>
                  )}
                  <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {competitors.map((c) => (
                      <div
                        key={c.name}
                        className={`rounded-xl border p-3 space-y-2 ${
                          c.isMostRelevant
                            ? 'border-yellow-400/60 bg-yellow-400/5 ring-1 ring-yellow-400/30'
                            : 'border-border bg-panel/50'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <h4 className="text-white text-xs font-semibold flex items-center gap-1.5">
                            {c.isMostRelevant && <Star size={12} className="text-yellow-400 fill-yellow-400" />}
                            {c.name}
                          </h4>
                          {c.confidenceScore != null && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-teal/10 text-teal border border-teal/25">
                              {c.confidenceScore}/100
                            </span>
                          )}
                        </div>
                        <div className="flex gap-2 text-[10px] text-muted">
                          <span>
                            {(c.allAds ?? []).filter(isDisplayableCompetitorAd).length} relevant ads
                          </span>
                          <span title="Days advertising on Google Ads">
                            {c.adDurationDays > 0 ? `${c.adDurationDays}d` : '—'}
                          </span>
                          <span title="Active creatives in library">
                            {c.activeAdCount > 0 ? `${c.activeAdCount} active` : '0 active'}
                          </span>
                        </div>
                        {(() => {
                          const displayAds = (c.allAds?.length
                            ? c.allAds
                            : [
                                {
                                  headlines: c.headlines,
                                  descriptions: c.descriptions,
                                  previewImageUrl: c.previewImageUrl,
                                  syntheticCopy: false,
                                },
                              ]
                          ).filter(isDisplayableCompetitorAd);
                          if (!displayAds.length) {
                            return (
                              <p className="text-muted text-[10px] italic">
                                No live ad copy yet — open the advertiser page for current creatives.
                              </p>
                            );
                          }
                          return displayAds.map((ad, adIdx) => (
                            <div
                              key={adIdx}
                              className="rounded-lg border border-border/60 bg-panel/30 p-2 space-y-1"
                            >
                              <p className="text-[10px] text-muted uppercase tracking-wide">
                                Ad {adIdx + 1}
                              </p>
                              {(ad.headlines ?? [])
                                .filter((h) => h.trim() && !/shop now/i.test(h))
                                .slice(0, 3)
                                .map((h, i) => (
                                  <p key={i} className="text-blue-300 text-[11px] leading-snug truncate">
                                    {h}
                                  </p>
                                ))}
                              {(ad.descriptions ?? [])
                                .filter((d) => d.trim() && !/^visit .+ for quality service/i.test(d))
                                .slice(0, 1)
                                .map((d, i) => (
                                  <p key={i} className="text-muted text-[10px] leading-relaxed line-clamp-2">
                                    {d}
                                  </p>
                                ))}
                              {!(ad.headlines?.length || ad.descriptions?.length) &&
                                (ad.previewImageUrl || c.previewImageUrl) && (
                                  <img
                                    src={ad.previewImageUrl ?? c.previewImageUrl}
                                    alt={`${c.name} ad preview`}
                                    className="rounded-md border border-border/60 max-h-24 object-contain w-full bg-white/5"
                                  />
                                )}
                              {(ad.creativeUrl || ad.adLink) && (
                                <a
                                  href={ad.creativeUrl || ad.adLink}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-[10px] text-teal underline block"
                                >
                                  View this ad →
                                </a>
                              )}
                            </div>
                          ));
                        })()}
                        <a
                          href={transparencyCenterHref(c)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[10px] text-teal underline"
                        >
                          View live ads →
                        </a>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </section>
          )}

          {/* ── STEP 5: Generated ads ── */}
          {step === 'generate-ads' && (
            <section className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-white text-sm font-semibold flex items-center gap-2">
                  <Sparkles size={16} className="text-teal" />
                  AI-generated ads ({generatedAds.length})
                </h3>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void handleGenerateAds()}
                  disabled={loading}
                >
                  {loading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                  Regenerate
                </Button>
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                {generatedAds.map((ad) => {
                  const isSelected = ad.id === selectedAdId;
                  return (
                    <button
                      key={ad.id}
                      type="button"
                      onClick={() => setSelectedAdId(ad.id)}
                      className={`text-left rounded-xl border p-4 space-y-2 transition-colors ${
                        isSelected
                          ? 'border-teal bg-teal/10 ring-1 ring-teal/30'
                          : 'border-border bg-panel/50 hover:border-teal/40'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-white text-xs font-semibold">{ad.label}</span>
                        {isSelected && (
                          <span className="text-[10px] uppercase tracking-wider text-teal font-semibold">
                            Selected
                          </span>
                        )}
                      </div>
                      {ad.focusedCompetitor && (
                        <p className="text-purple-300 text-[10px]">
                          Focused on: {ad.focusedCompetitor}
                        </p>
                      )}
                      <div className="space-y-0.5">
                        {ad.headlines.slice(0, 4).map((h, i) => (
                          <p key={i} className="text-blue-300 text-[11px] truncate">
                            {h}
                          </p>
                        ))}
                        {ad.headlines.length > 4 && (
                          <p className="text-muted text-[10px]">+{ad.headlines.length - 4} more headlines</p>
                        )}
                      </div>
                      <p className="text-muted text-[10px] line-clamp-2">{ad.descriptions[0]}</p>
                    </button>
                  );
                })}
              </div>

              {selectedAd && (
                <div className="rounded-xl border border-orange/30 bg-orange/5 p-4 space-y-4">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-white text-sm font-semibold">Selected ad — edit & chat</h3>
                    <span className="text-[10px] text-muted">{selectedAd.label}</span>
                  </div>

                  <AdPreviewPanel
                    headlines={selectedAd.headlines.filter((h) => h.trim())}
                    descriptions={selectedAd.descriptions.filter((d) => d.trim())}
                    displayUrl={hostFromUrl(finalUrl)}
                    displayPaths={selectedAd.displayPaths}
                    finalUrl={finalUrl.trim()}
                    device={previewDevice}
                    onDeviceChange={setPreviewDevice}
                    variant="optimized"
                  />

                  <div className="grid lg:grid-cols-2 gap-4">
                    <div className="rounded-lg border border-border bg-navy/40 p-3 space-y-3">
                      <div className="flex items-center justify-between">
                        <p className="text-[10px] uppercase tracking-wider text-muted">
                          Headlines ({selectedAd.headlines.length}/15 · max 30 chars)
                        </p>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={selectedAd.headlines.length >= 15}
                          onClick={() => addSelectedAdField('headlines')}
                        >
                          <Plus size={12} /> Add
                        </Button>
                      </div>
                      <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                        {selectedAd.headlines.map((h, i) => (
                          <div key={`h-${i}`} className="flex gap-2 items-center">
                            <input
                              value={h}
                              maxLength={30}
                              onChange={(e) => updateSelectedAdField('headlines', i, e.target.value)}
                              className="flex-1 min-w-0 rounded-lg border border-border bg-panel px-2 py-1.5 text-[11px] text-blue-300"
                              placeholder={`Headline ${i + 1}`}
                            />
                            <span className="text-[9px] text-muted w-6 text-right shrink-0">
                              {h.length}
                            </span>
                            <button
                              type="button"
                              disabled={selectedAd.headlines.length <= 3}
                              onClick={() => removeSelectedAdField('headlines', i)}
                              className="p-1.5 rounded border border-border text-muted hover:text-red-300 disabled:opacity-30"
                              aria-label="Remove headline"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        ))}
                      </div>

                      <div className="flex items-center justify-between pt-1">
                        <p className="text-[10px] uppercase tracking-wider text-muted">
                          Descriptions ({selectedAd.descriptions.length}/4 · max 90 chars)
                        </p>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={selectedAd.descriptions.length >= 4}
                          onClick={() => addSelectedAdField('descriptions')}
                        >
                          <Plus size={12} /> Add
                        </Button>
                      </div>
                      <div className="space-y-2">
                        {selectedAd.descriptions.map((d, i) => (
                          <div key={`d-${i}`} className="space-y-1">
                            <div className="flex gap-2 items-start">
                              <textarea
                                value={d}
                                maxLength={90}
                                rows={2}
                                onChange={(e) =>
                                  updateSelectedAdField('descriptions', i, e.target.value)
                                }
                                className="flex-1 min-w-0 rounded-lg border border-border bg-panel px-2 py-1.5 text-[11px] text-white/90 resize-none"
                                placeholder={`Description ${i + 1}`}
                              />
                              <button
                                type="button"
                                disabled={selectedAd.descriptions.length <= 1}
                                onClick={() => removeSelectedAdField('descriptions', i)}
                                className="p-1.5 rounded border border-border text-muted hover:text-red-300 disabled:opacity-30"
                                aria-label="Remove description"
                              >
                                <Trash2 size={12} />
                              </button>
                            </div>
                            <p className="text-[9px] text-muted text-right">{d.length}/90</p>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="rounded-lg border border-teal/30 bg-teal/5 p-3 space-y-3 flex flex-col min-h-[280px]">
                      <div className="flex items-center gap-2">
                        <MessageSquare size={14} className="text-teal" />
                        <p className="text-white text-xs font-semibold">Ad copy chatbot</p>
                      </div>
                      <p className="text-[10px] text-muted">
                        Tell the AI how to rewrite this ad — e.g. “make headlines more urgent”,
                        “add Melbourne”, “focus on free consultation”.
                      </p>
                      <div className="flex-1 max-h-44 overflow-y-auto space-y-2 rounded-lg border border-border/60 bg-navy/50 p-2">
                        {(adChatById[selectedAd.id] ?? []).length === 0 && (
                          <p className="text-[10px] text-muted italic px-1 py-2">
                            No messages yet. Ask for a rewrite and the headlines/descriptions will update.
                          </p>
                        )}
                        {(adChatById[selectedAd.id] ?? []).map((msg, i) => (
                          <div
                            key={`${msg.role}-${i}`}
                            className={`rounded-lg px-2 py-1.5 text-[11px] ${
                              msg.role === 'user'
                                ? 'bg-orange/15 text-white ml-4'
                                : 'bg-panel text-teal/90 mr-4'
                            }`}
                          >
                            <p className="text-[9px] uppercase tracking-wider opacity-70 mb-0.5">
                              {msg.role === 'user' ? 'You' : 'AI'}
                            </p>
                            {msg.content}
                          </div>
                        ))}
                        {refiningAd && (
                          <p className="text-[10px] text-muted flex items-center gap-1.5">
                            <Loader2 size={12} className="animate-spin" /> Rewriting ad copy…
                          </p>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <input
                          value={adChatInput}
                          onChange={(e) => setAdChatInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault();
                              void handleAdChatSend();
                            }
                          }}
                          disabled={refiningAd}
                          placeholder="Describe the change you want…"
                          className="flex-1 rounded-lg border border-border bg-panel px-3 py-2 text-xs text-white disabled:opacity-50"
                        />
                        <Button
                          size="sm"
                          disabled={refiningAd || !adChatInput.trim()}
                          onClick={() => void handleAdChatSend()}
                          className="gap-1"
                        >
                          {refiningAd ? (
                            <Loader2 size={14} className="animate-spin" />
                          ) : (
                            <Send size={14} />
                          )}
                          Send
                        </Button>
                      </div>
                    </div>
                  </div>

                  {selectedAd.keywords.length > 0 && (
                    <p className="text-[11px] text-muted">
                      Keywords: {selectedAd.keywords.join(', ')}
                    </p>
                  )}
                </div>
              )}
            </section>
          )}

          {/* ── DONE ── */}
          {step === 'done' && (
            <div className="rounded-xl border border-teal/30 bg-teal/10 px-4 py-5 space-y-2">
              <p className="text-teal font-semibold flex items-center gap-2">
                <CheckCircle2 size={18} />
                Done
              </p>
              <p className="text-sm text-white/90">
                {isAdMode
                  ? `Your paused RSA is in “${existingCampaign?.name ?? 'the campaign'}”. Enable it in Google Ads when you're ready to serve.`
                  : "Your paused campaign and RSA ad are in Google Ads. Enable them when you're ready to serve."}
              </p>
            </div>
          )}

          {/* Error / Success */}
          {error && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {error}
            </div>
          )}
          {success && step !== 'done' && (
            <div className="rounded-xl border border-teal/30 bg-teal/10 px-3 py-2 text-sm text-teal flex gap-2">
              <CheckCircle2 size={16} className="shrink-0 mt-0.5" />
              <span>{success}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 flex items-center justify-between gap-2 border-t border-border bg-navy/95 px-5 py-4 backdrop-blur">
          <div>
            {step !== 'services' && step !== 'done' && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setError(null);
                  const prev: Record<WizardStep, WizardStep> = {
                    services: 'services',
                    competitors: 'services',
                    keywords: 'competitors',
                    'campaign-settings': 'keywords',
                    'generate-ads': 'campaign-settings',
                    done: 'done',
                  };
                  setStep(prev[step]);
                }}
                disabled={submitting || loading || fetchingLive}
              >
                ← Back
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              onClick={() => {
                stopCompetitorFetch('Fetch cancelled.');
                onClose();
              }}
              disabled={submitting || loading}
            >
              {step === 'done' ? 'Close' : 'Cancel'}
            </Button>

            {step === 'services' && servicesScanned && (
              <Button
                onClick={() => {
                  setError(null);
                  setStep('competitors');
                  void handleDiscoverAllCompetitors().then(() =>
                    persistWizardActivity({
                      stage: 'in_progress',
                      message: 'Services selected; competitor research started.',
                    })
                  );
                }}
                disabled={loading || fetchingLive || !selectedServices.length}
                loading={fetchingLive}
              >
                {fetchingLive
                  ? 'Finding competitors…'
                  : `Find competitors for ${selectedServices.length} service(s)`}
              </Button>
            )}

            {step === 'competitors' && (
              <Button
                onClick={() => void handleFetchKeywords()}
                disabled={loading || fetchingLive || !selectedServices.length}
                loading={loading}
              >
                {loading ? 'Building keyword clusters…' : 'Build keywords from competitor ads'}
              </Button>
            )}

            {step === 'keywords' && (
              <Button
                onClick={() => {
                  if (!selectedClusters.length) {
                    setError('Select at least one keyword cluster');
                    return;
                  }
                  if (!allSelectedKeywords.length) {
                    setError('Select at least one keyword');
                    return;
                  }
                  if (!(budgetNumber > 0)) {
                    setError('Enter a daily budget so keyword bids can be sized to it.');
                    return;
                  }
                  setError(null);
                  if (!isAdMode) applyChosenStrategy(chosenStrategy);
                  if (!isAdMode) {
                    setCampaignName(
                      `Search — ${selectedClusters.map((c) => c.service).join(' + ')}`
                    );
                  }
                  void loadKeywordRecommendations(clusters, budgetNumber);
                  setStep('campaign-settings');
                  void persistWizardActivity({
                    stage: 'in_progress',
                    message: 'Keywords and bid strategy selected.',
                  });
                }}
                disabled={!selectedClusters.length || !allSelectedKeywords.length || !(budgetNumber > 0)}
              >
                {isAdMode ? 'Continue to ad details' : 'Continue to campaign details'}
              </Button>
            )}

            {step === 'campaign-settings' && (
              <Button
                onClick={() =>
                  void (isAdMode ? handleContinueToGenerateAds() : handleCreateCampaign())
                }
                disabled={
                  submitting ||
                  loading ||
                  !finalUrl.trim() ||
                  (isAdMode
                    ? !allAdApprovals
                    : !campaignName.trim() || !(budgetNumber > 0) || !allApprovals || !euPolicyLoaded)
                }
                loading={submitting || loading}
              >
                {isAdMode ? 'Generate AI ads' : 'Create campaign & generate ads'}
              </Button>
            )}

            {step === 'generate-ads' && (
              <Button
                onClick={() => void handleCreateAd()}
                disabled={
                  submitting ||
                  !selectedAd ||
                  !createdCampaignResourceName ||
                  (isAdMode && biddingSwitchDecision === 'switch' && !biddingSwitchApproved)
                }
                loading={submitting}
              >
                {isAdMode ? 'Create paused ad' : 'Create paused ad in campaign'}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
