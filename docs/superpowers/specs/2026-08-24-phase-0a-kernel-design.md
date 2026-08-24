# Civic Foundry 2.0 — Phase 0A Kernel Skeleton & Deterministic Scheduling Design

## Status

Proposed phase-specific design for the first implementation tranche of the approved Civic Foundry 2.0 master architecture.

Parent design: `docs/superpowers/specs/2026-08-24-civic-foundry-2.0-master-design.md`.

Phase 0A introduces the simulation kernel underneath the current V7 city simulation. It deliberately does **not** migrate any gameplay domain to new ownership, does not alter gameplay formulas, and does not change the V7 save schema. Its job is to prove that Civic Foundry can acquire a scalable scheduler, command/event infrastructure, deterministic random-stream registry, invariant framework and snapshot hooks without changing the current authoritative future of a V7 city.

## Existing Baseline

The V7 runtime currently has one top-level `SimulationCore` that owns/composes all authoritative systems and directly coordinates the fixed-step loop. `SimulationCore.step()` advances the shared `SimulationClock` one tick, rebuilds or advances mobility/economy/service/traffic/building/development state, runs 10-tick service/development loops and a 50-tick core-city loop.

Current save compatibility depends on the existing `SimulationCore` surface and current `SimulationClock`, `SeededRandom`, transit, economy, development and housing state. V7 serialization ultimately inherits the legacy `seed`, `rngState` and `clock` fields, then layers V5–V7 domain state on top.

Phase 0A therefore treats the current V7 tick body as a **single compatibility system**. The kernel will become responsible for advancing the clock and invoking that compatibility system. The old per-tick logic itself stays behaviorally identical.

## Goals

Phase 0A must establish these durable kernel capabilities:

1. `SimulationKernel` as the future top-level simulation scheduler.
2. A typed system-registration contract with explicit read/write domains, cadence and ordering dependencies.
3. Deterministic scheduler compilation with cycle detection and ambiguous write-conflict rejection.
4. Typed command sequencing with monotonic command IDs and deterministic FIFO dispatch.
5. Typed domain-event journaling with monotonic event IDs and stable ordering.
6. Named deterministic RNG streams that are isolated from one another.
7. An invariant runner for kernel and future domain invariants.
8. Minimal snapshot-provider hooks for kernel diagnostics and future domain snapshots.
9. A compatibility adapter that routes `SimulationCore.step()` through the kernel while preserving exact V7 behavior.
10. A parity harness capable of proving that selected deterministic V7 scenarios serialize identically before and after the kernel insertion.

## Non-Goals

Phase 0A does not:

- move roads, buildings, traffic, transit, services, economy, housing or development into new kernel-owned domain systems;
- convert current player mutations such as `buildRoad()` or `paintZone()` into kernel commands;
- replace `SimulationCore` as the public gameplay API;
- change any simulation cadence currently encoded in V7;
- replace the current `SeededRandom` algorithm;
- consume new named RNG streams in gameplay decisions;
- persist the new command queue, event journal, invariant registry, snapshot providers or named RNG-stream state;
- introduce a new save version;
- redesign the browser UI;
- change current game balance or formulas.

The new infrastructure exists beneath V7 and is exercised by kernel-level tests. Gameplay domains migrate in later reviewed tranches.

# Architectural Shape

## Directory

Create a focused kernel package:

```text
src/simulation/kernel/
  KernelTypes.ts
  SystemScheduler.ts
  CommandBus.ts
  DomainEventJournal.ts
  RandomStreamRegistry.ts
  InvariantRunner.ts
  SnapshotRegistry.ts
  SimulationKernel.ts
```

The existing `src/simulation/core/SimulationCore.ts`, `SimulationClock.ts`, `SeededRandom.ts` and `types.ts` remain in place during Phase 0A.

`SimulationCore` will expose a readonly `kernel` property but remains the public facade used by `GameApp`, serializers, tests and all domain code.

# 1. Kernel Types

`KernelTypes.ts` defines the common contracts without owning behavior.

## Domain keys

```ts
export type DomainKey = string;
export type KernelSystemId = string;
export type CommandType = string;
export type EventType = string;
```

Domain keys are descriptive stable strings such as:

