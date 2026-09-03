import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_ISO_METRICS,
  inverseProjectPoint,
  inverseRotateWorldPoint,
  projectRotatedPoint,
  rotateWorldPoint,
} from '../src/rendering/isometric/IsometricProjection.ts';
import { IsometricCamera } from '../src/rendering/isometric/IsometricCamera.ts';

type CameraParityFixture = Readonly<{
  metrics: Readonly<{ tileWidth: number; tileHeight: number }>;
  world: Readonly<{ width: number; height: number }>;
  fractionalPoint: Readonly<{ x: number; y: number }>;
  cells: readonly Readonly<{ x: number; y: number }>[];
  focusWorld: Readonly<{ x: number; y: number }>;
  zoomCell: Readonly<{ x: number; y: number }>;
  zoomFactor: number;
  zoomMaxProbe: number;
  zoomMinProbe: number;
  zoomMax: number;
  zoomMin: number;
  outsideCanvas: Readonly<{ x: number; y: number }>;
}>;

const fixture = JSON.parse(
  readFileSync(new URL('./fixtures/isometric-camera-parity.json', import.meta.url), 'utf8'),
) as CameraParityFixture;
const size = fixture.world;

test('uses the shared 64x32 2:1 camera contract', () => {
  assert.deepEqual(DEFAULT_ISO_METRICS, fixture.metrics);
  assert.deepEqual(projectRotatedPoint(1, 0), { x: fixture.metrics.tileWidth / 2, y: fixture.metrics.tileHeight / 2 });
  assert.deepEqual(projectRotatedPoint(0, 1), { x: -fixture.metrics.tileWidth / 2, y: fixture.metrics.tileHeight / 2 });
});

test('projection round-trips the shared fractional camera point', () => {
  const p = projectRotatedPoint(fixture.fractionalPoint.x, fixture.fractionalPoint.y);
  const world = inverseProjectPoint(p.x, p.y);
  assert.ok(Math.abs(world.x - fixture.fractionalPoint.x) < 1e-9);
  assert.ok(Math.abs(world.y - fixture.fractionalPoint.y) < 1e-9);
});

test('all quarter turns round-trip authoritative coordinates', () => {
  const referenceCell = fixture.cells.at(-1);
  assert.ok(referenceCell);
  for (const turn of [0, 1, 2, 3] as const) {
    const r = rotateWorldPoint(referenceCell.x, referenceCell.y, size, turn);
    assert.deepEqual(inverseRotateWorldPoint(r.x, r.y, size, turn), referenceCell);
  }
});

test('camera projected centers pick the same shared authoritative cells across rotations', () => {
  const camera = new IsometricCamera();
  for (let turn = 0; turn < 4; turn += 1) {
    for (const cell of fixture.cells) {
      const p = camera.tileCenter(cell.x, cell.y, size);
      assert.deepEqual(camera.canvasToCell(p.x, p.y, size), cell);
    }
    camera.rotate(1);
  }
});

test('viewport-focused rotation keeps the shared focus world point at the same canvas position', () => {
  const camera = new IsometricCamera();
  const focusCanvas = camera.worldToCanvas(fixture.focusWorld.x, fixture.focusWorld.y, size);
  camera.rotateAroundCanvasPoint(1, size, focusCanvas);
  const after = camera.worldToCanvas(fixture.focusWorld.x, fixture.focusWorld.y, size);
  assert.ok(Math.abs(after.x - focusCanvas.x) < 1e-9);
  assert.ok(Math.abs(after.y - focusCanvas.y) < 1e-9);
  assert.deepEqual(camera.canvasToCell(after.x, after.y, size), fixture.focusWorld);
});

test('camera rejects the shared point outside the projected map', () => {
  const camera = new IsometricCamera();
  assert.equal(camera.canvasToCell(fixture.outsideCanvas.x, fixture.outsideCanvas.y, size), null);
});

test('zoom remains clamped and cursor anchored using the shared camera fixture', () => {
  const camera = new IsometricCamera();
  const anchor = camera.tileCenter(fixture.zoomCell.x, fixture.zoomCell.y, size);
  camera.zoomBy(fixture.zoomFactor, anchor.x, anchor.y);
  const after = camera.tileCenter(fixture.zoomCell.x, fixture.zoomCell.y, size);
  assert.ok(Math.abs(after.x - anchor.x) < 1e-9);
  assert.ok(Math.abs(after.y - anchor.y) < 1e-9);
  camera.zoomBy(fixture.zoomMaxProbe, anchor.x, anchor.y);
  assert.equal(camera.zoom, fixture.zoomMax);
  camera.zoomBy(fixture.zoomMinProbe, anchor.x, anchor.y);
  assert.equal(camera.zoom, fixture.zoomMin);
});
