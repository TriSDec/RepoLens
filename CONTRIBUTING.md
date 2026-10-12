# Contributing to RepoLens

Thanks for helping. RepoLens is small on purpose and has one non-negotiable rule: **your code never leaves the browser.** Changes that add network access, third-party scripts, analytics or storage of project data will not be merged.

## Set up

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # builds the engine and runs the tests
npm run lint && npm run typecheck
```

Node 20.9 or newer. `npm run dev` rebuilds the analyzer worker first; after changing anything in `lib/repolens/`, run `npm run analyzer:build` if you are only running `next dev` yourself.

## Where things live

| Area | Files |
| --- | --- |
| Analysis engine (no DOM, no network) | `lib/repolens/` |
| Folder scanning and `.gitignore` | `lib/scan.ts`, `lib/gitignore.ts` |
| 3D map renderer | `components/MindMap.tsx`, `lib/map3d.ts` |
| Security headers and CSP | `proxy.ts`, `next.config.ts` |
| Tests | `tests/*.test.mjs` |

## Good first contributions

- A language, framework or alias convention the import resolver misses (add a test with a tiny fixture project).
- A false positive or false negative in a finding. Please include the smallest snippet that shows it; every fixed false positive gets a regression test.
- Documentation, accessibility and mobile polish.

## Pull requests

1. One focused change per PR, with a test when behaviour changes.
2. `npm test`, `npm run lint` and `npm run typecheck` pass. CI also runs a production build and `npm audit --omit=dev`.
3. Keep copy plain and honest: findings are labelled *confirmed* (a fact about the graph) or *review* (a judgement call), and RepoLens never claims to be a security audit.
4. By contributing you agree your work is released under the project's MIT licence.

## Security issues

Please do **not** open a public issue. See [SECURITY.md](SECURITY.md).

## Conduct

Be kind and constructive. See the [Code of Conduct](CODE_OF_CONDUCT.md).
