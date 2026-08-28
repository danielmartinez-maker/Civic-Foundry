# Civic Foundry Windows Desktop + Babylon.js Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Civic Foundry's browser/Canvas2D production runtime with a secure Electron Windows desktop application whose city world is rendered entirely through Babylon.js while preserving the deterministic simulation and Save V9 compatibility chain.

**Architecture:** Preserve `SimulationCore`, `SimulationKernel`, `WorldFoundation`, `CadastralGraph`, existing gameplay domains, and Save V3–V9 hydration as authoritative. Add a secure Electron main/preload/renderer boundary, immutable renderer-facing snapshots, deterministic presentation deltas, and Babylon scene synchronization; migrate presentation through D0–D4, then remove the old Canvas/isometric runtime.

**Tech Stack:** Node.js 22, TypeScript 5.8.3, Electron 44.0.0, electron-vite 5.0.0, electron-builder 26.15.3 with NSIS, `@babylonjs/core` 9.23.0, `@babylonjs/loaders` 9.23.0, Playwright 1.62.1 for packaged Electron smoke automation, Node test runner, ESLint 10, Prettier 3, `clipper2-ts` 2.0.1-18.

**Spec:** `docs/superpowers/specs/2026-08-27-windows-desktop-babylon-migration-design.md`

## Global Constraints

- Implement in order: D0 → D1 → D2 → D3 → D4. Do not begin 3R until D4 is accepted.
- `SimulationKernel` remains the deterministic scheduler/time authority. Rendering frame rate never changes authoritative outcomes.
- `WorldFoundation` remains the sole physical/geographic authority. `CadastralGraph` remains the sole legal-land/topology authority.
- Babylon state is disposable presentation state. Presentation reads immutable snapshots and emits gameplay intent through existing simulation entry points.
- Save V9 remains the default schema. V3–V9 hydration remains supported. Desktop storage alone must not create Save V10.
- Electron renderer uses `contextIsolation: true`, `nodeIntegration: false`, sandbox where compatible, restrictive navigation/CSP, and an allow-listed preload bridge.
- Renderer code never receives arbitrary filesystem paths, general `ipcRenderer`, shell/process authority, or Node globals.
- WebGL2 is the required rendering baseline. WebGPU is outside this implementation plan.
- Desktop storage root is `%APPDATA%\Civic Foundry\`; desktop saves use `.cfsave`, atomic same-directory replacement, previous-good preservation, and three rotating autosaves.
- Autosave cadence is five real-time minutes when a city is loaded and authoritative state has changed since the last successful save.
- D1 must launch through Babylon without importing or invoking the Canvas2D world renderer. D4 removes every supported production Canvas2D world-rendering path.
- Reference fixture: 2,000 buildings, 1,000 moving vehicles, 5,000 repeated props, one analytical overlay; 1080p target median ≥60 FPS and 1% low ≥45 FPS after 10-second warmup over 30-second measurement.
- Stress fixture: 5,000 buildings, 2,000 moving vehicles, 20,000 repeated props, one analytical overlay; 1080p acceptance median ≥30 FPS and 1% low ≥22 FPS.
- If migration reveals a simulation bug, fix it narrowly with a regression test. Do not redesign transportation, households, economics, politics, region scale, or save authority under this plan.

---

## Locked Cross-Task Interfaces

These names are introduced by the tasks below and must remain consistent unless the same commit updates all consumers and tests.

```ts
export type DesktopResult<T> = Readonly<
  | { ok: true; value: T }
  | { ok: false; code: string; message: string }
>;

export type SaveDescriptor = Readonly<{
  name: string;
  modifiedMs: number;
  autosave: boolean;
}>;

export type SaveGameRequest = Readonly<{ name: string; save: unknown }>;
export type LoadGameRequest = Readonly<{ name: string }>;
export type ImportSaveRequest = Readonly<{ name?: string }>;
export type AutosaveRequest = Readonly<{ slot: 0 | 1 | 2; save: unknown }>;
export type DesktopSettings = Readonly<{ tiltShiftEnabled: boolean; renderScale: number }>;

export interface DesktopApi {
  listSaves(): Promise<readonly SaveDescriptor[]>;
  saveGame(request: SaveGameRequest): Promise<DesktopResult<SaveDescriptor>>;
  loadGame(request: LoadGameRequest): Promise<DesktopResult<unknown>>;
  importSave(request: ImportSaveRequest): Promise<DesktopResult<SaveDescriptor>>;
  writeAutosave(request: AutosaveRequest): Promise<DesktopResult<SaveDescriptor>>;
  readSettings(): Promise<DesktopResult<DesktopSettings>>;
  writeSettings(settings: DesktopSettings): Promise<DesktopResult<DesktopSettings>>;
}
```

`importSave()` opens a native file picker in the Electron main process. The renderer never supplies or receives an arbitrary path.

```ts
export type CityPresentationSnapshot = Readonly<{
  revision: number;
  tick: number;
  world: WorldPresentation;
  terrain: readonly TerrainPresentationCell[];
  parcels: readonly ParcelPresentation[];
  buildings: readonly BuildingPresentation[];
  roads: readonly RoadPresentation[];
  trafficVehicles: readonly VehiclePresentation[];
  serviceVehicles: readonly VehiclePresentation[];
  transitVehicles: readonly VehiclePresentation[];
  freightVehicles: readonly VehiclePresentation[];
  facilities: readonly FacilityPresentation[];
  props: readonly PropPresentation[];
  overlays: OverlayPresentation;
  hud: HudPresentation;
}>;
```

`revision` is presentation-local. `DesktopApp` increments it whenever it publishes state after an accepted authoritative command or a simulation tick batch, including edits while paused. It is never serialized into Save V9.

```ts
export type EntityDelta<T extends { id: string }> = Readonly<{
  created: readonly T[];
  updated: readonly T[];
  removedIds: readonly string[];
}>;

export type PresentationDelta = Readonly<{
  revision: number;
  terrainChanged: boolean;
  parcels: EntityDelta<ParcelPresentation>;
  buildings: EntityDelta<BuildingPresentation>;
  roads: EntityDelta<RoadPresentation>;
  trafficVehicles: EntityDelta<VehiclePresentation>;
  serviceVehicles: EntityDelta<VehiclePresentation>;
  transitVehicles: EntityDelta<VehiclePresentation>;
  freightVehicles: EntityDelta<VehiclePresentation>;
  facilities: EntityDelta<FacilityPresentation>;
  props: EntityDelta<PropPresentation>;
  overlaysChanged: boolean;
  hudChanged: boolean;
}>;
```

---

# D0 — Windows Desktop Foundation

### Task 1: Pin the desktop toolchain and scalable repository formatting

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `.prettierignore`
- Create: `electron.vite.config.ts`
- Create: `electron-builder.yml`
- Create: `src/desktop/renderer/index.html`
- Test: `tests/desktop_toolchain.test.ts`

**Interfaces:**
- Produces canonical commands `desktop:dev`, `desktop:build`, `desktop:package`, `desktop:test`, `desktop:smoke`.
- Electron entry outputs are fixed at `out/main/index.js`, `out/preload/index.js`, and `out/renderer/`.

- [ ] **Step 1: Write the failing toolchain test**

```ts
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('desktop toolchain is pinned and has a fixed main entry', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.main, 'out/main/index.js');
  assert.equal(pkg.scripts['desktop:dev'], 'electron-vite dev');
  assert.equal(pkg.scripts['desktop:package'], 'npm run desktop:build && electron-builder --win nsis');
  assert.equal(pkg.dependencies['@babylonjs/core'], '9.23.0');
  assert.equal(pkg.dependencies['@babylonjs/loaders'], '9.23.0');
  assert.equal(pkg.devDependencies.electron, '44.0.0');
  assert.equal(pkg.devDependencies['electron-vite'], '5.0.0');
  assert.equal(pkg.devDependencies['electron-builder'], '26.15.3');
  assert.equal(pkg.devDependencies.playwright, '1.62.1');
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node --experimental-strip-types --test tests/desktop_toolchain.test.ts`

Expected: FAIL because the desktop configuration is absent.

- [ ] **Step 3: Install exact dependencies**

```bash
npm install --save-exact @babylonjs/core@9.23.0 @babylonjs/loaders@9.23.0
npm install --save-dev --save-exact electron@44.0.0 electron-vite@5.0.0 electron-builder@26.15.3 playwright@1.62.1 @types/node@22.20.1
```

Set:

```json
{
  "main": "out/main/index.js",
  "scripts": {
    "desktop:dev": "electron-vite dev",
    "desktop:build": "electron-vite build",
    "desktop:package": "npm run desktop:build && electron-builder --win nsis",
    "desktop:test": "npm test && npm run desktop:build",
    "desktop:smoke": "node tests/desktop/electron_smoke.mjs",
    "format": "prettier --write . --ignore-unknown",
    "format:check": "prettier --check . --ignore-unknown"
  }
}
```

- [ ] **Step 4: Exclude generated/package output from Prettier**

Add to `.prettierignore`:

```text
out/
release/
dist/
assets/runtime/**/*.glb
assets/runtime/**/*.gltf
assets/runtime/**/*.ktx2
assets/runtime/**/*.png
assets/runtime/**/*.jpg
```

- [ ] **Step 5: Add explicit electron-vite entries**

```ts
import { defineConfig } from 'electron-vite';