- `legacy-v7-city`
- `mobility`
- `economy`
- `housing`
- `traffic`
- `government`

Phase 0A registers only `legacy-v7-city` for real gameplay execution.

## Cadence

```ts
export type SystemCadence = Readonly<{
  every: number;
  offset?: number;
}>;
```

Rules:

- `every` must be a positive integer.
- `offset` defaults to `0` and must be an integer from `0` through `every - 1`.
- A system is due when `(tick - offset) % every === 0` and `tick >= offset`.
- The V7 compatibility system uses `{ every: 1 }`.

## System context

```ts
export type KernelStepContext = Readonly<{
  tick: number;
  commands: CommandBus;
  events: DomainEventJournal;
  random: RandomStreamRegistry;
  snapshots: SnapshotRegistry;
}>;
```

The context does not expose `SimulationCore`; the compatibility closure captures `SimulationCore` privately when the adapter is registered.

## System registration

```ts
export type KernelSystemDefinition = Readonly<{
  id: KernelSystemId;
  reads: readonly DomainKey[];
  writes: readonly DomainKey[];
  cadence: SystemCadence;
  after?: readonly KernelSystemId[];
  before?: readonly KernelSystemId[];
  order?: number;
  execute(context: KernelStepContext): void;
}>;
```

`order` defaults to `0` and is only a stable tie-breaker for systems that do not require an explicit dependency relation. It is **not** permission to hide an ambiguous same-domain write conflict.

# 2. SystemScheduler

`SystemScheduler` owns registration metadata and the compiled deterministic execution order. It owns no gameplay state.

## API

```ts
export class SystemScheduler {
  register(system: KernelSystemDefinition): void;
  compile(): readonly KernelSystemDefinition[];
  dueSystems(tick: number): readonly KernelSystemDefinition[];
  listSystems(): readonly KernelSystemDefinition[];
}
```

## Registration rules

Registration rejects:

- empty system IDs;
- duplicate IDs;
- invalid cadence;
- duplicate domain keys within one read/write array;
- a system declaring the same domain in both `reads` and `writes` when `writes` already implies read/write authority for conflict purposes;
- self-dependencies in `after` or `before`.

A system may depend on a system registered later. Unknown dependency IDs are rejected at compile time rather than at first registration.

## Dependency graph

`after: ['x']` creates edge `x → current`.

`before: ['x']` creates edge `current → x`.

The compiler performs a deterministic topological sort. Among currently available nodes it orders by:

1. numeric `order` ascending;
2. system ID using ordinal string comparison.

This makes independent systems deterministic even when registration order differs.

## Write-conflict rule

If two systems can execute on at least one common tick and both write the same domain, there must be a dependency path ordering one before the other. A plain `order` value is insufficient.

Examples:

- `traffic-flow` writes `traffic`; `traffic-analytics` only reads `traffic`: valid without explicit dependency if there is no other semantic prerequisite.
- `traffic-flow` and `incident-road-closure` both write `traffic`: invalid unless one is explicitly ordered before/after the other.

To determine whether cadences can overlap, Phase 0A may use a bounded least-common-multiple check for positive integer cadences. Since all current and near-term cadences are small integers, the scheduler can compute overlap exactly without introducing a generalized calendar solver.

## Cycle failure

Any dependency cycle throws an error naming the participating system IDs. Kernel construction must fail before simulation ticks advance.

# 3. CommandBus

The command bus introduces sequencing semantics for future player/simulation mutations without migrating current V7 mutation APIs yet.

## Command contracts

```ts
export type KernelCommand<TPayload = unknown> = Readonly<{
  type: CommandType;
  payload: TPayload;
}>;

export type SequencedCommand = Readonly<{
  sequence: number;
  enqueuedTick: number;
  command: KernelCommand;
}>;

export type CommandHandler = (
  command: SequencedCommand,
  context: KernelStepContext,
) => void;
```

## API

```ts
export class CommandBus {
  registerHandler(type: CommandType, handler: CommandHandler): void;
  enqueue(command: KernelCommand, enqueuedTick: number): number;
  dispatchReady(tick: number, context: KernelStepContext): readonly SequencedCommand[];
  pending(): readonly SequencedCommand[];
  getNextSequence(): number;
}
```

