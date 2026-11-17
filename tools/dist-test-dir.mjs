// Builds the unpacked packaged app as a TEST build (D-296): `RL_PACKAGED_TEST=1` makes electron-vite define
// `__RL_PACKAGED_TEST__`, the one build that accepts a remote debugging port and `--user-data-dir` (for
// e2e/packaged-app.spec.ts). Never ship it: `npm run dist` and `npm run dist:dir` build the release behaviour.
import { spawnSync } from 'node:child_process';

const r = spawnSync('npm run dist:dir', { stdio: 'inherit', shell: true, env: { ...process.env, RL_PACKAGED_TEST: '1' } });
process.exit(r.status ?? 1);
