import type { Metadata } from 'next';
import { SiteFooter, SiteHeader } from '@/components/SiteChrome';

export const metadata: Metadata = {
    title: 'Privacy & security',
    description: 'Exactly what RepoLens does with your files (nothing leaves your browser), how that is enforced, and how to verify it yourself.',
    alternates: { canonical: '/privacy' },
};

export default function Privacy() {
    return (
        <>
            <SiteHeader />
            <main id="main" className="page">
                <h1>Privacy &amp; security</h1>
                <p className="lead">RepoLens is built so that your source code has no route off your machine. This page explains what that means, how it is enforced, and how you can check it yourself instead of taking our word for it.</p>

                <h2>What happens to your files</h2>
                <p>When you open a folder, drop a ZIP or load a saved report, your browser reads the files and hands them to a <strong>Web Worker</strong>, a separate sandboxed thread on your own device. The worker parses the code, builds the graph and returns a result to the page. There is no upload endpoint, no database and no account. The server only delivers the app itself.</p>
                <p>Code is treated as text. It is never executed, rendered as HTML, installed, or given to any other service.</p>
                <p>If a browser cannot start the worker (some locked-down browsers and extensions block them), RepoLens runs the same analysis on the page’s own thread instead. It is just as local, and the page’s policy still forbids all network connections; only the sandbox boundary of the separate thread is lost.</p>

                <h2>How the “no network” promise is enforced</h2>
                <ul>
                    <li><strong>The page cannot connect anywhere.</strong> Every response carries a <code>Content-Security-Policy</code> with <code>connect-src &apos;none&apos;</code>, so the browser itself blocks <code>fetch</code>, XHR, WebSocket and beacon requests from the page.</li>
                    <li><strong>The analyzer cannot either.</strong> The worker script is served with its own policy (<code>default-src &apos;none&apos;; connect-src &apos;none&apos;</code>), independent of the page. Even a compromised analyzer could not send data out.</li>
                    <li><strong>Only our scripts can run.</strong> Scripts need a fresh random nonce on every request (<code>script-src &apos;nonce-…&apos; &apos;strict-dynamic&apos;</code>), which blocks injected scripts. There are no third-party scripts, analytics, or tag managers, and fonts are served from this site.</li>
                    <li><strong>It cannot be framed or tricked into posting.</strong> <code>frame-ancestors &apos;none&apos;</code> and <code>form-action &apos;none&apos;</code>; the page is also sent with <code>X-Frame-Options: DENY</code>, <code>Referrer-Policy: no-referrer</code>, <code>X-Content-Type-Options: nosniff</code>, strict transport security, and a Permissions-Policy that disables the camera, microphone, location and similar APIs.</li>
                </ul>

                <h2>Verify it yourself</h2>
                <ol>
                    <li>Open your browser’s developer tools and switch to the <strong>Network</strong> tab.</li>
                    <li>Analyze a project. You will see the page, scripts and fonts load once, and <strong>no requests at all</strong> while your files are being read and analysed.</li>
                    <li>Click the document request and read its <strong>Content-Security-Policy</strong> response header.</li>
                    <li>In the console, run <code>fetch(&apos;https://example.com&apos;)</code>. The browser refuses it and reports a CSP violation.</li>
                </ol>
                <p>Prefer not to trust any hosted copy? RepoLens is open source: run <code>npm install &amp;&amp; npm run build &amp;&amp; npm start</code> on your own machine, or use the command-line tool, which never opens a network connection.</p>

                <h2>What the site stores</h2>
                <ul>
                    <li><strong>On your device:</strong> one preference, your theme (ink or paper), in <code>localStorage</code>. No project data is ever stored. Close the tab and it is gone.</li>
                    <li><strong>No cookies, no tracking, no analytics.</strong></li>
                    <li><strong>On the server:</strong> the host that serves this site may keep ordinary web-server logs (such as your IP address and the pages requested), as any website does. Those logs cannot contain anything about your projects, because project data never reaches the server.</li>
                </ul>

                <h2>What reports contain</h2>
                <p>Exported reports hold file paths, structure metrics and findings, and never the text of your source files. For credential findings, only the kind of secret and its line number are recorded. <strong>The value is never captured</strong>, so it cannot leak into a report, a screenshot or a Markdown summary. Reports you load are validated field by field against strict bounds before use, so a crafted file cannot inject content or crash the app.</p>

                <h2>Hostile and oversized input</h2>
                <p>Projects are untrusted input. RepoLens skips dependency folders, build output, lockfiles, source maps, minified files, hidden files and common secret files such as <code>.env</code> and private keys <em>before reading them</em>. Absolute paths, path traversal, control characters and duplicate paths are rejected. Limits apply to file count (60,000), readable text (100 MB), single files (1 MB), and ZIP size (100 MB compressed, 300 MB expanded, with entry-count and size-mismatch checks). Folders are scanned on your device and respect <code>.gitignore</code>, so ignored folders are never opened. Analysis runs under a time limit, and the analyzer’s pattern matching is tested against pathological inputs.</p>

                <h2>What this does not protect against</h2>
                <ul>
                    <li>Browser extensions and a compromised device can read what is on screen. They are outside RepoLens’s control.</li>
                    <li>Like every website, you trust the host to serve unmodified code. If that matters, build and run it yourself.</li>
                    <li>The secret and risky-code checks are pattern-based. They can miss real problems and flag harmless code. RepoLens is not a security audit.</li>
                </ul>

                <h2>Reporting a vulnerability</h2>
                <p>If you find a security problem, please report it privately through <a href="https://github.com/TriSDec/RepoLens/security/advisories/new" rel="noopener noreferrer">GitHub’s private vulnerability reporting</a> rather than a public issue, and give us a reasonable chance to fix it first.</p>
            </main>
            <SiteFooter />
        </>
    );
}
