# Civic Foundry 3D Runtime Foundation + House A Calibration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish Civic Foundry's permanent Babylon.js/WebGPU-first 3D presentation foundation and prove the complete deterministic asset path with House A, while preserving the current PixiJS renderer as the default compatibility path and leaving simulation, World Foundation, cadastre, and Save V9 authority unchanged.

**Architecture:** Add a second, opt-in `civic-3d` presentation backend behind the existing `GameApp` boundary. Authoritative state is converted into deterministic read-only presentation snapshots; a 3D asset catalog and streaming layer resolve generated GLBs; Babylon consumes those resources through retained scene layers. First-party 3D binaries are compiled deterministically from tracked text recipes into `dist/`, never committed as source binaries.

**Tech Stack:** TypeScript 5.8.3, Node.js 22 test runner, Babylon.js `@babylonjs/core` 9.23.0, `@babylonjs/loaders` 9.23.0, glTF Transform `@gltf-transform/core` 4.4.2 and `@gltf-transform/functions` 4.4.2, PixiJS 8.20.1 compatibility renderer, Electron 44.0.0 compatibility host, Playwright/Python smoke harness, existing static ESM/import-map build.

**Spec:** `docs/superpowers/specs/2026-08-30-3d-presentation-asset-program-design.md`

## Global Constraints

- Preserve Save V9 and `gameVersion: '0.9.0-urban-fabric'`; this tranche does not introduce Save V10.
- `SimulationCore`, `WorldFoundation`, `CadastralGraph`, canonical `BuildingV2`, transportation, economy, and service systems remain authoritative.
- Babylon, GLB assets, the asset catalog, and Electron remain presentation/infrastructure consumers only.
- The existing PixiJS/WebGL renderer remains available and is the default backend for this tranche.
- Tauri 2 is not introduced in this tranche.
- No production 3D binary (`.glb`, `.gltf`, `.blend`, `.obj`, raster review image) is tracked under `assets/`; generated runtime outputs belong under `dist/`.
- Runtime 3D coordinates use meters, `+Y` up, `-Z` project forward, ground at `Y = 0`, and ground-center roots.
- Presentation variation is deterministic from stable IDs; do not use `Math.random()` for asset identity, condition, or cosmetic state.
- The browser build remains native ESM with local import maps; do not introduce a bundler in this tranche.
- The Electron host remains the desktop host until the separately approved Tauri tranche.
- House A is the only fully authored production asset in this plan. The other eleven first-wave families remain later tranche work.
- Full predictive metro streaming, hard CPU/GPU residency budgets, aggregate district representations, GPU-driven overlays, and road/terrain chunk meshing remain Tranches 2–5.
- Every implementation task follows TDD: RED contract, focused GREEN implementation, focused verification, then commit.

---

## File Map

### Runtime presentation contracts

- Create `src/rendering/PresentationRenderer.ts` — renderer-neutral compatibility interface used by `GameApp`.
- Create `src/rendering/PresentationRendererFactory.ts` — selects `legacy-gpu` or opt-in `civic-3d` without moving authority.
- Modify `src/rendering/gpu/GpuWorldRenderer.ts` — implement the shared interface and explicit disposal/diagnostics.
- Modify `src/app/GameApp.ts` — consume the renderer interface/factory while preserving legacy default behavior.

### 3D presentation state

- Create `src/rendering/3d/presentation/PresentationTypes.ts` — immutable render-only types and revision/dirty-set contracts.
- Create `src/rendering/3d/presentation/VisualDeterminism.ts` — stable hash/seed helpers.
- Create `src/rendering/3d/presentation/BuildingVisualResolver.ts` — canonical `BuildingV2` to visual state mapping.
- Create `src/rendering/3d/presentation/WorldPresentationSnapshotBuilder.ts` — complete snapshot and retained dirty/revision tracking.

### Asset contracts and loading

- Create `src/rendering/3d/assets/AssetManifestV2.ts` — manifest types.
- Create `src/rendering/3d/assets/AssetManifestV2Validation.ts` — strict runtime manifest validation.
- Create `src/rendering/3d/assets/AssetCatalogV2.ts` — immutable asset lookup/catalog.
- Create `src/rendering/3d/assets/AssetRequestBroker.ts` — request deduplication and priority queue.
- Create `src/rendering/3d/assets/GLBResourceCache.ts` — reference-counted prototype resource cache.
- Create `src/rendering/3d/assets/ScenePrototypeCache.ts` — Babylon prototype lifecycle.
- Create `src/rendering/3d/assets/AssetStreamingManager.ts` — bounded concurrent async load orchestration.
- Create `src/rendering/3d/assets/BabylonGlbPrototypeLoader.ts` — only module allowed to call Babylon GLB loading APIs for city assets.

### Babylon runtime

- Create `src/rendering/3d/BabylonEngineFactory.ts` — WebGPU-first engine creation with WebGL fallback.
- Create `src/rendering/3d/MiniatureCameraController.ts` — deterministic orbit/pan/zoom state and compatibility rotation.
- Create `src/rendering/3d/MiniatureRenderPipeline.ts` — lighting and depth-of-field presentation setup.
- Create `src/rendering/3d/Civic3DWorldRenderer.ts` — renderer facade and Babylon scene lifecycle.
- Create `src/rendering/3d/scene/BuildingSceneLayer.ts` — retained canonical building instances.
- Create `src/rendering/3d/scene/ProceduralFallbackBuilding.ts` — category-preserving canonical bounds proxy.
- Create `src/rendering/3d/scene/StateVisualResolver.ts` — material/emissive/construction visual updates.

### Offline asset compiler and House A source

- Create `tools/3d/asset-source-schema.mjs` — text-source schema and validation.
- Create `tools/3d/geometry.mjs` — deterministic primitive mesh helpers.
- Create `tools/3d/CivicAssetCompiler.mjs` — deterministic source-to-GLB compiler and checker.
- Create `assets/source/3d/buildings/cf_bld_res_detached_house_a_low_v01.asset.json` — tracked House A recipe.
- Modify `scripts/build.mjs` — vendor Babylon package trees and invoke 3D asset build.
- Modify `scripts/check-assets.mjs` only if required to make the text-source policy explicit; `.glb` remains forbidden under tracked `assets/`.
- Modify `package.json` and `package-lock.json` — exact package pins and asset/smoke scripts.
- Modify `index.html` — local Babylon import-map prefixes.

### Verification and documentation

- Create `tests/asset_manifest_v2.test.ts`.
- Create `tests/asset_compiler.test.ts`.
- Create `tests/presentation_snapshot_3d.test.ts`.
- Create `tests/presentation_renderer_contract.test.ts`.
- Create `tests/civic_3d_engine_contract.test.ts`.
- Create `tests/civic_3d_camera.test.ts`.
- Create `tests/asset_streaming_3d.test.ts`.
- Create `tests/building_scene_layer_3d.test.ts`.
- Create `tests/presentation_backend.test.ts`.
- Create `tests/smoke/civic_3d_house_a_smoke.py`.
- Create `tests/smoke/civic_3d_house_a_review.py`.
- Modify `tests/desktop_gpu_runtime.test.ts`, `tests/architecture_policy.test.ts`, and `tests/build_script.test.ts`.
- Modify `scripts/check-architecture.mjs`.
- Modify `docs/ARCHITECTURE.md` and `docs/TESTING.md`.
- Create `docs/art/3D_ASSET_PIPELINE.md`.

---

### Task 1: Pin Babylon/glTF Dependencies and Extend the Local ESM Vendor Seam

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `scripts/build.mjs`
- Modify: `index.html`
- Modify: `tests/desktop_gpu_runtime.test.ts`
- Modify: `tests/build_script.test.ts`

**Interfaces:**
- Consumes: current static browser ESM build and import map.
- Produces: local browser package prefixes `@babylonjs/core/` and `@babylonjs/loaders/`; offline glTF Transform dependencies for later compiler tasks.

- [ ] **Step 1: Write the failing package/import-map contract**

Extend `tests/desktop_gpu_runtime.test.ts` with an exact dependency and import-map contract:

```ts
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
```

- [ ] **Step 2: Add a failing build helper test for recursive package copying**

Refactor `scripts/build.mjs` to export a helper only after the RED test exists. Add to `tests/build_script.test.ts`:

```ts
test('copyDirectory recursively copies a package tree', async () => {
  const root = await mkdtemp(join(tmpdir(), 'civic-vendor-src-'));
  const source = join(root, 'source');
  const target = join(root, 'target');
  await mkdir(join(source, 'sub'), { recursive: true });
  await writeFile(join(source, 'index.js'), 'root');
  await writeFile(join(source, 'sub', 'module.js'), 'nested');

  await copyDirectory(source, target);

  assert.equal(await readFile(join(target, 'index.js'), 'utf8'), 'root');
  assert.equal(await readFile(join(target, 'sub', 'module.js'), 'utf8'), 'nested');
});
```

Update imports in the test to include `mkdir`, `readFile`, and `copyDirectory`.

- [ ] **Step 3: Run RED tests**

Run:

```bash
node --experimental-strip-types --test tests/desktop_gpu_runtime.test.ts tests/build_script.test.ts
```

Expected: FAIL because Babylon/glTF packages, import-map prefixes, and `copyDirectory` do not yet exist.

- [ ] **Step 4: Install exact package versions**

Run:

```bash
npm install --save-exact @babylonjs/core@9.23.0 @babylonjs/loaders@9.23.0
npm install --save-dev --save-exact @gltf-transform/core@4.4.2 @gltf-transform/functions@4.4.2
```

