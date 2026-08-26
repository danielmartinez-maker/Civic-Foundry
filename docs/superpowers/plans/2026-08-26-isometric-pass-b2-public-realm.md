# Isometric Pass B2 — Parking & Public Realm Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a deterministic, presentation-only parking/public-realm layer with six context-derived streetscape profiles, 90 authored B2 asset entries, correct shared depth ordering, and no new simulation or parking authority.

**Architecture:** B2 reads existing canonical roads, cadastre, `BuildingV2`, service facilities, terrain compatibility, and stable IDs. A read-only O(N) revision fingerprint gates an indexed context snapshot; pure resolver functions map each context to a semantic public-realm profile, qualitative parking form, and independent deterministic visual channels. The renderer resolves one B2 presentation snapshot per frame, draws flat treatments before scene objects, and puts dimensional B2 props into the same deterministic scene-command sort used by buildings and facilities.

**Tech Stack:** TypeScript 5.8.3, Node 22 test runner (`node --experimental-strip-types --test`), Canvas 2D isometric renderer, deterministic SVG generation in Python, Playwright 1.55.0 + Pillow 11.3.0 visual smoke, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-08-26-isometric-pass-b2-public-realm-design.md`

## Global Constraints

- Work only on `feature/isometric-pass-b2-public-realm`; `main` remains untouched.
- B2 began from verified B1 head `ea294c07b1bf3d0f3b324c48499915f3883c4c6e` plus the approved B2 design commits.
- Frozen Urban Fabric integration checkpoint for this plan: `941a9d5261898b00af103bfd9797065975a660f2`.
- The parent moved 13 commits from B1's old checkpoint `1c1479bdad0a7be6db16263128f5aee38dccdc44` to `941a9d5`; those commits touch none of B1's 21 changed files. Do not restack B1 during Tasks 1–7. Perform one controlled integration-freshness reconciliation in Task 8.
- Pass A remains exactly 161 entries and unchanged.
- Pass B1 remains exactly 138 additional entries; `PASS_B1_COMPOSED_ASSET_MANIFEST` remains exactly 299 entries across 9 atlases.
- B2 implements exactly 90 manifest entries in one `public_realm` atlas, yielding 389 runtime entries across 10 atlases.
- The 90-entry count is the concrete inventory for this plan; tests must also prove semantic family/orientation coverage so count alone cannot pass.
- B2 must not create, persist, expose, or feed back parking capacity, occupancy, price, legality, availability, cruising penalty, generalized cost, curb regulation, parking revenue, pedestrian simulation, or public-space simulation.
- Existing service facilities are authoritative inputs only. B2 must not change service capacity, staffing, dispatch, vehicles, cost, funding, or coverage.
- No save-format change.
- Presentation code must not advance or consume simulation RNG.
- No per-frontage/per-decoration citywide scans. The fingerprint may make one O(N) read-only pass; expensive geometry/context indexing occurs only when the fingerprint changes.
- Resolve the public-realm snapshot once per rendered frame; do not recompute the fingerprint separately for surface and vertical passes.
- Build the B2 asset catalog once from the manifest; do not filter the full runtime manifest per descriptor.
- Camera rotation changes rendered orientation only; it may not change semantic profile, parking form, or stable visual-family choice.
- Use TDD on every production task: RED test → confirm failure → minimal GREEN implementation → focused tests → commit.

## File Structure

### New production files

- `src/rendering/public-realm/PublicRealmTypes.ts` — semantic profiles, context shapes, placement/orientation, descriptors.
- `src/rendering/public-realm/PublicRealmVisualResolver.ts` — pure profile and parking-form rules.
- `src/rendering/public-realm/PublicRealmRevisionFingerprint.ts` — stable O(N) read-only fingerprint of relevant authoritative inputs.
- `src/rendering/public-realm/PublicRealmContextIndex.ts` — one-pass road/parcel/edge/building/facility indexes and contexts.
- `src/rendering/public-realm/PublicRealmPresentationCache.ts` — fingerprint-gated context/descriptor cache.
- `src/rendering/public-realm/PublicRealmAssetResolver.ts` — pre-indexed B2 asset catalog and independent deterministic channel selection.
- `src/rendering/assets/PassB2AssetManifest.ts` — B2 atlas descriptor and exact 90-entry inventory.
- `src/rendering/passes/SceneSpriteCommand.ts` — shared scene sprite command contract and deterministic sorting.
- `src/rendering/passes/SceneSpriteCommandBuffer.ts` — cull/paint shared scene commands.
- `src/rendering/passes/PublicRealmRenderPass.ts` — resolves one B2 frame snapshot, draws surfaces, collects vertical commands.
- `assets/source/public_realm.svg` — deterministic generated source contract.
- `.github/workflows/isometric-b2.yml` — B2 targeted and full compatibility CI.
- `tests/smoke/isometric_b2_visual_smoke.py` — six-profile multi-rotation browser smoke.
- `docs/art/PASS_B2_REPORT.md` — final acceptance evidence, created in Task 8.

### New tests

- `tests/isometric-b2-resolver.test.ts`
- `tests/isometric-b2-context-index.test.ts`
- `tests/isometric-b2-manifest.test.ts`
- `tests/isometric-b2-asset-resolver.test.ts`
- `tests/isometric-b2-scene-order.test.ts`
- `tests/isometric-b2-runtime.test.ts`
- `tests/isometric-b2-performance.test.ts`

### Existing files modified

- `src/rendering/assets/RuntimeAssetManifest.ts` — switch runtime composition to Pass A + B1 + B2.
- `src/rendering/passes/ObjectRenderPass.ts` — collect scene commands instead of privately sorting/painting them.
- `src/rendering/WorldRenderer.ts` — orchestrate one B2 frame snapshot, surfaces, shared scene commands, vehicles, overlays, selection.
- `tools/isometric_art.py` — add the `public_realm` deterministic SVG builder.
- `tests/isometric-b1-runtime.test.ts` — keep B1's own 299-entry contract exact while allowing runtime composition to reach 389.
- `tests/smoke/isometric_b1_visual_smoke.py` — assert B1 sub-manifest = 299/9 and runtime = 389/10.
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
  - `WorldFacing = AssetOrientation` where `0=north, 1=east, 2=south, 3=west`
  - `PublicRealmContext`
  - `PublicRealmDescriptor`
  - `resolvePublicRealmProfile(context): PublicRealmProfile | undefined`
  - `resolveParkingForm(context, profile): ParkingForm`
  - `resolvePublicRealmDescriptor(context): PublicRealmDescriptor | undefined`
  - `rotateWorldFacing(facing, quarterTurns): AssetOrientation`

- [ ] **Step 1: Write the failing resolver tests**

Create `tests/isometric-b2-resolver.test.ts` with functions imported from the resolver and types imported from the type owner:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveParkingForm,
  resolvePublicRealmDescriptor,
  resolvePublicRealmProfile,
  rotateWorldFacing,
} from '../src/rendering/public-realm/PublicRealmVisualResolver.ts';
import type {
  PublicRealmBuildingContext,
  PublicRealmFacilityContext,
} from '../src/rendering/public-realm/PublicRealmTypes.ts';

const building = (overrides: Partial<PublicRealmBuildingContext> = {}): PublicRealmBuildingContext => ({
  kind: 'building', stableId: 'building:test', selectionKey: 'parcel:test|edge:test',
  typologyId: 'typology:residential_cottage', stories: 2, realizedFAR: 0.8,
  coverageRatio: 0.45, uses: ['residential'], roadType: 'local', hasAccessEdge: true,
  atIntersection: false, curbsideSuppressedByGeometry: false, worldFacing: 0,
  siteAnchor: { x: 4, y: 4 }, frontageAnchor: { x: 4, y: 5 }, ...overrides,
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
  assert.equal(resolvePublicRealmProfile(building({ typologyId: 'custom', stories: 7, realizedFAR: 3, uses: ['office'] })), 'urban-core');
  assert.equal(resolvePublicRealmProfile(building({ typologyId: 'custom', stories: 4, uses: ['residential'] })), 'residential-green');
  assert.equal(resolvePublicRealmProfile(building({ typologyId: 'custom', stories: 5, uses: ['residential'], coverageRatio: 0.35 })), 'suburban-auto-oriented');
  assert.equal(resolvePublicRealmProfile(building({ typologyId: 'custom', uses: [] })), undefined);
});

test('parking form obeys eligibility, access suppression, and precedence', () => {
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

- [ ] **Step 2: Run the test and verify RED**

```bash
node --experimental-strip-types --test tests/isometric-b2-resolver.test.ts
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `PublicRealmVisualResolver.ts`.

