# Prism Engine P1 — Native ECS and Deterministic Parallel Execution

## Status

Approved direction in chat on 2026-08-29. The user selected the full P1 tranche rather than splitting P1 into P1A/P1B.

This specification implements the P1 milestone defined by `docs/superpowers/specs/2026-08-27-prism-engine-v5.1-design.md`:

> P1 — ECS and deterministic scheduler: native archetype storage, structural command buffers, deterministic DAG execution, profiling hooks.

P1 extends the verified P0 native Rust substrate. It does not begin P2 world/cadastral migration and transfers no Civic Foundry gameplay authority.

## Goal

Build the first complete native computational substrate capable of storing engine entities in cache-oriented archetypes, executing independent jobs on persistent worker threads, collecting structural mutations deterministically, and producing stable authoritative state regardless of registration or worker completion order.

## Global Constraints

- Target platform remains native Windows, with Linux CI support for verification.
- Rust toolchain remains exactly 1.98.0 / Rust 2024.
- `engine/prism/Cargo.lock` remains committed and `--locked` verification remains mandatory.
- P1 introduces no third-party Rust dependency unless separately approved. The intended implementation uses only `std`.
- `#![forbid(unsafe_code)]` remains in force for P1. P1 uses the existing safe 64-byte-aligned byte storage primitive rather than introducing an unaudited unsafe typed allocator.
- Save V9 remains the compatibility persistence authority. No Save V10 or Chrono-Lattice state is introduced.
- `SimulationCore`, `SimulationKernel`, `WorldFoundation`, `CadastralGraph`, transportation, economy, housing, services, and all TypeScript game-domain systems remain authoritative.
- No D3D12, GPU compute, native world import, native cadastral import, continuum solver, ML runtime, or rendering authority is introduced in P1.
- Deterministic state may never depend on worker completion order, wall-clock timing, OS thread identity, profiler values, or hash-map iteration order.

---

# 1. Component Model

## 1.1 Component Type Identity

Each native component type is identified by a stable `ComponentTypeId(u64)`. IDs are engine/domain schema identifiers, not process-local `TypeId` values. They must therefore be explicitly assigned and stable across runs.

Component metadata is represented by:

```text
ComponentLayout {
    type_id: ComponentTypeId,
    size_bytes: usize,
    alignment_bytes: usize,
    temperature: ComponentTemperature,
}
```

`ComponentTemperature` is one of `Hot`, `Medium`, or `Cold`.

P1 component payloads use an engine-owned `ComponentValue` containing an exact byte payload. The value must match the registered component layout size before it can enter authoritative ECS state.

## 1.2 Archetype Key

An `ArchetypeKey` is the canonical sorted unique sequence of `ComponentTypeId`s that defines one exact component signature.

Construction rejects duplicate component IDs. Registration order cannot affect the resulting key.

## 1.3 Registry

`ComponentRegistry` owns metadata by stable component ID and rejects conflicting re-registration. A repeated registration with byte-identical metadata may be accepted idempotently; a conflicting layout is an error.

---

# 2. Chunked SoA Archetype Storage

## 2.1 Chunk Layout

Each archetype owns one or more `ArchetypeChunk`s. A chunk stores:

- a dense ordered entity GUID stream;
- one component column per component type;
- a deterministic row count;
- a deterministic row capacity.

Each component column is a separate 64-byte-aligned `AlignedBlock`, producing Structure-of-Arrays storage while retaining P0's safe-memory policy.

The default target payload is 32 KiB per archetype chunk and must remain within the v5.1 architectural target of 16–64 KiB for normal hot signatures. Capacity is calculated deterministically from the sum of component widths, clamped to at least one row.

Zero-sized components are rejected in P1. Oversized signatures may produce one-row chunks rather than violating correctness.

## 2.2 Dense Rows

Removal uses swap-remove within the chunk. If the last row moves into the removed row, the ECS location map is updated before the operation completes.

Archetype chunk order is append-stable. Empty trailing chunks may be removed; arbitrary compaction across chunks is deferred unless required for deterministic correctness.

## 2.3 Entity Location

