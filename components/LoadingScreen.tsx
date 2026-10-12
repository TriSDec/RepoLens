'use client';
import { useEffect, useRef, useState } from 'react';
import { Mark } from './Icon';
import { fmt } from '@/lib/format';
import { DEFAULT_CAMERA, project, type Projected } from '@/lib/map3d';
import { LANG_COLORS, rgba } from '@/lib/palette';
import type { Stage, Status } from '@/lib/useAnalysis';

const STEPS: { stage: Stage; title: string }[] = [
    { stage: 'scan', title: 'Scanning folders' },
    { stage: 'read', title: 'Reading files' },
    { stage: 'analyze', title: 'Parsing code and following imports' },
    { stage: 'map', title: 'Laying out the map' },
];
const mb = (n: number) => (n < 1048576 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1048576).toFixed(1)} MB`);

/** Where the i-th discovered file sits: a sphere that fills outward, using a golden-angle sequence so it never reshuffles. */
function place(i: number): [number, number, number] {
    const u = (i * 0.6180339887) % 1, theta = i * 2.399963, y = 1 - 2 * u, rad = Math.sqrt(1 - y * y);
    const r = 0.18 + 0.82 * (1 - Math.exp(-i / 900)), wobble = 0.82 + 0.18 * Math.sin(i * 12.9898);
    return [Math.cos(theta) * rad * r * wobble, y * r * wobble, Math.sin(theta) * rad * r * wobble];
}

function Constellation({ dots, stage }: { dots: React.RefObject<string[]>; stage: Stage }) {
    const ref = useRef<HTMLCanvasElement>(null);
    const stageRef = useRef(stage);
    useEffect(() => { stageRef.current = stage; }, [stage]);
    useEffect(() => {
        const cv = ref.current!, ctx = cv.getContext('2d')!;
        const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
        const proj: Projected = { sx: 0, sy: 0, depth: 0, scale: 1 };
        let raf = 0, t = 0, w = 0, h = 0;
        const style = getComputedStyle(document.documentElement);
        const col = (n: string, d: string) => style.getPropertyValue(n).trim() || d;
        const text = col('--text', '#ebe5d6'), accent = col('--accent', '#e5603a'), muted = col('--muted', '#9a968a');
        const fit = () => {
            const r = cv.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
            w = Math.max(1, r.width); h = Math.max(1, r.height);
            cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        };
        fit();
        const ro = new ResizeObserver(fit); ro.observe(cv);
        const frame = () => {
            raf = requestAnimationFrame(frame);
            t += reduce ? 0 : 1;
            const list = dots.current ?? [], n = Math.max(list.length, 0);
            ctx.clearRect(0, 0, w, h);
            const cam = { ...DEFAULT_CAMERA, yaw: 0.4 + t * 0.0035, pitch: 0.38, zoom: 1.12, panX: 0, panY: 0 };
            // faint orbit rings
            ctx.lineWidth = 1;
            for (const ring of [0.55, 0.95, 1.3]) {
                ctx.beginPath();
                for (let k = 0; k <= 64; k++) { const a = (k / 64) * Math.PI * 2; project(Math.cos(a) * ring, 0, Math.sin(a) * ring, cam, w, h, proj); if (k) ctx.lineTo(proj.sx, proj.sy); else ctx.moveTo(proj.sx, proj.sy); }
                ctx.strokeStyle = rgba(text, 0.06); ctx.stroke();
            }
            if (n === 0) { // nothing discovered yet (or a ZIP/report): a calm placeholder swarm
                for (let i = 0; i < 90; i++) { const [x, y, z] = place(i * 7); project(x, y, z, cam, w, h, proj); ctx.fillStyle = rgba(muted, 0.25 + 0.2 * (proj.depth + 1) / 2); ctx.beginPath(); ctx.arc(proj.sx, proj.sy, 1.6 * proj.scale, 0, 6.2832); ctx.fill(); }
                return;
            }
            const shown = Math.min(n, 4000), pts: [number, number, number, number][] = [];
            for (let i = 0; i < shown; i++) { const [x, y, z] = place(i); project(x, y, z, cam, w, h, proj); pts.push([proj.sx, proj.sy, proj.depth, proj.scale]); }
            // links to earlier files, which gives the cluster a web-like structure as it grows
            ctx.beginPath();
            for (let i = 1; i < Math.min(shown, 1800); i++) for (const back of [1, 3, 8]) { const j = i - back; if (j < 0) continue; ctx.moveTo(pts[i][0], pts[i][1]); ctx.lineTo(pts[j][0], pts[j][1]); }
            ctx.strokeStyle = rgba(text, 0.07); ctx.stroke();
            for (let i = 0; i < shown; i++) {
                const [x, y, d, s] = pts[i], fresh = Math.max(0, 1 - (n - i) / 24); // the newest few glow
                const c = LANG_COLORS[list[i]] ?? muted, r = (1.9 + fresh * 3) * s * (shown > 1500 ? 0.8 : 1);
                ctx.fillStyle = rgba(c, (0.35 + 0.65 * (d + 1) / 2) * (0.75 + 0.25 * fresh));
                ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill();
                if (fresh > 0.2) { ctx.beginPath(); ctx.arc(x, y, r + 5 * fresh, 0, 6.2832); ctx.strokeStyle = rgba(accent, 0.5 * fresh); ctx.stroke(); }
            }
            if (stageRef.current === 'analyze' || stageRef.current === 'map') { // once everything is read, a slow pulse shows the graph being built
                const p = (t % 140) / 140; project(0, 0, 0, cam, w, h, proj);
                ctx.beginPath(); ctx.arc(proj.sx, proj.sy, 20 + p * Math.min(w, h) * 0.42, 0, 6.2832); ctx.strokeStyle = rgba(accent, 0.28 * (1 - p)); ctx.lineWidth = 1.4; ctx.stroke(); ctx.lineWidth = 1;
            }
        };
        raf = requestAnimationFrame(frame);
        return () => { cancelAnimationFrame(raf); ro.disconnect(); };
    }, [dots]);
    return <canvas ref={ref} className="loading-canvas" aria-hidden="true" />;
}

export default function LoadingScreen({ status, dots, onCancel }: { status: Status; dots: React.RefObject<string[]>; onCancel: () => void }) {
    const [now, setNow] = useState(0);
    useEffect(() => { const id = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(id); }, []);
    const elapsed = Math.max(0, Math.round(((now || status.startedAt) - status.startedAt) / 1000));
    const current = STEPS.findIndex(s => s.stage === status.stage);
    const folders = Object.entries(status.skippedFolders).sort((a, b) => b[1] - a[1]);
    const skippedFolderCount = folders.reduce((n, [, c]) => n + c, 0);
    const pct = Math.min(100, Math.max(0, status.progress));
    return (
        <div className="loading" role="dialog" aria-modal="true" aria-label="Analysing your project">
            <div className="loading-copy">
                <p className="wordmark"><Mark size={22} /><span>RepoLens</span></p>
                <p className="eyebrow"><span className="rule" />Working on your device</p>
                <h2 className="display loading-title">{STEPS[Math.max(0, current)].title}<em>…</em></h2>

                <ol className="steps" aria-label="Progress">
                    {STEPS.map((s, i) => (
                        <li key={s.stage} className={i < current ? 'is-done' : i === current ? 'is-active' : ''}>
                            <i aria-hidden="true">{i < current ? '✓' : String(i + 1)}</i><span>{s.title}</span>
                        </li>
                    ))}
                </ol>

                <div className="meter loading-meter" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${pct}%` }} /></div>

                <dl className="loading-stats">
                    <div><dt>Files found</dt><dd>{fmt(status.found)}</dd></div>
                    <div><dt>Skipped</dt><dd>{fmt(status.skipped + skippedFolderCount)}</dd></div>
                    <div><dt>Source read</dt><dd>{mb(status.bytes)}</dd></div>
                    <div><dt>Elapsed</dt><dd>{elapsed}s</dd></div>
                </dl>

                {folders.length > 0 && <p className="loading-skips">Not entered: {folders.slice(0, 5).map(([name, c]) => `${name}${c > 1 ? ` ×${c}` : ''}`).join(', ')}{folders.length > 5 ? ` and ${folders.length - 5} more` : ''}</p>}
                <p className="loading-path" title={status.current}><bdi>{status.current || ' '}</bdi></p>
                {status.found > 4000 && status.stage !== 'map' && <p className="loading-note">A large project. This can take up to half a minute.</p>}
                <p className="visually-live sr-only" aria-live="polite">{STEPS[Math.max(0, current)].title}, {pct}% done</p>

                <div className="loading-foot">
                    <button className="link" onClick={onCancel}>Cancel</button>
                    <span>Nothing leaves this device.</span>
                </div>
            </div>
            <div className="loading-art"><Constellation dots={dots} stage={status.stage} /></div>
        </div>
    );
}