Do not change the existing PixiJS, Electron, clipper, TypeScript, ESLint, or Prettier pins.

- [ ] **Step 5: Add recursive local vendor copying**

In `scripts/build.mjs`, import `cp` from `node:fs/promises` and export:

```js
export async function copyDirectory(source, target) {
  await mkdir(target, { recursive: true });
  await cp(source, target, { recursive: true, force: true });
}
```

Within `copyOptionalVendorFiles(root)`, after the Pixi copy, require and recursively copy:

```js
const babylonPackages = [
  ['core', join(root, 'node_modules', '@babylonjs', 'core')],
  ['loaders', join(root, 'node_modules', '@babylonjs', 'loaders')],
];
for (const [name, source] of babylonPackages) {
  if (!(await pathExists(source))) {
    throw new Error(`Babylon ${name} browser runtime is missing; run npm ci before building.`);
  }
  await copyDirectory(source, join(vendor, '@babylonjs', name));
}
```

Do not copy glTF Transform into `dist/vendor`; it is offline/compiler-only.

- [ ] **Step 6: Extend the import map without removing existing mappings**

Add to `index.html`:

```json
"@babylonjs/core/": "./vendor/@babylonjs/core/",
"@babylonjs/loaders/": "./vendor/@babylonjs/loaders/"
```

Preserve `clipper2-ts` and `pixi.js` mappings exactly.

- [ ] **Step 7: Run focused tests and build**

Run:

```bash
node --experimental-strip-types --test tests/desktop_gpu_runtime.test.ts tests/build_script.test.ts
npm run build
```

Expected: PASS; `dist/vendor/@babylonjs/core/` and `dist/vendor/@babylonjs/loaders/` exist after build.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json scripts/build.mjs index.html tests/desktop_gpu_runtime.test.ts tests/build_script.test.ts
git commit -m "build: add local Babylon 3d runtime dependencies"
```

---

### Task 2: Define Asset Manifest V2 and Strict Runtime Validation

**Files:**
- Create: `src/rendering/3d/assets/AssetManifestV2.ts`
- Create: `src/rendering/3d/assets/AssetManifestV2Validation.ts`
- Create: `tests/asset_manifest_v2.test.ts`

**Interfaces:**
- Consumes: no runtime assets; pure TypeScript data.
- Produces: `AssetId`, `AssetManifestV2Entry`, `AssetManifestV2`, `validateAssetManifestV2(manifest)` and `assertAssetManifestV2(manifest)`.

- [ ] **Step 1: Write RED manifest tests**

Create `tests/asset_manifest_v2.test.ts` with a valid House A-shaped entry and explicit failure cases:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertAssetManifestV2,
  validateAssetManifestV2,
} from '../src/rendering/3d/assets/AssetManifestV2Validation.ts';

const valid = {
  schemaVersion: 2,
  entries: [{
    assetId: 'cf_bld_res_detached_house_a_low_v01',
    revision: 1,
    category: 'building',
    geometry: {
      lod0: 'assets/models/cf_bld_res_detached_house_a_low_v01_lod0.glb',
      lod1: 'assets/models/cf_bld_res_detached_house_a_low_v01_lod1.glb',
      lod2: 'assets/models/cf_bld_res_detached_house_a_low_v01_lod2.glb',
      collision: 'assets/collisions/cf_bld_res_detached_house_a_low_v01_collision.glb',
    },
    dimensions: { widthM: 9, depthM: 12, heightM: 7.6 },
    pivot: { convention: 'ground-center', forward: '-Z', up: '+Y' },
    placement: { snapMode: 'parcel', zoneCompatibility: ['residential'], density: ['low'] },
    sockets: [
      { id: 'front_entry', position: { x: 0, y: 0, z: -6 }, forward: { x: 0, y: 0, z: -1 } },
      { id: 'rear_service', position: { x: 0, y: 0, z: 6 }, forward: { x: 0, y: 0, z: 1 } },
      { id: 'exterior_light', position: { x: 0, y: 2.3, z: -6.01 }, forward: { x: 0, y: 0, z: -1 } },
    ],
    materials: [{ id: 'stucco_cream', family: 'stucco' }],
    stateChannels: {
      condition: ['excellent', 'good', 'worn', 'distressed', 'unsafe'],
      occupancy: ['vacant', 'occupied'],
      power: ['off', 'on'],
      construction: ['none', 'active'],
      night: ['day', 'night'],
    },
    runtime: { instancing: 'thin', streamingClass: 'normal', memoryClass: 'small' },
    art: { styleFamily: 'civic-foundry-miniature', qualityTier: 'standard' },
  }],
} as const;

test('Asset Manifest V2 accepts the canonical House A contract', () => {
  assert.doesNotThrow(() => assertAssetManifestV2(valid));
  assert.equal(validateAssetManifestV2(valid).length, 0);
});

test('Asset Manifest V2 rejects external and parent-relative model references', () => {
  const external = structuredClone(valid) as any;
  external.entries[0].geometry.lod0 = 'https://example.com/house.glb';
  assert.match(validateAssetManifestV2(external).join('\n'), /runtime-relative/);

  const parent = structuredClone(valid) as any;
  parent.entries[0].geometry.lod0 = '../house.glb';
  assert.match(validateAssetManifestV2(parent).join('\n'), /runtime-relative/);
});

test('Asset Manifest V2 rejects duplicate IDs and wrong axis conventions', () => {
  const duplicate = structuredClone(valid) as any;
  duplicate.entries.push(structuredClone(duplicate.entries[0]));
  assert.match(validateAssetManifestV2(duplicate).join('\n'), /duplicate assetId/);

  const axis = structuredClone(valid) as any;
  axis.entries[0].pivot.up = '+Z';
  assert.match(validateAssetManifestV2(axis).join('\n'), /\+Y/);
});
```

- [ ] **Step 2: Run RED test**

Run:

```bash
node --experimental-strip-types --test tests/asset_manifest_v2.test.ts
```

Expected: FAIL because the manifest modules do not exist.

- [ ] **Step 3: Define the V2 types**

In `AssetManifestV2.ts`, define focused immutable types. Use these exact public names:

```ts
export type AssetId = `cf_${string}_v${string}`;
export type AssetCategory = 'building' | 'vehicle' | 'vegetation' | 'road' | 'civic' | 'industrial' | 'transit' | 'construction' | 'public_realm';
export type AssetModelReference = string;
export type AssetVector3 = Readonly<{ x: number; y: number; z: number }>;
export type AssetSocket = Readonly<{ id: string; position: AssetVector3; forward: AssetVector3 }>;
export type AssetManifestV2Entry = Readonly<{
  assetId: AssetId;
  revision: number;
  category: AssetCategory;
  geometry: Readonly<{ lod0: AssetModelReference; lod1?: AssetModelReference; lod2?: AssetModelReference; impostor?: AssetModelReference; collision?: AssetModelReference }>;
  dimensions: Readonly<{ widthM: number; depthM: number; heightM: number }>;
  pivot: Readonly<{ convention: 'ground-center'; forward: '-Z'; up: '+Y' }>;
  placement: Readonly<{ snapMode: 'parcel' | 'road' | 'socket' | 'free'; zoneCompatibility?: readonly string[]; density?: readonly string[] }>;
  sockets: readonly AssetSocket[];
  materials: readonly Readonly<{ id: string; family: string }>[];
  stateChannels: Readonly<{
    condition?: readonly string[];
    occupancy?: readonly string[];
    power?: readonly string[];
    construction?: readonly string[];
    night?: readonly string[];
  }>;
  runtime: Readonly<{ instancing: 'thin' | 'hardware' | 'unique'; streamingClass: 'critical' | 'near' | 'normal' | 'background'; memoryClass: 'tiny' | 'small' | 'medium' | 'large' }>;
  art: Readonly<{ styleFamily: string; qualityTier: string; reviewImage?: string }>;
}>;
export type AssetManifestV2 = Readonly<{ schemaVersion: 2; entries: readonly AssetManifestV2Entry[] }>;
```

- [ ] **Step 4: Implement strict validation**

`validateAssetManifestV2(value: unknown): readonly string[]` must verify at least:

```text
schemaVersion === 2
entries is an array
assetId matches ^cf_[a-z0-9]+(?:_[a-z0-9]+)*_v\d{2}$
asset IDs are unique
revision is positive integer
dimensions are finite and > 0
pivot is exactly ground-center / -Z / +Y
lod0 is present
all model/review references are relative, contain no '..', contain no scheme, and do not start '/'
socket IDs are unique and vectors finite
state channels contain unique non-empty tokens
```

`assertAssetManifestV2(value)` throws `Error('Asset Manifest V2 invalid:\n' + errors.join('\n'))` when any errors exist.

- [ ] **Step 5: Run focused test and typecheck**

Run:

```bash
node --experimental-strip-types --test tests/asset_manifest_v2.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/rendering/3d/assets/AssetManifestV2.ts src/rendering/3d/assets/AssetManifestV2Validation.ts tests/asset_manifest_v2.test.ts
git commit -m "feat: define 3d asset manifest v2"
```

---

### Task 3: Build the Deterministic CivicAssetCompiler Kernel

**Files:**
- Create: `tools/3d/asset-source-schema.mjs`
- Create: `tools/3d/geometry.mjs`
- Create: `tools/3d/CivicAssetCompiler.mjs`
- Create: `tests/asset_compiler.test.ts`

