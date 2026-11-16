#!/usr/bin/env node
// Cross-platform "VAR=value command args": node tools/with-env.mjs RL_HEAVY_TESTS=1 -- vitest run
import { spawn } from 'node:child_process';

const args = process.argv.slice(2);
const sep = args.indexOf('--');
if (sep < 1 || sep === args.length - 1) {
  console.error('usage: node tools/with-env.mjs NAME=value [NAME=value...] -- command [args...]');
  process.exit(2);
}
const env = { ...process.env };
for (const pair of args.slice(0, sep)) {
  const i = pair.indexOf('=');
  if (i < 1) throw new Error(`not NAME=value: ${pair}`);
  env[pair.slice(0, i)] = pair.slice(i + 1);
}
const [cmd, ...rest] = args.slice(sep + 1);
const child = spawn(cmd, rest, { env, stdio: 'inherit', shell: process.platform === 'win32' });
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
