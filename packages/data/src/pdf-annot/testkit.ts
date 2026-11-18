// What the tests of the app need from the writer: the synthetic PDF generators and the read-only document model. Tests only: the app
// never imports this entry (it is not part of the lazy chunk of the writer).
export { appendRevision, basePdf } from './test-pdfs.js';
export { FOREIGN, assemble, docPdf, rng, type DocSpec, type PageSpec } from './gen.js';
export { bufSyncSource, getPage, loadDoc, resolve, resolveObj, readIndirectAt } from './doc.js';
export { planSync, type SyncRequest, type SyncResult } from './plan.js';
export { verifyFile } from './verify.js';
export { inspectFile } from './inspect.js';
export { readAnnot } from './annot.js';
