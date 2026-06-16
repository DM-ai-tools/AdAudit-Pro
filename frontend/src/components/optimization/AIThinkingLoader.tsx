import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles } from 'lucide-react';
import { THINKING_STEPS } from './utils';

export function AIThinkingLoader() {
  const [stepIndex, setStepIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setStepIndex((i) => (i + 1) % THINKING_STEPS.length);
    }, 2200);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex flex-col items-center justify-center py-20 px-8">
      <div className="relative mb-8">
        <motion.div
          className="w-24 h-24 rounded-full bg-gradient-to-br from-orange/30 via-purple-500/20 to-teal/30 blur-xl absolute inset-0"
          animate={{ scale: [1, 1.2, 1], opacity: [0.5, 0.8, 0.5] }}
          transition={{ duration: 2, repeat: Infinity }}
        />
        <motion.div
          className="relative w-24 h-24 rounded-full border border-orange/40 flex items-center justify-center bg-navy/80"
          animate={{ rotate: 360 }}
          transition={{ duration: 8, repeat: Infinity, ease: 'linear' }}
        >
          <Sparkles className="text-orange w-10 h-10" />
        </motion.div>
      </div>

      <AnimatePresence mode="wait">
        <motion.p
          key={stepIndex}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          className="text-white font-medium text-lg mb-2"
        >
          {THINKING_STEPS[stepIndex]}
        </motion.p>
      </AnimatePresence>

      <p className="text-muted text-sm text-center max-w-sm">
        Claude is analyzing your ad performance, audit findings, and conversion goals to generate publishable copy.
      </p>

      <div className="flex gap-1.5 mt-6">
        {THINKING_STEPS.map((_, i) => (
          <motion.div
            key={i}
            className="w-2 h-2 rounded-full bg-orange/60"
            animate={{ opacity: i === stepIndex ? 1 : 0.3, scale: i === stepIndex ? 1.2 : 1 }}
          />
        ))}
      </div>
    </div>
  );
}
