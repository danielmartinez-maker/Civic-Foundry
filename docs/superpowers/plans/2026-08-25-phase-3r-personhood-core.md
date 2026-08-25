# Phase 3R — Personhood Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the detailed-city scalar/cohort population authority with persistent one-resident-one-`Person` identity while preserving V7 compatibility and deterministic migration.

**Architecture:** Build a focused `src/simulation/people/` domain on top of the Phase 0B entity registry. `PersonStore` owns person records; `PersonBootstrapSystem` deterministically materializes V7 aggregate residents into explicit people; `PersonPopulationProjection` derives population and compatibility totals; invariants and snapshots integrate through the kernel. Existing systems continue to consume compatibility read models until later Human Simulation phases replace them with person-level behavior.

**Tech Stack:** TypeScript 5.x ES modules, Node 22 built-in test runner with strip-types, existing `SimulationKernel`, Phase 0B `EntityRegistry`, deterministic RNG streams, existing V7 save/migration infrastructure.

**Spec:** `docs/superpowers/specs/2026-08-25-full-individual-sim-master-roadmap.md`

## Global Constraints

- Every detailed-city resident corresponds to exactly one persistent `PersonId`.
- Detailed-city population becomes derived from living resident `Person` entities.
- No synthetic person history may be represented as observed simulated history.
- Bootstrap biographies are deterministic and provenance-tagged as `bootstrap_background`.
- Existing V7 behavior remains available behind compatibility boundaries until parity, determinism, persistence and performance gates pass.
- Phase 3R implementation must be based on a reconciled integration branch containing Phase 0B `src/entities/*`; do not create a second identity registry.
- Adding person RNG draws must not perturb traffic, development, firms or other named random streams.
- Normal source-file target remains under 500 LOC; split files before 750 LOC.
- No UI code may manufacture Person entities or mutate authoritative person state directly.
- All population conservation checks use integer resident counts.

---

## File Structure

Create:

- `src/simulation/people/PersonTypes.ts` — authoritative Person type contracts and branded IDs.
- `src/simulation/people/PersonStore.ts` — sole owner of detailed-city Person records.
- `src/simulation/people/PersonBootstrapSystem.ts` — deterministic V7/new-game resident materialization.
- `src/simulation/people/PersonPopulationProjection.ts` — derived population/read-model compatibility layer.
- `src/simulation/people/PersonInvariantSystem.ts` — person identity and population conservation checks.
- `src/simulation/people/PersonSnapshot.ts` — stable sorted diagnostics/inspection snapshot.
- `src/simulation/people/PersonPersistence.ts` — canonical serialization/restore helpers.
- `tests/person-types.test.ts`
- `tests/person-store.test.ts`
- `tests/person-bootstrap.test.ts`
- `tests/person-population-projection.test.ts`
- `tests/person-invariants.test.ts`
- `tests/person-persistence.test.ts`
- `tests/person-core-integration.test.ts`
- `tests/person-performance.test.ts`

Modify after Phase 0B reconciliation:

- `src/entities/EntityTypes.ts` — ensure `person` and `household` are stable entity kinds/IDs.
- `src/entities/EntityRegistry.ts` — register/remove Person entities through existing contracts only if Phase 0B does not already cover the required kind.
- `src/simulation/core/SimulationCore.ts` — expose derived population from Personhood once authoritative mode is enabled.
- `src/simulation/kernel/SimulationKernel.ts` — register person invariant/snapshot providers.
- `src/simulation/population/PopulationSystem.ts` — convert to compatibility adapter once authoritative Person mode is active.
- `src/save/save.ts` and the next available save-version module — persist Person authority without colliding with an already-landed save version.
- `tests/kernel-v7-parity.test.ts` and `tests/support/kernelParity.ts` — add Personhood-compatible parity assertions without changing legacy expected outcomes before cutover.

---

### Task 1: Define Person identity and authoritative record contracts

**Files:**
- Create: `src/simulation/people/PersonTypes.ts`
- Modify: `src/entities/EntityTypes.ts`
- Test: `tests/person-types.test.ts`

**Interfaces:**
- Consumes: Phase 0B entity-ID conventions.
- Produces: `PersonId`, `PersonRecord`, `PersonHistoryProvenance`, `PersonLocationState`, `PersonLifeStage`, `PersonCreateInput`.

