'use client';
import { useMemo, useState } from 'react';
import Icon from './Icon';
import { KIND_LABEL } from './types';
import { fmt } from '@/lib/format';
import { KIND_COLORS, LANG_COLORS } from '@/lib/palette';
import type { Finding, Report } from '@/lib/repolens/types';

const gradeTone = (g: string) => (g === 'A' || g === 'B' ? 'good' : g === 'C' ? 'mid' : 'bad');

function Gauge({ score, grade }: { score: number; grade: string }) {
    const r = 44, c = 2 * Math.PI * r, arc = c * 0.75;
    return (
        <div className={`gauge tone-${gradeTone(grade)}`} role="img" aria-label={`Health ${score} out of 100, grade ${grade}`}>
            <svg viewBox="0 0 110 110" width="118" height="118" aria-hidden="true">
                <circle cx="55" cy="55" r={r} className="gauge-track" strokeDasharray={`${arc} ${c}`} transform="rotate(135 55 55)" />
                <circle cx="55" cy="55" r={r} className="gauge-fill" strokeDasharray={`${(arc * score) / 100} ${c}`} transform="rotate(135 55 55)" />
            </svg>
            <div className="gauge-text"><strong>{score}</strong><span>grade {grade}</span></div>
        </div>
    );
}

type Props = {
    report: Report;
    selected: string | null;
    activeFinding: string | null;
    onSelect: (id: string) => void;
    onOpenFinding: (f: Finding) => void;
    search: React.RefObject<HTMLInputElement | null>;
};

export default function Rail({ report, selected, activeFinding, onSelect, onOpenFinding, search }: Props) {
    const [query, setQuery] = useState('');
    const [open, setOpen] = useState<Set<string>>(new Set());
    const flagged = useMemo(() => { const s = new Set<string>(); report.findings.forEach(f => f.severity !== 'info' && f.files.forEach(x => s.add(x))); return s; }, [report]);
    const byId = useMemo(() => new Map(report.findings.map(f => [f.id, f])), [report]);
    const grouped = useMemo(() => {
        const m = new Map<string, typeof report.nodes>();
        for (const n of report.nodes) { const l = m.get(n.folder); if (l) l.push(n); else m.set(n.folder, [n]); }
        return [...m].sort(([a], [b]) => a.localeCompare(b));
    }, [report]);
    const q = query.trim().toLowerCase();
    const matches = useMemo(() => (q ? report.nodes.filter(n => n.id.toLowerCase().includes(q)).slice(0, 150) : []), [q, report]);
    const expanded = (folder: string) => open.has(folder) || (grouped.length <= 10);
    const penalties = report.health.factors.filter(f => f.penalty > 0).sort((a, b) => b.penalty - a.penalty);

    const fileButton = (id: string, name: string, lang: string | undefined, kind: string) => (
        <button key={id} className={`file${selected === id ? ' is-selected' : ''}`} onClick={() => onSelect(id)} title={id}>
            <i className="dot" style={{ background: lang ? LANG_COLORS[lang] : KIND_COLORS[kind] }} />
            <span>{name}</span>
            {flagged.has(id) && <b className="flag" aria-label="has findings" />}
        </button>
    );

    return (
        <aside className="rail" aria-label="Project overview">
            <div className="rail-head">
                <h2 className="project-name display" title={report.name}>{report.name}</h2>
                <p className="meta">{fmt(report.nodes.length)} files · {fmt(new Set(report.edges.map(e => e.from + '\0' + e.to)).size)} links · {fmt(report.lines)} lines</p>
            </div>

            <section className="health" aria-label="Health score">
                <Gauge score={report.health.score} grade={report.health.grade} />
                <div className="health-copy">
                    <p className="eyebrow small">Structural health</p>
                    <p className="health-note">{penalties.length ? `${penalties.length} area${penalties.length === 1 ? '' : 's'} cost points.` : 'Nothing is costing points.'} A summary of structure, not a verdict on quality.</p>
                </div>
                {penalties.length > 0 && (
                    <details className="factors">
                        <summary>How it is scored</summary>
                        <ul>{penalties.map(f => (
                            <li key={f.key} title={f.detail}>
                                <div><span>{f.label}</span><b>−{f.penalty}</b></div>
                                <div className="bar"><i style={{ width: `${Math.min(100, (f.penalty / f.max) * 100)}%` }} /></div>
                                <small>{f.detail}</small>
                            </li>
                        ))}</ul>
                    </details>
                )}
            </section>

            {report.fixFirst.length > 0 && (
                <section className="fixfirst" aria-label="Fix first">
                    <h3 className="rail-title">Fix first</h3>
                    <ol>
                        {report.fixFirst.map(id => { const f = byId.get(id); return f && (
                            <li key={id}>
                                <button className={activeFinding === id ? 'is-selected' : ''} onClick={() => onOpenFinding(f)}>
                                    <i className={`sev sev-${f.severity}`} aria-label={f.severity} />
                                    <span><strong>{f.title}</strong><small>{f.files.length > 1 ? `${f.files.length} files` : f.files[0] ?? KIND_LABEL[f.kind]}{f.line ? `:${f.line}` : ''}</small></span>
                                </button>
                            </li>
                        ); })}
                    </ol>
                </section>
            )}

            <section className="files" aria-label="Files">
                <h3 className="rail-title">Files</h3>
                <label className="search"><Icon name="search" size={15} /><input ref={search} value={query} onChange={e => setQuery(e.target.value)} placeholder="Find a file…  ( / )" aria-label="Find a file" spellCheck={false} />{query && <button aria-label="Clear search" onClick={() => setQuery('')}><Icon name="close" size={14} /></button>}</label>
                <div className="tree">
                    {q ? (
                        matches.length ? matches.map(n => fileButton(n.id, n.id, n.lang, n.kind)) : <p className="empty-note">No file matches “{query}”.</p>
                    ) : grouped.map(([folder, nodes]) => (
                        <div key={folder} className="folder">
                            <button className="folder-row" aria-expanded={expanded(folder)} onClick={() => setOpen(prev => { const next = new Set(prev); if (next.has(folder)) next.delete(folder); else next.add(folder); return next; })}>
                                <span className={`caret${expanded(folder) ? ' is-open' : ''}`}>›</span><span className="folder-name">{folder}</span><small>{nodes.length}</small>
                            </button>
                            {expanded(folder) && nodes.map(n => fileButton(n.id, n.name, n.lang, n.kind))}
                        </div>
                    ))}
                </div>
            </section>
        </aside>
    );
}
