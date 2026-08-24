# Civic Foundry 2.0 — Phase 0A Kernel Skeleton & Deterministic Scheduling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce the Civic Foundry 2.0 simulation kernel beneath the current V7 runtime while preserving exact V7 gameplay behavior, save structure, deterministic continuation, and public `SimulationCore` APIs.

**Architecture:** Add a focused `src/simulation/kernel/` package containing deterministic scheduling, command/event infrastructure, isolated RNG streams, invariants, snapshot hooks, and `SimulationKernel`. Keep every current gameplay domain inside one `legacy-v7-city` compatibility system. `SimulationCore.step()` delegates timing to the kernel, while the extracted legacy per-tick body remains behaviorally unchanged.

**Tech Stack:** TypeScript 5.x ES modules; Node 22 built-in test runner with `--experimental-strip-types`; browser-native runtime; no new runtime dependencies; `node:crypto` and `node:perf_hooks` only in test support.

**Spec:** `docs/superpowers/specs/2026-08-24-phase-0a-kernel-design.md`

## Global Constraints

- Preserve the V7 public `SimulationCore` gameplay facade.
- Do not migrate roads, buildings, traffic, transit, services, economy, housing, or development to separate kernel systems in Phase 0A.
- Do not alter current gameplay formulas, cadence, random-number consumption, or public mutation APIs.
- Keep `SimulationCore.random` and all subsystem-local V7 RNG state untouched.
- Do not change Save V7 schema or introduce Save V8.
- Do not persist kernel command/event/RNG/invariant/snapshot state in Phase 0A.
- No runtime npm dependency may be added.
- `SimulationKernel` becomes the sole normal advancer of the shared `SimulationClock` after integration.
- Existing V7 operation order inside a tick must remain exact.
- Tests are written first for each material behavior change.
- Exact parity against pre-kernel fixtures is the primary integration gate.
- Source-file target is under 500 LOC; review is required before any orchestration file exceeds 1,000 LOC.
- No UI, rendering, or gameplay-domain files change unless a parity regression proves a strictly necessary compatibility fix.

---

## File Structure

### New runtime files

- `src/simulation/kernel/KernelTypes.ts` — shared kernel type contracts and cadence helpers.
- `src/simulation/kernel/SystemScheduler.ts` — registration validation, dependency graph compilation, cadence overlap detection, deterministic topological ordering.
- `src/simulation/kernel/CommandBus.ts` — sequenced command queue and handler dispatch.
- `src/simulation/kernel/DomainEventJournal.ts` — deterministic append-only diagnostic event history.
- `src/simulation/kernel/RandomStreamRegistry.ts` — stable named RNG derivation/snapshot/restore using existing `SeededRandom`.
- `src/simulation/kernel/InvariantRunner.ts` — cadence-aware invariant registration and failure wrapping.
- `src/simulation/kernel/SnapshotRegistry.ts` — ordered read-only diagnostic providers.
- `src/simulation/kernel/SimulationKernel.ts` — kernel composition, compile lifecycle, fixed tick execution.

### Existing runtime file modified

- `src/simulation/core/SimulationCore.ts` — add readonly kernel, register `legacy-v7-city`, extract legacy per-tick body, delegate `step()` to kernel.

### New tests/support

- `tests/kernel-scheduler.test.ts`
- `tests/kernel-command-event.test.ts`
- `tests/kernel-random-invariant-snapshot.test.ts`
- `tests/kernel-simulation.test.ts`
- `tests/kernel-v7-parity.test.ts`
- `tests/support/kernelParity.ts`
- `tests/support/generateKernelParityFixture.ts`
- `tests/fixtures/kernel-v7-parity/baseline.json`

### Existing tests/docs modified only where needed

- `tests/save-v7.test.ts` — explicit schema-exclusion assertion for Phase 0A kernel state.
- `docs/ARCHITECTURE.md` — describe kernel shell + single legacy compatibility system.
- `README.md` — mark Phase 0A architecture baseline without claiming gameplay-domain migration.

---

### Task 1: Capture the Pre-Kernel V7 Parity Baseline

**Files:**
- Create: `tests/support/kernelParity.ts`
- Create: `tests/support/generateKernelParityFixture.ts`
- Create: `tests/fixtures/kernel-v7-parity/baseline.json`
- Create: `tests/kernel-v7-parity.test.ts`

**Interfaces:**
- Produces: `canonicalStringify(value: unknown): string`
- Produces: `digestCanonical(value: unknown): string`
- Produces: `runKernelParityScenarios(): KernelParityFixture`
- Produces fixture shape:

