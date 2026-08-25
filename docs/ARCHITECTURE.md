# Civic Foundry Architecture — Phase 1R World Foundation 2.0

## Runtime boundary

Phase 1R introduces a new authoritative physical-world substrate while preserving the existing playable V7 city behind explicit compatibility adapters.

Current runtime path:

`GameApp → SimulationCore facade → WorldFoundation + SimulationKernel → legacy-v7-city compatibility system → existing city/mobility/service/economy/development domains`

`SimulationCore` remains the public gameplay facade. `SimulationKernel` owns the deterministic tick boundary. `WorldFoundation` owns the Phase 1R physical world. Existing V7 domains continue to own their current gameplay state until a later reviewed tranche replaces them.

This is a progressive replacement architecture, not a clean-slate rewrite.

## WorldFoundation composition

```text
WorldFoundation
├── Geometry primitives and canonical polygon/segment math
├── GeographyHierarchy
│   └── Region → Municipality → District → Neighborhood → Block
├── TerrainField
│   ├── elevation / slope / aspect
│   ├── soil / bearing / soil depth
│   ├── bedrock / groundwater
│   ├── vegetation / contamination
│   └── surface-water state
├── HydrologyModel
│   ├── priority-flood conditioning
│   ├── deterministic D8 receivers
│   ├── flow accumulation
│   ├── watersheds
│   └── drainage channels / flood susceptibility
├── FloodModel
├── WorldGenerator
├── Scenario overrides
├── GeometryIndex
└── LegacyTerrainAdapter
```

`WorldFoundationSnapshot` persists the authoritative composition, including mode, seed, generation config, scenario identity, terrain, hydrology, geography, legacy compatibility data where applicable, and the latest design-storm result.

## Authority and ownership

### `WorldFoundation`

Owns:

- generated/legacy world mode;
- deterministic world seed and generation configuration;
- physical terrain;
- geography hierarchy;
- hydrology;
- spatial index derived from geography/channels;
- latest design-storm result;
- compatibility projection to `TerrainGrid`;
- terrain-preparation economics for generated 1R worlds.

It does not own roads, zoning, lots, buildings, population, transit, firms, housing cohorts, developer capital, or municipal finance.

### `SimulationKernel`

Owns the fixed deterministic clock/scheduling shell, command sequencing, diagnostic event journal, named RNG infrastructure, invariants, and diagnostic snapshot registry. Current V7 gameplay orchestration still runs through the `legacy-v7-city` compatibility system.

### Existing V7 gameplay domains

Continue to own city/economic state during Phase 1R. This includes roads, zoning, cell-based lots, buildings, population, services, transit, traffic, firms/freight, housing/relocation, development policy, and developer capital.

Phase 1R may supply them with richer physical-world inputs, but it does not silently transfer their authority.

## Deterministic world generation

World generation resolves configuration first, then uses named RNG streams so unrelated generation concerns do not perturb one another accidentally.

High-level generation pipeline:

1. resolve world dimensions, scale, and one of six locked presets;
2. generate macro elevation and local relief;
3. derive slope/aspect;
4. assign engineering soil/bedrock properties;
5. derive groundwater/moisture and vegetation;
6. apply scenario-authored physical overrides;
7. condition drainage using deterministic priority flood;
8. build fixed-precedence D8 receivers;
9. derive accumulation, watersheds, channels, and flood susceptibility;
10. generate stable hierarchical administrative boundaries;
11. build spatial indexes;
12. materialize the legacy terrain projection needed by existing gameplay/presentation.

The six presets are `plain`, `river_valley`, `basin`, `rolling_uplands`, `ridge_edge`, and `coastal_lowland`.

Generated contamination is zero unless a scenario explicitly authors it.

## Terrain and soil model

`TerrainField` stores physical values rather than legacy presentation categories. Buildability and the compatibility biome are derived outputs.

Locked soil classes:

- `rock`
- `gravel`
- `sand`
- `loam`
- `clay`
- `alluvium`
- `peat`
- `fill_disturbed`

Engineering properties feed a deterministic land-preparation multiplier. Slope, weak/wet soils, groundwater, contamination, bedrock conditions, and flood susceptibility can increase preparation cost directionally.

For generated 1R worlds, that multiplier feeds two existing economic channels:

- `RoadSystem` construction cost: per-new-cell base road cost × local world multiplier, summed and rounded once;
- development feasibility: existing service/utility construction index × local world multiplier, then clamped by the existing underwriting bounds.

Direct/legacy terrain modes return exactly `1.0`, preserving historical road and development economics.

## Hydrology and flooding

### Static hydrology

Elevation is conditioned using a deterministic priority-flood algorithm. Drainage uses D8 routing with a fixed clockwise precedence for equal candidates. Every routed cell must eventually reach an explicit outlet without cycles.

`HydrologyModel` derives:

- receiver graph;
- flow accumulation;
- watershed membership;
- channel network;
- static flood susceptibility.

### Design-storm flooding

`SimulationCore.runDesignStorm(event)` is the public authoritative storm entry point. It:

1. appends `FloodEventStarted` to the diagnostic journal;
2. runs `WorldFoundation.runDesignStorm()`;
3. stores the latest flood result in world authority;
4. appends `FloodEventResolved` with event ID, flooded-cell count, and balance error;
5. returns the deterministic flood result.

