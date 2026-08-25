import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Target, Megaphone, Search, RefreshCw, Filter, Plus } from 'lucide-react';
import clsx from 'clsx';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { CampaignCard } from '../connect/CampaignCard';
import { CreateCampaignModal } from './CreateCampaignModal';
import { googleAdsApi, auditApi } from '../../services/api';
import type { GoogleAdsCampaign } from '../../types/connect';
import type { Finding } from '../../types';
import {
  ACCOUNT_CAMPAIGN_TYPES,
  campaignMatchesService,
  deriveServiceFilters,
  getCampaignTypeMeta,
  resolveAccountCampaignType,
  type AccountCampaignTypeKey,
} from '../../utils/campaignTypes';
import { buildAdOptimizeFinding, inferServiceFromAd } from '../../utils/adServiceInference';
import type { GoogleAdsCampaignAd } from '../../types/connect';
import type { AdCompetitorUpload } from './CampaignAdPreview';

interface CampaignAuditsSectionProps {
  auditId: string;
  googleAdsCustomerId?: string;
  dataWindowDays?: number;
  auditScope?: 'account' | 'campaign';
  parentAuditId?: string;
  campaignName?: string;
  websiteUrl?: string;
  onOptimizeCampaign?: (finding: Finding, campaign: GoogleAdsCampaign) => void;
  onOptimizeAd?: (
    finding: Finding,
    campaign: GoogleAdsCampaign,
    ad: GoogleAdsCampaignAd,
    competitors?: AdCompetitorUpload,
    requestedService?: string
  ) => void;
}

function formatGoogleAdsCustomerId(id: string): string {
  const bare = id.replace(/\D/g, '');
  if (bare.length !== 10) return id;
  return `${bare.slice(0, 3)}-${bare.slice(3, 6)}-${bare.slice(6)}`;
}

function optimizeFindingFor(campaign: GoogleAdsCampaign): Finding {
  return {
    id: `camp-opt-${campaign.id}`,
    severity: 'HIGH',
    title: `Optimize campaign: ${campaign.name}`,
    description: campaign.adCount > 0
      ? `AI optimization for ${campaign.name} (${campaign.type}, ${campaign.status}) — improve existing ads.`
      : `AI recommendations for ${campaign.name} (${campaign.type}, ${campaign.status}) — no responsive search ads found; generate new copy and strategy.`,
    recommendation: campaign.adCount > 0
      ? 'Generate improved ad copy and extensions for this campaign.'
      : 'Generate new ad copy, asset recommendations, and campaign strategy for this campaign.',
    confidence: 85,
    impactMonthly: 0,
    category: 'AD_COPY',
    dimension: 'Ad Copy Review',
    status: 'OPEN',
  };
}

