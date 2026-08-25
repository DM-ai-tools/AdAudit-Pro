/** Google Ads enum: CONTAINS_EU_POLITICAL_ADVERTISING vs DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING */
export function campaignContainsEuPoliticalAdvertising(flag?: string | null): boolean {
  const value = (flag ?? '').trim().toUpperCase();
  return value === 'CONTAINS_EU_POLITICAL_ADVERTISING';
}

/** Timezones where EU/EEA/UK political-ad rules commonly apply. */
export function timezoneSuggestsEuPoliticalAdvertising(timezone?: string | null): boolean {
  const tz = (timezone ?? '').trim();
  if (!tz) return false;
  if (/^Europe\//i.test(tz)) return true;
  if (/^Atlantic\/(Reykjavik|Azores|Canary|Madeira|Faroe)/i.test(tz)) return true;
  return false;
}

export function accountRequiresEuPoliticalDeclaration(opts: {
  timezone?: string | null;
  containsEuPoliticalAdvertisingFlags?: Array<string | null | undefined>;
}): boolean {
  if (opts.containsEuPoliticalAdvertisingFlags?.some(campaignContainsEuPoliticalAdvertising)) {
    return true;
  }
  return timezoneSuggestsEuPoliticalAdvertising(opts.timezone);
}
