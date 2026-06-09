export function formatCurrency(amount: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatImpact(amount: number): string {
  return `$${amount.toLocaleString()}/mo`;
}

export function getHealthLabel(score: number): { label: string; color: string } {
  if (score < 30) return { label: 'Critical — immediate action required', color: 'text-red-400' };
  if (score < 50) return { label: 'Below average — action required', color: 'text-orange' };
  if (score < 70) return { label: 'Fair — room for improvement', color: 'text-orange-2' };
  return { label: 'Good — minor optimizations available', color: 'text-teal' };
}
