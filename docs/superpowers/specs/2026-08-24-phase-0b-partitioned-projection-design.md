# Civic Foundry 2.0 — Phase 0B Partitioned Entity Projection Design

## Status

Architectural correction to the approved Phase 0B Entity Registry & Referential Integrity design.

The direction was approved by continuation on 2026-08-24 after controlled profiling showed that revision fast paths and immutable-record reuse were insufficient to meet the Phase 0B performance gate. This document narrows the correction to entity projection transactions; it does not change Phase 0B gameplay scope, V7 authority, save compatibility, entity coverage, reference semantics, or kernel cadence.

This document supplements `2026-08-24-phase-0b-entity-registry-design.md`. Where the original design describes rebuilding one complete projection transaction every tick, this document defines the required partitioned implementation beneath the same externally observable synchronization contract.

## Problem Statement

Phase 0B currently projects the complete V7 entity surface into one combined `EntityProjectionData`, stages the complete active registry, resolves the complete reference set, and commits the complete graph whenever any projected owner revision changes.

Controlled evidence on the same developed-city 5,000-tick workload showed:

- pre-0B median: 1,625.1 ms;
- optimized full-projection median after revision caching: 3,083.3 ms;
- optimized full-projection median after immutable record reuse: 3,008.0 ms;
- remaining regression: approximately +85.1% versus pre-0B.

A churn profile over 5,000 ticks showed 853 entity-registry commits, driven primarily by transient domains:

- traffic revision changed on 655 ticks;
- freight revision changed on 178 ticks;
- incidents changed on 86 ticks;
- durable domains changed rarely.

A layer profile showed the expensive path is whole-registry staging/commit under transient churn rather than the stable-tick revision check itself.

The root cause is architectural: a one-entity or one-domain change causes O(total projected entities + total projected references) work. Micro-optimizations around that full rebuild cannot satisfy the <=5% target while retaining every-tick synchronization and transient entity coverage.

## Constraints Preserved

The correction must preserve every existing Phase 0B invariant:

- V7 domain systems remain authoritative for gameplay state.
- `entity-registry-sync` still runs after `legacy-v7-city` every kernel tick.
- Registry state after each kernel tick is equivalent to a complete deterministic projection of current V7 state.
- Save V7 remains unchanged; no registry state is persisted.
- Generation-aware handles preserve replacement semantics.
- Strong and owned references require active exact targets.
- Weak references never silently retarget to a newer generation.
- Ambiguous weak references remain explicitly unresolved.
- Failed synchronization is atomic: registry, graph, partition cache, and diagnostics remain at the prior committed state.
- No gameplay formulas, cadence, RNG consumption, traffic behavior, transit behavior, economy behavior, or UI behavior change.
- Canonical snapshot ordering and deterministic hashes remain unchanged.

## Approaches Considered

### A. Reduce synchronization cadence

Run entity synchronization every N ticks or only at economy cadence.

Rejected. It would allow the public registry to lag V7 state after a kernel tick and violate the approved same-tick synchronization contract. It also complicates future consumers that assume identity infrastructure reflects the completed tick.

### B. Drop transient entities from Phase 0B coverage

Remove traffic, freight, or incident entities from the compatibility projection.

Rejected. Those kinds were explicitly accepted in the implementation scope and provide important weak-reference/replacement tests. Dropping them would hide the performance problem rather than solve the entity substrate.

### C. Partitioned delta transactions — selected

Project V7 state as deterministic owner partitions. Only partitions whose revision key changed are rebuilt. The registry and reference graph apply a staged delta scoped to the entity kinds and reference sources owned by those changed partitions, while unchanged partitions retain their committed immutable records and edges.

This keeps every-tick external equivalence while changing steady-state and transient-update cost from whole-world work toward work proportional to changed partitions.

## Partition Model

### EntityProjectionPartition

`EntityProjection.ts` introduces:

```ts
export type EntityProjectionPartition = Readonly<{
  id: string;
  ownedKinds: readonly EntityKind[];
  revisionKey: string;
  projection: EntityProjectionData;
}>;
```

Rules:

- `id` is a stable developer-defined partition identifier.
- `ownedKinds` is non-empty and canonicalized in ordinal order.
- One entity kind has exactly one owner partition in the V7 projector.
- `revisionKey` is a deterministic value derived from authoritative owner revisions and any cross-owner identity evidence that can change the partition output.
- `projection.entities` may contain only entity kinds declared by `ownedKinds`.
- Reference intents are owned by the partition containing their source entity kind.
- Unresolved compatibility references are likewise owned by the partition containing their source entity kind.
- Duplicate partition IDs, duplicate owned kinds, or entities outside the declared kinds are programming errors and reject before commit.

The initial V7 partition set is:

```text
lots
buildings
firms
utilities
services
transit
traffic
service-vehicles
freight
incidents
```

`transit` owns both `transit-stop` and `transit-line` because line reference validity and stop lifecycle are coupled in the existing V7 API. Other partitions own their corresponding singular entity kind.

## Revision Keys

A partition revision key must change whenever that partition's projected identity, metadata, reference intents, or unresolved diagnostics can change.

Preferred inputs are existing monotonic `entityRevision` values on domain owners. If a partition depends on another owner's replacement evidence, its revision key includes that dependent revision as well.

Examples:

- `lots`: lot owner revision;
- `buildings`: building revision plus any lot revision needed for building->lot reference output;
- `firms`: firm revision plus building revision because replacement can alter exact-reference validity;
- `traffic`: traffic revision plus building revision because origin/destination weak-reference binding depends on building incarnation evidence;
- `freight`: freight revision plus firm/building revisions where weak target evidence depends on them;
- `incidents`: incident revision plus building revision;
- `transit`: transit revision only because stops and lines are owned together.

Revision keys are optimization inputs, not identity. Incorrectly unchanged keys would be a correctness bug, so tests must prove each cross-owner dependency that can alter projection output.

## Projector Architecture

`LegacyV7EntityProjector` becomes a partition-producing projector internally while preserving `project(source): EntityProjectionData` for tests, hydration equivalence, and diagnostics.

Required API:

```ts
export class LegacyV7EntityProjector {
  projectPartitions(source: LegacyV7EntitySource): readonly EntityProjectionPartition[];
  project(source: LegacyV7EntitySource): EntityProjectionData;
}
```

`project()` is defined as deterministic composition of `projectPartitions()` and remains the full-projection correctness oracle.

The projector maintains a cache by partition ID:

```text
partition id -> { revisionKey, immutable EntityProjectionData }
```

On each synchronization:

1. compute revision keys using O(number of partitions) scalar reads;
2. rebuild only partitions with changed keys;
3. reuse immutable `EntityProjectionData` objects for unchanged partitions;
4. pass the full ordered partition descriptors to the partitioned coordinator;
5. update projector cache only after the coordinator commits successfully.

A failed transaction must not advance a revision cache and thereby suppress the next rebuild.

## Registry Data Structure

The existing canonical active map remains the source of truth:

```ts
activeByLegacyKey: Map<string, EntityRecord>
```

To support scoped replacement/removal without scanning all active entities, `EntityRegistry` adds a per-kind active index:

```ts
activeLegacyKeysByKind: Map<EntityKind, Set<string>>
```

The index is committed atomically with the canonical map and is derived only from committed registry state.

Required invariants:

- every active canonical key appears exactly once in the set for its record kind;
- no per-kind key exists without an active canonical record;
- snapshot output continues to derive canonical ordering independently of set insertion order;
- hydration/full projection produces the same index deterministically;
- diagnostics validate index consistency but do not expose the mutable sets.

## Partial Registry Preparation

`EntityRegistry` adds a scoped preparation path:

```ts
preparePartitionProjection(
  ownedKinds: readonly EntityKind[],
  entities: readonly ProjectedEntity[],
): PreparedEntityPartitionProjection;
```

The preparation algorithm:

1. validate and canonicalize `ownedKinds` and incoming entities;
2. read only active legacy keys in the owned-kind indexes;
3. compare those currently active entities to incoming entities;
4. mark disappeared/replaced handles historical using the same generation rules as full projection;
5. preserve unchanged frozen `EntityRecord` object identity;
6. stage new/replaced records and generation increments;
7. stage exact changes to the per-kind indexes;
8. expose a staged `KnownEntityView` that overlays partition changes on committed state without cloning unrelated active records.

No loop over `activeByLegacyKey` as a whole is permitted in the partial path.

