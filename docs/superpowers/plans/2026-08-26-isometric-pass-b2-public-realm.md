# Isometric Pass B2 — Parking & Public Realm Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a deterministic, presentation-only parking/public-realm layer with six context-derived streetscape profiles, 90 authored B2 asset entries, correct shared depth ordering, and no new simulation or parking authority.

**Architecture:** B2 reads existing canonical roads, cadastre, BuildingV2, service facilities, zoning/terrain compatibility, and stable IDs. A read-only revision fingerprint gates an indexed context snapshot; pure resolver functions map each context to a semantic public-realm profile, qualitative parking form, and independent deterministic visual channels. Flat public-realm sprites render before scene objects, while vertical B2 props join existing building/facility sprites in one deterministic scene command buffer.

**Tech Stack:** TypeScript 5.8.3, Node 22 test runner (`node --experimental-strip-types --test`), Canvas 2D isometric renderer, deterministic SVG generation in Python, Playwright + Pillow visual smoke, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-08-26-isometric-pass-b2-public-realm-design.md`

## Global Constraints

- Work only on `feature/isometric-pass-b2-public-realm`; `main` remains untouched.
- B2 begins from verified B1 head `ea294c07b1bf3d0f3b324c48499915f3883c4c6e` plus the approved B2 design commits.
- Frozen Urban Fabric integration checkpoint for this plan: `941a9d5261898b00af103bfd9797065975a660f2`.
- The parent moved 13 commits from B1's old checkpoint `1c1479bdad0a7be6db16263128f5aee38dccdc44` to `941a9d5`; those commits touch none of B1's 21 changed files. Do **not** restack B1 before B2 production work. Perform one controlled integration-freshness reconciliation in Task 8.
- Pass A remains exactly 161 entries and unchanged.
- Pass B1 remains exactly 138 additional entries and its own composed manifest remains exactly 299 entries across 9 atlases.
- B2 implements exactly 90 manifest entries in one `public_realm` atlas, yielding 389 runtime entries across 10 atlases.
- The 90-entry count is the concrete implementation inventory for this plan; correctness still depends on semantic family/orientation coverage, not padding.
- B2 must not create, persist, expose, or feed back parking capacity, occupancy, price, legality, availability, cruising penalty, generalized cost, curb regulation, parking revenue, pedestrian simulation, or public-space simulation.
- Existing service facilities are authoritative inputs only. B2 must not change service capacity, staffing, dispatch, vehicles, cost, funding, or coverage.
- No save-format change.
- Presentation code must not advance or consume simulation RNG.
- No per-frontage/per-decoration citywide scans. Fingerprinting may make one O(N) read-only pass; expensive context/index construction occurs only when that fingerprint changes.
- Camera rotation changes rendered orientation only; it may not change semantic profile, parking form, or stable visual-family choice.
- Use TDD on every production task: RED test → confirm failure → minimal GREEN implementation → focused tests → commit.

## File Structure

### New production files

- `src/rendering/public-realm/PublicRealmTypes.ts` — semantic profiles, context shapes, placement/orientation, descriptors.
- `src/rendering/public-realm/PublicRealmVisualResolver.ts` — pure profile and parking-form rules from the approved spec.
- `src/rendering/public-realm/PublicRealmRevisionFingerprint.ts` — stable O(N) read-only fingerprint of relevant authoritative presentation inputs.
- `src/rendering/public-realm/PublicRealmContextIndex.ts` — one-pass road/parcel/edge/building/facility indexes and frontage/facility contexts.
- `src/rendering/public-realm/PublicRealmPresentationCache.ts` — fingerprint-gated context/descriptor cache.
- `src/rendering/public-realm/PublicRealmAssetResolver.ts` — independent deterministic visual-channel family selection.
- `src/rendering/assets/PassB2AssetManifest.ts` — B2 atlas descriptor and exact 90-entry inventory.
- `src/rendering/passes/SceneSpriteCommand.ts` — shared scene sprite command contract.
- `src/rendering/passes/SceneSpriteCommandBuffer.ts` — deterministic sort/cull/paint for buildings, facilities, construction, and vertical B2 props.
- `src/rendering/passes/PublicRealmRenderPass.ts` — draws B2 surfaces and collects B2 vertical scene commands.
- `assets/source/public_realm.svg` — deterministic generated source contract produced from `tools/isometric_art.py`.
- `.github/workflows/isometric-b2.yml` — B2 targeted + full compatibility CI.
- `tests/smoke/isometric_b2_visual_smoke.py` — six-profile multi-rotation browser smoke.
- `docs/art/PASS_B2_REPORT.md` — final exact-head acceptance evidence, created only in Task 8.

### New tests

- `tests/isometric-b2-resolver.test.ts`
- `tests/isometric-b2-context-index.test.ts`
- `tests/isometric-b2-manifest.test.ts`
- `tests/isometric-b2-asset-resolver.test.ts`
- `tests/isometric-b2-scene-order.test.ts`
- `tests/isometric-b2-runtime.test.ts`
- `tests/isometric-b2-performance.test.ts`

### Existing files modified

- `src/rendering/assets/RuntimeAssetManifest.ts` — compose Pass A + B1 + B2.
- `src/rendering/passes/ObjectRenderPass.ts` — collect scene commands instead of privately sorting/painting them.
- `src/rendering/WorldRenderer.ts` — orchestrate surfaces, shared scene commands, vehicles, overlays, selection.
- `tools/isometric_art.py` — add `public_realm` deterministic SVG builder.
- `tests/isometric-b1-runtime.test.ts` — keep B1's own 299-entry contract exact while allowing B2 runtime composition.
- `tests/smoke/isometric_b1_visual_smoke.py` — assert B1 sub-manifest = 299 and B2 runtime = 389 rather than treating 299 as the forever runtime total.
- `tests/presentation-contract.test.ts` — extend non-mutation contract to B2 resolution/render collection.

---

### Task 1: Pure Public-Realm Profile and Parking Resolver

**Files:**
- Create: `src/rendering/public-realm/PublicRealmTypes.ts`
- Create: `src/rendering/public-realm/PublicRealmVisualResolver.ts`
- Test: `tests/isometric-b2-resolver.test.ts`

**Interfaces:**
- Consumes: `UseType`, `ServiceFacilityType`, `RoadType`, `AssetOrientation`.
- Produces:
  - `PublicRealmProfile`
  - `ParkingForm`
  - `WorldFacing = AssetOrientation` using `0=north, 1=east, 2=south, 3=west`
  - `PublicRealmContext`
  - `PublicRealmDescriptor`
  - `resolvePublicRealmProfile(context): PublicRealmProfile | undefined`
  - `resolveParkingForm(context, profile): ParkingForm`
  - `resolvePublicRealmDescriptor(context): PublicRealmDescriptor | undefined`
  - `rotateWorldFacing(facing, quarterTurns): AssetOrientation`

- [ ] **Step 1: Write the failing resolver tests**

Create a table-driven test that encodes the complete approved precedence, not prose assertions:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveParkingForm,
  resolvePublicRealmDescriptor,
  resolvePublicRealmProfile,
  rotateWorldFacing,
  type PublicRealmBuildingContext,
  type PublicRealmFacilityContext,
} from '../src/rendering/public-realm/PublicRealmVisualResolver.ts';

const building = (overrides: Partial<PublicRealmBuildingContext> = {}): PublicRealmBuildingContext => ({
  kind: 'building',
  stableId: 'building:test',
  selectionKey: 'parcel:test|edge:test',
  typologyId: 'typology:residential_cottage',
  stories: 2,
  realizedFAR: 0.8,
  coverageRatio: 0.45,
  uses: ['residential'],
  roadType: 'local',
  hasAccessEdge: true,
  atIntersection: false,
  suppressCurbside: false,
  worldFacing: 0,
  siteAnchor: { x: 4, y: 4 },
  frontageAnchor: { x: 4, y: 5 },
  ...overrides,
});

const facility = (type: PublicRealmFacilityContext['facilityType']): PublicRealmFacilityContext => ({
  kind: 'facility', stableId: `service:${type}`, selectionKey: `service:${type}`,
  facilityType: type, roadType: 'collector', worldFacing: 0,
  siteAnchor: { x: 6, y: 6 }, frontageAnchor: { x: 6, y: 7 },
});

test('service facilities map only to approved civic/industrial profiles', () => {
  for (const type of ['fire_station','police_station','clinic','elementary_school'] as const) {
    assert.equal(resolvePublicRealmProfile(facility(type)), 'civic-public-space');
  }
  for (const type of ['landfill','recycling_center'] as const) {
    assert.equal(resolvePublicRealmProfile(facility(type)), 'industrial-logistics');
  }
  assert.equal(resolveParkingForm(facility('fire_station'), 'civic-public-space'), 'none');
});

test('building profile precedence and numerical boundaries are exact', () => {
  assert.equal(resolvePublicRealmProfile(building({ uses: ['civic'] })), 'civic-public-space');
  assert.equal(resolvePublicRealmProfile(building({ uses: ['residential','logistics'] })), 'industrial-logistics');
  assert.equal(resolvePublicRealmProfile(building({ typologyId: 'main_street_mixed_use', stories: 8 })), 'main-street');
  assert.equal(resolvePublicRealmProfile(building({ typologyId: 'podium_mixed_use', uses: ['residential','retail'], stories: 12 })), 'urban-core');
  assert.equal(resolvePublicRealmProfile(building({ typologyId: 'custom', uses: ['retail'], stories: 2, coverageRatio: 0.350001 })), 'main-street');
  assert.equal(resolvePublicRealmProfile(building({ typologyId: 'custom', uses: ['retail'], stories: 7, coverageRatio: 0.6 })), 'main-street');
  assert.equal(resolvePublicRealmProfile(building({ typologyId: 'custom', uses: ['retail'], stories: 8, coverageRatio: 0.6 })), 'urban-core');
  assert.equal(resolvePublicRealmProfile(building({ typologyId: 'custom', stories: 7, realizedFAR: 3.0, uses: ['office'] })), 'urban-core');
  assert.equal(resolvePublicRealmProfile(building({ typologyId: 'custom', stories: 4, uses: ['residential'] })), 'residential-green');
  assert.equal(resolvePublicRealmProfile(building({ typologyId: 'custom', stories: 5, uses: ['residential'], coverageRatio: 0.35 })), 'suburban-auto-oriented');
  assert.equal(resolvePublicRealmProfile(building({ typologyId: 'custom', uses: [] })), undefined);
});

test('parking form obeys eligibility, suppression, and precedence', () => {
  assert.equal(resolveParkingForm(building({ typologyId: 'podium_mixed_use', stories: 12, hasAccessEdge: true }), 'urban-core'), 'garage-entry');
  assert.equal(resolveParkingForm(building({ typologyId: 'podium_mixed_use', stories: 12, hasAccessEdge: false }), 'urban-core'), 'none');
  assert.equal(resolveParkingForm(building({ coverageRatio: 0.35, uses: ['retail'] }), 'suburban-auto-oriented'), 'surface-lot-edge');
  assert.equal(resolveParkingForm(building({ roadType: 'arterial' }), 'residential-green'), 'driveway');
  assert.equal(resolveParkingForm(building({ hasAccessEdge: false, roadType: 'collector' }), 'residential-green'), 'curbside-dressing');
  assert.equal(resolveParkingForm(building({ hasAccessEdge: false, roadType: 'collector', atIntersection: true }), 'residential-green'), 'none');
});

test('descriptor channel keys and orientation are stable', () => {
  const descriptor = resolvePublicRealmDescriptor(building());
  assert.ok(descriptor);
  assert.equal(descriptor.channelKeys.surface, 'parcel:test|edge:test|surface');
  assert.equal(descriptor.channelKeys.vegetation, 'parcel:test|edge:test|vegetation');
  assert.equal(rotateWorldFacing(0, 1), 1);
  assert.equal(rotateWorldFacing(3, 1), 0);
});
```

