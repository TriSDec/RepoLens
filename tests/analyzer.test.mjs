import assert from 'node:assert/strict';
import { test } from 'node:test';
import { collected, kinds, lib, project, zipBuffer } from './helpers.mjs';

const { analyze, collectFolder, collectZip, demoFiles, exclusion, safePath, trace, shortestPath, LIMITS } = lib;

test('the sample project shows real structure and a spread of insight types', () => {
  const r = analyze(collected(demoFiles), 'demo');
  assert.equal(r.schemaVersion, 2);
  assert.equal(kinds(r, 'cycle').length, 2, 'one TypeScript cycle and one Python cycle');
  assert.equal(kinds(r, 'duplicate').length, 1);
  assert.equal(kinds(r, 'syntax').length, 0);
  assert.ok(kinds(r, 'secret').some(f => f.severity === 'error'));
  assert.ok(kinds(r, 'undeclared').some(f => f.detail.includes('lodash')));
  assert.ok(kinds(r, 'package').some(f => f.detail.includes('moment')));
  assert.ok(kinds(r, 'complexity').some(f => f.title.includes('shippingCost')));
  assert.ok(kinds(r, 'unused-export').some(f => f.files[0] === 'web/src/services/cache.ts'));
  assert.ok(kinds(r, 'risky').length >= 3);
  assert.equal(r.testFiles, 3);
  assert.deepEqual(r.languages.map(l => l.lang).sort(), ['go', 'js', 'python']);
  assert.ok(!r.findings.some(f => f.kind === 'package' && f.detail.includes('“react”')));
  assert.ok(r.health.score < 80 && r.health.score > 20);
});

test('the sample has no false "unreachable" noise for files reached from entry points', () => {
  const r = analyze(collected(demoFiles), 'demo');
  const unreachable = new Set(kinds(r, 'unreachable').flatMap(f => f.files));
  for (const reached of ['web/src/App.tsx', 'web/src/components/Dashboard.tsx', 'api/models.py', 'api/routers/auth.py', 'worker/internal/store/store.go'])
    assert.ok(!unreachable.has(reached), reached);
  assert.ok(unreachable.has('web/src/legacy/OldDashboard.tsx'));
});

test('syntax-aware imports ignore comments and strings; support reexports, require, dynamic literals and type imports', () => {
  const r = project({ 'src/main.ts': `// import './ghost';\nconst s = "require('./also-ghost')";\nexport {a} from './a';\nconst b = require('./b');\nimport('./c');\nimport type {T} from './types';`, 'src/a.ts': 'export const a=1', 'src/b.ts': 'module.exports=2', 'src/c.ts': 'export default 3', 'src/types.ts': 'export type T=string' });
  assert.equal(r.edges.length, 4);
  assert.equal(kinds(r, 'unresolved').length, 0);
  assert.ok(r.edges.some(e => e.to === 'src/types.ts' && e.typeOnly));
});

test('type-only cycles do not count as runtime cycles', () => {
  const r = project({ 'a.ts': "import type {B} from './b'; export type A = B;", 'b.ts': "import type {A} from './a'; export type B = A;" });
  assert.equal(kinds(r, 'cycle').length, 0);
});

test('cycles report the actual loop, not just the files involved', () => {
  const r = project({ 'main.ts': "import './a'", 'a.ts': "import './b'", 'b.ts': "import './c'", 'c.ts': "import './a'" });
  const [cycle] = kinds(r, 'cycle');
  assert.deepEqual(cycle.path.slice(0, -1).sort(), ['a.ts', 'b.ts', 'c.ts']);
  assert.equal(cycle.path[0], cycle.path.at(-1));
  assert.match(cycle.detail, /→/);
  assert.ok(r.nodes.find(n => n.id === 'a.ts').inCycle && !r.nodes.find(n => n.id === 'main.ts').inCycle);
});

