// Command-line entry point. Bundled to dist-cli/cli.mjs by scripts/build-cli.mjs.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { analyze } from './analyze';
import { exclusion, isText, type Collected } from './input';
import { toMarkdown } from './report';
import { LIMITS, trace, type InputFile, type Report } from './types';

const HELP = `RepoLens - dependency map and health report for your project

Usage: repolens [path] [options]

  path                 project folder (default: current directory)

Options:
  --json <file>        write the full report as JSON
  --md <file>          write a Markdown summary
  --impact <file>      list every file affected by changing <file>
  --fail-on <level>    exit 1 if findings reach: error | warning | cycle   (for CI)
  --max-files <n>      analyse up to n files (default 5000)
  --no-gitignore       do not apply the project's .gitignore
  -q, --quiet          only print errors and the requested outputs
  -h, --help           show this help

Supported: JavaScript/TypeScript (+Vue/Svelte/Astro), Python, Java, Kotlin, Scala,
Go, Rust, C/C++, C#, Ruby, PHP, Dart, Swift. Everything runs locally.`;

/** Convert the most common .gitignore syntax to RegExps (negations are ignored). */
function gitignoreRules(text: string): RegExp[] {
    const rules: RegExp[] = [];
    for (let line of text.split(/\r?\n/)) {
        line = line.trim();
        if (!line || line.startsWith('#') || line.startsWith('!')) continue;
        const anchored = line.startsWith('/') || line.slice(0, -1).includes('/');
        const dirOnly = line.endsWith('/');
        const body = line.replace(/^\//, '').replace(/\/$/, '')
            .replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*\//g, '(?:.*/)?').replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]');
        rules.push(new RegExp(`${anchored ? '^' : '(?:^|/)'}${body}${dirOnly ? '/' : '(?:/|$)'}`));
    }
    return rules;
}

function collect(root: string, maxFiles: number, useGitignore: boolean): Collected {
    const data: Collected = { files: [], skipped: 0, skippedBytes: 0, skippedReasons: {} };
    let ignore: RegExp[] = [];
    if (useGitignore) try { ignore = gitignoreRules(readFileSync(join(root, '.gitignore'), 'utf8')); } catch { /* no .gitignore */ }
    const skip = (size: number, why: string) => { data.skipped++; data.skippedBytes += size; data.skippedReasons[why] = (data.skippedReasons[why] || 0) + 1; };
    const walk = (dir: string, rel: string) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const path = rel ? `${rel}/${entry.name}` : entry.name;
            if (entry.isSymbolicLink()) continue;
            const reason = exclusion(path + (entry.isDirectory() ? '/x' : ''));
            if (reason) { if (!entry.isDirectory()) skip(0, reason); continue; }
            if (ignore.some(r => r.test(entry.isDirectory() ? path + '/' : path))) { if (!entry.isDirectory()) skip(0, 'Matched .gitignore'); continue; }
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

function main(argv: string[]): number {
    const opts: { path: string; json?: string; md?: string; impact?: string; failOn?: string; maxFiles: number; gitignore: boolean; quiet: boolean } = { path: '.', maxFiles: 5000, gitignore: true, quiet: false };
    const value = (i: number, flag: string) => { if (i + 1 >= argv.length) throw new Error(`${flag} needs a value`); return argv[i + 1]; };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '-h' || a === '--help') { console.log(HELP); return 0; }
        else if (a === '--json') opts.json = value(i++, a);
        else if (a === '--md') opts.md = value(i++, a);
        else if (a === '--impact') opts.impact = value(i++, a);
        else if (a === '--fail-on') opts.failOn = value(i++, a);
        else if (a === '--max-files') opts.maxFiles = Math.max(1, parseInt(value(i++, a), 10) || 5000);
        else if (a === '--no-gitignore') opts.gitignore = false;
        else if (a === '-q' || a === '--quiet') opts.quiet = true;
        else if (a.startsWith('-')) throw new Error(`Unknown option ${a}. Try --help.`);
        else opts.path = a;
    }
    if (opts.failOn && !['error', 'warning', 'cycle'].includes(opts.failOn)) throw new Error('--fail-on must be error, warning or cycle');
    const root = resolve(opts.path);
    if (!statSync(root).isDirectory()) throw new Error(`${root} is not a folder`);

    const report: Report = analyze(collect(root, opts.maxFiles, opts.gitignore), basename(root), () => { }, { maxEdges: 200000, maxFindings: 50000 });
    if (opts.json) writeFileSync(opts.json, JSON.stringify({ schemaVersion: 1, ...report }, null, 2));
    if (opts.md) writeFileSync(opts.md, toMarkdown(report));

    const count = (s: string) => report.findings.filter(f => f.severity === s).length;
    if (!opts.quiet) {
        console.log(`\nRepoLens - ${report.name}`);
        console.log(`  ${report.nodes.length} files, ${new Set(report.edges.map(e => e.from + '\0' + e.to)).size} connections, ${report.lines.toLocaleString('en-US')} lines (${report.duration} ms)`);
        console.log('  ' + report.languages.map(l => `${l.label} ${l.files}`).join(' · '));
        console.log(`  ${count('error')} errors · ${count('warning')} warnings · ${count('info')} suggestions\n`);
        for (const f of report.findings.filter(f => f.severity !== 'info').slice(0, 15))
            console.log(`  [${f.severity}] ${f.title}: ${f.files.length > 1 ? `${f.files.length} files (${f.files.slice(0, 3).join(', ')}${f.files.length > 3 ? ', …' : ''})` : f.files[0] + (f.line ? ':' + f.line : '')}`);
        if (report.findings.filter(f => f.severity !== 'info').length > 15) console.log('  …more in --json / --md output');
    }
    if (opts.impact) {
        const target = opts.impact.replace(/\\/g, '/').replace(/^\.\//, '');
        if (!report.nodes.some(n => n.id === target)) throw new Error(`"${target}" is not in the analysed project. Paths are relative to ${root}.`);
        const affected = [...trace(target, report.edges, 'impact')].filter(id => id !== target).sort();
        console.log(`\n${affected.length} file(s) are affected by changes to ${target}:`);
        for (const id of affected) console.log('  ' + id);
    }
    const bad = opts.failOn === 'error' ? count('error') > 0 : opts.failOn === 'warning' ? count('error') + count('warning') > 0 : opts.failOn === 'cycle' ? report.findings.some(f => f.kind === 'cycle') : false;
    return bad ? 1 : 0;
}

try { process.exitCode = main(process.argv.slice(2)); }
catch (error) { console.error(`repolens: ${error instanceof Error ? error.message : error}`); process.exitCode = 2; }
