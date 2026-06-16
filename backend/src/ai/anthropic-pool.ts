import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config/env.js';

const clients = new Map<string, Anthropic>();

export function getAnthropicClientForKey(apiKey: string): Anthropic {
  let client = clients.get(apiKey);
  if (!client) {
    client = new Anthropic({ apiKey });
    clients.set(apiKey, client);
  }
  return client;
}

/** Three parallel worker keys (4 modules each for a 12-module audit). */
export function getParallelApiKeys(): string[] {
  if (env.anthropicParallelKeys.length >= 3) {
    return env.anthropicParallelKeys.slice(0, 3);
  }
  if (env.anthropicParallelKeys.length > 0) {
    return env.anthropicParallelKeys;
  }
  if (env.anthropicApiKey) {
    return [env.anthropicApiKey];
  }
  return [];
}

export function getPrimaryApiKey(): string | undefined {
  return env.anthropicApiKey || env.anthropicParallelKeys[0];
}

export function getParallelStreamCount(): number {
  const keys = getParallelApiKeys();
  return Math.max(1, keys.length);
}
