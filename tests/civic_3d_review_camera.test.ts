import assert from 'node:assert/strict';
import test from 'node:test';
import { Civic3DWorldRenderer } from '../src/rendering/3d/Civic3DWorldRenderer.ts';
import { MiniatureCameraController } from '../src/rendering/3d/MiniatureCameraController.ts';

test('fixed review camera state can be restored exactly and deterministically', () => {
  const camera = new MiniatureCameraController({
    target: { x: 0, y: 0, z: 0 },
    radius: 120,
    azimuthRad: Math.PI / 4,
    elevationRad: 0.9,
  });
  const review = Object.freeze({
    target: Object.freeze({ x: 120, y: 0, z: 100 }),
    radius: 72,
    azimuthRad: 5.48,
    elevationRad: 0.72,
  });

  camera.orbit(100, -50);
  camera.zoomBy(1.8);
  camera.pan(25, -10);
  camera.setState(review);
  assert.deepEqual(camera.snapshot(), review);

  camera.setState(review);
  assert.deepEqual(camera.snapshot(), review);
});

test('3D renderer exposes a presentation-only review camera setter', () => {
  assert.equal(typeof Civic3DWorldRenderer.prototype.setReviewCamera, 'function');
});
