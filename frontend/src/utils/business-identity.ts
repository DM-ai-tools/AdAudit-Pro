export function isGenericGoogleAdsName(name: string): boolean {
  return /^Google Ads[\s-]?\d{3}/i.test(name.trim()) || /^Google Ads \d/.test(name.trim());
}

function formatDomainBrand(segment: string): string {
  const cleaned = segment.replace(/[-_]/g, ' ').trim();
  if (!cleaned) return 'Your Business';
  if (cleaned.includes(' ')) {
    return cleaned
      .split(/\s+/)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(' ');
  }
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1).toLowerCase();
}

export function brandFromWebsite(url?: string): string | undefined {
  if (!url?.trim()) return undefined;
  try {
    const parsed = new URL(url.startsWith('http') ? url : `https://${url}`);
    const segment = parsed.hostname.replace(/^www\./, '').split('.')[0];
    if (!segment || segment.length < 2) return undefined;
    return formatDomainBrand(segment);
  } catch {
    return undefined;
  }
}

export function resolveBusinessName(accountName: string, websiteUrl?: string): string {
  const fromWeb = brandFromWebsite(websiteUrl);
  if (fromWeb) return fromWeb;
  const trimmed = accountName.trim();
  if (trimmed && !isGenericGoogleAdsName(trimmed)) return trimmed;
  return trimmed || 'Your Business';
}

export function resolveDisplayHost(websiteUrl?: string, accountName?: string): string {
  if (websiteUrl?.trim()) {
    try {
      const parsed = new URL(websiteUrl.startsWith('http') ? websiteUrl : `https://${websiteUrl}`);
      return parsed.hostname.replace(/^www\./, '');
    } catch {
      return websiteUrl.replace(/^https?:\/\//, '').split('/')[0] ?? 'yourwebsite.com';
    }
  }
  if (isGenericGoogleAdsName(accountName ?? '')) return 'yourwebsite.com';
  const brand = resolveBusinessName(accountName ?? '', websiteUrl);
  return `${brand.toLowerCase().replace(/[^a-z0-9]/g, '')}.com`;
}