export function CampaignAuditsSection({
  auditId,
  googleAdsCustomerId,
  dataWindowDays = 30,
  auditScope,
  parentAuditId,
  campaignName,
  websiteUrl,
  onOptimizeCampaign,
  onOptimizeAd,
}: CampaignAuditsSectionProps) {
  const navigate = useNavigate();
  const [campaigns, setCampaigns] = useState<GoogleAdsCampaign[]>([]);
  const [currency, setCurrency] = useState('AUD');
  const [metricsWindowDays, setMetricsWindowDays] = useState(dataWindowDays);
  const [loading, setLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createAdCampaign, setCreateAdCampaign] = useState<GoogleAdsCampaign | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [startingId, setStartingId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [dataSource, setDataSource] = useState<'google_ads_api' | 'mock' | null>(null);
  const [typeFilter, setTypeFilter] = useState<AccountCampaignTypeKey | 'all'>('all');
  const [serviceFilter, setServiceFilter] = useState<string | 'all'>('all');
  const [websiteServices, setWebsiteServices] = useState<string[]>([]);
  const [competitorUploads, setCompetitorUploads] = useState<Record<string, AdCompetitorUpload>>({});

  const isCampaignAudit = auditScope === 'campaign';
  const customerId = googleAdsCustomerId ? formatGoogleAdsCustomerId(googleAdsCustomerId) : undefined;

  const loadCampaigns = useCallback(async () => {
    if (!customerId || isCampaignAudit) return;
    setLoading(true);
    setError(null);
    try {
      const { data } = await googleAdsApi.campaigns(customerId, dataWindowDays);
      setCampaigns(data.campaigns ?? []);
      setCurrency(data.account?.currency || data.performance?.currency || 'AUD');
      setMetricsWindowDays(data.metricsWindowDays ?? dataWindowDays);
      setDataSource(data.source ?? null);
      if (!data.campaigns?.length && data.source === 'google_ads_api') {
        setError('No campaigns returned from Google Ads for this account. Try refreshing or reconnecting Google Ads.');
      }
    } catch (err) {
      setCampaigns([]);
      const message = err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { error?: string } } }).response?.data?.error
        : undefined;
      setError(message || 'Could not load campaigns from Google Ads. Try refreshing the page.');
    } finally {
      setLoading(false);
    }
  }, [customerId, isCampaignAudit, dataWindowDays]);

  useEffect(() => {
    void loadCampaigns();
  }, [loadCampaigns]);

  useEffect(() => {
    if (!auditId || isCampaignAudit) return;
    let cancelled = false;
    void auditApi
      .companyServices(auditId)
      .then((res) => {
        if (!cancelled) setWebsiteServices(res.data.services ?? []);
      })
      .catch(() => {
        if (!cancelled) setWebsiteServices([]);
      });
    return () => {
      cancelled = true;
    };
  }, [auditId, isCampaignAudit, websiteUrl]);

  const handleCampaignAudit = async (campaign: GoogleAdsCampaign) => {
    const parentId = parentAuditId ?? auditId;
    setStartingId(campaign.id);
    setError(null);
    try {
      const { data } = await auditApi.startCampaign({
        parentAuditId: parentId,
        campaignId: campaign.id,
        campaignName: campaign.name,
      });
      navigate(`/processing/${data.auditId}`);
    } catch {
      setError(`Failed to start audit for "${campaign.name}". Please try again.`);
      setStartingId(null);
    }
  };

  const typedCampaigns = useMemo(
    () =>
      campaigns.map((c) => ({
        campaign: c,
        typeKey: resolveAccountCampaignType({
          type: c.type,
          name: c.name,
          ads: c.ads,
        }),
      })),
    [campaigns]
  );

  const availableTypes = useMemo(() => {
    // Always show every Google Ads campaign type, including types with 0 campaigns
    return ACCOUNT_CAMPAIGN_TYPES.filter((t) => t.key !== 'other').concat(
      typedCampaigns.some((t) => t.typeKey === 'other')
        ? ACCOUNT_CAMPAIGN_TYPES.filter((t) => t.key === 'other')
        : []
    );
  }, [typedCampaigns]);

  const typeCounts = useMemo(() => {
    const counts = {} as Record<AccountCampaignTypeKey, number>;
    for (const t of ACCOUNT_CAMPAIGN_TYPES) counts[t.key] = 0;
    for (const row of typedCampaigns) counts[row.typeKey] = (counts[row.typeKey] ?? 0) + 1;
    return counts;
  }, [typedCampaigns]);

  const serviceOptions = useMemo(
    () => deriveServiceFilters(websiteServices, campaigns),
    [websiteServices, campaigns]
  );

  const serviceCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const service of serviceOptions) {
      counts[service] = campaigns.filter((c) => campaignMatchesService(c, service)).length;
    }
    return counts;
  }, [serviceOptions, campaigns]);

  const filteredTyped = useMemo(() => {
    const q = search.trim().toLowerCase();
    return typedCampaigns.filter(({ campaign, typeKey }) => {
      if (typeFilter !== 'all' && typeKey !== typeFilter) return false;
      if (serviceFilter !== 'all' && !campaignMatchesService(campaign, serviceFilter)) return false;
      if (q && !campaign.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [typedCampaigns, typeFilter, serviceFilter, search]);

  const groupedByType = useMemo(() => {
    // Always include every standard type so empty buckets show as 0
    const keys = ACCOUNT_CAMPAIGN_TYPES
      .map((t) => t.key)
      .filter((k) => k !== 'other' || typedCampaigns.some((t) => t.typeKey === 'other'));

    return keys.map((key) => ({
      key,
      campaigns: filteredTyped.filter((t) => t.typeKey === key).map((t) => t.campaign),
      totalInAccount: typeCounts[key] ?? 0,
    }));
  }, [filteredTyped, typedCampaigns, typeCounts]);

  const activeTypeMeta =
    typeFilter === 'all' ? null : getCampaignTypeMeta(typeFilter);

  const renderCampaignCard = (campaign: GoogleAdsCampaign) => (
    <CampaignCard
      key={campaign.id}
      campaign={campaign}
      variant="action"
      currency={currency}
      auditing={startingId === campaign.id}
      serviceFilter={serviceFilter}
      competitorUploads={competitorUploads}
      onCompetitorUploadChange={(adId, upload) => {
        setCompetitorUploads((prev) => {
          if (!upload) {
            const next = { ...prev };
            delete next[adId];
            return next;
          }
          return { ...prev, [adId]: upload };
        });
      }}
      onAudit={() => void handleCampaignAudit(campaign)}
      onOptimize={
        onOptimizeCampaign
          ? () => onOptimizeCampaign(optimizeFindingFor(campaign), campaign)
          : undefined
      }
      onCreateAd={() => {
        setCreateOpen(false);
        setCreateAdCampaign(campaign);
      }}
      googleAdsCustomerId={googleAdsCustomerId}
      onSettingsUpdated={() => void loadCampaigns()}
      onOptimizeAd={
        onOptimizeAd
          ? (ad, competitors) => {
              const inferred = inferServiceFromAd(ad);
              const effectiveService =
                serviceFilter !== 'all' ? serviceFilter : inferred.primaryService;
              onOptimizeAd(
                buildAdOptimizeFinding(campaign.id, campaign.name, ad, effectiveService),
                campaign,
                ad,
                competitors ?? competitorUploads[ad.id],
                effectiveService
              );
            }
          : undefined
      }
    />
  );

  if (isCampaignAudit) {
    return (
      <section id="campaign-audits" className="scroll-mt-24">
        <div className="bg-teal/5 border border-teal/30 rounded-xl p-5">
          <div className="flex items-start gap-3">
            <Megaphone size={20} className="text-teal shrink-0 mt-0.5" />
            <div>
              <p className="text-white font-medium text-sm">
                Campaign audit: {campaignName ?? 'Selected campaign'}
              </p>
              <p className="text-teal/80 text-sm mt-1">
                This report is a deep-dive audit scoped to a single campaign — ad groups, keywords, ads, and search terms.
              </p>
              {parentAuditId && (
                <Button variant="outline" size="sm" className="mt-3" onClick={() => navigate(`/dashboard/${parentAuditId}`)}>
                  View full account audit
                </Button>
              )}
            </div>
          </div>
        </div>
      </section>
    );
  }

  if (!customerId) {
    return (
      <section id="campaign-audits" className="scroll-mt-24">
        <div className="bg-panel border border-border rounded-xl p-6 text-center">
          <p className="text-white font-medium text-sm mb-1">Google Ads account not linked to this audit</p>
          <p className="text-muted text-xs">Run a new account audit from Connect to load campaigns.</p>
        </div>
      </section>
    );
  }

  return (
    <section id="campaign-audits" className="scroll-mt-24">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
        <div>
          <h2 className="text-white font-bold text-xl flex items-center gap-2">
            <Target size={20} className="text-orange" />
            Your Campaigns
          </h2>
          <p className="text-muted text-sm mt-1 max-w-xl">
            Segregated by Google Ads campaign type. Filter by type or company service, then open a campaign for a detailed audit
            ({metricsWindowDays >= 365 ? 'last 365 days' : metricsWindowDays >= 90 ? 'last 90 days' : 'last 30 days'}).
          </p>
        </div>
        <div className="flex items-center gap-2">
          {campaigns.length > 0 && (
            <Badge variant="teal">{campaigns.length} campaign{campaigns.length === 1 ? '' : 's'}</Badge>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setCreateAdCampaign(null);
              setCreateOpen(true);
            }}
            disabled={!googleAdsCustomerId}
          >
            <Plus size={14} /> Create campaign
          </Button>
          <Button variant="outline" size="sm" onClick={() => void loadCampaigns()} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
          </Button>
        </div>
      </div>

      {!loading && campaigns.length > 0 && (
        <div className="bg-panel border border-border rounded-xl p-4 mb-4 space-y-4">
          <div className="flex items-center gap-2 text-muted text-[11px] uppercase tracking-wider">
            <Filter size={12} />
            Campaign type
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setTypeFilter('all')}
              className={clsx(
                'text-[11px] px-3 py-1.5 rounded-full border transition-colors',
                typeFilter === 'all'
                  ? 'bg-orange/15 text-orange border-orange/40'
                  : 'bg-navy text-muted border-border hover:text-white'
              )}
            >
              All types
              <span className="ml-1.5 opacity-70">({campaigns.length})</span>
            </button>
            {availableTypes.map((t) => {
              const count = typeCounts[t.key] ?? 0;
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setTypeFilter(t.key)}
                  className={clsx(
                    'text-[11px] px-3 py-1.5 rounded-full border transition-colors',
                    typeFilter === t.key
                      ? 'bg-teal/15 text-teal border-teal/40'
                      : count === 0
                        ? 'bg-navy text-muted/70 border-border/70 hover:text-muted'
                        : 'bg-navy text-muted border-border hover:text-white'
                  )}
                >
                  {t.shortLabel}
                  <span className="ml-1.5 opacity-70">({count})</span>
                </button>
              );
            })}
          </div>

          {activeTypeMeta && (
            <div className="rounded-lg border border-teal/25 bg-teal/5 px-3 py-2.5">
              <p className="text-teal text-xs font-semibold">{activeTypeMeta.label}</p>
              <p className="text-muted text-[11px] leading-relaxed mt-1">{activeTypeMeta.description}</p>
              <p className="text-muted text-[11px] mt-1">
                Campaigns in account: <span className="text-white">{typeCounts[activeTypeMeta.key] ?? 0}</span>
              </p>
            </div>
          )}

          {/* Service filter — always shown in Your Campaigns when campaigns exist */}
          <div className="flex items-center gap-2 text-muted text-[11px] uppercase tracking-wider pt-1 border-t border-border/50">
            <Filter size={12} />
            Service
            <span className="normal-case tracking-normal text-muted/80">
              (filter campaigns by offering)
            </span>
          </div>
          {serviceOptions.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setServiceFilter('all')}
                className={clsx(
                  'text-[11px] px-3 py-1.5 rounded-full border transition-colors',
                  serviceFilter === 'all'
                    ? 'bg-orange/15 text-orange border-orange/40'
                    : 'bg-navy text-muted border-border hover:text-white'
                )}
              >
                All services
                <span className="ml-1.5 opacity-70">({campaigns.length})</span>
              </button>
              {serviceOptions.map((service) => (
                <button
                  key={service}
                  type="button"
                  onClick={() => setServiceFilter(service)}
                  className={clsx(
                    'text-[11px] px-3 py-1.5 rounded-full border transition-colors',
                    serviceFilter === service
                      ? 'bg-teal/15 text-teal border-teal/40'
                      : 'bg-navy text-muted border-border hover:text-white'
                  )}
                >
                  {service}
                  <span className="ml-1.5 opacity-70">({serviceCounts[service] ?? 0})</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="text-muted text-[11px]">
              Service filters appear once campaign ads or website offerings are detected.
            </p>
          )}

          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              type="search"
              placeholder="Search campaigns by name…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-navy border border-border rounded-lg pl-9 pr-4 py-2.5 text-white text-sm placeholder:text-muted/70 focus:outline-none focus:border-orange/50"
            />
          </div>
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-12 text-muted">
          <Loader2 className="animate-spin mr-2" size={20} />
          Loading campaigns from Google Ads…
        </div>
      )}

      {error && !loading && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-red-300 text-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <span>{error}</span>
          <Button variant="outline" size="sm" onClick={() => void loadCampaigns()}>
            <RefreshCw size={14} /> Retry
          </Button>
        </div>
      )}

      {!loading && !error && campaigns.length === 0 && (
        <div className="bg-panel border border-border rounded-xl p-6 text-center">
          <Megaphone size={32} className="text-muted mx-auto mb-3" />
          <p className="text-white font-medium text-sm mb-1">No campaigns found in this account</p>
          <p className="text-muted text-xs mb-4">
            {dataSource === 'mock'
              ? 'Mock data mode is on — only demo accounts have sample campaigns.'
              : 'Create a paused Search campaign here, or click Refresh if you expect existing campaigns.'}
          </p>
          <div className="flex items-center justify-center gap-2">
            <Button
              size="sm"
              onClick={() => {
                setCreateAdCampaign(null);
                setCreateOpen(true);
              }}
            >
              <Plus size={14} /> Create campaign
            </Button>
            <Button variant="outline" size="sm" onClick={() => void loadCampaigns()}>
              <RefreshCw size={14} /> Refresh campaigns
            </Button>
          </div>
        </div>
      )}

      {!loading && campaigns.length > 0 && typeFilter === 'all' && (
        <div className="space-y-8">
          {groupedByType.map((group) => {
            const meta = getCampaignTypeMeta(group.key);
            return (
              <div key={group.key} className="space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <h3 className="text-white font-semibold text-sm flex items-center gap-2">
                      {meta.label}
                      <Badge variant="teal">
                        {serviceFilter !== 'all' || search.trim()
                          ? group.campaigns.length
                          : group.totalInAccount}
                      </Badge>
                    </h3>
                    <p className="text-muted text-[11px] leading-relaxed mt-1 max-w-3xl">
                      {meta.description}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setTypeFilter(group.key)}
                    className="text-[11px] text-teal hover:underline shrink-0"
                  >
                    Filter to {meta.shortLabel}
                  </button>
                </div>
                {group.campaigns.length > 0 ? (
                  <div className="grid lg:grid-cols-1 gap-4">
                    {group.campaigns.map(renderCampaignCard)}
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-border bg-navy/30 px-4 py-5 text-center">
                    <p className="text-muted text-sm">
                      0 campaigns of this type in the Google Ads account
                      {serviceFilter !== 'all' || search.trim()
                        ? ' matching the current filters'
                        : ''}
                      .
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {!loading && typeFilter !== 'all' && (
        <div className="space-y-4">
          {filteredTyped.length > 0 ? (
            <div className="grid lg:grid-cols-1 gap-4">
              {filteredTyped.map(({ campaign }) => renderCampaignCard(campaign))}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-border bg-navy/30 px-4 py-8 text-center">
              <p className="text-white text-sm font-medium mb-1">
                0 {getCampaignTypeMeta(typeFilter).shortLabel} campaigns
              </p>
              <p className="text-muted text-xs">
                No campaigns of this type
                {serviceFilter !== 'all' || search.trim()
                  ? ' match the current service / search filters'
                  : ' were found in this Google Ads account'}
                .
              </p>
            </div>
          )}
        </div>
      )}

      {!loading && campaigns.length > 0 && filteredTyped.length === 0 && typeFilter === 'all' && (serviceFilter !== 'all' || search.trim()) && (
        <p className="text-muted text-sm text-center py-6">
          No campaigns match the current service / search filters.
          <button
            type="button"
            className="block mx-auto mt-2 text-orange hover:underline"
            onClick={() => {
              setTypeFilter('all');
              setServiceFilter('all');
              setSearch('');
            }}
          >
            Clear filters
          </button>
        </p>
      )}

      {googleAdsCustomerId && (
        <CreateCampaignModal
          open={createOpen || Boolean(createAdCampaign)}
          mode={createAdCampaign ? 'ad' : 'campaign'}
          existingCampaign={
            createAdCampaign
              ? {
                  id: createAdCampaign.id,
                  resourceName: createAdCampaign.resourceName,
                  name: createAdCampaign.name,
                  type: createAdCampaign.type,
                  biddingStrategyType: createAdCampaign.biddingStrategyType,
                  budgetDaily: createAdCampaign.budgetDaily,
                  status: createAdCampaign.status,
                }
              : undefined
          }
          onClose={() => {
            setCreateOpen(false);
            setCreateAdCampaign(null);
          }}
          auditId={auditId}
          googleAdsCustomerId={googleAdsCustomerId}
          websiteUrl={websiteUrl}
          typeCounts={typeCounts}
          onCreated={() => {
            setCreateOpen(false);
            setCreateAdCampaign(null);
            void loadCampaigns();
          }}
        />
      )}
    </section>
  );
}
