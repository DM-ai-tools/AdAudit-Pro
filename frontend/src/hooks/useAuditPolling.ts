import { useEffect, useRef, useState, useCallback } from 'react';
import { auditApi } from '../services/api';
import type { AuditRun } from '../types';
import { countFindingsForModule, FINDINGS_NAV_MODULES, isFailureFinding } from '../utils/findingFilters';

export function useAuditPolling(auditId: string | undefined, intervalMs = 3000) {
  const [audit, setAudit] = useState<AuditRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  const fetchAudit = useCallback(async () => {
    if (!auditId) return;
    try {
      const { data } = await auditApi.status(auditId);
      setAudit(data.audit);
      setError(null);
      if (data.audit.status === 'COMPLETED' && intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    } catch {
      setError('Failed to load audit status');
    } finally {
      setLoading(false);
    }
  }, [auditId]);

  useEffect(() => {
    if (!auditId) return;
    fetchAudit();
    intervalRef.current = setInterval(fetchAudit, intervalMs);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [auditId, intervalMs, fetchAudit]);

  return { audit, loading, error, refetch: fetchAudit };
}

function auditNeedsModuleBackfill(audit: AuditRun): boolean {
  if (audit.status !== 'COMPLETED') return false;
  const valid = audit.findings.filter((f) => !isFailureFinding(f));
  return FINDINGS_NAV_MODULES.some((m) => countFindingsForModule(valid, m.slug) === 0);
}

export function useAuditReport(auditId: string | undefined) {
  const [audit, setAudit] = useState<AuditRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [backfilling, setBackfilling] = useState(false);
  const backfillStarted = useRef(false);

  const load = useCallback(async () => {
    if (!auditId) return null;
    try {
      const { data } = await auditApi.report(auditId);
      setAudit(data.audit);
      return data.audit;
    } catch {
      return null;
    } finally {
      setLoading(false);
    }
  }, [auditId]);

  useEffect(() => {
    backfillStarted.current = false;
    setLoading(true);
    void load();
  }, [load]);

  useEffect(() => {
    if (!auditId || !audit || backfillStarted.current || !auditNeedsModuleBackfill(audit)) return;

    backfillStarted.current = true;
    setBackfilling(true);

    void (async () => {
      try {
        const token = localStorage.getItem('token');
        const { data } = token
          ? await auditApi.backfillModules(auditId)
          : await auditApi.backfillModulesDemo(auditId);
        if (data.audit) setAudit(data.audit);
        else await load();
      } catch {
        backfillStarted.current = false;
      } finally {
        setBackfilling(false);
      }
    })();
  }, [auditId, audit, load]);

  return { audit, loading, backfilling, refetch: load };
}
