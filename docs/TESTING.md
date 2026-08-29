# Testing — Current Urban Fabric 2.0 Gate

## Required CI commands

```bash
npm test
npm run typecheck
npm run lint
npm run assets:check
npm run build
npm run test:smoke
npm run test:smoke:phase7
npm run test:smoke:urban-fabric
npm run test:smoke:isometric
python tests/smoke/isometric_visual_smoke.py
```

`npm test` uses Node's built-in test runner with TypeScript strip-types. Source typechecking uses strict `tsc`. Browser smokes execute the compiled application in Chromium through Playwright.

The GitHub Actions `verify` job runs the same stack and treats the dedicated Urban Fabric smoke as a required gate.

## Prism P0 native gate

Prism P0 adds a separate native test stack without removing inherited TypeScript/browser regression coverage.

Required native command:

```bash
npm run prism:verify
```

It runs Rust formatting, Clippy with warnings denied, workspace tests, release-mode P0 invariant stress tests, and workspace checking from the committed Cargo lockfile.

The Windows-only `prism-windows` CI job must additionally execute `prism-host` and require the exact deterministic bootstrap line. A P0 change is not native-green until that Windows job passes.

During dual-stack migration, `npm run verify:all` is the combined local gate and runs the legacy authoritative-runtime verification followed by the Prism native gate.

## Current verified baseline

Task 13 runtime-mutation implementation head `fa23d77bdaba7f8d260b10ca2d75507f38ed81a6` passed exact-head Civic Foundry CI run **#992** with:

- **595/595 Node tests**;
- strict TypeScript typecheck;
- source lint with zero errors;
- repository and architecture policy checks;
- isometric asset source validation;
- production build and atlas generation;
- Phase 6 compiled browser smoke;
- Phase 7 compiled browser smoke;
- dedicated Urban Fabric compiled browser smoke;
- Isometric Pass A functional browser smoke;
- Isometric Pass A visual smoke.

The final documentation/reconciliation head must rerun this complete stack before PR #63 is treated as integration-ready.

## Regression layers

### Existing city regressions

All inherited deterministic suites remain mandatory. They cover the simulation kernel, world generation/flooding, roads/transportation, traffic, public services, transit, firms/freight, housing/relocation, developer markets, persistence migrations, and isometric presentation.

Urban Fabric is not allowed to clear its own tests by weakening these older gates.

### Urban Fabric unit/integration coverage

Dedicated suites cover:

- canonical cadastral graph construction, snapshot restoration, adjacency, area, centroid, frontage/access, and validation;
- legal parcel generation from legacy roads/zoning while preserving legacy `lot:x,y` identity in the compatibility facade;
- low-level split, assembly, easement creation/removal, and right-of-way dedication with atomic failure behavior and lineage;
- runtime `CadastralRuntimeMutationService` coordination across cadastre, parcel zoning, canonical buildings, property holdings/history, and the derived lot facade;
- split success with geometry-based building reassignment and stable canonical building identity;
- split rejection when a canonical building crosses the cut, with no dependent-domain mutation;
- assembly rewrites plus atomic owner/zoning conflict rejection;
- right-of-way residual rewrites plus building-intersection rejection;
- easement create/remove through the public runtime transaction boundary;
- twin-core deterministic split → assembly sequences with deep-equal results and snapshots;
- an injected live commit fault that forces `runtime-commit-rollback` and proves byte-for-byte restoration of every dependent domain;
- dimensional zoning districts and parcel assignments;
- buildable envelopes from setbacks, coverage, height, FAR, and minimum parcel dimensions;
- zoning-compliance rejection by dimensional/use reason;
- deterministic physical massing and mixed-use floor allocation;
- physical building metrics derived from real floor area;
- independent canonical `BuildingV2` storage, deterministic ordering, duplicate rejection, and legacy-cell spatial lookup;
- lifecycle deterioration, maintenance, distress, renovation, adaptive reuse, and relocation gates;
- property holdings/transactions and atomic multi-parcel transfers;
- highest-and-best-use and physical redevelopment pressure;
- deterministic site-assembly enumeration/economics;
- runtime proof that development awards use cadastral parcel identity and materialize `BuildingV2` state;
- grandfathered compatibility behavior when multiple legacy structures share one canonical parcel;
- Urban Fabric renderer overlays and canonical parcel inspector behavior;
- Save V9 exact round-trip, migration, reference validation, and continuation.

## Deterministic cadastral fuzz gate

`tests/urban-fabric-fuzz.test.ts` runs the fixed seed set:

```ts
[3, 7, 11, 19, 31, 47, 73, 101]
```

For each seed, the test executes **80 deterministic mutation attempts** over a controlled cadastral fixture. The sequence mixes:

- parcel splits;
- easement creation;
- easement removal;
- compatible parcel assembly;
- right-of-way dedication.

After every step the test requires:

1. `validateCadastralGraph(graph).valid === true`;
2. snapshot reconstruction through `new CadastralGraph(graph.snapshot())` to remain byte-equivalent;
3. failed operations to leave a coherent graph;
4. enough committed operations to ensure the sequence is exercising mutations rather than only rejecting inputs.

At the end of every seed, controlled land accounting requires:

`private parcel area + successfully dedicated ROW area = original controlled area ± 0.05 m²`

This gate specifically targets topology/reference drift that is difficult to expose with only isolated hand-authored mutation tests.

## Runtime cadastral transaction acceptance

`tests/urban-fabric-runtime-mutations.test.ts` is the Task 13 coordinator gate. It requires:

1. property transaction history to accept retired parcel IDs only when cadastral lineage recognizes them;
2. runtime split to rewrite canonical building, zoning, and current holding references atomically;
3. split crossing a building to reject without changing any participating domain;
4. assembly to conserve one valid owner/zoning state and reject conflicting state atomically;
5. right-of-way dedication to transfer live references to the residual parcel and preserve area/value rules;
6. easement create/remove to mutate only legal cadastral state while still using the runtime boundary;
7. `SimulationCore.cadastralMutations` to preserve surviving building identity through continued simulation;
8. identical cores plus identical mutation sequences to produce deep-equal results and snapshots;
9. a forced commit-stage exception to return `runtime-commit-rollback` and restore cadastre, zoning, canonical buildings, property market, and legacy lots byte-for-byte.

The commit fault injector is an optional narrow dependency used only to prove rollback. It does not introduce global mutable test state or a general event framework.

## Urban Fabric browser smoke

`tests/smoke/urban_fabric_smoke.py` boots the compiled application and verifies the player-facing/runtime integration boundary.

The smoke:

1. boots with no page or console errors;
2. replaces the demo city with a deterministic flat test world;
3. builds a real local road;
4. paints a small residential district;
5. places real power/water infrastructure;
6. advances 600 live simulation ticks;
7. requires at least one canonical cadastral parcel;
8. requires at least one runtime-created `BuildingV2`;
9. requires the legacy lot compatibility projection to remain available;
10. toggles the cadastre overlay;
11. toggles the zoning-envelope overlay;
12. clicks a compatibility cell and requires the inspector/renderer to resolve the exact same canonical parcel ID;
13. serializes through the current public API and requires `saveVersion: 9` / `gameVersion: "0.9.0-urban-fabric"`;
14. hydrates the save;
15. requires sorted canonical parcel IDs and `BuildingV2` IDs to remain identical after reload.

The CI step is named **Urban Fabric browser smoke** and executes `npm run test:smoke:urban-fabric`.

## Save V9 acceptance

Current default persistence is Save V9. Tests require:

- exact Urban Fabric cadastral/zoning/building/property round-trip;
- deterministic continuation after load;
- V8 → V9 migration to be deterministic;
- no fabricated legal/property history during migration;
- legacy lots rebuilt from persisted cadastral topology;
- live parcel references in parcel zoning, `BuildingV2`, and current holdings to resolve to live cadastral parcels;
- historical property transaction parcel IDs to resolve to either a current live parcel or a retired parcel recognized by persisted cadastral lineage;
- mutation → Save V9 → hydrate → continue to preserve property history and all live cross-domain references;
- explicit Save V8 compatibility to remain available and unchanged;
- inherited World Foundation restoration to occur before dependent legacy gameplay construction.

Older serializers/hydrators remain independently covered so backward compatibility is not conflated with current schema behavior.

## Cadastral validation acceptance

`CadastralValidator` rejects or reports:

- duplicate node/edge/block/parcel/easement/lineage IDs;
- missing nodes, edges, blocks, or parcels;
- orphan nodes;
- zero-length or duplicate shared boundaries;
- invalid parcel boundary chains;
- parcel area mismatches;
- invalid frontage/access references;
- private parcel overlap;
- invalid easement parcel references;
- lineage cycles.

Geometry-changing operations are expected to build a complete candidate snapshot and pass this validator before live replacement.

## Development/massing acceptance

Controlled fixtures require:

- legal envelopes to respect actual parcel geometry and dimensional controls;
- setbacks that disconnect a narrow parcel to report the constraint rather than fabricate a continuous envelope;
- larger legal massing to produce corresponding real floor area, costs, and revenue;
- mixed-use allocations to conserve usable floor area;
- illegal candidates to stop before developer bidding;
- physical candidate identity to survive through bids/awards;
- runtime awards to use one canonical parcel identity rather than multiple derived frontage lots.

## Lifecycle/redevelopment acceptance

Tests require:

- maintenance to slow deterioration;
- chronic vacancy to increase distress;
- renovation/adaptive reuse to obey zoning and return hurdles;
- occupied redevelopment to respect canonical relocation state;
- unresolved households to block demolition;
- redevelopment stages to progress through explicit acquisition/demolition/construction/lease-up gates;
- physical redevelopment pressure to remain deterministic and explanatory.

## World Foundation regressions

Urban Fabric continues to run the complete 1R physical-world coverage:

- polygon/segment geometry;
- geography hierarchy;
- engineering terrain/soil classes;
- six deterministic world presets;
- priority-flood and D8 hydrology;
- design-storm water balance;
- scenario overrides and named RNG isolation;
- World Foundation snapshot persistence;
- terrain-preparation economics;
- spatial-index correctness/performance;
- long-run proof that ordinary simulation ticks do not mutate static world authority.

This is important because legal parcel geometry is layered onto, not substituted for, World Foundation.

## Browser regression stack

The compiled browser stack remains mandatory because several important boundaries are not proven by Node-only tests:

- actual UI event ordering;
- overlay mutual exclusion;
- canvas coordinate picking;
- parcel inspector handoff;
- save/load through compiled modules;
- rendering and atlas integration;
- browser console/page errors.

Playwright request routing serves the compiled `dist` tree under the controlled `http://civic.test/` origin.

These browser/Chromium regressions cover the still-authoritative compatibility runtime. They remain required until native equivalents replace their coverage; they do not constrain the Prism destination architecture.

## Completion rule

A task slice may be called green only after its relevant RED/acceptance test has passed and the full CI gate for the resulting head is successful. A failed downstream browser/visual gate is treated as a real integration defect unless evidence proves infrastructure failure.

Task 13 requires two separate exact-head checkpoints: a green implementation head proving the runtime transaction behavior, followed by a green final documentation/reconciliation head. `main` is not updated by either verification step. PR #63 remains the isolated integration vehicle until explicit approval to merge.
