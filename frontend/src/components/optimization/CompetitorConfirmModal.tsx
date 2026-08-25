import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, FileText, Plus, Upload, X } from 'lucide-react';
import clsx from 'clsx';
import { Button } from '../ui/Button';
import type { AdCompetitorUpload } from '../dashboard/CampaignAdPreview';

export type CompetitorDiscoveryMode = 'uploaded_only' | 'auto' | 'both';

export type CompetitorConfirmResult = AdCompetitorUpload & {
  mode: CompetitorDiscoveryMode;
};

interface CompetitorConfirmModalProps {
  open: boolean;
  upload: AdCompetitorUpload;
  primaryService?: string;
  onConfirm: (result: CompetitorConfirmResult) => void;
  onCancel: () => void;
}

function scoreServiceRelevance(name: string, url: string | undefined, service?: string): 'high' | 'medium' | 'low' {
  if (!service?.trim()) return 'medium';
  const serviceTokens = service
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !['and', 'the', 'for', 'loan', 'loans'].includes(t));
  const blob = `${name} ${url ?? ''}`.toLowerCase();
  if (!serviceTokens.length) return 'medium';
  const hits = serviceTokens.filter((t) => blob.includes(t)).length;
  if (hits >= 2 || (serviceTokens.length === 1 && hits === 1)) return 'high';
  if (hits === 1) return 'medium';
  if (/\b(bank|finance|loan|credit|lender)\b/i.test(blob)) return 'medium';
  return 'low';
}

