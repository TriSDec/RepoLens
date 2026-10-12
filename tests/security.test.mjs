import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FAKE, collected, kinds, lib, project } from './helpers.mjs';

const { scanSecrets, scanRisky, parseReport, validateReport, toMarkdown, analyze, demoFiles, entropy } = lib;

// ---- secret detection ---------------------------------------------------------------------------
test('detects well-known credential formats', () => {
  const cases = [
    [`key = "${FAKE.aws}"`, 'aws-key'], [`token: ${FAKE.github}`, 'github-token'], [`const k = '${FAKE.openai}'`, 'openai-key'],
    [`stripe.api_key = "${FAKE.stripeLive}"`, 'stripe-live'], [`SLACK=${FAKE.slack}`, 'slack-token'], [FAKE.privateKey, 'private-key'],
    [`smtp_password = "${FAKE.appPassword}"`, 'app-password'], ['db_password = "Tr0ub4dor&3xK9qL2"', 'assigned-secret'],
  ];
  for (const [line, rule] of cases) assert.deepEqual(scanSecrets('src/app.py', line).map(h => h.rule), [rule], line);
});

test('does not flag placeholders, environment lookups, identifiers or ordinary strings', () => {
  const safe = [
    'password = "changeme123"', 'api_key = "your-api-key-here"', 'token = os.environ["TOKEN_VALUE"]', 'const secret = process.env.SECRET_KEY;',
    'password = "<password>"', 'access_token_expire_minutes = "access_token_expire"', 'AWS_KEY = "AKIAIOSFODNN7EXAMPLE"',
    'password: "${DB_PASSWORD}"', 'token_type = "bearer"', 'const label = "Enter your password"', 'secret = "aaaaaaaaaaaa"',
    'api_key = "https://example.com/key/abcdef123456"', 'password = "dummy-password-for-tests"',
  ];
  for (const line of safe) assert.equal(scanSecrets('src/app.ts', line).length, 0, line);
});

test('findings never contain the secret value, and test or docs paths are downgraded', () => {
  const r = project({ 'src/config.py': `KEY = "${FAKE.aws}"\nPASS = "${FAKE.appPassword.replace(/ /g, '')}"`, 'tests/fixture.py': `KEY = "${FAKE.aws}"` });
  const secrets = kinds(r, 'secret');
  assert.ok(secrets.length >= 2);
  const blob = JSON.stringify(r) + lib.toMarkdown(r);
  for (const value of [FAKE.aws, FAKE.appPassword, FAKE.appPassword.replace(/ /g, '')]) assert.ok(!blob.includes(value), 'secret value leaked into the report');
  const test = secrets.find(f => f.files[0].startsWith('tests/'));
  assert.equal(test.severity, 'warning');
  assert.equal(secrets.find(f => f.files[0] === 'src/config.py').severity, 'error');
});

test('entropy separates random strings from words', () => {
  assert.ok(entropy('aaaaaaaa') < 1);
  assert.ok(entropy('Zx9Qw3Er7Ty1Ui5Op2As') > 4);
});

test('the sample project never contains a literal secret in its source text', () => {
  for (const f of demoFiles) if (!f.path.endsWith('config.py')) assert.equal(scanSecrets(f.path, f.content).length, 0, f.path);
});

// ---- risky constructs -------------------------------------------------------------------------------
test('flags risky constructs per language and ignores them in comments', () => {
  assert.deepEqual(scanRisky('const x = eval(input);', 'js').map(h => h.rule.id), ['eval']);
  assert.deepEqual(scanRisky('el.innerHTML = html;', 'js').map(h => h.rule.id), ['inner-html']);
  assert.deepEqual(scanRisky('import pickle\nobj = pickle.loads(data)', 'python').map(h => h.rule.id), ['unsafe-deserialize']);
  assert.deepEqual(scanRisky('subprocess.run(cmd, shell=True)', 'python').map(h => h.rule.id), ['py-exec']);
  assert.deepEqual(scanRisky('requests.get(u, verify=False)', 'python').map(h => h.rule.id), ['tls-off']);
  assert.deepEqual(scanRisky('char b[8]; strcpy(b, s);', 'c').map(h => h.rule.id), ['c-unsafe']);
  assert.equal(scanRisky('// eval(x)\n/* eval(y) */', 'js').length, 0);
  assert.equal(scanRisky('# eval(x)', 'python').length, 0);
  assert.equal(scanRisky('const medieval = 1; retrieval(2);', 'js').length, 0);
});

