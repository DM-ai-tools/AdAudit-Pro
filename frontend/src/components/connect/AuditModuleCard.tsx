import clsx from 'clsx';
import { motion } from 'framer-motion';
import {
  Layers, Search, Target, DollarSign, MapPin, Users, FileText,
  Layout, TrendingUp, Activity, BarChart3, Smartphone, Check,
} from 'lucide-react';
import type { AuditModuleOption } from '../../types/connect';

const iconMap: Record<string, typeof Layers> = {
  layers: Layers,
  search: Search,
  target: Target,
  dollar: DollarSign,
  map: MapPin,
  users: Users,
  file: FileText,
  layout: Layout,
  trending: TrendingUp,
  activity: Activity,
  bar: BarChart3,
  smartphone: Smartphone,
};

interface AuditModuleCardProps {
  module: AuditModuleOption;
  onToggle: () => void;
}

export function AuditModuleCard({ module, onToggle }: AuditModuleCardProps) {
  const Icon = iconMap[module.icon] || Layers;
  const unavailable = module.available === false;

  return (
    <motion.button
      type="button"
      onClick={unavailable ? undefined : onToggle}
      disabled={unavailable}
      whileHover={unavailable ? undefined : { y: -2 }}
      title={unavailable ? module.reason : module.description}
      className={clsx(
        'relative p-3 rounded-lg border text-left transition-all duration-200',
        unavailable
          ? 'bg-navy/50 border-border opacity-40 cursor-not-allowed'
          : module.enabled
            ? 'bg-orange/5 border-orange/30'
            : 'bg-navy border-border opacity-60 hover:opacity-80'
      )}
    >
      <div className="flex items-start gap-2">
        <div className={clsx(
          'w-8 h-8 rounded-md flex items-center justify-center shrink-0',
          module.enabled ? 'bg-orange/15' : 'bg-panel'
        )}>
          <Icon size={16} className={module.enabled ? 'text-orange' : 'text-muted'} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-white text-xs font-semibold leading-tight">{module.name}</p>
          <p className="text-muted text-[10px] mt-0.5 line-clamp-2">{module.description}</p>
        </div>
        <div className={clsx(
          'w-4 h-4 rounded border flex items-center justify-center shrink-0 mt-0.5',
          module.enabled ? 'bg-orange border-orange' : 'border-border bg-panel'
        )}>
          {module.enabled && <Check size={10} className="text-white" />}
        </div>
      </div>
    </motion.button>
  );
}
