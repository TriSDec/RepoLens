'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from './Icon';
import type { Report } from '@/lib/repolens/types';

export type Command = { id: string; label: string; hint?: string; run: () => void };
export type PaletteMode = { kind: 'go' } | { kind: 'file'; title: string; onPick: (id: string) => void };

type Props = { report: Report | null; commands: Command[]; mode: PaletteMode | null; onClose: () => void; onGoToFile: (id: string) => void };

export default function CommandPalette(props: Props) {
    // Remounting on each opening gives a fresh query and selection without setting state inside an effect.
    return props.mode ? <PaletteBody key={props.mode.kind === 'file' ? props.mode.title : 'go'} {...props} mode={props.mode} /> : null;
}

function PaletteBody({ report, commands, mode, onClose, onGoToFile }: Omit<Props, 'mode'> & { mode: PaletteMode }) {
    const [query, setQuery] = useState('');
    const [index, setIndex] = useState(0);
    const input = useRef<HTMLInputElement>(null), list = useRef<HTMLUListElement>(null);

    useEffect(() => { const t = setTimeout(() => input.current?.focus(), 0); return () => clearTimeout(t); }, []);

    const q = query.trim().toLowerCase();
    const items = useMemo(() => {
        const files = (report?.nodes ?? []).filter(n => !q || n.id.toLowerCase().includes(q)).sort((a, b) => (q ? a.id.length - b.id.length : b.importedBy - a.importedBy)).slice(0, 40);
        const fileItems = files.map(n => ({ id: n.id, label: n.name, hint: n.folder, run: () => (mode.kind === 'file' ? mode.onPick(n.id) : onGoToFile(n.id)), group: 'Files' }));
        if (mode.kind === 'file') return fileItems;
        const cmds = commands.filter(c => !q || c.label.toLowerCase().includes(q)).map(c => ({ ...c, group: 'Actions' }));
        return [...cmds, ...fileItems];
    }, [mode, q, report, commands, onGoToFile]);

    useEffect(() => { list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }); }, [index]);

    const choose = (i: number) => { const item = items[i]; if (item) { onClose(); item.run(); } };
    const onKey = (e: React.KeyboardEvent) => {
        if (e.key === 'ArrowDown') { e.preventDefault(); setIndex(i => Math.min(items.length - 1, i + 1)); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); setIndex(i => Math.max(0, i - 1)); }
        else if (e.key === 'Enter') { e.preventDefault(); choose(index); }
        else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    };
    return (
        <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
            <div className="palette" role="dialog" aria-modal="true" aria-label={mode.kind === 'file' ? mode.title : 'Command palette'} onKeyDown={onKey}>
                <label className="palette-input"><Icon name="search" size={18} />
                    <input ref={input} value={query} onChange={e => { setQuery(e.target.value); setIndex(0); }} placeholder={mode.kind === 'file' ? mode.title : 'Jump to a file or run an action…'} role="combobox" aria-expanded="true" aria-controls="palette-list" aria-activedescendant={items[index] ? `pal-${index}` : undefined} spellCheck={false} />
                    <kbd>esc</kbd>
                </label>
                <ul id="palette-list" ref={list} role="listbox">
                    {items.length === 0 && <li className="palette-empty">No matches</li>}
                    {items.map((item, i) => (
                        <li key={item.id + i} id={`pal-${i}`} role="option" aria-selected={i === index} className={i === index ? 'is-active' : ''} onMouseMove={() => setIndex(i)} onClick={() => choose(i)}>
                            <span>{item.label}</span><small>{item.hint}</small>
                        </li>
                    ))}
                </ul>
            </div>
        </div>
    );
}
