import { useState } from 'react';
import clsx from 'clsx';
import { ChevronLeft, ChevronRight, Link2, Phone, MapPin } from 'lucide-react';
import type { PreviewDevice } from '../../types/optimization';
import { normalizeRenderableStrings } from './utils';

interface AdPreviewPanelProps {
  headlines: string[];
  descriptions: string[];
  displayUrl?: string;
  displayPaths?: { path1?: string; path2?: string };
  sitelinks?: string[];
  callouts?: string[];
  structuredSnippets?: string[];
  device: PreviewDevice;
  onDeviceChange: (d: PreviewDevice) => void;
  variant?: 'current' | 'optimized';
  finalUrl?: string;
}

export function AdPreviewPanel({
  headlines,
  descriptions,
  displayUrl = 'www.example.com',
  displayPaths,
  sitelinks = [],
  callouts = [],
  structuredSnippets = [],
  device,
  onDeviceChange,
  variant = 'optimized',
  finalUrl,
}: AdPreviewPanelProps) {
  const [headlineIdx, setHeadlineIdx] = useState(0);
  const [descIdx, setDescIdx] = useState(0);

  const safeHeadlines = normalizeRenderableStrings(headlines);
  const safeDescriptions = normalizeRenderableStrings(descriptions);
  const safeSitelinks = normalizeRenderableStrings(sitelinks);
  const safeCallouts = normalizeRenderableStrings(callouts);
  const safeSnippets = normalizeRenderableStrings(structuredSnippets);

  const cleanUrl = displayUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const path1 = displayPaths?.path1;
  const path2 = displayPaths?.path2;
  const urlLine = path1
    ? `${cleanUrl}${path2 ? ` › ${path1} › ${path2}` : ` › ${path1}`}`
    : cleanUrl;

  const headline = safeHeadlines[headlineIdx] ?? safeHeadlines[0] ?? 'Your Headline Here';
  const description = safeDescriptions[descIdx] ?? safeDescriptions[0] ?? 'Your ad description will appear here.';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-muted text-xs uppercase tracking-wider">
          {variant === 'optimized' ? 'AI Optimized Preview' : 'Current Ad Preview'}
        </span>
        <div className="flex gap-1 bg-navy rounded-lg p-0.5 border border-border">
          {(['mobile', 'desktop'] as PreviewDevice[]).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => onDeviceChange(d)}
              className={clsx(
                'px-2.5 py-1 rounded-md text-[10px] font-semibold capitalize transition-colors',
                device === d ? 'bg-orange/20 text-orange' : 'text-muted hover:text-white'
              )}
            >
              {d}
            </button>
          ))}
        </div>
      </div>

      {/* Google SERP mock */}
      <div
        className={clsx(
          'rounded-xl border transition-all duration-300 overflow-hidden',
          variant === 'optimized'
            ? 'border-teal/40 bg-gradient-to-br from-teal/5 to-navy glow-teal'
            : 'border-border bg-navy/50',
          device === 'mobile' ? 'max-w-[320px] mx-auto' : 'w-full'
        )}
      >
        <div className={clsx('bg-white/5', device === 'mobile' ? 'p-3' : 'p-5')}>
          <div className="flex items-center gap-1.5 mb-1">
            <span className="text-[9px] font-bold text-teal bg-teal/15 px-1.5 py-0.5 rounded">Sponsored</span>
          </div>
          <div className="flex items-center gap-1 mb-1">
            <span className="text-[10px] text-muted truncate">{urlLine}</span>
          </div>
          <h3
            className={clsx(
              'text-blue-400 font-medium leading-snug mb-1.5 hover:underline cursor-default',
              device === 'mobile' ? 'text-[15px]' : 'text-lg'
            )}
          >
            {headline}
          </h3>
          <p className={clsx('text-gray-300 leading-relaxed', device === 'mobile' ? 'text-xs' : 'text-sm')}>
            {description}
          </p>
          {finalUrl && (
            <p className="text-[10px] text-teal/80 mt-2 flex items-center gap-1 truncate">
              <Link2 size={10} /> {finalUrl}
            </p>
          )}
        </div>

        {/* Ad extensions preview */}
        {(safeSitelinks.length > 0 || safeCallouts.length > 0) && (
          <div className="border-t border-border/60 px-3 py-2.5 space-y-2 bg-panel/30">
            {safeSitelinks.length > 0 && (
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                {safeSitelinks.slice(0, 4).map((link, i) => (
                  <span key={i} className="text-[11px] text-blue-400/90">{link}</span>
                ))}
              </div>
            )}
            {safeCallouts.length > 0 && (
              <p className="text-[10px] text-muted leading-relaxed">
                {safeCallouts.slice(0, 4).join(' · ')}
              </p>
            )}
            {safeSnippets.length > 0 && (
              <p className="text-[10px] text-muted">
                {safeSnippets.slice(0, 5).join(', ')}
              </p>
            )}
          </div>
        )}
      </div>

      {/* RSA headline / description rotator */}
      {safeHeadlines.length > 1 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-muted uppercase tracking-wide">
              Headline {headlineIdx + 1} of {safeHeadlines.length}
            </span>
            <div className="flex gap-1">
              <button
                type="button"
                className="p-1 rounded border border-border text-muted hover:text-white disabled:opacity-30"
                disabled={headlineIdx === 0}
                onClick={() => setHeadlineIdx((i) => Math.max(0, i - 1))}
              >
                <ChevronLeft size={14} />
              </button>
              <button
                type="button"
                className="p-1 rounded border border-border text-muted hover:text-white disabled:opacity-30"
                disabled={headlineIdx >= safeHeadlines.length - 1}
                onClick={() => setHeadlineIdx((i) => Math.min(safeHeadlines.length - 1, i + 1))}
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
          <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
            {safeHeadlines.map((h, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setHeadlineIdx(i)}
                className={clsx(
                  'text-[10px] rounded px-2 py-1 border truncate max-w-full text-left',
                  i === headlineIdx
                    ? 'border-orange/50 bg-orange/10 text-white'
                    : 'border-border text-muted hover:border-orange/30'
                )}
              >
                H{i + 1}: {h} <span className="opacity-50">({h.length})</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {safeDescriptions.length > 1 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-muted uppercase tracking-wide">
              Description {descIdx + 1} of {safeDescriptions.length}
            </span>
            <div className="flex gap-1">
              <button
                type="button"
                className="p-1 rounded border border-border text-muted hover:text-white disabled:opacity-30"
                disabled={descIdx === 0}
                onClick={() => setDescIdx((i) => Math.max(0, i - 1))}
              >
                <ChevronLeft size={14} />
              </button>
              <button
                type="button"
                className="p-1 rounded border border-border text-muted hover:text-white disabled:opacity-30"
                disabled={descIdx >= safeDescriptions.length - 1}
                onClick={() => setDescIdx((i) => Math.min(safeDescriptions.length - 1, i + 1))}
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
          <div className="space-y-1">
            {safeDescriptions.map((d, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setDescIdx(i)}
                className={clsx(
                  'w-full text-left text-[10px] rounded px-2 py-1.5 border',
                  i === descIdx
                    ? 'border-teal/50 bg-teal/10 text-white'
                    : 'border-border text-muted hover:border-teal/30'
                )}
              >
                D{i + 1}: {d} <span className="opacity-50">({d.length})</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {variant === 'optimized' && (
        <div className="flex flex-wrap gap-3 text-[10px] text-muted pt-1">
          <span className="flex items-center gap-1"><Phone size={10} /> Call extension ready</span>
          <span className="flex items-center gap-1"><MapPin size={10} /> Location targeting from account</span>
        </div>
      )}
    </div>
  );
}
