# Phase 3R Personhood V9 Re-stack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-stack Phase 3R Personhood Core onto the current Phase 0B forward-port, preserve World Foundation Save V8 ownership, and introduce canonical Personhood persistence as the next available save version, expected Save V9.

**Architecture:** Preserve PR #89 as the Phase 0B dependency spine and surgically port Personhood onto its `SimulationCore` wrapper, kernel, and entity registry rather than replacing newer mainline code. Save V9 extends the existing V8 world envelope; V8 and older loaders stay pure, while explicit V9 migration performs one-time deterministic Person materialization.

**Tech Stack:** TypeScript 5.x ES modules, Node 22 built-in test runner with `--experimental-strip-types`, existing `SimulationKernel`, Phase 0B `EntityRegistry`, World Foundation Save V8, deterministic named RNG streams.

**Spec:** `docs/superpowers/specs/2026-08-25-phase-3r-personhood-v9-integration-design.md`

## Global Constraints

- Save V7 remains the metropolitan compatibility envelope.
- Save V8 remains owned by World Foundation with game version `0.8.0-world-foundation`.
- Personhood owns the next available version after reconciliation, expected Save V9 with game version `0.9.0-personhood`.
- `hydrateCoreV8` must remain a pure World Foundation/legacy loader and must never create Person entities.
- Every detailed-city resident corresponds to exactly one persistent `PersonId` once Personhood authority is enabled.
- Detailed-city population is derived from living resident `Person` entities once Personhood authority is enabled.
- Person bootstrap uses only `demographics/person-bootstrap` and must not perturb other named RNG streams.
- V9 restore must reproduce exact persisted people without consuming bootstrap RNG.
- `PersonStore` is the sole owner of detailed-city Person records.
- Phase 0B `EntityRegistry` remains the cross-domain identity registry; do not create a second global identity map.
- World Foundation remains the sole physical/geographic authority.
- Do not modify `main`, PR #20, or PR #63.
- Do not expand this tranche into families, schedules, jobs, education, health, memory, motivations, inheritance, UI person workflows, or person-level travel.

---

### Task 1: Safely re-stack PR #72 onto the Phase 0B forward-port

**Files:**
- Preserve from old Phase 3R head: `docs/superpowers/specs/2026-08-25-phase-3r-personhood-v9-integration-design.md`
- Preserve from plan branch: `docs/superpowers/plans/2026-08-25-phase-3r-personhood-v9-restack.md`
- No production code changes in this task.

**Interfaces:**
- Consumes: `civic-2.0-phase-0b-forward-port` from PR #89.
- Produces: `feature/phase-3r-personhood-core` whose first parent is the current PR #89 head, with the approved spec and plan restored.

- [ ] **Step 1: Fetch and record exact branch heads**

```bash
git fetch origin civic-2.0-phase-0b-forward-port feature/phase-3r-personhood-core archive/phase-3r-personhood-core-pre-v9 plan/phase-3r-v9-restack-final13
OLD_PHASE3R_HEAD="$(git rev-parse origin/feature/phase-3r-personhood-core)"
FORWARD_PORT_HEAD="$(git rev-parse origin/civic-2.0-phase-0b-forward-port)"
printf 'old=%s\nforward=%s\n' "$OLD_PHASE3R_HEAD" "$FORWARD_PORT_HEAD"
```

Expected: both values are non-empty commit SHAs and differ.

- [ ] **Step 2: Ensure the archival ref protects the old implementation**

```bash
git branch -f archive/phase-3r-personhood-core-pre-v9 "$OLD_PHASE3R_HEAD"
git push --force-with-lease origin archive/phase-3r-personhood-core-pre-v9
```

Expected: the archive branch resolves to the exact old Phase 3R head before the re-stack.

- [ ] **Step 3: Reset the feature branch to the current forward-port head**

```bash
git switch -C feature/phase-3r-personhood-core "$FORWARD_PORT_HEAD"
git push --force-with-lease=refs/heads/feature/phase-3r-personhood-core:"$OLD_PHASE3R_HEAD" origin feature/phase-3r-personhood-core
```

Expected: the feature branch now starts from PR #89 without rewriting PR #89 or `main`.

- [ ] **Step 4: Restore the approved architecture documents**

