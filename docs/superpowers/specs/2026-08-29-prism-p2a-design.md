# Prism Engine v5.1 — P2A World/Cadastre Mirror and Parity Harness

## Status

Approved direction in chat on 2026-08-29.

P2 is intentionally split into two controlled tranches:

- **P2A — native world/cadastre mirror and parity harness**: build native Civic Foundry representations, import the existing authoritative state, validate/query/mutate candidate copies, and prove deterministic parity while TypeScript remains authoritative.
- **P2B — authority transfer**: only after P2A passes its gates, move the approved geographic/cadastral ownership boundary to native code behind an explicit architecture decision.

This specification covers **P2A only**. It does not authorize P2B authority transfer.

P2A begins from the verified P1 integration baseline `e5a5c0e961d2654dbe023f1ae5a4c3b73baa0161` on `design/prism-engine-v5.1`.

---

# 1. Goal

Build a deterministic native mirror of Civic Foundry's current physical-world and legal-land state that can:

1. import the exact authoritative `WorldFoundationSnapshot` and `CadastralSnapshot` emitted by the TypeScript runtime;
2. reject malformed or semantically invalid imports before native state becomes visible;
3. answer canonical world/cadastral queries with parity against TypeScript;
4. execute cadastral mutation sequences on an isolated candidate native graph for parity testing;
5. produce language-independent canonical hashes and parity reports;
6. prove that import order, map iteration order, worker timing, and non-authoritative diagnostics cannot change native canonical state;
7. preserve Save V9 unchanged;
8. leave all live gameplay ownership in TypeScript until P2B is separately specified and approved.

P2A is therefore a **migration proof layer**, not a live authority switch.

---

# 2. Authority Before and After P2A

## 2.1 Before P2A

The authoritative runtime remains:

```text
SimulationCore
  → SimulationKernel
  → WorldFoundation                  physical/geographic authority
  → CadastralGraph                   legal-land authority
  → CadastralRuntimeMutationService  cross-domain parcel transaction boundary
  → TypeScript game-domain systems
```

Save V9 is the trusted persistence envelope. Its V8-derived `world` field contains the complete `WorldFoundationSnapshot`; its `urbanFabric` field contains the canonical `CadastralSnapshot`.

## 2.2 After P2A

Authority is intentionally unchanged:

```text
TypeScript authoritative state
  → versioned P2A export envelope
    → native Prism domain import
      → validate
      → canonicalize
      → query / candidate mutation / hash
      → parity report
```

The arrow is one-way for P2A. Native P2A state cannot commit back into `SimulationCore`, `WorldFoundation`, `CadastralGraph`, Save V9, or player-facing runtime state.

No native P2A API may be wired as a live mutation source.

## 2.3 Explicit Non-Authority

P2A does **not** own or alter:

- `SimulationCore` or `SimulationKernel`;
- live `WorldFoundation` state;
- live `CadastralGraph` state;
- `CadastralRuntimeMutationService`;
- zoning assignments;
- buildings or `BuildingV2`;
- property holdings/transactions;
- roads, transport, traffic, transit, utilities, economy, households, firms, policies, or municipal finance;
- Save V9 serialization or hydration semantics;
- Electron/Pixi presentation;
- hydrology/flood computation authority.

There is no Save V10 in P2A.

---

# 3. Engine/Game Boundary

P1 established `prism-core` as low-level engine infrastructure. Parcels, blocks, zoning district identifiers, legal lineage, terrain semantics, and Civic Foundry geography are game-domain concepts and must not be added to `prism-core`.

P2A therefore introduces a separate transitional workspace crate:

```text
engine/prism/
  Cargo.toml
  core/       # engine substrate; no Civic Foundry semantics
  host/       # native host shell
  domain/     # transitional native Civic Foundry world/cadastre domain
```

Package intent:

```text
prism-core
    ↑
prism-domain
```

`prism-domain` may depend on `prism-core`; `prism-core` must never depend on `prism-domain`.

This physical location is transitional. The approved target architecture eventually moves game-domain modules under a top-level `game/` hierarchy, but the architecture explicitly requires that physical repository moves occur incrementally rather than through an early repo-wide rename. P2A must not perform that unrelated migration.

