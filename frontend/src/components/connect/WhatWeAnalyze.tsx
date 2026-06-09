import { CheckCircle } from 'lucide-react';

interface WhatWeAnalyzeProps {
  items: string[];
}

export function WhatWeAnalyze({ items }: WhatWeAnalyzeProps) {
  const list = items.length
    ? items
    : ['Connect an account to see analysis areas'];

  return (
    <div className="bg-navy border border-border rounded-xl p-4">
      <h4 className="text-white font-semibold text-sm mb-3">What We Analyze</h4>
      <ul className="space-y-2">
        {list.map((item) => (
          <li key={item} className="flex items-center gap-2 text-xs text-body">
            <CheckCircle size={12} className="text-teal shrink-0" />
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
