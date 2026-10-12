'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_CAMERA, MAX_ZOOM, MIN_ZOOM, clamp, easeCamera, fitZoom, orbit, panToCenter, pick, project, zoomAt, type Camera, type Projected } from '@/lib/map3d';
import { KIND_COLORS, LANG_COLORS, folderColor, rgba, riskColor } from '@/lib/palette';
import type { Report } from '@/lib/repolens/types';

export type ColorBy = 'language' | 'folder' | 'risk' | 'kind';
export type Highlight = { nodes: Set<string>; edges?: Set<string>; label?: string } | null;
export type MapApi = { reset(): void; focus(id: string): void; zoomBy(factor: number): void; snapshot(): Promise<Blob | null> };

type Props = {
    report: Report;
    selected: string | null;
    highlight?: Highlight;
    colorBy?: ColorBy;
    showEdges?: boolean;
    showLabels?: boolean;
    autoRotate?: boolean;
    interactive?: boolean;
    onSelect?: (id: string | null) => void;
    onReady?: (api: MapApi) => void;
    ariaLabel?: string;
    className?: string;
};

type Theme = { bg: string; text: string; muted: string; accent: string; teal: string; gold: string };
const readTheme = (): Theme => {
    const s = getComputedStyle(document.documentElement), v = (n: string, d: string) => s.getPropertyValue(n).trim() || d;
    return { bg: v('--bg', '#0b0c0d'), text: v('--text', '#ebe5d6'), muted: v('--muted', '#8f8b80'), accent: v('--accent', '#e5603a'), teal: v('--teal', '#7fbfae'), gold: v('--gold', '#d6a84f') };
};

