import { Plus, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import { Button } from '../ui/Button';

export interface EditableOptimizationAssetsProps {
  sitelinks: string[];
  callouts: string[];
  structuredSnippets: string[];
  keywords: string[];
  negativeKeywords: string[];
  onSitelinksChange: (next: string[]) => void;
  onCalloutsChange: (next: string[]) => void;
  onStructuredSnippetsChange: (next: string[]) => void;
  onKeywordsChange: (next: string[]) => void;
  onNegativeKeywordsChange: (next: string[]) => void;
  disabled?: boolean;
  /** Compact layout for review step sidebars */
  compact?: boolean;
  /** Hide keyword editors when shown elsewhere on the page */
  showKeywords?: boolean;
}

function ListEditor({
  label,
  hint,
  items,
  onChange,
  placeholder,
  maxLength,
  disabled,
  addLabel,
}: {
  label: string;
  hint?: string;
  items: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
  maxLength?: number;
  disabled?: boolean;
  addLabel: string;
}) {
  const rows = items.length ? items : [''];

  return (
    <div className="rounded-xl border border-border bg-navy/40 p-3 space-y-2">
      <div>
        <p className="text-orange text-[11px] font-semibold uppercase tracking-wider">{label}</p>
        {hint && <p className="text-muted text-[10px] mt-0.5">{hint}</p>}
      </div>
      <div className="space-y-2">
        {rows.map((value, i) => (
          <div key={`${label}-${i}`} className="flex gap-2 items-start">
            <input
              type="text"
              value={value}
              disabled={disabled}
              maxLength={maxLength}
              placeholder={placeholder}
              onChange={(e) => {
                const next = [...rows];
                next[i] = e.target.value;
                onChange(next);
              }}
              className="flex-1 min-w-0 bg-panel border border-border rounded-lg px-3 py-2 text-xs text-white placeholder:text-muted focus:border-teal/50 outline-none disabled:opacity-50"
            />
            <button
              type="button"
              disabled={disabled || rows.length <= 1}
              onClick={() => onChange(rows.filter((_, j) => j !== i))}
              className="p-2 rounded-lg border border-border text-muted hover:text-red-300 hover:border-red-400/40 disabled:opacity-30"
              aria-label={`Remove ${label} row`}
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
      <Button
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => onChange([...rows.filter(Boolean), ''])}
      >
        <Plus size={14} /> {addLabel}
      </Button>
    </div>
  );
}

export function EditableOptimizationAssets({
  sitelinks,
  callouts,
  structuredSnippets,
  keywords,
  negativeKeywords,
  onSitelinksChange,
  onCalloutsChange,
  onStructuredSnippetsChange,
  onKeywordsChange,
  onNegativeKeywordsChange,
  disabled,
  compact,
  showKeywords = true,
}: EditableOptimizationAssetsProps) {
  return (
    <div className={clsx('space-y-3', compact && 'text-sm')}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[10px] uppercase tracking-wider text-muted">Ad assets &amp; keywords</p>
        <p className="text-[10px] text-muted">
          Edit here manually, or describe changes in <span className="text-purple-300">Refine generation</span> and
          apply via AI.
        </p>
      </div>

      <ListEditor
        label="Sitelinks"
        hint="Text and optional URL — e.g. Get Free Quote (https://yoursite.com/page)"
        items={sitelinks}
        onChange={onSitelinksChange}
        placeholder="Sitelink text (optional URL in parentheses)"
        maxLength={120}
        disabled={disabled}
        addLabel="Add sitelink"
      />

      <ListEditor
        label="Callouts"
        hint="Max 25 characters each"
        items={callouts}
        onChange={onCalloutsChange}
        placeholder="Callout extension"
        maxLength={25}
        disabled={disabled}
        addLabel="Add callout"
      />

      <ListEditor
        label="Structured snippets"
        hint="One value per line (e.g. Offices, Warehouses)"
        items={structuredSnippets}
        onChange={onStructuredSnippetsChange}
        placeholder="Snippet value"
        maxLength={48}
        disabled={disabled}
        addLabel="Add snippet value"
      />

      {showKeywords && (
        <>
          <ListEditor
            label="Keywords"
            hint="Recommended search terms for this ad / service"
            items={keywords}
            onChange={onKeywordsChange}
            placeholder="Keyword or phrase"
            maxLength={80}
            disabled={disabled}
            addLabel="Add keyword"
          />

          <ListEditor
            label="Negative keywords"
            hint="Terms to exclude from matching"
            items={negativeKeywords}
            onChange={onNegativeKeywordsChange}
            placeholder="Negative keyword"
            maxLength={80}
            disabled={disabled}
            addLabel="Add negative keyword"
          />
        </>
      )}
    </div>
  );
}
