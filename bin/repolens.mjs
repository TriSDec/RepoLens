#!/usr/bin/env node
// Thin launcher: builds the bundled CLI on first use, then runs it.
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const cli = fileURLToPath(new URL('../dist-cli/cli.mjs', import.meta.url));
if (!existsSync(cli)) {
  console.error('repolens: building the command-line tool (first run only)...');
  const r = spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/build-cli.mjs', import.meta.url))], { cwd: root, stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
await import(pathToFileURL(cli).href);
