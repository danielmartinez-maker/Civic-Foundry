import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const text = (path: string) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('GameApp uses the shared presentation contract while legacy GPU remains the default production path', async () => {
  const source = await text('src/app/GameApp.ts');
  assert.match(source, /rendering\/PresentationRenderer\.ts/);
  assert.match(source, /rendering\/gpu\/GpuWorldRenderer\.ts/);
  assert.match(source, /readonly renderer:\s*PresentationRenderer/);
  assert.match(source, /new GpuWorldRenderer\(canvas\)/);
  assert.doesNotMatch(source, /rendering\/WorldRenderer\.ts/);
});

test('GPU renderer selects WebGL and never acquires a Canvas2D context', async () => {
  const source = await text('src/rendering/gpu/GpuWorldRenderer.ts');
  assert.match(source, /preference:\s*['"]webgl['"]/);
  assert.match(source, /powerPreference:\s*['"]high-performance['"]/);
  assert.doesNotMatch(source, /getContext\(\s*['"]2d['"]\s*\)/);
  assert.doesNotMatch(source, /CanvasRenderingContext2D/);
});

test('desktop host loads local content with hardened BrowserWindow settings', async () => {
  const source = await text('desktop/main.mjs');
  assert.match(source, /loadFile\(/);
  assert.match(source, /nodeIntegration:\s*false/);
  assert.match(source, /contextIsolation:\s*true/);
  assert.match(source, /sandbox:\s*true/);
  assert.match(source, /setWindowOpenHandler/);
  assert.match(source, /will-navigate/);
});

test('static build vendors PixiJS and index resolves the bare module locally', async () => {
  const build = await text('scripts/build.mjs');
  const html = await text('index.html');
  assert.match(build, /pixi\.mjs/);
  assert.match(build, /node_modules[\s\S]*pixi\.js[\s\S]*dist/);
  assert.match(html, /type=['"]importmap['"]/);
  assert.match(html, /"pixi\.js"\s*:\s*"\.\/vendor\/pixi\.mjs"/);
});

test('package metadata exposes GPU and desktop dependencies and launch script', async () => {
  const packageJson = JSON.parse(await text('package.json')) as {
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  assert.match(packageJson.dependencies?.['pixi.js'] ?? '', /^8\.20\./);
  assert.match(packageJson.devDependencies?.electron ?? '', /^44\./);
  assert.equal(packageJson.scripts?.desktop, 'npm run build && electron desktop/main.mjs');
});

test('3D tranche pins Babylon and glTF Transform while preserving the local import-map runtime', async () => {
  const packageJson = JSON.parse(await text('package.json')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const html = await text('index.html');
  const build = await text('scripts/build.mjs');

  assert.equal(packageJson.dependencies?.['@babylonjs/core'], '9.23.0');
  assert.equal(packageJson.dependencies?.['@babylonjs/loaders'], '9.23.0');
  assert.equal(packageJson.devDependencies?.['@gltf-transform/core'], '4.4.2');
  assert.equal(packageJson.devDependencies?.['@gltf-transform/functions'], '4.4.2');
  assert.match(html, /"@babylonjs\/core\/"\s*:\s*"\.\/vendor\/@babylonjs\/core\/"/);
  assert.match(html, /"@babylonjs\/loaders\/"\s*:\s*"\.\/vendor\/@babylonjs\/loaders\/"/);
  assert.match(build, /@babylonjs[\s\S]*core/);
  assert.match(build, /@babylonjs[\s\S]*loaders/);
});