- [ ] **Step 2: Run the new tests and verify RED**

Run:

```bash
node --experimental-strip-types --test tests/isometric-b2-resolver.test.ts
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `PublicRealmVisualResolver.ts`.

- [ ] **Step 3: Implement the semantic types**

`PublicRealmTypes.ts` must contain these exact contracts:

```ts
import type { ServiceFacilityType } from '../../data/services.ts';
import type { RoadType } from '../../data/roads.ts';
import type { UseType } from '../../simulation/zoning/ZoningTypes.ts';
import type { AssetOrientation } from '../assets/AssetTypes.ts';

export type PublicRealmProfile =
  | 'urban-core' | 'main-street' | 'residential-green'
  | 'suburban-auto-oriented' | 'industrial-logistics' | 'civic-public-space';
export type ParkingForm = 'none' | 'driveway' | 'surface-lot-edge' | 'garage-entry' | 'curbside-dressing';
export type WorldFacing = AssetOrientation;
export type RealmAnchor = Readonly<{ x: number; y: number }>;

export type PublicRealmBuildingContext = Readonly<{
  kind: 'building'; stableId: string; selectionKey: string; typologyId: string;
  stories: number; realizedFAR: number; coverageRatio: number; uses: readonly UseType[];
  roadType?: RoadType; hasAccessEdge: boolean; atIntersection: boolean; suppressCurbside: boolean;
  worldFacing: WorldFacing; siteAnchor: RealmAnchor; frontageAnchor: RealmAnchor;
}>;

export type PublicRealmFacilityContext = Readonly<{
  kind: 'facility'; stableId: string; selectionKey: string; facilityType: ServiceFacilityType;
  roadType?: RoadType; worldFacing: WorldFacing; siteAnchor: RealmAnchor; frontageAnchor: RealmAnchor;
}>;

export type PublicRealmContext = PublicRealmBuildingContext | PublicRealmFacilityContext;
export type PublicRealmChannelKeys = Readonly<{
  surface: string; access: string; vegetation: string; furniture: string; parking: string; accent: string;
}>;
export type PublicRealmDescriptor = Readonly<{
  context: PublicRealmContext; profile: PublicRealmProfile; parkingForm: ParkingForm;
  channelKeys: PublicRealmChannelKeys;
}>;
```

- [ ] **Step 4: Implement the pure resolver**

Use the approved order exactly:

```ts
export function resolvePublicRealmProfile(context: PublicRealmContext): PublicRealmProfile | undefined {
  if (context.kind === 'facility') {
    return context.facilityType === 'landfill' || context.facilityType === 'recycling_center'
      ? 'industrial-logistics'
      : 'civic-public-space';
  }
  const uses = new Set(context.uses);
  if (uses.has('civic')) return 'civic-public-space';
  if (uses.has('light-industrial') || uses.has('heavy-industrial') || uses.has('logistics')) return 'industrial-logistics';
  if (context.typologyId === 'main_street_mixed_use' || context.typologyId === 'typology:commercial_block') return 'main-street';
  if (context.typologyId === 'podium_mixed_use' || context.typologyId === 'typology:commercial_office') return 'urban-core';
  if (uses.has('retail') && context.stories >= 2 && context.stories <= 7 && context.coverageRatio > 0.35) return 'main-street';
  if (context.stories >= 8 || context.realizedFAR >= 3.0) return 'urban-core';
  if (context.typologyId === 'typology:residential_cottage' || context.typologyId === 'typology:residential_rowhouse') return 'residential-green';
  if (context.uses.length > 0 && context.uses.every((use) => use === 'residential') && context.stories <= 4) return 'residential-green';
  const compatible = [...uses].some((use) => use === 'residential' || use === 'retail' || use === 'office' || use === 'hospitality');
  if (compatible && (context.coverageRatio <= 0.35 || context.typologyId === 'typology:commercial_shop')) return 'suburban-auto-oriented';
  if (context.uses.length > 0 && context.uses.every((use) => use === 'residential')) return 'residential-green';
  if ([...uses].some((use) => use === 'retail' || use === 'office' || use === 'hospitality')) return 'suburban-auto-oriented';
  return undefined;
}

