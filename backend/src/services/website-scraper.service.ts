import { createClaudeMessage } from '../ai/anthropic-client.js';
import { ANTHROPIC_OPTIMIZE_MODEL_FALLBACKS } from '../ai/anthropic-models.js';
import { firecrawlScrapeUrl, isFirecrawlConfigured } from './firecrawl.service.js';

const FETCH_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml',
};

const SERVICE_PAGE_CANDIDATES = [
  '/services',
  '/our-services',
  '/what-we-do',
  '/solutions',
  '/service',
];

/** Headings / blocks that mark the end of a services listing (case studies, CTA, etc.). */
const SERVICES_SECTION_STOP =
  /(?:solutions?\s+in\s+action|see\s+our\s+(?:work|solutions?)|case\s+stud(?:y|ies)|the\s+proof\s+is|trusted\s+by|our\s+clients?|testimonial|success\s+stor(?:y|ies)|get\s+(?:your\s+)?free\s+(?:audit|quote|consultation)|schedule\s+your\s+free|contact\s+us|footer|newsletter|subscribe)/i;

/** Marks the start of a dedicated services listing block on a page. */
const SERVICES_SECTION_START =
  /(?:area\s+of\s+focus|our\s+services|services\s+we\s+offer|what\s+we\s+do|our\s+expertise|service\s+offerings|our\s+solutions|we\s+(?:offer|provide)|panoramic\s+solutions)/i;

function hostnameToName(url: string): string {
  try {
    const host = new URL(url.startsWith('http') ? url : `https://${url}`).hostname.replace(/^www\./, '');
    const base = host.split('.')[0] ?? 'Company';
    return base
      .split(/[-_]/)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  } catch {
    return 'Company';
  }
}

function isBotBlocked(html: string): boolean {
  const lower = html.toLowerCase();
  return (
    html.length < 500 ||
    lower.includes('sgcaptcha') ||
    lower.includes('/.well-known/sgcaptcha') ||
    lower.includes('cf-browser-verification') ||
    lower.includes('challenge-platform') ||
    lower.includes('just a moment') ||
    lower.includes('access denied') ||
    lower.includes('captcha')
  );
}

function extractMetaHints(html: string): { title: string; description: string } {
  const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() ?? '';
  const description =
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)/i)?.[1]?.trim() ??
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i)?.[1]?.trim() ??
    '';
  return { title, description };
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanHtml(html: string): string {
  return stripHtml(html).slice(0, 25000);
}

