// Interprets what was dropped onto the page. Folders are not walked here: the scanner walks them lazily,
// applying .gitignore and skipping dependency folders without entering them.
import { fromEntries, type DirSource } from './scan';

export type Dropped =
    | { kind: 'zip'; file: File }
    | { kind: 'report'; file: File }
    | { kind: 'folder'; name: string; source: DirSource }
    | { kind: 'none' };

/**
 * Must be called synchronously from the drop event: the browser invalidates the item list once the event returns,
 * so the entries are collected before anything is awaited.
 */
export function readDropped(items: DataTransferItemList): Promise<Dropped> {
    const entries = [...items].map(i => i.webkitGetAsEntry?.()).filter((e): e is FileSystemEntry => !!e);
    return (async (): Promise<Dropped> => {
        if (!entries.length) return { kind: 'none' };
        if (entries.length === 1 && entries[0].isFile) {
            const file = await new Promise<File>((res, rej) => (entries[0] as FileSystemFileEntry).file(res, rej));
            if (/\.zip$/i.test(file.name)) return { kind: 'zip', file };
            if (/\.json$/i.test(file.name)) return { kind: 'report', file };
            return { kind: 'none' };
        }
        if (entries.length === 1) return { kind: 'folder', name: entries[0].name, source: fromEntries(null, entries[0] as FileSystemDirectoryEntry) };
        return { kind: 'folder', name: 'my-project', source: fromEntries(entries) };
    })();
}
