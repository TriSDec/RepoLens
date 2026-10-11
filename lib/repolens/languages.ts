// Language support beyond JavaScript/TypeScript. Imports are extracted with
// comment-aware pattern matching (no external parsers) and resolved against the
// files that were collected, so analysis stays local, fast, and dependency free.
// JavaScript/TypeScript itself is still parsed with the TypeScript compiler API
// in analyze.ts; this module only tells it which files are "script-like".

export type Lang =
    | 'js' | 'python' | 'java' | 'kotlin' | 'scala' | 'go' | 'rust' | 'c' | 'cpp' | 'csharp'
    | 'ruby' | 'php' | 'dart' | 'swift';

export const LANGUAGE_LABELS: Record<Lang, string> = {
    js: 'JavaScript / TypeScript', python: 'Python', java: 'Java', kotlin: 'Kotlin', scala: 'Scala', go: 'Go',
    rust: 'Rust', c: 'C', cpp: 'C++', csharp: 'C#', ruby: 'Ruby', php: 'PHP', dart: 'Dart', swift: 'Swift',
};

const EXTENSIONS: Record<Lang, string[]> = {
    js: ['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'mts', 'cts', 'vue', 'svelte', 'astro'],
    python: ['py', 'pyi'], java: ['java'], kotlin: ['kt', 'kts'], scala: ['scala'], go: ['go'], rust: ['rs'],
    c: ['c', 'h'], cpp: ['cc', 'cpp', 'cxx', 'hpp', 'hh', 'hxx'], csharp: ['cs'], ruby: ['rb'],
    php: ['php'], dart: ['dart'], swift: ['swift'],
};
const BY_EXT = new Map<string, Lang>();
for (const [lang, exts] of Object.entries(EXTENSIONS) as [Lang, string[]][]) for (const e of exts) BY_EXT.set(e, lang);

export function languageOf(path: string): Lang | null {
    const m = /\.([a-z0-9]+)$/i.exec(path);
    return (m && BY_EXT.get(m[1].toLowerCase())) || null;
}
/** Single-file components whose <script> / frontmatter is analysed as TypeScript. */
export const isSfc = (p: string) => /\.(vue|svelte|astro)$/i.test(p);
export const SOURCE_EXTENSIONS = [...BY_EXT.keys()];

/** Pull the script portions out of Vue / Svelte / Astro files, keeping line numbers aligned. */
export function extractScript(path: string, text: string): string {
    const out: string[] = [];
    const push = (start: number, body: string) => out.push('\n'.repeat(text.slice(0, start).split('\n').length - 1) + body);
    for (const m of text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) push(m.index! + m[0].indexOf('>') + 1, m[1]);
    if (/\.astro$/i.test(path)) {
        const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
        if (fm) push(fm.index + 4, fm[1]);
    }
    return out.join('\n');
}

export type RawImport = { spec: string; line: number; names?: string[] };
export type Resolution = { targets: string[]; external?: string; unresolved?: boolean };

// ---------------------------------------------------------------- text helpers
type Syntax = { line?: string[]; block?: [string, string][]; quotes: string; triple?: boolean };
const SYNTAX: Partial<Record<Lang, Syntax>> = {
    python: { line: ['#'], quotes: '"\'', triple: true },
    ruby: { line: ['#'], block: [['=begin', '=end']], quotes: '"\'' },
    php: { line: ['//', '#'], block: [['/*', '*/']], quotes: '"\'' },
    rust: { line: ['//'], block: [['/*', '*/']], quotes: '"' },
    go: { line: ['//'], block: [['/*', '*/']], quotes: '"`\'' },
    swift: { line: ['//'], block: [['/*', '*/']], quotes: '"' },
};
const CLIKE: Syntax = { line: ['//'], block: [['/*', '*/']], quotes: '"\'' };

/** Blank out comments (and Python docstrings) while keeping offsets and line breaks intact. */
export function stripComments(text: string, lang: Lang): string {
    const syn = SYNTAX[lang] || CLIKE;
    const out = text.split('');
    const blank = (from: number, to: number) => { for (let k = from; k < to && k < out.length; k++) if (out[k] !== '\n') out[k] = ' '; };
    let i = 0;
    const n = text.length;
    while (i < n) {
        const ch = text[i];
        const block = syn.block?.find(([open]) => text.startsWith(open, i) && (open !== '=begin' || i === 0 || text[i - 1] === '\n'));
        if (block) {
            const end = text.indexOf(block[1], i + block[0].length);
            const stop = end < 0 ? n : end + block[1].length;
            blank(i, stop); i = stop; continue;
        }
        const line = syn.line?.find(l => text.startsWith(l, i));
        if (line) {
            let end = text.indexOf('\n', i);
            if (end < 0) end = n;
            blank(i, end); i = end; continue;
        }
        if (syn.quotes.includes(ch)) {
            if (syn.triple && text.startsWith(ch.repeat(3), i)) {
                const end = text.indexOf(ch.repeat(3), i + 3);
                const stop = end < 0 ? n : end + 3;
                blank(i, stop); i = stop; continue;
            }
            let k = i + 1;
            while (k < n && text[k] !== ch && text[k] !== '\n') k += text[k] === '\\' ? 2 : 1;
            // Rust/C-family character literals and lifetimes never span lines; a stray quote stops at the newline.
            i = ch === '`' && text[k] === '`' ? k + 1 : text[k] === ch ? k + 1 : k; continue;
        }
        i++;
    }
    return out.join('');
}

const lineIndex = (text: string) => { const starts = [0]; for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1); return starts; };
const lineAt = (starts: number[], pos: number) => { let lo = 0, hi = starts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= pos) lo = mid; else hi = mid - 1; } return lo + 1; };