```bash
git checkout archive/phase-3r-personhood-core-pre-v9 -- docs/superpowers/specs/2026-08-25-phase-3r-personhood-v9-integration-design.md
git checkout origin/plan/phase-3r-v9-restack-final13 -- docs/superpowers/plans/2026-08-25-phase-3r-personhood-v9-restack.md
git add docs/superpowers/specs/2026-08-25-phase-3r-personhood-v9-integration-design.md docs/superpowers/plans/2026-08-25-phase-3r-personhood-v9-restack.md
git commit -m "docs: restack personhood v9 architecture"
git push origin feature/phase-3r-personhood-core
```

- [ ] **Step 5: Retarget PR #72**

Set PR #72 base to `civic-2.0-phase-0b-forward-port`.

Verification:

```bash
git merge-base --is-ancestor origin/civic-2.0-phase-0b-forward-port HEAD
```

Expected: exit status 0.

---

### Task 2: Re-port the isolated Person domain with RED-first tests

**Files:**
- Create: `src/simulation/people/PersonTypes.ts`
- Create: `src/simulation/people/PersonStore.ts`
- Create: `src/simulation/people/PersonEntityBridge.ts`
- Create: `src/simulation/people/PersonBootstrapSystem.ts`
- Create: `src/simulation/people/PersonPopulationProjection.ts`
- Create: `src/simulation/people/PersonInvariantSystem.ts`
- Create: `src/simulation/people/PersonSnapshot.ts`
- Create: `src/simulation/people/PersonPersistence.ts`
- Test: `tests/person-types.test.ts`
- Test: `tests/person-store.test.ts`
- Test: `tests/person-entity-registry.test.ts`
- Test: `tests/person-bootstrap.test.ts`
- Test: `tests/person-population-projection.test.ts`
- Test: `tests/person-invariants.test.ts`
- Test: `tests/person-persistence.test.ts`

**Interfaces:**
- Consumes: Phase 0B `EntityRegistry` public APIs and existing `RandomStreamRegistry` conventions.
- Produces: `PersonStore`, `PersonEntityBridge`, `PersonBootstrapSystem`, `PersonPopulationProjection`, `validatePersonState`, `buildPersonSnapshot`, `serializePeople`, `parsePersonSavePayload`, `restorePeople`.

- [ ] **Step 1: Restore only the focused Person tests from the archived implementation**

```bash
git checkout archive/phase-3r-personhood-core-pre-v9 -- \
  tests/person-types.test.ts \
  tests/person-store.test.ts \
  tests/person-entity-registry.test.ts \
  tests/person-bootstrap.test.ts \
  tests/person-population-projection.test.ts \
  tests/person-invariants.test.ts \
  tests/person-persistence.test.ts
```

- [ ] **Step 2: Run the tests and verify RED**

```bash
node --experimental-strip-types --test \
  tests/person-types.test.ts \
  tests/person-store.test.ts \
  tests/person-entity-registry.test.ts \
  tests/person-bootstrap.test.ts \
  tests/person-population-projection.test.ts \
  tests/person-invariants.test.ts \
  tests/person-persistence.test.ts
```

Expected: FAIL because `src/simulation/people/*` has not yet been restored on the re-stacked branch.

- [ ] **Step 3: Restore the proven isolated Person-domain implementation**

```bash
git checkout archive/phase-3r-personhood-core-pre-v9 -- src/simulation/people
```

Do not restore archived `SimulationCore.ts`, `SimulationKernel.ts`, `PopulationSystem.ts`, `save.ts`, or `saveV8.ts` in this step.

- [ ] **Step 4: Run the focused Person tests and verify GREEN**

```bash
node --experimental-strip-types --test \
  tests/person-types.test.ts \
  tests/person-store.test.ts \
  tests/person-entity-registry.test.ts \
  tests/person-bootstrap.test.ts \
  tests/person-population-projection.test.ts \
  tests/person-invariants.test.ts \
  tests/person-persistence.test.ts
```

Expected: PASS. If the forward-ported `EntityRegistry` public surface differs, adapt `PersonEntityBridge` only through public methods; do not alter the registry's ownership model.

- [ ] **Step 5: Commit**

