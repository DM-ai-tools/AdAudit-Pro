import clsx from 'clsx';
import { Layers, Target } from 'lucide-react';
import type { GoogleAdsCampaign } from '../../types/connect';

interface MakeItBetterScopeBarProps {
  mode: 'ad' | 'campaign';
  campaign?: GoogleAdsCampaign | null;
  adHeadline?: string;
  adGroupName?: string;
  service?: string;
}

export function MakeItBetterScopeBar({
  mode,
  campaign,
  adHeadline,
  adGroupName,
  service,
}: MakeItBetterScopeBarProps) {
  const isAd = mode === 'ad';
  return (
    <div
      className={clsx(
        'rounded-xl border px-4 py-3 flex flex-wrap items-center gap-3',
        isAd ? 'border-teal/30 bg-teal/5' : 'border-orange/30 bg-orange/5'
      )}
    >
      <div
        className={clsx(
          'w-9 h-9 rounded-lg flex items-center justify-center shrink-0',
          isAd ? 'bg-teal/15 text-teal' : 'bg-orange/15 text-orange'
        )}
      >
        {isAd ? <Target size={18} /> : <Layers size={18} />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] uppercase tracking-wider text-muted">
          {isAd ? 'Single ad optimization' : 'Campaign optimization'}
        </p>
        <p className="text-white text-sm font-semibold truncate">
          {isAd
            ? adHeadline || adGroupName || 'Selected ad'
            : campaign?.name ?? 'Campaign'}
        </p>
        <p className="text-muted text-[11px] mt-0.5">
          {isAd
            ? `Service-scoped rivals and RSA tuned to this ad${service ? ` · ${service}` : ''}.`
            : `Generalized strategy and ad copy for the whole campaign${campaign ? ` · ${campaign.adCount} ad${campaign.adCount === 1 ? '' : 's'}` : ''}.`}
        </p>
      </div>
    </div>
  );
}
