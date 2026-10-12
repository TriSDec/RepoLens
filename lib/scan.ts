// Scans a project folder on the page (before analysis) from any of the ways a browser can hand one over:
// the directory picker, a drag-and-drop, or a plain <input webkitdirectory> file list. Ignored folders
// (node_modules, .git, anything in .gitignore, ...) are never entered, so a huge dependency tree costs nothing,
// and a project that is too big is rejected as soon as the limit is crossed, not after reading everything.
import { createIgnore } from './gitignore';
import { decodeText, exclusion, isText, limitError, safePath, type Collected } from './repolens/input';
import { languageOf } from './repolens/languages';
import { LIMITS, type InputFile } from './repolens/types';

export type Listing = { name: string; kind: 'file' | 'dir'; file?: () => Promise<File>; open?: () => Promise<DirSource> };
export type DirSource = { list(): Promise<Listing[]> };

export type ScanProgress = {
    stage: 'scan' | 'read';
    found: number;
    skipped: number;
    read: number;
    toRead: number;
    bytes: number;
    current: string;
    /** Folders that were not entered, by name (for example node_modules), with how many. */
    skippedFolders: Record<string, number>;
};
export type ScanOptions = {
    gitignore: boolean;
    onProgress: (p: ScanProgress) => void;
    /** Called once per included file as it is discovered (the language key, or 'other'), to animate the loading screen. */
    onFile?: (kind: string) => void;
    cancelled: () => boolean;
};
export class ScanCancelled extends Error { constructor() { super('Cancelled'); } }

const DIR_WORKERS = 8, READ_WORKERS = 48, EMIT_EVERY_MS = 45;

export async function scanTree(root: DirSource, opts: ScanOptions): Promise<Collected> {
    const ignore = createIgnore();
    const files: InputFile[] = [];
    const reasons: Record<string, number> = {};
    const skippedFolders: Record<string, number> = {};
    const ignoredPaths: string[] = [];
    const noteIgnored = (path: string) => { if (ignoredPaths.length < 5000) ignoredPaths.push(path); };
    const s = { found: 0, skipped: 0, skippedBytes: 0, read: 0, toRead: 0, bytes: 0, current: '' };
    let textBytes = 0, failure: unknown = null, lastEmit = 0, stage: ScanProgress['stage'] = 'scan';

    const emit = (force = false) => {
        const now = performance.now();
        if (!force && now - lastEmit < EMIT_EVERY_MS) return;
        lastEmit = now;
        opts.onProgress({ stage, found: s.found, skipped: s.skipped, read: s.read, toRead: s.toRead, bytes: textBytes, current: s.current, skippedFolders: { ...skippedFolders } });
    };
    const guard = () => { if (failure) throw failure; if (opts.cancelled()) throw new ScanCancelled(); };
    const skip = (why: string, size = 0) => { s.skipped++; s.skippedBytes += size; reasons[why] = (reasons[why] || 0) + 1; };

    // ---- bounded parallel file reads ------------------------------------------------------------------------
    const readQueue: (() => Promise<void>)[] = [];
    let head = 0, walkDone = false;
    const waiters: (() => void)[] = [];
    const wakeAll = () => { while (waiters.length) waiters.pop()!(); };
    const fail = (error: unknown) => { failure ??= error; wakeAll(); };
    const pump = async () => {
        try {
            for (;;) {
                if (head >= readQueue.length) {
                    if (walkDone || failure) return;
                    await new Promise<void>(r => waiters.push(r));
                    continue;
                }
                const job = readQueue[head++];
                if (head > 2048) { readQueue.splice(0, head); head = 0; } // keep the queue small without an O(n) shift per job
                guard();
                await job();
            }
        } catch (error) { fail(error); }
    };
    const enqueue = (job: () => Promise<void>) => { readQueue.push(job); waiters.pop()?.(); };

    const readFile = (path: string, listing: Listing) => async () => {
        s.current = path;
        let file: File;
        try { file = await listing.file!(); } catch { skip('Unreadable files'); s.read++; return; } // a locked or vanished file must not sink the whole scan
        const size = file.size;
        if (isText(path)) {
            if (size > LIMITS.perFile) { skip('Text files over 1 MB', size); }
            else {
                textBytes += size;
                if (textBytes > LIMITS.bytes) throw limitError.bytes();
                let bytes: ArrayBuffer | null = null;
                try { bytes = await file.arrayBuffer(); } catch { skip('Unreadable files', size); }
                const text = bytes && decodeText(bytes);
                if (text) files.push({ path, size, content: text });
                else if (bytes) { if (text === null) skip('Binary or non-UTF-8 text', size); else files.push({ path, size, content: '' }); }
            }
        } else files.push({ path, size });
        s.read++;
        emit();
    };

    // ---- directory walk -----------------------------------------------------------------------------------------
    const pending: { src: DirSource; path: string }[] = [{ src: root, path: '' }];
    let active = 0;
    const walkOne = async (src: DirSource, dirPath: string) => {
        const entries = await src.list();
        guard();
        if (opts.gitignore) { // this folder's own .gitignore applies to everything below it, so read it first
            const gi = entries.find(e => e.kind === 'file' && e.name === '.gitignore' && e.file);
            if (gi) { try { const f = await gi.file!(); if (f.size <= 200_000) ignore.add(dirPath, await f.text()); } catch { /* unreadable: no rules */ } }
        }
        for (const e of entries) {
            const path = dirPath ? `${dirPath}/${e.name}` : e.name;
            if (e.kind === 'dir') {
                const reason = exclusion(path + '/x');
                if (reason || (opts.gitignore && ignore.ignores(path, true))) {
                    const label = reason ? e.name : `${e.name} (.gitignore)`;
                    skippedFolders[label] = (skippedFolders[label] || 0) + 1;
                    noteIgnored(path);
                    continue;
                }
                pending.push({ src: await e.open!(), path });
            } else {
                const reason = exclusion(path);
                if (reason) { skip(reason); continue; }
                if (opts.gitignore && ignore.ignores(path, false)) { noteIgnored(path); skip('Ignored by .gitignore'); continue; }
                if (++s.found > LIMITS.files) throw limitError.files();
                opts.onFile?.(languageOf(path) ?? 'other');
                s.toRead++;
                s.current = path;
                enqueue(readFile(path, e));
            }
        }
        emit();
    };
    const walker = async () => {
        try {
            for (;;) {
                guard();
                const next = pending.shift();
                if (!next) { if (active === 0) return; await new Promise(r => setTimeout(r, 6)); continue; }
                active++;
                try { await walkOne(next.src, next.path); } finally { active--; }
            }
        } catch (error) { fail(error); }
    };

    const readersDone = Array.from({ length: READ_WORKERS }, () => pump());
    await Promise.all(Array.from({ length: DIR_WORKERS }, () => walker()));
    walkDone = true;
    stage = 'read';
    wakeAll();
    emit(true);
    await Promise.all(readersDone);
    if (failure) throw failure;
    guard();

    files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    const folderTotal = Object.values(skippedFolders).reduce((a, b) => a + b, 0);
    if (folderTotal) reasons['Folders not entered (dependencies, build output, .gitignore)'] = folderTotal;
    emit(true);
    return { files, skipped: s.skipped, skippedBytes: s.skippedBytes, skippedReasons: reasons, ignoredPaths };
}

