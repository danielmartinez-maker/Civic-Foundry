# Civic Foundry 2.0 — Phase 0B Entity Registry & Referential Integrity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a deterministic, generation-aware cross-domain EntityRegistry and reference graph beneath the existing V7 simulation without changing gameplay behavior or Save V7.

**Architecture:** Add a focused `src/entities/` package containing typed handles, staged projection transactions, reference validation, diagnostics, and a V7 compatibility projector. `SimulationCore` remains the public facade and keeps all gameplay systems authoritative; after each `legacy-v7-city` tick, a second kernel system rebuilds the entity projection and validates references. Entity infrastructure is derived and rebuildable, so Save V7 remains unchanged.

**Tech Stack:** TypeScript 5.x ES modules, Node 22 built-in test runner with `--experimental-strip-types`, existing `SimulationKernel`, existing V7 domain APIs, no runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-08-24-phase-0b-entity-registry-design.md`

## Global Constraints

- Preserve exact V7 gameplay formulas, cadence, RNG consumption, mutation APIs, save envelope, and public `SimulationCore` behavior.
- Do not introduce Save V8 or persist registry/reference state.
- The registry owns identity metadata only; V7 domain systems remain authoritative for gameplay state.
- Use exact generation-aware `EntityHandle`s. Never auto-retarget a stale handle to a newer generation.
- Generation history may be retained during one live registry lifetime, but hydration may reconstruct only history that surviving V7 state proves. Never fabricate missing history.
- Weak references that cannot be bound to an exact reconstructable incarnation remain explicitly unresolved; they must not bind to a newer current entity merely because the raw legacy ID matches.
- Strong and owned references must resolve to active exact handles before a projection commits.
- Projection commits are atomic: invalid entities/references leave the prior committed registry and graph unchanged.
- Deterministic ordering uses ordinal string comparison (`a < b ? -1 : a > b ? 1 : 0`), never `localeCompare()` inside new identity infrastructure.
- No new runtime dependencies.
- No UI/rendering changes.
- The immutable Phase 0A V7 parity fixture remains the primary gameplay regression gate.
- Tests are written before production code for each task.

---

### Task 1: Entity contracts and canonical identity encoding

**Files:**
- Create: `src/entities/EntityTypes.ts`
- Test: `tests/entity-types.test.ts`

**Interfaces:**
- Produces `EntityKind`, `LegacyEntityKey`, `EntityHandle`, `ProjectedEntity`, `EntityReferenceSemantics`, `ProjectedReferenceIntent`, `UnresolvedEntityReference`, `canonicalLegacyKey()`, `canonicalHandleKey()`, `ordinalCompare()`.
- Later tasks rely on these exact names.

- [ ] **Step 1: Write failing contract tests**

Create `tests/entity-types.test.ts` with cases equivalent to:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalHandleKey, canonicalLegacyKey } from '../src/entities/EntityTypes.ts';

test('canonical entity keys separate kind, id and generation unambiguously', () => {
  assert.notEqual(
    canonicalLegacyKey({ kind: 'building', legacyId: 'a|b' }),
    canonicalLegacyKey({ kind: 'building', legacyId: 'a' }),
  );
  assert.notEqual(
    canonicalHandleKey({ kind: 'building', legacyId: 'x', generation: 1 }),
    canonicalHandleKey({ kind: 'building', legacyId: 'x', generation: 2 }),
  );
});

test('canonical handle encoding rejects invalid generations and blank ids', () => {
  assert.throws(() => canonicalHandleKey({ kind: 'building', legacyId: '', generation: 1 }));
  assert.throws(() => canonicalHandleKey({ kind: 'building', legacyId: 'x', generation: 0 }));
  assert.throws(() => canonicalHandleKey({ kind: 'building', legacyId: 'x', generation: 1.5 }));
});
```

- [ ] **Step 2: Run the test and confirm RED**

Run:

```bash
node --experimental-strip-types --test tests/entity-types.test.ts
```