export default defineConfig({
  main: {
    build: {
      outDir: 'out/main',
      lib: { entry: 'src/desktop/main/ElectronMain.ts' },
      rollupOptions: { output: { entryFileNames: 'index.js' } },
    },
  },
  preload: {
    build: {
      outDir: 'out/preload',
      lib: { entry: 'src/desktop/preload/index.ts' },
      rollupOptions: { output: { entryFileNames: 'index.js' } },
    },
  },
  renderer: {
    root: 'src/desktop/renderer',
    build: { outDir: '../../../out/renderer', emptyOutDir: false },
  },
});
```

If electron-vite's installed type definitions require a syntactic adjustment to the Vite `build.lib` shape, preserve the exact entry/output contract above and add a regression assertion for the resulting files.

- [ ] **Step 6: Add initial Windows package configuration**

`electron-builder.yml`:

```yaml
appId: com.civicfoundry.desktop
productName: Civic Foundry
directories:
  output: release
files:
  - out/**/*
win:
  target:
    - nsis
nsis:
  oneClick: false
  allowToChangeInstallationDirectory: true
```

Do not package `assets/runtime/` until D3 introduces its validated manifest.

- [ ] **Step 7: Add the renderer HTML shell**

`src/desktop/renderer/index.html` contains `#app`, a restrictive CSP allowing only self-hosted scripts/styles/images and WebGL resources, and module entry `/src/main.ts`.

- [ ] **Step 8: Verify GREEN and commit**

```bash
node --experimental-strip-types --test tests/desktop_toolchain.test.ts
npm run format:check
npm run typecheck
npm test
git add package.json package-lock.json .prettierignore electron.vite.config.ts electron-builder.yml src/desktop/renderer/index.html tests/desktop_toolchain.test.ts
git commit -m "build: add desktop Electron toolchain"
```

---

### Task 2: Implement the secure Electron main/preload boundary

**Files:**
- Create: `src/desktop/shared/DesktopApi.ts`
- Create: `src/desktop/main/WindowOptions.ts`
- Create: `src/desktop/main/WindowManager.ts`
- Create: `src/desktop/main/ElectronMain.ts`
- Create: `src/desktop/preload/index.ts`
- Create: `src/desktop/renderer/src/global.d.ts`
- Test: `tests/desktop_security.test.ts`

**Interfaces:**
- Produces `DesktopApi`, `buildWindowOptions(preloadPath)`, `createMainWindow()`, and `window.civicDesktop`.
- No storage call returns a native path to renderer code.

- [ ] **Step 1: Write the failing security test**

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildWindowOptions } from '../src/desktop/main/WindowOptions.ts';

test('desktop renderer receives no Node integration', () => {
  const options = buildWindowOptions('C:/preload.js');
  assert.equal(options.webPreferences?.contextIsolation, true);
  assert.equal(options.webPreferences?.nodeIntegration, false);
  assert.equal(options.webPreferences?.sandbox, true);
  assert.equal(options.webPreferences?.preload, 'C:/preload.js');
});
```

- [ ] **Step 2: Verify RED**

Run: `node --experimental-strip-types --test tests/desktop_security.test.ts`

- [ ] **Step 3: Define `DesktopApi` exactly as locked above**

Implement the shared types in `src/desktop/shared/DesktopApi.ts`. `SaveDescriptor` exposes logical names/metadata only. `ImportSaveRequest` contains only an optional destination name.

- [ ] **Step 4: Implement secure window creation**

`WindowOptions.ts` returns `BrowserWindowConstructorOptions` with `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, fixed preload. `WindowManager.ts` denies new windows and blocks navigation away from the known dev URL or packaged renderer file URL.

- [ ] **Step 5: Implement preload allow-list**

Expose only:

```ts
contextBridge.exposeInMainWorld('civicDesktop', {
  listSaves: () => ipcRenderer.invoke('civic:list-saves'),
  saveGame: (request) => ipcRenderer.invoke('civic:save-game', request),
  loadGame: (request) => ipcRenderer.invoke('civic:load-game', request),
  importSave: (request) => ipcRenderer.invoke('civic:import-save', request),
  writeAutosave: (request) => ipcRenderer.invoke('civic:write-autosave', request),
  readSettings: () => ipcRenderer.invoke('civic:read-settings'),
  writeSettings: (settings) => ipcRenderer.invoke('civic:write-settings', settings),
} satisfies DesktopApi);
```

Do not expose `ipcRenderer` itself.

- [ ] **Step 6: Implement lifecycle without fake storage success**

`ElectronMain.ts` owns `app.whenReady()`, window creation, `window-all-closed`, and platform lifecycle. Do not register fake-success persistence handlers; Task 3 adds the real handlers.

- [ ] **Step 7: Verify and commit**

```bash
node --experimental-strip-types --test tests/desktop_security.test.ts
npm run desktop:build
npm run typecheck
git add src/desktop tests/desktop_security.test.ts
git commit -m "feat: add secure Electron process boundary"
```

---

### Task 3: Add atomic native Save V9 storage, native import selection, and rotating autosaves

**Files:**
- Create: `src/desktop/main/AtomicFileOps.ts`
- Create: `src/desktop/main/NativeStorage.ts`
- Create: `src/desktop/main/DesktopIpc.ts`
- Modify: `src/desktop/main/ElectronMain.ts`
- Test: `tests/native_storage.test.ts`
- Modify: `docs/SAVE_FORMAT.md`

**Interfaces:**
- `NativeStorage`: `initialize`, `listSaves`, `listAutosaves`, `writeSave`, `readSave`, `importSave(sourcePath, name?)`, `writeAutosave`, `readSettings`, `writeSettings`.
- `registerDesktopIpc(storage, chooseImportFile)` owns native file selection and returns logical descriptors only.

- [ ] **Step 1: Define injectable file operations for atomic-failure testing**

```ts
export type AtomicFileOps = Readonly<{
  mkdir: typeof import('node:fs/promises').mkdir;
  open: typeof import('node:fs/promises').open;
  rename: typeof import('node:fs/promises').rename;
  copyFile: typeof import('node:fs/promises').copyFile;
  readFile: typeof import('node:fs/promises').readFile;
  readdir: typeof import('node:fs/promises').readdir;
  stat: typeof import('node:fs/promises').stat;
  rm: typeof import('node:fs/promises').rm;
}>;
```

`NativeStorage` constructor accepts `(root: string, fileOps: AtomicFileOps = nodeAtomicFileOps)`.

- [ ] **Step 2: Write failing storage tests**

Using `mkdtemp()`:

