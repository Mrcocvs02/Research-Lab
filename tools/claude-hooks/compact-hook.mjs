#!/usr/bin/env node
// Claude Code hooks around context compaction (development tooling, not part of the app).
//   pre  (PreCompact):              snapshot the project state into .claude/last-compact.md and warn if docs are stale.
//   post (SessionStart "compact"):  hand the snapshot back to the model with the files to re-read.
// Output is the JSON that Claude Code hooks understand; the script never fails the hook.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const repo = path.resolve(import.meta.dirname, '..', '..');
const snapshotFile = path.join(repo, '.claude', 'last-compact.md');
const mode = process.argv[2];

const git = (...args) => {
  try {
    return execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
};
const ageMinutes = (rel) => {
  const f = path.join(repo, rel);
  return existsSync(f) ? Math.round((Date.now() - statSync(f).mtimeMs) / 60000) : null;
};
const out = (obj) => process.stdout.write(JSON.stringify(obj));

function pre() {
  const head = git('log', '-1', '--format=%h %s');
  const headAgeMin = Math.round((Date.now() / 1000 - Number(git('log', '-1', '--format=%ct') || 0)) / 60);
  const dirty = git('status', '--short').split('\n').filter(Boolean);
  const unpushed = git('rev-list', '--count', '@{u}..HEAD') || '?';
  const worktrees = git('worktree', 'list').split('\n').filter(Boolean);
  const branches = git('branch', '--format=%(refname:short)').split('\n').filter((b) => b && b !== 'main');
  const tags = git('tag', '--list', 'phase-*').split('\n').filter(Boolean);
  const statusAge = ageMinutes('docs/STATUS.md');
  const historyAge = ageMinutes('docs/HISTORY.md');
  const stale = statusAge !== null && statusAge > headAgeMin + 30;

  const lines = [
    `# Snapshot before compaction (${new Date().toISOString()})`,
    `- HEAD on main: ${head} (${headAgeMin} min ago); unpushed commits: ${unpushed}`,
    `- Phase tags: ${tags.join(', ') || 'none'}`,
    `- Uncommitted changes: ${dirty.length ? dirty.slice(0, 15).join('; ') : 'none'}`,
    `- Worktrees: ${worktrees.join(' | ')}`,
    `- Branches not merged/removed: ${branches.join(', ') || 'none'}`,
    `- docs/STATUS.md updated ${statusAge ?? '?'} min ago; docs/HISTORY.md ${historyAge ?? '?'} min ago${stale ? ' (STATUS older than the last commit: update it)' : ''}`,
  ];
  try {
    mkdirSync(path.dirname(snapshotFile), { recursive: true });
    writeFileSync(snapshotFile, lines.join('\n') + '\n');
  } catch {
    /* best effort */
  }
  out({
    systemMessage:
      `Research Lab: project state saved before compaction (HEAD ${head.split(' ')[0] || '?'}, ` +
      `${dirty.length} uncommitted, ${worktrees.length - 1} extra worktrees)` +
      (stale ? '. Warning: docs/STATUS.md is older than the last commit.' : '.'),
  });
}

function post() {
  let snapshot = '';
  try {
    snapshot = readFileSync(snapshotFile, 'utf8');
  } catch {
    /* no snapshot */
  }
  out({
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext:
        'The conversation was just compacted. Before continuing the Research Lab work, re-read ' +
        `${path.join(repo, 'CLAUDE.md')}, ${path.join(repo, 'CLAUDE.local.md')}, ` +
        `${path.join(repo, 'docs', 'STATUS.md')} and ${path.join(repo, 'docs', 'HISTORY.md')}, ` +
        'check `git status` and the worktrees, and only then resume.\n\n' +
        (snapshot || '(no snapshot was saved)'),
    },
  });
}

if (mode === 'pre') pre();
else if (mode === 'post') post();
else out({});
