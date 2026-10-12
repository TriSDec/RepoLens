/* eslint-disable @next/next/no-html-link-for-pages -- plain anchors are deliberate: client-side navigation would fetch
   page data in the background, and the Content-Security-Policy forbids network connections (connect-src 'none'). */
import { Mark } from './Icon';

export function SiteHeader() {
    return (
        <header className="site-header">
            <a className="wordmark" href="/" aria-label="RepoLens home"><Mark /><span>RepoLens</span></a>
            <nav aria-label="Site"><a href="/docs">Docs</a><a href="/privacy">Privacy &amp; security</a><a href="/">Open the app</a></nav>
        </header>
    );
}

export function SiteFooter() {
    return (
        <footer className="site-footer">
            <a className="wordmark" href="/"><Mark size={20} /><span>RepoLens</span></a>
            <nav aria-label="Footer"><a href="/docs">Docs</a><a href="/privacy">Privacy &amp; security</a><a href="/terms">Terms</a><a href="/licenses">Licences</a><a href="https://github.com/TriSDec/RepoLens" rel="noopener noreferrer">Source on GitHub</a></nav>
            <p>© 2026 Tristan DeClercq. MIT-licensed. Structural analysis only. RepoLens does not run your code, replace your compiler or tests, or constitute a security audit.</p>
        </footer>
    );
}