**Interfaces:**
- Consumes: JSON text recipes under `assets/source/3d/**`.
- Produces: `validateAssetSource(source)`, `compileAssetSource(source, options)`, `compileAssetFile(path, outputRoot)`, and deterministic `.glb`/manifest outputs.

- [ ] **Step 1: Write RED compiler determinism and validation tests**

Create `tests/asset_compiler.test.ts` that imports the `.mjs` compiler and uses a tiny in-memory source:

```ts
const source = {
  schemaVersion: 1,
  assetId: 'cf_test_building_box_low_a_v01',
  category: 'building',
  dimensions: { widthM: 4, depthM: 6, heightM: 3 },
  pivot: { convention: 'ground-center', forward: '-Z', up: '+Y' },
  materials: [{ id: 'wall', family: 'stucco', baseColor: '#d6c7a8', roughness: 0.8, metallic: 0 }],
  sockets: [{ id: 'front_entry', position: { x: 0, y: 0, z: -3 }, forward: { x: 0, y: 0, z: -1 } }],
  stateChannels: {},
  runtime: { instancing: 'thin', streamingClass: 'normal', memoryClass: 'tiny' },
  art: { styleFamily: 'civic-foundry-miniature', qualityTier: 'standard' },
  lods: [
    { id: 'lod0', maxTriangles: 100, parts: [{ id: 'body', primitive: 'box', size: { x: 4, y: 3, z: 6 }, center: { x: 0, y: 1.5, z: 0 }, material: 'wall' }] },
    { id: 'lod1', maxTriangles: 100, parts: [{ id: 'body', primitive: 'box', size: { x: 4, y: 3, z: 6 }, center: { x: 0, y: 1.5, z: 0 }, material: 'wall' }] },
    { id: 'lod2', maxTriangles: 100, parts: [{ id: 'body', primitive: 'box', size: { x: 4, y: 3, z: 6 }, center: { x: 0, y: 1.5, z: 0 }, material: 'wall' }] },
  ],
  collision: [{ id: 'collision_body', primitive: 'box', size: { x: 4, y: 3, z: 6 }, center: { x: 0, y: 1.5, z: 0 } }],
};

test('compiler emits byte-identical GLB for identical source', async () => {
  const first = await compileAssetSource(source, { compilerVersion: 'test-v1' });
  const second = await compileAssetSource(source, { compilerVersion: 'test-v1' });
  assert.deepEqual(first.lods.lod0, second.lods.lod0);
  assert.equal(first.contentHash, second.contentHash);
});

test('compiler rejects geometry below ground and missing required LODs', async () => {
  const below = structuredClone(source) as any;
  below.lods[0].parts[0].center.y = -2;
  await assert.rejects(() => compileAssetSource(below, { compilerVersion: 'test-v1' }), /below ground/);

  const missing = structuredClone(source) as any;
  missing.lods = missing.lods.slice(0, 2);
  await assert.rejects(() => compileAssetSource(missing, { compilerVersion: 'test-v1' }), /lod2/);
});
```

- [ ] **Step 2: Run RED compiler test**

Run:

```bash
node --experimental-strip-types --test tests/asset_compiler.test.ts
```

Expected: FAIL because compiler modules do not exist.

- [ ] **Step 3: Implement the source schema**

In `asset-source-schema.mjs`, validate a deliberately small first-tranche primitive vocabulary:

```text
box
wedge
cylinder
plane
```

Require:

```text
schemaVersion 1
assetId
category
dimensions
canonical pivot
materials
sockets
stateChannels
runtime
art
exactly lod0/lod1/lod2
collision primitives
```

Reject unsupported primitive/material keys rather than silently ignoring them.

- [ ] **Step 4: Implement deterministic primitive geometry helpers**

In `geometry.mjs`, export pure helpers:

```js
export function boxGeometry(size, center) { /* fixed vertex/index order */ }
export function wedgeGeometry(size, center, axis = 'x') { /* fixed vertex/index order */ }
export function cylinderGeometry(radius, height, segments, center) { /* start angle fixed at 0 */ }
export function planeGeometry(size, center, orientation) { /* fixed order */ }
export function triangleCount(geometry) { return geometry.indices.length / 3; }
```

Every helper must produce arrays in fixed order and must validate finite inputs. Do not depend on random values or filesystem iteration order.

- [ ] **Step 5: Implement deterministic GLB emission with glTF Transform**

In `CivicAssetCompiler.mjs`:

- sort material definitions by `id`;
- sort parts by `id` before emission;
- create one glTF Transform `Document` per LOD/collision output;
- create meshes/primitives with fixed attribute/index ordering;
- write GLB with `NodeIO().writeBinary(document)`;
- compute SHA-256 over compiler version + canonicalized source JSON + output bytes;
- return buffers instead of writing files from the pure `compileAssetSource()` API.

Use public shape:

```js
export async function compileAssetSource(source, { compilerVersion = 'civic-asset-compiler-v1' } = {}) {
  // returns { lods: { lod0, lod1, lod2 }, collision, manifest, contentHash, diagnostics }
}
```

`compileAssetFile(sourcePath, outputRoot)` writes the canonical filenames to `dist/assets/models`, `dist/assets/collisions`, and `dist/assets/manifests`.

- [ ] **Step 6: Enforce compiler correctness budgets**

For each source, reject:

```text
non-finite or non-positive dimensions
wrong +Y/-Z/ground-center convention
part bounds below Y = 0 by more than 0.001m
part bounds outside declared dimensions by more than 0.02m
LOD missing or duplicated
LOD triangle count greater than source maxTriangles
LOD1 triangles > LOD0 triangles
LOD2 triangles > LOD1 triangles
missing collision geometry for category building
missing mandatory declared socket data
external texture/URI references
```

This tranche uses primitive/color materials, so source texture URIs are not accepted yet.

- [ ] **Step 7: Run focused tests**

Run:

```bash
node --experimental-strip-types --test tests/asset_compiler.test.ts
```

Expected: PASS and repeat compilation produces byte-identical buffers.

- [ ] **Step 8: Commit**

```bash
git add tools/3d/asset-source-schema.mjs tools/3d/geometry.mjs tools/3d/CivicAssetCompiler.mjs tests/asset_compiler.test.ts
git commit -m "feat: add deterministic civic asset compiler"
```

---

### Task 4: Author and Compile Canonical House A

**Files:**
- Create: `assets/source/3d/buildings/cf_bld_res_detached_house_a_low_v01.asset.json`
- Modify: `tests/asset_compiler.test.ts`

**Interfaces:**
- Consumes: `CivicAssetCompiler` from Task 3.
- Produces runtime outputs named `cf_bld_res_detached_house_a_low_v01_{lod0,lod1,lod2}.glb`, collision GLB, and manifest JSON when built.

- [ ] **Step 1: Add RED House A source-contract tests**

Append tests that load the real recipe and assert the immutable art/geometry contract:

```ts
test('House A source preserves the approved miniature calibration contract', async () => {
  const source = JSON.parse(await readFile(new URL('../assets/source/3d/buildings/cf_bld_res_detached_house_a_low_v01.asset.json', import.meta.url), 'utf8'));
  assert.equal(source.assetId, 'cf_bld_res_detached_house_a_low_v01');
  assert.deepEqual(source.dimensions, { widthM: 9, depthM: 12, heightM: 7.6 });
  assert.deepEqual(source.pivot, { convention: 'ground-center', forward: '-Z', up: '+Y' });
  assert.deepEqual(source.sockets.map((socket: any) => socket.id).sort(), [
    'exterior_light', 'front_entry', 'rear_service', 'tree_primary',
  ]);
  assert.deepEqual(source.stateChannels.condition, ['excellent', 'good', 'worn', 'distressed', 'unsafe']);
  assert.equal(source.bakedPeople, false);
  assert.equal(source.bakedVehicles, false);
  assert.equal(source.bakedText, false);
});
```

Add a GLB bounds/LOD test using `NodeIO` from `@gltf-transform/core`:

```ts
test('House A compiles into valid monotonic LODs and collision output', async () => {
  const result = await compileAssetFile(sourcePath, outputRoot);
  assert.ok(result.triangleCounts.lod0 >= result.triangleCounts.lod1);
  assert.ok(result.triangleCounts.lod1 >= result.triangleCounts.lod2);
  assert.ok(result.triangleCounts.lod2 > 0);
  assert.ok(result.collisionTriangleCount > 0);
  assert.deepEqual(result.dimensions, { widthM: 9, depthM: 12, heightM: 7.6 });
});
```

- [ ] **Step 2: Run RED House A tests**

Run:

```bash
node --experimental-strip-types --test tests/asset_compiler.test.ts
```

Expected: FAIL because the House A recipe does not exist.

- [ ] **Step 3: Create the House A recipe with the approved palette and silhouette**

The JSON must use these named materials and approximate PBR values:

```json
[
  { "id": "foundation_warm", "family": "concrete", "baseColor": "#b9aa91", "roughness": 0.92, "metallic": 0 },
  { "id": "stucco_cream", "family": "stucco", "baseColor": "#d8ceb7", "roughness": 0.88, "metallic": 0 },
  { "id": "roof_charcoal", "family": "roofing", "baseColor": "#45494b", "roughness": 0.9, "metallic": 0 },
  { "id": "trim_muted_green", "family": "wood", "baseColor": "#70806e", "roughness": 0.82, "metallic": 0 },
  { "id": "door_dark", "family": "wood", "baseColor": "#343738", "roughness": 0.75, "metallic": 0 },
  { "id": "glass_pale_blue", "family": "glass", "baseColor": "#b6ced4", "roughness": 0.2, "metallic": 0, "alpha": 0.72 },
  { "id": "path_stone", "family": "concrete", "baseColor": "#b9b2a3", "roughness": 0.95, "metallic": 0 },
  { "id": "lawn_muted", "family": "vegetation", "baseColor": "#7f956f", "roughness": 1, "metallic": 0 }
]
```

