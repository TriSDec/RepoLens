'use client';
import { useMemo } from 'react';
import Icon from './Icon';
import Relations, { type Neighbour } from './Relations';
import { KIND_LABEL, SEVERITY_LABEL, type TraceMode } from './types';
import { fmt } from '@/lib/format';
import { riskColor } from '@/lib/palette';
import type { Finding, Report } from '@/lib/repolens/types';

type Props = {
    report: Report;
    selected: string | null;
    finding: Finding | null;
    trace: TraceMode;
    pathTarget: string | null;
    path: string[] | null;
    onTrace: (mode: TraceMode) => void;
    onSelect: (id: string) => void;
    onFindPath: () => void;
    onFocus: () => void;
    onShowFinding: (f: Finding) => void;
    onOpenFinding: (f: Finding) => void;
    onClose: () => void;
    onBack: () => void;
    onForward: () => void;
    canBack: boolean;
    canForward: boolean;
};

function FileLink({ id, meta, onSelect }: { id: string; meta?: string; onSelect: (id: string) => void }) {
    const name = id.split('/').pop();
    return <button className="file-link" onClick={() => onSelect(id)} title={id}><span>{name}{meta && <em className="link-meta">{meta}</em>}</span><small>{id.includes('/') ? id.slice(0, id.lastIndexOf('/')) : ''}</small></button>;
}

function FindingDetail({ f, onSelect, onShow, onClose }: { f: Finding; onSelect: (id: string) => void; onShow: (f: Finding) => void; onClose: () => void }) {
    return (
        <>
            <header className="reading-head">
                <div className="chips"><span className={`chip sev-${f.severity}`}>{SEVERITY_LABEL[f.severity]}</span><span className="chip">{f.confidence === 'confirmed' ? 'Confirmed' : 'Needs review'}</span><span className="chip">{KIND_LABEL[f.kind] ?? f.kind}</span></div>
                <button className="icon-btn" onClick={onClose} aria-label="Close details"><Icon name="close" /></button>
            </header>
            <h2 className="reading-title display">{f.title}</h2>
            <p className="prose">{f.detail}</p>
            {f.path && f.path.length > 1 && (
                <div className="cycle-path" aria-label="Loop">
                    {f.path.map((id, i) => <span key={i}>{i > 0 && <Icon name="arrow" size={14} />}<button className="file-link inline" onClick={() => onSelect(id)}>{id.split('/').pop()}</button></span>)}
                </div>
            )}
            <div className="callout"><h3>What to do</h3><p>{f.suggestion}</p></div>
            {f.files.length > 0 && <>
                <h3 className="reading-sub">{f.files.length === 1 ? 'File' : `${f.files.length} files`}{f.line ? ` · line ${f.line}` : ''}</h3>
                <div className="links">{f.files.slice(0, 40).map(id => <FileLink key={id} id={id} onSelect={onSelect} />)}</div>
            </>}
            {f.folders && <p className="muted-line">Directories: {f.folders.join(', ')}</p>}
            {f.files.length > 0 && <button className="btn" onClick={() => onShow(f)}>Show on the map</button>}
        </>
    );
}

