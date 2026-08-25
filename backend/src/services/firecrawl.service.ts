import axios from 'axios';
import { env } from '../config/env.js';

export interface FirecrawlScrapeResult {
  html: string;
  markdown: string;
  title: string;
  description: string;
  links: string[];
  sourceUrl: string;
}

export function isFirecrawlConfigured(): boolean {
  return Boolean(env.firecrawlApiKey);
}

function normalizeLinks(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((l): l is string => typeof l === 'string' && l.startsWith('http'));
}

function parseScrapePayload(body: unknown, requestedUrl: string): FirecrawlScrapeResult | null {
  if (!body || typeof body !== 'object') return null;
  const root = body as Record<string, unknown>;
  if (root.success === false) return null;

  const data = (root.data ?? root) as Record<string, unknown>;
  const metadata = (data.metadata ?? {}) as Record<string, unknown>;

  const html = typeof data.html === 'string' ? data.html : '';
  const markdown = typeof data.markdown === 'string' ? data.markdown : '';
  if (!html && !markdown) return null;

  return {
    html,
    markdown,
    title: String(metadata.title ?? metadata.ogTitle ?? '').trim(),
    description: String(metadata.description ?? metadata.ogDescription ?? '').trim(),
    links: normalizeLinks(data.links),
    sourceUrl: String(metadata.sourceURL ?? metadata.url ?? requestedUrl).trim() || requestedUrl,
  };
}

/**
 * Scrape a single URL via Firecrawl (bypasses bot protection, renders JS).
 * Tries v1 then v2 API paths for compatibility.
 */
export async function firecrawlScrapeUrl(url: string): Promise<FirecrawlScrapeResult | null> {
  if (!isFirecrawlConfigured()) return null;

  const endpoints = [
    'https://api.firecrawl.dev/v1/scrape',
    'https://api.firecrawl.dev/v2/scrape',
  ];

  for (const endpoint of endpoints) {
    try {
      const res = await axios.post(
        endpoint,
        {
          url,
          formats: ['html', 'markdown', 'links'],
          onlyMainContent: false,
          waitFor: 2500,
          timeout: 30000,
        },
        {
          headers: {
            Authorization: `Bearer ${env.firecrawlApiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 45000,
          validateStatus: (s) => s < 500,
        }
      );

      if (res.status === 402) {
        console.warn('[Firecrawl] credits exhausted or payment required');
        return null;
      }
      if (res.status === 429) {
        console.warn('[Firecrawl] rate limited');
        return null;
      }
      if (res.status >= 400) {
        console.warn(`[Firecrawl] ${endpoint} → HTTP ${res.status}`);
        continue;
      }

      const parsed = parseScrapePayload(res.data, url);
      if (parsed) {
        console.log(
          `[Firecrawl] scraped ${url} → html=${parsed.html.length}b md=${parsed.markdown.length}b links=${parsed.links.length}`
        );
        return parsed;
      }
    } catch (err) {
      console.warn(
        `[Firecrawl] scrape failed (${endpoint}):`,
        err instanceof Error ? err.message : err
      );
    }
  }

  return null;
}
