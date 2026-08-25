import mammoth from 'mammoth';
import WordExtractor from 'word-extractor';
import { PDFParse } from 'pdf-parse';
import * as XLSX from 'xlsx';
import { createClaudeMessage } from '../ai/anthropic-client.js';
import { getPrimaryApiKey } from '../ai/anthropic-pool.js';

export type ExtractedCompetitor = {
  name: string;
  url?: string;
};

const URL_RE =
  /(?:https?:\/\/)?(?:www\.)?[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+(?:\/[^\s\]\)>",]*)?/gi;

const SKIP_HOST =
  /^(?:google|facebook|instagram|linkedin|twitter|youtube|tiktok|wikipedia|github|microsoft|apple|amazonaws|cloudflare|wix|squarespace|godaddy|bing|yahoo)\./i;

function normalizeCompetitorUrl(raw: string): string | undefined {
  const trimmed = raw.trim().replace(/[),.;]+$/g, '');
  if (!trimmed || trimmed.length < 4) return undefined;
  try {
    const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const u = new URL(withProto);
    if (!u.hostname.includes('.')) return undefined;
    const host = u.hostname.replace(/^www\./, '').toLowerCase();
    if (SKIP_HOST.test(host) || SKIP_HOST.test(`${host}.`)) return undefined;
    if (/^(google|facebook|instagram|linkedin|twitter|youtube|tiktok)\./i.test(host)) return undefined;
    u.hash = '';
    u.search = '';
    // Canonical site root — path noise creates duplicate identities
    return `https://${host}`;
  } catch {
    return undefined;
  }
}

function domainKey(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return url.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0] ?? url;
  }
}

function hostnameToName(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    const base = host.split('.')[0] ?? 'Competitor';
    return base.charAt(0).toUpperCase() + base.slice(1);
  } catch {
    return 'Competitor';
  }
}

function brandKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Deduplicate by domain first, then by brand name. Prefer entries that have a URL. */
function dedupeCompetitors(list: ExtractedCompetitor[]): ExtractedCompetitor[] {
  const byDomain = new Map<string, ExtractedCompetitor>();
  const byName = new Map<string, ExtractedCompetitor>();
  const out: ExtractedCompetitor[] = [];

  for (const raw of list) {
    const url = raw.url ? normalizeCompetitorUrl(raw.url) : undefined;
    const name = (raw.name || (url ? hostnameToName(url) : '')).trim();
    if (!name && !url) continue;
    const entry: ExtractedCompetitor = { name: name || hostnameToName(url!), ...(url ? { url } : {}) };

    if (url) {
      const dk = domainKey(url);
      const existing = byDomain.get(dk);
      if (existing) {
        // Keep the better/longer document brand name for the same domain
        if (entry.name.length > existing.name.length && !/^(www|http)/i.test(entry.name)) {
          existing.name = entry.name;
        }
        continue;
      }
      byDomain.set(dk, entry);
      byName.set(brandKey(entry.name), entry);
      out.push(entry);
      continue;
    }

    const nk = brandKey(entry.name);
    if (!nk) continue;
    // Skip name-only if a domain entry already covers this brand
    if ([...byDomain.values()].some((e) => brandKey(e.name) === nk || brandKey(e.name).includes(nk) || nk.includes(brandKey(e.name)))) {
      continue;
    }
    if (byName.has(nk)) continue;
    byName.set(nk, entry);
    out.push(entry);
  }

  return out.slice(0, 30);
}

function extractUrlsFromText(text: string): string[] {
  const found = text.match(URL_RE) ?? [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of found) {
    const url = normalizeCompetitorUrl(raw);
    if (!url) continue;
    const key = domainKey(url);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(url);
    if (out.length >= 30) break;
  }
  return out;
}