House geometry must visibly include, within declared 9 m × 12 m × 7.6 m bounds:

```text
foundation slab
main cream rectangular volume
charcoal two-plane gable roof
chimney
centered dark front door on -Z facade
small covered entry canopy and supports
pale-blue windows with muted-green trim
front path/lawn base treatment
sparse low shrub/fence geometry
```

Do not bake a person, car, text/logo, or full tree mesh into the building model. `tree_primary` is a placement socket/context relationship.

- [ ] **Step 4: Make the three LODs intentionally simpler**

Use explicit recipe content:

```text
LOD0: full calibration detail; windows/trim/canopy/chimney/shrubs/fence retained
LOD1: retain silhouette, roof, chimney, door, major windows/canopy; simplify trim/shrubs
LOD2: retain foundation/body/gable/door/window color blocks; remove small trim/shrub/fence details
collision: one or two conservative boxes matching the occupied building envelope
```

The compiler enforces triangle monotonicity; do not fake LODs by duplicating identical detailed source if Task 3's real triangle tests can distinguish them.

- [ ] **Step 5: Compile House A twice and compare bytes**

Run a temporary local command through the compiler API or the compiler CLI implemented in Task 3:

```bash
node tools/3d/CivicAssetCompiler.mjs --source assets/source/3d/buildings/cf_bld_res_detached_house_a_low_v01.asset.json --out dist/assets
```

Run it twice after clearing the generated House A outputs. Expected: identical SHA-256/content hash and byte-identical LOD/collision files.

- [ ] **Step 6: Run focused tests**

Run:

