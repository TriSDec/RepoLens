# RepoLens

See how any codebase fits together. RepoLens turns a project into an interactive dependency map and a short list of structural findings — circular dependencies, broken imports, duplicate files, files nothing seems to use, and "if I change this, what breaks?" impact tracing.

It works on **JavaScript / TypeScript** (including Vue, Svelte and Astro), **Python, Java, Kotlin, Scala, Go, Rust, C / C++, C#, Ruby, PHP, Dart and Swift**, and mixed-language repositories. Everything is analyzed on your machine — nothing is uploaded.

## Quick start

**Command line** (no browser needed):

```sh
npm install
node bin/repolens.mjs /path/to/project            # summary in the terminal
node bin/repolens.mjs . --md report.md            # shareable Markdown report
node bin/repolens.mjs . --json report.json        # full machine-readable report
node bin/repolens.mjs . --impact src/db/client.ts # what is affected if I change this file?
node bin/repolens.mjs . --fail-on cycle           # exit 1 if a cycle exists (CI)
```

`npm link` (or `npx .`) makes the `repolens` command available everywhere. The folder's `.gitignore` is respected by default (`--no-gitignore` to disable). Run `repolens --help` for all options.

**Web app** (interactive map):

```sh
npm install
npm run dev        # http://localhost:3000
```

Choose a folder or drop a ZIP. The sample project loads automatically so you can explore before opening your own code.

## What you get

- A draggable dependency diagram with zoom, pan, fit, focus and minimap, plus a searchable file explorer.
- Direct imports, reverse dependencies and transitive **change impact** for any file.
- Findings with severity and confidence: runtime cycles, unresolved local imports, syntax errors (JS/TS), duplicate files, repeated imports, large files, high-coupling modules, files outside known entry points, and production packages with no traced import.
- Per-language breakdown, external-package list, and JSON or Markdown export (paths and findings only — never source text).

## How each language is understood

| Language | Imports recognised | Resolution |
| --- | --- | --- |
| JS / TS / JSX / TSX / Vue / Svelte / Astro | `import`, `export … from`, `require`, literal `import()`, type-only edges | Relative paths, directory indexes, tsconfig/jsconfig `paths` and `baseUrl`; parsed with the TypeScript compiler |
| Python | `import`, `from … import` (absolute and relative) | Modules, packages, `__init__.py`, submodules; stdlib ignored |
| Java / Kotlin / Scala | `import` (incl. static and wildcard) | Matched to the `package` declaration of each file |
| Go | `import` blocks | `go.mod` module path → package directory |
| Rust | `mod`, `use` (incl. braced lists), `extern crate` | `crate::`, `self::`, `super::`, `foo.rs` / `foo/mod.rs` |
| C / C++ | `#include "…"` | Relative, common include dirs, unique path-suffix match |
| C# | `using` | Matched to `namespace` declarations |
| Ruby | `require`, `require_relative`, `load` | Relative and `lib/` / `app/` lookup |
| PHP | `require`/`include`, `use` | Relative paths and namespace-to-path matching |
| Dart | `import`, `export`, `part` | Relative and `package:` of the local pubspec |
| Swift | `import` | Module names listed as external packages |

Non-JS/TS languages use comment-aware pattern matching rather than a full parser. In Java, Kotlin, Scala, Go and C#, files in the same package/namespace see each other without imports, so those links are not drawn (but are used when deciding whether a file is reachable).

## Limits and honest caveats

This is a structural static analyzer — not a type checker, vulnerability scanner or profiler. A cycle is a real graph relationship, not necessarily a bug. "Outside known entry paths" and "package with no traced import" are review prompts, not proof that something can be deleted. Computed imports, reflection, dependency injection, package export maps, macros, build-generated files and custom resolvers are not modelled. Only exact textual duplicates are detected.

Browser limits: 1,000 included files, 25 MiB of readable content, 1 MiB per text file; ZIPs 25 MiB compressed / 50 MiB expanded. The CLI default is 5,000 files (`--max-files`).

## Privacy

- The web app parses files in a disposable browser worker. It never sends source, paths or findings to a server, and uses no analytics, remote fonts or third-party scripts. The production Content Security Policy forbids network connections from the page.
- The CLI reads files locally and writes only the outputs you request.
- Imported code is treated as text: nothing is executed, rendered as HTML or installed.
- Dependency/build folders (`node_modules`, `.venv`, `target`, `dist`, …), lockfiles, source maps, minified files, hidden files and common secret files (`.env`, `*.pem`, keys, …) are skipped before reading. Absolute paths, path traversal and unsafe ZIP entries are rejected.

## Deploy

It is a standard Next.js app: `npm run build && npm start`, or import the repository into Vercel (framework preset: Next.js, build command `npm run build`). No environment variables or storage are needed.

## Development

```sh
npm test            # analyzer + language + ZIP/limits tests
npm run typecheck
npm run analyzer:build   # rebuild public/worker/analyzer.js (also run by dev/build)
npm run cli:build        # rebuild dist-cli/cli.mjs
```

```
app/                     Next.js UI (page.tsx holds the workspace state)
components/              graph canvas and the few shadcn/ui primitives in use
lib/repolens/
  analyze.ts             graph, cycles (Tarjan), findings, layout
  languages.ts           per-language import extraction and resolution
  input.ts               folder/ZIP collection, exclusions, limits
  report.ts              Markdown export
  cli.ts                 command-line entry (bundled to dist-cli/)
  analyzer.worker.ts     browser worker entry (bundled to public/worker/)
tests/run.mjs            test suite
```
