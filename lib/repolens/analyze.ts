import ts from 'typescript';
import { articulationPoints, buildGraph, influence, pagerank, shortestCycle, stronglyConnected } from './graph';
import { isCode, type Collected } from './input';
import { computeHealth, pickFixFirst, priorityOf, riskScore } from './insights';
import { layout3d } from './layout3d';
import { LANGUAGE_LABELS, createLanguageContext, extractScript, isSfc, languageOf, stripComments, type Lang } from './languages';
import { estimateComplexity, isTestPath } from './metrics';
import { scanRisky } from './risky';
import { scanSecrets } from './secrets';
import { LIMITS, type Edge, type ExternalPackage, type FileNode, type Finding, type FolderEdge, type FolderNode, type Report } from './types';

const normalize = (p: string) => { const out: string[] = []; for (const part of p.split('/')) { if (part === '..') out.pop(); else if (part && part !== '.') out.push(part); } return out.join('/'); };
const dir = (p: string) => p.slice(0, Math.max(0, p.lastIndexOf('/')));
const packageName = (s: string) => s.startsWith('@') ? s.split('/').slice(0, 2).join('/') : s.split('/')[0];
const NODE_BUILTINS = new Set('assert async_hooks buffer child_process cluster console constants crypto dgram diagnostics_channel dns domain events fs http http2 https module net os path perf_hooks process punycode querystring readline repl stream string_decoder sys timers tls trace_events tty url util v8 vm wasi worker_threads zlib test'.split(' '));

export type AnalyzeOptions = {
    maxEdges?: number;
    maxFindings?: number;
    /** Skip the 3D layout (the command line does not need it). */
    layout?: boolean;
    /** After this many milliseconds, remaining JavaScript/TypeScript files are read with a faster, less detailed method. */
    budgetMs?: number;
};

