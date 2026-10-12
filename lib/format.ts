export const fmt = (n: number) => n.toLocaleString('en-US');
export const plural = (n: number, one: string, many = one + 's') => `${fmt(n)} ${n === 1 ? one : many}`;
export const pct = (n: number) => `${Math.round(n)}%`;

/** Trigger a browser download of text or a Blob without any network request. */
export function download(name: string, content: string | Blob, type = 'application/json') {
    const blob = content instanceof Blob ? content : new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/** A file-system-safe slug for download names. */
export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'project';
