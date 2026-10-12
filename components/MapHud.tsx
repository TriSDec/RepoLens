'use client';
import Icon from './Icon';
import type { ColorBy, MapApi } from './MindMap';
import { KIND_COLORS, LANG_COLORS, folderColor, riskColor } from '@/lib/palette';
import type { Report } from '@/lib/repolens/types';

type Props = {
    report: Report;
    colorBy: ColorBy;
    setColorBy: (c: ColorBy) => void;
    showEdges: boolean; setShowEdges: (v: boolean) => void;
    showLabels: boolean; setShowLabels: (v: boolean) => void;
    autoRotate: boolean; setAutoRotate: (v: boolean) => void;
    api: MapApi | null;
    onSnapshot: () => void;
    focusLabel: string | null;
    onClearFocus: () => void;
};

const MODES: [ColorBy, string][] = [['language', 'Language'], ['folder', 'Folder'], ['risk', 'Risk'], ['kind', 'Kind']];

export default function MapHud({ report, colorBy, setColorBy, showEdges, setShowEdges, showLabels, setShowLabels, autoRotate, setAutoRotate, api, onSnapshot, focusLabel, onClearFocus }: Props) {
    const legend: [string, string][] = colorBy === 'language' ? report.languages.map(l => [l.label, LANG_COLORS[l.lang] ?? '#8f8b80'])
        : colorBy === 'kind' ? [...new Set(report.nodes.map(n => n.kind))].map(k => [k, KIND_COLORS[k] ?? '#8f8b80'])
        : colorBy === 'folder' ? report.folders.slice(0, 8).map((f, i) => [f.id.split('/').pop() || f.id, folderColor(i)])
        : [['low', riskColor(0)], ['medium', riskColor(30)], ['high', riskColor(60)]];
    return (
        <>
            <div className="hud hud-top">
                <div className="seg" role="group" aria-label="Colour files by">
                    <span className="seg-label">Colour</span>
                    {MODES.map(([v, l]) => <button key={v} className={colorBy === v ? 'is-on' : ''} onClick={() => setColorBy(v)}>{l}</button>)}
                </div>
                <div className="toggles" role="group" aria-label="Display options">
                    <button aria-pressed={showEdges} className={showEdges ? 'is-on' : ''} onClick={() => setShowEdges(!showEdges)}>Links</button>
                    <button aria-pressed={showLabels} className={showLabels ? 'is-on' : ''} onClick={() => setShowLabels(!showLabels)}>Labels</button>
                    <button aria-pressed={autoRotate} className={autoRotate ? 'is-on' : ''} onClick={() => setAutoRotate(!autoRotate)}>Turn</button>
                </div>
            </div>
            {focusLabel && <div className="hud hud-focus" role="status"><span>{focusLabel}</span><button className="link" onClick={onClearFocus}>Clear</button></div>}
            <ul className="hud hud-legend" aria-label="Legend">
                {legend.map(([label, color]) => <li key={label}><i style={{ background: color }} />{label}</li>)}
                <li className="legend-sep"><i className="ring cyc" />in a cycle</li>
                <li><i className="ring entry" />entry point</li>
                <li><i className="ring hollow" />test</li>
            </ul>
            <div className="hud hud-zoom" role="group" aria-label="Camera">
                <button onClick={() => api?.zoomBy(1.3)} aria-label="Zoom in"><Icon name="plus" size={16} /></button>
                <button onClick={() => api?.zoomBy(1 / 1.3)} aria-label="Zoom out"><Icon name="minus" size={16} /></button>
                <button onClick={() => api?.reset()} aria-label="Reset view"><Icon name="reset" size={16} /></button>
                <button onClick={onSnapshot} aria-label="Save the map as an image"><Icon name="image" size={16} /></button>
            </div>
            <p className="hud hud-hint">Drag to turn · scroll to zoom · shift-drag to pan · double-click a file to centre it</p>
        </>
    );
}
