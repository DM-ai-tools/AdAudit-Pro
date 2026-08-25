import { motion } from 'framer-motion';
import { Sparkles } from 'lucide-react';

interface AIThinkingLoaderProps {
  progress?: number;
  stage?: string;
  compact?: boolean;
}

export function AIThinkingLoader({
  progress = 0,
  stage = 'Analyzing competitor ads and your current copy…',
  compact = false,
}: AIThinkingLoaderProps) {
  const pct = Math.max(0, Math.min(100, Math.round(progress)));

  return (
    <div className={compact ? 'py-4 px-4' : 'flex flex-col items-center justify-center py-12 px-8'}>
      {!compact && (
        <div className="relative mb-6">
          <motion.div
            className="w-20 h-20 rounded-full bg-gradient-to-br from-orange/30 via-purple-500/20 to-teal/30 blur-xl absolute inset-0"
            animate={{ scale: [1, 1.2, 1], opacity: [0.5, 0.8, 0.5] }}
            transition={{ duration: 2, repeat: Infinity }}
          />
          <motion.div
            className="relative w-20 h-20 rounded-full border border-orange/40 flex items-center justify-center bg-navy/80"
            animate={{ rotate: 360 }}
            transition={{ duration: 8, repeat: Infinity, ease: 'linear' }}
          >
            <Sparkles className="text-orange w-8 h-8" />
          </motion.div>
        </div>
      )}

      <div className={compact ? 'w-full' : 'w-full max-w-md'}>
        <div className="flex items-center justify-between gap-3 mb-2">
          <p className="text-white font-medium text-sm flex items-center gap-2 min-w-0">
            {compact && <Sparkles className="text-orange shrink-0" size={14} />}
            <span className="truncate">{stage}</span>
          </p>
          <span className="text-orange text-xs font-semibold shrink-0">{pct}%</span>
        </div>
        <div className="h-2 rounded-full bg-navy border border-border overflow-hidden">
          <motion.div
            className="h-full rounded-full bg-gradient-to-r from-orange via-purple-400 to-teal"
            initial={false}
            animate={{ width: `${pct}%` }}
            transition={{ duration: 0.4 }}
          />
        </div>
        {!compact && (
          <p className="text-muted text-xs text-center mt-3">
            Live results appear below as each section finishes — competitors first, then the new AI Optimized Ad.
          </p>
        )}
      </div>
    </div>
  );
}
