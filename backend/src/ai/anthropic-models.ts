import { env } from '../config/env.js';

/** Primary model for audit analysis — Haiku 4.5 (3.5 Haiku retired Feb 2026). */
export const ANTHROPIC_MODEL =
  process.env.ANTHROPIC_MODEL?.trim() || 'claude-haiku-4-5-20251001';

export const ANTHROPIC_MODEL_FALLBACKS = [
  ANTHROPIC_MODEL,
  'claude-sonnet-4-5-20250929',
  'claude-3-5-haiku-20241022',
].filter((v, i, a) => a.indexOf(v) === i);
