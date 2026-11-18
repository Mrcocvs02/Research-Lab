// Entry of the lazy chunk of the annotation writer (ARCHITETTURA-UI §8.3, §13): loaded with `import()` by the library worker at
// the first write, never at start. Everything in this folder reads hostile bytes and runs in the worker only.
export { planSync, pageCountOf, type SyncRequest, type SyncResult, type PlanAnnot, type PageExpect, type Mark, type AdoptItem } from './plan.js';
export { verifyFile, type VerifyRequest, type VerifyResult } from './verify.js';
export { inspectFile, type InspectResult } from './inspect.js';
export type { ExternalItem } from './external.js';
export { revOf, semOf, COLORS } from './annot.js';
export { toPdfRects, fromPdfRects, pageGeometry } from './geometry.js';
