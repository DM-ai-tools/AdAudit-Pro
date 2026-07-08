/**
 * Extract a JSON object from Claude responses that may include markdown fences or trailing prose.
 */

/** Attempt to close truncated JSON when Claude hits max_tokens mid-response. */
function repairTruncatedJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{');
  if (start === -1) return null;

  let slice = text.slice(start).trimEnd();
  slice = slice.replace(/,\s*"[^"]*$/s, '');
  slice = slice.replace(/,\s*$/s, '');
  slice = slice.replace(/:\s*"[^"]*$/s, ': ""');
  slice = slice.replace(/:\s*$/s, ': null');

  let braces = 0;
  let brackets = 0;
  let inString = false;
  let escape = false;

  for (const ch of slice) {
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\' && inString) {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '{') braces++;
    if (ch === '}') braces--;
    if (ch === '[') brackets++;
    if (ch === ']') brackets--;
  }

  while (brackets > 0) {
    slice += ']';
    brackets--;
  }
  while (braces > 0) {
    slice += '}';
    braces--;
  }

  try {
    return JSON.parse(slice) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function extractJsonFromClaudeText(text: string): Record<string, unknown> {
  let cleaned = text.trim();

  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  } else {
    cleaned = cleaned.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
  }

  try {
    return JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    /* try balanced-object extraction */
  }

  const start = cleaned.indexOf('{');
  if (start === -1) {
    throw new Error('No JSON object found in Claude response');
  }

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\' && inString) {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        const slice = cleaned.slice(start, i + 1);
        try {
          return JSON.parse(slice) as Record<string, unknown>;
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'parse failed';
          throw new Error(`Could not parse JSON from Claude response: ${msg}`);
        }
      }
    }
  }

  const repaired = repairTruncatedJsonObject(cleaned);
  if (repaired) return repaired;

  throw new Error('Incomplete JSON object in Claude response');
}
