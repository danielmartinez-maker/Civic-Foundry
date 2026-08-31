import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const text = (path: string) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('shared presentation renderer owns runtime-neutral backend, input, selection, and diagnostics contracts', async () => {
  const source = await text('src/rendering/PresentationRenderer.ts');

  assert.match(source, /export type PresentationBackend\s*=\s*'legacy-gpu'\s*\|\s*'civic-3d'/);
  assert.match(source, /export type RendererCameraInputOwner\s*=\s*'app'\s*\|\s*'renderer'/);
  assert.match(source, /export type RenderPoint\s*=\s*Readonly<\{\s*x:\s*number;\s*y:\s*number\s*\}>/s);
  assert.match(source, /export type CellSelection\s*=\s*Readonly<\{\s*x:\s*number;\s*y:\s*number\s*\}>\s*\|\s*null/s);
  for (const field of [
    'backend',
    'loadedPrototypes',
    'buildingInstances',
    'fallbackBuildings',
    'assetRequests',
    'cacheHits',
    'cacheMisses',
  ]) {
    assert.match(source, new RegExp(`${field}:\\s*`));
  }
  assert.match(source, /export interface PresentationRenderer/);
  assert.match(source, /readonly backend:\s*PresentationBackend/);
  assert.match(source, /readonly cameraInputOwner:\s*RendererCameraInputOwner/);
  assert.match(source, /debugSceneStats\(\):\s*PresentationSceneStats/);
  assert.match(source, /dispose\(\):\s*void/);
});

test('legacy GPU renderer implements the shared contract without owning its types', async () => {
  const source = await text('src/rendering/gpu/GpuWorldRenderer.ts');

  assert.match(source, /implements PresentationRenderer/);
  assert.match(source, /readonly backend\s*=\s*'legacy-gpu'\s+as const/);
  assert.match(source, /readonly cameraInputOwner\s*=\s*'app'\s+as const/);
  assert.match(source, /debugSceneStats\(\):\s*PresentationSceneStats/);
  assert.match(source, /dispose\(\):\s*void/);
  assert.doesNotMatch(source, /export type CellSelection\s*=/);
});

test('GameApp delegates renderer construction to the backend factory and keeps legacy GPU as the default', async () => {
  const source = await text('src/app/GameApp.ts');

  assert.match(source, /rendering\/PresentationRenderer\.js/);
  assert.match(source, /rendering\/PresentationRendererFactory\.js/);
  assert.match(source, /readonly renderer:\s*PresentationRenderer/);
  assert.match(
    source,
    /this\.renderer\s*=\s*createPresentationRenderer\(\s*this\.elements\.canvas,\s*options\?\.presentationRendererBackend\s*\?\?\s*'legacy-gpu'/s,
  );
  assert.doesNotMatch(source, /this\.renderer\s*=\s*new GpuWorldRenderer\(/);
});
