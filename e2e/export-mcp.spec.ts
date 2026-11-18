import { openAdvancedGroup } from './helpers/settings';
import { mkdtemp, readFile, readdir, rm, stat, writeFile, appendFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { launchApp, type LaunchedApp } from './helpers/launch';
import { asArray, createLibraryViaWizard, idOf, ipcData, pathOf, searchHits, waitForScan } from './helpers/phase1';
import { clickRow } from './helpers/ui';

/**
 * Phase 7 criterion, through the interface, on the synthetic libraries (never a real one).
 *
 * 1. Export a project as a second brain from the project page: the folder has `CLAUDE.md`, `INDEX.md` and one card per
 *    paper; every relative link and every `[[citekey]]` resolves on disk, so the folder answers simple control questions
 *    (which library paper does A cite? who cites B?) by following links. A second export (found in the list of earlier
 *    exports, "update in place") keeps a section edited by hand, the text written outside the markers and `notes/`.
 * 2. Enable the MCP server in Settings, take the configuration from the clipboard of the Electron app and over HTTP call
 *    `initialize`, `tools/list`, `search_library`, `get_document` and `similar_documents` with the token: a document in a
 *    folder that is not enabled for AI never appears; a wrong token is refused; a rotated token replaces the old one.
 *
 * Run it alone, after `npm run build` (it launches the built app). The export goes to a temporary folder OUTSIDE the
 * library root (D-252: an export destination inside the library is refused): the folder dialog override returns the
 * library root for the library wizard and `RL_E2E_EXPORT_DIALOG_PATH` for the export destination only. The library
 * must stay exactly as it was, and a destination inside it must be refused.
 */

const OA = 'https://api.openalex.org';
const LINK = 'id,doi,title,publication_year,authorships,primary_location';
const EXPORT_DIR = 'second-brain-e2e';

const work = (id: string, doi: string, title: string, extra: Record<string, unknown> = {}) => ({
  id: `https://openalex.org/${id}`,
  doi: `https://doi.org/${doi}`,
  title,
  publication_year: 2024,
  authorships: [{ author: { display_name: 'Ada Example' } }],
  primary_location: { source: { display_name: 'Synthetic Venue' } },
  ...extra,
});

// ---- disk helpers (the exported folder is plain Markdown) ----

const exists = (p: string) => stat(p).then(() => true, () => false);

async function walk(dir: string, base = dir): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(full, base)));
    else out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out.sort();
}

/** The lines of a `## <heading>` section of a card (up to the next heading or marker line); the heading depends on the library language (en, it). */
const CITES = ['Cites', 'Cita'];
const CITED_BY = ['Cited by', 'Citato da'];
function section(text: string, headings: string[]): string[] {
  const lines = text.split('\n');
  const at = lines.findIndex((l) => headings.some((h) => l.trim() === `## ${h}`));
  if (at < 0) return [];
  const out: string[] = [];
  for (const l of lines.slice(at + 1)) {
    if (l.startsWith('## ') || l.startsWith('<!--')) break;
    if (l.trim()) out.push(l);
  }
  return out;
}

const citekeysIn = (lines: string[]) => lines.flatMap((l) => [...l.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => m[1]!));

