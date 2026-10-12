import { runJob, type Job } from './job';

const ctx = self as unknown as {
    onmessage: ((e: MessageEvent) => void) | null;
    postMessage: (data: unknown) => void;
};

ctx.onmessage = async (e: MessageEvent<Job>) => {
    try {
        const { report, imported } = await runJob(e.data, (value, phase) => ctx.postMessage({ type: 'progress', value, phase }));
        ctx.postMessage({ type: 'result', report, imported });
    } catch (error) {
        ctx.postMessage({ type: 'error', message: error instanceof Error ? error.message : 'Analysis could not be completed.' });
    }
};
