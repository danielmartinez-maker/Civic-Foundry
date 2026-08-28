# Civic Foundry Windows Desktop + Babylon.js Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Civic Foundry's browser/Canvas2D production runtime with a secure Electron Windows desktop application whose city world is rendered entirely through Babylon.js while preserving the deterministic simulation and Save V9 compatibility chain.

**Architecture:** Keep `SimulationCore`, `SimulationKernel`, `WorldFoundation`, `CadastralGraph`, existing gameplay systems, and Save V3–V9 hydration authoritative. Add a desktop main/preload/renderer process boundary, a typed `CityPresentationSnapshot`, deterministic presentation deltas, and Babylon scene synchronization; migrate gameplay presentation incrementally through D0–D4, then delete the old Canvas/isometric runtime. Each tranche ends with a runnable gate and must not assume authority belonging to 3R or later systems.

**Tech Stack:** Node.js 22, TypeScript 5.8.3, Electron 44.0.0, electron-vite 5.0.0, electron-builder 26.15.3 with NSIS, Babylon.js `@babylonjs/core` 9.23.0 + `@babylonjs/loaders` 9.23.0, Playwright 1.62.1 for Electron smoke automation, existing Node test runner, ESLint 10, Prettier 3, `clipper2-ts` 2.0.1-18.

**Spec:** `docs/superpowers/specs/2026-08-27-windows-desktop-babylon-migration-design.md`

## Global Constraints

- D0 → D1 → D2 → D3 → D4 completes before 3R Transportation Engine 2.0 begins.
- `SimulationKernel` remains deterministic scheduler/time authority; display frame rate may never change authoritative outcomes.
- `WorldFoundation` remains sole physical/geographic authority; `CadastralGraph` remains sole legal-land/topology authority.
- Presentation consumes immutable typed snapshots and emits gameplay intent; Babylon objects are disposable/non-authoritative.
- Save V9 stays the default schema; V3–V9 hydration remains supported; desktop storage location alone must not create Save V10.
- Electron renderer uses `contextIsolation: true`, `nodeIntegration: false`, sandbox where compatible, restrictive navigation/CSP, and a narrow validated preload bridge.
- WebGL2 is the required rendering baseline. WebGPU is not required by this implementation plan.
- Desktop storage uses `%APPDATA%\Civic Foundry\`, `.cfsave`, atomic writes, and three rotating autosave slots at five-real-minute cadence when authoritative state is dirty.
- D1 desktop entry point must not execute Canvas2D world rendering. D4 removes all supported production Canvas2D world-rendering paths.
- The reference fixture is approximately 2,000 buildings / 1,000 moving vehicles / 5,000 repeated props with one analytical overlay; target median ≥60 FPS and 1% low ≥45 FPS at 1080p on reference hardware.
- The stress fixture is approximately 5,000 buildings / 2,000 moving vehicles / 20,000 repeated props with one analytical overlay; acceptance floor median ≥30 FPS and 1% low ≥22 FPS at 1080p on reference hardware.
- If migration exposes a simulation defect, fix it narrowly with regression tests. Do not redesign transportation, households, economics, politics, region scale, or save authority under this plan.

---

## File/Module Map Locked by This Plan

New desktop platform files live under `src/desktop/`. New renderer-facing read models and Babylon scene code live under `src/presentation/`. Existing `src/simulation/`, `src/world/`, and `src/save/` remain authoritative and are changed only when a narrow presentation accessor or compatibility fix is demonstrably required.

Core interfaces introduced early and reused by later tasks:

```ts
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
  overlays: OverlayPresentation;
  hud: HudPresentation;
}>;
```

```ts
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
  overlaysChanged: boolean;
  hudChanged: boolean;
}>;
```

No later task may rename these contracts without updating every dependent task/test in the same commit.

---

# D0 — Windows Desktop Foundation

### Task 1: Pin the desktop toolchain and create Electron build configuration

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `electron.vite.config.ts`
- Create: `electron-builder.yml`
- Create: `src/desktop/renderer/index.html`
- Create: `tests/desktop_toolchain.test.ts`

**Interfaces:**
- Consumes: existing Node 22 / TypeScript 5.8.3 build and repository policy.
- Produces: `npm run desktop:dev`, `desktop:build`, `desktop:package`, `desktop:test`; Electron main output at `out/main/index.js`; preload output at `out/preload/index.js`; renderer bundle under `out/renderer/`.

- [ ] **Step 1: Write the failing toolchain test**

```ts
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('desktop package scripts and pinned dependencies are present', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.scripts['desktop:dev'], 'electron-vite dev');
  assert.equal(pkg.scripts['desktop:build'], 'electron-vite build');
  assert.equal(pkg.scripts['desktop:package'], 'npm run desktop:build && electron-builder --win nsis');
  assert.equal(pkg.dependencies['@babylonjs/core'], '9.23.0');
  assert.equal(pkg.dependencies['@babylonjs/loaders'], '9.23.0');
  assert.equal(pkg.devDependencies.electron, '44.0.0');
  assert.equal(pkg.devDependencies['electron-vite'], '5.0.0');
  assert.equal(pkg.devDependencies['electron-builder'], '26.15.3');
  assert.equal(pkg.devDependencies.playwright, '1.62.1');
});
```

- [ ] **Step 2: Run the new test and verify RED**

Run: `node --experimental-strip-types --test tests/desktop_toolchain.test.ts`

Expected: FAIL because desktop scripts/dependencies are absent.

- [ ] **Step 3: Install pinned dependencies and update scripts**

Run:

```bash
npm install --save-exact @babylonjs/core@9.23.0 @babylonjs/loaders@9.23.0
npm install --save-dev --save-exact electron@44.0.0 electron-vite@5.0.0 electron-builder@26.15.3 playwright@1.62.1 @types/node@22.20.1
```

Set package scripts to include:

```json
{
  "desktop:dev": "electron-vite dev",
  "desktop:build": "electron-vite build",
  "desktop:package": "npm run desktop:build && electron-builder --win nsis",
  "desktop:test": "npm test && npm run desktop:build",
  "desktop:smoke": "node tests/desktop/electron_smoke.mjs"
}
```

- [ ] **Step 4: Add electron-vite and electron-builder configuration**

`electron.vite.config.ts`:

```ts
import { defineConfig } from 'electron-vite';

export default defineConfig({
  main: { build: { outDir: 'out/main' } },
  preload: { build: { outDir: 'out/preload' } },
  renderer: {
    root: 'src/desktop/renderer',
    build: { outDir: '../../../out/renderer', emptyOutDir: false },
  },
});
```

`electron-builder.yml`:

```yaml
appId: com.civicfoundry.desktop
productName: Civic Foundry
directories:
  output: release
files:
  - out/**/*
  - assets/runtime/**/*
win:
  target:
    - nsis
nsis:
  oneClick: false
  allowToChangeInstallationDirectory: true
```

Create `src/desktop/renderer/index.html` with a strict CSP, `#app`, and module entry `/src/main.ts`.

- [ ] **Step 5: Run focused and inherited verification**

Run:

```bash
node --experimental-strip-types --test tests/desktop_toolchain.test.ts
npm run typecheck
npm test
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json electron.vite.config.ts electron-builder.yml src/desktop/renderer/index.html tests/desktop_toolchain.test.ts
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
- Create: `src/desktop/renderer/global.d.ts`
- Test: `tests/desktop_security.test.ts`

**Interfaces:**
- Produces: `DesktopApi`, `buildWindowOptions(preloadPath: string)`, `createMainWindow()`, and `window.civicDesktop`.
- Consumes in Task 3: `DesktopApi` request/result types.

- [ ] **Step 1: Write the failing security/options test**

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildWindowOptions } from '../src/desktop/main/WindowOptions.ts';

test('desktop renderer has no Node authority', () => {
  const options = buildWindowOptions('C:/fake/preload.js');
  assert.equal(options.webPreferences?.contextIsolation, true);
  assert.equal(options.webPreferences?.nodeIntegration, false);
  assert.equal(options.webPreferences?.sandbox, true);
  assert.equal(options.webPreferences?.preload, 'C:/fake/preload.js');
});
```

