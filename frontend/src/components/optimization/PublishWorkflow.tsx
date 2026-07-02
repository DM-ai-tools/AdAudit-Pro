import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AlertTriangle, CheckCircle2, ChevronRight, Circle, Loader2,
  RotateCcw, Send, X,
} from 'lucide-react';
import clsx from 'clsx';
import { Button } from '../ui/Button';
import type {
  OptimizationScenario,
  PublishAdResponse,
  PublishStep,
  PublishStepStatus,
} from '../../types/optimization';

type WorkflowPhase = 'confirm' | 'publishing' | 'success' | 'error';

const VISIBLE_STEPS: Array<{ id: string; label: string }> = [
  { id: 'validate', label: 'Validating permissions' },
  { id: 'token', label: 'Refreshing OAuth token' },
  { id: 'resolve', label: 'Resolving campaign & ad group' },
  { id: 'campaign', label: 'Creating campaign' },
  { id: 'adgroup', label: 'Creating ad group' },
  { id: 'keywords', label: 'Adding keywords' },
  { id: 'pause', label: 'Pausing previous ad' },
  { id: 'create_ad', label: 'Creating optimized ad' },
  { id: 'save', label: 'Saving version history' },
];

function scenarioConfirmCopy(scenario: OptimizationScenario, campaignName?: string): string {
  if (scenario === 'REPLACE_EXISTING') {
    return 'The existing ad will be paused (not deleted). A new optimized Responsive Search Ad will be created in paused status until you enable it in Google Ads.';
  }
  if (scenario === 'CREATE_STRATEGY') {
    return 'A new Search campaign, ad group, keywords, and Responsive Search Ad will be created in paused status. Review and enable them in Google Ads when ready.';
  }
  if (campaignName) {
    return `A new Responsive Search Ad will be added to "${campaignName}" (paused until you enable it in Google Ads).`;
  }
  return 'A new Responsive Search Ad will be created in your selected campaign (paused until you enable it in Google Ads).';
}

function stepIcon(status: PublishStepStatus) {
  if (status === 'complete') return <CheckCircle2 size={16} className="text-teal shrink-0" />;
  if (status === 'running') return <Loader2 size={16} className="text-orange animate-spin shrink-0" />;
  if (status === 'failed') return <AlertTriangle size={16} className="text-red-400 shrink-0" />;
  if (status === 'skipped') return <Circle size={16} className="text-muted/40 shrink-0" />;
  return <Circle size={16} className="text-muted/60 shrink-0" />;
}

