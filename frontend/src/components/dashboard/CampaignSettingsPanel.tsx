import { useEffect, useState } from 'react';
import { AlertTriangle, Settings } from 'lucide-react';
import type { GoogleAdsCampaign } from '../../types/connect';
import { googleAdsApi } from '../../services/api';
import {
  campaignBidLabel,
  campaignCanSwitchManualVsConversions,
  campaignHonorsKeywordBids,
  normalizeCampaignBid,
} from '../../utils/campaignBidding';
import { formatCurrencyPrecise } from '../../utils/helpers';
import { Button } from '../ui/Button';

interface CampaignSettingsPanelProps {
  campaign: GoogleAdsCampaign;
  googleAdsCustomerId: string;
  currency?: string;
  onUpdated?: () => void;
}

export function CampaignSettingsPanel({
  campaign,
  googleAdsCustomerId,
  currency = 'AUD',
  onUpdated,
}: CampaignSettingsPanelProps) {
  const current = normalizeCampaignBid(campaign.biddingStrategyType);
  const canSwitch = campaignCanSwitchManualVsConversions(campaign.type);
  const honorsBids = campaignHonorsKeywordBids(campaign.biddingStrategyType);
  const [target, setTarget] = useState<'MANUAL_CPC' | 'MAXIMIZE_CONVERSIONS'>(
    current === 'MAXIMIZE_CONVERSIONS' ? 'MAXIMIZE_CONVERSIONS' : 'MANUAL_CPC'
  );
  const [approved, setApproved] = useState(false);
  const [dailyBudget, setDailyBudget] = useState(String(campaign.budgetDaily || ''));
  const [budgetApproved, setBudgetApproved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingBudget, setSavingBudget] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setDailyBudget(String(campaign.budgetDaily || ''));
    setBudgetApproved(false);
  }, [campaign.id, campaign.budgetDaily]);

  const budgetNumber = Number(dailyBudget);
  const budgetDirty =
    Number.isFinite(budgetNumber) &&
    budgetNumber > 0 &&
    Math.abs(budgetNumber - (campaign.budgetDaily || 0)) >= 0.01;

  const dirty =
    (target === 'MANUAL_CPC' && current !== 'MANUAL_CPC') ||
    (target === 'MAXIMIZE_CONVERSIONS' && current !== 'MAXIMIZE_CONVERSIONS');

  const apiError = (err: unknown, fallback: string) =>
    (err as { response?: { data?: { error?: string; message?: string } } })?.response?.data
      ?.message ||
    (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
    fallback;

  const save = async () => {
    if (!dirty || !approved) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const { data } = await googleAdsApi.updateCampaignBidding({
        googleAdsCustomerId,
        campaignResourceName: campaign.resourceName,
        biddingStrategy: target,
        clientApprovals: { authorizeBiddingSwitch: true },
      });
      if (!data.success) {
        setError(data.message || data.error || 'Could not update bidding.');
        return;
      }
      setMessage(data.message);
      setApproved(false);
      onUpdated?.();
    } catch (err) {
      setError(apiError(err, 'Could not update bidding.'));
    } finally {
      setSaving(false);
    }
  };

  const saveBudget = async () => {
    if (!budgetDirty || !budgetApproved) return;
    setSavingBudget(true);
    setError(null);
    setMessage(null);
    try {
      const { data } = await googleAdsApi.updateCampaignBudget({
        googleAdsCustomerId,
        campaignResourceName: campaign.resourceName,
        dailyBudget: budgetNumber,
        clientApprovals: { authorizeBudgetChange: true },
      });
      if (!data.success) {
        setError(data.message || data.error || 'Could not update daily budget.');
        return;
      }
      setMessage(data.message);
      setBudgetApproved(false);
      onUpdated?.();
    } catch (err) {
      setError(apiError(err, 'Could not update daily budget.'));
    } finally {
      setSavingBudget(false);
    }
  };

  return (
    <div className="rounded-xl border border-border bg-panel/40 px-3 py-3 space-y-3">
      <p className="text-[11px] uppercase tracking-wider text-muted flex items-center gap-1.5">
        <Settings size={12} /> Settings from Google Ads
      </p>
      <div className="grid sm:grid-cols-2 gap-2 text-[12px]">
        <p className="text-muted">
          Status <span className="text-white">{campaign.status}</span>
        </p>
        <label className="text-muted">
          Daily budget
          <input
            type="number"
            min={1}
            step={0.01}
            value={dailyBudget}
            onChange={(e) => {
              setDailyBudget(e.target.value);
              setBudgetApproved(false);
              setMessage(null);
            }}
            className="mt-1 w-full rounded-md border border-border bg-navy px-2 py-1.5 text-white tabular-nums"
          />
          <span className="block text-[10px] mt-1">
            Current in Google Ads: {formatCurrencyPrecise(campaign.budgetDaily, currency)} / day
          </span>
        </label>
        <p className="text-muted sm:col-span-2">
          Bidding <span className="text-orange">{campaignBidLabel(campaign.biddingStrategyType)}</span>
        </p>
      </div>
      {budgetDirty && (
        <div className="space-y-2">
          <p className="text-[11px] text-muted leading-relaxed">
            This updates the campaign’s daily budget in Google Ads. Shared budgets also change other
            campaigns using the same budget.
          </p>
          <label className="flex items-start gap-2 text-[12px] text-white cursor-pointer">
            <input
              type="checkbox"
              checked={budgetApproved}
              onChange={() => setBudgetApproved((v) => !v)}
              className="accent-orange mt-0.5"
            />
            I approve the daily budget change
          </label>
          <Button
            size="sm"
            disabled={!budgetApproved || savingBudget}
            loading={savingBudget}
            onClick={() => void saveBudget()}
          >
            {savingBudget ? 'Updating…' : 'Apply daily budget'}
          </Button>
        </div>
      )}
      {!honorsBids && (
        <p className="text-[11px] text-orange/90 leading-relaxed">
          Individual keyword max CPC is ignored on this strategy. Google sets click prices inside the
          daily budget.
        </p>
      )}
      {canSwitch ? (
        <div className="space-y-2">
          <p className="text-[11px] text-white/85">Change bidding (Search campaigns only)</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                setTarget('MANUAL_CPC');
                setApproved(false);
              }}
              className={`text-[11px] px-2.5 py-1 rounded-md border ${
                target === 'MANUAL_CPC' ? 'border-orange text-orange bg-orange/10' : 'border-border text-muted'
              }`}
            >
              Manual CPC
            </button>
            <button
              type="button"
              onClick={() => {
                setTarget('MAXIMIZE_CONVERSIONS');
                setApproved(false);
              }}
              className={`text-[11px] px-2.5 py-1 rounded-md border ${
                target === 'MAXIMIZE_CONVERSIONS'
                  ? 'border-orange text-orange bg-orange/10'
                  : 'border-border text-muted'
              }`}
            >
              Maximize conversions
            </button>
          </div>
          {dirty && (
            <>
              <p className="text-[11px] text-muted leading-relaxed">
                Switching bidding is a significant campaign change, separate from approving ad copy.
                {target === 'MANUAL_CPC'
                  ? ' Manual CPC lets you set keyword max CPC bids.'
                  : ' Maximize conversions lets Google set click prices.'}
              </p>
              <label className="flex items-start gap-2 text-[12px] text-white cursor-pointer">
                <input
                  type="checkbox"
                  checked={approved}
                  onChange={() => setApproved((v) => !v)}
                  className="accent-orange mt-0.5"
                />
                I authorize switching this campaign’s bidding strategy
              </label>
              <Button size="sm" disabled={!approved || saving} loading={saving} onClick={() => void save()}>
                {saving ? 'Updating…' : 'Apply bidding change'}
              </Button>
            </>
          )}
        </div>
      ) : (
        <p className="text-[11px] text-muted">
          This campaign type cannot switch between Manual CPC and Maximize conversions in AdAudit Pro.
        </p>
      )}
      {error && (
        <p className="text-[11px] text-red-300 flex gap-1">
          <AlertTriangle size={12} className="shrink-0 mt-0.5" /> {error}
        </p>
      )}
      {message && <p className="text-[11px] text-teal">{message}</p>}
    </div>
  );
}