```ts
const storage = new NativeStorage(root);
await storage.initialize();
const saved = await storage.writeSave('New Brighton', saveV9Fixture);
assert.equal(saved.name, 'New Brighton');
assert.deepEqual(await storage.readSave('New Brighton'), saveV9Fixture);
await assert.rejects(() => storage.writeSave('../escape', saveV9Fixture));
await storage.writeAutosave(0, saveV9Fixture);
await storage.writeAutosave(1, saveV9Fixture);
await storage.writeAutosave(2, saveV9Fixture);
assert.equal((await storage.listAutosaves()).length, 3);
```

Inject a `rename`/write failure after a prior valid save and assert the original destination remains byte-for-byte intact.

- [ ] **Step 3: Verify RED**

Run: `node --experimental-strip-types --test tests/native_storage.test.ts`

- [ ] **Step 4: Implement safe names and atomic writes**

Accept names matching `^[A-Za-z0-9 _.-]{1,80}$`, reject `.`/`..`, trailing dot/space, path separators, and reserved Windows device basenames. Write a same-directory temporary file, `FileHandle.sync()`, close, preserve current file as `.bak` when applicable, then same-volume `rename()`.

Storage layout:

```ts
savesDir = join(root, 'saves');
autosavesDir = join(root, 'autosaves');
settingsPath = join(root, 'settings.json');
logsDir = join(root, 'logs');
```

Autosave filenames are `autosave-1.cfsave`, `autosave-2.cfsave`, `autosave-3.cfsave`.

- [ ] **Step 5: Implement main-owned import picker**

`DesktopIpc.ts` uses:

```ts
const result = await dialog.showOpenDialog({
  properties: ['openFile'],
  filters: [{ name: 'Civic Foundry Saves', extensions: ['cfsave', 'json'] }],
});
```

Only the main process sees `result.filePaths[0]`; pass it internally to `storage.importSave()`. Cancellation returns `{ ok:false, code:'cancelled', message:'Import cancelled.' }`.

- [ ] **Step 6: Register validated IPC handlers**

Every handler validates object shape/name/slot/settings range and returns `DesktopResult<T>`. Catch native errors; never send raw error objects or file paths across IPC.

- [ ] **Step 7: Initialize under app data**

```ts
const storage = new NativeStorage(join(app.getPath('appData'), 'Civic Foundry'));
await storage.initialize();
registerDesktopIpc(storage, chooseImportFile);
```

- [ ] **Step 8: Verify Save V9 compatibility and commit**

```bash
node --experimental-strip-types --test tests/native_storage.test.ts
node --experimental-strip-types --test tests/save*.test.ts
npm run typecheck
git add src/desktop/main docs/SAVE_FORMAT.md tests/native_storage.test.ts
git commit -m "feat: add atomic desktop save storage"
```

Document `.cfsave` as a file convention containing the existing Save V9 JSON envelope; do not alter schema version.

---

### Task 4: Build the desktop management shell and D0 boot path

**Files:**
- Create: `src/desktop/renderer/src/main.ts`
- Create: `src/desktop/renderer/src/DesktopApp.ts`
- Create: `src/desktop/renderer/src/DesktopLayout.ts`
- Create: `src/desktop/renderer/src/desktop.css`
- Modify: `src/desktop/renderer/index.html`
- Test: `tests/desktop_layout.test.ts`

**Interfaces:**
- Produces stable roots/test IDs: `world-3d`, `hud`, `toolbox`, `inspector`, management panels.
- Does not import `GameApp` or `WorldRenderer`.

- [ ] **Step 1: Write failing layout test**

```ts
const html = desktopLayoutHtml();
assert.match(html, /data-testid="world-3d"/);
assert.match(html, /data-testid="toolbox"/);
assert.match(html, /data-testid="inspector"/);
assert.doesNotMatch(html, /world-canvas/);
```

- [ ] **Step 2: Verify RED**

Run: `node --experimental-strip-types --test tests/desktop_layout.test.ts`

- [ ] **Step 3: Implement the shell**

Use HTML/CSS for top HUD, left tools, center `<canvas data-testid="world-3d">`, right inspector, and expandable management sections. The canvas is a future WebGL surface only; no `getContext('2d')` call is permitted.

- [ ] **Step 4: Implement minimal desktop boot**

```ts
export class DesktopApp {
  constructor(private readonly root: HTMLElement) {}
  start(): void {
    this.root.innerHTML = desktopLayoutHtml();
    document.documentElement.dataset.desktopReady = 'true';
  }
}
```

- [ ] **Step 5: Verify no old app/renderer dependency and commit**

```bash
node --experimental-strip-types --test tests/desktop_layout.test.ts
npm run desktop:build
rg "GameApp|WorldRenderer|getContext\(['\"]2d" src/desktop
# expected: no matches
git add src/desktop/renderer tests/desktop_layout.test.ts
git commit -m "feat: add desktop renderer shell"
```

---

### Task 5: Package and smoke-test the D0 Windows application

**Files:**
- Create: `tests/desktop/electron_smoke.mjs`
- Create: `scripts/find-windows-package.mjs`
- Modify: `.github/workflows/ci.yml`
- Test: Windows packaged application

**Interfaces:**
- Produces `release/win-unpacked/Civic Foundry.exe` and NSIS installer.

- [ ] **Step 1: Write Electron smoke automation**

Use Playwright `_electron.launch({ executablePath })`; assert title `Civic Foundry`, `[data-testid="world-3d"]` visible, `typeof window.require === 'undefined'`, and clean close.

- [ ] **Step 2: Add exact package discovery**

`scripts/find-windows-package.mjs` accepts only `release/win-unpacked/Civic Foundry.exe`; exit nonzero if absent.

- [ ] **Step 3: Add Windows CI installation sequence**

Because repository installs use `--ignore-scripts`, run Electron's download script explicitly before packaging:

```bash
npm ci --ignore-scripts --no-audit --no-fund
node node_modules/electron/install.js
npm run desktop:package
npm run desktop:smoke
```

Do not run arbitrary dependency postinstall scripts.

- [ ] **Step 4: Add `desktop-windows` CI job**

Use `windows-latest`, Node 22, the commands above, then upload `release/*.exe` and `release/win-unpacked/**`. Keep inherited Linux CI intact during D0.

- [ ] **Step 5: Run inherited verification and commit**

```bash
npm run verify
git add tests/desktop scripts/find-windows-package.mjs .github/workflows/ci.yml
git commit -m "ci: package and smoke-test desktop foundation"
```

**D0 Gate:** Windows executable boots securely, native Save V9 services exist, inherited simulation tests pass, and no simulation authority moved.

---

# D1 — Babylon 3D Vertical Slice

### Task 6: Define deterministic presentation snapshots and coordinate mapping

**Files:**
- Create: `src/presentation/snapshot/CityPresentationSnapshot.ts`
- Create: `src/presentation/snapshot/PresentationSnapshotBuilder.ts`
- Create: `src/presentation/snapshot/WorldCoordinateMapping.ts`
- Test: `tests/presentation_snapshot.test.ts`

**Interfaces:**
- Produces `buildCityPresentationSnapshot(core: SimulationCore, presentationRevision: number)`.
- Uses `core.world.terrainSampleAt`, `core.cadastre.listParcels/parcelPolygon`, `core.buildings.listV2`, `core.transportationGraph.nodes/edges`.

- [ ] **Step 1: Write failing determinism tests**

Create two identical seeded cores and call both builders with revision `7`; assert normalized snapshots deep-equal, collections sort deterministically, terrain is row-major, and a rebuild is independent of any consumer-owned copies.

- [ ] **Step 2: Define immutable presentation records**

Include `WorldPresentation`, `TerrainPresentationCell`, `ParcelPresentation`, `BuildingPresentation`, `RoadPresentation`, `VehiclePresentation`, `FacilityPresentation`, `PropPresentation`, `OverlayPresentation`, `HudPresentation` and the locked snapshot type.

- [ ] **Step 3: Implement coordinate mapping**

```ts
export const worldMetersToBabylon = (point: WorldPoint, elevationMeters = 0) => Object.freeze({
  x: point.x,
  y: elevationMeters,
  z: point.y,
});
```