export default function MindMap({ report, selected, highlight = null, colorBy = 'language', showEdges = true, showLabels = true, autoRotate = false, interactive = true, onSelect, onReady, ariaLabel, className }: Props) {
    const wrap = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null);
    const [tip, setTip] = useState<{ id: string; x: number; y: number } | null>(null);

    // ---- static data derived from the report ------------------------------------------------------------
    const model = useMemo(() => {
        const n = report.nodes.length, index = new Map(report.nodes.map((nd, i) => [nd.id, i]));
        const X = new Float32Array(n), Y = new Float32Array(n), Z = new Float32Array(n), base = new Float32Array(n);
        report.nodes.forEach((nd, i) => { X[i] = nd.x; Y[i] = nd.y; Z[i] = nd.z; base[i] = 2.9 + Math.min(7.5, Math.log2(1 + nd.importedBy) * 1.55 + (nd.entry ? 0.8 : 0)); });
        const ea: number[] = [], eb: number[] = [], eType: boolean[] = [];
        for (const e of report.edges) { const a = index.get(e.from), b = index.get(e.to); if (a !== undefined && b !== undefined) { ea.push(a); eb.push(b); eType.push(e.typeOnly); } }
        const out: number[][] = Array.from({ length: n }, () => []), inn: number[][] = Array.from({ length: n }, () => []);
        ea.forEach((a, k) => { out[a].push(eb[k]); inn[eb[k]].push(a); });
        const folderIndex = new Map(report.folders.map((f, i) => [f.id, i]));
        const nodeFolder = report.nodes.map(nd => folderIndex.get(nd.folder) ?? 0);
        const folderMembers: number[][] = report.folders.map(() => []);
        nodeFolder.forEach((f, i) => folderMembers[f]?.push(i));
        const trunks = report.folderEdges.map(e => ({ a: folderIndex.get(e.from), b: folderIndex.get(e.to), w: e.weight })).filter((t): t is { a: number; b: number; w: number } => t.a !== undefined && t.b !== undefined && t.a !== t.b);
        // Small cycles are drawn whole. A cycle spanning much of the project would turn the map solid red,
        // so for those only the shortest loop is highlighted.
        const cycleEdge = new Uint8Array(ea.length), cycleNode = new Uint8Array(n);
        for (const f of report.findings) if (f.kind === 'cycle') {
            if (f.files.length <= 40) {
                const set = new Set(f.files);
                f.files.forEach(id => { const i = index.get(id); if (i !== undefined) cycleNode[i] = 1; });
                ea.forEach((a, k) => { if (set.has(report.nodes[a].id) && set.has(report.nodes[eb[k]].id)) cycleEdge[k] = 1; });
            } else if (f.path) {
                const loop = new Set(f.path.slice(1).map((id, i) => `${f.path![i]}\0${id}`));
                f.path.forEach(id => { const i = index.get(id); if (i !== undefined) cycleNode[i] = 1; });
                ea.forEach((a, k) => { if (loop.has(`${report.nodes[a].id}\0${report.nodes[eb[k]].id}`)) cycleEdge[k] = 1; });
            }
        }
        const dist = Array.from({ length: n }, (_, i) => Math.hypot(X[i], Y[i], Z[i])).sort((a, b) => a - b);
        const radius = Math.max(0.2, dist[Math.floor(n * 0.92)] ?? 1); // frame most files; a few outliers may sit at the edge
        // deterministic background dust, so it never twinkles between renders
        const rng = { s: 99 }; const rnd = () => { rng.s = (Math.imul(rng.s, 1664525) + 1013904223) >>> 0; return rng.s / 4294967296; };
        const dust = Array.from({ length: 140 }, () => { const u = rnd() * 2 - 1, t = rnd() * Math.PI * 2, r = 1.2 + rnd() * 1.4, q = Math.sqrt(1 - u * u); return [r * q * Math.cos(t), r * u, r * q * Math.sin(t), 0.3 + rnd() * 0.7]; });
        const topByDeps = Array.from({ length: n }, (_, i) => i).filter(i => report.nodes[i].importedBy >= 3).sort((a, b) => report.nodes[b].importedBy - report.nodes[a].importedBy).slice(0, 400);
        return { n, topByDeps, index, X, Y, Z, base, folderMembers, trunks, ea: Int32Array.from(ea), eb: Int32Array.from(eb), eType, out, inn, nodeFolder, cycleEdge, cycleNode, radius, dust };
    }, [report]);

    // ---- everything the render loop reads lives in a ref so React never re-renders per frame ----------------
    const state = useRef({
        cam: { ...DEFAULT_CAMERA } as Camera, target: { ...DEFAULT_CAMERA } as Camera, dirty: true, lastInput: 0, hover: -1, w: 0, h: 0, dpr: 1,
        sx: new Float32Array(0), sy: new Float32Array(0), sd: new Float32Array(0), sr: new Float32Array(0), colors: null as { by: ColorBy; report: Report; muted: string; pal: string[]; idx: Uint16Array } | null, theme: null as Theme | null, visible: true, reduce: false, dragging: false, heavyUntil: 0, settle: false,
    });
    const live = useRef({ selected, highlight, colorBy, showEdges, showLabels, autoRotate, model, report, onSelect });
    useEffect(() => { // publish the latest props to the render loop after each commit
        live.current = { selected, highlight, colorBy, showEdges, showLabels, autoRotate, model, report, onSelect };
        state.current.dirty = true;
    });

    useEffect(() => {
        const st = state.current, { n, radius } = model;
        st.sx = new Float32Array(n); st.sy = new Float32Array(n); st.sd = new Float32Array(n); st.sr = new Float32Array(n);
        const z = fitZoom(radius);
        st.cam = { ...DEFAULT_CAMERA, zoom: z }; st.target = { ...st.cam }; st.dirty = true;
    }, [model]);

    // ---- render loop ---------------------------------------------------------------------------------------------
    useEffect(() => {
        const cv = canvas.current!, host = wrap.current!, st = state.current;
        const ctx = cv.getContext('2d', { alpha: false })!;
        st.reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
        st.theme = readTheme();
        const proj: Projected = { sx: 0, sy: 0, depth: 0, scale: 1 };

        const resize = () => {
            const r = host.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
            st.w = Math.max(1, Math.round(r.width)); st.h = Math.max(1, Math.round(r.height)); st.dpr = dpr;
            cv.width = Math.round(st.w * dpr); cv.height = Math.round(st.h * dpr);
            st.dirty = true;
        };
        const ro = new ResizeObserver(resize); ro.observe(host); resize();
        const themeObserver = new MutationObserver(() => { st.theme = readTheme(); st.dirty = true; });
        themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
        const io = new IntersectionObserver(([e]) => { st.visible = e.isIntersecting; if (e.isIntersecting) st.dirty = true; });
        io.observe(host);
        const onVisibility = () => { st.dirty = true; };
        document.addEventListener('visibilitychange', onVisibility);

        const draw = (heavy: boolean) => {
            const { w, h, dpr, cam } = st, th = st.theme!, L = live.current, M = L.model, nodes = L.report.nodes;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.fillStyle = th.bg; ctx.fillRect(0, 0, w, h);
            const g = ctx.createRadialGradient(w / 2 + cam.panX * 0.2, h / 2 + cam.panY * 0.2, 0, w / 2, h / 2, Math.max(w, h) * 0.7);
            g.addColorStop(0, rgba(th.text, 0.05)); g.addColorStop(1, rgba(th.text, 0));
            ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);

            // dust and orbit rings give the scene a sense of depth and rotation
            for (const [dx, dy, dz, a] of M.dust) {
                project(dx, dy, dz, cam, w, h, proj);
                ctx.fillStyle = rgba(th.text, 0.07 + 0.2 * a * (proj.depth + 1) / 2);
                ctx.fillRect(proj.sx, proj.sy, 1.2, 1.2);
            }
            ctx.lineWidth = 1;
            for (const [ring, tilt] of [[0.62, 0], [1.0, 0.35], [1.38, -0.25]] as const) {
                ctx.beginPath();
                for (let k = 0; k <= 72; k++) {
                    const t = (k / 72) * Math.PI * 2;
                    project(Math.cos(t) * ring, Math.sin(t) * ring * Math.sin(tilt), Math.sin(t) * ring * Math.cos(tilt), cam, w, h, proj);
                    if (k) ctx.lineTo(proj.sx, proj.sy); else ctx.moveTo(proj.sx, proj.sy);
                }
                ctx.strokeStyle = rgba(th.text, 0.045); ctx.stroke();
            }

            // project every node once
            const { n } = M, sx = st.sx, sy = st.sy, sd = st.sd, sr = st.sr;
            const zoomBoost = clamp(Math.pow(cam.zoom, 0.45), 0.7, 2.3);
            for (let i = 0; i < n; i++) {
                project(M.X[i], M.Y[i], M.Z[i], cam, w, h, proj);
                sx[i] = proj.sx; sy[i] = proj.sy; sd[i] = proj.depth; sr[i] = M.base[i] * proj.scale * zoomBoost;
            }

            const big = n > 3000, scaleDown = big ? clamp(Math.sqrt(3000 / n) * 1.15, 0.3, 1) : 1; // large projects draw smaller, batched dots
            if (big) for (let i = 0; i < n; i++) sr[i] *= scaleDown;

            // folder territories: a soft pool of colour and a hairline ring behind each constellation
            const territoryDim = live.current.selected !== null || live.current.highlight ? 0.3 : 1;
            const fcx = new Float32Array(L.report.folders.length), fcy = new Float32Array(L.report.folders.length), fcd = new Float32Array(L.report.folders.length), fcr = new Float32Array(L.report.folders.length);
            M.folderMembers.forEach((members, f) => {
                if (!members.length) return;
                let mx = 0, my = 0, md = 0;
                for (const i of members) { mx += sx[i]; my += sy[i]; md += sd[i]; }
                mx /= members.length; my /= members.length; md /= members.length;
                let rad = 0;
                for (const i of members) rad = Math.max(rad, Math.hypot(sx[i] - mx, sy[i] - my) + sr[i]);
                fcx[f] = mx; fcy[f] = my; fcd[f] = md; fcr[f] = rad + 14;
                if (members.length < 2) return;
                if (L.report.folders.length > 120) { if (members.length >= 25) { ctx.beginPath(); ctx.arc(mx, my, fcr[f], 0, 6.2832); ctx.strokeStyle = rgba(folderColor(f), 0.2 * territoryDim); ctx.lineWidth = 1; ctx.stroke(); } return; }
                const col = folderColor(f), fog = (0.5 + 0.5 * (md + 1) / 2) * territoryDim;
                const grad = ctx.createRadialGradient(mx, my, 0, mx, my, fcr[f] * 1.2);
                grad.addColorStop(0, rgba(col, 0.1 * fog)); grad.addColorStop(0.7, rgba(col, 0.035 * fog)); grad.addColorStop(1, rgba(col, 0));
                ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(mx, my, fcr[f] * 1.2, 0, 6.2832); ctx.fill();
                ctx.beginPath(); ctx.arc(mx, my, fcr[f], 0, 6.2832); ctx.strokeStyle = rgba(col, 0.16 * fog); ctx.lineWidth = 1; ctx.stroke();
            });

            // what is "in focus": the selection's neighbourhood, or an explicit highlight
            const sel = L.selected ? M.index.get(L.selected) ?? -1 : -1;
            const hl = L.highlight;
            const deps = new Set<number>(), users = new Set<number>(), lit = new Set<number>();
            if (sel >= 0) { M.out[sel].forEach(x => deps.add(x)); M.inn[sel].forEach(x => users.add(x)); }
            if (hl) for (const id of hl.nodes) { const i = M.index.get(id); if (i !== undefined) lit.add(i); }
            const focused = sel >= 0 || !!hl;
            const inFocus = (i: number) => !focused || i === sel || deps.has(i) || users.has(i) || lit.has(i);

            // trunks: how strongly whole folders lean on each other (the "branches" of the mind map)
            if (L.showEdges && !focused) {
                for (const t of M.trunks) {
                    if (!(L.report.folders[t.a].files > 1 || L.report.folders[t.b].files > 1)) continue;
                    ctx.beginPath(); curve(ctx, fcx[t.a], fcy[t.a], fcx[t.b], fcy[t.b], t.a * 7 + t.b);
                    ctx.strokeStyle = rgba(th.text, 0.1 + 0.07 * (fcd[t.a] + fcd[t.b] + 2) / 2); ctx.lineWidth = 0.8 + Math.min(3.2, Math.log2(1 + t.w) * 0.8); ctx.stroke();
                }
            }

            // edges
            if (L.showEdges) {
                const E = M.ea.length, stride = heavy && E > 5000 ? Math.ceil(E / (big ? 3000 : 5000)) : E > 20000 ? Math.ceil(E / 20000) : 1; // very large graphs draw a representative subset of links
                const baseAlpha = focused ? 0.06 : E > 2500 ? 0.16 : 0.27;
                const buckets: number[][] = [[], [], [], []];
                for (let k = 0; k < E; k += stride) {
                    const a = M.ea[k], b = M.eb[k];
                    const x1 = sx[a], y1 = sy[a], x2 = sx[b], y2 = sy[b];
                    if ((x1 < -50 && x2 < -50) || (x1 > w + 50 && x2 > w + 50) || (y1 < -50 && y2 < -50) || (y1 > h + 50 && y2 > h + 50)) continue;
                    if (focused && (a === sel || b === sel)) continue; // drawn brighter below
                    buckets[Math.min(3, Math.max(0, Math.floor(((sd[a] + sd[b]) / 2 + 1) * 2)))].push(k);
                }
                buckets.forEach((list, bi) => {
                    if (!list.length) return;
                    ctx.beginPath();
                    for (const k of list) curve(ctx, sx[M.ea[k]], sy[M.ea[k]], sx[M.eb[k]], sy[M.eb[k]], k);
                    ctx.strokeStyle = rgba(th.text, baseAlpha * (0.45 + bi * 0.3)); ctx.lineWidth = 0.8; ctx.stroke();
                });
                // loops in the dependency graph
                ctx.beginPath(); let any = false;
                for (let k = 0; k < E; k++) if (M.cycleEdge[k] && (!M.eType[k])) { curve(ctx, sx[M.ea[k]], sy[M.ea[k]], sx[M.eb[k]], sy[M.eb[k]], k); any = true; }
                if (any) { ctx.strokeStyle = rgba(th.accent, focused ? 0.35 : 0.55); ctx.lineWidth = 1.2; ctx.stroke(); }
                // the neighbourhood of the selected file
                if (sel >= 0) {
                    for (const [list, color] of [[M.out[sel], th.teal], [M.inn[sel], th.gold]] as const) {
                        ctx.beginPath();
                        for (const o of list) {
                            const from = list === M.out[sel] ? sel : o, to = list === M.out[sel] ? o : sel;
                            curve(ctx, sx[from], sy[from], sx[to], sy[to], from * 31 + to);
                        }
                        ctx.strokeStyle = rgba(color, 0.75); ctx.lineWidth = 1.5; ctx.stroke();
                        for (const o of list) { const from = list === M.out[sel] ? sel : o, to = list === M.out[sel] ? o : sel; arrow(ctx, sx[from], sy[from], sx[to], sy[to], sr[to], rgba(color, 0.9)); }
                    }
                }
                if (hl?.edges?.size) { // explicit path or finding
                    ctx.beginPath();
                    for (let k = 0; k < E; k++) if (hl.edges.has(`${nodes[M.ea[k]].id}\0${nodes[M.eb[k]].id}`)) curve(ctx, sx[M.ea[k]], sy[M.ea[k]], sx[M.eb[k]], sy[M.eb[k]], k);
                    ctx.strokeStyle = rgba(th.gold, 0.95); ctx.lineWidth = 2.2; ctx.stroke();
                }
            }

            // nodes, far to near
            let order: ArrayLike<number>;
            if (big) { // counting sort by depth: O(n) instead of a 50k-element comparison sort every frame
                const B = 32, count = new Int32Array(B + 1), slot = new Uint8Array(n);
                for (let i = 0; i < n; i++) { const k = Math.min(B - 1, Math.max(0, ((sd[i] + 1) * 0.5 * B) | 0)); slot[i] = k; count[k + 1]++; }
                for (let k = 0; k < B; k++) count[k + 1] += count[k];
                const sorted = new Int32Array(n);
                for (let i = 0; i < n; i++) sorted[count[slot[i]]++] = i;
                order = sorted;
            } else order = Array.from({ length: n }, (_, i) => i).sort((a, b) => sd[a] - sd[b]);
            const colorOf = (i: number): string => {
                const nd = nodes[i];
                switch (L.colorBy) {
                    case 'folder': return folderColor(M.nodeFolder[i]);
                    case 'risk': return nd.risk > 0 ? riskColor(nd.risk) : th.muted;
                    case 'kind': return KIND_COLORS[nd.kind] ?? th.muted;
                    default: return nd.lang ? LANG_COLORS[nd.lang] ?? th.muted : KIND_COLORS[nd.kind] ?? th.muted;
                }
            };
            const decorate = (i: number, r: number, c: string, a: number) => {
                const nd = nodes[i];
                if (M.cycleNode[i] && L.showEdges) { ctx.beginPath(); ctx.arc(sx[i], sy[i], r + 2.6, 0, 6.2832); ctx.strokeStyle = rgba(th.accent, 0.7 * a); ctx.lineWidth = 1.2; ctx.stroke(); }
                if (nd.entry && !nd.isTest) { ctx.beginPath(); ctx.arc(sx[i], sy[i], r + 3.4, 0, 6.2832); ctx.strokeStyle = rgba(th.gold, 0.55 * a); ctx.lineWidth = 0.9; ctx.setLineDash([2, 2.5]); ctx.stroke(); ctx.setLineDash([]); }
                if (i === sel) { const glow = ctx.createRadialGradient(sx[i], sy[i], r, sx[i], sy[i], r + 22); glow.addColorStop(0, rgba(c, 0.45)); glow.addColorStop(1, rgba(c, 0)); ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(sx[i], sy[i], r + 22, 0, 6.2832); ctx.fill(); }
                if (i === sel || i === st.hover) { ctx.beginPath(); ctx.arc(sx[i], sy[i], r + 5, 0, 6.2832); ctx.strokeStyle = rgba(th.text, i === sel ? 0.95 : 0.6); ctx.lineWidth = i === sel ? 1.8 : 1.2; ctx.stroke(); }
            };
            if (big) {
                // one path and one fill per colour and depth band instead of two strokes per file
                let cc = st.colors;
                if (!cc || cc.by !== L.colorBy || cc.report !== L.report || cc.muted !== th.muted) { // colours resolved once, not per file per frame
                    const pal: string[] = [], seen = new Map<string, number>(), idx = new Uint16Array(n);
                    for (let i = 0; i < n; i++) { const c = colorOf(i); let k = seen.get(c); if (k === undefined) { k = Math.min(pal.length, 65535); seen.set(c, k); pal.push(c); } idx[i] = k; }
                    cc = st.colors = { by: L.colorBy, report: L.report, muted: th.muted, pal, idx };
                }
                const P = cc.pal.length, groups: number[][] = Array.from({ length: 8 * P }, () => []);
                const fogOf = [0.5, 0.66, 0.82, 0.96];
                const step = heavy ? Math.max(1, Math.ceil(n / 14000)) : 1; // while dragging, draw a thinned-out cloud so it stays fluid
                for (let k = 0; k < n; k += step) {
                    const i = order[k], x = sx[i], y = sy[i];
                    if (x < -8 || x > w + 8 || y < -8 || y > h + 8) continue;
                    const band = Math.min(3, Math.max(0, Math.floor((sd[i] + 1) * 2)));
                    groups[(band * 2 + (focused && !inFocus(i) ? 1 : 0)) * P + cc.idx[i]].push(i);
                }
                for (let g = 0; g < groups.length; g++) {
                    const list = groups[g];
                    if (!list.length) continue;
                    const band = Math.floor(g / (2 * P)), dim = Math.floor(g / P) % 2 === 1;
                    ctx.globalAlpha = (dim ? 0.12 : 0.92) * fogOf[band]; ctx.fillStyle = cc.pal[g % P];
                    if (heavy) { for (const i of list) { const r = Math.max(1.1, sr[i]) * step ** 0.25; ctx.fillRect(sx[i] - r, sy[i] - r, r * 2, r * 2); } }
                    else {
                        ctx.beginPath();
                        for (const i of list) { const r = Math.max(1.1, sr[i]); ctx.moveTo(sx[i] + r, sy[i]); ctx.arc(sx[i], sy[i], r, 0, 6.2832); }
                        ctx.fill();
                    }
                }
                ctx.globalAlpha = 1;
                let rings = 0;
                for (let i = 0; i < n && rings < 400; i++) {
                    if (i !== sel && i !== st.hover && !(M.cycleNode[i] || nodes[i].entry)) continue;
                    if (!inFocus(i)) continue;
                    rings++;
                    decorate(i, Math.max(1.4, sr[i]), colorOf(i), 0.5 + 0.5 * (sd[i] + 1) / 2);
                }
                for (const i of [sel, st.hover]) if (i >= 0 && i < n) decorate(i, Math.max(1.4, sr[i]), colorOf(i), 1);
            } else for (let k = 0; k < n; k++) {
                const i = order[k], nd = nodes[i], r = Math.max(1.4, sr[i]), fog = 0.42 + 0.58 * (sd[i] + 1) / 2;
                const a = (inFocus(i) ? 1 : 0.14) * fog, c = colorOf(i);
                ctx.beginPath(); ctx.arc(sx[i], sy[i], r, 0, 6.2832);
                if (nd.isTest) { ctx.strokeStyle = rgba(c, a); ctx.lineWidth = 1.4; ctx.stroke(); ctx.fillStyle = rgba(th.bg, 0.8); ctx.fill(); }
                else { ctx.fillStyle = rgba(c, a * 0.92); ctx.fill(); ctx.strokeStyle = rgba(th.bg, 0.7); ctx.lineWidth = 1; ctx.stroke(); }
                decorate(i, r, c, a);
            }

            // labels with greedy overlap rejection
            if (L.showLabels) {
                const placed: number[][] = [];
                const free = (x: number, y: number, tw: number, th2: number) => { for (const p of placed) if (x < p[0] + p[2] && x + tw > p[0] && y < p[1] + p[3] && y + th2 > p[1]) return false; return x > 2 && x + tw < w - 2 && y > 8 && y < h - 4; };
                const put = (text: string, x: number, y: number, font: string, color: string, align: CanvasTextAlign = 'center') => {
                    ctx.font = font;
                    const tw = ctx.measureText(text).width, left = align === 'center' ? x - tw / 2 : x;
                    if (!free(left, y - 11, tw + 6, 14)) return false;
                    placed.push([left, y - 11, tw + 6, 14]);
                    ctx.textAlign = align; ctx.fillStyle = color; ctx.fillText(text, x, y);
                    return true;
                };
                ctx.textBaseline = 'alphabetic';
                // selected, hovered and neighbouring files first (highest priority)
                const priority: number[] = [];
                if (sel >= 0) priority.push(sel);
                if (st.hover >= 0 && st.hover !== sel) priority.push(st.hover);
                if (sel >= 0 && deps.size + users.size <= 14) { deps.forEach(i => priority.push(i)); users.forEach(i => priority.push(i)); }
                if (hl && lit.size <= 16) lit.forEach(i => priority.push(i));
                for (const i of priority) put(nodes[i].name, sx[i], sy[i] - sr[i] - 9, `${i === sel ? 600 : 500} 12px var(--font-mono), monospace`, rgba(th.text, 0.95));
                if (!focused) {
                    const named = L.report.folders.length > 60 ? [...L.report.folders].sort((a, b) => b.files - a.files).slice(0, 60) : L.report.folders;
                    for (const f of named) { // constellation names
                        if (f.files < 2) continue;
                        project(f.x, f.y, f.z, cam, w, h, proj);
                        const alpha = 0.3 + 0.55 * (proj.depth + 1) / 2;
                        put(f.id.split('/').pop() || f.id, proj.sx, proj.sy - 4, `italic ${Math.round(clamp(15 * proj.scale * Math.pow(cam.zoom, 0.25), 12, 24))}px var(--font-display), serif`, rgba(th.text, alpha * 0.8));
                    }
                    if (cam.zoom > 1.5) {
                        const top = M.topByDeps.filter(i => sx[i] > 0 && sx[i] < w && sy[i] > 0 && sy[i] < h).slice(0, 24);
                        for (const i of top) put(nodes[i].name, sx[i], sy[i] - sr[i] - 7, '500 11px var(--font-mono), monospace', rgba(th.muted, 0.95));
                    }
                }
            }
        };

        const curve = (c: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, seed: number) => {
            const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1, bow = Math.min(60, len * 0.12) * (seed & 1 ? 1 : -1);
            c.moveTo(x1, y1); c.quadraticCurveTo((x1 + x2) / 2 - (dy / len) * bow, (y1 + y2) / 2 + (dx / len) * bow, x2, y2);
        };
        const arrow = (c: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, rTo: number, color: string) => {
            const ang = Math.atan2(y2 - y1, x2 - x1), tipX = x2 - Math.cos(ang) * (rTo + 4), tipY = y2 - Math.sin(ang) * (rTo + 4);
            c.beginPath(); c.moveTo(tipX, tipY); c.lineTo(tipX - Math.cos(ang - 0.45) * 7, tipY - Math.sin(ang - 0.45) * 7); c.lineTo(tipX - Math.cos(ang + 0.45) * 7, tipY - Math.sin(ang + 0.45) * 7); c.closePath(); c.fillStyle = color; c.fill();
        };

        let raf = 0, running = true;
        const frame = () => {
            if (!running) return;
            raf = requestAnimationFrame(frame);
            if (!st.visible || document.hidden) return;
            const L = live.current;
            if (L.autoRotate && L.model.n <= 8000 && !st.reduce && !st.dragging && performance.now() - st.lastInput > 2500 && L.selected === null) { st.cam.yaw += 0.0016; st.target.yaw = st.cam.yaw; st.dirty = true; }
            if (st.reduce) { Object.assign(st.cam, st.target); }
            else if (easeCamera(st.cam, st.target)) st.dirty = true;
            const thin = L.model.n > 3000 && performance.now() < st.heavyUntil; // hovering a huge map redraws a thinned cloud, then settles
            if (!thin && st.settle && !st.dirty) st.dirty = true;
            if (st.dirty) { st.dirty = false; st.settle = thin; draw(st.dragging || thin || (L.autoRotate && L.model.n <= 8000)); }
        };
        raf = requestAnimationFrame(frame);

        // ---- API for the surrounding UI ------------------------------------------------------------------------------
        const api: MapApi = {
            reset() { st.target = { ...DEFAULT_CAMERA, zoom: fitZoom(live.current.model.radius) }; st.lastInput = performance.now(); st.dirty = true; },
            focus(id) {
                const M = live.current.model, i = M.index.get(id);
                if (i === undefined) return;
                const zoom = clamp(Math.max(st.target.zoom, 1.9), MIN_ZOOM, MAX_ZOOM);
                const pan = panToCenter(M.X[i], M.Y[i], M.Z[i], { ...st.target, zoom }, st.w, st.h);
                st.target = { ...st.target, zoom, ...pan }; st.lastInput = performance.now(); st.dirty = true;
            },
            zoomBy(factor) { st.target = zoomAt(st.target, factor, st.w / 2, st.h / 2, st.w, st.h); st.lastInput = performance.now(); st.dirty = true; },
            snapshot() { st.dirty = true; draw(false); return new Promise(res => cv.toBlob(b => res(b), 'image/png')); },
        };
        onReady?.(api);

        return () => { running = false; cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); themeObserver.disconnect(); document.removeEventListener('visibilitychange', onVisibility); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ---- pointer, wheel and keyboard ------------------------------------------------------------------------------
    useEffect(() => {
        if (!interactive) return;
        const cv = canvas.current!, st = state.current;
        const pointers = new Map<number, { x: number; y: number }>();
        let moved = 0, mode: 'orbit' | 'pan' = 'orbit', pinch = 0, downAt = { x: 0, y: 0 };
        const local = (e: PointerEvent | WheelEvent) => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
        const touch = () => { st.lastInput = performance.now(); st.dirty = true; };
        const hit = (x: number, y: number) => pick(st.sx, st.sy, st.sd, st.sr, x, y, 5);

        const down = (e: PointerEvent) => {
            cv.setPointerCapture(e.pointerId); const p = local(e); pointers.set(e.pointerId, p);
            moved = 0; downAt = p; st.dragging = true;
            mode = e.button === 1 || e.button === 2 || e.shiftKey ? 'pan' : 'orbit';
            if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); }
            st.target = { ...st.cam }; touch();
        };
        const move = (e: PointerEvent) => {
            const p = local(e), prev = pointers.get(e.pointerId);
            if (!prev) { // hover
                const i = hit(p.x, p.y);
                if (i !== st.hover) { st.hover = i; st.dirty = true; st.heavyUntil = performance.now() + 220; setTip(i >= 0 ? { id: live.current.report.nodes[i].id, x: p.x, y: p.y } : null); }
                else if (i >= 0) setTip({ id: live.current.report.nodes[i].id, x: p.x, y: p.y });
                cv.style.cursor = i >= 0 ? 'pointer' : 'grab';
                return;
            }
            pointers.set(e.pointerId, p);
            const dx = p.x - prev.x, dy = p.y - prev.y; moved += Math.abs(dx) + Math.abs(dy);
            if (pointers.size === 2) {
                const [a, b] = [...pointers.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
                if (pinch > 0) { st.cam = zoomAt(st.cam, d / pinch, (a.x + b.x) / 2, (a.y + b.y) / 2, st.w, st.h); }
                pinch = d;
            } else if (mode === 'pan') { st.cam = { ...st.cam, panX: st.cam.panX + dx, panY: st.cam.panY + dy }; }
            else st.cam = orbit(st.cam, dx, dy);
            st.target = { ...st.cam }; cv.style.cursor = 'grabbing'; touch();
        };
        const up = (e: PointerEvent) => {
            pointers.delete(e.pointerId); pinch = 0;
            if (pointers.size === 0) {
                st.dragging = false; touch();
                if (moved < 6) { const i = hit(downAt.x, downAt.y); live.current.onSelect?.(i >= 0 ? live.current.report.nodes[i].id : null); }
            }
        };
        const leave = () => { if (st.hover !== -1) { st.hover = -1; st.dirty = true; setTip(null); } };
        const wheel = (e: WheelEvent) => { e.preventDefault(); const p = local(e); st.cam = zoomAt(st.cam, Math.exp(-e.deltaY * 0.0016), p.x, p.y, st.w, st.h); st.target = { ...st.cam }; touch(); };
        const dbl = (e: MouseEvent) => {
            const r = cv.getBoundingClientRect(), i = hit(e.clientX - r.left, e.clientY - r.top), M = live.current.model;
            if (i >= 0) { const zoom = Math.max(st.target.zoom, 1.9); st.target = { ...st.target, zoom, ...panToCenter(M.X[i], M.Y[i], M.Z[i], { ...st.target, zoom }, st.w, st.h) }; }
            else st.target = { ...DEFAULT_CAMERA, zoom: fitZoom(M.radius) };
            touch();
        };
        const key = (e: KeyboardEvent) => {
            const step = e.shiftKey ? 40 : 16; let handled = true;
            if (e.key === 'ArrowLeft') st.cam = orbit(st.cam, -step, 0); else if (e.key === 'ArrowRight') st.cam = orbit(st.cam, step, 0);
            else if (e.key === 'ArrowUp') st.cam = orbit(st.cam, 0, -step); else if (e.key === 'ArrowDown') st.cam = orbit(st.cam, 0, step);
            else if (e.key === '+' || e.key === '=') st.cam = zoomAt(st.cam, 1.2, st.w / 2, st.h / 2, st.w, st.h); else if (e.key === '-') st.cam = zoomAt(st.cam, 1 / 1.2, st.w / 2, st.h / 2, st.w, st.h);
            else if (e.key === '0') st.target = { ...DEFAULT_CAMERA, zoom: fitZoom(live.current.model.radius) };
            else if (e.key === 'Escape') live.current.onSelect?.(null); else handled = false;
            if (handled) { e.preventDefault(); if (e.key !== '0') st.target = { ...st.cam }; touch(); }
        };
        cv.addEventListener('pointerdown', down); cv.addEventListener('pointermove', move); cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
        cv.addEventListener('pointerleave', leave); cv.addEventListener('wheel', wheel, { passive: false }); cv.addEventListener('dblclick', dbl); cv.addEventListener('keydown', key);
        cv.addEventListener('contextmenu', ev => ev.preventDefault());
        return () => {
            cv.removeEventListener('pointerdown', down); cv.removeEventListener('pointermove', move); cv.removeEventListener('pointerup', up); cv.removeEventListener('pointercancel', up);
            cv.removeEventListener('pointerleave', leave); cv.removeEventListener('wheel', wheel); cv.removeEventListener('dblclick', dbl); cv.removeEventListener('keydown', key);
        };
    }, [interactive]);

    const tipNode = tip ? report.nodes[model.index.get(tip.id) ?? -1] : null;
    const wrapStyle = { position: 'absolute', inset: 0 } as const;
    return (
        <div ref={wrap} className={className} style={wrapStyle}>
            <canvas ref={canvas} role="img" tabIndex={interactive ? 0 : -1} aria-label={ariaLabel ?? `Interactive 3D map of ${report.nodes.length} files and ${report.edges.length} connections. Drag to rotate, scroll to zoom, arrow keys to orbit.`} style={{ width: '100%', height: '100%', display: 'block', touchAction: 'none', cursor: interactive ? 'grab' : 'default', outline: 'none' }} />
            {tip && tipNode && (
                <div className="map-tip" style={{ left: `min(${tip.x + 14}px, calc(100% - 230px))`, top: tip.y + 14 }}>
                    <strong>{tipNode.name}</strong>
                    <span>{tipNode.folder}</span>
                    <span>{tipNode.importedBy} dependents · {tipNode.lines} lines{tipNode.risk ? ` · risk ${tipNode.risk}` : ''}</span>
                </div>
            )}
        </div>
    );
}
