import clsx from 'clsx';
import { ChevronRight } from 'lucide-react';

export type MakeItBetterStepId = 'ad' | 'competitors' | 'recommendation' | 'review';

const STEP_META: Array<{ id: MakeItBetterStepId; adLabel: string; campaignLabel: string }> = [
  { id: 'ad', adLabel: 'Ad', campaignLabel: 'Campaign' },
  { id: 'competitors', adLabel: 'Competitors', campaignLabel: 'Competitors' },
  { id: 'recommendation', adLabel: 'AI recommendation', campaignLabel: 'AI recommendation' },
  { id: 'review', adLabel: 'Review & publish', campaignLabel: 'Review & publish' },
];

interface MakeItBetterStepNavProps {
  active: MakeItBetterStepId;
  onChange: (step: MakeItBetterStepId) => void;
  unlocked: Record<MakeItBetterStepId, boolean>;
  scope?: 'ad' | 'campaign';
}

export function MakeItBetterStepNav({
  active,
  onChange,
  unlocked,
  scope = 'ad',
}: MakeItBetterStepNavProps) {
  const steps = STEP_META.map((s, i) => ({
    id: s.id,
    label: scope === 'campaign' ? s.campaignLabel : s.adLabel,
    number: i + 1,
  }));

  const activeIndex = steps.findIndex((s) => s.id === active);

  return (
    <div className="bg-panel/80 border border-border rounded-2xl p-4">
      <div className="hidden sm:flex items-center gap-1">
        {steps.map((s, i) => {
          const isActive = active === s.id;
          const isUnlocked = unlocked[s.id];
          const isPast = activeIndex > i;
          return (
            <div key={s.id} className="flex items-center flex-1 min-w-0">
              <button
                type="button"
                disabled={!isUnlocked}
                onClick={() => isUnlocked && onChange(s.id)}
                className={clsx(
                  'flex items-center gap-2 min-w-0 flex-1 rounded-lg px-2 py-1.5 transition-colors',
                  isActive && 'bg-orange/10',
                  !isUnlocked && 'opacity-40 cursor-not-allowed'
                )}
              >
                <span
                  className={clsx(
                    'w-7 h-7 rounded-full text-[11px] flex items-center justify-center font-bold shrink-0 border',
                    isActive
                      ? 'bg-orange text-navy border-orange'
                      : isPast
                        ? 'bg-teal/20 text-teal border-teal/40'
                        : 'bg-navy border-border text-muted'
                  )}
                >
                  {s.number}
                </span>
                <span
                  className={clsx(
                    'text-xs font-medium truncate',
                    isActive ? 'text-orange' : isUnlocked ? 'text-white' : 'text-muted'
                  )}
                >
                  {s.label}
                </span>
              </button>
              {i < steps.length - 1 && (
                <ChevronRight size={14} className="text-muted/40 shrink-0 mx-0.5" />
              )}
            </div>
          );
        })}
      </div>
      <div className="sm:hidden flex flex-wrap gap-2">
        {steps.map((s) => {
          const isActive = active === s.id;
          const isUnlocked = unlocked[s.id];
          return (
            <button
              key={s.id}
              type="button"
              disabled={!isUnlocked}
              onClick={() => isUnlocked && onChange(s.id)}
              className={clsx(
                'px-3 py-1.5 rounded-full text-[11px] font-medium border',
                isActive
                  ? 'border-orange/50 bg-orange/15 text-orange'
                  : isUnlocked
                    ? 'border-border text-muted'
                    : 'border-border/50 text-muted/40'
              )}
            >
              {s.number}. {s.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
