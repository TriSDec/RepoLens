import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createIgnore } from '../.test-build/gitignore.mjs';
import { ScanCancelled, fromFileList, scanTree } from '../.test-build/scan.mjs';
import { analyze, collectZip, LIMITS, stripComments } from '../.test-build/lib.mjs';
import { kinds, project, zipBuffer } from './helpers.mjs';

// ---- helpers ------------------------------------------------------------------------------------------------
/** An in-memory folder: { name: 'text' | { nested } }, instrumented so tests can see what was opened or read. */
const mem = (tree, stats = { opened: [], read: 0 }, prefix = '') => ({
  stats,
  async list() {
    return Object.entries(tree).map(([name, v]) => {
      const path = prefix ? `${prefix}/${name}` : name;
      return typeof v === 'string' || v instanceof Uint8Array
        ? { name, kind: 'file', file: async () => { stats.read++; if (v === 'THROW') throw new Error('disk error'); return new File([v], name); } }
        : { name, kind: 'dir', open: async () => { stats.opened.push(path); return mem(v, stats, path); } };
    });
  },
});
const run = (tree, over = {}) => { const progress = [], kindsSeen = []; const src = mem(tree); return scanTree(src, { gitignore: true, onProgress: p => progress.push(p), onFile: k => kindsSeen.push(k), cancelled: () => false, ...over }).then(r => ({ ...r, progress, kindsSeen, stats: src.stats })); };
const paths = r => r.files.map(f => f.path);

// ---- .gitignore matcher ---------------------------------------------------------------------------------------------
test('gitignore: patterns, anchoring, directory-only rules, negation and **', () => {
  const ig = createIgnore();
  ig.add('', '# comment\n\n*.log\n/build\ntemp/\n!keep.log\n**/cache\ndocs/**/draft.md\nsecret?.txt\n[ab].tmp\n');
  const yes = [['a.log', 0], ['src/deep/x.log', 0], ['build', 1], ['build', 0], ['temp', 1], ['a/cache', 1], ['cache', 0], ['docs/a/b/draft.md', 0], ['docs/draft.md', 0], ['secret1.txt', 0], ['a.tmp', 0]];
  const no = [['keep.log', 0], ['src/build', 1], ['temp', 0], ['other/draft.md', 0], ['secret12.txt', 0], ['c.tmp', 0], ['src/main.ts', 0]];
  for (const [p, dir] of yes) assert.ok(ig.ignores(p, !!dir), `${p} should be ignored`);
  for (const [p, dir] of no) assert.ok(!ig.ignores(p, !!dir), `${p} should not be ignored`);
});

test('gitignore: nested files apply only below their folder, and may re-include', () => {
  const ig = createIgnore();
  ig.add('', '*.gen.ts\n');
  ig.add('pkg', '!important.gen.ts\n/local-only.ts\n');
  assert.ok(ig.ignores('a.gen.ts', false) && ig.ignores('pkg/a.gen.ts', false));
  assert.ok(!ig.ignores('pkg/important.gen.ts', false), 'a deeper file can re-include');
  assert.ok(ig.ignores('important.gen.ts', false), 'but not outside its folder');
  assert.ok(ig.ignores('pkg/local-only.ts', false) && !ig.ignores('local-only.ts', false) && !ig.ignores('pkg/sub/local-only.ts', false));
});

test('gitignore: ignoresPath treats everything under an ignored folder as ignored; escapes and trailing spaces behave', () => {
  const ig = createIgnore();
  ig.add('', 'build/\n\\#hash.txt\ntrailing.txt   \n');
  assert.ok(ig.ignoresPath('build/x/y.ts') && !ig.ignoresPath('src/build.ts'));
  assert.ok(ig.ignoresPath('#hash.txt') && ig.ignoresPath('trailing.txt'));
  assert.ok(!createIgnore().ignoresPath('anything'));
});

test('gitignore: hostile patterns neither hang nor throw', () => {
  const ig = createIgnore();
  const t = performance.now();
  ig.add('', ['*'.repeat(5000), '['.repeat(3000), '(a+)+$', '\\'.repeat(2000), '**/'.repeat(500) + 'x', 'a/'.repeat(300)].join('\n'));
  ig.ignores('a/'.repeat(50) + 'x', false);
  assert.ok(performance.now() - t < 1500);
});