Flood accounting explicitly tracks rainfall volume against infiltration, retained/storage/flood water, and outlet export. Depths are finite/nonnegative and tests enforce a tight balance tolerance.

Ordinary `SimulationCore.step()` does **not** mutate terrain, hydrology, geography, or flood state. World mutation is explicit rather than an accidental side effect of legacy city ticking.

## Geography hierarchy and spatial index

The hierarchy is:

`Region → Municipality → District → Neighborhood → Block`

Stable typed IDs, canonical polygons, parent references, containment, sibling overlap rules, and deterministic ordering are validated at construction/restore time.

`GeometryIndex` accelerates point-in-entity and nearby-channel queries while exact polygon containment remains the correctness source of truth. Acceptance tests compare indexed results against direct hierarchy lookup for a deterministic sample before applying the performance threshold.

Phase 1R stops at block geography. **True legal parcels are intentionally deferred to 2R.** Existing V7 lots remain cell/frontage records and must not be confused with the new geography hierarchy.

## V7 compatibility facade

`SimulationCore` resolves its world before calling the preserved V7 constructor:

- supplied `world` → use it directly after seed/dimension validation;
- supplied `terrain` → create a `legacy-explicit` or migration `legacy-flat` world;
- no supplied world/terrain → generate a `generated-1r` world.

The legacy constructor receives `world.legacyTerrain()`.

This guarantees that terrain-dependent V7 systems are born against the correct compatibility terrain. A restored V8 world is never attached after V7 systems have already been constructed against some other terrain.

`core.terrain` therefore remains the compatibility seam for:

- V7 road placement/buildability;
- zoning and cell lots;
- existing service/utility placement;
- Canvas/isometric world sizing and ground art.

The adapter preserves historical direct `TerrainGrid` fixtures exactly.

## Save V8

Default persistence is:

```ts
saveVersion: 8
gameVersion: '0.8.0-world-foundation'
world: WorldFoundationSnapshot
```

Save V8 extends the complete V7 gameplay envelope. Serialization sanitizes the inherited V7 state and then adds the authoritative world snapshot.

V8 hydration:

1. validates the V8 game version and world object;
2. restores `WorldFoundation`;
3. validates saved compatibility terrain dimensions/cells against `world.legacyTerrain()`;
4. converts the inherited fields to the V7 hydration envelope;
5. injects the restored world through the constructor-time hydration override;
6. hydrates all V7 gameplay domains against that world from construction time.

Current-load V3–V7 migration instead supplies `terrainMode: 'legacy-flat'`, preserving old terrain/buildability/cost semantics without fabricating 1R physical history.

Explicit historical serializers/hydrators remain available for parity and migration testing.

## Lifecycle diagnostics

The diagnostic event journal may contain:

- `WorldGenerated` — exactly once for a newly generated 1R core;
- `WorldMigratedTo1R` — exactly once when an older save is loaded through the current API;
- `FloodEventStarted`;
- `FloodEventResolved`.

Direct `TerrainGrid` construction emits neither generated nor migration events. V8 restoration does not fabricate lifecycle events.

These are diagnostic events, not a second authoritative history ledger.

## Presentation boundary

Rendering remains presentation-only.

`WorldRenderer` and `GroundRenderPass` derive world size and terrain art from `core.terrain`. They do not call storm APIs, mutate `WorldFoundation`, or mutate persistence state. This lets the richer physical substrate ship without forcing a simultaneous renderer rewrite.

Generated water/forest/rock/grass compatibility remains available through `LegacyTerrainAdapter` so current isometric rendering continues to work.

Future terrain visualization can consume additional read-only world snapshots, but presentation still cannot become an authority owner.

## Key invariants

Phase 1R locks the following architectural invariants:

- identical seed + config + scenario produces identical authoritative world state;
- hierarchy references and containment are valid;
- canonical polygons are finite and non-self-intersecting;
- drainage receivers are deterministic, acyclic, and outlet-reaching;
- design-storm water accounting closes within tolerance;
- generated terrain cost directionality is explicit and legacy terrain remains exactly neutral;
- compatibility terrain dimensions/cells cannot diverge from a restored V8 world;
- ordinary simulation ticks leave the authoritative static world unchanged;
- presentation reads authority but does not manufacture outcomes;
- older save migration preserves historical city state without inventing 1R history.

## Scope boundary for later tranches

### 2R — Urban Fabric 2.0

Owns the later transition from V7 cell lots to legal parcel geometry, including true parcels, FAR, setbacks, height/coverage zoning, mixed use, deterioration, renovation, redevelopment geometry, parcel splitting, and parcel assembly.

### 3R — Transportation Engine 2.0

Owns the later reviewed replacement of transportation authority, including lane-level geometry/permissions, signals, explicit turn movements, road hierarchy semantics, dynamic routing, parking, and crashes.

Phase 1R provides geometry and terrain capabilities those systems may consume, but it does not preempt their authority or acceptance gates.

## Verification boundary

Phase 1R acceptance covers deterministic generation, geometry/hierarchy correctness, hydrology/flood conservation, Save V8, older-save migration, terrain-economics integration, V7 compatibility/parity, presentation read-only behavior, indexed spatial performance, all-six-preset generation, static-world long-run behavior, and an end-to-end generated-city headless scenario.

GitHub remains the durable canonical source of truth.