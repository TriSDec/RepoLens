'use client';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import CommandPalette, { type Command, type PaletteMode } from './CommandPalette';
import Icon, { Mark } from './Icon';
import Inspector from './Inspector';
import Landing from './Landing';
import LoadingScreen from './LoadingScreen';
import MapHud from './MapHud';
import MindMap, { type ColorBy, type Highlight, type MapApi } from './MindMap';
import Rail from './Rail';
import { VIEWS, type TraceMode, type View } from './types';
import { ArchitectureView, FindingsView, HotspotsView, PackagesView } from './Views';
import { download, fmt, slug } from '@/lib/format';
import { readDropped } from '@/lib/dropped';
import { exclusion, limitError } from '@/lib/repolens/input';
import { fromFileList, fromHandle, type DirSource } from '@/lib/scan';
import { toMarkdown } from '@/lib/repolens/report';
import { MAX_REPORT_BYTES } from '@/lib/repolens/schema';
import { LIMITS, shortestPath, trace as traceFrom, type Finding, type Report } from '@/lib/repolens/types';
import { useAnalysis } from '@/lib/useAnalysis';

type Origin = 'sample' | 'project' | 'saved';
type Theme = 'ink' | 'paper';

const readTheme = (): Theme => (document.documentElement.dataset.theme === 'paper' ? 'paper' : 'ink');
function subscribeTheme(notify: () => void) {
    const observer = new MutationObserver(notify);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
}