```ts
export type KernelParityFixture = Readonly<{
  version: 1;
  scenarios: Readonly<Record<string, Readonly<{
    checkpoints: Readonly<Record<string, string>>;
    metrics: Readonly<Record<string, number | string | boolean>>;
  }>>>;
}>;
```

- Consumes existing `SimulationCore`, `serializeCoreV7`, `hydrateCoreV7`, `TerrainGrid`, and current direct V7 APIs only.
- This task must be completed and committed **before** any runtime kernel code is added.

- [ ] **Step 1: Add deterministic canonical JSON support**

Create `tests/support/kernelParity.ts` with recursive key sorting that preserves array order:

```ts
import { createHash } from 'node:crypto';
import { SimulationCore } from '../../src/simulation/core/SimulationCore.ts';
import { serializeCoreV7, hydrateCoreV7 } from '../../src/save/saveV7.ts';
import { TerrainGrid, type TerrainCell } from '../../src/world/terrain/TerrainGrid.ts';

export type KernelParityScenario = Readonly<{
  checkpoints: Readonly<Record<string, string>>;
  metrics: Readonly<Record<string, number | string | boolean>>;
}>;

export type KernelParityFixture = Readonly<{
  version: 1;
  scenarios: Readonly<Record<string, KernelParityScenario>>;
}>;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) result[key] = canonicalize(source[key]);
    return result;
  }
  return value;
}

export function canonicalStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function digestCanonical(value: unknown): string {
  return createHash('sha256').update(canonicalStringify(value)).digest('hex');
}

export function flatTerrain(width = 24, height = 12): TerrainGrid {
  const cells: TerrainCell[] = Array.from({ length: width * height }, () => ({
    elevation: 0.5,
    water: false,
    buildable: true,
    biome: 'grass' as const,
  }));
  return new TerrainGrid(width, height, cells);
}

function checkpoint(core: SimulationCore): string {
  return digestCanonical(serializeCoreV7(core));
}
```

- [ ] **Step 2: Add seven canonical parity scenarios**

In the same support file, implement `runKernelParityScenarios()` using fixed flat terrain so setup never depends on generated buildability. Use only public/direct V7 interfaces and assert setup success with local `must()` helper:

```ts
function must(ok: boolean, message: string): void {
  if (!ok) throw new Error(`parity setup failed: ${message}`);
}

function baseCore(seed: number): SimulationCore {
  return new SimulationCore({ terrain: flatTerrain(), seed, startingFunds: 5_000_000 });
}

function roadCells(y: number): Array<{ x: number; y: number }> {
  return Array.from({ length: 18 }, (_, i) => ({ x: i + 3, y }));
}
```

Implement these scenarios exactly:

1. `empty-boundaries` — step a new seeded core to ticks 9, 10, 49, 50, 99, 100, 249, 250 and record hashes at each checkpoint.
2. `city-development` — place a horizontal local-road spine, paint adjacent residential/commercial/industrial strips, place power + water next to road, step through 50/250/500, record hashes and population/building/treasury metrics.
3. `services-incidents` — create the same road/zoning/utility setup, place fire/police/clinic/school/service-landfill facilities on valid adjacent cells, step through 100/500/1_000, record active/completed incident and service-vehicle counts plus hashes.
4. `transit` — create two `surface_stop` stops next to the road, create one bus line, set two stops, headway 20, fare 1, enable it, set `core.mobility.operations.setFleetLimit(lineId, 4)`, then step through 100/500/1_000 and record line/vehicle/ridership hashes/metrics.
5. `economy-freight` — create road plus commercial/industrial zoning and utilities, run through 250/1_000/2_000, record firm count, freight vehicle count, employment and hashes.
6. `housing-development` — create a long residential frontage with mixed commercial/industrial demand support, utilities, step through 500/1_500/3_000, record residential building count, population, housing affordability index, developer commitment count and hashes.
7. `save-hydrate-continue` — build a city using the same deterministic setup, step 1_000, serialize, hydrate, then step both original and hydrated cores another 500; record the pre-save hash, hydrated-immediate hash, final original hash, and final hydrated hash.

Use metrics only from stable public snapshots already exposed by `SimulationCore`; do not add runtime APIs for fixture generation.

- [ ] **Step 3: Add the fixture generator**

Create `tests/support/generateKernelParityFixture.ts`:

```ts
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { runKernelParityScenarios, canonicalStringify } from './kernelParity.ts';

const path = 'tests/fixtures/kernel-v7-parity/baseline.json';
mkdirSync(dirname(path), { recursive: true });
writeFileSync(path, `${canonicalStringify(runKernelParityScenarios())}\n`, 'utf8');
console.log(path);
```

- [ ] **Step 4: Generate the baseline on untouched V7 runtime**

Run:

