import { stripComments, type Lang } from './languages';

const TEST_PATH = [
    /(^|\/)(tests?|__tests__|specs?|e2e|cypress|playwright|integration[-_]tests?)\//i,
    /\.(test|spec|e2e)\.[cm]?[jt]sx?$/i,
    /(^|\/)test_[^/]+\.py$|_test\.(py|go|rb|dart|swift|cpp|cc|c)$/i,
    /(^|\/)src\/test\//,
    /(Tests?|Spec|IT)\.(java|kt|scala|cs|swift)$/,
    /_spec\.rb$/,
    /(^|\/)[\w.-]+\.Tests?\//,
    /(^|\/)conftest\.py$/,
];
export const isTestPath = (path: string) => TEST_PATH.some(re => re.test(path));

const BRANCH_COMMON = /\b(?:if|for|while|case|catch|foreach|elif|except|when|unless|until|rescue)\b|&&|\|\||\?\?/g;
const BRANCH_WORDS = /\b(?:and|or)\b/g;

const FUNCTION_DEF: Partial<Record<Lang, RegExp>> = {
    python: /^[ \t]*(?:async[ \t]+)?def[ \t]+(\w+)/gm,
    go: /^func[ \t]+(?:\([^)]*\)[ \t]*)?(\w+)/gm,
    rust: /\bfn[ \t]+(\w+)/g,
    kotlin: /\bfun[ \t]+(?:<[^>]*>[ \t]*)?(?:[\w.]+\.)?(\w+)/g,
    scala: /\bdef[ \t]+(\w+)/g,
    ruby: /^[ \t]*def[ \t]+(?:self\.)?(\w+[?!=]?)/gm,
    php: /\bfunction[ \t]+&?(\w+)/g,
    swift: /\bfunc[ \t]+(\w+)/g,
    dart: /^[ \t]*(?:static[ \t]+)?(?:[\w<>?]+[ \t]+)(\w+)[ \t]*\([^;{}]*\)[ \t]*(?:async[ \t]*)?\{/gm,
    java: /^[ \t]*(?:(?:public|private|protected|static|final|abstract|synchronized|default)[ \t]+)*(?:[\w<>\[\],.?]+[ \t]+)(\w+)[ \t]*\([^;{}()]*\)[ \t]*(?:throws[ \t]+[\w, .]+)?\{/gm,
    csharp: /^[ \t]*(?:(?:public|private|protected|internal|static|virtual|override|async|abstract|sealed)[ \t]+)*(?:[\w<>\[\],.?]+[ \t]+)(\w+)[ \t]*\([^;{}()]*\)[ \t]*\{/gm,
    c: /^[ \t]*(?:(?:static|inline|extern|const|unsigned|struct)[ \t]+)*(?:[\w*]+[ \t]+)+\**(\w+)[ \t]*\([^;{}()]*\)[ \t]*\{/gm,
    cpp: /^[ \t]*(?:(?:static|inline|virtual|constexpr|const|unsigned|struct)[ \t]+)*(?:[\w:<>*&]+[ \t]+)+[*&]*(?:\w+::)?(\w+)[ \t]*\([^;{}()]*\)[ \t]*(?:const[ \t]*)?(?:noexcept[ \t]*)?\{/gm,
};
const NOT_FUNCTIONS = new Set(['if', 'for', 'while', 'switch', 'catch', 'else', 'return', 'new', 'sizeof', 'using', 'lock', 'foreach', 'when']);

/** Rough size of the logic in a non-JavaScript file: branch points and function count. */
export function estimateComplexity(text: string, lang: Lang): { complexity: number; functions: number } {
    if (lang === 'js') return { complexity: 0, functions: 0 };
    const clean = stripComments(text.length > 600_000 ? text.slice(0, 600_000) : text, lang);
    let complexity = (clean.match(BRANCH_COMMON) || []).length;
    if (lang === 'python' || lang === 'ruby') complexity += (clean.match(BRANCH_WORDS) || []).length;
    let functions = 0;
    const def = FUNCTION_DEF[lang];
    if (def) for (const m of clean.matchAll(def)) if (!NOT_FUNCTIONS.has(m[1])) functions++;
    return { complexity: complexity + functions, functions };
}
