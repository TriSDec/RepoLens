// Graph algorithms over index-based adjacency lists. Everything is iterative so a very long
// dependency chain cannot overflow the call stack, and sized so a few thousand files stay fast.

export type Graph = {
    n: number;
    ids: string[];
    index: Map<string, number>;
    /** out[u] = distinct nodes that u imports. */
    out: number[][];
    /** inn[v] = distinct nodes that import v. */
    inn: number[][];
};

export function buildGraph(ids: string[], edges: { from: string; to: string }[]): Graph {
    const index = new Map(ids.map((id, i) => [id, i]));
    const outSets: Set<number>[] = ids.map(() => new Set());
    for (const e of edges) {
        const a = index.get(e.from), b = index.get(e.to);
        if (a !== undefined && b !== undefined && a !== b) outSets[a].add(b);
    }
    const out = outSets.map(s => [...s]);
    const inn: number[][] = ids.map(() => []);
    out.forEach((list, a) => list.forEach(b => inn[b].push(a)));
    return { n: ids.length, ids, index, out, inn };
}

/** Tarjan's strongly connected components. `comps` come out dependencies-first (reverse topological order). */
export function stronglyConnected(out: number[][]): { comp: Int32Array; comps: number[][] } {
    const n = out.length;
    const idx = new Int32Array(n).fill(-1), low = new Int32Array(n), onStack = new Uint8Array(n);
    const comp = new Int32Array(n).fill(-1);
    const comps: number[][] = [];
    const stack: number[] = [], callV: number[] = [], callI: number[] = [];
    let counter = 0;
    for (let root = 0; root < n; root++) {
        if (idx[root] !== -1) continue;
        callV.push(root);
        callI.push(0);
        while (callV.length) {
            const v = callV[callV.length - 1];
            const i = callI[callI.length - 1];
            if (i === 0 && idx[v] === -1) {
                idx[v] = low[v] = counter++;
                stack.push(v);
                onStack[v] = 1;
            }
            if (i < out[v].length) {
                callI[callI.length - 1] = i + 1;
                const w = out[v][i];
                if (idx[w] === -1) {
                    callV.push(w);
                    callI.push(0);
                } else if (onStack[w]) low[v] = Math.min(low[v], idx[w]);
            } else {
                if (low[v] === idx[v]) {
                    const group: number[] = [];
                    let w: number;
                    do {
                        w = stack.pop()!;
                        onStack[w] = 0;
                        comp[w] = comps.length;
                        group.push(w);
                    } while (w !== v);
                    comps.push(group);
                }
                callV.pop();
                callI.pop();
                if (callV.length) {
                    const parent = callV[callV.length - 1];
                    low[parent] = Math.min(low[parent], low[v]);
                }
            }
        }
    }
    return { comp, comps };
}

/** A short loop through an SCC, as node indexes with the first repeated at the end. */
export function shortestCycle(out: number[][], members: number[]): number[] {
    const inside = new Set(members);
    const starts = [...members].sort((a, b) => out[b].length - out[a].length || a - b).slice(0, 12);
    let best: number[] | null = null;
    for (const s of starts) {
        const prev = new Map<number, number>([[s, -1]]);
        const queue = [s];
        let found: number[] | null = null;
        for (let i = 0; i < queue.length && !found; i++) {
            const u = queue[i];
            for (const w of out[u]) {
                if (!inside.has(w)) continue;
                if (w === s) {
                    const path = [u];
                    while (path[0] !== s) path.unshift(prev.get(path[0])!);
                    found = [...path, s];
                    break;
                }
                if (!prev.has(w)) {
                    prev.set(w, u);
                    queue.push(w);
                }
            }
        }
        if (found && (!best || found.length < best.length)) best = found;
        if (best && best.length <= 3) break;
    }
    return best ?? [...members.slice(0, 2), members[0]];
}

/**
 * For every node, how many other nodes depend on it directly or transitively.
 * Works on the condensation DAG with bitsets: O(edges * components / 32).
 */