```bash
node --experimental-strip-types tests/support/generateKernelParityFixture.ts
```

Expected: prints `tests/fixtures/kernel-v7-parity/baseline.json`; file contains `version: 1` and all seven scenario keys.

- [ ] **Step 5: Add a baseline self-check test**

Create `tests/kernel-v7-parity.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { canonicalStringify, runKernelParityScenarios, type KernelParityFixture } from './support/kernelParity.ts';

const baseline = JSON.parse(readFileSync('tests/fixtures/kernel-v7-parity/baseline.json', 'utf8')) as KernelParityFixture;

test('current V7 runtime matches the committed Phase 0A pre-kernel baseline', () => {
  const current = runKernelParityScenarios();
  assert.equal(canonicalStringify(current), canonicalStringify(baseline));
});
```

- [ ] **Step 6: Run the parity test before kernel implementation**

Run:

```bash
node --experimental-strip-types --test tests/kernel-v7-parity.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit the immutable baseline**

```bash
git add tests/support/kernelParity.ts tests/support/generateKernelParityFixture.ts tests/fixtures/kernel-v7-parity/baseline.json tests/kernel-v7-parity.test.ts
git commit -m "test: capture V7 kernel parity baseline"
```

---

### Task 2: Define Kernel Contracts and Deterministic System Scheduler

**Files:**
- Create: `src/simulation/kernel/KernelTypes.ts`
- Create: `src/simulation/kernel/SystemScheduler.ts`
- Create: `tests/kernel-scheduler.test.ts`

**Interfaces:**
- Produces `DomainKey`, `KernelSystemId`, `CommandType`, `EventType`, `SystemCadence`, `KernelStepContext`, `KernelSystemDefinition`, `KernelCommand`, `SequencedCommand`, `DomainEvent`, `JournaledDomainEvent`, `KernelInvariant`.
- Produces `isDue(cadence: SystemCadence, tick: number): boolean` and `validateCadence(cadence: SystemCadence, owner: string): void`.
- Produces `SystemScheduler.register()`, `compile()`, `dueSystems()`, `listSystems()`.

- [ ] **Step 1: Write scheduler contract tests first**

Create `tests/kernel-scheduler.test.ts` covering stable ordering, dependencies, cadence, cycles, unknown dependencies, write conflicts and non-overlap. The core ordering test must prove registration order independence:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { SystemScheduler } from '../src/simulation/kernel/SystemScheduler.ts';
import type { KernelSystemDefinition } from '../src/simulation/kernel/KernelTypes.ts';

const noop = (): void => {};
const system = (id: string, options: Partial<KernelSystemDefinition> = {}): KernelSystemDefinition => ({
  id,
  reads: [],
  writes: [],
  cadence: { every: 1 },
  execute: noop,
  ...options,
});

test('scheduler order is independent of registration order', () => {
  const a = new SystemScheduler();
  a.register(system('zeta'));
  a.register(system('alpha'));
  const b = new SystemScheduler();
  b.register(system('alpha'));
  b.register(system('zeta'));
  assert.deepEqual(a.compile().map((item) => item.id), ['alpha', 'zeta']);
  assert.deepEqual(b.compile().map((item) => item.id), ['alpha', 'zeta']);
});
```

Also add explicit assertions that:

```ts
assert.throws(() => scheduler.compile(), /kernel dependency cycle/);
assert.throws(() => scheduler.compile(), /unknown kernel dependency/);
assert.throws(() => scheduler.compile(), /ambiguous write conflict/);
```

Use cadence examples `{ every: 2, offset: 0 }` and `{ every: 2, offset: 1 }` to prove mathematically non-overlapping writers are allowed.

- [ ] **Step 2: Run scheduler tests and verify red state**

Run:

```bash
node --experimental-strip-types --test tests/kernel-scheduler.test.ts
```

Expected: FAIL because kernel files do not exist.

- [ ] **Step 3: Implement `KernelTypes.ts`**

Define exact types from the design, including type-only imports to avoid runtime cycles:

```ts
import type { CommandBus } from './CommandBus.ts';
import type { DomainEventJournal } from './DomainEventJournal.ts';
import type { RandomStreamRegistry } from './RandomStreamRegistry.ts';
import type { SnapshotRegistry } from './SnapshotRegistry.ts';

export type DomainKey = string;
export type KernelSystemId = string;
export type CommandType = string;
export type EventType = string;

export type SystemCadence = Readonly<{ every: number; offset?: number }>;

export function validateCadence(cadence: SystemCadence, owner: string): void {
  if (!Number.isInteger(cadence.every) || cadence.every <= 0) throw new Error(`invalid cadence for ${owner}`);
  const offset = cadence.offset ?? 0;
  if (!Number.isInteger(offset) || offset < 0 || offset >= cadence.every) throw new Error(`invalid cadence for ${owner}`);
}

export function isDue(cadence: SystemCadence, tick: number): boolean {
  const offset = cadence.offset ?? 0;
  return tick >= offset && (tick - offset) % cadence.every === 0;
}

export type KernelStepContext = Readonly<{
  tick: number;
  commands: CommandBus;
  events: DomainEventJournal;
  random: RandomStreamRegistry;
  snapshots: SnapshotRegistry;
}>;

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

Define command/event/invariant types exactly as specified in the phase design.

- [ ] **Step 4: Implement deterministic scheduler validation and compilation**

In `SystemScheduler.ts`, keep registration storage in a `Map<string, KernelSystemDefinition>`, normalize/copy arrays on registration, and compile to an immutable sorted array.

Implement helper logic:

```ts
function gcd(a: number, b: number): number {
  while (b !== 0) [a, b] = [b, a % b];
  return Math.abs(a);
}

function cadencesOverlap(a: SystemCadence, b: SystemCadence): boolean {
  const ao = a.offset ?? 0;
  const bo = b.offset ?? 0;
  return (ao - bo) % gcd(a.every, b.every) === 0;
}
```

Use graph reachability after dependency edges are built to decide whether shared writers are explicitly ordered. Reject a shared-write pair if cadences overlap and neither system reaches the other.

Use deterministic Kahn topological sort: available systems sorted by `(order ?? 0)` then `id.localeCompare(..., 'en', { sensitivity: 'variant' })` is **not** acceptable because locale behavior may vary; use ordinal comparison `a.id < b.id ? -1 : a.id > b.id ? 1 : 0`.

- [ ] **Step 5: Run scheduler tests**

Run:

```bash
node --experimental-strip-types --test tests/kernel-scheduler.test.ts
npm run typecheck
```

Expected: PASS and typecheck exit 0.

- [ ] **Step 6: Commit scheduler foundation**

```bash
git add src/simulation/kernel/KernelTypes.ts src/simulation/kernel/SystemScheduler.ts tests/kernel-scheduler.test.ts
git commit -m "feat: add deterministic kernel scheduler"
```

---

### Task 3: Add Sequenced Commands and Deterministic Domain Event Journal

**Files:**
- Create: `src/simulation/kernel/CommandBus.ts`
- Create: `src/simulation/kernel/DomainEventJournal.ts`
- Create: `tests/kernel-command-event.test.ts`

**Interfaces:**
- Consumes `KernelCommand`, `SequencedCommand`, `CommandHandler`, `KernelStepContext`, `DomainEvent`, `JournaledDomainEvent` from `KernelTypes.ts`.
- Produces `CommandBus` and `DomainEventJournal` APIs from the phase spec.

- [ ] **Step 1: Write command/event tests first**

Create tests for sequence monotonicity, FIFO dispatch, future tick retention, enqueue-during-dispatch deferral, duplicate handler rejection, abort-on-handler-error, event order, `since()`, clear-without-rewind and payload isolation.

Critical enqueue-during-dispatch test:

```ts
test('commands enqueued during dispatch wait for the next drain', () => {
  const bus = new CommandBus();
  const seen: number[] = [];
  bus.registerHandler('root', (command) => {
    seen.push(command.sequence);
    bus.enqueue({ type: 'child', payload: {} }, command.enqueuedTick);
  });
  bus.registerHandler('child', (command) => seen.push(command.sequence));
  bus.enqueue({ type: 'root', payload: {} }, 1);
  bus.dispatchReady(1, context(bus));
  assert.deepEqual(seen, [1]);
  bus.dispatchReady(1, context(bus));
  assert.deepEqual(seen, [1, 2]);
});
```

Critical payload-isolation test:

```ts
const payload = { nested: { value: 1 } };
const event = journal.append(5, { type: 'x', source: 'test', payload });
payload.nested.value = 2;
assert.deepEqual(event.payload, { nested: { value: 1 } });
```

- [ ] **Step 2: Run tests and verify red state**

```bash
node --experimental-strip-types --test tests/kernel-command-event.test.ts
```

Expected: FAIL because implementations do not exist.

- [ ] **Step 3: Implement `CommandBus`**

Use an array for pending commands and a map for handlers. Capture the ready set before invoking any handler so newly enqueued commands do not join the active drain:

```ts
const ready = this.queue.filter((item) => item.enqueuedTick <= tick).sort((a, b) => a.sequence - b.sequence);
const readyIds = new Set(ready.map((item) => item.sequence));
this.queue = this.queue.filter((item) => !readyIds.has(item.sequence));
for (const command of ready) {
  const handler = this.handlers.get(command.command.type);
  if (!handler) throw new Error(`no command handler: ${command.command.type}`);
  handler(command, context);
}
return Object.freeze([...ready]);
```

If a handler throws, propagate immediately; already-dispatched commands remain dispatched and undispatched items from the captured ready set must be restored to the front of the pending queue in original sequence order. Test this explicitly so abort semantics never silently drop commands.

- [ ] **Step 4: Implement `DomainEventJournal`**

Use repository-owned deep-copy/freezing for JSON-like event payloads. Do not use `structuredClone` because Phase 0A wants deterministic supported payload semantics and no browser-specific clone edge cases.

Implement:

```ts
function isolate(value: unknown): unknown {
  if (Array.isArray(value)) return Object.freeze(value.map(isolate));
  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>)) output[key] = isolate((value as Record<string, unknown>)[key]);
    return Object.freeze(output);
  }
  return value;
}
```

Reject invalid negative/fractional ticks and empty event type/source strings.

- [ ] **Step 5: Run focused tests and typecheck**

```bash
node --experimental-strip-types --test tests/kernel-command-event.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit command/event infrastructure**

