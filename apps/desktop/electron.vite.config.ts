import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';
import type { Plugin } from 'vite';
import { cpSync, createReadStream, existsSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, normalize, resolve, sep } from 'node:path';

/**
 * Files pdf.js fetches only when a PDF needs them (D-193): standard fonts for PDFs that do not embed theirs, CMaps
 * for CJK text, ICC profiles, and the JavaScript decoders of JBIG2 and JPEG 2000 images (scanned papers). The
 * WebAssembly versions are left out: they would need 'wasm-unsafe-eval' in the CSP. Served at `pdfjs/` next to the page.
 */
const PDFJS_DIR = dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
const PDFJS_RESOURCES: Record<string, string> = {
  cmaps: 'cmaps',
  standard_fonts: 'standard_fonts',
  iccs: 'iccs',
  'wasm/jbig2_nowasm_fallback.js': 'wasm/jbig2_nowasm_fallback.js',
  'wasm/openjpeg_nowasm_fallback.js': 'wasm/openjpeg_nowasm_fallback.js',
};

function pdfjsResources(): Plugin {
  let outDir = '';
  return {
    name: 'rl-pdfjs-resources',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    // Development server: the same files under /pdfjs/, read from the package (only the listed ones).
    configureServer(server) {
      server.middlewares.use('/pdfjs/', (req, res, next) => {
        const rel = normalize(decodeURIComponent((req.url ?? '').split('?')[0]!)).replace(/^[\\/]+/, '');
        const allowed = Object.keys(PDFJS_RESOURCES).some((k) => rel === normalize(k) || rel.startsWith(normalize(k) + sep));
        const file = join(PDFJS_DIR, rel);
        if (!allowed || !file.startsWith(PDFJS_DIR + sep) || !existsSync(file) || !statSync(file).isFile()) return next();
        if (file.endsWith('.js')) res.setHeader('Content-Type', 'text/javascript');
        createReadStream(file).pipe(res);
      });
    },
    writeBundle() {
      for (const [from, to] of Object.entries(PDFJS_RESOURCES)) cpSync(join(PDFJS_DIR, from), join(outDir, 'pdfjs', to), { recursive: true });
    },
  };
}

/** Workspace packages ship TypeScript sources: they must be bundled, not externalized. */
const workspacePackages = ['@rl/core', '@rl/data', '@rl/search', '@rl/ai', '@rl/citations', '@rl/graph', '@rl/export', '@rl/mcp'];

export default defineConfig({
  main: {
    build: {
      // Main and worker stay unminified (dead code is still dropped) so that stack traces in the logs stay readable:
      // diagnostics come before ~250 KB on disk, which cost about 1 MB and a few ms at start (D-177).
      minify: false,
      externalizeDeps: { exclude: workspacePackages },
      // `scan-worker` is the worker thread of the library runtime (scan, text extraction, index writes).
      rollupOptions: {
        // Dependencies of the workspace packages that must stay real node modules (pdf.js finds its own worker file by path).
        // The Agent SDK (about 5 MB, plus a platform executable) is imported dynamically on the first AI use and never bundled (D-205).
        external: ['pdfjs-dist', /^pdfjs-dist\//, 'fflate', '@anthropic-ai/claude-agent-sdk', /^@anthropic-ai\/claude-agent-sdk\//],
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
    plugins: [react(), pdfjsResources()],
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