export default function RepoLensApp() {
    const theme = useSyncExternalStore(subscribeTheme, readTheme, () => 'ink' as Theme);
    const main = useAnalysis();
    const [sample, setSample] = useState<Report | null>(null);
    const [report, setReport] = useState<Report | null>(null);
    const [origin, setOrigin] = useState<Origin>('project');
    const [view, setView] = useState<View>('map');
    const [selected, setSelected] = useState<string | null>(null);
    const [finding, setFinding] = useState<Finding | null>(null);
    const [traceMode, setTraceMode] = useState<TraceMode>('none');
    const [pathTarget, setPathTarget] = useState<string | null>(null);
    const [colorBy, setColorBy] = useState<ColorBy>('language');
    const [showEdges, setShowEdges] = useState(true), [showLabels, setShowLabels] = useState(true), [autoRotate, setAutoRotate] = useState(false);
    const [palette, setPalette] = useState<PaletteMode | null>(null);
    const [help, setHelp] = useState(false);
    const [railOpen, setRailOpen] = useState(false);
    const [dragging, setDragging] = useState(false);
    const [localError, setLocalError] = useState('');
    const [gitignore, setGitignore] = useState(true);
    // a folder opened with the directory picker (or dropped) can be scanned again after you edit code, without choosing it again
    const lastScan = useRef<{ name: string; source: () => DirSource } | null>(null);
    const [canRescan, setCanRescan] = useState(false);
    // visited files, so Alt+Left / Alt+Right (and the arrows in the details panel) walk back through a trail of imports
    const [trail, setTrail] = useState<{ stack: string[]; at: number }>({ stack: [], at: -1 });
    const canPickDirectory = useSyncExternalStore(() => () => {}, () => 'showDirectoryPicker' in window, () => false);
    const [toast, setToast] = useState('');
    const [mapApi, setMapApi] = useState<MapApi | null>(null);
    const folderInput = useRef<HTMLInputElement>(null), zipInput = useRef<HTMLInputElement>(null), reportInput = useRef<HTMLInputElement>(null), search = useRef<HTMLInputElement>(null);
    const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const say = useCallback((message: string) => { setToast(message); if (toastTimer.current) clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(''), 3800); }, []);

    // ---- theme -------------------------------------------------------------------------------------------------
    const toggleTheme = useCallback(() => {
        const next: Theme = document.documentElement.dataset.theme === 'paper' ? 'ink' : 'paper';
        document.documentElement.dataset.theme = next;
        try { localStorage.setItem('repolens-theme', next); } catch { /* private mode: the choice just will not persist */ }
    }, []);

    // ---- the sample project shown on the landing page ------------------------------------------------------------------
    useEffect(() => { import('@/lib/sample-report.json').then(m => setSample(m.default as unknown as Report)); }, []);

    // ---- loading a project -----------------------------------------------------------------------------------------------
    const load = useCallback((r: Report, from: Origin) => {
        setReport(r); setOrigin(from); setView('map'); setSelected(null); setFinding(null); setTraceMode('none'); setPathTarget(null); setLocalError(''); setRailOpen(false); setTrail({ stack: [], at: -1 });
        if (from !== 'sample') say(from === 'saved' ? 'Report opened. No source code is in it.' : `Analysed ${fmt(r.nodes.length)} files on this device.`);
    }, [say]);

    // The classic folder chooser hands over every file at once, including dependency folders, so those are dropped up front.
    const analyzeFileList = useCallback((files: File[]) => {
        if (!files.length) { setLocalError('That folder has no readable files.'); return; }
        const rel = (f: File) => (f.webkitRelativePath || f.name).replace(/\\/g, '/');
        const kept = files.filter(f => /(^|\/)\.gitignore$/.test(rel(f)) || !exclusion(rel(f))); // .gitignore files stay so the scanner can read them
        if (!kept.length) { setLocalError('Every file in that folder is a dependency, build output or another kind of file RepoLens always skips.'); return; }
        setLocalError('');
        try {
            const source = fromFileList(kept, kept.map(rel));
            lastScan.current = null; setCanRescan(false); // a snapshot of files cannot be re-read
            main.runScan(source.rootName, () => source, gitignore, r => load(r, 'project'), files.length - kept.length);
        } catch (error) { setLocalError(error instanceof Error ? error.message : 'That folder could not be read.'); }
    }, [main, load, gitignore]);
    const analyzeZip = useCallback(async (file: File) => {
        if (file.size > LIMITS.archive) { setLocalError(limitError.zipSize().message); return; }
        setLocalError('');
        try { main.run({ name: file.name.replace(/\.zip$/i, ''), zip: await file.arrayBuffer(), gitignore }, r => load(r, 'project')); }
        catch { setLocalError('That ZIP could not be read. Try selecting it again.'); }
    }, [main, load, gitignore]);
    const rescan = useCallback(() => {
        const last = lastScan.current;
        if (!last) return;
        setLocalError('');
        main.runScan(last.name, last.source, gitignore, r => load(r, 'project'));
    }, [main, load, gitignore]);
    const openReport = useCallback(async (file: File) => {
        if (file.size > MAX_REPORT_BYTES) { setLocalError('That file is too large to be a RepoLens report.'); return; }
        setLocalError('');
        try { main.run({ name: file.name, reportText: await file.text() }, r => load(r, 'saved')); }
        catch { setLocalError('That file could not be read.'); }
    }, [main, load]);

    // Chromium browsers can open a folder through the directory picker, which lets RepoLens skip dependency
    // folders without ever listing them. Other browsers fall back to the classic folder chooser.
    const pickDirectory = useCallback(async () => {
        try {
            const handle = await (window as unknown as { showDirectoryPicker(options?: { mode?: string }): Promise<FileSystemDirectoryHandle> }).showDirectoryPicker({ mode: 'read' });
            setLocalError('');
            lastScan.current = { name: handle.name, source: () => fromHandle(handle) }; setCanRescan(true);
            main.runScan(handle.name, () => fromHandle(handle), gitignore, r => load(r, 'project'));
        } catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError') return; // the person closed the picker
            folderInput.current?.click();
        }
    }, [main, load, gitignore]);
    const pick = useCallback((kind: 'folder' | 'zip' | 'report') => {
        if (kind === 'folder' && canPickDirectory) { void pickDirectory(); return; }
        (kind === 'folder' ? folderInput : kind === 'zip' ? zipInput : reportInput).current?.click();
    }, [canPickDirectory, pickDirectory]);

    // drag and drop anywhere on the page
    useEffect(() => {
        let depth = 0;
        const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');
        const enter = (e: DragEvent) => { if (hasFiles(e)) { depth++; setDragging(true); e.preventDefault(); } };
        const over = (e: DragEvent) => { if (hasFiles(e)) e.preventDefault(); };
        const leave = () => { depth = Math.max(0, depth - 1); if (!depth) setDragging(false); };
        const drop = async (e: DragEvent) => {
            if (!hasFiles(e)) return;
            e.preventDefault(); depth = 0; setDragging(false);
            try {
                const d = await readDropped(e.dataTransfer!.items);
                if (d.kind === 'zip') void analyzeZip(d.file);
                else if (d.kind === 'report') void openReport(d.file);
                else if (d.kind === 'folder') { setLocalError(''); lastScan.current = { name: d.name, source: () => d.source }; setCanRescan(true); main.runScan(d.name, () => d.source, gitignore, r => load(r, 'project')); }
            } catch (error) { setLocalError(error instanceof Error ? error.message : 'That could not be read.'); }
        };
        window.addEventListener('dragenter', enter); window.addEventListener('dragover', over); window.addEventListener('dragleave', leave); window.addEventListener('drop', drop);
        return () => { window.removeEventListener('dragenter', enter); window.removeEventListener('dragover', over); window.removeEventListener('dragleave', leave); window.removeEventListener('drop', drop); };
    }, [analyzeZip, openReport, main, load, gitignore]);

    // ---- selection ------------------------------------------------------------------------------------------------------------
    const show = useCallback((id: string | null) => { setSelected(id); setFinding(null); setTraceMode('none'); setPathTarget(null); if (id) setRailOpen(false); }, []);
    const selectFile = useCallback((id: string | null) => {
        show(id);
        if (id) setTrail(t => { if (t.stack[t.at] === id) return t; const stack = [...t.stack.slice(0, t.at + 1), id].slice(-80); return { stack, at: stack.length - 1 }; });
    }, [show]);
    const walk = useCallback((delta: number) => {
        const to = trail.at + delta;
        if (to < 0 || to >= trail.stack.length) return;
        setTrail({ ...trail, at: to });
        show(trail.stack[to]);
        if (view === 'map') setTimeout(() => mapApi?.focus(trail.stack[to]), 60);
    }, [trail, show, view, mapApi]);
    const openFinding = useCallback((f: Finding) => { setFinding(f); setSelected(null); setTraceMode('none'); setPathTarget(null); setRailOpen(false); if (f.files[0] && view === 'map') setTimeout(() => mapApi?.focus(f.files[0]), 60); }, [view, mapApi]);
    const showFindingOnMap = useCallback((f: Finding) => { setView('map'); if (f.files[0]) setTimeout(() => mapApi?.focus(f.files[0]), 50); }, [mapApi]);
    const closeReading = useCallback(() => { setSelected(null); setFinding(null); setTraceMode('none'); setPathTarget(null); }, []);

    const highlight = useMemo<Highlight>(() => {
        if (!report) return null;
        const pairs = (ids: string[]) => new Set(ids.slice(1).map((id, i) => `${ids[i]}\0${id}`));
        if (selected && pathTarget) {
            const p = shortestPath(selected, pathTarget, report.edges);
            return p ? { nodes: new Set(p), edges: pairs(p), label: `Path: ${p.length - 1} import${p.length === 2 ? '' : 's'} from ${p[0].split('/').pop()} to ${p.at(-1)!.split('/').pop()}` } : null;
        }
        if (finding) {
            const ids = finding.path && finding.path.length > 1 ? finding.path : finding.files;
            return { nodes: new Set([...finding.files, ...ids]), edges: finding.path ? pairs(finding.path) : undefined, label: finding.title };
        }
        if (selected && traceMode !== 'none') {
            const set = traceFrom(selected, report.edges, traceMode === 'deps' ? 'dependencies' : 'impact');
            const edges = new Set<string>();
            for (const e of report.edges) if (set.has(e.from) && set.has(e.to)) edges.add(`${e.from}\0${e.to}`);
            return { nodes: set, edges, label: traceMode === 'deps' ? `Everything ${selected.split('/').pop()} relies on (${set.size - 1})` : `Everything affected by ${selected.split('/').pop()} (${set.size - 1})` };
        }
        return null;
    }, [report, selected, pathTarget, finding, traceMode]);

    const path = useMemo(() => (report && selected && pathTarget ? shortestPath(selected, pathTarget, report.edges) : null), [report, selected, pathTarget]);

    // ---- exports ----------------------------------------------------------------------------------------------------------------
    const exportJson = useCallback(() => { if (report) { download(`${slug(report.name)}-repolens.json`, JSON.stringify(report)); say('Report saved. It holds paths and findings, no source code.'); } }, [report, say]);
    const exportMd = useCallback(() => { if (report) { download(`${slug(report.name)}-repolens.md`, toMarkdown(report), 'text/markdown'); say('Summary saved.'); } }, [report, say]);
    const exportPng = useCallback(async () => {
        if (!report) return;
        setView('map');
        const blob = await mapApi?.snapshot();
        if (blob) { download(`${slug(report.name)}-map.png`, blob); say('Map image saved.'); }
    }, [report, mapApi, say]);

    // ---- keyboard ---------------------------------------------------------------------------------------------------------------------
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const typing = (e.target as HTMLElement)?.closest('input, textarea, select, [contenteditable]');
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette(p => (p ? null : { kind: 'go' })); }
            else if (e.key === '/' && !typing && report) { e.preventDefault(); setRailOpen(true); setTimeout(() => search.current?.focus(), 30); }
            else if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !typing && report) { e.preventDefault(); walk(e.key === 'ArrowLeft' ? -1 : 1); }
            else if (e.key === '?' && !typing) setHelp(h => !h);
            else if (e.key === 'Escape') { if (palette) setPalette(null); else if (help) setHelp(false); else if (!typing && (selected || finding)) closeReading(); }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [report, palette, help, selected, finding, closeReading, walk]);

    const commands = useMemo<Command[]>(() => {
        if (!report) return [];
        return [
            ...VIEWS.map(([v, label]) => ({ id: `view-${v}`, label: `Go to ${label}`, run: () => setView(v) })),
            { id: 'json', label: 'Save report (JSON)', hint: 'paths and findings only', run: exportJson },
            { id: 'md', label: 'Save summary (Markdown)', run: exportMd },
            { id: 'png', label: 'Save map as image', run: () => void exportPng() },
            { id: 'theme', label: theme === 'ink' ? 'Switch to paper theme' : 'Switch to ink theme', run: toggleTheme },
            ...(canRescan ? [{ id: 'rescan', label: 'Scan this folder again', hint: 'picks up your latest edits', run: rescan }] : []),
            { id: 'open', label: 'Open another project', run: () => pick('folder') },
            { id: 'help', label: 'Keyboard shortcuts', run: () => setHelp(true) },
        ];
    }, [report, theme, exportJson, exportMd, exportPng, toggleTheme, pick, canRescan, rescan]);

    const status = { ...main.status, error: main.status.error || localError };
    const reading = !!(selected || finding);
    const counts: Record<View, number | null> = { map: null, findings: report?.findings.length ?? 0, hotspots: null, architecture: null, packages: report?.externals.length ?? null };

    const inputs = (
        <>
            <input ref={folderInput} type="file" multiple hidden {...{ webkitdirectory: '' }} onChange={e => { const files = Array.from(e.target.files || []); e.target.value = ''; if (files.length) analyzeFileList(files); }} />
            <input ref={zipInput} type="file" accept=".zip,application/zip" hidden onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void analyzeZip(f); }} />
            <input ref={reportInput} type="file" accept=".json,application/json" hidden onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void openReport(f); }} />
        </>
    );
    const overlays = (
        <>
            {status.busy && <LoadingScreen status={status} dots={main.dots} onCancel={main.cancel} />}
            {dragging && <div className="drop-veil" aria-hidden="true"><p className="display">Release to analyse</p><span>A folder, a ZIP, or a saved report</span></div>}
            {toast && <div className="toast" role="status">{toast}</div>}
            <CommandPalette report={report} commands={commands} mode={palette} onClose={() => setPalette(null)} onGoToFile={id => { setView('map'); selectFile(id); setTimeout(() => mapApi?.focus(id), 60); }} />
            {help && (
                <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) setHelp(false); }}>
                    <div className="modal" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
                        <header><h2 className="display">Shortcuts</h2><button className="icon-btn" onClick={() => setHelp(false)} aria-label="Close"><Icon name="close" /></button></header>
                        <dl className="keys">
                            <dt><kbd>Ctrl</kbd>/<kbd>⌘</kbd> <kbd>K</kbd></dt><dd>Search files and actions</dd>
                            <dt><kbd>/</kbd></dt><dd>Find a file in the list</dd>
                            <dt><kbd>Esc</kbd></dt><dd>Close details or clear selection</dd>
                            <dt><kbd>Alt</kbd> <kbd>←</kbd><kbd>→</kbd></dt><dd>Previous / next file you looked at</dd>
                            <dt>Drag</dt><dd>Turn the map; shift-drag to pan</dd>
                            <dt>Scroll</dt><dd>Zoom toward the cursor</dd>
                            <dt>Double-click</dt><dd>Centre a file, or reset the view on empty space</dd>
                            <dt><kbd>←</kbd><kbd>↑</kbd><kbd>→</kbd><kbd>↓</kbd></dt><dd>Orbit (map focused)</dd>
                            <dt><kbd>+</kbd><kbd>−</kbd><kbd>0</kbd></dt><dd>Zoom in, out, reset (map focused)</dd>
                        </dl>
                    </div>
                </div>
            )}
        </>
    );

    if (!report) {
        return (
            <>
                <Landing sample={sample} status={status} dragging={dragging} onPick={pick} onSample={() => sample && load(sample, 'sample')} gitignore={gitignore} onGitignore={setGitignore} canPickDirectory={canPickDirectory} onTheme={toggleTheme} theme={theme} />
                {inputs}{overlays}
            </>
        );
    }

    return (
        <div className="ws">
            <header className="ws-top">
                <button className="icon-btn rail-toggle" onClick={() => setRailOpen(o => !o)} aria-label="Show the file list" aria-expanded={railOpen}><Icon name="menu" /></button>
                <button className="wordmark" onClick={() => setReport(null)} aria-label="Close project and return to the start page"><Mark size={22} /><span>RepoLens</span></button>
                <span className="origin">{origin === 'sample' ? 'Sample project' : origin === 'saved' ? 'Saved report' : 'On this device'}</span>
                <div className="ws-actions">
                    <button className="btn small" onClick={() => setPalette({ kind: 'go' })} aria-label="Search files and actions"><Icon name="search" size={15} /><span className="label">Search</span> <kbd>Ctrl K</kbd></button>
                    <details className="menu"><summary className="btn small"><Icon name="down" size={15} /> Export</summary>
                        <div className="menu-pop" onClick={e => (e.currentTarget.parentElement as HTMLDetailsElement).removeAttribute('open')}>
                            <button onClick={exportJson}>Report <small>JSON, reopenable</small></button>
                            <button onClick={exportMd}>Summary <small>Markdown</small></button>
                            <button onClick={() => void exportPng()}>Map image <small>PNG</small></button>
                            <button className="show-sm" onClick={() => pick('folder')}>Open another project</button>
                        </div>
                    </details>
                    {canRescan && origin === 'project' && <button className="btn small hide-sm" onClick={rescan} title="Scan this folder again to pick up your latest edits">Rescan</button>}
                    <button className="btn small hide-sm" onClick={() => pick('folder')}>Open another</button>
                    <button className="icon-btn" onClick={toggleTheme} aria-label={theme === 'ink' ? 'Switch to the light paper theme' : 'Switch to the dark ink theme'}><Icon name={theme === 'ink' ? 'sun' : 'moon'} /></button>
                    <button className="icon-btn hide-sm" onClick={() => setHelp(true)} aria-label="Keyboard shortcuts"><Icon name="help" /></button>
                    <button className="icon-btn" onClick={() => { setReport(null); }} aria-label="Close project"><Icon name="close" /></button>
                </div>
            </header>

            {status.error && !status.busy && <p className="notice top" role="alert"><Icon name="warn" size={16} />{status.error}</p>}

            <div className={`ws-body${railOpen ? ' rail-open' : ''}${reading ? ' has-reading' : ''}`}>
                <Rail report={report} selected={selected} activeFinding={finding?.id ?? null} onSelect={id => { selectFile(id); setView('map'); setTimeout(() => mapApi?.focus(id), 60); }} onOpenFinding={openFinding} search={search} />
                <main className="stage" id="main">
                    <div className="tabs" role="tablist" aria-label="Views">
                        {VIEWS.map(([v, label]) => (
                            <button key={v} role="tab" aria-selected={view === v} className={view === v ? 'is-on' : ''} onClick={() => setView(v)}>{label}{counts[v] !== null && <small>{fmt(counts[v]!)}</small>}</button>
                        ))}
                    </div>
                    <div className="stage-body">
                        {view === 'map' && (
                            <div className="map-wrap">
                                <MindMap report={report} selected={selected} highlight={highlight} colorBy={colorBy} showEdges={showEdges} showLabels={showLabels} autoRotate={autoRotate} onSelect={id => { if (id) { selectFile(id); } else closeReading(); }} onReady={setMapApi} />
                                <MapHud report={report} colorBy={colorBy} setColorBy={setColorBy} showEdges={showEdges} setShowEdges={setShowEdges} showLabels={showLabels} setShowLabels={setShowLabels} autoRotate={autoRotate} setAutoRotate={setAutoRotate} api={mapApi} onSnapshot={() => void exportPng()} focusLabel={highlight?.label ?? null} onClearFocus={() => { setTraceMode('none'); setPathTarget(null); if (finding) setFinding(null); }} />
                            </div>
                        )}
                        {view === 'findings' && <FindingsView report={report} active={finding?.id ?? null} onOpen={openFinding} />}
                        {view === 'hotspots' && <HotspotsView report={report} selected={selected} onSelect={id => { selectFile(id); }} />}
                        {view === 'architecture' && <ArchitectureView report={report} />}
                        {view === 'packages' && <PackagesView report={report} />}
                    </div>
                </main>
                <Inspector
                    report={report} selected={selected} finding={finding} trace={traceMode} pathTarget={pathTarget} path={path}
                    onTrace={m => { setTraceMode(m); setPathTarget(null); setView('map'); }}
                    onSelect={id => { selectFile(id); if (view === 'map') setTimeout(() => mapApi?.focus(id), 60); }}
                    onFindPath={() => selected && setPalette({ kind: 'file', title: `Trace from ${selected.split('/').pop()} to which file?`, onPick: id => { setPathTarget(id); setTraceMode('none'); setView('map'); } })}
                    onFocus={() => selected && (setView('map'), setTimeout(() => mapApi?.focus(selected), 60))}
                    onShowFinding={showFindingOnMap} onOpenFinding={openFinding} onClose={closeReading}
                    onBack={() => walk(-1)} onForward={() => walk(1)} canBack={trail.at > 0} canForward={trail.at < trail.stack.length - 1}
                />
            </div>
            {inputs}{overlays}
        </div>
    );
}
