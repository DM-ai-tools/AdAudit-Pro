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
  const hasLoadedAudit = useRef(false);
  const loadedAuditId = useRef<string | undefined>(undefined);

  const load = useCallback(async () => {
    if (!auditId) return null;
    const maxAttempts = 4;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const { data } = await auditApi.report(auditId);
        let next = data.audit;
        // Refresh KPI fields from the dedicated health endpoint (valid findings only)
        if (next.status === 'COMPLETED') {
          try {
            const { data: health } = await auditApi.health(auditId);
            next = {
              ...next,
              healthScore: health.overallScore,
              healthScores: health.scores?.length ? health.scores : next.healthScores,
              totalImpact: health.totalImpact,
              annualOpportunity: health.annualOpportunity ?? health.totalImpact * 12,
              totalFindings: health.totalFindings ?? next.totalFindings,
              criticalCount: health.criticalCount,
            };
          } catch {
            /* report sanitize fields already present */
          }
        }
        hasLoadedAudit.current = true;
        loadedAuditId.current = auditId;
        setAudit(next);
        setError(null);
        setLoading(false);
        return next;
      } catch {
        // Backend often restarts briefly during Make It Better / file watch — retry before failing the page.
        if (attempt < maxAttempts) {
          await new Promise((r) => setTimeout(r, 600 * attempt));
          continue;
        }
        // Keep any previously loaded audit so Make It Better / dashboard stay mounted.
        setError('Failed to load audit report. Refresh the page or check that the backend is running.');
        setLoading(false);
        return null;
      }
    }
    setLoading(false);
    return null;
  }, [auditId]);

  useEffect(() => {
    backfillStarted.current = false;
    if (loadedAuditId.current !== auditId) {
      hasLoadedAudit.current = false;
      loadedAuditId.current = auditId;
      setAudit(null);
    }
    // Only full-page load when we have no report yet — never unmount dashboard mid Make It Better.
    if (!hasLoadedAudit.current) setLoading(true);
    setError(null);
    setBackfillError(null);
    void load();
  }, [load, auditId]);

  useEffect(() => {
    if (!auditId || !audit || backfillStarted.current || !auditNeedsModuleBackfill(audit)) return;

    backfillStarted.current = true;
    setBackfilling(true);
    setBackfillError(null);
    setBackfillProgress('Analyzing remaining audit modules…');

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
