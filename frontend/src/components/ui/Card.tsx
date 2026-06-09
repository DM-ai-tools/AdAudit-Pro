import clsx from 'clsx';
import type { ReactNode } from 'react';
import { motion } from 'framer-motion';

interface CardProps {
  children: ReactNode;
  className?: string;
  glow?: boolean;
  hover?: boolean;
  id?: string;
}

export function Card({ children, className, glow, hover, id }: CardProps) {
  return (
    <motion.div
      id={id}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={clsx(
        'bg-panel border border-border rounded-xl p-5',
        glow && 'glow-orange',
        hover && 'hover:border-orange/30 transition-colors cursor-pointer',
        className
      )}
    >
      {children}
    </motion.div>
  );
}
