import { useEffect, useRef, useState, useCallback } from 'react';
import { auditApi } from '../services/api';
import type { AuditRun } from '../types';
import { countFindingsForModule, isFailureFinding } from '../utils/findingFilters';

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

/** Only backfill modules that were part of this audit run and have no findings yet. */
function auditNeedsModuleBackfill(audit: AuditRun): boolean {
  if (audit.status !== 'COMPLETED') return false;
  const valid = audit.findings.filter((f) => !isFailureFinding(f));
  const slugs = (audit.modules ?? [])
    .filter((m) => m.status === 'COMPLETED')
    .map((m) => m.slug)
    .filter(Boolean);
  if (!slugs.length) return false;
  return slugs.some((slug) => countFindingsForModule(valid, slug) === 0);
}

export function useAuditReport(auditId: string | undefined) {
  const [audit, setAudit] = useState<AuditRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [backfilling, setBackfilling] = useState(false);
  const [backfillProgress, setBackfillProgress] = useState<string | null>(null);
  const [backfillError, setBackfillError] = useState<string | null>(null);
  const backfillStarted = useRef(false);

  const load = useCallback(async () => {
    if (!auditId) return null;
    try {
      const { data } = await auditApi.report(auditId);
      setAudit(data.audit);
      setError(null);
      return data.audit;
    } catch {
      setError('Failed to load audit report. Refresh the page or check that the backend is running.');
      return null;
    } finally {
      setLoading(false);
    }
  }, [auditId]);

  useEffect(() => {
    backfillStarted.current = false;
    setLoading(true);
    setError(null);
    setBackfillError(null);
    void load();
  }, [load]);

  useEffect(() => {
    if (!auditId || !audit || backfillStarted.current || !auditNeedsModuleBackfill(audit)) return;

    backfillStarted.current = true;
    setBackfilling(true);
    setBackfillError(null);
    setBackfillProgress('Claude is analyzing remaining audit modules…');

    void (async () => {
      try {
        const token = localStorage.getItem('token');
        const { data } = token
          ? await auditApi.backfillModules(auditId)
          : await auditApi.backfillModulesDemo(auditId);
        if (data.audit) setAudit(data.audit);
        else await load();
        if (data.added > 0) {
          setBackfillProgress(`Added findings from ${data.added} module${data.added === 1 ? '' : 's'}.`);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Backfill failed';
        setBackfillError(message);
        backfillStarted.current = false;
      } finally {
        setBackfilling(false);
        setTimeout(() => setBackfillProgress(null), 4000);
      }
    })();
  }, [auditId, audit, load]);

  return { audit, loading, error, backfilling, backfillProgress, backfillError, refetch: load };
}
