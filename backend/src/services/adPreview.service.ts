import type { CurrentAdData, OptimizedAdContent } from './aiOptimization.service.js';

export interface AdPreviewPayload {
  optimizationId: string;
  device: 'mobile' | 'desktop';
  variant: 'original' | 'optimized';
  displayUrl: string;
  headline: string;
  headline2?: string;
  description: string;
  description2?: string;
  callouts: string[];
  sitelinks: string[];
  scenario: string;
}

export function buildAdPreview(
  optimizationId: string,
  originalAd: CurrentAdData,
  optimized: OptimizedAdContent,
  options: {
    device?: 'mobile' | 'desktop';
    variant?: 'original' | 'optimized';
    websiteUrl?: string;
    accountName?: string;
    scenario?: string;
  } = {}
): AdPreviewPayload {
  const device = options.device ?? 'mobile';
  const variant = options.variant ?? 'optimized';
  const source = variant === 'original' ? originalAd : optimized;

  const headlines = variant === 'original' ? originalAd.headlines : optimized.headlines;
  const descriptions = variant === 'original' ? originalAd.descriptions : optimized.descriptions;

  const displayUrl =
    options.websiteUrl?.replace(/^https?:\/\//, '').replace(/\/$/, '') ??
    `${(options.accountName ?? 'business').toLowerCase().replace(/\s+/g, '')}.com`;

  const paths = optimized.displayPaths;
  const pathSuffix = paths?.path1 ? `/${paths.path1}` : '';

  return {
    optimizationId,
    device,
    variant,
    displayUrl: `${displayUrl}${pathSuffix}`,
    headline: headlines[0] ?? 'Your Headline',
    headline2: headlines[1],
    description: descriptions[0] ?? '',
    description2: device === 'desktop' ? descriptions[1] : undefined,
    callouts: optimized.adExtensions?.callouts ?? [],
    sitelinks: optimized.adExtensions?.sitelinks ?? [],
    scenario: options.scenario ?? 'CREATE_ADS',
  };
}
