// Use this when moving a managed Sites checkout onto a normal development machine.
import { mkdir, writeFile } from 'node:fs/promises';
await mkdir('.sites-runtime', { recursive: true });
await writeFile('.sites-runtime/execution-profile.json', JSON.stringify({executionProfile:'portable'},null,2)+'\n');
console.log('Portable profile saved. Run pnpm analyzer:build, then pnpm dev.');
