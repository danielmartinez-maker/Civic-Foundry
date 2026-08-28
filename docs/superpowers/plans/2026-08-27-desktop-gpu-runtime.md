# Desktop GPU Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Civic Foundry's production Canvas2D world renderer with a PixiJS/WebGL renderer and add a secure Electron desktop runtime while preserving simulation/save authority and existing player controls.

**Architecture:** Keep `SimulationCore` and all authoritative domain systems unchanged. `GameApp` switches to a presentation-only `GpuWorldRenderer` that preserves the existing interaction-facing renderer API and uses `IsometricCamera` for all projection/input transforms. Electron is a secure local host around the same built `dist/` application; the existing TypeScript/static build copies PixiJS browser ESM to `dist/vendor/` and resolves it through an import map.

**Tech Stack:** TypeScript 5.8, PixiJS 8.20.x WebGL, Electron 44.x, Node test runner, existing isometric camera and policy tooling.

**Spec:** `docs/superpowers/specs/2026-08-27-desktop-gpu-runtime.md`

## Global Constraints

- Simulation, world, cadastral, transport, economy, and save systems remain authoritative and unchanged.
- Production startup/frame rendering must not call `getContext('2d')`.
- PixiJS initializes with `preference: 'webgl'` and `powerPreference: 'high-performance'`.
- Electron loads only local built application content with `nodeIntegration: false`, `contextIsolation: true`, and `sandbox: true`.
- No generic IPC bridge in tranche 1.
- Preserve `dist/` as the build output and retain the generated-atlas step.
- No save-version change.
- Windows target is current 64-bit Windows supported by Electron 44.

---

### Task 1: Lock the production GPU/desktop contracts with failing tests

**Files:**
- Create: `tests/desktop_gpu_runtime.test.ts`
- Test: `tests/desktop_gpu_runtime.test.ts`

**Interfaces:**
- Consumes: repository files via `node:fs/promises`.
- Produces: regression gates for the exact production imports, Pixi initialization policy, Electron security policy, import-map/vendor-copy build contract, and dependency scripts.

- [ ] **Step 1: Write the failing contract tests**

```ts
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
```

- [ ] **Step 2: Run the new test and verify RED**

Run: `node --experimental-strip-types --test tests/desktop_gpu_runtime.test.ts`

Expected: FAIL because `GpuWorldRenderer.ts` and `desktop/main.mjs` do not exist and `GameApp` still imports the Canvas renderer.

- [ ] **Step 3: Commit the RED test only**

```bash
git add tests/desktop_gpu_runtime.test.ts
git commit -m "test: define desktop GPU runtime contract"
```

---

### Task 2: Introduce PixiJS/WebGL renderer and cut the production path over

**Files:**
- Create: `src/rendering/gpu/GpuWorldRenderer.ts`
- Modify: `src/app/GameApp.ts` (renderer import/type only)
- Modify: `package.json`
- Modify: `package-lock.json`
- Test: `tests/desktop_gpu_runtime.test.ts`

**Interfaces:**
- Consumes: `SimulationCore`, `IsometricCamera`, `LEGACY_CELL_SIZE_METERS`, existing overlay mode types, `UrbanFabricOverlayMode`.
- Produces: `export class GpuWorldRenderer` with the same application-facing camera/input/draw interface as the old `WorldRenderer`.

- [ ] **Step 1: Add exact dependencies**

```json
{
  "dependencies": {
    "clipper2-ts": "2.0.1-18",
    "pixi.js": "8.20.1"
  },
  "devDependencies": {
    "electron": "44.0.0"
  }
}
```

Preserve all existing dev dependencies. Regenerate `package-lock.json` with the same exact versions.

- [ ] **Step 2: Implement the minimal GPU renderer needed by the contract and current `GameApp`**

Create `src/rendering/gpu/GpuWorldRenderer.ts` with:

