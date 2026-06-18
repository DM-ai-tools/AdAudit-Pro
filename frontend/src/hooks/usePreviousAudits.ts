import { useEffect, useState, useCallback } from 'react';
import { auditApi } from '../services/api';
import type { AuditSummary } from '../types';

export function usePreviousAudits(enabled = true) {
  const [audits, setAudits] = useState<AuditSummary[]>([]);
  const [userEmail, setUserEmail] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!enabled || !localStorage.getItem('token')) {
      setAudits([]);
      setUserEmail(undefined);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { data } = await auditApi.list();
      setAudits(data.audits);
      setUserEmail(data.userEmail);
    } catch {
      setError('Could not load previous audits');
      setAudits([]);
      setUserEmail(undefined);
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      setAudits([]);
      setUserEmail(undefined);
      setError(null);
      setLoading(false);
      return;
    }
    void load();
  }, [enabled, load]);

  return { audits, userEmail, loading, error, reload: load };
}
