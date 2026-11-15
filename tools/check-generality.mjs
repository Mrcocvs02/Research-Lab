// check:generality - fails (exit 1) when tracked code, tests or fixtures contain absolute user paths,
// sync-service folders, real e-mail addresses or anything in the git-ignored tools/generality.local.json.
// Usage: node tools/check-generality.mjs [--root <dir>]
// A line may carry `generality-allow: <reason>` to opt out; allowed lines are counted and listed.
// Output lists file:line and the rule only, never the matched text (local patterns: index only).
import path from 'node:path';
import { scanGenerality } from './lib/generality.mjs';

const args = process.argv.slice(2);
const i = args.indexOf('--root');
const root = path.resolve(i >= 0 && args[i + 1] ? args[i + 1] : path.join(import.meta.dirname, '..'));

const { violations, allowed, scanned } = scanGenerality({ root });
const fmt = (f) => `${f.file}:${f.line}  [${f.rule}]`;
if (allowed.length > 0) {
  console.log(`generality: ${allowed.length} line(s) allowed by an explicit exception:`);
  for (const f of allowed) console.log(`  ${fmt(f)}`);
}
if (violations.length > 0) {
  console.error(`generality: ${violations.length} violation(s) in ${scanned} files:`);
  for (const f of violations) console.error(`  ${fmt(f)}`);
  process.exit(1);
}
console.log(`generality: OK (${scanned} files scanned, ${allowed.length} exception(s))`);