```bash
node --experimental-strip-types --test tests/asset_compiler.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit only the tracked source/test changes**

```bash
git add assets/source/3d/buildings/cf_bld_res_detached_house_a_low_v01.asset.json tests/asset_compiler.test.ts
git status --short
```

Confirm no generated `.glb` or review `.png` is staged, then:

```bash
git commit -m "feat: author canonical house a 3d source"
```

---

### Task 5: Integrate the 3D Compiler into Asset Build and Verification

**Files:**
- Modify: `package.json`
- Modify: `scripts/build.mjs`
- Modify: `scripts/check-assets.mjs`
- Modify: `tests/asset_policy.test.ts`
- Modify: `tests/build_script.test.ts`

**Interfaces:**
- Consumes: compiler and House A source.
- Produces: reproducible `assets:3d:check`, `assets:3d:build`, combined asset gates, and production build outputs under `dist/assets`.

- [ ] **Step 1: Write RED asset-policy and script contracts**

Add to `tests/asset_policy.test.ts`:

```ts
test('tracked JSON 3D recipes are allowed while tracked GLB remains forbidden', () => {
  assert.equal(isForbiddenAssetPath('assets/source/3d/buildings/house.asset.json'), false);
  assert.equal(isForbiddenAssetPath('assets/source/3d/buildings/house.glb'), true);
});
```

Add a source contract test that `package.json` contains:

```json
"assets:3d:check": "node tools/3d/CivicAssetCompiler.mjs --check",
"assets:3d:build": "node tools/3d/CivicAssetCompiler.mjs --build",
"assets:check": "python tools/render_isometric_atlases.py --check && npm run assets:3d:check",
"assets:build": "python tools/render_isometric_atlases.py && npm run assets:3d:build"
```

- [ ] **Step 2: Run RED tests**

Run:

```bash
node --experimental-strip-types --test tests/asset_policy.test.ts tests/build_script.test.ts
```

Expected: script contract FAIL until package/build integration exists.

- [ ] **Step 3: Add compiler CLI modes**

`CivicAssetCompiler.mjs` must support:

```text
--check   validate every *.asset.json below assets/source/3d, compile in memory, write nothing
--build   validate and compile every source in stable lexical path order to dist/assets
--source <path> --out <path>   focused developer compilation
```

For `--build`, write:

```text
dist/assets/models/*_lod0.glb
dist/assets/models/*_lod1.glb
dist/assets/models/*_lod2.glb
dist/assets/collisions/*_collision.glb
dist/assets/manifests/*_manifest.json
dist/assets/manifests/catalog-v2.json
```

Do not write `review.png` here; deterministic review capture is a browser acceptance task.

- [ ] **Step 4: Integrate 3D asset compilation into the production build**

In `scripts/build.mjs`, after TypeScript/static/vendor setup and atlas generation, call the Node compiler as a child process:

```js
async function run3DAssetCompiler(root) {
  await runCommand(process.execPath, [join(root, 'tools', '3d', 'CivicAssetCompiler.mjs'), '--build'], {
    cwd: root,
    label: '3D asset generation',
  });
}
```

Call `await run3DAssetCompiler(root);` before `build()` returns.

- [ ] **Step 5: Keep binary source policy strict**

Do not remove `.glb`, `.gltf`, `.blend`, or `.obj` from `forbiddenExtensions`. If updating the policy message, state explicitly that deterministic `.asset.json` source is allowed and generated binaries belong in `dist/`.

- [ ] **Step 6: Verify asset gates and production build**

Run:

```bash
npm run assets:policy
npm run assets:3d:check
npm run assets:3d:build
npm run build
```

Expected generated House A outputs exist and are non-empty under `dist/assets`; `git status --short` shows no generated binary source changes.

- [ ] **Step 7: Commit**

```bash
git add package.json scripts/build.mjs scripts/check-assets.mjs tests/asset_policy.test.ts tests/build_script.test.ts
git commit -m "build: integrate deterministic 3d asset generation"
```

---

### Task 6: Create the Deterministic Presentation Snapshot and Canonical Building Resolver

**Files:**
- Create: `src/rendering/3d/presentation/PresentationTypes.ts`
- Create: `src/rendering/3d/presentation/VisualDeterminism.ts`
- Create: `src/rendering/3d/presentation/BuildingVisualResolver.ts`
- Create: `src/rendering/3d/presentation/WorldPresentationSnapshotBuilder.ts`
- Create: `tests/presentation_snapshot_3d.test.ts`

**Interfaces:**
- Consumes: read-only `SimulationCore`, `BuildingV2`, canonical geometry, existing utility snapshot.
- Produces: `PresentationEntityId`, `BuildingVisualState`, `WorldPresentationSnapshot`, `BuildingVisualResolver.resolve()`, and `WorldPresentationSnapshotBuilder.build()`.

- [ ] **Step 1: Write RED canonical mapping tests**

Create tests with a minimal `BuildingV2` fixture. Assert:

```ts
const state = resolver.resolve(cottage, {
  powerRatio: 1,
  visualTime: 'night',
});
assert.equal(state.presentationId, `building:${cottage.id}`);
assert.equal(state.assetId, 'cf_bld_res_detached_house_a_low_v01');
assert.equal(state.transform.positionM.y, 0);
assert.equal(state.state.condition, 'excellent');
assert.equal(state.state.occupancy, 'occupied');
assert.equal(state.state.powered, true);
assert.equal(state.state.nightLighting, true);
```

For an unsupported typology:

```ts
assert.equal(state.assetId, null);
assert.deepEqual(state.fallbackBoundsM, {
  footprint: unsupported.footprint,
  heightM: unsupported.heightMeters,
});
```

This forbids falling back to an unrelated legacy building asset.

- [ ] **Step 2: Write RED deterministic reconstruction/dirty-set tests**

Assert two fresh builders given equivalent core state resolve byte-equivalent presentation JSON and variation seeds. Assert a lifecycle appearance change dirties `appearance` but not `structural`, while a footprint/height/asset change dirties `structural`.

- [ ] **Step 3: Run RED tests**

Run:

```bash
node --experimental-strip-types --test tests/presentation_snapshot_3d.test.ts
```

Expected: FAIL because presentation modules do not exist.

- [ ] **Step 4: Define immutable presentation types**

Use these public shapes in `PresentationTypes.ts`:

```ts
export type PresentationEntityId = `building:${string}` | `parcel:${string}` | `road:${string}` | `vehicle:${string}` | `facility:${string}`;
export type VisualCondition = 'excellent' | 'good' | 'worn' | 'distressed' | 'unsafe';
export type VisualOccupancy = 'occupied' | 'vacant';
export type VisualTime = 'day' | 'night';
export type SceneTransform = Readonly<{
  positionM: Readonly<{ x: number; y: number; z: number }>;
  rotationYRad: number;
  scale: Readonly<{ x: number; y: number; z: number }>;
}>;
export type BuildingVisualState = Readonly<{
  presentationId: `building:${string}`;
  canonicalBuildingId: string;
  assetId: AssetId | null;
  transform: SceneTransform;
  fallbackBoundsM: Readonly<{ footprint: PolygonRing; heightM: number }>;
  state: Readonly<{
    condition: VisualCondition;
    occupancy: VisualOccupancy;
    powered: boolean;
    construction: 'none' | 'active';
    constructionProgress: number;
    nightLighting: boolean;
  }>;
  variationSeed: number;
  structuralFingerprint: string;
  appearanceFingerprint: string;
}>;
export type PresentationRevision = Readonly<{ world: number; buildings: number; environment: number }>;
export type PresentationDirtySets = Readonly<{
  structuralBuildings: readonly `building:${string}`[];
  appearanceBuildings: readonly `building:${string}`[];
  removedBuildings: readonly `building:${string}`[];
}>;
export type WorldPresentationSnapshot = Readonly<{
  revision: PresentationRevision;
  visualTime: VisualTime;
  buildings: readonly BuildingVisualState[];
  dirty: PresentationDirtySets;
}>;
```

Import `AssetId` and `PolygonRing` as types only.

- [ ] **Step 5: Implement stable deterministic hashing**

In `VisualDeterminism.ts`, implement a fixed FNV-1a 32-bit UTF-8 hash without platform-dependent APIs:

```ts
export function visualSeed(...parts: readonly string[]): number {
  let hash = 0x811c9dc5;
  const input = parts.join('\u001f');
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}
```

Use a deterministic string canonicalizer for fingerprints; sort object keys before hashing.

- [ ] **Step 6: Implement `BuildingVisualResolver` from canonical state only**

Rules for Tranche 1:

```text
typology:residential_cottage -> cf_bld_res_detached_house_a_low_v01
all other typologies -> assetId null + canonical-bounds proxy
scene X = world x meters
scene Y = 0
scene Z = world y meters
origin = polygonCentroid(building.footprint)
condition: exteriorCondition >=85 excellent; >=65 good; >=40 worn; >=20 distressed; else unsafe
occupancy: status occupied -> occupied; otherwise vacant
powered: supplied authoritative powerRatio >= 0.5
construction: status construction OR project.phase in foundation/structure/enclosure/fit-out -> active
constructionProgress: clamp project.progress to 0..1, else 0
nightLighting: visualTime night AND occupied AND powered
variationSeed: visualSeed(presentationId, assetId-or-proxy, 'base')
```

Do not infer household composition, income, tenants, or room-level occupancy.

- [ ] **Step 7: Implement `WorldPresentationSnapshotBuilder` retained revisions**

`build(core: SimulationCore, visualTime: VisualTime): WorldPresentationSnapshot` must:

1. read `core.buildings.listV2()` in deterministic ID order;
2. resolve power via `core.utilitySnapshot.perBuilding[building.id]?.power ?? 0`;
3. build all current states;
4. compare structural/appearance fingerprints with the previous build;
5. increment `revision.buildings` only when building content changes;
6. increment `revision.environment` when `visualTime` changes;
7. expose stable-sorted dirty IDs and removed IDs;
8. never mutate `core`.

The first snapshot marks every building structural-dirty.

- [ ] **Step 8: Run focused tests and typecheck**

Run:

```bash
node --experimental-strip-types --test tests/presentation_snapshot_3d.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/rendering/3d/presentation tests/presentation_snapshot_3d.test.ts
git commit -m "feat: add deterministic 3d presentation snapshots"
```

---

### Task 7: Introduce a Renderer-Neutral Presentation Interface Without Changing the Default

**Files:**
- Create: `src/rendering/PresentationRenderer.ts`
- Modify: `src/rendering/gpu/GpuWorldRenderer.ts`
- Modify: `src/app/GameApp.ts`
- Create: `tests/presentation_renderer_contract.test.ts`
- Modify: `tests/desktop_gpu_runtime.test.ts`

**Interfaces:**
- Consumes: current `GpuWorldRenderer` behavior.
- Produces: `PresentationRenderer` contract that both Pixi and Babylon implement.

- [ ] **Step 1: Write RED interface/source contracts**

Create a test that asserts the common module exports the required runtime-neutral types and that `GameApp.renderer` is typed as `PresentationRenderer`, while default construction remains the legacy renderer at this task.

Use the exact public contract:

```ts
export type PresentationBackend = 'legacy-gpu' | 'civic-3d';
export type RendererCameraInputOwner = 'app' | 'renderer';
export type RenderPoint = Readonly<{ x: number; y: number }>;
export type CellSelection = Readonly<{ x: number; y: number }> | null;
export type PresentationSceneStats = Readonly<{
  backend: PresentationBackend;
  loadedPrototypes: number;
  buildingInstances: number;
  fallbackBuildings: number;
  assetRequests: number;
  cacheHits: number;
  cacheMisses: number;
}>;
```

The interface must include the current renderer methods/signature plus:

```ts
readonly backend: PresentationBackend;
readonly cameraInputOwner: RendererCameraInputOwner;
debugSceneStats(): PresentationSceneStats;
dispose(): void;
```

- [ ] **Step 2: Run RED test**

Run:

```bash
node --experimental-strip-types --test tests/presentation_renderer_contract.test.ts tests/desktop_gpu_runtime.test.ts
```

Expected: FAIL because the interface does not exist.

- [ ] **Step 3: Create the renderer-neutral interface**

Move `CellSelection`/point contract ownership out of `GpuWorldRenderer.ts` into `PresentationRenderer.ts`. Keep the `draw()` argument order exactly compatible with the current `GameApp` call.

- [ ] **Step 4: Make `GpuWorldRenderer` implement the contract**

Add:

```ts
readonly backend = 'legacy-gpu' as const;
readonly cameraInputOwner = 'app' as const;
```

Return zeroed 3D-only diagnostics while preserving the current runtime:

```ts
debugSceneStats(): PresentationSceneStats {
  return Object.freeze({
    backend: 'legacy-gpu',
    loadedPrototypes: 0,
    buildingInstances: 0,
    fallbackBuildings: 0,
    assetRequests: 0,
    cacheHits: 0,
    cacheMisses: 0,
  });
}
```

`dispose()` must destroy the Pixi application without touching simulation state.

- [ ] **Step 5: Type `GameApp.renderer` against the interface but keep legacy construction**

Change imports/property type so:

```ts
readonly renderer: PresentationRenderer;
```

but constructor still executes:

```ts
this.renderer = new GpuWorldRenderer(canvas);
```

This task is a behavior-neutral seam.

- [ ] **Step 6: Run focused tests and existing isometric smoke**

Run:

```bash
node --experimental-strip-types --test tests/presentation_renderer_contract.test.ts tests/desktop_gpu_runtime.test.ts
npm run typecheck
npm run build
npm run test:smoke:isometric
```

Expected: PASS; legacy smoke behavior is unchanged.

- [ ] **Step 7: Commit**

```bash
git add src/rendering/PresentationRenderer.ts src/rendering/gpu/GpuWorldRenderer.ts src/app/GameApp.ts tests/presentation_renderer_contract.test.ts tests/desktop_gpu_runtime.test.ts
git commit -m "refactor: add shared presentation renderer contract"
```

---

### Task 8: Add the Babylon WebGPU-First Scene and Miniature Camera Shell

**Files:**
- Create: `src/rendering/3d/BabylonEngineFactory.ts`
- Create: `src/rendering/3d/MiniatureCameraController.ts`
- Create: `src/rendering/3d/MiniatureRenderPipeline.ts`
- Create: `src/rendering/3d/Civic3DWorldRenderer.ts`
- Create: `tests/civic_3d_engine_contract.test.ts`
- Create: `tests/civic_3d_camera.test.ts`

**Interfaces:**
- Consumes: `PresentationRenderer`, Babylon package imports, presentation snapshot builder.
- Produces: instantiable `Civic3DWorldRenderer` with WebGPU-first engine initialization, WebGL fallback, free orbit/zoom, and presentation-only rendering.

- [ ] **Step 1: Write RED engine factory tests around injected adapters**

Do not require a real GPU in Node tests. Design `createBabylonEngine(canvas, adapters?)` so test adapters can prove ordering:

```ts
test('engine factory prefers WebGPU and falls back to WebGL after support/init failure', async () => {
  const calls: string[] = [];
  const result = await createBabylonEngine({} as HTMLCanvasElement, {
    webGpuSupported: async () => true,
    createWebGpu: async () => { calls.push('webgpu'); throw new Error('init failed'); },
    createWebGl: () => { calls.push('webgl'); return fakeEngine; },
  });
  assert.deepEqual(calls, ['webgpu', 'webgl']);
  assert.equal(result.backend, 'webgl');
});
```

Also test unsupported WebGPU goes directly to WebGL.

- [ ] **Step 2: Write RED camera-state tests**

Use a math-only controller independent of DOM/Babylon allocation:

```ts
const camera = new MiniatureCameraController({ target: { x: 0, y: 0, z: 0 }, radius: 120, azimuthRad: Math.PI / 4, elevationRad: 0.9 });
const initial = camera.snapshot();
camera.orbit(120, -40);
camera.zoomBy(0.8);
camera.pan(10, -5);
assert.notDeepEqual(camera.snapshot(), initial);
assert.ok(camera.snapshot().radius >= 12 && camera.snapshot().radius <= 5000);
```

Test `rotateQuarterTurn(1)` changes azimuth by exactly `Math.PI / 2` modulo a full turn.

- [ ] **Step 3: Run RED tests**

Run:

```bash
node --experimental-strip-types --test tests/civic_3d_engine_contract.test.ts tests/civic_3d_camera.test.ts
```

Expected: FAIL because 3D runtime modules do not exist.

- [ ] **Step 4: Implement WebGPU-first engine creation**

Runtime imports use explicit browser-resolvable Babylon subpaths, for example:

```ts
import { Engine } from '@babylonjs/core/Engines/engine.js';
import { WebGPUEngine } from '@babylonjs/core/Engines/webgpuEngine.js';
```

The default adapter must:

1. query `WebGPUEngine.IsSupportedAsync`;
2. if supported, construct/init `WebGPUEngine` with high-performance intent;
3. catch support/init exceptions and record a diagnostic;
4. fall back to `new Engine(canvas, true, { preserveDrawingBuffer: false, stencil: true, powerPreference: 'high-performance' })`;
5. return `{ engine, backend: 'webgpu' | 'webgl', diagnostics }`.

Do not create a second simulation clock or render loop.

- [ ] **Step 5: Implement deterministic camera state and Babylon application**

`MiniatureCameraController` owns clamped math state. `Civic3DWorldRenderer` creates an `ArcRotateCamera`, applies controller state each draw, and declares:

```ts
readonly backend = 'civic-3d' as const;
readonly cameraInputOwner = 'renderer' as const;
```

Required input behavior once attached:

```text
right drag: orbit
middle drag: pan
wheel: radius zoom
Q/E compatibility rotate: ±90° azimuth
```

Keep `pan`, `zoomBy`, and `rotate` methods for the shared interface.

- [ ] **Step 6: Add the miniature presentation pipeline**

Use a conservative scene:

```text
hemispheric ambient light
directional key light
neutral ground/clear color
DefaultRenderingPipeline with FXAA and depth of field enabled
no baked blur in assets
```

Expose a renderer-only `setVisualTime('day' | 'night')` internally for later acceptance tests; it updates presentation environment state, not simulation.

- [ ] **Step 7: Implement compatibility projection/picking methods**

`worldToCanvas` uses Babylon `Vector3.Project` from world `(xMeters, 0, zMeters)` to canvas pixels. `worldMetersToCanvas` maps canonical `(x,y)` to `(x,0,z=y)`. `canvasToCell` creates a camera ray, intersects the `Y=0` ground plane, converts meters to legacy cell coordinates using `LEGACY_CELL_SIZE_METERS`, and returns null outside terrain bounds.

`tilePolygon` projects the four ground corners of a legacy 20m cell.

- [ ] **Step 8: Run focused tests and typecheck**

Run:

```bash
node --experimental-strip-types --test tests/civic_3d_engine_contract.test.ts tests/civic_3d_camera.test.ts
npm run typecheck
npm run build
```

Expected: PASS. `Civic3DWorldRenderer` is not yet selected by `GameApp`.

- [ ] **Step 9: Commit**

```bash
git add src/rendering/3d/BabylonEngineFactory.ts src/rendering/3d/MiniatureCameraController.ts src/rendering/3d/MiniatureRenderPipeline.ts src/rendering/3d/Civic3DWorldRenderer.ts tests/civic_3d_engine_contract.test.ts tests/civic_3d_camera.test.ts
git commit -m "feat: add Babylon 3d renderer foundation"
```

---

### Task 9: Implement the Async GLB Catalog, Request Broker, and Prototype Cache

**Files:**
- Create: `src/rendering/3d/assets/AssetCatalogV2.ts`
- Create: `src/rendering/3d/assets/AssetRequestBroker.ts`
- Create: `src/rendering/3d/assets/GLBResourceCache.ts`
- Create: `src/rendering/3d/assets/ScenePrototypeCache.ts`
- Create: `src/rendering/3d/assets/AssetStreamingManager.ts`
- Create: `src/rendering/3d/assets/BabylonGlbPrototypeLoader.ts`
- Create: `tests/asset_streaming_3d.test.ts`

**Interfaces:**
- Consumes: Asset Manifest V2 and Babylon scene.
- Produces: `AssetCatalogV2`, `AssetStreamingManager.request()`, reference-counted `AssetLease`, prototype diagnostics, and one centralized Babylon GLB loading seam.

- [ ] **Step 1: Write RED catalog/request collapse tests**

Test pure catalog and loader injection:

```ts
test('duplicate asset+LOD requests collapse to one load and both leases share a prototype', async () => {
  let loads = 0;
  const manager = testStreamingManager({
    loader: async (request) => { loads += 1; return fakePrototype(request.key); },
    maxConcurrent: 2,
  });
  const [a, b] = await Promise.all([
    manager.request({ assetId: HOUSE_A, lod: 'lod0', priority: 1 }),
    manager.request({ assetId: HOUSE_A, lod: 'lod0', priority: 1 }),
  ]);
  assert.equal(loads, 1);
  assert.equal(a.prototype, b.prototype);
  a.release();
  b.release();
});
```

Add cancellation test: cancel before load completion and assert no acquired lease/scene instantiation survives. Add priority test: with `maxConcurrent: 1`, P0 queued work starts before P4 work when both are waiting.

- [ ] **Step 2: Write RED cache/refcount/failure tests**

Assert:

```text
acquire increments refs
release decrements refs but never below zero
duplicate release throws or is idempotently guarded by lease object
transient loader failure retries once
invalid/permanent failure does not retry
cache hit/miss/load counters are deterministic
```

- [ ] **Step 3: Run RED tests**

Run:

```bash
node --experimental-strip-types --test tests/asset_streaming_3d.test.ts
```

Expected: FAIL because streaming modules do not exist.

- [ ] **Step 4: Implement immutable `AssetCatalogV2`**

Public API:

```ts
export class AssetCatalogV2 {
  constructor(manifest: AssetManifestV2);
  get(assetId: AssetId): AssetManifestV2Entry | undefined;
  require(assetId: AssetId): AssetManifestV2Entry;
  model(assetId: AssetId, lod: 'lod0' | 'lod1' | 'lod2'): string;
  list(): readonly AssetManifestV2Entry[];
}
```

Validate manifest in the constructor and store deterministic ID-sorted entries.

- [ ] **Step 5: Implement request and cache contracts**

Use exact public request/lease concepts:

```ts
export type AssetLod = 'lod0' | 'lod1' | 'lod2';
export type AssetRequest = Readonly<{ assetId: AssetId; lod: AssetLod; priority: 0 | 1 | 2 | 3 | 4; signal?: AbortSignal }>;
export type AssetResourceKey = `${AssetId}@${AssetLod}`;
export type AssetLease<T> = Readonly<{ key: AssetResourceKey; prototype: T; release(): void }>;
```

`AssetRequestBroker` sorts by lower numeric priority first, then monotonic sequence number. It deduplicates active keys.

`GLBResourceCache` owns resolved resource/refcount metadata. `ScenePrototypeCache` owns/disposes the Babylon presentation prototype when explicitly evicted or renderer disposed.

- [ ] **Step 6: Implement bounded `AssetStreamingManager`**

Tranche 1 behavior:

```text
maxConcurrent default 4
duplicate active key -> same promise/resource
AbortSignal cancellation respected before acquisition
transient failure -> one retry
invalid/permanent failure -> no retry
resolved lease increments refcount
release decrements exactly once
diagnostics expose requestCount/cacheHits/cacheMisses/residentCount/queuedCount/activeLoads
```

Do not add GPU memory budgets or predictive camera streaming yet.

- [ ] **Step 7: Centralize Babylon GLB loading**

`BabylonGlbPrototypeLoader.ts` is the only runtime 3D asset module allowed to import the glTF loader side effect:

```ts
import '@babylonjs/loaders/glTF/index.js';
```

Use `SceneLoader.LoadAssetContainerAsync` (or the current Babylon 9 equivalent available in the pinned package) against runtime-relative URLs. Wrap the returned `AssetContainer` as a prototype that can instantiate/dispose presentation meshes without owning game facts.

No building scene layer may call `SceneLoader` directly.

- [ ] **Step 8: Run focused tests and typecheck**

Run:

```bash
node --experimental-strip-types --test tests/asset_streaming_3d.test.ts
npm run typecheck
npm run build
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/rendering/3d/assets tests/asset_streaming_3d.test.ts
git commit -m "feat: add streamed 3d asset runtime"
```

---

### Task 10: Add Retained Canonical Building Instances, State Visuals, and House A LOD

**Files:**
- Create: `src/rendering/3d/scene/BuildingSceneLayer.ts`
- Create: `src/rendering/3d/scene/ProceduralFallbackBuilding.ts`
- Create: `src/rendering/3d/scene/StateVisualResolver.ts`
- Modify: `src/rendering/3d/Civic3DWorldRenderer.ts`
- Create: `tests/building_scene_layer_3d.test.ts`

**Interfaces:**
- Consumes: `WorldPresentationSnapshot`, `AssetStreamingManager`, House A prototypes.
- Produces: retained building scene entries keyed by `PresentationEntityId`, initial LOD switching, state-only updates, stable pick metadata, and canonical-bounds fallback meshes.

- [ ] **Step 1: Write RED retained identity tests with fake scene adapters**

Keep Node tests independent of WebGL by injecting a `BuildingSceneAdapter`. Assert:

```ts
test('unchanged snapshot retains the same building handle and does not reload the prototype', async () => {
  const first = await layer.applySnapshot(snapshot);
  const handle = layer.debugHandle('building:b1');
  const loads = diagnostics.loads;

  await layer.applySnapshot(snapshotWithNoDirtyBuildings);

  assert.equal(layer.debugHandle('building:b1'), handle);
  assert.equal(diagnostics.loads, loads);
});
```

Add appearance-only change test asserting same structural handle/prototype. Add structural change test asserting replacement. Add removal test asserting lease release.

- [ ] **Step 2: Write RED canonical fallback and picking tests**

For unsupported typology state with `assetId: null`, assert adapter receives its canonical footprint/height and never receives House A. For House A, assert created mesh metadata contains exactly:

```ts
{ presentationEntityId: 'building:<canonical-id>' }
```

- [ ] **Step 3: Write RED LOD/state tests**

Use deterministic camera-distance inputs:

```text
<= 90m -> lod0
> 90m and <= 260m -> lod1
> 260m -> lod2
```

Add 10% hysteresis for downgrade/upgrade to prevent immediate oscillation. These are first-tranche calibration thresholds, not permanent metro LOD policy.

State tests assert:

```text
excellent/good/worn/distressed/unsafe -> deterministic material parameter profile
night + occupied + powered -> emissive windows on
night + unpowered -> emissive off
active construction -> scaffold attachment visible with progress
appearance changes do not request a different base GLB
```

- [ ] **Step 4: Run RED tests**

Run:

```bash
node --experimental-strip-types --test tests/building_scene_layer_3d.test.ts
```

Expected: FAIL because scene layer modules do not exist.

- [ ] **Step 5: Implement state visual resolution**

`StateVisualResolver` returns presentation parameters, not simulation data. Use a small fixed profile:

```ts
export type BuildingAppearance = Readonly<{
  baseTint: Readonly<{ r: number; g: number; b: number }>;
  roughnessMultiplier: number;
  grimeAmount: number;
  windowsEmissive: boolean;
  scaffoldVisible: boolean;
  constructionProgress: number;
}>;
```

Condition should progressively reduce saturation/brightness and increase roughness/grime without changing asset identity.

- [ ] **Step 6: Implement canonical fallback geometry**

`ProceduralFallbackBuilding` extrudes or approximates the canonical footprint/height sufficiently for bounds and picking. It must preserve:

```text
presentation identity
canonical footprint extents
heightMeters
world transform/category meaning
```

It must not call legacy `definitionForBuilding()` to fabricate a different massing.

- [ ] **Step 7: Implement retained House A instance lifecycle**

`BuildingSceneLayer` maintains:

```ts
private readonly entries = new Map<PresentationEntityId, BuildingSceneEntry>();
```

Only structural dirty IDs may acquire/replace base prototype instances. Appearance dirty IDs update material/emissive/scaffold parameters in place. Removed IDs release their asset lease and dispose presentation nodes.

For repeated House A, use Babylon instancing where compatible so geometry/material resources are shared. If thin instances conflict with per-instance picking/state in this first calibration tranche, regular Babylon instances are acceptable; retain `runtime.instancing: 'thin'` as the target declaration and record the temporary instance strategy in diagnostics rather than duplicating mesh geometry.

- [ ] **Step 8: Wire building snapshots into `Civic3DWorldRenderer.draw()`**

The renderer owns one `WorldPresentationSnapshotBuilder`. Each draw:

1. builds snapshot for current visual time;
2. advances camera state;
3. applies snapshot to `BuildingSceneLayer`;
4. renders the Babylon scene once.

Do not rebuild terrain/roads/vehicles here; Tranche 1 can use a neutral ground plane plus canonical building layer for House A calibration.

- [ ] **Step 9: Run focused tests**

Run:

```bash
node --experimental-strip-types --test tests/building_scene_layer_3d.test.ts tests/presentation_snapshot_3d.test.ts tests/asset_streaming_3d.test.ts
npm run typecheck
npm run build
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/rendering/3d/scene src/rendering/3d/Civic3DWorldRenderer.ts tests/building_scene_layer_3d.test.ts
git commit -m "feat: render retained canonical buildings in 3d"
```

---

### Task 11: Add the Dual Presentation Backend Factory and Opt-In Civic 3D Mode

**Files:**
- Create: `src/rendering/PresentationRendererFactory.ts`
- Modify: `src/app/GameApp.ts`
- Modify: `tests/desktop_gpu_runtime.test.ts`
- Create: `tests/presentation_backend.test.ts`

**Interfaces:**
- Consumes: `GpuWorldRenderer`, `Civic3DWorldRenderer`, shared `PresentationRenderer`.
- Produces: query-selected `?renderer=civic-3d` path with `legacy-gpu` as the unchanged default.

- [ ] **Step 1: Write RED backend-selection tests**

Use an injectable factory to avoid allocating a real canvas renderer in Node tests:

```ts
test('presentation backend defaults to legacy gpu and recognizes explicit civic-3d', () => {
  assert.equal(resolvePresentationBackend(''), 'legacy-gpu');
  assert.equal(resolvePresentationBackend('?renderer=legacy-gpu'), 'legacy-gpu');
  assert.equal(resolvePresentationBackend('?renderer=civic-3d'), 'civic-3d');
  assert.equal(resolvePresentationBackend('?renderer=unknown'), 'legacy-gpu');
});
```

Update the desktop runtime source test to assert default legacy behavior and opt-in 3D support instead of claiming Pixi is the only production-capable renderer.

- [ ] **Step 2: Run RED tests**

Run:

```bash
node --experimental-strip-types --test tests/presentation_backend.test.ts tests/desktop_gpu_runtime.test.ts
```

Expected: FAIL because factory/resolver does not exist.

- [ ] **Step 3: Implement backend resolution/factory**

Public API:

```ts
export function resolvePresentationBackend(search: string): PresentationBackend;
export function createPresentationRenderer(canvas: HTMLCanvasElement, backend: PresentationBackend): PresentationRenderer;
```

`legacy-gpu` returns `GpuWorldRenderer`. `civic-3d` returns `Civic3DWorldRenderer`.

- [ ] **Step 4: Wire `GameApp` through the factory**

In constructor:

```ts
const backend = resolvePresentationBackend(window.location.search);
this.renderer = createPresentationRenderer(canvas, backend);
```

Do not add a persisted gameplay setting or Save field.

- [ ] **Step 5: Prevent legacy pan gestures from fighting the 3D camera**

In existing pointer bindings, guard the old app-owned right/middle pan behavior:

```ts
if (this.renderer.cameraInputOwner === 'app') {
  // existing right/middle drag pan behavior
}
```

For `cameraInputOwner === 'renderer'`, attach the renderer's camera controller to the canvas and let it own right-drag orbit/middle-drag pan/wheel zoom. Keep Q/E dispatch through `renderer.rotate()` so both backends remain compatible.

- [ ] **Step 6: Verify default legacy smoke still passes**

Run:

```bash
node --experimental-strip-types --test tests/presentation_backend.test.ts tests/desktop_gpu_runtime.test.ts
npm run build
npm run test:smoke:isometric
```

Expected: PASS. No query parameter means current Pixi behavior.

- [ ] **Step 7: Commit**

```bash
git add src/rendering/PresentationRendererFactory.ts src/app/GameApp.ts tests/presentation_backend.test.ts tests/desktop_gpu_runtime.test.ts
git commit -m "feat: add opt-in civic 3d presentation backend"
```

---

### Task 12: Add House A Browser Acceptance, Picking, Reconstruction, and Review Cameras

**Files:**
- Create: `tests/smoke/civic_3d_house_a_smoke.py`
- Create: `tests/smoke/civic_3d_house_a_review.py`
- Modify: `package.json`
- Modify: `src/rendering/3d/Civic3DWorldRenderer.ts`
- Modify: `src/rendering/3d/scene/BuildingSceneLayer.ts`

**Interfaces:**
- Consumes: built app, generated House A GLBs/catalog, opt-in 3D renderer.
- Produces: real Chromium acceptance for loading/rendering/picking/reconstruction and deterministic fixed-camera review images under `dist/assets/reviews/house-a/`.

- [ ] **Step 1: Add RED package scripts and smoke skeleton**

Add scripts:

```json
"test:smoke:3d-house": "python tests/smoke/civic_3d_house_a_smoke.py",
"review:3d-house": "python tests/smoke/civic_3d_house_a_review.py"
```

The smoke must fail initially if it cannot observe a civic-3d renderer and a resident House A prototype.

- [ ] **Step 2: Build a deterministic canonical House A fixture in the browser**

Within the smoke page, dynamically import current compiled simulation modules and restore one canonical `BuildingV2` using `app.core.buildings.restoreV2([...])`. Use a rectangular footprint centered on a known position and:

```text
id: house-a-calibration-1
typologyId: typology:residential_cottage
heightMeters: 7.6
stories: 2
status: occupied
lifecycle.exteriorCondition: 92
```

Do not inject Babylon-owned gameplay data; the fixture enters through the canonical building store.

- [ ] **Step 3: Implement public presentation-only test diagnostics**

`Civic3DWorldRenderer.debugSceneStats()` must expose only counts, backend, and asset diagnostics. Add a narrow debug query method for browser acceptance:

```ts
debugBuildingState(presentationId: `building:${string}`): Readonly<{
  assetId: AssetId | null;
  lod: AssetLod | 'proxy';
  variationSeed: number;
  structuralHandleId: string;
}> | null;
```

`structuralHandleId` is presentation-only and must never be serialized.

- [ ] **Step 4: Implement real picking identity round-trip**

Expose `pickPresentationEntity(clientX, clientY): PresentationEntityId | null` on `Civic3DWorldRenderer` for the test and later UI integration. It must use Babylon picking metadata and return the canonical presentation identity, not a mesh name as authority.

- [ ] **Step 5: Write the full browser smoke assertions**

The smoke should launch Chromium headless with WebGPU not assumed; WebGL fallback is acceptable. Assert:

```text
?renderer=civic-3d selects backend civic-3d
engine backend is webgpu or webgl
House A generated lod0/lod1/lod2/collision files exist and are non-empty
House A catalog entry loads successfully
at least one House A building instance exists
camera orbit/zoom changes camera diagnostics but not serialized core state
picking the visible House A returns building:house-a-calibration-1
same authoritative snapshot after renderer building-layer teardown/rebuild resolves same assetId/state/variationSeed
second House A canonical building shares one loaded prototype for the same LOD
legacy save serialization remains Save V9 and contains no Babylon/scene handles
no browser console/page errors
```

Print a single success line:

```text
CIVIC_3D_HOUSE_A_SMOKE_PASS
```

with compact diagnostics.

- [ ] **Step 6: Add deterministic fixed review cameras**

`civic_3d_house_a_review.py` creates `dist/assets/reviews/house-a/` and captures these fixed scenes at a fixed viewport/resolution:

```text
front_three_quarter.png
rear_three_quarter.png
top_oblique.png
street_distance.png
neighborhood_distance.png
night.png
worn.png
construction.png
cf_bld_res_detached_house_a_low_v01_review.png
```

Set camera state, lighting, `visualTime`, and House A canonical lifecycle/project state explicitly before each capture. Do not use current clock time or randomness.

- [ ] **Step 7: Run real browser acceptance and review generation**

Run:

```bash
npm run build
npm run test:smoke:3d-house
npm run review:3d-house
```

Expected: smoke PASS; all review files are non-empty under `dist/assets/reviews/house-a/`; no review PNG is tracked by git.

- [ ] **Step 8: Re-run the legacy isometric smoke**

Run:

```bash
npm run test:smoke:isometric
```

Expected: PASS, proving default renderer compatibility.

- [ ] **Step 9: Commit**

```bash
git add tests/smoke/civic_3d_house_a_smoke.py tests/smoke/civic_3d_house_a_review.py package.json src/rendering/3d/Civic3DWorldRenderer.ts src/rendering/3d/scene/BuildingSceneLayer.ts
git status --short
git commit -m "test: add house a 3d browser acceptance"
```

Confirm no `dist/` review image or generated GLB is staged.

---

### Task 13: Lock the Architecture Firewall, Document the New Experimental Path, and Run Full Verification

**Files:**
- Modify: `scripts/check-architecture.mjs`
- Modify: `tests/architecture_policy.test.ts`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/TESTING.md`
- Create: `docs/art/3D_ASSET_PIPELINE.md`
- Modify: `README.md` only if the renderer query flag is not documented elsewhere in current user-facing development instructions.

**Interfaces:**
- Consumes: completed Tranche 1.
- Produces: enforceable no-Babylon authority firewall, accurate repository documentation, exact-head verification evidence.

- [ ] **Step 1: Write RED bare-package architecture policy tests**

Extend `tests/architecture_policy.test.ts` with direct package-boundary checks. Refactor `checkArchitectureImport()` if necessary so it can evaluate both relative resolved paths and bare specifiers.

Required contracts:

```ts
assert.equal(checkArchitectureImport('src/simulation/A.ts', '@babylonjs/core/scene.js')?.rule, 'authoritative-no-babylon');
assert.equal(checkArchitectureImport('src/world/A.ts', '@babylonjs/core/Meshes/mesh.js')?.rule, 'authoritative-no-babylon');
assert.equal(checkArchitectureImport('src/save/A.ts', '@babylonjs/loaders/glTF/index.js')?.rule, 'authoritative-no-babylon');
assert.equal(checkArchitectureImport('src/simulation/A.ts', '@gltf-transform/core')?.rule, 'authoritative-no-gltf-transform');
assert.equal(checkArchitectureImport('src/rendering/3d/A.ts', '@babylonjs/core/scene.js'), null);
```

- [ ] **Step 2: Run RED architecture test**

Run:

```bash
node --experimental-strip-types --test tests/architecture_policy.test.ts
```

Expected: FAIL because bare package imports are not currently checked.

- [ ] **Step 3: Extend the architecture checker**

`runArchitectureCheck()` must pass every extracted module specifier through a package rule before skipping non-relative imports. Apply:

```text
importer starts src/simulation/, src/world/, or src/save/
AND specifier starts @babylonjs/
-> authoritative-no-babylon

importer starts src/simulation/, src/world/, or src/save/
AND specifier starts @gltf-transform/
-> authoritative-no-gltf-transform
```

Keep all existing relative-path rules unchanged.

- [ ] **Step 4: Update architecture documentation with current-vs-target language**

`docs/ARCHITECTURE.md` must state accurately:

```text
Current default presentation: GpuWorldRenderer / PixiJS WebGL
Opt-in Tranche 1 presentation: ?renderer=civic-3d / Civic3DWorldRenderer / Babylon.js WebGPU-first with WebGL fallback
Desktop host: Electron remains current
Tauri 2: approved later target, not implemented in Tranche 1
Simulation/World/Cadastre/Save authority: unchanged
```

Do not describe Babylon as the sole/default production renderer until the retirement gates in the umbrella spec are met.

- [ ] **Step 5: Document the asset pipeline concretely**

Create `docs/art/3D_ASSET_PIPELINE.md` with these exact operational sections:

```text
Source policy
Coordinate contract
Asset ID/naming contract
House A source path
Compiler commands
Generated output paths
Manifest V2 contract
LOD/collision requirements
Runtime loading path
Deterministic state/variation rule
Review-camera command/output
How to add the next asset family without committing binaries
```

Include example commands:

```bash
npm run assets:3d:check
npm run assets:3d:build
npm run build
npm run test:smoke:3d-house
npm run review:3d-house
```

- [ ] **Step 6: Document verification in `docs/TESTING.md`**

Add the new focused unit suites and smoke/review commands. Make clear review PNG generation is evidence output, not a source-of-truth asset.

- [ ] **Step 7: Run the complete Node/asset/build gate**

From a clean dependency install:

```bash
npm ci
npm run verify
```

Expected: every format, lint, policy, architecture, typecheck, Node test, asset policy/check, and production build gate passes.

- [ ] **Step 8: Run all inherited browser smoke gates**

Run:

```bash
npm run test:smoke
npm run test:smoke:phase7
npm run test:smoke:urban-fabric
npm run test:smoke:isometric
```

Expected: PASS.

- [ ] **Step 9: Run the new 3D acceptance gate**

Run:

```bash
npm run test:smoke:3d-house
npm run review:3d-house
```

Expected: `CIVIC_3D_HOUSE_A_SMOKE_PASS` and deterministic non-empty review images under `dist/assets/reviews/house-a/`.

- [ ] **Step 10: Prove persistence/authority scope did not move**

Run:

```bash
git diff --name-only 4e06d80561278e35d3868a37d41fa5c6e8d3537b...HEAD
```

Inspect the result and confirm:

```text
no file under src/save/ changed
no authoritative type/state was moved into src/rendering/
no Babylon import exists under src/simulation/, src/world/, or src/save/
no generated GLB/PNG is tracked under assets/
no Tauri files/dependencies exist
GpuWorldRenderer remains available and default without query override
```

If any condition fails, correct the tranche before final verification rather than documenting an exception.

- [ ] **Step 11: Commit documentation/policy closure**

```bash
git add scripts/check-architecture.mjs tests/architecture_policy.test.ts docs/ARCHITECTURE.md docs/TESTING.md docs/art/3D_ASSET_PIPELINE.md README.md
git commit -m "docs: close 3d runtime foundation tranche"
```

If `README.md` did not require a change, omit it from `git add`.

- [ ] **Step 12: Capture exact-head verification evidence before completion**

Run:

```bash
git rev-parse HEAD
npm run verify
npm run test:smoke
npm run test:smoke:phase7
npm run test:smoke:urban-fabric
npm run test:smoke:isometric
npm run test:smoke:3d-house
```

Record the exact head SHA and command results in the eventual PR description. Do not claim Tranche 1 complete until these commands pass on that exact head.

---

## Tranche 1 Completion Criteria

Tranche 1 is complete only when all of the following are true:

1. Babylon 9.23.0 is available through the existing local ESM/import-map build with WebGPU-first initialization and WebGL fallback.
2. Legacy Pixi remains the default renderer and all inherited smoke tests remain green.
3. `?renderer=civic-3d` launches the new renderer without changing simulation/save authority.
4. Asset Manifest V2 validates canonical meters/+Y/-Z/ground-center metadata and safe runtime references.
5. CivicAssetCompiler deterministically produces byte-identical GLBs from identical tracked text source.
6. House A compiles to LOD0/LOD1/LOD2 plus collision and manifest outputs with the approved 9m × 12m × 7.6m miniature-house contract.
7. Generated GLB/review binaries remain under `dist/`; source-control binary policy remains strict.
8. Canonical `BuildingV2` drives House A presentation through stable IDs and deterministic state/variation.
9. Unsupported canonical buildings use canonical-bounds proxies rather than unrelated legacy massing.
10. Asset requests are deduplicated, bounded, reference-counted, cancelable, and observable through diagnostics.
11. Repeated House A buildings share prototype resources; unchanged frames do not reconstruct them.
12. Condition, power/night, and construction presentation update without becoming simulation facts.
13. Free orbit, pan, zoom, Q/E compatibility rotation, picking, and deterministic scene reconstruction pass real-browser acceptance.
14. Fixed House A review cameras produce deterministic evidence images.
15. Architecture policy prevents Babylon/glTF Transform imports from authoritative simulation/world/save domains.
16. Save V9 remains unchanged, Electron remains current, Tauri remains deferred, and no Pixi retirement is attempted.
17. `npm run verify`, all inherited smoke suites, and `npm run test:smoke:3d-house` pass on the exact final head.