Legacy transport cell coordinates map to centers using `LEGACY_CELL_SIZE_METERS`.

- [ ] **Step 4: Implement D1 snapshot domains**

Terrain comes from authoritative samples; parcels retain canonical IDs/polygons; buildings come from `listV2()`; directed transport edges are deduplicated into stable visual road IDs using ordered endpoint IDs while preserving source edge IDs. `props` is initially an empty frozen array.

- [ ] **Step 5: Verify twice and commit**

```bash
node --experimental-strip-types --test tests/presentation_snapshot.test.ts
node --experimental-strip-types --test tests/presentation_snapshot.test.ts
git add src/presentation/snapshot tests/presentation_snapshot.test.ts
git commit -m "feat: add deterministic city presentation snapshot"
```

---

### Task 7: Add deterministic presentation deltas

**Files:**
- Create: `src/presentation/snapshot/PresentationDelta.ts`
- Create: `src/presentation/snapshot/diffPresentationSnapshots.ts`
- Test: `tests/presentation_delta.test.ts`

**Interfaces:**
- Produces `diffPresentationSnapshots(previous, next): PresentationDelta` including `props`.

- [ ] **Step 1: Write failing delta tests**

Test null→all created, identical snapshots→empty, one building changed→one update, one entity removed→one sorted removed ID, order-only changes→no semantic update.

- [ ] **Step 2: Implement generic ID diff**

Compare immutable entity records structurally and sort all output arrays/IDs by stable ID. `terrainChanged` compares authoritative terrain/world revision content rather than render frame count.

- [ ] **Step 3: Verify and commit**

```bash
node --experimental-strip-types --test tests/presentation_delta.test.ts tests/presentation_snapshot.test.ts
git add src/presentation/snapshot tests/presentation_delta.test.ts
git commit -m "feat: add deterministic presentation deltas"
```

---

### Task 8: Bootstrap Babylon scene and scene synchronization with `NullEngine` tests

**Files:**
- Create: `src/presentation/scene/CityScene.ts`
- Create: `src/presentation/scene/SceneSynchronizer.ts`
- Create: `src/presentation/scene/EntityVisualRegistry.ts`
- Create: `src/presentation/scene/SceneMaterials.ts`
- Test: `tests/babylon_scene.test.ts`

**Interfaces:**
- `SceneSynchronizer.apply(snapshot, delta)` accepts strictly increasing presentation revisions.
- Registry maps category + canonical presentation ID to Babylon node/mesh and disposes removals.

- [ ] **Step 1: Write failing `NullEngine` test**

Instantiate `NullEngine`, create `CityScene`, apply an empty snapshot revision 1, assert camera/light creation and no simulation mutation.

- [ ] **Step 2: Implement visual registry**

Use separate maps for terrain/parcels/buildings/roads/vehicles/facilities/props; expose `get`, `set`, `removeAndDispose`, `clearAndDispose`.

- [ ] **Step 3: Implement base scene/materials**

Create scene, hemispheric + directional light, shared materials, and effect guards for `NullEngine`. Do not place Babylon types in simulation/save modules.

- [ ] **Step 4: Implement synchronizer revision guard**

Reject duplicate/decreasing `revision`. Delegate each delta category to layers introduced by later tasks; empty deltas are no-ops.

- [ ] **Step 5: Verify and commit**

```bash
node --experimental-strip-types --test tests/babylon_scene.test.ts
npm run typecheck
git add src/presentation/scene tests/babylon_scene.test.ts
git commit -m "feat: bootstrap Babylon city scene"
```

---

### Task 9: Render terrain, parcels, canonical buildings, and current roads

**Files:**
- Create: `src/presentation/terrain/TerrainMeshBuilder.ts`
- Create: `src/presentation/terrain/TerrainSceneLayer.ts`
- Create: `src/presentation/parcels/ParcelSceneLayer.ts`
- Create: `src/presentation/buildings/BuildingMeshBuilder.ts`
- Create: `src/presentation/buildings/BuildingSceneLayer.ts`
- Create: `src/presentation/roads/RoadSceneLayer.ts`
- Modify: `src/presentation/scene/SceneSynchronizer.ts`
- Test: `tests/babylon_city_geometry.test.ts`

**Interfaces:**
- Terrain chunks keyed `terrain:<chunkX>:<chunkY>`.
- Parcel/building metadata carries canonical IDs.
- Road visuals reflect current transport projection only; no lane/turn authority is inferred.

- [ ] **Step 1: Write failing geometry tests**

Use small synthetic terrain/parcels/buildings/roads. Assert X/Z plane, Y elevation, finite normals, canonical metadata, correct footprint bounds, stable mesh identity on unchanged reapply, and disposal on removal.

- [ ] **Step 2: Implement pure terrain chunk data**

Generate corner heights by averaging adjacent authoritative cell-center samples, then positions/indices/normals. Chunk before mesh creation; no Babylon side effects in the pure builder.

- [ ] **Step 3: Implement parcel surfaces**

Triangulate canonical rings into thin selectable/overlay surfaces slightly above terrain. Attach `{ kind:'parcel', id }`.

- [ ] **Step 4: Implement procedural `BuildingV2` massing**

Extrude canonical footprint to `heightMeters`; triangulate roof; create wall quads; select shared material family by primary use/lifecycle. Never create one material per building.

- [ ] **Step 5: Implement current-authority roads**

Create centerline/ribbon meshes from deduplicated `RoadPresentation`; width derives only from existing `RoadType` definitions.

- [ ] **Step 6: Wire deltas, verify, commit**

```bash
node --experimental-strip-types --test tests/babylon_city_geometry.test.ts tests/babylon_scene.test.ts
npm run typecheck
git add src/presentation/terrain src/presentation/parcels src/presentation/buildings src/presentation/roads src/presentation/scene/SceneSynchronizer.ts tests/babylon_city_geometry.test.ts
git commit -m "feat: render physical city geometry in Babylon"
```

---

### Task 10: Add free city camera, GPU picking, selection, and compatibility cell resolution

**Files:**
- Create: `src/presentation/camera/CityCamera.ts`
- Create: `src/presentation/camera/CameraController.ts`
- Create: `src/presentation/selection/SelectionTypes.ts`
- Create: `src/presentation/selection/PresentationSelectionResolver.ts`
- Create: `src/presentation/selection/SelectionHighlighter.ts`
- Test: `tests/babylon_navigation_selection.test.ts`

**Interfaces:**
- `SelectionTarget` discriminates terrain/cell, parcel, building, road.
- Terrain picks include world meters and optional derived legacy cell coordinate.

- [ ] **Step 1: Write failing pick-resolution tests**

Create pickable meshes with metadata; assert canonical IDs resolve correctly. Terrain world hit derives cell using `LEGACY_CELL_SIZE_METERS` only when in bounds.

- [ ] **Step 2: Implement city orbit camera**

Use `ArcRotateCamera` or equivalent with radius/pitch limits, wheel zoom, Q/E rotate, WASD pan, middle-drag pan, focus selection. Prevent hotkeys while typing in form controls.

- [ ] **Step 3: Implement selection/highlighting**

Selection remains renderer-local; use highlight/outline/shared material override. Clear on removal or invalid pick.

- [ ] **Step 4: Verify and commit**

```bash
node --experimental-strip-types --test tests/babylon_navigation_selection.test.ts
npm run typecheck
git add src/presentation/camera src/presentation/selection tests/babylon_navigation_selection.test.ts
git commit -m "feat: add 3D camera and GPU selection"
```

---

### Task 11: Integrate the D1 playable Babylon desktop vertical slice

**Files:**
- Create: `src/desktop/renderer/src/GameViewport.ts`
- Create: `src/desktop/renderer/src/DesktopGameplayAdapter.ts`
- Create: `src/desktop/renderer/src/D1Controls.ts`
- Modify: `src/desktop/renderer/src/DesktopApp.ts`
- Create: `tests/desktop/d1_vertical_slice.mjs`
- Test: `tests/desktop_gameplay_adapter.test.ts`