export function CompetitorConfirmModal({
  open,
  upload,
  primaryService,
  onConfirm,
  onCancel,
}: CompetitorConfirmModalProps) {
  const [entries, setEntries] = useState(
    () =>
      upload.competitorEntries?.length
        ? upload.competitorEntries.map((e) => ({ name: e.name, url: e.url }))
        : upload.labels.map((name) => ({ name, url: undefined as string | undefined }))
  );
  const [mode, setMode] = useState<CompetitorDiscoveryMode>(upload.mode ?? 'both');
  const [newName, setNewName] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [keptLowRelevance, setKeptLowRelevance] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!open) return;
    setEntries(
      upload.competitorEntries?.length
        ? upload.competitorEntries.map((e) => ({ name: e.name, url: e.url }))
        : upload.labels.map((name) => ({ name, url: undefined as string | undefined }))
    );
    setMode(upload.mode ?? 'both');
    setKeptLowRelevance({});
    setNewName('');
    setNewUrl('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, upload.filename, upload.labels.join('\u0001'), upload.mode]);

  // Lock body scroll while the modal is open — prevents list scroll thrash behind it
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const rows = useMemo(
    () =>
      entries.map((e, i) => ({
        ...e,
        key: `${e.name}-${i}`,
        relevance: scoreServiceRelevance(e.name, e.url, primaryService),
      })),
    [entries, primaryService]
  );

  const lowRelevance = rows.filter((r) => r.relevance === 'low' && !keptLowRelevance[r.key]);

  const removeAt = (idx: number) => {
    setEntries((prev) => prev.filter((_, i) => i !== idx));
  };

  const addCompetitor = () => {
    const name = newName.trim();
    if (!name) return;
    setEntries((prev) => [...prev, { name, url: newUrl.trim() || undefined }]);
    setNewName('');
    setNewUrl('');
  };

  const handleConfirm = () => {
    const cleaned = entries
      .map((e) => ({ name: e.name.trim(), url: e.url?.trim() || undefined }))
      .filter((e) => e.name);
    const deduped: typeof cleaned = [];
    const seen = new Set<string>();
    for (const e of cleaned) {
      const key = (e.url || e.name).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(e);
    }
    onConfirm({
      ...upload,
      competitorEntries: deduped,
      competitorNames: deduped.map((e) => e.name),
      competitorUrls: deduped.map((e) => e.url!).filter(Boolean),
      labels: deduped.map((e) => e.name),
      mode,
    });
  };

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[200] bg-black/80 flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-competitors-title"
    >
      <div
        className="bg-panel border border-orange/30 rounded-2xl w-full max-w-xl max-h-[85vh] overflow-y-auto p-5 space-y-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 id="confirm-competitors-title" className="text-white font-bold text-lg">
              Confirm Competitors
            </h3>
            <p className="text-muted text-xs mt-1">
              These rivals will be used for this ad&apos;s Make It Better run
              {primaryService ? (
                <>
                  {' '}
                  · service <span className="text-teal">{primaryService}</span>
                </>
              ) : null}
              . Generation starts when you click Start.
            </p>
          </div>
          <button type="button" onClick={onCancel} className="text-muted hover:text-white p-1" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="rounded-lg border border-border bg-navy/50 px-3 py-2 flex items-center gap-2 text-xs text-muted">
          <FileText size={14} className="text-teal shrink-0" />
          <span className="truncate text-white/90">{upload.filename ?? 'Uploaded document'}</span>
          <span className="ml-auto shrink-0">{rows.length} detected</span>
        </div>

        <div className="space-y-2">
          <p className="text-[10px] uppercase tracking-wider text-muted">Competitor source</p>
          <div className="flex flex-wrap gap-2">
            {(
              [
                { id: 'uploaded_only' as const, label: 'My Competitors' },
                { id: 'auto' as const, label: 'Find Automatically' },
                { id: 'both' as const, label: 'My Competitors + AI Discovery' },
              ] as const
            ).map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setMode(m.id)}
                className={clsx(
                  'px-3 py-1.5 rounded-full text-[11px] border transition-colors',
                  mode === m.id
                    ? 'border-orange/50 bg-orange/15 text-orange'
                    : 'border-border text-muted hover:text-white'
                )}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        {lowRelevance.length > 0 && (
          <div className="rounded-lg border border-amber-400/30 bg-amber-400/10 p-3 space-y-2">
            <p className="text-amber-200 text-xs font-semibold flex items-center gap-1.5">
              <AlertTriangle size={14} /> Competitor relevance warning
            </p>
            <p className="text-[11px] text-amber-100/80">
              These names look weakly related to {primaryService || 'this ad’s service'}. Keep or remove —
              nothing is removed silently.
            </p>
            {lowRelevance.map((r) => {
              const idx = rows.findIndex((x) => x.key === r.key);
              return (
                <div key={r.key} className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-white truncate">{r.name}</span>
                  <div className="flex gap-2 shrink-0">
                    <button
                      type="button"
                      className="text-teal hover:underline"
                      onClick={() => setKeptLowRelevance((p) => ({ ...p, [r.key]: true }))}
                    >
                      Keep Anyway
                    </button>
                    <button
                      type="button"
                      className="text-red-300 hover:underline"
                      onClick={() => idx >= 0 && removeAt(idx)}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="space-y-2 max-h-56 overflow-y-auto overscroll-contain">
          {rows.map((r, idx) => (
            <div
              key={r.key}
              className="flex items-start gap-2 rounded-lg border border-border bg-navy/40 px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <p className="text-white text-sm truncate">{r.name}</p>
                {r.url && <p className="text-[10px] text-muted truncate">{r.url}</p>}
                <p
                  className={clsx(
                    'text-[10px] mt-0.5',
                    r.relevance === 'high'
                      ? 'text-teal'
                      : r.relevance === 'medium'
                        ? 'text-muted'
                        : 'text-amber-300'
                  )}
                >
                  Relevance: {r.relevance}
                </p>
              </div>
              <button
                type="button"
                onClick={() => removeAt(idx)}
                className="text-muted hover:text-white shrink-0"
                aria-label={`Remove ${r.name}`}
              >
                <X size={14} />
              </button>
            </div>
          ))}
          {!rows.length && (
            <p className="text-muted text-xs">No competitors left. Add at least one or use automatic discovery.</p>
          )}
        </div>

        <div className="grid sm:grid-cols-[1fr_1fr_auto] gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Add competitor name"
            className="bg-navy border border-border rounded-lg px-3 py-2 text-xs text-white outline-none focus:border-orange/40"
          />
          <input
            value={newUrl}
            onChange={(e) => setNewUrl(e.target.value)}
            placeholder="URL (optional)"
            className="bg-navy border border-border rounded-lg px-3 py-2 text-xs text-white outline-none focus:border-orange/40"
          />
          <Button variant="outline" size="sm" onClick={addCompetitor} disabled={!newName.trim()}>
            <Plus size={14} /> Add
          </Button>
        </div>

        <div className="flex justify-end gap-2 pt-1 border-t border-border">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={mode !== 'auto' && rows.length === 0}
            className="bg-gradient-to-r from-orange to-orange-2"
          >
            <Upload size={14} /> Save competitors
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
}
