import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'vite';

/**
 * Bundles `hostile-worker.ts` into a real worker file (the app does the same with electron-vite). The output goes
 * under `apps/desktop/out/` (ignored by git) so that the packages kept external (pdf.js, fflate) resolve.
 */
export async function buildHostileWorker(): Promise<string> {
  const dir = path.resolve(import.meta.dirname, '../../../../out/test-worker');
  await mkdir(dir, { recursive: true });
  await build({
    configFile: false,
    logLevel: 'silent',
    build: {
      ssr: path.resolve(import.meta.dirname, 'hostile-worker.ts'),
      outDir: dir,
      emptyOutDir: false,
      minify: false,
      target: 'node22',
      rollupOptions: { external: ['pdfjs-dist', /^pdfjs-dist\//, 'fflate'], output: { format: 'es', entryFileNames: 'hostile-worker.mjs' } },
    },
    ssr: { noExternal: [/^@rl\//] },
  });
  return path.join(dir, 'hostile-worker.mjs');
}
