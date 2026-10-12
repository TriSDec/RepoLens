// Command-line entry point. Bundled to dist-cli/cli.mjs by scripts/build-cli.mjs.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { createIgnore } from '../gitignore';
import { analyze } from './analyze';
import { exclusion, isText, type Collected } from './input';
import { toMarkdown } from './report';
import { LIMITS, trace, type InputFile, type Report } from './types';

const HELP = `RepoLens - dependency map and health report for your project

Usage: repolens [path] [options]

  path                 project folder (default: current directory)

Options:
  --json <file>        write the full report (open it later in the web app)
  --md <file>          write a Markdown summary
  --impact <file>      list every file affected by changing <file>
  --fail-on <level>    exit 1 when findings reach: secret | error | warning | cycle   (for CI)
  --min-score <n>      exit 1 when the health score is below n (0-100)
  --max-files <n>      analyse up to n files (default 60000)
  --no-gitignore       do not apply the project's .gitignore
  -q, --quiet          only print errors and the requested outputs
  -h, --help           show this help

Supported: JavaScript/TypeScript (+Vue/Svelte/Astro), Python, Java, Kotlin, Scala,
Go, Rust, C/C++, C#, Ruby, PHP, Dart, Swift. Everything runs locally; nothing is uploaded.`;

function collect(root: string, maxFiles: number, useGitignore: boolean): Collected {
    const data: Collected = { files: [], skipped: 0, skippedBytes: 0, skippedReasons: {} };
    const ignore = createIgnore();
    const skip = (size: number, why: string) => { data.skipped++; data.skippedBytes += size; data.skippedReasons[why] = (data.skippedReasons[why] || 0) + 1; };
    const walk = (dir: string, rel: string) => {
        const entries = readdirSync(dir, { withFileTypes: true });
        if (useGitignore && entries.some(e => e.name === '.gitignore' && e.isFile())) { try { ignore.add(rel, readFileSync(join(dir, '.gitignore'), 'utf8')); } catch { /* unreadable: no rules */ } }
        for (const entry of entries) {
            const path = rel ? `${rel}/${entry.name}` : entry.name;
            if (entry.isSymbolicLink()) continue; // never follow links out of the project
            const reason = exclusion(path + (entry.isDirectory() ? '/x' : ''));
            if (reason) { if (!entry.isDirectory()) skip(0, reason); continue; }
            if (ignore.ignores(path, entry.isDirectory())) { if (!entry.isDirectory()) skip(0, 'Matched .gitignore'); continue; }
            if (entry.isDirectory()) { walk(join(dir, entry.name), path); continue; }
            const size = statSync(join(dir, entry.name)).size;
            if (data.files.length >= maxFiles) throw new Error(`More than ${maxFiles.toLocaleString('en-US')} files. Pass a subfolder, or raise the limit with --max-files.`);
            const file: InputFile = { path, size };
            if (isText(path)) {
                if (size > LIMITS.perFile) { skip(size, 'Text files over 1 MB'); continue; }
                const buf = readFileSync(join(dir, entry.name));
                if (buf.includes(0)) { skip(size, 'Binary or non-UTF-8 text'); continue; }
                file.content = buf.toString('utf8');
            }
            data.files.push(file);
        }
    };
    walk(root, '');
    return data;
}

type Options = { path: string; json?: string; md?: string; impact?: string; failOn?: string; minScore?: number; maxFiles: number; gitignore: boolean; quiet: boolean };