- [ ] **Step 1: Write the failing type/runtime contract test**

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { createPersonId, normalizePersonCreateInput } from '../src/simulation/people/PersonTypes.ts';

test('person identity and create input normalize deterministically', () => {
  const id = createPersonId(42);
  assert.equal(id, 'person:42');
  const value = normalizePersonCreateInput({
    id,
    displayName: 'Ana Torres',
    birthTick: 100,
    alive: true,
    resident: true,
    householdId: null,
    homeEntityId: null,
    location: { kind: 'unknown' },
    lifeStage: 'adult',
    provenance: 'bootstrap_background',
  });
  assert.equal(value.id, 'person:42');
  assert.equal(value.provenance, 'bootstrap_background');
});

test('invalid person identifiers are rejected', () => {
  assert.throws(() => normalizePersonCreateInput({
    id: 'building:42' as never,
    displayName: 'Bad Id',
    birthTick: 0,
    alive: true,
    resident: true,
    householdId: null,
    homeEntityId: null,
    location: { kind: 'unknown' },
    lifeStage: 'adult',
    provenance: 'bootstrap_background',
  }), /person id/i);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
node --test --experimental-strip-types tests/person-types.test.ts
```

Expected: FAIL because `PersonTypes.ts` does not exist.

- [ ] **Step 3: Implement the minimal contracts**

```ts
export type PersonId = `person:${number}`;
export type HouseholdId = `household:${number}`;
export type PersonHistoryProvenance = 'bootstrap_background' | 'simulated_event' | 'imported_fact';
export type PersonLifeStage = 'child' | 'teen' | 'adult' | 'senior';
export type PersonLocationState =
  | Readonly<{ kind: 'unknown' }>
  | Readonly<{ kind: 'building'; entityId: string }>
  | Readonly<{ kind: 'network'; entityId: string }>;

export type PersonRecord = Readonly<{
  id: PersonId;
  displayName: string;
  birthTick: number;
  alive: boolean;
  resident: boolean;
  householdId: HouseholdId | null;
  homeEntityId: string | null;
  location: PersonLocationState;
  lifeStage: PersonLifeStage;
  provenance: PersonHistoryProvenance;
}>;

export type PersonCreateInput = PersonRecord;

export function createPersonId(sequence: number): PersonId {
  if (!Number.isInteger(sequence) || sequence < 1) throw new Error('person sequence must be a positive integer');
  return `person:${sequence}`;
}

export function normalizePersonCreateInput(input: PersonCreateInput): PersonRecord {
  if (!/^person:[1-9]\d*$/.test(input.id)) throw new Error('invalid person id');
  if (!Number.isFinite(input.birthTick)) throw new Error('birthTick must be finite');
  if (input.displayName.trim().length === 0) throw new Error('displayName must be non-empty');
  return Object.freeze({ ...input, displayName: input.displayName.trim(), location: Object.freeze({ ...input.location }) });
}
```

Extend `EntityTypes.ts` by using the Phase 0B entity-kind pattern so `person` and `household` IDs validate through the existing registry; do not invent a second branded-ID scheme if the registry already exports a compatible one.

- [ ] **Step 4: Run tests**

```bash
node --test --experimental-strip-types tests/person-types.test.ts tests/entity-types.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/simulation/people/PersonTypes.ts src/entities/EntityTypes.ts tests/person-types.test.ts
git commit -m "feat: define persistent person identity contracts"
```

---

### Task 2: Implement authoritative PersonStore

**Files:**
- Create: `src/simulation/people/PersonStore.ts`
- Test: `tests/person-store.test.ts`

**Interfaces:**
- Consumes: `PersonId`, `PersonCreateInput`, `PersonRecord`.
- Produces: `PersonStore.create`, `PersonStore.get`, `PersonStore.require`, `PersonStore.update`, `PersonStore.markDead`, `PersonStore.list`, `PersonStore.livingResidents`, `PersonStore.size`.

- [ ] **Step 1: Write failing store tests**

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { PersonStore } from '../src/simulation/people/PersonStore.ts';
import { createPersonId } from '../src/simulation/people/PersonTypes.ts';

const person = (n: number) => ({
  id: createPersonId(n),
  displayName: `Person ${n}`,
  birthTick: 0,
  alive: true,
  resident: true,
  householdId: null,
  homeEntityId: null,
  location: { kind: 'unknown' as const },
  lifeStage: 'adult' as const,
  provenance: 'bootstrap_background' as const,
});

test('store owns stable unique people and lists in id order', () => {
  const store = new PersonStore();
  store.create(person(2));
  store.create(person(1));
  assert.deepEqual(store.list().map((p) => p.id), ['person:1', 'person:2']);
  assert.throws(() => store.create(person(1)), /duplicate/i);
});

test('livingResidents excludes deceased and nonresident people', () => {
  const store = new PersonStore();
  store.create(person(1));
  store.create({ ...person(2), resident: false });
  store.create({ ...person(3), alive: false });
  assert.equal(store.livingResidents().length, 1);
});
```

- [ ] **Step 2: Run RED**

```bash
node --test --experimental-strip-types tests/person-store.test.ts
```

Expected: FAIL because `PersonStore.ts` does not exist.

- [ ] **Step 3: Implement minimal store**

```ts
import { normalizePersonCreateInput, type PersonCreateInput, type PersonId, type PersonRecord } from './PersonTypes.ts';

export class PersonStore {
  private readonly people = new Map<PersonId, PersonRecord>();

  create(input: PersonCreateInput): PersonRecord {
    const person = normalizePersonCreateInput(input);
    if (this.people.has(person.id)) throw new Error(`duplicate person: ${person.id}`);
    this.people.set(person.id, person);
    return person;
  }

  get(id: PersonId): PersonRecord | undefined { return this.people.get(id); }
  require(id: PersonId): PersonRecord {
    const person = this.people.get(id);
    if (!person) throw new Error(`missing person: ${id}`);
    return person;
  }
  update(id: PersonId, patch: Partial<Omit<PersonRecord, 'id'>>): PersonRecord {
    const current = this.require(id);
    const next = normalizePersonCreateInput({ ...current, ...patch, id });
    this.people.set(id, next);
    return next;
  }
  markDead(id: PersonId): PersonRecord { return this.update(id, { alive: false, resident: false }); }
  list(): PersonRecord[] { return [...this.people.values()].sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true })); }
  livingResidents(): PersonRecord[] { return this.list().filter((p) => p.alive && p.resident); }
  size(): number { return this.people.size; }
}
```

- [ ] **Step 4: Run tests**

```bash
node --test --experimental-strip-types tests/person-store.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/simulation/people/PersonStore.ts tests/person-store.test.ts
git commit -m "feat: add authoritative person store"
```

---

### Task 3: Integrate PersonStore with the Phase 0B EntityRegistry

**Files:**
- Modify: `src/entities/EntityRegistry.ts`
- Create: `src/simulation/people/PersonEntityBridge.ts`
- Test: `tests/person-entity-registry.test.ts`

**Interfaces:**
- Consumes: Phase 0B `EntityRegistry`, `PersonStore`.
- Produces: `PersonEntityBridge.createPerson`, `PersonEntityBridge.removePerson`, registry-backed identity validation.

- [ ] **Step 1: Write failing registry bridge test**

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { EntityRegistry } from '../src/entities/EntityRegistry.ts';
import { PersonStore } from '../src/simulation/people/PersonStore.ts';
import { PersonEntityBridge } from '../src/simulation/people/PersonEntityBridge.ts';
import { createPersonId } from '../src/simulation/people/PersonTypes.ts';

test('creating a person also registers exactly one person entity', () => {
  const registry = new EntityRegistry();
  const store = new PersonStore();
  const bridge = new PersonEntityBridge(store, registry);
  const id = createPersonId(1);
  bridge.createPerson({
    id,
    displayName: 'Ana Torres',
    birthTick: 0,
    alive: true,
    resident: true,
    householdId: null,
    homeEntityId: null,
    location: { kind: 'unknown' },
    lifeStage: 'adult',
    provenance: 'bootstrap_background',
  });
  assert.equal(store.require(id).id, id);
  assert.equal(registry.has(id), true);
});
```

Adapt constructor/lookup calls to the exact Phase 0B public API after reading `EntityRegistry.ts`; do not reach into registry internals.

- [ ] **Step 2: Run RED**

```bash
node --test --experimental-strip-types tests/person-entity-registry.test.ts
```

Expected: FAIL because `PersonEntityBridge` does not exist.

- [ ] **Step 3: Implement bridge through public registry methods**

```ts
export class PersonEntityBridge {
  constructor(private readonly store: PersonStore, private readonly registry: EntityRegistry) {}

  createPerson(input: PersonCreateInput): PersonRecord {
    if (this.registry.has(input.id)) throw new Error(`duplicate entity: ${input.id}`);
    const person = this.store.create(input);
    this.registry.register({ id: person.id, kind: 'person' });
    return person;
  }

  removePerson(id: PersonId): void {
    const person = this.store.require(id);
    if (person.alive || person.resident) throw new Error(`cannot remove active person: ${id}`);
    this.registry.remove(id);
  }
}
```

If the Phase 0B registry uses different exact method signatures, preserve this behavioral contract while using those public names.

- [ ] **Step 4: Run registry suites**

```bash
node --test --experimental-strip-types tests/person-entity-registry.test.ts tests/entity-registry.test.ts tests/entity-references.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/entities/EntityRegistry.ts src/simulation/people/PersonEntityBridge.ts tests/person-entity-registry.test.ts
git commit -m "feat: connect people to entity registry"
```

---

### Task 4: Build deterministic resident bootstrap from V7 population

**Files:**
- Create: `src/simulation/people/PersonBootstrapSystem.ts`
- Test: `tests/person-bootstrap.test.ts`

**Interfaces:**
- Consumes: scalar legacy population, seed, optional housing building IDs/capacities.
- Produces: deterministic `PersonCreateInput[]`; `bootstrapPopulation(input)`.

- [ ] **Step 1: Write deterministic bootstrap tests**

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { PersonBootstrapSystem } from '../src/simulation/people/PersonBootstrapSystem.ts';

test('bootstrap creates exactly one person per legacy resident', () => {
  const system = new PersonBootstrapSystem(1234);
  const people = system.bootstrapPopulation({ population: 100, simulationStartTick: 10_000 });
  assert.equal(people.length, 100);
  assert.equal(new Set(people.map((p) => p.id)).size, 100);
  assert.ok(people.every((p) => p.provenance === 'bootstrap_background'));
});

test('bootstrap is deterministic for the same seed and inputs', () => {
  const a = new PersonBootstrapSystem(99).bootstrapPopulation({ population: 25, simulationStartTick: 500 });
  const b = new PersonBootstrapSystem(99).bootstrapPopulation({ population: 25, simulationStartTick: 500 });
  assert.deepEqual(a, b);
});
```

- [ ] **Step 2: Run RED**

```bash
node --test --experimental-strip-types tests/person-bootstrap.test.ts
```

Expected: FAIL because bootstrap system does not exist.

- [ ] **Step 3: Implement deterministic bootstrap with a dedicated RNG stream**

Use the existing `RandomStreamRegistry` when integrated with the kernel; standalone tests may inject a deterministic seed. The bootstrap must derive age/life-stage/name inputs from a person-specific deterministic sequence and must not call `Math.random()`.

Core implementation shape:

```ts
export type PersonBootstrapInput = Readonly<{
  population: number;
  simulationStartTick: number;
}>;

export class PersonBootstrapSystem {
  constructor(private readonly seed: number) {}

  bootstrapPopulation(input: PersonBootstrapInput): PersonCreateInput[] {
    if (!Number.isInteger(input.population) || input.population < 0) throw new Error('population must be a non-negative integer');
    const random = new SeededRandom(this.seed ^ 0x50e250e2);
    const people: PersonCreateInput[] = [];
    for (let index = 1; index <= input.population; index++) {
      const ageYears = random.nextInt(90);
      const lifeStage: PersonLifeStage = ageYears < 13 ? 'child' : ageYears < 18 ? 'teen' : ageYears < 65 ? 'adult' : 'senior';
      people.push(Object.freeze({
        id: createPersonId(index),
        displayName: deterministicBootstrapName(index, random),
        birthTick: input.simulationStartTick - ageYears * TICKS_PER_YEAR,
        alive: true,
        resident: true,
        householdId: null,
        homeEntityId: null,
        location: Object.freeze({ kind: 'unknown' }),
        lifeStage,
        provenance: 'bootstrap_background',
      }));
    }
    return people;
  }
}
```

Define `TICKS_PER_YEAR` from the authoritative simulation-time conversion already used by the project; do not create a second contradictory calendar constant.

- [ ] **Step 4: Run tests twice**

```bash
node --test --experimental-strip-types tests/person-bootstrap.test.ts
node --test --experimental-strip-types tests/person-bootstrap.test.ts
```

Expected: both runs PASS with identical assertions.

- [ ] **Step 5: Commit**

```bash
git add src/simulation/people/PersonBootstrapSystem.ts tests/person-bootstrap.test.ts
git commit -m "feat: materialize deterministic legacy residents"
```

---

### Task 5: Make population a derived projection

**Files:**
- Create: `src/simulation/people/PersonPopulationProjection.ts`
- Modify: `src/simulation/population/PopulationSystem.ts`
- Test: `tests/person-population-projection.test.ts`

**Interfaces:**
- Consumes: `PersonStore`.
- Produces: `PersonPopulationSnapshot`, `PersonPopulationProjection.snapshot()`, compatibility `PopulationSystem.attachPersonProjection()`.

- [ ] **Step 1: Write failing projection tests**

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { PersonStore } from '../src/simulation/people/PersonStore.ts';
import { PersonPopulationProjection } from '../src/simulation/people/PersonPopulationProjection.ts';
import { createPersonId } from '../src/simulation/people/PersonTypes.ts';

function add(store: PersonStore, n: number, patch = {}) {
  store.create({
    id: createPersonId(n), displayName: `P${n}`, birthTick: 0, alive: true, resident: true,
    householdId: null, homeEntityId: null, location: { kind: 'unknown' }, lifeStage: 'adult',
    provenance: 'bootstrap_background', ...patch,
  });
}

test('population equals living resident person count', () => {
  const store = new PersonStore();
  add(store, 1); add(store, 2); add(store, 3, { resident: false }); add(store, 4, { alive: false });
  const snapshot = new PersonPopulationProjection(store).snapshot();
  assert.equal(snapshot.population, 2);
  assert.equal(snapshot.totalPersonRecords, 4);
});
```

- [ ] **Step 2: Run RED**

```bash
node --test --experimental-strip-types tests/person-population-projection.test.ts
```

Expected: FAIL because projection does not exist.

- [ ] **Step 3: Implement projection and compatibility adapter**

```ts
export type PersonPopulationSnapshot = Readonly<{
  population: number;
  totalPersonRecords: number;
  nonresidentLiving: number;
  deceased: number;
}>;

export class PersonPopulationProjection {
  constructor(private readonly store: PersonStore) {}
  snapshot(): PersonPopulationSnapshot {
    const all = this.store.list();
    return Object.freeze({
      population: all.filter((p) => p.alive && p.resident).length,
      totalPersonRecords: all.length,
      nonresidentLiving: all.filter((p) => p.alive && !p.resident).length,
      deceased: all.filter((p) => !p.alive).length,
    });
  }
}
```

Modify `PopulationSystem` so legacy scalar mutation remains available only before Person authority is attached. After attachment, `population` reads from the projection and direct `restore()`/`update()` attempts either delegate through migration-compatible commands or reject mutation with a clear `population is person-derived` error. Preserve legacy behavior by default until `SimulationCore` explicitly enables Person authority.

- [ ] **Step 4: Run legacy and new tests**

```bash
node --test --experimental-strip-types tests/person-population-projection.test.ts tests/core-city-loop.test.ts tests/kernel-v7-parity.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/simulation/people/PersonPopulationProjection.ts src/simulation/population/PopulationSystem.ts tests/person-population-projection.test.ts
git commit -m "feat: derive city population from people"
```

---

### Task 6: Add person invariants and deterministic snapshots

**Files:**
- Create: `src/simulation/people/PersonInvariantSystem.ts`
- Create: `src/simulation/people/PersonSnapshot.ts`
- Modify: `src/simulation/kernel/SimulationKernel.ts`
- Test: `tests/person-invariants.test.ts`

**Interfaces:**
- Consumes: `PersonStore`, Phase 0B registry.
- Produces: `validatePersonState()`, `buildPersonSnapshot()`, kernel invariant/snapshot registrations.

- [ ] **Step 1: Write failing invariant tests**

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { validatePersonState } from '../src/simulation/people/PersonInvariantSystem.ts';

// fixture helpers create a store + registry containing matching person entities

test('person invariant rejects missing registry identity', () => {
  const { store, registry } = makeFixture();
  store.create(makePerson(1));
  assert.throws(() => validatePersonState(store, registry), /registry/i);
});

test('person snapshot sorts by numeric person id', () => {
  const { store, registry } = makeFixture();
  registerBoth(store, registry, makePerson(10));
  registerBoth(store, registry, makePerson(2));
  assert.deepEqual(buildPersonSnapshot(store).people.map((p) => p.id), ['person:2', 'person:10']);
});
```

- [ ] **Step 2: Run RED**

```bash
node --test --experimental-strip-types tests/person-invariants.test.ts
```

Expected: FAIL because invariant/snapshot modules do not exist.

- [ ] **Step 3: Implement exact Phase 3R invariants**

`validatePersonState()` must reject:

- PersonStore record without matching registry `person` entity;
- registry `person` entity without PersonStore record;
- living resident with invalid PersonId;
- deceased person marked resident;
- household reference that points to a missing household entity once household IDs are present;
- population projection count different from `livingResidents().length`.

`buildPersonSnapshot()` returns stable sorted readonly records containing only Phase 3R fields plus aggregate counts.

Register both with the kernel using the existing `InvariantRunner` and `SnapshotRegistry` APIs. Use person-domain cadence rather than frame callbacks.

- [ ] **Step 4: Run new and kernel tests**

```bash
node --test --experimental-strip-types tests/person-invariants.test.ts tests/kernel-random-invariant-snapshot.test.ts tests/kernel-core-integration.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/simulation/people/PersonInvariantSystem.ts src/simulation/people/PersonSnapshot.ts src/simulation/kernel/SimulationKernel.ts tests/person-invariants.test.ts
git commit -m "feat: enforce person identity invariants"
```

---

### Task 7: Persist and restore Person authority canonically

**Files:**
- Create: `src/simulation/people/PersonPersistence.ts`
- Modify: `src/save/save.ts`
- Modify: the next available save-version module after integration reconciliation
- Test: `tests/person-persistence.test.ts`

**Interfaces:**
- Consumes: `PersonStore.list()`.
- Produces: `serializePeople(store)`, `restorePeople(payload, bridge)`, canonical sorted save payload.

- [ ] **Step 1: Write failing persistence tests**

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { serializePeople, restorePeople } from '../src/simulation/people/PersonPersistence.ts';

test('person save payload is canonical and round-trips', () => {
  const source = makePeopleFixture([10, 2, 1]);
  const payload = serializePeople(source.store);
  assert.deepEqual(payload.people.map((p) => p.id), ['person:1', 'person:2', 'person:10']);
  const target = emptyPeopleFixture();
  restorePeople(payload, target.bridge);
  assert.deepEqual(serializePeople(target.store), payload);
});
```

- [ ] **Step 2: Run RED**

```bash
node --test --experimental-strip-types tests/person-persistence.test.ts
```

Expected: FAIL because persistence helpers do not exist.

- [ ] **Step 3: Implement canonical persistence**

```ts
export type PersonSavePayload = Readonly<{ people: readonly PersonRecord[] }>;

export function serializePeople(store: PersonStore): PersonSavePayload {
  return Object.freeze({ people: Object.freeze(store.list().map((person) => Object.freeze({ ...person, location: Object.freeze({ ...person.location }) }))) });
}

export function restorePeople(payload: PersonSavePayload, bridge: PersonEntityBridge): void {
  const sorted = payload.people.slice().sort(comparePersonIdNumeric);
  for (const person of sorted) bridge.createPerson(person);
}
```

Integrate this payload into the next free save schema number determined from the reconciled branch. The migration path from a V7-only save must call `PersonBootstrapSystem` exactly once and mark created biographies `bootstrap_background`. A save that already contains people must never regenerate them.

- [ ] **Step 4: Run persistence and existing save tests**

```bash
node --test --experimental-strip-types tests/person-persistence.test.ts tests/save-v7.test.ts
npm test
```

Expected: PASS; if a later save-version test exists on the reconciled base, include it in the command as well.

- [ ] **Step 5: Commit**

```bash
git add src/simulation/people/PersonPersistence.ts src/save tests/person-persistence.test.ts
git commit -m "feat: persist authoritative people"
```

---

### Task 8: Wire Personhood into SimulationCore behind an explicit cutover flag

**Files:**
- Modify: `src/simulation/core/SimulationCore.ts`
- Create: `tests/person-core-integration.test.ts`
- Modify: `tests/support/kernelParity.ts`

**Interfaces:**
- Consumes: `PersonStore`, bootstrap, population projection, persistence, invariants.
- Produces: Personhood-enabled `SimulationCore` mode with legacy-compatible population snapshots.

- [ ] **Step 1: Write integration tests**

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { SimulationCore } from '../src/simulation/core/SimulationCore.ts';

test('personhood cutover preserves legacy population total at migration', () => {
  const core = createLegacyCoreWithPopulation(250);
  core.enablePersonhoodAuthority();
  assert.equal(core.population.population, 250);
  assert.equal(core.getPersonSnapshot().population, 250);
  assert.equal(core.getPersonSnapshot().people.length, 250);
});

test('personhood cutover is idempotent', () => {
  const core = createLegacyCoreWithPopulation(25);
  core.enablePersonhoodAuthority();
  const first = core.getPersonSnapshot();
  core.enablePersonhoodAuthority();
  assert.deepEqual(core.getPersonSnapshot(), first);
});
```

Use existing test fixture construction conventions from `kernelParity.ts` rather than introducing a separate city bootstrap harness.

- [ ] **Step 2: Run RED**

```bash
node --test --experimental-strip-types tests/person-core-integration.test.ts
```

Expected: FAIL because cutover API does not exist.

- [ ] **Step 3: Implement explicit cutover**

`SimulationCore.enablePersonhoodAuthority()` must:

1. return immediately if already enabled;
2. read legacy scalar population exactly once;
3. bootstrap exactly that many Person records with a named demographics/person-bootstrap RNG stream;
4. register Person entities through the Phase 0B bridge;
5. attach `PersonPopulationProjection` to the compatibility population facade;
6. register person invariants/snapshots;
7. leave housing, employment, trips and services on legacy aggregate read models until their own later replacement phases.

Do not rewrite unrelated systems in this task.

- [ ] **Step 4: Run integration and parity suite**

```bash
node --test --experimental-strip-types tests/person-core-integration.test.ts tests/kernel-v7-parity.test.ts tests/core-city-loop.test.ts
npm test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/simulation/core/SimulationCore.ts tests/person-core-integration.test.ts tests/support/kernelParity.ts
git commit -m "feat: enable personhood authority cutover"
```

---

### Task 9: Add scale and determinism performance gates

**Files:**
- Create: `tests/person-performance.test.ts`
- Modify: `tests/kernel-performance-evidence.md`

**Interfaces:**
- Consumes: `PersonBootstrapSystem`, `PersonStore`, snapshots.
- Produces: regression gates for 100k mandatory tier and a non-CI 1M stress path.

- [ ] **Step 1: Write the 100k deterministic scale test**

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { performance } from 'node:perf_hooks';

test('100k person bootstrap preserves exact identity count inside CI budget', () => {
  const started = performance.now();
  const people = new PersonBootstrapSystem(123).bootstrapPopulation({ population: 100_000, simulationStartTick: 0 });
  const elapsed = performance.now() - started;
  assert.equal(people.length, 100_000);
  assert.equal(people[0]?.id, 'person:1');
  assert.equal(people.at(-1)?.id, 'person:100000');
  assert.ok(elapsed < 5_000, `100k bootstrap took ${elapsed}ms`);
});
```

The 5-second threshold is a CI guardrail for bootstrap only, not a whole-frame budget. If runner variance proves this threshold unstable, replace the timing assertion with the repository's existing benchmark-evidence pattern while retaining 100k correctness in CI.

- [ ] **Step 2: Run the performance test**

```bash
node --test --experimental-strip-types tests/person-performance.test.ts
```

Expected: PASS on the supported CI runner.

- [ ] **Step 3: Add deterministic replay assertion**

Add a second test that bootstraps 100k people twice with the same seed and compares a stable hash of canonical serialized payloads rather than retaining two full JSON strings simultaneously.

```ts
assert.equal(hashPeople(first), hashPeople(second));
```

Use Node `crypto.createHash('sha256')` over sorted serialized records.

- [ ] **Step 4: Document the 1M stress command**

Add to `tests/kernel-performance-evidence.md`:

```text
Personhood stress tier: run the dedicated local benchmark with PERSON_STRESS_COUNT=1000000.
Acceptance: exact identity count, no duplicate IDs, successful canonical snapshot/save construction, no invariant failures.
The 1M tier is architecture evidence and is not part of every CI run.
```

- [ ] **Step 5: Run full verification**

```bash
npm test
npm run lint
npm run typecheck
```

Expected: all commands PASS.

- [ ] **Step 6: Commit**

```bash
git add tests/person-performance.test.ts tests/kernel-performance-evidence.md
git commit -m "test: gate personhood scale and determinism"
```

---

### Task 10: Phase 3R completion audit

**Files:**
- Modify only if audit finds a defect in files introduced by Tasks 1–9.

**Interfaces:**
- Consumes: complete Phase 3R implementation.
- Produces: evidence that Personhood Core satisfies its spec without prematurely implementing later family/schedule systems.

- [ ] **Step 1: Run the complete automated suite**

```bash
npm test
npm run lint
npm run typecheck
```

Expected: PASS.

- [ ] **Step 2: Run focused person suites**

```bash
node --test --experimental-strip-types \
  tests/person-types.test.ts \
  tests/person-store.test.ts \
  tests/person-entity-registry.test.ts \
  tests/person-bootstrap.test.ts \
  tests/person-population-projection.test.ts \
  tests/person-invariants.test.ts \
  tests/person-persistence.test.ts \
  tests/person-core-integration.test.ts \
  tests/person-performance.test.ts
```

Expected: PASS.

- [ ] **Step 3: Verify spec invariants manually from snapshots**

Create a deterministic fixture with 1,000 legacy residents, enable Personhood authority, save, restore and assert:

```text
population = 1000
living resident Person records = 1000
unique PersonIds = 1000
registry person entities = 1000
bootstrap provenance records = 1000
post-start simulated history records = 0
```

- [ ] **Step 4: Confirm scope boundary**

Verify Phase 3R does **not** yet claim to implement:

```text
family graph behavior
adaptive schedules
individual jobs
individual school enrollment
person-level trips
memory/motivation decisions
health lifecycle
inheritance
```

Those belong to Phases 4R–12R and must be implemented through their own specs/plans.

- [ ] **Step 5: Final commit if audit fixes were required**

```bash
git add src tests
git commit -m "fix: close phase 3r personhood audit gaps"
```

If no audit fixes are required, do not create an empty commit.

---

## Plan Self-Review Results

- **Spec coverage:** Phase 3R identity, deterministic bootstrap, population derivation, V7 migration, persistence, registry integration, invariants, inspector-ready snapshots and 100k/1M performance tiers are covered.
- **Intentional exclusions:** families, backstory depth beyond provenance-safe bootstrap, motivations, memory, schedules, social networks, education, careers, wealth and health are deliberately deferred to their dedicated approved phases.
- **Type consistency:** `PersonId`, `PersonRecord`, `PersonStore`, `PersonEntityBridge`, `PersonPopulationProjection` and persistence interfaces are defined before downstream use.
- **Migration consistency:** scalar V7 population remains the compatibility source only until one-time Personhood cutover; after cutover population is derived.
- **History consistency:** bootstrap background is provenance-tagged; no pre-start event history is fabricated.
- **Performance consistency:** individual identity is preserved at all scales; event/schedule optimization arrives in later phases without weakening one-person-one-identity.
