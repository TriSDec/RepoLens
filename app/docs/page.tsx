import type { Metadata } from 'next';
import { SiteFooter, SiteHeader } from '@/components/SiteChrome';

export const metadata: Metadata = {
    title: 'Docs',
    description: 'How to use RepoLens: the app, the command line, supported languages, what each finding means, and how scores are calculated.',
    alternates: { canonical: '/docs' },
};

const FINDINGS: [string, string, string][] = [
    ['Credential', 'confirmed / review', 'A value shaped like an API key, token, private key or password appears in source. The value is never stored. Rotate it if real.'],
    ['Cycle', 'confirmed', 'Files import each other in a loop (type-only imports are excluded). The shortest loop is shown.'],
    ['Directory cycle', 'confirmed', 'Directories depend on each other sideways or downward. A child importing from its own parent folder is not counted.'],
    ['Broken import', 'review', 'A relative or aliased import that resolves to no included file.'],
    ['Syntax error', 'confirmed', 'JavaScript/TypeScript the compiler cannot parse, or an invalid package.json.'],
    ['Risky code', 'review', 'eval, raw HTML injection, shell execution, unsafe deserialization, disabled TLS checks, weak hashes and similar. Sometimes legitimate.'],
    ['Complexity', 'confirmed (JS/TS) / review', 'A function with cyclomatic complexity of 15 or more (each branch, loop, case and boolean operator counts one).'],
    ['Untested', 'review', 'A widely-used file that no test file reaches through imports. Shown only when the project has tests.'],
    ['Undeclared package', 'review', 'An imported package that no covering package.json lists.'],
    ['Unused package', 'review', 'A production dependency with no traced import.'],
    ['Unused export', 'review', 'A named export that nothing in the project imports. Library entry points may use it legitimately.'],
    ['Unreachable', 'review', 'No import path connects the file to a recognised entry point. Dynamic loading and framework conventions can cause false positives.'],
    ['Duplicate', 'confirmed', 'Source files with identical text.'],
    ['Layering', 'review', 'A stable directory depending on a volatile one.'],
];

const LANGS: [string, string][] = [
    ['JavaScript, TypeScript, JSX, TSX', 'Parsed with the TypeScript compiler. import, export … from, require, literal import(), type-only edges, tsconfig/jsconfig paths and baseUrl.'],
    ['Vue, Svelte, Astro', 'Script blocks (and Astro frontmatter) are parsed as TypeScript.'],
    ['Python', 'import / from … import, absolute and relative, packages, namespace packages.'],
    ['Java, Kotlin, Scala', 'Imports matched to each file’s package declaration, including static and wildcard imports.'],
    ['Go', 'Import blocks resolved through go.mod module paths to package directories.'],
    ['Rust', 'mod, use (including braced lists), crate::, self::, super::.'],
    ['C, C++', '#include "…" resolved relative to the file, common include directories and unique path suffixes.'],
    ['C#', 'using matched to namespace declarations.'],
    ['Ruby, PHP, Dart, Swift', 'require / require_relative, require / include / use, import / export / part, import.'],
];

