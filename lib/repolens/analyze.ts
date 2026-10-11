import ts from 'typescript';
import { isCode, type Collected } from './input';
import { LANGUAGE_LABELS, createLanguageContext, extractScript, isSfc, languageOf, type Lang } from './languages';
import { type Report, type Finding, type Edge, type FileNode } from './types';
const normalize = (p: string) => { const out: string[] = []; for (const part of p.split('/')) {
    if (part === '..')
        out.pop();
    else if (part && part !== '.')
        out.push(part);
} return out.join('/'); };
const dir = (p: string) => p.slice(0, Math.max(0, p.lastIndexOf('/')));
const packageName = (s: string) => s.startsWith('@') ? s.split('/').slice(0, 2).join('/') : s.split('/')[0];
const native = new Set('assert async_hooks buffer child_process cluster console constants crypto dgram diagnostics_channel dns domain events fs http http2 https module net os path perf_hooks process punycode querystring readline repl stream string_decoder sys timers tls trace_events tty url util v8 vm wasi worker_threads zlib test'.split(' '));
export type AnalyzeOptions = { maxEdges?: number; maxFindings?: number };
export function analyze(input: Collected, name: string, progress: (n: number) => void = () => { }, options: AnalyzeOptions = {}): Report {
    const started = performance.now(), { files } = input;
    if (!files.some(f => isCode(f.path) && f.content !== undefined))
        throw new Error('No readable source files found. RepoLens understands JavaScript/TypeScript, Python, Java, Kotlin, Scala, Go, Rust, C/C++, C#, Ruby, PHP, Dart and Swift. Select the project root or a source folder.');
    const maxEdges = options.maxEdges ?? 15000, maxFindings = options.maxFindings ?? 5000, ctx = createLanguageContext(files), contentOf = new Map(files.map(f => [f.path, f.content])), edgeKeys = new Set<string>();
    const paths = new Set(files.map(f => f.path)), nodes: FileNode[] = [], edges: Edge[] = [], findings: Finding[] = [];
    const contents = new Map<string, string[]>(), external = new Set<string>(), configWarnings = new Set<string>();
    const configs = files.filter(f => /(^|\/)(tsconfig|jsconfig)\.json$/.test(f.path) && f.content).map(f => { const parsed = ts.parseConfigFileTextToJson(f.path, f.content!); if (parsed.error)
        configWarnings.add(`Cannot parse ${f.path}.`); if (parsed.config?.extends)
        configWarnings.add(`${f.path} extends another config; inherited aliases are not resolved.`); return { root: dir(f.path), options: parsed.config?.compilerOptions || {} }; }).sort((a, b) => b.root.length - a.root.length);
    const add = (f: Omit<Finding, 'id'>) => { if (findings.length >= maxFindings)
        throw new Error(`This project produced more than ${maxFindings.toLocaleString('en-US')} findings. Analyze a smaller source folder.`); findings.push({ id: `f-${findings.length}`, ...f }); };
    const addEdge = (from: string, to: string, typeOnly: boolean, line: number) => {
        const key = `${from}\0${to}\0${typeOnly}`;
        if (edgeKeys.has(key))
            return;
        if (edges.length >= maxEdges)
            throw new Error(`This project exceeds ${maxEdges.toLocaleString('en-US')} connections. Analyze a smaller source folder.`);
        edgeKeys.add(key);
        edges.push({ from, to, typeOnly, line });
    };
    const tryPath = (p: string) => {
        const base = normalize(p), candidates = [base, ...['.ts', '.tsx', '.js', '.jsx', '.mts', '.mjs', '.cts', '.cjs', '.json', '.css', '.vue', '.svelte', '.astro'].map(x => base + x), ...['.ts', '.tsx', '.js', '.jsx', '.mts', '.mjs', '.vue', '.svelte'].map(x => base + '/index' + x)];
        if (/\.[cm]?jsx?$/.test(base))
            candidates.push(base.replace(/\.[cm]?jsx?$/, '.ts'), base.replace(/\.[cm]?jsx?$/, '.tsx'), base.replace(/\.mjs$/, '.mts'), base.replace(/\.cjs$/, '.cts'));
        return candidates.find(x => paths.has(x));
    };
    const resolve = (from: string, raw: string): {
        local: boolean;
        target?: string;
        uncertain?: boolean;
    } => {
        const s = raw.split(/[?#]/)[0];
        if (s.startsWith('.'))
            return { local: true, target: tryPath(dir(from) + '/' + s) };
        if (s.startsWith('/'))
            return { local: true, target: tryPath(s.slice(1)) || tryPath('public/' + s.slice(1)) };
        const cfg = configs.find(c => !c.root || from.startsWith(c.root + '/'));
        if (cfg) {
            const base = normalize(cfg.root + '/' + (typeof cfg.options.baseUrl === 'string' ? cfg.options.baseUrl : '.'));
            for (const [pattern, targets] of Object.entries(cfg.options.paths || {}).sort(([a], [b]) => b.replace('*', '').length - a.replace('*', '').length)) {
                if (!Array.isArray(targets))
                    continue;
                const [pre, post = ''] = pattern.split('*');
                const matches = pattern.includes('*') ? s.startsWith(pre) && s.endsWith(post) : s === pattern;
                if (matches) {
                    const middle = pattern.includes('*') ? s.slice(pre.length, post ? -post.length : undefined) : '';
                    for (const target of targets)
                        if (typeof target === 'string') {
                            const found = tryPath(base + '/' + target.replace('*', middle));
                            if (found)
                                return { local: true, target: found };
                        }
                    return { local: true };
                }
            }
            if (typeof cfg.options.baseUrl === 'string') {
                const found = tryPath(base + '/' + s);
                if (found)
                    return { local: true, target: found };
            }
        }
        if (s.startsWith('@/') || s.startsWith('~/') || s.startsWith('#'))
            return { local: true, uncertain: true };
        return { local: false };
    };
    for (let i = 0; i < files.length; i++) {
        const file = files[i], code = isCode(file.path), lang: Lang | null = languageOf(file.path), text = file.content;
        const node: FileNode = { id: file.path, name: file.path.split('/').at(-1)!, folder: dir(file.path) || 'project', lang: lang ?? undefined, kind: code ? (/tsx$|jsx$|\.(vue|svelte|astro)$/.test(file.path) ? 'component' : 'module') : /\.s?css$/.test(file.path) ? 'style' : /\.json$/.test(file.path) ? 'config' : text !== undefined ? 'document' : 'asset', size: file.size, lines: text ? text.split('\n').length : 0, imports: 0, importedBy: 0, external: [], entry: false, x: 0, y: 0 };
        nodes.push(node);
        if (text && text.length >= 80 && code)
            contents.set(text, [...(contents.get(text) || []), file.path]);
        if (file.size >= (code ? 50 * 1024 : 250 * 1024) || (code && node.lines >= 800))
            add({ kind: 'size', severity: 'info', confidence: 'review', title: code ? 'Large source file' : 'Large asset', detail: `${file.path} uses ${(file.size / 1024).toFixed(1)} KB${code ? ` across ${node.lines} lines` : ' on disk'}. Disk size is not transferred bundle size or runtime cost.`, suggestion: code ? 'Check whether this file has several responsibilities that could be separated.' : 'Check whether this asset needs its current resolution or format. Its runtime use is not inferred.', files: [file.path], bytes: file.size });
        if (!code || text === undefined)
            continue;
        if (lang !== 'js') {
            const seen = new Set<string>();
            for (const imp of ctx.imports(file.path, text)) {
                const r = ctx.resolve(file.path, imp);
                for (const target of r.targets)
                    if (target !== file.path)
                        addEdge(file.path, target, false, imp.line);
                if (r.external && !node.external.includes(r.external)) {
                    node.external.push(r.external);
                    external.add(r.external);
                }
                if (r.unresolved && !r.targets.length && !seen.has(imp.spec)) {
                    seen.add(imp.spec);
                    add({ kind: 'unresolved', severity: 'warning', confidence: 'review', title: 'Unresolved local import', detail: `“${imp.spec.replace(/^(mod:|ns:)/, '')}” could not be resolved within the included files. It may be missing, excluded, generated, or provided by build tooling.`, suggestion: 'Check the path, filename case, and whether the target file was included in the analysis.', files: [file.path], line: imp.line });
                }
            }
            progress(35 + Math.round(i / files.length * 45));
            continue;
        }
        const scriptText = isSfc(file.path) ? extractScript(file.path, text) : text;
        const source = ts.createSourceFile(isSfc(file.path) ? file.path + '.ts' : file.path, scriptText, ts.ScriptTarget.Latest, true);
        const diagnostics = (source as ts.SourceFile & {
            parseDiagnostics: readonly ts.Diagnostic[];
        }).parseDiagnostics;
        for (const d of diagnostics.slice(0, 10))
            add({ kind: 'syntax', severity: 'error', confidence: 'confirmed', title: 'Syntax error', detail: ts.flattenDiagnosticMessageText(d.messageText, ' '), suggestion: 'Correct this syntax, then run your project’s own compiler and tests.', files: [file.path], line: source.getLineAndCharacterOfPosition(d.start || 0).line + 1 });
        const imported = new Map<string, number>();
        let dynamic = 0;
        const record = (spec: string, pos: number, typeOnly = false) => {
            const line = source.getLineAndCharacterOfPosition(pos).line + 1;
            imported.set(spec, (imported.get(spec) || 0) + 1);
            const r = resolve(file.path, spec);
            if (r.target)
                addEdge(file.path, r.target, typeOnly, line);
            else if (r.local)
                add({ kind: 'unresolved', severity: 'warning', confidence: 'review', title: r.uncertain ? 'Unconfigured import alias' : 'Unresolved local import', detail: `“${spec}” could not be resolved within the included files. It may be missing, excluded, generated, or handled by custom tooling.`, suggestion: r.uncertain ? 'Include the tsconfig.json/jsconfig.json containing this alias. Inherited aliases and package import maps need manual review.' : 'Check the import path, filename case, and whether the target file was included.', files: [file.path], line });
            else if (!spec.startsWith('node:') && !native.has(packageName(spec)) && !/^https?:|^data:/.test(spec)) {
                const p = packageName(spec);
                external.add(p);
                if (!node.external.includes(p))
                    node.external.push(p);
            }
        };
        const visit = (n: ts.Node) => {
            if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) {
                const c = n.importClause;
                const onlyTypes = !!c?.isTypeOnly || !!(c && !c.name && c.namedBindings && ts.isNamedImports(c.namedBindings) && c.namedBindings.elements.length && c.namedBindings.elements.every(e => e.isTypeOnly));
                record(n.moduleSpecifier.text, n.getStart(source), onlyTypes);
            }
            else if (ts.isExportDeclaration(n) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier))
                record(n.moduleSpecifier.text, n.getStart(source), n.isTypeOnly || !!(n.exportClause && ts.isNamedExports(n.exportClause) && n.exportClause.elements.length && n.exportClause.elements.every(e => e.isTypeOnly)));
            else if (ts.isCallExpression(n) && (n.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(n.expression) && n.expression.text === 'require')) {
                const a = n.arguments[0];
                if (a && (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a)))
                    record(a.text, n.getStart(source));
                else
                    dynamic++;
            }
            else if (ts.isImportEqualsDeclaration(n) && ts.isExternalModuleReference(n.moduleReference) && n.moduleReference.expression && ts.isStringLiteral(n.moduleReference.expression))
                record(n.moduleReference.expression.text, n.getStart(source), n.isTypeOnly);
            ts.forEachChild(n, visit);
        };
        visit(source);
        const jsxConfig = configs.find(c => !c.root || file.path.startsWith(c.root + '/'))?.options;
        if (/tsx$|jsx$/.test(file.path) && /^react-jsx/.test(jsxConfig?.jsx || '')) {
            const p = typeof jsxConfig.jsxImportSource === 'string' ? jsxConfig.jsxImportSource : 'react';
            external.add(p);
            if (!node.external.includes(p))
                node.external.push(p);
        }
        for (const [spec, count] of imported)
            if (count > 1)
                add({ kind: 'repeated', severity: 'info', confidence: 'review', title: 'Repeated import', detail: `${count} import statements reference “${spec}”. Separate type and value imports may be intentional.`, suggestion: 'Consider consolidating compatible imports for readability. Bundlers usually deduplicate the module already.', files: [file.path] });
        if (dynamic)
            add({ kind: 'dynamic', severity: 'info', confidence: 'review', title: 'Computed import not traced', detail: `${dynamic} computed import${dynamic > 1 ? 's cannot' : ' cannot'} be resolved statically. The map may miss these connections.`, suggestion: 'Review these imports before treating a disconnected file as unused.', files: [file.path] });
        progress(35 + Math.round(i / files.length * 45));
    }
    const byId = new Map(nodes.map(n => [n.id, n]));
    for (const n of nodes) {
        n.imports = new Set(edges.filter(e => e.from === n.id).map(e => e.to)).size;
        n.importedBy = new Set(edges.filter(e => e.to === n.id).map(e => e.from)).size;
    }
    // Tarjan's strongly connected components, excluding explicitly type-only edges.
    const adjacency = new Map<string, string[]>();
    for (const e of edges.filter(e => !e.typeOnly))
        adjacency.set(e.from, [...(adjacency.get(e.from) || []), e.to]);
    let index = 0;
    const indices = new Map<string, number>(), low = new Map<string, number>(), stack: string[] = [], onStack = new Set<string>();
    const components: string[][] = [];
    const strong = (v: string) => { indices.set(v, index); low.set(v, index++); stack.push(v); onStack.add(v); for (const w of adjacency.get(v) || []) {
        if (!indices.has(w)) {
            strong(w);
            low.set(v, Math.min(low.get(v)!, low.get(w)!));
        }
        else if (onStack.has(w))
            low.set(v, Math.min(low.get(v)!, indices.get(w)!));
    } if (low.get(v) === indices.get(v)) {
        const group: string[] = [];
        let w: string;
        do {
            w = stack.pop()!;
            onStack.delete(w);
            group.push(w);
        } while (w !== v);
        components.push(group);
    } };
    for (const node of nodes)
        if (!indices.has(node.id))
            strong(node.id);
    for (const group of components)
        if (group.length > 1 || edges.some(e => !e.typeOnly && e.from === group[0] && e.to === group[0]))
            add({ kind: 'cycle', severity: 'warning', confidence: 'confirmed', title: 'Circular dependency', detail: `${group.length} file${group.length > 1 ? 's form a dependency loop' : ' imports itself'}. Initialization order may become fragile; a cycle is not necessarily a runtime error.`, suggestion: 'Move shared types or helpers into a separate module, or invert the dependency.', files: group });
    let duplicateBytes = 0;
    for (const group of contents.values())
        if (group.length > 1) {
            const bytes = byId.get(group[0])!.size * (group.length - 1);
            duplicateBytes += bytes;
            add({ kind: 'duplicate', severity: 'warning', confidence: 'confirmed', title: 'Identical source files', detail: `${group.length} files contain exactly the same text. ${(bytes / 1024).toFixed(1)} KB is repeated on disk; this is not a guaranteed bundle saving.`, suggestion: 'Review whether callers can share one implementation before removing a copy.', files: group, bytes });
        }
    const rootPackage = files.find(f => f.path === 'package.json');
    let pkg: Record<string, unknown> = {};
    if (rootPackage?.content) {
        try {
            pkg = JSON.parse(rootPackage.content);
        }
        catch {
            add({ kind: 'syntax', severity: 'error', confidence: 'confirmed', title: 'Invalid package.json', detail: 'The root package.json is not valid JSON.', suggestion: 'Fix its JSON syntax before installing or building the project.', files: ['package.json'] });
        }
    }
    const declaredEntries = ['main', 'module', 'source', 'browser'].map(k => pkg[k]).filter((p): p is string => typeof p === 'string');
    for (const n of nodes)
        n.entry = n.lang === 'js' ? (/^((src|app|pages)\/)?(main|index|App|server)\.[cm]?[jt]sx?$/.test(n.id) || /(^|\/)(page|layout|route|middleware|instrumentation|.*\.config|.*\.test|.*\.spec)\.[cm]?[jt]sx?$/.test(n.id) || /(^|\/)(\+page|\+layout|\+server|\+error)\.[\w.]+$/.test(n.id) || /(^|\/)(pages|routes)\//.test(n.id) || n.id.endsWith('.d.ts') || declaredEntries.some(p => tryPath(p) === n.id)) : !!n.lang && ctx.isEntry(n.id, contentOf.get(n.id));
    const entryLangs = new Set(nodes.filter(n => n.entry).map(n => n.lang));
    const implicitGroups = new Map<string, string[]>();
    for (const n of nodes) {
        const g = ctx.group(n.id);
        if (g)
            implicitGroups.set(g, [...(implicitGroups.get(g) || []), n.id]);
    }
    const reachable = new Set<string>(), queue = nodes.filter(n => n.entry).map(n => n.id), expandedGroups = new Set<string>();
    const allAdj = new Map<string, string[]>();
    for (const e of edges)
        allAdj.set(e.from, [...(allAdj.get(e.from) || []), e.to]);
    for (let i = 0; i < queue.length; i++) {
        const id = queue[i];
        if (reachable.has(id))
            continue;
        reachable.add(id);
        queue.push(...(allAdj.get(id) || []));
        const group = ctx.group(id);
        if (group && !expandedGroups.has(group)) {
            expandedGroups.add(group);
            queue.push(...(implicitGroups.get(group) || []));
        }
    }
    if (nodes.some(n => n.entry))
        for (const n of nodes)
            if (isCode(n.id) && entryLangs.has(n.lang) && !reachable.has(n.id))
                add({ kind: 'unreachable', severity: 'info', confidence: 'review', title: 'Outside known entry paths', detail: 'No traced import path connects this file to a recognized entry point. It may be a script, framework route, public API, or dynamically loaded file.', suggestion: 'Verify your framework conventions, package exports, scripts, and computed imports before deleting anything.', files: [n.id], bytes: n.size });
    for (const n of nodes)
        if (n.importedBy >= 6)
            add({ kind: 'coupling', severity: 'info', confidence: 'review', title: 'High change influence', detail: `${n.importedBy} files directly depend on this module. Changes here deserve extra testing.`, suggestion: 'Keep the interface stable and test its callers. Shared utilities can be intentionally central.', files: [n.id] });
    const deps = pkg.dependencies && typeof pkg.dependencies === 'object' ? Object.keys(pkg.dependencies) : [];
    for (const p of deps)
        if (!external.has(p))
            add({ kind: 'package', severity: 'info', confidence: 'review', title: 'Package has no traced import', detail: `“${p}” is a production dependency with no literal import in the analyzed source. It may be used by scripts, plugins, styles, or generated code.`, suggestion: 'Check configuration, scripts, and runtime usage before uninstalling this package.', files: ['package.json'] });
    // Position SCCs by dependency depth. Components containing cycles stay together.
    const componentOf = new Map<string, number>();
    components.forEach((c, i) => c.forEach(id => componentOf.set(id, i)));
    const depth = new Map<number, number>();
    const level = (c: number): number => { if (depth.has(c))
        return depth.get(c)!; depth.set(c, 0); const next = new Set(components[c].flatMap(id => (adjacency.get(id) || []).map(n => componentOf.get(n)!)).filter(n => n !== c)); const value = next.size ? Math.min(8, 1 + Math.max(...[...next].map(level))) : 0; depth.set(c, value); return value; };
    const layers = new Map<number, FileNode[]>();
    for (const n of nodes) {
        const l = level(componentOf.get(n.id)!);
        layers.set(l, [...(layers.get(l) || []), n]);
    }
    const max = Math.max(...layers.keys());
    for (const [l, group] of layers) {
        group.sort((a, b) => b.importedBy - a.importedBy || a.folder.localeCompare(b.folder) || a.name.localeCompare(b.name));
        group.forEach((n, i) => { n.x = (max - l) * 315; n.y = (i - (group.length - 1) / 2) * 102; });
    }
    // A bounded grid optimization keeps the mindmap compact and high-influence
    // modules central, without the unstable motion of a continuously running force simulation.
    const columns = Math.max(2, Math.ceil(Math.sqrt(nodes.length * .68)));
    const rows = Math.ceil(nodes.length / columns);
    const slots = Array.from({ length: nodes.length }, (_, i) => ({ x: (i % columns) * 258, y: Math.floor(i / columns) * 99 }));
    slots.sort((a, b) => Math.hypot(a.x - (columns - 1) * 129, a.y - (rows - 1) * 49.5) - Math.hypot(b.x - (columns - 1) * 129, b.y - (rows - 1) * 49.5));
    const ordered = [...nodes].sort((a, b) => (b.imports + b.importedBy) - (a.imports + a.importedBy) || a.id.localeCompare(b.id));
    ordered.forEach((n, i) => { n.x = slots[i].x; n.y = slots[i].y; });
    const neighbors = new Map<string, string[]>();
    for (const e of edges) {
        neighbors.set(e.from, [...(neighbors.get(e.from) || []), e.to]);
        neighbors.set(e.to, [...(neighbors.get(e.to) || []), e.from]);
    }
    const cost = (n: FileNode) => (neighbors.get(n.id) || []).reduce((total, id) => { const other = byId.get(id)!; return total + Math.hypot((n.x - other.x) * .6, n.y - other.y); }, 0);
    let seed = 718;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    for (let i = 0; i < Math.min(nodes.length * 90, 20000); i++) {
        const a = ordered[Math.floor(random() * nodes.length)], b = ordered[Math.floor(random() * nodes.length)];
        if (a === b)
            continue;
        const before = cost(a) + cost(b);
        [a.x, b.x] = [b.x, a.x];
        [a.y, b.y] = [b.y, a.y];
        if (cost(a) + cost(b) > before) {
            [a.x, b.x] = [b.x, a.x];
            [a.y, b.y] = [b.y, a.y];
        }
    }
    const languageTotals = new Map<string, { lang: string; label: string; files: number; lines: number }>();
    for (const n of nodes)
        if (n.lang) {
            const t = languageTotals.get(n.lang) || { lang: n.lang, label: LANGUAGE_LABELS[n.lang as Lang], files: 0, lines: 0 };
            t.files++;
            t.lines += n.lines;
            languageTotals.set(n.lang, t);
        }
    const languages = [...languageTotals.values()].sort((a, b) => b.lines - a.lines);
    const rank = { error: 0, warning: 1, info: 2 };
    findings.sort((a, b) => rank[a.severity] - rank[b.severity] || a.title.localeCompare(b.title));
    progress(100);
    return { name, nodes, edges, findings, skipped: input.skipped, skippedBytes: input.skippedBytes, skippedReasons: input.skippedReasons, bytes: files.reduce((s, f) => s + f.size, 0), lines: nodes.reduce((s, n) => s + n.lines, 0), duplicateBytes, packages: [...external].sort(), duration: Math.round(performance.now() - started), languages, limitations: ['JavaScript and TypeScript are parsed with the TypeScript compiler; other languages use comment-aware pattern matching, not a full parser. No execution, type checking, security audit, or energy measurement.', ...(languages.some(l => ['java', 'kotlin', 'scala', 'go', 'csharp'].includes(l.lang)) ? ['Java, Kotlin, Scala, Go and C# files in the same package or namespace see each other without imports, so those connections are not drawn.'] : []), 'Framework entry points, generated files, computed imports, package exports, and custom resolvers can leave gaps. Review unused-file and unused-package suggestions.', ...configWarnings] };
}
