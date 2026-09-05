# Stack 1 — C++ World, Cadastre & Urban Fabric Authority Transfer

**Branch:** `feature/stack-1-cpp-world-cadastre-urban`  
**Scope:** C++ migration Stack 1  
**Save envelope:** V9 remains unchanged (`saveVersion: 9`, `gameVersion: 0.9.0-urban-fabric`)

## Status on this branch

When the native World and Urban authority bridges are enabled, the C++ runtime is the authoritative owner for the Stack 1 domains listed below. TypeScript remains the public gameplay facade and continues to own domains that are outside Stack 1.

| Domain | Branch authority | Compatibility rule |
| --- | --- | --- |
| World Foundation physical/geographic state | C++ | TypeScript `WorldFoundation`-compatible reads are projections of the native snapshot. |
| Terrain, geography, hydrology, design-storm state | C++ | Legacy terrain adapters remain read-only compatibility surfaces. |
| Legal cadastral topology, parcel identity, frontage/access, easements and lineage | C++ | `LotSystem` is rebuilt from native cadastre and cannot create legal land. |
| Parcel dimensional-zoning assignments | C++ | Legacy cell zoning remains an input/projection seam for inherited gameplay. |
| Canonical `BuildingV2` existence, identity, lifecycle and renovation state | C++ | The inherited one-cell `BuildingSystem` map is rebuilt from native `BuildingV2` after every native projection. |
| Property holdings and historical transactions | C++ | TypeScript property state is restored from each native snapshot. |
| HBU admission for newly created BuildingV2 | C++ validation | TypeScript computes the physical/economic proposal; C++ independently evaluates the supplied HBU inputs and rejects non-`redevelop` admissions. |
| Legacy gameplay economy, population, services, utilities, transport and housing | TypeScript / transitional | These systems consume the compatibility projections until their later migration stacks. |
| GPU/UI presentation | Presentation only | Reads snapshots/projections and never creates authoritative simulation facts. |

## Runtime command flow

Native-enabled simulation ticks use this order:

```text
legacy/transitional TypeScript systems produce a proposal
→ physical development is filtered through HBU economics
→ buildings.reconcile submits the proposed BuildingV2 set + lifecycle inputs
→ C++ validates HBU evidence for every newly admitted BuildingV2
→ C++ commits or rejects the BuildingV2 proposal transactionally
→ native scheduler advances renovation/lifecycle on a staged authority clone
→ C++ publishes the resulting authoritative urban snapshot
→ TypeScript rebuilds cadastre/zoning/BuildingV2/property projections
→ TypeScript rebuilds legacy lots and legacy one-cell buildings from that snapshot
```

A failed HBU check, cadastral mutation, lifecycle update, renovation update, or native scheduler operation must not expose partial native Urban Fabric state.

## Cadastral mutation authority

The public `SimulationCore.cadastralMutations` compatibility API is replaced at runtime by commands sent to `NativeUrbanAuthority`:

- split parcel;
- assemble parcels;
- dedicate right-of-way;
- create easement;
- remove easement.

Native mutations operate on staged state, validate dependent zoning/building/property references, and publish a new snapshot only after the complete transaction succeeds. TypeScript then rebuilds derived lots and other compatibility reads from that committed snapshot.

Ordinary road/zoning edits may request a legacy rebuild, but protected native parcel topology cannot be silently replaced. If an inherited edit would destroy protected canonical topology, native authority rejects the rebuild.

## Building authority and compatibility

`BuildingV2` is the canonical building representation under native authority.

The inherited `BuildingSystem` still exists because economy, population, services, housing and presentation compatibility code expects one-cell records. On this branch those records are disposable projections:

- they are deterministically rebuilt from native `BuildingV2` and native legacy-lot compatibility cells;
- a native-deleted building disappears from the legacy map on the next projection;
- lifecycle and renovation state are never taken from the legacy map as final authority;
- a canonical building that cannot be represented by one legacy compatibility cell is omitted from the legacy map instead of manufacturing a conflicting identity.

## Development / HBU boundary