const FAST_IMPORTS: { re: RegExp; type: number; spec: number }[] = [
    { re: /\bimport\s+(type\s+)?(?:[\w*${},\s]{0,400}?\bfrom\s*)?(['"])([^'"\n]{1,300})\2/g, type: 1, spec: 3 },
    { re: /\bexport\s+(type\s+)?(?:\*|\{[^}]{0,400}\})(?:\s+as\s+\w+)?\s*from\s*(['"])([^'"\n]{1,300})\2/g, type: 1, spec: 3 },
    { re: /\b(?:require|import)\s*\(\s*(['"])([^'"\n]{1,300})\1\s*\)/g, type: 0, spec: 2 },
];

const MAX_AST_DEPTH = 1500;

type ExportInfo = { names: Set<string>; barrel: boolean };
type Usage = { wild: boolean; names: Set<string> };

export function analyze(input: Collected, name: string, progress: (n: number, phase?: string) => void = () => { }, options: AnalyzeOptions = {}): Report {
    const started = performance.now(), { files } = input;
    if (!files.some(f => isCode(f.path) && f.content !== undefined))
        throw new Error('No readable source files found. RepoLens understands JavaScript/TypeScript, Python, Java, Kotlin, Scala, Go, Rust, C/C++, C#, Ruby, PHP, Dart and Swift. Select the project root or a source folder.');

    const maxEdges = options.maxEdges ?? LIMITS.edges, maxFindings = options.maxFindings ?? 5000, budgetMs = options.budgetMs ?? Infinity;
    let fastFiles = 0;
    const ctx = createLanguageContext(files);
    const contentOf = new Map(files.map(f => [f.path, f.content]));
    const paths = new Set(files.map(f => f.path));
    const nodes: FileNode[] = [], edges: Edge[] = [], rawFindings: Omit<Finding, 'id' | 'priority'>[] = [];
    const edgeKeys = new Set<string>();
    const duplicates = new Map<string, string[]>();
    const externalFiles = new Map<string, Set<string>>();
    const exportsOf = new Map<string, ExportInfo>();
    const usage = new Map<string, Usage>();
    const configWarnings = new Set<string>();

    const add = (f: Omit<Finding, 'id' | 'priority'>) => { rawFindings.push(f); };
    const ignoredPaths = input.ignoredPaths ?? [];
    /** True when a relative import points into a folder or file that was left out on purpose (dependencies, .gitignore). */
    const intoIgnored = (from: string, spec: string) => {
        if (!ignoredPaths.length) return false;
        const s = spec.replace(/^(mod:|ns:|[<"'])/, '');
        if (!s.startsWith('.')) return false;
        const target = normalize(`${dir(from)}/${s}`);
        return ignoredPaths.some(p => target === p || target.startsWith(p + '/') || p.startsWith(target + '/') || p.replace(/\.[^./]+$/, '') === target);
    };

    // ---- tsconfig / jsconfig ----------------------------------------------------------------
    const configs = files.filter(f => /(^|\/)(tsconfig|jsconfig)\.json$/.test(f.path) && f.content).map(f => {
        const parsed = ts.parseConfigFileTextToJson(f.path, f.content!);
        if (parsed.error) configWarnings.add(`Cannot parse ${f.path}.`);
        if (parsed.config?.extends) configWarnings.add(`${f.path} extends another config; inherited aliases are not resolved.`);
        return { root: dir(f.path), options: parsed.config?.compilerOptions || {} };
    }).sort((a, b) => b.root.length - a.root.length);

    const tryPath = (p: string) => {
        const base = normalize(p);
        const candidates = [base, ...['.ts', '.tsx', '.js', '.jsx', '.mts', '.mjs', '.cts', '.cjs', '.json', '.css', '.vue', '.svelte', '.astro'].map(x => base + x), ...['.ts', '.tsx', '.js', '.jsx', '.mts', '.mjs', '.vue', '.svelte'].map(x => base + '/index' + x)];
        if (/\.[cm]?jsx?$/.test(base)) candidates.push(base.replace(/\.[cm]?jsx?$/, '.ts'), base.replace(/\.[cm]?jsx?$/, '.tsx'), base.replace(/\.mjs$/, '.mts'), base.replace(/\.cjs$/, '.cts'));
        return candidates.find(x => paths.has(x));
    };
    const resolveJs = (from: string, raw: string): { local: boolean; target?: string; uncertain?: boolean } => {
        const s = raw.split(/[?#]/)[0];
        if (s.startsWith('.')) return { local: true, target: tryPath(dir(from) + '/' + s) };
        if (s.startsWith('/')) return { local: true, target: tryPath(s.slice(1)) || tryPath('public/' + s.slice(1)) };
        const cfg = configs.find(c => !c.root || from.startsWith(c.root + '/'));
        if (cfg) {
            const base = normalize(cfg.root + '/' + (typeof cfg.options.baseUrl === 'string' ? cfg.options.baseUrl : '.'));
            const patterns = Object.entries(cfg.options.paths || {}).sort(([a], [b]) => b.replace('*', '').length - a.replace('*', '').length);
            for (const [pattern, targets] of patterns) {
                if (!Array.isArray(targets)) continue;
                const [pre, post = ''] = pattern.split('*');
                const matches = pattern.includes('*') ? s.startsWith(pre) && s.endsWith(post) : s === pattern;
                if (!matches) continue;
                const middle = pattern.includes('*') ? s.slice(pre.length, post ? -post.length : undefined) : '';
                for (const target of targets) if (typeof target === 'string') {
                    const found = tryPath(base + '/' + target.replace('*', middle));
                    if (found) return { local: true, target: found };
                }
                return { local: true };
            }
            if (typeof cfg.options.baseUrl === 'string') {
                const found = tryPath(base + '/' + s);
                if (found) return { local: true, target: found };
            }
        }
        if (s.startsWith('@/') || s.startsWith('~/') || s.startsWith('#')) return { local: true, uncertain: true };
        return { local: false };
    };

    const addEdge = (from: string, to: string, typeOnly: boolean, line: number) => {
        const key = `${from}\0${to}\0${typeOnly}`;
        if (edgeKeys.has(key)) return;
        if (edges.length >= maxEdges) throw new Error(`This project exceeds ${maxEdges.toLocaleString('en-US')} connections. Analyze a smaller source folder.`);
        edgeKeys.add(key);
        edges.push({ from, to, typeOnly, line });
    };
    const noteExternal = (node: FileNode, pkg: string) => {
        if (!node.external.includes(pkg)) node.external.push(pkg);
        const set = externalFiles.get(pkg);
        if (set) set.add(node.id);
        else externalFiles.set(pkg, new Set([node.id]));
    };
    const markUsed = (target: string, names: string[] | undefined) => {
        const u = usage.get(target) ?? { wild: false, names: new Set<string>() };
        if (!names || names.includes('*')) u.wild = true;
        else for (const n of names) u.names.add(n);
        usage.set(target, u);
    };

    // ---- per-file pass --------------------------------------------------------------------------
    for (let i = 0; i < files.length; i++) {
        const file = files[i], code = isCode(file.path), lang: Lang | null = languageOf(file.path), text = file.content;
        const lines = text ? text.split('\n').length : 0;
        const kind = code ? (/tsx$|jsx$|\.(vue|svelte|astro)$/.test(file.path) ? 'component' : 'module') : /\.(s?css|less|sass)$/.test(file.path) ? 'style' : /\.(json|ya?ml|toml|xml|gradle|properties|cfg|ini|csproj|mod)$/.test(file.path) ? 'config' : text !== undefined ? 'document' : 'asset';
        const node: FileNode = {
            id: file.path, name: file.path.split('/').at(-1)!, folder: dir(file.path) || 'project', kind, lang: lang ?? undefined,
            size: file.size, lines, imports: 0, importedBy: 0, external: [], entry: false, isTest: code && isTestPath(file.path),
            x: 0, y: 0, z: 0, complexity: 0, functions: 0, influence: 0, centrality: 0, risk: 0, cutPoint: false, tested: false, inCycle: false,
        };
        nodes.push(node);

        if (text && text.length >= 80 && code) duplicates.set(text, [...(duplicates.get(text) || []), file.path]);
        if (file.size >= (code ? 50 * 1024 : 250 * 1024) || (code && lines >= 800))
            add({ kind: 'size', severity: 'info', confidence: 'review', title: code ? 'Large source file' : 'Large asset', detail: `${file.path} uses ${(file.size / 1024).toFixed(1)} KB${code ? ` across ${lines} lines` : ' on disk'}. Disk size is not transferred bundle size or runtime cost.`, suggestion: code ? 'Check whether this file has several responsibilities that could be separated.' : 'Check whether this asset needs its current resolution or format. Its runtime use is not inferred.', files: [file.path], bytes: file.size });

        if (text !== undefined) {
            for (const hit of scanSecrets(file.path, text))
                add({ kind: 'secret', severity: hit.severity, confidence: hit.rule === 'assigned-secret' || hit.rule === 'jwt' ? 'review' : 'confirmed', title: `Possible ${hit.label} in source`, detail: `Line ${hit.line} contains a value that matches the pattern of an exposed credential (${hit.label}). The value is deliberately not shown or stored.`, suggestion: 'If it is real, revoke and rotate it now: anything committed to version control must be treated as exposed even after deletion. Then load it from an environment variable or secrets manager.', files: [file.path], line: hit.line });
        }
        if (!code || text === undefined || !lang) { progress(35 + Math.round(i / files.length * 40), 'Reading imports'); continue; }

        if (!node.isTest) for (const hit of scanRisky(text, lang))
            add({ kind: 'risky', severity: hit.rule.severity, confidence: 'review', title: hit.rule.label, detail: `${hit.rule.why}${hit.count > 1 ? ` Found ${hit.count} times; first on line ${hit.line}.` : ` On line ${hit.line}.`}`, suggestion: hit.rule.fix, files: [file.path], line: hit.line });

        if (lang !== 'js') {
            const est = estimateComplexity(text, lang);
            node.complexity = est.complexity;
            node.functions = est.functions;
            if (est.complexity >= 150 && lines >= 200)
                add({ kind: 'complexity', severity: 'info', confidence: 'review', title: 'Dense branching logic', detail: `${file.path} has about ${est.complexity} branch points across ${est.functions} functions, which is hard to test and reason about.`, suggestion: 'Split the busiest functions and replace long if/else chains with data tables or polymorphism.', files: [file.path] });
            const seen = new Set<string>();
            for (const imp of ctx.imports(file.path, text)) {
                const r = ctx.resolve(file.path, imp);
                for (const target of r.targets) if (target !== file.path) addEdge(file.path, target, false, imp.line);
                if (r.external) noteExternal(node, r.external);
                if (r.unresolved && !r.targets.length && !seen.has(imp.spec) && !intoIgnored(file.path, imp.spec)) {
                    seen.add(imp.spec);
                    add({ kind: 'unresolved', severity: 'warning', confidence: 'review', title: 'Unresolved local import', detail: `“${imp.spec.replace(/^(mod:|ns:|[<"])/, '')}” could not be resolved within the included files. It may be missing, excluded, generated, or provided by build tooling.`, suggestion: 'Check the path, filename case, and whether the target file was included in the analysis.', files: [file.path], line: imp.line });
                }
            }
            progress(35 + Math.round(i / files.length * 40), 'Reading imports');
            continue;
        }

        // ---- JavaScript / TypeScript -------------------------------------------------------------
        if (performance.now() - started > budgetMs) { // over the time budget: find imports with patterns instead of a full parse
            fastFiles++;
            const clean = stripComments(isSfc(file.path) ? extractScript(file.path, text) : text, 'js');
            const starts = [0];
            for (let k = clean.indexOf('\n'); k >= 0; k = clean.indexOf('\n', k + 1)) starts.push(k + 1);
            const lineOf = (pos: number) => { let lo = 0, hi = starts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= pos) lo = mid; else hi = mid - 1; } return lo + 1; };
            for (const { re, type, spec } of FAST_IMPORTS) {
                re.lastIndex = 0;
                for (const m of clean.matchAll(re)) {
                    const r = resolveJs(file.path, m[spec]);
                    if (r.target) { addEdge(file.path, r.target, !!(type && m[type]), lineOf(m.index!)); markUsed(r.target, ['*']); }
                    else if (!r.local && !m[spec].startsWith('node:') && !NODE_BUILTINS.has(packageName(m[spec])) && !/^https?:|^data:/.test(m[spec])) noteExternal(node, packageName(m[spec]));
                }
            }
            progress(35 + Math.round(i / files.length * 40), 'Reading imports');
            continue;
        }
        const sfc = isSfc(file.path);
        const scriptText = sfc ? extractScript(file.path, text) : text;
        let source: ts.SourceFile;
        try { source = ts.createSourceFile(sfc ? file.path + '.ts' : file.path, scriptText, ts.ScriptTarget.Latest, false); }
        catch (error) {
            if (!(error instanceof RangeError)) throw error;
            add({ kind: 'syntax', severity: 'info', confidence: 'confirmed', title: 'Too deeply nested to analyze', detail: `${file.path} nests expressions so deeply that the parser gave up; it is shown without connections.`, suggestion: 'Generated or minified code is the usual cause. Exclude it, or point RepoLens at your source files.', files: [file.path] });
            progress(35 + Math.round(i / files.length * 40), 'Reading imports');
            continue;
        }
        const diagnostics = (source as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics;
        for (const d of diagnostics.slice(0, 10))
            add({ kind: 'syntax', severity: 'error', confidence: 'confirmed', title: 'Syntax error', detail: ts.flattenDiagnosticMessageText(d.messageText, ' '), suggestion: 'Correct this syntax, then run your project’s own compiler and tests.', files: [file.path], line: source.getLineAndCharacterOfPosition(d.start || 0).line + 1 });

        const imported = new Map<string, number>();
        const info: ExportInfo = { names: new Set(), barrel: false };
        let dynamic = 0, topLevelBranches = 0;
        const fnList: { name: string; line: number; cc: number }[] = [];
        const record = (spec: string, pos: number, typeOnly = false, names?: string[]) => {
            const line = source.getLineAndCharacterOfPosition(pos).line + 1;
            imported.set(spec, (imported.get(spec) || 0) + 1);
            const r = resolveJs(file.path, spec);
            if (r.target) { addEdge(file.path, r.target, typeOnly, line); markUsed(r.target, names); }
            else if (r.local && !intoIgnored(file.path, spec))
                add({ kind: 'unresolved', severity: 'warning', confidence: 'review', title: r.uncertain ? 'Unconfigured import alias' : 'Unresolved local import', detail: `“${spec}” could not be resolved within the included files. It may be missing, excluded, generated, or handled by custom tooling.`, suggestion: r.uncertain ? 'Include the tsconfig.json/jsconfig.json containing this alias. Inherited aliases and package import maps need manual review.' : 'Check the import path, filename case, and whether the target file was included.', files: [file.path], line });
            else if (!r.local && !spec.startsWith('node:') && !NODE_BUILTINS.has(packageName(spec)) && !/^https?:|^data:/.test(spec)) noteExternal(node, packageName(spec));
        };
        const hasModifier = (n: ts.Node, kindOf: ts.SyntaxKind) => ts.canHaveModifiers(n) && !!ts.getModifiers(n)?.some(m => m.kind === kindOf);
        const bindingNames = (b: ts.BindingName, into: Set<string>) => {
            if (ts.isIdentifier(b)) into.add(b.text);
            else for (const el of b.elements) if (ts.isBindingElement(el)) bindingNames(el.name, into);
        };
        const fnName = (n: ts.Node, p: ts.Node | undefined): string => {
            const named = (n as ts.FunctionLikeDeclaration).name;
            if (named && (ts.isIdentifier(named) || ts.isStringLiteral(named))) return named.text;
            if (p && ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) return p.name.text;
            if (p && ts.isPropertyAssignment(p) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))) return p.name.text;
            return '(anonymous)';
        };
        const visit = (n: ts.Node, fn: { cc: number } | null, depth: number, parent: ts.Node | undefined) => {
            let cur = fn;
            if (ts.isFunctionLike(n) && !ts.isTypeNode(n) && 'body' in n && (n as ts.FunctionLikeDeclaration).body) {
                const entry = { name: fnName(n, parent), line: source.getLineAndCharacterOfPosition(n.getStart(source)).line + 1, cc: 1 };
                fnList.push(entry);
                cur = entry;
            }
            const bump = () => { if (cur) cur.cc++; else topLevelBranches++; };
            switch (n.kind) {
                case ts.SyntaxKind.IfStatement: case ts.SyntaxKind.ConditionalExpression: case ts.SyntaxKind.ForStatement:
                case ts.SyntaxKind.ForInStatement: case ts.SyntaxKind.ForOfStatement: case ts.SyntaxKind.WhileStatement:
                case ts.SyntaxKind.DoStatement: case ts.SyntaxKind.CatchClause: case ts.SyntaxKind.CaseClause: bump(); break;
                case ts.SyntaxKind.BinaryExpression: {
                    const op = (n as ts.BinaryExpression).operatorToken.kind;
                    if (op === ts.SyntaxKind.AmpersandAmpersandToken || op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.QuestionQuestionToken) bump();
                    break;
                }
            }
            if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) {
                const c = n.importClause;
                const onlyTypes = !!c?.isTypeOnly || !!(c && !c.name && c.namedBindings && ts.isNamedImports(c.namedBindings) && c.namedBindings.elements.length && c.namedBindings.elements.every(e => e.isTypeOnly));
                const names: string[] = [];
                if (!c) names.push('*'); // side-effect import: nothing is named, so do not report its exports as unused
                else {
                    if (c.name) names.push('default');
                    if (c.namedBindings) {
                        if (ts.isNamespaceImport(c.namedBindings)) names.push('*');
                        else for (const e of c.namedBindings.elements) names.push((e.propertyName ?? e.name).text);
                    }
                }
                record(n.moduleSpecifier.text, n.getStart(source), onlyTypes, names);
            } else if (ts.isExportDeclaration(n)) {
                if (n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) {
                    info.barrel = true;
                    const names = n.exportClause && ts.isNamedExports(n.exportClause) ? n.exportClause.elements.map(e => (e.propertyName ?? e.name).text) : ['*'];
                    record(n.moduleSpecifier.text, n.getStart(source), n.isTypeOnly || !!(n.exportClause && ts.isNamedExports(n.exportClause) && n.exportClause.elements.length && n.exportClause.elements.every(e => e.isTypeOnly)), names);
                } else if (n.exportClause && ts.isNamedExports(n.exportClause)) for (const e of n.exportClause.elements) info.names.add(e.name.text);
            } else if (ts.isExportAssignment(n)) info.names.add('default');
            else if (ts.isCallExpression(n) && (n.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(n.expression) && n.expression.text === 'require'))) {
                const a = n.arguments[0];
                if (a && (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a))) record(a.text, n.getStart(source), false, ['*']);
                else dynamic++;
            } else if (ts.isImportEqualsDeclaration(n) && ts.isExternalModuleReference(n.moduleReference) && n.moduleReference.expression && ts.isStringLiteral(n.moduleReference.expression))
                record(n.moduleReference.expression.text, n.getStart(source), n.isTypeOnly, ['*']);
            else if (hasModifier(n, ts.SyntaxKind.ExportKeyword)) {
                if (hasModifier(n, ts.SyntaxKind.DefaultKeyword)) info.names.add('default');
                else if (ts.isVariableStatement(n)) n.declarationList.declarations.forEach(d => bindingNames(d.name, info.names));
                else if ((ts.isFunctionDeclaration(n) || ts.isClassDeclaration(n) || ts.isInterfaceDeclaration(n) || ts.isTypeAliasDeclaration(n) || ts.isEnumDeclaration(n)) && n.name) info.names.add(n.name.text);
            }
            if (depth < MAX_AST_DEPTH) ts.forEachChild(n, c => visit(c, cur, depth + 1, n));
        };
        try { visit(source, null, 0, undefined); }
        catch (error) {
            if (!(error instanceof RangeError)) throw error;
            add({ kind: 'syntax', severity: 'info', confidence: 'confirmed', title: 'Too deeply nested to analyze', detail: `${file.path} nests expressions so deeply that it could only be partly read; some imports may be missing from the map.`, suggestion: 'Generated or minified code is the usual cause. Exclude it, or point RepoLens at your source files.', files: [file.path] });
        }

        const jsxConfig = configs.find(c => !c.root || file.path.startsWith(c.root + '/'))?.options;
        if (/tsx$|jsx$/.test(file.path) && /^react-jsx/.test(jsxConfig?.jsx || '')) noteExternal(node, typeof jsxConfig.jsxImportSource === 'string' ? jsxConfig.jsxImportSource : 'react');
        for (const [spec, count] of imported)
            if (count > 1) add({ kind: 'repeated', severity: 'info', confidence: 'review', title: 'Repeated import', detail: `${count} import statements reference “${spec}”. Separate type and value imports may be intentional.`, suggestion: 'Consider consolidating compatible imports for readability. Bundlers usually deduplicate the module already.', files: [file.path] });
        if (dynamic) add({ kind: 'dynamic', severity: 'info', confidence: 'review', title: 'Computed import not traced', detail: `${dynamic} computed import${dynamic > 1 ? 's cannot' : ' cannot'} be resolved statically. The map may miss these connections.`, suggestion: 'Review these imports before treating a disconnected file as unused.', files: [file.path] });

        node.functions = fnList.length;
        node.complexity = fnList.reduce((s, f) => s + f.cc, 0) + topLevelBranches;
        const worst = fnList.reduce<typeof fnList[number] | null>((a, f) => (!a || f.cc > a.cc ? f : a), null);
        if (worst && worst.cc > 1) node.worst = { name: worst.name, line: worst.line, complexity: worst.cc };
        if (worst && worst.cc >= 15)
            add({ kind: 'complexity', severity: worst.cc >= 25 ? 'warning' : 'info', confidence: 'confirmed', title: `Complex function: ${worst.name}`, detail: `${worst.name} on line ${worst.line} has a cyclomatic complexity of about ${worst.cc} (each branch, loop, case and boolean operator adds one). Above ~10 it becomes hard to test fully.`, suggestion: 'Extract the branches into named helpers, return early to flatten nesting, or replace repeated conditions with a lookup table.', files: [file.path], line: worst.line });
        if (info.names.size || info.barrel) exportsOf.set(file.path, info);
        progress(35 + Math.round(i / files.length * 40), 'Reading imports');
    }

    // ---- graph metrics ----------------------------------------------------------------------------
    progress(78, 'Measuring the graph');
    const ids = nodes.map(n => n.id);
    const byId = new Map(nodes.map(n => [n.id, n]));
    const full = buildGraph(ids, edges);
    const runtime = buildGraph(ids, edges.filter(e => !e.typeOnly));
    nodes.forEach((n, i) => { n.imports = full.out[i].length; n.importedBy = full.inn[i].length; });

    const sccRuntime = stronglyConnected(runtime.out);
    const selfLoops = new Set(edges.filter(e => !e.typeOnly && e.from === e.to).map(e => e.from));
    for (const group of sccRuntime.comps) {
        if (group.length < 2) continue;
        const loop = shortestCycle(runtime.out, group).map(i => ids[i]);
        group.forEach(i => { nodes[i].inCycle = true; });
        add({ kind: 'cycle', severity: 'warning', confidence: 'confirmed', title: 'Circular dependency', detail: `${group.length} files form a dependency loop. Shortest loop: ${loop.join(' → ')}. Initialization order may become fragile; a cycle is not necessarily a runtime error.`, suggestion: 'Move shared types or helpers into a separate module, or invert one dependency (pass the value in, or depend on an interface).', files: group.map(i => ids[i]), path: loop });
    }
    for (const id of selfLoops) { byId.get(id)!.inCycle = true; add({ kind: 'cycle', severity: 'warning', confidence: 'confirmed', title: 'File imports itself', detail: `${id} imports itself.`, suggestion: 'Remove the self-import.', files: [id], path: [id, id] }); }

    const sccFull = stronglyConnected(full.out);
    const infl = influence(full, sccFull);
    const rank = pagerank(full);
    const cuts = articulationPoints(full);
    nodes.forEach((n, i) => { n.influence = infl[i]; n.centrality = Math.round(rank[i] * 1000) / 1000; n.cutPoint = !!cuts.cut[i]; });

    // ---- entry points, reachability, tests ---------------------------------------------------------
    const manifests: { path: string; dir: string; json: Record<string, unknown> }[] = [];
    for (const f of files) {
        if (!/(^|\/)package\.json$/.test(f.path) || !f.content) continue;
        try { manifests.push({ path: f.path, dir: dir(f.path), json: JSON.parse(f.content) }); }
        catch { add({ kind: 'syntax', severity: 'error', confidence: 'confirmed', title: 'Invalid package.json', detail: `${f.path} is not valid JSON.`, suggestion: 'Fix its JSON syntax before installing or building the project.', files: [f.path] }); }
    }
    const underDir = (id: string, d: string) => d === '' || id.startsWith(d + '/');
    const declaredEntryIds = new Set<string>();
    for (const m of manifests)
        for (const k of ['main', 'module', 'source', 'browser']) {
            const v = m.json[k];
            if (typeof v === 'string') { const hit = tryPath(m.dir ? `${m.dir}/${v}` : v); if (hit) declaredEntryIds.add(hit); }
        }
    for (const n of nodes) {
        n.entry = n.isTest || (n.lang === 'js'
            ? (/(^|\/)(src|app|pages)\/(main|index|App|server)\.[cm]?[jt]sx?$|^(main|index|App|server)\.[cm]?[jt]sx?$/.test(n.id) || /(^|\/)(page|layout|route|middleware|proxy|instrumentation|error|loading|not-found|template|default|global-error|robots|sitemap|manifest|opengraph-image|twitter-image|icon|apple-icon|worker|cli|.*\.worker|.*\.config)\.[cm]?[jt]sx?$/.test(n.id) || /(^|\/)(bin|scripts|tools|\.github)\//.test(n.id) || /(^|\/)(\+page|\+layout|\+server|\+error)\.[\w.]+$/.test(n.id) || /(^|\/)(pages|routes)\//.test(n.id) || n.id.endsWith('.d.ts') || declaredEntryIds.has(n.id))
            : !!n.lang && ctx.isEntry(n.id, contentOf.get(n.id)));
    }
    for (const [id, info] of exportsOf) { const n = byId.get(id)!; if (info.barrel && !n.importedBy && /(^|\/)index\.[cm]?[jt]sx?$/.test(id)) n.entry = true; }
    const entryLangs = new Set(nodes.filter(n => n.entry).map(n => n.lang));
    const implicitGroups = new Map<string, string[]>();
    for (const n of nodes) { const g = ctx.group(n.id); if (g) implicitGroups.set(g, [...(implicitGroups.get(g) || []), n.id]); }
    const reach = (starts: string[]) => {
        const seen = new Set<string>(), queue = [...starts], expanded = new Set<string>();
        for (let i = 0; i < queue.length; i++) {
            const id = queue[i];
            if (seen.has(id)) continue;
            seen.add(id);
            for (const t of full.out[full.index.get(id)!]) queue.push(ids[t]);
            const g = ctx.group(id);
            if (g && !expanded.has(g)) { expanded.add(g); queue.push(...(implicitGroups.get(g) || [])); }
        }
        return seen;
    };
    const reachable = reach(nodes.filter(n => n.entry).map(n => n.id));
    if (nodes.some(n => n.entry))
        for (const n of nodes) if (isCode(n.id) && entryLangs.has(n.lang) && !reachable.has(n.id) && !n.isTest)
            add({ kind: 'unreachable', severity: 'info', confidence: 'review', title: 'Outside known entry paths', detail: 'No traced import path connects this file to a recognized entry point. It may be a script, framework route, public API, or dynamically loaded file.', suggestion: 'Verify your framework conventions, package exports, scripts, and computed imports before deleting anything.', files: [n.id], bytes: n.size });

    const testNodes = nodes.filter(n => n.isTest);
    const testReach = testNodes.length ? reach(testNodes.map(n => n.id)) : new Set<string>();
    const hasTests = testNodes.length > 0;
    const codeNodes = nodes.filter(n => isCode(n.id));
    nodes.forEach(n => { n.tested = testReach.has(n.id) && !n.isTest; });
    if (hasTests) {
        const gaps = codeNodes.filter(n => !n.isTest && !n.tested && !n.entry && (n.importedBy >= 3 || n.influence >= 5)).sort((a, b) => b.influence - a.influence).slice(0, 25);
        for (const n of gaps) add({ kind: 'untested', severity: 'info', confidence: 'review', title: 'Widely used, but no test reaches it', detail: `${n.importedBy} files import ${n.id} and ${n.influence} are affected by changes to it, yet no test file imports it directly or indirectly.`, suggestion: 'Add a test that exercises this module, or one that covers a file that depends on it.', files: [n.id] });
    } else if (codeNodes.length >= 8) {
        add({ kind: 'no-tests', severity: 'info', confidence: 'review', title: 'No tests detected', detail: 'Nothing in the project looks like a test file (a tests/ folder, *.test.*, test_*.py, *_test.go, src/test/ and similar).', suggestion: 'Even a few tests around the most-imported modules make refactoring far safer.', files: [] });
    }

    // ---- coupling, dead code, packages ----------------------------------------------------------------
    const hubThreshold = Math.max(8, Math.round(nodes.length * 0.1));
    const hubs = new Set(nodes.filter(n => n.importedBy >= hubThreshold).sort((a, b) => b.importedBy - a.importedBy).slice(0, 6).map(n => n.id));
    for (const n of nodes) {
        if (hubs.has(n.id)) add({ kind: 'coupling', severity: 'info', confidence: 'review', title: 'High change influence', detail: `${n.importedBy} files import this module directly and ${n.influence} are affected by a change. Changes here deserve extra testing.`, suggestion: 'Keep the interface stable and test its callers. Shared utilities can be intentionally central.', files: [n.id] });
        if (n.imports >= 15 && isCode(n.id) && !n.entry) add({ kind: 'fan-out', severity: 'info', confidence: 'review', title: 'Depends on many files', detail: `${n.id} imports ${n.imports} other files, so it breaks whenever any of them changes and is hard to reuse.`, suggestion: 'Check whether it is doing too many jobs; split it, or pass collaborators in instead of importing them.', files: [n.id] });
    }
    for (const [target, info] of exportsOf) {
        const n = byId.get(target)!;
        if (info.barrel || n.entry || n.isTest || target.endsWith('.d.ts') || isSfc(target) || !n.importedBy) continue;
        const u = usage.get(target);
        if (!u || u.wild) continue;
        const unused = [...info.names].filter(x => !u.names.has(x));
        if (unused.length) add({ kind: 'unused-export', severity: 'info', confidence: 'review', title: 'Exports nothing else uses', detail: `${unused.slice(0, 6).join(', ')}${unused.length > 6 ? `, +${unused.length - 6} more` : ''} ${unused.length === 1 ? 'is' : 'are'} exported from ${target} but never imported anywhere in the project.`, suggestion: 'If this is not a public API, remove the export (or the code). Packages consumed by other repositories may use it legitimately.', files: [target] });
    }

    const jsExternalByFile = new Map<string, string[]>();
    for (const n of nodes) if (n.lang === 'js') jsExternalByFile.set(n.id, n.external);
    const declaredFor = (id: string) => {
        const owners = manifests.filter(m => underDir(id, m.dir));
        if (!owners.length) return null; // no manifest covers this file, so declarations cannot be judged
        const set = new Set<string>();
        for (const m of owners) for (const k of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
            const group = m.json[k];
            if (group && typeof group === 'object') Object.keys(group).forEach(d => set.add(d));
        }
        return set;
    };
    for (const m of manifests) {
        const prod = m.json.dependencies && typeof m.json.dependencies === 'object' ? Object.keys(m.json.dependencies) : [];
        const used = new Set<string>();
        for (const [id, ext] of jsExternalByFile) if (underDir(id, m.dir)) ext.forEach(e => used.add(e));
        for (const p of prod) if (!used.has(p)) add({ kind: 'package', severity: 'info', confidence: 'review', title: 'Package has no traced import', detail: `“${p}” is a production dependency of ${m.path} with no literal import in the analyzed source. It may be used by scripts, plugins, styles, or generated code.`, suggestion: 'Check configuration, scripts, and runtime usage before uninstalling this package.', files: [m.path] });
    }
    const undeclared = new Map<string, string[]>();
    for (const [id, ext] of jsExternalByFile) {
        const declared = declaredFor(id);
        if (!declared) continue;
        for (const p of ext) if (!declared.has(p) && !p.startsWith('@types/')) undeclared.set(p, [...(undeclared.get(p) || []), id]);
    }
    for (const [p, users] of [...undeclared].sort(([x], [y]) => x.localeCompare(y)))
        add({ kind: 'undeclared', severity: 'warning', confidence: 'review', title: 'Imported but not declared', detail: `“${p}” is imported by ${users.length} file${users.length === 1 ? '' : 's'} but no package.json covering ${users.length === 1 ? 'it' : 'them'} lists it. It may only work because another package pulls it in, which can break on a fresh install.`, suggestion: `Add it to dependencies (npm install ${p}) or remove the import.`, files: users.slice(0, 8) });

    // ---- folder architecture -------------------------------------------------------------------------------
    progress(86, 'Mapping architecture');
    const folderIds = [...new Set(nodes.map(n => n.folder))].sort();
    const fIdx = new Map(folderIds.map((f, i) => [f, i]));
    const folderWeight = new Map<string, number>();
    const folderSamples = new Map<string, string[]>();
    for (const e of edges) {
        const a = byId.get(e.from)!.folder, b = byId.get(e.to)!.folder;
        if (a === b) continue;
        const key = `${a}\0${b}`;
        folderWeight.set(key, (folderWeight.get(key) || 0) + 1);
        const s = folderSamples.get(key) ?? [];
        if (s.length < 3) s.push(e.from);
        folderSamples.set(key, s);
    }
    const folderEdges: FolderEdge[] = [...folderWeight].map(([k, weight]) => { const [from, to] = k.split('\0'); return { from, to, weight }; });
    const ca = new Map<string, number>(), ce = new Map<string, number>();
    for (const e of folderEdges) { ce.set(e.from, (ce.get(e.from) || 0) + e.weight); ca.set(e.to, (ca.get(e.to) || 0) + e.weight); }
    const isAncestor = (anc: string, of: string) => of !== anc && (anc === 'project' || of.startsWith(anc + '/'));
    // A directory importing from one of its ancestors ('../types', '../config') is a normal shared-base
    // pattern, so only sideways and downward dependencies can form a meaningful directory cycle.
    const folderGraph = buildGraph(folderIds, folderEdges.filter(e => !isAncestor(e.to, e.from)));
    const folderScc = stronglyConnected(folderGraph.out);
    const folderCyclic = new Set<number>();
    for (const group of folderScc.comps) {
        if (group.length < 2) continue;
        group.forEach(i => folderCyclic.add(i));
        const names = group.map(i => folderIds[i]);
        const sample = names.flatMap(a => names.flatMap(b => folderSamples.get(`${a}\0${b}`) ?? [])).slice(0, 6);
        add({ kind: 'folder-cycle', severity: 'info', confidence: 'confirmed', title: 'Directories depend on each other', detail: `${names.slice(0, 5).join(', ')}${names.length > 5 ? ` and ${names.length - 5} more` : ''} import from one another, so none of them can be understood, tested or moved on its own.`, suggestion: 'Decide which directory is lower-level and make dependencies run one way only; extract what both need into a third directory.', files: [...new Set(sample)], folders: names });
    }
    const folderStat = new Map<string, FolderNode>();
    const insideByFolder = new Map<string, FileNode[]>();
    for (const n of nodes) { const l = insideByFolder.get(n.folder); if (l) l.push(n); else insideByFolder.set(n.folder, [n]); }
    const folders: FolderNode[] = folderIds.map((id, i) => {
        const inside = insideByFolder.get(id) ?? [];
        const a = ca.get(id) || 0, e = ce.get(id) || 0;
        const f: FolderNode = { id, files: inside.length, lines: inside.reduce((s, n) => s + n.lines, 0), ca: a, ce: e, instability: a + e ? Math.round(e / (a + e) * 100) / 100 : 0, inCycle: folderCyclic.has(i), x: 0, y: 0, z: 0 };
        folderStat.set(id, f);
        return f;
    });
    const violations = folderEdges.filter(e => {
        const a = folderStat.get(e.from)!, b = folderStat.get(e.to)!;
        return e.weight >= 2 && a.files >= 2 && b.files >= 2 && b.instability - a.instability >= 0.4 && !(folderCyclic.has(fIdx.get(e.from)!) && folderCyclic.has(fIdx.get(e.to)!));
    }).sort((x, y) => y.weight - x.weight).slice(0, 5);
    for (const v of violations) {
        const a = folderStat.get(v.from)!, b = folderStat.get(v.to)!;
        add({ kind: 'layering', severity: 'info', confidence: 'review', title: 'A stable directory leans on a volatile one', detail: `${v.from} (instability ${a.instability.toFixed(2)}) depends on ${v.to} (${b.instability.toFixed(2)}) through ${v.weight} imports. Code that many others rely on should depend on steadier code, not on code that itself depends on many things.`, suggestion: 'Move the shared piece down into the stable directory, or introduce an interface owned by the stable side.', files: folderSamples.get(`${v.from}\0${v.to}`) ?? [], folders: [v.from, v.to] });
    }

    // ---- duplicates --------------------------------------------------------------------------------------------
    let duplicateBytes = 0;
    for (const group of duplicates.values()) if (group.length > 1) {
        const bytes = byId.get(group[0])!.size * (group.length - 1);
        duplicateBytes += bytes;
        add({ kind: 'duplicate', severity: 'warning', confidence: 'confirmed', title: 'Identical source files', detail: `${group.length} files contain exactly the same text. ${(bytes / 1024).toFixed(1)} KB is repeated on disk; this is not a guaranteed bundle saving.`, suggestion: 'Review whether callers can share one implementation before removing a copy.', files: group, bytes });
    }

    // ---- risk, priority, health ---------------------------------------------------------------------------------------
    for (const n of nodes) n.risk = isCode(n.id) ? riskScore(n, nodes.length, hasTests) : 0;
    const influenceOf = (fs: string[]) => fs.reduce((m, f) => Math.max(m, byId.get(f)?.influence ?? 0), 0);
    const severityRank = { error: 0, warning: 1, info: 2 };
    const sizeFindings = rawFindings.filter(f => f.kind === 'size').sort((a, b) => (b.bytes ?? 0) - (a.bytes ?? 0));
    if (sizeFindings.length > 20) {
        const drop = new Set(sizeFindings.slice(20));
        for (let i = rawFindings.length - 1; i >= 0; i--) if (drop.has(rawFindings[i])) rawFindings.splice(i, 1);
        configWarnings.add(`Only the 20 largest of ${sizeFindings.length} large files are listed.`);
    }
    let findings: Finding[] = rawFindings.map(f => ({ ...f, id: '', priority: priorityOf(f, influenceOf(f.files)) }))
        .sort((a, b) => b.priority - a.priority || severityRank[a.severity] - severityRank[b.severity] || a.title.localeCompare(b.title));
    const limitations = ['JavaScript and TypeScript are parsed with the TypeScript compiler; other languages use comment-aware pattern matching, not a full parser. No execution, type checking, or exhaustive security audit.', 'Framework entry points, generated files, computed imports, package exports, and custom resolvers can leave gaps. Review unused-file and unused-export suggestions.', 'Secret and risky-construct checks are pattern-based: they can miss things and can flag harmless code.', ...configWarnings];
    if (languagesOf(nodes).some(l => ['java', 'kotlin', 'scala', 'go', 'csharp'].includes(l.lang)))
        limitations.splice(2, 0, 'Java, Kotlin, Scala, Go and C# files in the same package or namespace see each other without imports, so those connections are not drawn.');
    if (fastFiles) limitations.push(`To stay within its time budget, ${fastFiles.toLocaleString('en-US')} JavaScript/TypeScript files were read with a faster, less detailed method: their imports are mapped, but they have no complexity or unused-export data.`);
    if (findings.length > maxFindings) {
        limitations.push(`Showing the ${maxFindings.toLocaleString('en-US')} highest-priority of ${findings.length.toLocaleString('en-US')} findings.`);
        findings = findings.slice(0, maxFindings);
    }
    findings.forEach((f, i) => { f.id = `f-${i}`; });
    const health = computeHealth({ findings, codeFiles: codeNodes.length, testFiles: testNodes.length });

    // ---- layout ----------------------------------------------------------------------------------------------------------------
    progress(92, 'Laying out the map');
    if (options.layout !== false) {
        const pairs: [number, number][] = [];
        const seenPair = new Set<number>();
        for (const e of edges) {
            const a = full.index.get(e.from)!, b = full.index.get(e.to)!;
            const key = a * nodes.length + b;
            if (a !== b && !seenPair.has(key)) { seenPair.add(key); pairs.push([a, b]); }
        }
        const layout = layout3d(nodes.map(n => n.folder), pairs);
        nodes.forEach((n, i) => { n.x = round(layout.positions[i * 3]); n.y = round(layout.positions[i * 3 + 1]); n.z = round(layout.positions[i * 3 + 2]); });
        layout.folderIds.forEach((id, i) => { const f = folderStat.get(id)!; f.x = round(layout.folderPositions[i * 3]); f.y = round(layout.folderPositions[i * 3 + 1]); f.z = round(layout.folderPositions[i * 3 + 2]); });
    }

    const externals: ExternalPackage[] = [...externalFiles].map(([pkgName, set]) => {
        const isJs = [...set].some(id => byId.get(id)?.lang === 'js');
        return { name: pkgName, files: set.size, declared: isJs && manifests.length ? !undeclared.has(pkgName) : null };
    }).sort((a, b) => b.files - a.files || a.name.localeCompare(b.name));
    progress(100, 'Done');
    return {
        schemaVersion: 2, name, nodes, edges, findings, folders, folderEdges, externals, health, fixFirst: pickFixFirst(findings),
        skipped: input.skipped, skippedBytes: input.skippedBytes, skippedReasons: input.skippedReasons,
        bytes: files.reduce((s, f) => s + f.size, 0), lines: nodes.reduce((s, n) => s + n.lines, 0), duplicateBytes,
        packages: [...externalFiles.keys()].sort(), languages: languagesOf(nodes), testFiles: testNodes.length,
        duration: Math.round(performance.now() - started), limitations,
    };
}

const round = (v: number) => Math.round(v * 10000) / 10000;

function languagesOf(nodes: FileNode[]) {
    const totals = new Map<string, { lang: string; label: string; files: number; lines: number }>();
    for (const n of nodes) if (n.lang) {
        const t = totals.get(n.lang) || { lang: n.lang, label: LANGUAGE_LABELS[n.lang as Lang], files: 0, lines: 0 };
        t.files++;
        t.lines += n.lines;
        totals.set(n.lang, t);
    }
    return [...totals.values()].sort((a, b) => b.lines - a.lines);
}
