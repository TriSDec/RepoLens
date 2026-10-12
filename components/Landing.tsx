'use client';
import Icon, { Mark } from './Icon';
import MindMap from './MindMap';
import type { Status } from '@/lib/useAnalysis';
import type { Report } from '@/lib/repolens/types';

type Props = {
    sample: Report | null;
    status: Status;
    dragging: boolean;
    onPick: (kind: 'folder' | 'zip' | 'report') => void;
    onSample: () => void;
    gitignore: boolean;
    onGitignore: (value: boolean) => void;
    canPickDirectory: boolean;
    onTheme: () => void;
    theme: 'ink' | 'paper';
};

const FEATURES: [string, string, string][] = [
    ['A map you can turn', 'Every import becomes a line between files. Folders gather into constellations, so the shape of a project shows at a glance: the tight clusters, the long bridges, the loners.', 'layers'],
    ['What breaks if I touch this?', 'Select any file to see everything that depends on it, directly or indirectly, and trace the exact chain of imports that links any two files.', 'target'],
    ['Where the risk hides', 'Files are ranked by blast radius, complexity, missing tests and circular dependencies, so you know where a mistake would cost the most.', 'warn'],
    ['Secrets in the source', 'Finds API keys, tokens, private keys and passwords committed to code. The value itself is never stored, shown or exported.', 'key'],
    ['Architecture, not just files', 'Directory-level coupling and stability, loops between folders, and layers that lean the wrong way. The structure you meant to build, checked against the one you built.', 'box'],
    ['Dead weight', 'Unreachable files, exports nobody imports, packages nothing uses, and imports no manifest declares, each marked as confirmed or needs review.', 'cycle'],
];

const LANGS = ['JavaScript', 'TypeScript', 'Vue', 'Svelte', 'Astro', 'Python', 'Java', 'Kotlin', 'Scala', 'Go', 'Rust', 'C', 'C++', 'C#', 'Ruby', 'PHP', 'Dart', 'Swift'];

const FAQ: [string, string][] = [
    ['Is my code uploaded anywhere?', 'No. Files are read by your browser and analysed in a Web Worker on your device. The site sends a strict Content Security Policy that forbids network connections from the page and from the worker, so there is nowhere for the data to go. You can confirm it in your browser’s network tab while an analysis runs.'],
    ['How accurate is it?', 'JavaScript and TypeScript are parsed with the real TypeScript compiler. Other languages use comment-aware pattern matching, which is reliable for imports but not a full parser. Findings are labelled “confirmed” when they are facts about the graph (a cycle, a syntax error) and “review” when they are judgement calls (possibly unused code). Nothing here replaces your compiler, tests or a security audit.'],
    ['What are the limits?', 'In the browser: up to 60,000 files to analyse (after skipping dependencies, build output and anything in .gitignore), 100 MB of readable text and 1 MB per file; ZIPs up to 100 MB. Most large projects finish in well under 30 seconds. If one is over the limit you are told straight away, before anything is read, and can open a subfolder or use the command-line tool.'],
    ['Can I share what I find?', 'Yes. Export a JSON report, a Markdown summary or a PNG of the map. Reports hold paths and findings only, and anyone can open a saved report here without access to your code.'],
    ['What does the health score mean?', 'It is a transparent, size-adjusted summary of structural problems: exposed credentials, syntax errors, cycles, broken imports, risky constructs, complexity, missing tests, duplication and unused code. Every point deducted is listed and explained. It describes structure, not quality or security as a whole.'],
];

