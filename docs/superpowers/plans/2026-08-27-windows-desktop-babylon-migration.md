# Civic Foundry Windows Desktop + Babylon.js Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Civic Foundry's browser/Canvas2D production runtime with a secure Electron Windows desktop application whose city world is rendered entirely through Babylon.js while preserving the deterministic simulation and Save V9 compatibility chain.

**Architecture:** Preserve `SimulationCore`, `SimulationKernel`, `WorldFoundation`, `CadastralGraph`, existing gameplay domains, and Save V3–V9 hydration as authoritative. Add a secure Electron main/preload/renderer boundary, immutable renderer-facing snapshots, deterministic presentation deltas, and Babylon scene synchronization; migrate presentation through D0–D4, then remove the old Canvas/isometric runtime.

**Tech Stack:** Node.js 22.12+ on the Node 22 line, TypeScript 5.8.3, Electron 44.0.0, electron-vite 5.0.0, electron-builder 26.15.3 with NSIS, `@babylonjs/core` 9.23.0, `@babylonjs/loaders` 9.23.0, Playwright 1.62.1 for Electron automation, Node test runner, ESLint 10, Prettier 3, `clipper2-ts` 2.0.1-18.

**Spec:** `docs/superpowers/specs/2026-08-27-windows-desktop-babylon-migration-design.md`

## Global Constraints