```ts
import { Application, Container, Graphics } from 'pixi.js';
import type { SimulationCore } from '../../simulation/core/SimulationCore.ts';
import { LEGACY_CELL_SIZE_METERS, type WorldPoint } from '../../world/cadastre/Geometry.ts';
import type { TrafficOverlayMode } from '../TrafficOverlayLayer.ts';
import type { ServiceOverlayMode } from '../ServiceOverlayLayer.ts';
import type { TransitOverlayMode } from '../TransitOverlayLayer.ts';
import type { EconomyOverlayMode } from '../EconomyOverlayLayer.ts';
import type { UrbanFabricOverlayMode } from '../CadastralOverlayLayer.ts';
import { IsometricCamera } from '../isometric/IsometricCamera.ts';

export type GpuPoint = Readonly<{ x: number; y: number }>;
export type CellSelection = Readonly<{ x: number; y: number }> | null;
type RendererWorldSize = Readonly<{ width: number; height: number }>;

export class GpuWorldRenderer {
  readonly canvas: HTMLCanvasElement;
  private readonly camera = new IsometricCamera();
  private readonly application = new Application();
  private readonly terrainLayer = new Graphics();
  private readonly zoningLayer = new Graphics();
  private readonly roadLayer = new Graphics();
  private readonly objectLayer = new Graphics();
  private readonly vehicleLayer = new Graphics();
  private readonly overlayLayer = new Graphics();
  private readonly selectionLayer = new Graphics();
  private initialized = false;
  private lastWorldSize: RendererWorldSize | null = null;
  private urbanFabricOverlayMode: UrbanFabricOverlayMode = 'none';
  private urbanFabricSelectedParcelId: string | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    void this.initialize();
  }

  private async initialize(): Promise<void> {
    await this.application.init({
      canvas: this.canvas,
      preference: 'webgl',
      powerPreference: 'high-performance',
      antialias: true,
      autoDensity: true,
      background: '#11171b',
      resizeTo: this.canvas.parentElement ?? window,
    });
    const layers = new Container();
    layers.addChild(
      this.terrainLayer,
      this.zoningLayer,
      this.roadLayer,
      this.objectLayer,
      this.vehicleLayer,
      this.overlayLayer,
      this.selectionLayer,
    );
    this.application.stage.addChild(layers);
    this.initialized = true;
  }
}
```

Then implement the existing getters/transforms by delegating to `IsometricCamera`, including rotation around viewport center when a world size is known. Implement `draw()` by clearing only these persistent `Graphics` contexts and rebuilding GPU primitives from `SimulationCore` snapshots. Required base scene:

- every terrain cell as an isometric diamond, using stable biome colors and distinct water/unbuildable treatment;
- zoning list as translucent diamonds;
- roads as darker road-class diamonds plus a thin center stroke;
- buildings/services/utilities as projected block/marker primitives;
- traffic/service/transit/freight active vehicle snapshots as small circles/markers;
- selected cell and road-preview path;
- high-level tinting when any non-`none` overlay is active;
- urban-fabric selected parcel/overlay state remains stored and accepted by the facade even where specialized cadastral parity is deferred.

Use helper functions local to this file for diamond polygons, block drawing, and stable presentation colors. They must consume simulation state only; no mutation APIs may be called.

- [ ] **Step 3: Cut `GameApp` to the GPU facade**

Replace:

```ts
import { WorldRenderer, type CellSelection } from '../rendering/WorldRenderer.ts';
```

with:

```ts
import { GpuWorldRenderer, type CellSelection } from '../rendering/gpu/GpuWorldRenderer.ts';
```

and change the field/constructor from `WorldRenderer` to `GpuWorldRenderer`. Do not change tool, simulation, save, input, HUD, inspector, or frame-loop semantics.

- [ ] **Step 4: Run focused tests and typecheck**

Run:

```bash
node --experimental-strip-types --test tests/desktop_gpu_runtime.test.ts tests/isometric_*.test.ts
npm run typecheck
```

Expected: GPU import/initialization tests pass; desktop/build contract tests remain RED until Task 3.

- [ ] **Step 5: Commit the GPU cutover**

```bash
git add src/rendering/gpu/GpuWorldRenderer.ts src/app/GameApp.ts package.json package-lock.json
git commit -m "feat: cut production rendering over to PixiJS WebGL"
```

---

### Task 3: Extend the static build and add the secure Electron host

