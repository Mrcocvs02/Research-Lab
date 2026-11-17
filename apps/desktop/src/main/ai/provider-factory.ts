import path from 'node:path';
import { createClaudeProvider, createMockAiProvider, type AiProviderEx, type MockScript } from '@rl/ai';
import type { AiProviderId, ModelConfig, SecretStore } from '@rl/core';

/** Secret under which the user's Anthropic API key lives (scope `app`, OS secure store). The Claude Code login needs none. */
export const API_KEY_SECRET = 'anthropic-api-key';

export interface AiProviderFactory {
  /** The provider for a library's configuration; null when that provider is not available in this app (yet). */
  (config: { provider: AiProviderId; models: ModelConfig[]; /** Claude Code executable chosen by the user (settings of this machine). */ claudeCodePath?: string | null }): AiProviderEx | null;
}

export interface FactoryDeps {
  /** From `RuntimeConfig.aiProvider`: `'mock'` only in a development run (ignored when packaged). */
  forceMock: boolean;
  localDataDir: string;
  secrets: SecretStore;
  clientApp?: string;
  mockScript?: MockScript;
}

/**
 * Chooses the provider. The Agent SDK is not loaded here: the provider imports it on its first chat. With `forceMock`
 * every library gets the deterministic mock, whatever its configuration says.
 */
export function createProviderFactory(d: FactoryDeps): AiProviderFactory {
  return (config) => {
    if (d.forceMock) return createMockAiProvider({ models: config.models, ...d.mockScript });
    if (config.provider !== 'claude-agent-sdk') return null;
    return createClaudeProvider({
      models: config.models,
      configuredExecutable: () => config.claudeCodePath ?? null,
      workDir: path.join(d.localDataDir, 'ai-work'),
      getApiKey: () => d.secrets.get({ kind: 'app' }, API_KEY_SECRET),
      ...(d.clientApp ? { clientApp: d.clientApp } : {}),
    });
  };
}
