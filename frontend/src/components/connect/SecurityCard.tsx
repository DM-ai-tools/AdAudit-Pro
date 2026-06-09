import { Shield, Lock, Eye, CreditCard } from 'lucide-react';

const items = [
  { icon: Shield, label: 'OAuth secured', desc: 'Google-approved authentication flow' },
  { icon: Eye, label: 'Your data only', desc: 'Developer token + your OAuth grant — never other users\' accounts' },
  { icon: Lock, label: 'Encrypted processing', desc: 'Data encrypted in transit & at rest' },
  { icon: CreditCard, label: 'No billing access', desc: 'Zero access to payment methods' },
];

export function SecurityCard() {
  return (
    <div className="bg-navy border border-border rounded-xl p-4">
      <h4 className="text-white font-semibold text-sm mb-3 flex items-center gap-2">
        <Shield size={16} className="text-teal" /> Security
      </h4>
      <div className="space-y-3">
        {items.map((item) => (
          <div key={item.label} className="flex items-start gap-2.5">
            <item.icon size={14} className="text-teal shrink-0 mt-0.5" />
            <div>
              <p className="text-white text-xs font-medium">{item.label}</p>
              <p className="text-muted text-[10px]">{item.desc}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
