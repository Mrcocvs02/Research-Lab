import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

/**
 * The pdf.js set-up shared by the reader and the grid thumbnails (D-186, D-193, D-195). Imported only from lazy code:
 * the library itself is a dynamic import, so nothing of pdf.js is fetched until a document must be opened or drawn.
 */
export type PdfjsLib = typeof import('pdfjs-dist');

/** URL of a pdf.js resource folder copied next to the page at build time (`pdfjs/`, see electron.vite.config.ts). */
const resourceUrl = (folder: string) => new URL(`pdfjs/${folder}`, document.baseURI).href;

export async function loadPdfjs(): Promise<PdfjsLib> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  return pdfjs;
}

/** Options of `getDocument` for an `rl-doc://` URL. `isEvalSupported` exists at run time but not in the shipped types. */
export function pdfDocumentParams(url: string): Parameters<PdfjsLib['getDocument']>[0] & { isEvalSupported: boolean } {
  return {
    url,
    isEvalSupported: false, // no eval in the renderer (CSP)
    enableXfa: false,
    disableAutoFetch: true, // read the ranges that are needed, not the whole file in the background
    verbosity: 0,
    // Fetched only when a PDF needs them (D-193): non-embedded standard fonts, CMaps of CJK text, ICC profiles, and
    // the JavaScript decoders of JBIG2/JPEG 2000 scans (no WebAssembly: the CSP has no 'wasm-unsafe-eval').
    cMapUrl: resourceUrl('cmaps/'),
    cMapPacked: true,
    standardFontDataUrl: resourceUrl('standard_fonts/'),
    iccUrl: resourceUrl('iccs/'),
    wasmUrl: resourceUrl('wasm/'),
    useWasm: false,
  };
}