```bash
git add src/simulation/people tests/person-types.test.ts tests/person-store.test.ts tests/person-entity-registry.test.ts tests/person-bootstrap.test.ts tests/person-population-projection.test.ts tests/person-invariants.test.ts tests/person-persistence.test.ts
git commit -m "feat: port personhood domain onto forward-port"
```

---

### Task 3: Integrate Person authority into the current runtime wrapper

**Files:**
- Modify: `src/simulation/core/SimulationCore.ts`
- Modify: `src/simulation/kernel/SimulationKernel.ts`
- Modify: `src/simulation/population/PopulationSystem.ts`
- Test: `tests/person-core-integration.test.ts`

**Interfaces:**
- Consumes: `PersonStore`, `PersonEntityBridge`, `PersonBootstrapSystem`, `PersonPopulationProjection`, `parsePersonSavePayload`, `buildPersonSnapshot`, `validatePersonState`.
- Produces on `SimulationCore`: `enablePersonhoodAuthority(): void`, `isPersonhoodAuthorityEnabled(): boolean`, `getPersonSnapshot(): PersonSnapshot`, `getPersonSavePayload(): PersonSavePayload`, `restorePersonhoodAuthority(input: unknown): void`.
- Produces on `SimulationKernel`: `registerPersonDiagnostics(store: PersonStore, registry: EntityRegistry): void`.
- Produces on `PopulationSystem`: `attachPersonProjection(projection: PersonPopulationProjection): void` and person-derived `population` reads.

- [ ] **Step 1: Restore the runtime integration test first**

```bash
git checkout archive/phase-3r-personhood-core-pre-v9 -- tests/person-core-integration.test.ts
```

- [ ] **Step 2: Run RED against the forward-ported runtime**

```bash
node --experimental-strip-types --test tests/person-core-integration.test.ts
```

Expected: FAIL because the forward-port `SimulationCore` has no Personhood authority API yet.

- [ ] **Step 3: Add Person-derived population compatibility without replacing the current PopulationSystem behavior**

Update `PopulationSystem` so its scalar state remains the legacy fallback and its getter delegates only after explicit cutover:

```ts
import type { PersonPopulationProjection } from '../people/PersonPopulationProjection.ts';

private legacyPopulation: number;
private personProjection: PersonPopulationProjection | null = null;

get population(): number {
  return this.personProjection?.snapshot().population ?? this.legacyPopulation;
}

attachPersonProjection(projection: PersonPopulationProjection): void {
  if (this.personProjection && this.personProjection !== projection) {
    throw new Error('population is already person-derived');
  }
  this.personProjection = projection;
}
```

Keep the existing update/restore semantics, but add this guard at the start of both mutating paths:

```ts
if (this.personProjection) throw new Error('population is person-derived');
```

- [ ] **Step 4: Add diagnostics registration while preserving current kernel fault semantics**

Add imports:

```ts
import type { EntityRegistry } from '../../entities/EntityRegistry.ts';
import { validatePersonState } from '../people/PersonInvariantSystem.ts';
import { buildPersonSnapshot } from '../people/PersonSnapshot.ts';
import type { PersonStore } from '../people/PersonStore.ts';
```

Add fields:

```ts
private personDiagnosticsStore: PersonStore | null = null;
private personDiagnosticsRegistry: EntityRegistry | null = null;
```

Add method without changing `fault`, `registerSystem`, `compile`, or `step` behavior already present on the forward-port:

```ts
registerPersonDiagnostics(store: PersonStore, registry: EntityRegistry): void {
  if (this.personDiagnosticsStore || this.personDiagnosticsRegistry) {
    if (this.personDiagnosticsStore === store && this.personDiagnosticsRegistry === registry) return;
    throw new Error('person diagnostics already registered for another authority');
  }
  this.personDiagnosticsStore = store;
  this.personDiagnosticsRegistry = registry;
  this.invariants.register({
    id: 'person-state-valid',
    cadence: { every: 1 },
    check: () => validatePersonState(store, registry),
  });
  this.snapshots.register('people', () => buildPersonSnapshot(store));
}
```

- [ ] **Step 5: Add Personhood state to the current `SimulationCore` wrapper**

Add imports:

```ts
import { PersonBootstrapSystem } from '../people/PersonBootstrapSystem.ts';
import { PersonEntityBridge } from '../people/PersonEntityBridge.ts';
import { parsePersonSavePayload, serializePeople, type PersonSavePayload } from '../people/PersonPersistence.ts';
import { PersonPopulationProjection } from '../people/PersonPopulationProjection.ts';
import { buildPersonSnapshot, type PersonSnapshot } from '../people/PersonSnapshot.ts';
import { PersonStore } from '../people/PersonStore.ts';
```

Add fields to the wrapper class:

```ts
private readonly personStore: PersonStore;
private readonly personEntityBridge: PersonEntityBridge;
private readonly personPopulationProjection: PersonPopulationProjection;
private personhoodAuthorityEnabled = false;
```

Initialize immediately after `entityRegistry` is created:

```ts
this.personStore = new PersonStore();
this.personEntityBridge = new PersonEntityBridge(this.personStore, this.entityRegistry);
this.personPopulationProjection = new PersonPopulationProjection(this.personStore);
```

Add methods:

```ts
enablePersonhoodAuthority(): void {
  if (this.personhoodAuthorityEnabled) return;
  const legacyPopulation = this.population.population;
  const bootstrapSeed = this.kernel.random.stream('demographics/person-bootstrap').getState();
  const people = new PersonBootstrapSystem(bootstrapSeed).bootstrapPopulation({
    population: legacyPopulation,
    simulationStartTick: this.clock.tick,
  });
  this.personEntityBridge.createPeople(people);
  this.kernel.registerPersonDiagnostics(this.personStore, this.entityRegistry);
  this.population.attachPersonProjection(this.personPopulationProjection);
  this.personhoodAuthorityEnabled = true;
  this.rebuildEntityProjection();
}

isPersonhoodAuthorityEnabled(): boolean {
  return this.personhoodAuthorityEnabled;
}

getPersonSnapshot(): PersonSnapshot {
  return buildPersonSnapshot(this.personStore);
}

getPersonSavePayload(): PersonSavePayload {
  if (!this.personhoodAuthorityEnabled) throw new Error('personhood authority is not enabled');
  return serializePeople(this.personStore);
}

restorePersonhoodAuthority(input: unknown): void {
  if (this.personhoodAuthorityEnabled) throw new Error('personhood authority is already enabled');
  const payload = parsePersonSavePayload(input);
  const expectedPopulation = this.population.population;
  const personPopulation = payload.people.reduce(
    (count, person) => count + (person.alive && person.resident ? 1 : 0),
    0,
  );
  if (personPopulation !== expectedPopulation) {
    throw new Error(`person population mismatch: expected ${expectedPopulation}, received ${personPopulation}`);
  }
  this.personEntityBridge.createPeople(payload.people);
  this.kernel.registerPersonDiagnostics(this.personStore, this.entityRegistry);
  this.population.attachPersonProjection(this.personPopulationProjection);
  this.personhoodAuthorityEnabled = true;
  this.rebuildEntityProjection();
}
```

- [ ] **Step 6: Run focused integration tests**

```bash
node --experimental-strip-types --test tests/person-core-integration.test.ts tests/person-invariants.test.ts tests/person-entity-registry.test.ts
```

Expected: PASS while existing World Foundation and entity-registry tests remain unchanged.

- [ ] **Step 7: Commit**

```bash
git add src/simulation/core/SimulationCore.ts src/simulation/kernel/SimulationKernel.ts src/simulation/population/PopulationSystem.ts tests/person-core-integration.test.ts
git commit -m "feat: integrate personhood authority with current runtime"
```

---

### Task 4: Replace stale Personhood V8 with canonical V9 persistence

**Files:**
- Create: `src/save/saveV9.ts`
- Modify: `src/save/save.ts`
- Create: `tests/save-v9-personhood.test.ts`
- Preserve unchanged: `src/save/saveV8.ts`
- Preserve existing World Foundation V8 tests.

**Interfaces:**
- Consumes: `SaveV8`, `serializeCoreV8(core, baseV7?)`, `hydrateCoreV8(input)`, `PersonSavePayload`, `SimulationCore.restorePersonhoodAuthority`, `SimulationCore.enablePersonhoodAuthority`.
- Produces: `SaveV9`, `serializeCoreV9(core, baseV8?)`, `hydrateCoreV9(input)`.

- [ ] **Step 1: Write the V9 tests before production code**

