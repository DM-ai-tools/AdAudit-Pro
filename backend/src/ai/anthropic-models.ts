import { env } from '../config/env.js';

/** Primary model for audit analysis — Haiku 4.5 (3.5 Haiku retired Feb 2026). */
export const ANTHROPIC_MODEL =
  process.env.ANTHROPIC_MODEL?.trim() || 'claude-haiku-4-5-20251001';

/**
 * Make It Better / RSA optimize needs a larger output budget than audit modules.
 * Prefer Sonnet unless overridden — Haiku often hits max_tokens on the full JSON schema.
 */
export const ANTHROPIC_OPTIMIZE_MODEL =
  process.env.ANTHROPIC_OPTIMIZE_MODEL?.trim() || 'claude-sonnet-4-5-20250929';

export const ANTHROPIC_OPTIMIZE_MAX_TOKENS = Math.min(
  32000,
  Math.max(4096, Number.parseInt(process.env.ANTHROPIC_OPTIMIZE_MAX_TOKENS || '16000', 10) || 16000)
);

export const ANTHROPIC_MODEL_FALLBACKS = [
  ANTHROPIC_MODEL,
  'claude-sonnet-4-5-20250929',
  'claude-3-5-haiku-20241022',
].filter((v, i, a) => a.indexOf(v) === i);

export const ANTHROPIC_OPTIMIZE_MODEL_FALLBACKS = [
  ANTHROPIC_OPTIMIZE_MODEL,
  'claude-sonnet-4-5-20250929',
  ANTHROPIC_MODEL,
  'claude-haiku-4-5-20251001',
].filter((v, i, a) => a.indexOf(v) === i);