```bash
git add src/simulation/kernel/CommandBus.ts src/simulation/kernel/DomainEventJournal.ts tests/kernel-command-event.test.ts
git commit -m "feat: add kernel command and event sequencing"
```

---

### Task 4: Add Named RNG Streams, Invariants, and Diagnostic Snapshots

**Files:**
- Create: `src/simulation/kernel/RandomStreamRegistry.ts`
- Create: `src/simulation/kernel/InvariantRunner.ts`
- Create: `src/simulation/kernel/SnapshotRegistry.ts`
- Create: `tests/kernel-random-invariant-snapshot.test.ts`

**Interfaces:**
- Consumes existing `SeededRandom` without changing its algorithm.
- Produces `RandomStreamRegistry`, `InvariantRunner`, `SnapshotRegistry`.

- [ ] **Step 1: Write RNG isolation and restore tests**

Add:

```ts
test('named random streams are deterministic and isolated', () => {
  const a = new RandomStreamRegistry(42);
  const b = new RandomStreamRegistry(42);
  assert.equal(a.stream('traffic').next(), b.stream('traffic').next());
  const demographicBefore = a.stream('demographics').getState();
  for (let i = 0; i < 100; i++) a.stream('traffic').next();
  assert.equal(a.stream('demographics').getState(), demographicBefore);
});
```

Snapshot/restore must reproduce the next value for every previously created stream.

- [ ] **Step 2: Write invariant and snapshot tests**

Cover duplicate invariant IDs, cadence, stable failure text, duplicate snapshot IDs, ordinal ID ordering, and `captureAll()`.

Invariant failure assertion:

```ts
assert.throws(() => runner.runDue(10, context), /invariant failed \[population-conservation\] at tick 10/);
```

- [ ] **Step 3: Run test and verify red state**

```bash
node --experimental-strip-types --test tests/kernel-random-invariant-snapshot.test.ts
```

Expected: FAIL.

- [ ] **Step 4: Implement `RandomStreamRegistry` with stable integer derivation**

Use FNV-1a-style UTF-16 code-unit hashing plus a final integer mixer owned by the repository:

```ts
function hashName(name: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    hash ^= name.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function mix32(value: number): number {
  let x = value >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d) >>> 0;
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b) >>> 0;
  x ^= x >>> 16;
  return (x >>> 0) || 0x6d2b79f5;
}

function deriveSeed(rootSeed: number, name: string): number {
  if (!name.trim()) throw new Error('random stream name must not be empty');
  return mix32((rootSeed >>> 0) ^ hashName(name));
}
```

`listNames()` and `snapshot()` must return keys in ordinal sorted order.

- [ ] **Step 5: Implement `InvariantRunner`**

Validate cadence at registration. `runDue()` wraps failures while retaining the original message:

```ts
try {
  invariant.check(context);
} catch (error) {
  const detail = error instanceof Error ? `: ${error.message}` : '';
  throw new Error(`invariant failed [${invariant.id}] at tick ${tick}${detail}`);
}
```

- [ ] **Step 6: Implement `SnapshotRegistry`**

Keep providers in a map; sort IDs ordinally on list/capture-all. `capture('missing')` throws `unknown snapshot provider: missing`.

- [ ] **Step 7: Run focused tests and typecheck**

