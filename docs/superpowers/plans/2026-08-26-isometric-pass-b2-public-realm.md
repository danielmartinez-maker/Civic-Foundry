# Isometric Pass B2 — Parking & Public Realm Implementation Plan

> **Execution status: COMPLETE against frozen Urban Fabric checkpoint `941a9d5261898b00af103bfd9797065975a660f2`.** Final acceptance evidence is recorded in `docs/art/PASS_B2_REPORT.md`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to execute this plan task-by-task. Every production task follows RED → GREEN → focused verification → commit.

**Goal:** Add a deterministic, presentation-only parking/public-realm layer with six context-derived streetscape profiles, 90 authored B2 asset entries, correct shared depth ordering, and no new simulation or parking authority.

**Architecture:** B2 reads canonical roads, cadastre, `BuildingV2`, service facilities, terrain compatibility, and stable IDs. A read-only O(N) fingerprint gates an indexed context snapshot. Pure resolver functions map contexts to semantic public-realm profiles, qualitative parking form, and independent deterministic visual channels. The renderer resolves one B2 snapshot per frame, draws flat treatments before scene objects, and contributes dimensional B2 props to the same deterministic scene-command sort used by buildings and facilities.

**Tech Stack:** TypeScript 5.8.3, Node 22 test runner, Canvas 2D isometric renderer, Python deterministic SVG generation, Playwright 1.55.0 + Pillow 11.3.0 visual smoke, GitHub Actions.

**Approved spec:** `docs/superpowers/specs/2026-08-26-isometric-pass-b2-public-realm-design.md`

## Global constraints

- Work only on `feature/isometric-pass-b2-public-realm`; `main` remains untouched.
- B2 began from verified B1 head `ea294c07b1bf3d0f3b324c48499915f3883c4c6e` plus approved B2 design commits.
- Frozen Urban Fabric integration checkpoint: `941a9d5261898b00af103bfd9797065975a660f2`.
- The 13 parent commits between B1's frozen checkpoint `1c1479bdad0a7be6db16263128f5aee38dccdc44` and `941a9d5` touched none of B1's 21 changed files. Do not restack B1 during Tasks 1–7. Reconcile once in Task 8.
- Pass A stays exactly 161 entries and unchanged.
- Pass B1 stays exactly 138 additional entries; `PASS_B1_COMPOSED_ASSET_MANIFEST` stays exactly 299 entries across 9 atlases.
- B2 adds exactly 90 entries in one `public_realm` atlas; runtime becomes exactly 389 entries across 10 atlases.
- B2 never creates, persists, exposes, or feeds back parking capacity, occupancy, price, legality, availability, cruising penalty, generalized cost, curb regulation, parking revenue, pedestrian simulation, or public-space simulation.
- Service facilities are read-only presentation inputs. B2 cannot change their capacity, staffing, dispatch, vehicles, cost, funding, or coverage.
- No save-format change and no simulation RNG consumption.
- No per-frontage/per-decoration citywide scans. Fingerprinting may perform one O(N) read-only pass; expensive context construction happens only when the fingerprint changes.
- Resolve public-realm state once per rendered frame. Do not fingerprint separately for surfaces and vertical props.
- Build the B2 asset catalog once. Do not filter the full runtime manifest per descriptor.
- Camera rotation changes only rendered orientation, never semantic profile, parking form, or stable family selection.

## File map

### New production files

- `src/rendering/public-realm/PublicRealmTypes.ts`
- `src/rendering/public-realm/PublicRealmVisualResolver.ts`
- `src/rendering/public-realm/PublicRealmRevisionFingerprint.ts`
- `src/rendering/public-realm/PublicRealmContextIndex.ts`
- `src/rendering/public-realm/PublicRealmPresentationCache.ts`
- `src/rendering/public-realm/PublicRealmAssetResolver.ts`
- `src/rendering/assets/PassB2AssetManifest.ts`
- `src/rendering/passes/SceneSpriteCommand.ts`
- `src/rendering/passes/SceneSpriteCommandBuffer.ts`
- `src/rendering/passes/PublicRealmRenderPass.ts`
- `assets/source/public_realm.svg`
- `.github/workflows/isometric-b2.yml`
- `tests/smoke/isometric_b2_visual_smoke.py`
- `docs/art/PASS_B2_REPORT.md` in Task 8 only.

### New tests

- `tests/isometric-b2-resolver.test.ts`
- `tests/isometric-b2-context-index.test.ts`
- `tests/isometric-b2-manifest.test.ts`
- `tests/isometric-b2-asset-resolver.test.ts`
- `tests/isometric-b2-scene-order.test.ts`
- `tests/isometric-b2-runtime.test.ts`
- `tests/isometric-b2-performance.test.ts`

### Existing files modified

- `src/rendering/assets/RuntimeAssetManifest.ts`
- `src/rendering/passes/ObjectRenderPass.ts`
- `src/rendering/WorldRenderer.ts`
- `tools/isometric_art.py`
- `tests/isometric-b1-runtime.test.ts`
- `tests/smoke/isometric_b1_visual_smoke.py`
- `tests/presentation-contract.test.ts`

---

## Task 1 — Pure profile and parking resolver

**Files:** create `PublicRealmTypes.ts`, `PublicRealmVisualResolver.ts`, `tests/isometric-b2-resolver.test.ts`.

**Public API:**

