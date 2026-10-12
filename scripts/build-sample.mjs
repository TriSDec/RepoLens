// Precomputes the sample project's report so the landing page can show it instantly,
// without starting the analyzer worker. Run via `npm run sample:build`.
import { writeFileSync } from 'node:fs';
import { analyze, demoFiles } from '../.test-build/lib.mjs';

const report = analyze({ files: demoFiles, skipped: 0, skippedBytes: 0, skippedReasons: {} }, 'orbit-dashboard');
report.duration = 0; // keeps the generated file deterministic
writeFileSync(new URL('../lib/sample-report.json', import.meta.url), JSON.stringify(report));
console.log(`sample report: ${report.nodes.length} files, ${report.findings.length} findings`);
