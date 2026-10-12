/* eslint-disable @next/next/no-html-link-for-pages -- plain anchors: client navigation would fetch in the background, which the Content-Security-Policy forbids. */
import type { Metadata } from 'next';
import { SiteFooter, SiteHeader } from '@/components/SiteChrome';

export const metadata: Metadata = { title: 'Page not found', robots: { index: false } };

export default function NotFound() {
    return (
        <>
            <SiteHeader />
            <main id="main" className="page">
                <h1>Off the map.</h1>
                <p className="lead">There is nothing at this address. Head back to <a href="/">the app</a>, or read the <a href="/docs">docs</a>.</p>
            </main>
            <SiteFooter />
        </>
    );
}
