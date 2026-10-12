'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Job } from './repolens/job';
import type { Report } from './repolens/types';
import type { DirSource } from './scan';

export type { Job };
export type Stage = 'scan' | 'read' | 'analyze' | 'map';
export type Status = {
    busy: boolean;
    /** Overall progress, 0-100, across scanning, reading and analysis. */
    progress: number;
    phase: string;
    error: string;
    stage: Stage;
    found: number;
    skipped: number;
    read: number;
    toRead: number;
    bytes: number;
    current: string;
    skippedFolders: Record<string, number>;
    startedAt: number;
};

const IDLE: Status = { busy: false, progress: 0, phase: '', error: '', stage: 'scan', found: 0, skipped: 0, read: 0, toRead: 0, bytes: 0, current: '', skippedFolders: {}, startedAt: 0 };
const WATCHDOG_MS = 90_000;
const ANALYSIS_FROM = 45; // scanning and reading take the first 45% of the bar, analysis the rest

const PHASES: Record<string, { stage: Stage; label: string }> = {
    'Reading files': { stage: 'read', label: 'Reading files' },
    'Reading imports': { stage: 'analyze', label: 'Parsing code and following imports' },
    'Measuring the graph': { stage: 'analyze', label: 'Measuring blast radius and cycles' },
    'Mapping architecture': { stage: 'analyze', label: 'Mapping the architecture' },
    'Laying out the map': { stage: 'map', label: 'Laying out the map' },
    'Done': { stage: 'map', label: 'Done' },
};

/**
 * Imports a project. Folders are scanned and read on the page (so ignored folders are never entered), then
 * analysed in a throwaway Web Worker that is terminated when it finishes, fails or is cancelled. If a browser
 * cannot start the worker, the same analysis runs on the page instead. Both are entirely local, and the page's
 * Content-Security-Policy still forbids network access; only the thread differs.
 */
export function useAnalysis() {
    const [status, setStatus] = useState<Status>(IDLE);
    const worker = useRef<Worker | null>(null), timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const generation = useRef(0); // lets a cancelled or superseded job ignore late results
    const dots = useRef<string[]>([]); // the languages of discovered files, read by the loading animation

    const stop = useCallback(() => {
        generation.current++;
        worker.current?.terminate();
        worker.current = null;
        if (timer.current) clearTimeout(timer.current);
    }, []);
    useEffect(() => stop, [stop]);

    /** `carry` keeps the counters from a scan that just finished, so the loading screen does not reset. */
    const run = useCallback((job: Job, onResult: (report: Report, imported: boolean) => void, quiet = false, carry = false) => {
        stop();
        const mine = generation.current;
        const alive = () => generation.current === mine;
        const base = carry ? ANALYSIS_FROM : 0, span = 100 - base;
        if (!quiet) setStatus(s => ({ ...(carry ? s : { ...IDLE, startedAt: Date.now() }), busy: true, progress: base + 1, phase: 'Starting', error: '', stage: carry ? 'analyze' : 'read' }));
        const progress = (value: number, phase?: string) => {
            if (quiet || !alive()) return;
            const info = phase ? PHASES[phase] : undefined;
            setStatus(s => ({ ...s, progress: Math.max(s.progress, Math.round(base + (value / 100) * span)), phase: info?.label ?? phase ?? s.phase, stage: info?.stage ?? s.stage }));
        };
        const succeed = (report: Report, imported: boolean) => { if (!alive()) return; stop(); setStatus(s => ({ ...s, busy: false, progress: 100, phase: '', error: '' })); onResult(report, imported); };
        const fail = (message: string) => { if (!alive()) return; stop(); setStatus({ ...IDLE, error: message }); };

        const onPage = async () => { // fallback: same engine, same restrictions, on this thread
            try {
                const { runJob } = await import('./repolens/job');
                await new Promise(r => setTimeout(r, 30)); // let the progress UI paint before the thread gets busy
                if (!alive()) return;
                const { report, imported } = await runJob(job, progress);
                succeed(report, imported);
            } catch (error) { fail(error instanceof Error ? error.message : 'Analysis could not be completed.'); }
        };

        let w: Worker;
        try { w = new Worker('/worker/analyzer.js'); }
        catch { void onPage(); return; }
        worker.current = w;
        let started = false;
        timer.current = setTimeout(() => fail('The analysis ran for over 90 seconds and was stopped. Open a subfolder (such as src/) or use the command-line tool (npx repolens) for a project this large.'), WATCHDOG_MS);
        w.onerror = (event) => {
            if (!alive()) return;
            if (!started) {
                console.warn('RepoLens: the analyzer worker could not start, analysing on the page instead.', event.message || '(script did not load)');
                worker.current?.terminate(); worker.current = null;
                void onPage();
                return;
            }
            fail(`The local analyzer stopped unexpectedly${event.message ? `: ${event.message}` : ''}. Please try again.`);
        };
        w.onmessage = (e: MessageEvent) => {
            const d = e.data;
            started = true;
            if (d.type === 'progress') progress(d.value, d.phase);
            else if (d.type === 'error') fail(d.message);
            else if (d.type === 'result') succeed(d.report, !!d.imported);
        };
        try { w.postMessage(job, job.zip ? [job.zip] : []); }
        catch { worker.current?.terminate(); worker.current = null; void onPage(); }
    }, [stop]);

    /** Scan a folder on the page, then analyse it. `source` is created lazily so a cancelled import does no work. */
    const runScan = useCallback((name: string, source: () => DirSource | Promise<DirSource>, gitignore: boolean, onResult: (report: Report, imported: boolean) => void, preSkipped = 0) => {
        stop();
        const mine = generation.current;
        const alive = () => generation.current === mine;
        dots.current = [];
        setStatus({ ...IDLE, busy: true, startedAt: Date.now(), progress: 1, phase: 'Scanning folders', stage: 'scan' });
        void (async () => {
            try {
                const { scanTree, ScanCancelled } = await import('./scan');
                try {
                    const collected = await scanTree(await source(), {
                        gitignore, cancelled: () => !alive(),
                        onFile: kind => { if (dots.current.length < 4000) dots.current.push(kind); },
                        onProgress: p => {
                            if (!alive()) return;
                            const progress = p.stage === 'scan' ? 2 + 28 * (1 - Math.exp(-p.found / 2500)) : 30 + 15 * (p.read / Math.max(1, p.toRead));
                            setStatus(s => ({ ...s, stage: p.stage, found: p.found, skipped: p.skipped, read: p.read, toRead: p.toRead, bytes: p.bytes, current: p.current, skippedFolders: p.skippedFolders, progress: Math.round(progress), phase: p.stage === 'scan' ? 'Scanning folders' : 'Reading files' }));
                        },
                    });
                    if (!alive()) return;
                    run({ name, collected, preSkipped }, onResult, false, true);
                } catch (error) {
                    if (error instanceof ScanCancelled || !alive()) return;
                    throw error;
                }
            } catch (error) {
                if (alive()) { stop(); setStatus({ ...IDLE, error: error instanceof Error ? error.message : 'That folder could not be read.' }); }
            }
        })();
    }, [stop, run]);

    const cancel = useCallback(() => { stop(); setStatus({ ...IDLE, error: 'Cancelled.' }); }, [stop]);
    const clearError = useCallback(() => setStatus(s => ({ ...s, error: '' })), []);
    return { status, run, runScan, cancel, clearError, dots };
}
