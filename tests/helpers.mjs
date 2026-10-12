import { zipSync, strToU8 } from 'fflate';
import * as lib from '../.test-build/lib.mjs';

export { lib };

export const collected = files => ({ files, skipped: 0, skippedBytes: 0, skippedReasons: {} });
/** Analyse an in-memory project given as { path: content }. */
export const project = (map, name = 'test', options) =>
  lib.analyze(collected(Object.entries(map).map(([path, content]) => ({ path, size: Buffer.byteLength(content), content }))), name, () => {}, options);
export const edgeSet = r => new Set(r.edges.map(e => `${e.from}->${e.to}`));
export const kinds = (r, kind) => r.findings.filter(f => f.kind === kind);
export const zipBuffer = map => {
  const z = zipSync(Object.fromEntries(Object.entries(map).map(([k, v]) => [k, strToU8(v)])));
  return z.buffer.slice(z.byteOffset, z.byteOffset + z.byteLength);
};

// Credential-shaped strings are assembled at runtime so this repository never contains a literal one.
export const FAKE = {
  aws: ['AKIA', 'J3Q7ZK2M5XW4N6PB'].join(''),
  github: ['gh', 'p_', 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8'].join(''),
  openai: ['sk', '-proj-', 'Zx9Qw3Er7Ty1Ui5Op2As6Df0Gh4Jk8Lm3Nb7Vc1Xz'].join(''),
  stripeLive: ['sk', '_live_', '4eC39HqLyjWDarjtT1zdp7dc'].join(''),
  slack: ['xo', 'xb-', '123456789012-abcdefABCDEF1234'].join(''),
  privateKey: ['-----BEGIN ', 'RSA PRIVATE KEY-----'].join(''),
  appPassword: ['qwer', 'asdf', 'zxcv', 'tyui'].join(' '),
};
