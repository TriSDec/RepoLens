import { Unzip, UnzipInflate } from 'fflate';
import { LIMITS, type InputFile } from './types';
export function safePath(raw: string) {
    const p = raw.replaceAll('\\', '/');
    if (!p || p.length > 500 || p.startsWith('/') || /^[a-z]:/i.test(p) || /[\x00-\x1f\x7f]/.test(p) || p.split('/').includes('..'))
        throw new Error('This project contains an unsafe or excessively long file path.');
    return p.replace(/^\.\//, '');
}
export function exclusion(p: string): string | null {
    const parts = p.split('/'), name = parts.at(-1) || '';
    if (parts.some(s => ['node_modules', '.git', '.next', '.nuxt', 'dist', 'build', 'coverage', '.cache', '.turbo', 'vendor', '__MACOSX'].includes(s)))
        return 'Dependencies & generated files';
    if (/^(\.env($|\.)|\.npmrc$|\.pypirc$|\.netrc$|id_rsa|id_ed25519|credentials|secrets\.)/i.test(name) || /\.(pem|key|p12|pfx|keystore)$/i.test(name))
        return 'Sensitive files';
    if (/^(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?)$/.test(name) || /\.map$/.test(name))
        return 'Lockfiles & source maps';
    if (name.startsWith('.'))
        return 'Hidden files';
    return null;
}
export function isCode(p: string) { return /\.[cm]?[jt]sx?$/i.test(p); }
export function isText(p: string) { return isCode(p) || /\.(json|css|scss|less|html|md|txt|ya?ml)$/i.test(p); }
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
};
function collector() {
    const data: Collected = { files: [], skipped: 0, skippedBytes: 0, skippedReasons: {} }, names = new Set<string>();
    let bytes = 0;
    const skip = (size: number, why: string) => { data.skipped++; data.skippedBytes += size; data.skippedReasons[why] = (data.skippedReasons[why] || 0) + 1; };
    const accept = (path: string, size: number) => {
        const reason = exclusion(path);
        if (reason) {
            skip(size, reason);
            return false;
        }
        if (names.has(path))
            throw new Error('Duplicate file paths found. Please select one project root.');
        names.add(path);
        if (names.size > LIMITS.files)
            throw new Error('This project exceeds 1,000 included files. Select a smaller project or subfolder.');
        if (isText(path)) {
            if (size > LIMITS.perFile) {
                skip(size, 'Text files over 1 MB');
                return false;
            }
            bytes += size;
            if (bytes > LIMITS.bytes)
                throw new Error('Readable project content exceeds 25 MB. Select a smaller folder.');
        }
        return true;
    };
    return { data, accept, skip };
}
export async function collectFolder(input: File[], progress: (n: number) => void): Promise<Collected> {
    const c = collector(), decoder = new TextDecoder('utf-8', { fatal: true });
    for (let i = 0; i < input.length; i++) {
        const file = input[i], path = safePath(file.webkitRelativePath || file.name);
        if (c.accept(path, file.size)) {
            let content: string | undefined;
            if (isText(path)) {
                try {
                    content = decoder.decode(await file.arrayBuffer());
                    if (content.includes('\0'))
                        throw new Error();
                }
                catch {
                    c.skip(file.size, 'Binary or non-UTF-8 text');
                    continue;
                }
            }
            c.data.files.push({ path, size: file.size, content });
        }
        if (i % 30 === 0)
            progress(Math.round(i / input.length * 35));
    }
    c.data.files = stripRoot(c.data.files);
    return c.data;
}
export function collectZip(buffer: ArrayBuffer, progress: (n: number) => void): Collected {
    if (buffer.byteLength > LIMITS.archive)
        throw new Error('ZIP files must be 25 MB or smaller.');
    const raw = new Uint8Array(buffer);
    if (raw[0] !== 80 || raw[1] !== 75)
        throw new Error('That file is not a ZIP archive.');
    const c = collector(), decoder = new TextDecoder('utf-8', { fatal: true });
    let entries = 0, expanded = 0, decoded = 0, pending = 0;
    const unzip = new Unzip(file => {
        if (++entries > LIMITS.zipEntries)
            throw new Error('ZIP contains too many entries. Remove generated folders before compressing.');
        const path = safePath(file.name);
        if (path.endsWith('/'))
            return;
        if (file.originalSize === undefined)
            throw new Error('This streaming ZIP format is unsupported. Use a standard ZIP or select the folder directly.');
        expanded += file.originalSize;
        if (expanded > LIMITS.expanded)
            throw new Error('ZIP expands beyond the 50 MB safety limit. Use folder import to skip generated files first.');
        if (!c.accept(path, file.originalSize))
            return;
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
                try {
                    const content = decoder.decode(joined);
                    if (content.includes('\0'))
                        throw new Error();
                    c.data.files.push({ path, size: length, content });
                }
                catch {
                    c.skip(length, 'Binary or non-UTF-8 text');
                }
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
