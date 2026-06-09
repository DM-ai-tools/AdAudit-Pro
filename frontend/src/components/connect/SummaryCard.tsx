import { Activity } from 'lucide-react';
import type { AuditDepth } from '../../types/connect';
import { AUDIT_DEPTH_OPTIONS } from '../../data/auditModules';
import { formatCurrency } from '../../utils/helpers';

interface SummaryCardProps {
  accountName?: string;
  auditDepth: AuditDepth;
  modulesEnabled: number;
  totalModules: number;
  auditWindow: number;
  monthlySpend?: number;
  currency?: string;
  activeCampaigns?: number;
  configSource?: 'google_ads_api' | 'mock' | null;
}

export function SummaryCard({
  accountName,
  auditDepth,
  modulesEnabled,
  totalModules,
  auditWindow,
  monthlySpend,
  currency,
  activeCampaigns,
  configSource,
}: SummaryCardProps) {
  const depth = AUDIT_DEPTH_OPTIONS.find((d) => d.id === auditDepth);

  return (
    <div className="bg-panel border border-orange/20 rounded-xl p-4 glow-orange">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-white font-semibold text-sm">Audit Summary</h4>
        {configSource === 'google_ads_api' && (
          <span className="text-[10px] text-teal font-semibold">Live data</span>
        )}
      </div>
      <dl className="space-y-2 text-xs">
        <div className="flex justify-between gap-2">
          <dt className="text-muted">Account</dt>
          <dd className="text-white font-medium text-right truncate">{accountName || '—'}</dd>
        </div>
        {activeCampaigns != null && (
          <div className="flex justify-between gap-2">
            <dt className="text-muted">Active campaigns</dt>
            <dd className="text-white font-medium">{activeCampaigns}</dd>
          </div>
        )}
        <div className="flex justify-between gap-2">
          <dt className="text-muted">Audit depth</dt>
          <dd className="text-orange font-semibold">{depth?.title || 'Standard'}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-muted">Modules enabled</dt>
          <dd className="text-white font-medium">{modulesEnabled} / {totalModules}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-muted">Data window</dt>
          <dd className="text-white font-medium">{auditWindow} days</dd>
        </div>
        {monthlySpend != null && (
          <div className="flex justify-between gap-2">
            <dt className="text-muted">30-day spend</dt>
            <dd className="text-teal font-semibold">
              {formatCurrency(monthlySpend, currency || 'USD')}
            </dd>
          </div>
        )}
        <div className="flex justify-between gap-2 pt-2 border-t border-border">
          <dt className="text-muted">Est. processing</dt>
          <dd className="text-orange font-bold">~{depth?.estimatedMinutes || 18} min</dd>
        </div>
      </dl>
    </div>
  );
}

interface ProgressPreviewProps {
  modules: { name: string; enabled: boolean }[];
}

export function ProgressPreview({ modules }: ProgressPreviewProps) {
  const queued = modules.filter((m) => m.enabled).slice(0, 4);

  return (
    <div className="bg-navy border border-border rounded-xl p-4 overflow-hidden">
      <h4 className="text-white font-semibold text-sm mb-3 flex items-center gap-2">
        <Activity size={14} className="text-orange" /> Modules Queued
      </h4>
      {queued.length === 0 ? (
        <p className="text-muted text-xs">Enable modules to preview the audit pipeline.</p>
      ) : (
        <div className="space-y-2.5">
          {queued.map((mod) => (
            <div key={mod.name}>
              <div className="flex justify-between text-[10px] mb-1">
                <span className="text-muted">{mod.name}</span>
                <span className="text-muted">Queued</span>
              </div>
              <div className="h-1 bg-panel rounded-full overflow-hidden">
                <div className="h-full w-0 rounded-full bg-border" />
              </div>
            </div>
          ))}
        </div>
      )}
      <p className="text-[10px] text-muted mt-3 italic">
        Processing starts when you click Start Audit →
      </p>
    </div>
  );
}