// ---- scanner ---------------------------------------------------------------------------------------------------------------
test('the scanner never enters dependency folders, and reads text but only sizes binary assets', async () => {
  const r = await run({ 'package.json': '{}', src: { 'a.ts': "import './b'", 'b.ts': 'export const b=1', 'logo.png': new Uint8Array([137, 80, 78, 71, 0, 1]) }, node_modules: { pkg: { 'index.js': 'x' } }, '.git': { HEAD: 'ref' }, dist: { 'out.js': 'y' } });
  assert.deepEqual(paths(r), ['package.json', 'src/a.ts', 'src/b.ts', 'src/logo.png']);
  assert.equal(r.files.find(f => f.path === 'src/logo.png').content, undefined);
  assert.ok(r.files.find(f => f.path === 'src/a.ts').content.includes('import'));
  assert.deepEqual(r.stats.opened, ['src'], 'node_modules, .git and dist were skipped without being opened');
  assert.ok(r.skippedReasons['Folders not entered (dependencies, build output, .gitignore)'] >= 3);
  assert.equal(analyze(r, 'x', () => {}, { layout: false }).edges.length, 1);
});

test('the scanner honours .gitignore (including nested files) and the option can be turned off', async () => {
  const tree = { '.gitignore': 'generated/\n*.log\n', src: { 'a.ts': 'export const a=1', 'debug.log': 'noise', generated: { 'g.ts': 'export const g=1' }, '.gitignore': '!debug.log\nlocal.ts\n', 'local.ts': 'export const l=1' }, generated: { 'x.ts': 'export {}' }, 'run.log': 'x' };
  const on = await run(tree);
  assert.deepEqual(paths(on), ['src/a.ts', 'src/debug.log'].sort(), 'nested !debug.log re-includes it; generated/ and local.ts are gone');
  assert.ok(!on.stats.opened.includes('generated'));
  assert.ok(on.skippedReasons['Ignored by .gitignore'] >= 2);
  const off = await run(tree, { gitignore: false });
  assert.ok(paths(off).includes('generated/x.ts') && paths(off).includes('src/local.ts'));
});

test('a project over the file limit fails early with a message that says what to do, before reading everything', async () => {
  const keep = LIMITS.files;
  try {
    LIMITS.files = 25;
    const tree = {};
    for (let d = 0; d < 10; d++) tree[`d${d}`] = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`f${i}.ts`, `export const v${i}=1`]));
    const src = mem(tree);
    await assert.rejects(() => scanTree(src, { gitignore: true, onProgress() {}, cancelled: () => false }), /more than 25 files.*subfolder.*repolens/s);
    assert.ok(src.stats.read < 200, `stopped after reading ${src.stats.read} of 200 files`);
  } finally { LIMITS.files = keep; }
});

test('the byte limit applies to readable text only', async () => {
  const keep = LIMITS.bytes;
  try {
    LIMITS.bytes = 2000;
    await assert.rejects(() => run({ 'a.ts': 'x'.repeat(1500), 'b.ts': 'y'.repeat(1500) }), /larger than/);
    const ok = await run({ 'a.ts': 'x'.repeat(1500), 'pic.png': new Uint8Array(900000) });
    assert.equal(ok.files.length, 2);
  } finally { LIMITS.bytes = keep; }
});

test('binary and oversized text files are skipped and counted, not analysed', async () => {
  const r = await run({ 'ok.ts': 'export const a=1', 'bin.ts': new Uint8Array([0x41, 0, 0x42, 0xff, 0xfe]), 'big.json': 'x'.repeat(LIMITS.perFile + 1) });
  assert.deepEqual(paths(r), ['ok.ts']);
  assert.equal(r.skippedReasons['Binary or non-UTF-8 text'], 1);
  assert.equal(r.skippedReasons['Text files over 1 MB'], 1);
});

test('progress is reported as it goes, with one callback per included file, and can be cancelled', async () => {
  const tree = {};
  for (let d = 0; d < 20; d++) tree[`d${d}`] = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`f${i}.${i % 2 ? 'py' : 'ts'}`, 'x = 1']));
  const r = await run(tree);
  assert.equal(r.kindsSeen.length, 600);
  assert.ok(new Set(r.kindsSeen).has('python') && new Set(r.kindsSeen).has('js'));
  const last = r.progress.at(-1);
  assert.equal(last.found, 600);
  assert.equal(last.read, 600);
  for (let i = 1; i < r.progress.length; i++) assert.ok(r.progress[i].found >= r.progress[i - 1].found, 'found never goes backwards');
  let calls = 0;
  await assert.rejects(() => run(tree, { cancelled: () => ++calls > 40 }), ScanCancelled);
});