```ts
export type PublicRealmProfile =
  | 'urban-core' | 'main-street' | 'residential-green'
  | 'suburban-auto-oriented' | 'industrial-logistics' | 'civic-public-space';
export type ParkingForm = 'none' | 'driveway' | 'surface-lot-edge' | 'garage-entry' | 'curbside-dressing';
export type WorldFacing = AssetOrientation; // 0=N, 1=E, 2=S, 3=W

export type PublicRealmBuildingContext = Readonly<{
  kind: 'building'; stableId: string; selectionKey: string; typologyId: string;
  stories: number; realizedFAR: number; coverageRatio: number; uses: readonly UseType[];
  roadType?: RoadType; hasAccessEdge: boolean; atIntersection: boolean;
  curbsideSuppressedByGeometry: boolean; worldFacing: WorldFacing;
  siteAnchor: Readonly<{x:number;y:number}>; frontageAnchor: Readonly<{x:number;y:number}>;
}>;

export type PublicRealmFacilityContext = Readonly<{
  kind: 'facility'; stableId: string; selectionKey: string; facilityType: ServiceFacilityType;
  roadType?: RoadType; worldFacing: WorldFacing;
  siteAnchor: Readonly<{x:number;y:number}>; frontageAnchor: Readonly<{x:number;y:number}>;
}>;

export type PublicRealmContext = PublicRealmBuildingContext | PublicRealmFacilityContext;
export type PublicRealmDescriptor = Readonly<{
  context: PublicRealmContext; profile: PublicRealmProfile; parkingForm: ParkingForm;
  channelKeys: Readonly<{surface:string;access:string;vegetation:string;furniture:string;parking:string;accent:string}>;
}>;

export function resolvePublicRealmProfile(context: PublicRealmContext): PublicRealmProfile | undefined;
export function resolveParkingForm(context: PublicRealmContext, profile: PublicRealmProfile): ParkingForm;
export function resolvePublicRealmDescriptor(context: PublicRealmContext): PublicRealmDescriptor | undefined;
export function rotateWorldFacing(facing: WorldFacing, quarterTurns: AssetOrientation): AssetOrientation;
```

- [ ] **1.1 Write RED resolver tests.** Import functions from `PublicRealmVisualResolver.ts` and types from `PublicRealmTypes.ts`. Table-test every approved boundary:
  - civic use → civic;
  - industrial/logistics use → industrial;
  - `main_street_mixed_use` and `typology:commercial_block` → main street;
  - `podium_mixed_use` and `typology:commercial_office` → urban core before generic retail;
  - retail + 2–7 stories + coverage `> 0.35` → main street;
  - story 8 or FAR `3.0` → urban core;
  - cottage/rowhouse or residential-only ≤4 stories → residential green;
  - compatible coverage `<= 0.35` or commercial shop → suburban auto-oriented;
  - unrecognized use → no profile.

Parking tests must cover garage/access requirement, exact `0.35` surface-lot boundary, driveway/access requirement, local/collector curbside eligibility, arterial suppression, intersection suppression, geometry suppression, and precedence.

Use this fixture shape:

```ts
const building = (overrides: Partial<PublicRealmBuildingContext> = {}): PublicRealmBuildingContext => ({
  kind: 'building', stableId: 'building:test', selectionKey: 'parcel:test|edge:test',
  typologyId: 'typology:residential_cottage', stories: 2, realizedFAR: .8, coverageRatio: .45,
  uses: ['residential'], roadType: 'local', hasAccessEdge: true, atIntersection: false,
  curbsideSuppressedByGeometry: false, worldFacing: 0,
  siteAnchor: {x:4,y:4}, frontageAnchor: {x:4,y:5}, ...overrides,
});
```

- [ ] **1.2 Verify RED.**

```bash
node --experimental-strip-types --test tests/isometric-b2-resolver.test.ts
```

Expected: `ERR_MODULE_NOT_FOUND` for the new resolver.

- [ ] **1.3 Implement exact profile precedence.** Use the approved order literally. Generic classification reads only `context.uses`; no lifecycle, demand, service quality, or parking state.

```ts
if (context.kind === 'facility') {
  return context.facilityType === 'landfill' || context.facilityType === 'recycling_center'
    ? 'industrial-logistics' : 'civic-public-space';
}
const uses = new Set(context.uses);
if (uses.has('civic')) return 'civic-public-space';
if (uses.has('light-industrial') || uses.has('heavy-industrial') || uses.has('logistics')) return 'industrial-logistics';
if (context.typologyId === 'main_street_mixed_use' || context.typologyId === 'typology:commercial_block') return 'main-street';
if (context.typologyId === 'podium_mixed_use' || context.typologyId === 'typology:commercial_office') return 'urban-core';
if (uses.has('retail') && context.stories >= 2 && context.stories <= 7 && context.coverageRatio > .35) return 'main-street';
if (context.stories >= 8 || context.realizedFAR >= 3) return 'urban-core';
```

Complete the remaining approved residential/suburban/fallback rules exactly as specified.

- [ ] **1.4 Implement parking form and channel keys.** Facilities always return `none`. Buildings use `garage > surface-lot > driveway > curbside > none`. Curbside requires local/collector, main-street/residential-green, no intersection, and `!curbsideSuppressedByGeometry`. Channel keys are `${selectionKey}|surface`, `|access`, `|vegetation`, `|furniture`, `|parking`, `|accent`.

- [ ] **1.5 Verify GREEN and commit.**

```bash
node --experimental-strip-types --test tests/isometric-b2-resolver.test.ts
npm run typecheck
git add src/rendering/public-realm/PublicRealmTypes.ts src/rendering/public-realm/PublicRealmVisualResolver.ts tests/isometric-b2-resolver.test.ts
git commit -m "feat: add B2 public realm resolver"
```

