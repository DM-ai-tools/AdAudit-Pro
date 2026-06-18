/** True when Google Ads API returned a placeholder instead of descriptive_name. */
export function isGenericGoogleAdsName(name: string): boolean {
  const t = name.trim();
  return /^Google Ads[\s-]?\d{3}/i.test(t) || /^Google Ads \d/.test(t);
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

/** Display path slug from website domain (e.g. clicktrends.com.au → clicktrends). */
export function displayPathFromWebsite(websiteUrl?: string): string {
  if (!websiteUrl?.trim()) return 'services';
  try {
    const parsed = new URL(
      websiteUrl.startsWith('http') ? websiteUrl : `https://${websiteUrl}`
    );
    const segment = parsed.hostname.replace(/^www\./, '').split('.')[0];
    const slug = segment.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 15);
    return slug || 'services';
  } catch {
    return 'services';
  }
}

/**
 * Resolve the business brand for ad copy.
 * Website domain is the source of truth — never use contact-person names.
 */
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
      const parsed = new URL(
        websiteUrl.startsWith('http') ? websiteUrl : `https://${websiteUrl}`
      );
      return parsed.hostname.replace(/^www\./, '');
    } catch {
      return websiteUrl.replace(/^https?:\/\//, '').split('/')[0] ?? 'yourwebsite.com';
    }
  }
  if (isGenericGoogleAdsName(accountName ?? '')) return 'yourwebsite.com';
  const brand = resolveBusinessName(accountName ?? '', websiteUrl);
  return `${brand.toLowerCase().replace(/[^a-z0-9]/g, '')}.com`;
}
