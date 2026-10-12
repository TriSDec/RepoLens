# RepoLens

**See how your code is connected.** RepoLens turns a project into an interactive 3D map and a short, prioritised list of what needs attention: circular dependencies, exposed credentials, risky code, untested hotspots, directory-level architecture problems and dead weight. It understands JavaScript/TypeScript (plus Vue, Svelte, Astro), Python, Java, Kotlin, Scala, Go, Rust, C/C++, C#, Ruby, PHP, Dart and Swift, and mixed-language repositories.

**Your code never leaves your machine.** Files are read by the browser and analysed in a sandboxed Web Worker. The site ships a Content Security Policy that forbids network connections from the page *and* from the worker, so there is nowhere for the data to go. See [Privacy & security](#privacy--security) for how to verify that yourself.

## What you get

| | |
| --- | --- |
| **A map you can turn** | A hand-written 3D renderer (no WebGL dependency): files are grouped into folder constellations, links fade with depth, and folder-to-folder "trunks" show architecture at a glance. Colour by language, folder, risk or kind. |
| **File relations** | Every file gets a small diagram of its neighbourhood (who imports it on the left, what it imports on the right, arrows following the import), a plain-English summary, line numbers for each import, and Alt+Left / Alt+Right to walk back through the files you visited. |
| **Big projects** | Folders are scanned on your device and `.gitignore` is applied before a folder is opened, so `node_modules` costs nothing. Up to 60,000 files; a live loading screen shows progress; huge maps switch to a lighter drawing mode. After you open a folder with the directory picker, **Rescan** picks up your edits. |
| **Blast radius** | Select a file to see what it uses and what depends on it, light up everything transitively affected, or trace the exact chain of imports between any two files. |
| **Health score** | A transparent 0-100 summary of structural problems, size-adjusted, with every deducted point listed. |
| **Fix first** | The shortest useful to-do list: findings ranked by severity × certainty × how much depends on the files involved. |
| **Credentials** | Detects committed API keys, tokens, private keys and passwords. The value is never stored, shown or exported. |
| **Hotspots** | Change risk per file from blast radius, function complexity, missing test coverage, size and cycles. |
| **Architecture** | Directory coupling and instability, loops between folders, layers leaning the wrong way. |
| **Dead weight** | Unreachable files, unused exports, unused and undeclared packages. |
| **Share** | Export a JSON report (reopenable, validated on load), Markdown summary or PNG of the map. |
| **CLI + CI** | The same engine on the command line: `--fail-on secret`, `--min-score 70`, `--impact <file>`. |

## Run it

```sh
npm install
npm run dev          # http://localhost:3000
```

Production:

```sh
npm run build        # also downloads and self-hosts the fonts
npm start
```

Deploy anywhere that runs Next.js 16 (Vercel needs no configuration). The pages are server-rendered because each response carries a per-request CSP nonce. Set `NEXT_PUBLIC_SITE_URL` (see `.env.example`) so canonical URLs, the sitemap and social tags use your domain.

### Command line

```sh
node bin/repolens.mjs /path/to/project            # summary: health, fix-first list
node bin/repolens.mjs . --md report.md            # shareable Markdown
node bin/repolens.mjs . --json report.json        # open it in the app ("Open a saved report")
node bin/repolens.mjs . --impact src/db/client.ts # what is affected if I change this?
node bin/repolens.mjs . --fail-on secret          # exit 1 on a leaked credential
node bin/repolens.mjs . --min-score 70            # gate CI on health
```

`npm link` (or `npx .`) installs it as `repolens`. The folder's `.gitignore` is respected, symbolic links are never followed, and the tool opens no network connections. A GitHub Actions workflow for this repo lives in `.github/workflows/ci.yml`.

## How it works

```
app/                     Next.js pages: /, /docs, /privacy (+ robots, sitemap, icon)
proxy.ts                 per-request nonce Content-Security-Policy
components/              UI: Landing, RepoLensApp (state), MindMap (3D canvas), Rail, Inspector, Views, CommandPalette
lib/map3d.ts             camera, projection, picking (pure, unit-tested)
lib/repolens/
  analyze.ts             orchestrates one analysis
  languages.ts           import extraction + resolution for every language
  graph.ts               SCC, shortest cycle, blast radius (bitsets), PageRank, articulation points
  secrets.ts risky.ts    credential and risky-construct detection
  metrics.ts insights.ts complexity estimates, health score, risk and priority formulas
  layout3d.ts            folder-constellation force layout
  input.ts schema.ts     safe folder/ZIP collection; strict validation of imported reports
  report.ts cli.ts       Markdown export; command line
tests/                   64 tests: analyzer, languages, security, regressions, 3D maths, CSP
```

JavaScript and TypeScript are parsed with the TypeScript compiler; other languages use comment-aware pattern matching, which is dependable for imports but not a full parser. The analyzer runs in `public/worker/analyzer.js` (built by `npm run analyzer:build`, run automatically by `dev` and `build`).

```sh
npm test               # builds the engine bundle, runs all 64 tests
npm run typecheck
npm run lint
npm run sample:build   # regenerate lib/sample-report.json after changing the analyzer or demo project
```

## Privacy & security

- **No upload path.** Analysis runs in a Web Worker. The page is served with `connect-src 'none'`, and the worker script has its own `default-src 'none'; connect-src 'none'` policy.
- **Only our scripts run.** `script-src 'self' 'nonce-…' 'strict-dynamic'` with a fresh nonce per request; no third-party scripts, analytics or tag managers; fonts self-hosted; `frame-ancestors 'none'`, `form-action 'none'`, `object-src 'none'`.
- **No tracking.** No cookies or accounts. The only stored value is your theme choice in `localStorage`.
- **Reports hold no source.** Exports contain paths and findings. Credential findings record the kind and line, never the value. Imported reports are validated field by field and rebuilt from known keys.
- **Hostile input is expected.** Dependency folders, lockfiles, minified files, hidden files and `.env`/key files are skipped before reading; unsafe paths and ZIP anomalies are rejected; limits cover file count, bytes, archive expansion and run time; regular expressions are tested against pathological input.
- **Dependencies:** five production packages (`next`, `react`, `react-dom`, `fflate`, `typescript`). `npm audit --omit=dev` reports zero known vulnerabilities.

Verify it yourself: open the browser's Network tab while analysing a project (no requests), read the `Content-Security-Policy` response header, and try `fetch('https://example.com')` in the console (blocked). Details and the threat model are on the in-app [privacy page](app/privacy/page.tsx). To report a vulnerability, see [SECURITY.md](SECURITY.md).

## Silencing a reviewed finding

Put `repolens-ignore` in a comment on the line above (or the same line as) a risky-construct finding you have reviewed, and it stops being reported. Risky constructs inside string literals and test files are never reported.

## Limits and honesty

RepoLens is structural analysis. It does not run your code, replace your compiler, tests or a security audit, and its secret and risky-code checks are pattern-based (they can miss things and flag harmless code). Every finding is labelled *confirmed* (a fact about the graph) or *review* (a judgement call). Browser limits: 60,000 files to analyse (after dependencies, build output and anything in `.gitignore` are skipped), 100 MB of text, 1 MB per file, ZIPs up to 100 MB; very large projects switch to a faster import method after 14 seconds so they finish; the CLI defaults to 60,000 files. Computed imports, reflection, macros, dependency injection and build-generated files cannot be traced, and same-package links in Java, Kotlin, Scala, Go and C# are implicit, so they are not drawn.
