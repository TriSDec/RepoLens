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
    /** Distinct files this file imports. */
    imports: number;
    /** Distinct files that import this file. */
    importedBy: number;
    external: string[];
    entry: boolean;
    isTest: boolean;
    /** 3D position, roughly in [-1, 1] on each axis. */
    x: number;
    y: number;
    z: number;
    /** Sum of branch points (an approximation of cyclomatic complexity) across the file. */
    complexity: number;
    functions: number;
    /** Most complex function in the file, when known (JavaScript / TypeScript). */
    worst?: { name: string; line: number; complexity: number };
    /** How many files are affected, directly or indirectly, if this one changes. */
    influence: number;
    /** 0..1, PageRank over the dependency graph (high = depended on by important files). */
    centrality: number;
    /** 0..100 change-risk score combining influence, complexity, test reach, size and cycles. */
    risk: number;
    /** Removing this file would split the dependency graph. */
    cutPoint: boolean;
    /** Reached by at least one test file through imports. */
    tested: boolean;
    inCycle: boolean;
};

export type Edge = {
    from: string;
    to: string;
    typeOnly: boolean;
    line: number;
};

export type FindingKind =
    | 'cycle' | 'folder-cycle' | 'duplicate' | 'unresolved' | 'syntax' | 'size' | 'unreachable' | 'coupling'
    | 'package' | 'undeclared' | 'repeated' | 'dynamic' | 'secret' | 'risky' | 'untested' | 'complexity'
    | 'unused-export' | 'bridge' | 'fan-out' | 'layering' | 'no-tests';

export type Finding = {
    id: string;
    kind: FindingKind | string;
    severity: 'error' | 'warning' | 'info';
    confidence: 'confirmed' | 'review';
    title: string;
    detail: string;
    suggestion: string;
    files: string[];
    line?: number;
    bytes?: number;
    /** For cycles: the loop in order, first file repeated at the end. */
    path?: string[];
    /** For directory-level findings. */
    folders?: string[];
    /** Higher means fix sooner. Combines severity, confidence and how much depends on the files involved. */
    priority: number;
};

export type FolderNode = {
    id: string;
    files: number;
    lines: number;
    /** Incoming dependencies from other folders (afferent coupling). */
    ca: number;
    /** Outgoing dependencies to other folders (efferent coupling). */
    ce: number;
    /** ce / (ca + ce): 0 = everyone depends on it, 1 = it depends on everyone. */
    instability: number;
    inCycle: boolean;
    x: number;
    y: number;
    z: number;
};

export type FolderEdge = { from: string; to: string; weight: number };

export type HealthFactor = { key: string; label: string; penalty: number; max: number; detail: string };
export type Health = { score: number; grade: 'A' | 'B' | 'C' | 'D' | 'E'; factors: HealthFactor[] };

export type ExternalPackage = { name: string; files: number; declared: boolean | null };

export type Report = {
    schemaVersion: 2;
    name: string;
    nodes: FileNode[];
    edges: Edge[];
    findings: Finding[];
    folders: FolderNode[];
    folderEdges: FolderEdge[];
    externals: ExternalPackage[];
    health: Health;
    /** Finding ids, most worthwhile to fix first. */
    fixFirst: string[];
    skipped: number;
    skippedBytes: number;
    skippedReasons: Record<string, number>;
    bytes: number;
    lines: number;
    duplicateBytes: number;
    packages: string[];
    languages: { lang: string; label: string; files: number; lines: number }[];
    testFiles: number;
    duration: number;
    limitations: string[];
};

// Browser limits. Chosen so a very large project still finishes inside roughly 30 seconds on an ordinary laptop.
export const LIMITS = { files: 60000, bytes: 100 * 1024 * 1024, perFile: 1024 * 1024, archive: 100 * 1024 * 1024, expanded: 300 * 1024 * 1024, zipEntries: 200000, edges: 200000 };

export function prettyBytes(n: number) {
    return n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`;
}

/** Everything reachable from `start` following edges forwards (dependencies) or backwards (impact). */
export function trace(start: string, edges: Edge[], direction: 'dependencies' | 'impact') {
    const adjacency = new Map<string, string[]>();
    for (const e of edges) {
        const a = direction === 'dependencies' ? e.from : e.to;
        const b = direction === 'dependencies' ? e.to : e.from;
        const list = adjacency.get(a);
        if (list) list.push(b);
        else adjacency.set(a, [b]);
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

/** Shortest chain of imports leading from `from` to `to` (inclusive), or null if `from` never reaches `to`. */
export function shortestPath(from: string, to: string, edges: Edge[]): string[] | null {
    if (from === to) return [from];
    const adjacency = new Map<string, string[]>();
    for (const e of edges) {
        const list = adjacency.get(e.from);
        if (list) list.push(e.to);
        else adjacency.set(e.from, [e.to]);
    }
    const prev = new Map<string, string>([[from, '']]), queue = [from];
    for (let i = 0; i < queue.length; i++)
        for (const n of adjacency.get(queue[i]) || []) {
            if (prev.has(n)) continue;
            prev.set(n, queue[i]);
            if (n === to) {
                const path = [to];
                while (path[0] !== from) path.unshift(prev.get(path[0])!);
                return path;
            }
            queue.push(n);
        }
    return null;
}