/** Every relative Markdown link and every `[[citekey]]` of every file must name a file that exists. */
async function brokenLinks(dir: string): Promise<string[]> {
  const broken: string[] = [];
  for (const rel of (await walk(dir)).filter((f) => f.endsWith('.md'))) {
    const text = await readFile(path.join(dir, rel), 'utf8');
    for (const m of text.matchAll(/\]\(([^)#\s]+\.md)(?:#[^)]*)?\)/g)) {
      const target = m[1]!;
      if (/^[a-z]+:/i.test(target)) continue;
      if (!(await exists(path.resolve(dir, path.dirname(rel), target)))) broken.push(`${rel} -> ${target}`);
    }
    for (const m of text.matchAll(/\[\[([A-Za-z0-9_-]+)\]\]/g)) {
      if (rel === 'CLAUDE.md' || rel.startsWith('.claude/')) continue; // the guide names `[[citekey]]` as a placeholder
      if (!(await exists(path.join(dir, 'papers', `${m[1]}.md`)))) broken.push(`${rel} -> [[${m[1]}]]`);
    }
  }
  return broken;
}

// ---- 1. export ----

test('export a project as a second brain, answer control questions from the folder, re-export keeping hand edits (phase 7)', async () => {
  test.setTimeout(300_000);
  let ctx: LaunchedApp | undefined;
  const dir = await mkdtemp(path.join(os.tmpdir(), 'rl-net-'));
  const fixtures = path.join(dir, 'net.json');
  await writeFile(fixtures, '{}');
  const exportRoot = await mkdtemp(path.join(os.tmpdir(), 'rl-brain-'));
  try {
    ctx = await launchApp({ library: 'papers', dialogPath: true, env: { RL_E2E_NET_FIXTURES: fixtures, RL_E2E_EXPORT_DIALOG_PATH: exportRoot } });
    const { window } = ctx;
    const root = ctx.library!.root;
    const papers = ctx.library!.manifest!.files.filter((f) => f.format === 'pdf' && f.title && f.doi);
    test.skip(papers.length < 3, 'needs three titled PDFs with a DOI');
    const [a, b] = papers as [(typeof papers)[0], (typeof papers)[0]];

    // The citation data: A cites B (in the library) and two works that are not.
    await writeFile(
      fixtures,
      JSON.stringify({
        [`${OA}/works/doi:${a.doi}`]: work('W101', a.doi!, a.title!, { referenced_works: ['https://openalex.org/W102', 'https://openalex.org/W900', 'https://openalex.org/W901'], cited_by_count: 0 }),
        [`${OA}/works/doi:${b.doi}`]: work('W102', b.doi!, b.title!, { referenced_works: ['https://openalex.org/W900'], cited_by_count: 1 }),
        [`${OA}/works?filter=openalex_id:W102|W900|W901&per-page=50&select=${LINK}`]: {
          results: [work('W102', b.doi!, b.title!), work('W900', '10.9999/rl-e2e.missing.900', 'Missing Foundations of Synthetic Testing'), work('W901', '10.9999/rl-e2e.other.901', 'Another Missing Work')],
        },
        [`${OA}/works?filter=openalex_id:W900&per-page=50&select=${LINK}`]: { results: [work('W900', '10.9999/rl-e2e.missing.900', 'Missing Foundations of Synthetic Testing')] },
        [`${OA}/works`]: { results: [], meta: { next_cursor: null } },
      }),
    );

    await createLibraryViaWizard(window, { name: 'Export library' });
    await waitForScan(window, ctx.library!.manifest!.files.length);
    await expect(window.getByTestId('scan-status')).toHaveAttribute('data-state', 'done', { timeout: 180_000 });
    const idFor = async (title: string) => idOf((await searchHits(window, `"${title}"`))[0])!;
    const [idA, idB] = [await idFor(a.title!), await idFor(b.title!)];
    await ipcData(window, 'citations:refresh', { docId: idA });
    await ipcData(window, 'citations:refresh', { docId: idB });

    // A project of A and B, made from the library selection.
    await window.getByTestId('search-sort').selectOption('title');
    await clickRow(window, a.title!);
    await clickRow(window, b.title!, ['Control']);
    await expect(window.getByTestId('selection-count')).toHaveText(/2 selected/);
    await window.getByTestId('add-to-project-button').click();
    await window.getByTestId('new-project-name').fill('Export project');
    await window.getByTestId('create-project-with-selection').click();
    await expect(window.getByTestId('toasts')).toContainText('Export project');

    // The entry point on the project page; the dialog starts from the project and estimates before running.
    await window.getByTestId('nav-projects').click();
    await window.getByTestId('project-open').click();
    await window.getByTestId('project-export').click();
    const dialog = window.getByTestId('export-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId('export-project')).not.toHaveValue('');
    await expect(dialog.getByTestId('est-documents')).toHaveText('2', { timeout: 30_000 });
    await expect(dialog.getByTestId('export-run')).toBeDisabled(); // no destination yet

    await dialog.getByTestId('export-folder-name').fill(EXPORT_DIR);
    // The destination only through the folder dialog (the test override returns the temporary folder); a sanitized name.
    await dialog.getByTestId('export-choose').click();
    await expect(dialog.getByTestId('export-dest-path')).toBeVisible();
    await dialog.getByTestId('export-folder-name').fill(EXPORT_DIR);
    await expect(dialog.getByTestId('export-target-note')).toHaveAttribute('data-state', 'new', { timeout: 30_000 });
    await dialog.getByTestId('export-run').click();
    // The papers are in folders not enabled for AI: the export asks before writing them (D-241).
    await dialog.getByTestId('export-confirm-yes').click();
    const result = dialog.getByTestId('export-result');
    await expect(result).toHaveAttribute('data-state', 'done', { timeout: 120_000 });
    const written = Number(await dialog.getByTestId('res-written').textContent());
    expect(written).toBeGreaterThan(4);
    await dialog.getByTestId('export-close').click();
    await expect(dialog).toHaveCount(0);

    // ---- on disk ----
    const out = path.join(exportRoot, EXPORT_DIR);
    expect(await exists(path.join(root, EXPORT_DIR))).toBe(false);
    const files = await walk(out);
    for (const f of ['CLAUDE.md', 'INDEX.md', 'graph.json']) expect(files, f).toContain(f);
    expect(files.some((f) => f.startsWith('.claude/commands/'))).toBe(true);
    JSON.parse(await readFile(path.join(out, 'graph.json'), 'utf8'));
    const cards = files.filter((f) => /^papers\/[^/]+\.md$/.test(f));
    expect(cards).toHaveLength(2);
    expect(await brokenLinks(out)).toEqual([]);

    const cardTexts = new Map<string, string>();
    for (const c of cards) cardTexts.set(path.basename(c, '.md'), await readFile(path.join(out, c), 'utf8'));
    const keyOf = (title: string) => [...cardTexts].find(([, t]) => t.includes(`# ${title}`))?.[0];
    const keyA = keyOf(a.title!);
    const keyB = keyOf(b.title!);
    expect(keyA && keyB && keyA !== keyB).toBeTruthy();

    // Control question 1: which paper of the library does A cite? Follow the link from A's card.
    const cites = citekeysIn(section(cardTexts.get(keyA!)!, CITES));
    expect(cites).toEqual([keyB]);
    const followed = await readFile(path.join(out, 'papers', `${cites[0]}.md`), 'utf8');
    expect(followed).toContain(`# ${b.title}`);
    expect(followed).toContain(`doi: `);
    // The works that are not in the library are listed as such, without a link.
    expect(section(cardTexts.get(keyA!)!, CITES).filter((l) => /not in the library|non in libreria/.test(l))).toHaveLength(2);
    // Control question 2: who cites B? The link goes back to A.
    expect(citekeysIn(section(cardTexts.get(keyB!)!, CITED_BY))).toEqual([keyA]);
    // The index lists both papers and the guide tells where to start.
    const index = await readFile(path.join(out, 'INDEX.md'), 'utf8');
    expect(index).toContain(`[[${keyA}]]`);
    expect(index).toContain(`[[${keyB}]]`);
    expect(await readFile(path.join(out, 'CLAUDE.md'), 'utf8')).toContain('INDEX.md');

    // ---- by hand, then a second export ----
    const cardA = path.join(out, 'papers', `${keyA}.md`);
    const cardB = path.join(out, 'papers', `${keyB}.md`);
    const edited = (await readFile(cardA, 'utf8')).replace(`# ${a.title}`, `# ${a.title}\n\nHAND EDIT INSIDE THE GENERATED SECTION`);
    expect(edited).toContain('HAND EDIT INSIDE');
    await writeFile(cardA, edited);
    await appendFile(cardB, '\nMY OWN NOTE OUTSIDE THE MARKERS\n');
    await mkdir(path.join(out, 'notes'), { recursive: true });
    await writeFile(path.join(out, 'notes', 'mine.md'), 'free note, never touched\n');
    const before = await walk(out);

    // The earlier export is easy to find: it is listed at the top of the dialog and updates in place.
    await window.getByTestId('project-export').click();
    await expect(dialog).toBeVisible();
    const past = dialog.getByTestId('export-past-item');
    await expect(past).toHaveCount(1);
    await expect(past).toContainText(EXPORT_DIR);
    await past.click();
    await expect(dialog.getByTestId('export-target-note')).toHaveAttribute('data-state', 'previous-export', { timeout: 30_000 });
    await expect(dialog.getByTestId('export-target-note')).toContainText('1 file has a generated section you edited by hand');
    await expect(dialog.getByTestId('export-run')).toHaveText('Update the export');
    await dialog.getByTestId('export-run').click();
    // The papers are in folders not enabled for AI: the export asks before writing them (D-241).
    await dialog.getByTestId('export-confirm-yes').click();
    await expect(dialog.getByTestId('export-result')).toHaveAttribute('data-state', 'done', { timeout: 120_000 });
    await expect(dialog.getByTestId('res-kept')).toHaveText('1');
    await expect(dialog.getByTestId('res-kept-list')).toContainText(`papers/${keyA}.md`);
    expect(Number(await dialog.getByTestId('res-unchanged').textContent())).toBeGreaterThan(0);
    await dialog.getByTestId('export-close').click();

    expect(await readFile(cardA, 'utf8')).toContain('HAND EDIT INSIDE THE GENERATED SECTION');
    expect(await readFile(cardB, 'utf8')).toContain('MY OWN NOTE OUTSIDE THE MARKERS');
    expect(await readFile(path.join(out, 'notes', 'mine.md'), 'utf8')).toBe('free note, never touched\n');
    expect(await walk(out)).toEqual(before); // the same citekeys and files: stable names
    expect(await brokenLinks(out)).toEqual([]);

    await ctx.verifyLibraryUntouched();
  } finally {
    await ctx?.close();
    await rm(dir, { recursive: true, force: true }).catch(() => {});
    await rm(exportRoot, { recursive: true, force: true }).catch(() => {});
  }
});

// ---- 2. MCP server ----

interface Reply {
  status: number;
  json: any;
}

/** One JSON-RPC POST to the server (Streamable HTTP; a server-sent-event answer is read as well). */
async function post(url: string, body: unknown, headers: Record<string, string>): Promise<Reply> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers }, body: JSON.stringify(body) });
  const text = await res.text();
  let json: any = null;
  if (text) {
    const data = res.headers.get('content-type')?.includes('text/event-stream') ? (text.split('\n').find((l) => l.startsWith('data:')) ?? '').slice(5) : text;
    try {
      json = JSON.parse(data);
    } catch {
      json = null;
    }
  }
  return { status: res.status, json };
}

