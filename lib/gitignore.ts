// A small, dependency-free .gitignore matcher. It implements the parts of git's rules that matter for
// choosing which files to analyse: comments, negation (!), directory-only (trailing /), anchoring
// (a leading or inner /), *, ?, [classes], ** and nested .gitignore files whose rules apply below their folder.

type Rule = { re: RegExp; negate: boolean; dirOnly: boolean };
type Source = { base: string; rules: Rule[] };

const MAX_PATTERN = 400;
const escapeRe = (c: string) => c.replace(/[.+^${}()|[\]\\]/g, '\\$&');

/** Translate one glob (already stripped of !, leading / and trailing /) into a regular expression body. */
function globToRegex(glob: string): string {
    let out = '';
    for (let i = 0; i < glob.length; i++) {
        const c = glob[i];
        if (c === '*') {
            if (glob[i + 1] === '*') {
                const before = i === 0 || glob[i - 1] === '/', after = glob[i + 2] === '/' || i + 2 === glob.length;
                if (before && glob[i + 2] === '/') { out += '(?:.*/)?'; i += 2; }
                else if (before && after) { out += '.*'; i += 1; }
                else { out += '[^/]*'; i += 1; }
            } else out += '[^/]*';
        } else if (c === '?') out += '[^/]';
        else if (c === '[') {
            const end = glob.indexOf(']', i + 2);
            if (end < 0) out += '\\[';
            else { const body = glob.slice(i + 1, end).replace(/^[!^]/, '^').replace(/\\/g, '\\\\'); out += `[${body}]`; i = end; }
        } else if (c === '\\' && i + 1 < glob.length) { out += escapeRe(glob[++i]); }
        else out += escapeRe(c);
    }
    return out;
}

export function parseGitignore(text: string): Rule[] {
    const rules: Rule[] = [];
    for (let raw of text.split(/\r?\n/)) {
        if (raw.length > MAX_PATTERN * 2) continue;
        raw = raw.replace(/(?<!\\)[ \t]+$/, ''); // trailing spaces are ignored unless escaped
        if (!raw || raw.startsWith('#')) continue;
        let line = raw, negate = false;
        if (line.startsWith('!')) { negate = true; line = line.slice(1); }
        if (line.startsWith('\\#') || line.startsWith('\\!')) line = line.slice(1);
        const dirOnly = line.endsWith('/');
        if (dirOnly) line = line.slice(0, -1);
        if (!line || line.length > MAX_PATTERN) continue;
        const anchored = line.includes('/');
        if (line.startsWith('/')) line = line.slice(1);
        try {
            const body = globToRegex(line);
            rules.push({ re: new RegExp(anchored ? `^${body}$` : `(?:^|/)${body}$`), negate, dirOnly });
        } catch { /* an unparseable pattern is skipped, as git would warn and ignore it */ }
    }
    return rules;
}

export type Ignore = {
    /** Register the contents of the .gitignore found in `dir` ('' for the project root). */
    add(dir: string, text: string): void;
    /** Whether git would ignore this exact path. Ancestors are not consulted; use `ignoresPath` for a flat list. */
    ignores(path: string, isDir: boolean): boolean;
    /** Like `ignores`, but also true when any parent folder is ignored. For paths that arrive without a directory walk. */
    ignoresPath(path: string): boolean;
    readonly size: number;
};

export function createIgnore(): Ignore {
    const sources: Source[] = [];
    const cache = new Map<string, boolean>();
    const decide = (path: string, isDir: boolean): boolean => {
        let ignored = false;
        for (const s of sources) {
            if (s.base && !path.startsWith(s.base + '/')) continue;
            const rel = s.base ? path.slice(s.base.length + 1) : path;
            for (const r of s.rules) if ((!r.dirOnly || isDir) && r.negate === ignored && r.re.test(rel)) ignored = !r.negate;
        }
        return ignored;
    };
    const self: Ignore = {
        add(dir, text) {
            const rules = parseGitignore(text);
            if (!rules.length) return;
            sources.push({ base: dir, rules });
            sources.sort((a, b) => a.base.split('/').length - b.base.split('/').length || (a.base === b.base ? 0 : a.base < b.base ? -1 : 1));
            cache.clear();
        },
        ignores: (path, isDir) => (sources.length ? decide(path, isDir) : false),
        ignoresPath(path) {
            if (!sources.length) return false;
            const parts = path.split('/');
            let prefix = '';
            for (let i = 0; i < parts.length; i++) {
                prefix = prefix ? `${prefix}/${parts[i]}` : parts[i];
                const isDir = i < parts.length - 1;
                const key = prefix + (isDir ? '/' : '');
                let hit = cache.get(key);
                if (hit === undefined) { hit = decide(prefix, isDir); cache.set(key, hit); }
                if (hit && isDir) return true;
                if (i === parts.length - 1) return hit;
            }
            return false;
        },
        get size() { return sources.reduce((n, s) => n + s.rules.length, 0); },
    };
    return self;
}
