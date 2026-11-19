import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import type { LaunchedApp } from './helpers/launch';
import { ipcData } from './helpers/phase1';
import { openSyntheticLibrary } from './helpers/ui';

/**
 * Zotero and BibTeX (features 7 and 52), through the interface, on a synthetic library and synthetic files.
 *
 * 1. "+ Add > From Zotero or BibTeX…": a .bib file with one entry whose PDF is in the library, one without a file and one
 *    with a file that does not exist: the counts say so, the import fills the data and the tags, the originals are not
 *    touched, and "Undo the import" takes the tags away again.
 * 2. A project is linked to a .bib file in an export folder: the file starts with the generated-by line; after the file is
 *    edited by hand the app does not write over it (banner "changed outside the app") and "Unlink" removes the link.
 *
 * Run it alone, after `npm run build` (it launches the built app). The file and the export folder are temporary folders
 * outside the library root (`RL_E2E_BIB_DIALOG_PATH`, `RL_E2E_EXPORT_DIALOG_PATH`).
 */
test('import a BibTeX file and keep a project linked to a .bib file', async ({}, testInfo) => {
  test.setTimeout(300_000);
  let ctx: LaunchedApp | undefined;
  const work = await mkdtemp(path.join(os.tmpdir(), 'rl-bib-e2e-'));
  const bibPath = path.join(work, 'source.bib');
  const exportDir = path.join(work, 'exports');
  try {
    const opened = await openSyntheticLibrary(testInfo, 'papers', { RL_E2E_BIB_DIALOG_PATH: bibPath, RL_E2E_EXPORT_DIALOG_PATH: exportDir });
    ctx = opened.ctx;
    const { window } = opened;
    const lib = ctx.library!;
    const files = lib.manifest!.files.filter((f) => f.relPath.toLowerCase().endsWith('.pdf'));
    const first = files[0]!;
    const second = files[1]!;
    await writeFile(
      bibPath,
      [
        '@article{imported2024first,',
        '  title = {Imported Synthetic Title},',
        '  author = {Roe, Rick},',
        '  year = {2024},',
        '  keywords = {e2e-imported},',
        `  file = {Full text:${path.join(lib.root, first.relPath)}:application/pdf}`,
        '}',
        '@article{nofile2023entry, title = {An entry without any file}, author = {Doe, Jane}, year = {2023}}',
        `@article{gone2022entry, title = {An entry whose file is gone}, author = {Doe, Jane}, year = {2022}, file = {x:${path.join(work, 'missing.pdf')}:application/pdf}}`,
      ].join('\n'),
    );

    // 1. Import.
    await window.getByTestId('add-menu').click();
    await window.getByTestId('add-menu-zotero').click();
    await expect(window.getByTestId('import-dialog')).toBeVisible();
    await window.getByTestId('import-choose').click();
    await expect(window.getByTestId('import-counts')).toContainText('0 with a file to add · 2 without a file · 1 already in the library');
    await window.getByTestId('import-next').click();
    await expect(window.getByTestId('import-opt-tags')).toBeChecked();
    await window.getByTestId('import-run').click();
    await expect(window.getByTestId('import-result')).toContainText('Updated 1 documents');
    await expect(window.getByTestId('import-not-imported')).toContainText('An entry without any file');

    const docs = await ipcData<{ items: Array<{ docId: string; path: string }> }>(window, 'documents:list', { limit: 200 });
    const docId = docs.items.find((d) => d.path === first.relPath)!.docId;
    const view = await ipcData<{ citeKey?: string; tags: string[] }>(window, 'documents:get', { docId });
    expect(view.citeKey).toBe('imported2024first');
    expect(view.tags).toHaveLength(1);

    await window.getByTestId('import-undo').click();
    await expect(window.getByTestId('import-result')).toContainText('Import undone');
    expect((await ipcData<{ tags: string[] }>(window, 'documents:get', { docId })).tags).toEqual([]);
    await window.getByTestId('import-close').click();
    // Originals never moved, renamed or changed; nothing was added to the library folder.
    const diff = await lib.diff();
    expect(diff.clean).toBe(true);

    // 2. A project linked to a .bib file.
    const created = await ipcData<{ project: { id: string } }>(window, 'projects:create', { name: 'Linked project', docIds: [docId] });
    await window.getByTestId('nav-projects').click();
    await window.getByTestId('project-row').filter({ hasText: 'Linked project' }).getByTestId('project-open').click();
    await window.getByTestId('project-more').click();
    await window.getByTestId('project-link-bib').click();
    await window.getByTestId('link-bib-folder').click();
    await window.getByTestId('link-bib-name').fill('thesis.bib');
    await window.getByTestId('link-bib-run').click();
    await expect(window.getByTestId('link-bib-dialog')).toBeHidden();
    const linked = path.join(exportDir, 'thesis.bib');
    const text = await readFile(linked, 'utf8');
    expect(text.split('\n')[0]).toBe('% Generato da Research Lab: le modifiche qui verranno sovrascritte');
    expect(text).toContain('imported2024first');
    await expect(window.getByTestId('bib-banner')).toHaveCount(0);

    // Edited outside the app: the next change of the project does not write over it.
    const edited = `${text}\n@misc{byhand, title={Written by hand}}\n`;
    await writeFile(linked, edited);
    await ipcData(window, 'projects:addMembers', { projectId: created.project.id, docIds: [docs.items.find((d) => d.path === second.relPath)!.docId] });
    await expect(window.getByTestId('bib-banner')).toHaveAttribute('data-state', 'changed-outside');
    expect(await readFile(linked, 'utf8')).toBe(edited);
    await window.getByTestId('bib-unlink').click();
    await expect(window.getByTestId('bib-banner')).toHaveCount(0);
    expect(await readFile(linked, 'utf8')).toBe(edited);
  } finally {
    await ctx?.close();
    await rm(work, { recursive: true, force: true });
  }
});