let rpcId = 0;
const rpc = (url: string, token: string | null, method: string, params?: unknown) => post(url, { jsonrpc: '2.0', id: ++rpcId, method, params }, token ? { Authorization: `Bearer ${token}` } : {});
async function tool(url: string, token: string, name: string, args: unknown) {
  const r = await rpc(url, token, 'tools/call', { name, arguments: args });
  expect(r.status).toBe(200);
  if (r.json.error) return { rpcError: r.json.error as { message: string } };
  return { isError: r.json.result.isError === true, body: JSON.parse(r.json.result.content[0].text as string) as any };
}

/** What Claude Code would get: the configuration line the main process put on the clipboard of the app. */
async function clipboardConfig(ctx: LaunchedApp): Promise<{ url: string; token: string; text: string }> {
  const text = await ctx.app.evaluate(({ clipboard }) => clipboard.readText());
  const url = /http:\/\/127\.0\.0\.1:\d+\/mcp/.exec(text)?.[0];
  const token = /Bearer ([A-Za-z0-9._~+/=-]+)/.exec(text)?.[1];
  expect(url, 'the clipboard holds a server address').toBeTruthy();
  expect(token, 'the clipboard holds the token').toBeTruthy();
  return { url: url!, token: token!, text };
}

async function docIds(window: Page): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const it of asArray(await ipcData(window, 'documents:list', { limit: 200 }))) {
    const p = pathOf(it);
    const id = idOf(it);
    if (p && id) out.set(p, id);
  }
  return out;
}

