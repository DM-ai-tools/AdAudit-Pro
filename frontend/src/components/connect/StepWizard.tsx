import clsx from 'clsx';
import { motion } from 'framer-motion';
import { Check } from 'lucide-react';

interface StepWizardProps {
  steps: { id: number; label: string }[];
  currentStep: number;
  className?: string;
}

export function StepWizard({ steps, currentStep, className }: StepWizardProps) {
  return (
    <div className={clsx('flex items-center gap-2', className)}>
      {steps.map((step, i) => {
        const done = currentStep > step.id;
        const active = currentStep === step.id;
        return (
          <div key={step.id} className="flex items-center gap-2 flex-1">
            <div className="flex items-center gap-2 min-w-0">
              <motion.div
                animate={active ? { scale: [1, 1.05, 1] } : {}}
                transition={{ duration: 0.4 }}
                className={clsx(
                  'w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 border transition-colors',
                  done && 'bg-teal/20 border-teal text-teal',
                  active && 'bg-orange/20 border-orange text-orange glow-orange',
                  !done && !active && 'bg-panel border-border text-muted'
                )}
              >
                {done ? <Check size={14} /> : step.id}
              </motion.div>
              <span
                className={clsx(
                  'text-xs font-medium truncate hidden sm:block',
                  active ? 'text-white' : done ? 'text-teal' : 'text-muted'
                )}
              >
                {step.label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div
                className={clsx(
                  'h-px flex-1 min-w-[12px]',
                  done ? 'bg-teal/40' : 'bg-border'
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
