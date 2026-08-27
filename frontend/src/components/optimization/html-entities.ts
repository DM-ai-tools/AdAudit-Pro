const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

export function decodeHtmlEntities(text: string): string {
  if (!text) return text;
  return restoreWordSpacing(
    text
      .replace(/&#(\d+);/g, (_, code) => {
        const n = parseInt(code, 10);
        return Number.isFinite(n) ? String.fromCharCode(n) : _;
      })
      .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
        const n = parseInt(hex, 16);
        return Number.isFinite(n) ? String.fromCharCode(n) : _;
      })
      .replace(/&([a-z]+);/gi, (match, name) => NAMED_ENTITIES[name.toLowerCase()] ?? match)
  );
}

/** Fix OCR / entity copy that glues words together (We'reWithYou, savings&stamp). */
export function restoreWordSpacing(text: string): string {
  return text
    .replace(/\u00a0/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Za-z])&([A-Za-z])/g, '$1 & $2')
    .replace(/([A-Za-z]),([A-Za-z])/g, '$1, $2')
    .replace(/\s+/g, ' ')
    .trim();
}

export function decodeHtmlEntitiesList(items: string[]): string[] {
  return items.map((s) => decodeHtmlEntities(s).trim()).filter(Boolean);
}
