# Civic Foundry — Urban Fabric 2.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the runtime one-cell lot model with a deterministic cadastral/topological urban fabric that supports dimensional zoning, mixed-use massing, building lifecycle, highest-and-best-use redevelopment, parcel subdivision/assembly, V8 saves, and player-facing diagnostics.

**Architecture:** `CadastralGraph` becomes the canonical land representation while `LotSystem` survives only as a temporary compatibility facade. Geometry is expressed in world meters, normalized to centimeter precision, with polygon boolean/offset operations isolated behind `Geometry.ts`; zoning, buildings, economics, save migration, rendering, and UI consume narrow parcel/building interfaces rather than geometry internals. Each vertical slice preserves determinism and repository-wide compatibility before the next slice replaces more legacy consumers.

**Tech Stack:** TypeScript ES2022, strict `tsc`, Node built-in test runner, browser Canvas 2D/isometric renderer, `clipper2-ts@2.0.1-18` for polygon clipping/offsetting, Python smoke tests.

**Spec:** `docs/superpowers/specs/2026-08-25-urban-fabric-2.0-design.md`

## Global Constraints

- Work on `feature/urban-fabric-2.0`; use an isolated worktree when execution begins.
- Keep simulation deterministic for identical seed + inputs; never use `Math.random()` in urban-fabric code.
- Canonical geometry coordinates are meters; normalize topology identity to 0.01 m (centimeter) precision.
- Legacy grid conversion uses `LEGACY_CELL_SIZE_METERS = 20` and converts cell `(x, y)` to `[x*20,(x+1)*20] × [y*20,(y+1)*20]`.
- Geometry errors fail closed. No cadastral mutation may partially modify canonical state.
- `SimulationCore.ts` orchestrates systems; it must not contain polygon algorithms, setback math, or lifecycle formulas.
- Existing runtime consumers may read parcel-derived `Lot` compatibility views during migration, but `LotSystem` must never become a second source of truth.
- Existing fixed building definitions remain compatibility typology seeds; new buildings derive capacity from realized floor area.
- Existing occupied structures may become legal nonconforming after rezoning; rezoning never deletes them.
- Redevelopment must handle resident/tenant displacement before demolition.
- Save output becomes `saveVersion: 8`, `gameVersion: '0.8.0-urban-fabric'`; V7 and older supported saves remain loadable through deterministic migration.
- Full merge gate: `npm test`, `npm run typecheck`, `npm run lint`, `npm run assets:check`, `npm run build`, `npm run test:smoke`, `npm run test:smoke:phase7`, `npm run test:smoke:isometric`, and the new Urban Fabric smoke test all pass.

---

## File Structure Map

### New geometry/cadastre files
- `src/world/cadastre/Geometry.ts` — coordinate normalization and polygon boolean/offset wrappers.
- `src/world/cadastre/CadastralTypes.ts` — graph DTOs, IDs, snapshots, mutation results.
- `src/world/cadastre/CadastralGraph.ts` — authoritative node/edge/block/parcel/easement state and queries.
- `src/world/cadastre/CadastralValidator.ts` — graph/topology invariants.
- `src/world/cadastre/ParcelGenerationSystem.ts` — roads/zoning/legacy-grid to initial blocks and parcels.
- `src/world/cadastre/ParcelLineage.ts` — immutable split/assembly history and ID generation.
- `src/world/cadastre/CadastralMutationSystem.ts` — atomic split/assembly/right-of-way/easement mutations.

### New/extended zoning files
- `src/simulation/zoning/ZoningTypes.ts` — district, overlay, edge-role, envelope/compliance types.
- `src/simulation/zoning/ZoningDistrictCatalog.ts` — deterministic base district definitions and legacy-zone mapping.
- `src/simulation/zoning/BuildableEnvelopeSystem.ts` — setback/FAR/coverage/height capacity.
- `src/simulation/zoning/ZoningComplianceSystem.ts` — validates realized project massing/uses.
- `src/simulation/zoning/ZoningSystem.ts` — transition from cell paint to parcel district assignment while retaining legacy paint compatibility.

### New/extended building files
- `src/simulation/buildings/BuildingTypes.ts` — physical building/floor/use/lifecycle/project DTOs.
- `src/data/buildingTypologies.ts` — typology catalog derived from existing building definitions.
- `src/simulation/buildings/BuildingMassingSystem.ts` — finite deterministic candidate generation.
- `src/simulation/buildings/BuildingMetrics.ts` — floor-area-derived capacity and utility/tax aggregates.
- `src/simulation/buildings/BuildingLifecycleSystem.ts` — aging, maintenance, vacancy, distress.
- `src/simulation/buildings/RenovationSystem.ts` — light/major/gut rehab, adaptive reuse economics/state.
- `src/simulation/buildings/BuildingSystem.ts` — canonical V2 buildings plus temporary legacy entrypoints.

### New/extended development files
- `src/simulation/development/DevelopmentTypes.ts` — physical candidate + parcel underwriting interfaces.
- `src/simulation/development/DevelopmentFeasibilitySystem.ts` — actual floor-area/site-based pro forma.
- `src/simulation/development/HighestBestUseSystem.ts` — hold/renovate/convert/redevelop/assemble comparison.
- `src/simulation/development/PropertyMarketSystem.ts` — ownership, reservation price, transactions.
- `src/simulation/development/SiteAssemblySystem.ts` — contiguous-site candidate discovery and acquisition math.
- `src/simulation/development/RedevelopmentPressureSystem.ts` — explainable diagnostic only.
- `src/simulation/development/RedevelopmentExecutionSystem.ts` — relocation/demolition/construction state transitions.

### Save/presentation integration
- `src/save/saveV8.ts` — canonical V8 serializer/hydrator and V7 migration.
- `src/save/save.ts` — default serializer/hydrator delegates to V8.
- `src/rendering/CadastralOverlayLayer.ts` — parcel/block/frontage display.
- `src/rendering/ZoningEnvelopeLayer.ts` — setbacks/buildable envelope/max-volume diagnostics.
- `src/rendering/passes/ObjectRenderPass.ts` — generated footprint/massing render proxies.
- `src/rendering/OverlayRenderPass.ts` — Urban Fabric overlays.
- `src/rendering/WorldRenderer.ts` — parcel selection/world-meter projection facade.
- `src/ui/ParcelInspector.ts` — parcel/HBU diagnostic model and HTML.
- `src/ui/Inspector.ts` — route parcel selections to `ParcelInspector`.
- `src/ui/ToolController.ts` — district selection and parcel-aware land tools.
- `src/styles.css` — cadastral/inspector controls.

---

### Task 1: Deterministic Geometry Kernel

**Files:**
- Modify: `package.json`
- Create: `src/world/cadastre/Geometry.ts`
- Test: `tests/urban-fabric-geometry.test.ts`

**Interfaces:**
- Consumes: `clipper2-ts@2.0.1-18`.
- Produces: `WorldPoint`, `PolygonRing`, `MultiPolygon`, `LEGACY_CELL_SIZE_METERS`, `normalizePoint()`, `normalizeRing()`, `polygonArea()`, `polygonCentroid()`, `pointInPolygon()`, `polygonUnion()`, `polygonIntersection()`, `polygonDifference()`, `offsetPolygon()`.

- [ ] **Step 1: Add the geometry dependency and failing tests**

Run:

```bash
npm install clipper2-ts@2.0.1-18
```

Create tests covering centimeter normalization, area, centroid, boolean union/difference, negative offset, and point inclusion:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LEGACY_CELL_SIZE_METERS,
  normalizePoint,
  polygonArea,
  polygonCentroid,
  polygonDifference,
  offsetPolygon,
} from '../src/world/cadastre/Geometry.ts';

const square = [
  { x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 },
] as const;

test('geometry normalizes to centimeter precision', () => {
  assert.deepEqual(normalizePoint({ x: 1.2349, y: 8.7651 }), { x: 1.23, y: 8.77 });
  assert.equal(LEGACY_CELL_SIZE_METERS, 20);
});

test('square geometry has stable area centroid and inset', () => {
  assert.equal(polygonArea(square), 400);
  assert.deepEqual(polygonCentroid(square), { x: 10, y: 10 });
  const inset = offsetPolygon(square, -2);
  assert.equal(inset.length, 1);
  assert.equal(Math.round(polygonArea(inset[0]!) * 100) / 100, 256);
});

