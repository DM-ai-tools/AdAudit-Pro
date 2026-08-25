import { BarChart3 } from 'lucide-react';

interface LogoProps {
  size?: 'sm' | 'md' | 'lg';
  showSubtitle?: boolean;
}

export function Logo({ size = 'md', showSubtitle = true }: LogoProps) {
  const sizes = {
    sm: { icon: 20, text: 'text-base', sub: 'text-[9px]' },
    md: { icon: 24, text: 'text-lg', sub: 'text-[10px]' },
    lg: { icon: 32, text: 'text-2xl', sub: 'text-xs' },
  };
  const s = sizes[size];

  return (
    <div className="flex items-center gap-2.5">
      <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-br from-orange/20 to-orange-2/10 border border-orange/25 shadow-[0_0_20px_rgba(255,107,43,0.12)]">
        <BarChart3 size={s.icon} className="text-orange" />
      </div>
      <div className="text-left">
        <div className={`font-extrabold text-white ${s.text} leading-tight tracking-tight`}>
          AdAudit <span className="text-orange">Pro</span>
        </div>
        {showSubtitle && (
          <div className={`${s.sub} text-muted uppercase tracking-[0.18em] font-semibold`}>
            Google Ads Intelligence
          </div>
        )}
      </div>
    </div>
  );
}