Every materialized ECS entity has exactly one `EntityLocation`:

```text
EntityLocation {
    archetype: ArchetypeKey,
    chunk_index: usize,
    row_index: usize,
}
```

The location map is authoritative engine metadata. No live entity may exist in more than one archetype.

---

# 3. ECS World and Structural Mutation

## 3.1 World Ownership

`EcsWorld` owns:

- the P0 `EntityRegistry`;
- the `ComponentRegistry`;
- archetypes keyed by `ArchetypeKey`;
- entity locations;
- a monotonically increasing structural epoch.

P1 ECS entities are infrastructure/test entities only. Civic Foundry gameplay entities are not migrated into this store in P1.

## 3.2 Structural Commands

Jobs never mutate archetype membership directly. Structural work is represented by `StructuralCommand`s in job-local `StructuralCommandBuffer`s.

P1 supports:

- `Spawn { components }`;
- `Despawn { entity }`;
- `AddComponent { entity, component }`;
- `RemoveComponent { entity, component_type }`.

Each buffered command receives a deterministic `StructuralCommandKey` consisting of the issuing stable `JobId` and a monotonically increasing local sequence number. Buffers may complete in any runtime order; commit concatenates all commands and sorts by the deterministic key.

Duplicate global keys are rejected.

## 3.3 Migration

Adding or removing a component migrates the entity to the target archetype:

1. validate the source entity and requested mutation;
2. copy all retained component bytes into a temporary deterministic row representation;
3. add/remove the requested component;
4. insert the target row;
5. update the entity location;
6. remove the source row and repair any swapped entity location.

The operation is transactional at the API level: validation failure must not partially alter world state.

## 3.4 Spawn Ordering

Spawn GUID allocation occurs only during structural commit, after worker execution has reached the barrier. Spawn results are returned in command-key order. This makes newly spawned entities visible in the following execution epoch and prevents job completion order from influencing entity identity.

## 3.5 Retirement Safety

Worker execution reaches a full batch/graph barrier before structural commands are committed. Despawned slots therefore cannot be recycled while a job from the retiring epoch is still running. This satisfies the P0/P1 epoch-safety requirement without introducing asynchronous entity reclamation.

---

# 4. Deterministic Job Graph Execution

## 4.1 Compiled Waves

P0 `JobGraph` remains the dependency/hazard authority. P1 extends `CompiledJobGraph` with deterministic execution waves.

A wave contains jobs whose declared dependencies have completed. Within a wave, jobs are independent under the existing resource-hazard validation and may execute concurrently.

Wave membership and ordering are derived only from stable `order`, `JobId`, and dependency edges. Registration order cannot alter the compiled waves.

## 4.2 Job Function Contract

Executable jobs are registered separately from graph metadata by stable `JobId`.

A P1 job function:

- may perform arbitrary thread-safe local computation;
- may emit a `StructuralCommandBuffer`;
- may emit deterministic diagnostic counters;
- must not commit ECS structural state itself;
- must not use profiler timing to make authoritative decisions.

Missing executable functions for compiled jobs are errors.

## 4.3 Commit Order

Worker completion order is explicitly non-authoritative. The executor collects each wave's results, sorts them by stable job identity/order, and exposes deterministic ordered results. Structural command buffers from all waves are committed using structural command keys.

---

# 5. Persistent Worker Pool and Work Stealing

## 5.1 Pool Lifetime

`WorkerPool` owns persistent OS worker threads for the lifetime of the pool. Threads are created once and joined on `Drop`.

The default worker count is configurable and must be at least one.

## 5.2 Queues

Each worker owns a mutex-protected local `VecDeque`.

Task admission is deterministic: an input batch is sorted by stable task key and distributed round-robin across worker-local queues.

A worker:

1. pops from the front of its local queue;
2. if empty, scans other workers in ascending worker index and steals from the back;
3. sleeps on a condition variable when no work is available;
4. wakes for new work or shutdown.

The exact worker that executes a task is diagnostic only.

## 5.3 Batch Barrier

`execute_batch` returns only after every task admitted to that batch has returned a result. Results are sorted by stable task key before leaving the pool.

