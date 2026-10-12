// Collects the licences of everything RepoLens ships to visitors (its production dependencies) into
// lib/notices.json, which the /licenses page renders. Run after changing dependencies: npm run notices
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
const packages = [];

for (const name of Object.keys(pkg.dependencies ?? {}).sort()) {
    const dir = new URL(`node_modules/${name}/`, root);
    const meta = JSON.parse(readFileSync(new URL('package.json', dir), 'utf8'));
    const file = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'license'].find(f => existsSync(new URL(f, dir)));
    const repo = (typeof meta.repository === 'string' ? meta.repository : meta.repository?.url ?? '').replace(/^git\+/, '').replace(/\.git$/, '');
    packages.push({
        name, version: meta.version, license: typeof meta.license === 'string' ? meta.license : 'See package',
        homepage: meta.homepage || repo || `https://www.npmjs.com/package/${name}`,
        text: file ? readFileSync(new URL(file, dir), 'utf8').trim() : '',
    });
}

const fonts = [
    { name: 'Instrument Serif', holder: 'The Instrument Serif Project Authors', source: 'https://github.com/Instrument/instrument-serif' },
    { name: 'Newsreader', holder: 'The Newsreader Project Authors', source: 'https://github.com/productiontype/Newsreader' },
    { name: 'IBM Plex Mono', holder: 'IBM Corp.', source: 'https://github.com/IBM/plex' },
].map(f => ({ ...f, license: 'SIL Open Font License 1.1', licenseUrl: 'https://openfontlicense.org' }));

writeFileSync(new URL('lib/notices.json', root), JSON.stringify({ packages, fonts }, null, 2) + '\n');
console.log(`notices: ${packages.length} packages, ${fonts.length} fonts`);
