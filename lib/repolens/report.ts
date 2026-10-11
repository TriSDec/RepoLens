import { prettyBytes, trace, type Report } from './types';

/** Human-readable summary of a report. Contains paths and findings only, never source text. */
export function toMarkdown(report: Report, options: { maxFindings?: number } = {}): string {
    const limit = options.maxFindings ?? 100;
    const unique = new Set(report.edges.map(e => e.from + '\0' + e.to)).size;
    const out: string[] = [
        `# RepoLens report: ${report.name}`, '',
        `- **${report.nodes.length}** files · **${unique}** connections · **${report.lines.toLocaleString('en-US')}** lines · ${prettyBytes(report.bytes)}`,
        `- **${report.findings.filter(f => f.severity === 'error').length}** errors · **${report.findings.filter(f => f.severity === 'warning').length}** warnings · **${report.findings.filter(f => f.severity === 'info').length}** review suggestions`,
        `- Analysed in ${report.duration} ms · ${report.skipped} files skipped`, '',
    ];
    if (report.languages.length) {
        out.push('## Languages', '', '| Language | Files | Lines |', '| --- | ---: | ---: |');
        for (const l of report.languages) out.push(`| ${l.label} | ${l.files} | ${l.lines.toLocaleString('en-US')} |`);
        out.push('');
    }
    const hubs = [...report.nodes].filter(n => n.importedBy > 0).sort((a, b) => b.importedBy - a.importedBy).slice(0, 10);
    if (hubs.length) {
        out.push('## Most depended-on files', '', '| File | Direct dependents | Transitive impact |', '| --- | ---: | ---: |');
        for (const n of hubs) out.push(`| \`${n.id}\` | ${n.importedBy} | ${trace(n.id, report.edges, 'impact').size - 1} |`);
        out.push('');
    }
    if (report.packages.length) out.push('## External packages', '', report.packages.map(p => `\`${p}\``).join(', '), '');
    out.push(`## Findings (${report.findings.length})`, '');
    if (!report.findings.length) out.push('No findings from these checks. This is not a complete correctness or security audit.', '');
    for (const f of report.findings.slice(0, limit)) {
        const where = f.files.length > 1 ? `${f.files.length} files: ${f.files.slice(0, 5).map(p => `\`${p}\``).join(', ')}${f.files.length > 5 ? ', …' : ''}` : `\`${f.files[0]}${f.line ? `:${f.line}` : ''}\``;
        out.push(`- **[${f.severity}] ${f.title}** — ${where}`, `  ${f.detail}`);
    }
    if (report.findings.length > limit) out.push('', `…and ${report.findings.length - limit} more. Use the JSON report for the full list.`);
    if (report.limitations.length) out.push('', '## Limits of this analysis', '', ...report.limitations.map(l => `- ${l}`));
    return out.join('\n') + '\n';
}
