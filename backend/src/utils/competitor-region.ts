import type {
  CompetitorAdPreview,
  CompetitorIntelligence,
  CompetitorProfile,
} from '../services/competitor-intelligence.service.js';

const REGION_TLD: Record<string, RegExp[]> = {
  AU: [/\.(com|net|org|edu|gov|asn)\.au$/i, /\.(id|conf)\.au$/i],
  GB: [/\.(co|org|me|ac|gov)\.uk$/i, /\.uk$/i],
  NZ: [/\.(co|net|org|gov)\.nz$/i, /\.nz$/i],
  CA: [/\.(ca|co\.ca)$/i],
  US: [/\.us$/i],
  IN: [/\.(co|net|org|in|gov)\.in$/i, /\.in$/i],
};

/** Foreign TLDs to exclude when searching in a given market. */
const FOREIGN_TLD: Record<string, RegExp[]> = {
  AU: [/\.(se|de|fr|nl|no|dk|fi|pl|it|es|pt|ru|jp|cn|kr|br|mx|at|ch|be|cz|hu|ro|gr|tr|il|ae|sa|hk|tw|sg|my|ph|vn|th|id|pk|bd|ng|za|eg|ua|sk|si|hr|bg|lt|lv|ee|is|lu|mt|cy)$/i],
  GB: [/\.(se|de|fr|au|nz|jp|cn|br|mx)$/i],
  US: [/\.(se|de|fr|au|co\.uk)$/i],
  NZ: [/\.(se|de|fr|au|co\.uk)$/i],
  CA: [/\.(se|de|fr|au|co\.uk)$/i],
};