function formatTimestamp(iso?: string): string {
  if (!iso) return new Date().toLocaleString();
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

interface PublishWorkflowProps {
  open: boolean;
  scenario: OptimizationScenario;
  campaignName?: string;
  accountName: string;
  publishing: boolean;
  publishResult: PublishAdResponse | null;
  publishError: string | null;
  rollbackAvailable: boolean;
  rollingBack: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  onClose: () => void;
  onRollback: () => void;
}

export function PublishWorkflow({
  open,
  scenario,
  campaignName,
  accountName,
  publishing,
  publishResult,
  publishError,
  rollbackAvailable,
  rollingBack,
  onConfirm,
  onCancel,
  onClose,
  onRollback,
}: PublishWorkflowProps) {
  const [phase, setPhase] = useState<WorkflowPhase>('confirm');
  const [displaySteps, setDisplaySteps] = useState<PublishStep[]>([]);
  const stepTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const stepIndex = useRef(0);

  useEffect(() => {
    if (!open) {
      setPhase('confirm');
      setDisplaySteps([]);
      stepIndex.current = 0;
      if (stepTimer.current) clearInterval(stepTimer.current);
      return;
    }
    if (publishing) {
      setPhase('publishing');
      const initial = VISIBLE_STEPS.map((s, i) => ({
        id: s.id,
        label: s.label,
        status: (i === 0 ? 'running' : 'pending') as PublishStepStatus,
      }));
      setDisplaySteps(initial);
      stepIndex.current = 0;

      if (stepTimer.current) clearInterval(stepTimer.current);
      stepTimer.current = setInterval(() => {
        stepIndex.current += 1;
        setDisplaySteps((prev) => {
          const next = prev.map((s, i) => {
            if (i < stepIndex.current) return { ...s, status: 'complete' as const };
            if (i === stepIndex.current) return { ...s, status: 'running' as const };
            return { ...s, status: 'pending' as const };
          });
          return next;
        });
      }, 2200);
    } else if (publishResult) {
      if (stepTimer.current) clearInterval(stepTimer.current);
      const steps = publishResult.steps?.length
        ? publishResult.steps.filter((s) => s.status !== 'skipped')
        : VISIBLE_STEPS.map((s) => ({ id: s.id, label: s.label, status: 'complete' as const }));
      setDisplaySteps(steps);
      setPhase(publishResult.status === 'FAILED' ? 'error' : 'success');
    } else if (publishError) {
      if (stepTimer.current) clearInterval(stepTimer.current);
      setPhase('error');
    }
    return () => {
      if (stepTimer.current) clearInterval(stepTimer.current);
    };
  }, [open, publishing, publishResult, publishError]);

  if (!open) return null;

  const visibleSteps = displaySteps.filter((s) => {
    if (scenario !== 'REPLACE_EXISTING' && s.id === 'pause') return false;
    if (scenario !== 'CREATE_STRATEGY' && (s.id === 'campaign' || s.id === 'keywords')) return false;
    if (scenario === 'REPLACE_EXISTING' && s.id === 'campaign') return false;
    return s.status !== 'skipped';
  });

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-[120]"
      >
        <motion.div
          initial={{ scale: 0.95, y: 8 }}
          animate={{ scale: 1, y: 0 }}
          exit={{ scale: 0.95, y: 8 }}
          className="bg-panel border border-orange/30 rounded-2xl p-6 max-w-lg w-full glow-orange relative"
        >
          <button
            type="button"
            onClick={onClose}
            className="absolute top-4 right-4 text-muted hover:text-white p-1 rounded-lg"
            aria-label="Close"
          >
            <X size={18} />
          </button>

          {phase === 'confirm' && (
            <>
              <AlertTriangle className="text-orange mb-3" size={28} />
              <h3 className="text-white font-bold text-xl mb-2">Confirm Publish</h3>
              <p className="text-muted text-sm mb-3">
                You are about to publish optimized ads to your Google Ads account.
                {campaignName && (
                  <> This will update <strong className="text-white">{campaignName}</strong>.</>
                )}
              </p>
              <p className="text-muted text-xs mb-6 leading-relaxed">
                {scenarioConfirmCopy(scenario, campaignName)}
              </p>
              <div className="flex gap-3 justify-end">
                <Button variant="ghost" onClick={onCancel}>Cancel</Button>
                <Button onClick={onConfirm} className="bg-gradient-to-r from-orange to-orange-2">
                  Confirm Publish <ChevronRight size={16} />
                </Button>
              </div>
            </>
          )}

          {phase === 'publishing' && (
            <>
              <div className="flex items-center gap-3 mb-4">
                <Loader2 className="text-orange animate-spin" size={24} />
                <h3 className="text-white font-bold text-lg">Publishing to Google Ads…</h3>
              </div>
              <ul className="space-y-2.5 mb-2">
                {visibleSteps.map((step) => (
                  <li key={step.id} className="flex items-center gap-2.5 text-sm">
                    {stepIcon(step.status)}
                    <span className={clsx(
                      step.status === 'complete' && 'text-teal',
                      step.status === 'running' && 'text-orange',
                      step.status === 'pending' && 'text-muted',
                      step.status === 'failed' && 'text-red-300',
                    )}>
                      {step.label}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="text-muted text-xs mt-4">Do not close this window while publishing.</p>
            </>
          )}

          {phase === 'success' && publishResult && (
            <>
              <CheckCircle2 className="text-teal mb-3" size={32} />
              <h3 className="text-white font-bold text-xl mb-1">
                {publishResult.status === 'SIMULATED' ? 'Copy Saved' : 'Ad Successfully Published'}
              </h3>
              <p className="text-muted text-sm mb-5">{publishResult.message}</p>

              <dl className="space-y-2 text-sm mb-5 bg-navy/50 rounded-xl p-4 border border-border">
                {publishResult.campaignName && (
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted">Campaign</dt>
                    <dd className="text-white text-right">{publishResult.campaignName}</dd>
                  </div>
                )}
                <div className="flex justify-between gap-4">
                  <dt className="text-muted">Google Ads Account</dt>
                  <dd className="text-white text-right">{publishResult.accountName ?? accountName}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted">Published At</dt>
                  <dd className="text-white text-right">{formatTimestamp(publishResult.publishedAt)}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted">Version Saved</dt>
                  <dd className="text-teal">{publishResult.versionSaved ? 'Yes' : 'No'}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted">Rollback Available</dt>
                  <dd className={publishResult.rollbackAvailable ? 'text-teal' : 'text-muted'}>
                    {publishResult.rollbackAvailable ? 'Yes' : 'No'}
                  </dd>
                </div>
              </dl>

              {visibleSteps.length > 0 && (
                <ul className="space-y-1.5 mb-5">
                  {visibleSteps.map((step) => (
                    <li key={step.id} className="flex items-center gap-2 text-xs text-muted">
                      {stepIcon(step.status)}
                      <span>{step.label}</span>
                    </li>
                  ))}
                </ul>
              )}

              <div className="flex gap-3 justify-end flex-wrap">
                {rollbackAvailable && publishResult.rollbackAvailable && (
                  <Button variant="outline" size="sm" loading={rollingBack} onClick={onRollback}>
                    <RotateCcw size={14} /> Rollback To Previous Version
                  </Button>
                )}
                <Button onClick={onClose}>Done</Button>
              </div>
            </>
          )}

          {phase === 'error' && (
            <>
              <AlertTriangle className="text-red-400 mb-3" size={28} />
              <h3 className="text-white font-bold text-xl mb-2">Publish Failed</h3>
              <p className="text-red-300 text-sm mb-6">
                {publishError ?? publishResult?.message ?? 'An unexpected error occurred.'}
              </p>
              <div className="flex gap-3 justify-end">
                <Button variant="ghost" onClick={onClose}>Close</Button>
                <Button onClick={onConfirm}>
                  <Send size={14} /> Try Again
                </Button>
              </div>
            </>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