test('resolves directory indexes, tsconfig aliases, explicit JS-to-TS paths and flags missing files', () => {
  const r = project({ 'tsconfig.json': JSON.stringify({ compilerOptions: { paths: { '@/*': ['src/*'] } } }), 'src/main.ts': "import '@/lib'; import './util.js'; import './missing';", 'src/lib/index.ts': 'export const a=1', 'src/util.ts': 'export const b=1' });
  assert.equal(r.edges.length, 2);
  assert.equal(kinds(r, 'unresolved').length, 1);
});

test('syntax errors have line numbers and computed imports are disclosed', () => {
  const r = project({ 'main.ts': 'const x = ;\nimport(name);' });
  assert.ok(r.findings.some(f => f.kind === 'syntax' && f.line === 1));
  assert.ok(r.findings.some(f => f.kind === 'dynamic'));
});

test('change impact follows reverse transitive edges and handles cycles; shortestPath explains a dependency', () => {
  const e = [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'c', to: 'b' }];
  assert.deepEqual([...trace('c', e, 'impact')].sort(), ['a', 'b', 'c']);
  assert.deepEqual(shortestPath('a', 'c', e), ['a', 'b', 'c']);
  assert.equal(shortestPath('c', 'a', e), null);
  assert.deepEqual(shortestPath('a', 'a', e), ['a']);
});

test('influence counts every direct and indirect dependent exactly once', () => {
  const r = project({ 'a.ts': "import './c'; import './b'", 'b.ts': "import './c'", 'c.ts': "import './d'", 'd.ts': 'export const d=1', 'e.ts': 'export const e=1' });
  const byId = Object.fromEntries(r.nodes.map(n => [n.id, n]));
  assert.equal(byId['d.ts'].influence, 3); // c, b, a  (a reaches d through two routes but counts once)
  assert.equal(byId['c.ts'].influence, 2);
  assert.equal(byId['a.ts'].influence, 0);
  assert.equal(byId['e.ts'].influence, 0);
  assert.ok(byId['d.ts'].centrality >= byId['a.ts'].centrality);
});

test('unused exports are reported, but namespace, default-via-barrel and entry files are not', () => {
  const r = project({
    'src/main.ts': "import { used } from './lib'; import * as ns from './wild'; import './barrel'; console.log(used, ns);",
    'src/lib.ts': 'export const used = 1; export const unusedA = 2; export function unusedB() {}',
    'src/wild.ts': 'export const x = 1; export const y = 2;',
    'src/barrel.ts': "export { z } from './deep';",
    'src/deep.ts': 'export const z = 1;',
  });
  const unused = kinds(r, 'unused-export');
  assert.equal(unused.length, 1);
  assert.equal(unused[0].files[0], 'src/lib.ts');
  assert.match(unused[0].detail, /unusedA/);
  assert.match(unused[0].detail, /unusedB/);
  assert.doesNotMatch(unused[0].detail, /\bused\b,/);
});

test('imports of packages no package.json declares are flagged; declared and @types ones are not', () => {
  const r = project({ 'package.json': JSON.stringify({ dependencies: { react: '1' }, devDependencies: { vitest: '1' } }), 'src/a.ts': "import React from 'react'; import _ from 'lodash'; import { test } from 'vitest'; import fs from 'node:fs';" });
  const undeclared = kinds(r, 'undeclared');
  assert.equal(undeclared.length, 1);
  assert.match(undeclared[0].detail, /lodash/);
  assert.equal(r.externals.find(p => p.name === 'lodash').declared, false);
  assert.equal(r.externals.find(p => p.name === 'react').declared, true);
});

test('files no test reaches are flagged only when the project has tests; projects without tests get one notice', () => {
  const src = { 'src/main.ts': "import './core'", 'src/core.ts': "import './a'; import './b'; import './c'; export const x=1", 'src/a.ts': "import './core'", 'src/b.ts': "import './core'", 'src/c.ts': "import './core'" };
  const none = project({ ...src, 'src/d.ts': '', 'src/e.ts': '', 'src/f.ts': '' });
  assert.equal(kinds(none, 'no-tests').length, 1);
  assert.equal(kinds(none, 'untested').length, 0);
  const some = project({ ...src, 'src/leaf.ts': 'export const leaf = 1', 'tests/other.test.ts': "import '../src/leaf'" });
  assert.equal(kinds(some, 'no-tests').length, 0);
  assert.ok(some.nodes.find(n => n.id === 'src/leaf.ts').tested);
  assert.ok(!some.nodes.find(n => n.id === 'src/a.ts').tested);
  assert.ok(kinds(some, 'untested').some(f => f.files[0] === 'src/core.ts'), 'core is imported by three files and no test reaches it');
  assert.equal(some.testFiles, 1);
});