---

## Task 2 — Authoritative context index, orientation, and cache

**Files:** create `PublicRealmRevisionFingerprint.ts`, `PublicRealmContextIndex.ts`, `PublicRealmPresentationCache.ts`, `tests/isometric-b2-context-index.test.ts`, `tests/isometric-b2-performance.test.ts`.

**Public API:**

```ts
export function publicRealmRevisionFingerprint(core: SimulationCore): string;
export function buildPublicRealmContextIndex(core: SimulationCore): readonly PublicRealmContext[];
export type PublicRealmPresentationSnapshot = Readonly<{
  fingerprint: string;
  contexts: readonly PublicRealmContext[];
  descriptors: readonly PublicRealmDescriptor[];
}>;
export class PublicRealmPresentationCache {
  resolve(core: SimulationCore): PublicRealmPresentationSnapshot;
}
```

- [ ] **2.1 Write RED context/cache tests.** Use real `SimulationCore`, real roads, zoning, and `placeServiceFacility()`. Verify a fire station next to a collector yields a facility context with `roadType === 'collector'`. Verify road/facility changes alter the fingerprint, while `setServiceFunding()` does not. Inject a counting index builder into the cache and require two unchanged resolves to return the same snapshot object with one build.

- [ ] **2.2 Add the performance RED guard.** In `tests/isometric-b2-performance.test.ts`, call `cache.resolve(core)` 100 times without changes and require one context build. Read `PublicRealmContextIndex.ts` and reject `.getV2At(`.

```bash
node --experimental-strip-types --test tests/isometric-b2-context-index.test.ts tests/isometric-b2-performance.test.ts
```

Expected: missing new modules.

- [ ] **2.3 Implement the O(N) fingerprint.** Hash sorted read-only representations of:
  - `core.roads.revision` + road cells/types;
  - parcels: ID, zoning district, frontage/access edge IDs;
  - edges: ID, kind, `roadRef`;
  - canonical buildings: ID, sorted parcel IDs, typology, stories, FAR, coverage, sorted floor-use values;
  - service facilities: ID, type, x/y.

Use `stableHash32(parts.join('|')).toString(16).padStart(8, '0')`. Do not include entitlement uses, treasury, funding, traffic, lifecycle condition, demand, or future parking data.

- [ ] **2.4 Build one-pass indexes.** Prebuild road, edge, parcel, and service maps. For canonical buildings, derive generic `uses` only from `BuildingV2.floors[].uses`; do not fall back to entitlement. Typology-specific rules may still classify empty-floor compatibility fixtures.

For each sorted street-frontage edge with `roadRef`, parse road x/y; use parcel centroid in legacy-cell coordinates as `siteAnchor`, road cell as `frontageAnchor`, `${parcel.id}|${edge.id}` as `selectionKey`, and derive world facing from road cell toward parcel centroid:

```ts
const dx = parcelCenter.x - roadX;
const dy = parcelCenter.y - roadY;
const worldFacing = Math.abs(dx) > Math.abs(dy)
  ? (dx >= 0 ? 1 : 3)
  : (dy >= 0 ? 2 : 0);
```

Set `hasAccessEdge = parcel.accessEdgeIds.includes(edge.id)`. Use `roadConnectivityMask()` and set `atIntersection` when at least three connectivity bits are present. Set `curbsideSuppressedByGeometry = hasAccessEdge`. This intentionally makes curbside uncommon in the current compatibility cadastre; do not weaken authority just to expose the asset.

For service facilities, choose the lexicographically stable adjacent cardinal road. A restored facility with no adjacent road still emits a facility context with `roadType` undefined and both anchors on the facility cell; never synthesize a road.

- [ ] **2.5 Implement cache.** Fingerprint once per resolve. Rebuild contexts/descriptors only when fingerprint changes; otherwise return the exact frozen snapshot object.

```ts
resolve(core: SimulationCore): PublicRealmPresentationSnapshot {
  const fingerprint = publicRealmRevisionFingerprint(core);
  if (this.snapshot && fingerprint === this.fingerprint) return this.snapshot;
  const contexts = Object.freeze([...this.buildIndex(core)]);
  const descriptors = Object.freeze(contexts.flatMap((context) => {
    const descriptor = resolvePublicRealmDescriptor(context);
    return descriptor ? [descriptor] : [];
  }));
  this.fingerprint = fingerprint;
  return this.snapshot = Object.freeze({fingerprint, contexts, descriptors});
}
```

- [ ] **2.6 Verify and commit.**

```bash
node --experimental-strip-types --test tests/isometric-b2-resolver.test.ts tests/isometric-b2-context-index.test.ts tests/isometric-b2-performance.test.ts
npm run typecheck
git add src/rendering/public-realm/PublicRealmRevisionFingerprint.ts src/rendering/public-realm/PublicRealmContextIndex.ts src/rendering/public-realm/PublicRealmPresentationCache.ts tests/isometric-b2-context-index.test.ts tests/isometric-b2-performance.test.ts
git commit -m "feat: index B2 public realm context"
```

---

## Task 3 — Exact 90-entry manifest and pre-indexed asset selection

**Files:** create `PassB2AssetManifest.ts`, `PublicRealmAssetResolver.ts`, `tests/isometric-b2-manifest.test.ts`, `tests/isometric-b2-asset-resolver.test.ts`; modify `RuntimeAssetManifest.ts`, `tests/isometric-b1-runtime.test.ts`.

**Public API:**