export default function Docs() {
    return (
        <>
            <SiteHeader />
            <main id="main" className="page">
                <h1>Docs</h1>
                <p className="lead">RepoLens reads a project and gives you a map of how its files connect, plus a short, prioritised list of things worth a look.</p>

                <h2>Using the app</h2>
                <ol>
                    <li><strong>Open a project.</strong> Choose a folder, pick a ZIP, or drop either anywhere on the page. Dropped folders skip <code>node_modules</code>, <code>.git</code> and build output automatically.</li>
                    <li><strong>Turn the map.</strong> Drag to rotate, scroll to zoom, shift-drag to pan, double-click a file to centre it. Files are grouped by folder into labelled constellations; colour them by language, folder, risk or kind.</li>
                    <li><strong>Select a file</strong> to see its neighbours: what it imports (teal) and what imports it (gold). Use <em>What depends on it</em> to light up its full blast radius, or <em>Trace path to…</em> to show the exact chain of imports between two files.</li>
                    <li><strong>Work the list.</strong> “Fix first” in the left rail is the shortest useful to-do list. Findings, Hotspots, Architecture and Packages give the full picture.</li>
                    <li><strong>Share.</strong> Export a JSON report (reopenable here), a Markdown summary, or a PNG of the map. Press <kbd>Ctrl</kbd> <kbd>K</kbd> for the command palette.</li>
                </ol>

                <h2>Command line</h2>
                <pre className="code"><code>{`npx repolens [path] [options]

--json <file>      write the full report (open it later in the app)
--md <file>        write a Markdown summary
--impact <file>    list every file affected by changing <file>
--fail-on <level>  exit 1 on: secret | error | warning | cycle
--min-score <n>    exit 1 when the health score is below n
--max-files <n>    analyse up to n files (default 5000)
--no-gitignore     do not apply the project's .gitignore`}</code></pre>
                <p>The folder’s <code>.gitignore</code> is respected by default, symbolic links are never followed, and the tool makes no network connections.</p>
                <h3>In CI</h3>
                <pre className="code"><code>{`# .github/workflows/repolens.yml
- uses: actions/checkout@v4
- uses: actions/setup-node@v4
  with: { node-version: 22 }
- run: npx repolens . --fail-on secret --min-score 70 --md repolens.md`}</code></pre>

                <h2>Supported languages</h2>
                <table><thead><tr><th>Language</th><th>How imports are found</th></tr></thead><tbody>{LANGS.map(([l, d]) => <tr key={l}><td><strong>{l}</strong></td><td>{d}</td></tr>)}</tbody></table>
                <p>Other languages’ files are not analysed in depth. Only JavaScript/TypeScript is parsed by a real compiler; the rest use comment-aware pattern matching, which is dependable for imports but not a full parser.</p>

                <h2>What each finding means</h2>
                <p>Every finding is labelled <em>confirmed</em> (a fact about the graph) or <em>review</em> (a judgement call that needs a human). Findings are ordered by a priority that multiplies severity and certainty by how much of the project depends on the files involved.</p>
                <table><thead><tr><th>Finding</th><th>Certainty</th><th>Meaning</th></tr></thead><tbody>{FINDINGS.map(([k, c, d]) => <tr key={k}><td><strong>{k}</strong></td><td>{c}</td><td>{d}</td></tr>)}</tbody></table>

                <h2>How scores are calculated</h2>
                <h3>Health score</h3>
                <p>Start at 100 and subtract capped penalties for: exposed credentials (up to 30), syntax errors (15), circular dependencies (18), broken imports (8), risky constructs (8), complex functions (8), untested or untested-project (8), duplicates (6) and unused code (6). Except for credentials and syntax errors, penalties are divided by a size factor (the square root of the number of code files over 20, between 1 and 4), so a large project is not punished for simply being large. Every deduction is listed in the app under “How it is scored”. Grades: A ≥ 90, B ≥ 80, C ≥ 70, D ≥ 55, otherwise E.</p>
                <h3>Change risk (per file)</h3>
                <p><code>38%</code> blast radius (how many files are affected, on a log scale) + <code>27%</code> complexity of the most complex function + <code>15%</code> not reached by any test + <code>10%</code> size + <code>10%</code> being part of a cycle. It is a prompt for where to look first, not a prediction.</p>
                <h3>Blast radius and centrality</h3>
                <p>Blast radius counts every file that depends on a file directly or through any chain of imports, each counted once. Centrality is PageRank over the import graph: high when important files lean on it.</p>

                <h2>Report format</h2>
                <p>Reports are JSON with <code>schemaVersion: 2</code>: <code>nodes</code> (files with metrics and 3D positions), <code>edges</code>, <code>findings</code>, <code>folders</code>, <code>folderEdges</code>, <code>externals</code>, <code>health</code> and <code>fixFirst</code>. They contain paths and findings only, never source text or secret values. When you open one, it is validated against strict bounds before use.</p>

                <h2>Limits</h2>
                <ul>
                    <li>Browser: 60,000 files, 100 MB readable text, 1 MB per file, ZIP up to 100 MB. Dependencies, build output and (optionally) <code>.gitignore</code>d files are skipped before reading. Over the limit, you get an error straight away and can open a subfolder or use the command line.</li>
                    <li>Command line: 60,000 files by default (<code>--max-files</code>).</li>
                    <li>Computed imports, reflection, dependency injection, macros, package export maps and build-generated files cannot be traced.</li>
                    <li>Java, Kotlin, Scala, Go and C# files in the same package or namespace see each other without imports; those links are not drawn.</li>
                </ul>
            </main>
            <SiteFooter />
        </>
    );
}