export function resolveParkingForm(context: PublicRealmContext, profile: PublicRealmProfile): ParkingForm {
  if (context.kind === 'facility') return 'none';
  const garageEligible = context.typologyId === 'podium_mixed_use'
    || context.typologyId === 'typology:commercial_office' || context.stories >= 8;
  if (garageEligible && context.hasAccessEdge) return 'garage-entry';
  if (profile === 'suburban-auto-oriented' && context.coverageRatio <= 0.35) return 'surface-lot-edge';
  if (profile === 'residential-green' && context.hasAccessEdge) return 'driveway';
  const curbsideEligible = (context.roadType === 'local' || context.roadType === 'collector')
    && (profile === 'main-street' || profile === 'residential-green')
    && !context.atIntersection && !context.suppressCurbside;
  return curbsideEligible ? 'curbside-dressing' : 'none';
}

export function rotateWorldFacing(facing: WorldFacing, quarterTurns: AssetOrientation): AssetOrientation {
  return ((facing + quarterTurns) % 4) as AssetOrientation;
}
```

`resolvePublicRealmDescriptor()` must call these functions, return `undefined` when no profile exists, and build all six channel keys as `${selectionKey}|<channel>` without mutating the context.

- [ ] **Step 5: Run focused tests and commit**

```bash
node --experimental-strip-types --test tests/isometric-b2-resolver.test.ts
npm run typecheck
git add src/rendering/public-realm/PublicRealmTypes.ts src/rendering/public-realm/PublicRealmVisualResolver.ts tests/isometric-b2-resolver.test.ts
git commit -m "feat: add B2 public realm resolver"
```

Expected: resolver tests PASS; typecheck introduces no new diagnostics.

---

### Task 2: Authoritative Context Index, Orientation, and Revision-Gated Cache

**Files:**
- Create: `src/rendering/public-realm/PublicRealmRevisionFingerprint.ts`
- Create: `src/rendering/public-realm/PublicRealmContextIndex.ts`
- Create: `src/rendering/public-realm/PublicRealmPresentationCache.ts`
- Test: `tests/isometric-b2-context-index.test.ts`
- Test: `tests/isometric-b2-performance.test.ts`

**Interfaces:**
- Consumes: `SimulationCore`, Task 1 context/descriptor types, `stableHash32`, `roadConnectivityMask`, `LEGACY_CELL_SIZE_METERS`.
- Produces:
  - `publicRealmRevisionFingerprint(core): string`
  - `buildPublicRealmContextIndex(core): readonly PublicRealmContext[]`
  - `PublicRealmPresentationSnapshot = { fingerprint, contexts, descriptors }`
  - `PublicRealmPresentationCache.resolve(core): PublicRealmPresentationSnapshot`

- [ ] **Step 1: Write RED tests for authoritative extraction and cache invalidation**

Use a real `SimulationCore` fixture and verify current canonical APIs, including service facilities:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { SimulationCore } from '../src/simulation/core/SimulationCore.ts';
import { TerrainGrid, type TerrainCell } from '../src/world/terrain/TerrainGrid.ts';
import { PublicRealmPresentationCache } from '../src/rendering/public-realm/PublicRealmPresentationCache.ts';
import { buildPublicRealmContextIndex } from '../src/rendering/public-realm/PublicRealmContextIndex.ts';
import { publicRealmRevisionFingerprint } from '../src/rendering/public-realm/PublicRealmRevisionFingerprint.ts';

function flatTerrain(width = 14, height = 10): TerrainGrid {
  const cells: TerrainCell[] = Array.from({ length: width * height }, () => ({ elevation: .5, water: false, buildable: true, biome: 'grass' }));
  return new TerrainGrid(width, height, cells);
}

test('context index uses cadastral roadRef and service facility authority', () => {
  const core = new SimulationCore({ terrain: flatTerrain(), seed: 82, startingFunds: 500_000 });
  assert.equal(core.buildRoad([{x:2,y:5},{x:3,y:5},{x:4,y:5},{x:5,y:5}], 'collector').ok, true);
  core.paintZone([{x:3,y:4}], 'residential');
  assert.equal(core.placeServiceFacility('fire_station', 5, 4).ok, true);
  const contexts = buildPublicRealmContextIndex(core);
  const facility = contexts.find((item) => item.kind === 'facility' && item.facilityType === 'fire_station');
  assert.ok(facility);
  assert.equal(facility.roadType, 'collector');
});

test('fingerprint is order-stable and changes on relevant authority changes', () => {
  const core = new SimulationCore({ terrain: flatTerrain(), seed: 83, startingFunds: 500_000 });
  const before = publicRealmRevisionFingerprint(core);
  assert.equal(core.buildRoad([{x:2,y:5},{x:3,y:5}], 'local').ok, true);
  const afterRoad = publicRealmRevisionFingerprint(core);
  assert.notEqual(afterRoad, before);
  assert.equal(core.placeServiceFacility('clinic', 2, 4).ok, true);
  assert.notEqual(publicRealmRevisionFingerprint(core), afterRoad);
});

test('presentation cache rebuilds index only when fingerprint changes', () => {
  const core = new SimulationCore({ terrain: flatTerrain(), seed: 84, startingFunds: 500_000 });
  let builds = 0;
  const cache = new PublicRealmPresentationCache((value) => { builds += 1; return buildPublicRealmContextIndex(value); });
  const first = cache.resolve(core);
  const second = cache.resolve(core);
  assert.equal(first, second);
  assert.equal(builds, 1);
  core.buildRoad([{x:2,y:5}], 'local');
  cache.resolve(core);
  assert.equal(builds, 2);
});
```

Add a performance mechanism test using a synthetic city that counts index-builder invocations across 100 unchanged `cache.resolve(core)` calls; expected builder calls = 1. Also scan the production file text and reject `.getV2At(` inside the B2 context/index path.

- [ ] **Step 2: Run tests and verify RED**

```bash
node --experimental-strip-types --test tests/isometric-b2-context-index.test.ts tests/isometric-b2-performance.test.ts
```

Expected: FAIL because the three modules do not exist.

- [ ] **Step 3: Implement stable fingerprinting**

`publicRealmRevisionFingerprint(core)` must sort and hash only relevant read-only state:

```ts
const parts = [
  `roads:${core.roads.revision}:` + core.roads.list().map((r) => `${r.x},${r.y},${r.type}`).sort().join(';'),
  'parcels:' + [...core.cadastre.listParcels()].map((p) => `${p.id}:${p.zoningDistrictId}:${[...p.frontageEdgeIds].sort()}:${[...p.accessEdgeIds].sort()}`).sort().join(';'),
  'edges:' + [...core.cadastre.listEdges()].map((e) => `${e.id}:${e.kind}:${e.roadRef ?? ''}`).sort().join(';'),
  'buildings:' + core.buildings.listV2().map((b) => `${b.id}:${b.parcelIds.join(',')}:${b.typologyId}:${b.stories}:${b.realizedFAR}:${b.coverageRatio}:${b.floors.flatMap((f) => f.uses.map((u) => u.use)).sort().join(',')}`).sort().join(';'),
  'services:' + core.services.listFacilities().map((f) => `${f.id}:${f.type}:${f.x},${f.y}`).sort().join(';'),
];
return stableHash32(parts.join('|')).toString(16).padStart(8, '0');
```

Do not include treasury, service capacity, traffic, demand, lifecycle condition, or any future parking values.

- [ ] **Step 4: Implement one-pass context indexing**

Build maps once:

```ts
const roads = core.roads.list();
const roadByRef = new Map(roads.map((road) => [`${road.x},${road.y}`, road] as const));
const edges = [...core.cadastre.listEdges()].sort((a, b) => a.id.localeCompare(b.id));
const edgeById = new Map(edges.map((edge) => [edge.id, edge] as const));
const parcels = [...core.cadastre.listParcels()].sort((a, b) => a.id.localeCompare(b.id));
const parcelById = new Map(parcels.map((parcel) => [parcel.id, parcel] as const));
```