**Interfaces:**
- `GameViewport` owns Babylon engine/scene/render loop.
- `DesktopApp` owns `SimulationCore`, simulation time accumulation, presentation revision, snapshot/delta publishing.
- `DesktopGameplayAdapter` delegates road/zoning/inspect to existing `ToolController` and marks whether authoritative state changed.

- [ ] **Step 1: Write failing gameplay-adapter tests**

Seed a core; verify road placement calls existing road logic, zoning calls existing zoning logic, invalid previews/actions do not mutate state, and result reasons come from existing APIs.

- [ ] **Step 2: Implement `GameViewport`**

```ts
const engine = new Engine(canvas, true, { preserveDrawingBuffer: false, stencil: true });
const cityScene = new CityScene(engine);
engine.runRenderLoop(() => cityScene.scene.render());
window.addEventListener('resize', () => engine.resize());
```

- [ ] **Step 3: Implement presentation revision ownership**

`DesktopApp` starts `presentationRevision = 0`; after a successful road/zoning command or authoritative tick batch, increments once, builds `buildCityPresentationSnapshot(core, revision)`, diffs, applies. Paused edits still increment/publish.

- [ ] **Step 4: Implement D1 controls**

Support inspect, speed 0/1/2/4, local-road path placement, R/C/I zoning, save/load. Convert GPU hit to a legacy cell only at the compatibility tool boundary.

- [ ] **Step 5: Write D1 packaged smoke**

Expose development-only diagnostics `{ renderer:'babylon', terrainMeshes, parcelVisuals, buildingVisuals }`. Smoke asserts renderer is Babylon and geometry counts are nonzero. Do not invent a `canvas2dWorldRendererUsed` flag; static import/policy checks provide that proof.

- [ ] **Step 6: Verify no old renderer import and commit**

```bash
node --experimental-strip-types --test tests/desktop_gameplay_adapter.test.ts
npm run desktop:build
node tests/desktop/d1_vertical_slice.mjs
rg "WorldRenderer|CanvasRenderingContext2D|getContext\(['\"]2d" src/desktop src/presentation
# expected: no matches
npm test
npm run typecheck
git add src/desktop/renderer src/presentation tests/desktop/d1_vertical_slice.mjs tests/desktop_gameplay_adapter.test.ts
git commit -m "feat: ship Babylon desktop vertical slice"
```

**D1 Gate:** desktop city is playable through Babylon for camera/inspect/road/zoning/speed/save/load and desktop code does not import or execute Canvas2D world rendering.

---

# D2 — Gameplay Presentation Parity

### Task 12: Migrate all moving vehicle categories with presentation-only interpolation

**Files:**
- Modify: `src/presentation/snapshot/PresentationSnapshotBuilder.ts`
- Create: `src/presentation/vehicles/VehiclePose.ts`
- Create: `src/presentation/vehicles/VehicleInterpolation.ts`
- Create: `src/presentation/vehicles/VehicleSceneLayer.ts`
- Modify: `src/presentation/scene/SceneSynchronizer.ts`
- Test: `tests/babylon_vehicles.test.ts`

**Interfaces:**
- Uses existing traffic/service/transit/freight route/current-edge state.
- Interpolation samples between authoritative poses and never writes back to simulation.

- [ ] **Step 1: Write failing snapshot/pose tests**

Assert traffic/service/transit/freight IDs sort deterministically, current route edges resolve to finite poses, and route changes cause snap/reset rather than extrapolation.

- [ ] **Step 2: Implement pure route-edge pose conversion**

Resolve graph edge/from/to nodes and normalized progress from each system's existing state. Do not create new routing decisions.

- [ ] **Step 3: Implement interpolation buffer**

Store prior/current authoritative poses + presentation timestamps; clamp interpolation to `[0,1]`; newly created or route-changed entity snaps to current authority.

- [ ] **Step 4: Implement pooled visual layer**

Use shared prototypes/materials and pools. Category selects visual family; removed entities return to pool where safe.

- [ ] **Step 5: Verify and commit**

```bash
node --experimental-strip-types --test tests/babylon_vehicles.test.ts tests/presentation_snapshot.test.ts
npm run typecheck
git add src/presentation tests/babylon_vehicles.test.ts
git commit -m "feat: render moving city vehicles in Babylon"
```

---

### Task 13: Centralize gameplay tools and 3D placement previews

**Files:**
- Expand: `src/desktop/renderer/src/DesktopGameplayAdapter.ts`
- Create: `src/presentation/selection/PlacementPreview.ts`
- Modify: `src/desktop/renderer/src/DesktopApp.ts`
- Test: `tests/desktop_tools_parity.test.ts`

**Interfaces:**
- Supports exact current `ToolId` set: inspect; local/collector/arterial roads; R/C/I zoning; power/water/landfill; six service facilities; transit stop/metro station; bulldoze.

- [ ] **Step 1: Write failing tool parity tests**

For each `ToolId`, assert adapter delegates to the same existing simulation method as `ToolController`; invalid operation returns existing reason and leaves authoritative state unchanged.

- [ ] **Step 2: Implement adapter methods**

Return:

```ts
export type DesktopCommandResult = Readonly<{
  ok: boolean;
  message?: string;
  authoritativeChanged: boolean;
}>;
```

Only successful simulation mutation sets `authoritativeChanged: true`.

- [ ] **Step 3: Implement disposable 3D previews**

Create translucent road/cell preview geometry with shared valid/invalid material. Clear it after apply, cancel, selection loss, or tool switch. Never include preview in a presentation snapshot/save.

- [ ] **Step 4: Verify and commit**

```bash
node --experimental-strip-types --test tests/desktop_tools_parity.test.ts
git add src/desktop/renderer/src/DesktopGameplayAdapter.ts src/desktop/renderer/src/DesktopApp.ts src/presentation/selection/PlacementPreview.ts tests/desktop_tools_parity.test.ts
git commit -m "feat: migrate all gameplay tools and placement previews"
```

---

### Task 14: Migrate every analytical overlay to Babylon presentation data

**Files:**
- Create: `src/presentation/overlays/OverlayTypes.ts`
- Create: `src/presentation/overlays/OverlaySnapshotBuilder.ts`
- Create: `src/presentation/overlays/OverlaySceneLayer.ts`
- Create: `src/presentation/overlays/OverlayLegend.ts`
- Modify: `src/presentation/snapshot/PresentationSnapshotBuilder.ts`
- Modify old overlay files temporarily to re-export shared mode types where required
- Test: `tests/babylon_overlays.test.ts`

**Interfaces:**
- One `ActiveOverlay` discriminated union covers current traffic, service, transit, economy/freight, cadastral, zoning-envelope, and land/housing/development modes.
- Overlay selection remains mutually exclusive.

- [ ] **Step 1: Write failing overlay mode parity test**

Build expected set from current mode unions and assert new `OVERLAY_MODES` contains each exactly once.

- [ ] **Step 2: Move shared mode definitions without breaking browser reference tests**

Old renderer modules may re-export the new types until D4. Move pure mapping helpers when needed; no renderer-specific Canvas type may enter new overlay code.

- [ ] **Step 3: Build overlay data only from authoritative/cached metrics**

Read existing `trafficSnapshot`, service metrics, mobility/transit metrics, economy/freight metrics, cadastre/zoning/buildable-envelope and land/housing presentation inputs. Do not recompute simulation outcomes.

- [ ] **Step 4: Implement Babylon overlay visuals**

Use shared materials/vertex colors/line meshes/thin surfaces; update only on mode/source invalidation.

- [ ] **Step 5: Verify and commit**

```bash
node --experimental-strip-types --test tests/babylon_overlays.test.ts
npm run typecheck
git add src/presentation/overlays src/presentation/snapshot src/rendering tests/babylon_overlays.test.ts
git commit -m "feat: migrate analytical overlays to Babylon"
```

---

### Task 15: Migrate HUD, inspector, transit/economy management, taxes, service budgets, Urban Fabric, and land/housing UI

