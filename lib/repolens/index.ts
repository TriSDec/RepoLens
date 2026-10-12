// Public surface of the analysis engine (used by tests and tooling).
export { analyze } from './analyze';
export { runJob } from './job';
export type { Job } from './job';
export type { AnalyzeOptions } from './analyze';
export * from './graph';
export { collectFolder, collectZip, exclusion, isCode, isText, safePath } from './input';
export type { Collected } from './input';
export { computeHealth, pickFixFirst, priorityOf, riskScore } from './insights';
export { layout3d } from './layout3d';
export { createLanguageContext, expandRustUse, extractImports, extractScript, languageOf, stripComments } from './languages';
export { estimateComplexity, isTestPath } from './metrics';
export { toMarkdown } from './report';
export { RISKY_RULES, scanRisky } from './risky';
export { MAX_REPORT_BYTES, parseReport, validateReport } from './schema';
export { entropy, scanSecrets } from './secrets';
export { demoFiles } from './demo';
export * from './types';
