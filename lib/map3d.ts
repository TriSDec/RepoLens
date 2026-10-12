// Pure 3D helpers for the mind map: a turntable camera with perspective projection, plus picking.
// No DOM access here, so the maths is easy to test.

export type Camera = { yaw: number; pitch: number; zoom: number; panX: number; panY: number };

export const DEFAULT_CAMERA: Camera = { yaw: 0.55, pitch: 0.32, zoom: 1, panX: 0, panY: 0 };
export const PERSPECTIVE = 3.2; // eye distance from the origin in world units; lower = stronger perspective
export const MIN_ZOOM = 0.35;
export const MAX_ZOOM = 14;
export const MAX_PITCH = 1.45;

export type Projected = { sx: number; sy: number; /** -1 (far) .. 1 (near) */ depth: number; /** perspective scale, ~1 at the centre */ scale: number };

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Pixels per world unit at zoom 1 for a viewport. */
export const unitFor = (w: number, h: number) => Math.min(w, h) * 0.42;

export function project(x: number, y: number, z: number, cam: Camera, w: number, h: number, out: Projected = { sx: 0, sy: 0, depth: 0, scale: 1 }): Projected {
    const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw), cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    const x1 = x * cy + z * sy;
    const z1 = -x * sy + z * cy;
    const y2 = y * cp - z1 * sp;
    const z2 = y * sp + z1 * cp;
    const scale = PERSPECTIVE / Math.max(0.4, PERSPECTIVE - z2); // nearer (larger z2) = bigger
    const unit = unitFor(w, h) * cam.zoom;
    out.sx = w / 2 + cam.panX + x1 * unit * scale;
    out.sy = h / 2 + cam.panY - y2 * unit * scale;
    out.depth = clamp(z2, -1.2, 1.2) / 1.2;
    out.scale = scale;
    return out;
}

/** The pan that brings a world point to the centre of the viewport (at the camera's current angles and zoom). */
export function panToCenter(x: number, y: number, z: number, cam: Camera, w: number, h: number): { panX: number; panY: number } {
    const p = project(x, y, z, { ...cam, panX: 0, panY: 0 }, w, h);
    return { panX: w / 2 - p.sx, panY: h / 2 - p.sy };
}

/** Index of the point nearest to (px, py) within its pick radius, preferring points nearer the viewer. -1 if none. */
export function pick(sx: ArrayLike<number>, sy: ArrayLike<number>, depth: ArrayLike<number>, radius: ArrayLike<number>, px: number, py: number, slop = 4): number {
    let best = -1, bestScore = Infinity;
    for (let i = 0; i < sx.length; i++) {
        const dx = sx[i] - px, dy = sy[i] - py;
        const r = radius[i] + slop;
        const d2 = dx * dx + dy * dy;
        if (d2 > r * r) continue;
        const score = d2 - depth[i] * 40; // closer to the viewer wins ties
        if (score < bestScore) { bestScore = score; best = i; }
    }
    return best;
}

/** Orbit by pixel deltas, keeping the pitch from flipping over the poles. */
export function orbit(cam: Camera, dx: number, dy: number): Camera {
    return { ...cam, yaw: cam.yaw + dx * 0.0062, pitch: clamp(cam.pitch + dy * 0.0062, -MAX_PITCH, MAX_PITCH) };
}

/** Zoom about a screen point so the point under the cursor stays put. */
export function zoomAt(cam: Camera, factor: number, px: number, py: number, w: number, h: number): Camera {
    const zoom = clamp(cam.zoom * factor, MIN_ZOOM, MAX_ZOOM);
    const k = zoom / cam.zoom;
    const cx = w / 2, cy = h / 2;
    return { ...cam, zoom, panX: px - cx - (px - cx - cam.panX) * k, panY: py - cy - (py - cy - cam.panY) * k };
}

/** A zoom that frames the data, given the radius that contains most of it (outliers may sit outside the frame). */
export function fitZoom(radius: number): number {
    return clamp(1.2 / Math.max(radius, 0.2), 0.6, 4);
}

/** Smoothly move one camera toward another. Returns true while still moving. */
export function easeCamera(cur: Camera, target: Camera, rate = 0.16): boolean {
    let moving = false;
    for (const k of ['yaw', 'pitch', 'panX', 'panY'] as const) {
        const d = target[k] - cur[k];
        if (Math.abs(d) > 0.0005) { cur[k] += d * rate; moving = true; } else cur[k] = target[k];
    }
    const dz = Math.log(target.zoom / cur.zoom);
    if (Math.abs(dz) > 0.0008) { cur.zoom *= Math.exp(dz * rate); moving = true; } else cur.zoom = target.zoom;
    return moving;
}