export function influence(g: Graph, scc: { comp: Int32Array; comps: number[][] }): Int32Array {
    const { comp, comps } = scc;
    const c = comps.length, words = (c + 31) >>> 5;
    const reach = new Uint32Array(c * words); // reach[k] = components that can reach k (strictly)
    const preds: Set<number>[] = comps.map(() => new Set());
    for (let u = 0; u < g.n; u++) for (const v of g.out[u]) if (comp[u] !== comp[v]) preds[comp[v]].add(comp[u]);
    const size = comps.map(m => m.length);
    const result = new Int32Array(g.n);
    for (let k = c - 1; k >= 0; k--) { // importers first
        const base = k * words;
        for (const p of preds[k]) {
            const pb = p * words;
            for (let w = 0; w < words; w++) reach[base + w] |= reach[pb + w];
            reach[base + (p >>> 5)] |= 1 << (p & 31);
        }
        let total = size[k] - 1;
        for (let w = 0; w < words; w++) {
            let bits = reach[base + w];
            while (bits) {
                const low = bits & -bits;
                total += size[(w << 5) + (31 - Math.clz32(low))];
                bits ^= low;
            }
        }
        for (const v of comps[k]) result[v] = total;
    }
    return result;
}

/** PageRank where a file passes its weight to the files it imports, so widely-used foundations rank high. Normalised to max = 1. */
export function pagerank(g: Graph, iterations = 40, damping = 0.85): Float64Array {
    const n = g.n;
    if (!n) return new Float64Array(0);
    let rank = new Float64Array(n).fill(1 / n);
    for (let it = 0; it < iterations; it++) {
        const next = new Float64Array(n).fill((1 - damping) / n);
        let dangling = 0;
        for (let u = 0; u < n; u++) {
            const deg = g.out[u].length;
            if (!deg) dangling += rank[u];
            else {
                const share = (damping * rank[u]) / deg;
                for (const v of g.out[u]) next[v] += share;
            }
        }
        const spread = (damping * dangling) / n;
        let delta = 0;
        for (let i = 0; i < n; i++) {
            next[i] += spread;
            delta += Math.abs(next[i] - rank[i]);
        }
        rank = next;
        if (delta < 1e-9) break;
    }
    const max = Math.max(...rank);
    return max ? rank.map(r => r / max) : rank;
}

/**
 * Articulation points of the undirected graph. `separated[v]` is how many nodes lose their connection
 * to the largest remaining piece when v is removed.
 */
export function articulationPoints(g: Graph): { cut: Uint8Array; separated: Int32Array } {
    const n = g.n;
    const adj: number[][] = Array.from({ length: n }, (_, i) => [...new Set([...g.out[i], ...g.inn[i]])]);
    const disc = new Int32Array(n).fill(-1), low = new Int32Array(n), size = new Int32Array(n), parent = new Int32Array(n).fill(-1);
    const cut = new Uint8Array(n), separated = new Int32Array(n);
    const pieces: number[][] = Array.from({ length: n }, () => []);
    let time = 0;
    for (let root = 0; root < n; root++) {
        if (disc[root] !== -1) continue;
        const stack = [root], pos = new Map<number, number>();
        disc[root] = low[root] = time++;
        size[root] = 1;
        while (stack.length) {
            const v = stack[stack.length - 1];
            const i = pos.get(v) ?? 0;
            if (i < adj[v].length) {
                pos.set(v, i + 1);
                const w = adj[v][i];
                if (disc[w] === -1) {
                    parent[w] = v;
                    disc[w] = low[w] = time++;
                    size[w] = 1;
                    stack.push(w);
                } else if (w !== parent[v]) low[v] = Math.min(low[v], disc[w]);
            } else {
                stack.pop();
                const p = parent[v];
                if (p !== -1) {
                    low[p] = Math.min(low[p], low[v]);
                    size[p] += size[v];
                    if (low[v] >= disc[p]) pieces[p].push(size[v]);
                }
            }
        }
        const total = size[root];
        if (total === 1) continue;
        for (let v = 0; v < n; v++) {
            if (disc[v] < disc[root] || (!pieces[v].length && v !== root)) continue;
            const list = [...pieces[v]];
            if (v !== root) list.push(total - 1 - list.reduce((a, b) => a + b, 0)); // the part still attached above v
            const parts = list.filter(x => x > 0);
            if (parts.length >= 2) {
                cut[v] = 1;
                separated[v] = parts.reduce((a, b) => a + b, 0) - Math.max(...parts);
            }
        }
    }
    return { cut, separated };
}