function hostFromUrl(url: string): string {
  try {
    return new URL(url.startsWith('http') ? url : `https://${url}`).hostname
      .replace(/^www\./, '')
      .toLowerCase();
  } catch {
    return url.toLowerCase().replace(/^https?:\/\//, '').split('/')[0] ?? '';
  }
}

export function competitorUrlMatchesCountry(url: string, country: string): boolean {
  const host = hostFromUrl(url);
  if (!host) return false;
  const cc = country.toUpperCase();

  const foreign = FOREIGN_TLD[cc];
  if (foreign?.some((re) => re.test(host))) return false;

  const regional = REGION_TLD[cc];
  if (regional?.some((re) => re.test(host))) return true;

  // Generic .com / .net — allow only if copy hints at target country (checked separately)
  if (/\.(com|net|org|io|co)$/i.test(host) && !foreign?.some((re) => re.test(host))) {
    return true;
  }

  return false;
}

export function isPrimarilyEnglishText(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return true;
  if (/[\u0400-\u04FF\u0600-\u06FF\u4E00-\u9FFF\u3040-\u309F\u30A0-\u30FF\u0E00-\u0E7F]/.test(t)) {
    return false;
  }
  if (/[åäöÅÄÖßüÜ]/.test(t)) return false;
  const latin = (t.match(/[a-zA-Z]/g) ?? []).length;
  const letters = (t.match(/\p{L}/gu) ?? []).length;
  if (letters === 0) return true;
  return latin / letters >= 0.88;
}

export function isEnglishAdCopy(headlines: string[], descriptions: string[]): boolean {
  const parts = [...headlines, ...descriptions].map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return true;
  return parts.every(isPrimarilyEnglishText);
}

function profileMatchesMarket(
  profile: CompetitorProfile,
  country: string,
  companyUrl?: string
): boolean {
  const url = profile.url || '';
  const host = hostFromUrl(url);
  if (companyUrl && host && host === hostFromUrl(companyUrl)) return false;

  if (!isEnglishAdCopy(profile.headlines ?? [], profile.descriptions ?? [])) return false;

  const cc = country.toUpperCase();
  const regional = REGION_TLD[cc];
  const foreign = FOREIGN_TLD[cc];
  if (foreign?.some((re) => re.test(host))) return false;

  // Prefer market TLDs (.com.au, .co.uk, …)
  if (regional?.some((re) => re.test(host))) return true;

  const countryHints: Record<string, RegExp> = {
    AU: /\baustralia\b|\bau\b|melbourne|sydney|brisbane|perth|adelaide|\bpty\b|\bpty ltd\b/i,
    GB: /\buk\b|united kingdom|london|england|scotland|wales/i,
    NZ: /\bnew zealand\b|\bnz\b|auckland|wellington/i,
    US: /\bunited states\b|\busa\b|\bus\b/i,
    CA: /\bcanada\b|toronto|vancouver/i,
  };
  const blob = [profile.name, profile.url, ...profile.headlines, ...profile.descriptions]
    .join(' ')
    .toLowerCase();
  const hint = countryHints[cc];
  if (hint?.test(blob)) return true;

  // Generic .com only when library-backed AND no foreign TLD — still allow for sparse markets
  if (/\.(com|net|org|io|co)$/i.test(host) && (profile.totalAdCount ?? 0) > 0) {
    return true;
  }

  return competitorUrlMatchesCountry(url, country);
}

function galleryMatchesMarket(ad: CompetitorAdPreview, country: string, companyUrl?: string): boolean {
  const url = ad.destinationUrl ?? ad.url ?? '';
  const host = hostFromUrl(url);
  if (companyUrl && host && host === hostFromUrl(companyUrl)) return false;

  if (!isEnglishAdCopy(ad.headlines ?? [], ad.descriptions ?? [])) return false;

  const cc = country.toUpperCase();
  const foreign = FOREIGN_TLD[cc];
  if (host && foreign?.some((re) => re.test(host))) return false;

  const regional = REGION_TLD[cc];
  if (host && regional?.some((re) => re.test(host))) return true;

  const countryHints: Record<string, RegExp> = {
    AU: /\baustralia\b|\bau\b|melbourne|sydney|brisbane|perth|adelaide|\bpty\b/i,
    GB: /\buk\b|united kingdom|london|england/i,
    NZ: /\bnew zealand\b|\bnz\b|auckland/i,
    US: /\bunited states\b|\busa\b/i,
    CA: /\bcanada\b|toronto|vancouver/i,
  };
  const blob = [...(ad.headlines ?? []), ...(ad.descriptions ?? []), ad.name, ad.advertiserName ?? '']
    .join(' ')
    .toLowerCase();
  if (countryHints[cc]?.test(blob)) return true;

  if (host && /\.(com|net|org|io|co)$/i.test(host) && ((ad.totalAdCount ?? 0) > 0 || ad.adSource === 'sociavault')) {
    return true;
  }

  if (url && !competitorUrlMatchesCountry(url, country)) return false;
  return true;
}

/** Keep only competitors and gallery ads matching company region + English copy. */
export function filterCompetitorIntelligenceForMarket(
  intel: CompetitorIntelligence,
  companyUrl: string | undefined,
  country: string | undefined
): CompetitorIntelligence {
  if (!country) return intel;

  const competitors = (intel.competitors ?? []).filter((c) =>
    profileMatchesMarket(c, country, companyUrl)
  );
  const adGallery = (intel.adGallery ?? []).filter((g) =>
    galleryMatchesMarket(g, country, companyUrl)
  );

  // Never wipe a successful selection — UI must show what the terminal selected
  if (!competitors.length && (intel.competitors?.length ?? 0) > 0) {
    console.warn(
      `[competitor-region] market filter would drop all ${intel.competitors.length} selected rival(s) — keeping them for UI`
    );
    return intel;
  }

  if (competitors.length < (intel.competitors?.length ?? 0)) {
    console.log(
      `[competitor-region] market filter ${competitors.length}/${intel.competitors.length} rivals, ${adGallery.length} ads`
    );
  }

  return {
    ...intel,
    competitors,
    adGallery: adGallery.length ? adGallery : intel.adGallery,
    insights: (intel.insights ?? []).filter(
      (i) => !i.url || competitorUrlMatchesCountry(i.url, country) || competitors.some((c) => c.name === i.name)
    ),
  };
}

export function hasUsableCompetitorIntel(intel: CompetitorIntelligence | null | undefined): boolean {
  if (!intel) return false;
  return (intel.competitors?.length ?? 0) > 0 || (intel.adGallery?.length ?? 0) > 0;
}
