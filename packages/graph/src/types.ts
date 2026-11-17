/** One document as the graph sees it: plain data, no Electron, no files. */
export interface GraphDoc {
  id: string;
  /** Changes whenever the document changes (staleness of the model). */
  sig: string;
  /** Folder of the document ('' for the library root). */
  folder: string;
  title: string;
  /** AI summary/description (when not rejected) or the abstract found in the file. */
  abstract: string;
  /** Accepted or proposed (not rejected) AI keywords and synonyms. */
  keywords: string[];
  /** First pages of the text (the caller caps them). */
  text: string;
  /** Tag ids, implied tags included. */
  tags: string[];
  /** Keys of the works this document cites (`r:`) and of the works that cite it (`c:`): shared keys = shared citations. */
  refs: string[];
  /** Ids of library documents it cites or is cited by (direct links). */
  cites: string[];
}

/** Sparse L2-normalised vector: term indexes ascending, weights in 1/1000 steps. */
export interface SparseVec {
  i: Int32Array;
  w: Float32Array;
}

export interface Edge {
  a: number;
  b: number;
  w: number;
}

/** What the long computations need from the caller: progress and cancellation. */
export interface RunContext {
  signal?: AbortSignal | undefined;
  onProgress?: ((phase: 'vectors' | 'similarity' | 'clusters' | 'layout', done: number, total: number) => void) | undefined;
}

export const abortError = (): Error => Object.assign(new Error('aborted'), { name: 'AbortError' });

/** Lets queued messages (a cancel) reach the thread, and stops when the run was cancelled. */
export async function checkpoint(ctx: RunContext | undefined): Promise<void> {
  if (ctx?.signal?.aborted) throw abortError();
  await new Promise<void>((resolve) => setImmediate(resolve));
  if (ctx?.signal?.aborted) throw abortError();
}