// ---- hostile input -----------------------------------------------------------------------------------
test('pathological inputs finish quickly (no catastrophic regex backtracking)', () => {
  const nasty = [
    'import ' + 'a,'.repeat(20000) + 'b', 'from ' + 'x.'.repeat(20000) + ' import ' + 'y '.repeat(20000), '"' .repeat(50000),
    'password = "' + 'a'.repeat(100000) + '"', '#include "' + '../'.repeat(20000) + 'x.h"', 'use ' + 'a::{'.repeat(2000) + '}'.repeat(2000) + ';',
    '/*'.repeat(50000), "'".repeat(50000) + '\n' + '`'.repeat(50000), 'require_relative ' + "'".repeat(30000), ' '.repeat(100000) + 'import x', 'AKIA' + 'Z'.repeat(100000),
  ];
  const files = nasty.map((content, i) => ({ path: `n/f${i}.${['py', 'py', 'py', 'py', 'c', 'rs', 'java', 'go', 'rb', 'py', 'js'][i]}`, size: content.length, content }));
  const t = performance.now();
  analyze(collected(files), 'nasty', () => {}, { layout: false });
  assert.ok(performance.now() - t < 6000, `took ${Math.round(performance.now() - t)} ms`);
});

test('a very deeply nested expression does not crash the analyzer', () => {
  const deep = 'const x = ' + '('.repeat(3000) + '1' + ')'.repeat(3000) + ';\nexport const y = ' + '1+'.repeat(5000) + '1;';
  assert.doesNotThrow(() => project({ 'deep.ts': deep }));
});

test('keys like __proto__ or constructor in paths and names cannot pollute anything', () => {
  const r = project({ '__proto__/a.ts': "import './b'", '__proto__/b.ts': '', 'constructor/prototype.ts': 'export const toString = 1;' });
  assert.equal(r.nodes.length, 3);
  assert.equal(({}).polluted, undefined);
  assert.equal(Object.keys(r.skippedReasons).length, 0);
});

// ---- report import ---------------------------------------------------------------------------------------
const good = () => JSON.parse(JSON.stringify(analyze(collected(demoFiles), 'demo')));

test('a genuine report survives a round trip through the validator', () => {
  const r = good();
  const back = parseReport(JSON.stringify(r));
  assert.equal(back.nodes.length, r.nodes.length);
  assert.deepEqual(back.health, r.health);
  assert.equal(back.findings[0].title, r.findings[0].title);
});

test('malformed or hostile reports are rejected with a clear message', () => {
  const mutate = fn => { const r = good(); fn(r); return JSON.stringify(r); };
  const bad = {
    'not json': '{nope',
    'array': '[]',
    'old version': mutate(r => { r.schemaVersion = 1; }),
    'missing nodes': mutate(r => { delete r.nodes; }),
    'edge to nowhere': mutate(r => { r.edges[0].to = 'ghost.ts'; }),
    'bad severity': mutate(r => { r.findings[0].severity = 'catastrophic'; }),
    'NaN-like coordinate': mutate(r => { r.nodes[0].x = 1e99; }),
    'string where number expected': mutate(r => { r.nodes[0].lines = '12'; }),
    'huge string': mutate(r => { r.findings[0].detail = 'x'.repeat(100000); }),
    'control characters': mutate(r => { r.nodes[0].name = 'a\u0000b'; }),
    'duplicate node ids': mutate(r => { r.nodes[1].id = r.nodes[0].id; }),
    'too many nodes': mutate(r => { r.nodes = Array.from({ length: 30000 }, (_, i) => ({ ...r.nodes[0], id: 'n' + i })); }),
  };
  for (const [name, text] of Object.entries(bad)) assert.throws(() => parseReport(text), Error, name);
  assert.throws(() => parseReport('x'.repeat(lib.MAX_REPORT_BYTES + 1)), /too large/);
});

test('the validator rebuilds reports from known fields, dropping anything extra', () => {
  const r = good();
  r.nodes[0].__proto__ = { polluted: true };
  r.nodes[0].extraneous = '<script>alert(1)</script>';
  r.evil = { constructor: { prototype: { polluted: 1 } } };
  const out = validateReport(JSON.parse(JSON.stringify(r).replace('"extraneous"', '"extraneous"')));
  assert.equal(out.nodes[0].extraneous, undefined);
  assert.equal(out.evil, undefined);
  assert.equal(({}).polluted, undefined);
});

test('fixFirst entries that point at unknown findings are dropped on import', () => {
  const r = good();
  r.fixFirst.push('f-does-not-exist');
  assert.ok(!validateReport(r).fixFirst.includes('f-does-not-exist'));
});

// ---- markdown export --------------------------------------------------------------------------------------
test('markdown export neutralises hostile file names and project names', () => {
  const r = project({ 'src/`;rm -rf|x.ts': "import './b'", 'src/b.ts': 'eval("1")' }, '<img src=x onerror=alert(1)>\n# injected');
  const md = toMarkdown(r);
  assert.ok(!md.includes('<img'));
  assert.ok(!/^# injected/m.test(md));
  assert.ok(!md.includes('`;rm'), 'backticks in paths must not break out of code spans');
});

