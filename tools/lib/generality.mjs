// Generality scanner (PLAN section 7). Looks for personal paths, sync-service folders, real e-mail
// addresses and (optionally) a git-ignored list of locally forbidden substrings.
// Output never contains the matched text: only file, line and rule (local patterns: their index).
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

export const ALLOW_MARKER = 'generality-allow:';
const SCAN_DIRS = new Set(['apps', 'packages', 'e2e', 'tools']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'out', 'dist', 'release', 'coverage', 'test-results', 'playwright-report', 'docs']);
const SKIP_FILES = new Set(['package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'generality.local.json']);
const BINARY_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.icns', '.pdf', '.woff', '.woff2', '.ttf', '.otf', '.zip', '.gz', '.7z', '.exe', '.dll', '.node', '.db', '.sqlite']);

// Words are assembled from fragments so this file does not trip its own scan.
const SYNC_WORDS = [
  ['One', 'Drive'],
  ['Drop', 'box'],
  ['Google', '[\\s_-]?', 'Drive'],
  ['i', 'Cloud', '[\\s_-]?', 'Drive'],
  ['Mobile', '\\s', 'Documents'],
].map((parts) => parts.join(''));
const SYNC_RE = new RegExp(SYNC_WORDS.join('|'), 'i');
const USERS = 'Users';
const HOME = 'home';
const USER_PATH_RE = new RegExp(
  `(?:[A-Za-z]:[\\\\/]+${USERS}[\\\\/]+|(?<![A-Za-z0-9_.~-])/${USERS}/|(?<![A-Za-z0-9_.~-])/${HOME}/)` + '([^\\\\/\\s"\'`:*?<>|)\\]},;]+)',
  'g',
);
const EMAIL_RE = /[A-Za-z0-9._%+-]+@([A-Za-z][A-Za-z0-9-]*(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})/g;
const PLACEHOLDER_USERS = new Set(['user', 'username', 'yourname', 'you', 'me', 'runner', 'public', 'default', 'name']);

function isPlaceholderUser(name) {
  if (name.length <= 1) return true; // single-letter dummy names such as x
  if (/^[<{%$*]/.test(name) || /[>}%]$/.test(name)) return true;
  return PLACEHOLDER_USERS.has(name.toLowerCase());
}

function isAllowedEmail(email, domain) {
  const d = domain.toLowerCase();
  if (email.toLowerCase() === 'noreply@anthropic.com') return true;
  if (d === 'localhost' || d.endsWith('.local') || d.endsWith('.test')) return true;
  return ['example.com', 'example.org', 'example.net'].some((a) => d === a || d.endsWith('.' + a));
}

/** @returns {string[]} the local patterns, or [] when the file is missing or invalid. */
export function loadLocalPatterns(root) {
  const file = path.join(root, 'tools', 'generality.local.json');
  if (!existsSync(file)) return [];
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'));
    return Array.isArray(data.patterns) ? data.patterns.filter((p) => typeof p === 'string' && p.length > 0) : [];
  } catch {
    return [];
  }
}

/** Scans one text; rule ids: 'user-path' | 'sync-folder' | 'email' | 'local-pattern:<index>'. */
export function scanText(text, localPatterns = []) {
  const findings = [];
  const lowerLocal = localPatterns.map((p) => p.toLowerCase());
  text.split(/\r?\n/).forEach((line, i) => {
    const hits = new Set();
    for (const m of line.matchAll(USER_PATH_RE)) if (!isPlaceholderUser(m[1])) hits.add('user-path');
    if (SYNC_RE.test(line)) hits.add('sync-folder');
    for (const m of line.matchAll(EMAIL_RE)) {
      if (/:\/\/[^\s/@]+:$/.test(line.slice(0, m.index))) continue; // url userinfo (scheme://user:secret@host), not an address
      if (!isAllowedEmail(m[0], m[1])) hits.add('email');
    }
    const lower = line.toLowerCase();
    lowerLocal.forEach((p, idx) => {
      if (lower.includes(p)) hits.add(`local-pattern:${idx}`);
    });
    if (hits.size === 0) return;
    const at = line.indexOf(ALLOW_MARKER);
    const allowed = at >= 0 && line.slice(at + ALLOW_MARKER.length).trim().length >= 3;
    for (const rule of hits) findings.push({ line: i + 1, rule, allowed });
  });
  return findings;
}

function inScope(rel) {
  const parts = rel.split('/');
  if (parts.some((p) => SKIP_DIRS.has(p))) return false;
  const base = parts[parts.length - 1];
  if (SKIP_FILES.has(base) || BINARY_EXT.has(path.extname(base).toLowerCase())) return false;
  return parts.length === 1 || SCAN_DIRS.has(parts[0]);
}

function walk(root, rel = '') {
  const out = [];
  for (const entry of readdirSync(path.join(root, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) out.push(...walk(root, r));
    } else if (entry.isFile()) out.push(r);
  }
  return out;
}

/** Tracked files when root is a git repository, otherwise every file under root. Forward-slash relative paths. */
export function listFiles(root) {
  let files;
  if (existsSync(path.join(root, '.git'))) {
    const out = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    files = out.split('\0').filter(Boolean);
  } else {
    files = walk(root);
  }
  return files.filter(inScope);
}

/**
 * @param {{ root: string, localPatterns?: string[] }} opts
 * @returns {{ violations: {file:string,line:number,rule:string}[], allowed: {file:string,line:number,rule:string}[], scanned: number }}
 */
export function scanGenerality({ root, localPatterns }) {
  const patterns = localPatterns ?? loadLocalPatterns(root);
  const violations = [];
  const allowed = [];
  let scanned = 0;
  // A file name may itself contain a forbidden local pattern: never echo it back.
  const mask = (rel) =>
    patterns.reduce((acc, p) => {
      const needle = p.toLowerCase();
      let out = '';
      let i = 0;
      for (let at = acc.toLowerCase().indexOf(needle); at >= 0; at = acc.toLowerCase().indexOf(needle, i)) {
        out += acc.slice(i, at) + '***';
        i = at + needle.length;
      }
      return out + acc.slice(i);
    }, rel);
  for (const rel of listFiles(root)) {
    const shown = mask(rel);
    // File names count too (reported as line 0): a real name in a path is as bad as one in the content.
    for (const f of scanText(rel, patterns)) violations.push({ file: shown, line: 0, rule: f.rule });
    let buf;
    try {
      const abs = path.join(root, rel);
      if (!statSync(abs).isFile()) continue;
      buf = readFileSync(abs);
    } catch {
      continue; // listed but deleted in the working tree
    }
    if (buf.subarray(0, 8192).includes(0)) continue; // binary
    scanned++;
    for (const f of scanText(buf.toString('utf8'), patterns)) {
      (f.allowed ? allowed : violations).push({ file: shown, line: f.line, rule: f.rule });
    }
  }
  return { violations, allowed, scanned };
}
