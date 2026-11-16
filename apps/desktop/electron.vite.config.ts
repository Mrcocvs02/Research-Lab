import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';
import { resolve } from 'node:path';

/** Workspace packages ship TypeScript sources: they must be bundled, not externalized. */
const workspacePackages = ['@rl/core', '@rl/data', '@rl/search', '@rl/ai', '@rl/citations', '@rl/graph', '@rl/export', '@rl/mcp'];

export default defineConfig({
  main: {
    build: {
      // electron-vite builds main, preload and renderer unminified by default; minified code is smaller to read from disk and to parse.
      minify: 'oxc',
      externalizeDeps: { exclude: workspacePackages },
      // `scan-worker` is the worker thread of the library runtime (scan, text extraction, index writes).
      rollupOptions: {
        // Dependencies of the workspace packages that must stay real node modules (pdf.js finds its own worker file by path).
        external: ['pdfjs-dist', /^pdfjs-dist\//, 'fflate'],
        input: {
          index: resolve(import.meta.dirname, 'src/main/index.ts'),
          'scan-worker': resolve(import.meta.dirname, 'src/main/scan-worker.ts'),
        },
      },
    },
  },
  preload: {
    build: {
      minify: 'oxc',
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
      minify: 'oxc',
      cssMinify: true,
      rollupOptions: {
        input: { index: resolve(import.meta.dirname, 'src/renderer/index.html') },
        // `@rl/core` is one barrel whose modules build zod schemas at load time: without this, importing one constant from
        // it keeps all of zod (about 300 KB) in the first screen. The package has no side effects other than defining
        // its exports, so what the renderer does not use can go (zod itself is then only in the chunks that use it).
        treeshake: { moduleSideEffects: (id: string) => !/[\/]packages[\/]core[\/]src[\/]/.test(id) },
      },
    },
  },
});
