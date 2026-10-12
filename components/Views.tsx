'use client';
import { useMemo, useState } from 'react';
import Icon from './Icon';
import { KIND_LABEL, SEVERITY_LABEL } from './types';
import { fmt } from '@/lib/format';
import { riskColor } from '@/lib/palette';
import type { Finding, Report } from '@/lib/repolens/types';

// ---- Findings ----------------------------------------------------------------------------------------------------
export function FindingsView({ report, active, onOpen }: { report: Report; active: string | null; onOpen: (f: Finding) => void }) {
    const [severity, setSeverity] = useState<'all' | 'error' | 'warning' | 'info'>('all');
    const [kind, setKind] = useState('all');
    const [query, setQuery] = useState('');
    const kinds = useMemo(() => [...new Set(report.findings.map(f => f.kind))].sort(), [report]);
    const counts = useMemo(() => ({ error: report.findings.filter(f => f.severity === 'error').length, warning: report.findings.filter(f => f.severity === 'warning').length, info: report.findings.filter(f => f.severity === 'info').length }), [report]);
    const q = query.trim().toLowerCase();
    const list = useMemo(() => report.findings.filter(f => (severity === 'all' || f.severity === severity) && (kind === 'all' || f.kind === kind) && (!q || [f.title, f.detail, ...f.files].join(' ').toLowerCase().includes(q))), [report, severity, kind, q]);
    const shown = list.slice(0, 300);
    return (
        <div className="view">
            <header className="view-head">
                <div><h2 className="display">What we found</h2><p className="muted-line">{fmt(report.findings.length)} findings, most important first. “Confirmed” are facts about the graph; “review” are judgement calls.</p></div>
            </header>
            <div className="filters">
                <div className="seg" role="group" aria-label="Severity">
                    {([['all', `All ${report.findings.length}`], ['error', `Errors ${counts.error}`], ['warning', `Warnings ${counts.warning}`], ['info', `Suggestions ${counts.info}`]] as const).map(([v, l]) => <button key={v} className={severity === v ? 'is-on' : ''} onClick={() => setSeverity(v)}>{l}</button>)}
                </div>
                <select value={kind} onChange={e => setKind(e.target.value)} aria-label="Kind of finding"><option value="all">All kinds</option>{kinds.map(k => <option key={k} value={k}>{KIND_LABEL[k] ?? k}</option>)}</select>
                <label className="search"><Icon name="search" size={15} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Filter findings…" aria-label="Filter findings" /></label>
            </div>
            {!list.length ? (
                <div className="empty"><Icon name="check" size={28} /><h3>Nothing matches</h3><p>{report.findings.length ? 'Try a different filter.' : 'These checks found no issues. That is not a guarantee of correctness or security.'}</p></div>
            ) : (
                <ul className="finding-list">
                    {shown.map(f => (
                        <li key={f.id}>
                            <button className={active === f.id ? 'is-selected' : ''} onClick={() => onOpen(f)}>
                                <i className={`sev sev-${f.severity}`} aria-label={SEVERITY_LABEL[f.severity]} />
                                <span className="fl-main"><strong>{f.title}</strong><span className="fl-detail">{f.detail}</span><span className="fl-where">{f.files.length > 1 ? `${f.files.length} files · ${f.files[0]}` : f.files[0] ?? 'project-wide'}{f.line ? `:${f.line}` : ''}</span></span>
                                <span className="fl-meta"><span className="chip">{KIND_LABEL[f.kind] ?? f.kind}</span>{f.confidence === 'review' && <span className="chip faint">review</span>}</span>
                            </button>
                        </li>
                    ))}
                    {list.length > shown.length && <li className="more">Showing the first {shown.length} of {fmt(list.length)}. Narrow the filter to see the rest.</li>}
                </ul>
            )}
        </div>
    );
}

// ---- Hotspots ------------------------------------------------------------------------------------------------------
export function HotspotsView({ report, onSelect, selected }: { report: Report; onSelect: (id: string) => void; selected: string | null }) {
    const rows = useMemo(() => [...report.nodes].filter(n => n.risk > 0).sort((a, b) => b.risk - a.risk || b.influence - a.influence).slice(0, 40), [report]);
    return (
        <div className="view">
            <header className="view-head"><div><h2 className="display">Where a mistake costs most</h2><p className="muted-line">Change risk combines blast radius (38%), the most complex function (27%), missing test coverage (15%), size (10%) and circular dependencies (10%).</p></div></header>
            {!rows.length ? <div className="empty"><h3>No code files to rank</h3></div> : (
                <div className="table-wrap"><table className="table">
                    <thead><tr><th>Risk</th><th>File</th><th className="num">Dependents</th><th className="num">Blast radius</th><th className="num">Complexity</th><th>Tested</th><th className="num">Lines</th></tr></thead>
                    <tbody>{rows.map(n => (
                        <tr key={n.id} className={selected === n.id ? 'is-selected' : ''} onClick={() => onSelect(n.id)}>
                            <td className="risk-cell"><div className="bar"><i style={{ width: `${Math.min(100, n.risk * 1.6)}%`, background: riskColor(n.risk) }} /></div><b>{n.risk}</b></td>
                            <td><button className="file-link" onClick={e => { e.stopPropagation(); onSelect(n.id); }}><span>{n.name}</span><small>{n.folder}</small></button></td>
                            <td className="num">{n.importedBy}</td><td className="num">{n.influence}</td>
                            <td className="num" title={n.worst ? `${n.worst.name}, line ${n.worst.line}` : undefined}>{n.worst ? n.worst.complexity : n.complexity}</td>
                            <td>{report.testFiles ? (n.tested ? <span className="ok-mark">yes</span> : <span className="warn-mark">no</span>) : '—'}</td>
                            <td className="num">{fmt(n.lines)}</td>
                        </tr>
                    ))}</tbody>
                </table></div>
            )}
        </div>
    );
}

