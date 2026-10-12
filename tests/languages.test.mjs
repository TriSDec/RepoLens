import assert from 'node:assert/strict';
import { test } from 'node:test';
import { edgeSet, kinds, project } from './helpers.mjs';

test('Python: absolute, relative, submodule and namespace-package imports resolve; stdlib ignored; comments and docstrings skipped', () => {
  const r = project({ 'app/main.py': "import os\nimport requests\nfrom app import utils\nfrom .models import User\n# import ghost\n\"\"\"\nimport phantom\n\"\"\"\nfrom app.services.billing import charge", 'app/__init__.py': '', 'app/utils.py': 'x=1', 'app/models.py': 'class User: pass', 'app/services/__init__.py': '', 'app/services/billing.py': 'from ..models import User\ndef charge(): pass' });
  const e = edgeSet(r);
  for (const x of ['app/main.py->app/utils.py', 'app/main.py->app/models.py', 'app/main.py->app/services/billing.py', 'app/services/billing.py->app/models.py']) assert.ok(e.has(x), x);
  assert.deepEqual(r.packages, ['requests']);
  assert.equal(kinds(r, 'unresolved').length, 0);
  const ns = project({ 'svc/main.py': 'from svc.handlers import auth', 'svc/handlers/auth.py': 'x=1' });
  assert.ok(edgeSet(ns).has('svc/main.py->svc/handlers/auth.py'), 'namespace packages without __init__.py');
});

test('Python: circular imports are reported and a missing relative import is flagged', () => {
  const r = project({ 'main.py': 'import a', 'a.py': 'import b\nfrom . import missing_thing', 'b.py': 'import a' });
  assert.equal(kinds(r, 'cycle').length, 1);
  assert.equal(kinds(r, 'unresolved').length, 1);
});

test('Java and Kotlin: class imports, wildcard packages and nested/static members resolve by package', () => {
  const r = project({ 'src/main/java/com/acme/App.java': 'package com.acme;\nimport com.acme.util.Strings;\nimport static com.acme.util.Strings.trim;\nimport com.acme.model.*;\nimport java.util.List;\nimport org.springframework.boot.SpringApplication;\npublic class App { public static void main(String[] a){} }', 'src/main/java/com/acme/util/Strings.java': 'package com.acme.util;\npublic class Strings {}', 'src/main/java/com/acme/model/User.java': 'package com.acme.model;\npublic class User {}', 'src/main/kotlin/com/acme/Extra.kt': 'package com.acme\nimport com.acme.util.Strings' });
  const e = edgeSet(r);
  assert.ok(e.has('src/main/java/com/acme/App.java->src/main/java/com/acme/util/Strings.java'));
  assert.ok(e.has('src/main/java/com/acme/App.java->src/main/java/com/acme/model/User.java'));
  assert.ok(e.has('src/main/kotlin/com/acme/Extra.kt->src/main/java/com/acme/util/Strings.java'));
  assert.deepEqual(r.packages, ['org.springframework']);
});

test('Go: module-local package imports link to every file in the directory; stdlib ignored', () => {
  const r = project({ 'go.mod': 'module example.com/app\n\ngo 1.22', 'cmd/main.go': 'package main\nimport (\n\t"fmt"\n\t"example.com/app/internal/db"\n\t"github.com/gin-gonic/gin"\n)\nfunc main(){}', 'internal/db/conn.go': 'package db', 'internal/db/query.go': 'package db\nimport "example.com/app/internal/db/missing"' });
  const e = edgeSet(r);
  assert.ok(e.has('cmd/main.go->internal/db/conn.go') && e.has('cmd/main.go->internal/db/query.go'));
  assert.deepEqual(r.packages, ['github.com/gin-gonic/gin']);
  assert.equal(kinds(r, 'unresolved').length, 1);
  assert.ok(!kinds(r, 'unreachable').length);
});

test('Rust: mod declarations, crate/super/self paths and braced use lists', () => {
  const r = project({ 'src/main.rs': 'mod config;\nmod net;\nuse crate::net::{client::Client, server};\nuse serde::Serialize;\nuse std::fmt;', 'src/config.rs': 'use super::net::client::Client;', 'src/net/mod.rs': 'pub mod client;\npub mod server;', 'src/net/client.rs': 'use crate::config;', 'src/net/server.rs': '' });
  const e = edgeSet(r);
  for (const x of ['src/main.rs->src/config.rs', 'src/main.rs->src/net/mod.rs', 'src/main.rs->src/net/client.rs', 'src/main.rs->src/net/server.rs', 'src/net/mod.rs->src/net/client.rs', 'src/net/client.rs->src/config.rs']) assert.ok(e.has(x), x);
  assert.deepEqual(r.packages, ['serde']);
});