/** Mega-menu stops — industry/location/company nav, not core service offerings. */
const SERVICES_MENU_STOP =
  /^(by industry|by platforms?|by locations?|who we are|about us|contact|careers|resources|blogs?|tools|industries|locations?)$/i;

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\\+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleCaseService(label: string): string {
  const small = new Set(['and', 'or', 'for', 'of', 'the', 'a', 'an', 'to', 'in', 'on']);
  const acronyms = new Set(['seo', 'ppc', 'sem', 'cro', 'b2b', 'ui', 'ux', 'ai', 'roi', 'cta']);
  return decodeEntities(label)
    .replace(/\btiktok\b/gi, 'TikTok')
    .replace(/\blinkedin\b/gi, 'LinkedIn')
    .split(/\s+/)
    .map((word, i) => {
      if (/^(TikTok|LinkedIn)$/.test(word)) return word;
      const bare = word.replace(/[^a-zA-Z0-9/&]/g, '');
      const lower = bare.toLowerCase();
      if (acronyms.has(lower)) {
        if (lower === 'b2b') return word.replace(bare, 'B2B');
        if (lower === 'ui' || lower === 'ux') return word.replace(bare, lower.toUpperCase());
        return word.replace(bare, lower.toUpperCase());
      }
      if (i > 0 && small.has(lower)) return lower;
      if (lower === 'ads') return 'Ads';
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ')
    .replace(/\bUi\/Ux\b/i, 'UI/UX');
}

function isFluffServiceLabel(label: string): boolean {
  const t = decodeEntities(label).toLowerCase().trim();
  if (!t || t.length < 3 || t.length > 80) return true;
  if (SERVICES_MENU_STOP.test(t)) return true;
  return (
    /^(services?|our services|what we do|solutions?|area of focus|our expertise|contact|about|home|blog|news|privacy|terms|login|brands?|back|get a free|schedule|learn more|all of the above|explore now|see our|free seo audit)$/i.test(
      t
    ) ||
    /\b(years of experience|award|excellence|how it works|testimonials?|reviews?|get started|free consultation|contact us|trusted by|understanding digital|key ingredient|we help build|default text)\b/i.test(
      t
    ) ||
    /\?$/.test(t) ||
    /^\d+\+?\s/.test(t) ||
    /^\d+\s*%/.test(t) ||
    /\b(challenge|approach|increase in|reduction in|revenue from|traffic from)\b/i.test(t) ||
    /\b(i need more|need help with|elevate your|sharpen your|amplify your|craft a site)\b/i.test(t)
  );
}

function looksLikeCaseStudyHeading(label: string): boolean {
  const t = label.trim();
  if (!t) return true;
  if (/\b(challenge|approach)\b/i.test(t)) return true;
  if (/\d+\s*%/.test(t)) return true;
  if (/\b(increase|reduction|growth)\b/i.test(t) && t.length < 40) return true;
  // "Bathroom Supplier – E-commerce & Local SEO" style portfolio titles
  if (/ – /.test(t) && /\b(e-commerce|seo|ppc|manufacturer|retailer|supplier)\b/i.test(t)) {
    return true;
  }
  return false;
}

function normalizeServiceLabel(label: string): string {
  return titleCaseService(
    decodeEntities(label)
      .replace(/\s+/g, ' ')
      .replace(/[.·|]+$/g, '')
      .trim()
  );
}

function dedupeServices(labels: string[], max = 40): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of labels) {
    const label = normalizeServiceLabel(raw);
    if (!label || isFluffServiceLabel(label) || looksLikeCaseStudyHeading(label)) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(label);
  }
  return out.slice(0, max);
}

/** Parent mega-menu buckets — not sellable leaf services for campaign/ad create. */
const PARENT_SERVICE_CATEGORY =
  /^(seo services?|ppc advertising|ppc services?|sem services?|social media marketing|social media services?|content marketing services?|content marketing|digital marketing|digital marketing services?|web design services?|web development services?|google ads services?|paid media|organic search|our services?|marketing services?)$/i;

function isParentServiceCategory(label: string): boolean {
  const t = normalizeServiceLabel(label);
  if (PARENT_SERVICE_CATEGORY.test(t)) return true;
  // Short "X Services" parents when a more specific child also exists are handled in preferCoreServices
  return /^(seo|ppc|sem|cro|smm)\s+services?$/i.test(t);
}

/**
 * Keep core leaf offerings only (e.g. AI SEO, Local SEO) — drop parent categories
 * like "SEO Services" when children exist. Caps the list for campaign/ad wizards.
 */
function preferCoreServices(labels: string[], max = 12): string[] {
  const deduped = dedupeServices(labels, 40);
  const lowered = deduped.map((l) => l.toLowerCase());

  const withoutParents = deduped.filter((label) => {
    if (!isParentServiceCategory(label) && !/\bservices?$/i.test(label)) return true;
    if (!isParentServiceCategory(label) && label.split(/\s+/).length >= 3) {
      // e.g. "Enterprise SEO Services" can be a core offering
      const stem = label.replace(/\s+services?$/i, '').toLowerCase();
      const hasMoreSpecificChild = lowered.some(
        (other) => other !== label.toLowerCase() && other.includes(stem) && other.length > label.length
      );
      return !hasMoreSpecificChild;
    }
    const stem = label.replace(/\s+services?$/i, '').toLowerCase().trim();
    if (!stem) return false;
    return !lowered.some((other) => {
      if (other === label.toLowerCase()) return false;
      return (
        other.includes(stem) ||
        stem.split(/\s+/).every((t) => t.length >= 2 && other.includes(t))
      );
    });
  });

  const preferred = withoutParents.length >= 2 ? withoutParents : deduped.filter((l) => !isParentServiceCategory(l));
  const finalList = preferred.length ? preferred : deduped;
  return finalList.slice(0, max);
}