**Files:**
- Create: `src/desktop/renderer/src/DesktopUiController.ts`
- Create: `src/desktop/renderer/src/InspectorController.ts`
- Create: `src/desktop/renderer/src/OverlayController.ts`
- Modify: `src/desktop/renderer/src/DesktopLayout.ts`
- Modify: `src/desktop/renderer/src/DesktopApp.ts`
- Reuse/extract pure helpers from: `src/ui/Hud.ts`, `src/ui/Inspector.ts`, `src/ui/TransitPanel.ts`, `src/ui/EconomyPanel.ts`, `src/ui/UrbanFabricUiController.ts`, `src/ui/LandHousingUiController.ts`
- Test: `tests/desktop_ui_parity.test.ts`

**Interfaces:**
- Desktop UI receives core, gameplay adapter, current selection, and latest presentation snapshot; it does not receive simulation-writable Babylon objects.

- [ ] **Step 1: Write failing UI parity contract**

Assert stable controls/test IDs for every tool, speed 0/1/2/4, three tax inputs, five service budgets, all analytical overlay selectors, transit line controls, inspector, Save/Load/Import, Urban Fabric, and land/housing management surfaces.

- [ ] **Step 2: Extract/reuse pure collectors/controllers**

Prefer `collectHudMetrics`, inspector helpers, `TransitPanelController`, and `EconomyPanel` behavior. If a controller is typed directly to `GameApp`, extract only the pure operation needed into a focused `src/ui/` helper and cover it with existing/new tests.

- [ ] **Step 3: Bind desktop UI exactly once**

Tax changes call `core.taxes.setRate`; service funding calls `core.setServiceFunding`; transit operations call `TransitPanelController`; overlays use `OverlayController`; inspection uses selected canonical target or compatibility cell.

- [ ] **Step 4: Preserve analytical mutual exclusion**

Activating any analytical overlay switches every other analytical selector to `none` before publishing the new presentation revision.

- [ ] **Step 5: Verify and commit**

```bash
node --experimental-strip-types --test tests/desktop_ui_parity.test.ts
npm test
npm run typecheck
git add src/desktop/renderer/src src/ui tests/desktop_ui_parity.test.ts
git commit -m "feat: migrate city management UI to desktop"
```

---

### Task 16: Complete safe save/load/import/autosave UX and full D2 gameplay smoke

**Files:**
- Create: `src/desktop/renderer/src/DesktopPersistenceController.ts`
- Create: `src/desktop/renderer/src/AutosaveController.ts`
- Modify: `src/desktop/renderer/src/DesktopApp.ts`
- Test: `tests/autosave_controller.test.ts`
- Create: `tests/desktop/d2_gameplay_smoke.mjs`

**Interfaces:**
- Load/import hydrates a candidate before replacing active core.
- Autosave slots rotate 0→1→2 and dirty state clears only on successful write.

- [ ] **Step 1: Write failing autosave tests with fake time**

Assert no autosave before 300,000 ms, no save when clean, successful save rotates slot, failed save retains dirty state, load transition suppresses autosave, and successful manual save resets dirty baseline.

- [ ] **Step 2: Implement safe load replacement**

```ts
const result = await window.civicDesktop.loadGame({ name });
if (!result.ok) return result;
const candidate = hydrateCore(result.value);
this.replaceCore(candidate);
return { ok: true as const };
```

Never replace active authoritative core until hydration succeeds.

- [ ] **Step 3: Implement main-owned import flow**

Renderer calls `window.civicDesktop.importSave({ name })`; main opens the native picker. After import, renderer loads the logical save name and validates through `hydrateCore()` before activation.

- [ ] **Step 4: Implement exact D2 gameplay smoke sequence**

Automate through UI/test IDs:
1. launch new seeded city;
2. build a five-cell straight local road;
3. zone two adjacent cells residential and one commercial;
4. place power and water plus one service facility;
5. place two surface transit stops at the road endpoints;
6. create bus line named `Smoke Line`, set route through those two stops, enable service, and apply headway/fare/fleet fields;
7. run simulation at 4× until at least one authoritative tick batch completes;
8. activate one traffic and one Urban Fabric overlay sequentially and verify mutual exclusion;
9. change residential tax and fire funding;
10. save as `Desktop Smoke`;
11. quit/relaunch/load `Desktop Smoke`;
12. assert tick, treasury, roads, zoning, transit line ID/name, tax, funding, and canonical parcel/building IDs match saved state.

- [ ] **Step 5: Run D2 gate and commit**

```bash
node --experimental-strip-types --test tests/autosave_controller.test.ts
npm run desktop:build
node tests/desktop/d2_gameplay_smoke.mjs
npm test
npm run typecheck
npm run architecture:check
git add src/desktop/renderer/src tests/autosave_controller.test.ts tests/desktop/d2_gameplay_smoke.mjs
git commit -m "feat: complete desktop gameplay presentation parity"
```

**D2 Gate:** current player-facing tools, management panels, overlays, inspection, all vehicle categories, and persistence workflows operate through desktop/Babylon. Browser/Canvas remains reference-only.

---

# D3 — 3D Asset and Visual Pipeline

### Task 17: Introduce validated 3D runtime asset manifests

**Files:**
- Create: `src/presentation/assets/AssetTypes.ts`
- Create: `src/presentation/assets/DesktopAssetManifest.ts`
- Create: `src/presentation/assets/AssetManifestValidation.ts`
- Create: `assets/runtime/manifest.json`
- Modify: `scripts/check-assets.mjs`
- Test: `tests/desktop_asset_manifest.test.ts`

**Interfaces:**
- Runtime assets use `kind: 'glb' | 'texture' | 'procedural-kit'`, category, required flag, optional LOD paths.

- [ ] **Step 1: Write failing validation tests**

Reject duplicate IDs, absolute/traversal paths, unsupported extensions, duplicate/unsorted LOD distances, and missing required references. Accept a minimal procedural-only manifest.

- [ ] **Step 2: Define asset types**

```ts
export type RuntimeAsset = Readonly<{
  id: string;
  kind: 'glb' | 'texture' | 'procedural-kit';
  path?: string;
  category: 'building' | 'vehicle' | 'facility' | 'road' | 'terrain' | 'prop';
  required: boolean;
  lods?: readonly Readonly<{ distanceMeters: number; path: string }>[];
}>;
```

- [ ] **Step 3: Implement manifest validation and repository asset checks**

Extend `check-assets.mjs` to validate desktop runtime manifest/allowed extensions while retaining legacy atlas checks until Task 19 switches canonical desktop build and D4 removes the old pipeline.

- [ ] **Step 4: Verify and commit**

```bash
node --experimental-strip-types --test tests/desktop_asset_manifest.test.ts
npm run assets:policy
git add src/presentation/assets assets/runtime/manifest.json scripts/check-assets.mjs tests/desktop_asset_manifest.test.ts
git commit -m "feat: add validated 3D runtime asset manifest"
```

---

### Task 18: Implement Babylon asset registry, instancing, LODs, props, and mature procedural kits

**Files:**
- Create: `src/presentation/assets/DesktopAssetRegistry.ts`
- Create: `src/presentation/assets/InstancePool.ts`
- Create: `src/presentation/assets/LodResolver.ts`
- Create: `src/presentation/buildings/ProceduralBuildingKit.ts`
- Create: `src/presentation/vehicles/ProceduralVehicleKit.ts`
- Create: `src/presentation/services/ProceduralFacilityKit.ts`
- Create: `src/presentation/props/PropSceneLayer.ts`
- Modify: `src/presentation/scene/SceneSynchronizer.ts`
- Test: `tests/babylon_asset_registry.test.ts`

**Interfaces:**
- `DesktopAssetRegistry.preloadRequired()`, `instantiate(assetId,parent?)`, `diagnostics()`.
- Missing required asset rejects scene readiness; optional asset returns explicit fallback visual with diagnostic.

- [ ] **Step 1: Write failing `NullEngine` asset tests**

Test procedural-kit resolution, required missing GLB error `required-asset-missing`, optional missing GLB fallback, instance reuse, deterministic LOD choice, and prop create/remove deltas.

