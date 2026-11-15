import type { AiProvider, ToolSpec } from '@rl/core';

export interface ClaudeProviderOptions {
  /** Resolves a secret from the OS store; the provider never persists it. */
  getApiKey?: () => Promise<string | null>;
}

/** Owner: ai-integration. Claude Agent SDK provider. */
export function createClaudeProvider(_options?: ClaudeProviderOptions): AiProvider {
  throw new Error('not implemented');
}

/** Owner: ai-integration. Deterministic provider used by every automated test. */
export function createMockAiProvider(_script?: Record<string, unknown>): AiProvider {
  throw new Error('not implemented');
}

/** Owner: ai-integration. The only tools the chat agent may use (no shell, no free network). */
export function createLibraryTools(): ToolSpec[] {
  throw new Error('not implemented');
}