Expected: failure because `src/entities/EntityTypes.ts` does not exist.

- [ ] **Step 3: Implement the contracts**

`EntityTypes.ts` must define:

```ts
export type EntityKind =
  | 'lot' | 'building' | 'firm' | 'utility-facility' | 'service-facility'
  | 'transit-stop' | 'transit-line' | 'traffic-vehicle' | 'service-vehicle'
  | 'freight-vehicle' | 'incident' | 'project' | 'person' | 'cohort'
  | 'household' | 'parcel' | 'unit' | 'facility' | 'contract'
  | 'network-node' | 'network-edge' | 'government-body';

export type LegacyEntityKey<K extends EntityKind = EntityKind> = Readonly<{
  kind: K;
  legacyId: string;
}>;

export type EntityHandle<K extends EntityKind = EntityKind> = Readonly<{
  kind: K;
  legacyId: string;
  generation: number;
}>;

export type ProjectedEntity = Readonly<{
  kind: EntityKind;
  legacyId: string;
  incarnationToken: string;
  metadata?: Readonly<Record<string, string | number | boolean | null>>;
}>;

export type EntityReferenceSemantics = 'strong' | 'owned' | 'weak' | 'external';

export type ProjectedReferenceIntent = Readonly<{
  source: LegacyEntityKey;
  target: LegacyEntityKey;
  semantics: EntityReferenceSemantics;
  relation: string;
  targetIncarnationToken?: string;
}>;

export type UnresolvedEntityReference = Readonly<{
  source: LegacyEntityKey;
  target: LegacyEntityKey;
  semantics: 'weak' | 'external';
  relation: string;
  reason: string;
}>;
```

Canonical encoding must be escape-safe by length-prefixing each string field, e.g. `8:building|3:a|b` rather than delimiter-only concatenation. Validate non-empty IDs/kinds and positive integer generations.

- [ ] **Step 4: Run focused test and static checks**

```bash
node --experimental-strip-types --test tests/entity-types.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/entities/EntityTypes.ts tests/entity-types.test.ts
git commit -m "feat: add typed entity identity contracts"
```

---

### Task 2: Generation-aware EntityRegistry with staged projection

**Files:**
- Create: `src/entities/EntityRegistry.ts`
- Test: `tests/entity-registry.test.ts`

**Interfaces:**
- Consumes Task 1 types and canonical key helpers.
- Produces `EntityRegistry`, `PreparedEntityProjection`, `EntityRegistrySnapshot`, `EntityRecord`, `KnownEntityView`.

- [ ] **Step 1: Write failing registry tests**

Cover:

```ts
const registry = new EntityRegistry();
registry.commitPrepared(registry.prepareProjection([
  { kind: 'building', legacyId: 'building:lot:1,1', incarnationToken: 'start:10' },
]));
const g1 = registry.require('building', 'building:lot:1,1');
assert.equal(g1.generation, 1);

registry.commitPrepared(registry.prepareProjection([
  { kind: 'building', legacyId: 'building:lot:1,1', incarnationToken: 'start:20' },
]));
const g2 = registry.require('building', 'building:lot:1,1');
assert.equal(g2.generation, 2);
assert.equal(registry.isKnown(g1), true);
assert.equal(registry.isActive(g1), false);
assert.equal(registry.isActive(g2), true);
```

Also test:
- identical token preserves the same handle;
- disappearance makes the prior handle historical;
- disappearance followed by reappearance increments generation even if token text repeats;
- duplicate `(kind, legacyId)` in one projection rejects;
- blank incarnation token rejects;
- invalid projection does not mutate previous state;
- input ordering produces identical snapshots;
- returned records/snapshots cannot be used to mutate registry internals.

- [ ] **Step 2: Run and confirm RED**

```bash
node --experimental-strip-types --test tests/entity-registry.test.ts
```

- [ ] **Step 3: Implement staged registry state**

Required shape:

```ts
export type EntityRecord = Readonly<{
  handle: EntityHandle;
  incarnationToken: string;
  metadata: Readonly<Record<string, string | number | boolean | null>>;
  active: boolean;
}>;

export type PreparedEntityProjection = Readonly<{
  activeByLegacyKey: ReadonlyMap<string, EntityRecord>;
  knownByHandleKey: ReadonlyMap<string, EntityRecord>;
  highestGenerationByLegacyKey: ReadonlyMap<string, number>;
}>;

export class EntityRegistry {
  resolve<K extends EntityKind>(kind: K, legacyId: string): EntityHandle<K> | undefined;
  require<K extends EntityKind>(kind: K, legacyId: string): EntityHandle<K>;
  isActive(handle: EntityHandle): boolean;
  isKnown(handle: EntityHandle): boolean;
  resolveKnownByToken(kind: EntityKind, legacyId: string, incarnationToken: string): EntityHandle | undefined;
  listActive(kind?: EntityKind): readonly EntityHandle[];
  listHistorical(kind?: EntityKind): readonly EntityHandle[];
  prepareProjection(entities: readonly ProjectedEntity[]): PreparedEntityProjection;
  commitPrepared(prepared: PreparedEntityProjection): void;
  snapshot(): EntityRegistrySnapshot;
}
```

`prepareProjection()` clones committed state, processes normalized entities in canonical legacy-key order, moves missing active records to historical, increments generation on token change/reappearance, and returns an immutable staged state without mutating the live registry.

- [ ] **Step 4: Run tests**

```bash
node --experimental-strip-types --test tests/entity-types.test.ts tests/entity-registry.test.ts
npm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add src/entities/EntityRegistry.ts tests/entity-registry.test.ts
git commit -m "feat: add generation-aware entity registry"
```

---

### Task 3: Deterministic EntityReferenceGraph and atomic projection coordinator

**Files:**
- Create: `src/entities/EntityReferenceGraph.ts`
- Create: `src/entities/EntityProjection.ts`
- Test: `tests/entity-references.test.ts`

**Interfaces:**
- Consumes `PreparedEntityProjection` and Task 1 reference intents.
- Produces `EntityReference`, `EntityReferenceGraph`, `EntityProjectionBuilder`, `EntityProjectionCommitResult`.

- [ ] **Step 1: Write failing reference tests**

Test all of the following:
- strong firm→building resolves only when target is active;
- owned target must be active;
- weak exact-token reference may bind a known historical generation;
- weak intent with an absent/unprovable target is not auto-retargeted and can be represented as an unresolved diagnostic;
- stale generation remains distinct from a newer current generation;
- duplicate equivalent edges collapse or reject deterministically (choose reject for programming-error visibility);
- graph ordering is source key, relation, semantics, target key using ordinal comparison;
- failed graph preparation leaves the previous registry and graph untouched.

Use an atomic builder flow:

```ts
const builder = new EntityProjectionBuilder();
builder.entity({ kind: 'building', legacyId: 'b1', incarnationToken: 't1' });
builder.entity({ kind: 'firm', legacyId: 'f1', incarnationToken: 't1' });
builder.reference({
  source: { kind: 'firm', legacyId: 'f1' },
  target: { kind: 'building', legacyId: 'b1' },
  semantics: 'strong',
  relation: 'firm-building',
});
commitEntityProjection(registry, graph, builder.build());
```

- [ ] **Step 2: Run and confirm RED**

```bash
node --experimental-strip-types --test tests/entity-references.test.ts
```

- [ ] **Step 3: Implement reference graph**

Required record:

```ts
export type EntityReference = Readonly<{
  source: EntityHandle;
  target: EntityHandle;
  semantics: EntityReferenceSemantics;
  relation: string;
}>;
```

Required graph API:

```ts
export class EntityReferenceGraph {
  prepare(references: readonly EntityReference[], view: KnownEntityView): PreparedReferenceGraph;
  commitPrepared(prepared: PreparedReferenceGraph): void;
  outgoing(source: EntityHandle): readonly EntityReference[];
  incoming(target: EntityHandle): readonly EntityReference[];
  list(): readonly EntityReference[];
  snapshot(): EntityReferenceGraphSnapshot;
}
```

Validation:
- source must be active for all resolved edges;
- `strong`/`owned` target must be active;
- `weak` target must be known exact handle;
- `external` is not emitted as an entity edge in Phase 0B; keep it as unresolved/diagnostic intent until a target entity exists.

- [ ] **Step 4: Implement atomic coordinator**

`EntityProjection.ts` must stage registry first, resolve intents against the staged view, stage graph second, then commit both only after both preparations succeed.

The builder owns:

```ts
entity(entity: ProjectedEntity): this;
reference(intent: ProjectedReferenceIntent): this;
unresolved(reference: UnresolvedEntityReference): this;
build(): EntityProjectionData;
```

`commitEntityProjection(...)` returns committed active/reference/unresolved counts and a deterministic unresolved list.

- [ ] **Step 5: Run focused tests**

```bash
node --experimental-strip-types --test tests/entity-registry.test.ts tests/entity-references.test.ts
npm run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add src/entities/EntityReferenceGraph.ts src/entities/EntityProjection.ts tests/entity-references.test.ts
git commit -m "feat: add deterministic entity reference graph"
```

---

### Task 4: Entity diagnostics and invariants

**Files:**
- Create: `src/entities/EntityDiagnostics.ts`
- Test: `tests/entity-diagnostics.test.ts`

**Interfaces:**
- Produces `EntityDiagnosticsSnapshot`, `buildEntityDiagnostics()`, `assertEntityIntegrity()`.

- [ ] **Step 1: Write failing diagnostics tests**

Assert deterministic counts and sorted unresolved entries. Verify `assertEntityIntegrity()` throws for:
- reference source that is not active;
- strong/owned target not active;
- graph edge to unknown handle;
- duplicate active legacy identity;
- non-positive generation in supplied corrupted snapshots.

Unresolved weak/external references are diagnostics, not integrity failures.

- [ ] **Step 2: Run RED**

```bash
node --experimental-strip-types --test tests/entity-diagnostics.test.ts
```

- [ ] **Step 3: Implement diagnostics**

Include at minimum:

```ts
export type EntityDiagnosticsSnapshot = Readonly<{
  activeEntities: number;
  historicalEntities: number;
  references: number;
  unresolvedReferences: number;
  activeByKind: Readonly<Record<string, number>>;
  historicalByKind: Readonly<Record<string, number>>;
  unresolved: readonly UnresolvedEntityReference[];
}>;
```

`assertEntityIntegrity(registry, graph)` re-validates the committed graph and throws precise deterministic errors.

- [ ] **Step 4: Run GREEN**

```bash
node --experimental-strip-types --test tests/entity-*.test.ts
npm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add src/entities/EntityDiagnostics.ts tests/entity-diagnostics.test.ts
git commit -m "feat: add entity integrity diagnostics"
```

---

### Task 5: Legacy V7 entity projector

**Files:**
- Create: `src/entities/LegacyV7EntityProjector.ts`
- Test: `tests/entity-v7-projector.test.ts`

**Interfaces:**
- Consumes public `SimulationCore` domain APIs only.
- Produces `LegacyV7EntityProjector.project(core): EntityProjectionData`.

- [ ] **Step 1: Write failing projection tests**

Build small deterministic cores and assert projection coverage for:
- lots;
- buildings;
- all retained firms from `core.economyDomain.firms.list()`;
- utility facilities;
- service facilities;
- transit stops;
- transit lines;
- active traffic vehicles;
- service vehicles;
- freight vehicles;
- incidents.

Explicitly defer `project` entity kind because current developer commitments do not expose a standalone stable project identity contract suitable for 0B without changing gameplay APIs.