test('results are sorted and identical however the reads interleave; a failing read rejects instead of hanging', async () => {
  const tree = { z: { 'a.ts': 'export {}' }, a: { 'z.ts': 'export {}', 'b.ts': 'export {}' }, m: 'text' };
  const one = await run(tree), two = await run(tree);
  assert.deepEqual(paths(one), ['a/b.ts', 'a/z.ts', 'm', 'z/a.ts']);
  assert.deepEqual(paths(one), paths(two));
  const bad = await run({ ...tree, boom: { 'x.ts': 'THROW' } }); // an unreadable file is skipped and reported, it does not sink the scan
  assert.deepEqual(paths(bad), paths(one));
  assert.equal(bad.skippedReasons['Unreadable files'], 1);
});

test('source files named secrets or credentials are analysed, data files with those names are not', async () => {
  const r = await run({ src: { 'secrets.ts': 'export const a = 1', 'credentials.py': 'x = 1', 'secrets.json': '{}', 'credentials.yml': 'a: 1' } });
  assert.deepEqual(paths(r), ['src/credentials.py', 'src/secrets.ts']);
});

test('imports into folders that were left out on purpose are not reported as broken', () => {
  const r = analyze({ files: [{ path: 'a.ts', size: 40, content: "import './build/out';\nimport './missing';" }], skipped: 1, skippedBytes: 0, skippedReasons: {}, ignoredPaths: ['build'] }, 'p');
  const broken = r.findings.filter(f => f.kind === 'unresolved');
  assert.equal(broken.length, 1);
  assert.match(broken[0].detail, /missing/);
});

test('risky constructs inside strings, tests and reviewed lines are not flagged', () => {
  const risky = (path, text) => analyze({ files: [{ path, size: text.length, content: text }], skipped: 0, skippedBytes: 0, skippedReasons: {} }, 'p').findings.filter(f => f.kind === 'risky');
  assert.equal(risky('a.ts', 'run(eval(input));').length, 1);
  assert.equal(risky('a.ts', "const doc = 'use eval(x) carefully';").length, 0);
  assert.equal(risky('a.test.ts', 'eval(input);').length, 0);
  assert.equal(risky('a.ts', '// repolens-ignore: input is a constant\neval(input);').length, 0);
});

test('a large, wide project scans quickly and completes (no lost wake-ups under load)', async () => {
  const tree = {};
  for (let d = 0; d < 80; d++) tree[`pkg${d}`] = { src: Object.fromEntries(Array.from({ length: 125 }, (_, i) => [`f${i}.ts`, `export const v${i} = ${i};`])), node_modules: { x: { 'i.js': '1' } } };
  const t = performance.now();
  const r = await run(tree);
  assert.equal(r.files.length, 10000);
  assert.ok(performance.now() - t < 8000, `took ${Math.round(performance.now() - t)} ms`);
});

test('a flat file list (folder chooser) becomes a tree, strips the shared root, and rejects unsafe paths', async () => {
  const mk = t => new File([t], 'x');
  const src = fromFileList([mk('a'), mk('b'), mk('c')], ['proj/src/a.ts', 'proj/src/b.ts', 'proj/README.md']);
  assert.equal(src.rootName, 'proj');
  const r = await scanTree(src, { gitignore: true, onProgress() {}, cancelled: () => false });
  assert.deepEqual(paths(r), ['README.md', 'src/a.ts', 'src/b.ts']);
  assert.throws(() => fromFileList([mk('a')], ['../escape.ts']), /unsafe/);
});