- [ ] **Step 3: Implement the semantic types**

Create `PublicRealmTypes.ts` with these contracts:

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
  roadType?: RoadType; hasAccessEdge: boolean; atIntersection: boolean;
  curbsideSuppressedByGeometry: boolean; worldFacing: WorldFacing;
  siteAnchor: RealmAnchor; frontageAnchor: RealmAnchor;
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

Implement exact approved precedence:

```ts
export function resolvePublicRealmProfile(context: PublicRealmContext): PublicRealmProfile | undefined {
  if (context.kind === 'facility') {
    return context.facilityType === 'landfill' || context.facilityType === 'recycling_center'
      ? 'industrial-logistics' : 'civic-public-space';
  }
  const uses = new Set(context.uses);
  if (uses.has('civic')) return 'civic-public-space';
  if (uses.has('light-industrial') || uses.has('heavy-industrial') || uses.has('logistics')) return 'industrial-logistics';
  if (context.typologyId === 'main_street_mixed_use' || context.typologyId === 'typology:commercial_block') return 'main-street';
  if (context.typologyId === 'podium_mixed_use' || context.typologyId === 'typology:commercial_office') return 'urban-core';
  if (uses.has('retail') && context.stories >= 2 && context.stories <= 7 && context.coverageRatio > 0.35) return 'main-street';
  if (context.stories >= 8 || context.realizedFAR >= 3) return 'urban-core';
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
    && !context.atIntersection && !context.curbsideSuppressedByGeometry;
  return curbsideEligible ? 'curbside-dressing' : 'none';
}

export function rotateWorldFacing(facing: WorldFacing, quarterTurns: AssetOrientation): AssetOrientation {
  return ((facing + quarterTurns) % 4) as AssetOrientation;
}
```

`resolvePublicRealmDescriptor()` calls those functions, returns `undefined` when no profile exists, and creates the six channel keys as `${selectionKey}|surface`, `${selectionKey}|access`, `${selectionKey}|vegetation`, `${selectionKey}|furniture`, `${selectionKey}|parking`, `${selectionKey}|accent` without mutating input.

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

- [ ] **Step 1: Write RED extraction and cache tests**

Create `tests/isometric-b2-context-index.test.ts` using a real `SimulationCore`:

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

test('context index uses cadastral roadRef and service-facility authority', () => {
  const core = new SimulationCore({ terrain: flatTerrain(), seed: 82, startingFunds: 500_000 });
  assert.equal(core.buildRoad([{x:2,y:5},{x:3,y:5},{x:4,y:5},{x:5,y:5}], 'collector').ok, true);
  core.paintZone([{x:3,y:4}], 'residential');
  assert.equal(core.placeServiceFacility('fire_station', 5, 4).ok, true);
  const contexts = buildPublicRealmContextIndex(core);
  const facility = contexts.find((item) => item.kind === 'facility' && item.facilityType === 'fire_station');
  assert.ok(facility);
  assert.equal(facility.roadType, 'collector');
});

test('fingerprint changes only when relevant presentation authority changes', () => {
  const core = new SimulationCore({ terrain: flatTerrain(), seed: 83, startingFunds: 500_000 });
  const before = publicRealmRevisionFingerprint(core);
  assert.equal(core.buildRoad([{x:2,y:5},{x:3,y:5}], 'local').ok, true);
  const afterRoad = publicRealmRevisionFingerprint(core);
  assert.notEqual(afterRoad, before);
  assert.equal(core.placeServiceFacility('clinic', 2, 4).ok, true);
  assert.notEqual(publicRealmRevisionFingerprint(core), afterRoad);
  const beforeFunding = publicRealmRevisionFingerprint(core);
  core.setServiceFunding('healthcare', 120);
  assert.equal(publicRealmRevisionFingerprint(core), beforeFunding);
});

