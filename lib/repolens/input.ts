import { Unzip, UnzipInflate, unzipSync } from 'fflate';
import { createIgnore, type Ignore } from '../gitignore';
import { LIMITS, type InputFile } from './types';
import { languageOf } from './languages';

const mb = (n: number) => `${Math.round(n / 1048576)} MB`;
const fmt = (n: number) => n.toLocaleString('en-US');
/** Errors shown to people, so they say what to do next. */
export const limitError = {
    files: () => new Error(`This project has more than ${fmt(LIMITS.files)} files to analyse, even after skipping dependencies, build output and anything in .gitignore. Open a subfolder (for example src/), or use the command-line tool (npx repolens), which handles larger projects.`),
    bytes: () => new Error(`The readable source in this project is larger than ${mb(LIMITS.bytes)}. Open a subfolder (for example src/), or use the command-line tool (npx repolens).`),
    zipSize: () => new Error(`ZIP files must be ${mb(LIMITS.archive)} or smaller. Leave out node_modules and build output when you create it, or open the folder directly instead.`),
};

export function safePath(raw: string) {
    const p = raw.replaceAll('\\', '/');
    if (!p || p.length > 500 || p.startsWith('/') || /^[a-z]:/i.test(p) || /[\x00-\x1f\x7f]/.test(p) || p.split('/').includes('..'))
        throw new Error('This project contains an unsafe or excessively long file path.');
    return p.replace(/^\.\//, '');
}
const IGNORED_DIRS = ['node_modules', '.git', '.next', '.nuxt', '.svelte-kit', '.output', 'dist', 'build', 'out', 'coverage', '.cache', '.turbo', 'vendor', '__MACOSX', '__pycache__', '.venv', 'venv', 'site-packages', '.tox', '.mypy_cache', '.pytest_cache', '.ruff_cache', 'target', 'obj', '.gradle', 'Pods', 'DerivedData', '.dart_tool', '.idea', '.vs', '.vscode', 'bower_components', '.yarn', '.pnpm-store', '.parcel-cache', '.angular', '.expo', '.terraform'];
export function exclusion(p: string): string | null {
    const parts = p.split('/'), name = parts.at(-1) || '';
    if (parts.some(s => IGNORED_DIRS.includes(s)))
        return 'Dependencies & generated files';
    if (/^(\.env($|\.)|\.npmrc$|\.pypirc$|\.netrc$|id_rsa|id_ed25519)/i.test(name) || /\.(pem|key|p12|pfx|keystore)$/i.test(name)
        || (/^(credentials|secrets\.)/i.test(name) && !isCode(name))) // credentials.ts or secrets.py is source code; credentials.json is a secret
        return 'Sensitive files';
    if (/^(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|Cargo\.lock|poetry\.lock|Pipfile\.lock|composer\.lock|Gemfile\.lock|go\.sum|pubspec\.lock|packages\.lock\.json)$/.test(name) || /\.(map|min\.js|min\.css)$/.test(name))
        return 'Lockfiles & source maps';
    if (name.startsWith('.'))
        return 'Hidden files';
    return null;
}
export function isCode(p: string) { return languageOf(p) !== null; }
export function isText(p: string) { return isCode(p) || /\.(json|css|scss|less|html|md|txt|ya?ml|toml|xml|gradle|properties|cfg|ini|csproj|mod)$/i.test(p); }

/** Decode UTF-8 text, or null when the bytes are binary or not valid UTF-8. */
export function decodeText(bytes: ArrayBuffer | Uint8Array, decoder = new TextDecoder('utf-8', { fatal: true })): string | null {
    try {
        const text = decoder.decode(bytes);
        return text.includes('\0') ? null : text;
    } catch { return null; }
}

export function stripRoot(files: InputFile[]) {
    if (!files.length)
        return files;
    const first = files[0].path.split('/')[0];
    return files.every(f => f.path.startsWith(first + '/')) ? files.map(f => ({ ...f, path: f.path.slice(first.length + 1) })) : files;
}
export type Collected = {
    files: InputFile[];
    skipped: number;
    skippedBytes: number;
    skippedReasons: Record<string, number>;
    /** Folders and files left out on purpose (dependencies, .gitignore). An import that points into one is not a broken import. */
    ignoredPaths?: string[];
};
const MAX_IGNORED_PATHS = 5000;
function collector(ignore?: Ignore, prefix = '') {
    const data: Collected = { files: [], skipped: 0, skippedBytes: 0, skippedReasons: {}, ignoredPaths: [] }, names = new Set<string>(), noted = new Set<string>();
    let bytes = 0;
    const note = (path: string, dependency: boolean) => {
        let p = path;
        if (dependency) { const parts = path.split('/'), at = parts.findIndex(s => IGNORED_DIRS.includes(s)); if (at >= 0) p = parts.slice(0, at + 1).join('/'); }
        if (noted.size < MAX_IGNORED_PATHS && !noted.has(p)) { noted.add(p); data.ignoredPaths!.push(p); }
    };
    const skip = (size: number, why: string) => { data.skipped++; data.skippedBytes += size; data.skippedReasons[why] = (data.skippedReasons[why] || 0) + 1; };
    const accept = (path: string, size: number) => {
        const reason = exclusion(path);
        if (reason) {
            note(path, reason === 'Dependencies & generated files');
            skip(size, reason);
            return false;
        }
        if (ignore && ignore.ignoresPath(prefix && path.startsWith(prefix) ? path.slice(prefix.length) : path)) {
            note(path, false);
            skip(size, 'Ignored by .gitignore');
            return false;
        }
        if (names.has(path))
            throw new Error('Duplicate file paths found. Please select one project root.');
        names.add(path);
        if (names.size > LIMITS.files)
            throw limitError.files();
        if (isText(path)) {
            if (size > LIMITS.perFile) {
                skip(size, 'Text files over 1 MB');
                return false;
            }
            bytes += size;
            if (bytes > LIMITS.bytes)
                throw limitError.bytes();
        }
        return true;
    };
    return { data, accept, skip };
}
/** `paths` carries each file's project-relative path explicitly: a File cloned into a worker loses `webkitRelativePath`. */
export async function collectFolder(input: File[], progress: (n: number) => void, paths?: string[]): Promise<Collected> {
    const c = collector(), decoder = new TextDecoder('utf-8', { fatal: true });
    for (let i = 0; i < input.length; i++) {
        const file = input[i], path = safePath(paths?.[i] ?? (file.webkitRelativePath || file.name));
        if (c.accept(path, file.size)) {
            let content: string | undefined;
            if (isText(path)) {
                const text = decodeText(await file.arrayBuffer(), decoder);
                if (text === null) {
                    c.skip(file.size, 'Binary or non-UTF-8 text');
                    continue;
                }
                content = text;
            }
            c.data.files.push({ path, size: file.size, content });
        }
        if (i % 30 === 0)
            progress(Math.round(i / input.length * 35));
    }
    c.data.files = stripRoot(c.data.files);
    return c.data;
}

/** The folder every entry sits under, if there is exactly one ("project/..."), so paths can be made project-relative. */
function commonRoot(names: string[]): string {
    const files = names.filter(n => !n.endsWith('/') && !n.startsWith('__MACOSX/'));
    if (!files.length) return '';
    const first = files[0].split('/')[0];
    return files[0].includes('/') && files.every(n => n.startsWith(first + '/')) ? first + '/' : '';
}

export function collectZip(buffer: ArrayBuffer, progress: (n: number) => void, options: { gitignore?: boolean } = {}): Collected {
    if (buffer.byteLength > LIMITS.archive)
        throw limitError.zipSize();
    const raw = new Uint8Array(buffer);
    if (raw[0] !== 80 || raw[1] !== 75)
        throw new Error('That file is not a ZIP archive.');

    // First pass: list the entries and decompress only the small .gitignore files, so ignored folders are never inflated.
    const names: string[] = [];
    let ignore: Ignore | undefined;
    let prefix = '';
    try {
        const found = unzipSync(raw, { filter: f => { if (names.length < LIMITS.zipEntries + 1) names.push(f.name); return /(^|\/)\.gitignore$/.test(f.name) && f.originalSize <= 200_000; } });
        if (names.length > LIMITS.zipEntries) throw new Error('ZIP contains too many entries. Remove generated folders before compressing.');
        prefix = commonRoot(names);
        if (options.gitignore !== false) {
            ignore = createIgnore();
            const decoder = new TextDecoder('utf-8');
            for (const [name, bytes] of Object.entries(found)) {
                const rel = safePath(name.startsWith(prefix) ? name.slice(prefix.length) : name);
                ignore.add(rel.slice(0, Math.max(0, rel.length - '.gitignore'.length - 1)), decoder.decode(bytes));
            }
        }
    } catch (error) {
        if (error instanceof Error && /too many entries|unsafe/.test(error.message)) throw error;
        throw new Error('Unable to read this ZIP. It may be encrypted, damaged, or unsupported.');
    }

    const c = collector(ignore, prefix), decoder = new TextDecoder('utf-8', { fatal: true });
    let entries = 0, expanded = 0, decoded = 0, pending = 0;
    const unzip = new Unzip(file => {
        if (++entries > LIMITS.zipEntries)
            throw new Error('ZIP contains too many entries. Remove generated folders before compressing.');
        const path = safePath(file.name);
        if (path.endsWith('/'))
            return;
        if (file.originalSize === undefined)
            throw new Error('This streaming ZIP format is unsupported. Use a standard ZIP or select the folder directly.');
        if (!c.accept(path, file.originalSize))
            return; // skipped entries are never decompressed, so they cost nothing and cannot be a zip bomb
        expanded += file.originalSize;
        if (expanded > LIMITS.expanded)
            throw new Error(`The ZIP expands beyond the ${mb(LIMITS.expanded)} safety limit. Leave out generated folders, or open the folder directly.`);
        if (!isText(path)) {
            c.data.files.push({ path, size: file.originalSize });
            return;
        }
        const chunks: Uint8Array[] = [];
        let length = 0;
        pending++;
        file.ondata = (error, chunk, final) => {
            if (error)
                throw new Error('Unable to read this ZIP. It may be encrypted, damaged, or unsupported.');
            length += chunk.length;
            decoded += chunk.length;
            if (length > LIMITS.perFile || decoded > LIMITS.bytes)
                throw new Error('Expanded text exceeds the safe analysis limit.');
            chunks.push(chunk);
            if (final) {
                pending--;
                if (length !== file.originalSize)
                    throw new Error('ZIP size metadata does not match its content.');
                const joined = new Uint8Array(length);
                let offset = 0;
                for (const part of chunks) {
                    joined.set(part, offset);
                    offset += part.length;
                }
                const text = decodeText(joined, decoder);
                if (text === null) c.skip(length, 'Binary or non-UTF-8 text');
                else c.data.files.push({ path, size: length, content: text });
            }
        };
        file.start();
    });
    unzip.register(UnzipInflate);
    // Small compressed chunks bound allocation before the expanded-size callback.
    for (let i = 0; i < raw.length; i += 2048) {
        unzip.push(raw.subarray(i, i + 2048), i + 2048 >= raw.length);
        if (i % 131072 === 0)
            progress(Math.round(i / raw.length * 35));
    }
    if (pending)
        throw new Error('The ZIP is incomplete or corrupted.');
    c.data.files = stripRoot(c.data.files);
    return c.data;
}