## Semantics

- Sequences start at `1` and increase monotonically.
- Exactly one handler may own a command type.
- A command is ready when `enqueuedTick <= current tick`.
- Ready commands dispatch in ascending `sequence` order regardless of command type.
- Enqueuing while dispatching never interleaves into the current drain. It is eligible on the next kernel dispatch boundary.
- A handler exception aborts the current kernel tick and propagates; later commands and systems do not execute.

Phase 0A gameplay does not enqueue commands. Existing `SimulationCore` mutation methods remain direct and synchronous.

# 4. DomainEventJournal

The event journal is an append-only diagnostic/replay primitive.

## Event contract

```ts
export type DomainEvent<TPayload = unknown> = Readonly<{
  type: EventType;
  source: string;
  payload: TPayload;
}>;

export type JournaledDomainEvent = DomainEvent & Readonly<{
  sequence: number;
  tick: number;
}>;
```

## API

```ts
export class DomainEventJournal {
  append(tick: number, event: DomainEvent): JournaledDomainEvent;
  list(): readonly JournaledDomainEvent[];
  since(sequenceExclusive: number): readonly JournaledDomainEvent[];
  clearDiagnosticHistory(): void;
  getNextSequence(): number;
}
```

## Semantics

- Event sequence starts at `1`.
- Events preserve append order exactly.
- Event payload references are copied/frozen sufficiently to prevent later mutation through the journal API.
- `clearDiagnosticHistory()` may remove retained events but does not rewind the sequence counter.
- Phase 0A V7 gameplay emits no new domain events, so save/load behavior is unchanged.

The event journal is not yet treated as authoritative persisted history. A later replay/persistence tranche will define persistence and retention.

# 5. RandomStreamRegistry

The registry provides deterministic named streams while preserving the existing V7 random behavior.

## API

```ts
export type RandomStreamSnapshot = Readonly<Record<string, number>>;

export class RandomStreamRegistry {
  constructor(rootSeed: number);
  stream(name: string): SeededRandom;
  snapshot(): RandomStreamSnapshot;
  restore(snapshot: RandomStreamSnapshot): void;
  listNames(): readonly string[];
}
```

## Seed derivation

Each stream seed is deterministically derived from:

`root seed + UTF-16/UTF-8 stable stream-name hash`

using a repository-owned integer mixing function implemented in `RandomStreamRegistry.ts`. It must not depend on JavaScript object hash behavior, locale, browser randomness or platform-specific APIs.

The output seed must be a non-zero unsigned 32-bit integer so it is valid for the existing `SeededRandom` implementation.

## Isolation invariant

For a fixed root seed and stream name, the stream sequence must be identical across runs. Drawing any number of values from stream `traffic` must not alter the current or future sequence of stream `demographics`.

## V7 compatibility

`SimulationCore.random` remains the existing standalone `SeededRandom` and continues to serialize through the existing `rngState` field. Existing subsystem-local RNGs such as trip generation and incidents remain untouched.

The kernel registry is instantiated in Phase 0A but **no current gameplay system consumes its streams**. Therefore its state is intentionally not added to Save V7. When the first authoritative gameplay domain migrates to a named stream, that later tranche must either add persisted stream state or use a deterministic counter/keyed scheme that requires no mutable persisted state.

# 6. InvariantRunner

The invariant runner centralizes checks that must fail loudly when authoritative state violates a declared invariant.

## Contract

```ts
export type KernelInvariant = Readonly<{
  id: string;
  cadence: SystemCadence;
  check(context: KernelStepContext): void;
}>;

export class InvariantRunner {
  register(invariant: KernelInvariant): void;
  runDue(tick: number, context: KernelStepContext): void;
  list(): readonly KernelInvariant[];
}
```

Rules mirror system cadence validation. Duplicate invariant IDs are rejected.

Phase 0A registers one built-in kernel invariant:

- `kernel-clock-valid`: tick must remain a finite non-negative integer.

Gameplay conservation invariants remain in their current tests and move into the runner only in later domain migrations.

Invariant failures throw an error containing invariant ID and tick.

# 7. SnapshotRegistry

