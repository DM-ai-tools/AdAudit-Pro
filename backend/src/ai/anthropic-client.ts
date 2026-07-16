import type Anthropic from '@anthropic-ai/sdk';
import { getAnthropicClientForKey, getParallelApiKeys, getPrimaryApiKey } from './anthropic-pool.js';
import { ANTHROPIC_MODEL_FALLBACKS } from './anthropic-models.js';

export function allApiKeysForRequest(preferredKey?: string): string[] {
  const keys = new Set<string>();
  if (preferredKey) keys.add(preferredKey);
  for (const k of getParallelApiKeys()) keys.add(k);
  const primary = getPrimaryApiKey();
  if (primary) keys.add(primary);
  return [...keys];
}

export async function createClaudeMessage(
  params: Omit<Parameters<Anthropic['messages']['create']>[0], 'model'> & { model?: string },
  preferredKey?: string,
  modelFallbacks?: string[]
): Promise<Anthropic.Message> {
  const keys = allApiKeysForRequest(preferredKey);
  if (!keys.length) {
    throw new Error('No Anthropic API keys configured');
  }

  const models = (
    modelFallbacks?.length
      ? modelFallbacks
      : [params.model, ...ANTHROPIC_MODEL_FALLBACKS]
  ).filter((v, i, a): v is string => Boolean(v) && a.indexOf(v) === i);

  let lastError: unknown;
  for (const apiKey of keys) {
    const client = getAnthropicClientForKey(apiKey);
    for (const model of models) {
      try {
        return (await client.messages.create({
          ...params,
          model,
          stream: false,
        } as Parameters<Anthropic['messages']['create']>[0])) as Anthropic.Message;
      } catch (err) {
        lastError = err;
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('not_found') || msg.includes('404') || msg.includes('deprecated')) {
          continue;
        }
        if (msg.includes('rate_limit') || msg.includes('529') || msg.includes('overloaded')) {
          continue;
        }
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error('All Claude API attempts failed');
}

export function isAnalysisFailureFinding(title: string): boolean {
  return /analysis incomplete|configure anthropic|configure API keys/i.test(title);
}
