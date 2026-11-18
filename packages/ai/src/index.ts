/** AI layer (phase 4): the Claude Agent SDK provider, the deterministic mock provider and the library tools. */
export * from './types.js';
export * from './pricing.js';
export * from './guide.js';
export * from './tools.js';
export * from './suggest.js';
export { createMockAiProvider, parseToolDirectives, type MockScript } from './mock.js';
export {
  BUILTIN_TOOLS_DISALLOWED,
  MCP_SERVER_NAME,
  buildQueryOptions,
  bundledExecutable,
  childEnvFor,
  claudeCredentialsFile,
  createClaudeProvider,
  detectAccess,
  findClaudeExecutable,
  type ExecutableSource,
  effortFor,
  mcpToolName,
  renderPrompt,
  resolveClaudeExecutable,
  type ClaudeProviderOptions,
  type QueryOptionsInput,
  type SdkModule,
} from './claude.js';