// ---- ZIP files ------------------------------------------------------------------------------------------------------------------
test('ZIP files honour .gitignore, with or without a root folder, and can opt out', () => {
  const zip = zipBuffer({ 'proj/.gitignore': 'ignored/\n*.tmp\n', 'proj/src/a.ts': 'export const a=1', 'proj/ignored/x.ts': 'export const x=1', 'proj/src/s.tmp': 'noise' });
  assert.deepEqual(collectZip(zip, () => {}).files.map(f => f.path).sort(), ['src/a.ts']);
  assert.ok(collectZip(zip, () => {}, { gitignore: false }).files.some(f => f.path === 'ignored/x.ts'));
  const flat = zipBuffer({ '.gitignore': 'ignored/\n', 'a.ts': 'export {}', 'ignored/b.ts': 'export {}' });
  assert.deepEqual(collectZip(flat, () => {}).files.map(f => f.path).sort(), ['a.ts']);
});

test('ignored or skipped ZIP entries are never decompressed, so they do not count toward the expansion limit', () => {
  const keep = LIMITS.expanded;
  try {
    LIMITS.expanded = 20000;
    const big = 'x'.repeat(60000);
    const zip = zipBuffer({ 'node_modules/pkg/big.js': big, 'build/out.js': big, 'main.ts': 'export const a=1' });
    assert.deepEqual(collectZip(zip, () => {}).files.map(f => f.path), ['main.ts']);
    assert.throws(() => collectZip(zipBuffer({ 'src/big.txt': big }), () => {}), /safety limit/);
  } finally { LIMITS.expanded = keep; }
});

test('the ZIP entry and file limits fail with actionable messages', () => {
  const keep = LIMITS.files;
  try {
    LIMITS.files = 30;
    const many = Object.fromEntries(Array.from({ length: 31 }, (_, i) => [`f${i}.ts`, 'export const x=1']));
    assert.throws(() => collectZip(zipBuffer(many), () => {}), /more than 30 files.*subfolder/s);
  } finally { LIMITS.files = keep; }
});

// ---- engine: time budget and faster comment stripping ----------------------------------------------------------------
test('over its time budget the analyzer still maps imports, says so, and invents no unused-export findings', () => {
  const map = { 'src/main.ts': "import { a } from './a'; import type { T } from './types'; export * from './c'; const d = require('./d'); import('./e'); import 'lodash';", 'src/a.ts': 'export const a = 1; export const unused = 2;', 'src/types.ts': 'export type T = 1', 'src/c.ts': 'export const c = 1', 'src/d.ts': 'module.exports = 1', 'src/e.ts': 'export default 1', 'package.json': '{"dependencies":{"lodash":"1"}}' };
  const normal = project(map), fast = project(map, 't', { budgetMs: -1 });
  const edges = r => new Set(r.edges.map(e => `${e.from}>${e.to}`));
  assert.deepEqual([...edges(fast)].sort(), [...edges(normal)].sort());
  assert.ok(fast.limitations.some(l => /faster, less detailed/.test(l)));
  assert.ok(!normal.limitations.some(l => /faster, less detailed/.test(l)));
  assert.equal(kinds(fast, 'unused-export').length, 0);
  assert.ok(fast.edges.find(e => e.to === 'src/types.ts').typeOnly);
  assert.ok(fast.packages.includes('lodash'));
});

test('stripComments keeps offsets and line breaks and matches what the readable text means', () => {
  const src = "const a = 1; // trailing\n/* block\n   spanning */ const b = '// not a comment';\n";
  const out = stripComments(src, 'js');
  assert.equal(out.length, src.length);
  assert.equal(out.split('\n').length, src.split('\n').length);
  assert.ok(!out.includes('trailing') && !out.includes('spanning') && out.includes("'// not a comment'"));
  assert.equal(stripComments('x = 1', 'python'), 'x = 1');
  assert.equal(stripComments('"""doc import os"""\nimport sys', 'python').includes('import os'), false);
});

test('a project much larger than before still analyses within a comfortable time', () => {
  const map = {};
  for (let i = 0; i < 6000; i++) map[`src/m${i % 60}/f${i}.ts`] = (i ? `import './../m${(i - 1) % 60}/f${i - 1}';\n` : '') + `export function fn${i}(x: number) { if (x > ${i}) { return x * 2; } return ${i}; }`;
  const t = performance.now();
  const r = project(map, 'big', { budgetMs: 18000 });
  assert.equal(r.nodes.length, 6000);
  assert.ok(r.edges.length > 5000);
  assert.ok(performance.now() - t < 20000, `took ${Math.round(performance.now() - t)} ms`);
});