---

# 4. Compatibility Envelope

## 4.1 Contract

TypeScript exports a dedicated bridge object rather than exposing arbitrary runtime objects to Rust:

```text
PrismP2AImportEnvelopeV1 {
  schemaVersion: 1,
  sourceSaveVersion: 9,
  sourceGameVersion: "0.9.0-urban-fabric",
  world: WorldFoundationSnapshot,
  cadastre: CadastralSnapshot
}
```

The envelope is migration tooling, not a new save format. It may be generated directly from a live `SimulationCore` or from a hydrated Save V9 candidate, but it must contain only the explicit versioned schema above.

P2A may add an optional diagnostic metadata block outside the hashed authoritative payload for fixture names, test labels, and timing. Diagnostic metadata can never affect canonical hashes or import state.

## 4.2 Encoding

The bridge uses UTF-8 JSON for inspectability and cross-language fixtures.

P2A may introduce exactly these Rust serialization dependencies in `prism-domain`:

- `serde` with derive support;
- `serde_json`.

They must be pinned through the committed workspace lockfile and may not leak into authoritative behavior beyond schema decoding/encoding.

No geometry, spatial-index, hashing, random, or collection dependency is required for P2A unless separately approved. Geometry validation and canonical hashing are engine-owned implementations.

## 4.3 Import Atomicity

Import is transactional:

1. decode into wire-schema types;
2. validate schema/version constraints;
3. validate world shape and numeric invariants;
4. validate cadastral references/topology/geometry/lineage;
5. canonicalize collections;
6. build derived indexes;
7. compute the native canonical hash;
8. expose the completed immutable mirror only after all stages succeed.

Any failure returns a structured import error and exposes no partially initialized authoritative mirror.

---

# 5. Native World Mirror

## 5.1 Scope

The native P2A world mirror represents the current `WorldFoundationSnapshot` exactly enough to preserve and compare:

- `mode`;
- world seed;
- generation configuration;
- scenario ID;
- terrain dimensions, meters-per-cell, and physical samples;
- hydrology snapshot state;
- geography hierarchy;
- legacy terrain compatibility snapshot;
- latest flood result.

P2A imports hydrology/flood state because it is part of the current authoritative snapshot. It does **not** port `HydrologyModel`, `FloodModel`, depression resolution, or design-storm execution. Those numerical systems remain TypeScript-owned until the later native hydrology/multi-physics phase.

## 5.2 World Validation

Import must reject at minimum:

- unsupported world modes;
- zero or invalid dimensions;
- terrain sample count not equal to `width * height`;
- hydrology dimensions that differ from terrain dimensions;
- positional hydrology arrays whose lengths differ from `width * height`;
- flood depth arrays whose lengths differ from `width * height`;
- non-finite authoritative numeric values;
- invalid meters-per-cell;
- duplicate geography IDs;
- invalid geography kinds;
- missing geography parents;
- geography parent cycles;
- child geography outside the declared hierarchy ordering contract;
- malformed polygons.

The importer does not silently repair malformed authoritative input.

## 5.3 Query Parity Surface

P2A exposes a deliberately small read-only query API mirroring existing semantics:

- world dimensions and mode;
- terrain physical sample by `(x, y)`;
- hydrology sample by `(x, y)` using imported fields;
- combined terrain sample parity where no recomputation is required;
- flood depth by `(x, y)` from imported latest flood state;
- geography entity lookup by stable ID;
- deterministic geography listing;
- point/AABB geography lookup through the native index;
- imported watershed/channel lookup and deterministic listing;
- access to compatibility terrain material needed for parity fixtures.

`preparationMultiplierAt` may only be declared parity-complete when the exact current TypeScript formula and mode-dependent behavior are implemented natively and covered by golden fixtures. Until that task lands, the native mirror stores the imported physical value and reports the derived-query capability as unavailable rather than guessing.

## 5.4 Hydrology Boundary

P2A treats imported hydrology/flood arrays as authoritative **mirror data**, not as a native solver result.

A P2A parity test may compare imported hydrology fields and queries. It may not claim native design-storm parity without a native solver.

