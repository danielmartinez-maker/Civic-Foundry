import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function source(path: string): Promise<string> {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('GameApp owns cancellable frame, listener, timer, and renderer teardown', async () => {
  const text = await source('src/app/GameApp.ts');
  assert.match(text, /dispose\s*\(/);
  assert.match(text, /cancelAnimationFrame\s*\(/);
  assert.match(text, /removeEventListener\s*\(\s*['"]keydown['"]/);
  assert.match(text, /clearTimeout\s*\(/);
  assert.match(text, /renderer\.destroy\s*\(/);
});

test('LandHousingUiController owns and releases RAF, listeners, and injected canvas', async () => {
  const text = await source('src/ui/LandHousingUiController.ts');
  assert.match(text, /AbortController/);
  assert.match(text, /dispose\s*\(/);
  assert.match(text, /cancelAnimationFrame\s*\(/);
  assert.match(text, /overlayCanvas\.remove\s*\(/);
});

test('UrbanFabricUiController owns and releases listeners and injected presentation state', async () => {
  const text = await source('src/ui/UrbanFabricUiController.ts');
  assert.match(text, /AbortController/);
  assert.match(text, /dispose\s*\(/);
  assert.match(text, /section\.remove\s*\(/);
  assert.match(text, /delete\s+this\.app\.urbanFabricOverlayMode/);
});

test('GpuWorldRenderer owns explicit async-safe Pixi destruction', async () => {
  const text = await source('src/rendering/gpu/GpuWorldRenderer.ts');
  assert.match(text, /initialization/);
  assert.match(text, /disposed/);
  assert.match(text, /destroy\s*\(/);
  assert.match(text, /application\.destroy\s*\(/);
});

test('runtime bootstrap owns presentation components in reverse teardown order', async () => {
  const runtime = await source('src/app/CivicRuntime.ts');
  assert.match(runtime, /class CivicRuntime/);
  assert.match(runtime, /async dispose\s*\(/);
  const land = runtime.indexOf('landHousingUi.dispose');
  const urban = runtime.indexOf('urbanFabricUi.dispose');
  const app = runtime.indexOf('app.dispose');
  assert.ok(land >= 0 && urban > land && app > urban, 'runtime must tear down dependents before GameApp');
});
