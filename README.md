# RepoLens

An interactive dependency explorer for small JavaScript and TypeScript projects. Source files are parsed locally in a disposable browser worker. There is no source upload endpoint, project database, or AI service.

## Run locally

Node 22.13+ and pnpm are required. Install the locked dependencies, build the analyzer, and start the app:

```sh
pnpm install --frozen-lockfile
pnpm analyzer:build
pnpm dev
```

## Deploy to Vercel

Sign into Vercel with the account/email that should own this project. Import this folder through a Git repository, or run `npx vercel` from this folder and select the intended account/team. Select the Next.js framework preset; the build command is `pnpm build`. No environment variables or source-upload storage are needed.

This edition uses native Next.js for development, production builds, and hosting. Vercel account ownership is separate from the email used in ChatGPT. The original ChatGPT-hosted site is a separate deployment. Configure the Vercel project's audience before sharing its URL; the original site's private access policy does not transfer.

```sh
pnpm test
pnpm typecheck
pnpm build
```

## What works

- Folder selection and ZIP import; drag and drop for ZIP files.
- Searchable file explorer and draggable dependency diagram with zoom, pan, fit, focus, and minimap.
- Direct imports, reverse dependencies, and transitive change impact.
- Literal ES imports, reexports, CommonJS `require`, dynamic literal imports, and explicit type-only edges.
- Relative imports, directory indexes, common JavaScript-to-TypeScript extension resolution, and directly declared tsconfig/jsconfig aliases.
- Parse errors, unresolved local imports, runtime dependency cycles, exact duplicate source files, repeated imports, large files/assets, and review suggestions for disconnected files or production packages with no traced import.
- JSON report export; reports contain paths and findings, never full source files.
- A 23-file sample project with an intentional cycle, duplicate implementation, and legacy branch.

## Architecture

`app/page.tsx` owns the transient UI state. `components/repolens-graph.tsx` implements the SVG canvas, camera, node dragging, keyboard selection, and touch gestures.

`lib/repolens/input.ts` validates project paths, filters generated and common sensitive files before reading, and limits archive expansion. `analyzer.worker.ts` runs collection and analysis in a separate browser thread. `analyze.ts` walks TypeScript syntax trees, builds a directed graph, finds strongly connected components with Tarjan's algorithm, and computes a layout. `types.ts` contains breadth-first dependency and impact tracing.

The analyzer worker is bundled separately into `public/worker/analyzer.js`; rebuild it after changing analyzer source. The hosted server only delivers the app and its assets.

## Privacy and security design

- The app does not submit source, paths, or findings to a server or model, and does not use project localStorage or IndexedDB.
- Imported code is treated as text. No eval, HTML rendering, package installation, or project command execution.
- No remote fonts, client analytics, third-party scripts, or externally hosted parser code.
- Production Content Security Policy disallows fetch/XHR/WebSocket connections, objects, form submission, and embedding. Framework hydration requires inline scripts; source text is never inserted as HTML.
- The worker is terminated after analysis or cancellation, and a 40-second watchdog bounds analysis time.
- Common `.env` and key files, dependency/build folders, lockfiles, and source maps are skipped. Secrets inside ordinary source files cannot be identified automatically, but those files remain local too.
- Maximum 1,000 included files; 25 MiB readable content; 1 MiB per text file. ZIPs are limited to 25 MiB compressed and 50 MiB declared expansion. Decoded text has a separate actual-byte bound. At most 15,000 graph edges and 5,000 findings are returned.
- Absolute paths, path traversal, control characters, and duplicate paths are rejected. Invalid ZIP formats fail closed.
- The site host may still see routine requests for the application and assets. Browser extensions, a compromised device, and a compromised app delivery origin are outside this protection.

## Important analysis limits

This is a structural static analyzer, not a type checker, vulnerability scanner, profiler, or energy meter. A parseable project may still fail at runtime. Cycles are real graph relationships, not necessarily bugs. A file outside recognized entry paths or package without a literal import is a review suggestion, not proof that it can be deleted.

Computed imports, package export/import maps, inherited tsconfig aliases, CSS import graphs, and custom framework resolution are not fully modeled. Disk bytes are not bundle bytes or proven performance savings. Only exact textual duplicate code is detected, not semantically equivalent code. Type imports are visible but excluded from runtime cycle detection.

The analyzer is scoped to JS/TS/JSX/TSX and their common module extensions. Other assets are represented by metadata only.

## Validation

`pnpm test` checks syntax-aware import extraction, type-only cycle exclusion, alias/index resolution, parse diagnostics, transitive influence, secret exclusion before reads, unsafe archive paths, ZIP collection, expansion limits, file count limits, and a full 1,000-file fixture.

The application and analyzer are intentionally split so algorithm correctness can be tested separately from interaction behavior.
