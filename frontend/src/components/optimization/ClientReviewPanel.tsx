import { useMemo, useState } from 'react';
import { CheckCircle2, Circle } from 'lucide-react';
import clsx from 'clsx';
import { Button } from '../ui/Button';

export type PublishExistingAdAction = 'keep_active' | 'pause_existing';

interface ClientReviewPanelProps {
  canPublish: boolean;
  validation: Array<{ id: string; label: string; ok: boolean; detail?: string }>;
  onPublish: (opts: { pauseExisting: boolean; approvalsComplete: boolean }) => void;
  disabled?: boolean;
}

const APPROVALS = [
  { id: 'campaign', label: 'I approve the campaign / ad group selection' },
  { id: 'url', label: 'I approve the final URL' },
  { id: 'headlines', label: 'I approve the headlines' },
  { id: 'descriptions', label: 'I approve the descriptions' },
  { id: 'assets', label: 'I approve the ad assets' },
  { id: 'tracking', label: 'I approve preserving existing tracking (or any shown changes)' },
  { id: 'publish', label: 'I approve publishing to Google Ads' },
] as const;

export function ClientReviewPanel({
  canPublish,
  validation,
  onPublish,
  disabled,
}: ClientReviewPanelProps) {
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [existingAction, setExistingAction] = useState<PublishExistingAdAction>('keep_active');

  const allApproved = useMemo(
    () => APPROVALS.every((a) => checks[a.id]),
    [checks]
  );
  const validationOk = validation.every((v) => v.ok);

  return (
    <div className="space-y-4">
      <div className="bg-panel border border-border rounded-2xl p-5 space-y-3">
        <h3 className="text-white font-semibold">Google Ads check</h3>
        <div className="space-y-2">
          {validation.map((v) => (
            <div key={v.id} className="flex items-start gap-2 text-sm">
              {v.ok ? (
                <CheckCircle2 size={16} className="text-teal shrink-0 mt-0.5" />
              ) : (
                <Circle size={16} className="text-red-400 shrink-0 mt-0.5" />
              )}
              <div>
                <p className={v.ok ? 'text-white' : 'text-red-300'}>
                  {v.ok ? '✓' : '✗'} {v.label}
                </p>
                {v.detail && <p className="text-[11px] text-muted">{v.detail}</p>}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-panel border border-border rounded-2xl p-5 space-y-3">
        <h3 className="text-white font-semibold">Publishing behavior</h3>
        <label className="flex items-start gap-2 text-sm text-muted cursor-pointer">
          <input
            type="radio"
            className="mt-1"
            checked={existingAction === 'keep_active'}
            onChange={() => setExistingAction('keep_active')}
          />
          <span>
            <span className="text-white">Create new ad and keep existing ad</span>
            <span className="block text-[11px]">Default — no automatic pause or delete.</span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm text-muted cursor-pointer">
          <input
            type="radio"
            className="mt-1"
            checked={existingAction === 'pause_existing'}
            onChange={() => setExistingAction('pause_existing')}
          />
          <span>
            <span className="text-white">Create new ad and pause existing ad</span>
            <span className="block text-[11px]">Requires your explicit choice — never automatic.</span>
          </span>
        </label>
      </div>

      <div className="bg-panel border border-orange/25 rounded-2xl p-5 space-y-3">
        <h3 className="text-white font-semibold">Client approval</h3>
        {APPROVALS.map((a) => (
          <label key={a.id} className="flex items-start gap-2 text-sm text-muted cursor-pointer">
            <input
              type="checkbox"
              className="mt-1"
              checked={!!checks[a.id]}
              onChange={(e) => setChecks((p) => ({ ...p, [a.id]: e.target.checked }))}
            />
            <span>{a.label}</span>
          </label>
        ))}
        <Button
          disabled={disabled || !canPublish || !allApproved || !validationOk}
          onClick={() =>
            onPublish({
              pauseExisting: existingAction === 'pause_existing',
              approvalsComplete: allApproved,
            })
          }
          className={clsx(
            'w-full sm:w-auto bg-gradient-to-r from-orange to-orange-2',
            (!allApproved || !validationOk) && 'opacity-50'
          )}
        >
          Approve &amp; Publish
        </Button>
        {(!allApproved || !validationOk) && (
          <p className="text-[11px] text-muted">
            Complete all approvals and resolve Google Ads checks before publishing.
          </p>
        )}
      </div>
    </div>
  );
}
