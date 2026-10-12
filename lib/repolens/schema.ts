// Validation for reports loaded from disk. A report file is untrusted input: it is checked field by
// field against strict bounds and rebuilt from known keys only (nothing is copied across wholesale),
// so a crafted file cannot inject unexpected properties, oversized data, or dangling references.
import type { Edge, ExternalPackage, FileNode, Finding, FolderEdge, FolderNode, Health, Report } from './types';

export const MAX_REPORT_BYTES = 150 * 1024 * 1024;
const LIMIT = { nodes: 60000, edges: 200000, findings: 50000, folders: 60000, externals: 20000, text: 4000, path: 600 };

class Invalid extends Error {}
const fail = (what: string): never => { throw new Invalid(`This does not look like a RepoLens report (${what}).`); };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const obj = (v: unknown, what: string) => isObj(v) ? v : fail(what);
const arr = (v: unknown, max: number, what: string): unknown[] => Array.isArray(v) && v.length <= max ? v : fail(what);
const str = (v: unknown, max: number, what: string): string => typeof v === 'string' && v.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v) ? v : fail(what);
const num = (v: unknown, lo: number, hi: number, what: string): number => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : fail(what);
const int = (v: unknown, lo: number, hi: number, what: string): number => Number.isInteger(num(v, lo, hi, what)) ? (v as number) : fail(what);
const bool = (v: unknown, what: string): boolean => typeof v === 'boolean' ? v : fail(what);
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], what: string): T => allowed.includes(v as T) ? (v as T) : fail(what);
const strings = (v: unknown, maxItems: number, maxLen: number, what: string) => arr(v, maxItems, what).map(s => str(s, maxLen, what));
const optInt = (v: unknown, what: string) => v === undefined ? undefined : int(v, 0, 10_000_000, what);