```bash
node --experimental-strip-types --test tests/kernel-random-invariant-snapshot.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit support primitives**

```bash
git add src/simulation/kernel/RandomStreamRegistry.ts src/simulation/kernel/InvariantRunner.ts src/simulation/kernel/SnapshotRegistry.ts tests/kernel-random-invariant-snapshot.test.ts
git commit -m "feat: add kernel deterministic support services"
```

---

### Task 5: Compose `SimulationKernel`

**Files:**
- Create: `src/simulation/kernel/SimulationKernel.ts`
- Create: `tests/kernel-simulation.test.ts`

**Interfaces:**
- Consumes shared `SimulationClock`, `SystemScheduler`, `CommandBus`, `DomainEventJournal`, `RandomStreamRegistry`, `InvariantRunner`, `SnapshotRegistry`.
- Produces constructor and API exactly defined in Phase 0A spec:

```ts
new SimulationKernel({ clock, seed });
kernel.registerSystem(system);
kernel.compile();
kernel.step(ticks);
kernel.diagnosticSnapshot();
```

- [ ] **Step 1: Write kernel execution-order tests first**

Create `tests/kernel-simulation.test.ts` proving tick order is:

`clock advance → command dispatch → due systems → invariants`.

Use a trace array:

```ts
const trace: string[] = [];
commands.registerHandler('test', () => trace.push(`command:${clock.tick}`));
kernel.registerSystem({
  id: 'system', reads: [], writes: ['test'], cadence: { every: 1 },
  execute: () => trace.push(`system:${clock.tick}`),
});
invariants.register({
  id: 'trace', cadence: { every: 1 },
  check: () => trace.push(`invariant:${clock.tick}`),
});
commands.enqueue({ type: 'test', payload: {} }, 1);
kernel.step(1);
assert.deepEqual(trace, ['command:1', 'system:1', 'invariant:1']);
```

Also test `step(0)`, invalid tick counts, compile failure before clock advancement, lazy recompile after registration, and diagnostic snapshot contents.

- [ ] **Step 2: Run test and verify red state**

```bash
node --experimental-strip-types --test tests/kernel-simulation.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement `SimulationKernel` composition**

Constructor must initialize all components, register built-in clock invariant, and register `kernel` snapshot provider:

```ts
this.invariants.register({
  id: 'kernel-clock-valid',
  cadence: { every: 1 },
  check: ({ tick }) => {
    if (!Number.isFinite(tick) || !Number.isInteger(tick) || tick < 0) throw new Error('invalid simulation clock');
  },
});

this.snapshots.register('kernel', () => ({
  tick: this.clock.tick,
  systems: this.scheduler.listSystems().map((item) => item.id),
  pendingCommands: this.commands.pending().length,
  nextCommandSequence: this.commands.getNextSequence(),
  retainedEvents: this.events.list().length,
  nextEventSequence: this.events.getNextSequence(),
  randomStreams: this.random.snapshot(),
}));
```

`registerSystem()` marks compiled state dirty. `step()` validates all input before mutation, compiles if dirty, then performs one-tick order exactly from the spec.

- [ ] **Step 4: Run all kernel-only tests**