For every canonical building, emit one building context per valid street frontage in sorted parcel/frontage order. Derive `uses` from `BuildingV2.floors`; if floors are empty, use `building.entitlement.approvedUses` **only as a compatibility fallback for current restored fixtures**, with a test proving populated floor uses take precedence.

For a frontage edge with `roadRef="x,y"`:

```ts
const [roadX, roadY] = edge.roadRef.split(',').map(Number);
const parcelCenter = { x: parcel.centroid.x / LEGACY_CELL_SIZE_METERS, y: parcel.centroid.y / LEGACY_CELL_SIZE_METERS };
const dx = parcelCenter.x - roadX;
const dy = parcelCenter.y - roadY;
const worldFacing = Math.abs(dx) > Math.abs(dy) ? (dx >= 0 ? 1 : 3) : (dy >= 0 ? 2 : 0);
```

Use the road cell as `frontageAnchor`. Use the parcel centroid divided by `LEGACY_CELL_SIZE_METERS` as `siteAnchor`. `selectionKey` is `${parcel.id}|${edge.id}`. `hasAccessEdge` is `parcel.accessEdgeIds.includes(edge.id)`.

Use `roadConnectivityMask()` against `roadByRef` and classify `atIntersection` when the mask has at least three set bits. `suppressCurbside` is true for access frontage when the selected visual parking form will need a driveway/garage opening; do not fabricate service/loading regulation.

For service facilities, select the lexicographically stable adjacent road cell from the four cardinal neighbors, use the facility cell as `siteAnchor`, the road cell as `frontageAnchor`, and `selectionKey = facility.id`. If a restored facility has no adjacent road, still emit its civic/industrial semantic context with `roadType` undefined and both anchors at the facility cell; do not create a road.

- [ ] **Step 5: Implement fingerprint-gated presentation cache**

```ts
export class PublicRealmPresentationCache {
  private fingerprint = '';
  private snapshot: PublicRealmPresentationSnapshot | null = null;
  constructor(private readonly buildIndex = buildPublicRealmContextIndex) {}

  resolve(core: SimulationCore): PublicRealmPresentationSnapshot {
    const fingerprint = publicRealmRevisionFingerprint(core);
    if (this.snapshot && fingerprint === this.fingerprint) return this.snapshot;
    const contexts = Object.freeze([...this.buildIndex(core)]);
    const descriptors = Object.freeze(contexts.flatMap((context) => {
      const value = resolvePublicRealmDescriptor(context);
      return value ? [value] : [];
    }));
    this.fingerprint = fingerprint;
    this.snapshot = Object.freeze({ fingerprint, contexts, descriptors });
    return this.snapshot;
  }
}
```

- [ ] **Step 6: Run tests and commit**

```bash
node --experimental-strip-types --test tests/isometric-b2-resolver.test.ts tests/isometric-b2-context-index.test.ts tests/isometric-b2-performance.test.ts
npm run typecheck
git add src/rendering/public-realm/PublicRealmRevisionFingerprint.ts src/rendering/public-realm/PublicRealmContextIndex.ts src/rendering/public-realm/PublicRealmPresentationCache.ts tests/isometric-b2-context-index.test.ts tests/isometric-b2-performance.test.ts
git commit -m "feat: index B2 public realm context"
```

Expected: focused tests PASS; builder remains one call across unchanged cache resolves.

---

### Task 3: Exact 90-Entry B2 Manifest and Deterministic Channel Selection

**Files:**
- Create: `src/rendering/assets/PassB2AssetManifest.ts`
- Create: `src/rendering/public-realm/PublicRealmAssetResolver.ts`
- Modify: `src/rendering/assets/RuntimeAssetManifest.ts`
- Modify: `tests/isometric-b1-runtime.test.ts`
- Test: `tests/isometric-b2-manifest.test.ts`
- Test: `tests/isometric-b2-asset-resolver.test.ts`

**Interfaces:**
- Consumes: `PASS_B1_COMPOSED_ASSET_MANIFEST`, `composeAssetManifests`, `resolveVariantEntry`, `selectWeightedVariantKey`, Task 1 descriptors.
- Produces:
  - `PASS_B2_ASSET_MANIFEST` = exactly 90 entries, one atlas.
  - `PASS_B2_COMPOSED_ASSET_MANIFEST` = exactly 389 entries, 10 atlases.
  - `resolvePublicRealmVisual(descriptor, cameraTurns, entries): PublicRealmVisualSelection`

- [ ] **Step 1: Write RED manifest and selector tests**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { PASS_A_ASSET_MANIFEST } from '../src/rendering/assets/PassAAssetManifest.ts';
import { PASS_B1_ASSET_MANIFEST, PASS_B1_COMPOSED_ASSET_MANIFEST } from '../src/rendering/assets/PassB1AssetManifest.ts';
import { PASS_B2_ASSET_MANIFEST, PASS_B2_COMPOSED_ASSET_MANIFEST } from '../src/rendering/assets/PassB2AssetManifest.ts';

test('B2 composition preserves all prior manifest cardinalities', () => {
  assert.equal(PASS_A_ASSET_MANIFEST.entries.length, 161);
  assert.equal(PASS_B1_ASSET_MANIFEST.entries.length, 138);
  assert.equal(PASS_B1_COMPOSED_ASSET_MANIFEST.entries.length, 299);
  assert.equal(PASS_B2_ASSET_MANIFEST.entries.length, 90);
  assert.equal(PASS_B2_ASSET_MANIFEST.atlases.length, 1);
  assert.equal(PASS_B2_COMPOSED_ASSET_MANIFEST.entries.length, 389);
  assert.equal(PASS_B2_COMPOSED_ASSET_MANIFEST.atlases.length, 10);
});

test('B2 atlas rectangles stay inside 2048x1152 and asset ids are unique', () => {
  const ids = new Set<string>();
  for (const entry of PASS_B2_ASSET_MANIFEST.entries) {
    assert.equal(ids.has(entry.assetId), false); ids.add(entry.assetId);
    assert.ok(entry.sourceRect.x >= 0 && entry.sourceRect.y >= 0);
    assert.ok(entry.sourceRect.x + entry.sourceRect.width <= 2048);
    assert.ok(entry.sourceRect.y + entry.sourceRect.height <= 1152);
  }
});
```

Selector tests must create two descriptors with identical `selectionKey` and verify that adding an unrelated variant family to `entries` cannot change the chosen surface/vegetation/furniture keys for the original descriptor.

- [ ] **Step 2: Run tests and verify RED**

```bash
node --experimental-strip-types --test tests/isometric-b2-manifest.test.ts tests/isometric-b2-asset-resolver.test.ts
```

Expected: FAIL with missing `PassB2AssetManifest.ts` / `PublicRealmAssetResolver.ts`.

- [ ] **Step 3: Implement the exact manifest inventory**

Use 128×192 frames, 16 columns, 6 rows, atlas `2048×1152`, and declaration order exactly as listed here.

**6 symmetric surfaces (6 frames):**

```text
realm_sidewalk_concrete_01
realm_sidewalk_paver_01
realm_plaza_stone_01
realm_plaza_concrete_01
realm_permeable_pavers_01
realm_grass_verge_01
```

**6 directional curb/access families × 4 orientations (24 frames):**

```text
realm_curb_standard_01
realm_curb_ramp_01
realm_driveway_cut_01
realm_service_apron_01
realm_loading_apron_01
realm_parking_lot_entrance_01
```

**Furniture (10 frames):** `realm_bench_01` × 4 orientations plus symmetric `realm_ped_lamp_01`, `realm_road_lamp_01`, `realm_bollards_01`, `realm_planter_01`, `realm_bin_01`, `realm_hydrant_01`.

**Vegetation (17 symmetric frames):**

```text
realm_tree_pit_01 realm_tree_pit_02
realm_tree_young_01 realm_tree_young_02 realm_tree_young_03
realm_tree_mature_01 realm_tree_mature_02 realm_tree_mature_03 realm_tree_mature_04
realm_tree_ornamental_01 realm_tree_ornamental_02 realm_tree_ornamental_03
realm_hedge_01 realm_hedge_02
realm_median_planting_01 realm_median_planting_02 realm_median_planting_03
```

**5 directional parking families × 4 orientations (20 frames):**

```text
realm_parking_surface_01
realm_parking_landscaped_edge_01
realm_garage_structured_entry_01
realm_garage_podium_entry_01
realm_curbside_cars_01
```

**Public-space features (13 symmetric frames):**

```text
realm_pocket_plaza_01 realm_pocket_plaza_02
realm_civic_forecourt_01 realm_civic_forecourt_02
realm_commercial_forecourt_01 realm_commercial_forecourt_02
realm_small_square_01 realm_small_square_02
realm_cafe_market_01 realm_cafe_market_02 realm_cafe_market_03
realm_fountain_plinth_01 realm_fountain_plinth_02
```

Every B2 entry uses `category: 'public-realm'`; use `subcategory` to identify `surface`, `access`, `furniture`, `vegetation`, `parking`, or `public-space`. Directional entries receive orientations 0–3. Symmetric entries receive orientation 0 and tag `symmetric`. All entries include tags `north-american` and `pass-b2`.

`PASS_B2_COMPOSED_ASSET_MANIFEST` must be:

```ts
composeAssetManifests(PASS_B1_COMPOSED_ASSET_MANIFEST, PASS_B2_ASSET_MANIFEST)
```

- [ ] **Step 4: Implement deterministic channel selection**

`PublicRealmAssetResolver.ts` must export:

```ts
export type PublicRealmVisualSelection = Readonly<{
  surface: readonly AssetManifestEntry[];
  vertical: readonly AssetManifestEntry[];
}>;