export default function Landing({ sample, status, dragging, onPick, onSample, gitignore, onGitignore, canPickDirectory, onTheme, theme }: Props) {
    return (
        <div className="landing">
            <header className="site-header">
                <span className="wordmark"><Mark /><span>RepoLens</span></span>
                <nav aria-label="Site">
                    <a href="/docs">Docs</a>
                    <a href="/privacy">Privacy &amp; security</a>
                    <button className="icon-btn" onClick={onTheme} aria-label={theme === 'ink' ? 'Switch to the light paper theme' : 'Switch to the dark ink theme'}><Icon name={theme === 'ink' ? 'sun' : 'moon'} /></button>
                </nav>
            </header>

            <main id="main">
                <section className="hero">
                    <div className="hero-copy">
                        <p className="eyebrow"><span className="rule" />A cartographer for codebases</p>
                        <h1 className="display">See how your code is <em>connected.</em></h1>
                        <p className="lede">RepoLens turns any project into a map you can turn in your hands: what depends on what, what breaks if you touch it, and what quietly needs attention. It reads your files in your browser and never uploads a line.</p>

                        <div className={`dropzone corners${dragging ? ' is-dragging' : ''}`}>
                            <p className="dz-title">{dragging ? 'Release to analyse' : 'Drop a folder or ZIP anywhere'}</p>
                            <div className="dz-actions">
                                <button className="btn btn-primary" onClick={() => onPick('folder')} disabled={status.busy}>Open a folder <Icon name="arrow" size={16} /></button>
                                <button className="btn" onClick={() => onPick('zip')} disabled={status.busy}>Choose a ZIP</button>
                            </div>
                            <label className="check"><input type="checkbox" checked={gitignore} onChange={e => onGitignore(e.target.checked)} /> Skip files listed in the project’s <code>.gitignore</code></label>
                            <p className="dz-note">Dependencies, build output and secret files are always skipped. Read on this device; nothing is uploaded.{!canPickDirectory && ' For big projects, dropping the folder here is much faster than the folder chooser in this browser.'}</p>
                        </div>
                        {status.error && <p className="notice" role="alert"><Icon name="warn" size={16} />{status.error}</p>}
                        <p className="hero-links">
                            <button className="link" onClick={onSample} disabled={!sample}>Explore the sample project</button>
                            <span aria-hidden="true">·</span>
                            <button className="link" onClick={() => onPick('report')}>Open a saved report</button>
                        </p>
                    </div>

                    <figure className="hero-map">
                        {sample ? <MindMap report={sample} selected={null} autoRotate showLabels colorBy="language" ariaLabel="Interactive 3D map of the sample project. Drag to rotate, scroll to zoom." /> : <div className="hero-skeleton" aria-hidden="true" />}
                        <figcaption>The sample: a React app, a Python API and a Go worker. Drag to turn it.</figcaption>
                    </figure>
                </section>

                <section className="section" aria-labelledby="s1">
                    <h2 id="s1" className="section-title"><span className="numeral">I.</span> What it finds</h2>
                    <ol className="features">
                        {FEATURES.map(([title, body, icon], i) => (
                            <li key={title}>
                                <span className="feature-no">{String(i + 1).padStart(2, '0')}</span>
                                <Icon name={icon as 'layers'} size={22} />
                                <h3>{title}</h3>
                                <p>{body}</p>
                            </li>
                        ))}
                    </ol>
                </section>

                <section className="section" aria-labelledby="s2">
                    <h2 id="s2" className="section-title"><span className="numeral">II.</span> Every language, one map</h2>
                    <p className="section-lede">Projects are rarely written in one language, so RepoLens reads them side by side. Imports are followed across files, packages and namespaces, and a React front end, a Python service and a Go worker appear on the same map.</p>
                    <ul className="langs" aria-label="Supported languages">{LANGS.map(l => <li key={l}>{l}</li>)}</ul>
                </section>

                <section className="section split" aria-labelledby="s3">
                    <div>
                        <h2 id="s3" className="section-title"><span className="numeral">III.</span> Private by construction</h2>
                        <p className="section-lede">Most tools ask you to trust a promise. RepoLens is built so the promise is enforced by your browser.</p>
                        <a className="link" href="/privacy">Read the security notes</a>
                    </div>
                    <ul className="promises">
                        <li><strong>No upload path exists.</strong> Files are read locally and analysed in a sandboxed worker. The page and the worker are forbidden from making network connections at all.</li>
                        <li><strong>Nothing to track you.</strong> No accounts, cookies, analytics or third-party scripts. Fonts are served from this site.</li>
                        <li><strong>Reports hold no source.</strong> Exports contain paths and findings. Secret values are never captured, so they cannot leak into a report.</li>
                        <li><strong>Hostile input is expected.</strong> Archive size, file count and path checks, and a time limit, bound what any project can do.</li>
                    </ul>
                </section>

                <section className="section split" aria-labelledby="s4">
                    <div>
                        <h2 id="s4" className="section-title"><span className="numeral">IV.</span> From the terminal</h2>
                        <p className="section-lede">The same engine runs in your build. Fail a pull request on a leaked secret or a falling score, and open the saved report here to explore what changed.</p>
                    </div>
                    <pre className="code" aria-label="Command-line examples"><code>{`npx repolens .                       # summary
repolens . --md report.md            # shareable Markdown
repolens . --json report.json        # open it in the app
repolens . --impact src/db/client.ts # who is affected?
repolens . --fail-on secret          # exit 1 on a leaked key
repolens . --min-score 70            # gate CI on health`}</code></pre>
                </section>

                <section className="section" aria-labelledby="s5">
                    <h2 id="s5" className="section-title"><span className="numeral">V.</span> Questions</h2>
                    <div className="faq">
                        {FAQ.map(([q, a]) => (
                            <details key={q}><summary>{q}</summary><p>{a}</p></details>
                        ))}
                    </div>
                </section>
            </main>

            <footer className="site-footer">
                <span className="wordmark"><Mark size={20} /><span>RepoLens</span></span>
                <nav aria-label="Footer"><a href="/docs">Docs</a><a href="/privacy">Privacy &amp; security</a><a href="https://github.com/TriSDec/RepoLens" rel="noopener noreferrer">Source on GitHub</a></nav>
                <p>Structural analysis only. RepoLens does not run your code, replace your compiler or tests, or constitute a security audit.</p>
            </footer>
        </div>
    );
}
