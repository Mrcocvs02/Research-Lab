/**
 * Writing the highlights and underlines of the app INTO the original PDFs (ARCHITETTURA-UI §8.3, D-316, D-348, D-349, D-352).
 * SECURITY-SENSITIVE: the user's PDFs must never be damaged. The rules this module keeps:
 *  - nothing is written without the consent of the library (`writeToPdf` AND `writeToPdfConfirmedAt`), without `geom: 2`, or while
 *    `PDF_WRITE_ENABLED` is off; the original bytes stay an exact prefix of the file (the worker verifies it before the replacement);
 *  - the PDF is parsed only in the library worker; this module copies, appends, verifies, re-checks and renames;
 *  - a safety copy of the original is made first, and a journal lists the temporaries so that a stop leaves nothing behind;
 *  - no path comes from the renderer (only `docId`), no PDF content reaches the logs (reasons and counts only).
 * One write collects every change since the last one and happens only at the moments of D-349 (`touch`, `writeNow`, `flushAll`).
 */
import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { access, copyFile, mkdir, readdir, readFile, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import {
  AppError,
  PDF_WRITE_ENABLED,
  annotationFileSchema,
  PDF_WRITE_LIMITS as L,
  contentHashOf,
  type Annotation,
  type AnnotationFile,
  type DocumentId,
  type DocumentRecord,
  type LibraryConfig,
  type PdfReason,
  type PdfState,
} from '@rl/core';
import { atomicWriteJson, resolveInRoot, sha256File } from '@rl/core/node';
import type { PlanAnnot, SyncResult } from '@rl/data/pdf-annot';
import type { LibraryRuntime } from '../library/library-runtime.js';
import type { MainServices } from '../ipc/handlers/services.js';
import { Journal, LockedError, copyOriginal, fingerprint, replaceGuarded, sameFingerprint, tempNameFor, writeTempTruncated, writeTempWithAppend } from './pdf-files.js';
import { KeyedQueue } from '../keyed-queue.js';

type Plan = Extract<SyncResult, { ok: true }>;
const PDF_EXT = /\.pdf$/i;
const nowIso = () => new Date().toISOString();

/** Machine-local memory of what this computer wrote and is still to write (survives a restart): ids with their page, and a wait reason. */
interface LocalDoc { written: Record<string, number>; pending?: 'dirty' | 'locked' | 'unavailable'; since?: string }
interface LocalFile { v: 1; libs: Record<string, { docs: Record<string, LocalDoc> }> }

interface Mem {
  timer?: ReturnType<typeof setTimeout>;
  lastWriteAt: number;
  writing: boolean;
  /** A refusal, valid while the file stays as it was. */
  refused?: { reason: PdfReason; key: string };
  external?: number;
  dropped?: { hash: string; n: number };
}

interface Job { controller: AbortController; state: 'running' | 'done' | 'cancelled' }

export class PdfSync {
  private readonly dir: string;
  private readonly journal: Journal;
  private local: LocalFile | null = null;
  private readonly mem = new Map<string, Mem>();
  private readonly queue = new KeyedQueue();
  private readonly jobs = new Map<string, Job>();
  /** Hash and size of the files this process is about to put in place: the watcher event of our own replacement is recognised (§8.3.3 step 7). */

  constructor(private readonly s: MainServices, private readonly enabled: boolean = s.pdfWriteEnabled ?? PDF_WRITE_ENABLED) {
    this.dir = path.join(s.localDataDir, 'pdf-write');
    this.journal = new Journal(path.join(this.dir, 'journal.json'));
  }

  /* ----------------------------------------------------------------- local state */

  private async loadLocal(): Promise<LocalFile> {
    if (this.local) return this.local;
    try {
      const v = JSON.parse(await readFile(path.join(this.dir, 'state.json'), 'utf8')) as LocalFile;
      this.local = v && v.v === 1 && typeof v.libs === 'object' && v.libs ? v : { v: 1, libs: {} };
    } catch {
      this.local = { v: 1, libs: {} };
    }
    return this.local;
  }
  private async localDoc(libId: string, docId: string): Promise<LocalDoc> {
    const f = await this.loadLocal();
    const lib = (f.libs[libId] ??= { docs: {} });
    return (lib.docs[docId] ??= { written: {} });
  }
  private async saveLocal(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const f = await this.loadLocal();
    // Documents with nothing to remember are dropped.
    for (const lib of Object.values(f.libs)) for (const [k, d] of Object.entries(lib.docs)) if (!d.pending && Object.keys(d.written).length === 0) delete lib.docs[k];
    await atomicWriteJson(path.join(this.dir, 'state.json'), f, { space: 0 });
  }
  private memOf(libId: string, docId: string): Mem {
    const k = `${libId}|${docId}`;
    let m = this.mem.get(k);
    if (!m) this.mem.set(k, (m = { lastWriteAt: 0, writing: false }));
    return m;
  }
  private enqueue<T>(libId: string, docId: string, task: () => Promise<T>): Promise<T> {
    return this.queue.run(`${libId}|${docId}`, task);
  }

  /* ----------------------------------------------------------------- reading the situation */

  private async config(rt: LibraryRuntime): Promise<LibraryConfig> {
    return this.s.libraries.getConfig(rt.libraryId);
  }
  private consentOk(cfg: LibraryConfig): boolean {
    return this.enabled && cfg.annotations.writeToPdf && cfg.annotations.writeToPdfConfirmedAt !== null;
  }

  /** Splits the annotations of a document into those that may be written now and the rest (§8.1.2, D-347, D-198). */
  private split(file: AnnotationFile | null, rec: DocumentRecord): { plan: PlanAnnot[]; otherIds: string[]; needsRepair: number } {
    const plan: PlanAnnot[] = [];
    const otherIds: string[] = [];
    let needsRepair = 0;
    for (const a of file?.annotations ?? []) {
      // A crop (`area`) never goes into the PDF (§17.4.8): it is not counted, repaired or written.
      if (a.kind === 'area') continue;
      if (a.geom !== 2) needsRepair++;
      const aligned = (a.forHash ?? file?.forHash ?? contentHashOf(rec)) === contentHashOf(rec);
      if (a.geom === 2 && aligned) plan.push({ id: a.id, kind: a.kind, page: a.page, rects: a.rects, color: a.color, comment: a.comment, createdAt: a.createdAt, pdf: a.pdf });
      else otherIds.push(a.id);
    }
    return { plan, otherIds, needsRepair };
  }

  async state(docId: string, inspect = false): Promise<PdfState> {
    const rt = await this.s.runtime.require();
    const id = docId as DocumentId;
    if (inspect) {
      // How many annotations of other programs a byte-exact restore would drop (§8.3.8): reads the file, so only on request.
      const rec = await rt.getDocument(id);
      const w = rec.pdfWrite;
      if (w && !rec.missing && PDF_EXT.test(rec.path)) {
        const profile = await this.s.libraries.profile(rt.libraryId);
        const abs = await resolveInRoot(profile.rootPath, rec.path).catch(() => null);
        const ins = abs ? await rt.pdf.pdfInspect({ path: abs, baseSize: w.base.size }).catch(() => null) : null;
        if (ins?.ok && ins.externalAtBase !== null) this.memOf(rt.libraryId, docId).dropped = { hash: rec.hash, n: Math.max(0, ins.external - ins.externalAtBase) };
      }
    }
    return this.stateOf(rt, id);
  }

  private async stateOf(rt: LibraryRuntime, docId: DocumentId): Promise<PdfState> {
    const [cfg, rec, file] = await Promise.all([this.config(rt), rt.getDocument(docId), rt.store.annotations.get(docId)]);
    const ld = (await this.loadLocal()).libs[rt.libraryId]?.docs[docId];
    const mem = this.memOf(rt.libraryId, docId);
    const { plan, needsRepair } = this.split(file, rec);
    const all = (file?.annotations ?? []).filter((a) => a.kind !== 'area');
    const mode: PdfState['mode'] = !this.enabled || !cfg.annotations.writeToPdf ? 'off' : file?.pdfMode === 'app-only' ? 'app-only' : 'write';
    const missing = all.filter((a) => a.pdf?.missing).length;
    const appOnly = all.filter((a) => !a.pdf).length;
    const refused = mem.refused && mem.refused.key === `${rec.hash}:${rec.size}` ? mem.refused.reason : undefined;
    const waiting = ld?.pending === 'locked' || ld?.pending === 'unavailable' ? ld.pending : undefined;
    let st: PdfState['state'] = 'none';
    if (mode === 'write' && all.length > 0) st = mem.writing ? 'writing' : refused ? 'refused' : waiting || ld?.pending === 'dirty' || plan.some((a) => !a.pdf) ? 'pending' : 'synced';
    const own = rec.pdfWrite?.own.at(-1);
    const droppedOnRestore = rec.pdfWrite && mem.dropped?.hash === rec.hash ? mem.dropped.n : undefined;
    return {
      mode,
      state: st,
      needsConsent: this.enabled && cfg.annotations.writeToPdf && cfg.annotations.writeToPdfConfirmedAt === null,
      needsRepair,
      ...((refused ?? waiting) ? { reason: (refused ?? waiting) as PdfReason } : {}),
      appOnly,
      external: mem.external ?? 0,
      missing,
      ...(own ? { lastWrittenAt: own.at } : {}),
      canRestore: rec.pdfWrite !== undefined,
      ...(droppedOnRestore !== undefined ? { droppedOnRestore } : {}),
    };
  }

  private emitDoc(docId: string, state: 'writing' | 'synced' | 'pending' | 'refused', reason?: PdfReason): void {
    this.s.emit('annotations:pdfProgress', { docId, state, ...(reason ? { reason } : {}) });
  }

  /* ----------------------------------------------------------------- moments of writing (D-349) */

  /** The annotations of a document changed: the write waits for the close of the document, or 120 s without changes (at most once in 10 minutes). */
  touch(libId: string, docId: string): void {
    if (!this.enabled) return;
    const mem = this.memOf(libId, docId);
    void this.localDoc(libId, docId).then(async (d) => {
      if (d.pending !== 'dirty') {
        d.pending ??= 'dirty';
        await this.saveLocal().catch(() => {});
      }
    });
    clearTimeout(mem.timer);
    const wait = Math.max(L.idleWriteMs, mem.lastWriteAt + L.minIntervalMs - Date.now());
    mem.timer = setTimeout(() => void this.idleWrite(libId, docId), wait);
    mem.timer.unref();
  }

  private async idleWrite(libId: string, docId: string): Promise<void> {
    try {
      const rt = await this.s.runtime.require(libId);
      const rec = await rt.getDocument(docId as DocumentId);
      // A big file is written only when the document closes (a write reloads the whole file in the sync service).
      if (rec.size > L.idleWriteMaxBytes) return;
      await this.writeNow(docId, true);
    } catch {
      // another library is active, or the document is gone: the pending mark stays for the next start
    }
  }

  /**
   * Writes what is pending now (close of the document, "write now"). Never throws for a refusal: the state says it. A user's action
   * (`auto` false) tries again even if the file was refused before and has not changed (the user may have fixed the cause);
   * the timer and the flush at quit (`auto`) do not hammer a refused file.
   */
  async writeNow(docId: string, auto = false): Promise<PdfState> {
    const rt = await this.s.runtime.require();
    const id = docId as DocumentId;
    await this.enqueue(rt.libraryId, docId, () => this.syncDoc(rt, id, 'sync', !auto).then(() => undefined));
    return this.stateOf(rt, id);
  }

  /** Writes every pending document of the active library, waiting at most `ms` (quit, change of library). The rest stays pending for the next start. */
  async flushAll(ms: number = L.closeWaitMs): Promise<void> {
    if (!this.enabled) return;
    const f = await this.loadLocal();
    const run = async () => {
      for (const [libId, lib] of Object.entries(f.libs)) {
        const rt = await this.s.runtime.require(libId).catch(() => null);
        if (!rt) continue;
        for (const [docId, d] of Object.entries(lib.docs)) if (d.pending) await this.writeNow(docId, true).catch(() => {});
      }
    };
    await Promise.race([run().catch(() => {}), new Promise<void>((r) => setTimeout(r, ms).unref())]);
  }

  /** At start: stale temporaries of a write that was stopped are deleted (only the listed ones), then the pending documents are written. */
  async resume(): Promise<void> {
    try {
      const rt = await this.s.runtime.require();
      await this.journal.cleanup([rt.store.rootPath, this.s.localDataDir]);
      if (this.enabled) await this.flushAll(L.closeWaitMs * 4);
    } catch {
      // no active library yet
    }
  }

  /* ----------------------------------------------------------------- one write */

  private async annotationsUpdate(rt: LibraryRuntime, docId: DocumentId, fn: (f: AnnotationFile) => AnnotationFile): Promise<void> {
    await rt.store.annotations.update(docId, (cur) => fn(cur ?? annotationFileSchema.parse({ docId })));
    this.s.emit('library:changed', { kind: 'annotations', ids: [docId] });
  }

  /** Applies what the worker found: marks of what was written, adopted changes, annotations to check. Guarded: an annotation edited meanwhile is left for the next round. */
  private async applyPlan(rt: LibraryRuntime, docId: DocumentId, plan: Plan, readAt: Map<string, string>): Promise<void> {
    const marks = new Map(plan.marks.map((m) => [m.id, m]));
    const adopt = new Map(plan.adopt.map((a) => [a.id, a]));
    const cleared = new Set(plan.cleared);
    const missing = new Set(plan.missing);
    if (marks.size + adopt.size + cleared.size + missing.size === 0) return;
    const stamp = nowIso();
    await this.annotationsUpdate(rt, docId, (file) => ({
      ...file,
      annotations: file.annotations.map((a): Annotation => {
        const m = marks.get(a.id);
        const ad = adopt.get(a.id);
        if (ad && readAt.get(a.id) === a.updatedAt) {
          const next: Annotation = { ...a, ...(ad.color ? { color: ad.color } : {}), ...(ad.rects ? { rects: ad.rects } : {}), updatedAt: stamp };
          if (ad.comment) next.comment = ad.comment;
          else delete next.comment;
          a = next;
        }
        if (m) return { ...a, pdf: { objNum: m.objNum, gen: m.gen, rev: m.rev } };
        if (cleared.has(a.id)) {
          const { pdf: _gone, ...rest } = a;
          return rest;
        }
        return missing.has(a.id) && a.pdf ? { ...a, pdf: { ...a.pdf, missing: true } } : a;
      }),
    }));
  }

  /**
   * Reconciles one document with its PDF and, when there is something to write, writes it (§8.3.3). Returns what happened.
   * `remove`: takes every annotation of ours out of the PDF (revision that only edits `/Annots`).
   */
  private async syncDoc(rt: LibraryRuntime, docId: DocumentId, kind: 'sync' | 'remove', explicit = false): Promise<'done' | 'noop' | 'skipped' | 'refused' | 'waiting' | 'changed'> {
    const libId = rt.libraryId;
    const mem = this.memOf(libId, docId);
    const ld = await this.localDoc(libId, docId);
    if (kind === 'sync') {
      const cfg = await this.config(rt);
      if (!this.consentOk(cfg)) return 'skipped';
    } else if (!this.enabled) return 'skipped';
    const rec = await rt.getDocument(docId);
    const file = await rt.store.annotations.get(docId);
    if (kind === 'sync' && (file?.pdfMode === 'app-only' || !file || !file.annotations.some((a) => a.kind !== 'area') && Object.keys(ld.written).length === 0)) {
      if (ld.pending === 'dirty') ((ld.pending = undefined), await this.saveLocal());
      return 'skipped';
    }
    if (rec.missing || !PDF_EXT.test(rec.path)) return 'skipped';
    const key = `${rec.hash}:${rec.size}`;
    if (!explicit && mem.refused && mem.refused.key === key) return 'refused'; // no new attempt until the file changes
    mem.refused = undefined;

    // 2. preliminary checks
    const profile = await this.s.libraries.profile(libId);
    const abs = await resolveInRoot(profile.rootPath, rec.path);
    if (!PDF_EXT.test(abs)) return 'skipped';
    const st = await stat(abs).catch(() => null);
    if (!st?.isFile()) return 'skipped';
    const bad = (reason: PdfReason): 'refused' => ((mem.refused = { reason, key }), this.emitDoc(docId, 'refused', reason), 'refused');
    if (st.size > L.maxBytes) return bad('too-large');
    if (await access(abs, constants.W_OK).then(() => false, () => true)) return bad('read-only');
    if (st.size !== rec.size) return 'changed'; // the scan has not caught up: let it work first
    const before = await fingerprint(abs);

    // 3. analysis and plan (worker)
    mem.writing = true;
    this.emitDoc(docId, 'writing');
    try {
      const { plan: annots, otherIds } = this.split(file, rec);
      const cfg = await this.config(rt);
      const user = cfg.annotations.author === 'profile' ? (await this.s.settings.get()).user.name.trim() : '';
      const readAt = new Map((file?.annotations ?? []).map((a) => [a.id, a.updatedAt]));
      const result = await rt.pdf.pdfSync({ path: abs, mode: kind === 'remove' ? 'remove-all' : 'sync', annotations: kind === 'remove' ? [] : annots, otherIds, known: ld.written, ...(user ? { author: user } : {}), now: nowIso() });
      if (!result.ok) {
        const reason: PdfReason = result.reason;
        this.s.log.warn('pdf write refused', { reason, detail: result.detail });
        return bad(reason);
      }
      mem.external = result.external;
      if (result.size !== st.size) return 'changed';

      // Nothing to append: only the bookkeeping of the app changes.
      if (!result.update) {
        await this.applyPlan(rt, docId, result, readAt);
        this.forget(ld, result);
        ld.pending = ld.pending === 'dirty' || kind === 'sync' ? undefined : ld.pending;
        await this.saveLocal();
        this.emitDoc(docId, result.missing.length > 0 ? 'pending' : 'synced');
        return 'noop';
      }

      // 4-8. copy, temporary, verification, re-check, replacement
      const outcome = await this.commit(rt, docId, rec, abs, { ...result, update: result.update }, before, st.mtimeMs, cfg, annots);
      if (outcome.kind === 'locked' || outcome.kind === 'unavailable') {
        ld.pending = outcome.kind;
        ld.since ??= nowIso();
        await this.saveLocal();
        this.emitDoc(docId, 'pending', outcome.kind);
        return 'waiting';
      }
      if (outcome.kind === 'changed') return 'changed';
      if (outcome.kind === 'verify-failed') return bad('verify-failed');
      // the file is the new one now: the record knows it, the annotations carry their marks
      await this.applyPlan(rt, docId, result, readAt);
      this.forget(ld, result, annots);
      ld.pending = undefined;
      delete ld.since;
      mem.lastWriteAt = Date.now();
      await this.saveLocal();
      this.s.emit('library:changed', { kind: 'documents', ids: [docId] });
      this.emitDoc(docId, 'synced');
      return 'done';
    } finally {
      mem.writing = false;
    }
  }

  /** Records what this computer wrote (ids with their page) and forgets what it took out. */
  private forget(ld: LocalDoc, plan: Plan, annots: PlanAnnot[] = []): void {
    const page = new Map(annots.map((a) => [a.id, a.page]));
    for (const m of plan.marks) if (page.has(m.id)) ld.written[m.id] = page.get(m.id)!;
    for (const id of plan.cleared) delete ld.written[id];
  }

  /** Steps 4-8 of §8.3.3. */
  private async commit(
    rt: LibraryRuntime,
    docId: DocumentId,
    rec: DocumentRecord,
    abs: string,
    plan: Plan & { update: NonNullable<Plan['update']> },
    before: Awaited<ReturnType<typeof fingerprint>>,
    mtimeMs: number,
    cfg: LibraryConfig,
    annots: PlanAnnot[],
  ): Promise<{ kind: 'done' } | { kind: 'locked' | 'unavailable' | 'changed' | 'verify-failed' }> {
    const libId = rt.libraryId;
    // The hash of the whole original must be the one the record has (else the scan has to look at the file first).
    let hash: string;
    try {
      hash = await sha256File(abs);
    } catch {
      return { kind: 'unavailable' };
    }
    if (hash !== rec.hash) return { kind: 'changed' };

    // 4. safety copy, once per content, BEFORE the original is touched; the record says how to go back
    let pdfWrite = rec.pdfWrite;
    if (!pdfWrite) {
      const location = cfg.annotations.backupLocation;
      const dir = this.backupDir(rt, location);
      const name = await copyOriginal(abs, dir, docId, hash, this.journal, libId);
      pdfWrite = { base: { hash, size: rec.size }, own: [], backup: { file: name, hash, location } };
      await rt.store.documents.update(docId, (cur) => ({ ...cur!, pdfWrite, updatedAt: nowIso() }));
    }

    // 5. temporary next to the original, with the update appended
    const tmp = tempNameFor(abs);
    await this.journal.add({ tmp, docId, libraryId: libId, at: nowIso() });
    try {
      await writeTempWithAppend(abs, tmp, plan.update.bytes, plan.update.oldSize);

      // 6. verification in the worker: prefix, structure and (at the first write of a file) pdf.js
      const byId = new Map(annots.map((a) => [a.id, a]));
      const deep = pdfWrite.own.length === 0 ? plan.marks.flatMap((m) => { const a = byId.get(m.id); return a ? [{ page: a.page - 1, objNum: m.objNum, gen: m.gen, subtype: a.kind === 'underline' ? 'Underline' : 'Highlight' }] : []; }) : undefined;
      const v = await rt.pdf.pdfVerify({ path: tmp, oldSize: plan.update.oldSize, oldHash: hash, expect: plan.expect, pages: plan.pages, ...(deep ? { deep } : {}) });
      if (!v.ok) {
        this.s.log.warn('pdf write verification failed', { detail: v.detail });
        return { kind: 'verify-failed' };
      }

      // 7. re-check, then replace
      const now = await fingerprint(abs).catch(() => null);
      if (!now || !sameFingerprint(before, now) || (await stat(abs)).mtimeMs !== mtimeMs) return { kind: 'changed' };
      const stamp = nowIso();
      // The record knows the new file BEFORE the replacement, so the scan that the watcher starts cannot take it for a change by someone else.
      await rt.store.documents.update(docId, (cur) => ({ ...cur!, pdfWrite: { ...pdfWrite!, own: [...(cur!.pdfWrite?.own ?? pdfWrite!.own), { hash: v.sha256, size: v.size, at: stamp }].slice(-L.ownHashes) }, updatedAt: stamp }));
      let swapped: 'replaced' | 'changed';
      try {
        swapped = await replaceGuarded(tmp, abs, hash);
      } catch (e) {
        await rt.store.documents.update(docId, (cur) => ({ ...cur!, pdfWrite: { ...cur!.pdfWrite!, own: cur!.pdfWrite!.own.filter((o) => o.hash !== v.sha256) }, updatedAt: nowIso() })).catch(() => {});
        if (e instanceof LockedError) return { kind: 'locked' };
        throw e;
      }
      if (swapped === 'changed') {
        // Another program wrote in the last instant: its version is back in place (replaceGuarded); the record forgets our hash and the
        // scan sees the new file as a change by someone else (to look at), like the other conflict cases.
        await rt.store.documents.update(docId, (cur) => ({ ...cur!, pdfWrite: { ...cur!.pdfWrite!, own: cur!.pdfWrite!.own.filter((o) => o.hash !== v.sha256) }, updatedAt: nowIso() })).catch(() => {});
        return { kind: 'changed' };
      }

      // 8. after the replacement: the record follows the file
      const after = await stat(abs);
      await rt.store.documents.update(docId, (cur) => ({ ...cur!, hash: v.sha256, size: after.size, mtimeMs: after.mtimeMs, missing: false, updatedAt: nowIso() }));
      return { kind: 'done' };
    } finally {
      await unlink(tmp).catch(() => {});
      await this.journal.remove(tmp);
    }
  }

  private backupDir(rt: LibraryRuntime, location: 'data' | 'local'): string {
    return location === 'data' ? path.join(rt.store.dataDir, 'pdf-originals') : path.join(this.s.localDataDir, 'libraries', rt.libraryId.replace(/[^\w-]/g, '_'), 'pdf-originals');
  }

  /* ----------------------------------------------------------------- the channels */

  async setMode(docId: string, mode: 'write' | 'app-only'): Promise<PdfState> {
    const rt = await this.s.runtime.require();
    const id = docId as DocumentId;
    await this.annotationsUpdate(rt, id, (f) => {
      const { pdfMode: _m, ...rest } = f;
      return mode === 'app-only' ? { ...rest, pdfMode: 'app-only' as const } : rest;
    });
    if (mode === 'write') return this.writeNow(docId);
    return this.stateOf(rt, id);
  }

  /** The consent (D-348): 'pdf' sets `writeToPdfConfirmedAt`, 'app-only' turns `writeToPdf` off. */
  async confirm(choice: 'pdf' | 'app-only'): Promise<{ choice: 'pdf' | 'app-only'; confirmedAt: string | null }> {
    const stamp = nowIso();
    const cfg = await this.s.libraries.updateConfig((c) => ({ ...c, annotations: { ...c.annotations, ...(choice === 'pdf' ? { writeToPdf: true, writeToPdfConfirmedAt: stamp } : { writeToPdf: false }) } }));
    if (choice === 'pdf') void this.flushAll(L.closeWaitMs * 4).catch(() => {});
    return { choice, confirmedAt: cfg.annotations.writeToPdfConfirmedAt };
  }

  /** Takes the annotations of Research Lab out of the PDF (a revision that only edits `/Annots`); then the document is app-only (§8.3.8). */
  async removeFromPdf(docId: string): Promise<PdfState> {
    const rt = await this.s.runtime.require();
    const id = docId as DocumentId;
    const r = await this.enqueue(rt.libraryId, docId, () => this.syncDoc(rt, id, 'remove', true));
    if (r === 'refused') {
      const reason = this.memOf(rt.libraryId, docId).refused?.reason;
      throw new AppError('PERMISSION_DENIED', 'The PDF cannot be written', { reason });
    }
    if (r === 'changed') throw new AppError('CONFLICT', 'The file changed meanwhile', { reason: 'changed' });
    if (r === 'waiting') throw new AppError('PERMISSION_DENIED', 'The file is open in another program', { reason: 'locked' });
    await this.annotationsUpdate(rt, id, (f) => ({ ...f, pdfMode: 'app-only' as const, annotations: f.annotations.map(({ pdf: _p, ...a }) => a) })).catch(() => {});
    const ld = await this.localDoc(rt.libraryId, docId);
    ld.written = {};
    ld.pending = undefined;
    await this.saveLocal();
    return this.stateOf(rt, id);
  }

  /**
   * Puts the file back as it was before our first write (§8.3.8): the first `base.size` bytes (checked against `base.hash`), else the
   * safety copy (checked against its hash). Same path as a write: temporary, re-check, replacement. Then the document is app-only.
   */
  async restoreOriginal(docId: string, mode: 'one' | 'all' = 'one'): Promise<{ restored: boolean; droppedExternal: number; savedCopy?: string }> {
    const rt = await this.s.runtime.require();
    const id = docId as DocumentId;
    return this.enqueue(rt.libraryId, docId, async () => {
      const rec = await rt.getDocument(id);
      const w = rec.pdfWrite;
      if (!w || rec.missing || !PDF_EXT.test(rec.path)) return { restored: false, droppedExternal: 0 };
      const profile = await this.s.libraries.profile(rt.libraryId);
      const abs = await resolveInRoot(profile.rootPath, rec.path);
      const st = await stat(abs);
      if (st.size !== rec.size) throw new AppError('CONFLICT', 'The file changed meanwhile', { reason: 'changed' });
      const before = await fingerprint(abs);
      // The file must be the one the record knows (I2): a different file with the same size is never replaced.
      if ((await sha256File(abs).catch(() => '')) !== rec.hash) throw new AppError('CONFLICT', 'The file changed meanwhile', { reason: 'changed' });
      let dropped = 0;
      const ins = await rt.pdf.pdfInspect({ path: abs, baseSize: w.base.size }).catch(() => null);
      if (ins?.ok && ins.externalAtBase !== null) dropped = Math.max(0, ins.external - ins.externalAtBase);
      // The restore drops what other programs added (I1): the current state is saved first, or nothing is replaced.
      let savedCopy: string | undefined;
      if (dropped > 0 || !ins?.ok) {
        const dir = this.backupDir(rt, w.backup?.location ?? (await this.config(rt)).annotations.backupLocation);
        try {
          savedCopy = await copyOriginal(abs, dir, docId, rec.hash, this.journal, rt.libraryId, '-prerestore');
        } catch {
          throw new AppError('IO_ERROR', 'The current state cannot be saved before the restore', { reason: 'no-original' });
        }
      }
      const known = new Set([w.base.hash, ...w.own.map((o) => o.hash)]);
      const tmp = tempNameFor(abs);
      await this.journal.add({ tmp, docId, libraryId: rt.libraryId, at: nowIso() });
      try {
        let ok = false;
        if (rec.size >= w.base.size) {
          await writeTempTruncated(abs, tmp, w.base.size);
          ok = (await sha256File(tmp)) === w.base.hash;
        }
        if (!ok) {
          // The truncation does not give the original (the file was rewritten): the safety copy does, if it is still there and intact.
          await unlink(tmp).catch(() => {});
          // The copy replaces only a file whose hash we know (ours or the original): never a new edition of someone else.
          if (!known.has(rec.hash)) throw new AppError('IO_ERROR', 'The original cannot be restored', { reason: 'no-original' });
          const b = w.backup;
          const dir = b ? this.backupDir(rt, b.location) : null;
          const src = b && dir ? await resolveInRoot(dir, b.file).catch(() => null) : null;
          if (!b || !src || (await sha256File(src).catch(() => '')) !== b.hash) throw new AppError('IO_ERROR', 'The original cannot be restored', { reason: 'no-original' });
          await copyFile(src, tmp, constants.COPYFILE_EXCL);
          if ((await sha256File(tmp)) !== b.hash) throw new AppError('IO_ERROR', 'The safety copy is damaged', { reason: 'no-original' });
        }
        const newHash = await sha256File(tmp);
        const now = await fingerprint(abs);
        if (!sameFingerprint(before, now)) throw new AppError('CONFLICT', 'The file changed meanwhile', { reason: 'changed' });
        try {
          // Same guard as a write: a version written by another program in the last instant is put back, and the restore reports a conflict.
          if ((await replaceGuarded(tmp, abs, rec.hash)) === 'changed') throw new AppError('CONFLICT', 'The file changed meanwhile', { reason: 'changed' });
        } catch (e) {
          if (e instanceof LockedError) throw new AppError('PERMISSION_DENIED', 'The file is open in another program', { reason: 'locked' });
          throw e;
        }
        const after = await stat(abs);
        await rt.store.documents.update(id, (cur) => ({ ...cur!, hash: newHash, size: after.size, mtimeMs: after.mtimeMs, pdfWrite: { ...cur!.pdfWrite!, own: [] }, updatedAt: nowIso() }));
      } finally {
        await unlink(tmp).catch(() => {});
        await this.journal.remove(tmp);
      }
      if (mode === 'one') {
        await this.annotationsUpdate(rt, id, (f) => ({ ...f, pdfMode: 'app-only' as const, annotations: f.annotations.map(({ pdf: _p, ...a }) => a) })).catch(() => {});
      } else {
        await this.annotationsUpdate(rt, id, (f) => ({ ...f, annotations: f.annotations.map(({ pdf: _p, ...a }) => a) })).catch(() => {});
      }
      const ld = await this.localDoc(rt.libraryId, docId);
      ld.written = {};
      ld.pending = undefined;
      await this.saveLocal();
      this.s.emit('library:changed', { kind: 'documents', ids: [docId] });
      return { restored: true, droppedExternal: dropped, ...(savedCopy ? { savedCopy } : {}) };
    });
  }

  /** "Rewrite" or "delete here too" for annotations that were taken out of the PDF elsewhere (§8.3.7). */
  async resolveMissing(docId: string, choice: 'rewrite' | 'delete', ids?: string[]): Promise<PdfState> {
    const rt = await this.s.runtime.require();
    const id = docId as DocumentId;
    const pick = new Set(ids ?? []);
    const hit = (a: Annotation) => a.pdf?.missing === true && (!ids || pick.has(a.id));
    await this.annotationsUpdate(rt, id, (f) => ({
      ...f,
      annotations: choice === 'delete' ? f.annotations.filter((a) => !hit(a)) : f.annotations.map((a) => (hit(a) ? (({ pdf: _p, ...rest }) => rest)(a) : a)),
    })).catch(() => {});
    if (choice === 'delete') {
      const left = (await rt.store.annotations.get(id))?.annotations.length ?? 0;
      await rt.organizer.syncUnderlined(docId, left > 0).catch(() => {});
    }
    if (choice === 'rewrite') return this.writeNow(docId);
    return this.stateOf(rt, id);
  }

  /* ----------------------------------------------------------------- annotated copy, other programs' annotations (J5, lazy chunk) */

  /** The document's record, its absolute path (confined to the library root) and its annotations: what the J5 functions work on. */
  private async docFiles(docId: string) {
    const rt = await this.s.runtime.require();
    const id = docId as DocumentId;
    const [rec, file] = await Promise.all([rt.getDocument(id), rt.store.annotations.get(id)]);
    if (rec.missing || !PDF_EXT.test(rec.path)) throw new AppError('INVALID_REQUEST', 'The PDF is not available', { reason: 'unavailable' });
    const abs = await resolveInRoot((await this.s.libraries.profile(rt.libraryId)).rootPath, rec.path);
    return { rt, id, rec, file, abs };
  }

  /** "Export an annotated copy" (§8.3.14): the original is only read; works with `PDF_WRITE_ENABLED` off, without consent, for refused files. */
  async exportCopy(docId: string, destination: string): Promise<{ file: string; annotations: number; skipped: number }> {
    const { rt, rec, file, abs } = await this.docFiles(docId);
    const cfg = await this.config(rt);
    const user = cfg.annotations.author === 'profile' ? (await this.s.settings.get()).user.name.trim() : '';
    // After a write on this document, never during it.
    return this.enqueue(rt.libraryId, docId, async () => {
      const { plan } = this.split(file, rec);
      return (await import('./pdf-copy.js')).exportCopy({
        s: this.s, rt, rec, abs, dir: path.join(this.dir, 'copies'), journal: this.journal, destination,
        plan: plan.map(({ pdf: _p, ...a }) => a),
        skipped: (file?.annotations.length ?? 0) - plan.length,
        ...(user ? { author: user } : {}),
      });
    });
  }

  async externalList(docId: string) {
    const { rt, file, abs } = await this.docFiles(docId);
    return (await import('./pdf-copy.js')).externalList(rt, abs, file);
  }

  /** "Import into the app": new app annotations; the PDF is not touched (the usual write moments then apply to them). */
  async externalImport(docId: string, keys: string[]): Promise<{ imported: number; skipped: number }> {
    const { rt, id, rec, abs } = await this.docFiles(docId);
    const r = await this.enqueue(rt.libraryId, docId, async () => (await import('./pdf-copy.js')).externalImport(rt, rec, abs, keys));
    if (r.imported > 0) {
      await rt.organizer.syncUnderlined(docId, true).catch(() => {});
      this.s.emit('library:changed', { kind: 'annotations', ids: [id] });
      this.s.emit('library:changed', { kind: 'documents', ids: [id] });
      this.touch(rt.libraryId, docId);
    }
    return r;
  }

  /* ----------------------------------------------------------------- the library (jobs, copies) */

  private async documentsWithPdf(rt: LibraryRuntime): Promise<Array<{ rec: DocumentRecord; file: AnnotationFile }>> {
    const out: Array<{ rec: DocumentRecord; file: AnnotationFile }> = [];
    for (const id of await rt.store.documents.listIds()) {
      const file = await rt.store.annotations.get(id);
      if (!file || file.annotations.length === 0) continue;
      const rec = await rt.store.documents.get(id);
      if (rec && !rec.missing && PDF_EXT.test(rec.path)) out.push({ rec, file });
    }
    return out;
  }

  /** What "Write them into the PDFs" would do: files, size of the safety copies, documents skipped for annotations to check (§8.3.7). */
  async migrationPlan(): Promise<{ files: number; bytes: number; skipped: number; written: number }> {
    const rt = await this.s.runtime.require();
    let files = 0, bytes = 0, skipped = 0, written = 0;
    for (const { rec, file } of await this.documentsWithPdf(rt)) {
      if (file.pdfMode === 'app-only') continue;
      if (file.annotations.some((a) => a.geom !== 2)) skipped++;
      else if (file.annotations.every((a) => a.pdf)) written++;
      else {
        files++;
        if (!rec.pdfWrite) bytes += rec.size;
      }
    }
    return { files, bytes, skipped, written };
  }

  private startJob(kind: 'migrate' | 'restore'): { jobId: string; job: Job } {
    const jobId = `pdf-${kind}-${randomUUID().slice(0, 8)}`;
    const job: Job = { controller: new AbortController(), state: 'running' };
    this.jobs.set(jobId, job);
    return { jobId, job };
  }

  /** One file at a time; a document with annotations to check (no `geom: 2`) is skipped whole. Cancellable. */
  async migrate(): Promise<{ jobId: string }> {
    const rt = await this.s.runtime.require();
    const cfg = await this.config(rt);
    if (!this.consentOk(cfg)) throw new AppError('PERMISSION_DENIED', 'The library has not agreed to write into the PDFs', { reason: 'consent' });
    const { jobId, job } = this.startJob('migrate');
    void (async () => {
      const todo = (await this.documentsWithPdf(rt)).filter(({ file }) => file.pdfMode !== 'app-only' && !file.annotations.some((a) => a.geom !== 2) && file.annotations.some((a) => !a.pdf));
      let done = 0;
      this.s.emit('annotations:pdfProgress', { jobId, state: 'running', done, total: todo.length });
      for (const { rec } of todo) {
        if (job.controller.signal.aborted) break;
        await this.enqueue(rt.libraryId, rec.id, () => this.syncDoc(rt, rec.id as DocumentId, 'sync', true)).catch(() => {});
        this.s.emit('annotations:pdfProgress', { jobId, state: 'running', done: ++done, total: todo.length });
        await new Promise<void>((r) => setTimeout(r, 40));
      }
      job.state = job.controller.signal.aborted ? 'cancelled' : 'done';
      this.s.emit('annotations:pdfProgress', { jobId, state: job.state, done, total: todo.length });
    })().catch((e: unknown) => this.s.log.warn('annotation migration stopped', { error: e }));
    return { jobId };
  }

  /** `confirmed` must be true: the main process refuses a mass restore the renderer did not ask the user to confirm (I1). */
  async restoreAll(confirmed = false): Promise<{ jobId: string }> {
    if (confirmed !== true) throw new AppError('PERMISSION_DENIED', 'The restore of the library needs the confirmation of the user', { reason: 'confirm' });
    const rt = await this.s.runtime.require();
    const { jobId, job } = this.startJob('restore');
    void (async () => {
      const ids: string[] = [];
      for (const id of await rt.store.documents.listIds()) if ((await rt.store.documents.get(id))?.pdfWrite) ids.push(id);
      let done = 0;
      this.s.emit('annotations:pdfProgress', { jobId, state: 'running', done, total: ids.length });
      for (const id of ids) {
        if (job.controller.signal.aborted) break;
        await this.restoreOriginal(id, 'all').catch((e: unknown) => this.s.log.warn('restore of one file failed', { reason: e instanceof AppError ? e.details?.['reason'] : undefined }));
        this.s.emit('annotations:pdfProgress', { jobId, state: 'running', done: ++done, total: ids.length });
      }
      job.state = job.controller.signal.aborted ? 'cancelled' : 'done';
      this.s.emit('annotations:pdfProgress', { jobId, state: job.state, done, total: ids.length });
    })().catch((e: unknown) => this.s.log.warn('restore of the library stopped', { error: e }));
    return { jobId };
  }

  cancel(jobId: string): void {
    this.jobs.get(jobId)?.controller.abort();
  }

  /** Safety copies: how many, how much space, where (Advanced). */
  async backups(): Promise<{ count: number; bytes: number; location: 'data' | 'local' }> {
    const rt = await this.s.runtime.require();
    const location = (await this.config(rt)).annotations.backupLocation;
    let count = 0, bytes = 0;
    for (const loc of ['data', 'local'] as const) {
      const dir = this.backupDir(rt, loc);
      for (const name of await readdir(dir).catch(() => [] as string[])) {
        if (!name.endsWith('.pdf') || name.startsWith('.')) continue;
        const st = await stat(path.join(dir, name)).catch(() => null);
        if (st?.isFile()) (count++, (bytes += st.size));
      }
    }
    return { count, bytes, location };
  }

  /** Deletes the safety copies (the renderer asked the user first); the records forget them, the restore will use truncation only. */
  async deleteBackups(): Promise<{ deleted: number }> {
    const rt = await this.s.runtime.require();
    let deleted = 0;
    for (const id of await rt.store.documents.listIds()) {
      const rec = await rt.store.documents.get(id);
      const b = rec?.pdfWrite?.backup;
      if (!rec || !b) continue;
      const dir = this.backupDir(rt, b.location);
      const file = await resolveInRoot(dir, b.file).catch(() => null);
      if (file && (await unlink(file).then(() => true, () => false))) deleted++;
      await rt.store.documents.update(id, (cur) => {
        const { backup: _b, ...w } = cur!.pdfWrite!;
        return { ...cur!, pdfWrite: w, updatedAt: nowIso() };
      });
    }
    // Copies without a record (the file changed and the record was reset, prerestore copies) are deleted too (M7).
    for (const loc of ['data', 'local'] as const) {
      const dir = this.backupDir(rt, loc);
      for (const name of await readdir(dir).catch(() => [] as string[])) {
        if (!/^[\w-]+-[0-9a-f]{8}(-prerestore)?\.pdf$/.test(name)) continue;
        const file = await resolveInRoot(dir, name).catch(() => null);
        if (file && (await unlink(file).then(() => true, () => false))) deleted++;
      }
    }
    return { deleted };
  }
}

/** One PdfSync per services object (the handlers of the channels and the quit hook share it). */
const instances = new WeakMap<object, PdfSync>();
export function getPdfSync(s: MainServices): PdfSync {
  let p = instances.get(s);
  if (!p) {
    instances.set(s, (p = new PdfSync(s)));
    void p.resume();
  }
  return p;
}

/** Quit: writes the pending changes, waiting at most `closeWaitMs`. */
export async function flushPdfWrites(s: MainServices): Promise<void> {
  await instances.get(s)?.flushAll();
}
