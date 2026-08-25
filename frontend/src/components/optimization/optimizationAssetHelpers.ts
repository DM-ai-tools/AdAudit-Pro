import type { OptimizedAdContent } from '../../types/optimization';

export interface EditableOptimizationAssetsState {
  sitelinks: string[];
  callouts: string[];
  structuredSnippets: string[];
  keywords: string[];
  negativeKeywords: string[];
}

function uniqueStrings(items: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of items) {
    const s = raw.trim();
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

export function extractEditableAssets(content: OptimizedAdContent): EditableOptimizationAssetsState {
  const keywords = uniqueStrings([
    ...(content.strategistRecommendations?.keywords ?? []),
    ...(content.keywordSuggestions ?? []),
    ...(content.campaignStrategy?.adGroups?.flatMap((ag) => ag.keywords ?? []) ?? []),
  ]);
  const negativeKeywords = uniqueStrings([
    ...(content.strategistRecommendations?.negativeKeywords ?? []),
    ...(content.negativeKeywordSuggestions ?? []),
    ...(content.campaignStrategy?.negativeKeywords ?? []),
  ]);

  return {
    sitelinks: [...(content.adExtensions?.sitelinks ?? [])],
    callouts: [...(content.adExtensions?.callouts ?? [])],
    structuredSnippets: [...(content.adExtensions?.structuredSnippets ?? [])],
    keywords,
    negativeKeywords,
  };
}

export function applyEditableAssetsToContent(
  content: OptimizedAdContent,
  assets: EditableOptimizationAssetsState
): OptimizedAdContent {
  const sitelinks = assets.sitelinks.map((s) => s.trim()).filter(Boolean);
  const callouts = assets.callouts.map((s) => s.trim()).filter(Boolean);
  const structuredSnippets = assets.structuredSnippets.map((s) => s.trim()).filter(Boolean);
  const keywords = uniqueStrings(assets.keywords);
  const negativeKeywords = uniqueStrings(assets.negativeKeywords);

  return {
    ...content,
    adExtensions: {
      sitelinks,
      callouts,
      structuredSnippets,
    },
    keywordSuggestions: keywords,
    negativeKeywordSuggestions: negativeKeywords,
    strategistRecommendations: {
      extensions: content.strategistRecommendations?.extensions ?? [],
      landingPage: content.strategistRecommendations?.landingPage ?? [],
      budget: content.strategistRecommendations?.budget ?? [],
      bidding: content.strategistRecommendations?.bidding ?? [],
      audience: content.strategistRecommendations?.audience ?? [],
      ...content.strategistRecommendations,
      keywords,
      negativeKeywords,
    },
    campaignStrategy: content.campaignStrategy
      ? {
          ...content.campaignStrategy,
          negativeKeywords,
          adGroups: content.campaignStrategy.adGroups?.length
            ? [{ ...content.campaignStrategy.adGroups[0]!, keywords }, ...content.campaignStrategy.adGroups.slice(1)]
            : [{ name: 'Core', keywords }],
        }
      : content.campaignStrategy,
  };
}

export function buildAssetPromptContext(assets: EditableOptimizationAssetsState): string {
  const lines: string[] = [];
  if (assets.sitelinks.some((s) => s.trim())) {
    lines.push(`Sitelinks: ${assets.sitelinks.filter(Boolean).join(' | ')}`);
  }
  if (assets.callouts.some((s) => s.trim())) {
    lines.push(`Callouts: ${assets.callouts.filter(Boolean).join(' | ')}`);
  }
  if (assets.structuredSnippets.some((s) => s.trim())) {
    lines.push(`Structured snippets: ${assets.structuredSnippets.filter(Boolean).join(' | ')}`);
  }
  if (assets.keywords.some((s) => s.trim())) {
    lines.push(`Keywords: ${assets.keywords.filter(Boolean).join(', ')}`);
  }
  if (assets.negativeKeywords.some((s) => s.trim())) {
    lines.push(`Negative keywords: ${assets.negativeKeywords.filter(Boolean).join(', ')}`);
  }
  if (!lines.length) return '';
  return `CURRENT CLIENT EDITS (preserve unless your instructions replace them):\n${lines.join('\n')}`;
}
