import type { Metadata, Viewport } from 'next';
import { IBM_Plex_Mono, Instrument_Serif, Newsreader } from 'next/font/google';
import { headers } from 'next/headers';
import { connection } from 'next/server';
import './globals.css';

// Fonts are downloaded at build time and served from this site: visitors' browsers never contact Google.
const display = Instrument_Serif({ subsets: ['latin'], weight: '400', style: ['normal', 'italic'], variable: '--font-display', display: 'swap' });
const text = Newsreader({ subsets: ['latin'], style: ['normal', 'italic'], variable: '--font-text', display: 'swap' });
const mono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-mono', display: 'swap' });

const SITE = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
const TITLE = 'RepoLens: see how your code is connected';
const DESCRIPTION = 'Turn any codebase into an interactive 3D map. Find circular dependencies, exposed secrets, risky files and dead code across 14 languages. Everything runs in your browser; your code is never uploaded.';

export const metadata: Metadata = {
    metadataBase: new URL(SITE),
    title: { default: TITLE, template: '%s · RepoLens' },
    description: DESCRIPTION,
    applicationName: 'RepoLens',
    keywords: ['dependency graph', 'code visualization', 'circular dependencies', 'codebase analysis', 'static analysis', 'secret scanning', 'architecture'],
    openGraph: { type: 'website', siteName: 'RepoLens', title: TITLE, description: DESCRIPTION },
    twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
    alternates: { canonical: '/' },
    authors: [{ name: 'Tristan DeClercq', url: 'https://github.com/TriSDec' }],
    category: 'developer tools',
    referrer: 'no-referrer',
    robots: { index: true, follow: true },
};

export const viewport: Viewport = {
    themeColor: [{ media: '(prefers-color-scheme: dark)', color: '#0b0c0d' }, { media: '(prefers-color-scheme: light)', color: '#efe9da' }],
    colorScheme: 'dark light',
};

// Structured data so search engines can describe the app. A constant, with no user data in it.
const JSON_LD = JSON.stringify({
    '@context': 'https://schema.org', '@type': 'SoftwareApplication', name: 'RepoLens', applicationCategory: 'DeveloperApplication',
    operatingSystem: 'Any (web browser)', description: DESCRIPTION, url: SITE, license: 'https://opensource.org/licenses/MIT',
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' }, author: { '@type': 'Person', name: 'Tristan DeClercq' },
}).replace(/</g, '\\u003c');

// Runs before first paint so the chosen theme never flashes. A constant string, no user data involved.
const THEME_SCRIPT = `try{var t=localStorage.getItem('repolens-theme');if(t!=='ink'&&t!=='paper')t=matchMedia('(prefers-color-scheme: light)').matches?'paper':'ink';document.documentElement.dataset.theme=t}catch(e){document.documentElement.dataset.theme='ink'}`;

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
    await connection(); // the Content-Security-Policy nonce is per request, so pages render dynamically
    const nonce = (await headers()).get('x-nonce') ?? undefined;
    return (
        <html lang="en" className={`${display.variable} ${text.variable} ${mono.variable}`} data-theme="ink" suppressHydrationWarning>
            <head>
                {/* repolens-ignore: a fixed, build-time theme bootstrap, never user input */}
                <script nonce={nonce} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
                {/* repolens-ignore: constant structured data, escaped so it can never close the tag */}
                <script nonce={nonce} type="application/ld+json" suppressHydrationWarning dangerouslySetInnerHTML={{ __html: JSON_LD }} />
            </head>
            <body>
                <a href="#main" className="sr-only">Skip to content</a>
                {children}
            </body>
        </html>
    );
}
