// Scoring. Every number here is a documented, bounded formula so a score can always be explained.
import type { FileNode, Finding, Health, HealthFactor } from './types';

const SEVERITY_BASE = { error: 100, warning: 50, info: 10 } as const;

/** Higher = fix sooner. Severity and certainty, amplified by how much of the codebase depends on the files involved. */
export function priorityOf(f: Pick<Finding, 'severity' | 'confidence' | 'kind'>, maxInfluence: number): number {
    const base = f.kind === 'secret' && f.severity === 'error' ? 220 : SEVERITY_BASE[f.severity];
    const certainty = f.confidence === 'confirmed' ? 1 : 0.6;
    return Math.round(base * certainty * (1 + Math.log1p(maxInfluence) / 2));
}

const NOISE = new Set(['size', 'repeated', 'dynamic', 'coupling', 'fan-out', 'package', 'unreachable', 'bridge', 'layering']);

/** The handful of findings most worth acting on, skipping stylistic noise. */
export function pickFixFirst(findings: Finding[], limit = 6): string[] {
    return [...findings]
        .filter(f => !NOISE.has(f.kind) && (f.severity !== 'info' || f.kind === 'untested' || f.kind === 'folder-cycle'))
        .sort((a, b) => b.priority - a.priority)
        .slice(0, limit)
        .map(f => f.id);
}

/** 0..100 change-risk: how costly a mistake in this file would be. */
export function riskScore(n: Pick<FileNode, 'influence' | 'complexity' | 'functions' | 'worst' | 'lines' | 'inCycle' | 'tested' | 'isTest' | 'lang'>, total: number, hasTests: boolean): number {
    if (n.isTest) return 0;
    const reach = Math.log1p(n.influence) / Math.log1p(Math.max(1, total - 1));
    const logic = n.worst ? Math.min(1, n.worst.complexity / 30) : Math.min(1, n.complexity / 300);
    const untested = hasTests && !n.tested ? 1 : 0;
    const size = Math.min(1, n.lines / 1000);
    return Math.round(100 * (0.38 * reach + 0.27 * logic + 0.15 * untested + 0.1 * size + 0.1 * (n.inCycle ? 1 : 0)));
}

type Ctx = { findings: Finding[]; codeFiles: number; testFiles: number };

export function computeHealth({ findings, codeFiles, testFiles }: Ctx): Health {
    const of = (...kinds: string[]) => findings.filter(f => kinds.includes(f.kind));
    // Larger projects accumulate more findings simply because they are larger, so most penalties are
    // damped by size. Secrets and syntax errors are never damped.
    const damp = Math.min(4, Math.max(1, Math.sqrt(codeFiles / 20)));
    const make = (key: string, label: string, raw: number, max: number, detail: string, scaled = true): HealthFactor => {
        const penalty = Math.min(max, scaled ? raw / damp : raw);
        return { key, label, penalty: Math.round(penalty * 10) / 10, max, detail };
    };
    const secrets = of('secret');
    const cycles = of('cycle'), folderCycles = of('folder-cycle');
    const complexity = of('complexity');
    const factors: HealthFactor[] = [
        make('secrets', 'Exposed credentials', secrets.reduce((s, f) => s + (f.severity === 'error' ? 12 : f.severity === 'warning' ? 4 : 0.5), 0), 30,
            `${secrets.length} possible credential${secrets.length === 1 ? '' : 's'} in source`, false),
        make('syntax', 'Syntax errors', of('syntax').length * 5, 15, `${of('syntax').length} file(s) that do not parse`, false),
        make('cycles', 'Circular dependencies', cycles.length * 3 + folderCycles.length * 2, 18,
            `${cycles.length} file loop(s), ${folderCycles.length} directory loop(s)`),
        make('unresolved', 'Broken imports', of('unresolved').length, 8, `${of('unresolved').length} local import(s) that resolve to nothing`),
        make('risky', 'Risky constructs', of('risky').filter(f => f.severity === 'warning').length * 1.5, 8,
            `${of('risky').length} place(s) using eval, shell commands, unsafe deserialization and similar`),
        make('complexity', 'Complex functions', complexity.reduce((s, f) => s + (f.severity === 'warning' ? 2 : 1), 0), 8, `${complexity.length} unusually branchy function(s) or file(s)`),
        make('tests', testFiles ? 'Widely-used code without tests' : 'No tests detected',
            testFiles ? of('untested').length * 0.8 : of('no-tests').length * 6, 8,
            testFiles ? `${of('untested').length} heavily-used file(s) no test reaches` : 'Nothing that looks like a test file was found'),
        make('duplicates', 'Duplicated files', of('duplicate').length * 2, 6, `${of('duplicate').length} set(s) of identical files`),
        make('dead', 'Unused code', of('unreachable', 'unused-export', 'package').length * 0.4, 6,
            `${of('unreachable', 'unused-export', 'package').length} possibly-unused file(s), export(s) or package(s)`),
    ];
    const score = Math.max(0, Math.round(100 - factors.reduce((s, f) => s + f.penalty, 0)));
    const grade = score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : score >= 55 ? 'D' : 'E';
    return { score, grade, factors };
}