The snapshot registry provides read-only diagnostic hooks without creating a new authoritative store.

## API

```ts
export type SnapshotProvider = () => unknown;

export class SnapshotRegistry {
  register(id: string, provider: SnapshotProvider): void;
  capture(id: string): unknown;
  captureAll(): Readonly<Record<string, unknown>>;
  listIds(): readonly string[];
}
```

Providers are unique by ID and captured in ordinal ID order for `captureAll()`.

Phase 0A registers a kernel diagnostic snapshot exposing:

```ts
{
  tick,
  systems: string[],
  pendingCommands,
  nextCommandSequence,
  retainedEvents,
  nextEventSequence,
  randomStreams: Record<string, number>
}
```

This snapshot is diagnostic only and not written into Save V7.

# 8. SimulationKernel

`SimulationKernel` composes the Phase 0A infrastructure.

## Constructor

```ts
export type SimulationKernelOptions = Readonly<{
  clock: SimulationClock;
  seed: number;
}>;

export class SimulationKernel {
  readonly clock: SimulationClock;
  readonly scheduler: SystemScheduler;
  readonly commands: CommandBus;
  readonly events: DomainEventJournal;
  readonly random: RandomStreamRegistry;
  readonly invariants: InvariantRunner;
  readonly snapshots: SnapshotRegistry;

  constructor(options: SimulationKernelOptions);
  registerSystem(system: KernelSystemDefinition): void;
  compile(): void;
  step(ticks?: number): void;
  diagnosticSnapshot(): Readonly<Record<string, unknown>>;
}
```

## Tick order

For each requested tick:

1. advance the shared `SimulationClock` by exactly one tick;
2. create one `KernelStepContext` bound to that tick;
3. dispatch commands ready for this tick;
4. execute due systems in compiled scheduler order;
5. run due invariants;
6. finish the tick.

This ordering is fixed by Phase 0A and becomes part of the kernel contract.

`step(0)` does nothing. Negative, fractional or non-finite tick counts throw before state changes.

## Compile behavior

The kernel compiles lazily before the first step and recompiles after a subsequent system registration. Invalid scheduler state fails before the next tick is advanced.

# 9. SimulationCore Compatibility Adapter

This is the critical migration seam.

## Shared clock

Construction becomes conceptually:

```ts
this.clock = new SimulationClock();
this.kernel = new SimulationKernel({ clock: this.clock, seed: this.seed });
```

There is exactly one clock object. Existing serializer/hydrator code continues to read and restore `core.clock` directly. Because the kernel references the same object, hydration automatically restores the kernel-visible time without adding save fields.

## Legacy tick extraction

The current body inside the `for` loop of `SimulationCore.step()` is extracted into one private method:

```ts
private runLegacyV7Tick(): void
```

That method starts with the current first operation **after** `this.clock.step(1)` and ends after the existing 10-tick and 50-tick cadence calls. No formulas or ordering inside the legacy body change.

`SimulationCore` registers one kernel system:

```ts
{
  id: 'legacy-v7-city',
  reads: [],
  writes: ['legacy-v7-city'],
  cadence: { every: 1 },
  execute: () => this.runLegacyV7Tick(),
}
```

Then:

```ts
step(ticks = 1): void {
  this.kernel.step(ticks);
}
```

This means the new kernel owns **when** a V7 tick executes, while the existing V7 code still owns **what** happens during that tick.

## Compatibility constraint

`runLegacyV7Tick()` must not call `clock.step()`. The kernel is the sole clock advancer after Phase 0A.

`SimulationCore` public mutation methods remain unchanged. `GameApp` therefore requires no behavior change.

# 10. V7 Save Compatibility

Phase 0A does not introduce Save V8.

The following remain byte/structure compatible with existing V7 serialization expectations:

- `seed`;
- `rngState`;
- `clock`;
- all terrain/treasury/road/zoning/building/population state;
- transit/mobility state;
- economy/freight state;
- developer market state;
- development policy;
- housing relocation state.

`SimulationKernel`, command queue, event journal, kernel RNG registry, invariant registrations and diagnostic snapshots are not serialized because none affects V7 gameplay in Phase 0A.