**Files:**
- Create: `desktop/main.mjs`
- Modify: `scripts/build.mjs`
- Modify: `index.html`
- Modify: `package.json`
- Test: `tests/desktop_gpu_runtime.test.ts`
- Test: `tests/build_script.test.ts`

**Interfaces:**
- Consumes: built `dist/index.html` and local `dist/vendor/pixi.mjs`.
- Produces: `npm run desktop` native desktop launch path; no IPC API.

- [ ] **Step 1: Add PixiJS vendor-copy behavior to the existing build**

Extend `copyOptionalVendorFiles(root)` so it also requires and copies:

```text
node_modules/pixi.js/dist/pixi.mjs -> dist/vendor/pixi.mjs
```

PixiJS is mandatory after this migration. If its source file is absent, throw a clear build error instead of silently producing a broken runtime. Keep Clipper behavior unchanged.

- [ ] **Step 2: Add the import map to `index.html`**

Before the application's module script, add:

```html
<script type="importmap">
  {
    "imports": {
      "pixi.js": "./vendor/pixi.mjs"
    }
  }
</script>
```

Do not load PixiJS from a CDN.

- [ ] **Step 3: Add the hardened Electron host**

Create `desktop/main.mjs`:

```js
import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

function createWindow() {
  const window = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#11171b',
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.once('ready-to-show', () => window.show());
  void window.loadFile(join(root, 'dist', 'index.html'));
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
```

- [ ] **Step 4: Add the desktop launch script**

Set:

```json
"desktop": "npm run build && electron desktop/main.mjs"
```

- [ ] **Step 5: Run the desktop/build contract tests**

Run:

```bash
node --experimental-strip-types --test tests/desktop_gpu_runtime.test.ts tests/build_script.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit the desktop/build integration**

```bash
git add desktop/main.mjs scripts/build.mjs index.html package.json package-lock.json tests/desktop_gpu_runtime.test.ts tests/build_script.test.ts
git commit -m "feat: add secure Windows desktop runtime"
```

---

### Task 4: Documentation, repository policy compatibility, and complete verification

**Files:**
- Modify: `README.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/ENGINEERING_STANDARDS.md` only if the current dependency/build wording contradicts the approved GPU runtime
- Modify: formatter scripts/globs only if required by verification

**Interfaces:**
- Consumes: completed GPU/desktop runtime.
- Produces: documented development and desktop launch path with explicit presentation authority rules.

- [ ] **Step 1: Update runtime documentation**

Document:

- PixiJS/WebGL is the production world renderer;
- Electron is the desktop host;
- Canvas renderer files are migration-only and no longer the production path;
- simulation remains authoritative and renderer read-only;
- `npm run build`, `npm run dev`, and `npm run desktop` usage;
- Windows 64-bit desktop is the primary distribution target for this migration.

- [ ] **Step 2: Run the complete repository verification gate**

Run:

```bash
npm run verify
```

Expected: PASS with no formatting, lint, architecture, typecheck, unit-test, asset-policy, asset-generation, or build failures.

- [ ] **Step 3: Run browser smoke tests against the GPU production path**

Run:

```bash
npm run test:smoke
npm run test:smoke:phase7
npm run test:smoke:urban-fabric
npm run test:smoke:isometric
python tests/smoke/isometric_visual_smoke.py
```

Expected: all pass using the PixiJS/WebGL production renderer. Any smoke failure caused by a Canvas-specific visual assertion must be replaced with a renderer-neutral behavioral assertion only if the new assertion preserves the original gameplay contract.

- [ ] **Step 4: Confirm no authoritative-domain drift**

Run:

```bash
git diff --name-only main...HEAD
```

Expected: no files under `src/simulation/`, `src/world/`, `src/save/`, or authoritative data/domain directories.

- [ ] **Step 5: Commit documentation/verification fixes**

```bash
git add README.md docs/ARCHITECTURE.md docs/ENGINEERING_STANDARDS.md package.json scripts tests

git commit -m "docs: document desktop GPU runtime"
```

- [ ] **Step 6: Re-run `npm run verify` and all smoke gates after the final commit**

Expected: PASS before the branch is presented for merge.