- Implement in order: D0 → D1 → D2 → D3 → D4. Do not begin 3R until D4 is accepted.
- `SimulationKernel` remains the deterministic scheduler/time authority. Rendering frame rate never changes authoritative outcomes.
- `WorldFoundation` remains the sole physical/geographic authority. `CadastralGraph` remains the sole legal-land/topology authority.
- Babylon state is disposable presentation state. Presentation reads immutable snapshots and emits gameplay intent through existing simulation entry points.
- Save V9 remains the default schema. V3–V9 hydration remains supported. Desktop storage alone must not create Save V10.
- Electron renderer uses `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, restrictive navigation/CSP, and an allow-listed preload bridge.
- Renderer code never receives arbitrary filesystem paths, general `ipcRenderer`, shell/process authority, or Node globals.
- WebGL2 is the required rendering baseline. WebGPU is outside this implementation plan.
- Desktop storage root is `%APPDATA%\Civic Foundry\`; desktop saves use `.cfsave`, atomic same-directory replacement, previous-good preservation, and three rotating autosaves.
- Autosave cadence is five real-time minutes when a city is loaded and authoritative state has changed since the last successful save.
- D1 must launch through Babylon without importing or invoking the Canvas2D world renderer. D4 removes every supported production Canvas2D world-rendering path.
- Reference fixture: exactly 2,000 buildings, 1,000 moving vehicles, 5,000 repeated props, one analytical overlay; 1080p target median ≥60 FPS and 1% low ≥45 FPS after 10-second warmup over 30-second measurement.
- Stress fixture: exactly 5,000 buildings, 2,000 moving vehicles, 20,000 repeated props, one analytical overlay; 1080p acceptance median ≥30 FPS and 1% low ≥22 FPS.
- If migration reveals a simulation bug, fix it narrowly with a regression test. Do not redesign transportation, households, economics, politics, region scale, or save authority under this plan.

---

## Locked Cross-Task Interfaces

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

`importSave()` opens a native file picker in the Electron main process. The renderer never supplies or receives a native path.

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

`revision` is presentation-local. `DesktopApp` increments it whenever it publishes after an accepted authoritative command or a simulation tick batch, including edits while paused. It is never serialized into Save V9.

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

### Task 1: Pin the desktop toolchain, entries, and repository formatting

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `.prettierignore`
- Create: `electron.vite.config.ts`
- Create: `electron-builder.yml`
- Create: `src/desktop/renderer/index.html`
- Create: `src/desktop/renderer/src/main.ts`
- Test: `tests/desktop_toolchain.test.ts`

**Interfaces:**
- Produces commands `desktop:dev`, `desktop:build`, `desktop:package`, `desktop:test`, `desktop:smoke`.
- Fixed outputs: `out/main/index.js`, `out/preload/index.js`, `out/renderer/`.

- [ ] **Step 1: Write the failing toolchain test**

```ts
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('desktop toolchain is pinned and main entry is fixed', async () => {
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

- [ ] **Step 2: Run and verify RED**

Run: `node --experimental-strip-types --test tests/desktop_toolchain.test.ts`

Expected: FAIL because desktop scripts/dependencies are absent.

- [ ] **Step 3: Install exact dependencies and scripts**

```bash
npm install --save-exact @babylonjs/core@9.23.0 @babylonjs/loaders@9.23.0
npm install --save-dev --save-exact electron@44.0.0 electron-vite@5.0.0 electron-builder@26.15.3 playwright@1.62.1 @types/node@22.20.1
```

Add:

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

- [ ] **Step 4: Exclude generated/binary output from Prettier**

Append:

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

- [ ] **Step 5: Configure electron-vite with explicit custom inputs**

```ts
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'electron-vite';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  main: {
    build: {
      outDir: 'out/main',
      rollupOptions: {
        input: { index: resolve(root, 'src/desktop/main/ElectronMain.ts') },
        output: { entryFileNames: 'index.js' },
      },
    },
  },
  preload: {
    build: {
      outDir: 'out/preload',
      rollupOptions: {
        input: { index: resolve(root, 'src/desktop/preload/index.ts') },
        output: { entryFileNames: 'index.js' },
      },
    },
  },
  renderer: {
    root: resolve(root, 'src/desktop/renderer'),
    build: {
      outDir: resolve(root, 'out/renderer'),
      rollupOptions: { input: { index: resolve(root, 'src/desktop/renderer/index.html') } },
    },
  },
});
```

- [ ] **Step 6: Add package configuration and initial renderer bootstrap**

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

`src/desktop/renderer/index.html` contains strict CSP, `#app`, and `<script type="module" src="/src/main.ts"></script>`.

`src/desktop/renderer/src/main.ts`:

```ts
document.documentElement.dataset.desktopBootstrap = 'true';
```

- [ ] **Step 7: Verify GREEN and commit**

```bash
node --experimental-strip-types --test tests/desktop_toolchain.test.ts
npm run format:check
npm run typecheck
npm test
git add package.json package-lock.json .prettierignore electron.vite.config.ts electron-builder.yml src/desktop/renderer tests/desktop_toolchain.test.ts
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

**Interfaces:** Produces the locked `DesktopApi`, secure BrowserWindow options, app lifecycle, and `window.civicDesktop` allow-list. No storage operation exposes a path.

- [ ] **Step 1: Write the failing security test**

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildWindowOptions } from '../src/desktop/main/WindowOptions.ts';

test('desktop renderer has no Node integration', () => {
  const options = buildWindowOptions('C:/preload.js');
  assert.equal(options.webPreferences?.contextIsolation, true);
  assert.equal(options.webPreferences?.nodeIntegration, false);
  assert.equal(options.webPreferences?.sandbox, true);
  assert.equal(options.webPreferences?.preload, 'C:/preload.js');
});
```

- [ ] **Step 2: Verify RED**

Run: `node --experimental-strip-types --test tests/desktop_security.test.ts`

- [ ] **Step 3: Implement shared types exactly as locked above**

`SaveDescriptor` has logical metadata only. `ImportSaveRequest` has only optional logical destination name.

- [ ] **Step 4: Implement window lifecycle/security**

`WindowOptions.ts` fixes `contextIsolation:true`, `nodeIntegration:false`, `sandbox:true`. `WindowManager.ts` denies `setWindowOpenHandler` and prevents navigation away from the known electron-vite development URL or packaged renderer file URL.

- [ ] **Step 5: Implement preload allow-list**

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

- [ ] **Step 6: Implement app lifecycle without fake storage responses**

`ElectronMain.ts` owns `app.whenReady`, main-window creation, activation, and `window-all-closed`. Persistence handlers are absent until Task 3; do not register success stubs.

- [ ] **Step 7: Verify build and commit**

```bash
node --experimental-strip-types --test tests/desktop_security.test.ts
npm run desktop:build
npm run typecheck
git add src/desktop tests/desktop_security.test.ts
git commit -m "feat: add secure Electron process boundary"
```

---

### Task 3: Add atomic Save V9 storage, native import selection, and rotating autosaves

**Files:**
- Create: `src/desktop/main/AtomicFileOps.ts`
- Create: `src/desktop/main/NativeStorage.ts`
- Create: `src/desktop/main/DesktopIpc.ts`
- Modify: `src/desktop/main/ElectronMain.ts`
- Test: `tests/native_storage.test.ts`
- Modify: `docs/SAVE_FORMAT.md`

**Interfaces:** `NativeStorage.initialize/listSaves/listAutosaves/writeSave/readSave/importSave/writeAutosave/readSettings/writeSettings`; `registerDesktopIpc(storage)`.

- [ ] **Step 1: Define injectable filesystem operations**

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

`NativeStorage(root, fileOps = nodeAtomicFileOps)` uses this dependency in every write/read operation.

- [ ] **Step 2: Write failing atomic-storage tests**

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

Also inject a failing file operation after a prior valid write and assert destination bytes remain unchanged.

- [ ] **Step 3: Verify RED**

Run: `node --experimental-strip-types --test tests/native_storage.test.ts`

- [ ] **Step 4: Implement names/layout/atomic replace**

Accept `^[A-Za-z0-9 _.-]{1,80}$`; reject `.`, `..`, separators, trailing dot/space, and Windows reserved device basenames. Use same-directory temporary file → `FileHandle.sync()` → close → copy prior target to `.bak` when present → atomic `rename()`.

```text
%APPDATA%\Civic Foundry\
  saves\
  autosaves\autosave-1.cfsave
  autosaves\autosave-2.cfsave
  autosaves\autosave-3.cfsave
  settings.json
  logs\
```

- [ ] **Step 5: Implement main-owned native import picker**

```ts
const result = await dialog.showOpenDialog({
  properties: ['openFile'],
  filters: [{ name: 'Civic Foundry Saves', extensions: ['cfsave', 'json'] }],
});
```

Only main receives `filePaths[0]`, then calls `storage.importSave(sourcePath, request.name)`. Renderer receives only `SaveDescriptor`.

- [ ] **Step 6: Register validated IPC**

Validate request object shapes, logical save names, slot 0/1/2, settings bounds; catch native errors and return `DesktopResult`. Cancellation returns code `cancelled`.

- [ ] **Step 7: Initialize under app data and verify Save V9 suite**

```ts
const storage = new NativeStorage(join(app.getPath('appData'), 'Civic Foundry'));
await storage.initialize();
registerDesktopIpc(storage);
```

Run:

```bash
node --experimental-strip-types --test tests/native_storage.test.ts
node --experimental-strip-types --test tests/save*.test.ts
npm run typecheck
```

- [ ] **Step 8: Document and commit**

Document `.cfsave` as existing Save V9 JSON envelope; schema/version unchanged.

```bash
git add src/desktop/main docs/SAVE_FORMAT.md tests/native_storage.test.ts
git commit -m "feat: add atomic desktop save storage"
```

---

### Task 4: Build the desktop city-management shell

**Files:**
- Modify: `src/desktop/renderer/src/main.ts`
- Create: `src/desktop/renderer/src/DesktopApp.ts`
- Create: `src/desktop/renderer/src/DesktopLayout.ts`
- Create: `src/desktop/renderer/src/desktop.css`
- Test: `tests/desktop_layout.test.ts`

**Interfaces:** Stable roots/test IDs `world-3d`, `hud`, `toolbox`, `inspector`, management panels. No import of `GameApp`/`WorldRenderer`.

- [ ] **Step 1: Write failing layout test**

```ts
const html = desktopLayoutHtml();
assert.match(html, /data-testid="world-3d"/);
assert.match(html, /data-testid="toolbox"/);
assert.match(html, /data-testid="inspector"/);
assert.doesNotMatch(html, /world-canvas/);
```

- [ ] **Step 2: Implement shell HTML/CSS**

Top HUD, left tool rail, center `<canvas data-testid="world-3d">`, right inspector, expandable management sections. Canvas is WebGL surface only.

- [ ] **Step 3: Implement boot**

```ts
export class DesktopApp {
  constructor(private readonly root: HTMLElement) {}
  start(): void {
    root.innerHTML = desktopLayoutHtml();
    document.documentElement.dataset.desktopReady = 'true';
  }
}
```

`main.ts` finds `#app` and calls `new DesktopApp(root).start()`.

- [ ] **Step 4: Verify and commit**

```bash
node --experimental-strip-types --test tests/desktop_layout.test.ts
npm run desktop:build
rg "GameApp|WorldRenderer|getContext\(['\"]2d" src/desktop
# expected: no matches
git add src/desktop/renderer tests/desktop_layout.test.ts
git commit -m "feat: add desktop renderer shell"
```

---

### Task 5: Package and smoke-test D0 on Windows

**Files:**
- Create: `tests/desktop/electronHarness.mjs`
- Create: `tests/desktop/electron_smoke.mjs`
- Create: `scripts/find-windows-package.mjs`
- Modify: `.github/workflows/ci.yml`

**Interfaces:** `electronHarness` can launch built app through installed Electron for developer tests or exact packaged EXE for package smoke.

- [ ] **Step 1: Implement launch harness**

Installed mode obtains Electron executable from the `electron` package and launches app root (`package.json.main` points at `out/main/index.js`). Packaged mode accepts only the exact path returned by `find-windows-package.mjs`.

- [ ] **Step 2: Write smoke assertions**

Assert title `Civic Foundry`, `[data-testid="world-3d"]` visible, `window.require` unavailable, close cleanly.

- [ ] **Step 3: Add exact Windows package discovery**

Only accept `release/win-unpacked/Civic Foundry.exe`; no fuzzy recursive lookup.

- [ ] **Step 4: Add Windows CI install/package sequence**

```bash
npm ci --ignore-scripts --no-audit --no-fund
node node_modules/electron/install.js
npm run desktop:package
npm run desktop:smoke
```

Use `windows-latest`, Node 22; upload `release/*.exe` and `release/win-unpacked/**`. Do not run arbitrary dependency postinstall scripts.

- [ ] **Step 5: Run inherited verification and commit**

```bash
npm run verify
git add tests/desktop scripts/find-windows-package.mjs .github/workflows/ci.yml
git commit -m "ci: package and smoke-test desktop foundation"
```

**D0 Gate:** Windows executable boots securely, native Save V9 services exist, inherited simulation verification remains green.

---

# D1 — Babylon 3D Vertical Slice

### Task 6: Define deterministic presentation snapshots and world mapping

**Files:**
- Create: `src/presentation/snapshot/CityPresentationSnapshot.ts`
- Create: `src/presentation/snapshot/PresentationSnapshotBuilder.ts`
- Create: `src/presentation/snapshot/WorldCoordinateMapping.ts`
- Test: `tests/presentation_snapshot.test.ts`

**Interfaces:** `buildCityPresentationSnapshot(core: SimulationCore, presentationRevision: number)`; locked snapshot type above.

- [ ] **Step 1: Write failing determinism tests**

Two identical seeded cores + same revision `7` must deep-equal. Assert sorted parcels/buildings/roads, row-major terrain, and no object identity leakage from mutable simulation owners.

- [ ] **Step 2: Define renderer records**

`BuildingPresentation` uses actual `BuildingV2`: `id`, `parcelIds`, `typologyId`, `footprint`, `heightMeters`, `stories`, `status`, `lifecycle.condition`, dominant floor-use allocation, project progress. `ParcelPresentation` retains canonical parcel ID/polygon/frontage metadata. `props` begins as frozen empty array.

- [ ] **Step 3: Implement coordinate mapping**

```ts
export const worldMetersToBabylon = (point: WorldPoint, elevationMeters = 0) => Object.freeze({
  x: point.x,
  y: elevationMeters,
  z: point.y,
});
```

Legacy transportation cells map to physical cell centers using `LEGACY_CELL_SIZE_METERS`.

- [ ] **Step 4: Implement D1 snapshot builder**

Terrain: `core.world.terrainSampleAt`. Parcels: `core.cadastre.listParcels/parcelPolygon`. Buildings: `core.buildings.listV2`. Roads: deduplicate opposite directed `transportationGraph.edges` using ordered endpoint IDs while retaining source edge IDs.

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

**Interfaces:** `diffPresentationSnapshots(previous, next): PresentationDelta`, including `props`.

- [ ] **Step 1: Write failing delta tests**

Null→all created; identical→empty; one building field changed→one updated; removed ID→one sorted removal; input order change only→no update.

- [ ] **Step 2: Implement ID-based structural diff**

Sort every created/updated/removed collection by stable ID. `terrainChanged` is based on terrain/world data, not frame count.

- [ ] **Step 3: Verify and commit**

```bash
node --experimental-strip-types --test tests/presentation_delta.test.ts tests/presentation_snapshot.test.ts
git add src/presentation/snapshot tests/presentation_delta.test.ts
git commit -m "feat: add deterministic presentation deltas"
```

---

### Task 8: Bootstrap Babylon scene/synchronizer with `NullEngine`

**Files:**
- Create: `src/presentation/scene/CityScene.ts`
- Create: `src/presentation/scene/SceneSynchronizer.ts`
- Create: `src/presentation/scene/EntityVisualRegistry.ts`
- Create: `src/presentation/scene/SceneMaterials.ts`
- Test: `tests/babylon_scene.test.ts`

**Interfaces:** `SceneSynchronizer.apply(snapshot, delta)` requires strictly increasing presentation revision; registry maps category+ID to disposable Babylon visuals.

- [ ] **Step 1: Write failing NullEngine test**

Instantiate `NullEngine`, create city scene, apply empty revision 1, assert scene/camera/lights and no simulation mutation.

- [ ] **Step 2: Implement registry**

Separate maps for terrain/parcels/buildings/roads/vehicles/facilities/props; `get/set/removeAndDispose/clearAndDispose`.

- [ ] **Step 3: Implement scene/materials**

Hemispheric + directional light, shared materials; guard GPU-only effects in `NullEngine`.

- [ ] **Step 4: Implement synchronizer guard/delegation**

Reject duplicate/decreasing revisions; empty categories are no-ops until scene layers are added.

- [ ] **Step 5: Verify and commit**

```bash
node --experimental-strip-types --test tests/babylon_scene.test.ts
npm run typecheck
git add src/presentation/scene tests/babylon_scene.test.ts
git commit -m "feat: bootstrap Babylon city scene"
```

---

### Task 9: Render terrain, parcels, `BuildingV2`, and current roads

**Files:**
- Create: `src/presentation/terrain/TerrainMeshBuilder.ts`
- Create: `src/presentation/terrain/TerrainSceneLayer.ts`
- Create: `src/presentation/parcels/ParcelSceneLayer.ts`
- Create: `src/presentation/buildings/BuildingMeshBuilder.ts`
- Create: `src/presentation/buildings/BuildingSceneLayer.ts`
- Create: `src/presentation/roads/RoadSceneLayer.ts`
- Modify: `src/presentation/scene/SceneSynchronizer.ts`
- Test: `tests/babylon_city_geometry.test.ts`

**Interfaces:** Canonical IDs in Babylon metadata; road visuals use existing road types only.

- [ ] **Step 1: Write failing geometry tests**

Small synthetic world: assert X/Z physical plane, Y elevation, finite normals, canonical metadata, `BuildingV2.heightMeters/stories` reflected in mesh, unchanged visual identity across no-op delta, disposal on removal.

- [ ] **Step 2: Implement pure chunked terrain geometry**

Compute corner elevation by averaging neighboring cell-center samples, then positions/indices/normals. Babylon mesh creation consumes this pure data.

- [ ] **Step 3: Implement parcel surfaces**

Triangulate canonical rings into selectable surfaces slightly above terrain; metadata `{ kind:'parcel', id }`.

- [ ] **Step 4: Implement building massing**

Extrude footprint to actual `heightMeters`; roof triangulation + wall quads; shared material family based on dominant use/status/condition.

- [ ] **Step 5: Implement road ribbons**

Use deduplicated road endpoints; width maps from current `RoadType`. Do not introduce lanes, turns, signals, parking, or crash logic.

- [ ] **Step 6: Verify and commit**

```bash
node --experimental-strip-types --test tests/babylon_city_geometry.test.ts tests/babylon_scene.test.ts
npm run typecheck
git add src/presentation/terrain src/presentation/parcels src/presentation/buildings src/presentation/roads src/presentation/scene/SceneSynchronizer.ts tests/babylon_city_geometry.test.ts
git commit -m "feat: render physical city geometry in Babylon"
```

---

### Task 10: Add free orbit camera, GPU picking, selection, and cell compatibility mapping

**Files:**
- Create: `src/presentation/camera/CityCamera.ts`
- Create: `src/presentation/camera/CameraController.ts`
- Create: `src/presentation/selection/SelectionTypes.ts`
- Create: `src/presentation/selection/PresentationSelectionResolver.ts`
- Create: `src/presentation/selection/SelectionHighlighter.ts`
- Test: `tests/babylon_navigation_selection.test.ts`

**Interfaces:** Use Babylon `ArcRotateCamera`; `SelectionTarget` discriminates terrain/cell, parcel, building, road.

- [ ] **Step 1: Write failing pick-resolution tests**

Pick meshes with metadata and assert canonical IDs. Terrain hit returns world meters plus derived legacy cell only when within terrain bounds.

- [ ] **Step 2: Implement `ArcRotateCamera` controls**

Wheel zoom, Q/E rotation, WASD target pan, middle-drag pan, radius/pitch bounds, focus selected entity. Ignore gameplay hotkeys while text/select/number controls have focus.

- [ ] **Step 3: Implement selection/highlighting**

Renderer-local selection; highlight/outline/shared emissive override; clear when selected visual disappears.

- [ ] **Step 4: Verify and commit**

```bash
node --experimental-strip-types --test tests/babylon_navigation_selection.test.ts
npm run typecheck
git add src/presentation/camera src/presentation/selection tests/babylon_navigation_selection.test.ts
git commit -m "feat: add 3D camera and GPU selection"
```

---

### Task 11: Integrate the playable D1 Babylon vertical slice

**Files:**
- Create: `src/desktop/renderer/src/GameViewport.ts`
- Create: `src/desktop/renderer/src/DesktopGameplayAdapter.ts`
- Create: `src/desktop/renderer/src/D1Controls.ts`
- Modify: `src/desktop/renderer/src/DesktopApp.ts`
- Create: `tests/desktop/d1_vertical_slice.mjs`
- Test: `tests/desktop_gameplay_adapter.test.ts`

**Interfaces:** `DesktopApp` owns `SimulationCore`, simulation accumulator, `presentationRevision`; `GameViewport` owns Babylon engine/render loop; adapter delegates to existing `ToolController`.

- [ ] **Step 1: Write failing gameplay-adapter tests**

Seed core; successful road changes `core.roads`; zoning changes existing zoning; invalid actions do not mutate state; reasons come from existing simulation APIs.

- [ ] **Step 2: Implement viewport**

```ts
const engine = new Engine(canvas, true, { preserveDrawingBuffer: false, stencil: true });
const cityScene = new CityScene(engine);
engine.runRenderLoop(() => cityScene.scene.render());
window.addEventListener('resize', () => engine.resize());
```

- [ ] **Step 3: Implement revision publishing**

Start `presentationRevision = 0`. After each successful authoritative tool command or simulation tick batch: increment exactly once, build snapshot with new revision, diff from prior, apply. Paused successful edits still publish.

- [ ] **Step 4: Implement D1 controls**

Inspect; speed 0/1/2/4; local-road drag path; R/C/I zoning; manual Save/Load. GPU picks convert to legacy cells only at `ToolController` compatibility boundary.

- [ ] **Step 5: Implement D1 smoke**

Use `electronHarness` in installed-Electron mode after `desktop:build`; diagnostics report `{ renderer:'babylon', terrainMeshes, parcelVisuals, buildingVisuals }`. Assert nonzero city visuals.

- [ ] **Step 6: Verify old renderer absence and commit**

```bash
node node_modules/electron/install.js
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

**D1 Gate:** desktop city is playable through Babylon for camera/inspect/road/zoning/speed/save/load and desktop/presentation code does not import Canvas2D world rendering.

---

# D2 — Gameplay Presentation Parity

### Task 12: Render all moving vehicle categories with presentation-only interpolation

**Files:**
- Modify: `src/presentation/snapshot/PresentationSnapshotBuilder.ts`
- Create: `src/presentation/vehicles/VehiclePose.ts`
- Create: `src/presentation/vehicles/VehicleInterpolation.ts`
- Create: `src/presentation/vehicles/VehicleSceneLayer.ts`
- Modify: `src/presentation/scene/SceneSynchronizer.ts`
- Test: `tests/babylon_vehicles.test.ts`

**Interfaces:** Existing traffic/service/transit/freight state supplies routes/current edge; no new routing authority.

- [ ] **Step 1: Write failing pose/snapshot tests**

Assert deterministic IDs, current edge resolves to finite pose, route identity change resets interpolation, and deleting entity disposes visual.

- [ ] **Step 2: Implement authoritative edge pose**

Traffic normalized progress uses `edgeProgressTicks / edgeMetric.travelTimeTicks` clamped `[0,1]`; other vehicle categories use their existing authoritative progress fields. Resolve edge endpoints from `TransportationGraph`.

- [ ] **Step 3: Implement interpolation buffer**

Store previous/current authoritative poses + arrival timestamps; interpolate only inside interval; never extrapolate/write back.

- [ ] **Step 4: Implement pooled vehicle visuals**

Shared prototypes/materials for traffic/service/transit/freight; pool on remove when safe.

- [ ] **Step 5: Verify and commit**

```bash
node --experimental-strip-types --test tests/babylon_vehicles.test.ts tests/presentation_snapshot.test.ts
npm run typecheck
git add src/presentation tests/babylon_vehicles.test.ts
git commit -m "feat: render moving city vehicles in Babylon"
```

---

### Task 13: Migrate every current gameplay tool and 3D placement preview

**Files:**
- Expand: `src/desktop/renderer/src/DesktopGameplayAdapter.ts`
- Create: `src/presentation/selection/PlacementPreview.ts`
- Modify: `src/desktop/renderer/src/DesktopApp.ts`
- Test: `tests/desktop_tools_parity.test.ts`

**Interfaces:** Exact current `ToolId` coverage: inspect; local/collector/arterial roads; R/C/I zoning; power/water/landfill; fire/police/clinic/school/service-landfill/recycling; transit surface/metro stop; bulldoze.

- [ ] **Step 1: Write failing parity tests for every ToolId**

Assert adapter delegates to the same existing simulation call as `ToolController`; invalid operation preserves authoritative snapshot and existing failure reason.

- [ ] **Step 2: Implement result contract**

```ts
export type DesktopCommandResult = Readonly<{
  ok: boolean;
  message?: string;
  authoritativeChanged: boolean;
}>;
```

Only successful simulation mutation sets `authoritativeChanged:true`.

- [ ] **Step 3: Implement disposable previews**

Shared translucent valid/invalid road/cell geometry; clear after apply/cancel/tool switch; never snapshot/save it.

- [ ] **Step 4: Verify and commit**

```bash
node --experimental-strip-types --test tests/desktop_tools_parity.test.ts
git add src/desktop/renderer/src/DesktopGameplayAdapter.ts src/desktop/renderer/src/DesktopApp.ts src/presentation/selection/PlacementPreview.ts tests/desktop_tools_parity.test.ts
git commit -m "feat: migrate all gameplay tools and previews"
```

---

### Task 14: Migrate all analytical overlays

**Files:**
- Create: `src/presentation/overlays/OverlayTypes.ts`
- Create: `src/presentation/overlays/OverlaySnapshotBuilder.ts`
- Create: `src/presentation/overlays/OverlaySceneLayer.ts`
- Create: `src/presentation/overlays/OverlayLegend.ts`
- Modify: `src/presentation/snapshot/PresentationSnapshotBuilder.ts`
- Modify temporarily: current overlay modules in `src/rendering/` to import/re-export shared mode types/helpers
- Test: `tests/babylon_overlays.test.ts`

**Interfaces:** One `ActiveOverlay` discriminated union covers current traffic, service, transit, economy/freight, cadastral, zoning-envelope, and land/housing/development modes. One active analytical mode at a time.

- [ ] **Step 1: Write failing overlay-mode coverage test**

Expected set is constructed explicitly from current public mode strings; new `OVERLAY_MODES` must equal it with no duplicates/missing modes.

- [ ] **Step 2: Move mode definitions/pure mappings to new overlay module**

Old renderer modules import/re-export these definitions until D4; no Canvas types enter new code.

- [ ] **Step 3: Build overlay values from existing authoritative/cached metrics**

Use current traffic/service/mobility/economy/cadastre/zoning/land-housing inputs; do not recalculate simulation outcomes in presentation.

- [ ] **Step 4: Implement Babylon overlay scene layer**

Shared materials, vertex/instance colors, lines or thin surfaces; update only on mode/source invalidation.

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
- Modify only when needed to extract DOM-independent operations: `src/ui/Hud.ts`, `src/ui/Inspector.ts`, `src/ui/TransitPanel.ts`, `src/ui/EconomyPanel.ts`, `src/ui/UrbanFabricUiController.ts`, `src/ui/LandHousingUiController.ts`
- Test: `tests/desktop_ui_parity.test.ts`

**Interfaces:** Desktop UI receives core, gameplay adapter, selection, current presentation snapshot. It does not receive writable Babylon scene objects.

- [ ] **Step 1: Write failing UI contract test**

Assert stable controls for every ToolId, speed 0/1/2/4, three taxes, five service budgets, every current overlay selector, transit line create/route/stop/config controls, inspector, Save/Load/Import, Urban Fabric and land/housing surfaces.

- [ ] **Step 2: Extract only direct-`GameApp` dependencies**

Keep `collectHudMetrics`, `inspectCell`, `inspectTransitLine`, `inspectTransitVehicle`, `TransitPanelController`, economy collection logic when already independent. For `UrbanFabricUiController`/`LandHousingUiController`, extract their simulation action/collection functions into focused `src/ui/` helpers while leaving old browser controller importing those helpers until D4.

- [ ] **Step 3: Bind desktop controls**

Taxes → `core.taxes.setRate`; service funding → `core.setServiceFunding`; transit → `TransitPanelController`; overlays → `OverlayController`; inspection → canonical selection/compatibility cell.

- [ ] **Step 4: Enforce overlay mutual exclusion**

Changing one analytical mode sets every other selector to `none`, updates snapshot overlay input, increments presentation revision once.

- [ ] **Step 5: Verify and commit**

```bash
node --experimental-strip-types --test tests/desktop_ui_parity.test.ts
npm test
npm run typecheck
git add src/desktop/renderer/src src/ui tests/desktop_ui_parity.test.ts
git commit -m "feat: migrate city management UI to desktop"
```

---

### Task 16: Complete safe persistence UX, autosaves, and full D2 gameplay smoke

**Files:**
- Create: `src/desktop/renderer/src/DesktopPersistenceController.ts`
- Create: `src/desktop/renderer/src/AutosaveController.ts`
- Modify: `src/desktop/renderer/src/DesktopApp.ts`
- Test: `tests/autosave_controller.test.ts`
- Create: `tests/desktop/d2_gameplay_smoke.mjs`

**Interfaces:** Hydrate candidate before active-core replacement; autosave slots 0→1→2; dirty state clears only on successful write.

- [ ] **Step 1: Write failing autosave tests**

Fake real-time clock: no save before 300,000 ms; clean city never autosaves; successful save rotates slot; failed save stays dirty; load transition suppresses; successful manual save resets dirty baseline.

- [ ] **Step 2: Implement safe load/import replacement**

```ts
const result = await window.civicDesktop.loadGame({ name });
if (!result.ok) return result;
const candidate = hydrateCore(result.value);
this.replaceCore(candidate);
```

Import calls `window.civicDesktop.importSave({ name })`; main owns picker. Load imported logical name and hydrate before replacement.

- [ ] **Step 3: Implement exact D2 smoke sequence**

Automate with UI/test IDs:
1. launch seeded city;
2. build five-cell straight local road;
3. zone two adjacent residential cells and one commercial cell;
4. place power, water, and fire station;
5. place two surface transit stops at road endpoints;
6. create bus line `Smoke Line`, set initial route between the two stops, enable it, set explicit headway/fare/fleet values;
7. run at 4× until tick advances;
8. activate traffic then Urban Fabric overlay and verify mutual exclusion;
9. change residential tax and fire funding;
10. save `Desktop Smoke`;
11. quit, relaunch, load;
12. assert saved tick/treasury/roads/zoning/transit line/tax/funding and canonical parcel/building IDs.

- [ ] **Step 4: Run D2 gate and commit**

```bash
node node_modules/electron/install.js
node --experimental-strip-types --test tests/autosave_controller.test.ts
npm run desktop:build
node tests/desktop/d2_gameplay_smoke.mjs
npm test
npm run typecheck
npm run architecture:check
git add src/desktop/renderer/src tests/autosave_controller.test.ts tests/desktop/d2_gameplay_smoke.mjs
git commit -m "feat: complete desktop gameplay presentation parity"
```

**D2 Gate:** current tools, management, overlays, inspection, vehicles, and persistence operate through desktop/Babylon. Browser Canvas renderer is reference-only.

---

# D3 — 3D Asset and Visual Pipeline

### Task 17: Introduce validated 3D runtime asset manifest

**Files:**
- Create: `src/presentation/assets/AssetTypes.ts`
- Create: `src/presentation/assets/DesktopAssetManifest.ts`
- Create: `src/presentation/assets/AssetManifestValidation.ts`
- Create: `assets/runtime/manifest.json`
- Modify: `scripts/check-assets.mjs`
- Test: `tests/desktop_asset_manifest.test.ts`

**Interfaces:** `RuntimeAsset.kind = 'glb' | 'texture' | 'procedural-kit'`; categories building/vehicle/facility/road/terrain/prop; required flag; optional ordered LODs.

- [ ] **Step 1: Write failing manifest-validation tests**

Reject duplicate IDs, absolute/traversal paths, unsupported extensions, missing required references, non-increasing LOD distances. Accept minimal procedural-only manifest.

- [ ] **Step 2: Define asset type**

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

- [ ] **Step 3: Implement manifest/repository checks**

Extend `check-assets.mjs` to validate desktop runtime paths/extensions while retaining old atlas checks until D4 removes legacy runtime.

- [ ] **Step 4: Verify and commit**

```bash
node --experimental-strip-types --test tests/desktop_asset_manifest.test.ts
npm run assets:policy
git add src/presentation/assets assets/runtime/manifest.json scripts/check-assets.mjs tests/desktop_asset_manifest.test.ts
git commit -m "feat: add validated 3D runtime asset manifest"
```

---

### Task 18: Implement asset registry, instancing, LODs, props, and procedural kits

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

**Interfaces:** `preloadRequired`, `instantiate`, `diagnostics`; required missing asset fails readiness, optional missing asset returns explicit fallback visual + diagnostic.

- [ ] **Step 1: Write failing NullEngine tests**

Procedural kit resolves; missing required GLB gives `required-asset-missing`; optional missing GLB gives fallback; pool reuses visuals; LOD resolver deterministic; prop delta create/remove works.

- [ ] **Step 2: Register glTF loader once and cache containers**

Import `@babylonjs/loaders/glTF` in registry bootstrap; cache `AssetContainer` results.

- [ ] **Step 3: Implement pools/thin instances**

Vehicles/facilities/props share prototypes. Use thin instances for non-pickable repetition; individually selectable entities maintain registry nodes.

- [ ] **Step 4: Mature procedural building kit**

Shared facade/roof/window material families based on dominant use, status, condition band, deterministic ID hash. Geometry remains driven by canonical footprint/height/stories.

- [ ] **Step 5: Implement visual LOD**

Near detailed massing; medium simplified extrusion; far low-poly proxy. LOD never changes authoritative state.

- [ ] **Step 6: Verify and commit**

```bash
node --experimental-strip-types --test tests/babylon_asset_registry.test.ts tests/babylon_city_geometry.test.ts tests/babylon_vehicles.test.ts
npm run typecheck
git add src/presentation tests/babylon_asset_registry.test.ts
git commit -m "feat: add instanced 3D asset and procedural kits"
```

---

### Task 19: Make 3D desktop asset pipeline canonical

**Files:**
- Create: `scripts/build-desktop-assets.mjs`
- Modify: `package.json`
- Modify: `electron-builder.yml`
- Modify: `docs/art/ASSET_BIBLE.md`
- Test: `tests/desktop_asset_build.test.ts`

**Interfaces:** `desktop:assets:check`; desktop build packages `assets/runtime/**`; desktop build does not invoke atlas generator.

- [ ] **Step 1: Write failing asset-build contract test**

Assert `desktop:build` starts with desktop asset check and no desktop command contains `render_isometric_atlases.py`.

- [ ] **Step 2: Implement deterministic runtime asset check**

Parse manifest, ensure every required path exists inside `assets/runtime`, extensions/LOD paths valid; `--check` makes no writes.

- [ ] **Step 3: Update scripts/package files**

```json
{
  "desktop:assets:check": "node scripts/build-desktop-assets.mjs --check",
  "desktop:build": "npm run desktop:assets:check && electron-vite build"
}
```

Add `assets/runtime/**/*` to electron-builder `files`.

- [ ] **Step 4: Update asset bible**

Document GLB/glTF runtime form, manifest IDs, compressed textures, procedural kits, instancing/LOD/culling; isometric assets are legacy-only until D4.

- [ ] **Step 5: Verify and commit**

```bash
npm run desktop:assets:check
npm run desktop:build
node --experimental-strip-types --test tests/desktop_asset_build.test.ts
npm test
git add scripts/build-desktop-assets.mjs package.json package-lock.json electron-builder.yml docs/art/ASSET_BIBLE.md tests/desktop_asset_build.test.ts
git commit -m "build: make 3D asset pipeline canonical for desktop"
```

**D3 Gate:** desktop package uses validated procedural/GLB runtime assets, instancing/LOD/culling, no desktop atlas dependency.

---

# D4 — Canvas2D and Browser Runtime Removal

### Task 20: Add exact performance fixtures and renderer telemetry

**Files:**
- Create: `src/presentation/performance/RendererTelemetry.ts`
- Create: `src/presentation/performance/PerformanceFixtureFactory.ts`
- Create: `tests/presentation_performance_fixture.test.ts`
- Create: `tests/performance/renderer_reference.mjs`
- Create: `tests/performance/renderer_stress.mjs`
- Modify: `src/desktop/renderer/src/DesktopApp.ts`
- Modify: `package.json`

**Interfaces:** Synthetic fixture is `CityPresentationSnapshot`; telemetry records FPS/frame time, build/sync ms, simulation tick duration, meshes/instances/draw calls, entity+prop counts.

- [ ] **Step 1: Write failing exact-count tests**

Reference exactly 2,000 buildings/1,000 vehicles/5,000 props/one overlay. Stress exactly 5,000/2,000/20,000/one overlay. IDs deterministic and sorted.

- [ ] **Step 2: Implement fixed-seed fixture factory**

Generate presentation data directly; do not add simulation APIs to fabricate scale.

- [ ] **Step 3: Implement telemetry window**

Warmup excluded; compute median and 1% low from 30-second sample; export JSON.

- [ ] **Step 4: Implement launch/benchmark scripts**

Launch built/package app in fixture mode; wait 10 sec, sample 30 sec; enforce thresholds under `--enforce-reference`.

- [ ] **Step 5: Add commands, verify structural tests, commit**

```json
{
  "desktop:perf:reference": "node tests/performance/renderer_reference.mjs --enforce-reference",
  "desktop:perf:stress": "node tests/performance/renderer_stress.mjs --enforce-reference"
}
```

```bash
node --experimental-strip-types --test tests/presentation_performance_fixture.test.ts
npm run desktop:build
git add src/presentation/performance src/desktop/renderer/src/DesktopApp.ts tests/performance tests/presentation_performance_fixture.test.ts package.json package-lock.json
git commit -m "perf: add desktop renderer performance gates"
```

Hosted/software-rendered CI may collect telemetry but cannot substitute for reference-hardware acceptance.

---

### Task 21: Add architecture/rendering-policy scanners without a red canonical gate

**Files:**
- Modify: `scripts/check-architecture.mjs`
- Create: `scripts/check-rendering-policy.mjs`
- Create: `tests/rendering_policy.test.ts`
- Modify: `package.json`

**Interfaces:** `findForbiddenRenderingUsage(path, source)` flags `CanvasRenderingContext2D`, `.getContext('2d')`, and legacy renderer imports inside production `src`.

- [ ] **Step 1: Write failing scanner unit tests**

Canvas2D examples must be flagged; `new Engine(canvas)` and plain `HTMLCanvasElement` must pass.

- [ ] **Step 2: Implement scanner**

Scan `src/**/*.ts`; tests are outside `src`; no general production allow-list.

- [ ] **Step 3: Extend architecture boundaries**

Simulation/world/save may not import desktop/presentation. Presentation may not import desktop. Existing simulation/world old-rendering bans remain until deletion.

- [ ] **Step 4: Add noncanonical script only**

```json
{ "rendering:policy": "node scripts/check-rendering-policy.mjs" }
```

Do not add it to `verify` yet because legacy Canvas code is intentionally still present until Task 22.

- [ ] **Step 5: Run unit tests GREEN and legacy scan diagnostically**

```bash
node --experimental-strip-types --test tests/rendering_policy.test.ts
npm run architecture:check
npm run rendering:policy || true
```

First two commands must pass; final command should enumerate known legacy files.

- [ ] **Step 6: Commit**

```bash
git add scripts/check-architecture.mjs scripts/check-rendering-policy.mjs tests/rendering_policy.test.ts package.json package-lock.json
git commit -m "test: add desktop rendering architecture policy"
```

---

### Task 22: Delete Canvas2D/isometric/browser runtime and atlas pipeline

**Files:**
- Delete: `src/rendering/WorldRenderer.ts`
- Delete: Canvas vehicle renderers in `src/rendering/`
- Delete: `src/rendering/passes/*` Canvas passes after import inventory
- Delete: `src/rendering/isometric/*`
- Delete: sprite-only `src/rendering/assets/*` modules after import inventory
- Delete: old `src/rendering/*OverlayLayer.ts` implementations after shared types/helpers moved
- Delete: `src/app/GameApp.ts`
- Delete: root `src/main.ts`
- Delete: root `index.html`
- Delete: `tools/render_isometric_atlases.py`
- Delete: superseded browser/isometric smoke tests
- Modify/delete: `scripts/build.mjs`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`
- Modify repository/asset policies for removed outputs

**Interfaces:** Canonical runtime = Electron main/preload/desktop renderer + Babylon. `build`/`dev` alias desktop commands; `verify` adds rendering policy and desktop asset check.

- [ ] **Step 1: Inventory legacy imports**

```bash
rg "WorldRenderer|Isometric|PassAAssetManifest|SpritePainter|render_isometric_atlases|src/rendering|\.\./rendering" src tests scripts package.json .github README.md docs
```

Migrate every surviving production consumer before deletion; preserve useful pure UI helpers under `src/ui`.

- [ ] **Step 2: Delete browser app/entry path**

Remove `GameApp`, root `src/main.ts`, root `index.html` after desktop parity tests already cover their functionality.

- [ ] **Step 3: Delete legacy render stack**

Remove WorldRenderer, Canvas passes, Canvas vehicle renderers, isometric camera/projection/culling/painter, sprite registry/painter/manifest and old overlay implementations no longer used.

- [ ] **Step 4: Remove atlas/browser smoke build dependencies**

Remove Python atlas generation and superseded browser visual-smoke scripts from package, build, CI; delete tracked atlas runtime outputs not in desktop manifest.

- [ ] **Step 5: Make canonical scripts desktop-native**

```json
{
  "build": "npm run desktop:build",
  "dev": "npm run desktop:dev",
  "assets:check": "npm run desktop:assets:check",
  "assets:build": "node scripts/build-desktop-assets.mjs",
  "verify": "npm run format:check && npm run lint && npm run policy:check && npm run architecture:check && npm run rendering:policy && npm run typecheck && npm test && npm run assets:policy && npm run assets:check && npm run build"
}
```

- [ ] **Step 6: Require policy/search GREEN**

```bash
npm run rendering:policy
rg "CanvasRenderingContext2D|getContext\(['\"]2d|WorldRenderer|render_isometric_atlases" src scripts package.json .github
# expected: no production matches
```

- [ ] **Step 7: Run full functional D4 gate**

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

### Task 23: Finalize CI, reference-performance acceptance, docs, and D4 checkpoint

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

**Interfaces:** Standard CI = Linux verification + Windows package/smoke/artifacts. Reference-performance workflow = self-hosted `[windows, x64, civic-foundry-reference]` matching spec hardware class.

- [ ] **Step 1: Finalize standard CI**

Linux: `npm ci --ignore-scripts`, verify + desktop build. Windows: `npm ci --ignore-scripts`, `node node_modules/electron/install.js`, verify, package, package smoke, D2 gameplay smoke, upload NSIS/unpacked. Remove Python/Pillow/Chromium setup when no surviving test uses it.

- [ ] **Step 2: Add reference-performance workflow**

`workflow_dispatch` plus release/tag trigger on `[self-hosted, windows, x64, civic-foundry-reference]`; explicitly install Electron binary, package app, run `desktop:perf:reference`, `desktop:perf:stress`, upload telemetry JSON. D4 cannot be accepted without this green run.

- [ ] **Step 3: Update canonical architecture documentation**

```text
Electron Renderer → DesktopApp → CityPresentationSnapshot → Babylon CityScene
                                      ↑
                               SimulationCore facade
                                      ↓
             SimulationKernel + WorldFoundation + CadastralGraph + domains
```

State HTML canvas is WebGL surface only; Canvas2D world rendering prohibited.

- [ ] **Step 4: Update testing/engineering/save/asset docs**

Document desktop commands, NullEngine tests, package smoke, rendering policy, `.cfsave`, atomic saves/autosaves/import, Electron security, runtime asset manifest, performance fixtures, Windows artifacts.

- [ ] **Step 5: Add ADR**

Record Electron + Babylon, WebGL2 baseline, HTML/CSS management UI, snapshot authority boundary, narrow preload bridge, and Canvas/browser retirement.

- [ ] **Step 6: Run final nonperformance gates**

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run verify
npm run desktop:build
```

Windows:

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

- [ ] **Step 8: Verify legacy runtime absent**

```bash
rg "CanvasRenderingContext2D|getContext\(['\"]2d|WorldRenderer|IsometricCamera|render_isometric_atlases" src scripts package.json .github
```

Expected: no production/runtime matches. Historical docs may mention removed system only as history.

- [ ] **Step 9: Commit final checkpoint**

```bash
git add .github README.md docs package.json package-lock.json
git commit -m "docs: declare Babylon desktop runtime canonical"
```

---

## Final D4 Acceptance Checklist

- [ ] Packaged Windows application launches through Electron and Babylon WebGL2.
- [ ] Player can create a deterministic city; orbit/pan/zoom/inspect; build/bulldoze roads; zone R/C/I; place current utilities/services; change speed/taxes/service budgets; operate transit; use all current analytical overlays; observe traffic/service/transit/freight movement in 3D.
- [ ] `CityPresentationSnapshot`/delta is deterministic for identical authoritative input + presentation revision; Babylon state never enters Save V9.
- [ ] Desktop save/load/import preserves V3–V9 migration behavior; three rotating autosaves work; failed writes leave prior valid saves intact.
- [ ] Renderer has no Node integration, arbitrary filesystem path access, shell authority, or general IPC authority.
- [ ] No supported production `CanvasRenderingContext2D`, `getContext('2d')`, `WorldRenderer`, isometric render pass, or atlas-generation dependency remains.
- [ ] GLB/procedural runtime asset manifest validation passes and Windows package contains every required runtime asset.
- [ ] All inherited deterministic simulation tests pass.
- [ ] Babylon NullEngine/presentation tests, packaged smoke, full gameplay smoke, architecture/rendering policies pass.
- [ ] Reference and stress thresholds pass on defined reference hardware.
- [ ] CI emits unpacked Windows build + NSIS installer and reference-performance telemetry is green.
- [ ] README/architecture/testing/engineering/save/asset docs declare Electron/Babylon canonical.
- [ ] Only after every item above is green may the implementation branch unlock 3R Transportation Engine 2.0.
