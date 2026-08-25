# Testing — Phase 1R World Foundation 2.0

## CI commands

```bash
npm test
npm run typecheck
npm run lint
npm run assets:check
npm run build
npm run test:smoke
npm run test:smoke:phase7
npm run test:smoke:isometric
python tests/smoke/isometric_visual_smoke.py
```

`npm test` uses Node's built-in runner with TypeScript strip-types. Source typechecking uses strict `tsc`. Browser smoke tests execute the compiled application in Chromium through Playwright.

## Phase 1R coverage groups

The existing deterministic gameplay suites for Phases 1–7 and Phase 0A remain regression coverage. Phase 1R adds dedicated coverage for:

- canonical polygon/segment geometry, winding, self-intersection rejection, bounds, projection, and frontage overlap;
- geography hierarchy parent rules, containment, overlap rejection, stable IDs, deterministic irregular generation, and deepest-entity resolution;
- eight engineering soil classes and directional land-preparation economics;
- physical `TerrainField` validation, derived buildability, snapshot isolation, and restoration;
- all six world-generation presets, same-seed determinism, different-seed divergence, named RNG stream isolation, scenario overrides, and zero default contamination;
- deterministic priority-flood conditioning, D8 tie-breaking, acyclic outlet-reaching receiver graphs, watersheds, accumulation, channels, and static flood susceptibility;
- design-storm runoff/infiltration behavior, rainfall monotonicity, soil/impervious directionality, nonnegative flood depth, deterministic replay, and explicit water-balance closure;
- `WorldFoundation` generated/legacy modes, compatibility terrain, static-world behavior, and snapshot restoration;
- `SimulationCore` world ownership, constructor-time world injection, generation/migration/flood diagnostic events, and no fabricated lifecycle events during V8 load;
- Save V8 exact world persistence, last-flood persistence, explicit legacy compatibility, neutral V7 migration, deterministic migration, and corruption rejection;
- generated terrain preparation cost integration into road construction and development underwriting while legacy/direct terrain remains exactly neutral;
- presentation contract proving world rendering remains read-only and `core.terrain` driven;
- spatial-index correctness and 10,000-point performance acceptance;
- all-six-preset 96×64 generation diagnostics;
- 5,000-tick proof that ordinary simulation stepping does not mutate authoritative static world state;
- end-to-end Phase 1R headless acceptance: generate → build → zone → utilities → step → flood → Save V8 → hydrate → deterministic continuation.

## Current verified acceptance

The Phase 1R acceptance head passed:

- **483/483 Node tests**;
- TypeScript typecheck;
- source lint;
- isometric asset source validation;
- production build and procedural atlas generation;
- Phase 6 compiled browser smoke;
- Phase 7 compiled browser smoke;
- Isometric Pass A functional browser smoke;
- eight-scene isometric visual smoke.

The CI checkout was the pull-request merge result, so this verification exercised the Phase 1R branch combined with the then-current `main`, not only the isolated feature-branch commit.

## Geometry and hierarchy acceptance

Geometry tests lock canonical counter-clockwise polygon winding, finite coordinates, deterministic point containment, segment intersections, and invalid-polygon rejection.

Hierarchy tests require exactly one region root and the chain:

`Region → Municipality → District → Neighborhood → Block`

Orphans, wrong parent kinds, cycles, children outside their parents, and invalid sibling overlap are rejected. Generated boundaries are deterministic for a fixed seed/config and use stable IDs.

## Terrain and world-generation acceptance

Generation tests require:

1. same seed/config → byte-equivalent authoritative physical terrain;
2. different seeds → materially different terrain;
3. all six presets → finite valid playable physical worlds;
4. generated contamination remains zero unless authored by scenario data;
5. named vegetation RNG changes cannot perturb topography, soils, or groundwater;
6. scenario overrides win over generated physical values;
7. malformed scenario data fails before a live world is returned.

The six locked presets are:

- `plain`
- `river_valley`
- `basin`
- `rolling_uplands`
- `ridge_edge`
- `coastal_lowland`

## Hydrology and flood acceptance

Static hydrology tests require:

- priority flood fills enclosed depressions to deterministic spill elevation;
- permanent water and boundaries are explicit outlets;
- conditioned receiver graphs never climb and contain no cycles;
- equal D8 downhill candidates use the locked clockwise precedence;
- every cell resolves to a watershed;
- accumulation conserves upstream contribution;
- generated channels follow drainage receivers and include high-accumulation trunks;
- low/convergent terrain has greater static flood susceptibility than ridge terrain in controlled fixtures.

Flood tests require:

- zero rainfall → exact zero flood state and zero balance error;
- more rainfall cannot reduce runoff in an otherwise identical event;
- clay infiltrates less than gravel under the same storm;
- impervious surface reduces infiltration;
- all depths remain finite and nonnegative;
- repeated identical storms are deterministic;
- each event closes the explicit rainfall/infiltration/storage/export water balance within tolerance.

## Save V8 and migration acceptance

Current default persistence is Save V8.