The existing `prepareProjection()` remains supported and must produce snapshots equivalent to composing all partitions from an empty registry.

## Reference Graph Data Structure

The reference graph keeps canonical deterministic output but adds source-kind/source-handle indexing sufficient to replace only edges owned by changed source partitions.

Conceptually:

```ts
referencesBySourceKey: Map<string, readonly EntityReference[]>
sourceKeysByKind: Map<EntityKind, Set<string>>
```

The graph may retain a canonical flattened cache for diagnostics/snapshots, but that cache must be invalidated lazily and must not be rebuilt every tick unless requested.

Partition ownership is by reference source. Therefore updating the `traffic` partition replaces only references whose source kind is `traffic-vehicle`; it cannot remove or rewrite firm, transit, or service edges.

## Partial Reference Preparation

`EntityReferenceGraph` adds:

```ts
preparePartition(
  ownedSourceKinds: readonly EntityKind[],
  references: readonly EntityReference[],
  view: KnownEntityView,
): PreparedReferencePartition;
```

Validation is identical to the full path:

- source must be active;
- strong/owned target must be active;
- weak target must be a known exact handle;
- duplicate canonical references reject;
- external intents never enter the resolved graph.

Only existing references whose source kind is owned by the changed partition are replaced. Unchanged source partitions are untouched.

## Partitioned Atomic Coordinator

`EntityProjection.ts` adds:

```ts
export function commitEntityProjectionPartitions(
  registry: EntityRegistry,
  graph: EntityReferenceGraph,
  partitions: readonly EntityProjectionPartition[],
): EntityProjectionCommitResult;
```

The coordinator maintains transaction state by `(registry, graph)` in an internal weak cache:

```text
partition id -> last committed revisionKey
partition id -> last committed unresolved diagnostics
```

Algorithm:

1. validate the complete partition manifest and deterministic ownership rules;
2. determine changed partitions by comparing revision keys with the last successfully committed keys;
3. if no partitions changed and registry/graph revisions match the cache, return the previous immutable result in O(number of partitions);
4. stage every changed registry partition against one transaction overlay without mutating live state;
5. resolve reference intents for every changed partition against the final staged registry view so cross-partition targets see same-transaction replacements;
6. stage reference replacements for changed source partitions;
7. compose unresolved diagnostics from changed partition results plus cached unchanged partition diagnostics;
8. validate final staged registry/reference invariants;
9. commit registry delta, graph delta, coordinator partition keys, and unresolved cache as one logical transaction;
10. return deterministic counts and unresolved diagnostics.

If any stage fails, no live registry data, graph data, revision counter, partition key, or unresolved cache changes.

## Cross-Partition Replacement Semantics

Multiple partitions may change in the same tick. The coordinator must stage all entity changes before resolving any changed references.

Example: a building is redeveloped and a firm closes/reforms in the same V7 tick.

Correct order:

```text
stage building replacement generation
stage firm entity changes
resolve firm -> building against final staged entity view
stage graph changes
validate
commit all deltas
```

Resolving each partition immediately after staging it is forbidden because result could depend on partition order.

The manifest itself is canonicalized by partition ID for deterministic behavior, but correctness must not depend on caller ordering.

## Counts and Diagnostics

`EntityProjectionCommitResult` retains its current external meaning:

- `activeEntities` is the total active registry count;
- `references` is the total resolved graph count;
- `unresolved` contains the complete deterministic unresolved diagnostic list across all partitions.

For performance, registry and graph maintain committed active/reference counts incrementally. Producing a commit result must not call `listActive()` or `graph.list()` solely to calculate counts.

Snapshot/list APIs may still sort and clone on explicit diagnostic demand.

## Hydration

Hydration may use either:

- one full `commitEntityProjection()` from `project()`; or
- a first `commitEntityProjectionPartitions()` where every partition is new.

Both paths must produce byte-equivalent registry/reference snapshots and unresolved diagnostics.

No partition revision cache is persisted. After hydration, the first partitioned sync reconstructs cache state from authoritative V7 revisions without consuming a simulation tick or RNG draw.

## Failure Handling

Programming errors reject before mutation where possible:

- duplicate partition ID;
- duplicate owned kind;
- empty owned-kind list;
- entity kind outside partition ownership;
- reference source kind outside partition ownership;
- conflicting entity identity in the final staged view;
- dangling strong/owned reference;
- invalid weak exact handle;
- stale prepared delta;
- registry/index inconsistency;
- graph/index inconsistency.