test('polygon difference preserves deterministic land area', () => {
  const cut = [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 20 }, { x: 0, y: 20 }] as const;
  const remainder = polygonDifference(square, cut);
  assert.equal(remainder.reduce((sum, ring) => sum + polygonArea(ring), 0), 300);
});
```

- [ ] **Step 2: Run the focused test and verify failure**

Run:

```bash
node --experimental-strip-types --test tests/urban-fabric-geometry.test.ts
```

Expected: FAIL because `src/world/cadastre/Geometry.ts` does not exist.

- [ ] **Step 3: Implement the wrapper with fixed integer scaling**

Use this public contract:

```ts
export const LEGACY_CELL_SIZE_METERS = 20;
const GEOMETRY_SCALE = 100;

export type WorldPoint = Readonly<{ x: number; y: number }>;
export type PolygonRing = readonly WorldPoint[];
export type MultiPolygon = readonly PolygonRing[];

export function normalizePoint(point: WorldPoint): WorldPoint {
  return Object.freeze({
    x: Math.round(point.x * GEOMETRY_SCALE) / GEOMETRY_SCALE,
    y: Math.round(point.y * GEOMETRY_SCALE) / GEOMETRY_SCALE,
  });
}
```

All Clipper calls must convert meters to integer centimeters before calling `union`, `difference`, `intersect`, or `inflatePaths`, then convert outputs back to normalized meters. Sort output rings by descending absolute area and then lexicographically by their first normalized vertex so serialization never depends on library iteration order.

- [ ] **Step 4: Run focused tests and typecheck**

Run:

```bash
node --experimental-strip-types --test tests/urban-fabric-geometry.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/world/cadastre/Geometry.ts tests/urban-fabric-geometry.test.ts
git commit -m "feat: add deterministic cadastral geometry kernel"
```

---

### Task 2: Cadastral Types, Graph, and Validator

**Files:**
- Create: `src/world/cadastre/CadastralTypes.ts`
- Create: `src/world/cadastre/CadastralGraph.ts`
- Create: `src/world/cadastre/CadastralValidator.ts`
- Test: `tests/urban-fabric-cadastre.test.ts`

**Interfaces:**
- Consumes: `WorldPoint`, `PolygonRing` from `Geometry.ts`.
- Produces: `ParcelNode`, `ParcelEdge`, `Parcel`, `UrbanBlock`, `Easement`, `ParcelLineageEvent`, `CadastralSnapshot`; class `CadastralGraph`; `validateCadastralGraph(graph): CadastralValidationResult`.

- [ ] **Step 1: Write graph behavior tests**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { CadastralGraph } from '../src/world/cadastre/CadastralGraph.ts';
import { validateCadastralGraph } from '../src/world/cadastre/CadastralValidator.ts';

const snapshot = {
  nodes: [
    { id: 'n0', point: { x: 0, y: 0 } }, { id: 'n1', point: { x: 20, y: 0 } },
    { id: 'n2', point: { x: 20, y: 20 } }, { id: 'n3', point: { x: 0, y: 20 } },
  ],
  edges: [
    { id: 'e0', fromNodeId: 'n0', toNodeId: 'n1', leftParcelId: 'p0', kind: 'street-frontage' as const, roadRef: '0,-1' },
    { id: 'e1', fromNodeId: 'n1', toNodeId: 'n2', leftParcelId: 'p0', kind: 'property-boundary' as const },
    { id: 'e2', fromNodeId: 'n2', toNodeId: 'n3', leftParcelId: 'p0', kind: 'property-boundary' as const },
    { id: 'e3', fromNodeId: 'n3', toNodeId: 'n0', leftParcelId: 'p0', kind: 'property-boundary' as const },
  ],
  blocks: [{ id: 'b0', boundary: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }], parcelIds: ['p0'], roadEdgeIds: ['e0'] }],
  parcels: [{ id: 'p0', blockId: 'b0', boundaryEdgeIds: ['e0', 'e1', 'e2', 'e3'], areaM2: 400, centroid: { x: 10, y: 10 }, frontageEdgeIds: ['e0'], accessEdgeIds: ['e0'], zoningDistrictId: 'R2', historicalParentIds: [] }],
  easements: [],
  lineage: [],
} as const;

test('cadastral graph round-trips a valid parcel', () => {
  const graph = new CadastralGraph(snapshot);
  assert.equal(graph.getParcel('p0')?.areaM2, 400);
  assert.deepEqual(graph.adjacentParcelIds('p0'), []);
  assert.deepEqual(validateCadastralGraph(graph), { valid: true, errors: [] });
  assert.deepEqual(graph.snapshot(), snapshot);
});

test('validator rejects orphaned edges and mismatched area', () => {
  const graph = new CadastralGraph({ ...snapshot, parcels: [{ ...snapshot.parcels[0], areaM2: 399 }] });
  const result = validateCadastralGraph(graph);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.code === 'parcel-area-mismatch'));
});
```

- [ ] **Step 2: Verify failure**

```bash
node --experimental-strip-types --test tests/urban-fabric-cadastre.test.ts
```

Expected: FAIL because the cadastral classes/types do not exist.

- [ ] **Step 3: Implement immutable graph storage and invariant validation**

`CadastralGraph` must expose only copied/frozen DTOs:

```ts
export class CadastralGraph {
  constructor(snapshot?: CadastralSnapshot);
  getParcel(id: string): Parcel | undefined;
  getBlock(id: string): UrbanBlock | undefined;
  getEdge(id: string): ParcelEdge | undefined;
  getNode(id: string): ParcelNode | undefined;
  parcelPolygon(id: string): PolygonRing;
  adjacentParcelIds(id: string): readonly string[];
  listParcels(): readonly Parcel[];
  listBlocks(): readonly UrbanBlock[];
  snapshot(): CadastralSnapshot;
  replaceSnapshot(snapshot: CadastralSnapshot): void;
}
```

`replaceSnapshot` validates before replacing internal maps. Validation checks missing references, zero-length edges, closed edge chains, self-intersection, overlap, block membership, symmetric adjacency, stored area tolerance `<= 0.01 m²`, frontage road references when present, and acyclic lineage.

- [ ] **Step 4: Run focused tests and strict compiler**

```bash
node --experimental-strip-types --test tests/urban-fabric-cadastre.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/world/cadastre/CadastralTypes.ts src/world/cadastre/CadastralGraph.ts src/world/cadastre/CadastralValidator.ts tests/urban-fabric-cadastre.test.ts
git commit -m "feat: add cadastral graph and topology validation"
```

---

### Task 3: Initial Parcel Generation and Legacy Lot Compatibility

**Files:**
- Create: `src/world/cadastre/ParcelGenerationSystem.ts`
- Modify: `src/world/lots/LotSystem.ts`
- Test: `tests/urban-fabric-parcel-generation.test.ts`
- Modify: `tests/city-foundation.test.ts`

**Interfaces:**
- Consumes: `TerrainGrid`, `RoadSystem`, legacy `ZoningSystem`, `CadastralGraph`.
- Produces: `ParcelGenerationSystem.rebuild(terrain, roads, zoning): CadastralSnapshot`; `LotSystem.rebuildFromCadastre(graph, legacyZoneResolver): void`.

- [ ] **Step 1: Write tests proving parcels are graph-derived and compatibility lots are views**

```ts
test('parcel generator converts road-bounded zoned land into cadastral parcels', () => {
  const terrain = TerrainGrid.generate(8, 6, 11);
  const roads = new RoadSystem(terrain);
  roads.place(0, 2, 'local'); roads.place(1, 2, 'local'); roads.place(2, 2, 'local'); roads.place(3, 2, 'local');
  const zoning = new ZoningSystem(terrain, roads);
  zoning.paint([{ x: 1, y: 1 }, { x: 2, y: 1 }], 'residential');
  const snapshot = new ParcelGenerationSystem().rebuild(terrain, roads, zoning);
  assert.ok(snapshot.blocks.length >= 1);
  assert.ok(snapshot.parcels.length >= 1);
  assert.ok(snapshot.parcels.every((parcel) => parcel.areaM2 > 0 && parcel.frontageEdgeIds.length > 0));
});

test('LotSystem is rebuilt from parcel state rather than zoning cells', () => {
  const graph = new CadastralGraph(snapshotFixture());
  const lots = new LotSystem();
  lots.rebuildFromCadastre(graph, () => 'residential');
  assert.equal(lots.list()[0]?.id, 'p0');
});
```