export function resolvePublicRealmVisual(
  descriptor: PublicRealmDescriptor,
  cameraTurns: AssetOrientation,
  entries: readonly AssetManifestEntry[],
): PublicRealmVisualSelection;
```

Filter once to B2 entries and select channel families with `selectWeightedVariantKey(descriptor.channelKeys.<channel>, candidates)`. Resolve directional entries with `rotateWorldFacing(descriptor.context.worldFacing, cameraTurns)`.

Profile candidates are fixed:

```text
urban-core surface: sidewalk_paver | plaza_concrete
main-street surface: sidewalk_concrete | sidewalk_paver
residential-green surface: sidewalk_concrete | grass_verge
suburban-auto-oriented surface: permeable_pavers | grass_verge
industrial-logistics surface: plaza_concrete | sidewalk_concrete
civic-public-space surface: plaza_stone | plaza_concrete
```

Vegetation candidates: urban core tree-pit/ornamental; main street tree-pit/mature; residential green mature/young; suburban hedge/young; industrial median/hedge at low density; civic ornamental/mature. Furniture: urban core/main street/civic choose from bench/lamp/planter/bin/bollards; residential green uses lamps/bench sparsely; suburban and industrial use roadway lamp/bollards only. Parking form selects the matching parking family; `garage-entry` chooses podium garage only for `podium_mixed_use`, otherwise structured garage. Current service facilities always have `parkingForm='none'`.

Return arrays because a context may contribute both a surface and an access/parking surface plus multiple vertical props. Stable channel keys must isolate each selection.

- [ ] **Step 5: Switch runtime composition and fix inherited B1 regression semantics**

`RuntimeAssetManifest.ts` becomes:

```ts
import type { AssetManifest } from './AssetTypes.ts';
import { PASS_B2_COMPOSED_ASSET_MANIFEST } from './PassB2AssetManifest.ts';
export const RUNTIME_ASSET_MANIFEST: AssetManifest = PASS_B2_COMPOSED_ASSET_MANIFEST;
```

Change `tests/isometric-b1-runtime.test.ts` so the B1 contract remains exact independently of the runtime total:

```ts
const { PASS_B1_COMPOSED_ASSET_MANIFEST } = await import('../src/rendering/assets/PassB1AssetManifest.ts');
const { RUNTIME_ASSET_MANIFEST } = await loadRuntimeManifest();
assert.equal(PASS_B1_COMPOSED_ASSET_MANIFEST.entries.length, 299);
assert.equal(PASS_B1_COMPOSED_ASSET_MANIFEST.atlases.length, 9);
assert.equal(RUNTIME_ASSET_MANIFEST.entries.length, 389);
assert.equal(RUNTIME_ASSET_MANIFEST.atlases.length, 10);
```

- [ ] **Step 6: Run manifest/selector/B1 regression tests and commit**

```bash
node --experimental-strip-types --test tests/isometric-assets.test.ts tests/isometric-b1-manifest.test.ts tests/isometric-b1-runtime.test.ts tests/isometric-b2-manifest.test.ts tests/isometric-b2-asset-resolver.test.ts
npm run typecheck
git add src/rendering/assets/PassB2AssetManifest.ts src/rendering/public-realm/PublicRealmAssetResolver.ts src/rendering/assets/RuntimeAssetManifest.ts tests/isometric-b1-runtime.test.ts tests/isometric-b2-manifest.test.ts tests/isometric-b2-asset-resolver.test.ts
git commit -m "feat: add B2 public realm manifest"
```

Expected: Pass A=161, B1 delta=138, B1 composed=299, B2 delta=90, runtime=389.

---

### Task 4: Deterministic `public_realm` SVG/PNG Atlas Pipeline

**Files:**
- Modify: `tools/isometric_art.py`
- Create/generated: `assets/source/public_realm.svg`
- Test: `tests/isometric-b2-manifest.test.ts` (source/manifest slot parity assertions)

**Interfaces:**
- Consumes: exact Task 3 declaration order.
- Produces: `build_svg_sheet('public_realm')`, `assets/source/public_realm.svg`, `dist/assets/atlases/public_realm.png`.

- [ ] **Step 1: Add RED source-contract assertions**

Extend `tests/isometric-b2-manifest.test.ts` to assert the source exists with `width="2048" height="1152"`, and that `tools/isometric_art.py` declares `public_realm` in `DIMS` and builder dispatch. The test should initially fail because the source/builder are absent.

- [ ] **Step 2: Run RED asset check**

```bash
node --experimental-strip-types --test tests/isometric-b2-manifest.test.ts
npm run assets:check
```

Expected: source-contract test FAIL and/or `assets:check` reports missing `assets/source/public_realm.svg` after `DIMS` is introduced.

- [ ] **Step 3: Add the deterministic Python builder**

Add:

```py
DIMS = {
    # existing entries...
    'urban_depth_buildings': (2048, 1728),
    'public_realm': (2048, 1152),
}

B2_FRAME_W = 128
B2_FRAME_H = 192
B2_COLUMNS = 16