- [ ] **Step 2: Run test and verify RED**

Run: `node --experimental-strip-types --test tests/desktop_security.test.ts`

Expected: FAIL because `WindowOptions.ts` does not exist.

- [ ] **Step 3: Define the shared bridge contract**

`src/desktop/shared/DesktopApi.ts`:

```ts
export type DesktopResult<T> = Readonly<
  | { ok: true; value: T }
  | { ok: false; code: string; message: string }
>;

export type SaveDescriptor = Readonly<{ name: string; path: string; modifiedMs: number; autosave: boolean }>;
export type SaveGameRequest = Readonly<{ name: string; save: unknown }>;
export type LoadGameRequest = Readonly<{ name: string }>;
export type ImportSaveRequest = Readonly<{ sourcePath: string; name?: string }>;
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

- [ ] **Step 4: Implement secure window options and lifecycle**

`WindowOptions.ts` returns `BrowserWindowConstructorOptions` with `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. `WindowManager.ts` creates one main window, denies `setWindowOpenHandler`, blocks navigation away from the packaged/dev renderer URL, and loads the electron-vite renderer entry.

- [ ] **Step 5: Implement the preload allow-list**

`src/desktop/preload/index.ts` exposes exactly the `DesktopApi` methods through `contextBridge.exposeInMainWorld('civicDesktop', api)`. IPC channel names are constants prefixed `civic:`; do not expose `ipcRenderer` itself.

- [ ] **Step 6: Wire Electron main without storage handlers yet**

`ElectronMain.ts` owns `app.whenReady()`, window creation, `window-all-closed`, and platform lifecycle. IPC registration is a function call placeholder only in the sense of dependency injection: define `registerDesktopIpc()` in Task 3 and import it then; do not add fake successful handlers.

- [ ] **Step 7: Run tests and build**

```bash
node --experimental-strip-types --test tests/desktop_security.test.ts
npm run desktop:build
npm run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/desktop tests/desktop_security.test.ts
git commit -m "feat: add secure Electron process boundary"
```

---

### Task 3: Add atomic native Save V9 storage and rotating autosaves

**Files:**
- Create: `src/desktop/main/NativeStorage.ts`
- Create: `src/desktop/main/DesktopIpc.ts`
- Modify: `src/desktop/main/ElectronMain.ts`
- Test: `tests/native_storage.test.ts`
- Modify: `docs/SAVE_FORMAT.md`

**Interfaces:**
- Produces: `NativeStorage.initialize()`, `listSaves()`, `writeSave()`, `readSave()`, `importSave()`, `writeAutosave()`, `readSettings()`, `writeSettings()`; `registerDesktopIpc(storage)`.
- Consumes: `serializeCore()` / `hydrateCore()` validation remains renderer-side for authoritative load replacement; storage treats the envelope as data and validates request shape/name/path safety.

- [ ] **Step 1: Write RED tests for atomic writes, name safety, and autosave rotation**

Use `mkdtemp()` and a temporary root. Assert:

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

Also pre-create a valid destination, inject a write failure through a test-only `AtomicFileOps` dependency, and assert the original destination bytes remain unchanged.

- [ ] **Step 2: Run and verify RED**

Run: `node --experimental-strip-types --test tests/native_storage.test.ts`

Expected: FAIL because `NativeStorage` does not exist.

- [ ] **Step 3: Implement safe paths and atomic JSON writes**

Use a strict save-name validator (`^[A-Za-z0-9 _.-]{1,80}$` plus rejection of `.`/`..` and trailing dot/space), `mkdir({ recursive: true })`, a same-directory `.<name>.<random>.tmp`, `FileHandle.sync()`, close, optional `.bak` rotation, then `rename()`.

Expose storage layout:

```ts
readonly savesDir = join(root, 'saves');
readonly autosavesDir = join(root, 'autosaves');
readonly settingsPath = join(root, 'settings.json');
readonly logsDir = join(root, 'logs');
```

Autosaves are exact names `autosave-1.cfsave`, `autosave-2.cfsave`, `autosave-3.cfsave` mapped from slots `0|1|2`.

- [ ] **Step 4: Implement validated IPC handlers**

`registerDesktopIpc(storage)` registers `ipcMain.handle()` for each allow-listed channel. Every handler catches errors and returns `DesktopResult<T>`; it never throws raw filesystem errors across IPC.

- [ ] **Step 5: Derive the root from Electron's user-data directory**

In `ElectronMain.ts`:

```ts
const storage = new NativeStorage(join(app.getPath('appData'), 'Civic Foundry'));
await storage.initialize();
registerDesktopIpc(storage);
```

- [ ] **Step 6: Run save/storage and inherited save tests**

```bash
node --experimental-strip-types --test tests/native_storage.test.ts
node --experimental-strip-types --test tests/save*.test.ts
npm run typecheck
```

Expected: PASS with no Save V10 change.

- [ ] **Step 7: Document `.cfsave` as Save V9 JSON envelope**

Update `docs/SAVE_FORMAT.md` with desktop file convention, atomic-write semantics, and three autosave filenames. Keep schema/version text unchanged.

- [ ] **Step 8: Commit**

```bash
git add src/desktop/main src/desktop/preload docs/SAVE_FORMAT.md tests/native_storage.test.ts
git commit -m "feat: add atomic desktop save storage"
```

---

### Task 4: Create the desktop renderer shell and D0 boot path

**Files:**
- Create: `src/desktop/renderer/src/main.ts`
- Create: `src/desktop/renderer/src/DesktopApp.ts`
- Create: `src/desktop/renderer/src/DesktopLayout.ts`
- Create: `src/desktop/renderer/src/desktop.css`
- Modify: `src/desktop/renderer/index.html`
- Test: `tests/desktop_layout.test.ts`

**Interfaces:**
- Produces: `DesktopApp.start()`, stable DOM test IDs, `#world-3d` WebGL canvas surface, `#hud`, `#toolbox`, `#inspector-content`, overlay and management panel roots.
- Does not import `WorldRenderer` or `GameApp`.

- [ ] **Step 1: Write RED layout test**

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { desktopLayoutHtml } from '../src/desktop/renderer/src/DesktopLayout.ts';

test('desktop shell has management regions and Babylon viewport surface', () => {
  const html = desktopLayoutHtml();
  assert.match(html, /data-testid="world-3d"/);
  assert.match(html, /data-testid="toolbox"/);
  assert.match(html, /data-testid="inspector"/);
  assert.doesNotMatch(html, /world-canvas/);
});
```

- [ ] **Step 2: Run RED**

Run: `node --experimental-strip-types --test tests/desktop_layout.test.ts`

- [ ] **Step 3: Implement shell HTML/CSS**

Create a desktop version of the existing three-column city-builder layout. Use an actual `<canvas data-testid="world-3d">` only as Babylon's WebGL drawing surface; do not call `getContext('2d')` anywhere.

- [ ] **Step 4: Implement minimal `DesktopApp` bootstrap**

```ts
export class DesktopApp {
  constructor(private readonly root: HTMLElement) {}
  start(): void {
    this.root.innerHTML = desktopLayoutHtml();
    this.root.dataset.desktopReady = 'true';
  }
}
```

`main.ts` locates `#app`, constructs `DesktopApp`, calls `start()`, and assigns `window.__civicDesktopApp` only in development builds for smoke diagnostics.

- [ ] **Step 5: Run desktop build and verify no browser-app dependency**