/** Structured XLSX/CSV-like rows: paired competitor name + domain/URL. */
function extractStructuredFromSpreadsheet(buffer: Buffer): ExtractedCompetitor[] {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const rowsOut: ExtractedCompetitor[] = [];

  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  console.log(
    `[competitor-document] reading Sheet 1 only: "${sheetName}" (${workbook.SheetNames.length} sheet(s) in file)`
  );

  {
    const worksheet = workbook.Sheets[sheetName];
    if (!worksheet) return [];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
      defval: '',
      raw: false,
    });

    for (const row of rows) {
      const keys = Object.keys(row);
      if (!keys.length) continue;

      const nameKey = keys.find((k) =>
        /competitor|company|brand|advertiser|rival|business|trading\s*name|^name$/i.test(k.trim())
      );
      const urlKey = keys.find((k) =>
        /website|url|domain|site|link|web|homepage/i.test(k.trim())
      );

      let nameVal = nameKey ? String(row[nameKey] ?? '').trim() : '';
      let urlVal = urlKey ? String(row[urlKey] ?? '').trim() : '';

      // If columns aren't labeled, pick the first URL-like cell + first name-like cell
      if (!urlVal || !nameVal) {
        for (const k of keys) {
          const v = String(row[k] ?? '').trim();
          if (!v) continue;
          if (!urlVal && (normalizeCompetitorUrl(v) || /\.[a-z]{2,}(\/|$)/i.test(v))) {
            urlVal = v;
            continue;
          }
          if (
            !nameVal &&
            !normalizeCompetitorUrl(v) &&
            v.length >= 2 &&
            v.length <= 80 &&
            !/^(https?:|www\.)/i.test(v)
          ) {
            nameVal = v;
          }
        }
      }

      const url = urlVal ? normalizeCompetitorUrl(urlVal) : undefined;
      const name = nameVal.replace(/\s+/g, ' ').trim();
      if (!url && !name) continue;
      // Skip header-ish rows
      if (/^(competitor|company|brand|name|website|url|domain)$/i.test(name)) continue;
      rowsOut.push({
        name: name || (url ? hostnameToName(url) : ''),
        ...(url ? { url } : {}),
      });
    }
  }

  return dedupeCompetitors(rowsOut);
}

async function extractTextFromPdfDoc(
  buffer: Buffer,
  filename: string,
  mimeType?: string
): Promise<string> {
  const lower = filename.toLowerCase();
  const mime = (mimeType ?? '').toLowerCase();

  if (lower.endsWith('.pdf') || mime.includes('pdf')) {
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      return (result.text ?? '').trim();
    } finally {
      await parser.destroy().catch(() => undefined);
    }
  }

  if (lower.endsWith('.docx') || mime.includes('wordprocessingml')) {
    const result = await mammoth.extractRawText({ buffer });
    return (result.value ?? '').trim();
  }

  if (lower.endsWith('.doc') || mime === 'application/msword') {
    const extractor = new WordExtractor();
    const doc = await extractor.extract(buffer);
    return (doc.getBody() ?? '').trim();
  }

  throw new Error('Unsupported file type. Upload a PDF, DOC, DOCX, or XLSX file.');
}

async function extractWithClaude(text: string): Promise<ExtractedCompetitor[]> {
  const key = getPrimaryApiKey();
  if (!key || text.trim().length < 20) return [];

  const snippet = text.slice(0, 20_000);
  try {
    const response = await createClaudeMessage(
      {
        max_tokens: 1200,
        messages: [
          {
            role: 'user',
            content: `Extract EVERY competitor company from this document with their official website domain when present.
Return ONLY valid JSON (no markdown):
{"competitors":[{"name":"Brand Name","url":"https://example.com"}]}
Rules:
- Use the exact brand name as written in the document (do not invent legal entity suffixes)
- url MUST be the domain from the document when a website/domain column or URL is present
- Do not invent competitors that are not listed
- Skip social networks and Google
- Max 25 competitors

Document:
${snippet}`,
          },
        ],
      },
      key
    );
    const block = response.content[0];
    if (block.type !== 'text') return [];
    const raw = block.text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    const parsed = JSON.parse(raw) as { competitors?: Array<{ name?: string; url?: string }> };
    return (parsed.competitors ?? [])
      .map((c) => ({
        name: String(c.name ?? '').trim(),
        url: c.url ? normalizeCompetitorUrl(String(c.url)) : undefined,
      }))
      .filter((c) => c.name || c.url);
  } catch (err) {
    console.warn('[competitor-document] Claude extract failed:', err instanceof Error ? err.message : err);
    return [];
  }
}

