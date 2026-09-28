'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Focus, Minus, Plus, RotateCcw, Maximize2 } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { type Report, type FileNode } from '@/lib/repolens/types';
const W = 204, H = 70;
export const colors: Record<string, string> = { component: '#a48bfa', module: '#67bedb', style: '#e5a777', config: '#b0b9c9', document: '#b0b9c9', asset: '#e5a777' };
export function Graph({ report, selected, highlighted, onSelect, query, onlyIssues, showTypes, viewKey }: {
    report: Report;
    selected: string | null;
    highlighted: Set<string> | null;
    onSelect: (id: string) => void;
    query: string;
    onlyIssues: boolean;
    showTypes: boolean;
    viewKey: string;
}) {
    const ref = useRef<HTMLDivElement>(null), [size, setSize] = useState({ w: 800, h: 650 }), [camera, setCamera] = useState({ x: 0, y: 0, z: .65 }), [positions, setPositions] = useState<Record<string, {
        x: number;
        y: number;
    }>>({});
    const drag = useRef<{
        id: string | null;
        x: number;
        y: number;
        ox: number;
        oy: number;
        moved: boolean;
    } | null>(null), pointers = useRef(new Map<number, {
        x: number;
        y: number;
    }>()), pinch = useRef<{
        distance: number;
        z: number;
        x: number;
        y: number;
        cx: number;
        cy: number;
    } | null>(null);
    const issueFiles = useMemo(() => new Set(report.findings.flatMap(f => f.files)), [report]), cycleFiles = useMemo(() => new Set(report.findings.filter(f => f.kind === 'cycle').flatMap(f => f.files)), [report]);
    const nodes = useMemo(() => report.nodes.filter(n => (!highlighted || highlighted.has(n.id)) && (!onlyIssues || issueFiles.has(n.id))), [report, highlighted, onlyIssues, issueFiles]), nodeIds = useMemo(() => new Set(nodes.map(n => n.id)), [nodes]), nodeMap = useMemo(() => new Map(nodes.map(n => [n.id, n])), [nodes]);
    const links = useMemo(() => report.edges.filter(e => nodeIds.has(e.from) && nodeIds.has(e.to) && (showTypes || !e.typeOnly)), [report, nodeIds, showTypes]);
    const point = useCallback((n: FileNode) => positions[n.id] || { x: n.x, y: n.y }, [positions]);
    const bounds = useMemo(() => { if (!nodes.length)
        return { x: 0, y: 0, w: 600, h: 400 }; const pts = nodes.map(point), x = Math.min(...pts.map(p => p.x)) - 35, y = Math.min(...pts.map(p => p.y)) - 55; return { x, y, w: Math.max(...pts.map(p => p.x)) + W + 35 - x, h: Math.max(...pts.map(p => p.y)) + H + 55 - y }; }, [nodes, point]);
    const fit = useCallback(() => { const z = Math.max(.035, Math.min(.95, (size.w - 64) / bounds.w, (size.h - 120) / bounds.h)); setCamera({ z, x: (size.w - bounds.w * z) / 2 - bounds.x * z, y: (size.h - bounds.h * z) / 2 - bounds.y * z }); }, [bounds, size]);
    useEffect(() => { const el = ref.current; if (!el)
        return; const obs = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height })); obs.observe(el); return () => obs.disconnect(); }, []);
    useEffect(() => setPositions({}), [report]);
    useEffect(() => { fit(); }, [report, size.w, size.h, viewKey, onlyIssues]); // eslint-disable-line react-hooks/exhaustive-deps
    const zoom = useCallback((factor: number, x = size.w / 2, y = size.h / 2) => setCamera(c => { const z = Math.min(2.4, Math.max(.035, c.z * factor)); return { z, x: x - (x - c.x) * z / c.z, y: y - (y - c.y) * z / c.z }; }), [size]);
    useEffect(() => { const el = ref.current; if (!el)
        return; const wheel = (e: WheelEvent) => { e.preventDefault(); const r = el.getBoundingClientRect(); zoom(Math.exp(-e.deltaY * .0013), e.clientX - r.left, e.clientY - r.top); }; el.addEventListener('wheel', wheel, { passive: false }); return () => el.removeEventListener('wheel', wheel); }, [zoom]);
    const focus = () => { const n = nodes.find(n => n.id === selected); if (n) {
        const p = point(n);
        setCamera({ x: size.w / 2 - p.x - W / 2, y: size.h / 2 - p.y - H / 2, z: 1 });
    }
    else
        fit(); };
    const related = useMemo(() => new Set(selected ? [selected, ...report.edges.filter(e => e.from === selected || e.to === selected).flatMap(e => [e.from, e.to])] : []), [report, selected]);
    const controls = [{ label: 'Zoom in', icon: Plus, action: () => zoom(1.25) }, { label: 'Zoom out', icon: Minus, action: () => zoom(.8) }, { label: 'Fit all files', icon: Maximize2, action: fit }, { label: 'Focus selected file', icon: Focus, action: focus }, { label: 'Reset layout', icon: RotateCcw, action: () => { setPositions({}); fit(); } }];
    return <div className="graph-surface" ref={ref}><div className="graph-caption"><span className="micro-label">DEPENDENCY MAP</span><span>Arrows point to imported files</span></div>{!nodes.length && <div className="graph-empty">No files match this view. Try another filter.</div>}
 <svg className="graph-svg" width="100%" height="100%" aria-label="Interactive dependency map. Drag to pan, scroll to zoom, or select a file." onPointerDown={e => { if (e.button !== 0)
        return; pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (pointers.current.size === 2) {
        const [a, b] = [...pointers.current.values()], r = e.currentTarget.getBoundingClientRect();
        pinch.current = { distance: Math.hypot(a.x - b.x, a.y - b.y), z: camera.z, x: camera.x, y: camera.y, cx: (a.x + b.x) / 2 - r.left, cy: (a.y + b.y) / 2 - r.top };
        drag.current = null;
        e.currentTarget.setPointerCapture(e.pointerId);
        return;
    } const id = (e.target as Element).closest('[data-node]')?.getAttribute('data-node') || null, n = nodeMap.get(id || ''), p = n ? point(n) : { x: camera.x, y: camera.y }; drag.current = { id, x: e.clientX, y: e.clientY, ox: p.x, oy: p.y, moved: false }; e.currentTarget.setPointerCapture(e.pointerId); }} onPointerMove={e => { if (pointers.current.has(e.pointerId))
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (pinch.current && pointers.current.size === 2) {
        const [a, b] = [...pointers.current.values()], p = pinch.current, z = Math.max(.035, Math.min(2.4, p.z * Math.hypot(a.x - b.x, a.y - b.y) / Math.max(p.distance, 1)));
        setCamera({ z, x: p.cx - (p.cx - p.x) * z / p.z, y: p.cy - (p.cy - p.y) * z / p.z });
        return;
    } const d = drag.current; if (!d)
        return; const dx = e.clientX - d.x, dy = e.clientY - d.y; if (Math.abs(dx) + Math.abs(dy) > 4)
        d.moved = true; if (d.id)
        setPositions(p => ({ ...p, [d.id!]: { x: d.ox + dx / camera.z, y: d.oy + dy / camera.z } }));
    else
        setCamera(c => ({ ...c, x: d.ox + dx, y: d.oy + dy })); }} onPointerUp={e => { const d = drag.current; if (d?.id && !d.moved)
        onSelect(d.id); drag.current = null; pointers.current.delete(e.pointerId); pinch.current = null; }} onPointerCancel={e => { drag.current = null; pointers.current.delete(e.pointerId); pinch.current = null; }}>
 <defs><pattern id="dots" width={24 * camera.z} height={24 * camera.z} patternUnits="userSpaceOnUse" x={camera.x} y={camera.y}><circle cx="1" cy="1" r=".8" fill="#303342"/></pattern><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke"/></marker><filter id="node-glow" x="-20%" y="-30%" width="140%" height="170%"><feDropShadow dx="0" dy="0" stdDeviation="8" floodColor="#9775ff" floodOpacity=".2"/></filter></defs><rect width="100%" height="100%" fill="url(#dots)"/>
 <g transform={`translate(${camera.x},${camera.y}) scale(${camera.z})`}>{links.map((e, i) => { const a = nodeMap.get(e.from)!, b = nodeMap.get(e.to)!, p = point(a), q = point(b), forward = q.x > p.x, x1 = p.x + (forward ? W : 0), x2 = q.x + (forward ? 0 : W), d = Math.max(55, Math.abs(x2 - x1) * .55), active = selected === a.id || selected === b.id, cycle = cycleFiles.has(a.id) && cycleFiles.has(b.id); return <path key={i} d={a.id === b.id ? `M ${p.x + W} ${p.y + 20} C ${p.x + W + 85} ${p.y - 50}, ${p.x + W + 85} ${p.y + 120}, ${p.x + W} ${p.y + 50}` : `M ${x1} ${p.y + H / 2} C ${x1 + (forward ? d : -d)} ${p.y + H / 2}, ${x2 + (forward ? -d : d)} ${q.y + H / 2}, ${x2} ${q.y + H / 2}`} fill="none" stroke={cycle ? '#e6a258' : active ? '#a38af3' : '#555269'} strokeWidth={active ? 2.2 : 1.5} strokeDasharray={e.typeOnly ? '6 5' : undefined} opacity={selected && !active && !cycle ? .22 : active || cycle ? .9 : .5} markerEnd="url(#arrow)"/>; })}
 {nodes.map(n => { const p = point(n), active = n.id === selected, searched = !!query && n.id.toLowerCase().includes(query.toLowerCase()), dim = !!query && !searched || !!selected && !related.has(n.id) && !highlighted, color = colors[n.kind], cycle = cycleFiles.has(n.id), count = report.findings.filter(f => f.files.includes(n.id)).length; return <g key={n.id} transform={`translate(${p.x},${p.y})`} data-node={n.id} tabIndex={0} role="button" aria-label={`${n.id}, ${n.imports} imports, ${n.importedBy} dependents${count ? `, ${count} findings` : ''}`} aria-pressed={active} className="graph-node" opacity={dim ? .38 : 1} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onSelect(n.id);
    } }}><title>{n.id}</title><rect width={W} height={H} rx="10" fill={active ? '#242034' : '#181a24'} stroke={active || searched ? '#ab8eff' : cycle ? '#8b6444' : '#343541'} strokeWidth={active || searched ? 2 : 1.2} filter={active ? 'url(#node-glow)' : undefined}/><rect x="0" y="17" width="3" height="35" rx="1.5" fill={color}/><rect x="13" y="15" width="25" height="25" rx="6" fill={color} opacity=".12"/><text x="25.5" y="32" textAnchor="middle" fontSize="11" fontWeight="700" fill={color}>{n.kind === 'component' ? 'TSX' : n.name.endsWith('.js') ? 'JS' : n.kind === 'module' ? 'TS' : n.kind === 'style' ? 'CSS' : '{ }'}</text><text x="47" y="29" fill="#e7e6ee" fontSize="16" fontWeight="550">{n.name.length > 16 ? n.name.slice(0, 14) + '…' : n.name}</text><text x="47" y="49" fill="#90909f" fontSize="12">{n.folder.length > 22 ? '…' + n.folder.slice(-21) : n.folder}</text>{n.entry && <circle cx="185" cy="18" r="3" fill="#69d4ae"/>}{count > 0 && <g><circle cx="184" cy="51" r="9" fill={cycle ? '#4d3827' : '#2e293e'}/><text x="184" y="55" textAnchor="middle" fill={cycle ? '#efb46e' : '#b6a2e6'} fontSize="11" fontWeight="600">{count}</text></g>}</g>; })}</g></svg>
 <div className="graph-legend"><span><i style={{ background: colors.component }}/>Component</span><span><i style={{ background: colors.module }}/>Module</span><span><i style={{ background: '#e2ad70' }}/>Cycle</span><span><i style={{ background: '#69d4ae' }}/>Entry point</span></div><div className="graph-controls">{controls.map(c => <Tooltip key={c.label}><TooltipTrigger asChild><button onClick={c.action} aria-label={c.label}><c.icon size={16}/></button></TooltipTrigger><TooltipContent side="top">{c.label}</TooltipContent></Tooltip>)}<span>{Math.round(camera.z * 100)}%</span></div>
 <div className="minimap" aria-label="Map overview"><svg viewBox={`${bounds.x} ${bounds.y} ${bounds.w} ${bounds.h}`} width="100%" height="100%" onClick={e => { const r = e.currentTarget.getBoundingClientRect(), scale = Math.min(r.width / bounds.w, r.height / bounds.h), px = (e.clientX - r.left - (r.width - bounds.w * scale) / 2) / scale + bounds.x, py = (e.clientY - r.top - (r.height - bounds.h * scale) / 2) / scale + bounds.y; setCamera(c => ({ ...c, x: size.w / 2 - px * c.z, y: size.h / 2 - py * c.z })); }}>{nodes.map(n => { const p = point(n); return <rect key={n.id} x={p.x} y={p.y} width={W} height={H} rx="8" fill={n.id === selected ? '#b69af8' : colors[n.kind]} opacity=".65"/>; })}<rect x={-camera.x / camera.z} y={-camera.y / camera.z} width={size.w / camera.z} height={size.h / camera.z} fill="#ab8aff14" stroke="#b69af8" strokeWidth={2 / camera.z}/></svg></div><div className="graph-hint">Drag to explore <span>·</span> Scroll to zoom <span>·</span> Click a file to inspect</div></div>;
}