- [ ] **Step 2: Register glTF loader exactly once**

Import `@babylonjs/loaders/glTF` in the registry/bootstrap. Cache `AssetContainer`s loaded with Babylon scene loader APIs.

- [ ] **Step 3: Implement pools/thin instances**

Pool vehicle/facility/prop families. Use thin instances for non-individually-pickable repeated props; keep a separate selection mapping for individually selectable entities.

- [ ] **Step 4: Mature procedural building visuals**

Shared facade/roof/window material families vary by primary use, quality band, condition band, lifecycle, and deterministic hash of building ID. Geometry remains derived from canonical footprint/floor/height state.

- [ ] **Step 5: Add LOD/culling behavior**

Near = detailed procedural massing; medium = simplified extrusion; far = low-poly proxy. Visual LOD never changes simulation entity presence or save state.

- [ ] **Step 6: Verify and commit**

```bash
node --experimental-strip-types --test tests/babylon_asset_registry.test.ts tests/babylon_city_geometry.test.ts tests/babylon_vehicles.test.ts
npm run typecheck
git add src/presentation tests/babylon_asset_registry.test.ts
git commit -m "feat: add instanced 3D asset and procedural kits"
```

---

### Task 19: Make the desktop 3D asset pipeline canonical

**Files:**
- Create: `scripts/build-desktop-assets.mjs`
- Modify: `package.json`
- Modify: `electron-builder.yml`
- Modify: `docs/art/ASSET_BIBLE.md`
- Test: `tests/desktop_asset_build.test.ts`

**Interfaces:**
- `desktop:assets:check` validates `assets/runtime/manifest.json` and all required files.
- Desktop build packages `assets/runtime/**`; it never calls Python/Pillow/atlas generation.

- [ ] **Step 1: Write failing build-script test**

Assert `desktop:build` begins with `desktop:assets:check`, desktop asset command references only `build-desktop-assets.mjs`, and no desktop command contains `render_isometric_atlases.py`.

- [ ] **Step 2: Implement desktop asset build/check**

`build-desktop-assets.mjs --check` parses manifest, validates all required files/extensions/LODs, verifies paths remain inside `assets/runtime`, and exits nonzero on failure.

- [ ] **Step 3: Update package/build configuration**

```json
{
  "desktop:assets:check": "node scripts/build-desktop-assets.mjs --check",
  "desktop:build": "npm run desktop:assets:check && electron-vite build"
}
```

Add `assets/runtime/**/*` to `electron-builder.yml` `files`.

- [ ] **Step 4: Update asset bible**

Document GLB/glTF runtime rules, manifest IDs, compressed texture handling, procedural kits, instancing, LOD/culling, and that isometric assets are legacy-only until D4 deletion.

- [ ] **Step 5: Verify D3 and commit**

```bash
npm run desktop:assets:check
npm run desktop:build
node --experimental-strip-types --test tests/desktop_asset_build.test.ts
npm test
git add scripts/build-desktop-assets.mjs package.json package-lock.json electron-builder.yml docs/art/ASSET_BIBLE.md tests/desktop_asset_build.test.ts
git commit -m "build: make 3D asset pipeline canonical for desktop"
```

**D3 Gate:** desktop package uses validated procedural/GLB runtime assets with instancing/LOD/culling and has no desktop build dependency on isometric atlases.

---

# D4 — Canvas2D and Browser Runtime Removal

### Task 20: Add deterministic performance fixtures and renderer telemetry

**Files:**
- Create: `src/presentation/performance/RendererTelemetry.ts`
- Create: `src/presentation/performance/PerformanceFixtureFactory.ts`
- Create: `tests/presentation_performance_fixture.test.ts`
- Create: `tests/performance/renderer_reference.mjs`
- Create: `tests/performance/renderer_stress.mjs`
- Modify: `src/desktop/renderer/src/DesktopApp.ts`
- Modify: `package.json`

**Interfaces:**
- Synthetic fixtures are presentation snapshots, not fake simulation cities.
- Telemetry exposes FPS/frame durations, snapshot build/sync time, simulation tick duration, active meshes/instances, draw calls where available, entity/prop counts.

- [ ] **Step 1: Write failing exact-count tests**

Reference: exactly 2,000 buildings, 1,000 moving vehicles total, 5,000 props, one overlay. Stress: exactly 5,000 buildings, 2,000 vehicles, 20,000 props, one overlay. IDs are deterministic/sorted.

- [ ] **Step 2: Implement fixed-seed fixture factory**

Generate `CityPresentationSnapshot` directly with `props` populated; do not add simulation APIs to manufacture renderer load.

- [ ] **Step 3: Implement telemetry rolling window**

Track frame durations and compute median FPS and 1% low after caller-defined warmup/measurement; keep metrics presentation-local.

- [ ] **Step 4: Implement benchmark launch scripts**

Package-launch in `reference`/`stress` fixture mode, wait 10 seconds, collect 30 seconds, save telemetry JSON. `--enforce-reference` exits nonzero below thresholds.

- [ ] **Step 5: Add commands and verify structural tests**

```json
{
  "desktop:perf:reference": "node tests/performance/renderer_reference.mjs --enforce-reference",
  "desktop:perf:stress": "node tests/performance/renderer_stress.mjs --enforce-reference"
}
```

Run:

```bash
node --experimental-strip-types --test tests/presentation_performance_fixture.test.ts
npm run desktop:build
git add src/presentation/performance src/desktop/renderer/src/DesktopApp.ts tests/performance tests/presentation_performance_fixture.test.ts package.json package-lock.json
git commit -m "perf: add desktop renderer performance gates"
```

Hosted/software-rendered CI may record telemetry but may not substitute for the reference-hardware release gate.

---

### Task 21: Add architecture/rendering-policy scanners without making the intermediate branch red

**Files:**
- Modify: `scripts/check-architecture.mjs`
- Create: `scripts/check-rendering-policy.mjs`
- Create: `tests/rendering_policy.test.ts`
- Modify: `package.json`

**Interfaces:**
- `findForbiddenRenderingUsage(path, source)` reports production use of `CanvasRenderingContext2D`, `getContext('2d')`, and imports from legacy renderer paths.
- `rendering:policy` command exists after this task, but `verify` does not include it until Task 22 removes legacy code.

- [ ] **Step 1: Write failing scanner unit tests**

Synthetic Canvas2D source must be reported; `new Engine(canvas)` and `HTMLCanvasElement` as WebGL surface must pass.

- [ ] **Step 2: Implement source scanner**

Scan `src/**/*.ts`; no broad allow-list. Test files are outside `src` and therefore naturally excluded.

- [ ] **Step 3: Extend architecture boundaries**

Prevent `src/simulation/`, `src/world/`, and `src/save/` from importing `src/desktop/` or `src/presentation/`. Prevent `src/presentation/` from importing `src/desktop/`. Existing simulation/world→old-rendering bans remain until deletion.

- [ ] **Step 4: Add non-gating command**

```json
{
  "rendering:policy": "node scripts/check-rendering-policy.mjs"
}
```

Do not add it to `verify` yet because the known legacy Canvas implementation still exists.

- [ ] **Step 5: Run scanner unit tests GREEN and record diagnostic legacy hits**

```bash
node --experimental-strip-types --test tests/rendering_policy.test.ts
npm run architecture:check
npm run rendering:policy || true
```

The unit tests/architecture check must pass. The final command is diagnostic only and should list the known legacy files that Task 22 removes.

- [ ] **Step 6: Commit**

```bash
git add scripts/check-architecture.mjs scripts/check-rendering-policy.mjs tests/rendering_policy.test.ts package.json package-lock.json
git commit -m "test: add desktop rendering architecture policy"
```

---

### Task 22: Remove Canvas2D/isometric/browser runtime and old atlas pipeline