No task from a completed batch may remain queued or running.

---

# 6. Epochs

`ExecutionEpoch(u64)` identifies one complete deterministic graph execution. The executor advances the epoch monotonically after a graph barrier.

Epoch values are authoritative ordering metadata; wall-clock time is not.

An execution report records the epoch that produced it. Structural commit may then advance the ECS structural epoch once all buffered commands are committed successfully.

---

# 7. Profiling

## 7.1 Job Samples

Each executed job records a non-authoritative profile sample containing:

- `JobId`;
- execution epoch;
- worker index;
- elapsed nanoseconds;
- structural command count.

Timing uses `std::time::Instant` and is never included in deterministic state hashes.

## 7.2 Aggregation

`Profiler` stores per-job invocation count, total elapsed nanoseconds, maximum elapsed nanoseconds, and total structural command count.

Profiler snapshots are sorted by `JobId` for stable diagnostics. Timing values may differ across machines and runs.

---

# 8. Strict State Hashing

P1 provides a deterministic ECS state hash for CI and divergence localization. The hash covers, in stable order:

- structural epoch;
- live GUIDs;
- archetype keys;
- chunk and row ordering;
- component type IDs;
- exact component bytes.

The implementation uses an engine-local deterministic integer hash routine rather than `DefaultHasher`, whose implementation is not an authoritative persistence contract.

Profiler data, worker identity, wall time, allocation addresses, and unused capacity are excluded.

---

# 9. Error Policy

All public P1 mutation/execution APIs use explicit error enums. Expected invalid operations must not panic.

Panics remain acceptable only for impossible internal invariants after successful public validation or platform impossibilities already assumed by P0 (for example, converting a valid in-memory vector length to an entity index on supported platforms).

Key errors include:

- unknown/conflicting component registration;
- payload-size mismatch;
- duplicate component IDs in an archetype/spawn row;
- stale entity GUID;
- adding an existing component;
- removing a missing component;
- missing executable job;
- duplicate structural command key;
- worker pool configured with zero workers.

---

# 10. P1 Acceptance Criteria

P1 is complete only when all of the following are proven by automated tests and repository verification:

1. Component registration and archetype keys are stable under reversed registration/input order.
2. Component columns begin on 64-byte boundaries.
3. Normal hot archetype chunk targets remain inside 16–64 KiB, with deterministic capacity calculation.
4. Spawn creates exactly one live entity and location.
5. Add/remove component migration preserves every retained byte exactly.
6. Swap-removal repairs the moved entity's location.
7. Despawn rejects stale GUID access and later slot reuse increments generation.
8. Structural command buffers committed in opposite runtime completion orders yield identical GUIDs, archetypes, component bytes, and strict hashes.
9. Registration order cannot change compiled job waves.
10. Unordered read/write hazards continue to be rejected.
11. Independent jobs execute successfully on multiple persistent workers.
12. Worker completion order cannot change ordered job results or ECS strict hashes.
13. Each batch returns only after all admitted tasks are complete.
14. No entity slot is recycled before the execution barrier that retires it.
15. Profiling captures invocation/timing/command metrics without entering the strict state hash.
16. A scale invariant test executes at least 10,000 structural operations and repeated archetype migrations deterministically.
17. `cargo fmt --check`, Clippy with warnings denied, workspace tests, release P1 invariants, and `cargo check --locked` all pass.
18. Windows `prism-host` bootstrap output remains exactly unchanged from P0.
19. Legacy TypeScript verification and inherited browser/visual smoke gates remain green.
20. Scope audit confirms no Save V10, Chrono-Lattice, D3D12, world/cadastre import, continuum solver, gameplay authority migration, or third-party Rust dependency entered P1.

## P1 Completion Boundary

Successful P1 means Prism has a native deterministic parallel execution fabric and cache-oriented archetype substrate suitable for subsequent domain migration.

It does not mean the city simulation is running natively yet. P2 begins only from a green, reviewed P1 checkpoint and is responsible for importing `WorldFoundation` and canonical cadastral state behind parity gates.