```ts
export const PASS_B2_ASSET_MANIFEST: AssetManifest;
export const PASS_B2_COMPOSED_ASSET_MANIFEST: AssetManifest;
export type PublicRealmAssetCatalog = Readonly<{
  byVariantKey: ReadonlyMap<string, readonly AssetManifestEntry[]>;
  bySubcategory: ReadonlyMap<string, readonly string[]>;
}>;
export function buildPublicRealmAssetCatalog(entries: readonly AssetManifestEntry[]): PublicRealmAssetCatalog;
export function resolvePublicRealmVisual(
  descriptor: PublicRealmDescriptor,
  cameraTurns: AssetOrientation,
  catalog: PublicRealmAssetCatalog,
): Readonly<{surface: readonly AssetManifestEntry[]; vertical: readonly AssetManifestEntry[]}>;
```

- [ ] **3.1 Write RED cardinality/orientation tests.** Assert A=161, B1 delta=138, B1 composed=299/9, B2 delta=90/1, B2 composed=389/10, unique IDs, all source rects within `2048×1152`, symmetric families exactly one orientation-0 frame with `symmetric`, directional families exactly `[0,1,2,3]`.

- [ ] **3.2 Write RED asset-catalog tests.** Prove `buildPublicRealmAssetCatalog()` filters B2 entries once, camera rotation changes only directional orientation, and inserting an unrelated family cannot change another channel's stable selection.

```bash
node --experimental-strip-types --test tests/isometric-b2-manifest.test.ts tests/isometric-b2-asset-resolver.test.ts
```

Expected: missing modules.

- [ ] **3.3 Implement exact frame inventory.** Frames are 128×192, 16 columns, 6 rows. Declaration order:

**Surfaces, 6 symmetric:**
`realm_sidewalk_concrete_01`, `realm_sidewalk_paver_01`, `realm_plaza_stone_01`, `realm_plaza_concrete_01`, `realm_permeable_pavers_01`, `realm_grass_verge_01`.

**Access, 6 families ×4 = 24:**
`realm_curb_standard_01`, `realm_curb_ramp_01`, `realm_driveway_cut_01`, `realm_service_apron_01`, `realm_loading_apron_01`, `realm_parking_lot_entrance_01`.

**Furniture, 10:** `realm_bench_01` ×4 orientations; symmetric `realm_ped_lamp_01`, `realm_road_lamp_01`, `realm_bollards_01`, `realm_planter_01`, `realm_bin_01`, `realm_hydrant_01`.

**Vegetation, 17 symmetric:** tree pit ×2, young tree ×3, mature tree ×4, ornamental tree ×3, hedge ×2, median planting ×3, named `realm_tree_pit_01` through their corresponding numbered families.

**Parking, 5 families ×4 = 20:** `realm_parking_surface_01`, `realm_parking_landscaped_edge_01`, `realm_garage_structured_entry_01`, `realm_garage_podium_entry_01`, `realm_curbside_cars_01`.

**Public space, 13 symmetric:** pocket plaza ×2, civic forecourt ×2, commercial forecourt ×2, small square ×2, cafe/market ×3, fountain/plinth ×2.

Every entry uses category `public-realm`; subcategory is `surface`, `access`, `furniture`, `vegetation`, `parking`, or `public-space`; every entry has `north-american` and `pass-b2`; symmetric entries have orientation 0 and `symmetric`.

Compose exactly:

```ts
export const PASS_B2_COMPOSED_ASSET_MANIFEST = composeAssetManifests(
  PASS_B1_COMPOSED_ASSET_MANIFEST,
  PASS_B2_ASSET_MANIFEST,
);
```

- [ ] **3.4 Implement one-time catalog.** `buildPublicRealmAssetCatalog()` is the only place that filters `category === 'public-realm'`. `resolvePublicRealmVisual()` works from catalog maps only. Stable family selection uses `selectWeightedVariantKey(channelKey, candidates)`. Directional resolution uses `rotateWorldFacing(baseFacing, cameraTurns)` plus `resolveVariantEntry()`.

Surface candidates:

```text
urban-core: sidewalk_paver | plaza_concrete
main-street: sidewalk_concrete | sidewalk_paver
residential-green: sidewalk_concrete | grass_verge
suburban-auto-oriented: permeable_pavers | grass_verge
industrial-logistics: plaza_concrete | sidewalk_concrete
civic-public-space: plaza_stone | plaza_concrete
```

Parking mapping is fixed: driveway→driveway cut; surface-lot-edge→parking surface + landscaped edge; garage-entry→podium garage only for `podium_mixed_use`, otherwise structured garage; curbside→curbside cars; none→empty. Service facilities always select no parking.

- [ ] **3.5 Switch runtime manifest and preserve B1 sub-contract.** `RUNTIME_ASSET_MANIFEST = PASS_B2_COMPOSED_ASSET_MANIFEST`. Update B1 runtime test to assert B1 composed remains 299/9 while global runtime is 389/10. Keep all existing B1 building-family/condition assertions.

- [ ] **3.6 Verify and commit.**

```bash
node --experimental-strip-types --test tests/isometric-assets.test.ts tests/isometric-b1-manifest.test.ts tests/isometric-b1-runtime.test.ts tests/isometric-b2-manifest.test.ts tests/isometric-b2-asset-resolver.test.ts
npm run typecheck
git add src/rendering/assets/PassB2AssetManifest.ts src/rendering/public-realm/PublicRealmAssetResolver.ts src/rendering/assets/RuntimeAssetManifest.ts tests/isometric-b1-runtime.test.ts tests/isometric-b2-manifest.test.ts tests/isometric-b2-asset-resolver.test.ts
git commit -m "feat: add B2 public realm manifest"
```

