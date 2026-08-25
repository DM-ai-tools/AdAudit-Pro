import { formatCurrencyPrecise, formatNumber, formatPercent } from '../../utils/helpers';
import type { GoogleAdsCampaign } from '../../types/connect';

interface CampaignContextSectionProps {
  campaign: GoogleAdsCampaign;
  currency?: string;
  services?: string[];
}

export function CampaignContextSection({
  campaign,
  currency = 'AUD',
  services = [],
}: CampaignContextSectionProps) {
  return (
    <div className="bg-panel border border-border rounded-2xl p-5 space-y-4">
      <div>
        <h3 className="text-white font-semibold">Campaign context</h3>
        <p className="text-muted text-xs mt-1">
          Make It Better uses account-wide intelligence and this campaign&apos;s performance — not one
          ad in isolation.
        </p>
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2 text-[11px]">
        <Metric label="Campaign" value={campaign.name} />
        <Metric label="Type" value={campaign.type.replace(/_/g, ' ')} />
        <Metric label="Status" value={campaign.status} />
        <Metric label="Ads in campaign" value={String(campaign.adCount || campaign.ads.length)} />
        <Metric label="CTR" value={formatPercent(campaign.ctr)} />
        <Metric label="Clicks" value={formatNumber(campaign.clicks)} />
        <Metric label="Conversions" value={campaign.conversions.toFixed(1)} />
        <Metric label="Spend" value={formatCurrencyPrecise(campaign.cost, currency)} />
      </div>
      {services.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted mb-2">Services in this campaign</p>
          <div className="flex flex-wrap gap-1.5">
            {services.map((s) => (
              <span
                key={s}
                className="text-[10px] px-2 py-0.5 rounded-full border border-teal/30 bg-teal/10 text-teal"
              >
                {s}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-navy/40 px-2.5 py-2">
      <p className="text-muted uppercase tracking-wide text-[9px]">{label}</p>
      <p className="text-white font-medium truncate mt-0.5">{value}</p>
    </div>
  );
}