**Files:**
- Delete: `src/rendering/WorldRenderer.ts`
- Delete: Canvas vehicle renderers in `src/rendering/`
- Delete: `src/rendering/passes/*` Canvas passes after all consumers are migrated
- Delete: `src/rendering/isometric/*`
- Delete: sprite-only `src/rendering/assets/*` modules after import inventory proves no nonlegacy consumers
- Delete: old `src/rendering/*OverlayLayer.ts` implementations once types/helpers live in `src/presentation/overlays/`
- Delete: `src/app/GameApp.ts`
- Delete: root `src/main.ts`
- Delete: root `index.html`
- Delete: `tools/render_isometric_atlases.py`
- Delete: superseded isometric/browser smoke files under `tests/smoke/`
- Modify/delete: `scripts/build.mjs`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`
- Modify repository/asset policy files as required

**Interfaces:**
- Canonical production entry becomes Electron main + desktop renderer + Babylon.
- `build` aliases `desktop:build`; `dev` aliases `desktop:dev`.
- `verify` adds `rendering:policy` and uses desktop asset checks, with no Python atlas command.

- [ ] **Step 1: Inventory all legacy imports before deleting**

```bash
rg "WorldRenderer|Isometric|PassAAssetManifest|SpritePainter|render_isometric_atlases|src/rendering|\.\./rendering" src tests scripts package.json .github README.md docs
```

For each production consumer, migrate it to the new presentation/overlay/asset equivalent before deletion. Pure UI helpers are retained under `src/ui/` when still useful.

- [ ] **Step 2: Delete browser app/entry path**

Remove `GameApp`, root `src/main.ts`, root `index.html`. Ensure desktop renderer owns all surviving management behavior first.

- [ ] **Step 3: Delete Canvas/isometric world renderer**

Remove `WorldRenderer`, Canvas render passes, Canvas vehicle renderers, isometric projection/camera/culling/painters, old sprite registry/painter/manifest modules, and old overlay implementations no longer consumed.

- [ ] **Step 4: Remove atlas generator and browser visual-smoke dependencies**

Remove Python atlas scripts and old browser/isometric smoke commands from package/CI/build. Delete obsolete tracked generated atlas outputs if no desktop manifest references them.

- [ ] **Step 5: Make package scripts desktop-native without recursion**

Set:

```json
{
  "build": "npm run desktop:build",
  "dev": "npm run desktop:dev",
  "assets:check": "npm run desktop:assets:check",
  "assets:build": "node scripts/build-desktop-assets.mjs",
  "verify": "npm run format:check && npm run lint && npm run policy:check && npm run architecture:check && npm run rendering:policy && npm run typecheck && npm test && npm run assets:policy && npm run assets:check && npm run build"
}
```

- [ ] **Step 6: Require rendering policy GREEN**

```bash
npm run rendering:policy
rg "CanvasRenderingContext2D|getContext\(['\"]2d|WorldRenderer|render_isometric_atlases" src scripts package.json .github
# expected: no production matches
```

- [ ] **Step 7: Run full D4 functional gate**

```bash
npm run verify
npm run desktop:package
npm run desktop:smoke
node tests/desktop/d2_gameplay_smoke.mjs
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor: remove Canvas2D browser runtime"
```

---

### Task 23: Finalize Windows CI, reference-performance gate, docs, and D4 acceptance

**Files:**
- Modify: `.github/workflows/ci.yml`
- Create: `.github/workflows/desktop-performance.yml`
- Modify: `README.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/TESTING.md`
- Modify: `docs/ENGINEERING_STANDARDS.md`
- Modify: `docs/SAVE_FORMAT.md`
- Modify: `docs/DEVELOPMENT_LOG.md`
- Modify: `docs/art/ASSET_BIBLE.md`
- Create: `docs/adr/0002-electron-babylon-desktop-runtime.md`
- Modify: `docs/adr/README.md`

**Interfaces:**
- Standard CI: Linux verification plus Windows package/smoke/artifacts.
- Reference performance: self-hosted label `civic-foundry-reference` with defined Windows hardware class.

- [ ] **Step 1: Finalize standard CI**

Linux: install with scripts suppressed, run `verify`/desktop build. Windows: install with scripts suppressed, explicitly run `node node_modules/electron/install.js`, then `verify`, `desktop:package`, packaged smoke, D2 gameplay smoke, artifact upload. Remove Python/Pillow/Chromium setup if no surviving test consumes it.

- [ ] **Step 2: Add reference-performance workflow**

`desktop-performance.yml` runs on `workflow_dispatch` and release/tag trigger with `[self-hosted, windows, x64, civic-foundry-reference]`; execute package, `desktop:perf:reference`, `desktop:perf:stress`, upload telemetry JSON. D4 is not accepted without a green run on the defined reference class.

- [ ] **Step 3: Update canonical architecture docs**

Use:

```text
Electron Renderer → DesktopApp → CityPresentationSnapshot → Babylon CityScene
                                      ↑
                               SimulationCore facade
                                      ↓
             SimulationKernel + WorldFoundation + CadastralGraph + domains
```

State that the HTML canvas is only a WebGL surface and Canvas2D world rendering is prohibited.

- [ ] **Step 4: Update testing/engineering/save/asset documentation**

Document desktop commands, NullEngine tests, packaged smoke, rendering policy, `.cfsave`, atomic saves/autosaves/import behavior, Electron security, 3D asset manifests, performance fixtures, and Windows artifact locations.

- [ ] **Step 5: Add ADR**

Record Electron + Babylon, WebGL2 baseline, HTML/CSS management UI, snapshot authority boundary, narrow preload bridge, and staged Canvas/browser retirement.

- [ ] **Step 6: Run final non-performance gates**

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run verify
npm run desktop:build
```

On Windows additionally:

```bash
node node_modules/electron/install.js
npm run desktop:package
npm run desktop:smoke
node tests/desktop/d2_gameplay_smoke.mjs
```

- [ ] **Step 7: Run reference hardware performance acceptance**

```bash
npm run desktop:perf:reference
npm run desktop:perf:stress
```

Expected: reference median ≥60 / 1% low ≥45; stress median ≥30 / 1% low ≥22.

- [ ] **Step 8: Verify legacy runtime is absent**

```bash
rg "CanvasRenderingContext2D|getContext\(['\"]2d|WorldRenderer|IsometricCamera|render_isometric_atlases" src scripts package.json .github
```

Expected: no production/runtime matches. Historical design/plan documentation may describe the removed system explicitly as history.

- [ ] **Step 9: Commit final D4 checkpoint**

```bash
git add .github README.md docs package.json package-lock.json
git commit -m "docs: declare Babylon desktop runtime canonical"
```

---

## Final D4 Acceptance Checklist

- [ ] Packaged Windows application launches through Electron and Babylon WebGL2.
- [ ] Player can create a deterministic city; orbit/pan/zoom/inspect; build/bulldoze roads; zone R/C/I; place current utilities/services; change speed/taxes/service budgets; operate transit; use all current analytical overlays; and observe traffic/service/transit/freight movement in 3D.
- [ ] `CityPresentationSnapshot`/delta output is deterministic for identical authoritative input + presentation revision; Babylon state never enters Save V9.
- [ ] Desktop save/load/import preserves V3–V9 migration behavior; three rotating autosaves work; failed writes leave prior valid saves intact.
- [ ] Renderer process has no Node integration, arbitrary filesystem path access, shell authority, or general IPC authority.
- [ ] No supported production `CanvasRenderingContext2D`, `getContext('2d')`, `WorldRenderer`, isometric render pass, or atlas-generation dependency remains.
- [ ] GLB/procedural runtime asset manifest validation passes and the Windows package contains every required runtime asset.
- [ ] All inherited deterministic simulation tests pass.
- [ ] Babylon NullEngine/presentation tests, package smoke, full gameplay smoke, architecture/rendering policies pass.
- [ ] Reference and stress thresholds pass on the defined reference hardware class.
- [ ] CI emits unpacked Windows build + NSIS installer and reference-performance telemetry is green.
- [ ] README/architecture/testing/engineering/save/asset documentation declares Electron/Babylon canonical.
- [ ] Only after every item above is green may the implementation branch unlock 3R Transportation Engine 2.0.