Create `tests/save-v9-personhood.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hydrateCore,
  hydrateCoreV8,
  hydrateCoreV9,
  serializeCore,
  serializeCoreV8,
  serializeCoreV9,
} from '../src/save/save.ts';
import { SimulationCore } from '../src/simulation/core/SimulationCore.ts';
import { flatTerrain } from './support/kernelParity.ts';

function coreWithPopulation(population: number, seed = 811): SimulationCore {
  const core = new SimulationCore({ terrain: flatTerrain(16, 10), seed, startingFunds: 1_000_000 });
  core.population.restore(population);
  return core;
}

test('World Foundation keeps exclusive Save V8 ownership', () => {
  const core = coreWithPopulation(8);
  const v8 = serializeCoreV8(core);
  assert.equal(v8.saveVersion, 8);
  assert.equal(v8.gameVersion, '0.8.0-world-foundation');
  assert.ok('world' in v8);
  assert.equal('personhood' in v8, false);
});

test('default save emits Save V9 when Personhood authority is enabled', () => {
  const core = coreWithPopulation(25);
  core.enablePersonhoodAuthority();
  const save = serializeCore(core);
  assert.equal(save.saveVersion, 9);
  assert.equal(save.gameVersion, '0.9.0-personhood');
  assert.ok('world' in save);
  assert.ok('personhood' in save);
});

test('Save V9 restores exact people without bootstrap RNG', () => {
  const core = coreWithPopulation(40);
  core.enablePersonhoodAuthority();
  const save = serializeCoreV9(core);
  const loaded = hydrateCore(structuredClone(save));
  assert.deepEqual(loaded.getPersonSnapshot(), core.getPersonSnapshot());
  assert.equal(loaded.population.population, 40);
  assert.equal(loaded.entityRegistry.listActive('person').length, 40);
  assert.equal(loaded.kernel.random.listNames().includes('demographics/person-bootstrap'), false);
  assert.deepEqual(serializeCoreV9(loaded), save);
});

test('explicit V8 to V9 migration materializes residents exactly once', () => {
  const legacy = coreWithPopulation(17);
  const v8 = serializeCoreV8(legacy);
  const migrated = hydrateCoreV9(structuredClone(v8));
  const first = migrated.getPersonSnapshot();
  const v9 = serializeCoreV9(migrated);
  const restored = hydrateCoreV9(structuredClone(v9));
  assert.equal(first.population, 17);
  assert.equal(first.people.length, 17);
  assert.equal(first.people.every((person) => person.provenance === 'bootstrap_background'), true);
  assert.deepEqual(restored.getPersonSnapshot(), first);
  assert.equal(restored.kernel.random.listNames().includes('demographics/person-bootstrap'), false);
});

test('hydrateCoreV8 stays pure and never creates Personhood authority', () => {
  const core = coreWithPopulation(11);
  const v8 = serializeCoreV8(core);
  const loaded = hydrateCoreV8(structuredClone(v8));
  assert.equal(loaded.isPersonhoodAuthorityEnabled(), false);
  assert.equal(loaded.entityRegistry.listActive('person').length, 0);
});

test('Save V9 rejects a Person payload that disagrees with population', () => {
  const core = coreWithPopulation(8);
  core.enablePersonhoodAuthority();
  const corrupt = structuredClone(serializeCoreV9(core)) as any;
  corrupt.personhood.people.pop();
  assert.throws(() => hydrateCore(corrupt), /person.*population|population.*person/i);
});
```

- [ ] **Step 2: Run RED**

```bash
node --experimental-strip-types --test tests/save-v9-personhood.test.ts
```

Expected: FAIL because `saveV9.ts`, `serializeCoreV9`, and `hydrateCoreV9` do not exist.

- [ ] **Step 3: Implement `src/save/saveV9.ts` as a strict extension of V8**

