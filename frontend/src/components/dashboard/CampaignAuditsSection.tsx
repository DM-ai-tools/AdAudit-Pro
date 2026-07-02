import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Target, Megaphone, Search, RefreshCw } from 'lucide-react';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { CampaignCard } from '../connect/CampaignCard';
import { googleAdsApi, auditApi } from '../../services/api';
import type { GoogleAdsCampaign } from '../../types/connect';
import type { Finding } from '../../types';

interface CampaignAuditsSectionProps {
  auditId: string;
  googleAdsCustomerId?: string;
  dataWindowDays?: number;
  auditScope?: 'account' | 'campaign';
  parentAuditId?: string;
  campaignName?: string;
  onOptimizeCampaign?: (finding: Finding, campaign: GoogleAdsCampaign) => void;
}

function formatGoogleAdsCustomerId(id: string): string {
  const bare = id.replace(/\D/g, '');
  if (bare.length !== 10) return id;
  return `${bare.slice(0, 3)}-${bare.slice(3, 6)}-${bare.slice(6)}`;
}

export function CampaignAuditsSection({
  auditId,
  googleAdsCustomerId,
  dataWindowDays = 30,
  auditScope,
  parentAuditId,
  campaignName,
  onOptimizeCampaign,
}: CampaignAuditsSectionProps) {
  const navigate = useNavigate();
  const [campaigns, setCampaigns] = useState<GoogleAdsCampaign[]>([]);
  const [currency, setCurrency] = useState('AUD');
  const [metricsWindowDays, setMetricsWindowDays] = useState(dataWindowDays);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [startingId, setStartingId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [dataSource, setDataSource] = useState<'google_ads_api' | 'mock' | null>(null);

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

  const filteredCampaigns = campaigns.filter((c) =>
    !search.trim() || c.name.toLowerCase().includes(search.toLowerCase())
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
            Account audit complete. Stats and ad previews match your Google Ads campaigns view
            ({metricsWindowDays >= 365 ? 'last 365 days' : metricsWindowDays >= 90 ? 'last 90 days' : 'last 30 days'}).
            Click a campaign to run a detailed audit using these metrics.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {campaigns.length > 0 && (
            <Badge variant="teal">{campaigns.length} campaign{campaigns.length === 1 ? '' : 's'}</Badge>
          )}
          <Button variant="outline" size="sm" onClick={() => void loadCampaigns()} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
          </Button>
        </div>
      </div>

      {campaigns.length > 4 && (
        <div className="relative mb-4">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            type="search"
            placeholder="Search campaigns…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-panel border border-border rounded-lg pl-9 pr-4 py-2.5 text-white text-sm placeholder:text-muted/70 focus:outline-none focus:border-orange/50"
          />
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
              : 'If you expect campaigns here, click Refresh or reconnect Google Ads.'}
          </p>
          <Button variant="outline" size="sm" onClick={() => void loadCampaigns()}>
            <RefreshCw size={14} /> Refresh campaigns
          </Button>
        </div>
      )}

      {!loading && filteredCampaigns.length > 0 && (
        <div className="grid lg:grid-cols-1 gap-4">
          {filteredCampaigns.map((campaign) => (
            <CampaignCard
              key={campaign.id}
              campaign={campaign}
              variant="action"
              currency={currency}
              auditing={startingId === campaign.id}
              onAudit={() => void handleCampaignAudit(campaign)}
              onOptimize={onOptimizeCampaign ? () => onOptimizeCampaign(
                {
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
                },
                campaign
              ) : undefined}
            />
          ))}
        </div>
      )}

      {!loading && campaigns.length > 0 && filteredCampaigns.length === 0 && (
        <p className="text-muted text-sm text-center py-6">No campaigns match &ldquo;{search}&rdquo;</p>
      )}
    </section>
  );
}
