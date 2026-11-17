import type { AiProvider, TokenUsage } from '@rl/core';

/** How the provider reaches the model: Claude Code login, an API key from the secure store, or nothing. */
export interface AiAccess {
  auth: 'claude-code' | 'api-key' | 'none';
}

/** A provider that can also say how it is authenticated (for `ai:status`). Never returns a credential. */
export interface AiProviderEx extends AiProvider {
  access(): Promise<AiAccess>;
  /** The Claude Code executable this provider runs and where it came from (Agent SDK provider only). */
  executable?(): { path: string | null; source: 'settings' | 'path' | 'local-bin' | 'sdk' | 'none' };
}

/** `TokenUsage` plus the cost the provider itself reported (the Agent SDK's `total_cost_usd`), when it did. */
export type TokenUsageWithCost = TokenUsage & { costUsd?: number };