P2B must explicitly decide how `WorldFoundation` is decomposed so native geographic authority can advance without prematurely transferring P7 hydrology/multi-physics authority.

---

# 6. Native Cadastral Mirror

## 6.1 Data Model

Native types mirror the current legal-land schema:

- `ParcelNode`;
- `ParcelEdge` and edge kind;
- `UrbanBlock`;
- `Parcel`;
- `Easement` and easement kind;
- `ParcelLineageEvent` and lineage kind;
- `CadastralSnapshot`.

Stable TypeScript string IDs remain the compatibility identity in P2A. P2A must not replace persisted/domain IDs with ECS GUIDs. Native ECS identity may later reference these domain identities but cannot redefine them.

## 6.2 Canonical Collections

Top-level collections are canonicalized by stable ID after validation:

- nodes by `id`;
- edges by `id`;
- blocks by `id`;
- parcels by `id`;
- easements by `id`;
- lineage events by `(tick, id)`.

Within records, ordering is classified explicitly:

**Semantic order — preserve exactly:**

- parcel `boundaryEdgeIds` because boundary walking depends on sequence;
- polygon/ring point order;
- grid-backed terrain/hydrology/flood arrays.

**Set-like order — canonicalize lexicographically for native state/hash:**

- block `parcelIds`;
- block `roadEdgeIds` where treated as membership rather than traversal;
- parcel `frontageEdgeIds`;
- parcel `accessEdgeIds`;
- parcel `historicalParentIds`;
- easement `parcelIds`;
- lineage `sourceParcelIds` and `resultingParcelIds` where event semantics are set membership.

Any ordering whose semantics are ambiguous in the TypeScript source must stay preserved until a parity test proves canonical sorting is behavior-neutral.

## 6.3 Native Validation Parity

The native validator must reproduce the current `CadastralValidator` contract, including at least:

- duplicate IDs;
- missing nodes/edges/parcels/blocks;
- zero-length edges;
- duplicate shared boundaries;
- invalid parcel-side references;
- required road refs on street frontage;
- orphan nodes;
- block/parcel membership mismatch;
- invalid frontage/access references;
- parcel boundary closure;
- self-intersection;
- stored-versus-derived area mismatch with the current `0.01 m²` tolerance;
- private parcel overlap above the same tolerance;
- easement parcel-reference validity;
- lineage cycles.

Validation errors carry stable machine-readable codes. Exact prose need not be byte-identical across languages, but the set of `(code, entity-id)` results for parity fixtures must match unless the fixture specifically tests error ordering.

## 6.4 Geometry Semantics

P2A ports only the geometry primitives needed for cadastral parity:

- point equality/tolerance helpers;
- ring normalization compatible with current expectations;
- signed/absolute polygon area as required by current code;
- segment intersection;
- self-intersection detection;
- boundary walking;
- polygon overlap/intersection area sufficient to reproduce cadastral validation and mutation gates.

The implementation must use deterministic iteration and fixed epsilon/tolerance constants. It may not use an external geometry engine in P2A without separate approval because implementation-specific topology repair or floating behavior would weaken the parity oracle.

---

# 7. Candidate Cadastral Mutation Engine

P2A includes a native **candidate** mutation engine so the parity harness can replay legal-land mutation sequences without granting live authority.

It covers the existing low-level cadastral operations:

- parcel split;
- parcel assembly;
- easement creation;
- easement removal;
- right-of-way dedication.

The candidate engine operates only on an isolated native snapshot.

For every operation:

1. clone/stage candidate state or otherwise guarantee API-level transactionality;
2. validate operation preconditions;
3. construct deterministic geometry/topology and IDs according to the existing TypeScript semantic contract;
4. append deterministic lineage;
5. run the full native cadastral validator;
6. commit the candidate snapshot only if valid;
7. return stable resulting/retired parcel IDs and reference rewrites.

A rejected operation must leave the pre-operation native canonical hash unchanged.

P2A does **not** reproduce `CadastralRuntimeMutationService` cross-domain commits to zoning, buildings, property, or lots. Those remain TypeScript-only because native P2A does not own those domains.

---

# 8. Canonical Hash V1

## 8.1 Purpose