- [ ] **Step 2: Verify focused failure**

```bash
node --experimental-strip-types --test tests/urban-fabric-parcel-generation.test.ts
```

Expected: FAIL because `ParcelGenerationSystem` and `rebuildFromCadastre` do not exist.

- [ ] **Step 3: Implement deterministic block tracing and parcel creation**

Convert each buildable grid cell to a 20 m square polygon. Use polygon union to form connected road-bounded land regions, then derive blocks from connected components separated by road cells. Within a block, group adjacent zoned cells with the same legacy zone and compatible frontage into parcel polygons; cap a generated frontage group at two cells before beginning the next parcel so the runtime is no longer forced to one cell = one parcel. Trace external edges into shared `ParcelNode`/`ParcelEdge` objects and mark edges touching road-cell polygons as `street-frontage`.

`LotSystem` becomes:

```ts
export class LotSystem {
  private lots: Lot[] = [];

  rebuildFromCadastre(graph: CadastralGraph, legacyZoneResolver: (parcel: Parcel) => ZoneType): void {
    this.lots = graph.listParcels().map((parcel) => ({
      id: parcel.id,
      x: Math.floor(parcel.centroid.x / LEGACY_CELL_SIZE_METERS),
      y: Math.floor(parcel.centroid.y / LEGACY_CELL_SIZE_METERS),
      zone: legacyZoneResolver(parcel),
      frontageRoadKey: firstRoadRef(graph, parcel),
    })).filter((lot): lot is Lot => lot.frontageRoadKey !== undefined)
      .sort((a, b) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id));
  }

  list(): Lot[] { return this.lots.map((lot) => ({ ...lot })); }
}
```

Keep the old `rebuild(roads, zoning)` only as a deprecated test/save migration adapter until Task 13 removes runtime calls.

- [ ] **Step 4: Run parcel and foundation regressions**

```bash
node --experimental-strip-types --test tests/urban-fabric-parcel-generation.test.ts tests/city-foundation.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/world/cadastre/ParcelGenerationSystem.ts src/world/lots/LotSystem.ts tests/urban-fabric-parcel-generation.test.ts tests/city-foundation.test.ts
git commit -m "feat: generate cadastral parcels with lot compatibility views"
```

---

### Task 4: Dimensional Zoning District Model

**Files:**
- Create: `src/simulation/zoning/ZoningTypes.ts`
- Create: `src/simulation/zoning/ZoningDistrictCatalog.ts`
- Modify: `src/simulation/zoning/ZoningSystem.ts`
- Test: `tests/urban-fabric-zoning.test.ts`

**Interfaces:**
- Produces: `UseType`, `ZoningDistrict`, `ZoningOverlay`, `ParcelZoningAssignment`, `ZoningSystem.assignParcel()`, `ZoningSystem.getParcelDistrictId()`, `districtForLegacyZone()`.

- [ ] **Step 1: Write district and parcel-assignment tests**

```ts
import { ZONING_DISTRICTS, districtForLegacyZone } from '../src/simulation/zoning/ZoningDistrictCatalog.ts';

test('base catalog contains deterministic dimensional districts', () => {
  assert.equal(ZONING_DISTRICTS.MU8.maxFAR, 8);
  assert.equal(ZONING_DISTRICTS.MU8.maxHeightMeters, 90);
  assert.ok(ZONING_DISTRICTS.MU8.permittedUses.includes('residential'));
  assert.ok(ZONING_DISTRICTS.MU8.permittedUses.includes('retail'));
  assert.equal(districtForLegacyZone('residential').id, 'R2');
  assert.equal(districtForLegacyZone('commercial').id, 'C6');
  assert.equal(districtForLegacyZone('industrial').id, 'IND');
});

test('parcel zoning assignment is independent of legacy cell paint', () => {
  const zoning = new ZoningSystem(terrainFixture(), roadsFixture());
  zoning.assignParcel('parcel:1', 'MU4');
  assert.equal(zoning.getParcelDistrictId('parcel:1'), 'MU4');
});
```

- [ ] **Step 2: Verify failure**

```bash
node --experimental-strip-types --test tests/urban-fabric-zoning.test.ts
```

Expected: FAIL because zoning V2 types/catalog/parcel assignments do not exist.

- [ ] **Step 3: Implement the initial district catalog and dual-mode zoning state**

Use these exact initial districts:

```ts
export const ZONING_DISTRICTS = Object.freeze({
  R2: district('R2', ['residential'], 1.5, 12, 2, 0.55, 4, 5, 2, 250, 8),
  R5: district('R5', ['residential'], 4, 30, 8, 0.70, 2, 4, 1.5, 180, 7),
  MU4: district('MU4', ['residential', 'retail', 'office', 'hospitality'], 4, 30, 8, 0.75, 0, 3, 0, 150, 6),
  MU8: district('MU8', ['residential', 'retail', 'office', 'hospitality'], 8, 90, 25, 0.80, 0, 3, 0, 250, 10),
  C6: district('C6', ['retail', 'office', 'hospitality'], 6, 60, 16, 0.80, 0, 3, 0, 180, 8),
  IND: district('IND', ['light-industrial', 'heavy-industrial', 'logistics'], 2, 24, 5, 0.80, 5, 5, 3, 500, 15),
});
```

`ZoningSystem` stores `Map<parcelId, districtId>` alongside legacy cell paint. `restoreParcelAssignments()` rejects unknown districts. Legacy paint remains unchanged for old UI/save consumers until Task 13.

- [ ] **Step 4: Run zoning + legacy regression tests**

```bash
node --experimental-strip-types --test tests/urban-fabric-zoning.test.ts tests/core-city-loop.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/simulation/zoning/ZoningTypes.ts src/simulation/zoning/ZoningDistrictCatalog.ts src/simulation/zoning/ZoningSystem.ts tests/urban-fabric-zoning.test.ts
git commit -m "feat: add parcel dimensional zoning districts"
```

---

### Task 5: Buildable Envelopes and Zoning Compliance

**Files:**
- Create: `src/simulation/zoning/BuildableEnvelopeSystem.ts`
- Create: `src/simulation/zoning/ZoningComplianceSystem.ts`
- Modify: `src/simulation/zoning/ZoningTypes.ts`
- Test: `tests/urban-fabric-envelope.test.ts`

**Interfaces:**
- Consumes: parcel polygon/topology, `ZoningDistrict`, overlays.
- Produces: `ParcelDevelopmentEnvelope`, `ZoningComplianceResult`, `BuildableEnvelopeSystem.evaluate(parcelId, graph, district, overlays)`, `ZoningComplianceSystem.evaluate(candidate, envelope)`.

- [ ] **Step 1: Write dimensional-envelope tests**

```ts
test('setbacks coverage height and FAR constrain a parcel envelope', () => {
  const envelope = system.evaluate('p0', graph20x20Fixture(), {
    ...ZONING_DISTRICTS.MU4,
    maxFAR: 2,
    maxHeightMeters: 18,
    maxCoverageRatio: 0.5,
    frontSetbackMeters: 2,
    rearSetbackMeters: 2,
    sideSetbackMeters: 2,
  }, []);
  assert.equal(envelope.parcelAreaM2, 400);
  assert.ok(envelope.maxFootprintAreaM2 <= 200);
  assert.equal(envelope.maxGrossFloorAreaM2, 800);
  assert.equal(envelope.maxHeightMeters, 18);
});

test('compliance reports exact dimensional violations', () => {
  const result = compliance.evaluate(candidateFixture({ realizedFAR: 4.2, heightMeters: 35 }), envelopeFixture({ effectiveFAR: 4, maxHeightMeters: 30 }));
  assert.equal(result.legal, false);
  assert.deepEqual(result.violations.map((v) => v.code).sort(), ['far', 'height']);
});
```