Error messages include partition ID and canonical entity/reference identifiers where applicable.

Atomicity tests must capture snapshots, revision counters, per-kind indexes, and partition cache behavior before a failing transaction and prove all remain unchanged afterward.

## Determinism

The partitioned path must be observationally equivalent to the full path.

For any sequence of authoritative V7 states `S0..Sn`:

```text
partitioned sync(S0..Sn).snapshot
==
full projection(Sn).snapshot
```

provided the full comparison registry has observed the same proven incarnation history required by the state sequence.

Tests must cover:

- partition caller order permutations;
- entity/source list order permutations;
- simultaneous multi-partition changes;
- disappearance/reappearance generation advancement;
- building replacement with weak traffic references;
- failed transaction retry with unchanged revision keys;
- hydration then first incremental tick;
- unchanged partition record object identity as an internal performance invariant;
- no iteration of unrelated active registry records during transient updates.

## Performance Requirements

The correction is successful only if it changes the complexity shape, not merely one benchmark number.

Required complexity:

- unchanged tick: O(number of partitions);
- one changed partition registry work: O(active entities in owned kinds + incoming entities in that partition);
- one changed partition reference work: O(existing/incoming references owned by changed source kinds);
- no full active registry scan for a traffic-only update;
- no full reference graph rebuild for a traffic-only update;
- no canonical sorting unless a list/snapshot/diagnostic explicitly requests it.

The existing controlled Phase 0B gate remains authoritative:

- same developed-city workload;
- 5,000 ticks;
- five isolated runs per side;
- median comparison;
- pre-0B baseline fixed at 1,625.1 ms from the anchored Phase 0A commit;
- <=5% regression target.

If the median remains >5%, investigation continues; the gate is not weakened.

A synthetic 10,000-entity test additionally verifies a single transient partition update does not scale with unrelated durable entity count.

## Testing Sequence

Implementation follows TDD in this order:

1. RED: partitioned coordinator API is absent and focused parity/iteration tests fail.
2. GREEN: manifest validation and per-kind registry index sufficient for a minimal two-partition transaction.
3. RED/GREEN: partial graph replacement and cross-partition same-transaction reference validation.
4. RED/GREEN: projector partition production and revision-cache correctness.
5. RED/GREEN: failure atomicity and retry behavior.
6. RED/GREEN: hydration/full-path equivalence and generation-history cases.
7. full entity suite.
8. Phase 0A immutable V7 parity fixture.
9. Save V7 schema/canonical serialization tests.
10. full repository tests, typecheck, lint, build.
11. controlled 5x5,000-tick pre/post benchmark.
12. browser smoke.

## Production Scope

Expected changes are limited to:

```text
src/entities/EntityRegistry.ts
src/entities/EntityReferenceGraph.ts
src/entities/EntityProjection.ts
src/entities/LegacyV7EntityProjector.ts
src/simulation/core/SimulationCore.ts   # integration only
src/entities/EntityDiagnostics.ts       # index invariant validation if needed
```

Tests may add focused partition/delta cases. No gameplay-domain formulas or rendering code are in scope.

## Acceptance Addendum

The original Phase 0B acceptance criteria remain in force. In addition, the partitioned correction must satisfy:

1. Partitioned and full projection paths produce equivalent canonical registry/reference state.
2. Changed partitions cannot mutate entities or references owned by unchanged partitions.
3. Same-tick multi-partition replacements resolve references against one final staged entity view.
4. A failed partial transaction leaves every committed structure and partition revision cache unchanged.
5. Traffic-only updates do not iterate unrelated active entity kinds.
6. Traffic-only updates do not rebuild unrelated reference-source partitions.
7. Unchanged partition entity records retain immutable object identity internally.
8. Commit result counts are maintained without forcing canonical full-list generation.
9. Hydration and first incremental synchronization remain deterministic and consume no tick/RNG draw.
10. Controlled developed-city median regression meets the original <=5% target before merge.

## Deferred Work

This correction does not introduce native entity allocation, persistence of handles, Save V8, SpatialIndex, EconomicLedger, Statistics/History, or new gameplay entity kinds. Those remain in their previously planned phases.
