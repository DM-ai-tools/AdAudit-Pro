import axios from 'axios';
import type { DiscoveredSocialLinks } from './sociavault-social-presence.service.js';

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
  trustSignals: string[];
  /** Social profile URLs discovered in page links / meta */
  socialLinks?: DiscoveredSocialLinks;
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

function guessTrustSignals(text: string): string[] {
  const patterns = [
    /\d+\+?\s*years?\s+(?:of\s+)?(?:experience|serving)/gi,
    /\d+[,.]?\d*\s*(?:star|★)\s*reviews?/gi,
    /trusted\s+by\s+[\w\s]{3,40}/gi,
    /certified\s+[\w\s]{2,30}/gi,
    /award[- ]winning/gi,
    /licensed\s+(?:and\s+)?insured/gi,
    /money[- ]back\s+guarantee/gi,
    /satisfaction\s+guarantee/gi,
    /bbb\s+accredited/gi,
    /a\+\s+rating/gi,
    /family[- ]owned/gi,
    /locally\s+owned/gi,
    /since\s+\d{4}/gi,
  ];
  const found = new Set<string>();
  for (const p of patterns) {
    for (const m of text.match(p) ?? []) {
      found.add(m.trim().slice(0, 80));
    }
  }
  return [...found].slice(0, 8);
}

function guessDescriptions(site: {
  metaDescription?: string;
  title?: string;
  valuePropositions?: string[];
  headings: string[];
}): string[] {
  const out: string[] = [];
  if (site.metaDescription?.trim()) out.push(site.metaDescription.trim().slice(0, 90));
  if (site.title?.trim() && !out.includes(site.title)) out.push(site.title.trim().slice(0, 90));
  for (const h of site.headings) {
    if (out.length >= 4) break;
    const d = h.trim().slice(0, 90);
    if (d.length > 20 && !out.includes(d)) out.push(d);
  }
  return out.slice(0, 4);
}

function isFluffServiceLabel(label: string): boolean {
  const t = label.toLowerCase().trim();
  if (!t || t.length < 3 || t.length > 60) return true;
  return (
    /^(services we offer|our services|contact|contact for services|why choose|faqs?|faq|home|about|blog|news|privacy|terms|login|book a|get in touch|learn more)/i.test(
      t
    ) ||
    /\b(years of experience|award|excellence|process|panel of|how it works|testimonials?|reviews?|get started|free consultation|contact us)\b/i.test(
      t
    ) ||
    /\?$/.test(t) ||
    /^\d+\+?\s/.test(t)
  );
}

function guessServices(headings: string[], text: string, html = ''): string[] {
  const serviceToken =
    /service|repair|install|solution|treatment|consult(?:ing|ation)?|cleaning|removal|maintenance|design|development|plumb|hvac|roof|legal|lawyer|dental|marketing|seo|audit|mortgage|home\s*loan|refinance|refi|broker|finance|lend(?:ing|er)|personal\s*loan|car\s*loan|business\s*loan|commercial|investment|property|insurance|wealth|smsf|first\s*home/i;

  const fromHeadings = headings
    .filter((h) => serviceToken.test(h) && !isFluffServiceLabel(h) && h.length < 80)
    .map((h) => h.trim());

  const listMatches = text.match(
    /(?:our\s+)?services?\s*(?:include|:)?\s*([^.]{10,220})/i
  );
  const fromList =
    listMatches?.[1]
      ?.split(/[,•|]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 3 && s.length < 60 && !isFluffServiceLabel(s)) ?? [];

  // Nav / footer links that look like real service pages
  const fromLinks: string[] = [];
  const linkRe = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html)) !== null) {
    const href = (m[1] ?? '').toLowerCase();
    const label = stripHtml(m[2] ?? '')
      .replace(/\s+/g, ' ')
      .trim();
    const pathLooksService =
      /\/(services?|solutions?|products?|mortgage|loans?|refinance|broker|finance|commercial|business|insurance|wealth)\b/i.test(
        href
      );
    if (!label || isFluffServiceLabel(label)) continue;
    if (pathLooksService || serviceToken.test(label)) {
      fromLinks.push(label.slice(0, 60));
    }
  }

  // Path-derived labels from service URLs when anchor text is generic
  const hrefOnlyRe = /href\s*=\s*["']([^"']+)["']/gi;
  while ((m = hrefOnlyRe.exec(html)) !== null) {
    try {
      const abs = m[1]!;
      if (!/\/(services?|mortgage|loan|refinance|broker|finance|commercial)/i.test(abs)) continue;
      const path = abs.split('?')[0] ?? abs;
      const seg = path
        .split('/')
        .filter(Boolean)
        .pop()
        ?.replace(/[-_]/g, ' ')
        .trim();
      if (seg && !isFluffServiceLabel(seg) && seg.length > 3 && serviceToken.test(seg)) {
        fromLinks.push(seg.replace(/\b\w/g, (c) => c.toUpperCase()));
      }
    } catch {
      /* ignore */
    }
  }

  return [...new Set([...fromLinks, ...fromList, ...fromHeadings])]
    .filter((s) => !isFluffServiceLabel(s))
    .slice(0, 12);
}

