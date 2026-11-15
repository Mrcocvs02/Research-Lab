import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';
import { resolve } from 'node:path';

/** Workspace packages ship TypeScript sources: they must be bundled, not externalized. */
const workspacePackages = ['@rl/core', '@rl/data', '@rl/search', '@rl/ai', '@rl/citations', '@rl/graph', '@rl/export', '@rl/mcp'];

export default defineConfig({
  main: {
    build: {
      externalizeDeps: { exclude: workspacePackages },
      // `scan-worker` is the worker thread of the library runtime (scan, text extraction, index writes).
      rollupOptions: {
        input: {
          index: resolve(import.meta.dirname, 'src/main/index.ts'),
          'scan-worker': resolve(import.meta.dirname, 'src/main/scan-worker.ts'),
        },
      },
    },
  },
  preload: {
    build: {
      // Sandboxed preloads can only require 'electron': bundle everything else, as CommonJS.
      externalizeDeps: false,
      rollupOptions: {
        input: { index: resolve(import.meta.dirname, 'src/preload/index.ts') },
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    root: resolve(import.meta.dirname, 'src/renderer'),
    plugins: [react()],
    build: {
      rollupOptions: { input: { index: resolve(import.meta.dirname, 'src/renderer/index.html') } },
    },
  },
});