Hydration constructs a new `SimulationCore`, which constructs a new kernel around the shared clock. Existing V7 hydration then restores `core.clock`, legacy RNGs and gameplay systems as today.

This is valid only while Phase 0A infrastructure has no authoritative gameplay influence beyond scheduling the exact existing tick body. The first later tranche that makes commands, events or named kernel RNG state authoritative must explicitly revisit persistence.

# 11. V7 Parity Harness

Phase 0A requires stronger evidence than ordinary unit tests.

Before modifying `SimulationCore.step()`, capture deterministic baseline scenarios from current `main`.

## Canonical parity scenarios

At minimum capture:

1. empty seeded city stepped through ticks that cross 10/50/100/250 boundaries;
2. road + zoning + utility development scenario;
3. service/incident scenario;
4. transit scenario;
5. economy/freight scenario;
6. Phase 7 housing/development/redevelopment scenario;
7. save → hydrate → continue scenario.

Each scenario records canonical `serializeCoreV7(core)` JSON at selected checkpoints or a SHA-256 digest of the canonical JSON plus separately asserted high-value metrics.

The baseline fixture is captured **before** kernel integration and committed. After kernel integration, the same scenario driver must produce the same fixture/digests.

If JSON key ordering is relied upon for a digest, the scenario driver must use a stable canonical stringify that recursively sorts object keys while preserving array order. The canonicalizer belongs in test support, not runtime code.

## Why this is required

A conventional test suite may miss accidental reordering of operations that still leaves broad metrics plausible. Phase 0A is specifically an orchestration refactor, so exact deterministic continuation is the primary acceptance condition.

# 12. Tests

Create dedicated kernel tests separate from existing Phase 1–7 domain tests.

## Scheduler tests

Cover:

- registration-order independence;
- `order` and ID deterministic tie-breaking;
- `after`/`before` dependencies;
- cadence and offset;
- dependency-cycle rejection;
- unknown-dependency rejection;
- ambiguous overlapping write-conflict rejection;
- valid explicitly ordered write sharing;
- no conflict for non-overlapping cadences where overlap is mathematically impossible.

## Command tests

Cover:

- monotonic sequences;
- FIFO dispatch;
- future-tick commands remaining queued;
- enqueue-during-dispatch deferral;
- duplicate handler rejection;
- handler exception abort semantics.

## Event tests

Cover:

- monotonic event sequence;
- stable append order;
- `since()` filtering;
- diagnostic clear without sequence rewind;
- payload isolation from external mutation.

## RNG tests

Cover:

- same root seed/name → same sequence;
- different stream names → independently derived sequences;
- draws from one stream do not alter another;
- snapshot/restore reproduces continuation;
- stream listing is deterministic.

## Invariant tests

Cover:

- cadence;
- duplicate IDs;
- failure includes ID/tick;
- built-in clock invariant.

## Snapshot tests

Cover:

- unique providers;
- deterministic provider ordering;
- capture-all output;
- kernel diagnostic metadata.

## Integration/parity tests

Cover:

- `SimulationCore.step()` advances exactly one clock tick per kernel tick;
- existing 10/50/100/250 cadence effects remain exact;
- V7 baseline parity fixtures remain identical;
- V7 serialization schema contains no Phase 0A fields;
- hydrate and continue remains deterministic.

# 13. Error Handling

Kernel configuration errors must fail early and explicitly.

Examples:

- `duplicate kernel system: traffic`
- `unknown kernel dependency: x -> y`
- `kernel dependency cycle: a -> b -> a`
- `ambiguous write conflict on domain traffic: a, b`
- `invalid cadence for system x`
- `duplicate command handler: BuildRoad`
- `invariant failed [population-conservation] at tick 500`

Errors should include stable machine-searchable component IDs. The kernel does not catch and suppress simulation exceptions.

# 14. Performance

Phase 0A adds orchestration overhead but no additional gameplay work.

Acceptance target:

- scheduler work per tick is proportional to registered systems, with compiled ordering reused until registration changes;
- no per-tick graph recompilation;
- no per-tick cloning of full city state;
- no event/history growth from V7 gameplay because V7 emits no kernel events yet;
- representative V7 headless stepping must not regress materially from the pre-kernel baseline.

