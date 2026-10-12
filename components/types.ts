import type { Finding } from '@/lib/repolens/types';

export type View = 'map' | 'findings' | 'hotspots' | 'architecture' | 'packages';
export type TraceMode = 'none' | 'deps' | 'impact';
export type ActiveFinding = Finding | null;

export const VIEWS: [View, string][] = [['map', 'Map'], ['findings', 'Findings'], ['hotspots', 'Hotspots'], ['architecture', 'Architecture'], ['packages', 'Packages']];

export const SEVERITY_LABEL = { error: 'Error', warning: 'Warning', info: 'Suggestion' } as const;
export const KIND_LABEL: Record<string, string> = {
    cycle: 'Cycle', 'folder-cycle': 'Directory cycle', duplicate: 'Duplicate', unresolved: 'Broken import', syntax: 'Syntax', size: 'Size', unreachable: 'Unreachable',
    coupling: 'Coupling', package: 'Unused package', undeclared: 'Undeclared package', repeated: 'Repeated import', dynamic: 'Dynamic import', secret: 'Credential',
    risky: 'Risky code', untested: 'Untested', complexity: 'Complexity', 'unused-export': 'Unused export', bridge: 'Bridge', 'fan-out': 'Fan-out', layering: 'Layering', 'no-tests': 'Tests',
};
