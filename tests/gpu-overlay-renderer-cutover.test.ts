import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const rendererUrl = new URL('../src/rendering/gpu/GpuWorldRenderer.ts', import.meta.url);

test('GPU world renderer routes specialized overlays through the retained coordinator', () => {
  const source = readFileSync(rendererUrl, 'utf8');

  assert.match(source, /GpuOverlayCoordinator/);
  assert.match(source, /debugOverlayStats\(\)/);
  assert.doesNotMatch(source, /const OVERLAY_COLORS/);
  assert.doesNotMatch(source, /drawOverlayTint\(/);
  assert.doesNotMatch(source, /private readonly overlayLayer = new Graphics\(\)/);
});