---

## Task 4 — Deterministic public-realm atlas pipeline

**Files:** modify `tools/isometric_art.py`; create generated `assets/source/public_realm.svg`; extend `tests/isometric-b2-manifest.test.ts`.

- [ ] **4.1 Add RED source-contract assertions.** Require `public_realm.svg` root `2048×1152`; require `tools/isometric_art.py` to contain a DIMS entry and builder mapping.

```bash
node --experimental-strip-types --test tests/isometric-b2-manifest.test.ts
```

Expected: missing source/builder failure.

- [ ] **4.2 Add exact dimension/builder seam.** Append to existing `DIMS`:

```py
'public_realm': (2048, 1152),
```

Add:

```py
B2_FRAME_W = 128
B2_FRAME_H = 192
B2_COLUMNS = 16

def _b2_origin(slot: int) -> tuple[int, int]:
    return (slot % B2_COLUMNS) * B2_FRAME_W, (slot // B2_COLUMNS) * B2_FRAME_H
```

Implement `public_realm()` in the exact Task 3 frame order; every drawing stays inside its 128×192 slot. Directional families must visibly differ by orientation. Symmetric frames are authored once. Use generic fictional North American markings/materials only.

End:

```py
if slot != 90:
    raise AssertionError(f'public realm sheet expected 90 frames, got {slot}')
return _root('public_realm', body)
```

Add `'public_realm': public_realm` to the existing builder dictionary.

- [ ] **4.3 Generate and prove byte stability.**

```bash
python - <<'PY'
from pathlib import Path
from tools.isometric_art import build_svg_sheet
p = Path('assets/source/public_realm.svg')
p.write_text(build_svg_sheet('public_realm'), encoding='utf-8')
PY
cp assets/source/public_realm.svg /tmp/public_realm.svg
python - <<'PY'
from pathlib import Path
from tools.isometric_art import build_svg_sheet
Path('assets/source/public_realm.svg').write_text(build_svg_sheet('public_realm'), encoding='utf-8')
PY
cmp /tmp/public_realm.svg assets/source/public_realm.svg
```

Expected: `cmp` exit 0.

- [ ] **4.4 Validate/rasterize ten atlases.**

```bash
npm run assets:check
python tools/render_isometric_atlases.py
test -s dist/assets/atlases/public_realm.png
```

- [ ] **4.5 Verify and commit.**

```bash
node --experimental-strip-types --test tests/isometric-b2-manifest.test.ts
npm run lint
git add tools/isometric_art.py assets/source/public_realm.svg tests/isometric-b2-manifest.test.ts
git commit -m "feat: generate B2 public realm atlas"
```

Do not commit `dist/` build output under current repository policy.

---

## Task 5 — Shared scene sprite command buffer

**Files:** create `SceneSpriteCommand.ts`, `SceneSpriteCommandBuffer.ts`; modify `ObjectRenderPass.ts`; create `tests/isometric-b2-scene-order.test.ts`.

**Public API:**

```ts
export type SceneSpriteCommand = Readonly<{
  depth: DepthKey; entry?: AssetManifestEntry; assetId: string;
  x: number; y: number; label: string; footprintWidth?: number; footprintHeight?: number;
}>;
export function sortSceneSpriteCommands(commands: readonly SceneSpriteCommand[]): readonly SceneSpriteCommand[];
export class SceneSpriteCommandBuffer { draw(...): void; }
```

- [ ] **5.1 Write RED order tests.** Use building and tree commands both on `objects` layer to prove a front tree sorts after a building and a rear tree sorts before it. Reverse contributor input order and require identical sorted stable IDs. Add a `low-props` bench/bollard fixture proving intentionally always-behind props remain below objects.

```ts
const commands = [
  {depth: makeDepthKey('objects',4,4,0,'building:b'), assetId:'b', x:4,y:4,label:'B'},
  {depth: makeDepthKey('objects',4,5,0,'tree:a'), assetId:'t', x:4,y:5,label:'T'},
];
assert.deepEqual(
  sortSceneSpriteCommands(commands).map((c) => c.depth.stableId),
  sortSceneSpriteCommands([...commands].reverse()).map((c) => c.depth.stableId),
);
```

Add a source guard requiring `ObjectRenderPass.collect(` and rejecting its old internal final paint loop.

- [ ] **5.2 Verify RED.**

```bash
node --experimental-strip-types --test tests/isometric-b2-scene-order.test.ts
```

- [ ] **5.3 Implement shared contract/buffer.** `sortSceneSpriteCommands()` clones and sorts with existing `compareDepthKeys()`. `SceneSpriteCommandBuffer.draw()` sorts once, computes tile center, applies existing projected-sprite culling, and paints through one `SpritePainter`.

- [ ] **5.4 Refactor ObjectRenderPass to collect only.** Preserve all existing building/construction/service/utility/forest-tree selection. Return unsorted `SceneSpriteCommand[]` from `collect(core, camera)`. Remove its painter/sort/final draw ownership. Continue building `CanonicalBuildingVisualIndex` once; never call `getV2At()` per building.

- [ ] **5.5 Verify and commit.**

```bash
node --experimental-strip-types --test tests/isometric-b1-canonical-index.test.ts tests/isometric-b2-scene-order.test.ts
npm run typecheck
npm run lint
git add src/rendering/passes/SceneSpriteCommand.ts src/rendering/passes/SceneSpriteCommandBuffer.ts src/rendering/passes/ObjectRenderPass.ts tests/isometric-b2-scene-order.test.ts
git commit -m "refactor: share isometric scene command buffer"
```

