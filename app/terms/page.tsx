import type { Metadata } from 'next';
import { SiteFooter, SiteHeader } from '@/components/SiteChrome';

export const metadata: Metadata = {
    title: 'Terms of use',
    description: 'The plain-language terms for using RepoLens: free to use, provided as is, and not a substitute for a security audit.',
    alternates: { canonical: '/terms' },
};

const UPDATED = 'October 2026';

export default function Terms() {
    return (
        <>
            <SiteHeader />
            <main id="main" className="page">
                <h1>Terms of use</h1>
                <p className="lead">RepoLens is a free, open-source tool. These terms are short on purpose. Last updated {UPDATED}.</p>

                <h2>1. What RepoLens is</h2>
                <p>RepoLens reads project files that <strong>you</strong> choose, entirely inside your browser, and shows a map and a report about how the code is connected. By using the site or the command-line tool you agree to these terms. If you do not agree, please do not use it.</p>

                <h2>2. Your files and your rights</h2>
                <p>Only open projects you own or are allowed to analyse. Your files are processed on your own device and are not sent to the operator of this site (see the <a href="/privacy">privacy page</a> for how that is enforced and how to check it). You keep all rights to your code and to any report you export. RepoLens claims no licence over either.</p>

                <h2>3. No warranty</h2>
                <p>RepoLens is provided <strong>“as is”</strong>, without warranty of any kind, express or implied, including fitness for a particular purpose, accuracy and non-infringement. It is structural analysis based on static pattern matching and parsing. It can miss problems and can flag harmless code. <strong>It is not a security audit, a compliance check, a code review or legal, financial or professional advice.</strong> Do not rely on it as your only safeguard, and always verify findings yourself before acting on them. A credential finding means a value looked like one; if it is real, rotate it.</p>

                <h2>4. Limitation of liability</h2>
                <p>To the fullest extent allowed by law, the authors and operators are not liable for any indirect, incidental, special or consequential damages, or for any loss of data, profits or business, arising from your use of RepoLens or your reliance on its output. Nothing in these terms limits liability that cannot be limited by law.</p>

                <h2>5. Acceptable use</h2>
                <ul>
                    <li>Do not try to disrupt the site, overload it, or probe it for vulnerabilities outside the process described in the <a href="/privacy">security policy</a>.</li>
                    <li>Do not use RepoLens to analyse material you have no right to access.</li>
                    <li>Do not present RepoLens output as an official certification or audit.</li>
                </ul>

                <h2>6. Open-source licence</h2>
                <p>The RepoLens source code is released under the <a href="https://github.com/TriSDec/RepoLens/blob/main/LICENSE" rel="noopener noreferrer">MIT licence</a>, which governs copying, modification and redistribution of the software. Third-party components keep their own licences, listed on the <a href="/licenses">licences page</a>. These terms govern use of the hosted site; the MIT licence governs the code.</p>

                <h2>7. Availability and changes</h2>
                <p>The hosted site is offered on a best-effort basis and may change or be withdrawn at any time. These terms may be updated; the date above shows the latest version. Continued use after a change means you accept it.</p>

                <h2>8. Trademarks</h2>
                <p>Product and language names mentioned (for example JavaScript, Python, Go, GitHub) belong to their owners and appear only to describe what RepoLens can read. RepoLens is not affiliated with or endorsed by them.</p>

                <h2>9. Contact</h2>
                <p>Questions and bug reports: <a href="https://github.com/TriSDec/RepoLens/issues" rel="noopener noreferrer">GitHub issues</a>. Security reports: <a href="https://github.com/TriSDec/RepoLens/security/advisories/new" rel="noopener noreferrer">private vulnerability reporting</a>.</p>
            </main>
            <SiteFooter />
        </>
    );
}
