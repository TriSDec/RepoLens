import type { Metadata } from 'next';
import { SiteFooter, SiteHeader } from '@/components/SiteChrome';
import notices from '@/lib/notices.json';

export const metadata: Metadata = {
    title: 'Open-source licences',
    description: 'The open-source software and fonts RepoLens is built from, with their licences.',
    alternates: { canonical: '/licenses' },
};

export default function Licenses() {
    return (
        <>
            <SiteHeader />
            <main id="main" className="page">
                <h1>Open-source licences</h1>
                <p className="lead">RepoLens stands on the work of others. These are the components delivered to your browser, with their licences. RepoLens itself is MIT-licensed.</p>

                <h2>Software</h2>
                {notices.packages.map(p => (
                    <details key={p.name} className="licence">
                        <summary><strong>{p.name}</strong> {p.version} · {p.license}</summary>
                        <p><a href={p.homepage} rel="noopener noreferrer">{p.homepage}</a></p>
                        {p.text && <pre>{p.text}</pre>}
                    </details>
                ))}

                <h2>Fonts</h2>
                <p>Fonts are bundled with this site and served from it; your browser never contacts a font provider.</p>
                <ul>
                    {notices.fonts.map(f => (
                        <li key={f.name}><strong>{f.name}</strong>, © {f.holder}. <a href={f.licenseUrl} rel="noopener noreferrer">{f.license}</a>. <a href={f.source} rel="noopener noreferrer">Source</a>.</li>
                    ))}
                </ul>
            </main>
            <SiteFooter />
        </>
    );
}