test('presentation cache rebuilds context only when fingerprint changes', () => {
  const core = new SimulationCore({ terrain: flatTerrain(), seed: 84, startingFunds: 500_000 });
  let builds = 0;
  const cache = new PublicRealmPresentationCache((value) => { builds += 1; return buildPublicRealmContextIndex(value); });
  const first = cache.resolve(core);
  const second = cache.resolve(core);
  assert.equal(first, second);
  assert.equal(builds, 1);
  assert.equal(core.buildRoad([{x:2,y:5}], 'local').ok, true);
  cache.resolve(core);
  assert.equal(builds, 2);
});
```

In `tests/isometric-b2-performance.test.ts`, call the same cache 100 times without changing state and require one index build. Read `PublicRealmContextIndex.ts` as text and reject `.getV2At(`.

- [ ] **Step 2: Run tests and verify RED**

```bash
node --experimental-strip-types --test tests/isometric-b2-context-index.test.ts tests/isometric-b2-performance.test.ts
```

Expected: FAIL because the three modules do not exist.

- [ ] **Step 3: Implement stable read-only fingerprinting**

`publicRealmRevisionFingerprint(core)` sorts and hashes only relevant state:

```ts
const parts = [
  `roads:${core.roads.revision}:` + core.roads.list().map((r) => `${r.x},${r.y},${r.type}`).sort().join(';'),
  'parcels:' + [...core.cadastre.listParcels()].map((p) => `${p.id}:${p.zoningDistrictId}:${[...p.frontageEdgeIds].sort().join(',')}:${[...p.accessEdgeIds].sort().join(',')}`).sort().join(';'),
  'edges:' + [...core.cadastre.listEdges()].map((e) => `${e.id}:${e.kind}:${e.roadRef ?? ''}`).sort().join(';'),
  'buildings:' + core.buildings.listV2().map((b) => `${b.id}:${[...b.parcelIds].sort().join(',')}:${b.typologyId}:${b.stories}:${b.realizedFAR}:${b.coverageRatio}:${b.floors.flatMap((f) => f.uses.map((u) => u.use)).sort().join(',')}`).sort().join(';'),
  'services:' + core.services.listFacilities().map((f) => `${f.id}:${f.type}:${f.x},${f.y}`).sort().join(';'),
];
return stableHash32(parts.join('|')).toString(16).padStart(8, '0');
```

Do not include treasury, funding, service capacity, traffic, demand, lifecycle condition, entitlement uses, or future parking values.

- [ ] **Step 4: Implement one-pass context indexing**

Build road, edge, parcel, building, and facility maps once. For every canonical building, derive `uses` **only** from `BuildingV2.floors[].uses`; do not fall back to entitlement because the approved design names floor-use allocation as the canonical generic classifier. Typology-specific rules may still classify a building with empty floors.

For each building parcel, emit one context per valid sorted `street-frontage` edge with a `roadRef`. Parse the road ref as the authoritative adjacent road cell. Use parcel centroid divided by `LEGACY_CELL_SIZE_METERS` as `siteAnchor`, road cell coordinates as `frontageAnchor`, and `${parcel.id}|${edge.id}` as `selectionKey`.

Derive world-facing direction from road cell to parcel centroid:

```ts
const dx = parcelCenter.x - roadX;
const dy = parcelCenter.y - roadY;
const worldFacing = Math.abs(dx) > Math.abs(dy)
  ? (dx >= 0 ? 1 : 3)
  : (dy >= 0 ? 2 : 0);
```

Set `hasAccessEdge = parcel.accessEdgeIds.includes(edge.id)`. Use `roadConnectivityMask()` against the prebuilt road map and set `atIntersection` when at least three connectivity bits are set. Set `curbsideSuppressedByGeometry = hasAccessEdge`; this is a direct reading of the approved access-edge suppression rule and does not depend on the parking resolver, avoiding a circular dependency. Current compatibility cadastre may therefore make curbside dressing uncommon; do not weaken the authority rule just to display the asset.

For service facilities, choose the lexicographically stable adjacent cardinal road cell. Use facility cell as `siteAnchor`, road cell as `frontageAnchor`, and facility ID as `selectionKey`. A restored facility with no adjacent road still emits a semantic context with `roadType` undefined and both anchors at the facility cell; rendering must not create a road.

- [ ] **Step 5: Implement the fingerprint-gated cache**

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
      const descriptor = resolvePublicRealmDescriptor(context);
      return descriptor ? [descriptor] : [];
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

Expected: focused tests PASS; unchanged cache resolves build the expensive context index once.

---

### Task 3: Exact 90-Entry B2 Manifest and Pre-Indexed Channel Selection

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
  - `PublicRealmAssetCatalog`
  - `buildPublicRealmAssetCatalog(entries): PublicRealmAssetCatalog`
  - `resolvePublicRealmVisual(descriptor, cameraTurns, catalog): PublicRealmVisualSelection`

- [ ] **Step 1: Write RED manifest tests**

Create `tests/isometric-b2-manifest.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { PASS_A_ASSET_MANIFEST } from '../src/rendering/assets/PassAAssetManifest.ts';
import { PASS_B1_ASSET_MANIFEST, PASS_B1_COMPOSED_ASSET_MANIFEST } from '../src/rendering/assets/PassB1AssetManifest.ts';
import { PASS_B2_ASSET_MANIFEST, PASS_B2_COMPOSED_ASSET_MANIFEST } from '../src/rendering/assets/PassB2AssetManifest.ts';

test('B2 composition preserves prior cardinalities', () => {
  assert.equal(PASS_A_ASSET_MANIFEST.entries.length, 161);
  assert.equal(PASS_B1_ASSET_MANIFEST.entries.length, 138);
  assert.equal(PASS_B1_COMPOSED_ASSET_MANIFEST.entries.length, 299);
  assert.equal(PASS_B2_ASSET_MANIFEST.entries.length, 90);
  assert.equal(PASS_B2_ASSET_MANIFEST.atlases.length, 1);
  assert.equal(PASS_B2_COMPOSED_ASSET_MANIFEST.entries.length, 389);
  assert.equal(PASS_B2_COMPOSED_ASSET_MANIFEST.atlases.length, 10);
});

test('B2 rectangles are in bounds and asset ids are unique', () => {
  const ids = new Set<string>();
  for (const entry of PASS_B2_ASSET_MANIFEST.entries) {
    assert.equal(ids.has(entry.assetId), false); ids.add(entry.assetId);
    assert.ok(entry.sourceRect.x >= 0 && entry.sourceRect.y >= 0);
    assert.ok(entry.sourceRect.x + entry.sourceRect.width <= 2048);
    assert.ok(entry.sourceRect.y + entry.sourceRect.height <= 1152);
  }
});
```

Add exact family/orientation assertions: every symmetric family appears once at orientation 0 with tag `symmetric`; every directional family appears exactly four times with orientations `[0,1,2,3]`.

Create `tests/isometric-b2-asset-resolver.test.ts` proving the catalog is built once, camera rotation changes only entry orientation, and adding an unrelated candidate family cannot change selections from unrelated channel keys.

- [ ] **Step 2: Run tests and verify RED**

```bash
node --experimental-strip-types --test tests/isometric-b2-manifest.test.ts tests/isometric-b2-asset-resolver.test.ts
```

Expected: FAIL with missing B2 manifest/asset resolver modules.

- [ ] **Step 3: Implement the exact manifest inventory**

Use 128×192 source rectangles, 16 columns, 6 rows, atlas `2048×1152`, declaration order exactly below.

**6 symmetric surfaces:**

```text
realm_sidewalk_concrete_01
realm_sidewalk_paver_01
realm_plaza_stone_01
realm_plaza_concrete_01
realm_permeable_pavers_01
realm_grass_verge_01
```

**6 directional curb/access families × 4 = 24:**

```text
realm_curb_standard_01
realm_curb_ramp_01
realm_driveway_cut_01
realm_service_apron_01
realm_loading_apron_01
realm_parking_lot_entrance_01
```

**Furniture = 10:** `realm_bench_01` × four orientations plus symmetric `realm_ped_lamp_01`, `realm_road_lamp_01`, `realm_bollards_01`, `realm_planter_01`, `realm_bin_01`, `realm_hydrant_01`.

**Vegetation = 17 symmetric:**

```text
realm_tree_pit_01 realm_tree_pit_02
realm_tree_young_01 realm_tree_young_02 realm_tree_young_03
realm_tree_mature_01 realm_tree_mature_02 realm_tree_mature_03 realm_tree_mature_04
realm_tree_ornamental_01 realm_tree_ornamental_02 realm_tree_ornamental_03
realm_hedge_01 realm_hedge_02
realm_median_planting_01 realm_median_planting_02 realm_median_planting_03
```

**5 directional parking families × 4 = 20:**

```text
realm_parking_surface_01
realm_parking_landscaped_edge_01
realm_garage_structured_entry_01
realm_garage_podium_entry_01
realm_curbside_cars_01
```

**Public-space = 13 symmetric:**

```text
realm_pocket_plaza_01 realm_pocket_plaza_02
realm_civic_forecourt_01 realm_civic_forecourt_02
realm_commercial_forecourt_01 realm_commercial_forecourt_02
realm_small_square_01 realm_small_square_02
realm_cafe_market_01 realm_cafe_market_02 realm_cafe_market_03
realm_fountain_plinth_01 realm_fountain_plinth_02
```

Every entry uses `category: 'public-realm'`; `subcategory` is one of `surface`, `access`, `furniture`, `vegetation`, `parking`, `public-space`. Directional entries get orientations 0–3. Symmetric entries get orientation 0 plus tag `symmetric`. All entries include `north-american` and `pass-b2` tags.

Compose:

```ts
export const PASS_B2_COMPOSED_ASSET_MANIFEST = composeAssetManifests(
  PASS_B1_COMPOSED_ASSET_MANIFEST,
  PASS_B2_ASSET_MANIFEST,
);
```

- [ ] **Step 4: Implement one-time asset catalog construction**

`PublicRealmAssetResolver.ts` exports:

```ts
export type PublicRealmAssetCatalog = Readonly<{
  byVariantKey: ReadonlyMap<string, readonly AssetManifestEntry[]>;
  bySubcategory: ReadonlyMap<string, readonly string[]>;
}>;

export function buildPublicRealmAssetCatalog(entries: readonly AssetManifestEntry[]): PublicRealmAssetCatalog;

export type PublicRealmVisualSelection = Readonly<{
  surface: readonly AssetManifestEntry[];
  vertical: readonly AssetManifestEntry[];
}>;

export function resolvePublicRealmVisual(
  descriptor: PublicRealmDescriptor,
  cameraTurns: AssetOrientation,
  catalog: PublicRealmAssetCatalog,
): PublicRealmVisualSelection;
```

`buildPublicRealmAssetCatalog()` filters `category === 'public-realm'` exactly once and freezes indexes by variant key/subcategory. `resolvePublicRealmVisual()` must never scan the full runtime manifest.

Use `selectWeightedVariantKey(descriptor.channelKeys.<channel>, candidates)` for stable family selection. Resolve directional variants with `rotateWorldFacing(descriptor.context.worldFacing, cameraTurns)` and `resolveVariantEntry()`.

Surface candidates:

```text
urban-core: realm_sidewalk_paver_01 | realm_plaza_concrete_01
main-street: realm_sidewalk_concrete_01 | realm_sidewalk_paver_01
residential-green: realm_sidewalk_concrete_01 | realm_grass_verge_01
suburban-auto-oriented: realm_permeable_pavers_01 | realm_grass_verge_01
industrial-logistics: realm_plaza_concrete_01 | realm_sidewalk_concrete_01
civic-public-space: realm_plaza_stone_01 | realm_plaza_concrete_01
```

Parking form mapping is exact: `driveway→realm_driveway_cut_01`, `surface-lot-edge→realm_parking_landscaped_edge_01` plus `realm_parking_surface_01`, `garage-entry→realm_garage_podium_entry_01` only for `podium_mixed_use` else `realm_garage_structured_entry_01`, `curbside-dressing→realm_curbside_cars_01`, `none→[]`.

Vegetation/furniture/public-space candidates must follow the approved profile taxonomy and be selected from the fixed family inventory above. Service-facility descriptors always receive no parking selection.

- [ ] **Step 5: Switch runtime composition and preserve B1 sub-contract tests**

`RuntimeAssetManifest.ts` becomes:

```ts
import type { AssetManifest } from './AssetTypes.ts';
import { PASS_B2_COMPOSED_ASSET_MANIFEST } from './PassB2AssetManifest.ts';
export const RUNTIME_ASSET_MANIFEST: AssetManifest = PASS_B2_COMPOSED_ASSET_MANIFEST;
```

Update `tests/isometric-b1-runtime.test.ts` to assert both layers:

```ts
assert.equal(PASS_B1_COMPOSED_ASSET_MANIFEST.entries.length, 299);
assert.equal(PASS_B1_COMPOSED_ASSET_MANIFEST.atlases.length, 9);
assert.equal(RUNTIME_ASSET_MANIFEST.entries.length, 389);
assert.equal(RUNTIME_ASSET_MANIFEST.atlases.length, 10);
```

Keep every existing B1 building-resolution assertion intact.

- [ ] **Step 6: Run focused tests and commit**

```bash
node --experimental-strip-types --test tests/isometric-assets.test.ts tests/isometric-b1-manifest.test.ts tests/isometric-b1-runtime.test.ts tests/isometric-b2-manifest.test.ts tests/isometric-b2-asset-resolver.test.ts
npm run typecheck
git add src/rendering/assets/PassB2AssetManifest.ts src/rendering/public-realm/PublicRealmAssetResolver.ts src/rendering/assets/RuntimeAssetManifest.ts tests/isometric-b1-runtime.test.ts tests/isometric-b2-manifest.test.ts tests/isometric-b2-asset-resolver.test.ts
git commit -m "feat: add B2 public realm manifest"
```

Expected: Pass A=161; B1 delta=138; B1 composed=299; B2 delta=90; runtime=389.

---

### Task 4: Deterministic `public_realm` SVG/PNG Atlas Pipeline

**Files:**
- Modify: `tools/isometric_art.py`
- Create/generated: `assets/source/public_realm.svg`
- Test: `tests/isometric-b2-manifest.test.ts`

**Interfaces:**
- Consumes: exact Task 3 declaration order.
- Produces: `build_svg_sheet('public_realm')`, committed SVG source contract, build-time PNG atlas.

- [ ] **Step 1: Add RED source-contract assertions**

Extend `tests/isometric-b2-manifest.test.ts` to read `assets/source/public_realm.svg` and require root `width="2048" height="1152"`. Read `tools/isometric_art.py` and require both the DIMS entry and builder dispatch string `public_realm`. Initial test must fail.

- [ ] **Step 2: Run RED checks**

```bash
node --experimental-strip-types --test tests/isometric-b2-manifest.test.ts
```

Expected: FAIL because the source/builder do not exist.

- [ ] **Step 3: Add the deterministic Python builder**

Append this exact dimension entry to the existing `DIMS` dictionary without replacing other entries:

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

Implement `public_realm()` in exactly the same 90-frame order as Task 3. Each sprite stays inside its 128×192 cell and follows the existing 2:1 North American lighting/material language. Directional families visibly differ by orientation; symmetric frames are authored once. Use generic fictional markings only—no trademarks or real-world logos.

End with:

```py
if slot != 90:
    raise AssertionError(f'public realm sheet expected 90 frames, got {slot}')
return _root('public_realm', body)
```

Add exactly this builder mapping to the existing `builders` dictionary:

```py
'public_realm': public_realm,
```

- [ ] **Step 4: Generate and prove byte stability**

```bash
python - <<'PY'
from pathlib import Path
from tools.isometric_art import build_svg_sheet
path = Path('assets/source/public_realm.svg')
path.write_text(build_svg_sheet('public_realm'), encoding='utf-8')
print(path, path.stat().st_size)
PY
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

Expected: source validation reports 10 atlas contracts; B2 PNG exists and is non-empty.

- [ ] **Step 6: Run tests and commit**

```bash
node --experimental-strip-types --test tests/isometric-b2-manifest.test.ts
npm run lint
git add tools/isometric_art.py assets/source/public_realm.svg tests/isometric-b2-manifest.test.ts
git commit -m "feat: generate B2 public realm atlas"
```

Do not commit `dist/` build output unless repository tracking policy changes independently.

---

### Task 5: Shared Scene Sprite Command Buffer

**Files:**
- Create: `src/rendering/passes/SceneSpriteCommand.ts`
- Create: `src/rendering/passes/SceneSpriteCommandBuffer.ts`
- Modify: `src/rendering/passes/ObjectRenderPass.ts`
- Test: `tests/isometric-b2-scene-order.test.ts`

**Interfaces:**
- Consumes: `DepthKey`, `AssetManifestEntry`, `AssetRegistry`, `SpritePainter`, `IsometricCamera`, culling helpers.
- Produces:
  - `SceneSpriteCommand`
  - `sortSceneSpriteCommands(commands): readonly SceneSpriteCommand[]`
  - `SceneSpriteCommandBuffer.draw(...)`
  - `ObjectRenderPass.collect(core, camera): readonly SceneSpriteCommand[]`

- [ ] **Step 1: Write RED scene-order tests**

Create a deterministic input-order test:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDepthKey } from '../src/rendering/passes/RenderOrder.ts';
import { sortSceneSpriteCommands } from '../src/rendering/passes/SceneSpriteCommand.ts';