test('JavaScript complexity counts branches per function and names the worst one', () => {
  const r = project({ 'a.ts': `export function simple(){ return 1 }\nexport function busy(x:number){ if(x>1&&x<5||x===9){ for(const i of [1]){ if(i) return 1 } } else if (x) { try{}catch{} } return x ? 1 : 2 }` });
  const n = r.nodes[0];
  assert.equal(n.functions, 2);
  assert.equal(n.worst.name, 'busy');
  assert.ok(n.worst.complexity >= 8);
});

test('non-JavaScript files get a complexity estimate', () => {
  const py = 'def a(x):\n    if x and x > 1:\n        for i in range(x):\n            while i: pass\n    elif x: pass\n';
  const n = project({ 'main.py': py }).nodes[0];
  assert.equal(n.functions, 1);
  assert.ok(n.complexity >= 6);
});

test('health score falls as problems are added and every penalty is bounded and explained', () => {
  const clean = project({ 'src/main.ts': "import './a'", 'src/a.ts': 'export const a=1' });
  const dirty = project({ 'src/main.ts': "import './a'; import './missing'; eval('1')", 'src/a.ts': `import './main'; export const k = 1`, 'src/b.ts': 'const x = ;' });
  assert.ok(clean.health.score > dirty.health.score);
  for (const f of dirty.health.factors) assert.ok(f.penalty >= 0 && f.penalty <= f.max, f.key);
  assert.equal(dirty.health.factors.reduce((s, f) => s + f.penalty, 0) <= 100, true);
  assert.ok(['A', 'B', 'C', 'D', 'E'].includes(dirty.health.grade));
});

test('fixFirst surfaces credentials and cycles ahead of stylistic findings', () => {
  const r = analyze(collected(demoFiles), 'demo');
  const first = r.fixFirst.map(id => r.findings.find(f => f.id === id));
  assert.equal(first[0].kind, 'secret');
  assert.ok(first.every(f => f.kind !== 'size' && f.kind !== 'repeated'));
  assert.ok(first.length <= 6 && new Set(r.fixFirst).size === first.length);
});

test('priority grows with how much depends on the problem file', () => {
  const r = project({
    'src/main.ts': "import './core'; import './leaf'", 'src/core.ts': "import './x'", 'src/x.ts': "import './y'", 'src/y.ts': "import './core'",
    'src/leaf.ts': "import './l2'", 'src/l2.ts': "import './leaf'", 'src/user1.ts': "import './core'", 'src/user2.ts': "import './core'",
  });
  const [big, small] = kinds(r, 'cycle');
  assert.ok(big.files.includes('src/core.ts') && big.priority > small.priority);
});

test('the layout is deterministic, finite and normalised', () => {
  const a = analyze(collected(demoFiles), 'demo'), b = analyze(collected(demoFiles), 'demo');
  assert.deepEqual(a.nodes.map(n => [n.x, n.y, n.z]), b.nodes.map(n => [n.x, n.y, n.z]));
  for (const n of a.nodes) for (const v of [n.x, n.y, n.z]) assert.ok(Number.isFinite(v) && Math.abs(v) <= 1.0001);
  assert.ok(new Set(a.nodes.map(n => `${n.x},${n.y},${n.z}`)).size > a.nodes.length * 0.95, 'nodes should not stack on top of each other');
  const flat = project({ 'a.ts': '' }, 't', { layout: false });
  assert.deepEqual([flat.nodes[0].x, flat.nodes[0].y, flat.nodes[0].z], [0, 0, 0]);
});