```bash
node --experimental-strip-types --test tests/kernel-scheduler.test.ts tests/kernel-command-event.test.ts tests/kernel-random-invariant-snapshot.test.ts tests/kernel-simulation.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit composed kernel**

```bash
git add src/simulation/kernel/SimulationKernel.ts tests/kernel-simulation.test.ts
git commit -m "feat: compose Phase 0A simulation kernel"
```

---

### Task 6: Insert the Kernel Beneath `SimulationCore` Without Changing V7 Behavior

**Files:**
- Modify: `src/simulation/core/SimulationCore.ts`
- Modify: `tests/save-v7.test.ts`
- Existing parity test: `tests/kernel-v7-parity.test.ts`

**Interfaces:**
- Adds `readonly kernel: SimulationKernel` to `SimulationCore`.
- Adds private `runLegacyV7Tick(): void`.
- Keeps existing `step(ticks = 1): void` public signature unchanged.
- Keeps all current public mutation/snapshot properties unchanged.

- [ ] **Step 1: Strengthen save-schema test before integration**

In `tests/save-v7.test.ts`, add a test that serializes a core and explicitly confirms kernel-only fields are absent:

```ts
test('Phase 0A kernel infrastructure does not change Save V7 schema', () => {
  const core = new SimulationCore({ width: 12, height: 8, seed: 77 });
  const save = serializeCoreV7(core) as unknown as Record<string, unknown>;
  assert.equal(save.saveVersion, 7);
  for (const key of ['kernel', 'commands', 'events', 'randomStreams', 'invariants', 'snapshots']) {
    assert.equal(Object.prototype.hasOwnProperty.call(save, key), false, `unexpected Phase 0A field ${key}`);
  }
});
```

Run:

```bash
node --experimental-strip-types --test tests/save-v7.test.ts
```

Expected: PASS before integration.

- [ ] **Step 2: Add `SimulationKernel` construction and compatibility registration**

Import:

```ts
import { SimulationKernel } from '../kernel/SimulationKernel.ts';
```

Add property:

```ts
readonly kernel: SimulationKernel;
```

Immediately after `this.clock = new SimulationClock();` in the constructor:

```ts
this.kernel = new SimulationKernel({ clock: this.clock, seed: this.seed });
```

After all V7 systems and initial snapshots have been initialized, register:

```ts
this.kernel.registerSystem({
  id: 'legacy-v7-city',
  reads: [],
  writes: ['legacy-v7-city'],
  cadence: { every: 1 },
  execute: () => this.runLegacyV7Tick(),
});
```

Do not call `kernel.compile()` manually; lazy compilation is part of the kernel contract.

- [ ] **Step 3: Extract the existing loop body mechanically**

Current `SimulationCore.step()` begins:

```ts
for (let i = 0; i < ticks; i++) {
  this.clock.step(1);
  this.transportationGraph.rebuildIfNeeded(this.roads);
  ...
}
```

Move everything from `this.transportationGraph.rebuildIfNeeded(this.roads);` through the existing 10-tick/50-tick evaluations into:

```ts
private runLegacyV7Tick(): void {
  this.transportationGraph.rebuildIfNeeded(this.roads);
  // exact former body, unchanged in order and formulas
}
```

Do **not** edit expressions while moving them. The only deleted operation from the old body is `this.clock.step(1)` because the kernel now owns it.

Replace public method with:

```ts
step(ticks = 1): void {
  this.kernel.step(ticks);
}
```

- [ ] **Step 4: Run exact parity immediately**

Run:

```bash
node --experimental-strip-types --test tests/kernel-v7-parity.test.ts
```

Expected: PASS against the pre-kernel fixture byte-for-byte/canonical-hash-for-hash.

If it fails, stop and diff the first mismatched scenario/checkpoint. Do not update the fixture. Restore operation order until parity returns.

- [ ] **Step 5: Run core/save integration tests**

```bash
node --experimental-strip-types --test tests/core-foundation.test.ts tests/core-city-loop.test.ts tests/save-v7.test.ts tests/phase6-headless.test.ts tests/phase7-tenure-relocation-invariants.test.ts tests/kernel-v7-parity.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit compatibility insertion only after parity is green**

```bash
git add src/simulation/core/SimulationCore.ts tests/save-v7.test.ts
git commit -m "refactor: schedule V7 through simulation kernel"
```

---

### Task 7: Add Phase 0A Performance Gate and Full Verification

**Files:**
- Modify: `tests/kernel-simulation.test.ts`
- Modify: `tests/support/kernelParity.ts` only if a reusable deterministic workload helper is needed; do not change baseline expected hashes.

**Interfaces:**
- Produces no runtime API.
- Verifies scheduler overhead and total V7 correctness.

- [ ] **Step 1: Add a deterministic headless timing workload**

In `tests/kernel-simulation.test.ts`, import `performance` from `node:perf_hooks` and run a stable workload multiple times after a warm-up:

```ts
function timeTicks(ticks: number): number {
  const core = new SimulationCore({ terrain: flatTerrain(40, 24), seed: 42, startingFunds: 5_000_000 });
  core.step(100); // warm-up
  const start = performance.now();
  core.step(ticks);
  return performance.now() - start;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}
```

Because the pre-kernel absolute baseline cannot be recomputed after integration without checking out the parent commit, execution must record the Task 1 baseline timing in the implementation notes or commit message before runtime changes. The automated test itself should assert only finite/non-pathological runtime, not a machine-specific hard millisecond threshold.

The reviewer compares median 5-run pre/post timings for the same workload. A post-kernel regression above 5% requires investigation and a second measurement set before acceptance.

- [ ] **Step 2: Run focused kernel and parity suite**

```bash
node --experimental-strip-types --test tests/kernel-*.test.ts tests/save-v7.test.ts
```

Expected: all tests PASS.

- [ ] **Step 3: Run complete unit/integration suite**

```bash
npm test
```

Expected: exit 0, zero failures.

- [ ] **Step 4: Run static verification**

```bash
npm run typecheck
npm run lint
npm run build
```

Expected: all exit 0.

- [ ] **Step 5: Run browser smoke tests**

```bash
npm run test:smoke
npm run test:smoke:phase7
```

Expected: both exit 0. Phase 0A has no UI changes, so any smoke regression is a compatibility defect.

- [ ] **Step 6: Verify parity fixture remains untouched**

```bash
git diff --exit-code -- tests/fixtures/kernel-v7-parity/baseline.json
```

