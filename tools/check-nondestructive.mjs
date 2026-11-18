// check:nondestructive - proves that nothing outside the excluded folders changed.
//
//   node tools/check-nondestructive.mjs <root> [--exclude <path>]... --snapshot <file> --save
//   node tools/check-nondestructive.mjs <root> [--exclude <path>]... --snapshot <file>       (compare)
//   node tools/check-nondestructive.mjs <root> [--exclude <path>]... --run "<command>"        (save, run, compare)
//   add --allow-pdf-append to accept PDF files that only GREW: the old bytes are an exact prefix of the new file and
//   the appended bytes carry an annotation of ours (/NM (rl-...)), the one write the app may do (D-316).
//
// --exclude paths are relative to <root> (typically .lab and the export folders). Exit code 1 when a
// file was added, removed or modified; mtime-only changes are listed as warnings.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open } from 'node:fs/promises';
import path from 'node:path';
import { diffSnapshots, formatDiff, loadSnapshot, saveSnapshot, snapshotTree } from '../packages/testkit/src/snapshot.ts';

const args = process.argv.slice(2);
const positional = [];
const exclude = [];
let snapshotFile;
let save = false;
let allowPdfAppend = false;
let runCmd;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--exclude') exclude.push(args[++i] ?? '');
  else if (a === '--snapshot') snapshotFile = args[++i];
  else if (a === '--save') save = true;
  else if (a === '--allow-pdf-append') allowPdfAppend = true;
  else if (a === '--run') runCmd = args[++i];
  else positional.push(a);
}
const root = positional[0];
if (!root || (!runCmd && !snapshotFile)) {
  console.error('usage: check-nondestructive <root> [--exclude <path>]... (--snapshot <file> [--save] | --run "<command>")');
  process.exit(2);
}
const absRoot = path.resolve(root);

let base;
if (runCmd) {
  base = await snapshotTree(absRoot, { exclude });
  const r = spawnSync(runCmd, { shell: true, stdio: 'inherit', cwd: process.cwd() });
  if (r.status !== 0) {
    console.error(`nondestructive: command exited with ${r.status}`);
    process.exitCode = 1;
  }
} else if (save) {
  const snap = await snapshotTree(absRoot, { exclude });
  await saveSnapshot(snapshotFile, snap);
  console.log(`nondestructive: snapshot saved (${Object.keys(snap).length} entries)`);
  process.exit(0);
} else {
  base = await loadSnapshot(snapshotFile);
}

const after = await snapshotTree(absRoot, { exclude });
const diff = diffSnapshots(base, after);

/** Did the PDF only grow, keeping every old byte, with an annotation of ours in the added bytes? */
async function onlyAppended(rel) {
  const before = base[rel];
  const now = after[rel];
  if (!/\.pdf$/i.test(rel) || before?.type !== 'file' || now?.type !== 'file' || now.size <= before.size) return false;
  const file = path.join(absRoot, rel);
  const h = createHash('sha256');
  for await (const c of createReadStream(file, { start: 0, end: before.size - 1 })) h.update(c);
  if (h.digest('hex') !== before.sha256) return false;
  const fh = await open(file, 'r');
  try {
    const tail = Buffer.alloc(now.size - before.size);
    await fh.read(tail, 0, tail.length, before.size);
    return tail.includes('/NM (rl-');
  } finally {
    await fh.close();
  }
}
if (allowPdfAppend) {
  const kept = [];
  for (const rel of diff.modified) if (!(await onlyAppended(rel))) kept.push(rel);
  const allowed = diff.modified.length - kept.length;
  if (allowed > 0) console.log(`nondestructive: ${allowed} PDF file(s) grew by an append of ours (prefix identical)`);
  diff.modified = kept;
  diff.clean = diff.added.length === 0 && diff.removed.length === 0 && kept.length === 0;
}
if (diff.touched.length > 0) {
  console.warn(`nondestructive: warning, ${diff.touched.length} file(s) rewritten with identical content:\n${diff.touched.map((p) => '  touched: ' + p).join('\n')}`);
}
if (!diff.clean) {
  console.error('nondestructive: FILES CHANGED OUTSIDE THE EXCLUDED FOLDERS');
  console.error(formatDiff({ ...diff, touched: [] }));
  process.exitCode = 1;
} else if (!process.exitCode) {
  console.log(`nondestructive: OK (${Object.keys(base).length} entries unchanged)`);
}
