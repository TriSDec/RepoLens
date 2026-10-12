// The work an analysis job does, shared by the Web Worker and by the on-page fallback used when a
// browser cannot start the worker. Nothing here touches the network.
import { analyze } from './analyze';
import { collectFolder, collectZip, type Collected } from './input';
import { parseReport } from './schema';
import type { InputFile, Report } from './types';

export type Job = {
    name: string;
    /** A project the page already scanned and read (the normal route for folders). */
    collected?: Collected;
    files?: File[];
    zip?: ArrayBuffer;
    demo?: InputFile[];
    reportText?: string;
    preSkipped?: number;
    paths?: string[];
    /** Honour .gitignore files inside a ZIP. */
    gitignore?: boolean;
};

/** After this long, remaining JavaScript/TypeScript files are mapped with a faster method so huge projects still finish. */
export const ANALYSIS_BUDGET_MS = 14_000;

export async function runJob(job: Job, progress: (value: number, phase?: string) => void): Promise<{ report: Report; imported: boolean }> {
    if (typeof job.reportText === 'string') return { report: parseReport(job.reportText), imported: true };
    progress(1, 'Reading files');
    const reading = (p: number) => progress(p, 'Reading files');
    const input = job.collected ?? (job.demo ? { files: job.demo, skipped: 0, skippedBytes: 0, skippedReasons: {} as Record<string, number> }
        : job.zip ? collectZip(job.zip, reading, { gitignore: job.gitignore })
        : await collectFolder(job.files || [], reading, job.paths));
    if (job.preSkipped) { // files the page already filtered out (node_modules and similar) still count as skipped
        input.skipped += job.preSkipped;
        input.skippedReasons['Dependencies & generated files'] = (input.skippedReasons['Dependencies & generated files'] || 0) + job.preSkipped;
    }
    return { report: analyze(input, job.name, progress, { budgetMs: ANALYSIS_BUDGET_MS }), imported: false };
}
