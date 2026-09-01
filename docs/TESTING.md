# Testing — Current Urban Fabric + Production 3D Gate

## Required repository verification

The canonical core verification gate is:

```bash
npm run verify
```

It expands to formatting, lint, repository policy, architecture policy, strict TypeScript typechecking, the complete Node test suite, asset policy/validation, and the production build.

CI then runs the compiled browser/visual regression stack, including:

```bash
npm run test:smoke
npm run test:smoke:phase7
npm run test:smoke:urban-fabric
npm run test:smoke:isometric
python tests/smoke/isometric_visual_smoke.py
npm run test:smoke:3d-house
npm run test:smoke:3d:stack3
```

Node tests use the built-in Node test runner with TypeScript strip-types. Source typechecking uses strict `tsc`. Browser smokes execute the compiled `dist/` application in Chromium through Playwright request routing under the controlled `http://civic.test/` origin.

A feature slice is green only when its relevant RED/acceptance test passes and the exact resulting GitHub head passes its full required CI. Downstream browser/visual failures are treated as real integration defects unless evidence proves infrastructure failure.

## Regression layers

All inherited deterministic simulation/world/save suites remain mandatory. They cover the simulation kernel, world generation/hydrology, roads/transportation, traffic, transit, services, utilities, firms/freight, housing/relocation, development/property systems, cadastral mutation, persistence migrations, and the default isometric/GPU presentation path.

Urban Fabric and Stack 3 are not allowed to clear their own acceptance by weakening older assertions, changing Save V9 semantics, or bypassing repository/architecture policy.

## Urban Fabric authority acceptance

Dedicated tests continue to cover:

- canonical cadastral graph construction, geometry, topology, access/frontage, lineage, and validation;
- deterministic legal parcel generation and legacy lot projection;
- split, assembly, easement, and right-of-way operations;
- `CadastralRuntimeMutationService` cross-domain coordination and rollback;
- parcel zoning, envelopes, compliance, physical massing, mixed-use allocation, and `BuildingV2` identity;
- lifecycle, maintenance, renovation/adaptive reuse, displacement/redevelopment gates;
- property holdings/history and deterministic highest-and-best-use/site assembly;
- runtime proof that development materializes canonical `BuildingV2` from cadastral parcel identity;
- Save V9 exact round-trip, migration, reference validation, and deterministic continuation;
- World Foundation physical/geographic regressions and static-world invariants.

`tests/urban-fabric-fuzz.test.ts` remains the fixed-seed mutation fuzz gate and checks graph validity, deterministic snapshot reconstruction, coherent failed operations, committed-mutation coverage, and controlled-area conservation.

`tests/smoke/urban_fabric_smoke.py` remains the compiled runtime acceptance for parcel/building creation, overlays/inspection, Save V9 serialization/hydration, and canonical ID preservation.

## House A 3D foundation gate

The accepted House A calibration tranche remains mandatory and is not superseded by Stack 3.

Focused tests cover Babylon engine selection/fallback, deterministic camera state, Asset Manifest V2, deterministic compilation, GLB streaming/cancellation, retained building reconstruction, canonical pick metadata, presentation state mapping, authority firewall, and desktop/browser runtime boundaries.

After the production build:

```bash
npm run build
npm run test:smoke:3d-house
npm run review:3d-house
```

The House A smoke requires the opt-in `civic-3d` backend, generated LOD/collision artifacts, resident prototype sharing, canonical presentation identity, camera orbit/zoom without Save V9 mutation, and deterministic teardown/rebuild. Fixed-camera review PNGs remain generated review evidence only.

## Stack 3 focused contract gate

Stack 3 adds these focused suites:

```text
tests/stack3_asset_contract.test.ts
tests/stack3_asset_wave.test.ts
tests/stack3_asset_selection.test.ts
tests/stack3_production_scene_layer.test.ts
tests/stack3_picking_reconstruction.test.ts
tests/stack3_scene_budget.test.ts
```

They prove the following contracts.

### Production metadata/compiler

Every source/manifest entry requires `semanticFamily` plus positive CPU/GPU geometry/material estimates. The compiler must emit the same production metadata deterministically and preserve the canonical meter/pivot/LOD contract.

### Controlled 14-family wave

The first production source wave contains exactly the approved 14 asset IDs. Every family supplies canonical axes/pivot, LOD0/LOD1/LOD2, runtime estimates, materials/state channels as applicable, and compiler-valid geometry/collision metadata.

### Deterministic semantic selection

`AssetCatalogV2.listBySemanticFamily(...)` returns stable asset-ID ordering. `selectProductionAssetId(...)` is input-order independent, stable for the same identity/family/channel, handles empty candidate sets, and uses no runtime randomness.

### Retained production reconciliation

`ProductionSceneLayer` must:

- create a new entity once;
- create nothing on an identical second reconciliation;
- update appearance-only changes in place;
- structurally replace asset/fingerprint/LOD/canonical-identity changes;
- remove departed entities;
- reconstruct the same deterministic digest after teardown/rebuild;
- report memory from unique active prototypes rather than instance count.

Canonical identity replacement has a dedicated regression so a stable presentation ID cannot retain stale pick/canonical metadata.

### Picking/reconstruction

