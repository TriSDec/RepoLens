import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildCsp } from '../.test-build/csp.mjs';
import * as m from '../.test-build/map3d.mjs';

test('the origin projects to the centre of the viewport, and nearer points are larger and shifted by pan', () => {
  const cam = { ...m.DEFAULT_CAMERA, yaw: 0, pitch: 0, panX: 10, panY: -6 };
  const o = m.project(0, 0, 0, cam, 800, 600);
  assert.ok(Math.abs(o.sx - 410) < 1e-9 && Math.abs(o.sy - 294) < 1e-9);
  const near = m.project(0, 0, 0.8, cam, 800, 600), far = m.project(0, 0, -0.8, cam, 800, 600);
  assert.ok(near.scale > 1 && far.scale < 1 && near.depth > far.depth);
});

test('orbiting by a full turn returns to the same screen position; pitch is clamped at the poles', () => {
  const a = m.project(0.4, 0.2, -0.3, m.DEFAULT_CAMERA, 800, 600);
  const b = m.project(0.4, 0.2, -0.3, { ...m.DEFAULT_CAMERA, yaw: m.DEFAULT_CAMERA.yaw + Math.PI * 2 }, 800, 600);
  assert.ok(Math.abs(a.sx - b.sx) < 1e-6 && Math.abs(a.sy - b.sy) < 1e-6);
  const up = m.orbit(m.DEFAULT_CAMERA, 0, -1e6), down = m.orbit(m.DEFAULT_CAMERA, 0, 1e6);
  assert.equal(up.pitch, -m.MAX_PITCH);
  assert.equal(down.pitch, m.MAX_PITCH);
});

test('zooming about a point keeps the world point under the cursor fixed, within limits', () => {
  const cam = { ...m.DEFAULT_CAMERA, zoom: 1.3, panX: 20, panY: 12 };
  const before = m.project(0.3, -0.2, 0.1, cam, 900, 700);
  const next = m.zoomAt(cam, 1.7, before.sx, before.sy, 900, 700);
  const after = m.project(0.3, -0.2, 0.1, next, 900, 700);
  assert.ok(Math.abs(after.sx - before.sx) < 1e-6 && Math.abs(after.sy - before.sy) < 1e-6);
  assert.equal(m.zoomAt(cam, 1e9, 0, 0, 900, 700).zoom, m.MAX_ZOOM);
  assert.equal(m.zoomAt(cam, 1e-9, 0, 0, 900, 700).zoom, m.MIN_ZOOM);
});

test('panToCenter puts a world point in the middle of the viewport', () => {
  const cam = { ...m.DEFAULT_CAMERA, zoom: 2 };
  const pan = m.panToCenter(0.5, 0.1, -0.4, cam, 1000, 600);
  const p = m.project(0.5, 0.1, -0.4, { ...cam, ...pan }, 1000, 600);
  assert.ok(Math.abs(p.sx - 500) < 1e-6 && Math.abs(p.sy - 300) < 1e-6);
});

test('picking chooses the nearer of two overlapping points, ignores far clicks and handles empty input', () => {
  const sx = [100, 102, 400], sy = [100, 101, 300], depth = [-0.5, 0.6, 0], radius = [8, 8, 8];
  assert.equal(m.pick(sx, sy, depth, radius, 101, 100), 1, 'the nearer (higher depth) point wins');
  assert.equal(m.pick(sx, sy, depth, radius, 250, 200), -1);
  assert.equal(m.pick(sx, sy, depth, radius, 400, 300), 2);
  assert.equal(m.pick([], [], [], [], 1, 1), -1);
});

test('camera easing converges and settles exactly on the target', () => {
  const cur = { ...m.DEFAULT_CAMERA }, target = { yaw: 2, pitch: -0.4, zoom: 3, panX: 90, panY: -40 };
  let steps = 0;
  while (m.easeCamera(cur, target) && steps < 2000) steps++;
  assert.ok(steps < 600, `settled in ${steps} steps`);
  assert.deepEqual(cur, target);
});

test('the Content-Security-Policy forbids network access and inline scripts in production', () => {
  const csp = buildCsp('abc123', { dev: false, https: true });
  for (const must of ["default-src 'self'", "connect-src 'none'", "object-src 'none'", "frame-ancestors 'none'", "form-action 'none'", "worker-src 'self'", "script-src 'self' 'nonce-abc123' 'strict-dynamic'", 'upgrade-insecure-requests'])
    assert.ok(csp.includes(must), must);
  assert.ok(!/script-src[^;]*'unsafe-inline'/.test(csp) && !/script-src[^;]*'unsafe-eval'/.test(csp), 'no unsafe script sources');
  assert.ok(!/style-src 'self'[^;]*'unsafe-inline'/.test(csp.replace("style-src-attr 'unsafe-inline'", '')), 'no inline <style> without a nonce');
  assert.ok(!csp.includes('http:') && !csp.includes('https:') && !csp.includes('*'), 'no external origins or wildcards');
  const dev = buildCsp('abc123', { dev: true, https: false });
  assert.ok(dev.includes("'unsafe-eval'") && !dev.includes('upgrade-insecure-requests'));
});
