import clsx from 'clsx';
import { motion } from 'framer-motion';

interface ProgressBarProps {
  value: number;
  className?: string;
  color?: 'orange' | 'teal' | 'red' | 'yellow';
  height?: string;
  animated?: boolean;
}

const colorMap = {
  orange: 'from-orange to-orange-2',
  teal: 'from-teal to-cyan',
  red: 'from-red-500 to-orange',
  yellow: 'from-yellow-500 to-orange-2',
};

export function ProgressBar({ value, className, color = 'orange', height = 'h-1.5', animated = true }: ProgressBarProps) {
  return (
    <div className={clsx('w-full bg-navy rounded-full overflow-hidden', height, className)}>
      <motion.div
        className={clsx('h-full rounded-full bg-gradient-to-r', colorMap[color])}
        initial={animated ? { width: 0 } : { width: `${value}%` }}
        animate={{ width: `${Math.min(100, Math.max(0, value))}%` }}
        transition={{ duration: 0.8, ease: 'easeOut' }}
      />
    </div>
  );
}

export function HealthProgressBar({ score, className }: { score: number; className?: string }) {
  const color = score < 30 ? 'red' : score < 50 ? 'orange' : score < 70 ? 'yellow' : 'teal';
  return <ProgressBar value={score} color={color} className={className} />;
}
