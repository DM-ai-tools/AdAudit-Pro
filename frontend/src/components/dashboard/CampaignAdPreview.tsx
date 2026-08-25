import clsx from 'clsx';
import { useRef, useState } from 'react';
import { Sparkles, Upload, Loader2, X, FileText } from 'lucide-react';
import type { GoogleAdsCampaignAd } from '../../types/connect';
import { formatCurrencyPrecise, formatNumber, formatPercent } from '../../utils/helpers';
import { aiApi } from '../../services/api';
import {
  CompetitorConfirmModal,
  type CompetitorConfirmResult,
} from '../optimization/CompetitorConfirmModal';

export type AdCompetitorUpload = {
  competitorUrls: string[];
  competitorNames: string[];
  competitorEntries: Array<{ name: string; url?: string }>;
  labels: string[];
  filename?: string;
  /** How Make It Better should discover rivals after confirm */
  mode?: 'uploaded_only' | 'auto' | 'both';
};

interface CampaignAdPreviewProps {
  ad: GoogleAdsCampaignAd;
  currency?: string;
  compact?: boolean;
  /** Ad-level Make This Ad Better */
  onOptimizeAd?: (competitors?: AdCompetitorUpload) => void;
  inferredService?: string;
  /** Show DOC/PDF competitor upload next to the ad */
  enableCompetitorUpload?: boolean;
  competitorUpload?: AdCompetitorUpload | null;
  onCompetitorUploadChange?: (upload: AdCompetitorUpload | null) => void;
}

