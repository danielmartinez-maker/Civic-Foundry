import assert from 'node:assert/strict';
import test from 'node:test';
import { MiniatureCameraController } from '../src/rendering/3d/MiniatureCameraController.ts';

const TAU = Math.PI * 2;
const normalizeAngle = (value: number): number => ((value % TAU) + TAU) % TAU;

test('miniature camera supports deterministic orbit, zoom, and ground-plane pan', () => {
  const camera = new MiniatureCameraController({
    target: { x: 0, y: 0, z: 0 },
    radius: 120,
    azimuthRad: Math.PI / 4,
    elevationRad: 0.9,
  });
  const initial = camera.snapshot();

  camera.orbit(120, -40);
  camera.zoomBy(0.8);
  camera.pan(10, -5);

  const next = camera.snapshot();
  assert.notDeepEqual(next, initial);
  assert.ok(next.radius >= 12 && next.radius <= 5000);
  assert.equal(next.target.y, 0);
});

test('miniature camera radius is clamped to the approved navigation envelope', () => {
  const camera = new MiniatureCameraController({
    target: { x: 0, y: 0, z: 0 },
    radius: 120,
    azimuthRad: 0,
    elevationRad: 0.9,
  });

  camera.zoomBy(0.000001);
  assert.equal(camera.snapshot().radius, 12);
  camera.zoomBy(1_000_000);
  assert.equal(camera.snapshot().radius, 5000);
});

test('quarter-turn rotation changes azimuth by exactly ninety degrees', () => {
  const camera = new MiniatureCameraController({
    target: { x: 0, y: 0, z: 0 },
    radius: 120,
    azimuthRad: Math.PI / 4,
    elevationRad: 0.9,
  });
  const before = camera.snapshot().azimuthRad;

  camera.rotateQuarterTurn(1);

  const delta = normalizeAngle(camera.snapshot().azimuthRad - before);
  assert.ok(Math.abs(delta - Math.PI / 2) < 1e-12);
});
