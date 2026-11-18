// The three-way comparison of §8.3.7 (pure): the app (source of truth), the PDF and `rev`, the content written last time.
// Nothing here reads a file: the plan feeds it and applies the verdict.
import type { Ref } from './objects.js';
import type { Sem } from './annot.js';

/** An annotation of the app that may be written: `rev` is the hash of what it would be written as NOW. */
export interface AppItem { id: string; page: number; sem: Sem; rev: string; pdf?: { objNum: number; gen: number; rev: string; missing?: true } }
/** One of our objects found in the PDF (`/NM (rl-<id>)`). */
export interface PdfItem { id: string; page: number; ref: Ref; sem: Sem; rev: string }

export interface Verdict {
  add: AppItem[];
  modify: Array<{ item: AppItem; ref: Ref }>;
  /** Objects to take out of their page's `/Annots`: deleted in the app on this computer, or all of ours when removing them. */
  remove: PdfItem[];
  /** Changed in another programme while the app did not change: the app takes colour and comment. */
  adopt: PdfItem[];
  /** Written once, gone from the PDF (another programme cleaned the file): to check, never adopted as a deletion, never written again by itself. */
  missing: string[];
  /** The app's record of the object is out of date (a full save by another programme renumbered it) or absent. */
  relink: Array<{ id: string; ref: Ref; rev: string }>;
  /** Both sides changed: the app won. */
  conflicts: number;
  /** Objects of ours that this computer did not write and the app does not know: left alone (the other computer's file may not have synced yet). */
  foreign: number;
}

export function reconcile(apps: AppItem[], pdfs: PdfItem[], appIds: ReadonlySet<string>, knownWritten: ReadonlySet<string>): Verdict {
  const v: Verdict = { add: [], modify: [], remove: [], adopt: [], missing: [], relink: [], conflicts: 0, foreign: 0 };
  const byId = new Map(pdfs.map((p) => [p.id, p]));
  for (const a of apps) {
    const p = byId.get(a.id);
    if (!p) {
      if (!a.pdf) v.add.push(a);
      else if (!a.pdf.missing) v.missing.push(a.id);
      continue;
    }
    if (!a.pdf) {
      if (p.rev === a.rev) v.relink.push({ id: a.id, ref: p.ref, rev: p.rev });
      else v.modify.push({ item: a, ref: p.ref });
      continue;
    }
    const appChanged = a.rev !== a.pdf.rev, pdfChanged = p.rev !== a.pdf.rev;
    if (appChanged && pdfChanged && a.rev !== p.rev) {
      v.conflicts++;
      v.modify.push({ item: a, ref: p.ref });
    } else if (appChanged && !pdfChanged) v.modify.push({ item: a, ref: p.ref });
    else if (pdfChanged && !appChanged) (v.adopt.push(p), v.relink.push({ id: a.id, ref: p.ref, rev: p.rev }));
    else if (pdfChanged || p.ref.n !== a.pdf.objNum || p.ref.g !== a.pdf.gen || a.pdf.missing) v.relink.push({ id: a.id, ref: p.ref, rev: p.rev });
  }
  for (const p of pdfs) {
    if (appIds.has(p.id)) continue;
    if (knownWritten.has(p.id)) v.remove.push(p);
    else v.foreign++;
  }
  return v;
}