```bash
node --experimental-strip-types --test tests/desktop_layout.test.ts
npm run desktop:build
npm run architecture:check
```

Search manually: `src/desktop/` must not import `src/app/GameApp.ts` or `src/rendering/WorldRenderer.ts`.

- [ ] **Step 6: Commit**

```bash
git add src/desktop/renderer tests/desktop_layout.test.ts
git commit -m "feat: add desktop renderer shell"
```

---

### Task 5: Package and smoke-test the D0 Windows application

**Files:**
- Create: `tests/desktop/electron_smoke.mjs`
- Create: `scripts/find-windows-package.mjs`
- Modify: `.github/workflows/ci.yml`
- Modify: `package.json`
- Test: packaged app boot on `windows-latest`

**Interfaces:**
- Produces: reproducible `release/win-unpacked/Civic Foundry.exe` plus NSIS installer; smoke signal `document.documentElement.dataset.desktopReady === 'true'` or equivalent app marker.

- [ ] **Step 1: Write the packaged Electron smoke script**

Use Playwright `_electron.launch({ executablePath })`, obtain the first window, assert title `Civic Foundry`, assert `[data-testid="world-3d"]` is visible, assert renderer `process`/`require` globals are absent, close cleanly.

- [ ] **Step 2: Add deterministic package discovery**

`scripts/find-windows-package.mjs` checks exactly `release/win-unpacked/Civic Foundry.exe` and exits nonzero if missing; no recursive fuzzy matching.

- [ ] **Step 3: Build and package on Windows locally/CI**