test('MCP server from the settings: configuration from the clipboard, tools over HTTP, folders not enabled for AI never appear (phase 7)', async () => {
  test.setTimeout(300_000);
  let ctx: LaunchedApp | undefined;
  try {
    ctx = await launchApp({ library: 'full', dialogPath: true, offline: true });
    const { window } = ctx;
    const manifest = ctx.library!.manifest!;
    const allowedRel = 'papers/paper-04.pdf';
    const closedRel = 'Area A/Subtopic 2/another-nested.pdf';
    const allowedFile = manifest.get(allowedRel);
    const closedFile = manifest.get(closedRel);
    expect(allowedFile && closedFile).toBeTruthy();

    await createLibraryViaWizard(window, { name: 'MCP library' });
    await waitForScan(window, manifest.files.length);
    await expect(window.getByTestId('scan-status')).toHaveAttribute('data-state', 'done', { timeout: 180_000 });
    const ids = await docIds(window);
    const allowed = ids.get(allowedRel)!;
    const closed = ids.get(closedRel)!;
    expect(allowed && closed).toBeTruthy();
    // Only `papers` is enabled for AI; the other folder holds a document with the same title.
    await ipcData(window, 'library:setConfig', { patch: { aiEnabledFolders: ['papers'] } });
    // The settings read the library configuration when the app state loads: reload so that "mcp-sees" shows the new value.
    await window.reload();
    await window.getByTestId('nav-settings').waitFor({ timeout: 60_000 });
    const query = allowedFile!.title!;

    // Settings: off by default, then enabled through the interface.
    await openAdvancedGroup(window, 'mcp');
    const section = window.getByTestId('mcp-settings');
    await expect(section).toBeVisible();
    await expect(section.getByTestId('mcp-state')).toHaveText('Off');
    await expect(section.getByTestId('mcp-sees')).toContainText('1 folder enabled for AI');
    await expect(section.getByTestId('mcp-copy-cli')).toBeDisabled();
    // A controlled checkbox: it changes once the main answers, so click and then wait for the state.
    await section.getByTestId('mcp-enable').click();
    await expect(section.getByTestId('mcp-state')).toHaveText('Running', { timeout: 30_000 });
    await expect(section.getByTestId('mcp-url')).toContainText('http://127.0.0.1:');

    // "Copy for Claude Code": the window shows only the masked preview, the clipboard of the app holds the real line.
    await section.getByTestId('mcp-copy-cli').click();
    await expect(section.getByTestId('mcp-copied')).toBeVisible();
    const { url, token, text } = await clipboardConfig(ctx);
    expect(text).toContain('claude mcp add --transport http');
    const preview = (await section.getByTestId('mcp-preview').textContent()) ?? '';
    expect(preview).not.toContain(token);
    expect(await window.locator('body').innerText()).not.toContain(token);
    await section.getByTestId('mcp-copy-json').click();
    const json = JSON.parse((await clipboardConfig(ctx)).text) as { mcpServers: Record<string, { url: string; headers: { Authorization: string } }> };
    expect(Object.values(json.mcpServers)[0]).toMatchObject({ url, headers: { Authorization: `Bearer ${token}` } });

    // Over HTTP with the token.
    const init = await rpc(url, token, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '0' } });
    expect(init.status).toBe(200);
    expect(init.json.result.serverInfo.name).toContain('research-lab');
    const list = await rpc(url, token, 'tools/list');
    const names = list.json.result.tools.map((t: { name: string }) => t.name) as string[];
    expect(names).toEqual(expect.arrayContaining(['search_library', 'get_document', 'similar_documents']));
    expect(names).not.toContain('write_ai_field');

    const found = await tool(url, token, 'search_library', { query });
    const foundIds = (found.body.items as Array<{ id: string }>).map((i) => i.id);
    expect(foundIds).toContain(allowed);
    expect(foundIds).not.toContain(closed);
    const card = await tool(url, token, 'get_document', { docId: allowed });
    expect(card).toMatchObject({ isError: false, body: { id: allowed } });
    const refused = await tool(url, token, 'get_document', { docId: closed });
    // Outside the enabled folders a document does not exist for the client: the same answer as for an unknown id (D-253).
    expect(refused).toMatchObject({ isError: true, body: { code: 'NOT_FOUND' } });
    const near = await tool(url, token, 'similar_documents', { docId: allowed, limit: 10 });
    expect(near.isError).toBe(false);
    expect(JSON.stringify(near.body)).not.toContain(closed);
    expect((await tool(url, token, 'similar_documents', { docId: closed })).body.code).toBe('NOT_FOUND');

    // A wrong or missing token is refused.
    expect((await rpc(url, 'not-the-token-value', 'tools/list')).status).toBe(401);
    expect((await rpc(url, null, 'tools/list')).status).toBe(401);

    // The call log in the settings follows live, with tools and outcomes but no content.
    await section.getByTestId('mcp-log').locator('summary').click();
    const rows = section.getByTestId('mcp-log-row');
    await expect.poll(() => rows.count(), { timeout: 30_000 }).toBeGreaterThan(3);
    await expect(section.getByTestId('mcp-log')).toContainText('get_document');
    await expect(section.getByTestId('mcp-log')).toContainText(/NOT_FOUND|FOLDER_NOT_AI_ENABLED/);
    expect(await section.getByTestId('mcp-log').innerText()).not.toContain(query);

    // Writing: only proposals, after an explicit confirmation; the tool list then has it.
    await expect(section.getByTestId('mcp-write-warning')).toContainText('PROPOSE');
    await section.getByTestId('mcp-write').click();
    await section.getByTestId('mcp-write-yes').click();
    await expect.poll(async () => ((await rpc(url, token, 'tools/list')).json.result.tools as Array<{ name: string }>).map((t) => t.name)).toContain('write_ai_field');
    await section.getByTestId('mcp-write').click();
    await expect.poll(async () => ((await rpc(url, token, 'tools/list')).json.result.tools as Array<{ name: string }>).map((t) => t.name)).not.toContain('write_ai_field');

    // Rotating the token (after confirmation) replaces the old one at once.
    await section.getByTestId('mcp-rotate').click();
    await section.getByTestId('mcp-rotate-yes').click();
    await expect(section.getByTestId('mcp-rotated')).toBeVisible();
    expect((await rpc(url, token, 'tools/list')).status).toBe(401);
    await section.getByTestId('mcp-copy-cli').click();
    const fresh = await clipboardConfig(ctx);
    expect(fresh.token).not.toBe(token);
    expect((await rpc(fresh.url, fresh.token, 'tools/list')).status).toBe(200);

    // Off again: the server stops.
    await section.getByTestId('mcp-enable').click();
    await expect(section.getByTestId('mcp-state')).toHaveText('Off');
    await expect(fetch(fresh.url, { method: 'POST' })).rejects.toThrow();

    await ctx.verifyLibraryUntouched();
  } finally {
    await ctx?.close();
  }
});
