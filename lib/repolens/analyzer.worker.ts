import { analyze } from './analyze';
import { collectFolder, collectZip } from './input';
import type { InputFile } from './types';
const ctx = self as unknown as {
    onmessage: ((e: MessageEvent) => void) | null;
    postMessage: (data: unknown) => void;
};
ctx.onmessage = async (e: MessageEvent<{
    name: string;
    files?: File[];
    zip?: ArrayBuffer;
    demo?: InputFile[];
}>) => {
    try {
        const progress = (value: number) => ctx.postMessage({ type: 'progress', value });
        const input = e.data.demo ? { files: e.data.demo, skipped: 0, skippedBytes: 0, skippedReasons: {} } : e.data.zip ? collectZip(e.data.zip, progress) : await collectFolder(e.data.files || [], progress);
        ctx.postMessage({ type: 'result', report: analyze(input, e.data.name, progress) });
    }
    catch (error) {
        ctx.postMessage({ type: 'error', message: error instanceof Error ? error.message : 'Analysis could not be completed.' });
    }
};