Run:

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run desktop:package
npm run desktop:smoke
```

Expected: unpacked EXE launches and smoke exits 0; NSIS `.exe` exists in `release/`.

- [ ] **Step 4: Add a `desktop-windows` GitHub Actions job**

Use `windows-latest`, Node 22, `npm ci`, `npm run verify` initially, `npm run desktop:package`, `npm run desktop:smoke`, then upload `release/*.exe` and `release/win-unpacked/**` as artifacts.

- [ ] **Step 5: Run the normal core verification before committing**

Run: `npm run verify`

Expected: inherited simulation/browser gates remain untouched at D0.

- [ ] **Step 6: Commit D0 gate**

```bash
git add tests/desktop scripts/find-windows-package.mjs .github/workflows/ci.yml package.json package-lock.json
git commit -m "ci: package and smoke-test desktop foundation"
```

**D0 acceptance:** Windows executable boots securely, Save V9 filesystem services exist, inherited simulation tests pass, and no simulation authority moved.

---

# D1 — Babylon 3D Vertical Slice

### Task 6: Define deterministic `CityPresentationSnapshot` and build the vertical-slice read model

**Files:**
- Create: `src/presentation/snapshot/CityPresentationSnapshot.ts`
- Create: `src/presentation/snapshot/PresentationSnapshotBuilder.ts`
- Create: `src/presentation/snapshot/WorldCoordinateMapping.ts`
- Test: `tests/presentation_snapshot.test.ts`

**Interfaces:**
- Produces: `buildCityPresentationSnapshot(core: SimulationCore): CityPresentationSnapshot`; `worldPointToBabylon(point): { x:number; y:number; z:number }`; stable IDs/sorted collections.
- Consumes: `core.world.terrainSampleAt`, `core.cadastre.listParcels()/parcelPolygon()`, `core.buildings.listV2()`, `core.transportationGraph.nodes/edges`, `core.clock`, `core.treasury`, existing HUD collectors where safe.

- [ ] **Step 1: Write RED determinism/isolation tests**

Create two identical seeded cores, build snapshots, assert deep equality. Mutate returned test-local copies only where types permit and verify a rebuilt snapshot is unaffected. Assert parcels/buildings/roads are sorted by ID and terrain order is row-major.

- [ ] **Step 2: Define immutable presentation types**

Use renderer-oriented records. `BuildingPresentation` includes `id`, `parcelIds`, footprint points in meters, `heightMeters`, `floorCount`, `primaryUse`, `quality`, `condition`, `lifecycleState`; `RoadPresentation` uses directed edge ID plus from/to world positions and road type.

- [ ] **Step 3: Implement coordinate mapping**

Canonical conversion:

```ts
export const worldMetersToBabylon = (point: WorldPoint, elevationMeters = 0) => Object.freeze({
  x: point.x,
  y: elevationMeters,
  z: point.y,
});
```

Legacy transportation cell coordinates map via `LEGACY_CELL_SIZE_METERS` to cell centers.

- [ ] **Step 4: Implement builder for D1 domains**

Build terrain from `core.world.terrain.width/height` and `terrainSampleAt(x,y)`. Build parcels with `core.cadastre.parcelPolygon(parcel.id)`. Build canonical buildings from `core.buildings.listV2()`. Build roads from `transportationGraph.nodes/edges`, de-duplicating opposite directed edges into one visual road key using sorted endpoint IDs while preserving source edge IDs for inspection.

- [ ] **Step 5: Run focused tests twice**

```bash
node --experimental-strip-types --test tests/presentation_snapshot.test.ts
node --experimental-strip-types --test tests/presentation_snapshot.test.ts
```

Expected: byte-for-byte equivalent normalized JSON output across runs.

- [ ] **Step 6: Commit**

```bash
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
- Produces: `diffPresentationSnapshots(previous: CityPresentationSnapshot | null, next: CityPresentationSnapshot): PresentationDelta`.
- Later `SceneSynchronizer` consumes `created`, `updated`, `removedIds` for each entity category.

- [ ] **Step 1: Write RED entity-delta tests**

Test initial snapshot → all created; unchanged snapshot → empty delta; changed building → exactly one updated; removed parcel → one sorted removed ID; order-only changes → no semantic delta.

- [ ] **Step 2: Implement generic ID-based diff**

```ts
export type EntityDelta<T extends { id: string }> = Readonly<{
  created: readonly T[];
  updated: readonly T[];
  removedIds: readonly string[];
}>;
```

Compare canonical serialized records or explicit structural fields; always sort output IDs.

- [ ] **Step 3: Run focused tests and snapshot tests**

```bash
node --experimental-strip-types --test tests/presentation_delta.test.ts tests/presentation_snapshot.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add src/presentation/snapshot tests/presentation_delta.test.ts
git commit -m "feat: add presentation snapshot deltas"
```

---

### Task 8: Bootstrap Babylon scene with `NullEngine` coverage

**Files:**
- Create: `src/presentation/scene/CityScene.ts`
- Create: `src/presentation/scene/SceneSynchronizer.ts`
- Create: `src/presentation/scene/EntityVisualRegistry.ts`
- Create: `src/presentation/scene/SceneMaterials.ts`
- Test: `tests/babylon_scene.test.ts`

**Interfaces:**
- Produces: `CityScene`, `SceneSynchronizer.apply(snapshot, delta)`, registry lookup by canonical presentation ID.

- [ ] **Step 1: Write RED NullEngine test**

Instantiate Babylon `NullEngine`, create `CityScene`, apply an empty snapshot, assert one `Scene`, camera/light existence, and zero authoritative simulation imports in scene files.

- [ ] **Step 2: Implement `EntityVisualRegistry`**

Use maps by category and ID. Registry stores Babylon `TransformNode`/`AbstractMesh` references only and disposes removed visuals explicitly.

- [ ] **Step 3: Implement base scene**

Create `Scene`, hemispheric + directional light, restrained clear color, shadow generator only when a real WebGL engine supports it, and a material factory. Keep `NullEngine` path effect-free.

- [ ] **Step 4: Implement synchronizer skeleton**

`apply()` handles revision monotonicity and delegates each delta category to renderer components added in later tasks. For now, empty categories are no-ops; out-of-order revisions throw.

- [ ] **Step 5: Run tests**

```bash
node --experimental-strip-types --test tests/babylon_scene.test.ts
npm run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add src/presentation/scene tests/babylon_scene.test.ts
git commit -m "feat: bootstrap Babylon city scene"
```

---

### Task 9: Render physical terrain from `WorldFoundation`

**Files:**
- Create: `src/presentation/terrain/TerrainMeshBuilder.ts`
- Create: `src/presentation/terrain/TerrainSceneLayer.ts`
- Modify: `src/presentation/scene/SceneSynchronizer.ts`
- Test: `tests/babylon_terrain.test.ts`

**Interfaces:**
- Produces: chunked terrain meshes keyed `terrain:<chunkX>:<chunkY>`; rebuild only when `terrainChanged`.

- [ ] **Step 1: Write RED geometry test**

For a 2×2 terrain fixture, assert generated Babylon vertex positions use X/Z world plane and Y elevation; assert one expected triangle winding and finite normals.

- [ ] **Step 2: Implement chunk mesh data builder as a pure function**

`buildTerrainChunkData(cells, bounds)` returns positions/indices/normals without Babylon scene side effects so topology is unit-testable.

- [ ] **Step 3: Implement `TerrainSceneLayer`**

Create/update Babylon `Mesh` vertex buffers per chunk, use one shared ground material, set `isPickable = true`, and attach metadata `{ kind:'terrain' }`.

- [ ] **Step 4: Wire to synchronizer and verify no per-frame rebuild**

Apply same snapshot twice; assert mesh identity is unchanged.

- [ ] **Step 5: Run tests and commit**

```bash
node --experimental-strip-types --test tests/babylon_terrain.test.ts tests/babylon_scene.test.ts
git add src/presentation/terrain src/presentation/scene/SceneSynchronizer.ts tests/babylon_terrain.test.ts
git commit -m "feat: render WorldFoundation terrain in Babylon"
```

---

### Task 10: Render canonical parcels and procedural `BuildingV2` massing

**Files:**
- Create: `src/presentation/parcels/ParcelSceneLayer.ts`
- Create: `src/presentation/buildings/BuildingMeshBuilder.ts`
- Create: `src/presentation/buildings/BuildingSceneLayer.ts`
- Modify: `src/presentation/scene/SceneSynchronizer.ts`
- Test: `tests/babylon_urban_fabric.test.ts`

**Interfaces:**
- Parcel meshes carry metadata `{ kind:'parcel', id }` and canonical parcel IDs.
- Building roots carry `{ kind:'building', id }`; geometry derives from canonical footprint/floors, never legacy sprite IDs.

- [ ] **Step 1: Write RED tests for canonical ID mapping**

Build a fixture parcel and `BuildingPresentation`; apply delta; assert registry has `parcel:<id>` and `building:<id>` visuals, footprint bounds match presentation meters, and removing the entity disposes registry entry.

- [ ] **Step 2: Implement parcel triangulation surface**

Use existing polygon geometry helpers/Clipper wrapper where appropriate; generate a thin overlay mesh slightly above terrain with `isVisible` controlled by overlay/selection state.

- [ ] **Step 3: Implement procedural building massing**

Generate a footprint extrusion to `heightMeters`; for non-rectangular rings triangulate the top face and build wall quads around the ring. Assign material class from primary use and lifecycle state. Do not create one material per building.

- [ ] **Step 4: Wire create/update/remove through synchronizer**

An update mutates/rebuilds only that building visual. Unchanged building mesh identity stays stable across snapshots.

- [ ] **Step 5: Run tests and commit**

```bash
node --experimental-strip-types --test tests/babylon_urban_fabric.test.ts
npm run typecheck
git add src/presentation/parcels src/presentation/buildings src/presentation/scene/SceneSynchronizer.ts tests/babylon_urban_fabric.test.ts
git commit -m "feat: render parcels and canonical buildings in 3D"
```

---

### Task 11: Render roads and implement orbit camera, GPU picking, and selection

**Files:**
- Create: `src/presentation/roads/RoadSceneLayer.ts`
- Create: `src/presentation/camera/CityCamera.ts`
- Create: `src/presentation/camera/CameraController.ts`
- Create: `src/presentation/selection/SelectionTypes.ts`
- Create: `src/presentation/selection/PresentationSelectionResolver.ts`
- Create: `src/presentation/selection/SelectionHighlighter.ts`
- Test: `tests/babylon_navigation_selection.test.ts`

**Interfaces:**
- Produces: `SelectionTarget = terrain | parcel | building | road`; `resolvePick(pickInfo): SelectionTarget | null`; camera `focusWorldPoint()`.

- [ ] **Step 1: Write RED selection test**

Create pickable parcel/building/road meshes with metadata, synthesize/execute Babylon picks, assert canonical selection IDs are returned. Terrain hit returns world point plus derived legacy cell coordinate using `LEGACY_CELL_SIZE_METERS` when in bounds.

- [ ] **Step 2: Implement road meshes from current transportation projection**

Use one visual segment per deduplicated road presentation ID. Width derives from current `RoadType`; no lane/turn/signal authority is inferred.

- [ ] **Step 3: Implement ArcRotate-style city camera**

Use Babylon `ArcRotateCamera` or equivalent with explicit lower/upper radius/pitch limits. Map wheel zoom, Q/E rotate, WASD pan, middle drag pan. Disable default controls that conflict with management UI inputs.

- [ ] **Step 4: Implement selection resolver/highlighter**

Highlighter uses Babylon highlight/outline or emissive override; selection state remains renderer-local and never enters Save V9.

- [ ] **Step 5: Run tests and commit**

```bash
node --experimental-strip-types --test tests/babylon_navigation_selection.test.ts
npm run typecheck
git add src/presentation/roads src/presentation/camera src/presentation/selection tests/babylon_navigation_selection.test.ts
git commit -m "feat: add 3D roads camera and GPU selection"
```

---

### Task 12: Integrate the D1 playable Babylon vertical slice

**Files:**
- Create: `src/desktop/renderer/src/GameViewport.ts`
- Create: `src/desktop/renderer/src/D1Controls.ts`
- Modify: `src/desktop/renderer/src/DesktopApp.ts`
- Create: `tests/desktop/d1_vertical_slice.mjs`
- Modify: `package.json`

**Interfaces:**
- `GameViewport` owns Babylon `Engine`, `CityScene`, `SceneSynchronizer`, resize/render loop.
- `DesktopApp` owns `SimulationCore`, simulation tick accumulator, snapshot generation, save/load, and D1 road/zoning interaction through existing `ToolController`.

- [ ] **Step 1: Write D1 smoke assertions before integration**

Smoke launches the built desktop renderer and asserts `window.__civicDesktopDiagnostics` reports `renderer: 'babylon'`, terrain mesh count >0, parcel count >0, and `canvas2dWorldRendererUsed === false`.

- [ ] **Step 2: Implement `GameViewport`**

Create Babylon `Engine(canvas, true, { preserveDrawingBuffer:false, stencil:true })`, `CityScene`, camera, and `runRenderLoop`; call `engine.resize()` on window resize.

- [ ] **Step 3: Move simulation loop ownership into `DesktopApp`**

Instantiate `new SimulationCore({ width:40, height:24, seed:42, startingFunds:250_000 })`. Advance simulation using the existing clock/tick semantics, not frame count. After authoritative changes/ticks, build a snapshot, diff it, and apply delta.

- [ ] **Step 4: Add D1 controls**

Support inspect, pause/speeds, road-local path placement, three zone tools, save/load. Reuse `ToolController.applyPath/applyCell`; convert GPU selection world hit to legacy cell only at this compatibility seam.

- [ ] **Step 5: Ensure desktop D1 imports no old renderer**

Run:

```bash
rg "WorldRenderer|CanvasRenderingContext2D|getContext\(['\"]2d" src/desktop src/presentation
```

Expected: no matches.

- [ ] **Step 6: Run D1 smoke and core suite**

```bash
npm run desktop:build
node tests/desktop/d1_vertical_slice.mjs
npm test
npm run typecheck
```

- [ ] **Step 7: Commit D1 gate**

```bash
git add src/desktop/renderer src/presentation tests/desktop/d1_vertical_slice.mjs package.json package-lock.json
git commit -m "feat: ship Babylon desktop vertical slice"
```

**D1 acceptance:** desktop city is playable through Babylon for inspect, camera, road/zoning, speed, save/load; no desktop code executes Canvas2D world rendering.

---

# D2 — Gameplay Presentation Parity

### Task 13: Centralize desktop tool execution and placement previews

**Files:**
- Create: `src/desktop/renderer/src/DesktopGameplayAdapter.ts`
- Create: `src/presentation/selection/PlacementPreview.ts`
- Modify: `src/desktop/renderer/src/DesktopApp.ts`
- Test: `tests/desktop_gameplay_adapter.test.ts`

**Interfaces:**
- Produces: `applyCellTool(toolId,target)`, `applyRoadTool(toolId,start,end)`, `previewRoad(start,end)`, `setTaxRate`, `setServiceFunding`.
- Internally reuses `ToolController` and existing `SimulationCore` public methods; it does not duplicate validation.

- [ ] **Step 1: Write RED tests against a seeded core**

Assert adapter road placement changes `core.roads`, invalid preview does not mutate state, zoning uses existing `paintZone`, service/utility/transit/bulldoze operations return existing reasons.

- [ ] **Step 2: Implement adapter as a compatibility command boundary**

Return typed `DesktopCommandResult` with `ok`, `message`, and `authoritativeChanged`. Only set dirty state when the underlying call succeeds.

- [ ] **Step 3: Implement 3D previews**

Preview layer creates disposable translucent Babylon geometry for road path/cell target with valid/invalid material. Destroy preview after command or tool change; preview is never included in snapshots.

- [ ] **Step 4: Run focused tests and commit**

```bash
node --experimental-strip-types --test tests/desktop_gameplay_adapter.test.ts
git add src/desktop/renderer/src/DesktopGameplayAdapter.ts src/presentation/selection/PlacementPreview.ts src/desktop/renderer/src/DesktopApp.ts tests/desktop_gameplay_adapter.test.ts
git commit -m "feat: migrate desktop gameplay tools and previews"
```

---

### Task 14: Extend snapshots and render moving traffic/service/transit/freight vehicles

**Files:**
- Modify: `src/presentation/snapshot/CityPresentationSnapshot.ts`
- Modify: `src/presentation/snapshot/PresentationSnapshotBuilder.ts`
- Create: `src/presentation/vehicles/VehiclePose.ts`
- Create: `src/presentation/vehicles/VehicleSceneLayer.ts`
- Create: `src/presentation/vehicles/VehicleInterpolation.ts`
- Modify: `src/presentation/scene/SceneSynchronizer.ts`
- Test: `tests/babylon_vehicles.test.ts`

**Interfaces:**
- `VehiclePresentation` contains ID, category, route edge IDs/current edge, normalized progress, authoritative tick, position/orientation endpoints, visual weight/class.
- `VehicleInterpolation.sample(id, renderTime)` returns presentation-only pose.

- [ ] **Step 1: Write RED snapshot tests for active vehicle categories**

Use current `core.traffic.activeVehicles`, service vehicle state, mobility/transit vehicle state, and freight vehicle state. Assert deterministic ID ordering and finite poses.

- [ ] **Step 2: Implement pure edge-progress to world-pose conversion**

For traffic routes, look up `TransportationGraph` edge/from/to nodes and compute a centerline pose. Use existing per-system route/current-edge data; do not infer new routing.

- [ ] **Step 3: Implement interpolation buffer**

Keep previous/current authoritative poses with timestamps. Clamp interpolation to the interval; never extrapolate authoritative state. Teleport/snap when route identity changes or entity is newly created.

- [ ] **Step 4: Implement pooled vehicle scene layer**

Use shared primitive/asset prototypes and instances. Category selects material/model family; remove returns instance to pool where safe.

- [ ] **Step 5: Run tests and commit**

```bash
node --experimental-strip-types --test tests/babylon_vehicles.test.ts tests/presentation_snapshot.test.ts
npm run typecheck
git add src/presentation tests/babylon_vehicles.test.ts
git commit -m "feat: render moving city vehicles in Babylon"
```

---

### Task 15: Migrate all analytical overlays to Babylon presentation data

**Files:**
- Create: `src/presentation/overlays/OverlayTypes.ts`
- Create: `src/presentation/overlays/OverlaySnapshotBuilder.ts`
- Create: `src/presentation/overlays/OverlaySceneLayer.ts`
- Create: `src/presentation/overlays/OverlayLegend.ts`
- Modify: `src/presentation/snapshot/PresentationSnapshotBuilder.ts`
- Test: `tests/babylon_overlays.test.ts`

**Interfaces:**
- Produces one `ActiveOverlay` discriminated union covering current traffic, service, transit, economy/freight, cadastral, zoning-envelope, land/housing/development modes.
- Overlay scene data is derived from current metrics only; mode switching is mutually exclusive.

- [ ] **Step 1: Write RED parity table test**

Declare every current mode string from `TrafficOverlayLayer`, `ServiceOverlayLayer`, `TransitOverlayLayer`, `EconomyOverlayLayer`, `CadastralOverlayLayer`, `ZoningEnvelopeLayer`, and land/housing overlays in one expected set. Assert new `OVERLAY_MODES` contains all of them exactly once.

- [ ] **Step 2: Move overlay mode types into `OverlayTypes.ts`**

Keep old files importing/re-exporting these types temporarily if browser parity tests still need them. This makes later D4 deletion possible without changing UI semantics.

- [ ] **Step 3: Build overlay presentation values**

Use existing cached analytics/snapshot fields from `SimulationCore`; do not recalculate simulation outcomes in rendering code.

- [ ] **Step 4: Render overlays**

Use shared materials, vertex colors/instance colors, line meshes, or thin overlay surfaces. Update only when overlay mode/source revision changes.

- [ ] **Step 5: Run overlay tests and commit**

```bash
node --experimental-strip-types --test tests/babylon_overlays.test.ts
npm run typecheck
git add src/presentation/overlays src/presentation/snapshot tests/babylon_overlays.test.ts
git commit -m "feat: migrate analytical overlays to Babylon"
```

---

### Task 16: Migrate HUD, inspector, transit, economy, tax, service-budget, Urban Fabric, and land/housing UI

**Files:**
- Create: `src/desktop/renderer/src/DesktopUiController.ts`
- Create: `src/desktop/renderer/src/InspectorController.ts`
- Create: `src/desktop/renderer/src/OverlayController.ts`
- Modify: `src/desktop/renderer/src/DesktopLayout.ts`
- Modify: `src/desktop/renderer/src/DesktopApp.ts`
- Reuse/modify as needed: `src/ui/Hud.ts`, `src/ui/Inspector.ts`, `src/ui/TransitPanel.ts`, `src/ui/EconomyPanel.ts`, `src/ui/UrbanFabricUiController.ts`, `src/ui/LandHousingUiController.ts`
- Test: `tests/desktop_ui_parity.test.ts`

**Interfaces:**
- Desktop UI receives `SimulationCore`, `DesktopGameplayAdapter`, selection, and current presentation snapshot. It never receives Babylon scene internals except selection/tool hooks.

- [ ] **Step 1: Write a UI parity contract test**

Assert desktop layout has stable controls/test IDs for every current tool, speed 0/1/2/4, tax inputs, service budgets, traffic/service/transit/economy/Urban Fabric overlays, transit line management, inspector, save/load/import.

- [ ] **Step 2: Reuse pure collectors/controllers before duplicating logic**

Keep `collectHudMetrics`, `inspectCell`, `inspectTransitLine`, `inspectTransitVehicle`, `TransitPanelController`, and `EconomyPanel` where they are DOM-independent enough. Extract small pure helper functions from old controllers only when direct `GameApp` typing blocks reuse.

- [ ] **Step 3: Implement desktop UI orchestration**

Bind DOM events once. Mode changes update `OverlayController`; selection calls inspector helpers; transit actions call `TransitPanelController`; taxes call `core.taxes.setRate`; service budgets call `core.setServiceFunding`.

- [ ] **Step 4: Preserve current analytical mutual exclusion**

When one analytical overlay becomes active, all other overlay selects switch to `none`, matching current semantics.

- [ ] **Step 5: Run parity tests and browser regression suite**

```bash
node --experimental-strip-types --test tests/desktop_ui_parity.test.ts
npm test
npm run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add src/desktop/renderer/src src/ui tests/desktop_ui_parity.test.ts
git commit -m "feat: migrate city management UI to desktop"
```

---

### Task 17: Complete save/load/import/autosave UX and full D2 gameplay smoke

**Files:**
- Create: `src/desktop/renderer/src/DesktopPersistenceController.ts`
- Create: `src/desktop/renderer/src/AutosaveController.ts`
- Modify: `src/desktop/renderer/src/DesktopApp.ts`
- Create: `tests/desktop/d2_gameplay_smoke.mjs`
- Test: `tests/autosave_controller.test.ts`

**Interfaces:**
- `DesktopPersistenceController` serializes current core with `serializeCore()`, calls desktop bridge, hydrates candidate with `hydrateCore()` before replacing active core.
- `AutosaveController.markDirty()`, `tick(realNowMs)`, `resetAfterSuccessfulSave()`; slots rotate 0→1→2.

- [ ] **Step 1: Write RED autosave timing tests with fake clock**

Assert no save before 300,000 ms, dirty-only saves, successful save rotates slots, failed save retains dirty state, and a load transition suppresses autosave.

- [ ] **Step 2: Implement safe load replacement**

```ts
const result = await window.civicDesktop.loadGame({ name });
if (!result.ok) return result;
const candidate = hydrateCore(result.value);
this.replaceCore(candidate);
```

Never replace the active city until hydration succeeds.

- [ ] **Step 3: Implement import path**

File-selection UI may use an IPC-owned native dialog or a controlled renderer file input; bytes still pass through validated import logic and `hydrateCore()` before activation.

- [ ] **Step 4: Write full D2 smoke**

Automate: launch → new city → place road → apply residential zone → run ticks → place service/utility → switch overlays → create/edit a transit line if fixture supports it → change tax/service funding → save named city → quit → relaunch → load → assert tick/treasury/road/zoning canonical state persists.

- [ ] **Step 5: Run full D2 gate**

```bash
npm run desktop:build
node tests/desktop/d2_gameplay_smoke.mjs
npm test
npm run typecheck
npm run architecture:check
```

- [ ] **Step 6: Commit D2 gate**

```bash
git add src/desktop/renderer/src tests/desktop/d2_gameplay_smoke.mjs tests/autosave_controller.test.ts
git commit -m "feat: complete desktop gameplay presentation parity"
```

**D2 acceptance:** current player-facing tools, management surfaces, overlays, vehicles, diagnostics, and save workflows operate through desktop/Babylon; old browser renderer is reference-only.

---

# D3 — 3D Asset and Visual Pipeline

### Task 18: Replace sprite-manifest concepts with validated 3D runtime asset manifests

**Files:**
- Create: `src/presentation/assets/AssetTypes.ts`
- Create: `src/presentation/assets/DesktopAssetManifest.ts`
- Create: `src/presentation/assets/AssetManifestValidation.ts`
- Create: `assets/runtime/manifest.json`
- Create: `tests/desktop_asset_manifest.test.ts`
- Modify: `scripts/check-assets.mjs`

**Interfaces:**
- Asset IDs resolve to `kind: 'glb' | 'texture' | 'procedural-kit'`; required path and usage class; optional LODs.

- [ ] **Step 1: Write RED validation tests**

Assert duplicate IDs, missing paths, unsupported extensions, absolute paths, `..` traversal, and missing LOD references are rejected. Assert a minimal procedural-only manifest is valid.

- [ ] **Step 2: Define manifest types**

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

- [ ] **Step 3: Implement manifest validation and filesystem policy checks**

`check-assets.mjs` validates tracked runtime extensions and manifest references. D3 desktop build no longer depends on SVG atlas existence.

- [ ] **Step 4: Run tests**

```bash
node --experimental-strip-types --test tests/desktop_asset_manifest.test.ts
npm run assets:policy
```

- [ ] **Step 5: Commit**

```bash
git add src/presentation/assets assets/runtime/manifest.json tests/desktop_asset_manifest.test.ts scripts/check-assets.mjs
git commit -m "feat: add validated 3D runtime asset manifest"
```

---

### Task 19: Implement Babylon asset loading, instancing pools, LODs, and production procedural kits

**Files:**
- Create: `src/presentation/assets/DesktopAssetRegistry.ts`
- Create: `src/presentation/assets/InstancePool.ts`
- Create: `src/presentation/assets/LodResolver.ts`
- Create: `src/presentation/buildings/ProceduralBuildingKit.ts`
- Create: `src/presentation/vehicles/ProceduralVehicleKit.ts`
- Create: `src/presentation/services/ProceduralFacilityKit.ts`
- Modify: scene layers to use registry/kits
- Test: `tests/babylon_asset_registry.test.ts`

**Interfaces:**
- `DesktopAssetRegistry.preloadRequired()`, `instantiate(assetId,parent?)`, diagnostics; required asset failure throws before playable scene; optional asset returns explicit placeholder.

- [ ] **Step 1: Write RED NullEngine registry tests**

Test procedural kit resolution without I/O; test missing required GLB rejects with `required-asset-missing`; optional missing GLB records diagnostic and returns placeholder visual.

- [ ] **Step 2: Register Babylon glTF loader side effects**

Import `@babylonjs/loaders/glTF` once in asset registry/bootstrap. Use `SceneLoader.LoadAssetContainerAsync` for GLBs and cache `AssetContainer`s.

- [ ] **Step 3: Implement reusable instance pools**

Pool common vehicle/facility/prop visuals and use thin instances where individual picking is unnecessary. Maintain per-instance metadata/selection mapping separately for pickable categories.

- [ ] **Step 4: Mature procedural building visuals**

Create shared facade/roof/window material families keyed by primary use, quality band, condition band, and lifecycle. Geometry still follows canonical footprint/floors; style variation uses deterministic hash of building ID so visual variation is stable but non-authoritative.

- [ ] **Step 5: Add basic LOD/culling hooks**

Near: full procedural massing; medium: simplified extrusion; far: low-poly block or thin-instance proxy when selection not required. Never alter simulation entity presence.

- [ ] **Step 6: Run tests and commit**

```bash
node --experimental-strip-types --test tests/babylon_asset_registry.test.ts tests/babylon_urban_fabric.test.ts tests/babylon_vehicles.test.ts
git add src/presentation tests/babylon_asset_registry.test.ts
git commit -m "feat: add instanced 3D asset and procedural visual kits"
```

---

### Task 20: Make the desktop asset pipeline canonical and remove atlas dependency from desktop builds

**Files:**
- Create: `scripts/build-desktop-assets.mjs`
- Modify: `package.json`
- Modify: `electron-builder.yml`
- Modify: `docs/art/ASSET_BIBLE.md`
- Create: `tests/desktop_asset_build.test.ts`

**Interfaces:**
- `npm run desktop:assets:check` validates manifest/runtime files; `desktop:build` invokes it before electron-vite.

- [ ] **Step 1: Write RED build-script test**

Assert desktop build scripts contain no `render_isometric_atlases.py` and validate `assets/runtime/manifest.json` before bundling.

- [ ] **Step 2: Implement desktop asset validation/build orchestration**

`build-desktop-assets.mjs` reads manifest, validates all required files, optionally copies/normalizes optimized outputs into `assets/runtime/`, and exits nonzero on missing required assets. It does not invoke Python/Pillow.

- [ ] **Step 3: Update scripts**

Set:

```json
{
  "desktop:assets:check": "node scripts/build-desktop-assets.mjs --check",
  "desktop:build": "npm run desktop:assets:check && electron-vite build"
}
```

- [ ] **Step 4: Update asset bible**

Document GLB/glTF preferred runtime form, manifest IDs, texture/runtime constraints, procedural kit policy, instancing/LOD rules, and that isometric SVG/atlas assets are legacy-only until D4 deletion.

- [ ] **Step 5: Run D3 gate and commit**

```bash
npm run desktop:assets:check
npm run desktop:build
node --experimental-strip-types --test tests/desktop_asset_build.test.ts
npm test
git add scripts/build-desktop-assets.mjs package.json package-lock.json electron-builder.yml docs/art/ASSET_BIBLE.md tests/desktop_asset_build.test.ts
git commit -m "build: make 3D asset pipeline canonical for desktop"
```

**D3 acceptance:** desktop package uses procedural/GLB 3D runtime assets, validated manifests, instancing/LOD/culling, and no desktop build dependency on isometric atlases.

---

# D4 — Canvas2D and Browser Runtime Removal

### Task 21: Add renderer telemetry and committed reference/stress fixtures

**Files:**
- Create: `src/presentation/performance/RendererTelemetry.ts`
- Create: `src/presentation/performance/PerformanceFixtureFactory.ts`
- Create: `tests/performance/renderer_reference.mjs`
- Create: `tests/performance/renderer_stress.mjs`
- Create: `tests/presentation_performance_fixture.test.ts`
- Modify: `src/desktop/renderer/src/DesktopApp.ts`
- Modify: `package.json`

**Interfaces:**
- Telemetry exposes FPS/frame time, snapshot build/sync ms, simulation tick duration, active meshes/instances, draw calls where available, entity counts.
- Fixture factory returns synthetic read-only `CityPresentationSnapshot` with exact target counts.

- [ ] **Step 1: Write RED fixture-count tests**

Assert reference fixture has 2,000 buildings, 1,000 moving vehicles total, 5,000 repeated props and one overlay. Assert stress fixture has 5,000 / 2,000 / 20,000 respectively. IDs must be deterministic and sorted.

- [ ] **Step 2: Implement fixed-seed synthetic fixture factory**

Generate presentation data directly; do not create a fake simulation city or mutate `SimulationCore` to reach stress scale.

- [ ] **Step 3: Implement telemetry rolling window**

Track frame durations and compute median/1% low over a requested measurement period after warmup. Keep instrumentation presentation-only.

- [ ] **Step 4: Implement reference/stress benchmark scripts**

Scripts launch packaged desktop in performance-fixture mode, wait 10 seconds, collect 30 seconds, print JSON and exit nonzero when thresholds are missed in `--enforce-reference` mode.

- [ ] **Step 5: Add scripts**

```json
{
  "desktop:perf:reference": "node tests/performance/renderer_reference.mjs --enforce-reference",
  "desktop:perf:stress": "node tests/performance/renderer_stress.mjs --enforce-reference"
}
```

- [ ] **Step 6: Run structural fixture tests and commit**

```bash
node --experimental-strip-types --test tests/presentation_performance_fixture.test.ts
npm run desktop:build
git add src/presentation/performance src/desktop/renderer/src/DesktopApp.ts tests/performance tests/presentation_performance_fixture.test.ts package.json package-lock.json
git commit -m "perf: add desktop renderer performance gates"
```

Note: final FPS enforcement must run on the spec's reference-hardware class. Hosted CI may record telemetry but cannot substitute a materially weaker/software-rendered runner for the release gate.

---

### Task 22: Add static architecture rules that ban production Canvas2D world rendering

**Files:**
- Modify: `scripts/check-architecture.mjs`
- Create: `scripts/check-rendering-policy.mjs`
- Create: `tests/rendering_policy.test.ts`
- Modify: `package.json`

**Interfaces:**
- `rendering:policy` fails on `CanvasRenderingContext2D`, `.getContext('2d')`, `.getContext("2d")`, or imports from deleted legacy renderer paths inside production `src/` after D4.
- HTMLCanvasElement/WebGL/Babylon canvas surfaces remain allowed.

- [ ] **Step 1: Write RED policy unit tests**

Feed synthetic source strings to exported `findForbiddenRenderingUsage(path, source)` and assert Canvas2D examples fail while `new Engine(canvas)` passes.

- [ ] **Step 2: Implement source scan**

Scan `src/**/*.ts`. Exempt only explicitly named test tooling outside `src/`; do not add a generic allow-list that can hide production regressions.

- [ ] **Step 3: Extend architecture boundaries**

Add rules preventing `src/simulation/`, `src/world/`, and `src/save/` from importing `src/desktop/` or `src/presentation/`; allow `src/presentation/` to import simulation/world read types but forbid `src/presentation/` importing `src/desktop/`.

- [ ] **Step 4: Add script to canonical verify**

`verify` includes `npm run rendering:policy` after architecture check.

- [ ] **Step 5: Run RED against current legacy renderer**

Run: `npm run rendering:policy`

Expected at this moment: FAIL on legacy Canvas files. This RED proves Task 23 deletions are required.

- [ ] **Step 6: Commit policy test while keeping the branch temporarily red only if Task 23 follows immediately in the same review batch**

Preferred implementation: combine Task 22 and Task 23 into one PR review batch but retain separate commits; do not merge a permanently red intermediate head.

---

### Task 23: Delete the Canvas/isometric/browser runtime and obsolete atlas pipeline

**Files:**
- Delete: `src/rendering/WorldRenderer.ts`
- Delete: `src/rendering/VehicleRenderer.ts`
- Delete: `src/rendering/ServiceVehicleRenderer.ts`
- Delete: `src/rendering/TransitVehicleRenderer.ts`
- Delete: `src/rendering/FreightVehicleRenderer.ts`
- Delete: `src/rendering/passes/GroundRenderPass.ts`
- Delete: `src/rendering/passes/ObjectRenderPass.ts`
- Delete: `src/rendering/passes/OverlayRenderPass.ts`
- Delete: `src/rendering/passes/SelectionRenderPass.ts`
- Delete: `src/rendering/passes/RenderOrder.ts` if no non-Canvas consumer remains
- Delete: `src/rendering/isometric/IsometricCamera.ts`
- Delete: `src/rendering/isometric/IsometricCulling.ts`
- Delete: `src/rendering/isometric/IsometricOverlayPainter.ts`
- Delete: `src/rendering/isometric/IsometricProjection.ts`
- Delete legacy sprite-only assets under `src/rendering/assets/` after verifying no desktop or tests import them
- Delete old overlay implementation files under `src/rendering/` only after all mode types/logic have moved to `src/presentation/overlays/`
- Delete: `src/app/GameApp.ts`
- Delete: `src/main.ts`
- Delete: root `index.html`
- Delete: `tools/render_isometric_atlases.py`
- Delete: obsolete isometric browser/visual smoke files under `tests/smoke/`
- Modify: `scripts/build.mjs` or delete it if no remaining supported command consumes it
- Modify: `package.json`
- Modify: `.prettierignore` / repository policy files as required by deleted outputs

**Interfaces:**
- Canonical runtime becomes `src/desktop/main/ElectronMain.ts` + desktop renderer/Babylon.
- `npm run build` should become an alias of `npm run desktop:build` or be removed only if repository policy/docs are updated consistently.

- [ ] **Step 1: Inventory all imports before deletion**

Run:

```bash
rg "src/rendering|\.\./rendering|WorldRenderer|Isometric|PassAAssetManifest|SpritePainter|render_isometric_atlases" src tests scripts package.json README.md docs
```

For every non-legacy match, migrate it to the new presentation/asset/overlay equivalent before deleting files.

- [ ] **Step 2: Remove browser entry path**

Delete `GameApp`, root `src/main.ts`, root `index.html`. Move any still-useful pure UI collector/controller into stable `src/ui/` modules or desktop UI before deletion.

- [ ] **Step 3: Remove Canvas/isometric renderer modules**

Delete the listed world renderer, render passes, vehicle renderers, isometric helpers, sprite painter/registry/manifest modules that have no non-Canvas consumer.

- [ ] **Step 4: Remove atlas generator and browser/isometric smoke requirements**

Remove Python atlas scripts from `package.json`, `scripts/build.mjs`, CI, and docs. Delete generated atlas runtime files if tracked and no longer referenced by desktop manifest.

- [ ] **Step 5: Make canonical commands desktop-native**

Set:

```json
{
  "build": "npm run desktop:build",
  "dev": "npm run desktop:dev"
}
```

Remove browser smoke scripts that no longer have a supported runtime; retain simulation/unit tests independent of presentation.

- [ ] **Step 6: Run the rendering policy and repository-wide search**

```bash
npm run rendering:policy
rg "CanvasRenderingContext2D|getContext\(['\"]2d|WorldRenderer|render_isometric_atlases" src package.json scripts .github
```

Expected: policy PASS; `rg` returns no production matches.

- [ ] **Step 7: Run full verification and desktop smoke**

```bash
npm run verify
npm run desktop:package
npm run desktop:smoke
node tests/desktop/d2_gameplay_smoke.mjs
```

Expected: PASS.

- [ ] **Step 8: Commit the removal**

```bash
git add -A
git commit -m "refactor: remove Canvas2D browser runtime"
```

---

### Task 24: Finalize Windows CI, reference-performance gate, documentation, and D4 acceptance

**Files:**
- Modify: `.github/workflows/ci.yml`
- Create: `.github/workflows/desktop-performance.yml`
- Modify: `README.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/TESTING.md`
- Modify: `docs/ENGINEERING_STANDARDS.md`
- Modify: `docs/SAVE_FORMAT.md`
- Modify: `docs/DEVELOPMENT_LOG.md`
- Create: `docs/adr/0002-electron-babylon-desktop-runtime.md`
- Modify: `docs/adr/README.md`
- Test: all D4 commands below

**Interfaces:**
- Normal CI: Linux core verification + Windows desktop package/smoke/artifacts.
- Dedicated performance workflow: reference-hardware runner label `civic-foundry-reference` runs actual 1080p reference/stress FPS gates before D4 signoff/release.

- [ ] **Step 1: Rewrite canonical CI stages**

Linux job: format/lint/policy/architecture/rendering-policy/typecheck/all Node simulation/presentation tests + desktop build without packaging if appropriate.

Windows job: `npm ci`, `npm run verify`, `npm run desktop:package`, packaged smoke, D2 gameplay smoke, upload unpacked/NSIS artifacts.

Remove Python Playwright/Pillow/Chromium setup if no remaining tests require them.

- [ ] **Step 2: Add reference-performance workflow**

`desktop-performance.yml` uses `workflow_dispatch` and release/tag trigger on `[self-hosted, windows, x64, civic-foundry-reference]`. It runs `desktop:package`, `desktop:perf:reference`, `desktop:perf:stress`, and uploads telemetry JSON. If this runner is unavailable, D4 cannot be marked complete; do not replace the gate with software rendering.

- [ ] **Step 3: Update README and architecture docs**

Canonical runtime text becomes:

```text
Electron Renderer → DesktopApp → CityPresentationSnapshot → Babylon CityScene
                                      ↑
                               SimulationCore facade
                                      ↓
             SimulationKernel + WorldFoundation + CadastralGraph + domains