Generic Babylon pick identity is bound to retained roots/descendants, survives LOD/prototype reconstruction, and can be resolved by walking parent identity. Babylon metadata maps back to stable presentation identity only; it never becomes simulation state.

### Representative structural budgets

`Stack3AcceptanceDistrict` is deterministic and exposes:

- `block`: 112 entities, all 14 asset IDs;
- `neighborhood`: 1008 entities, all 14 asset IDs.

Budget assertions require no more than 14 unique prototypes for the fixed wave and derive CPU/GPU estimates from unique prototypes. This catches accidental instance-count multiplication and uncontrolled prototype growth.

## Stack 3 architecture firewall gate

`tests/architecture_policy.test.ts` and `scripts/check-architecture.mjs` protect authoritative directories from the rendering runtime.

Required rules include:

- `src/simulation/` may not import `src/rendering/`;
- `src/world/` may not import `src/rendering/`;
- `src/save/` may not import `src/rendering/`;
- authoritative simulation/world/save code may not import `@babylonjs/*`;
- authoritative simulation/world/save code may not import `@gltf-transform/*`.

The Stack 3 TDD addition specifically introduced a RED test for Save -> `src/rendering/3d` before adding the broader `save-no-rendering` production rule.

## Stack 3 Chromium acceptance

The compiled browser acceptance is:

```bash
npm run build
npm run test:smoke:3d:stack3
```

`tests/smoke/civic_3d_stack3_smoke.py` requires the catalog and LOD0/LOD1/LOD2 GLBs for all 14 production assets before booting the renderer.

The smoke then requires:

1. a dedicated `Civic3DWorldRenderer` canvas;
2. deterministic 112-entity block fixture load;
3. `active === 112` and initial `created === 112`;
4. exactly 14 unique active production prototypes;
5. declared GPU estimate greater than zero and within the acceptance bound;
6. 112 unique production presentation IDs and canonical IDs;
7. visible screenshot luminance/color variance for the district;
8. identical second reconciliation with zero create/remove/replace and 112 unchanged;
9. identical reconstruction digest and stable pick identity list;
10. responsive orbit/zoom state changes;
11. deterministic explicit front/top review cameras;
12. night presentation evidence;
13. byte-identical Save V9 before and after camera/visual operations;
14. no serialized presentation/Babylon metadata;
15. renderer teardown/recreate with restored camera and fixture producing the same digest, picks, and structural counts;
16. final Save V9 still byte-identical.

The smoke emits:

```text
test-artifacts/civic-3d-stack3/district.png
test-artifacts/civic-3d-stack3/front.png
test-artifacts/civic-3d-stack3/top.png
test-artifacts/civic-3d-stack3/night.png
```

CI uploads these files as diagnostic evidence. Screenshots are not source-of-truth assets.

## First-frame visual readiness regression

The original Stack 3 browser RED could construct all 112 retained entities and 14 prototypes while the captured Chromium canvas was still only the clear color. That isolated structural readiness from actual shader/material visual readiness.

The runtime acceptance boundary therefore requires `Civic3DProductionRuntime.apply(...)` to await Babylon scene readiness after retained reconciliation/prototype changes and before the caller captures the accepted frame. The smoke keeps its visual-variance assertion; it was not weakened to accommodate an empty frame.

## LOD-residency regression

`AssetStreamingManager` intentionally keeps zero-reference prototypes resident until eviction/disposal for general cache reuse. The production runtime therefore has an additional ownership rule: after a successful retained-scene replacement, obsolete production `asset@lod` leases are released and then explicitly evicted at zero reference count. Acquisition-failure cleanup does the same for newly acquired unused keys.

This ordering is important: old prototypes are evicted only after old retained instances have been destroyed/replaced. The acceptance objective is bounded LOD cycling without disposing geometry/material resources still used by live handles.

## Save V9 acceptance

Current default persistence remains Save V9. Tests continue to require exact Urban Fabric round-trip, deterministic continuation, deterministic V8 -> V9 migration, live-reference validity, historical lineage validation, derived lot reconstruction, and inherited World Foundation restoration ordering.

Stack 3 adds a stronger negative persistence contract: camera state, Babylon metadata, asset/Lod residency, production fixtures, retained-handle identity, and visual-time presentation changes must not change serialized Save V9.

## Full Stack 3 acceptance sequence

Before Stack 3 can be called complete, the exact final feature head must pass:

```bash
npm run format:check
npm run lint
npm run policy:check
npm run architecture:check
npm run typecheck
npm test
npm run assets:policy
npm run assets:3d:check
npm run build
npm run test:smoke
npm run test:smoke:phase7
npm run test:smoke:urban-fabric
npm run test:smoke:isometric
python tests/smoke/isometric_visual_smoke.py
npm run test:smoke:3d-house
npm run test:smoke:3d:stack3
```

The permanent Stack 3 GitHub workflow additionally runs its focused Stack 3 suites and repository-wide gate. A historical green run is evidence only for the commit/merge ref it actually tested.

## Completion rule

A Stack 3 implementation report may state acceptance only after exact-head CI confirms all required gates. PR #114 remains draft and unmerged until that evidence is green and merge is explicitly authorized separately. If any required browser/visual gate is red, Stack 3 remains incomplete even if all unit/type/build gates are green.
