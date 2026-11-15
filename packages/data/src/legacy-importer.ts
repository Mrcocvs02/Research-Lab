import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  AppError,
  SCHEMA_VERSION,
  documentIdFromHash,
  documentRecordSchema,
  legacyFileRecordSchema,
  legacyTaxonomySchema,
  libraryConfigSchema,
  noopLogger,
  scanConfigSchema,
  sha256Schema,
  taxonomyFileSchema,
  type AiField,
  type DocumentRecord,
  type DocumentType,
  type ImportJobStatus,
  type ImportReport,
  type LegacyFileRecord,
  type LegacyImporter,
  type LegacyTaxonomy,
  type Logger,
  type TaxonomyNode,
  type Venue,
} from '@rl/core';
import { normalizeRelativePath, resolveInRoot, sha256File, sha256Of } from '@rl/core/node';
import { NameIndex, normalizeName, slugify, uniqueId } from './normalize.js';
import { createLibraryStore } from './store.js';

export interface LegacyImporterOptions {
  logger?: Logger;
  /** Clock, for tests. */
  now?: () => Date;
}

const OLD_INDEX_DIR = '.phd_index';
const MAX_WARNINGS = 100;

type Json = Record<string, unknown>;

function rest(obj: Json, known: readonly string[]): Json {
  const out: Json = {};
  for (const [k, v] of Object.entries(obj)) if (!known.includes(k)) out[k] = v;
  return out;
}

function compact(obj: Json): Json {
  const out: Json = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0)) out[k] = v;
  return out;
}

function toIso(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const t = Date.parse(value);
  return Number.isNaN(t) ? undefined : new Date(t).toISOString();
}