The implementation plan will establish a measured baseline and flag a regression above 5% in median headless simulation time for the same deterministic workload unless variance demonstrates the result is noise.

The 5% threshold is a Phase 0A warning/acceptance target, not a permanent global performance contract.

# 15. File-Level Change Boundary

Phase 0A should normally touch only:

```text
src/simulation/kernel/*
src/simulation/core/SimulationCore.ts
tests/kernel-*.test.ts
tests/support/kernelParity.ts
tests/fixtures/kernel-v7-parity/*
docs/ARCHITECTURE.md
README.md
```

`SimulationClock.ts` and `SeededRandom.ts` should remain behaviorally unchanged unless a test exposes a necessary compatibility fix. Save files should not require code changes; tests may inspect them to prove schema stability.

No UI/rendering/domain-system files should change in Phase 0A.

# 16. Migration Sequence

Implementation proceeds in this order:

1. capture exact V7 parity fixtures on the pre-kernel baseline;
2. implement and test pure kernel primitives independently of `SimulationCore`;
3. compose them in `SimulationKernel`;
4. add the shared-kernel property to `SimulationCore`;
5. extract the existing per-tick body unchanged;
6. register it as `legacy-v7-city`;
7. delegate `SimulationCore.step()` to `SimulationKernel.step()`;
8. run exact parity fixtures and the complete V7 suite;
9. run typecheck/lint/build/smoke verification;
10. update architecture documentation to state that the kernel schedules one legacy V7 compatibility system and no gameplay domain has migrated yet.

At no point should a later Phase 0 feature be mixed into this tranche simply because the kernel package now exists.

# 17. Acceptance Criteria

Phase 0A is accepted only if all of the following are true:

1. `SimulationKernel` is the sole advancer of the shared simulation clock during normal `SimulationCore.step()` execution.
2. `SimulationCore` remains the public V7 gameplay facade.
3. The current V7 per-tick operation order remains unchanged inside the compatibility system.
4. Scheduler order is deterministic and independent of registration order for semantically independent systems.
5. Dependency cycles, unknown dependencies and ambiguous overlapping write conflicts fail before a tick advances.
6. Command sequence ordering is deterministic.
7. Event journal ordering is deterministic.
8. Named RNG streams are deterministic and isolated in unit tests.
9. No existing gameplay domain consumes a kernel RNG stream.
10. Kernel invariant execution works and the clock invariant is active.
11. Snapshot providers produce deterministic diagnostic capture order.
12. Exact V7 parity scenarios match the committed pre-kernel fixtures.
13. Save V7 schema remains unchanged.
14. Existing V7 save → load → continue tests remain deterministic.
15. Full `npm test` passes.
16. `npm run typecheck` passes.
17. `npm run lint` passes.
18. `npm run build` passes.
19. Existing relevant browser smoke tests pass.
20. Measured headless simulation overhead remains inside the Phase 0A performance target or is explicitly investigated before acceptance.
21. `docs/ARCHITECTURE.md` and `README.md` accurately describe the new compatibility architecture.

# 18. Deferred Phase 0 Work

The following belong to later Phase 0 tranches after Phase 0A is proven:

- converting real gameplay mutations to kernel commands;
- migrating individual domains from `legacy-v7-city` into separately registered systems;
- authoritative event emission and replay journals;
- persisted named RNG stream state;
- entity registry;
- spatial index;
- economic ledger;
- long-term statistics/history store;
- full causality contribution tracing;
- performance telemetry beyond the minimal Phase 0A benchmark hooks;
- deterministic replay checkpoints.

Those systems need their own narrower designs because they alter authoritative ownership or persistence.

## Final Architectural Statement

Phase 0A changes the scheduling shell, not the city model.

Before Phase 0A:

`GameApp → SimulationCore.step → clock + all V7 orchestration`

After Phase 0A:

`GameApp → SimulationCore.step → SimulationKernel → legacy-v7-city compatibility system → unchanged V7 orchestration`

That seam is the foundation for Civic Foundry 2.0. Future tranches can peel domains out of `legacy-v7-city` one at a time, register their reads/writes/cadences explicitly, prove parity, then remove the corresponding legacy code only after acceptance.