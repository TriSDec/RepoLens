// `next start` serves public/worker/analyzer.js, which is generated. Build it if it is missing,
// so a fresh clone that runs `npm start` without `npm run build` still works.
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const worker = fileURLToPath(new URL('../public/worker/analyzer.js', import.meta.url));
if (!existsSync(worker)) {
  console.log('Building the analyzer worker (public/worker/analyzer.js)...');
  const r = spawnSync(process.execPath, [fileURLToPath(new URL('./build-analyzer.mjs', import.meta.url))], { stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