test('C/C++: quoted includes resolve relative, via include dirs and by suffix; system headers ignored', () => {
  const r = project({ 'src/main.cpp': '#include <vector>\n#include "util.h"\n#include "core/engine.h"\nint main(){}', 'src/util.h': '#pragma once', 'include/core/engine.h': '#include "../missing.h"' });
  const e = edgeSet(r);
  assert.ok(e.has('src/main.cpp->src/util.h') && e.has('src/main.cpp->include/core/engine.h'));
  assert.equal(kinds(r, 'unresolved').length, 1);
});

test('C#, Ruby, PHP and Dart imports resolve', () => {
  const r = project({ 'Program.cs': 'using System;\nusing Acme.Core;\nclass P { static void Main(){} }', 'Core/Thing.cs': 'namespace Acme.Core { class Thing {} }', 'lib/app.rb': "require 'json'\nrequire 'rails'\nrequire_relative 'helper'\nrequire 'tools/util'", 'lib/helper.rb': '', 'lib/tools/util.rb': '', 'public/index.php': "<?php\nrequire __DIR__ . '/../src/Db.php';\nuse App\\Models\\User;", 'src/Db.php': '<?php', 'app/Models/User.php': '<?php', 'lib/main.dart': "import 'dart:io';\nimport 'src/a.dart';\nimport 'package:http/http.dart';", 'lib/src/a.dart': '' });
  const e = edgeSet(r);
  for (const x of ['Program.cs->Core/Thing.cs', 'lib/app.rb->lib/helper.rb', 'lib/app.rb->lib/tools/util.rb', 'public/index.php->src/Db.php', 'public/index.php->app/Models/User.php', 'lib/main.dart->lib/src/a.dart']) assert.ok(e.has(x), x);
  assert.ok(r.packages.includes('rails') && r.packages.includes('http') && !r.packages.includes('json'));
});

test('Vue, Svelte and Astro scripts are analysed; a mixed-language project reports a language breakdown', () => {
  const r = project({ 'src/main.ts': "import App from './App.vue';\nimport Page from './Page.svelte';", 'src/App.vue': '<template><b/></template>\n<script setup lang="ts">\nimport { helper } from \'./helper\';\n</script>', 'src/Page.svelte': "<script>import { helper } from './helper';</script>", 'src/helper.ts': 'export const helper=1', 'server/app.py': 'import os' });
  const e = edgeSet(r);
  assert.ok(e.has('src/main.ts->src/App.vue') && e.has('src/App.vue->src/helper.ts') && e.has('src/Page.svelte->src/helper.ts'));
  assert.deepEqual(r.languages.map(l => l.lang).sort(), ['js', 'python']);
});

test('unreachable code is reported only for languages with recognised entry points', () => {
  const r = project({ 'main.py': 'import used', 'used.py': '', 'orphan.py': '', 'lib/Thing.rb': 'class Thing; end' });
  assert.deepEqual(kinds(r, 'unreachable').map(x => x.files[0]), ['orphan.py']);
});

test('new ignore rules skip virtualenvs, build output and language lockfiles', async () => {
  const { lib } = await import('./helpers.mjs');
  for (const p of ['repo/.venv/lib/x.py', 'repo/__pycache__/a.pyc', 'repo/target/debug/a.rs', 'repo/obj/Debug/a.cs', 'repo/Cargo.lock', 'repo/poetry.lock', 'repo/app.min.js']) assert.ok(lib.exclusion(p), p);
});

test('test files are recognised across ecosystems', async () => {
  const { lib } = await import('./helpers.mjs');
  for (const p of ['src/a.test.ts', 'tests/x.py', 'pkg/test_models.py', 'svc/handler_test.go', 'src/test/java/AppTest.java', 'spec/user_spec.rb', 'src/__tests__/a.tsx', 'App.Tests/Foo.cs'])
    assert.ok(lib.isTestPath(p), p);
  for (const p of ['src/latest.ts', 'src/contest.py', 'src/attestation/a.ts']) assert.ok(!lib.isTestPath(p), p);
});