export async function parseCompetitorsFromDocument(options: {
  buffer: Buffer;
  filename: string;
  mimeType?: string;
}): Promise<{
  textPreview: string;
  competitors: ExtractedCompetitor[];
  competitorUrls: string[];
  competitorNames: string[];
}> {
  const lower = options.filename.toLowerCase();
  const mime = (options.mimeType ?? '').toLowerCase();
  const isSpreadsheet =
    lower.endsWith('.xlsx') ||
    lower.endsWith('.xls') ||
    mime.includes('sheet') ||
    mime.includes('spreadsheetml');

  if (isSpreadsheet) {
    // Domain + name pairs from spreadsheet rows are authoritative — do NOT invent via Claude/named-lines
    let competitors = extractStructuredFromSpreadsheet(options.buffer);
    let textPreview = competitors
      .map((c) => `${c.name}${c.url ? `\t${c.url}` : ''}`)
      .join('\n')
      .slice(0, 400);

    // If the sheet had no usable rows, fall back to raw text + Claude once
    if (!competitors.length) {
      const workbook = XLSX.read(options.buffer, { type: 'buffer' });
      const firstSheet = workbook.SheetNames[0];
      const text = firstSheet && workbook.Sheets[firstSheet]
        ? XLSX.utils.sheet_to_txt(workbook.Sheets[firstSheet]!)
        : '';
      textPreview = text.slice(0, 400);
      const urls = extractUrlsFromText(text);
      const fromAi = await extractWithClaude(text);
      // Prefer URL-backed entries only in fallback — never keep bare invented names without domains
      competitors = dedupeCompetitors([
        ...fromAi.filter((c) => c.url),
        ...urls.map((url) => ({ name: hostnameToName(url), url })),
      ]);
    }

    if (!competitors.length) {
      throw new Error(
        'No competitors found in the spreadsheet. Include competitor names and/or website URLs/domains.'
      );
    }

    const competitorUrls = competitors.map((c) => c.url).filter((u): u is string => Boolean(u));
    const competitorNames = competitors.map((c) => c.name).filter(Boolean);

    console.log(
      `[competitor-document] extracted ${competitors.length} competitor(s) from spreadsheet:`,
      competitors.map((c) => `${c.name}${c.url ? ` <${domainKey(c.url)}>` : ''}`).join(', ')
    );

    return {
      textPreview,
      competitors,
      competitorUrls,
      competitorNames,
    };
  }

  const text = await extractTextFromPdfDoc(options.buffer, options.filename, options.mimeType);
  if (!text.trim()) {
    throw new Error('Could not read any text from that document.');
  }
  const textPreview = text.slice(0, 400);
  const urls = extractUrlsFromText(text);
  const fromAi = await extractWithClaude(text);
  const competitors = dedupeCompetitors([
    ...fromAi,
    ...urls.map((url) => ({ name: hostnameToName(url), url })),
  ]);

  if (!competitors.length) {
    throw new Error(
      'No competitors found in the document. Include competitor names and/or website URLs/domains.'
    );
  }

  const competitorUrls = competitors.map((c) => c.url).filter((u): u is string => Boolean(u));
  // Names stay paired with their domains — used for display + allow-list
  const competitorNames = competitors.map((c) => c.name).filter(Boolean);

  console.log(
    `[competitor-document] extracted ${competitors.length} competitor(s):`,
    competitors.map((c) => `${c.name}${c.url ? ` <${domainKey(c.url)}>` : ''}`).join(', ')
  );

  return {
    textPreview,
    competitors,
    competitorUrls,
    competitorNames,
  };
}
