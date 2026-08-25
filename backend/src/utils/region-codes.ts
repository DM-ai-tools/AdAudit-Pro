/** ISO 3166-1 numeric + 2000 = Google Transparency Center region filter value. */
const ISO_NUMERIC: Record<string, number> = {
  AU: 36,
  US: 840,
  GB: 826,
  CA: 124,
  NZ: 554,
  IN: 356,
  DE: 276,
  FR: 250,
  SG: 702,
  IE: 372,
};

export function transparencyRegionCode(country?: string): number | undefined {
  if (!country) return undefined;
  const key = country.trim().toUpperCase();
  if (key === 'ANYWHERE' || key === 'GLOBAL') return undefined;
  const numeric = ISO_NUMERIC[key];
  return numeric != null ? 2000 + numeric : undefined;
}

export function inferCountryFromLocation(location?: string): string | undefined {
  if (!location) return undefined;
  const l = location.trim().toLowerCase();
  if (/^(au|aus|australia)$/.test(l)) return 'AU';
  if (/^(gb|uk|gbr|united kingdom)$/.test(l)) return 'GB';
  if (/^(us|usa|united states)$/.test(l)) return 'US';
  if (/^(ca|can|canada)$/.test(l)) return 'CA';
  if (/^(nz|nzl|new zealand)$/.test(l)) return 'NZ';
  if (/^(in|ind|india)$/.test(l)) return 'IN';
  if (/\baustralia\b|\bau\b|sydney|melbourne|brisbane|perth|adelaide/.test(l)) return 'AU';
  if (/\bunited kingdom\b|\buk\b|london|england|scotland|wales/.test(l)) return 'GB';
  if (/\bunited states\b|\busa\b|\bus\b|america/.test(l)) return 'US';
  if (/\bcanada\b|\bca\b|toronto|vancouver/.test(l)) return 'CA';
  if (/\bnew zealand\b|\bnz\b|auckland|wellington/.test(l)) return 'NZ';
  if (/\bindia\b|\bin\b|mumbai|delhi|bangalore/.test(l)) return 'IN';
  return undefined;
}

/** Infer ISO country from website hostname TLD (e.g. argfinance.com.au → AU). */
export function inferCountryFromWebsiteUrl(url?: string): string | undefined {
  if (!url?.trim()) return undefined;
  try {
    const host = new URL(url.startsWith('http') ? url : `https://${url}`).hostname
      .replace(/^www\./, '')
      .toLowerCase();
    if (/\.(com|net|org|edu|gov|asn)\.au$/i.test(host)) return 'AU';
    if (/\.(co|org|me|ac)\.uk$/i.test(host) || host.endsWith('.uk')) return 'GB';
    if (/\.(co|net|org|gov)\.nz$/i.test(host) || host.endsWith('.nz')) return 'NZ';
    if (host.endsWith('.ca')) return 'CA';
    if (host.endsWith('.in')) return 'IN';
    return undefined;
  } catch {
    return undefined;
  }
}

export function countryToLocationLabel(country?: string): string | undefined {
  if (!country) return undefined;
  switch (country.trim().toUpperCase()) {
    case 'AU':
      return 'Australia';
    case 'GB':
      return 'United Kingdom';
    case 'US':
      return 'United States';
    case 'CA':
      return 'Canada';
    case 'NZ':
      return 'New Zealand';
    case 'IN':
      return 'India';
    default:
      return undefined;
  }
}

export function resolveMarketCountry(opts: {
  location?: string;
  websiteUrl?: string;
  explicitCountry?: string;
}): string | undefined {
  const explicit = opts.explicitCountry?.trim();
  if (explicit) {
    const upper = explicit.toUpperCase();
    if (ISO_NUMERIC[upper]) return upper;
    const fromExplicit = inferCountryFromLocation(explicit);
    if (fromExplicit) return fromExplicit;
  }
  return (
    inferCountryFromLocation(opts.location) ||
    inferCountryFromWebsiteUrl(opts.websiteUrl)
  );
}

/** Google Ads Keyword Planner geo target resource names (Search). */
export function googleAdsGeoTargetConstant(country?: string): string | undefined {
  switch ((country ?? '').trim().toUpperCase()) {
    case 'AU':
      return 'geoTargetConstants/2036';
    case 'US':
      return 'geoTargetConstants/2840';
    case 'GB':
      return 'geoTargetConstants/2826';
    case 'CA':
      return 'geoTargetConstants/2124';
    case 'NZ':
      return 'geoTargetConstants/2554';
    case 'IN':
      return 'geoTargetConstants/2356';
    default:
      return undefined;
  }
}
