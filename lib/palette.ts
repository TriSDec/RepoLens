// Muted, pigment-like colours that read on both the dark "ink" and light "paper" themes.
export const LANG_COLORS: Record<string, string> = {
    js: '#d9a441', python: '#6fb7a8', java: '#c4694a', kotlin: '#a8739a', scala: '#b5483f', go: '#6aa5c9', rust: '#b87a4b',
    c: '#8497b8', cpp: '#6f86b3', csharp: '#8fae6b', ruby: '#c2566b', php: '#9a8fc2', dart: '#4fa3a3', swift: '#e08a5c',
};
export const KIND_COLORS: Record<string, string> = {
    component: '#d9a441', module: '#a3a08f', style: '#9a8fc2', config: '#6aa5c9', document: '#8f8b80', asset: '#6a675f',
};
const FOLDER_PALETTE = ['#d9a441', '#6fb7a8', '#c4694a', '#a8739a', '#6aa5c9', '#8fae6b', '#c2566b', '#9a8fc2', '#4fa3a3', '#e08a5c', '#b87a4b', '#8497b8'];

export const folderColor = (index: number) => FOLDER_PALETTE[index % FOLDER_PALETTE.length];

const hex = (c: string) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
const mix = (a: string, b: string, t: number) => { const x = hex(a), y = hex(b); return '#' + [0, 1, 2].map(i => Math.round(x[i] + (y[i] - x[i]) * t).toString(16).padStart(2, '0')).join(''); };

/** sage → ochre → vermilion for a 0..100 risk score. */
export function riskColor(risk: number): string {
    const t = Math.min(1, Math.max(0, risk / 60));
    return t < 0.5 ? mix('#7fbfae', '#d6a84f', t * 2) : mix('#d6a84f', '#e5603a', (t - 0.5) * 2);
}

const cache = new Map<string, string>();
/** `#rrggbb` + alpha → `rgba(...)`, cached because the renderer calls this thousands of times per frame. */
export function rgba(color: string, alpha: number): string {
    const a = Math.round(alpha * 100) / 100, key = color + a;
    let v = cache.get(key);
    if (!v) { const [r, g, b] = hex(color); v = `rgba(${r},${g},${b},${a})`; cache.set(key, v); if (cache.size > 6000) cache.clear(); }
    return v;
}
