// check:nondestructive - proves that nothing outside the excluded folders changed.
//
//   node tools/check-nondestructive.mjs <root> [--exclude <path>]... --snapshot <file> --save
//   node tools/check-nondestructive.mjs <root> [--exclude <path>]... --snapshot <file>       (compare)
//   node tools/check-nondestructive.mjs <root> [--exclude <path>]... --run "<command>"        (save, run, compare)
//
// --exclude paths are relative to <root> (typically .lab and the export folders). Exit code 1 when a
// file was added, removed or modified; mtime-only changes are listed as warnings.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { diffSnapshots, formatDiff, loadSnapshot, saveSnapshot, snapshotTree } from '../packages/testkit/src/snapshot.ts';

const args = process.argv.slice(2);
const positional = [];
const exclude = [];
let snapshotFile;
let save = false;
let runCmd;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--exclude') exclude.push(args[++i] ?? '');
  else if (a === '--snapshot') snapshotFile = args[++i];
  else if (a === '--save') save = true;
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

const diff = diffSnapshots(base, await snapshotTree(absRoot, { exclude }));
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