The Stack 1 correction for CF-003 is active on this branch.

For vacant physical development:

1. cadastral parcel and dimensional zoning produce legal massing candidates;
2. feasibility produces land value, residual land value, return and risk;
3. HBU compares hold versus redevelopment using the minimum currently active developer hurdle as the market-entry floor;
4. only a `redevelop` result can remain eligible for the developer market;
5. when the resulting building is first materialized, the exact HBU input is sent with `buildings.reconcile`;
6. native `DevelopmentAuthority` independently evaluates that HBU evidence and rejects the new `BuildingV2` unless redevelopment remains the selected eligible strategy.

This preserves TypeScript as a proposal-computation compatibility layer while keeping canonical new-building admission under C++ validation.

## Native lifecycle transaction model

Renovation and lifecycle updates share one scheduled native building-state transaction.

At a due tick C++:

1. clones the complete native Urban Fabric authority, including non-persisted lifecycle runtime context;
2. advances renovation on the clone when due;
3. advances lifecycle on the same clone when due;
4. publishes the clone only if every operation succeeds.

If a later lifecycle validation fails after renovation would otherwise have mutated a building, the original native Urban Fabric snapshot remains unchanged and the native engine clock is rolled back by the kernel step transaction.

## Save V9 semantics

Stack 1 does not introduce a new save version.

Native authoritative save/load follows these rules:

- V9 loads canonical cadastre, zoning, `BuildingV2` and property state into C++ first;
- native save patches those authoritative domains back into the same V9 envelope;
- the save writes the current native seed, tick and speed, not the clock from the originally loaded envelope;
- non-persisted lifecycle runtime inputs are deterministically re-established by the TypeScript compatibility proposal before the next native lifecycle cadence;
- save → load → re-establish runtime inputs → continue must match uninterrupted continuation.

## Determinism and parity gates

Stack 1 remains subject to all existing V9 and 2R invariants plus native parity coverage for:

- deterministic World Foundation generation and legacy-world migration;
- hydrology/design-storm conservation;
- cadastral topology, area conservation, lineage and easements;
- dimensional zoning, envelopes and massing;
- BuildingV2 lifecycle, renovation and mixed-use metrics;
- HBU, property market and site assembly;
- transactional cadastral and scheduled building-state rollback;
- V9 cross-language round trip and continuation;
- TypeScript/native shadow parity fixtures;
- Linux GCC/Clang and Windows MSVC native gates;
- TypeScript fast verification and production/browser acceptance gates.

### Explicit Stack 1 gap-closure gates

The final Stack 1 audit adds focused evidence for plan requirements that were previously covered only indirectly:

- `tests/fixtures/cpp-migration/geometry-v1.json` is a shared TypeScript/C++ legal-geometry contract covering winding, canonical rotation, signed area, centroid, bounds, point containment, segment intersection and deterministic polygon hashing.
- `tests/cpp-geometry-fixture-parity.test.ts` and `cpp/tests/geometry/GeometryFixtureTests.cpp` consume the same geometry fixture from both runtimes.
- `tests/native-world-seed-parity.mjs` differentially executes 128 fixed seeds across all six world presets, includes scenario-override cases, compares every terrain field through named domain hashes, compares named hydrology-stage hashes, and reports the first mismatching entity/field path.
- Native geography now exposes deterministic hierarchy lookup plus a bounds-prefiltered `GeographySpatialIndex`; `cpp/tests/geography_hierarchy_tests.cpp` proves deepest-containing-entity lookup, kind-filtered lookup, deterministic child ordering and snapshot/restore equivalence.
- The Windows Node-API CI job executes the 128-seed differential parity matrix in addition to the shared migration fixture and V9 cross-language continuation gates.

## Non-goals

Stack 1 does not transfer authority for:

- Transportation Engine 2.0 / Stack 2;
- economy/freight/personhood/Prism runtime / Stack 3;
- native presentation/final platform cutover / Stack 4;
- later civic, household, infrastructure, politics or regional systems.

The existence of C++ Stack 1 authority does not mean the full Prism Engine or full game runtime has already migrated to C++.