```

State explicitly that HTML canvas is only a WebGL surface, Canvas2D world rendering is prohibited, and 3R resumes only after D4.

- [ ] **Step 4: Update testing/engineering/save/asset documentation**

Document desktop commands, NullEngine tests, packaged smoke, rendering policy, `.cfsave`, autosaves, Electron security, runtime asset manifests, performance fixtures, and Windows artifact path.

- [ ] **Step 5: Add ADR**

ADR records decision: Electron + Babylon.js, WebGL2 baseline, HTML/CSS management UI, snapshot-driven renderer, secure preload bridge, staged deletion of Canvas/browser runtime, and why simulation remains TypeScript-authoritative.

- [ ] **Step 6: Run final local/core gates**

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run verify
npm run desktop:build
```

Expected: PASS.

- [ ] **Step 7: Run Windows packaged acceptance**

On Windows:

```bash
npm run desktop:package
npm run desktop:smoke
node tests/desktop/d2_gameplay_smoke.mjs
```

Expected: PASS and NSIS installer present.

- [ ] **Step 8: Run reference hardware performance acceptance**

On the defined reference machine:

```bash
npm run desktop:perf:reference
npm run desktop:perf:stress
```

Expected: reference median ≥60 FPS / 1% low ≥45; stress median ≥30 / 1% low ≥22 after the specified warmup/measurement period.