Tests require:

- generated V8 save → hydrate → serialize is exact;
- latest design-storm result round-trips exactly;
- legacy-explicit V8 retains exact compatibility terrain;
- V7 loaded through the current API creates deterministic `legacy-flat` world state while preserving existing roads, zones, buildings, treasury, and gameplay domains;
- repeated legacy migration is deterministic;
- migrated old worlds begin with no fabricated prior flood result;
- corrupt world terrain length, corrupt hierarchy, or world-vs-compatibility terrain divergence is rejected before returning a live core;
- restored V8 worlds are injected before terrain-dependent legacy systems are constructed;
- existing Phase 0A/V7 compatibility parity remains green.

Explicit older serializers remain tested separately so migration compatibility is not conflated with the current default save schema.

## Terrain-economics acceptance

`RoadSystem` tests verify that generated terrain multipliers are applied per new cell and total cost is rounded once. A three-cell fixture with multipliers `1`, `1.5`, and `2` produces the expected weighted total and exact treasury debit.

Direct/legacy terrain tests retain the historical exact road cost because their world preparation multiplier is exactly `1.0`.

Development integration compares otherwise-equivalent sites and requires a more difficult generated site to produce a larger hard construction cost through the existing development-feasibility context. No second hidden construction charge exists inside `DevelopmentFeasibilitySystem`.

## Spatial performance acceptance

`tests/world-performance.test.ts` generates a 96×64 `rolling_uplands` world and constructs 10,000 deterministic query points using modular integer sequences.

For each point it resolves block, neighborhood, and district membership, resulting in **30,000 indexed kind lookups**. The acceptance threshold is **< 2,500 ms** for the indexed phase.

On the latest verified GitHub Actions run:

- 10,000 points / 30,000 indexed kind lookups: **~35.72 ms**;
- the first 500 points were cross-checked against direct hierarchy lookup for correctness;
- threshold headroom was therefore very large on that runner.

This is an acceptance budget, not a cross-hardware performance promise.

## Six-preset generation diagnostics

The same verified runner generated each 96×64 preset successfully:

| Preset | Diagnostic elapsed | Watersheds | Channels |
| --- | ---: | ---: | ---: |
| plain | ~114.31 ms | 316 | 278 |
| river_valley | ~112.85 ms | 316 | 212 |
| basin | ~87.75 ms | 316 | 153 |
| rolling_uplands | ~89.13 ms | 316 | 259 |
| ridge_edge | ~94.63 ms | 316 | 354 |
| coastal_lowland | ~160.17 ms | 812 | 532 |

Generation timings are diagnostic only. The test asserts finite/valid worlds rather than a machine-specific generation-time threshold.

## Static-world long-run gate

A generated `SimulationCore` authoritative world snapshot is captured, the normal city simulation advances **5,000 ticks without a storm or world mutation**, and the world snapshot must remain byte-equivalent.

This prevents legacy gameplay cadence from accidentally mutating the Phase 1R physical world.

## Phase 1R headless acceptance

`tests/phase1r-headless.test.ts` uses the locked fixture:

```ts
new SimulationCore({
  width: 48,
  height: 32,
  seed: 20260825,
  worldConfig: { preset: 'river_valley' },
})
```

The test scans generated geography rather than assuming a hand-authored playable coordinate. It deterministically finds three consecutive buildable road cells and adjacent buildable non-road cells for residential zoning, power, and water.

It then:

1. verifies generated 1R mode, hierarchy, and drainage channels;
2. builds a real local road through `SimulationCore.buildRoad()`;
3. paints residential zoning through `paintZone()`;
4. places real power and water infrastructure;
5. advances 250 live simulation ticks;
6. runs an 80 mm / 2 h design storm;
7. validates nonnegative flood depth and water-balance closure;
8. serializes the current Save V8;
9. hydrates it and requires exact authoritative world/save equality;
10. advances both original and loaded simulations another 300 ticks;
11. requires identical final serialization.

Latest verified diagnostic:

- road: `(1,1) → (3,1)`;
- zone: `(1,0)`;
- power: `(2,0)`;
- water: `(3,0)`;
- flooded cells: **60**;
- balance error: approximately **`-5.24e-10`**;
- final deterministic continuation tick: **550**.

The exact coordinates are diagnostic outputs from the locked seed, not production assumptions.

## Browser regression

Phase 1R intentionally preserves the presentation compatibility seam, so the established browser regression stack remains mandatory.

The latest verified run passed:

- `PHASE6_SMOKE_PASS` with restored current `saveVersion: 8`;
- `PHASE7_TENURE_RELOCATION_SMOKE_PASS`;
- `ISOMETRIC_PASS_A_SMOKE_PASS`;
- `ISOMETRIC_VISUAL_SMOKE_PASS` across eight scenes.

The smoke harness uses compiled ES modules and Playwright request routing because navigable loopback origins may be restricted in the execution environment. The simulation, UI events, serialization, hydration, rendering, and Canvas output remain the real compiled application.