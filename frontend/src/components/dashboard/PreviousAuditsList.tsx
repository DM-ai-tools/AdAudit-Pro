import { Link } from 'react-router-dom';
import { Loader2, FileText, Megaphone, ChevronRight, Clock, AlertCircle } from 'lucide-react';
import clsx from 'clsx';
import { Badge } from '../ui/Badge';
import { formatCurrency } from '../../utils/helpers';
import type { AuditSummary } from '../../types';

function statusVariant(status: AuditSummary['status']): 'teal' | 'orange' | 'muted' | 'red' {
  if (status === 'COMPLETED') return 'teal';
  if (status === 'RUNNING') return 'orange';
  if (status === 'FAILED') return 'red';
  return 'muted';
}

function formatAuditDate(audit: AuditSummary): string {
  const raw = audit.completedAt || audit.startedAt || audit.createdAt;
  return new Date(raw).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

interface PreviousAuditsListProps {
  audits: AuditSummary[];
  loading?: boolean;
  error?: string | null;
  userEmail?: string;
  currentAuditId?: string;
  compact?: boolean;
  emptyMessage?: string;
  className?: string;
}

export function PreviousAuditsList({
  audits,
  loading,
  error,
  userEmail,
  currentAuditId,
  compact = false,
  emptyMessage = 'No previous audits yet. Start your first audit below.',
  className,
}: PreviousAuditsListProps) {
  if (loading) {
    return (
      <div className={clsx('flex items-center gap-2 text-muted text-sm py-4', className)}>
        <Loader2 className="animate-spin" size={16} />
        Loading previous audits...
      </div>
    );
  }

  if (error) {
    return (
      <div className={clsx('text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2', className)}>
        {error}
      </div>
    );
  }

  if (!audits.length) {
    return (
      <div className={clsx('text-muted text-sm bg-panel/50 border border-border rounded-xl px-4 py-3', className)}>
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className={clsx('space-y-2', className)}>
      {userEmail && (
        <p className="text-muted text-xs mb-3">
          Audits for <span className="text-white font-medium">{userEmail}</span>
        </p>
      )}
      {audits.map((audit) => {
        const isCurrent = audit.id === currentAuditId;
        const isCampaign = audit.auditScope === 'campaign';

        return (
          <Link
            key={audit.id}
            to={audit.status === 'COMPLETED' || audit.status === 'RUNNING' ? `/dashboard/${audit.id}` : `/processing/${audit.id}`}
            className={clsx(
              'block rounded-xl border transition-colors',
              compact ? 'p-3' : 'p-4',
              isCurrent
                ? 'border-orange/40 bg-orange/10'
                : 'border-border bg-panel hover:border-orange/30 hover:bg-panel/80'
            )}
          >
            <div className="flex items-start gap-3">
              <div className={clsx(
                'shrink-0 w-9 h-9 rounded-lg flex items-center justify-center',
                isCampaign ? 'bg-teal/15 text-teal' : 'bg-orange/15 text-orange'
              )}>
                {isCampaign ? <Megaphone size={16} /> : <FileText size={16} />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <span className="text-white font-semibold text-sm truncate">
                    {audit.accountName}
                  </span>
                  <Badge variant={isCampaign ? 'teal' : 'orange'}>
                    {isCampaign ? 'Campaign' : 'Account'}
                  </Badge>
                  <Badge variant={statusVariant(audit.status)}>
                    {audit.status === 'COMPLETED' ? 'Complete' : audit.status}
                  </Badge>
                  {isCurrent && <Badge variant="outline">Current</Badge>}
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted">
                  <span className="inline-flex items-center gap-1">
                    <Clock size={11} />
                    {formatAuditDate(audit)}
                  </span>
                  <span>{audit.dataWindowDays}-day window</span>
                  {audit.status === 'COMPLETED' && (
                    <>
                      <span>{audit.findingsCount} findings</span>
                      {audit.healthScore != null && <span>Health {audit.healthScore}/100</span>}
                      {audit.totalImpact > 0 && (
                        <span className="text-teal">{formatCurrency(audit.totalImpact)}/mo impact</span>
                      )}
                    </>
                  )}
                  {audit.status === 'RUNNING' && (
                    <span>{audit.modulesComplete}/{audit.totalModules} modules</span>
                  )}
                  {audit.criticalCount > 0 && (
                    <span className="text-red-400 inline-flex items-center gap-1">
                      <AlertCircle size={11} />
                      {audit.criticalCount} critical
                    </span>
                  )}
                </div>
              </div>
              <ChevronRight size={16} className="text-muted shrink-0 mt-1" />
            </div>
          </Link>
        );
      })}
    </div>
  );
}