test('directory cycles ignore a child importing its parent, but catch siblings that depend on each other', () => {
  const ok = project({ 'src/app.ts': "import './ui/a'", 'src/types.ts': 'export type T=1', 'src/ui/a.ts': "import '../types'" });
  assert.equal(kinds(ok, 'folder-cycle').length, 0);
  const bad = project({ 'src/main.ts': "import './ui/a'; import './data/b'", 'src/ui/a.ts': "import '../data/b'", 'src/data/b.ts': "import '../ui/c'", 'src/ui/c.ts': '' });
  const [cycle] = kinds(bad, 'folder-cycle');
  assert.deepEqual([...cycle.folders].sort(), ['src/data', 'src/ui']);
});

test('findings are capped without failing, and the cap is disclosed', () => {
  const many = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`src/f${i}.ts`, `eval("${i}"); eval("${i + 1}");`]));
  const r = project(many, 'cap', { maxFindings: 20 });
  assert.equal(r.findings.length, 20);
  assert.ok(r.limitations.some(l => /highest-priority/.test(l)));
});

test('common secrets and generated files are skipped before reading', async () => {
  for (const p of ['repo/.env', 'repo/.env.local', 'repo/.git/config', 'repo/node_modules/pkg/a.ts', 'repo/private.key', 'repo/.npmrc', 'repo/dist/app.js']) assert.ok(exclusion(p), p);
  const good = new File(['export const a=1'], 'main.ts');
  const secret = new File(['not read'], '.env');
  secret.arrayBuffer = () => { throw new Error('Secret read attempted'); };
  const r = await collectFolder([good, secret], () => {});
  assert.equal(r.files.length, 1);
  assert.equal(r.skipped, 1);
});

test('unsafe ZIP paths and traversal are rejected', () => {
  for (const p of ['../secret.ts', 'repo/../secret.ts', '/absolute.ts', 'C:\\private.ts', 'x\u0000.ts']) assert.throws(() => safePath(p), p);
  assert.throws(() => collectZip(zipBuffer({ '../bad.ts': 'export const a=1' }), () => {}));
});

test('normal ZIP projects preserve paths and exclude secrets', () => {
  const r = collectZip(zipBuffer({ 'project/src/main.ts': "import './a'", 'project/src/a.ts': 'export const a=1', 'project/.env': 'sensitive' }), () => {});
  assert.equal(r.files.length, 2);
  assert.equal(r.skipped, 1);
  assert.equal(r.files[0].path, 'src/main.ts');
  assert.equal(analyze(r, 'zip').edges.length, 1);
});

test('archive expansion and included-file limits are enforced', () => {
  const keepExpanded = LIMITS.expanded, keepFiles = LIMITS.files;
  try {
    LIMITS.expanded = 50_000;
    assert.throws(() => collectZip(zipBuffer({ 'main.ts': 'export const a=1', 'huge.txt': 'x'.repeat(LIMITS.expanded + 1) }), () => {}), /safety limit/);
    LIMITS.files = 40;
    const many = Object.fromEntries(Array.from({ length: 41 }, (_, i) => [`f${i}.ts`, 'export const x=1']));
    assert.throws(() => collectZip(zipBuffer(many), () => {}), /more than 40 files/);
  } finally { LIMITS.expanded = keepExpanded; LIMITS.files = keepFiles; }
});

test('a 1,000-file chain finishes quickly, keeps every edge, and does not overflow the stack', () => {
  const map = Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [`src/${i === 0 ? 'main' : `f${i}`}.ts`, i === 999 ? 'export const x=1' : `import './f${i + 1}'; export const x=${i};`]));
  const t = performance.now();
  const r = project(map);
  assert.equal(r.nodes.length, 1000);
  assert.equal(r.edges.length, 999);
  assert.equal(r.nodes.find(n => n.id === 'src/f999.ts').influence, 999);
  assert.ok(performance.now() - t < 8000, 'analysis should stay fast');
});