function guessCtas(text: string): string[] {
  const ctas = [
    'get a quote', 'book now', 'call now', 'contact us', 'free consultation',
    'learn more', 'get started', 'request quote', 'schedule', 'buy now',
  ];
  const lower = text.toLowerCase();
  return ctas.filter((c) => lower.includes(c)).slice(0, 8);
}

function normalizeHref(href: string, pageUrl: string): string | null {
  const trimmed = href.trim().replace(/&amp;/gi, '&');
  if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('mailto:') || trimmed.startsWith('tel:')) {
    return null;
  }
  try {
    return new URL(trimmed, pageUrl).toString();
  } catch {
    return null;
  }
}

/** Pull LinkedIn / Facebook / Instagram / YouTube / TikTok / X URLs from page HTML. */
export function extractSocialLinksFromHtml(html: string, pageUrl: string): DiscoveredSocialLinks {
  const links: DiscoveredSocialLinks = {};

  const assign = (abs: string) => {
    let host = '';
    try {
      host = new URL(abs).hostname.replace(/^www\./, '').toLowerCase();
    } catch {
      return;
    }
    const clean = abs.split('?')[0]?.replace(/\/$/, '') ?? abs;

    if (!links.linkedin && /(^|\.)linkedin\.com$/.test(host)) {
      if (/\/(company|in|school)\//i.test(clean)) links.linkedin = clean;
    } else if (
      !links.facebook &&
      (/(^|\.)facebook\.com$/.test(host) || /(^|\.)fb\.com$/.test(host) || /(^|\.)fb\.me$/.test(host)) &&
      !/\/(sharer|share|dialog|plugins|tr|pixel)\b/i.test(clean)
    ) {
      links.facebook = clean;
    } else if (
      !links.instagram &&
      /(^|\.)instagram\.com$/.test(host) &&
      !/\/(p|reel|reels|stories|explore|accounts)\b/i.test(clean)
    ) {
      links.instagram = clean;
    } else if (
      !links.youtube &&
      (/(^|\.)youtube\.com$/.test(host) || /(^|\.)youtu\.be$/.test(host) || /(^|\.)youtube\.com$/.test(host)) &&
      !/\/(watch|shorts|embed|playlist|results)\b/i.test(clean)
    ) {
      links.youtube = clean;
    } else if (
      !links.tiktok &&
      /(^|\.)tiktok\.com$/.test(host) &&
      !/\/(video|music|tag|discover)\b/i.test(clean)
    ) {
      links.tiktok = clean;
    } else if (
      !links.twitter &&
      (/(^|\.)twitter\.com$/.test(host) || /(^|\.)x\.com$/.test(host)) &&
      !/\/(intent|share|home|search|i\/)\b/i.test(clean)
    ) {
      links.twitter = clean;
    }
  };

  // 1) Classic href attributes
  const hrefRe = /href\s*=\s*["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = hrefRe.exec(html)) !== null) {
    const abs = normalizeHref(m[1]!, pageUrl);
    if (abs) assign(abs);
  }

  // 2) Bare social URLs anywhere in HTML / JSON / scripts (many SPAs omit footer hrefs)
  const bareRe =
    /https?:\/\/(?:www\.)?(?:linkedin\.com\/(?:company|in|school)\/[A-Za-z0-9._%-]+|facebook\.com\/[A-Za-z0-9._%-]+|fb\.com\/[A-Za-z0-9._%-]+|instagram\.com\/[A-Za-z0-9._%-]+|youtube\.com\/(?:@|channel\/|c\/|user\/)?[A-Za-z0-9._%-]+|tiktok\.com\/@[A-Za-z0-9._%-]+|(?:twitter|x)\.com\/[A-Za-z0-9._%-]+)/gi;
  for (const match of html.match(bareRe) ?? []) {
    assign(match.replace(/[),.;]+$/, ''));
  }

  // 3) og:see_also / JSON-LD sameAs fallbacks
  const sameAsBlocks = html.match(/"sameAs"\s*:\s*\[([^\]]+)\]/gi) ?? [];
  for (const block of sameAsBlocks) {
    const urls = block.match(/https?:\/\/[^"'\s,\\]+/gi) ?? [];
    for (const u of urls) assign(u.replace(/\\+/g, ''));
  }

  return links;
}

export async function analyzeWebsite(url?: string): Promise<WebsiteIntelligence | null> {
  if (!url?.trim()) return null;
  const normalized = url.startsWith('http') ? url : `https://${url}`;

  try {
    const res = await axios.get<string>(normalized, {
      timeout: 10_000,
      maxRedirects: 4,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-AU,en;q=0.9',
      },
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
      services: guessServices(headings, text, html),
      ctas: guessCtas(text),
      locations: (text.match(/[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*(?:,\s*[A-Z]{2})?/g) ?? [])
        .filter((l) => l.length < 40)
        .slice(0, 6),
      usps: headings.slice(0, 5),
      trustSignals: guessTrustSignals(text),
      socialLinks: extractSocialLinksFromHtml(html, normalized),
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
      trustSignals: [],
      rawTextSample: '',
      error: err instanceof Error ? err.message : 'Could not fetch website',
    };
  }
}
