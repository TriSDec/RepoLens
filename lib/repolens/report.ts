import { prettyBytes, trace, type Report } from './types';

/** Make a path safe to drop inside a Markdown code span or table cell. */
const code = (s: string) => '`' + s.replace(/[`\r\n|]/g, ' ') + '`';
const text = (s: string) => s.replace(/[\r\n]+/g, ' ').replace(/[|<>]/g, c => ({ '|': '\\|', '<': '&lt;', '>': '&gt;' })[c]!);

/** Human-readable summary of a report. Contains paths and findings only, never source text or secret values. */
export function toMarkdown(report: Report, options: { maxFindings?: number } = {}): string {
    const limit = options.maxFindings ?? 100;
    const unique = new Set(report.edges.map(e => e.from + '\0' + e.to)).size;
    const byId = new Map(report.findings.map(f => [f.id, f]));
    const out: string[] = [
        `# RepoLens report: ${text(report.name)}`, '',
        `**Health ${report.health.score}/100 (grade ${report.health.grade})**`, '',
        `- ${report.nodes.length} files · ${unique} connections · ${report.lines.toLocaleString('en-US')} lines · ${prettyBytes(report.bytes)}`,
        `- ${report.findings.filter(f => f.severity === 'error').length} errors · ${report.findings.filter(f => f.severity === 'warning').length} warnings · ${report.findings.filter(f => f.severity === 'info').length} review suggestions`,
        `- ${report.testFiles} test file${report.testFiles === 1 ? '' : 's'} detected · analysed in ${report.duration} ms · ${report.skipped} files skipped`, '',
    ];
    if (report.fixFirst.length) {
        out.push('## Fix first', '');
        report.fixFirst.forEach((id, i) => { const f = byId.get(id); if (f) out.push(`${i + 1}. **${text(f.title)}** (${f.severity}): ${text(f.detail)}`); });
        out.push('');
    }
    out.push('## Score breakdown', '', '| Factor | Penalty | Detail |', '| --- | ---: | --- |');
    for (const f of report.health.factors.filter(f => f.penalty > 0)) out.push(`| ${text(f.label)} | -${f.penalty} | ${text(f.detail)} |`);
    out.push('');
    if (report.languages.length) {
        out.push('## Languages', '', '| Language | Files | Lines |', '| --- | ---: | ---: |');
        for (const l of report.languages) out.push(`| ${text(l.label)} | ${l.files} | ${l.lines.toLocaleString('en-US')} |`);
        out.push('');
    }
    const hot = [...report.nodes].filter(n => n.risk > 0).sort((a, b) => b.risk - a.risk).slice(0, 10);
    if (hot.length) {
        out.push('## Riskiest files to change', '', '| File | Risk | Dependents | Complexity | Tested |', '| --- | ---: | ---: | ---: | :---: |');
        for (const n of hot) out.push(`| ${code(n.id)} | ${n.risk} | ${n.influence} | ${n.worst ? n.worst.complexity : n.complexity} | ${n.tested ? 'yes' : 'no'} |`);
        out.push('');
    }
    const hubs = [...report.nodes].filter(n => n.importedBy > 0).sort((a, b) => b.importedBy - a.importedBy).slice(0, 10);
    if (hubs.length) {
        out.push('## Most depended-on files', '', '| File | Direct dependents | Transitive impact |', '| --- | ---: | ---: |');
        for (const n of hubs) out.push(`| ${code(n.id)} | ${n.importedBy} | ${trace(n.id, report.edges, 'impact').size - 1} |`);
        out.push('');
    }
    if (report.externals.length) out.push('## External packages', '', report.externals.slice(0, 60).map(p => code(p.name) + (p.declared === false ? ' (undeclared)' : '')).join(', '), '');
    out.push(`## Findings (${report.findings.length})`, '');
    if (!report.findings.length) out.push('No findings from these checks. This is not a complete correctness or security audit.', '');
    for (const f of report.findings.slice(0, limit)) {
        const where = f.files.length > 1 ? `${f.files.length} files: ${f.files.slice(0, 5).map(code).join(', ')}${f.files.length > 5 ? ', …' : ''}` : f.files[0] ? code(`${f.files[0]}${f.line ? `:${f.line}` : ''}`) : 'project-wide';
        out.push(`- **[${f.severity}] ${text(f.title)}**: ${where}`, `  ${text(f.detail)}`);
    }
    if (report.findings.length > limit) out.push('', `…and ${report.findings.length - limit} more. Use the JSON report for the full list.`);
    if (report.limitations.length) out.push('', '## Limits of this analysis', '', ...report.limitations.map(l => `- ${text(l)}`));
    return out.join('\n') + '\n';
}