```ts
import type { SimulationCore } from '../simulation/core/SimulationCore.ts';
import type { PersonSavePayload } from '../simulation/people/PersonPersistence.ts';
import { hydrateCoreV8, serializeCoreV8, type SaveV8 } from './saveV8.ts';

export type SaveV9 = Omit<SaveV8, 'saveVersion' | 'gameVersion'> & Readonly<{
  saveVersion: 9;
  gameVersion: '0.9.0-personhood';
  personhood: PersonSavePayload;
}>;

export function serializeCoreV9(core: SimulationCore, baseV8: SaveV8 = serializeCoreV8(core)): SaveV9 {
  if (!core.isPersonhoodAuthorityEnabled()) throw new Error('Save V9 requires Personhood authority');
  return {
    ...baseV8,
    saveVersion: 9,
    gameVersion: '0.9.0-personhood',
    personhood: core.getPersonSavePayload(),
  };
}

export function hydrateCoreV9(input: unknown): SimulationCore {
  if (!isRecord(input) || input.saveVersion !== 9) {
    const core = hydrateCoreV8(input);
    core.enablePersonhoodAuthority();
    return core;
  }
  if (input.gameVersion !== '0.9.0-personhood') throw new Error('invalid V9 game version');
  if (!isRecord(input.personhood)) throw new Error('personhood must be an object');

  const save = input as unknown as SaveV9;
  const { personhood, ...withoutPersonhood } = save;
  const v8: SaveV8 = {
    ...withoutPersonhood,
    saveVersion: 8,
    gameVersion: '0.8.0-world-foundation',
  };
  const core = hydrateCoreV8(v8);
  core.restorePersonhoodAuthority(personhood);
  return core;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
```

- [ ] **Step 4: Update the canonical router without changing `saveV8.ts`**

Add imports/exports for V9 to `src/save/save.ts`, then replace only the top-level routing functions with:

```ts
export function serializeCore(core: SimulationCore): SaveV8 | SaveV9 {
  const sanitizedV7 = sanitizePausedServiceState(serializeCoreV7(core), core);
  const v8 = serializeCoreV8(core, sanitizedV7);
  return core.isPersonhoodAuthorityEnabled() ? serializeCoreV9(core, v8) : v8;
}

export function hydrateCore(input: unknown): SimulationCore {
  return isSaveVersion(input, 9) ? hydrateCoreV9(input) : hydrateCoreV8(input);
}

function isSaveVersion(input: unknown, version: number): boolean {
  return typeof input === 'object'
    && input !== null
    && !Array.isArray(input)
    && (input as Record<string, unknown>).saveVersion === version;
}
```

Keep `sanitizePausedServiceState` intact.

- [ ] **Step 5: Run focused persistence gates**

