import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const text = (path: string) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('GameApp uses the GPU world renderer in the production path', async () => {
  const source = await text('src/app/GameApp.ts');
  assert.match(source, /rendering\/gpu\/GpuWorldRenderer\.ts/);
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
