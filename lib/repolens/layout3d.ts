// Deterministic 3D layout for the mind map. Folders are placed as "constellations" by a force
// simulation (related folders sit close, parents near their children), then each folder's files are
// spread through a ball around its centre and relaxed so connected files drift together.

export type Layout = {
    positions: Float64Array;       // 3 values per node, normalised to roughly [-1, 1]
    folderIds: string[];
    folderPositions: Float64Array; // 3 values per folder
};

function rng(seed: number) {
    let s = seed >>> 0;
    return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

const parentOf = (folder: string) => folder.slice(0, Math.max(0, folder.lastIndexOf('/')));

export function layout3d(nodeFolders: string[], edgePairs: [number, number][]): Layout {
    const n = nodeFolders.length;
    const random = rng(2718);
    const folderIds = [...new Set(nodeFolders)].sort();
    const fIndex = new Map(folderIds.map((f, i) => [f, i]));
    const f = folderIds.length;
    const nodeFolder = nodeFolders.map(x => fIndex.get(x)!);
    const members: number[][] = folderIds.map(() => []);
    nodeFolder.forEach((fi, i) => members[fi].push(i));

    // ---- folder level ------------------------------------------------------------------------
    const weights = new Map<number, number>();
    const addWeight = (a: number, b: number, w: number) => {
        if (a === b) return;
        const key = a < b ? a * f + b : b * f + a;
        weights.set(key, (weights.get(key) || 0) + w);
    };
    for (const [a, b] of edgePairs) addWeight(nodeFolder[a], nodeFolder[b], 1);
    folderIds.forEach((id, i) => { const p = fIndex.get(parentOf(id)); if (p !== undefined) addWeight(i, p, 3); });
    const links = [...weights].map(([key, w]) => [Math.floor(key / f), key % f, Math.log2(1 + w)] as const);

    const radius = folderIds.map((_, i) => 0.06 + 0.05 * Math.cbrt(members[i].length));
    const fp = new Float64Array(f * 3);
    for (let i = 0; i < f; i++) { // start on a sphere so the simulation never begins degenerate
        const t = (i + 0.5) / f, phi = Math.acos(1 - 2 * t), theta = Math.PI * (1 + Math.sqrt(5)) * i;
        fp[i * 3] = Math.cos(theta) * Math.sin(phi); fp[i * 3 + 1] = Math.sin(theta) * Math.sin(phi); fp[i * 3 + 2] = Math.cos(phi);
    }
    const folderIters = f <= 1 ? 0 : Math.max(30, Math.min(300, Math.floor(8e6 / (f * f))));
    const disp = new Float64Array(f * 3);
    for (let it = 0; it < folderIters; it++) {
        const cool = 0.12 * (1 - it / folderIters) + 0.004;
        disp.fill(0);
        for (let a = 0; a < f; a++) {
            for (let b = a + 1; b < f; b++) {
                let dx = fp[a * 3] - fp[b * 3], dy = fp[a * 3 + 1] - fp[b * 3 + 1], dz = fp[a * 3 + 2] - fp[b * 3 + 2];
                let d2 = dx * dx + dy * dy + dz * dz;
                if (d2 < 1e-6) { dx = random() - 0.5; dy = random() - 0.5; dz = random() - 0.5; d2 = dx * dx + dy * dy + dz * dz; }
                const d = Math.sqrt(d2), min = radius[a] + radius[b];
                const push = (0.012 + (d < min * 1.4 ? 0.06 * (min * 1.4 - d) / (min * 1.4) : 0)) / (d2 + 0.02);
                disp[a * 3] += dx * push; disp[a * 3 + 1] += dy * push; disp[a * 3 + 2] += dz * push;
                disp[b * 3] -= dx * push; disp[b * 3 + 1] -= dy * push; disp[b * 3 + 2] -= dz * push;
            }
        }
        for (const [a, b, w] of links) {
            const dx = fp[b * 3] - fp[a * 3], dy = fp[b * 3 + 1] - fp[a * 3 + 1], dz = fp[b * 3 + 2] - fp[a * 3 + 2];
            const d = Math.hypot(dx, dy, dz) || 1e-6, rest = radius[a] + radius[b] + 0.1;
            const pull = 0.06 * w * (d - rest) / d;
            disp[a * 3] += dx * pull; disp[a * 3 + 1] += dy * pull; disp[a * 3 + 2] += dz * pull;
            disp[b * 3] -= dx * pull; disp[b * 3 + 1] -= dy * pull; disp[b * 3 + 2] -= dz * pull;
        }
        for (let i = 0; i < f; i++) {
            for (let k = 0; k < 3; k++) { disp[i * 3 + k] -= fp[i * 3 + k] * 0.05; } // gentle gravity keeps the map compact
            const mag = Math.hypot(disp[i * 3], disp[i * 3 + 1], disp[i * 3 + 2]) || 1;
            const step = Math.min(mag, cool) / mag;
            for (let k = 0; k < 3; k++) fp[i * 3 + k] += disp[i * 3 + k] * step;
        }
    }

    // ---- file level --------------------------------------------------------------------------
    const pos = new Float64Array(n * 3);
    for (let fi = 0; fi < f; fi++) {
        const m = members[fi], r = radius[fi];
        m.forEach((node, j) => {
            const t = (j + 0.5) / m.length, phi = Math.acos(1 - 2 * ((j * 0.618034) % 1)), theta = Math.PI * (1 + Math.sqrt(5)) * j;
            const rr = r * Math.cbrt(t);
            pos[node * 3] = fp[fi * 3] + rr * Math.sin(phi) * Math.cos(theta);
            pos[node * 3 + 1] = fp[fi * 3 + 1] + rr * Math.sin(phi) * Math.sin(theta);
            pos[node * 3 + 2] = fp[fi * 3 + 2] + rr * Math.cos(phi);
        });
    }
    let sumSq = 0;
    for (const m of members) sumSq += m.length * m.length;
    const nodeIters = n < 2 ? 0 : Math.max(8, Math.min(70, Math.floor(3e7 / Math.max(sumSq + edgePairs.length * 4, 1))));
    const neighbours: number[][] = Array.from({ length: n }, () => []);
    for (const [a, b] of edgePairs) { neighbours[a].push(b); neighbours[b].push(a); }
    const push = new Float64Array(n * 3);
    for (let it = 0; it < nodeIters; it++) {
        const cool = 0.03 * (1 - it / nodeIters) + 0.002;
        push.fill(0);
        for (let fi = 0; fi < f; fi++) {
            const m = members[fi], r = radius[fi];
            for (let x = 0; x < m.length; x++) {
                const a = m[x];
                for (let y = x + 1; y < m.length; y++) {
                    const b = m[y];
                    let dx = pos[a * 3] - pos[b * 3], dy = pos[a * 3 + 1] - pos[b * 3 + 1], dz = pos[a * 3 + 2] - pos[b * 3 + 2];
                    const d2 = dx * dx + dy * dy + dz * dz + 1e-5;
                    const k = (r * r * 0.02) / d2;
                    dx *= k; dy *= k; dz *= k;
                    push[a * 3] += dx; push[a * 3 + 1] += dy; push[a * 3 + 2] += dz;
                    push[b * 3] -= dx; push[b * 3 + 1] -= dy; push[b * 3 + 2] -= dz;
                }
            }
        }
        for (let a = 0; a < n; a++) {
            const fi = nodeFolder[a], r = radius[fi];
            for (const b of neighbours[a]) {
                const same = nodeFolder[b] === fi;
                const k = same ? 0.08 : 0.015; // cross-folder links pull gently so folders stay together
                push[a * 3] += (pos[b * 3] - pos[a * 3]) * k;
                push[a * 3 + 1] += (pos[b * 3 + 1] - pos[a * 3 + 1]) * k;
                push[a * 3 + 2] += (pos[b * 3 + 2] - pos[a * 3 + 2]) * k;
            }
            const dx = pos[a * 3] - fp[fi * 3], dy = pos[a * 3 + 1] - fp[fi * 3 + 1], dz = pos[a * 3 + 2] - fp[fi * 3 + 2];
            const d = Math.hypot(dx, dy, dz) || 1e-6, over = d - r * 1.15;
            const hold = over > 0 ? 0.5 * over / d : 0.02; // confine to the constellation, hug its centre lightly
            push[a * 3] -= dx * hold; push[a * 3 + 1] -= dy * hold; push[a * 3 + 2] -= dz * hold;
            const mag = Math.hypot(push[a * 3], push[a * 3 + 1], push[a * 3 + 2]) || 1;
            const step = Math.min(mag, cool * (r + 0.05)) / mag;
            pos[a * 3] += push[a * 3] * step; pos[a * 3 + 1] += push[a * 3 + 1] * step; pos[a * 3 + 2] += push[a * 3 + 2] * step;
        }
    }

    // ---- normalise ---------------------------------------------------------------------------
    const cx = [0, 0, 0];
    for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) cx[k] += pos[i * 3 + k] / Math.max(n, 1);
    let max = 1e-6;
    for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { pos[i * 3 + k] -= cx[k]; max = Math.max(max, Math.abs(pos[i * 3 + k])); }
    for (let i = 0; i < n * 3; i++) pos[i] /= max;
    for (let i = 0; i < f; i++) for (let k = 0; k < 3; k++) fp[i * 3 + k] = (fp[i * 3 + k] - cx[k]) / max;
    return { positions: pos, folderIds, folderPositions: fp };
}
