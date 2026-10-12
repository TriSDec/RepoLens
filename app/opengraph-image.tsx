import { ImageResponse } from 'next/og';

export const alt = 'RepoLens: see how your code is connected';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

// A constellation of "files" generated from a fixed seed, so the preview image is identical on every build.
function dots() {
    let s = 7;
    const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
    const palette = ['#d6a84f', '#7fbfae', '#e5603a', '#8f8b80'];
    return Array.from({ length: 90 }, () => {
        const a = rnd() * Math.PI * 2, r = 70 + Math.pow(rnd(), 0.7) * 260;
        return { x: 880 + Math.cos(a) * r * 1.15, y: 315 + Math.sin(a) * r * 0.9, d: 4 + rnd() * 9, c: palette[Math.floor(rnd() * palette.length)], o: 0.35 + rnd() * 0.6 };
    });
}

export default function OpenGraphImage() {
    const points = dots();
    return new ImageResponse(
        (
            <div style={{ width: '100%', height: '100%', display: 'flex', position: 'relative', background: '#0b0c0d', color: '#ebe5d6' }}>
                {points.map((p, i) => (
                    <div key={i} style={{ position: 'absolute', left: p.x, top: p.y, width: p.d, height: p.d, borderRadius: 999, background: p.c, opacity: p.o }} />
                ))}
                <div style={{ position: 'absolute', left: 72, top: 70, display: 'flex', fontSize: 28, letterSpacing: 6, color: '#8f8b80' }}>REPOLENS</div>
                <div style={{ position: 'absolute', left: 72, top: 190, display: 'flex', flexDirection: 'column', fontSize: 92, lineHeight: 1.02, fontFamily: 'serif' }}>
                    <span>See how your</span>
                    <span style={{ fontStyle: 'italic', color: '#e5603a' }}>code is connected.</span>
                </div>
                <div style={{ position: 'absolute', left: 72, bottom: 70, display: 'flex', fontSize: 30, color: '#8f8b80' }}>A 3D map of any codebase. Runs in your browser. Nothing is uploaded.</div>
            </div>
        ),
        size,
    );
}
