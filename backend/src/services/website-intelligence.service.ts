import axios from 'axios';

export interface WebsiteIntelligence {
  url: string;
  fetched: boolean;
  title?: string;
  metaDescription?: string;
  headings: string[];
  offers: string[];
  services: string[];
  ctas: string[];
  locations: string[];
  usps: string[];
  rawTextSample: string;
  error?: string;
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTag(html: string, tag: string): string[] {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi');
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const t = stripHtml(m[1]).slice(0, 200);
    if (t.length > 2) out.push(t);
  }
  return out.slice(0, 12);
}

function extractMeta(html: string, name: string): string | undefined {
  const re = new RegExp(
    `<meta[^>]+(?:name|property)=["']${name}["'][^>]+content=["']([^"']+)["']`,
    'i'
  );
  const m = html.match(re);
  return m?.[1]?.trim();
}

function guessOffers(text: string): string[] {
  const patterns = [
    /free\s+[\w\s]{3,40}/gi,
    /\d+%\s+off[\w\s]*/gi,
    /save\s+\$[\d,]+/gi,
    /24\/7[\w\s]*/gi,
    /no\s+obligation[\w\s]*/gi,
  ];
  const found = new Set<string>();
  for (const p of patterns) {
    const matches = text.match(p) ?? [];
    for (const m of matches) found.add(m.trim().slice(0, 80));
  }
  return [...found].slice(0, 8);
}

function guessCtas(text: string): string[] {
  const ctas = [
    'get a quote', 'book now', 'call now', 'contact us', 'free consultation',
    'learn more', 'get started', 'request quote', 'schedule', 'buy now',
  ];
  const lower = text.toLowerCase();
  return ctas.filter((c) => lower.includes(c)).slice(0, 8);
}

export async function analyzeWebsite(url?: string): Promise<WebsiteIntelligence | null> {
  if (!url?.trim()) return null;
  const normalized = url.startsWith('http') ? url : `https://${url}`;

  try {
    const res = await axios.get<string>(normalized, {
      timeout: 6_000,
      maxRedirects: 3,
      headers: { 'User-Agent': 'AdAuditPro/1.0 (campaign optimizer)' },
      responseType: 'text',
      validateStatus: (s) => s < 400,
    });

    const html = res.data ?? '';
    const text = stripHtml(html).slice(0, 8000);
    const headings = [
      ...extractTag(html, 'h1'),
      ...extractTag(html, 'h2'),
      ...extractTag(html, 'h3'),
    ].slice(0, 15);

    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? stripHtml(titleMatch[1]).slice(0, 120) : undefined;

    return {
      url: normalized,
      fetched: true,
      title,
      metaDescription: extractMeta(html, 'description') ?? extractMeta(html, 'og:description'),
      headings,
      offers: guessOffers(text),
      services: headings.filter((h) => /service|repair|install|solution/i.test(h)).slice(0, 8),
      ctas: guessCtas(text),
      locations: (text.match(/[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*(?:,\s*[A-Z]{2})?/g) ?? [])
        .filter((l) => l.length < 40)
        .slice(0, 6),
      usps: headings.slice(0, 5),
      rawTextSample: text.slice(0, 1500),
    };
  } catch (err) {
    return {
      url: normalized,
      fetched: false,
      headings: [],
      offers: [],
      services: [],
      ctas: [],
      locations: [],
      usps: [],
      rawTextSample: '',
      error: err instanceof Error ? err.message : 'Could not fetch website',
    };
  }
}