- [ ] **Step 2: Define exact incarnation tokens**

Use these compatibility tokens:

```text
lot:              legacyId
building:         constructionStartedTick|completionTick|definitionId|developerId-or-empty
firm:             formationTick|buildingId
utility facility: legacyId
service facility: legacyId
transit stop:     legacyId
transit line:     legacyId
traffic vehicle:  departureTick|tripId
service vehicle:  legacyId
freight vehicle:  departureTick|shipment.id
incident:         createdTick|serviceJobId
```

Metadata is diagnostic only and may include zone/type/status values.

- [ ] **Step 3: Define exact references**

Emit:
- `firm-building`: strong when the firm is not closed and the referenced current building exists; weak exact-current when the firm is closed but current building still matches; unresolved weak if the building ID points to a replacement that started after the firm formation/closure evidence can prove the prior incarnation.
- `transit-line-stop`: strong for every stop ID in every current line.
- `service-vehicle-facility`: strong.
- `freight-origin-firm` / `freight-destination-firm`: weak when shipment endpoint kind is `firm`.
- `incident-building`: weak only when current building `constructionStartedTick <= incident.createdTick`; otherwise unresolved weak.
- `traffic-origin-building` / `traffic-destination-building`: weak only when current building `constructionStartedTick <= vehicle.departureTick`; otherwise unresolved weak.

Do not create a building→lot strong edge in 0B because current V7 can retain a building after lot derivation changes; that relationship is not lifecycle-safe enough yet.

- [ ] **Step 4: Implement projector without new gameplay APIs**

Use existing methods:

```ts
core.lots.list()
core.buildings.list()
core.economyDomain.firms.list()
core.utilities.listFacilities()
core.services.listFacilities()
core.transit.listStops()
core.transit.listLines()
core.traffic.activeVehicles
core.serviceVehicles.listVehicles()
core.economyDomain.freightVehicles.listVehicles()
core.incidents.listIncidents()
```

Do not modify those domain systems merely to make projection easier.

- [ ] **Step 5: Run focused tests and parity fixture**

```bash
node --experimental-strip-types --test tests/entity-v7-projector.test.ts tests/kernel-v7-parity.test.ts
npm run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add src/entities/LegacyV7EntityProjector.ts tests/entity-v7-projector.test.ts
git commit -m "feat: project V7 entities into identity graph"
```

---

### Task 6: SimulationCore/kernel integration and hydrate rebuild

**Files:**
- Modify: `src/simulation/core/SimulationCore.ts`
- Modify: `src/save/saveV7.ts`
- Modify: `tests/save-v7.test.ts`
- Create: `tests/entity-core-integration.test.ts`

**Interfaces:**
- Adds public read-only infrastructure fields to `SimulationCore`: `entityRegistry`, `entityReferences`, `entityDiagnostics` getter.
- Adds private `entityProjector` and `syncEntityProjection()`.

- [ ] **Step 1: Write failing integration tests**

Assert:
- a newly constructed core exposes an initialized registry snapshot;
- after city state changes and one simulation tick, registry projection matches current V7 state;
- kernel scheduler order places `entity-registry-sync` after `legacy-v7-city`;
- `entity-referential-integrity` invariant is registered and passes on valid state;
- V7 serialization has no `entityRegistry`, `entityReferences`, `entityDiagnostics`, or entity history keys;
- hydrate rebuilds registry/reference state from restored authoritative domains;
- serialize→hydrate→continue remains parity-equivalent.

- [ ] **Step 2: Run RED**

```bash
node --experimental-strip-types --test tests/entity-core-integration.test.ts tests/save-v7.test.ts
```

- [ ] **Step 3: Integrate in `SimulationCore`**

Add:

```ts
readonly entityRegistry = new EntityRegistry();
readonly entityReferences = new EntityReferenceGraph();
private readonly entityProjector = new LegacyV7EntityProjector();

get entityDiagnostics(): EntityDiagnosticsSnapshot {
  return buildEntityDiagnostics(this.entityRegistry, this.entityReferences, this.lastUnresolvedEntityReferences);
}
```

After all V7 systems and initial derived snapshots are initialized, call `this.syncEntityProjection()` once so entity reads are valid before the first tick.

Register a second kernel system:

```ts
this.kernel.registerSystem({
  id: 'entity-registry-sync',
  reads: ['legacy-v7-city'],
  writes: ['entity-registry'],
  cadence: { every: 1 },
  after: ['legacy-v7-city'],
  execute: () => this.syncEntityProjection(),
});
```

Register invariant:

```ts
this.kernel.invariants.register({
  id: 'entity-referential-integrity',
  cadence: { every: 1 },
  check: () => assertEntityIntegrity(this.entityRegistry, this.entityReferences),
});
```

`syncEntityProjection()` builds the V7 projection and atomically commits it.

- [ ] **Step 4: Add explicit hydrate rebuild hook**

Because `hydrateCoreV7()` restores domains after constructing `SimulationCore`, constructor projection is stale after restore. Add a public compatibility method whose only purpose is rebuilding derived entity infrastructure:

```ts
rebuildEntityProjection(): void {
  this.syncEntityProjection();
}
```

At every successful `hydrateCoreV7()` return path, invoke `core.rebuildEntityProjection()` after all V7 domain/housing restoration is complete.

Do not add registry data to `SaveV7`.

- [ ] **Step 5: Run parity and save gates**

```bash
node --experimental-strip-types --test tests/entity-*.test.ts tests/save-v7.test.ts tests/kernel-v7-parity.test.ts
npm run typecheck
```

If parity mismatches, stop and diagnose. Do not modify `tests/fixtures/kernel-v7-parity/baseline.json`.

- [ ] **Step 6: Commit**

```bash
git add src/simulation/core/SimulationCore.ts src/save/saveV7.ts tests/save-v7.test.ts tests/entity-core-integration.test.ts
git commit -m "feat: synchronize entity registry through simulation kernel"
```

---

### Task 7: Generation/redevelopment, weak-reference, and determinism regressions

**Files:**
- Create: `tests/entity-redevelopment.test.ts`
- Create: `tests/entity-determinism.test.ts`

**Interfaces:**
- Exercises the integrated 0B system; no new production API unless a failing test proves one is necessary.

- [ ] **Step 1: Write redevelopment generation tests**

Using existing Phase 7 redevelopment test helpers/patterns, prove:
- the first building handle is generation 1;
- replacement with the same V7 building ID and a changed `constructionStartedTick` creates generation 2 in the same live registry lifetime;
- generation 1 becomes historical;
- no old weak reference auto-retargets to generation 2;
- a later disappearance/reappearance increments again.

- [ ] **Step 2: Write hydrate no-fabricated-history tests**

Create a save after redevelopment, hydrate it, and assert:
- current authoritative entities project deterministically;
- the registry does not fabricate an unprovable full prior generation chain;
- surviving active vehicle/incident references that cannot prove an exact prior building incarnation are listed as unresolved weak references rather than bound to the current replacement;
- two independent hydrations of the same Save V7 produce identical registry/graph/diagnostic snapshots.

- [ ] **Step 3: Write ordering/property tests**

Shuffle projector entity/reference input arrays repeatedly using a deterministic test shuffle and assert identical registry/reference snapshots.

- [ ] **Step 4: Run all entity tests**

```bash
node --experimental-strip-types --test tests/entity-*.test.ts
npm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add tests/entity-redevelopment.test.ts tests/entity-determinism.test.ts
git commit -m "test: harden entity generation and rebuild determinism"
```

---

### Task 8: Performance, docs, and final acceptance

**Files:**
- Create: `tests/entity-performance.test.ts`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `README.md`
- Optionally create: `tests/entity-performance-evidence.md` if controlled CI comparison is needed.