```bash
node --experimental-strip-types --test tests/save-v9-personhood.test.ts tests/person-persistence.test.ts tests/person-core-integration.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run World Foundation V8 regression tests**

```bash
node --experimental-strip-types --test tests/*save*v8*.test.ts tests/*world*.test.ts
```

Expected: all matching existing V8/world tests PASS; `src/save/saveV8.ts` remains semantically unchanged.

- [ ] **Step 7: Commit**

```bash
git add src/save/save.ts src/save/saveV9.ts tests/save-v9-personhood.test.ts
git commit -m "feat: extend world saves with personhood v9"
```

---

### Task 5: Add the Phase 3R scale and determinism gate

**Files:**
- Create or restore: `tests/person-performance.test.ts`
- Modify only if required by measured bottleneck: focused `src/simulation/people/*` implementation files.

**Interfaces:**
- Consumes: deterministic Person bootstrap and canonical Person snapshots.
- Produces: a 100,000-resident correctness/determinism CI gate and a separate 1,000,000-resident stress entry point that is not part of normal CI.

- [ ] **Step 1: Restore the planned performance test if present in the archived Phase 3R branch**

```bash
git checkout archive/phase-3r-personhood-core-pre-v9 -- tests/person-performance.test.ts
```

If the archived file is absent, create this correctness-first test:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { SimulationCore } from '../src/simulation/core/SimulationCore.ts';
import { flatTerrain } from './support/kernelParity.ts';

function build(population: number, seed: number) {
  const core = new SimulationCore({ terrain: flatTerrain(16, 10), seed, startingFunds: 1_000_000 });
  core.population.restore(population);
  core.enablePersonhoodAuthority();
  return core;
}

test('100k Personhood bootstrap is deterministic and population-conserving', () => {
  const a = build(100_000, 1907);
  const b = build(100_000, 1907);
  assert.equal(a.population.population, 100_000);
  assert.equal(a.entityRegistry.listActive('person').length, 100_000);
  assert.deepEqual(a.getPersonSnapshot(), b.getPersonSnapshot());
  assert.deepEqual(a.kernel.random.snapshot(), b.kernel.random.snapshot());
});
```

- [ ] **Step 2: Run the 100k gate**

```bash
node --experimental-strip-types --test tests/person-performance.test.ts
```

Expected: PASS without relaxing identity, registry, or population-conservation assertions.

- [ ] **Step 3: If performance fails, profile before optimizing**

Run the exact failing 100k test with Node timing and inspect only Personhood bootstrap/store/registry hotspots. Do not disable invariants or reduce the test population to make CI green.

- [ ] **Step 4: Re-run deterministic output twice**

```bash
node --experimental-strip-types --test tests/person-performance.test.ts
node --experimental-strip-types --test tests/person-performance.test.ts
```

Expected: both runs PASS with stable deterministic snapshots.

- [ ] **Step 5: Commit**

```bash
git add tests/person-performance.test.ts src/simulation/people
git commit -m "test: gate personhood at 100k residents"
```

---

### Task 6: Complete the Phase 3R audit and CI gate

**Files:**
- Modify only files required by verified failures from the commands below.
- Update PR #72 description after all checks pass.

**Interfaces:**
- Consumes: all completed Phase 3R work.
- Produces: a reviewable draft PR with green tests, typecheck, lint, build, deterministic persistence, and 100k scale gate.

- [ ] **Step 1: Run all focused Phase 3R tests**

```bash
node --experimental-strip-types --test \
  tests/person-types.test.ts \
  tests/person-store.test.ts \
  tests/person-entity-registry.test.ts \
  tests/person-bootstrap.test.ts \
  tests/person-population-projection.test.ts \
  tests/person-invariants.test.ts \
  tests/person-persistence.test.ts \
  tests/person-core-integration.test.ts \
  tests/save-v9-personhood.test.ts \
  tests/person-performance.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run full repository tests**

```bash
npm test
```

Expected: PASS.

- [ ] **Step 3: Run static and build gates**

```bash
npm run typecheck
npm run lint
npm run build
```

Expected: all PASS.

- [ ] **Step 4: Verify version ownership directly**

```bash
grep -R "0.8.0-personhood" src tests && exit 1 || true
grep -R "0.8.0-world-foundation" src/save/saveV8.ts
grep -R "0.9.0-personhood" src/save/saveV9.ts tests/save-v9-personhood.test.ts
```

Expected: no stale Personhood V8 literal; World Foundation V8 and Personhood V9 literals are present only in their intended contracts.

- [ ] **Step 5: Verify branch containment**

```bash
git fetch origin main civic-2.0-phase-0b-forward-port
git merge-base --is-ancestor origin/civic-2.0-phase-0b-forward-port HEAD
git diff --name-only origin/civic-2.0-phase-0b-forward-port...HEAD
```

Expected: the diff contains only Phase 3R Personhood code/tests/docs and deliberate runtime/save integration. It must not contain unrelated rewrites of World Foundation, Transport 2.0, cadastral authority, PR #20, or PR #63 work.

- [ ] **Step 6: Push and verify GitHub Actions**

```bash
git push origin feature/phase-3r-personhood-core
```

Inspect the exact workflow run for the pushed head SHA. Do not declare completion from local tests alone.

- [ ] **Step 7: Final commit only if audit-required fixes were made**

```bash
git add -A
git commit -m "fix: complete phase 3r integration audit"
git push origin feature/phase-3r-personhood-core
```

Skip this commit if Step 1-6 required no code changes.

## Completion Gate

Do not mark PR #72 ready or complete until all of the following are true:

- PR #72 targets `civic-2.0-phase-0b-forward-port`.
- The old Phase 3R head remains recoverable from `archive/phase-3r-personhood-core-pre-v9`.
- World Foundation Save V8 remains unchanged in ownership and semantics.
- Personhood persistence is the next available save version, expected V9.
- `hydrateCoreV8` never creates Person authority.
- Explicit V8→V9 migration materializes residents exactly once.
- V9 restore consumes no bootstrap RNG and reproduces exact Person identity.
- Population is derived from living resident Persons under authority mode.
- Full tests, typecheck, lint, build, and GitHub Actions are green.
- The 100k determinism/correctness gate passes.