function main(argv: string[]): number {
    const opts: Options = { path: '.', maxFiles: 60000, gitignore: true, quiet: false };
    const value = (i: number, flag: string) => { if (i + 1 >= argv.length) throw new Error(`${flag} needs a value`); return argv[i + 1]; };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '-h' || a === '--help') { console.log(HELP); return 0; }
        else if (a === '--json') opts.json = value(i++, a);
        else if (a === '--md') opts.md = value(i++, a);
        else if (a === '--impact') opts.impact = value(i++, a);
        else if (a === '--fail-on') opts.failOn = value(i++, a);
        else if (a === '--min-score') opts.minScore = Number(value(i++, a));
        else if (a === '--max-files') opts.maxFiles = Math.max(1, parseInt(value(i++, a), 10) || 60000);
        else if (a === '--no-gitignore') opts.gitignore = false;
        else if (a === '-q' || a === '--quiet') opts.quiet = true;
        else if (a.startsWith('-')) throw new Error(`Unknown option ${a}. Try --help.`);
        else opts.path = a;
    }
    if (opts.failOn && !['secret', 'error', 'warning', 'cycle'].includes(opts.failOn)) throw new Error('--fail-on must be secret, error, warning or cycle');
    if (opts.minScore !== undefined && !(opts.minScore >= 0 && opts.minScore <= 100)) throw new Error('--min-score must be between 0 and 100');
    const root = resolve(opts.path);
    if (!statSync(root).isDirectory()) throw new Error(`${root} is not a folder`);

    // The 3D layout is only needed when the report will be opened in the web app.
    const report: Report = analyze(collect(root, opts.maxFiles, opts.gitignore), basename(root), () => { }, { maxEdges: 200000, maxFindings: 50000, layout: !!opts.json });
    if (opts.json) writeFileSync(opts.json, JSON.stringify(report));
    if (opts.md) writeFileSync(opts.md, toMarkdown(report));

    const count = (s: string) => report.findings.filter(f => f.severity === s).length;
    if (!opts.quiet) {
        console.log(`\nRepoLens - ${report.name}`);
        console.log(`  Health ${report.health.score}/100 (${report.health.grade})   ${report.nodes.length} files, ${new Set(report.edges.map(e => e.from + '\0' + e.to)).size} connections, ${report.lines.toLocaleString('en-US')} lines   ${report.duration} ms`);
        console.log('  ' + report.languages.map(l => `${l.label} ${l.files}`).join(' · '));
        console.log(`  ${count('error')} errors · ${count('warning')} warnings · ${count('info')} suggestions\n`);
        const byId = new Map(report.findings.map(f => [f.id, f]));
        if (report.fixFirst.length) {
            console.log('  Fix first:');
            for (const id of report.fixFirst) {
                const f = byId.get(id)!;
                console.log(`    [${f.severity}] ${f.title}: ${f.files.length > 1 ? `${f.files.length} files (${f.files.slice(0, 2).join(', ')}, …)` : f.files[0] ?? 'project-wide'}${f.line ? ':' + f.line : ''}`);
            }
        }
        if (!report.findings.length) console.log('  No findings.');
    }
    if (opts.impact) {
        const target = opts.impact.replace(/\\/g, '/').replace(/^\.\//, '');
        if (!report.nodes.some(n => n.id === target)) throw new Error(`"${target}" is not in the analysed project. Paths are relative to ${root}.`);
        const affected = [...trace(target, report.edges, 'impact')].filter(id => id !== target).sort();
        console.log(`\n${affected.length} file(s) are affected by changes to ${target}:`);
        for (const id of affected) console.log('  ' + id);
    }
    const failed = opts.failOn === 'secret' ? report.findings.some(f => f.kind === 'secret' && f.severity !== 'info')
        : opts.failOn === 'error' ? count('error') > 0
        : opts.failOn === 'warning' ? count('error') + count('warning') > 0
        : opts.failOn === 'cycle' ? report.findings.some(f => f.kind === 'cycle')
        : false;
    const lowScore = opts.minScore !== undefined && report.health.score < opts.minScore;
    if (lowScore && !opts.quiet) console.log(`\nHealth score ${report.health.score} is below the required ${opts.minScore}.`);
    return failed || lowScore ? 1 : 0;
}

try { process.exitCode = main(process.argv.slice(2)); }
catch (error) { console.error(`repolens: ${error instanceof Error ? error.message : error}`); process.exitCode = 2; }