function asYear(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' && /^\d{4}$/.test(value.trim()) ? Number(value) : NaN;
  return Number.isInteger(n) && n >= 1000 && n <= 3000 ? n : null;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

function mapNodeStatus(raw: string | undefined): { status: TaxonomyNode['status']; unknown: boolean } {
  switch ((raw ?? 'confirmed').toLowerCase()) {
    case 'confirmed':
    case 'active':
    case 'ok':
      return { status: 'active', unknown: false };
    case 'candidate':
    case 'proposed':
    case 'pending':
      return { status: 'candidate', unknown: false };
    case 'deprecated':
    case 'rejected':
    case 'obsolete':
      return { status: 'deprecated', unknown: false };
    default:
      return { status: 'active', unknown: true };
  }
}

function mapPubStatus(raw: string | null): DocumentRecord['publication']['status'] {
  const v = (raw ?? '').toLowerCase();
  return v === 'published' || v === 'preprint' || v === 'withdrawn' ? v : 'unknown';
}

async function readText(file: string): Promise<string | null> {
  try {
    const raw = await readFile(file, 'utf8');
    return raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new AppError('IO_ERROR', 'Cannot read the old index', { code: (e as NodeJS.ErrnoException).code ?? 'unknown' });
  }
}

async function locateIndexDir(sourceDir: string): Promise<string> {
  for (const candidate of [sourceDir, path.join(sourceDir, OLD_INDEX_DIR)]) {
    const s = await stat(path.join(candidate, 'files.jsonl')).catch(() => null);
    if (s?.isFile()) return candidate;
  }
  throw new AppError('NOT_FOUND', 'No old index (files.jsonl) found in the chosen folder');
}

/** Taxonomy being assembled: existing nodes first (they win), then the old ones. */
class TaxonomyBuilder {
  readonly nodes: TaxonomyNode[];
  readonly types: DocumentType[];
  readonly venues: Venue[];
  readonly created = { nodes: [] as TaxonomyNode[], types: [] as DocumentType[], venues: [] as Venue[] };
  readonly nodeIndex = new NameIndex();
  readonly typeIndex = new NameIndex();
  readonly venueIndex = new NameIndex();
  private readonly nodeIds = new Set<string>();
  private readonly typeIds = new Set<string>();
  private readonly venueIds = new Set<string>();

  constructor(
    existing: { nodes: TaxonomyNode[]; documentTypes: DocumentType[]; venues: Venue[] },
    private readonly warn: (m: string) => void,
    private readonly now: string,
  ) {
    this.nodes = [...existing.nodes];
    this.types = [...existing.documentTypes];
    this.venues = [...existing.venues];
    for (const n of this.nodes) this.registerNode(n);
    for (const t of this.types) {
      this.typeIds.add(t.id);
      this.typeIndex.add(t.label, t.id);
      this.typeIndex.add(t.id, t.id);
      for (const a of t.aliases) this.typeIndex.add(a, t.id);
    }
    for (const v of this.venues) {
      this.venueIds.add(v.id);
      this.venueIndex.add(v.name, v.id);
      for (const a of v.aliases) this.venueIndex.add(a, v.id);
    }
  }

  private registerNode(n: TaxonomyNode): void {
    this.nodeIds.add(n.id);
    this.nodeIndex.add(n.label, n.id);
    for (const a of n.aliases) {
      if (!this.nodeIndex.add(a, n.id)) this.warn(`Alias "${a}" of "${n.label}" is already used by another tag`);
    }
  }

  /** Adds a node unless one with the same (normalised) name or alias exists; returns the id either way. */
  addNode(label: string, fields: Partial<TaxonomyNode>): string {
    const known = this.nodeIndex.resolve(label);
    if (known !== undefined) return known;
    const node = taxonomyNodeShape({
      id: uniqueId(slugify(label), this.nodeIds),
      label: label.trim(),
      origin: 'import',
      createdAt: this.now,
      ...fields,
    });
    this.nodes.push(node);
    this.created.nodes.push(node);
    this.registerNode(node);
    return node.id;
  }

  addType(label: string): string {
    const known = this.typeIndex.resolve(label);
    if (known !== undefined) return known;
    const type: DocumentType = { id: uniqueId(slugify(label), this.typeIds), label: label.trim(), aliases: [] };
    this.types.push(type);
    this.created.types.push(type);
    this.typeIndex.add(type.label, type.id);
    return type.id;
  }

  addVenue(name: string, aliases: string[]): string {
    const known = this.venueIndex.resolve(name);
    if (known !== undefined) return known;
    const venue: Venue = { id: uniqueId(slugify(name), this.venueIds), name: name.trim(), aliases };
    this.venues.push(venue);
    this.created.venues.push(venue);
    this.venueIndex.add(venue.name, venue.id);
    for (const a of aliases) this.venueIndex.add(a, venue.id);
    return venue.id;
  }

  nodeById(id: string): TaxonomyNode | undefined {
    return this.nodes.find((n) => n.id === id);
  }
}

function taxonomyNodeShape(n: Partial<TaxonomyNode> & { id: string; label: string }): TaxonomyNode {
  return { parents: [], aliases: [], implies: [], status: 'active', origin: 'user', ...n };
}

/** Depth of each node: 1 = no parents, else 1 + deepest parent. Cycles are cut. */
function levelOf(id: string, byId: Map<string, TaxonomyNode>, trail = new Set<string>()): number {
  const node = byId.get(id);
  if (!node || trail.has(id)) return 1;
  trail.add(id);
  let deepest = 0;
  for (const p of node.parents) deepest = Math.max(deepest, levelOf(p, byId, trail));
  trail.delete(id);
  return deepest + 1;
}

/** All ids reachable through `implies` (transitively), excluding the start set itself. */
function impliedClosure(start: string[], byId: Map<string, TaxonomyNode>): Set<string> {
  const out = new Set<string>();
  const stack = [...start];
  while (stack.length) {
    const node = byId.get(stack.pop() as string);
    for (const t of node?.implies ?? []) {
      if (!out.has(t)) {
        out.add(t);
        stack.push(t);
      }
    }
  }
  return out;
}

interface Candidate {
  rec: LegacyFileRecord;
  relPath: string;
  hash: string;
  hashUnknown: boolean;
  missing: boolean;
  size: number;
  mtimeMs: number;
}

/** One-shot importer of the old index. Read-only on the old index and on the documents. */
export function createLegacyImporterImpl(options: LegacyImporterOptions = {}): LegacyImporter {
  const log = options.logger ?? noopLogger;
  const clock = options.now ?? (() => new Date());

  return {
    async run({ sourceDir, libraryRoot, dataDir, deviceId, onProgress, signal }): Promise<ImportReport> {
      const jobId = 'legacy-import';
      const nowIso = clock().toISOString();
      const warnings: string[] = [];
      let warningCount = 0;
      const warn = (m: string) => {
        warningCount++;
        if (warnings.length < MAX_WARNINGS) warnings.push(m);
        log.warn(m);
      };
      const progress = (phase: NonNullable<ImportJobStatus['phase']>, processed = 0, total?: number) =>
        onProgress?.({ jobId, state: 'running', phase, processed, ...(total !== undefined ? { total } : {}) });
      const checkAbort = () => {
        if (signal?.aborted) throw new AppError('CANCELLED', 'Import cancelled');
      };

      /* ---------------------------- reading ---------------------------- */
      progress('reading');
      const indexDir = await locateIndexDir(sourceDir);

      const taxonomyRaw = await readText(path.join(indexDir, 'taxonomy.json'));
      let legacyTax: LegacyTaxonomy = {};
      if (taxonomyRaw === null) warn('taxonomy.json not found in the old index; importing documents only');
      else {
        let json: unknown;
        try {
          json = JSON.parse(taxonomyRaw);
        } catch {
          throw new AppError('SCHEMA_INVALID', 'The old taxonomy.json is not valid JSON');
        }
        const parsed = legacyTaxonomySchema.safeParse(json);
        if (!parsed.success) throw new AppError('SCHEMA_INVALID', 'The old taxonomy.json has an unexpected shape');
        legacyTax = parsed.data;
      }

      const records: LegacyFileRecord[] = [];
      let skipped = 0;
      const filesRaw = (await readText(path.join(indexDir, 'files.jsonl'))) ?? '';
      for (const [i, line] of filesRaw.split('\n').entries()) {
        if (!line.trim()) continue;
        try {
          const parsed = legacyFileRecordSchema.safeParse(JSON.parse(line));
          if (parsed.success) records.push(parsed.data);
          else throw new Error('shape');
        } catch {
          skipped++;
          warn(`files.jsonl line ${i + 1} skipped: not a valid record`);
        }
      }
      checkAbort();

      const store = createLibraryStore({
        rootPath: libraryRoot,
        dataDir,
        deviceId,
        actor: 'import',
        logDocumentChanges: false,
        ...(options.logger ? { logger: options.logger } : {}),
      });
      await store.init();

      /* ---------------------------- taxonomy --------------------------- */
      progress('taxonomy');
      const existingTax = await store.readTaxonomy(); // throws if the file is corrupt: never overwrite it
      const tb = new TaxonomyBuilder(existingTax, warn, nowIso);

      for (const name of legacyTax.types ?? []) tb.addType(name);
      for (const [name, v] of Object.entries(legacyTax.venues ?? {})) tb.addVenue(name, v.aliases ?? []);

      for (const [name, m] of Object.entries(legacyTax.macro ?? {})) {
        tb.addNode(name, { aliases: m.aliases ?? [], group: 'macro', legacy: compact(rest(m, ['aliases'])) });
      }
      const microIds: [string, string][] = [];
      for (const [name, m] of Object.entries(legacyTax.micro ?? {})) {
        const parents: string[] = [];
        for (const pn of m.macro ?? []) {
          const pid = tb.nodeIndex.resolve(pn);
          if (pid === undefined) warn(`Parent "${pn}" of tag "${name}" not found`);
          else if (!parents.includes(pid)) parents.push(pid);
        }
        const st = mapNodeStatus(m.status);
        const id = tb.addNode(name, {
          parents,
          aliases: m.aliases ?? [],
          status: st.status,
          group: 'micro',
          legacy: compact({ ...rest(m, ['macro', 'aliases', 'status', 'implies']), ...(st.unknown ? { status: m.status } : {}) }),
        });
        microIds.push([name, id]);
      }
      // Second pass: implications can point to any node, so resolve once all exist.
      for (const [name, id] of microIds) {
        const node = tb.created.nodes.find((n) => n.id === id);
        if (!node) continue; // already existed: user edits win
        const unresolved: string[] = [];
        for (const target of legacyTax.micro?.[name]?.implies ?? []) {
          const tid = tb.nodeIndex.resolve(target);
          if (tid === undefined) unresolved.push(target);
          else if (tid !== id && !node.implies.includes(tid)) node.implies.push(tid);
        }
        if (unresolved.length) {
          node.legacy = { ...(node.legacy ?? {}), unresolvedImplies: unresolved };
          warn(`Tag "${name}" implies unknown tags: ${unresolved.join(', ')}`);
        }
      }
      for (const [name, e] of Object.entries(legacyTax.extra ?? {})) {
        tb.addNode(name, {
          group: e.group ? `extra:${e.group}` : 'extra',
          ...(toIso(e.added) ? { createdAt: toIso(e.added) as string } : {}),
          legacy: compact({ group: e.group, source: e.source, added: e.added, ...rest(e, ['group', 'source', 'added']) }),
        });
      }
      checkAbort();

      /* --------------------------- documents --------------------------- */
      progress('documents', 0, records.length);
      const existingDocs = await store.documents.list();
      const knownIds = new Set(existingDocs.map((d) => d.id));
      const knownPaths = new Set(existingDocs.map((d) => d.path));

      const byId = new Map<string, DocumentRecord>();
      const order: string[] = [];
      let duplicates = 0;
      let missingCount = 0;
      let tagTotal = 0;
      let nonDerivable = 0;
      const warnedNames = new Set<string>();
      const warnOnce = (key: string, m: string) => {
        if (!warnedNames.has(key)) {
          warnedNames.add(key);
          warn(m);
        }
      };
      const nodeById = new Map<string, TaxonomyNode>();
      const refreshNodeMap = () => {
        nodeById.clear();
        for (const n of tb.nodes) nodeById.set(n.id, n);
      };

      const resolveTags = (names: readonly string[], kind: 'macro' | 'micro' | 'extra' | 'manual'): string[] => {
        const ids: string[] = [];
        for (const raw of names) {
          if (typeof raw !== 'string' || !raw.trim()) continue;
          let id = tb.nodeIndex.resolve(raw);
          if (id === undefined) {
            warnOnce(`${kind}:${normalizeName(raw)}`, `Tag "${raw}" (${kind}) is not in the old taxonomy; created as a new tag`);
            id = tb.addNode(raw, {
              group: kind === 'macro' ? 'macro' : kind === 'micro' ? 'micro' : kind === 'extra' ? 'extra' : 'extra:manual',
              status: kind === 'macro' || kind === 'extra' ? 'active' : 'candidate',
              legacy: { unresolved: kind },
            });
          }
          if (!ids.includes(id)) ids.push(id);
        }
        return ids;
      };

      for (const [i, rec] of records.entries()) {
        checkAbort();
        if (i % 5 === 0) progress('documents', i, records.length);
        let relPath: string;
        try {
          relPath = normalizeRelativePath(rec.p);
          if (!relPath) throw new Error('empty');
        } catch {
          skipped++;
          warn(`Record ${i + 1} skipped: unusable path`);
          continue;
        }
        if (knownPaths.has(relPath)) {
          skipped++; // already imported on an earlier run: never overwrite later edits
          continue;
        }

        const cand = await describeFile(libraryRoot, relPath, rec, warn);
        if (!cand) {
          skipped++;
          continue;
        }
        if (knownIds.has(documentIdFromHash(cand.hash))) {
          skipped++;
          continue;
        }

        const tags = rec.tags ?? {};
        const xt = Array.isArray((rec as Json)['xt']) ? ((rec as Json)['xt'] as unknown[]).filter((x): x is string => typeof x === 'string') : [];
        const tagIds = [
          ...new Set([
            ...resolveTags(tags.macro ?? [], 'macro'),
            ...resolveTags(tags.micro ?? [], 'micro'),
            ...resolveTags(tags.extra ?? [], 'extra'),
            ...resolveTags(xt, 'manual'),
          ]),
        ];
        refreshNodeMap();

        const id = documentIdFromHash(cand.hash);
        const prior = byId.get(id);
        if (prior) {
          // Same content under another path: one record, more paths (see report).
          duplicates++;
          prior.tags = [...new Set([...prior.tags, ...tagIds])];
          const lg = prior.legacy ?? {};
          lg['duplicates'] = [...((lg['duplicates'] as unknown[] | undefined) ?? []), rec];
          prior.legacy = lg;
          warn(`Duplicate content: "${relPath}" shares the id of "${prior.path}"; kept as one document`);
          continue;
        }

        // Implied tags must be derivable from the implications (they are not stored as manual tags).
        const impliedNames = [...(tags.implied ?? []), ...(tags.implied_macro ?? [])];
        if (impliedNames.length) {
          const closure = impliedClosure(tagIds, nodeById);
          const parentsOfTags = new Set<string>();
          for (const t of [...tagIds, ...closure]) for (const p of nodeById.get(t)?.parents ?? []) parentsOfTags.add(p);
          const derivable = impliedNames.every((n) => {
            const nid = tb.nodeIndex.resolve(n);
            return nid !== undefined && (closure.has(nid) || parentsOfTags.has(nid) || tagIds.includes(nid));
          });
          if (!derivable) nonDerivable++;
        }

        const venueName = str(tags.venue);
        const venueId = venueName ? tb.venueIndex.resolve(venueName) : undefined;
        if (venueName && venueId === undefined) warnOnce(`venue:${normalizeName(venueName)}`, `Venue "${venueName}" is not in the old venue list; kept as text only`);
        const typeName = str(tags.type);
        const typeId = typeName ? tb.addType(typeName) : null;
        if (typeName && tb.created.types.some((t) => t.id === typeId) && !(legacyTax.types ?? []).some((t) => normalizeName(t) === normalizeName(typeName))) {
          warnOnce(`type:${normalizeName(typeName)}`, `Document type "${typeName}" is not in the old type list; added`);
        }
        const year = asYear(tags.year);
        const pubStatus = str(tags.pub_status);
        const pubChecked = toIso(tags.pub_checked);
        const summary = str(tags.summary);
        const keywords = (tags.keywords ?? []).filter((k) => typeof k === 'string' && k.trim());

        const doc: DocumentRecord = documentRecordSchema.parse({
          schemaVersion: SCHEMA_VERSION,
          id,
          hash: cand.hash,
          previousHashes: [],
          path: relPath,
          size: cand.size,
          mtimeMs: cand.mtimeMs,
          missing: cand.missing,
          type: typeId,
          title: str(tags.title),
          authors: (tags.authors ?? []).filter((a) => typeof a === 'string' && a.trim()),
          year,
          lang: str(tags.lang),
          ref: compact({ venue: venueName ?? undefined, venueId, venueRef: str(tags.venue_ref) ?? undefined }),
          doi: str(tags.doi),
          arxivId: str(tags.arxiv),
          publication: compact({ status: mapPubStatus(pubStatus), source: str(tags.pub_source) ?? undefined, checkedAt: pubChecked }),
          tags: tagIds,
          ai: compact({
            summary: summary ? legacyAi(summary, nowIso) : undefined,
            keywords: keywords.length ? legacyAi(keywords, nowIso) : undefined,
          }),
          addedAt: toIso(rec.first) ?? nowIso,
          updatedAt: nowIso,
          legacy: compact({
            index: compact(rest(rec as Json, ['tags', 'xt'])),
            tags: compact({
              ...rest(tags as Json, ['title', 'authors', 'type', 'macro', 'micro', 'extra', 'keywords', 'year', 'lang', 'summary', 'venue', 'venue_ref', 'doi', 'arxiv', 'pub_source']),
              pub_checked: pubChecked ? undefined : tags.pub_checked,
              year: year === null ? tags.year : undefined,
              xt,
            }),
          }),
        });
        tagTotal += doc.tags.length;
        if (cand.missing) missingCount++;
        if (cand.hashUnknown) doc.legacy = { ...(doc.legacy ?? {}), hashUnknown: true };
        byId.set(id, doc);
        order.push(id);
      }
      if (nonDerivable > 0) warn(`${nonDerivable} document(s) had implied tags that the implications do not reproduce; kept under legacy.tags`);
      progress('documents', records.length, records.length);
      checkAbort();

      /* ---------------------------- writing ---------------------------- */
      progress('finalizing', 0, order.length + 1);
      await store.writeTaxonomy(
        taxonomyFileSchema.parse({
          schemaVersion: SCHEMA_VERSION,
          revision: existingTax.revision,
          nodes: tb.nodes,
          documentTypes: tb.types,
          venues: tb.venues,
          legacy: existingTax.legacy ?? compact({ source: 'phd_index', version: legacyTax.version, settings: legacyTax.settings, imports_done: legacyTax.imports_done }),
        }),
      );
      // Recount tag totals now that unresolved tags may have grown the node list.
      for (const [n, id] of order.entries()) {
        await store.documents.put(byId.get(id) as DocumentRecord);
        if (n % 5 === 0) progress('finalizing', n, order.length + 1);
      }

      await applyScanSettings(store, legacyTax);

      const byLevelSource = new Map(tb.nodes.map((n) => [n.id, n] as const));
      const nodesByLevel: Record<string, number> = {};
      for (const n of tb.created.nodes) {
        const lvl = String(levelOf(n.id, byLevelSource));
        nodesByLevel[lvl] = (nodesByLevel[lvl] ?? 0) + 1;
      }

      const report: ImportReport = {
        documents: order.length,
        taxonomyNodes: tb.created.nodes.length,
        skipped,
        tags: tagTotal,
        nodesByLevel,
        venues: tb.created.venues.length,
        documentTypes: tb.created.types.length,
        missing: missingCount,
        duplicates,
        warnings: warningCount > warnings.length ? [...warnings, `...and ${warningCount - warnings.length} more warnings`] : warnings,
      };
      await store.appendLog({
        type: 'change',
        at: nowIso,
        deviceId,
        actor: 'import',
        target: { kind: 'document' },
        action: 'import.legacy',
        before: null,
        after: { documentIds: order, counts: { ...report, warnings: undefined } },
      });
      progress('finalizing', order.length + 1, order.length + 1);
      log.info('legacy import done', { documents: report.documents, nodes: report.taxonomyNodes, skipped });
      return report;
    },
  };
}

function legacyAi<T>(value: T, date: string): AiField<T> {
  return {
    value,
    // The old index was filled in by an AI assistant; model and exact provider were not recorded.
    meta: { model: 'unknown', provider: 'claude-agent-sdk', date, source: 'legacy-import' },
    review: { status: 'accepted', at: date },
  };
}

/** Hash and stat of one indexed file (read-only). Null when the file is present but unreadable. */
async function describeFile(libraryRoot: string, relPath: string, rec: LegacyFileRecord, warn: (m: string) => void): Promise<Candidate | null> {
  let abs: string;
  try {
    abs = await resolveInRoot(libraryRoot, relPath);
  } catch {
    warn(`"${relPath}" skipped: outside the library root`);
    return null;
  }
  const legacyMtime = typeof rec.mt === 'number' ? rec.mt : Date.parse(String(rec.mt ?? ''));
  const oldHash = typeof rec.h === 'string' && sha256Schema.safeParse(rec.h.toLowerCase()).success ? rec.h.toLowerCase() : null;
  const st = await stat(abs).catch(() => null);
  if (st?.isFile()) {
    try {
      const hash = await sha256File(abs);
      return { rec, relPath, hash, hashUnknown: false, missing: false, size: st.size, mtimeMs: st.mtimeMs };
    } catch (e) {
      warn(`"${relPath}" skipped: cannot read the file (${AppError.from(e).code})`);
      return null;
    }
  }
  if (st) {
    warn(`"${relPath}" skipped: not a regular file`);
    return null;
  }
  // The file no longer exists: keep the record, flagged as missing.
  warn(`"${relPath}" is in the old index but no longer on disk; imported as missing`);
  return {
    rec,
    relPath,
    hash: oldHash ?? sha256Of(`legacy-missing:${relPath}`),
    hashUnknown: oldHash === null,
    missing: true,
    size: typeof rec.sz === 'number' ? rec.sz : 0,
    mtimeMs: Number.isFinite(legacyMtime) ? legacyMtime : 0,
  };
}

/** Carries the old scan settings into library.json, only while the scan config is still untouched. */
async function applyScanSettings(store: ReturnType<typeof createLibraryStore>, tax: LegacyTaxonomy): Promise<void> {
  const s = tax.settings;
  if (!s) return;
  const config = await store.readConfig();
  const pristine = JSON.stringify(config.scan) === JSON.stringify(scanConfigSchema.parse({}));
  if (!pristine) return;
  const clean = (xs: string[] | undefined) => (xs ?? []).map((x) => x.replace(/^\./, '').toLowerCase()).filter(Boolean);
  const scan = scanConfigSchema.parse({
    ...(clean(s.extensions).length ? { extensions: clean(s.extensions) } : {}),
    ...(s.name_only_extensions ? { nameOnlyExtensions: clean(s.name_only_extensions) } : {}),
    ...(typeof s.prune_deleted_days === 'number' && s.prune_deleted_days >= 0 ? { pruneDeletedDays: Math.round(s.prune_deleted_days) } : {}),
  });
  await store.writeConfig(libraryConfigSchema.parse({ ...config, scan }));
}
