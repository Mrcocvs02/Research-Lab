#!/usr/bin/env node
// Runs a command and reports how much system memory it consumed (drop of available memory).
// Usage: node tools/mem-sample.mjs [--abort-below=<GiB>] -- command [args...]
// With --abort-below, the command is killed when available memory falls under that value.
import { spawn } from 'node:child_process';
import os from 'node:os';

const args = process.argv.slice(2);
const sep = args.indexOf('--');
if (sep < 0 || sep === args.length - 1) {
  console.error('usage: node tools/mem-sample.mjs [--abort-below=GiB] -- command [args...]');
  process.exit(2);
}
const abortOpt = args.slice(0, sep).find((a) => a.startsWith('--abort-below='));
const abortBelow = abortOpt ? Number(abortOpt.split('=')[1]) : 0;
const gib = (b) => b / 2 ** 30;

const baseline = os.freemem();
let min = baseline;
let aborted = false;
const [cmd, ...rest] = args.slice(sep + 1);
const child = spawn(cmd, rest, { stdio: 'inherit', shell: process.platform === 'win32' });

const timer = setInterval(() => {
  const free = os.freemem();
  if (free < min) min = free;
  if (abortBelow && gib(free) < abortBelow && !aborted) {
    aborted = true;
    console.error(`\nmem-sample: available memory ${gib(free).toFixed(2)} GiB < ${abortBelow} GiB, stopping the command`);
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
    else child.kill('SIGKILL');
  }
}, 250);

child.on('exit', (code) => {
  clearInterval(timer);
  console.log(
    `\nmem-sample: baseline ${gib(baseline).toFixed(2)} GiB available, minimum ${gib(min).toFixed(2)} GiB, ` +
      `peak use by the command ~${gib(baseline - min).toFixed(2)} GiB${aborted ? ' (ABORTED)' : ''}`,
  );
  process.exit(aborted ? 3 : (code ?? 1));
});
