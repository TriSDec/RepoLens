export type InputFile = {
    path: string;
    size: number;
    content?: string;
};
export type FileNode = {
    id: string;
    name: string;
    folder: string;
    kind: string;
    lang?: string;
    size: number;
    lines: number;
    imports: number;
    importedBy: number;
    external: string[];
    entry: boolean;
    x: number;
    y: number;
};
export type Edge = {
    from: string;
    to: string;
    typeOnly: boolean;
    line: number;
};
export type Finding = {
    id: string;
    kind: string;
    severity: 'error' | 'warning' | 'info';
    confidence: 'confirmed' | 'review';
    title: string;
    detail: string;
    suggestion: string;
    files: string[];
    line?: number;
    bytes?: number;
};
export type Report = {
    name: string;
    nodes: FileNode[];
    edges: Edge[];
    findings: Finding[];
    skipped: number;
    skippedBytes: number;
    skippedReasons: Record<string, number>;
    bytes: number;
    lines: number;
    duplicateBytes: number;
    packages: string[];
    languages: { lang: string; label: string; files: number; lines: number }[];
    duration: number;
    limitations: string[];
};
export const LIMITS = { files: 1000, bytes: 25 * 1024 * 1024, perFile: 1024 * 1024, archive: 25 * 1024 * 1024, expanded: 50 * 1024 * 1024, zipEntries: 12000 };
export function prettyBytes(n: number) { return n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`; }
export function trace(start: string, edges: Edge[], direction: 'dependencies' | 'impact') {
    const adjacency = new Map<string, string[]>();
    for (const e of edges) {
        const a = direction === 'dependencies' ? e.from : e.to;
        const b = direction === 'dependencies' ? e.to : e.from;
        adjacency.set(a, [...(adjacency.get(a) || []), b]);
    }
    const visited = new Set([start]), queue = [start];
    for (let i = 0; i < queue.length; i++)
        for (const n of adjacency.get(queue[i]) || [])
            if (!visited.has(n)) {
                visited.add(n);
                queue.push(n);
            }
    return visited;
}