**Interfaces:**
- No new gameplay interface.

- [ ] **Step 1: Add diagnostic performance test**

Construct a synthetic registry projection with at least 10,000 entities and representative strong/weak references. Measure projection/rebuild with `node:perf_hooks` and assert only that timing is finite/non-pathological in the normal test; do not hard-code hosted-runner milliseconds as a correctness gate.

- [ ] **Step 2: Compare simulation overhead**

Use the same controlled methodology established in Phase 0A: compare identical developed-city/5,000-tick workloads before and after 0B in isolated CI runs. Compute median delta. Target `<= 5%`; if `> 5%`, investigate before acceptance.

- [ ] **Step 3: Update architecture docs**

Document:

```text
SimulationKernel
  ├─ legacy-v7-city              authoritative V7 gameplay
  └─ entity-registry-sync        derived identity projection
       ├─ EntityRegistry
       ├─ EntityReferenceGraph
       └─ EntityDiagnostics
```

State explicitly:
- registry/reference state is derived and excluded from Save V7;
- active/historical generation semantics;
- weak unresolved references never auto-retarget;
- Phase 0C SpatialIndex depends on completed 0B identity handles.

Keep game/save version `0.7.0-metropolitan` / Save V7.

- [ ] **Step 4: Run final verification**

```bash
node --experimental-strip-types --test tests/entity-*.test.ts tests/save-v7.test.ts tests/kernel-v7-parity.test.ts
npm test
npm run typecheck
npm run lint
npm run build
npm run test:smoke
npm run test:smoke:phase7
git diff --exit-code -- tests/fixtures/kernel-v7-parity/baseline.json
```

Required evidence:
- all unit/integration tests pass;
- exact V7 parity fixture unchanged;
- Save V7 envelope unchanged;
- typecheck/lint/build green;
- browser smoke green;
- controlled median simulation overhead `<= 5%` or investigated/resolved;
- no unexpected gameplay-domain, UI, rendering, or save-schema edits.

- [ ] **Step 5: Review changed-file scope**

Expected production changes:

```text
src/entities/*
src/simulation/core/SimulationCore.ts
src/save/saveV7.ts
```

Expected non-production changes:

```text
tests/entity-*.test.ts
tests/save-v7.test.ts
docs/ARCHITECTURE.md
README.md
tests/entity-performance-evidence.md (only if needed)
```

Any changes outside this set require explicit justification in the PR.

- [ ] **Step 6: Commit docs/evidence**

```bash
git add tests/entity-performance.test.ts docs/ARCHITECTURE.md README.md
git commit -m "docs: document Phase 0B entity registry"
```

- [ ] **Step 7: Final completion report**

Report:
- entity test count and pass/fail;
- full-suite pass/fail;
- parity result;
- Save V7 result;
- static/build/smoke status;
- pre/post controlled performance median and delta;
- exact projected entity kinds and any explicitly deferred kind;
- unresolved weak-reference behavior;
- final branch/commit SHA;
- deferred work for Phase 0C.

## Plan Self-Review

- Spec coverage: typed identity, generations, atomic projection, strong/owned/weak/external semantics, V7 projection, diagnostics, kernel ordering, rebuild-on-hydrate, no Save V8, parity, performance, and documentation are each mapped to a task.
- Placeholder scan: no `TBD`, `TODO`, “implement later”, or unspecified generic error-handling steps remain.
- Type consistency: `EntityHandle`, `ProjectedEntity`, `ProjectedReferenceIntent`, `EntityRegistry`, `EntityReferenceGraph`, `EntityProjectionBuilder`, `commitEntityProjection`, `LegacyV7EntityProjector`, `buildEntityDiagnostics`, and `assertEntityIntegrity` use the same names throughout.
- Scope: Phase 0B remains one implementation tranche; SpatialIndex, EconomicLedger, gameplay-domain ownership migration, and Save V8 are explicitly excluded.