// ---- sources ------------------------------------------------------------------------------------------------------

/** A folder chosen with the directory picker (showDirectoryPicker). */
export function fromHandle(handle: FileSystemDirectoryHandle): DirSource {
    return {
        async list() {
            const out: Listing[] = [];
            const entries = (handle as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries();
            for await (const [name, h] of entries) {
                if (h.kind === 'file') out.push({ name, kind: 'file', file: () => (h as FileSystemFileHandle).getFile() });
                else out.push({ name, kind: 'dir', open: async () => fromHandle(h as FileSystemDirectoryHandle) });
            }
            return out;
        },
    };
}

const readAll = (reader: FileSystemDirectoryReader) => new Promise<FileSystemEntry[]>((resolve, reject) => {
    const all: FileSystemEntry[] = [];
    const next = () => reader.readEntries(batch => { if (!batch.length) resolve(all); else { all.push(...batch); next(); } }, reject);
    next();
});
const listEntries = (entries: FileSystemEntry[]): Listing[] => entries.map(e => e.isFile
    ? { name: e.name, kind: 'file' as const, file: () => new Promise<File>((res, rej) => (e as FileSystemFileEntry).file(res, rej)) }
    : { name: e.name, kind: 'dir' as const, open: async () => fromEntries(null, e as FileSystemDirectoryEntry) });

/** Something dropped onto the page: either a list of entries, or the single folder inside it. */
export function fromEntries(entries: FileSystemEntry[] | null, dir?: FileSystemDirectoryEntry): DirSource {
    return { async list() { return listEntries(entries ?? await readAll(dir!.createReader())); } };
}

/** The flat file list from <input webkitdirectory>. Paths are passed explicitly so they do not depend on File internals. */
export function fromFileList(files: File[], paths: string[]): DirSource & { rootName: string } {
    type Dir = { dirs: Map<string, Dir>; files: Map<string, File> };
    const make = (): Dir => ({ dirs: new Map(), files: new Map() });
    const tree = make();
    const clean = paths.map(p => safePath(p));
    const first = clean[0]?.split('/')[0] ?? '';
    const strip = clean.length > 0 && clean.every(p => p.startsWith(first + '/'));
    clean.forEach((p, i) => {
        const parts = (strip ? p.slice(first.length + 1) : p).split('/');
        let node = tree;
        for (const part of parts.slice(0, -1)) { let next = node.dirs.get(part); if (!next) { next = make(); node.dirs.set(part, next); } node = next; }
        node.files.set(parts.at(-1)!, files[i]);
    });
    const wrap = (d: Dir): DirSource => ({
        async list() {
            return [
                ...[...d.dirs].map(([name, child]) => ({ name, kind: 'dir' as const, open: async () => wrap(child) })),
                ...[...d.files].map(([name, f]) => ({ name, kind: 'file' as const, file: async () => f })),
            ];
        },
    });
    return Object.assign(wrap(tree), { rootName: strip ? first : 'my-project' });
}
