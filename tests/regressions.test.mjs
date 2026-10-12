// Cases found by running RepoLens over real repositories. Each of these was once a false positive.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { collected, kinds, lib, project } from './helpers.mjs';

const { scanSecrets, scanRisky, analyze, demoFiles } = lib;

test('plain words, header names and identifiers are not mistaken for credentials', () => {
  for (const line of [
    "secret: 'Credential',", 'public static final String AUTH_TOKEN = "Authorization";', 'String CORRELATION = "tmx-correlation-id"; // auth token header',
    'const token = "bearerTokenValue";', "password: 'PasswordField',", 'api_key = "apiKeyHeaderName"',
  ]) assert.equal(scanSecrets('src/a.ts', line).length, 0, line);
  assert.equal(scanSecrets('src/a.ts', 'const password = "Xk9!qZ2#mL4v";').length, 1, 'a random-looking password with symbols is still found');
});

test('method calls named exec or eval are not code execution', () => {
  assert.equal(scanRisky('rows = session.exec(select(User)).all()', 'python').length, 0);
  assert.equal(scanRisky('model.eval()\nresult = db.exec(query)', 'python').length, 0);
  assert.equal(scanRisky('redis.eval(script, 0)', 'js').length, 0);
  assert.equal(scanRisky('x = eval(user_input)', 'python').map(h => h.rule.id).join(), 'eval');
  assert.equal(scanRisky('exec(code)', 'python').map(h => h.rule.id).join(), 'py-exec');
  assert.equal(scanRisky('window.eval(src)', 'js').map(h => h.rule.id).join(), 'eval');
});

test('tooling scripts, framework files and unimported library barrels are entry points, not dead code', () => {
  const r = project({
    'package.json': '{"name":"x","dependencies":{}}',
    'bin/tool.mjs': "import '../lib/core.js'", 'scripts/build.mjs': "import '../lib/core.js'", 'proxy.ts': 'export function proxy() {}',
    'app/robots.ts': 'export default function robots() {}', 'src/engine.worker.ts': "import './core'", 'src/core.ts': 'export const a = 1',
    'lib/index.ts': "export * from './core'", 'lib/core.js': 'export const b = 1', 'lib/orphan.ts': 'export const c = 1',
    'src/main.ts': "import './core'",
  });
  const unreachable = new Set(kinds(r, 'unreachable').flatMap(f => f.files));
  for (const id of ['bin/tool.mjs', 'scripts/build.mjs', 'proxy.ts', 'app/robots.ts', 'src/engine.worker.ts', 'lib/index.ts']) assert.ok(!unreachable.has(id), id);
  assert.ok(unreachable.has('lib/orphan.ts'), 'a genuinely unreferenced file is still reported');
});

test('standard C headers included with quotes are not reported missing, and the message has no stray quote', () => {
  const r = project({ 'main.c': '#include "string.h"\n#include "stdio.h"\n#include "mine.h"\nint main(){}' });
  const missing = kinds(r, 'unresolved');
  assert.equal(missing.length, 1);
  assert.match(missing[0].detail, /^“mine\.h”/);
});

test('large-file and hub findings are capped so they cannot drown out real issues', () => {
  const files = {};
  for (let i = 0; i < 40; i++) files[`assets/blob${i}.txt`] = 'x'.repeat(300 * 1024);
  files['src/main.ts'] = "import './a'";
  files['src/a.ts'] = 'export const a=1';
  const r = project(files);
  assert.ok(kinds(r, 'size').length <= 20);
  assert.ok(r.limitations.some(l => /20 largest/.test(l)));
});

test('the bundled sample report is up to date with the analyzer and demo project', () => {
  const stored = JSON.parse(readFileSync(new URL('../lib/sample-report.json', import.meta.url), 'utf8'));
  const fresh = JSON.parse(JSON.stringify(analyze(collected(demoFiles), 'orbit-dashboard')));
  fresh.duration = 0;
  assert.deepEqual(stored, fresh, 'run `npm run sample:build` and commit the result');
});

test('folder paths survive being cloned into a worker because they are passed explicitly', async () => {
  const mk = (text, name) => new File([text], name); // no webkitRelativePath, exactly what a cloned or dropped File looks like
  const files = [mk("import './b'", 'a.ts'), mk('export const b = 1', 'b.ts')];
  const r = await lib.collectFolder(files, () => {}, ['proj/src/a.ts', 'proj/src/b.ts']);
  assert.deepEqual(r.files.map(f => f.path), ['src/a.ts', 'src/b.ts']);
  assert.equal(lib.analyze(r, 'x').edges.length, 1);
  await assert.rejects(() => lib.collectFolder(files, () => {}, ['../escape.ts', 'ok.ts']), /unsafe/);
});

test('runJob (shared by the worker and the on-page fallback) handles folders, saved reports and bad input', async () => {
  const seen = [];
  const mk = (text, name) => new File([text], name);
  const folder = await lib.runJob({ name: 'p', files: [mk("import './b'", 'a.ts'), mk('export const b = 1', 'b.ts')], paths: ['p/a.ts', 'p/b.ts'] }, (v, phase) => seen.push([v, phase]));
  assert.equal(folder.report.edges.length, 1);
  assert.equal(folder.imported, false);
  assert.ok(seen.length > 2 && seen.at(-1)[0] === 100, 'progress is reported through to 100');
  const again = await lib.runJob({ name: 'x', reportText: JSON.stringify(folder.report) }, () => {});
  assert.equal(again.imported, true);
  assert.equal(again.report.nodes.length, 2);
  await assert.rejects(() => lib.runJob({ name: 'x', reportText: '{"nope":1}' }, () => {}), /RepoLens report|older/);
  await assert.rejects(() => lib.runJob({ name: 'x', files: [mk('plain text', 'notes.txt')], paths: ['notes.txt'] }, () => {}), /No readable source files/);
  const skipped = await lib.runJob({ name: 'x', files: [mk('export const a=1', 'a.ts')], paths: ['a.ts'], preSkipped: 7 }, () => {});
  assert.equal(skipped.report.skipped, 7);
});
