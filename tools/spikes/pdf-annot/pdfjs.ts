// Read-back with pdf.js (the verifier of the design); test-only.
type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export async function withPdfjs<T>(bytes: Buffer, f: (doc: Any, pdfjs: Any) => Promise<T>): Promise<T> {
  const pdfjs: Any = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)),
    verbosity: 0, isEvalSupported: false, useSystemFonts: false, disableFontFace: true, useWorkerFetch: false, enableScripting: false,
  });
  const doc = await task.promise;
  try { return await f(doc, pdfjs); } finally { await task.destroy(); }
}

export const annotsOf = (bytes: Buffer, page = 1) => withPdfjs(bytes, async (doc) => (await (await doc.getPage(page)).getAnnotations()) as Any[]);