---

## Task 6 — Runtime public-realm pass, authority firewall, and performance gate

**Files:** create `PublicRealmRenderPass.ts`; modify `WorldRenderer.ts`, `tests/presentation-contract.test.ts`, `tests/isometric-b2-performance.test.ts`; create `tests/isometric-b2-runtime.test.ts`.

**Public API:**

```ts
export type PublicRealmFrame = Readonly<{
  presentation: PublicRealmPresentationSnapshot;
  visuals: readonly PublicRealmResolvedVisual[];
}>;
export class PublicRealmRenderPass {
  resolveFrame(core: SimulationCore, camera: IsometricCamera): PublicRealmFrame;
  drawSurfaces(ctx: CanvasRenderingContext2D, frame: PublicRealmFrame, camera: IsometricCamera, viewport: Viewport, worldSize: WorldSize): void;
  collectVertical(frame: PublicRealmFrame, camera: IsometricCamera): readonly SceneSpriteCommand[];
}
```

- [ ] **6.1 Write RED non-mutation/runtime tests.** Build real roads/zoning, at least one canonical building with populated floor uses, and a real fire station. Capture roads, cadastre, canonical buildings, services, treasury, traffic snapshot, utility snapshot, and save-facing state before and after B2 resolution and require deep equality. Require a runtime `civic-public-space` facility descriptor.

Read all B2 rendering sources and reject these tokens/calls: `parkingCapacity`, `occupancy`, `parkingPrice`, `cruisingPenalty`, `Math.random`, simulation `.random`, `.getV2At(`.

- [ ] **6.2 Verify RED.**

```bash
node --experimental-strip-types --test tests/isometric-b2-runtime.test.ts tests/isometric-b2-performance.test.ts tests/presentation-contract.test.ts
```

- [ ] **6.3 Implement one-time catalog and one-frame snapshot.** In `PublicRealmRenderPass` constructor build `PublicRealmAssetCatalog` from `assets.query({category:'public-realm'})` exactly once. `resolveFrame()` calls `cache.resolve(core)` exactly once and maps descriptors through `resolvePublicRealmVisual()`.

`drawSurfaces()` receives the already-resolved frame and never fingerprints again. Use `frontageAnchor` for sidewalk/curb/access/curbside treatments and `siteAnchor` for plazas/surface-lot site treatments.

`collectVertical()` receives the same frame. Trees, pedestrian/road lamps, parked-car dressing, garage entries, and fountain/sculpture accents use `makeDepthKey('objects', ...)` so iso-depth can place them before or after buildings. Benches, bollards, bins, low hedge, and low planters may use `low-props` because they are intentionally always behind object-layer sprites. All commands enter one buffer. Stable command IDs are `${selectionKey}|${assetId}`.

- [ ] **6.4 Wire WorldRenderer exactly once per frame.**

```ts
this.ground.draw(this.ctx, core, this.camera, viewport);
const realmFrame = this.publicRealm.resolveFrame(core, this.camera);
this.publicRealm.drawSurfaces(this.ctx, realmFrame, this.camera, viewport, worldSize);
const sceneCommands = [
  ...this.objects.collect(core, this.camera),
  ...this.publicRealm.collectVertical(realmFrame, this.camera),
];
this.scene.draw(this.ctx, sceneCommands, this.camera, viewport, worldSize);
```

Then preserve current vehicle renderers, overlays, selection, meter-space helpers, Urban Fabric overlay API, selected-parcel behavior, camera controls, and asset diagnostics.

- [ ] **6.5 Enforce O(N) mechanism.** 100 unchanged `cache.resolve(core)` calls → one context build; mutate one road → exactly one additional build. Source guards must reject full-manifest filtering in `resolvePublicRealmVisual()` and direct citywide list scans inside `PublicRealmRenderPass.ts`; those belong only in fingerprint/index construction.

- [ ] **6.6 Verify and commit.**

```bash
node --experimental-strip-types --test tests/presentation-contract.test.ts tests/isometric-b1-canonical-index.test.ts tests/isometric-b1-runtime.test.ts tests/isometric-b2-*.test.ts
npm run typecheck
npm run lint
npm run assets:check
git add src/rendering/passes/PublicRealmRenderPass.ts src/rendering/WorldRenderer.ts tests/presentation-contract.test.ts tests/isometric-b2-runtime.test.ts tests/isometric-b2-performance.test.ts
git commit -m "feat: render deterministic B2 public realm"
```

---

## Task 7 — Six-profile visual smoke and B2 CI

**Files:** create `tests/smoke/isometric_b2_visual_smoke.py`, `.github/workflows/isometric-b2.yml`; modify `tests/smoke/isometric_b1_visual_smoke.py`.

- [ ] **7.1 Build six runtime-reachable visual fixtures.** Use real roads/zoning/cadastre. Populate canonical `floors[].uses`. Required contexts:
  - urban-core: `podium_mixed_use`;
  - main-street: `main_street_mixed_use`;
  - residential-green: cottage/rowhouse;
  - suburban-auto-oriented: low-coverage commercial shop;
  - industrial-logistics: logistics/heavy-industrial building or landfill;
  - civic-public-space: real fire/police/clinic/school facility.

Evidence must assert runtime 389/10, B2 90, all six sorted profile names, and no asset diagnostics. Capture eight images: six profile-specific orientation-0 scenes plus `mixed_profiles_o1.png` and `mixed_profiles_o2.png`. Profile/parking semantics must be unchanged by camera rotation while directional entry orientations rotate correctly.