- [ ] **Step 2: Verify failure**

```bash
node --experimental-strip-types --test tests/urban-fabric-envelope.test.ts
```

Expected: FAIL because envelope/compliance systems do not exist.

- [ ] **Step 3: Implement edge-role setbacks and capacity math**

Classify every `street-frontage` edge as `front`. Choose the non-front edge whose midpoint has the greatest perpendicular distance from the longest front edge as `rear`; remaining property edges are `side`. Build exclusion strips inward from each edge using its applicable setback and subtract their union from the parcel polygon. If the subtraction produces multiple polygons, select the largest connected polygon and emit a `disconnected-envelope` limiting constraint.

Apply:

```ts
const zoningFloorArea = parcel.areaM2 * district.maxFAR;
const coverageFloorplate = parcel.areaM2 * district.maxCoverageRatio;
const geometryFloorplate = polygonArea(buildableFootprint);
const maxFootprintAreaM2 = Math.min(coverageFloorplate, geometryFloorplate);
const heightStories = Math.max(1, Math.floor(district.maxHeightMeters / 3.2));
const storyLimit = Math.min(heightStories, district.maxStories ?? heightStories);
const heightFloorArea = maxFootprintAreaM2 * storyLimit;
const maxGrossFloorAreaM2 = Math.min(zoningFloorArea, heightFloorArea);
const effectiveFAR = parcel.areaM2 > 0 ? maxGrossFloorAreaM2 / parcel.areaM2 : 0;
```

Compliance verifies footprint containment, `realizedFAR`, `coverageRatio`, `heightMeters`, stories, and use permissions.

- [ ] **Step 4: Run envelope tests and typecheck**

```bash
node --experimental-strip-types --test tests/urban-fabric-envelope.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/simulation/zoning/BuildableEnvelopeSystem.ts src/simulation/zoning/ZoningComplianceSystem.ts src/simulation/zoning/ZoningTypes.ts tests/urban-fabric-envelope.test.ts
git commit -m "feat: compute dimensional zoning envelopes"
```

---

### Task 6: Physical Building Types, Typologies, Massing, and Metrics

**Files:**
- Create: `src/simulation/buildings/BuildingTypes.ts`
- Create: `src/data/buildingTypologies.ts`
- Create: `src/simulation/buildings/BuildingMassingSystem.ts`
- Create: `src/simulation/buildings/BuildingMetrics.ts`
- Modify: `src/simulation/buildings/BuildingSystem.ts`
- Modify: `src/data/buildings.ts`
- Test: `tests/urban-fabric-buildings.test.ts`

**Interfaces:**
- Produces: `BuildingV2`, `BuildingFloor`, `FloorUseAllocation`, `BuildingTypology`, `DevelopmentCandidate`, `BuildingMetrics`; `BuildingMassingSystem.generate(parcel, envelope, typologies): readonly DevelopmentCandidate[]`; `calculateBuildingMetrics(building, typology)`.

- [ ] **Step 1: Write mixed-use and massing tests**

```ts
test('massing generator returns deterministic legal candidates', () => {
  const candidatesA = new BuildingMassingSystem().generate(parcelFixture(), envelopeFixture(), [typologyFixture()]);
  const candidatesB = new BuildingMassingSystem().generate(parcelFixture(), envelopeFixture(), [typologyFixture()]);
  assert.deepEqual(candidatesA, candidatesB);
  assert.ok(candidatesA.length >= 3);
  assert.ok(candidatesA.every((candidate) => candidate.realizedFAR <= envelopeFixture().effectiveFAR));
});

test('mixed-use metrics derive units and jobs from floor area', () => {
  const building = mixedUseBuildingFixture();
  const metrics = calculateBuildingMetrics(building, mixedUseTypologyFixture());
  assert.ok(metrics.residentialUnits > 0);
  assert.ok(metrics.jobCapacity > 0);
  assert.equal(metrics.floorAreaByUse.residential + metrics.floorAreaByUse.retail, building.usableFloorAreaM2);
});
```

- [ ] **Step 2: Verify failure**

```bash
node --experimental-strip-types --test tests/urban-fabric-buildings.test.ts
```

Expected: FAIL because physical building types and massing do not exist.

- [ ] **Step 3: Implement typology-backed finite massing**

Define `BuildingV2` with `parcelIds`, footprint, gross/usable floor area, height, stories, realized FAR, coverage, floors, status, entitlement, lifecycle, owner/developer/project cost. Do not duplicate `condition` or `maintenanceBacklog` outside `lifecycle`.

Generate strategies with deterministic target utilization ratios `[0.55, 0.75, 0.90, 1.00]` of effective FAR. For each strategy, choose footprint area `min(maxFootprint, targetGFA / preferredStories)`, derive stories, clamp to height/story limits, create floor allocations according to the typology's allowed use mix, then run `ZoningComplianceSystem` and keep legal candidates. Deduplicate candidates by normalized `(typologyId, stories, footprintArea, useMix)`.

Existing `BUILDING_VARIANTS` map into typology seeds using their construction cost, rent, utility, and capacity ratios; retain old exports for legacy tests.

- [ ] **Step 4: Run building and old development catalog tests**

```bash
node --experimental-strip-types --test tests/urban-fabric-buildings.test.ts tests/development-feasibility.test.ts
npm run typecheck
```

Expected: PASS, with old catalog tests still green through compatibility exports.

- [ ] **Step 5: Commit**

```bash
git add src/simulation/buildings/BuildingTypes.ts src/data/buildingTypologies.ts src/simulation/buildings/BuildingMassingSystem.ts src/simulation/buildings/BuildingMetrics.ts src/simulation/buildings/BuildingSystem.ts src/data/buildings.ts tests/urban-fabric-buildings.test.ts
git commit -m "feat: add physical mixed-use building massing"
```

---

### Task 7: Physical Development Feasibility and Developer-Market Adapter

**Files:**
- Modify: `src/simulation/development/DevelopmentTypes.ts`
- Modify: `src/simulation/development/DevelopmentFeasibilitySystem.ts`
- Modify: `src/simulation/development/DeveloperMarketSystem.ts`
- Test: `tests/urban-fabric-development.test.ts`
- Modify: `tests/development-feasibility.test.ts`
- Modify: `tests/developer-market.test.ts`

**Interfaces:**
- Produces: `PhysicalDevelopmentContext`, `PhysicalDevelopmentFeasibilityResult`, `DevelopmentFeasibilitySystem.evaluateCandidate(candidate, parcel, context)`.
- Keeps temporarily: `evaluateLot(lot, definitions, legacyContext)` implemented as a compatibility adapter.

- [ ] **Step 1: Write a physical pro-forma test**

```ts
test('larger legal mixed-use massing changes revenue cost and return from actual floor area', () => {
  const system = new DevelopmentFeasibilitySystem();
  const small = system.evaluateCandidate(candidateFixture({ grossFloorAreaM2: 2000, usableFloorAreaM2: 1600 }), parcelFixture(), contextFixture());
  const large = system.evaluateCandidate(candidateFixture({ grossFloorAreaM2: 4000, usableFloorAreaM2: 3200 }), parcelFixture(), contextFixture());
  assert.ok(large.hardConstructionCost > small.hardConstructionCost);
  assert.ok(large.grossPotentialRent > small.grossPotentialRent);
  assert.equal(large.legal, true);
});

test('illegal zoning candidate is rejected before bidding', () => {
  const result = new DevelopmentFeasibilitySystem().evaluateCandidate(candidateFixture({ zoningLegal: false }), parcelFixture(), contextFixture());
  assert.equal(result.legal, false);
  assert.ok(result.rejectionReasons.includes('zoning-compliance'));
});
```

- [ ] **Step 2: Verify failure**

```bash
node --experimental-strip-types --test tests/urban-fabric-development.test.ts
```

Expected: FAIL because `evaluateCandidate` does not exist.

- [ ] **Step 3: Implement floor-area/site underwriting and adapter**

Calculate hard construction cost from `candidate.grossFloorAreaM2 * typology.costPerM2 * constructionCostIndex`; rentable revenue from each `FloorUseAllocation` using use-specific market rent; property taxes from land + improvement value; demolition/relocation/site costs supplied by context; financing from construction duration and developer leverage. Preserve current `DevelopmentBid`/`DevelopmentAward` identifiers while changing `lotId` semantics to a generic `siteId` internally; keep serialized legacy fields until V8 migration.

