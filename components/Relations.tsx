'use client';
// A small diagram of one file's neighbourhood: who imports it on the left, what it imports on the right.
// It answers "how is this file connected?" at a glance, and every name is a link.
import { LANG_COLORS } from '@/lib/palette';
import type { FileNode } from '@/lib/repolens/types';

export type Neighbour = { id: string; line: number; typeOnly: boolean };
type Props = { node: FileNode; nodes: Map<string, FileNode>; users: Neighbour[]; deps: Neighbour[]; onSelect: (id: string) => void };

const ROWS = 8, ROW_H = 30, COL_W = 128, GAP = 64, PAD = 14;
const W = COL_W * 2 + GAP + 36;

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const rank = (nodes: Map<string, FileNode>) => (a: Neighbour, b: Neighbour) => (nodes.get(b.id)?.importedBy ?? 0) - (nodes.get(a.id)?.importedBy ?? 0) || (a.id < b.id ? -1 : 1);

export default function Relations({ node, nodes, users, deps, onSelect }: Props) {
    const sorted = (list: Neighbour[]) => [...list].sort(rank(nodes)).slice(0, ROWS);
    const left = sorted(users), right = sorted(deps);
    const rows = Math.max(left.length, right.length, 1);
    const H = PAD * 2 + rows * ROW_H + 26;
    const cy = PAD + 14 + (rows * ROW_H) / 2;
    const rowY = (i: number, count: number) => PAD + 14 + (rows * ROW_H) / 2 + (i - (count - 1) / 2) * ROW_H;
    const cx0 = 18 + COL_W + GAP / 2 - 2, cx1 = cx0 + 4; // the file itself is a slim spine in the middle
    const colour = (id: string) => { const n = nodes.get(id); return (n?.lang && LANG_COLORS[n.lang]) || 'var(--muted)'; };

    const column = (list: Neighbour[], total: number, side: 'left' | 'right') => {
        const x = side === 'left' ? 18 : 18 + COL_W + GAP, edgeX = side === 'left' ? x + COL_W + 6 : x - 6, midX = (edgeX + (side === 'left' ? cx0 : cx1)) / 2;
        return (
            <g>
                {list.map((nb, i) => {
                    const y = rowY(i, list.length), n = nodes.get(nb.id), name = nb.id.split('/').pop() ?? nb.id;
                    const sx = side === 'left' ? edgeX : cx1, ex = side === 'left' ? cx0 : edgeX; // data flows importer -> file -> imported
                    const d = side === 'left' ? `M${sx},${y} C${midX},${y} ${midX},${cy} ${ex},${cy}` : `M${sx},${cy} C${midX},${cy} ${midX},${y} ${ex},${y}`;
                    return (
                        <g key={nb.id} className="rel-row" role="button" tabIndex={0} aria-label={`${side === 'left' ? 'Imported by' : 'Imports'} ${nb.id}${nb.line ? `, line ${nb.line}` : ''}`}
                            onClick={() => onSelect(nb.id)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(nb.id); } }}>
                            <title>{nb.id}{nb.line ? ` · line ${nb.line}` : ''}{nb.typeOnly ? ' · type only' : ''}</title>
                            <path d={d} className={`rel-line ${side}${nb.typeOnly ? ' dashed' : ''}`} markerEnd={`url(#rel-arrow-${side === 'left' ? 'gold' : 'teal'})`} />
                            <rect x={x - 4} y={y - ROW_H / 2 + 2} width={COL_W + 8} height={ROW_H - 4} className="rel-hit" />
                            <circle cx={side === 'left' ? x + COL_W - 4 : x + 4} cy={y} r={3.2} fill={colour(nb.id)} />
                            <text x={side === 'left' ? x + COL_W - 14 : x + 14} y={y + 4} textAnchor={side === 'left' ? 'end' : 'start'} className="rel-name">{clip(name, 16)}{n?.inCycle ? ' ↻' : ''}</text>
                        </g>
                    );
                })}
                {total > list.length && <text x={side === 'left' ? x + COL_W - 14 : x + 14} y={PAD + 14 + rows * ROW_H + 14} textAnchor={side === 'left' ? 'end' : 'start'} className="rel-more">+{total - list.length} more below</text>}
            </g>
        );
    };

    return (
        <figure className="relations">
            <svg viewBox={`0 0 ${W} ${H}`} role="group" aria-label={`${node.name} is imported by ${users.length} files and imports ${deps.length}`}>
                <defs>{(['gold', 'teal'] as const).map(c => <marker key={c} id={`rel-arrow-${c}`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L8,4 L0,8 z" style={{ fill: `var(--${c})` }} /></marker>)}</defs>
                <text x={18 + COL_W - 14} y={PAD + 6} textAnchor="end" className="rel-head gold">IMPORTED BY · {users.length}</text>
                <text x={18 + COL_W + GAP + 14} y={PAD + 6} className="rel-head teal">IMPORTS · {deps.length}</text>
                {column(left, users.length, 'left')}
                {column(right, deps.length, 'right')}
                <rect x={cx0} y={cy - 17} width={cx1 - cx0} height={34} rx={2} className="rel-core" />
                {!left.length && <text x={18 + COL_W - 14} y={cy + 4} textAnchor="end" className="rel-none">nothing imports it</text>}
                {!right.length && <text x={18 + COL_W + GAP + 14} y={cy + 4} className="rel-none">imports nothing here</text>}
            </svg>
            <figcaption>Arrows follow the import: the importing file points to the file it imports. Dashed lines are type-only. ↻ marks files in a loop.</figcaption>
        </figure>
    );
}