function matches(text: string, re: RegExp, map: (m: RegExpExecArray, line: number) => RawImport[] | RawImport | null): RawImport[] {
    const starts = lineIndex(text), out: RawImport[] = [];
    for (const m of text.matchAll(re)) { const r = map(m as RegExpExecArray, lineAt(starts, m.index!)); if (r) out.push(...(Array.isArray(r) ? r : [r])); }
    return out;
}

// ------------------------------------------------------------------ extraction
export function extractImports(lang: Lang, raw: string): RawImport[] {
    const text = stripComments(raw, lang);
    switch (lang) {
        case 'python': return [
            ...matches(text, /^[ \t]*from[ \t]+(\.*[\w.]*)[ \t]+import[ \t]+(\([^)]*\)|[^\n;\\]*)/gm, (m, line) => ({ spec: m[1], line, names: m[2].replace(/[()]/g, '').split(',').map(s => s.trim().split(/\s+as\s+/)[0]).filter(s => /^\w+$/.test(s)) })),
            ...matches(text, /^[ \t]*import[ \t]+([\w.]+(?:[ \t]+as[ \t]+\w+)?(?:[ \t]*,[ \t]*[\w.]+(?:[ \t]+as[ \t]+\w+)?)*)/gm, (m, line) => m[1].split(',').map(s => ({ spec: s.trim().split(/\s+as\s+/)[0], line }))),
        ];
        case 'java': case 'kotlin': case 'scala':
            return matches(text, /^[ \t]*import[ \t]+(?:static[ \t]+)?([\w.]+(?:\.(?:\*|_))?)(?:[ \t]+as[ \t]+\w+)?[ \t]*;?[ \t]*$/gm, (m, line) => ({ spec: m[1].replace(/\._$/, '.*'), line }));
        case 'go': {
            const out: RawImport[] = [];
            const starts = lineIndex(text);
            for (const m of text.matchAll(/^[ \t]*import[ \t]*(?:\(([\s\S]*?)\)|(?:[\w.]+[ \t]+)?"([^"]+)")/gm)) {
                if (m[2]) { out.push({ spec: m[2], line: lineAt(starts, m.index!) }); continue; }
                const base = m.index! + m[0].indexOf('(') + 1;
                for (const q of m[1].matchAll(/"([^"]+)"/g)) out.push({ spec: q[1], line: lineAt(starts, base + q.index!) });
            }
            return out;
        }
        case 'rust': {
            const out = matches(text, /^[ \t]*(?:pub(?:\([^)]*\))?[ \t]+)?mod[ \t]+(\w+)[ \t]*;/gm, (m, line) => ({ spec: 'mod:' + m[1], line }));
            const starts = lineIndex(text);
            for (const m of text.matchAll(/^[ \t]*(?:pub(?:\([^)]*\))?[ \t]+)?use[ \t]+([^;]+);/gm))
                for (const p of expandRustUse(m[1].replace(/\s+/g, ' ').trim())) out.push({ spec: p, line: lineAt(starts, m.index!) });
            for (const m of text.matchAll(/^[ \t]*extern[ \t]+crate[ \t]+(\w+)/gm)) out.push({ spec: m[1], line: lineAt(starts, m.index!) });
            return out;
        }
        case 'swift': return swiftImports(raw);
        case 'c': case 'cpp':
            return matches(text, /^[ \t]*#[ \t]*(?:include|import)[ \t]*([<"])([^>"]+)[>"]/gm, (m, line) => ({ spec: (m[1] === '<' ? '<' : '"') + m[2], line }));
        case 'csharp':
            return matches(text, /^[ \t]*(?:global[ \t]+)?using[ \t]+(?:static[ \t]+)?(?:\w+[ \t]*=[ \t]*)?([\w.]+)[ \t]*;/gm, (m, line) => ({ spec: m[1], line }));
        case 'ruby':
            return matches(text, /^[ \t]*(require_relative|require|load)[ \t(]*['"]([^'"]+)['"]/gm, (m, line) => ({ spec: (m[1] === 'require' ? '' : './') + m[2], line }));
        case 'php': return [
            ...matches(text, /^[ \t]*(?:require|include)(?:_once)?[ \t(]*(__DIR__[ \t]*\.[ \t]*)?['"]([^'"]+)['"]/gm, (m, line) => ({ spec: (m[1] || m[2].startsWith('.') ? './' : '') + m[2].replace(/^\//, ''), line })),
            ...matches(text, /^[ \t]*use[ \t]+(?:function[ \t]+|const[ \t]+)?([\w\\]+?)(?:\\\{([^}]+)\})?(?:[ \t]+as[ \t]+\w+)?[ \t]*;/gm, (m, line) => m[2] ? m[2].split(',').map(s => ({ spec: 'ns:' + m[1] + '\\' + s.trim().split(/\s+as\s+/)[0], line })) : { spec: 'ns:' + m[1], line }),
        ];
        case 'dart':
            return matches(text, /^[ \t]*(?:import|export|part)[ \t]+['"]([^'"]+)['"]/gm, (m, line) => ({ spec: m[1], line }));
        default: return [];
    }
}
function swiftImports(raw: string): RawImport[] {
    return matches(stripComments(raw, 'swift'), /^[ \t]*(?:@\w+[ \t]+)*import[ \t]+(?:(?:struct|class|enum|protocol|func|var|let|typealias)[ \t]+)?(\w+)/gm, (m, line) => ({ spec: m[1], line }));
}

/** Expand `a::{b, c::d}` into flat paths. Pure text; handles nesting. */
export function expandRustUse(src: string): string[] {
    src = src.trim();
    const brace = src.indexOf('{');
    if (brace < 0) return [src.replace(/::\*$/, '').replace(/ as \w+$/, '').trim()];
    const prefix = src.slice(0, brace).trim().replace(/::$/, '');
    let depth = 0, start = brace + 1; const parts: string[] = [];
    for (let i = brace; i < src.length; i++) {
        const c = src[i];
        if (c === '{') depth++;
        else if (c === '}') { depth--; if (depth === 0) { parts.push(src.slice(start, i)); break; } }
        else if (c === ',' && depth === 1) { parts.push(src.slice(start, i)); start = i + 1; }
    }
    return parts.map(p => p.trim()).filter(Boolean).flatMap(p => expandRustUse(p === 'self' ? prefix : prefix ? prefix + '::' + p : p));
}

// ------------------------------------------------------------------ resolution
const PY_STDLIB = new Set('__future__ abc argparse array ast asyncio atexit base64 bisect builtins bz2 calendar cmath codecs collections colorsys concurrent configparser contextlib contextvars copy csv ctypes dataclasses datetime decimal difflib dis email encodings enum errno faulthandler fcntl filecmp fileinput fnmatch fractions ftplib functools gc getopt getpass gettext glob gzip hashlib heapq hmac html http imaplib importlib inspect io ipaddress itertools json keyword linecache locale logging lzma mailbox math mimetypes mmap msvcrt multiprocessing numbers operator os pathlib pdb pickle pkgutil platform plistlib poplib pprint profile pstats pty pwd queue quopri random re readline reprlib resource sched secrets select selectors shelve shlex shutil signal site smtplib socket socketserver sqlite3 ssl stat statistics string struct subprocess sys sysconfig syslog tarfile tempfile termios textwrap threading time timeit tkinter token tokenize tomllib trace traceback tracemalloc tty turtle types typing unicodedata unittest urllib uuid venv warnings wave weakref webbrowser winreg winsound wsgiref xml xmlrpc zipapp zipfile zipimport zlib zoneinfo'.split(' '));
const RUBY_STDLIB = new Set('set json yaml date time fileutils pathname tempfile securerandom digest open3 optparse logger erb csv uri net benchmark forwardable ostruct stringio timeout bigdecimal singleton observer monitor English strscan zlib socket openssl'.split(' '));
const SWIFT_BUILTIN = new Set('Foundation UIKit SwiftUI AppKit Combine CoreData CoreGraphics CoreLocation MapKit AVFoundation WebKit XCTest Swift Dispatch os Darwin Glibc SpriteKit SceneKit GameplayKit Metal StoreKit UserNotifications Network Security CloudKit'.split(' '));
const RUST_BUILTIN = new Set(['std', 'core', 'alloc', 'proc_macro', 'test']);
const JVM_BUILTIN = /^(java|javax|jdk|kotlin|kotlinx\.coroutines|scala|sun|android|androidx)\./;

const dirOf = (p: string) => p.slice(0, Math.max(0, p.lastIndexOf('/')));
const baseOf = (p: string) => p.slice(p.lastIndexOf('/') + 1);
const stemOf = (p: string) => baseOf(p).replace(/\.[^.]+$/, '');
const join = (...parts: string[]) => { const out: string[] = []; for (const part of parts.join('/').split('/')) { if (part === '..') out.pop(); else if (part && part !== '.') out.push(part); } return out.join('/'); };

export type LanguageContext = {
    imports(path: string, text: string): RawImport[];
    resolve(from: string, imp: RawImport): Resolution;
    /** Files that implicitly see each other without imports (Go packages, Java packages, C# namespaces). */
    group(path: string): string | undefined;
    isEntry(path: string, text: string | undefined): boolean;
};

export function createLanguageContext(files: { path: string; content?: string }[]): LanguageContext {
    const paths = new Set(files.map(f => f.path));
    const byBase = new Map<string, string[]>(); // lowercase basename -> paths, for suffix lookups
    for (const p of paths) { const k = baseOf(p).toLowerCase(); const l = byBase.get(k); if (l) l.push(p); else byBase.set(k, [p]); }

    // Package / namespace indexes -------------------------------------------------
    const jvmClass = new Map<string, string>();      // fully-qualified name -> file
    const jvmPackage = new Map<string, string[]>();   // package -> files
    const csNamespace = new Map<string, string[]>();  // namespace -> files
    const pkgOf = new Map<string, string>();          // file -> package / namespace / go dir (for implicit groups)
    const goModules: { dir: string; module: string }[] = [];
    const goDirs = new Map<string, string[]>();
    const dartPackages: { dir: string; name: string }[] = [];
    const push = <K,>(m: Map<K, string[]>, k: K, v: string) => { const l = m.get(k); if (l) l.push(v); else m.set(k, [v]); };
    for (const { path, content } of files) {
        const lang = languageOf(path);
        if (/(^|\/)go\.mod$/.test(path) && content) { const m = /^module\s+(\S+)/m.exec(content); if (m) goModules.push({ dir: dirOf(path), module: m[1] }); }
        if (/(^|\/)pubspec\.yaml$/.test(path) && content) { const m = /^name:\s*(\S+)/m.exec(content); if (m) dartPackages.push({ dir: dirOf(path), name: m[1] }); }
        if (content === undefined || !lang) continue;
        if (lang === 'java' || lang === 'kotlin' || lang === 'scala') {
            const pkg = /^[ \t]*package[ \t]+([\w.]+)/m.exec(content)?.[1];
            if (pkg) { jvmClass.set(pkg + '.' + stemOf(path), path); push(jvmPackage, pkg, path); pkgOf.set(path, 'jvm:' + pkg); }
        } else if (lang === 'csharp') {
            for (const m of content.matchAll(/^[ \t]*namespace[ \t]+([\w.]+)/gm)) { push(csNamespace, m[1], path); pkgOf.set(path, 'cs:' + m[1]); }
        } else if (lang === 'go') {
            push(goDirs, dirOf(path), path); pkgOf.set(path, 'go:' + dirOf(path));
        }
    }
    goModules.sort((a, b) => b.dir.length - a.dir.length);

    const exists = (p: string) => paths.has(p) ? p : undefined;
    const firstExisting = (cands: string[]) => cands.find(c => paths.has(c));
    const suffixMatch = (suffix: string, near: string, ci = false): string | undefined => {
        const s = ci ? suffix.toLowerCase() : suffix;
        const hits = (byBase.get(baseOf(s)) || []).filter(p => { const q = ci ? p.toLowerCase() : p; return q === s || q.endsWith('/' + s); });
        if (hits.length <= 1) return hits[0];
        const score = (p: string) => { let n = 0; while (n < p.length && p[n] === near[n]) n++; return n; };
        return hits.sort((a, b) => score(b) - score(a) || a.length - b.length)[0];
    };

    // Python ----------------------------------------------------------------------
    const pyModule = (base: string, mod: string): string | undefined => {
        const p = join(base, mod.replace(/\./g, '/'));
        return firstExisting([p + '.py', p + '/__init__.py', p + '.pyi']);
    };
    const pyRoots = (from: string) => { const roots = ['']; let d = dirOf(from); const chain: string[] = []; while (d) { chain.push(d); d = dirOf(d); } roots.push(...chain.reverse(), 'src', 'lib'); return roots; };
    const resolvePython = (from: string, imp: RawImport): Resolution => {
        const m = /^(\.*)(.*)$/.exec(imp.spec)!; const dots = m[1].length, mod = m[2];
        if (dots) {
            let base = dirOf(from);
            for (let i = 1; i < dots; i++) base = dirOf(base);
            const head = mod ? pyModule(base, mod) : exists(join(base, '__init__.py'));
            const subs = (imp.names || []).map(n => pyModule(join(base, mod.replace(/\./g, '/')), n)).filter((s): s is string => !!s);
            const targets = subs.length ? subs : head ? [head] : [];
            return targets.length ? { targets: [...new Set(targets)] } : { targets: [], unresolved: true };
        }
        const top = mod.split('.')[0];
        for (const root of pyRoots(from)) {
            const found = pyModule(root, mod);
            if (found) {
                const targets = new Set([found]);
                for (const n of imp.names || []) { const sub = pyModule(root, mod + '.' + n); if (sub) { targets.add(sub); if (/__init__\.pyi?$/.test(found)) targets.delete(found); } }
                return { targets: [...targets] };
            }
            // `import pkg.sub` when only the package __init__ exists
            const partial = mod.split('.');
            for (let k = partial.length - 1; k >= 1; k--) { const f = pyModule(root, partial.slice(0, k).join('.')); if (f) return { targets: [f] }; }
        }
        return PY_STDLIB.has(top) ? { targets: [] } : { targets: [], external: top };
    };

    // JVM / C# --------------------------------------------------------------------
    const resolveJvm = (spec: string): Resolution => {
        if (spec.endsWith('.*')) { const files = jvmPackage.get(spec.slice(0, -2)); if (files) return { targets: files }; }
        else for (let parts = spec.split('.'); parts.length > 1; parts.pop()) { const f = jvmClass.get(parts.join('.')); if (f) return { targets: [f] }; }
        if (JVM_BUILTIN.test(spec)) return { targets: [] };
        return { targets: [], external: spec.split('.').slice(0, 2).join('.') };
    };
    const resolveCsharp = (spec: string): Resolution => {
        for (let parts = spec.split('.'); parts.length; parts.pop()) { const f = csNamespace.get(parts.join('.')); if (f) return { targets: f }; }
        return /^System(\.|$)/.test(spec) ? { targets: [] } : { targets: [], external: spec.split('.').slice(0, 2).join('.') };
    };

    // Go --------------------------------------------------------------------------
    const resolveGo = (from: string, spec: string): Resolution => {
        const pkgFiles = (dir: string) => (goDirs.get(dir) || []).filter(f => !f.endsWith('_test.go'));
        for (const { dir, module } of goModules) {
            if (spec === module || spec.startsWith(module + '/')) {
                const files = pkgFiles(join(dir, spec.slice(module.length)));
                return files.length ? { targets: files } : { targets: [], unresolved: true };
            }
        }
        if (!goModules.length) { // no go.mod collected: match the import's tail against directories
            const segs = spec.split('/');
            for (let i = 0; i < segs.length; i++) {
                const tail = segs.slice(i).join('/');
                const dir = [...goDirs.keys()].find(d => d === tail || d.endsWith('/' + tail));
                if (dir && dir !== dirOf(from)) return { targets: pkgFiles(dir) };
            }
        }
        return spec.split('/')[0].includes('.') ? { targets: [], external: spec.split('/').slice(0, 3).join('/') } : { targets: [] };
    };

    // Rust ------------------------------------------------------------------------
    const crateRoot = (from: string) => { let d = dirOf(from); for (;;) { if (paths.has(join(d, 'lib.rs')) || paths.has(join(d, 'main.rs'))) return d; if (!d) return ''; d = dirOf(d); } };
    const modDir = (file: string) => /(^|\/)(mod|lib|main)\.rs$/.test(file) ? dirOf(file) : join(dirOf(file), stemOf(file));
    const rustModule = (dir: string, segs: string[]): string | undefined => {
        for (let k = segs.length; k >= 1; k--) {
            const base = join(dir, ...segs.slice(0, k));
            const f = firstExisting([base + '.rs', base + '/mod.rs']);
            if (f) return f;
        }
        return undefined;
    };
    const resolveRust = (from: string, spec: string): Resolution => {
        if (spec.startsWith('mod:')) {
            const f = rustModule(modDir(from), [spec.slice(4)]);
            return f ? { targets: [f] } : { targets: [], unresolved: true };
        }
        const segs = spec.split('::').filter(Boolean);
        const root = crateRoot(from);
        if (segs[0] === 'crate') { const f = rustModule(root, segs.slice(1)); return f ? { targets: [f] } : { targets: [] }; }
        if (segs[0] === 'self') { const f = rustModule(modDir(from), segs.slice(1)); return f ? { targets: [f] } : { targets: [] }; }
        if (segs[0] === 'super') {
            let d = modDir(from), i = 0;
            while (segs[i] === 'super') { d = dirOf(d); i++; }
            const f = rustModule(d, segs.slice(i)) || (paths.has(join(d, 'mod.rs')) ? join(d, 'mod.rs') : undefined);
            return f ? { targets: [f] } : { targets: [] };
        }
        if (RUST_BUILTIN.has(segs[0])) return { targets: [] };
        const local = rustModule(modDir(from), segs) || rustModule(root, segs);
        return local ? { targets: [local] } : { targets: [], external: segs[0].replace(/_/g, '-') };
    };

    // C / C++ ---------------------------------------------------------------------
    const INCLUDE_DIRS = ['', 'include', 'inc', 'src', 'lib'];
    const resolveInclude = (from: string, spec: string): Resolution => {
        const angle = spec[0] === '<', name = spec.slice(1);
        const found = (!angle && exists(join(dirOf(from), name))) || firstExisting(INCLUDE_DIRS.map(d => join(d, name))) || (name.includes('/') || !angle ? suffixMatch(name, from) : undefined);
        if (found && found !== from) return { targets: [found] };
        return angle ? { targets: [] } : { targets: [], unresolved: true };
    };

    // Ruby / PHP / Dart ------------------------------------------------------------
    const resolveRuby = (from: string, spec: string): Resolution => {
        const rel = spec.startsWith('./');
        const name = spec.replace(/^\.\//, '').replace(/\.rb$/, '');
        const found = rel ? exists(join(dirOf(from), name + '.rb')) : firstExisting(['lib', 'app', '', 'src'].map(d => join(d, name + '.rb')));
        if (found) return { targets: [found] };
        return rel ? { targets: [], unresolved: true } : RUBY_STDLIB.has(name.split('/')[0]) ? { targets: [] } : { targets: [], external: name.split('/')[0] };
    };
    const resolvePhp = (from: string, spec: string): Resolution => {
        if (spec.startsWith('ns:')) {
            const segs = spec.slice(3).split('\\').filter(Boolean);
            for (let i = 0; i < segs.length; i++) { const hit = suffixMatch(segs.slice(i).join('/') + '.php', from, true); if (hit) return { targets: [hit] }; }
            return { targets: [], external: segs[0] };
        }
        const name = spec.replace(/^\.\//, '');
        const found = exists(join(dirOf(from), name)) || exists(name);
        return found ? { targets: [found] } : { targets: [], unresolved: true };
    };
    const resolveDart = (from: string, spec: string): Resolution => {
        if (spec.startsWith('dart:')) return { targets: [] };
        if (spec.startsWith('package:')) {
            const [name, ...rest] = spec.slice(8).split('/');
            const pkg = dartPackages.find(p => p.name === name);
            if (!pkg) return { targets: [], external: name };
            const f = exists(join(pkg.dir, 'lib', ...rest));
            return f ? { targets: [f] } : { targets: [], unresolved: true };
        }
        const f = exists(join(dirOf(from), spec));
        return f ? { targets: [f] } : { targets: [], unresolved: true };
    };

    return {
        imports(path, content) {
            const lang = languageOf(path);
            if (!lang || lang === 'js') return [];
            return lang === 'swift' ? swiftImports(content) : extractImports(lang, content);
        },
        resolve(from, imp) {
            switch (languageOf(from)) {
                case 'python': return resolvePython(from, imp);
                case 'java': case 'kotlin': case 'scala': return resolveJvm(imp.spec);
                case 'csharp': return resolveCsharp(imp.spec);
                case 'go': return resolveGo(from, imp.spec);
                case 'rust': return resolveRust(from, imp.spec);
                case 'c': case 'cpp': return resolveInclude(from, imp.spec);
                case 'ruby': return resolveRuby(from, imp.spec);
                case 'php': return resolvePhp(from, imp.spec);
                case 'dart': return resolveDart(from, imp.spec);
                case 'swift': return SWIFT_BUILTIN.has(imp.spec) ? { targets: [] } : { targets: [], external: imp.spec };
                default: return { targets: [] };
            }
        },
        group: path => pkgOf.get(path),
        isEntry(path, content) {
            const name = baseOf(path), lang = languageOf(path), body = content || '';
            const inTests = /(^|\/)(tests?|spec|__tests__|examples?|benches|scripts?|bin|cmd)\//.test(path);
            switch (lang) {
                case 'python': return /^(__main__|main|app|manage|wsgi|asgi|setup|conftest|cli|run|server)\.py$|^test_.*\.py$|_test\.py$/.test(name) || inTests || /if\s+__name__\s*==\s*['"]__main__['"]/.test(body);
                case 'java': case 'kotlin': case 'scala': return /static\s+void\s+main\s*\(|fun\s+main\s*\(|def\s+main\s*\(|extends\s+App\b|@(SpringBootApplication|Test|RestController|Controller|Component|Service|Configuration|Entity)\b/.test(body) || /(Test|Tests|Spec|Application)\.\w+$/.test(name) || /(^|\/)src\/test\//.test(path);
                case 'go': return /^package\s+main\b/m.test(body) || name.endsWith('_test.go') || inTests;
                case 'rust': return /^(main|lib|build)\.rs$/.test(name) || /(^|\/)(bin|tests|benches|examples)\//.test(path);
                case 'c': case 'cpp': return /\bint\s+main\s*\(|\bWinMain\s*\(/.test(body) || /(^|\/)(tests?|examples?)\//.test(path);
                case 'csharp': return /^(Program|Startup)\.cs$/.test(name) || /static\s+(async\s+)?(void|int|Task(<int>)?)\s+Main\s*\(/.test(body) || /(Tests?)\.cs$/.test(name) || /\[(Fact|Test|TestMethod|ApiController)\]/.test(body);
                case 'ruby': return /(^|\/)(bin|spec|test|db|config|app|exe)\//.test(path) || /^(Rakefile|config\.ru|.*_spec\.rb|.*_test\.rb)$/.test(name);
                case 'php': return /^(index|artisan|server|console)\.php$/.test(name) || /(^|\/)(public|tests?|bin|routes|config|database)\//.test(path);
                case 'dart': return /(^|\/)(main\.dart)$/.test(path) || /(^|\/)(bin|test|example|tool)\//.test(path) || /\bvoid\s+main\s*\(/.test(body);
                case 'swift': return /^(main|.*App|AppDelegate|.*Tests)\.swift$/.test(name) || /@main\b/.test(body);
                default: return false;
            }
        },
    };
}