P2A requires a language-independent hash so TypeScript and Rust can prove equality without comparing runtime object layout or JSON object-key formatting.

The hash contract is named `PrismCanonicalHashV1`.

## 8.2 Canonical Byte Encoding

Both implementations feed the same typed logical stream into the hasher:

- every record begins with a fixed schema tag;
- strings are UTF-8 with explicit byte length;
- booleans use one byte;
- integers use fixed-width little-endian encoding;
- floating values use IEEE-754 `f64` little-endian bits;
- `-0` is normalized to `+0`;
- non-finite floats are rejected before hashing;
- optional values include an explicit presence byte;
- arrays include element count followed by elements;
- top-level/set-like collections use the canonical ordering defined above;
- semantically ordered collections preserve order.

The authoritative hash payload contains only `world` and `cadastre`. Envelope diagnostic metadata is excluded.

## 8.3 Hash Function

P2A uses an engine-owned deterministic 64-bit FNV-1a implementation and renders the result as a fixed 16-character lowercase hexadecimal string.

This hash is a parity/debugging checksum, not a cryptographic integrity primitive. Avoiding an additional hashing dependency keeps the contract simple and reproducible in Rust and TypeScript.

If a later persistence/security layer needs collision resistance, it will introduce a separately versioned cryptographic digest without silently changing `PrismCanonicalHashV1`.

---

# 9. Parity Harness

## 9.1 Fixture Production

TypeScript creates deterministic P2A fixture envelopes from canonical runtime scenarios. Fixtures are written only by explicit test/tool commands; normal gameplay does not emit bridge files.

Initial fixture classes:

1. legacy-flat world with minimal cadastre;
2. generated-1R world with geography/hydrology state;
3. multi-parcel block with shared boundaries/frontage;
4. easements and historical parcel lineage;
5. Save V9 round-trip candidate;
6. mutation-sequence fixtures covering split, assembly, easement create/remove, and right-of-way;
7. intentionally malformed fixtures for validator parity.

## 9.2 Twin Execution

For mutation scenarios the same initial cadastral snapshot and same ordered command sequence are supplied independently to:

- current TypeScript `CadastralGraph`/low-level mutation path;
- native P2A candidate cadastral engine.

After every accepted or rejected command, the harness compares:

- operation acceptance/rejection;
- resulting parcel IDs;
- retired parcel IDs;
- reference rewrites;
- validation code/entity pairs;
- controlled-area conservation metrics;
- canonical snapshot/hash.

Divergence reports identify the first command and first canonical section that differs.

## 9.3 Import-Order Invariance

For valid snapshots, the harness generates equivalent envelopes with shuffled top-level/set-like collection order. Native canonical state and hash must remain identical.

Semantic-order arrays are never shuffled by this test.

## 9.4 Repeated Import

Importing the same envelope repeatedly into fresh native mirrors must produce identical hashes and deterministic query results.

---

# 10. Spatial Indexing

P2A may build derived native indexes for geography and parcels after canonical import.

The first implementation should be deliberately simple and deterministic:

- immutable AABB entries derived from canonical geometry;
- stable ID tie-breaking;
- query results sorted by stable ID before exposure.

A linear/binned deterministic index is acceptable for P2A if benchmark gates are met. P2A should not prematurely implement the full loose-quadtree/AMR architecture merely to satisfy mirror queries.

Indexes are derived and excluded from canonical hashes. Rebuilding an index cannot change authoritative mirror state.

---

# 11. Error Model

Native P2A errors are structured enums, not free-form strings as the only contract.

Top-level categories:

- `Decode`;
- `UnsupportedSchema`;
- `UnsupportedSourceVersion`;
- `WorldValidation`;
- `CadastreValidation`;
- `Geometry`;
- `MutationRejected`;
- `ParityMismatch`.

Errors include stable codes and relevant entity/field identifiers where possible.

Malformed input must fail closed. No importer or validator may silently clamp, repair, re-parent, re-order semantic sequences, or fabricate missing identity.

---

# 12. Determinism and Concurrency

P2A canonical state construction is deterministic and independent of P1 worker execution timing.

Parallelism is optional in P2A. If validation or fixture processing later uses the P1 job executor:

