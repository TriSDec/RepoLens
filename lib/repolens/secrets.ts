// Detects credentials committed to source. A hit records only the kind of secret and its line; the
// value itself is never stored, shown, logged or exported.

export type SecretHit = { rule: string; label: string; line: number; severity: 'error' | 'warning' | 'info' };

type Rule = { id: string; label: string; re: RegExp; severity: 'error' | 'warning' | 'info'; check?: (match: RegExpExecArray) => boolean };

const PLACEHOLDER = /example|sample|changeme|change[-_ ]me|your[-_ ]|placeholder|x{4,}|\*{3,}|<[^>]*>|\$\{|\{\{|%s|process\.env|os\.environ|getenv|dummy|fake|todo|redacted|not-needed|replace[-_ ]?me|insert[-_ ]|secret[-_]?key[-_]?here/i;

export function entropy(s: string): number {
    const counts = new Map<string, number>();
    for (const ch of s) counts.set(ch, (counts.get(ch) || 0) + 1);
    let h = 0;
    for (const c of counts.values()) {
        const p = c / s.length;
        h -= p * Math.log2(p);
    }
    return h;
}

// Real secrets are random: they contain digits or symbols. Words, header names and identifiers
// ("Authorization", "tmx-auth-token", "Credential") are letters plus separators only.
const looksRandom = (value: string) =>
    !PLACEHOLDER.test(value) && entropy(value) >= 3 && /[^A-Za-z_.\-]/.test(value) && !/^(https?:|\.{0,2}\/)/.test(value);

const RULES: Rule[] = [
    { id: 'aws-key', label: 'AWS access key ID', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/, severity: 'error', check: m => !PLACEHOLDER.test(m[0]) },
    { id: 'github-token', label: 'GitHub token', re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{50,255})\b/, severity: 'error' },
    { id: 'openai-key', label: 'OpenAI- or Anthropic-style API key', re: /\bsk-(?:proj-|svcacct-|admin-|ant-)?[A-Za-z0-9_-]{32,200}/, severity: 'error', check: m => !PLACEHOLDER.test(m[0]) },
    { id: 'sk-hex-key', label: 'API key (sk_ prefix)', re: /\bsk_[a-f0-9]{40,64}\b/, severity: 'error' },
    { id: 'stripe-live', label: 'Stripe live secret key', re: /\b[sr]k_live_[A-Za-z0-9]{20,99}\b/, severity: 'error' },
    { id: 'stripe-test', label: 'Stripe test secret key', re: /\b[sr]k_test_[A-Za-z0-9]{20,99}\b/, severity: 'info' },
    { id: 'slack-token', label: 'Slack token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,200}/, severity: 'error' },
    { id: 'google-key', label: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}\b/, severity: 'warning' },
    { id: 'private-key', label: 'private key', re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/, severity: 'error' },
    { id: 'jwt', label: 'JSON Web Token', re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, severity: 'warning' },
    { id: 'app-password', label: 'app password', re: /(?:password|passwd|pass)\w{0,20}\s*[:=]\s*["']([a-z]{4}(?: [a-z]{4}){3})["']/i, severity: 'error' },
    {
        id: 'assigned-secret', label: 'hard-coded credential',
        re: /([A-Za-z0-9_.-]{0,30}(?:password|passwd|pwd|secret|api[_-]?key|apikey|access[_-]?token|auth[_-]?token|private[_-]?key|client[_-]?secret|token)[A-Za-z0-9_.-]{0,20})\s*[:=]\s*(["'`])([^"'`\s]{8,120})\2/i,
        severity: 'warning', check: m => looksRandom(m[3]),
    },
];

const PREFILTER = /AKIA|ASIA|gh[pousr]_|github_pat_|sk[-_]|xox[baprs]|AIza|PRIVATE KEY|eyJ|password|passwd|pwd|secret|key|token|pass/i;
const LOW_VALUE_PATH = /(^|\/)(tests?|__tests__|spec|specs|fixtures?|mocks?|examples?|samples?|docs?|demo)\//i;
const MAX_LINE = 2000;
const MAX_HITS = 25;

export function scanSecrets(path: string, text: string): SecretHit[] {
    const hits: SecretHit[] = [];
    const lowValue = LOW_VALUE_PATH.test(path) || /\.(md|mdx|txt|rst)$/i.test(path);
    const lines = text.split('\n');
    for (let i = 0; i < lines.length && hits.length < MAX_HITS; i++) {
        const line = lines[i];
        if (line.length < 8 || line.length > MAX_LINE || !PREFILTER.test(line)) continue;
        for (const rule of RULES) {
            if (lowValue && rule.id === 'assigned-secret') continue;
            const m = rule.re.exec(line);
            if (!m || (rule.check && !rule.check(m))) continue;
            let severity = rule.severity;
            if (lowValue) severity = severity === 'error' ? 'warning' : 'info';
            hits.push({ rule: rule.id, label: rule.label, line: i + 1, severity });
            break; // one finding per line is enough
        }
    }
    return hits;
}
