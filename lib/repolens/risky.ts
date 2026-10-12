// A small set of well-known risky constructs. These are review prompts, not vulnerability verdicts:
// each one is sometimes the right tool. Matching runs on comment-stripped text.
import { stripComments, type Lang } from './languages';

export type RiskyRule = { id: string; label: string; why: string; fix: string; severity: 'warning' | 'info'; langs: Lang[]; re: RegExp };
export type RiskyHit = { rule: RiskyRule; line: number; count: number };

const R = (id: string, label: string, severity: 'warning' | 'info', langs: Lang[], re: RegExp, why: string, fix: string): RiskyRule =>
    ({ id, label, severity, langs, re, why, fix });

export const RISKY_RULES: RiskyRule[] = [
    R('eval', 'Dynamic code evaluation', 'warning', ['js', 'python', 'php', 'ruby'], /(?<![.\w$])eval\s*\(|\b(?:window|globalThis|self)\.eval\s*\(|\bnew\s+Function\s*\(/,
        'Evaluating strings as code executes whatever the string contains, which turns any untrusted input into remote code execution.',
        'Parse data with JSON.parse / ast.literal_eval, or dispatch through a lookup table of allowed operations.'),
    R('inner-html', 'Raw HTML injection', 'warning', ['js'], /\bdangerouslySetInnerHTML\b|\.innerHTML\s*=|\.outerHTML\s*=|document\.write\s*\(|\bv-html\b|\{@html\b/,
        'Inserting unescaped strings as HTML allows cross-site scripting when any part comes from a user or a third party.',
        'Render text with textContent or your framework’s default escaping; if HTML is required, sanitise it with a vetted library first.'),
    R('shell-js', 'Shell command execution', 'warning', ['js'], /\bchild_process\b[\s\S]{0,400}?\bexec(?:Sync)?\s*\(|\bexec(?:Sync)?\s*\(\s*[`"'][^`"']*(?:\$\{|["']\s*\+)/,
        'Building a shell command from variables lets crafted input run extra commands.',
        'Use execFile / spawn with an argument array and no shell.'),
    R('py-exec', 'Python code or command execution', 'warning', ['python'], /\bos\.system\s*\(|\bsubprocess\.\w+\([^)]*shell\s*=\s*True|(?<![.\w])exec\s*\(/,
        'Shell strings and exec() run arbitrary commands or code when any part of them is attacker-influenced.',
        'Pass an argument list to subprocess with shell=False.'),
    R('unsafe-deserialize', 'Unsafe deserialization', 'warning', ['python', 'php', 'ruby', 'java', 'csharp'],
        /\bpickle\.loads?\s*\(|\byaml\.load\s*\((?![^)]*Loader)|\bunserialize\s*\(|\bMarshal\.load\b|\bnew\s+ObjectInputStream\b|\bBinaryFormatter\b/,
        'Deserializing untrusted bytes can instantiate arbitrary objects and execute code.',
        'Use a data-only format (JSON) or a safe loader (yaml.safe_load), and never deserialize untrusted input.'),
    R('tls-off', 'TLS verification disabled', 'warning', ['python', 'go', 'js', 'java', 'csharp'],
        /\bverify\s*=\s*False\b|InsecureSkipVerify\s*:\s*true|rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*["']?0|ServerCertificateValidationCallback\s*\+?=\s*\(.*\)\s*=>\s*true/,
        'Skipping certificate checks makes connections open to interception.',
        'Trust the proper CA bundle instead of disabling verification.'),
    R('weak-hash', 'Weak hash algorithm', 'info', ['python', 'java', 'js', 'php', 'csharp'],
        /\bhashlib\.(?:md5|sha1)\s*\(|MessageDigest\.getInstance\(\s*"(?:MD5|SHA-?1)"|createHash\(\s*["'](?:md5|sha1)["']|\bmd5\s*\(|\bsha1\s*\(|\bMD5\.Create\b/,
        'MD5 and SHA-1 are broken for security purposes such as passwords or signatures.',
        'Use SHA-256 or better; use a password hash (argon2, bcrypt, scrypt) for passwords.'),
    R('php-exec', 'Shell execution (PHP)', 'warning', ['php'], /\b(?:shell_exec|passthru|system|popen|proc_open)\s*\(/,
        'Running shell commands built from variables allows command injection.', 'Avoid the shell or strictly validate and escape every argument (escapeshellarg).'),
    R('ruby-exec', 'Shell execution or unsafe HTML (Ruby)', 'warning', ['ruby'], /\bsystem\s*\(|`[^`\n]*#\{|\.html_safe\b/,
        'Interpolating into shell commands or marking strings html_safe bypasses built-in protections.', 'Pass arguments separately and let the framework escape output.'),
    R('c-unsafe', 'Unbounded C string function', 'warning', ['c', 'cpp'], /\b(?:gets|strcpy|strcat|sprintf|vsprintf)\s*\(/,
        'These functions write without checking the buffer size, a classic source of memory-corruption bugs.', 'Use bounded variants (fgets, snprintf, strncpy with explicit termination) or std::string.'),
    R('csharp-process', 'Process execution (C#)', 'info', ['csharp'], /\bProcess\.Start\s*\(/,
        'Starting processes from variable input allows command injection.', 'Validate arguments and avoid shell execution.'),
];

const MAX_LINE = 4000;

/** `repolens-ignore` in a comment on the same or the previous line silences a finding that has been reviewed. */
const suppressed = (raw: string[] | null, i: number) => !!raw && (/repolens-ignore/.test(raw[i] ?? '') || /repolens-ignore/.test(raw[i - 1] ?? ''));

/** True when `index` falls inside a quoted string on this line (a cheap per-line check that ignores escaped quotes). */
function insideString(line: string, index: number): boolean {
    let quote = '';
    for (let k = 0; k < index; k++) {
        const c = line[k];
        if (quote) { if (c === '\\') k++; else if (c === quote) quote = ''; }
        else if (c === '"' || c === "'" || c === '`') quote = c;
    }
    return quote !== '';
}

export function scanRisky(text: string, lang: Lang): RiskyHit[] {
    // Cheap pre-check on the raw text: stripping comments is the expensive part, and most files match no rule at all.
    const rules = RISKY_RULES.filter(r => r.langs.includes(lang) && r.re.test(text.length > 400_000 ? text.slice(0, 400_000) : text));
    if (!rules.length) return [];
    const clean = stripComments(text, lang);
    const lines = clean.split('\n'), raw = text.includes('repolens-ignore') ? text.split('\n') : null;
    const hits: RiskyHit[] = [];
    for (const rule of rules) {
        let first = 0, count = 0;
        if (rule.re.source.includes('[\\s\\S]')) { // multi-line rules run against the whole text
            const m = rule.re.exec(clean.length > 400_000 ? clean.slice(0, 400_000) : clean);
            if (m) { count = 1; first = clean.slice(0, m.index).split('\n').length; }
        } else {
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].length > MAX_LINE) continue;
                const m = rule.re.exec(lines[i]);
                if (!m) continue;
                if (lang === 'js' && insideString(lines[i], m.index)) continue; // the text of a string or fixture is not code that runs
                if (suppressed(raw, i)) continue;
                if (!first) first = i + 1;
                count++;
            }
        }
        if (count) hits.push({ rule, line: first, count });
    }
    return hits;
}