- jobs operate on immutable imported data or job-local buffers;
- errors/results are sorted by stable keys before reduction;
- canonical commit happens after a full barrier;
- worker identity/timing is diagnostic only.

The first implementation should prefer correctness and observable parity over parallel complexity.

---

# 13. Persistence Impact

P2A changes **no persistent game format**.

Save V9 remains:

```text
saveVersion: 9
gameVersion: 0.9.0-urban-fabric
```

The P2A envelope is generated from existing authoritative snapshots and is not stored as canonical city persistence.

P2A must prove:

- existing V9 files hydrate through the existing TypeScript path unchanged;
- serializing after a P2A parity run produces the same V9 semantics as before;
- no native-only state is required to continue a V9 city;
- P2A fixture/tooling fields never appear in Save V9.

Save V10 remains P3 work.

---

# 14. Proposed Files and Modules

Exact names may change during the implementation plan if existing conventions demand it, but responsibilities must remain separated.

## Rust

```text
engine/prism/Cargo.toml
engine/prism/domain/Cargo.toml
engine/prism/domain/src/lib.rs
engine/prism/domain/src/compat/mod.rs
engine/prism/domain/src/compat/envelope.rs
engine/prism/domain/src/canonical/mod.rs
engine/prism/domain/src/canonical/hash.rs
engine/prism/domain/src/world/mod.rs
engine/prism/domain/src/world/types.rs
engine/prism/domain/src/world/import.rs
engine/prism/domain/src/world/index.rs
engine/prism/domain/src/cadastre/mod.rs
engine/prism/domain/src/cadastre/types.rs
engine/prism/domain/src/cadastre/geometry.rs
engine/prism/domain/src/cadastre/graph.rs
engine/prism/domain/src/cadastre/validator.rs
engine/prism/domain/src/cadastre/mutation.rs
engine/prism/domain/src/parity/mod.rs
```

Tests remain focused and may be split by contract:

```text
engine/prism/domain/tests/import_world.rs
engine/prism/domain/tests/import_cadastre.rs
engine/prism/domain/tests/cadastre_validation.rs
engine/prism/domain/tests/cadastre_mutation.rs
engine/prism/domain/tests/canonical_hash.rs
engine/prism/domain/tests/parity_fixtures.rs
engine/prism/domain/tests/p2a_invariants.rs
```

## TypeScript

Bridge/parity tooling should be isolated from runtime ownership, for example:

```text
src/prism/compat/P2AEnvelope.ts
src/prism/compat/P2AExporter.ts
src/prism/compat/P2ACanonicalHash.ts
scripts/prism-p2a-fixtures.mjs
```

Existing `WorldFoundation`, `CadastralGraph`, Save V9, and mutation implementations are parity oracles and should not be rewritten merely to make the bridge easier.

---

# 15. Test-Driven Implementation Order

Every production behavior begins with a failing contract test where practical.

Recommended implementation sequence:

1. workspace/domain crate bootstrap and build-policy RED/GREEN;
2. wire envelope decode and version rejection;
3. world type import and shape validation;
4. cadastral wire types and import;
5. native cadastral validator parity;
6. canonicalization and cross-language hash fixtures;
7. deterministic query/index parity;
8. candidate mutation engine one operation at a time;
9. twin mutation-sequence harness;
10. shuffled-order/repeated-import determinism tests;
11. malformed fixture corpus;
12. performance/memory measurement;
13. P2A release invariant and CI wiring;
14. durable architecture/testing/development-log documentation.

No P2B authority switch may be mixed into these commits.

---

# 16. Verification Gates

P2A is complete only when all gates below pass on the exact proposed integration head.

## 16.1 Native Build/Quality

- `cargo fmt --check`;
- Clippy with warnings denied;
- workspace tests;
- release workspace check;
- P0 and P1 release invariants remain green;
- new P2A release invariant passes;
- Windows `prism-host` still initializes successfully.

## 16.2 Import Parity

- every valid fixture imports successfully;
- every malformed fixture is rejected in the intended category;
- no partial mirror is observable after import failure;
- repeated import yields identical canonical hashes;
- shuffled non-semantic source ordering yields identical canonical hashes.

## 16.3 World Parity

