import { useEffect, useRef, useState, useCallback } from 'react';
import { auditApi } from '../services/api';
import type { AuditRun } from '../types';

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

export function useAuditReport(auditId: string | undefined) {
  const [audit, setAudit] = useState<AuditRun | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!auditId) return;
    auditApi.report(auditId).then(({ data }) => {
      setAudit(data.audit);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [auditId]);

  return { audit, loading };
}