export default function Inspector({ report, selected, finding, trace, pathTarget, path, onTrace, onSelect, onFindPath, onFocus, onShowFinding, onOpenFinding, onClose, onBack, onForward, canBack, canForward }: Props) {
    const node = useMemo(() => report.nodes.find(n => n.id === selected) ?? null, [report, selected]);
    const byId = useMemo(() => new Map(report.nodes.map(n => [n.id, n])), [report]);
    const links = useMemo(() => {
        if (!node) return { out: [] as Neighbour[], inn: [] as Neighbour[] };
        const out = new Map<string, Neighbour>(), inn = new Map<string, Neighbour>();
        for (const e of report.edges) {
            if (e.from === node.id && !out.has(e.to)) out.set(e.to, { id: e.to, line: e.line, typeOnly: e.typeOnly });
            if (e.to === node.id && !inn.has(e.from)) inn.set(e.from, { id: e.from, line: e.line, typeOnly: e.typeOnly });
        }
        const byName = (a: Neighbour, b: Neighbour) => (a.id < b.id ? -1 : 1);
        return { out: [...out.values()].sort(byName), inn: [...inn.values()].sort(byName) };
    }, [report, node]);
    const fileFindings = useMemo(() => (node ? report.findings.filter(f => f.files.includes(node.id)) : []), [report, node]);

    if (finding && !node) return <aside className="reading" aria-label="Details"><FindingDetail f={finding} onSelect={onSelect} onShow={onShowFinding} onClose={onClose} /></aside>;
    if (!node) return null;

    const folder = node.folder === 'project' ? '' : node.folder;
    const tag = (text: string, tone = '') => <span className={`chip ${tone}`}>{text}</span>;
    return (
        <aside className="reading" aria-label="File details">
            <header className="reading-head">
                <div className="chips">
                    {node.lang && tag(report.languages.find(l => l.lang === node.lang)?.label ?? node.lang)}
                    {tag(node.kind)}{node.entry && !node.isTest && tag('entry point', 'gold')}{node.isTest && tag('test')}{node.inCycle && tag('in a cycle', 'sev-warning')}
                </div>
                <span className="nav-hist">
                    <button className="icon-btn" onClick={onBack} disabled={!canBack} aria-label="Previous file (Alt+Left)" title="Previous file (Alt+←)"><Icon name="arrow" className="flip" /></button>
                    <button className="icon-btn" onClick={onForward} disabled={!canForward} aria-label="Next file (Alt+Right)" title="Next file (Alt+→)"><Icon name="arrow" /></button>
                    <button className="icon-btn" onClick={onClose} aria-label="Close details"><Icon name="close" /></button>
                </span>
            </header>
            <h2 className="reading-title display">{node.name}</h2>
            <p className="path">{folder && <span>{folder}/</span>}{node.name}</p>

            <p className="summary-line">
                {links.inn.length ? <>Imported by <b>{links.inn.length}</b> {links.inn.length === 1 ? 'file' : 'files'}</> : <>Nothing imports it</>}
                {links.out.length ? <> and imports <b>{links.out.length}</b>.</> : <> and it imports nothing in this project.</>}
                {node.influence > 0 && <> A change here can reach <b>{node.influence}</b> {node.influence === 1 ? 'file' : 'files'} ({Math.max(1, Math.round(node.influence / Math.max(1, report.nodes.length) * 100))}% of the project).</>}
            </p>
            <Relations node={node} nodes={byId} users={links.inn} deps={links.out} onSelect={onSelect} />

            <dl className="metrics">
                <div><dt>Lines</dt><dd>{fmt(node.lines)}</dd></div>
                <div><dt>Imports</dt><dd>{node.imports}</dd></div>
                <div><dt>Dependents</dt><dd>{node.importedBy}</dd></div>
                <div title="Files affected, directly or indirectly, if this one changes"><dt>Blast radius</dt><dd>{node.influence}</dd></div>
                <div title="Branch points in the most complex function (or the whole file where functions are not parsed)"><dt>Complexity</dt><dd>{node.worst ? node.worst.complexity : node.complexity}</dd></div>
                <div><dt>Functions</dt><dd>{node.functions || '—'}</dd></div>
            </dl>

            {node.risk > 0 && (
                <div className="risk" title="Blast radius, complexity, missing tests, size and cycles combined">
                    <div><span>Change risk</span><b>{node.risk}</b></div>
                    <div className="bar"><i style={{ width: `${Math.min(100, node.risk * 1.6)}%`, background: riskColor(node.risk) }} /></div>
                    {node.worst && <small>Most complex: <code>{node.worst.name}</code> (line {node.worst.line}, complexity {node.worst.complexity})</small>}
                </div>
            )}
            {report.testFiles > 0 && !node.isTest && <p className={`status ${node.tested ? 'ok' : 'warn'}`}><Icon name={node.tested ? 'check' : 'warn'} size={15} />{node.tested ? 'Reached by at least one test' : 'No test reaches this file'}</p>}

            <div className="actions">
                <button className={`btn small${trace === 'deps' ? ' is-on' : ''}`} onClick={() => onTrace(trace === 'deps' ? 'none' : 'deps')}>What it uses</button>
                <button className={`btn small${trace === 'impact' ? ' is-on' : ''}`} onClick={() => onTrace(trace === 'impact' ? 'none' : 'impact')}>What depends on it</button>
                <button className="btn small" onClick={onFindPath}>Trace path to…</button>
                <button className="btn small" onClick={onFocus}>Centre on map</button>
            </div>
            {pathTarget && (
                <div className="callout" role="status">
                    <h3>Path to {pathTarget.split('/').pop()}</h3>
                    {path ? <div className="cycle-path">{path.map((id, i) => <span key={i}>{i > 0 && <Icon name="arrow" size={14} />}<button className="file-link inline" onClick={() => onSelect(id)}>{id.split('/').pop()}</button></span>)}</div>
                        : <p>{node.name} never reaches that file through imports.</p>}
                </div>
            )}

            {fileFindings.length > 0 && <>
                <h3 className="reading-sub">Findings ({fileFindings.length})</h3>
                <ul className="mini-findings">{fileFindings.slice(0, 12).map(f => (
                    <li key={f.id}><button onClick={() => onOpenFinding(f)}><i className={`sev sev-${f.severity}`} /><span><strong>{f.title}</strong><small>{KIND_LABEL[f.kind] ?? f.kind}{f.line ? ` · line ${f.line}` : ''}</small></span></button></li>
                ))}</ul>
            </>}
            {links.out.length > 0 && <><h3 className="reading-sub">Imports ({links.out.length})</h3><div className="links">{links.out.slice(0, 60).map(l => <FileLink key={l.id} id={l.id} meta={`${l.typeOnly ? 'type · ' : ''}${l.line ? `line ${l.line}` : ''}`} onSelect={onSelect} />)}</div></>}
            {links.inn.length > 0 && <><h3 className="reading-sub">Imported by ({links.inn.length})</h3><div className="links">{links.inn.slice(0, 60).map(l => <FileLink key={l.id} id={l.id} meta={l.line ? `line ${l.line}` : ''} onSelect={onSelect} />)}</div></>}
            {node.external.length > 0 && <><h3 className="reading-sub">External packages</h3><p className="pkgs">{node.external.map(p => <code key={p}>{p}</code>)}</p></>}
            {!links.out.length && !links.inn.length && <p className="muted-line">No local imports traced for this file.</p>}
        </aside>
    );
}