test('scene command order is deterministic across contributor order', () => {
  const commands = [
    { depth: makeDepthKey('objects', 4, 4, 0, 'building:b'), assetId: 'b', x: 4, y: 4, label: 'B' },
    { depth: makeDepthKey('objects', 4, 5, 0, 'tree:a'), assetId: 't', x: 4, y: 5, label: 'T' },
    { depth: makeDepthKey('objects', 4, 4, 0, 'facility:a'), assetId: 'f', x: 4, y: 4, label: 'F' },
  ] as const;
  const forward = sortSceneSpriteCommands(commands).map((c) => c.depth.stableId);
  const reverse = sortSceneSpriteCommands([...commands].reverse()).map((c) => c.depth.stableId);
  assert.deepEqual(forward, reverse);
  assert.ok(forward.indexOf('tree:a') > forward.indexOf('building:b'));
});
```

Add a rear-tree fixture on the same `objects` layer proving it sorts before the building. Add a low-prop fixture proving a bench/bollard tagged as `low-props` remains below object-layer sprites by design.

Add a source guard requiring `ObjectRenderPass.collect(` and rejecting the old internal final paint loop.

- [ ] **Step 2: Run RED tests**

```bash
node --experimental-strip-types --test tests/isometric-b2-scene-order.test.ts
```

Expected: missing shared scene module/function or integration guard failure.

- [ ] **Step 3: Add shared command contract and buffer**

`SceneSpriteCommand.ts`:

```ts
import type { AssetManifestEntry } from '../assets/AssetTypes.ts';
import { compareDepthKeys, type DepthKey } from './RenderOrder.ts';

export type SceneSpriteCommand = Readonly<{
  depth: DepthKey; entry?: AssetManifestEntry; assetId: string;
  x: number; y: number; label: string; footprintWidth?: number; footprintHeight?: number;
}>;

export function sortSceneSpriteCommands(commands: readonly SceneSpriteCommand[]): readonly SceneSpriteCommand[] {
  return Object.freeze([...commands].sort((a, b) => compareDepthKeys(a.depth, b.depth)));
}
```

`SceneSpriteCommandBuffer.draw()` receives `ctx`, commands, camera, viewport, worldSize; sorts exactly once; computes tile center; applies existing projected-sprite culling when an entry exists; paints through one `SpritePainter` with current fallback labels/footprints.

- [ ] **Step 4: Refactor `ObjectRenderPass` to collect only**

Keep all current selection logic for canonical buildings, construction, service facilities, utilities, and forest trees. Replace its private command type with `SceneSpriteCommand` and return an unsorted array from:

```ts
collect(core: SimulationCore, camera: IsometricCamera): readonly SceneSpriteCommand[]
```

`ObjectRenderPass` must no longer own a `SpritePainter`, viewport culling, sort, or final paint loop. It must continue to build `CanonicalBuildingVisualIndex` once and must not call `getV2At()` per building.

- [ ] **Step 5: Run focused regressions and commit**

```bash
node --experimental-strip-types --test tests/isometric-b1-canonical-index.test.ts tests/isometric-b2-scene-order.test.ts
npm run typecheck
npm run lint
git add src/rendering/passes/SceneSpriteCommand.ts src/rendering/passes/SceneSpriteCommandBuffer.ts src/rendering/passes/ObjectRenderPass.ts tests/isometric-b2-scene-order.test.ts
git commit -m "refactor: share isometric scene command buffer"
```

Expected: B1 canonical-index guard and B2 scene-order tests PASS.

---

### Task 6: Public-Realm Render Pass, Runtime Wiring, Authority Firewall, and Performance Guard

**Files:**
- Create: `src/rendering/passes/PublicRealmRenderPass.ts`
- Modify: `src/rendering/WorldRenderer.ts`
- Modify: `tests/presentation-contract.test.ts`
- Test: `tests/isometric-b2-runtime.test.ts`
- Modify/Test: `tests/isometric-b2-performance.test.ts`

**Interfaces:**
- Consumes: `PublicRealmPresentationCache`, `PublicRealmAssetCatalog`, `resolvePublicRealmVisual`, `SceneSpriteCommandBuffer`, `ObjectRenderPass.collect()`.
- Produces:
  - `PublicRealmFrame = { presentation, visuals }`
  - `PublicRealmRenderPass.resolveFrame(core, camera): PublicRealmFrame`
  - `PublicRealmRenderPass.drawSurfaces(ctx, frame, camera, viewport, worldSize): void`
  - `PublicRealmRenderPass.collectVertical(frame, camera): readonly SceneSpriteCommand[]`
  - runtime order: ground → B2 surfaces → shared scene sprites → vehicles → overlays → selection.

- [ ] **Step 1: Write RED runtime/non-mutation tests**

Create `tests/isometric-b2-runtime.test.ts` with a real core. Build roads, zoning, at least one canonical building with populated floor uses, and a real `fire_station`. Snapshot roads, cadastre, buildings, services, treasury, traffic snapshot, utility snapshot, and save-facing state before/after `PublicRealmPresentationCache.resolve(core)` and assert deep equality.

Require a civic facility descriptor:

```ts
const snapshot = new PublicRealmPresentationCache().resolve(core);
assert.ok(snapshot.descriptors.some((descriptor) =>
  descriptor.profile === 'civic-public-space' && descriptor.context.kind === 'facility'));
```

Read all `src/rendering/public-realm/*.ts` and `PublicRealmRenderPass.ts` source text and reject `parkingCapacity`, `occupancy`, `parkingPrice`, `cruisingPenalty`, `Math.random`, `.random`, and `.getV2At(`.

- [ ] **Step 2: Run RED tests**

```bash
node --experimental-strip-types --test tests/isometric-b2-runtime.test.ts tests/isometric-b2-performance.test.ts tests/presentation-contract.test.ts
```

Expected: runtime integration guard fails because `PublicRealmRenderPass`/WorldRenderer wiring is absent.

- [ ] **Step 3: Implement `PublicRealmRenderPass` with one-time catalog**

Constructor:

```ts
export class PublicRealmRenderPass {
  private readonly cache = new PublicRealmPresentationCache();
  private readonly catalog: PublicRealmAssetCatalog;

  constructor(private readonly assets: AssetRegistry) {
    this.catalog = buildPublicRealmAssetCatalog(this.assets.query({ category: 'public-realm' }));
  }
}
```

`resolveFrame(core, camera)` calls `cache.resolve(core)` exactly once, then maps each descriptor through `resolvePublicRealmVisual(descriptor, camera.quarterTurns, catalog)`. Return a frozen frame object reused by both drawing methods.

`drawSurfaces()` never calls `cache.resolve()` itself. Draw flat sidewalk/plaza/curb/access/parking surfaces from the supplied frame. Use `frontageAnchor` for sidewalk/curb/access/curbside treatment and `siteAnchor` for plaza/surface-lot treatments. Cull before resolving/drawing where the frame already contains enough bounds information.

`collectVertical()` never calls `cache.resolve()` itself. Tall props that must participate in building/facility occlusion—trees, pedestrian/road lamps, parked-car dressing, garage entries, fountain/sculpture accents—use `makeDepthKey('objects', ...)`. Intentionally always-behind small props—benches, bollards, bins, low hedge/planter treatments—may use `low-props`. Both groups still enter the same shared command buffer. This resolves the approved foreground-tree occlusion requirement without making every small prop building-height.

Stable command IDs are `${descriptor.context.selectionKey}|${entry.assetId}`.

- [ ] **Step 4: Wire one frame snapshot through `WorldRenderer`**

Add:

```ts
private readonly publicRealm = new PublicRealmRenderPass(this.assets);
private readonly scene = new SceneSpriteCommandBuffer(this.assets);
```

In `draw()`:

```ts
this.ground.draw(this.ctx, core, this.camera, viewport);
const publicRealmFrame = this.publicRealm.resolveFrame(core, this.camera);
this.publicRealm.drawSurfaces(this.ctx, publicRealmFrame, this.camera, viewport, worldSize);
const sceneCommands = [
  ...this.objects.collect(core, this.camera),
  ...this.publicRealm.collectVertical(publicRealmFrame, this.camera),
];
this.scene.draw(this.ctx, sceneCommands, this.camera, viewport, worldSize);
```

Keep all vehicle renderers, overlays, and selection after the scene buffer with existing arguments. Preserve meter-space helpers, Urban Fabric overlay state/API, selected-parcel behavior, camera controls, and asset diagnostics.

- [ ] **Step 5: Strengthen the measurable O(N) regression gate**

`tests/isometric-b2-performance.test.ts` must prove:

```ts
for (let i = 0; i < 100; i += 1) cache.resolve(core);
assert.equal(buildCount, 1);
core.buildRoad([{x:8,y:5}], 'local');
cache.resolve(core);
assert.equal(buildCount, 2);
```

Add source guards rejecting full-manifest filtering inside `resolvePublicRealmVisual()` and rejecting direct `core.cadastre.list*`, `core.buildings.listV2()`, or `core.services.listFacilities()` loops inside `PublicRealmRenderPass.ts`. Those scans belong in fingerprint/index construction only.

- [ ] **Step 6: Extend presentation contract, run focused gates, commit**

```bash
node --experimental-strip-types --test tests/presentation-contract.test.ts tests/isometric-b1-canonical-index.test.ts tests/isometric-b1-runtime.test.ts tests/isometric-b2-*.test.ts
npm run typecheck
npm run lint
npm run assets:check
git add src/rendering/passes/PublicRealmRenderPass.ts src/rendering/WorldRenderer.ts tests/presentation-contract.test.ts tests/isometric-b2-runtime.test.ts tests/isometric-b2-performance.test.ts
git commit -m "feat: render deterministic B2 public realm"
```

Expected: no authoritative snapshot changes; runtime=389; B1 canonical lookup regression remains green.

---

### Task 7: Six-Profile Visual Smoke and B2 CI

**Files:**
- Create: `tests/smoke/isometric_b2_visual_smoke.py`
- Modify: `tests/smoke/isometric_b1_visual_smoke.py`
- Create: `.github/workflows/isometric-b2.yml`

**Interfaces:**
- Consumes: built `dist`, B2 runtime manifest, current browser fixture APIs.
- Produces: deterministic screenshots for all six profiles at multiple camera rotations and branch CI evidence.

- [ ] **Step 1: Write the B2 browser smoke**

Follow the B1 Playwright route/variance harness. Create runtime-reachable authoritative contexts:

```text
urban-core: podium_mixed_use canonical building
main-street: main_street_mixed_use canonical building
residential-green: cottage or rowhouse canonical building
suburban-auto-oriented: low-coverage commercial shop canonical building
industrial-logistics: logistics/heavy-industrial building or landfill
civic-public-space: real fire_station, police_station, clinic, or elementary_school service facility
```

Use real roads/zoning so cadastre produces actual `street-frontage` edges and `roadRef`s. Populate `BuildingV2.floors[].uses` in B2 fixtures; do not rely on entitlement fallback.

Browser evidence must assert:

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

Capture:

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

Before/after rotations, assert semantic profile and parking-form evidence is identical while directional entry orientations change correctly.

- [ ] **Step 2: Update B1 smoke semantics without weakening B1 visual assertions**

Import `PASS_B1_COMPOSED_ASSET_MANIFEST` inside the browser evidence and assert:

```py
assert evidence['b1_entries'] == 299
assert evidence['b1_atlases'] == 9
assert evidence['runtime_entries'] == 389
assert evidence['runtime_atlases'] == 10
```

Keep the three existing B1 screenshots and every mixed-use/condition key assertion unchanged.

- [ ] **Step 3: Build and run local visual gates**

```bash
npm run build
npm run test:smoke:isometric
python tests/smoke/isometric_b1_visual_smoke.py
python tests/smoke/isometric_b2_visual_smoke.py
```

Expected: Pass A, B1, and B2 visual smoke all PASS with no browser errors.

- [ ] **Step 4: Add `.github/workflows/isometric-b2.yml`**

Trigger on pushes to `feature/isometric-pass-b2-public-realm` and pull requests targeting `feature/isometric-pass-b1-urban-depth`. Use Node 22 and TypeScript 5.8.3.

Targeted job commands:

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

Add a B1 diagnostic-delta gate. Initialize `head_status=0` and `base_status=0`; fetch `origin/feature/isometric-pass-b1-urban-depth`; run `tsc --noEmit` on B2 head and an isolated B1 worktree; fail if green B1 becomes red or if a red B1 diagnostic set changes; allow B2 to clear inherited diagnostics.

Add a `b2-full` job that runs:

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

Because the pinned parent contains `tests/smoke/urban_fabric_smoke.py`, absence of that file after final integration is a failure, not a skip.

- [ ] **Step 5: Run workflow-equivalent local checks and commit**

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

Expected: all local branch-available gates PASS. `urban_fabric_smoke.py` becomes mandatory after Task 8 parent reconciliation.

---

### Task 8: Frozen-Parent Integration Freshness, Exact-Head Verification, Report, and Draft PR

**Files:**
- Modify only genuine conflict-resolved B1/B2 integration files if reconciliation requires them.
- Create: `docs/art/PASS_B2_REPORT.md`
- Modify: `docs/superpowers/plans/2026-08-26-isometric-pass-b2-public-realm.md` only to record execution completion after evidence exists.

**Interfaces:**
- Consumes: frozen Urban Fabric checkpoint `941a9d5261898b00af103bfd9797065975a660f2`, B1 branch, completed B2 branch.
- Produces: refreshed B1 ancestry, exact verified B2 implementation head, acceptance report, draft child PR. No merge to `main`.

- [ ] **Step 1: Reconfirm parent/B1 non-overlap before reconciliation**

```bash
git fetch origin feature/urban-fabric-2.0 feature/isometric-pass-b1-urban-depth feature/isometric-pass-b2-public-realm
git diff --name-only 1c1479bdad0a7be6db16263128f5aee38dccdc44..941a9d5261898b00af103bfd9797065975a660f2 | sort > /tmp/parent-late-files.txt
git diff --name-only 1c1479bdad0a7be6db16263128f5aee38dccdc44..ea294c07b1bf3d0f3b324c48499915f3883c4c6e | sort > /tmp/b1-files.txt
comm -12 /tmp/parent-late-files.txt /tmp/b1-files.txt
```

Expected at the pinned baseline: no output. If overlap appears because upstream history changed, stop reconciliation and handle it as a real compatibility defect; do not force a merge.

- [ ] **Step 2: Refresh B1 onto the frozen parent checkpoint without rewriting history**

Execution must use the worktree prepared by the execution skill. In the B1 worktree:

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

Expected: every command PASS before B1 is pushed. If B1 smoke still expects runtime 299 on its own branch, that remains correct because B2 code is not present there.

- [ ] **Step 3: Merge refreshed B1 ancestry into B2 without rewriting B2 history**

In the B2 execution worktree, locate its root rather than relying on a placeholder path:

```bash
git fetch origin feature/isometric-pass-b1-urban-depth
B2_ROOT="$(git rev-parse --show-toplevel)"
cd "$B2_ROOT"
git checkout feature/isometric-pass-b2-public-realm
git merge --no-ff origin/feature/isometric-pass-b1-urban-depth -m "Merge refreshed B1 baseline for B2 integration"
```

Resolve only genuine overlapping rendering/test/documentation files. Preserve all parent UI, Save V9, Urban Fabric, property-market, and simulation authority behavior. Never resolve by deleting parent authority code or weakening tests.

- [ ] **Step 4: Run exact implementation-head acceptance suite**

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

Expected: every command PASS.

- [ ] **Step 5: Verify final B2 delta scope**

```bash
git fetch origin feature/isometric-pass-b1-urban-depth
git diff --name-only origin/feature/isometric-pass-b1-urban-depth..HEAD | sort
```

Allowed delta: B2 art/rendering/tests/workflow/spec/plan/report plus the inherited B1 regression-test semantic updates described in this plan. There must be no change to save serialization, `SimulationCore`, service simulation, traffic economics, treasury, zoning legality, property-market authority, or a parking simulation owner.

- [ ] **Step 6: Push implementation head and require exact-head CI**

```bash
git push origin feature/isometric-pass-b2-public-realm
VERIFIED_B2_IMPLEMENTATION_SHA="$(git rev-parse HEAD)"
printf '%s\n' "$VERIFIED_B2_IMPLEMENTATION_SHA" > /tmp/b2-verified-implementation-sha.txt
```

Require both `Isometric Pass B2 Targeted CI` and the B2 full job to succeed on the SHA stored in `/tmp/b2-verified-implementation-sha.txt`. Record their numeric GitHub Actions run IDs from the successful exact-head runs before writing the report.

- [ ] **Step 7: Write the acceptance report using captured evidence**

Set concrete shell values from the exact repository/CI evidence:

```bash
REFRESHED_B1_SHA="$(git rev-parse origin/feature/isometric-pass-b1-urban-depth)"
VERIFIED_B2_IMPLEMENTATION_SHA="$(cat /tmp/b2-verified-implementation-sha.txt)"
```

Create `docs/art/PASS_B2_REPORT.md` with the literal SHAs from those variables and the literal numeric run IDs from Step 6. The report must include:

```text
Frozen Urban Fabric checkpoint: 941a9d5261898b00af103bfd9797065975a660f2
Refreshed B1 head: the exact value of REFRESHED_B1_SHA
Verified B2 implementation head: the exact value of VERIFIED_B2_IMPLEMENTATION_SHA
Pass A entries: 161
Pass B1 delta: 138
B2 delta: 90
Runtime entries: 389
Runtime atlases: 10
B2 atlas: public_realm (2048×1152)
Targeted CI run: numeric run ID and success
Full CI run: numeric run ID and success
Visual smoke: 8 B2 scenes plus inherited Pass A/B1 smoke, success
Deferred authority: Transportation 3R.6 owns parking spaces, prices, occupancy, cruising, and generalized-cost effects.
```

The report deliberately records the **verified implementation head**, not its own future documentation commit SHA; embedding a document's own commit SHA is self-referential and cannot reach a fixed value. The eventual draft PR body records the final branch/documentation head and its CI status separately.

- [ ] **Step 8: Mark plan complete and commit acceptance documentation**

Add this execution-status line directly below the plan title:

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

Wait for targeted and full B2 CI to succeed on `FINAL_B2_BRANCH_SHA`. Do not rewrite the report merely to embed this documentation commit; record this final branch SHA and its two successful run IDs in the PR body.

- [ ] **Step 9: Create the draft child PR and leave it unmerged**

Create a draft PR with:

```text
head: feature/isometric-pass-b2-public-realm
base: feature/isometric-pass-b1-urban-depth
title: Isometric Pass B2 — Parking & Public Realm
```

The body must contain the literal final branch SHA from `/tmp/b2-final-branch-sha.txt`, the two exact successful run IDs for that SHA, the 90-entry B2 delta, 389-entry runtime total, six profiles, parking authority firewall, shared scene buffer, frozen parent checkpoint, and a statement that the PR is draft/unmerged. Do not merge or mark ready without explicit user authorization.

## Plan Self-Review Gate

Before implementation begins, run this review against the plan and spec:

```bash
PLAN=docs/superpowers/plans/2026-08-26-isometric-pass-b2-public-realm.md
SPEC=docs/superpowers/specs/2026-08-26-isometric-pass-b2-public-realm-design.md
! grep -En 'TBD|TODO|<actual|<b2-worktree>|implement later|Similar to Task|existing entries\.\.\.' "$PLAN"
grep -q '90 manifest entries' "$PLAN"
grep -q '389 runtime entries' "$PLAN"
grep -q 'Transportation 3R.6' "$PLAN"
grep -q 'civic-public-space' "$PLAN"
grep -q 'PublicRealmPresentationCache' "$PLAN"
grep -q 'SceneSpriteCommandBuffer' "$PLAN"
test -s "$SPEC"
```

Spec-coverage mapping:

- authority boundary + parking firewall → Tasks 1, 2, 6, 8;
- six profiles + exact precedence → Tasks 1, 7;
- deterministic independent visual channels → Tasks 1, 3;
- 70–90 approved asset budget concretized to 90 + one atlas → Tasks 3, 4;
- context index/cache and no O(N²) hot path → Tasks 2, 6;
- surface-before-object and shared depth ordering → Tasks 5, 6;
- Pass A/B1 compatibility → Tasks 3, 5, 7, 8;
- visual smoke and CI → Tasks 7, 8;
- final report and draft/unmerged integration → Task 8.

Type consistency checks:

- Task 1 types are owned/imported from `PublicRealmTypes.ts`.
- Task 2 produces `PublicRealmPresentationSnapshot`; Task 6 consumes it only through `PublicRealmFrame`.
- Task 3 produces `PublicRealmAssetCatalog`; Task 6 constructs it once and reuses it.
- Task 5 produces `SceneSpriteCommand`; Task 6 contributes B2 commands of that exact type.
- `WorldRenderer` resolves B2 state once per frame and supplies the same frame to surface and vertical rendering.
- Tall B2 props use `objects` depth when cross-building occlusion is required; only intentionally always-behind small props use `low-props`.