`evaluateLot()` creates a compatibility candidate from the old fixed building definition and forwards it to `evaluateCandidate()` so existing tests prove parity during transition.

- [ ] **Step 4: Run old and new underwriting/market tests**

```bash
node --experimental-strip-types --test tests/urban-fabric-development.test.ts tests/development-feasibility.test.ts tests/developer-market.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/simulation/development/DevelopmentTypes.ts src/simulation/development/DevelopmentFeasibilitySystem.ts src/simulation/development/DeveloperMarketSystem.ts tests/urban-fabric-development.test.ts tests/development-feasibility.test.ts tests/developer-market.test.ts
git commit -m "feat: underwrite physical development candidates"
```

---

### Task 8: Building Lifecycle, Maintenance, Vacancy, and Distress

**Files:**
- Create: `src/simulation/buildings/BuildingLifecycleSystem.ts`
- Modify: `src/simulation/buildings/BuildingTypes.ts`
- Modify: `src/simulation/buildings/BuildingSystem.ts`
- Test: `tests/urban-fabric-lifecycle.test.ts`

**Interfaces:**
- Produces: `BuildingLifecycleSystem.tick(building, typology, input): BuildingLifecycleState`; `requiredMaintenanceCost()`; `conditionRentFactor()`.

- [ ] **Step 1: Write directional lifecycle tests**

```ts
test('adequate maintenance slows deterioration', () => {
  const lifecycle = new BuildingLifecycleSystem();
  const neglected = lifecycle.tick(buildingFixture(), typologyFixture(), lifecycleInput({ maintenanceSpend: 0 }));
  const maintained = lifecycle.tick(buildingFixture(), typologyFixture(), lifecycleInput({ maintenanceSpend: 50_000 }));
  assert.ok(maintained.condition > neglected.condition);
  assert.ok(maintained.maintenanceBacklog < neglected.maintenanceBacklog);
});

test('chronic vacancy raises distress deterministically', () => {
  let state = buildingFixture().lifecycle;
  for (let i = 0; i < 12; i++) state = new BuildingLifecycleSystem().tick(buildingFixture({ lifecycle: state }), typologyFixture(), lifecycleInput({ occupancyRatio: 0.05 }));
  assert.ok(state.vacancyDurationTicks > 0);
  assert.ok(state.distressScore > buildingFixture().lifecycle.distressScore);
});
```

- [ ] **Step 2: Verify failure**

```bash
node --experimental-strip-types --test tests/urban-fabric-lifecycle.test.ts
```

Expected: FAIL because lifecycle system does not exist.

- [ ] **Step 3: Implement coarse-cadence deterministic lifecycle formulas**

Clamp all condition indices to `[0,100]`. At each lifecycle cadence, compute required maintenance from `grossFloorAreaM2 * typology.annualMaintenancePerM2 * ageFactor * complexityFactor`; backlog grows by the shortfall. Condition loss combines base age decay, backlog ratio, vacancy, utilization, and environmental/service stress. Maintenance may restore at most 1 condition point per cadence; larger recovery belongs to renovation.

Use condition bands only for status decisions: `<35` applies strong rent/occupancy penalty, `<20` increases distress sharply, structural `<15` marks the building unsafe/abandoned if occupied relocation is complete.

- [ ] **Step 4: Run lifecycle and building regressions**

```bash
node --experimental-strip-types --test tests/urban-fabric-lifecycle.test.ts tests/urban-fabric-buildings.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/simulation/buildings/BuildingLifecycleSystem.ts src/simulation/buildings/BuildingTypes.ts src/simulation/buildings/BuildingSystem.ts tests/urban-fabric-lifecycle.test.ts
git commit -m "feat: add building deterioration and maintenance lifecycle"
```

---

### Task 9: Renovation, Adaptive Reuse, and Demolition State

**Files:**
- Create: `src/simulation/buildings/RenovationSystem.ts`
- Modify: `src/simulation/buildings/BuildingTypes.ts`
- Modify: `src/simulation/buildings/BuildingSystem.ts`
- Test: `tests/urban-fabric-renovation.test.ts`

**Interfaces:**
- Produces: `RenovationProposal`, `RenovationEvaluation`, `RenovationSystem.propose()`, `RenovationSystem.start()`, `RenovationSystem.tick()`; demolition status fields in `BuildingProjectState`.

- [ ] **Step 1: Write renovation/conversion tests**

```ts
test('major renovation improves condition and lowers effective age when return clears hurdle', () => {
  const proposal = renovation.propose(buildingFixture({ lifecycle: lifecycleFixture({ condition: 42, effectiveAge: 35 }) }), typologyFixture(), marketFixture(), 'major');
  assert.ok(proposal.projectedCondition >= 75);
  assert.ok(proposal.projectedEffectiveAge < 35);
  assert.ok(proposal.cost > 0);
});

test('adaptive reuse rejects a destination use prohibited by zoning', () => {
  const result = renovation.evaluateAdaptiveReuse(buildingFixture(), 'residential', envelopeFixture({ permittedUses: ['office'] }), marketFixture());
  assert.equal(result.feasible, false);
  assert.ok(result.rejectionReasons.includes('destination-use-prohibited'));
});
```

- [ ] **Step 2: Verify failure**

```bash
node --experimental-strip-types --test tests/urban-fabric-renovation.test.ts
```

Expected: FAIL because `RenovationSystem` does not exist.

- [ ] **Step 3: Implement explicit scopes and project transitions**

Use deterministic scope multipliers:

```ts
const RENOVATION_SCOPES = Object.freeze({
  light: { costPerM2: 180, durationTicks: 20, targetCondition: 68, effectiveAgeMultiplier: 0.90, requiresVacancy: false },
  major: { costPerM2: 520, durationTicks: 55, targetCondition: 82, effectiveAgeMultiplier: 0.55, requiresVacancy: true },
  gut: { costPerM2: 900, durationTicks: 90, targetCondition: 94, effectiveAgeMultiplier: 0.25, requiresVacancy: true },
});
```

Adaptive reuse is allowed only for `gut`, legal destination use, and typology conversion suitability `> 0`. Building project status must preserve occupants until the relocation subsystem reports completion.

- [ ] **Step 4: Run renovation and lifecycle tests**

```bash
node --experimental-strip-types --test tests/urban-fabric-renovation.test.ts tests/urban-fabric-lifecycle.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/simulation/buildings/RenovationSystem.ts src/simulation/buildings/BuildingTypes.ts src/simulation/buildings/BuildingSystem.ts tests/urban-fabric-renovation.test.ts
git commit -m "feat: add renovation adaptive reuse and demolition states"
```

---

### Task 10: Highest-and-Best-Use and Property Market

**Files:**
- Create: `src/simulation/development/HighestBestUseSystem.ts`
- Create: `src/simulation/development/PropertyMarketSystem.ts`
- Modify: `src/simulation/development/DevelopmentTypes.ts`
- Modify: `src/simulation/development/RedevelopmentPressureSystem.ts`
- Test: `tests/urban-fabric-hbu.test.ts`

**Interfaces:**
- Produces: `HighestBestUseResult`; `PropertyTransaction`; `PropertyMarketSystem.ownerOf()`, `reservationValue()`, `transact()`; `HighestBestUseSystem.evaluate(input)`.

- [ ] **Step 1: Write HBU/property tests**

```ts
test('profitable existing NOI can make hold the highest-and-best-use', () => {
  const result = hbu.evaluate(hbuInput({ holdValue: 5_000_000, redevelopmentNetValue: 4_700_000 }));
  assert.equal(result.bestStrategy, 'hold');
  assert.ok(result.redevelopmentPremium < 0);
});

test('upzoning and deterioration can make redevelopment win', () => {
  const result = hbu.evaluate(hbuInput({ holdValue: 2_000_000, redevelopmentNetValue: 5_500_000, buildingCondition: 35 }));
  assert.equal(result.bestStrategy, 'redevelop');
  assert.ok(result.redevelopmentPremium > 0);
});

test('property transaction changes owner and records land/improvement value', () => {
  const market = new PropertyMarketSystem([{ parcelId: 'p1', ownerId: 'owner:a' }]);
  const tx = market.transact(transactionInput({ parcelIds: ['p1'], buyerId: 'developer:b', sellerId: 'owner:a' }));
  assert.equal(market.ownerOf('p1'), 'developer:b');
  assert.equal(tx.purpose, 'redevelopment');
});
```