For the P2A query surface:

- dimensions/mode/seed/config/scenario identity match;
- terrain sample fields match exactly under the declared numeric encoding;
- imported hydrology/flood arrays match exactly;
- geography IDs, hierarchy, geometry, and deterministic listing match;
- native spatial-query result sets match TypeScript fixtures.

No gate claims design-storm solver parity in P2A.

## 16.4 Cadastral Validation Parity

- valid canonical snapshots are accepted by both implementations;
- malformed fixture `(code, entity-id)` sets match;
- `0.01 m²` area/overlap tolerance semantics match;
- lineage cycle behavior matches;
- boundary walking and parcel polygon results match declared tolerances.

## 16.5 Mutation Parity

For the approved low-level operation set:

- acceptance/rejection matches step-by-step;
- resulting/retired IDs match;
- parcel reference rewrites match;
- lineage matches;
- controlled land area is conserved within the existing tolerance contract;
- rejected mutations leave native pre-state hash unchanged;
- accepted mutations produce equivalent canonical snapshots/hashes after every step.

## 16.6 Save Compatibility

- Save V9 schema is unchanged;
- V8→V9 migration remains green;
- V9 round-trip remains green;
- P2A creates no persistence dependency on native-only state.

## 16.7 Inherited Regression Gates

All existing repository acceptance suites remain green, including:

- Phase 1R world tests;
- Urban Fabric/cadastral tests;
- Save tests;
- Phase 6/7 browser smoke;
- Urban Fabric browser smoke;
- isometric functional browser smoke;
- isometric visual regression smoke;
- existing native P0/P1 gates.

## 16.8 Exact-Head Confidence

Before P2A is proposed for integration, the exact final head must receive two consecutive complete Prism verification passes, matching the P1 completion discipline.

---

# 17. Performance and Memory Gate

P2A is not yet the production authority, but it must prove the representation is viable.

Measure at minimum:

- import wall time;
- validation wall time;
- canonical hash time;
- resident/native allocation estimate for world and cadastre mirrors;
- parcel point/AABB query throughput;
- mutation-sequence throughput for a deterministic fixture set.

Initial acceptance is regression-oriented rather than a speculative megacity SLA:

- no superlinear behavior where the TypeScript schema itself does not require it except explicit parcel-overlap validation;
- no unbounded allocation growth across repeated imports;
- indexes rebuild deterministically;
- benchmark output is diagnostic and excluded from authoritative hashes.

Any O(n²) cadastral validation path, especially overlap checking, must be surfaced in profiler/benchmark output so P2B can decide whether spatial acceleration is required before authority transfer.

---

# 18. Rollback Strategy

P2A rollback is intentionally simple because it transfers no authority:

- remove/disable the `prism-domain` P2A bridge and parity tooling;
- keep TypeScript runtime and Save V9 unchanged;
- no player city requires migration back from native state;
- no persisted native state needs conversion.

This reversibility is a primary reason P2A precedes P2B.

---

# 19. P2B Entry Gate

P2B may be designed only after P2A passes all verification gates.

P2B must separately specify:

1. exact authority before/after for terrain, geography, cadastre, hydrology state, and flood computation;
2. how the current bundled `WorldFoundation` ownership is decomposed without prematurely absorbing P7 hydrology/multi-physics;
3. the live typed bridge from native authority to remaining TypeScript domains;
4. how `CadastralRuntimeMutationService` is replaced or re-homed while zoning/buildings/property/lots remain coherent;
5. rollback semantics for live authority transfer;
6. Save V9 hydration/continuation while P3 Save V10 remains future work;
7. the criteria for deleting the TypeScript world/cadastre authority paths.

P2A completion is necessary but not sufficient authorization for P2B.

---

# 20. Acceptance Summary

P2A is successful when Civic Foundry can take the same authoritative world/cadastral state currently used by TypeScript, import it into native Rust, validate it independently, reproduce the approved read/query semantics, replay cadastral mutations on an isolated candidate graph, and prove deterministic state equality through a language-independent canonical hash — while Save V9 and all live gameplay authority remain untouched.

That creates the evidence required to make P2B an explicit ownership decision rather than a speculative rewrite.