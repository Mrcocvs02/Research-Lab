#!/usr/bin/env node
// Refuses to start a heavy job when the machine has too little available memory.
// Usage: node tools/mem-guard.mjs <minAvailableGiB> [label]
// Override (at your own risk): RL_SKIP_MEM_GUARD=1
import os from 'node:os';

const min = Number(process.argv[2] ?? 2);
const label = process.argv[3] ?? 'this job';
const availableGiB = os.freemem() / 2 ** 30;

if (process.env.RL_SKIP_MEM_GUARD === '1') process.exit(0);
if (availableGiB < min) {
  console.error(
    `mem-guard: only ${availableGiB.toFixed(1)} GiB of memory available, ${label} needs at least ${min} GiB. ` +
      'Close some applications and retry (or set RL_SKIP_MEM_GUARD=1 to force).',
  );
  process.exit(1);
}
console.log(`mem-guard: ${availableGiB.toFixed(1)} GiB available (min ${min} GiB) for ${label}`);
