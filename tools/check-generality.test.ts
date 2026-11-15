import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { scanGenerality, scanText } from './lib/generality.mjs';

// Every forbidden string is assembled at runtime so this file itself stays clean.
const sep = String.fromCharCode(92);
const winUser = (name: string, s = sep) => `C:${s}${'Us' + 'ers'}${s}${name}${s}Documents`;
const nixUser = (root: string, name: string) => `/${root}/${name}/notes`;
const sync = (word: string) => `${word}`;
const ONE = 'One' + 'Drive';
const DROP = 'Drop' + 'box';
const GDRIVE = 'Google ' + 'Drive';
const ICLOUD = 'iCloud ' + 'Drive';
const mail = (local: string, domain: string) => `${local}@${domain}`;
const LOCAL_TOKEN = 'zq' + 'x' + Math.random().toString(36).slice(2, 10);

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

function makeTree(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'rl-gen-'));
  dirs.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return root;
}

describe('scanText rules', () => {
  it('flags absolute user paths in every spelling', () => {
    const spellings = [
      winUser('someone'),
      winUser('someone', '/'),
      winUser('someone', sep + sep),
      nixUser('Us' + 'ers', 'someone'),
      nixUser('ho' + 'me', 'someone'),
      'file:///' + winUser('someone', '/'),
    ];
    for (const s of spellings) expect(scanText(`const p = "${s}";`).map((f) => f.rule), s).toContain('user-path');
  });

  it('accepts placeholders in paths', () => {
    for (const s of ['<user>', '%USERNAME%', '$USER', '{name}', 'user', 'x']) {
      expect(scanText(winUser(s)), s).toEqual([]);
    }
  });

  it('flags sync-service folders', () => {
    for (const w of [ONE, DROP, GDRIVE, ICLOUD, ONE.toLowerCase()]) {
      expect(scanText(`see ${sync(w)} here`).map((f) => f.rule), w).toContain('sync-folder');
    }
  });

  it('flags real e-mails and allows reserved domains', () => {
    expect(scanText(mail('a.b', 'gmail.com')).map((f) => f.rule)).toContain('email');
    expect(scanText(mail('a', 'uni.edu')).map((f) => f.rule)).toContain('email');
    for (const d of ['example.com', 'sub.example.org', 'example.net', 'localhost', 'box.local', 'x.test']) {
      expect(scanText(mail('someone', d)), d).toEqual([]);
    }
    expect(scanText('noreply' + '@anthropic.com')).toEqual([]);
    // package specs and url userinfo are not addresses
    expect(scanText('"electron@45.3.2" "@types/node@26.6.6" https://user:pw@host.org/x')).toEqual([]);
  });

  it('local patterns are case-insensitive and reported by index only', () => {
    const f = scanText(`value ${LOCAL_TOKEN.toUpperCase()}`, ['other', LOCAL_TOKEN]);
    expect(f).toEqual([{ line: 1, rule: 'local-pattern:1', allowed: false }]);
  });

  it('honours an explicit exception comment only when it has a reason', () => {
    expect(scanText(`${mail('a', 'gmail.com')} // generality-allow: documented sample`)[0]?.allowed).toBe(true);
    expect(scanText(`${mail('a', 'gmail.com')} // generality-allow:`)[0]?.allowed).toBe(false);
  });
});

describe('scanGenerality on a synthetic tree', () => {
  const files = {
    'packages/a/src/bad-path.ts': `// ok\nconst p = ${JSON.stringify(winUser('someone', sep))};\n`,
    'apps/b/src/bad-sync.ts': `x\ny\n// ${ONE}\n`,
    'e2e/bad-mail.ts': `const m = '${mail('person', 'gmail.com')}';\n`,
    'tools/bad-local.ts': `const s = '${LOCAL_TOKEN}';\n`,
    [`packages/a/src/${LOCAL_TOKEN}-named.ts`]: 'export {};\n',
    'packages/a/src/allowed.ts': `const m = '${mail('person', 'gmail.com')}'; // generality-allow: sample for a parser test\n`,
    'packages/a/src/clean.ts': `const m = '${mail('person', 'example.com')}'; const p = ${JSON.stringify(winUser('<user>'))};\n`,
    'docs/notes.md': `${winUser('someone')} ${ONE}\n`,
    'package-lock.json': `{"x":"${ONE}"}\n`,
    'tools/generality.local.json': JSON.stringify({ patterns: [LOCAL_TOKEN] }),
    'root-file.txt': `${DROP}\n`,
    'packages/a/src/image.png': Buffer.from([0, 1, 2, 3]).toString('latin1'),
  };

  it('reports each violation with file and line, counts exceptions, skips docs and lockfiles', () => {
    const root = makeTree(files);
    const r = scanGenerality({ root });
    const got = r.violations.map((v) => `${v.file}:${v.line}:${v.rule.split(':')[0]}`).sort();
    expect(got).toEqual(
      [
        'packages/a/src/bad-path.ts:2:user-path',
        'apps/b/src/bad-sync.ts:3:sync-folder',
        'e2e/bad-mail.ts:1:email',
        'tools/bad-local.ts:1:local-pattern',
        'packages/a/src/***-named.ts:0:local-pattern',
        'root-file.txt:1:sync-folder',
      ].sort(),
    );
    expect(r.allowed.map((a) => `${a.file}:${a.line}`)).toEqual(['packages/a/src/allowed.ts:1']);
  });

  it('CLI exits non-zero, lists file:line and never prints the local pattern', () => {
    const root = makeTree(files);
    const run = spawnSync(process.execPath, [path.join(import.meta.dirname, 'check-generality.mjs'), '--root', root], { encoding: 'utf8' });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('packages/a/src/bad-path.ts:2');
    expect(run.stdout + run.stderr).not.toContain(LOCAL_TOKEN);
    expect(run.stdout).toContain('1 line(s) allowed');
  });

  it('CLI exits 0 on a clean tree', () => {
    const root = makeTree({ 'packages/a/src/ok.ts': 'export const a = 1;\n' });
    const run = spawnSync(process.execPath, [path.join(import.meta.dirname, 'check-generality.mjs'), '--root', root], { encoding: 'utf8' });
    expect(run.status).toBe(0);
  });
});

describe('real repository', () => {
  it('has no generality violations', () => {
    const r = scanGenerality({ root: path.resolve(import.meta.dirname, '..') });
    expect(r.violations.map((v) => `${v.file}:${v.line}:${v.rule}`)).toEqual([]);
    expect(r.scanned).toBeGreaterThan(10);
  });
});