- [ ] **Step 2: Verify failure**

```bash
node --experimental-strip-types --test tests/urban-fabric-hbu.test.ts
```

Expected: FAIL because HBU/property systems do not exist.

- [ ] **Step 3: Implement asset-value comparison and explainable pressure**

`HighestBestUseSystem.evaluate()` compares net present values of hold, renovation proposals, adaptive conversion proposals, redevelopment candidates, and optional assembly candidate. Choose the highest value only when its risk-adjusted return clears the supplied developer hurdle; otherwise return `hold` or `none`.

`RedevelopmentPressureSystem` becomes a normalized diagnostic score from unused effective FAR, land/improvement ratio, condition, demand, accessibility change, rezoning, assembly opportunity, profitability, relocation cost, demolition cost, and preservation restrictions. It never triggers execution directly.

- [ ] **Step 4: Run HBU and existing redevelopment tests**

```bash
node --experimental-strip-types --test tests/urban-fabric-hbu.test.ts tests/development-integration.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/simulation/development/HighestBestUseSystem.ts src/simulation/development/PropertyMarketSystem.ts src/simulation/development/DevelopmentTypes.ts src/simulation/development/RedevelopmentPressureSystem.ts tests/urban-fabric-hbu.test.ts
git commit -m "feat: add highest-and-best-use property economics"
```

---

### Task 11: Atomic Parcel Split/Assembly, Easements, and Lineage

**Files:**
- Create: `src/world/cadastre/ParcelLineage.ts`
- Create: `src/world/cadastre/CadastralMutationSystem.ts`
- Modify: `src/world/cadastre/CadastralTypes.ts`
- Modify: `src/world/cadastre/CadastralGraph.ts`
- Test: `tests/urban-fabric-mutations.test.ts`

**Interfaces:**
- Produces: `CadastralMutationSystem.splitParcel()`, `assembleParcels()`, `dedicateRightOfWay()`, `createEasement()`, `removeEasement()`; `CadastralMutationResult` with `parcelReferenceRewrites: Readonly<Record<string,string>>` for one-to-one live-reference rewrites and `retiredParcelIds` for historical sources.

- [ ] **Step 1: Write atomicity, area-conservation, and lineage tests**

```ts
test('split conserves area and retires the source parcel', () => {
  const graph = graph40x20Fixture();
  const result = new CadastralMutationSystem(graph).splitParcel('p0', [{ x: 20, y: 0 }, { x: 20, y: 20 }]);
  assert.equal(result.committed, true);
  const children = result.resultingParcelIds.map((id) => graph.getParcel(id)!);
  assert.equal(children.reduce((sum, parcel) => sum + parcel.areaM2, 0), 800);
  assert.equal(graph.getParcel('p0'), undefined);
  assert.ok(graph.snapshot().lineage.some((event) => event.sourceParcelIds.includes('p0')));
});

test('invalid split is atomic', () => {
  const graph = graph40x20Fixture();
  const before = graph.snapshot();
  const result = new CadastralMutationSystem(graph).splitParcel('p0', [{ x: 0, y: 0 }, { x: 0.01, y: 0.01 }]);
  assert.equal(result.committed, false);
  assert.deepEqual(graph.snapshot(), before);
});

test('assembly removes internal edges and preserves external area', () => {
  const graph = twoAdjacentParcelFixture();
  const result = new CadastralMutationSystem(graph).assembleParcels(['p0', 'p1']);
  assert.equal(result.committed, true);
  assert.equal(graph.getParcel(result.resultingParcelIds[0]!)?.areaM2, 800);
});
```

- [ ] **Step 2: Verify failure**

```bash
node --experimental-strip-types --test tests/urban-fabric-mutations.test.ts
```

Expected: FAIL because mutation/lineage systems do not exist.

- [ ] **Step 3: Implement clone-validate-commit transactions**

Every mutation must:

```ts
const before = graph.snapshot();
const candidate = structuredClone(before);
const mutated = applyMutation(candidate, request);
const validation = validateSnapshot(mutated.snapshot);
if (!validation.valid) return Object.freeze({ committed: false, errors: validation.errors, resultingParcelIds: [], retiredParcelIds: [], parcelReferenceRewrites: {} });
graph.replaceSnapshot(mutated.snapshot);
return Object.freeze({ committed: true, errors: [], ...mutated.result });
```

Split uses polygon cutting/difference and reconstructs shared topology. Assembly finds selected edges referenced by exactly two selected parcels, removes those internal edges, traces the remaining external boundary, and creates one new parcel. IDs are generated deterministically from transaction sequence + sorted source IDs; never reuse retired IDs. Ordinary split rejects a cut intersecting any active building footprint supplied through the mutation guard callback.

- [ ] **Step 4: Run mutation and cadastre tests**

```bash
node --experimental-strip-types --test tests/urban-fabric-mutations.test.ts tests/urban-fabric-cadastre.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/world/cadastre/ParcelLineage.ts src/world/cadastre/CadastralMutationSystem.ts src/world/cadastre/CadastralTypes.ts src/world/cadastre/CadastralGraph.ts tests/urban-fabric-mutations.test.ts
git commit -m "feat: add atomic parcel subdivision and assembly"
```

---

### Task 12: Site Assembly Economics and Redevelopment Execution

**Files:**
- Create: `src/simulation/development/SiteAssemblySystem.ts`
- Modify: `src/simulation/development/RedevelopmentExecutionSystem.ts`
- Modify: `src/simulation/development/DeveloperMarketSystem.ts`
- Modify: `src/simulation/housing/HousingRelocationSystem.ts`
- Test: `tests/urban-fabric-redevelopment.test.ts`

**Interfaces:**
- Produces: `SiteAssemblySystem.candidates(parcelId, graph, propertyMarket, envelopeResolver)`; redevelopment execution states `under-contract | acquired | relocating | demolition | construction | lease-up | stabilized`.

- [ ] **Step 1: Write assembly economics and displacement tests**

```ts
test('assembly is offered only when geometry uplift beats acquisition friction', () => {
  const candidates = assembly.candidates('p0', graphFixture(), propertyMarketFixture(), envelopeResolverFixture());
  assert.ok(candidates.every((candidate) => candidate.incrementalDevelopmentValue > candidate.incrementalAssemblyCost));
});

test('redevelopment cannot enter demolition while households remain', () => {
  const execution = redevelopmentFixture({ state: 'relocating', displacedHouseholdIds: ['hh1'] });
  const next = system.tick(execution, { relocatedHouseholdIds: [] });
  assert.equal(next.state, 'relocating');
});

test('redevelopment advances to demolition after displacement clears', () => {
  const execution = redevelopmentFixture({ state: 'relocating', displacedHouseholdIds: ['hh1'] });
  const next = system.tick(execution, { relocatedHouseholdIds: ['hh1'] });
  assert.equal(next.state, 'demolition');
});
```

- [ ] **Step 2: Verify failure**

```bash
node --experimental-strip-types --test tests/urban-fabric-redevelopment.test.ts
```

Expected: FAIL because site assembly and the new execution state machine do not exist.

- [ ] **Step 3: Implement acquisition/assembly and staged execution**

Discover only contiguous adjacent parcels up to a deterministic initial maximum assemblage size of 4 parcels. Sort candidate parcel sets lexicographically. Calculate `incrementalAssemblyCost = acquisitionPremiums + transactionCosts + carryingCost + incrementalDemolitionCost`. Calculate uplift from the assembled envelope's best feasible HBU candidate minus the sum of independent parcel HBU values. Return candidates only when uplift is positive and the resulting developer return clears its hurdle.

`RedevelopmentExecutionSystem` owns state transitions but calls `PropertyMarketSystem`, `HousingRelocationSystem`, `CadastralMutationSystem`, `BuildingSystem`, and developer commitments through explicit injected methods. No demolition occurs while unresolved household/tenant IDs remain.