// ---- Architecture --------------------------------------------------------------------------------------------------------
export function ArchitectureView({ report }: { report: Report }) {
    const folders = useMemo(() => [...report.folders].sort((a, b) => b.lines - a.lines), [report]);
    const edges = useMemo(() => [...report.folderEdges].sort((a, b) => b.weight - a.weight).slice(0, 24), [report]);
    const loops = report.findings.filter(f => f.kind === 'folder-cycle');
    return (
        <div className="view">
            <header className="view-head"><div><h2 className="display">How the directories relate</h2><p className="muted-line">Instability is outgoing dependencies as a share of all dependencies: 0 means everything depends on a directory and it depends on little (stable), 1 means it leans on others and nothing leans on it (volatile). Dependencies should point toward stability.</p></div></header>
            {loops.length > 0 && <div className="callout warn">
                <h3>{loops.length} directory loop{loops.length === 1 ? '' : 's'}</h3>
                {loops.map(l => <p key={l.id}>{l.folders?.join(' ⇄ ')}</p>)}
            </div>}
            <div className="table-wrap"><table className="table">
                <thead><tr><th>Directory</th><th className="num">Files</th><th className="num">Lines</th><th className="num">In</th><th className="num">Out</th><th>Stable → volatile</th></tr></thead>
                <tbody>{folders.map(f => (
                    <tr key={f.id}>
                        <td className="mono">{f.id}{f.inCycle && <span className="chip sev-warning tight">loop</span>}</td>
                        <td className="num">{f.files}</td><td className="num">{fmt(f.lines)}</td><td className="num">{f.ca}</td><td className="num">{f.ce}</td>
                        <td className="strip-cell">{f.ca + f.ce > 0 ? <div className="strip" title={`Instability ${f.instability.toFixed(2)}`}><i style={{ left: `${f.instability * 100}%` }} /></div> : <small className="muted-line">isolated</small>}</td>
                    </tr>
                ))}</tbody>
            </table></div>
            {edges.length > 0 && <>
                <h3 className="reading-sub spaced">Strongest directory dependencies</h3>
                <div className="table-wrap"><table className="table compact"><thead><tr><th>From</th><th></th><th>To</th><th className="num">Imports</th></tr></thead>
                    <tbody>{edges.map((e, i) => <tr key={i}><td className="mono">{e.from}</td><td className="arrow-cell"><Icon name="arrow" size={14} /></td><td className="mono">{e.to}</td><td className="num">{e.weight}</td></tr>)}</tbody></table></div>
            </>}
        </div>
    );
}

// ---- Packages ----------------------------------------------------------------------------------------------------------------
export function PackagesView({ report }: { report: Report }) {
    const [query, setQuery] = useState('');
    const q = query.trim().toLowerCase();
    const rows = report.externals.filter(p => !q || p.name.toLowerCase().includes(q));
    return (
        <div className="view">
            <header className="view-head"><div><h2 className="display">What the code leans on</h2><p className="muted-line">{fmt(report.externals.length)} external packages are imported. “Undeclared” means a package.json that covers the importing file does not list it.</p></div>
                <label className="search"><Icon name="search" size={15} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Filter packages…" aria-label="Filter packages" /></label></header>
            {!rows.length ? <div className="empty"><h3>No packages</h3><p>No external imports were found.</p></div> : (
                <div className="table-wrap"><table className="table">
                    <thead><tr><th>Package</th><th className="num">Files using it</th><th>Declared</th></tr></thead>
                    <tbody>{rows.slice(0, 400).map(p => (
                        <tr key={p.name}><td className="mono">{p.name}</td><td className="num">{p.files}</td><td>{p.declared === null ? <span className="muted-line">n/a</span> : p.declared ? <span className="ok-mark">yes</span> : <span className="warn-mark">no</span>}</td></tr>
                    ))}</tbody>
                </table></div>
            )}
        </div>
    );
}