- [ ] **7.2 Update inherited B1 smoke semantics only.** Import `PASS_B1_COMPOSED_ASSET_MANIFEST`; assert B1 remains 299/9 and global runtime is 389/10. Keep all B1 condition/family assertions and screenshots unchanged.

- [ ] **7.3 Run local visual gates.**

```bash
npm run build
npm run test:smoke:isometric
python tests/smoke/isometric_b1_visual_smoke.py
python tests/smoke/isometric_b2_visual_smoke.py
```

- [ ] **7.4 Add B2 workflow.** Trigger pushes to B2 branch and PRs targeting B1. Node 22, TypeScript 5.8.3. Targeted job commands:

```bash
npm install --ignore-scripts --no-audit --no-fund
npm install --global typescript@5.8.3
node --experimental-strip-types --test tests/isometric-assets.test.ts tests/isometric-b1-*.test.ts tests/isometric-b2-*.test.ts tests/presentation-contract.test.ts
npm run typecheck
npm run lint
npm run assets:check
python -m pip install playwright==1.55.0 Pillow==11.3.0
python -m playwright install --with-deps chromium
npm run build
npm run test:smoke:isometric
python tests/smoke/isometric_b1_visual_smoke.py
python tests/smoke/isometric_b2_visual_smoke.py
```

Add B1 diagnostic-delta logic equivalent to the established B1 parent-delta gate: green B1 cannot become red; a red B1 diagnostic set cannot change; B2 may clear inherited diagnostics.

Add `b2-full` job:

```bash
npm test
npm run typecheck
npm run lint
npm run assets:check
npm run build
npm run test:smoke
npm run test:smoke:phase7
python tests/smoke/urban_fabric_smoke.py
npm run test:smoke:isometric
python tests/smoke/isometric_b1_visual_smoke.py
python tests/smoke/isometric_b2_visual_smoke.py
```

The pinned parent contains `urban_fabric_smoke.py`; after Task 8 reconciliation, absence is a failure, never a skip.

- [ ] **7.5 Run branch-available workflow-equivalent checks and commit.**

```bash
npm test
npm run typecheck
npm run lint
npm run assets:check
npm run build
npm run test:smoke
npm run test:smoke:phase7
npm run test:smoke:isometric
python tests/smoke/isometric_b1_visual_smoke.py
python tests/smoke/isometric_b2_visual_smoke.py
git add tests/smoke/isometric_b2_visual_smoke.py tests/smoke/isometric_b1_visual_smoke.py .github/workflows/isometric-b2.yml
git commit -m "test: gate isometric Pass B2"
```

---

## Task 8 — Frozen-parent reconciliation, exact-head evidence, report, and draft PR

**Files:** conflict-resolved B1/B2 integration files only if required; create `docs/art/PASS_B2_REPORT.md`; mark this plan complete after evidence exists.

- [ ] **8.1 Reconfirm parent/B1 non-overlap.**

```bash
git fetch origin feature/urban-fabric-2.0 feature/isometric-pass-b1-urban-depth feature/isometric-pass-b2-public-realm
git diff --name-only 1c1479bdad0a7be6db16263128f5aee38dccdc44..941a9d5261898b00af103bfd9797065975a660f2 | sort > /tmp/parent-late-files.txt
git diff --name-only 1c1479bdad0a7be6db16263128f5aee38dccdc44..ea294c07b1bf3d0f3b324c48499915f3883c4c6e | sort > /tmp/b1-files.txt
comm -12 /tmp/parent-late-files.txt /tmp/b1-files.txt
```

Expected: no output. Any overlap means stop and treat as a compatibility defect rather than forcing integration.

- [ ] **8.2 Refresh B1 in the execution skill's isolated B1 worktree, preserving history.**

```bash
git checkout feature/isometric-pass-b1-urban-depth
git merge --no-ff 941a9d5261898b00af103bfd9797065975a660f2 -m "Merge Urban Fabric checkpoint for B2 integration"
npm install --ignore-scripts --no-audit --no-fund
node --experimental-strip-types --test tests/isometric-assets.test.ts tests/isometric-b1-*.test.ts
npm run typecheck
npm run lint
npm run assets:check
npm run build
npm run test:smoke
npm run test:smoke:phase7
python tests/smoke/urban_fabric_smoke.py
npm run test:smoke:isometric
python tests/smoke/isometric_b1_visual_smoke.py
git push origin feature/isometric-pass-b1-urban-depth
```

Every command must pass before push.

- [ ] **8.3 Merge refreshed B1 ancestry into B2 without rewriting B2.**

```bash
git fetch origin feature/isometric-pass-b1-urban-depth
B2_ROOT="$(git rev-parse --show-toplevel)"
cd "$B2_ROOT"
git checkout feature/isometric-pass-b2-public-realm
git merge --no-ff origin/feature/isometric-pass-b1-urban-depth -m "Merge refreshed B1 baseline for B2 integration"
```

Resolve only genuine B2 rendering/test/docs overlap. Preserve parent Save V9, UI, Urban Fabric, property-market, service, traffic, and simulation authority. Never weaken tests to resolve a conflict.

- [ ] **8.4 Run exact implementation-head suite.**

```bash
npm test
npm run typecheck
npm run lint
npm run assets:check
npm run build
npm run test:smoke
npm run test:smoke:phase7
python tests/smoke/urban_fabric_smoke.py
npm run test:smoke:isometric
python tests/smoke/isometric_b1_visual_smoke.py
python tests/smoke/isometric_b2_visual_smoke.py
```