- [ ] **Step 9: Verify no legacy production path remains**

```bash
rg "CanvasRenderingContext2D|getContext\(['\"]2d|WorldRenderer|IsometricCamera|render_isometric_atlases" src scripts package.json .github README.md docs
```

Expected: no production/runtime references; documentation may mention historical removal only if clearly historical.

- [ ] **Step 10: Commit final D4 documentation/CI checkpoint**

```bash
git add .github README.md docs package.json package-lock.json
git commit -m "docs: declare Babylon desktop runtime canonical"
```

---

## Final D4 Acceptance Checklist

- [ ] Packaged Windows `.exe` launches through Electron and Babylon WebGL2.
- [ ] Player can create a deterministic city, orbit/pan/zoom/inspect, build/bulldoze roads, zone R/C/I, place current utilities/services, change speed/taxes/service budgets, operate transit controls, use all current analytical overlays, and observe traffic/service/transit/freight movement in 3D.
- [ ] `CityPresentationSnapshot`/delta boundary is deterministic and Babylon state never enters Save V9.
- [ ] Desktop save/load/import preserves V3–V9 migration behavior; three rotating autosaves recover correctly; failed writes do not destroy prior valid saves.
- [ ] Electron renderer has no Node integration/general filesystem or shell authority.
- [ ] No supported production `CanvasRenderingContext2D`, `getContext('2d')`, `WorldRenderer`, isometric render pass, or atlas generation dependency remains.
- [ ] GLB/procedural runtime asset manifest validation passes and desktop package contains all required assets.
- [ ] All inherited deterministic simulation tests pass.
- [ ] Babylon NullEngine/presentation tests, packaged Windows smoke, full desktop gameplay smoke, and rendering-policy tests pass.
- [ ] Reference and stress performance thresholds pass on defined reference hardware.
- [ ] CI emits unpacked Windows build + NSIS artifact and dedicated reference-performance telemetry is green.
- [ ] README/architecture/testing/engineering/save/asset docs describe Electron/Babylon as canonical.
- [ ] Only after every item above is green may the implementation branch unlock 3R Transportation Engine 2.0.
