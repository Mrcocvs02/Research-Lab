/** Second-brain export (plan section 6, contract in `@rl/core` `ipc/channels/export.ts`): pure logic, no Electron, no I/O of its own. */
export * from './citekeys.js';
export * from './manifest.js';
export * from './markers.js';
export * from './render.js';
export { approxTokens, foldAscii, mdText, safeLine, sha256, slugify, toLf } from './text.js';