def _b2_origin(slot: int) -> tuple[int, int]:
    return (slot % B2_COLUMNS) * B2_FRAME_W, (slot // B2_COLUMNS) * B2_FRAME_H
```

Implement `public_realm()` in **exactly the same 90-frame order as Task 3**. Each frame must remain inside its 128×192 cell and use the existing 2:1 North American asset-bible lighting/material language. Directional families must visibly differ by orientation; symmetric frames must be authored once. Use generic fictional signage/markings only—no trademarks or real-world logos.

The builder ends with:

```py
if slot != 90:
    raise AssertionError(f'public realm sheet expected 90 frames, got {slot}')
return _root('public_realm', body)
```

Add `'public_realm': public_realm` to `build_svg_sheet()`.

- [ ] **Step 4: Generate the committed source contract deterministically**

Run:

```bash
python - <<'PY'
from pathlib import Path
from tools.isometric_art import build_svg_sheet
path = Path('assets/source/public_realm.svg')
path.write_text(build_svg_sheet('public_realm'), encoding='utf-8')
print(path, path.stat().st_size)
PY
```

Then prove regeneration is byte-stable:

```bash
cp assets/source/public_realm.svg /tmp/public_realm.svg
python - <<'PY'
from pathlib import Path
from tools.isometric_art import build_svg_sheet
Path('assets/source/public_realm.svg').write_text(build_svg_sheet('public_realm'), encoding='utf-8')
PY
cmp /tmp/public_realm.svg assets/source/public_realm.svg
```

Expected: `cmp` exits 0.

- [ ] **Step 5: Validate and rasterize all ten atlases**

```bash
npm run assets:check
python tools/render_isometric_atlases.py
test -s dist/assets/atlases/public_realm.png
```

Expected: asset check reports 10 contracts; PNG exists and is non-empty.

- [ ] **Step 6: Run tests and commit**

```bash
node --experimental-strip-types --test tests/isometric-b2-manifest.test.ts
npm run lint
git add tools/isometric_art.py assets/source/public_realm.svg tests/isometric-b2-manifest.test.ts
git commit -m "feat: generate B2 public realm atlas"
```

Do not commit `dist/` PNG output unless repository policy already tracks generated runtime atlases; current Pass A/B1 pipeline treats `dist` as build output.

---

### Task 5: Shared Scene Sprite Command Buffer

**Files:**
- Create: `src/rendering/passes/SceneSpriteCommand.ts`
- Create: `src/rendering/passes/SceneSpriteCommandBuffer.ts`
- Modify: `src/rendering/passes/ObjectRenderPass.ts`
- Test: `tests/isometric-b2-scene-order.test.ts`

**Interfaces:**
- Consumes: existing `DepthKey`, `AssetManifestEntry`, `AssetRegistry`, `SpritePainter`, `IsometricCamera`, culling helpers.
- Produces:
  - `SceneSpriteCommand`
  - `sortSceneSpriteCommands(commands): readonly SceneSpriteCommand[]`
  - `SceneSpriteCommandBuffer.draw(...)`
  - `ObjectRenderPass.collect(core, camera): readonly SceneSpriteCommand[]`

- [ ] **Step 1: Write RED scene-order tests**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDepthKey } from '../src/rendering/passes/RenderOrder.ts';
import { sortSceneSpriteCommands } from '../src/rendering/passes/SceneSpriteCommand.ts';

test('scene command order is deterministic across contributor input order', () => {
  const commands = [
    { depth: makeDepthKey('objects', 4, 4, 0, 'building:b'), assetId: 'b', x: 4, y: 4, label: 'B' },
    { depth: makeDepthKey('low-props', 4, 5, 0, 'tree:a'), assetId: 't', x: 4, y: 5, label: 'T' },
    { depth: makeDepthKey('objects', 4, 4, 0, 'facility:a'), assetId: 'f', x: 4, y: 4, label: 'F' },
  ] as const;
  assert.deepEqual(
    sortSceneSpriteCommands(commands).map((c) => c.depth.stableId),
    sortSceneSpriteCommands([...commands].reverse()).map((c) => c.depth.stableId),
  );
});
```

Add two depth fixtures proving a foreground public-realm prop can sort after a rear object by isometric depth and a rear prop can sort before it. Do not assert a hardcoded tree-over-building z-index independent of depth.

Add a mechanism test that reads `ObjectRenderPass.ts` and requires a public `collect(` method while rejecting its old private `commands.sort(...); for (...) painter.draw(...)` ownership.

- [ ] **Step 2: Run RED tests**

```bash
node --experimental-strip-types --test tests/isometric-b2-scene-order.test.ts
```

Expected: missing module/function or integration guard failure.

- [ ] **Step 3: Add the shared command contract**

`SceneSpriteCommand.ts`:

```ts
import type { AssetManifestEntry } from '../assets/AssetTypes.ts';
import { compareDepthKeys, type DepthKey } from './RenderOrder.ts';

export type SceneSpriteCommand = Readonly<{
  depth: DepthKey;
  entry?: AssetManifestEntry;
  assetId: string;
  x: number;
  y: number;
  label: string;
  footprintWidth?: number;
  footprintHeight?: number;
}>;

export function sortSceneSpriteCommands(commands: readonly SceneSpriteCommand[]): readonly SceneSpriteCommand[] {
  return Object.freeze([...commands].sort((a, b) => compareDepthKeys(a.depth, b.depth)));
}
```

`SceneSpriteCommandBuffer.draw()` receives `ctx`, commands, camera, viewport, worldSize; it sorts once, computes `camera.tileCenter(command.x, command.y, worldSize)`, applies existing projected-sprite culling when an entry exists, and paints through one `SpritePainter` with the same fallback labels/footprint defaults as the current `ObjectRenderPass`.

- [ ] **Step 4: Refactor `ObjectRenderPass` to collect only**

Keep all existing object selection logic, canonical `BuildingV2` index use, construction selection, services, utilities, and forest trees. Replace private `DrawCommand` with imported `SceneSpriteCommand` and return the unsorted command array from:

```ts
collect(core: SimulationCore, camera: IsometricCamera): readonly SceneSpriteCommand[]
```

`ObjectRenderPass` must no longer own a `SpritePainter`, sorting, viewport culling, or final draw loop. It must continue to call `indexCanonicalBuildingsByLegacyCell(core.buildings.listV2())` once, never `getV2At()` per building.

- [ ] **Step 5: Run object/B1/scenario tests and commit**

```bash
node --experimental-strip-types --test tests/isometric-b1-canonical-index.test.ts tests/isometric-b2-scene-order.test.ts
npm run typecheck
npm run lint
git add src/rendering/passes/SceneSpriteCommand.ts src/rendering/passes/SceneSpriteCommandBuffer.ts src/rendering/passes/ObjectRenderPass.ts tests/isometric-b2-scene-order.test.ts
git commit -m "refactor: share isometric scene command buffer"
```

Expected: canonical B1 guard remains green; new scene-order tests PASS.

---

### Task 6: Public-Realm Render Pass, Runtime Wiring, Authority Firewall, and O(N) Guard

**Files:**
- Create: `src/rendering/passes/PublicRealmRenderPass.ts`
- Modify: `src/rendering/WorldRenderer.ts`
- Modify: `tests/presentation-contract.test.ts`
- Test: `tests/isometric-b2-runtime.test.ts`
- Modify/Test: `tests/isometric-b2-performance.test.ts`

**Interfaces:**
- Consumes: `PublicRealmPresentationCache`, `resolvePublicRealmVisual`, `SceneSpriteCommandBuffer`, `ObjectRenderPass.collect()`.
- Produces:
  - `PublicRealmRenderPass.drawSurfaces(...)`
  - `PublicRealmRenderPass.collectVertical(...)`
  - runtime frame order: ground → B2 surfaces → shared scene sprites → vehicles → overlays → selection.

- [ ] **Step 1: Write RED runtime integration tests**

The test must instantiate a real core with roads/zoning/service facility and verify B2 descriptors are reachable without mutation:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { PublicRealmPresentationCache } from '../src/rendering/public-realm/PublicRealmPresentationCache.ts';

// use the same flatTerrain helper pattern as presentation-contract.test.ts

test('B2 resolution is presentation-only and current civic facilities are runtime reachable', () => {
  const core = managedB2Core();
  const before = JSON.stringify({
    roads: core.roads.list(), parcels: core.cadastre.snapshot(), buildings: core.buildings.listV2(),
    services: core.services.listFacilities(), treasury: core.treasury.balance,
  });
  const snapshot = new PublicRealmPresentationCache().resolve(core);
  assert.ok(snapshot.descriptors.some((d) => d.profile === 'civic-public-space' && d.context.kind === 'facility'));
  assert.equal(JSON.stringify({
    roads: core.roads.list(), parcels: core.cadastre.snapshot(), buildings: core.buildings.listV2(),
    services: core.services.listFacilities(), treasury: core.treasury.balance,
  }), before);
});
```

Add source guards:

```ts
assert.doesNotMatch(publicRealmSource, /parkingCapacity|occupancy|parkingPrice|cruisingPenalty/);
assert.doesNotMatch(publicRealmSource, /\.random\b|Math\.random/);
assert.doesNotMatch(publicRealmSource, /\.getV2At\(/);
```

- [ ] **Step 2: Run RED tests**

```bash
node --experimental-strip-types --test tests/isometric-b2-runtime.test.ts tests/isometric-b2-performance.test.ts tests/presentation-contract.test.ts
```

Expected: runtime test fails because `PublicRealmRenderPass`/WorldRenderer integration does not exist yet.

- [ ] **Step 3: Implement `PublicRealmRenderPass`**

Construct it with the shared `AssetRegistry` and one `PublicRealmPresentationCache`.

```ts
export class PublicRealmRenderPass {
  constructor(
    private readonly assets: AssetRegistry,
    private readonly cache = new PublicRealmPresentationCache(),
  ) {}

  drawSurfaces(ctx: CanvasRenderingContext2D, core: SimulationCore, camera: IsometricCamera, viewport: Viewport): void { /* resolve cached snapshot, draw only flat selections */ }
  collectVertical(core: SimulationCore, camera: IsometricCamera): readonly SceneSpriteCommand[] { /* same cached snapshot, collect only dimensional selections */ }
}
```

`drawSurfaces()` must call `cache.resolve(core)` once and use `resolvePublicRealmVisual()` with camera orientation. Surface sprite anchors come from `descriptor.context.frontageAnchor` for sidewalk/curb/access/curbside treatments and `siteAnchor` for plaza/parking-site treatments. Apply viewport culling before asset resolution where feasible.

`collectVertical()` returns `low-props` commands for trees/furniture/parked-car dressing and `objects` commands only for dimensional garage/public-space objects that need building-like occlusion. Stable IDs must be `${descriptor.context.selectionKey}|${entry.assetId}`.

- [ ] **Step 4: Wire the shared frame in `WorldRenderer`**

Add:

```ts
private readonly publicRealm = new PublicRealmRenderPass(this.assets);
private readonly scene = new SceneSpriteCommandBuffer(this.assets);
```

Replace the current object draw call with:

```ts
this.ground.draw(this.ctx, core, this.camera, viewport);
this.publicRealm.drawSurfaces(this.ctx, core, this.camera, viewport);
const sceneCommands = [
  ...this.objects.collect(core, this.camera),
  ...this.publicRealm.collectVertical(core, this.camera),
];
this.scene.draw(this.ctx, sceneCommands, this.camera, viewport, worldSize);
```

Then keep all vehicle renderers, overlays, and selection in their existing order and with their existing arguments. Preserve `worldMetersToCanvas`, Urban Fabric overlay state, selected parcel handling, camera controls, and asset diagnostics exactly.

- [ ] **Step 5: Add the measurable performance regression gate**

Extend `tests/isometric-b2-performance.test.ts` so 100 unchanged calls to the same `PublicRealmPresentationCache` trigger one index build; then mutate a road and require exactly one additional build. Add a source scan rejecting nested calls to `core.cadastre.list*`, `core.buildings.listV2()`, or `core.services.listFacilities()` inside per-descriptor loops in `PublicRealmRenderPass.ts`.

- [ ] **Step 6: Extend presentation-contract test and run all focused gates**

```bash
node --experimental-strip-types --test tests/presentation-contract.test.ts tests/isometric-b1-canonical-index.test.ts tests/isometric-b1-runtime.test.ts tests/isometric-b2-*.test.ts
npm run typecheck
npm run lint
npm run assets:check
git add src/rendering/passes/PublicRealmRenderPass.ts src/rendering/WorldRenderer.ts tests/presentation-contract.test.ts tests/isometric-b2-runtime.test.ts tests/isometric-b2-performance.test.ts
git commit -m "feat: render deterministic B2 public realm"
```

Expected: B2 does not change any authoritative snapshot; no B1 canonical lookup regression; runtime manifest = 389.

---

### Task 7: Six-Profile Visual Smoke and B2 CI

**Files:**
- Create: `tests/smoke/isometric_b2_visual_smoke.py`
- Modify: `tests/smoke/isometric_b1_visual_smoke.py`
- Create: `.github/workflows/isometric-b2.yml`

**Interfaces:**
- Consumes: built `dist`, B2 runtime manifest, current browser fixture APIs.
- Produces: deterministic screenshots for all six profiles at multiple camera rotations and CI evidence.

- [ ] **Step 1: Write the B2 browser smoke before CI wiring**

Follow the existing B1 Playwright route/variance harness. The browser fixture must create authoritative contexts for all six profiles:

```text
urban-core: podium_mixed_use / office tower canonical building
main-street: main_street_mixed_use canonical building
residential-green: cottage/rowhouse canonical building
suburban-auto-oriented: low-coverage commercial shop canonical building
industrial-logistics: logistics/heavy-industrial canonical building or landfill
civic-public-space: authoritative fire_station/police_station/clinic/elementary_school service facility
```

Use real roads and zoning so the cadastre generates real `street-frontage` edges and `roadRef`s. For canonical BuildingV2 fixtures, populate `floors[].uses` rather than relying only on entitlement fallback.

The evidence object must assert:

```py
assert evidence['runtime_entries'] == 389
assert evidence['runtime_atlases'] == 10
assert evidence['b2_entries'] == 90
assert evidence['profiles'] == [
    'civic-public-space','industrial-logistics','main-street',
    'residential-green','suburban-auto-oriented','urban-core'
]
assert evidence['diagnostics'] == []
```

Capture at least these files:

```text
urban_core_o0.png
main_street_o0.png
residential_green_o0.png
suburban_auto_o0.png
industrial_logistics_o0.png
civic_public_space_o0.png
mixed_profiles_o1.png
mixed_profiles_o2.png
```

Rotate through the app renderer for `o1` and `o2`; verify the semantic profile/parking-form evidence is unchanged before and after rotation.

- [ ] **Step 2: Update B1 smoke to test the B1 sub-contract, not the total runtime forever**

Inside its browser `page.evaluate`, import `PASS_B1_COMPOSED_ASSET_MANIFEST`. Replace the 299/9 runtime assertions with:

```py
assert evidence['b1_entries'] == 299
assert evidence['b1_atlases'] == 9
assert evidence['runtime_entries'] == 389
assert evidence['runtime_atlases'] == 10
```

Keep all mixed-use/condition-key assertions and three B1 screenshots unchanged.

- [ ] **Step 3: Build and run local visual gates**

```bash
npm run build
npm run test:smoke:isometric
python tests/smoke/isometric_b1_visual_smoke.py
python tests/smoke/isometric_b2_visual_smoke.py
```

Expected: Pass A smoke, B1 smoke, and B2 smoke all PASS with no browser console/page errors.

- [ ] **Step 4: Add `.github/workflows/isometric-b2.yml`**

Use Node 22 and TypeScript 5.8.3. Trigger on pushes to `feature/isometric-pass-b2-public-realm` and PRs targeting `feature/isometric-pass-b1-urban-depth`.

The targeted job must run in this order:

```yaml
- npm install --ignore-scripts --no-audit --no-fund
- npm install --global typescript@5.8.3
- node --experimental-strip-types --test tests/isometric-assets.test.ts tests/isometric-b1-*.test.ts tests/isometric-b2-*.test.ts tests/presentation-contract.test.ts
- npm run typecheck
- npm run lint
- npm run assets:check
- install playwright==1.55.0 Pillow==11.3.0 and Chromium
- npm run build
- npm run test:smoke:isometric
- python tests/smoke/isometric_b1_visual_smoke.py
- python tests/smoke/isometric_b2_visual_smoke.py
```

Add a diagnostic-delta step against the current B1 branch, not `main`:

```bash
git fetch origin feature/isometric-pass-b1-urban-depth
base_ref="$(git rev-parse origin/feature/isometric-pass-b1-urban-depth)"
tsc -p tsconfig.json --noEmit --pretty false > /tmp/b2-head-typecheck.log 2>&1 || head_status=$?
git worktree add --detach /tmp/b2-base "$base_ref"
ln -s "$GITHUB_WORKSPACE/node_modules" /tmp/b2-base/node_modules
(cd /tmp/b2-base && tsc -p tsconfig.json --noEmit --pretty false > /tmp/b2-base-typecheck.log 2>&1) || base_status=$?
diff -u /tmp/b2-base-typecheck.log /tmp/b2-head-typecheck.log
```

Initialize `head_status=0` and `base_status=0` before the commands and preserve the same three-case policy as B1: green base cannot become red; red base cannot change diagnostic set; B2 may clear inherited diagnostics.

Add a second `b2-full` job that runs `npm test`, typecheck, lint, assets, build, Phase 6/7 smoke, Urban Fabric smoke when present, Pass A smoke, B1 smoke, and B2 smoke. This is the full repository gate for the B2 head.

- [ ] **Step 5: Run local workflow-equivalent checks and commit**

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

Expected: all local gates PASS before relying on GitHub CI.

---

### Task 8: Frozen-Parent Integration Freshness, Exact-Head Verification, Report, and Draft PR

**Files:**
- Modify only if reconciliation requires it: conflict-resolved B1/B2 integration files.
- Create: `docs/art/PASS_B2_REPORT.md`
- Update: `docs/superpowers/plans/2026-08-26-isometric-pass-b2-public-realm.md` only to mark execution status after all evidence exists.

**Interfaces:**
- Consumes: frozen Urban Fabric checkpoint `941a9d5261898b00af103bfd9797065975a660f2`, B1 branch, completed B2 branch.
- Produces: refreshed B1 integration ancestry if required, exact-head green CI, B2 report, draft PR. No merge to `main`.

- [ ] **Step 1: Reconfirm the frozen parent diff before reconciliation**

```bash
git fetch origin feature/urban-fabric-2.0 feature/isometric-pass-b1-urban-depth feature/isometric-pass-b2-public-realm

git diff --name-only 1c1479bdad0a7be6db16263128f5aee38dccdc44..941a9d5261898b00af103bfd9797065975a660f2 | sort > /tmp/parent-late-files.txt
git diff --name-only 1c1479bdad0a7be6db16263128f5aee38dccdc44..ea294c07b1bf3d0f3b324c48499915f3883c4c6e | sort > /tmp/b1-files.txt
comm -12 /tmp/parent-late-files.txt /tmp/b1-files.txt
```

Expected at the plan's pinned baseline: no output. If output appears because history changed, stop integration and treat it as a real compatibility defect; do not force merge.

- [ ] **Step 2: Refresh B1 only now, because this is the actual integration-freshness gate**

Use an isolated worktree. Preserve history with a merge commit; do not rewrite B1 commits:

```bash
git worktree add ../civic-foundry-b1-refresh feature/isometric-pass-b1-urban-depth
cd ../civic-foundry-b1-refresh
git merge --no-ff 941a9d5261898b00af103bfd9797065975a660f2 -m "Merge Urban Fabric checkpoint for B2 integration"
```

Run B1 targeted/full gates. Push B1 only after they are green. This action is allowed here because B2 is entering actual integration; it is not movement-chasing during implementation.

- [ ] **Step 3: Bring the refreshed B1 ancestry into B2 without rewriting B2 history**

```bash
cd ../<b2-worktree>
git fetch origin feature/isometric-pass-b1-urban-depth
git merge --no-ff origin/feature/isometric-pass-b1-urban-depth -m "Merge refreshed B1 baseline for B2 integration"
```

Resolve only genuine overlapping B2 rendering/test/doc files. Preserve all newer parent UI/Save V9/Urban Fabric behavior. Never resolve a conflict by deleting parent authority code or weakening tests.

- [ ] **Step 4: Run exact-head local acceptance suite**

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

Expected: every command PASS. If `urban_fabric_smoke.py` is absent on the branch despite the pinned parent reconciliation, treat that as a failed integration rather than skipping it.

- [ ] **Step 5: Verify the final B2 delta is scoped**

Compare refreshed B1 head to B2 head:

```bash
git diff --name-only origin/feature/isometric-pass-b1-urban-depth..HEAD | sort
```

Expected files are limited to B2 art/rendering/tests/workflow/spec/plan/report plus the two inherited B1 regression-test updates described in this plan. There must be no changes to save serialization, `SimulationCore`, service simulation, traffic economics, parking simulation, treasury, zoning legality, or property-market authority.

- [ ] **Step 6: Push B2 and require exact-head GitHub Actions success**

```bash
git push origin feature/isometric-pass-b2-public-realm
```

Record the exact B2 head SHA. Require both the B2 targeted job and `b2-full` job to complete successfully on that exact SHA. Do not cite an earlier green run after later commits.

- [ ] **Step 7: Write `PASS_B2_REPORT.md` from actual evidence**

The report must contain concrete values, no placeholders:

```markdown
# Isometric Pass B2 — Parking & Public Realm Report

- Frozen Urban Fabric checkpoint: `941a9d5261898b00af103bfd9797065975a660f2`
- Refreshed B1 head: `<actual SHA>`
- Final B2 head: `<actual SHA>`
- Pass A entries: 161
- Pass B1 delta: 138
- B2 delta: 90
- Runtime entries: 389
- Runtime atlases: 10
- B2 atlas: `public_realm` (`2048×1152`)
- Targeted CI run: `<actual run id>` — success
- Full CI run: `<actual run id>` — success
- Visual smoke: 8 B2 scenes plus inherited Pass A/B1 smoke — success
- Deferred authority: Transportation 3R.6 owns parking spaces, prices, occupancy, cruising and generalized-cost effects.
```

Replace every angle-bracket field with real evidence before committing.

- [ ] **Step 8: Mark plan execution status, commit docs, and create a draft child PR**

After evidence exists, add at the top of this plan:

```markdown
> **Execution status: COMPLETE against frozen Urban Fabric checkpoint `941a9d5261898b00af103bfd9797065975a660f2`.** Final acceptance evidence is recorded in `docs/art/PASS_B2_REPORT.md`.
```

Then:

```bash
git add docs/art/PASS_B2_REPORT.md docs/superpowers/plans/2026-08-26-isometric-pass-b2-public-realm.md
git commit -m "docs: record Pass B2 acceptance"
git push origin feature/isometric-pass-b2-public-realm
```

Because the documentation commit changes the exact head, rerun/await both B2 jobs on this final documentation head and update the report only if the recorded run IDs refer to a previous SHA. If updating the report creates another head, record the final successful workflow run in the PR body as well; do not create an infinite self-referential report loop.

Create a **draft** PR:

```text
head: feature/isometric-pass-b2-public-realm
base: feature/isometric-pass-b1-urban-depth
title: Isometric Pass B2 — Parking & Public Realm
```

PR body must summarize the 90-entry asset delta, six profiles, presentation-only parking firewall, shared scene buffer, exact frozen parent, and latest exact-head CI evidence. Keep the PR draft and unmerged.

## Plan Self-Review Checklist

Before execution begins, verify:

- [ ] Every approved spec requirement maps to a task above.
- [ ] No task creates authoritative parking state or modifies service/traffic/economic outcomes.
- [ ] Pass A and B1 exact sub-manifest counts remain separately testable after runtime grows to 389.
- [ ] All 90 B2 manifest entries map one-to-one to deterministic source frames.
- [ ] Directional world orientation is separated from camera rotation.
- [ ] Context indexing is O(N) and cache rebuilds are fingerprint-gated.
- [ ] Vertical B2 props join the same deterministic sprite command sort as buildings/facilities.
- [ ] Current service facilities make `civic-public-space` runtime reachable.
- [ ] B1 reconciliation occurs only at the final integration gate and preserves history.
- [ ] No placeholder/TODO language remains in implementation instructions or final-report requirements.
