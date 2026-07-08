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
  const l = location.toLowerCase();
  if (/\baustralia\b|\bau\b|sydney|melbourne|brisbane|perth|adelaide/.test(l)) return 'AU';
  if (/\bunited kingdom\b|\buk\b|london|england|scotland|wales/.test(l)) return 'GB';
  if (/\bunited states\b|\busa\b|\bus\b|america/.test(l)) return 'US';
  if (/\bcanada\b|\bca\b|toronto|vancouver/.test(l)) return 'CA';
  if (/\bnew zealand\b|\bnz\b|auckland|wellington/.test(l)) return 'NZ';
  if (/\bindia\b|\bin\b|mumbai|delhi|bangalore/.test(l)) return 'IN';
  return undefined;
}