/**
 * Extract Services mega-menu categories + subsections from Firecrawl markdown.
 * Matches the website nav Services dropdown (e.g. SEO Services → AI SEO, Local SEO…).
 */
function parseServicesMegaMenuFromMarkdown(markdown: string): string[] {
  if (!markdown?.trim()) return [];

  // Firecrawl often splits long menu labels across lines with "\\"
  const normalized = markdown
    .replace(/\\\s*\n\s*\\\s*\n/g, ' ')
    .replace(/\\\s*\n/g, ' ')
    .replace(/\]\(\s*\n\s*/g, '](')
    .replace(/\n[ \t]+(?=[a-z])/gi, ' ');

  // Find the Services nav list item
  const startRe = /(?:^|\n)([ \t]*)-\s*\[Services?\]\([^)]+\)[ \t]*\n/i;
  const start = startRe.exec(normalized);
  if (!start || start.index == null) return [];

  const baseIndent = (start[1] ?? '').length;
  const after = normalized.slice(start.index + start[0].length);
  const lines = after.split('\n');
  const items: Array<{ label: string; indent: number }> = [];

  for (const line of lines) {
    if (!line.trim()) continue;
    const listMatch = line.match(/^([ \t]*)-\s*(.+)$/);
    if (!listMatch) {
      if (items.length) break;
      continue;
    }
    const indent = listMatch[1]!.length;
    if (indent <= baseIndent) break;

    const rawItem = listMatch[2]!;
    const linkLabel =
      rawItem.match(/\[([^\]]+)\]\([^)]+\)/)?.[1] ??
      rawItem.replace(/^\[|\]$/g, '').trim();
    const label = decodeEntities(linkLabel.replace(/\\\s*/g, ' '));

    if (SERVICES_MENU_STOP.test(label)) break;
    if (
      /\b(automotive seo|dental seo|seo melbourne|seo sydney|wordpress seo|woocommerce seo)\b/i.test(
        label
      )
    ) {
      break;
    }
    if (!isFluffServiceLabel(label)) items.push({ label, indent });
  }

  // Prefer deepest nest level (leaf offerings), not parent buckets like "SEO Services"
  const maxIndent = items.reduce((m, i) => Math.max(m, i.indent), 0);
  const leafLabels =
    maxIndent > baseIndent
      ? items.filter((i) => i.indent === maxIndent).map((i) => i.label)
      : items.map((i) => i.label);
  const labels = leafLabels.length >= 2 ? leafLabels : items.map((i) => i.label);

  return preferCoreServices(labels, 12);
}

/**
 * Extract Services mega-menu from Elementor (or similar) icon-list HTML on the homepage.
 */
