import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_ISO_METRICS,
  inverseProjectPoint,
  inverseRotateWorldPoint,
  projectRotatedPoint,
  rotateWorldPoint,
} from '../src/rendering/isometric/IsometricProjection.ts';
import { IsometricCamera } from '../src/rendering/isometric/IsometricCamera.ts';

const size = { width: 40, height: 24 } as const;

test('uses the 64x32 2:1 contract', () => {
  assert.deepEqual(DEFAULT_ISO_METRICS, { tileWidth: 64, tileHeight: 32 });
  assert.deepEqual(projectRotatedPoint(1, 0), { x: 32, y: 16 });
  assert.deepEqual(projectRotatedPoint(0, 1), { x: -32, y: 16 });
});

test('projection round-trips fractional points', () => {
  const p = projectRotatedPoint(7.25, 11.75);
  const world = inverseProjectPoint(p.x, p.y);
  assert.ok(Math.abs(world.x - 7.25) < 1e-9);
  assert.ok(Math.abs(world.y - 11.75) < 1e-9);
});

test('all quarter turns round-trip authoritative coordinates', () => {
  for (const turn of [0, 1, 2, 3] as const) {
    const r = rotateWorldPoint(6, 9, size, turn);
    assert.deepEqual(inverseRotateWorldPoint(r.x, r.y, size, turn), { x: 6, y: 9 });
  }
});

test('camera projected centers pick the same authoritative cell across rotations', () => {
  const camera = new IsometricCamera();
  const cells = [{ x: 0, y: 0 }, { x: 39, y: 0 }, { x: 0, y: 23 }, { x: 39, y: 23 }, { x: 6, y: 9 }];
  for (let turn = 0; turn < 4; turn += 1) {
    for (const cell of cells) {
      const p = camera.tileCenter(cell.x, cell.y, size);
      assert.deepEqual(camera.canvasToCell(p.x, p.y, size), cell);
    }
    camera.rotate(1);
  }
});

test('viewport-focused rotation keeps the focus world point at the same canvas position', () => {
  const camera = new IsometricCamera();
  const focusWorld = { x: 10, y: 15 };
  const focusCanvas = camera.worldToCanvas(focusWorld.x, focusWorld.y, size);
  camera.rotateAroundCanvasPoint(1, size, focusCanvas);
  const after = camera.worldToCanvas(focusWorld.x, focusWorld.y, size);
  assert.ok(Math.abs(after.x - focusCanvas.x) < 1e-9);
  assert.ok(Math.abs(after.y - focusCanvas.y) < 1e-9);
  assert.deepEqual(camera.canvasToCell(after.x, after.y, size), focusWorld);
});

test('camera rejects points outside the projected map', () => {
  const camera = new IsometricCamera();
  assert.equal(camera.canvasToCell(-1000, -1000, size), null);
});

test('zoom remains clamped and cursor anchored', () => {
  const camera = new IsometricCamera();
  const anchor = camera.tileCenter(6, 9, size);
  camera.zoomBy(1.12, anchor.x, anchor.y);
  const after = camera.tileCenter(6, 9, size);
  assert.ok(Math.abs(after.x - anchor.x) < 1e-9);
  assert.ok(Math.abs(after.y - anchor.y) < 1e-9);
  camera.zoomBy(100, anchor.x, anchor.y);
  assert.equal(camera.zoom, 2.5);
  camera.zoomBy(0.0001, anchor.x, anchor.y);
  assert.equal(camera.zoom, 0.45);
});