- [ ] **8.5 Verify B2 delta scope.**

```bash
git fetch origin feature/isometric-pass-b1-urban-depth
git diff --name-only origin/feature/isometric-pass-b1-urban-depth..HEAD | sort
```

Allowed: B2 art/rendering/tests/workflow/spec/plan/report and the inherited B1 regression-test semantic updates described above. Forbidden: save serialization, `SimulationCore`, service simulation, traffic economics, treasury, zoning legality, property-market authority, or a parking simulation owner.

- [ ] **8.6 Push implementation head and require exact-head CI.**

```bash
git push origin feature/isometric-pass-b2-public-realm
VERIFIED_B2_IMPLEMENTATION_SHA="$(git rev-parse HEAD)"
printf '%s\n' "$VERIFIED_B2_IMPLEMENTATION_SHA" > /tmp/b2-verified-implementation-sha.txt
```

Require both B2 targeted and B2 full jobs to succeed on that exact SHA. Record the two numeric GitHub Actions run IDs.

- [ ] **8.7 Write acceptance report from captured evidence.**

```bash
REFRESHED_B1_SHA="$(git rev-parse origin/feature/isometric-pass-b1-urban-depth)"
VERIFIED_B2_IMPLEMENTATION_SHA="$(cat /tmp/b2-verified-implementation-sha.txt)"
```

`docs/art/PASS_B2_REPORT.md` must contain literal evidence values for:
- frozen Urban Fabric checkpoint `941a9d5261898b00af103bfd9797065975a660f2`;
- refreshed B1 SHA;
- verified B2 implementation SHA;
- Pass A 161, B1 delta 138, B2 delta 90, runtime 389, 10 atlases;
- `public_realm` atlas `2048×1152`;
- exact targeted/full run IDs and success;
- eight B2 scenes plus inherited Pass A/B1 visual smoke success;
- deferred Transportation 3R.6 parking authority.

The report records the verified implementation head rather than its own future documentation commit, because embedding a document's own commit SHA is self-referential. The draft PR body records the final branch/documentation SHA and its CI separately.

- [ ] **8.8 Mark plan complete, commit docs, and verify final documentation head.** Add immediately below the title:

```markdown
> **Execution status: COMPLETE against frozen Urban Fabric checkpoint `941a9d5261898b00af103bfd9797065975a660f2`.** Final acceptance evidence is recorded in `docs/art/PASS_B2_REPORT.md`.
```

Then:

```bash
git add docs/art/PASS_B2_REPORT.md docs/superpowers/plans/2026-08-26-isometric-pass-b2-public-realm.md
git commit -m "docs: record Pass B2 acceptance"
git push origin feature/isometric-pass-b2-public-realm
FINAL_B2_BRANCH_SHA="$(git rev-parse HEAD)"
printf '%s\n' "$FINAL_B2_BRANCH_SHA" > /tmp/b2-final-branch-sha.txt
```

Require targeted and full B2 CI to succeed on `FINAL_B2_BRANCH_SHA`. Do not rewrite the report to embed this documentation commit; record this SHA and its run IDs in the PR body.

- [ ] **8.9 Create a draft child PR only after final CI is green.**

```text
head: feature/isometric-pass-b2-public-realm
base: feature/isometric-pass-b1-urban-depth
title: Isometric Pass B2 — Parking & Public Realm
```

PR body must contain the literal final branch SHA, the two successful run IDs for that SHA, 90-entry B2 delta, 389 runtime total, all six profiles, parking firewall, shared scene buffer, frozen parent checkpoint, and explicit draft/unmerged status. Do not merge or mark ready without user authorization.

## Plan self-review gate

Before implementation starts, run:

```bash
PLAN=docs/superpowers/plans/2026-08-26-isometric-pass-b2-public-realm.md
SPEC=docs/superpowers/specs/2026-08-26-isometric-pass-b2-public-realm-design.md
! grep -En 'TBD|TODO|implement later|Similar to Task|existing entries\.\.\.' "$PLAN"
! grep -En '<[A-Za-z][A-Za-z0-9 _-]*>' "$PLAN"
grep -q '90 entries' "$PLAN"
grep -q '389 entries' "$PLAN"
grep -q 'Transportation 3R.6' "$PLAN"
grep -q 'civic-public-space' "$PLAN"
grep -q 'PublicRealmPresentationCache' "$PLAN"
grep -q 'SceneSpriteCommandBuffer' "$PLAN"
test -s "$SPEC"
```

Coverage mapping:
- authority boundary + parking firewall → Tasks 1, 2, 6, 8;
- six profiles + exact precedence → Tasks 1, 7;
- deterministic independent channels → Tasks 1, 3;
- approved 70–90 asset budget concretized to 90 + one atlas → Tasks 3, 4;
- context index/cache + no O(N²) path → Tasks 2, 6;
- surface-before-object + shared depth ordering → Tasks 5, 6;
- Pass A/B1 compatibility → Tasks 3, 5, 7, 8;
- visual smoke + CI → Tasks 7, 8;
- final report + draft/unmerged integration → Task 8.

Type handoffs:
- Task 1 owns all semantic types in `PublicRealmTypes.ts`.
- Task 2 produces `PublicRealmPresentationSnapshot`.
- Task 3 produces `PublicRealmAssetCatalog` and resolved visual selections.
- Task 5 produces `SceneSpriteCommand`.
- Task 6 combines Tasks 2/3/5, resolving exactly one B2 frame snapshot per rendered frame.
- Tall B2 props use `objects` when cross-building occlusion is required; intentionally always-behind small props use `low-props`.