function parseServicesMegaMenuFromHtml(html: string): string[] {
  if (!html?.includes('elementor-icon-list-text')) return [];

  const re =
    /<a[^>]+href=["']([^"']+)["'][^>]*>[\s\S]*?<span class="elementor-icon-list-text">([\s\S]*?)<\/span>/gi;
  const labels: string[] = [];
  let m: RegExpExecArray | null;
  let inServicesBlock = false;

  while ((m = re.exec(html)) !== null) {
    const href = (m[1] ?? '').trim();
    const label = decodeEntities(stripHtml(m[2] ?? ''));
    if (!label) continue;

    // Start capturing after we see the SEO Services / PPC column headers
    if (/^(seo services|ppc advertising|social media marketing|content marketing services)$/i.test(label)) {
      inServicesBlock = true;
    }
    if (!inServicesBlock) continue;
    if (SERVICES_MENU_STOP.test(label)) break;
    if (
      /\b(automotive seo|dental seo|seo melbourne|seo sydney|wordpress seo|woocommerce seo)\b/i.test(
        label
      )
    ) {
      break;
    }
    if (/^(tel:|mailto:|#)$/i.test(href) || href.endsWith('#')) {
      if (SERVICES_MENU_STOP.test(label)) break;
      // Category headers sometimes use href="#"
      if (!isFluffServiceLabel(label)) labels.push(label);
      continue;
    }
    if (!isFluffServiceLabel(label)) labels.push(label);
  }

  return preferCoreServices(
    labels.filter((l) => !isParentServiceCategory(l)).length >= 2
      ? labels.filter((l) => !isParentServiceCategory(l))
      : labels,
    12
  );
}

function findServicesPageFromLinks(links: string[], baseUrl: string): string | null {
  for (const link of links) {
    try {
      const abs = new URL(link, baseUrl);
      if (/\/(services?|our-services|what-we-do|solutions)\/?$/i.test(abs.pathname)) {
        return abs.href;
      }
    } catch {
      /* ignore */
    }
  }
  return null;
}

function findServicesPageUrl(homeHtml: string, baseUrl: string): string | null {
  const linkRe = /<a\b[^>]*href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  const candidates: string[] = [];

  while ((m = linkRe.exec(homeHtml)) !== null) {
    const href = (m[1] ?? '').trim();
    const label = stripHtml(m[2] ?? '').toLowerCase();
    if (!href || href.startsWith('mailto:') || href.startsWith('tel:')) continue;
    try {
      const abs = new URL(href, baseUrl);
      const path = abs.pathname.toLowerCase();
      if (
        /\/(services?|our-services|what-we-do|solutions)\/?$/i.test(path) ||
        /^services?$|^our services$|^what we do$|^solutions$/.test(label)
      ) {
        candidates.push(abs.href);
      }
    } catch {
      /* ignore */
    }
  }

  return candidates[0] ?? null;
}

/** Pull the HTML slice that contains the services listing (subsections), not the whole page. */
function extractServicesSectionHtml(html: string): string {
  if (!html?.trim()) return '';

  // 1) Prefer explicit <section> / <div> whose id or class mentions services
  const sectionRe =
    /<(section|div)\b[^>]*(?:id|class)\s*=\s*["'][^"']*\b(?:services?|service-area|service-list|our-services|what-we-do|service-offerings|area-of-focus)[^"']*["'][^>]*>([\s\S]*?)<\/\1>/gi;
  let best = '';
  let m: RegExpExecArray | null;
  while ((m = sectionRe.exec(html)) !== null) {
    const block = m[0] ?? '';
    if (block.length > best.length && block.length < html.length * 0.85) {
      best = block;
    }
  }
  if (best.length > 200) return best;

  // 2) Slice from a services-section heading until the next non-service block
  const text = stripHtml(html);
  const startMatch = SERVICES_SECTION_START.exec(text);
  if (startMatch?.index != null) {
    const startIdx = Math.max(0, startMatch.index - 200);
    const afterStart = text.slice(startIdx);
    const stopMatch = SERVICES_SECTION_STOP.exec(afterStart.slice(80));
    const endIdx = stopMatch?.index != null ? startIdx + 80 + stopMatch.index : startIdx + 8000;
    const slice = text.slice(startIdx, Math.min(endIdx, text.length));
    if (slice.length > 100) return slice;
  }

  // 3) Map text positions back roughly via cleaned full page (fallback)
  const cleaned = cleanHtml(html);
  const startInClean = SERVICES_SECTION_START.exec(cleaned);
  if (startInClean?.index != null) {
    const after = cleaned.slice(startInClean.index);
    const stop = SERVICES_SECTION_STOP.exec(after.slice(60));
    const end = stop?.index != null ? startInClean.index + 60 + stop.index : startInClean.index + 6000;
    return cleaned.slice(startInClean.index, Math.min(end, cleaned.length));
  }

  return '';
}

/** Parse h2/h3/h4 and list items that are service subsections within the services block. */
function parseServiceSubsections(sectionContent: string): string[] {
  const labels: string[] = [];

  // If we got raw HTML, pull heading tags first
  if (sectionContent.includes('<')) {
    const headingRe = /<h([234])[^>]*>([\s\S]*?)<\/h\1>/gi;
    let hm: RegExpExecArray | null;
    while ((hm = headingRe.exec(sectionContent)) !== null) {
      const text = stripHtml(hm[2] ?? '');
      if (text) labels.push(text);
    }

    // Service cards often use class names like service-title, service-item, etc.
    const cardRe =
      /<(?:div|article|li)\b[^>]*class\s*=\s*["'][^"']*\b(?:service-item|service-card|service-box|service-title|service-name|offer-item)[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|article|li)>/gi;
    let cm: RegExpExecArray | null;
    while ((cm = cardRe.exec(sectionContent)) !== null) {
      const inner = cm[1] ?? '';
      const innerHeading = inner.match(/<h[234][^>]*>([\s\S]*?)<\/h[234]>/i)?.[1];
      const text = stripHtml(innerHeading ?? inner).slice(0, 80);
      if (text) labels.push(text);
    }
  } else {
    // Plain-text slice: only pick ### / ## style lines if present
    for (const line of sectionContent.split('\n')) {
      const mdHeading = line.match(/^#{2,3}\s+(.+?)\s*$/)?.[1];
      if (mdHeading) labels.push(mdHeading.replace(/\*\*/g, '').trim());
    }
  }

  return preferCoreServices(labels, 12);
}

/** Extract service subsection titles from Firecrawl markdown (##/### headings in services block). */
function parseServiceSubsectionsFromMarkdown(markdown: string): string[] {
  if (!markdown?.trim()) return [];

  const startMatch = SERVICES_SECTION_START.exec(markdown);
  if (startMatch?.index == null) return [];

  let slice = markdown.slice(startMatch.index);
  const stopMatch = SERVICES_SECTION_STOP.exec(slice.slice(40));
  if (stopMatch?.index != null) {
    slice = slice.slice(0, 40 + stopMatch.index);
  }

  const labels: string[] = [];
  for (const line of slice.split('\n')) {
    const m = line.match(/^#{2,3}\s+(.+?)\s*$/);
    if (!m?.[1]) continue;
    const heading = m[1]
      .replace(/\*\*/g, '')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .trim();
    if (heading) labels.push(heading);
  }

  return preferCoreServices(labels, 12);
}

async function fetchPageViaFirecrawl(url: string): Promise<{
  html: string;
  markdown: string;
  title: string;
  description: string;
  links: string[];
} | null> {
  if (!isFirecrawlConfigured()) return null;
  const result = await firecrawlScrapeUrl(url);
  if (!result) return null;
  return {
    html: result.html,
    markdown: result.markdown,
    title: result.title,
    description: result.description,
    links: result.links,
  };
}

async function fetchPage(url: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: FETCH_HEADERS });
    if (!res.ok) return '';
    return await res.text();
  } catch {
    return '';
  } finally {
    clearTimeout(timeout);
  }
}

async function extractWithClaude(
  normalizedUrl: string,
  servicesSectionContent: string,
  companyHints: string
): Promise<{ services: string[]; companyName: string; industry: string } | null> {
  const prompt = `You are analyzing a company website to extract ONLY the core sellable services listed in the Services section.

Website URL: ${normalizedUrl}

${companyHints ? `Company hints:\n${companyHints}\n\n` : ''}Services section content (subsections only):
---
${servicesSectionContent.slice(0, 12000)}
---

Extract and return a JSON object with:
1. "companyName": The company/business name
2. "industry": The primary industry (e.g. "Digital Marketing", "Finance", "Construction")
3. "services": An array of CORE leaf service names only (the specific offerings a client would buy)

Strict rules:
- Return ONLY specific/core offerings (e.g. "AI SEO", "Local SEO", "Google Ads Agency", "Meta Ads")
- Do NOT include parent category buckets (e.g. "SEO Services", "PPC Advertising", "Social Media Marketing", "Digital Marketing")
- Prefer the deepest menu items / card titles — not the column headers above them
- Each service name should be concise (2–8 words)
- Do NOT include: case studies, client names, testimonials, blog topics, CTAs, stats, city/location SEO pages, industry SEO pages, team members, awards
- Do NOT infer services that are not listed
- Maximum 12 core services
- Return valid JSON only, no markdown

Return format:
{"companyName": "...", "industry": "...", "services": ["...", "..."]}`;

  const response = await createClaudeMessage({
    model: ANTHROPIC_OPTIMIZE_MODEL_FALLBACKS[0]!,
    max_tokens: 1500,
    messages: [{ role: 'user', content: prompt }],
  });

  const text =
    response.content
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map((b) => b.text)
      .join('') || '';

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;

  const parsed = JSON.parse(jsonMatch[0]) as {
    companyName?: string;
    industry?: string;
    services?: string[];
  };

  return {
    companyName: parsed.companyName ?? '',
    industry: parsed.industry ?? '',
    services: preferCoreServices(
      (parsed.services ?? []).filter((s): s is string => typeof s === 'string' && s.trim().length > 0),
      12
    ),
  };
}

/**
 * Scrape a website and extract services from the Services section only (subsection titles).
 * Falls back to URL/domain inference when the site blocks bots or has no identifiable services block.
 */
export async function extractServicesFromWebsite(
  websiteUrl: string
): Promise<{
  services: string[];
  companyName: string;
  industry: string;
  scrapeStatus: 'ok' | 'blocked' | 'empty' | 'inferred';
}> {
  const normalizedUrl = websiteUrl.startsWith('http') ? websiteUrl : `https://${websiteUrl}`;
  const domainName = hostnameToName(normalizedUrl);

  let homeHtml = '';
  let homeMarkdown = '';
  let homeLinks: string[] = [];
  let meta = { title: '', description: '' };
  let usedFirecrawl = false;

  const firecrawlHome = await fetchPageViaFirecrawl(normalizedUrl);
  if (firecrawlHome && (firecrawlHome.html.length > 500 || firecrawlHome.markdown.length > 200)) {
    homeHtml = firecrawlHome.html;
    homeMarkdown = firecrawlHome.markdown;
    homeLinks = firecrawlHome.links;
    meta = {
      title: firecrawlHome.title || meta.title,
      description: firecrawlHome.description || meta.description,
    };
    usedFirecrawl = true;
    console.log('[website-scraper] Firecrawl fetched homepage');
  } else {
    homeHtml = await fetchPage(normalizedUrl, 15000);
    meta = extractMetaHints(homeHtml);
  }

  const homeBlocked = !usedFirecrawl && isBotBlocked(homeHtml);

  // 1) Prefer Services mega-menu (nav categories + subsections) from homepage
  let parsedServices: string[] = [];
  if (homeMarkdown) {
    parsedServices = parseServicesMegaMenuFromMarkdown(homeMarkdown);
    if (parsedServices.length) {
      console.log(
        `[website-scraper] Services mega-menu (markdown) → ${parsedServices.length}: ${parsedServices.join(' | ')}`
      );
    }
  }
  if (!parsedServices.length && homeHtml) {
    parsedServices = parseServicesMegaMenuFromHtml(homeHtml);
    if (parsedServices.length) {
      console.log(
        `[website-scraper] Services mega-menu (html) → ${parsedServices.length}: ${parsedServices.join(' | ')}`
      );
    }
  }

  if (parsedServices.length > 0) {
    return {
      services: parsedServices,
      companyName: meta.title?.split(/[|\-–—]/)[0]?.trim() || domainName,
      industry: inferIndustryFromServices(parsedServices),
      scrapeStatus: 'ok',
    };
  }

  // 2) Fallback: dedicated /services page body subsections
  let servicesPageHtml = '';
  let servicesPageMarkdown = '';
  const navServicesUrl =
    findServicesPageUrl(homeHtml, normalizedUrl) ??
    findServicesPageFromLinks(homeLinks, normalizedUrl);
  const urlsToTry = [
    ...(navServicesUrl ? [navServicesUrl] : []),
    ...SERVICE_PAGE_CANDIDATES.map((p) => new URL(p, normalizedUrl).href),
  ];
  const tried = new Set<string>();
  for (const pageUrl of urlsToTry) {
    if (tried.has(pageUrl)) continue;
    tried.add(pageUrl);

    const firecrawlPage = await fetchPageViaFirecrawl(pageUrl);
    if (
      firecrawlPage &&
      (firecrawlPage.html.length > 800 || firecrawlPage.markdown.length > 300)
    ) {
      servicesPageHtml = firecrawlPage.html;
      servicesPageMarkdown = firecrawlPage.markdown;
      if (!meta.title && firecrawlPage.title) meta.title = firecrawlPage.title;
      usedFirecrawl = true;
      console.log(`[website-scraper] Firecrawl fetched services page: ${pageUrl}`);
      break;
    }

    const pageHtml = await fetchPage(pageUrl, 10000);
    if (pageHtml && !isBotBlocked(pageHtml) && pageHtml.length > 800) {
      servicesPageHtml = pageHtml;
      console.log(`[website-scraper] direct fetch services page: ${pageUrl}`);
      break;
    }
  }

  const sourceHtml = servicesPageHtml || homeHtml;
  const sourceMarkdown = servicesPageMarkdown || homeMarkdown;
  const sectionHtml = extractServicesSectionHtml(sourceHtml);

  if (sourceMarkdown) {
    parsedServices = parseServiceSubsectionsFromMarkdown(sourceMarkdown);
    if (parsedServices.length) {
      console.log('[website-scraper] parsed services from page markdown headings');
    }
  }
  if (!parsedServices.length && sectionHtml) {
    parsedServices = parseServiceSubsections(sectionHtml);
  }

  if (parsedServices.length > 0) {
    console.log(
      `[website-scraper] services section → ${parsedServices.length} subsection(s): ${parsedServices.join(' | ')}`
    );
    return {
      services: parsedServices,
      companyName: meta.title?.split(/[|\-–—]/)[0]?.trim() || domainName,
      industry: inferIndustryFromServices(parsedServices),
      scrapeStatus: 'ok',
    };
  }

  // Claude on services-section slice only (never the full homepage)
  const sectionText = sectionHtml
    ? cleanHtml(sectionHtml)
    : sourceMarkdown
      ? extractServicesSectionHtml(sourceMarkdown) || sourceMarkdown.slice(0, 12000)
      : '';
  const sourceBlocked = !usedFirecrawl && isBotBlocked(sourceHtml);
  if (sectionText.length >= 80 && !sourceBlocked) {
    try {
      const result = await extractWithClaude(
        normalizedUrl,
        sectionText,
        [meta.title ? `Page title: ${meta.title}` : '', meta.description ? `Meta: ${meta.description}` : '']
          .filter(Boolean)
          .join('\n')
      );
      if (result && result.services.length > 0) {
        return {
          companyName: result.companyName || meta.title?.split(/[|\-–—]/)[0]?.trim() || domainName,
          industry: result.industry || inferIndustryFromServices(result.services),
          services: result.services,
          scrapeStatus: 'ok',
        };
      }
    } catch (err) {
      console.error(
        '[website-scraper] Claude services-section extraction failed:',
        err instanceof Error ? err.message : err
      );
    }
  }

  // Bot protection — do not guess services from unrelated page content
  const pageBlocked = homeBlocked && !servicesPageHtml && !usedFirecrawl;
  if (pageBlocked || !sectionText) {
    return {
      services: [],
      companyName: meta.title?.split(/[|\-–—]/)[0]?.trim() || domainName,
      industry: '',
      scrapeStatus: pageBlocked ? 'blocked' : 'empty',
    };
  }

  return {
    services: [],
    companyName: meta.title?.split(/[|\-–—]/)[0]?.trim() || domainName,
    industry: '',
    scrapeStatus: 'empty',
  };
}

function inferIndustryFromServices(services: string[]): string {
  const joined = services.join(' ').toLowerCase();
  if (/seo|ppc|digital marketing|social media|web development|content marketing/.test(joined)) {
    return 'Digital Marketing';
  }
  if (/loan|mortgage|finance|insurance|broker/.test(joined)) return 'Finance';
  if (/legal|lawyer|attorney/.test(joined)) return 'Legal';
  if (/dental|medical|health|clinic/.test(joined)) return 'Healthcare';
  if (/construction|plumb|hvac|roof/.test(joined)) return 'Construction';
  return 'General';
}