- [ ] **Step 4: Run redevelopment/housing integration tests**

```bash
node --experimental-strip-types --test tests/urban-fabric-redevelopment.test.ts tests/development-integration.test.ts tests/audit-regressions.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/simulation/development/SiteAssemblySystem.ts src/simulation/development/RedevelopmentExecutionSystem.ts src/simulation/development/DeveloperMarketSystem.ts src/simulation/housing/HousingRelocationSystem.ts tests/urban-fabric-redevelopment.test.ts
git commit -m "feat: integrate parcel assembly with redevelopment execution"
```

---

### Task 13: SimulationCore Runtime Authority Migration

**Files:**
- Modify: `src/simulation/core/SimulationCore.ts`
- Modify: `src/world/lots/LotSystem.ts`
- Modify: `src/simulation/zoning/ZoningSystem.ts`
- Modify: `src/simulation/buildings/BuildingSystem.ts`
- Modify: all direct `lotId` runtime consumers identified by `rg "lotId|\.lots\b|LotSystem" src`
- Test: `tests/urban-fabric-integration.test.ts`
- Modify: `tests/core-city-loop.test.ts`
- Modify: `tests/development-integration.test.ts`

**Interfaces:**
- `SimulationCore` gains readonly `cadastre`, `parcelGeneration`, `buildableEnvelopes`, `zoningCompliance`, `buildingMassing`, `buildingLifecycle`, `renovation`, `highestBestUse`, `propertyMarket`, `siteAssembly`, `cadastralMutations`.
- Runtime development loops enumerate `core.cadastre.listParcels()`; `core.lots` remains a derived compatibility view only.

- [ ] **Step 1: Write an end-to-end runtime authority test**

```ts
test('simulation development enumerates cadastral parcels and keeps lot view derived', () => {
  const core = new SimulationCore({ width: 12, height: 8, seed: 7 });
  buildStreetAndZoneFixture(core);
  core.step(1);
  const parcels = core.cadastre.listParcels();
  assert.ok(parcels.length > 0);
  assert.deepEqual(core.lots.list().map((lot) => lot.id).sort(), parcels.filter((parcel) => parcel.frontageEdgeIds.length > 0).map((parcel) => parcel.id).sort());
});

test('parcel split survives subsequent simulation steps without stale building references', () => {
  const core = developedCoreFixture();
  const result = core.cadastralMutations.splitParcel(splitTarget(core), splitLineFixture());
  assert.equal(result.committed, true);
  core.step(10);
  for (const building of core.buildings.listV2()) {
    assert.ok(building.parcelIds.every((id) => core.cadastre.getParcel(id) !== undefined));
  }
});
```

- [ ] **Step 2: Verify failure**

```bash
node --experimental-strip-types --test tests/urban-fabric-integration.test.ts
```

Expected: FAIL because `SimulationCore` does not expose the new systems.

- [ ] **Step 3: Wire systems and replace runtime `Lot` authority**

Initialize cadastre after roads/zoning, regenerate only when roads or legacy zoning changes invalidate parcels, rebuild `LotSystem` from the cadastre, and move development candidate generation to parcel/envelope/massing flows. When a mutation commits, apply `parcelReferenceRewrites` to building/project/property references in the same simulation transaction; if a source splits into multiple live children and a consumer cannot be resolved uniquely by geometry, fail the mutation before graph commit.

Retain cell-based `getAt(x,y)` compatibility by spatially locating a building whose footprint contains the center of the requested legacy cell. This keeps services/transit callbacks working until future engines become fully geometric.

- [ ] **Step 4: Run full TypeScript test suite**

```bash
npm test
npm run typecheck
npm run lint
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src tests
git commit -m "feat: make cadastral parcels authoritative at runtime"
```

---

### Task 14: V8 Save Format and Deterministic V7 Migration

**Files:**
- Create: `src/save/saveV8.ts`
- Modify: `src/save/save.ts`
- Modify: `src/save/saveV7.ts` only if shared migration helpers require export visibility.
- Modify: `package.json` version to `0.8.0-urban-fabric`.
- Test: `tests/save-v8.test.ts`
- Modify: existing save tests that assert V7 as the primary format.

**Interfaces:**
- Produces: `SaveV8`, `serializeCoreV8(core): SaveV8`, `hydrateCoreV8(input): SimulationCore`; default `serializeCore()` returns V8; default `hydrateCore()` delegates to V8 migration-aware hydrator.

- [ ] **Step 1: Write V8 round-trip and V7 migration tests**

```ts
test('V8 save round-trip preserves topology lifecycle and property ownership', () => {
  const core = urbanFabricCoreFixture();
  const save = serializeCoreV8(core);
  assert.equal(save.saveVersion, 8);
  assert.equal(save.gameVersion, '0.8.0-urban-fabric');
  const restored = hydrateCoreV8(structuredClone(save));
  assert.deepEqual(restored.cadastre.snapshot(), core.cadastre.snapshot());
  assert.deepEqual(restored.buildings.listV2(), core.buildings.listV2());
  assert.deepEqual(restored.propertyMarket.snapshot(), core.propertyMarket.snapshot());
});

test('V7 lot maps deterministically to square V8 parcel', () => {
  const restored = hydrateCoreV8(v7Fixture());
  const parcel = restored.cadastre.getParcel('parcel:legacy:4,4');
  assert.ok(parcel);
  assert.equal(parcel.areaM2, 400);
});
```

- [ ] **Step 2: Verify failure**

```bash
node --experimental-strip-types --test tests/save-v8.test.ts
```

Expected: FAIL because V8 serializer/hydrator does not exist.

- [ ] **Step 3: Implement explicit V8 sections and migration map**

Define concrete fields:

```ts
export type SaveV8 = Omit<SaveV7, 'saveVersion' | 'gameVersion' | 'buildings'> & Readonly<{
  saveVersion: 8;
  gameVersion: '0.8.0-urban-fabric';
  urbanFabric: CadastralSnapshot;
  zoningV2: Readonly<{
    parcelAssignments: readonly ParcelZoningAssignment[];
    overlays: readonly ZoningOverlay[];
  }>;
  buildingsV2: readonly BuildingV2[];
  propertyMarket: PropertyMarketSnapshot;
}>;
```

For V7 input, hydrate V7 first, convert each legacy lot/building into deterministic `parcel:legacy:<x>,<y>` square geometry, map old building `lotId` and developer commitments through a single `Map<legacyLotId, parcelId>`, then validate all references before returning the core. Do not serialize a V7 `buildings` field in V8 except any compatibility field still required by inherited service-state DTOs; derive those references from V2 buildings during serialization.

- [ ] **Step 4: Run save, determinism, and full suite**

```bash
node --experimental-strip-types --test tests/save-v8.test.ts tests/audit-hardening.test.ts tests/audit-regressions.test.ts
npm test
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/save/saveV8.ts src/save/save.ts src/save/saveV7.ts package.json tests
git commit -m "feat: add Urban Fabric V8 save migration"
```

---

### Task 15: Cadastral Rendering, Zoning Envelope Overlay, and Parcel Inspector

**Files:**
- Create: `src/rendering/CadastralOverlayLayer.ts`
- Create: `src/rendering/ZoningEnvelopeLayer.ts`
- Modify: `src/rendering/OverlayRenderPass.ts`
- Modify: `src/rendering/passes/ObjectRenderPass.ts`
- Modify: `src/rendering/WorldRenderer.ts`
- Create: `src/ui/ParcelInspector.ts`
- Modify: `src/ui/Inspector.ts`
- Modify: `src/ui/ToolController.ts`
- Modify: `src/styles.css`
- Test: `tests/urban-fabric-presentation.test.ts`

**Interfaces:**
- `WorldRenderer.worldMetersToCanvas(point, core)` converts meters to legacy cell-space by dividing by `LEGACY_CELL_SIZE_METERS` before isometric projection.
- Overlay modes add `'cadastre' | 'zoning-envelope' | 'redevelopment'` to the relevant presentation state.
- `ParcelInspector.render(parcelId, core): string` returns escaped deterministic inspector markup.

- [ ] **Step 1: Write presentation-model tests**