Expected: exit 0.

- [ ] **Step 7: Commit performance test support**

```bash
git add tests/kernel-simulation.test.ts tests/support/kernelParity.ts
git commit -m "test: add Phase 0A kernel performance gate"
```

---

### Task 8: Document the New Compatibility Architecture and Final Acceptance Evidence

**Files:**
- Modify: `docs/ARCHITECTURE.md`
- Modify: `README.md`

**Interfaces:**
- No runtime API changes.
- Documentation must describe actual implemented state only.

- [ ] **Step 1: Update architecture boundary**

Change the opening architecture description from `SimulationCore` directly controlling the fixed-step city loop to the implemented compatibility shape:

```text
GameApp → SimulationCore facade → SimulationKernel → legacy-v7-city compatibility system → existing V7 domain orchestration
```

Document these exact facts:

- one shared `SimulationClock` object is referenced by both core and kernel;
- kernel advances the clock;
- `legacy-v7-city` is currently the only production gameplay system registered with the kernel;
- no gameplay domain has migrated to separate kernel ownership yet;
- kernel command/event/named-RNG infrastructure is diagnostic/non-authoritative in Phase 0A;
- Save V7 remains canonical and unchanged;
- future Phase 0 tranches will peel domains out one at a time behind parity gates.

- [ ] **Step 2: Update README roadmap/status**

Add a Civic Foundry 2.0 section stating:

```text
Phase 0A — Foundry Kernel Skeleton: deterministic scheduler, command/event infrastructure, named RNG registry, invariant runner, snapshot registry, and V7 compatibility adapter.
```

Do not rename the current game/save version from `0.7.0-metropolitan` in Phase 0A because the save/runtime compatibility contract intentionally remains V7.

- [ ] **Step 3: Run documentation-adjacent verification**

Run:

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

Expected: all exit 0.

- [ ] **Step 4: Run final smoke verification**

```bash
npm run test:smoke
npm run test:smoke:phase7
```

Expected: both exit 0.

- [ ] **Step 5: Inspect final diff for scope violations**

Run:

```bash
git diff --name-only HEAD~7..HEAD
```

Expected changed production paths are limited to:

```text
src/simulation/kernel/*
src/simulation/core/SimulationCore.ts
```

plus tests, fixture, docs. No `src/app`, `src/ui`, `src/rendering`, save implementation, or gameplay-domain system file should be changed.

- [ ] **Step 6: Commit docs**

```bash
git add docs/ARCHITECTURE.md README.md
git commit -m "docs: describe Civic Foundry Phase 0A kernel"
```

- [ ] **Step 7: Record final verification evidence before completion claim**

Capture the fresh outputs/exit codes for:

```bash
node --experimental-strip-types --test tests/kernel-*.test.ts tests/save-v7.test.ts
npm test
npm run typecheck
npm run lint
npm run build
npm run test:smoke
npm run test:smoke:phase7
git diff --exit-code -- tests/fixtures/kernel-v7-parity/baseline.json
```

The Phase 0A completion report must include:

- number of passing tests and failures from `npm test`;
- exact parity result;
- typecheck/lint/build status;
- smoke status;
- pre/post median timing and percentage delta;
- statement that Save V7 schema is unchanged;
- final commit SHA;
- any remaining deferred Phase 0 work from the phase spec.

---

## Plan Self-Review

### Spec coverage

- `SimulationKernel` API — Task 5.
- compatibility relationship with `SimulationCore` — Task 6.
- system registration contract — Task 2.
- deterministic scheduler ordering/conflicts/cycles — Task 2.
- typed domain declarations — Task 2.
- RNG registry — Task 4.
- command sequencing — Task 3.
- domain-event journal skeleton — Task 3.
- invariant runner — Tasks 4–5.
- minimal snapshot hooks — Tasks 4–5.
- exact V7 parity baseline — Tasks 1, 6, 7.
- no V7 save-schema change — Task 6.
- performance target — Task 7.
- architecture/README updates — Task 8.
- no gameplay-domain migration — enforced by Global Constraints and Task 8 scope check.

### Type consistency

The plan uses the exact Phase 0A names consistently:

- `SimulationKernel`
- `SystemScheduler`
- `CommandBus`
- `DomainEventJournal`
- `RandomStreamRegistry`
- `InvariantRunner`
- `SnapshotRegistry`
- `KernelStepContext`
- `KernelSystemDefinition`
- `SystemCadence`
- `legacy-v7-city`
- `runLegacyV7Tick()`

### Placeholder scan

The plan contains no `TBD`, `TODO`, unspecified implementation steps, or generic “write tests” instructions. Every material behavior has an explicit file, interface, test expectation, and verification command.