export function validateReport(raw: unknown): Report {
    const r = obj(raw, 'not an object');
    if (r.schemaVersion !== 2) throw new Invalid('This report was made by an older or different version of RepoLens and cannot be opened. Re-run the analysis to create a new one.');

    const nodeIds = new Set<string>();
    const nodes: FileNode[] = arr(r.nodes, LIMIT.nodes, 'nodes').map((x, i) => {
        const n = obj(x, `node ${i}`);
        const id = str(n.id, LIMIT.path, 'node id');
        if (nodeIds.has(id)) fail('duplicate node');
        nodeIds.add(id);
        const worst = n.worst === undefined ? undefined : (() => { const w = obj(n.worst, 'worst'); return { name: str(w.name, 200, 'worst'), line: int(w.line, 0, 10_000_000, 'worst'), complexity: int(w.complexity, 0, 100000, 'worst') }; })();
        return {
            id, name: str(n.name, 300, 'node name'), folder: str(n.folder, LIMIT.path, 'node folder'), kind: str(n.kind, 40, 'node kind'),
            lang: n.lang === undefined ? undefined : str(n.lang, 20, 'node lang'),
            size: num(n.size, 0, 1e12, 'size'), lines: int(n.lines, 0, 1e8, 'lines'), imports: int(n.imports, 0, 1e6, 'imports'), importedBy: int(n.importedBy, 0, 1e6, 'importedBy'),
            external: strings(n.external, 500, 200, 'external'), entry: bool(n.entry, 'entry'), isTest: bool(n.isTest, 'isTest'),
            x: num(n.x, -1000, 1000, 'x'), y: num(n.y, -1000, 1000, 'y'), z: num(n.z, -1000, 1000, 'z'),
            complexity: int(n.complexity, 0, 1e7, 'complexity'), functions: int(n.functions, 0, 1e6, 'functions'), worst,
            influence: int(n.influence, 0, 1e6, 'influence'), centrality: num(n.centrality, 0, 1, 'centrality'), risk: num(n.risk, 0, 100, 'risk'),
            cutPoint: bool(n.cutPoint, 'cutPoint'), tested: bool(n.tested, 'tested'), inCycle: bool(n.inCycle, 'inCycle'),
        };
    });

    const edges: Edge[] = arr(r.edges, LIMIT.edges, 'edges').map((x, i) => {
        const e = obj(x, `edge ${i}`);
        const from = str(e.from, LIMIT.path, 'edge'), to = str(e.to, LIMIT.path, 'edge');
        if (!nodeIds.has(from) || !nodeIds.has(to)) fail('an edge points at a file that is not in the report');
        return { from, to, typeOnly: bool(e.typeOnly, 'typeOnly'), line: int(e.line, 0, 10_000_000, 'line') };
    });

    const findings: Finding[] = arr(r.findings, LIMIT.findings, 'findings').map((x, i) => {
        const f = obj(x, `finding ${i}`);
        return {
            id: str(f.id, 40, 'finding id'), kind: str(f.kind, 40, 'finding kind'),
            severity: oneOf(f.severity, ['error', 'warning', 'info'] as const, 'severity'), confidence: oneOf(f.confidence, ['confirmed', 'review'] as const, 'confidence'),
            title: str(f.title, 300, 'title'), detail: str(f.detail, LIMIT.text, 'detail'), suggestion: str(f.suggestion, LIMIT.text, 'suggestion'),
            files: strings(f.files, 500, LIMIT.path, 'files'), line: optInt(f.line, 'line'), bytes: f.bytes === undefined ? undefined : num(f.bytes, 0, 1e12, 'bytes'),
            path: f.path === undefined ? undefined : strings(f.path, 500, LIMIT.path, 'path'), folders: f.folders === undefined ? undefined : strings(f.folders, 500, LIMIT.path, 'folders'),
            priority: num(f.priority, 0, 1e6, 'priority'),
        };
    });
    const findingIds = new Set(findings.map(f => f.id));

    const folders: FolderNode[] = arr(r.folders, LIMIT.folders, 'folders').map(x => {
        const f = obj(x, 'folder');
        return { id: str(f.id, LIMIT.path, 'folder'), files: int(f.files, 0, 1e6, 'folder'), lines: int(f.lines, 0, 1e8, 'folder'), ca: int(f.ca, 0, 1e7, 'folder'), ce: int(f.ce, 0, 1e7, 'folder'), instability: num(f.instability, 0, 1, 'folder'), inCycle: bool(f.inCycle, 'folder'), x: num(f.x, -1000, 1000, 'folder'), y: num(f.y, -1000, 1000, 'folder'), z: num(f.z, -1000, 1000, 'folder') };
    });
    const folderEdges: FolderEdge[] = arr(r.folderEdges, LIMIT.edges, 'folderEdges').map(x => { const e = obj(x, 'folder edge'); return { from: str(e.from, LIMIT.path, 'folder edge'), to: str(e.to, LIMIT.path, 'folder edge'), weight: int(e.weight, 0, 1e7, 'folder edge') }; });
    const externals: ExternalPackage[] = arr(r.externals, LIMIT.externals, 'externals').map(x => { const e = obj(x, 'external'); return { name: str(e.name, 200, 'external'), files: int(e.files, 0, 1e6, 'external'), declared: e.declared === null ? null : bool(e.declared, 'external') }; });

    const h = obj(r.health, 'health');
    const health: Health = {
        score: int(h.score, 0, 100, 'health'), grade: oneOf(h.grade, ['A', 'B', 'C', 'D', 'E'] as const, 'grade'),
        factors: arr(h.factors, 30, 'factors').map(x => { const f = obj(x, 'factor'); return { key: str(f.key, 40, 'factor'), label: str(f.label, 120, 'factor'), penalty: num(f.penalty, 0, 1000, 'factor'), max: num(f.max, 0, 1000, 'factor'), detail: str(f.detail, 300, 'factor') }; }),
    };

    const reasons = obj(r.skippedReasons, 'skippedReasons');
    const skippedReasons = Object.fromEntries((arr(Object.keys(reasons), 100, "skippedReasons") as string[]).map(k => [str(k, 100, 'skippedReasons'), int(reasons[k], 0, 1e7, 'skippedReasons')]));

    return {
        schemaVersion: 2, name: str(r.name, 200, 'name'), nodes, edges, findings, folders, folderEdges, externals, health,
        fixFirst: strings(r.fixFirst, 50, 40, 'fixFirst').filter(id => findingIds.has(id)),
        skipped: int(r.skipped, 0, 1e8, 'skipped'), skippedBytes: num(r.skippedBytes, 0, 1e13, 'skippedBytes'), skippedReasons,
        bytes: num(r.bytes, 0, 1e13, 'bytes'), lines: int(r.lines, 0, 1e9, 'lines'), duplicateBytes: num(r.duplicateBytes, 0, 1e13, 'duplicateBytes'),
        packages: strings(r.packages, LIMIT.externals, 200, 'packages'),
        languages: arr(r.languages, 40, 'languages').map(x => { const l = obj(x, 'language'); return { lang: str(l.lang, 20, 'language'), label: str(l.label, 60, 'language'), files: int(l.files, 0, 1e6, 'language'), lines: int(l.lines, 0, 1e9, 'language') }; }),
        testFiles: int(r.testFiles, 0, 1e6, 'testFiles'), duration: num(r.duration, 0, 1e9, 'duration'),
        limitations: strings(r.limitations, 40, LIMIT.text, 'limitations'),
    };
}

/** Parse and validate report text. Throws an Error with a user-facing message. */
export function parseReport(text: string): Report {
    if (text.length > MAX_REPORT_BYTES) throw new Error('That file is too large to be a RepoLens report.');
    let json: unknown;
    try { json = JSON.parse(text); } catch { throw new Error('That file is not valid JSON.'); }
    return validateReport(json);
}