```ts
test('parcel inspector exposes zoning capacity condition and redevelopment drivers', () => {
  const html = new ParcelInspector().render('p0', coreFixture());
  assert.match(html, /Area/);
  assert.match(html, /Effective FAR/);
  assert.match(html, /Condition/);
  assert.match(html, /Redevelopment pressure/);
});

test('meter coordinates project consistently with legacy cell coordinates', () => {
  const renderer = rendererFixture();
  const a = renderer.worldMetersToCanvas({ x: 20, y: 40 }, coreFixture());
  const b = renderer.worldToCanvas(1, 2, coreFixture());
  assert.deepEqual(a, b);
});
```

- [ ] **Step 2: Verify failure**

```bash
node --experimental-strip-types --test tests/urban-fabric-presentation.test.ts
```

Expected: FAIL because the new presentation classes/methods do not exist.

- [ ] **Step 3: Implement render proxies and parcel-aware UI**

`CadastralOverlayLayer` draws block edges, parcel edges, and frontage using normalized polygons. `ZoningEnvelopeLayer` draws selected parcel boundary, setback exclusion bands, legal footprint, and a height label rather than attempting a true 3D transparent volume in the first pass. `ObjectRenderPass` derives a building render proxy with footprint bounding extents, height, typology style, construction phase, and condition band; it may continue using existing atlas assets for facade treatment while footprint/height determine scale and placement.

`ParcelInspector` must escape all dynamic text via `escapeHtml()` and show area, frontage, district, allowed/effective FAR, height, coverage, building uses, realized FAR, lifecycle condition/effective age, land/improvement values, redevelopment pressure, top positive drivers, top constraints, and lineage summary.

- [ ] **Step 4: Run presentation tests and build**

```bash
node --experimental-strip-types --test tests/urban-fabric-presentation.test.ts tests/development-policy-presentation.test.ts
npm run typecheck
npm run build
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/rendering src/ui src/styles.css tests/urban-fabric-presentation.test.ts
git commit -m "feat: add cadastral overlays and parcel inspector"
```

---

### Task 16: Fuzz Tests, Urban Fabric Smoke Test, Documentation, and Final Gate

**Files:**
- Create: `tests/urban-fabric-fuzz.test.ts`
- Create: `tests/smoke/urban_fabric_smoke.py`
- Modify: `package.json` to add `test:smoke:urban-fabric`.
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/SIMULATION.md`
- Modify: `docs/SAVE_FORMAT.md`
- Modify: `docs/TESTING.md`
- Modify: `docs/DEVELOPMENT_LOG.md`

**Interfaces:**
- Fuzz seed list is fixed and checked into the test; no nondeterministic property-test seed.
- Smoke test verifies boot, zoning/parcel creation, at least one V2 building, cadastral overlay activation, V8 save, reload, and stable parcel count/IDs.

- [ ] **Step 1: Write deterministic mutation fuzz test**

Use a fixed seed set:

```ts
const FUZZ_SEEDS = [3, 7, 11, 19, 31, 47, 73, 101] as const;

test('cadastral mutation sequences preserve topology and land area', () => {
  for (const seed of FUZZ_SEEDS) {
    const { graph, originalControlledArea } = fuzzFixture(seed);
    runDeterministicMutationSequence(graph, seed, 80);
    const validation = validateCadastralGraph(graph);
    assert.equal(validation.valid, true, `seed ${seed}: ${validation.errors.map((e) => e.code).join(',')}`);
    const finalArea = privateLandArea(graph) + dedicatedRightOfWayArea(graph);
    assert.ok(Math.abs(finalArea - originalControlledArea) <= 0.05, `seed ${seed} area drift`);
    assert.deepEqual(new CadastralGraph(graph.snapshot()).snapshot(), graph.snapshot());
  }
});
```

- [ ] **Step 2: Add the browser smoke flow and script command**

`tests/smoke/urban_fabric_smoke.py` must follow the existing smoke-test launch pattern and assert:

```text
1. App boots without console errors.
2. Create/paint a small district and advance simulation.
3. At least one cadastral parcel exists and parcel inspector opens.
4. At least one V2 building can be observed after development advances.
5. Cadastral or zoning-envelope overlay can be toggled.
6. Save payload reports saveVersion 8 and gameVersion 0.8.0-urban-fabric.
7. Reloading the save preserves sorted parcel IDs and building IDs.
```

Add:

```json
"test:smoke:urban-fabric": "python tests/smoke/urban_fabric_smoke.py"
```

- [ ] **Step 3: Update architecture/save/testing docs with concrete V8 behavior**

Document the authoritative hierarchy:

```text
Terrain/grid → roads/right-of-way → blocks/cadastre → parcel zoning → legal envelope → building massing → development economics → lifecycle/redevelopment
```

Document V8 migration, centimeter topology precision, 20 m legacy cell mapping, parcel lineage, legal-nonconforming buildings, and the explicit full verification command list.

- [ ] **Step 4: Run the complete verification gate**

Run in this order:

```bash
npm test
npm run typecheck
npm run lint
npm run assets:check
npm run build
npm run test:smoke
npm run test:smoke:phase7
npm run test:smoke:isometric
npm run test:smoke:urban-fabric
```

Expected: every command exits `0`. If any command fails, do not mark the plan complete; fix the owning task and rerun that task's focused test before rerunning the full gate.

- [ ] **Step 5: Final implementation commit**

```bash
git add package.json src tests docs
git commit -m "feat: complete Urban Fabric 2.0 integration"
```

- [ ] **Step 6: Compare branch against its base and review scope**

```bash
git diff --stat main...HEAD
git diff --check main...HEAD
git log --oneline main..HEAD
```

Expected: no whitespace errors; commits correspond to Tasks 1–16; no unrelated files changed.

---

## Dependency / Ordering Graph

```text
Task 1 Geometry
  ↓
Task 2 Cadastre Graph
  ↓
Task 3 Parcel Generation / Lot Facade
  ↓
Task 4 Zoning Districts
  ↓
Task 5 Buildable Envelopes
  ↓
Task 6 Buildings / Massing
  ↓
Task 7 Physical Feasibility
  ↓
Task 8 Lifecycle
  ↓
Task 9 Renovation / Adaptive Reuse
  ↓
Task 10 HBU / Property Market
  ↓
Task 11 Cadastral Mutations
  ↓
Task 12 Site Assembly / Execution
  ↓
Task 13 Runtime Authority Migration
  ↓
Task 14 Save V8
  ↓
Task 15 Rendering / UI
  ↓
Task 16 Fuzz / Smoke / Final Gate
```

## Slice Checkpoints

- **R1 checkpoint after Task 3:** canonical graph exists; legacy lot view derives from parcels; existing city loop remains green.
- **R2 checkpoint after Task 5:** legal development capacity is FAR/setback/height/coverage based; old intensity remains adapter-only.
- **R3 checkpoint after Task 7:** developers can underwrite real physical mixed-use candidates from floor area.
- **R4 checkpoint after Task 9:** buildings deteriorate and can be maintained, renovated, converted, abandoned, or demolished through explicit states.
- **R5 checkpoint after Task 10:** hold/renovate/convert/redevelop are compared on asset economics; redevelopment pressure is diagnostic.
- **R6 checkpoint after Task 16:** split/assembly, displacement, runtime parcel authority, V8 saves, rendering/UI, fuzz tests, and all repository gates are complete.

## Self-Review Results

- **Spec coverage:** Every acceptance criterion in the design spec maps to at least one task above. Rights-of-way/easements are implemented in Task 11; legal nonconforming behavior is covered in Tasks 5/6; displacement is a hard execution gate in Task 12; V8 migration is Task 14; overlays/inspector are Task 15; fuzz conservation is Task 16.
- **Placeholder scan:** No implementation step relies on `TBD`, `TODO`, unspecified validation, or unnamed tests. Numerical implementation choices required for deterministic execution are explicit.
- **Type consistency:** Canonical land IDs are `parcelId`/`parcelIds`; the legacy `lotId` field remains only in compatibility adapters until V8. `BuildingV2.lifecycle` is the single authoritative lifecycle state. `ParcelDevelopmentEnvelope.effectiveFAR` is consumed by massing, HBU, assembly, inspector, and tests with the same name.