function displayHost(urls: string[]): string {
  const raw = urls[0];
  if (!raw) return 'www.example.com';
  try {
    return new URL(raw.startsWith('http') ? raw : `https://${raw}`).hostname.replace(/^www\./, '');
  } catch {
    return raw.replace(/^https?:\/\//, '').split('/')[0];
  }
}

export function CampaignAdPreview({
  ad,
  currency = 'AUD',
  compact = false,
  onOptimizeAd,
  inferredService,
  enableCompetitorUpload = false,
  competitorUpload = null,
  onCompetitorUploadChange,
}: CampaignAdPreviewProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingUpload, setPendingUpload] = useState<AdCompetitorUpload | null>(null);

  const host = displayHost(ad.finalUrls);
  const pathLine = ad.displayPath1
    ? `${host} › ${ad.displayPath1}${ad.displayPath2 ? ` › ${ad.displayPath2}` : ''}`
    : host;
  const headlinePreview = ad.headlines.slice(0, 3).join(' | ') || 'Ad headline';
  const descriptionPreview = ad.descriptions[0] ?? 'Ad description';

  const handleFile = async (file: File | undefined) => {
    if (!file || !onCompetitorUploadChange) return;
    setUploading(true);
    setUploadError(null);
    try {
      const { data } = await aiApi.parseCompetitors(file);
      const entries = (data.competitors ?? []).map((c) => ({
        name: c.name || c.url || 'Competitor',
        url: c.url,
      }));
      const labels = entries.map((c) => c.name).filter(Boolean);
      const upload: AdCompetitorUpload = {
        competitorUrls: data.competitorUrls ?? entries.map((e) => e.url!).filter(Boolean),
        competitorNames: data.competitorNames ?? labels,
        competitorEntries: entries,
        labels,
        filename: data.filename || file.name,
      };
      // Local only until confirm — do not expand parent list height under the modal.
      setPendingUpload(upload);
      setConfirmOpen(true);
    } catch (err) {
      const message =
        err && typeof err === 'object' && 'response' in err
          ? (err as { response?: { data?: { error?: string } } }).response?.data?.error
          : undefined;
      setUploadError(message || 'Could not extract competitors from that file.');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const confirmed = competitorUpload;
  const showActions = enableCompetitorUpload || onOptimizeAd;

  return (
    <div
      className={clsx(
        'rounded-lg border border-border bg-panel/40',
        compact ? 'p-3' : 'p-4'
      )}
    >
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="min-w-0">
          <p className="text-white text-xs font-semibold truncate">{ad.adGroupName}</p>
          <p className="text-muted text-[10px]">
            {ad.adType.replace(/_/g, ' ')}
            {ad.adStrength ? ` · ${ad.adStrength.replace(/_/g, ' ')}` : ''}
          </p>
          {inferredService && (
            <p className="text-teal text-[10px] mt-0.5 truncate">Service: {inferredService}</p>
          )}
        </div>
        <span
          className={clsx(
            'text-[9px] font-bold uppercase px-1.5 py-0.5 rounded shrink-0',
            ad.status === 'ENABLED' ? 'bg-teal/15 text-teal' : 'bg-panel text-muted'
          )}
        >
          {ad.status}
        </span>
      </div>

      <div className="rounded-lg border border-border/60 bg-navy/60 p-3 mb-3">
        <span className="text-[9px] font-bold text-teal bg-teal/15 px-1.5 py-0.5 rounded">Sponsored</span>
        <p className="text-[10px] text-muted mt-1.5 truncate">{pathLine}</p>
        <p className="text-blue-400 text-sm font-medium leading-snug mt-1 line-clamp-2">{headlinePreview}</p>
        <p className="text-gray-300 text-xs leading-relaxed mt-1 line-clamp-2">{descriptionPreview}</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px]">
        <Stat label="Clicks" value={formatNumber(ad.clicks)} />
        <Stat label="Impr." value={formatNumber(ad.impressions)} />
        <Stat label="CTR" value={formatPercent(ad.ctr)} />
        <Stat label="Avg. CPC" value={formatCurrencyPrecise(ad.avgCpc, currency)} />
      </div>

      {showActions && (
        <div className="mt-3">
          <div className="flex flex-wrap items-center gap-2">
            {enableCompetitorUpload && onCompetitorUploadChange && (
              <>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".pdf,.doc,.docx,.xls,.xlsx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  className="hidden"
                  onChange={(e) => void handleFile(e.target.files?.[0])}
                />
                <button
                  type="button"
                  disabled={uploading || confirmOpen}
                  onClick={(e) => {
                    e.stopPropagation();
                    fileRef.current?.click();
                  }}
                  className={clsx(
                    'inline-flex items-center justify-center gap-1.5 font-semibold rounded-lg',
                    'border border-teal/40 text-teal bg-teal/10 hover:bg-teal/20 hover:border-teal/60',
                    'h-8 px-3 text-xs disabled:opacity-60 shrink-0'
                  )}
                >
                  {uploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                  {uploading ? 'Extracting…' : confirmed ? 'Replace file' : 'Upload competitors'}
                </button>
              </>
            )}
            {onOptimizeAd && (
              <button
                type="button"
                disabled={uploading || confirmOpen}
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirmed) {
                    onOptimizeAd(confirmed);
                    return;
                  }
                  onOptimizeAd({
                    competitorUrls: [],
                    competitorNames: [],
                    competitorEntries: [],
                    labels: [],
                    mode: 'auto',
                  });
                }}
                className={clsx(
                  'inline-flex items-center justify-center gap-1.5 font-semibold rounded-lg',
                  'bg-gradient-to-r from-orange/20 to-purple-500/10 border border-orange/40 text-orange',
                  'hover:from-orange/30 hover:to-purple-500/20 hover:border-orange/60',
                  'h-8 px-3 text-xs disabled:opacity-60'
                )}
              >
                <Sparkles size={12} />
                {confirmed ? 'Start generation' : 'Make This Ad Better'}
              </button>
            )}
          </div>

          {/* Fixed-height status slot — avoids list jump when upload is confirmed */}
          <div className="mt-2 h-8 flex items-center">
            {uploadError ? (
              <p className="text-red-300 text-[11px] truncate">{uploadError}</p>
            ) : confirmed ? (
              <div className="w-full flex items-center gap-2 rounded-md border border-teal/20 bg-teal/5 px-2 h-8">
                <FileText size={12} className="text-teal shrink-0" />
                <p
                  className="text-[11px] text-teal truncate min-w-0 flex-1"
                  title={`${confirmed.labels.join(', ')}${confirmed.filename ? ` (${confirmed.filename})` : ''}`}
                >
                  {confirmed.labels.length} competitor{confirmed.labels.length === 1 ? '' : 's'} ready for this ad
                  {confirmed.filename ? ` · ${confirmed.filename}` : ''}
                </p>
                {onCompetitorUploadChange && (
                  <button
                    type="button"
                    aria-label="Clear uploaded competitors"
                    onClick={(e) => {
                      e.stopPropagation();
                      onCompetitorUploadChange(null);
                      setPendingUpload(null);
                      setConfirmOpen(false);
                      setUploadError(null);
                    }}
                    className="text-muted hover:text-white shrink-0 p-0.5"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            ) : enableCompetitorUpload ? (
              <p className="text-muted text-[10px] truncate">
                Optional: upload rivals for this ad, then Start generation. Without a file, AI discovers competitors.
              </p>
            ) : null}
          </div>
        </div>
      )}

      {pendingUpload && (
        <CompetitorConfirmModal
          open={confirmOpen}
          upload={pendingUpload}
          primaryService={inferredService}
          onCancel={() => {
            setConfirmOpen(false);
            setPendingUpload(null);
          }}
          onConfirm={(result: CompetitorConfirmResult) => {
            // Save only — do not auto-open Make It Better (avoids modal + list thrash).
            onCompetitorUploadChange?.(result);
            setConfirmOpen(false);
            setPendingUpload(null);
          }}
        />
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-muted uppercase tracking-wide">{label}</p>
      <p className="text-white font-semibold">{value}</p>
    </div>
  );
}
