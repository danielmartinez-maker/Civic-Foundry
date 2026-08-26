# Phase 3R Personhood V9 Execution Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-stack PR #72 onto the current Phase 0B forward-port, preserve World Foundation Save V8, and ship Personhood as the next persistence layer, expected Save V9.

**Architecture:** PR #89 is the dependency spine. Port only the isolated Person domain wholesale; reconcile runtime and persistence surgically against the newer wrapper-based `SimulationCore`. Direct V8 APIs stay pure; canonical `hydrateCore` upgrades V8 and older runtime state into Personhood exactly once, while V9 restores exact Person identity without bootstrap.

**Tech Stack:** TypeScript 5.x ES modules, Node 22 built-in test runner with `--experimental-strip-types`, `SimulationKernel`, Phase 0B `EntityRegistry`, World Foundation Save V8, deterministic named RNG streams.

**Spec:** `docs/superpowers/specs/2026-08-25-phase-3r-personhood-v9-integration-design.md`

## Global Constraints

- Save V7 remains the metropolitan compatibility envelope.
- Save V8 remains exclusively `0.8.0-world-foundation`.
- Personhood uses the next free save version after reconciliation, expected V9 / `0.9.0-personhood`.
- `hydrateCoreV8` never creates Person authority.
- Canonical `hydrateCore` migrates V8 and older saves through existing lower-version migration, then enables Personhood exactly once.
- V9 exact restore never consumes `demographics/person-bootstrap`.
- `PersonStore` is authoritative for detailed-city people; Phase 0B `EntityRegistry` remains the global identity registry.
- Population becomes a compatibility projection of living resident Persons only after Personhood authority is enabled.
- World Foundation remains the physical/geographic authority.
- Preserve the forward-port kernel fault behavior and newer mainline simulation code.
- Do not modify `main`, PR #20, or PR #63.
- Do not implement families, schedules, jobs, education, health, memory, motivations, inheritance, UI person workflows, or person-level travel.

---

### Task 1: Re-stack PR #72 safely

**Files:**
- Preserve: `docs/superpowers/specs/2026-08-25-phase-3r-personhood-v9-integration-design.md`
- Preserve: `docs/superpowers/plans/2026-08-25-phase-3r-personhood-v9-execution.md`

**Interfaces:**
- Consumes: `civic-2.0-phase-0b-forward-port`.
- Produces: `feature/phase-3r-personhood-core` directly based on the current forward-port head.

- [ ] **Step 1: Record exact heads and preserve the old implementation**

```bash
git fetch origin civic-2.0-phase-0b-forward-port feature/phase-3r-personhood-core plan/phase-3r-v9-restack-final13
OLD_PHASE3R_HEAD="$(git rev-parse origin/feature/phase-3r-personhood-core)"
FORWARD_PORT_HEAD="$(git rev-parse origin/civic-2.0-phase-0b-forward-port)"
git branch -f archive/phase-3r-personhood-core-pre-v9 "$OLD_PHASE3R_HEAD"
git push --force-with-lease origin archive/phase-3r-personhood-core-pre-v9
```

Expected: archive ref equals the pre-re-stack Phase 3R head.

- [ ] **Step 2: Move the feature branch onto PR #89**

```bash
git switch -C feature/phase-3r-personhood-core "$FORWARD_PORT_HEAD"
git push --force-with-lease=refs/heads/feature/phase-3r-personhood-core:"$OLD_PHASE3R_HEAD" origin feature/phase-3r-personhood-core
```

Expected: no commit on `main`, PR #20, or PR #63 changes.

- [ ] **Step 3: Restore the approved docs and commit**

```bash
git checkout archive/phase-3r-personhood-core-pre-v9 -- docs/superpowers/specs/2026-08-25-phase-3r-personhood-v9-integration-design.md
git checkout origin/plan/phase-3r-v9-restack-final13 -- docs/superpowers/plans/2026-08-25-phase-3r-personhood-v9-execution.md
git add docs/superpowers/specs/2026-08-25-phase-3r-personhood-v9-integration-design.md docs/superpowers/plans/2026-08-25-phase-3r-personhood-v9-execution.md
git commit -m "docs: restack phase 3r v9 architecture"
git push origin feature/phase-3r-personhood-core
```

- [ ] **Step 4: Retarget PR #72 to `civic-2.0-phase-0b-forward-port` and verify containment**

```bash
git merge-base --is-ancestor origin/civic-2.0-phase-0b-forward-port HEAD
```

Expected: exit 0.

---

### Task 2: Port the isolated Person domain RED→GREEN

**Files:**
- Create: `src/simulation/people/PersonTypes.ts`
- Create: `src/simulation/people/PersonStore.ts`
- Create: `src/simulation/people/PersonEntityBridge.ts`
- Create: `src/simulation/people/PersonBootstrapSystem.ts`
- Create: `src/simulation/people/PersonPopulationProjection.ts`
- Create: `src/simulation/people/PersonInvariantSystem.ts`
- Create: `src/simulation/people/PersonSnapshot.ts`
- Create: `src/simulation/people/PersonPersistence.ts`
- Test: `tests/person-types.test.ts`, `tests/person-store.test.ts`, `tests/person-entity-registry.test.ts`, `tests/person-bootstrap.test.ts`, `tests/person-population-projection.test.ts`, `tests/person-invariants.test.ts`, `tests/person-persistence.test.ts`

**Interfaces:**
- Produces: `PersonStore`, `PersonEntityBridge`, `PersonBootstrapSystem`, `PersonPopulationProjection`, `validatePersonState`, `buildPersonSnapshot`, `serializePeople`, `parsePersonSavePayload`, `restorePeople`.

- [ ] **Step 1: Restore tests only**

```bash
git checkout archive/phase-3r-personhood-core-pre-v9 -- tests/person-types.test.ts tests/person-store.test.ts tests/person-entity-registry.test.ts tests/person-bootstrap.test.ts tests/person-population-projection.test.ts tests/person-invariants.test.ts tests/person-persistence.test.ts
```

- [ ] **Step 2: Verify RED**

```bash
node --experimental-strip-types --test tests/person-types.test.ts tests/person-store.test.ts tests/person-entity-registry.test.ts tests/person-bootstrap.test.ts tests/person-population-projection.test.ts tests/person-invariants.test.ts tests/person-persistence.test.ts
```

Expected: missing `src/simulation/people/*` modules.

- [ ] **Step 3: Restore the isolated domain implementation only**

```bash
git checkout archive/phase-3r-personhood-core-pre-v9 -- src/simulation/people
```

Do not restore archived core, kernel, population, save router, or Save V8 files.

- [ ] **Step 4: Verify GREEN**

```bash
node --experimental-strip-types --test tests/person-types.test.ts tests/person-store.test.ts tests/person-entity-registry.test.ts tests/person-bootstrap.test.ts tests/person-population-projection.test.ts tests/person-invariants.test.ts tests/person-persistence.test.ts
```

Expected: PASS. If public EntityRegistry signatures changed, adapt `PersonEntityBridge` to the current public APIs only.

- [ ] **Step 5: Commit**

```bash
git add src/simulation/people tests/person-*.test.ts
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
- `SimulationCore.enablePersonhoodAuthority(): void`
- `SimulationCore.isPersonhoodAuthorityEnabled(): boolean`
- `SimulationCore.getPersonSnapshot(): PersonSnapshot`
- `SimulationCore.getPersonSavePayload(): PersonSavePayload`
- `SimulationCore.restorePersonhoodAuthority(input: unknown): void`
- `SimulationKernel.registerPersonDiagnostics(store: PersonStore, registry: EntityRegistry): void`
- `PopulationSystem.attachPersonProjection(projection: PersonPopulationProjection): void`

- [ ] **Step 1: Restore the runtime contract test and verify RED**

```bash
git checkout archive/phase-3r-personhood-core-pre-v9 -- tests/person-core-integration.test.ts
node --experimental-strip-types --test tests/person-core-integration.test.ts
```

Expected: missing Personhood API on the forward-port wrapper.

- [ ] **Step 2: Make `PopulationSystem` a compatibility adapter after cutover**

Add:

```ts
import type { PersonPopulationProjection } from '../people/PersonPopulationProjection.ts';

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

Preserve the current scalar as `legacyPopulation`. At the start of `update` and `restore`, add:

```ts
if (this.personProjection) throw new Error('population is person-derived');
```

- [ ] **Step 3: Add Person diagnostics without regressing kernel fault handling**

Add imports:

```ts
import type { EntityRegistry } from '../../entities/EntityRegistry.ts';
import { validatePersonState } from '../people/PersonInvariantSystem.ts';
import { buildPersonSnapshot } from '../people/PersonSnapshot.ts';
import type { PersonStore } from '../people/PersonStore.ts';
```

Add fields and method:

```ts
private personDiagnosticsStore: PersonStore | null = null;
private personDiagnosticsRegistry: EntityRegistry | null = null;

registerPersonDiagnostics(store: PersonStore, registry: EntityRegistry): void {
  if (this.personDiagnosticsStore || this.personDiagnosticsRegistry) {
    if (this.personDiagnosticsStore === store && this.personDiagnosticsRegistry === registry) return;
    throw new Error('person diagnostics already registered for another authority');
  }
  this.personDiagnosticsStore = store;
  this.personDiagnosticsRegistry = registry;
  this.invariants.register({
    id: 'person-state-valid', cadence: { every: 1 }, check: () => validatePersonState(store, registry),
  });
  this.snapshots.register('people', () => buildPersonSnapshot(store));
}
```

Do not copy the archived kernel wholesale; keep the forward-port `fault` field and fault guards/catch behavior.

- [ ] **Step 4: Add Person authority to the wrapper `SimulationCore`**

Add imports:

```ts
import { PersonBootstrapSystem } from '../people/PersonBootstrapSystem.ts';
import { PersonEntityBridge } from '../people/PersonEntityBridge.ts';
import { parsePersonSavePayload, serializePeople, type PersonSavePayload } from '../people/PersonPersistence.ts';
import { PersonPopulationProjection } from '../people/PersonPopulationProjection.ts';
import { buildPersonSnapshot, type PersonSnapshot } from '../people/PersonSnapshot.ts';
import { PersonStore } from '../people/PersonStore.ts';
```

Add fields:

```ts
private readonly personStore: PersonStore;
private readonly personEntityBridge: PersonEntityBridge;
private readonly personPopulationProjection: PersonPopulationProjection;
private personhoodAuthorityEnabled = false;
```

After `this.entityRegistry = new EntityRegistry();` initialize:

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
  this.kernel.registerPersonDiagnostics(this.personStore, this.entityRegistry);
  this.personEntityBridge.createPeople(people);
  this.population.attachPersonProjection(this.personPopulationProjection);
  this.personhoodAuthorityEnabled = true;
}

isPersonhoodAuthorityEnabled(): boolean { return this.personhoodAuthorityEnabled; }
getPersonSnapshot(): PersonSnapshot { return buildPersonSnapshot(this.personStore); }

getPersonSavePayload(): PersonSavePayload {
  if (!this.personhoodAuthorityEnabled) throw new Error('personhood authority is not enabled');
  return serializePeople(this.personStore);
}

restorePersonhoodAuthority(input: unknown): void {
  if (this.personhoodAuthorityEnabled) throw new Error('personhood authority is already enabled');
  const payload = parsePersonSavePayload(input);
  const expectedPopulation = this.population.population;
  const personPopulation = payload.people.reduce(
    (count, person) => count + (person.alive && person.resident ? 1 : 0), 0,
  );
  if (personPopulation !== expectedPopulation) {
    throw new Error(`person population mismatch: expected ${expectedPopulation}, received ${personPopulation}`);
  }
  this.personEntityBridge.createPeople(payload.people);
  this.kernel.registerPersonDiagnostics(this.personStore, this.entityRegistry);
  this.population.attachPersonProjection(this.personPopulationProjection);
  this.personhoodAuthorityEnabled = true;
}
```

Do not call `rebuildEntityProjection()` here; `PersonEntityBridge` owns the separate `person` partition directly.

- [ ] **Step 5: Verify GREEN and commit**

```bash
node --experimental-strip-types --test tests/person-core-integration.test.ts tests/person-invariants.test.ts tests/person-entity-registry.test.ts
git add src/simulation/core/SimulationCore.ts src/simulation/kernel/SimulationKernel.ts src/simulation/population/PopulationSystem.ts tests/person-core-integration.test.ts
git commit -m "feat: integrate personhood authority with current runtime"
```

---

### Task 4: Introduce Save V9 and canonical migration policy

**Files:**
- Create: `src/save/saveV9.ts`
- Modify: `src/save/save.ts`
- Create: `tests/save-v9-personhood.test.ts`
- Preserve unchanged: `src/save/saveV8.ts`

**Interfaces:**
- Produces: `SaveV9`, `serializeCoreV9(core, baseV8?)`, `hydrateCoreV9(input)`.
- Canonical `hydrateCore` migrates V8/older to Personhood; direct `hydrateCoreV8` remains Personhood-free.

- [ ] **Step 1: Write the failing V9 contracts**

Create `tests/save-v9-personhood.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hydrateCore, hydrateCoreV8, serializeCore, serializeCoreV7, serializeCoreV8, serializeCoreV9,
} from '../src/save/save.ts';
import { SimulationCore } from '../src/simulation/core/SimulationCore.ts';
import { flatTerrain } from './support/kernelParity.ts';

function coreWithPopulation(population: number, seed = 811): SimulationCore {
  const core = new SimulationCore({ terrain: flatTerrain(16, 10), seed, startingFunds: 1_000_000 });
  core.population.restore(population);
  return core;
}

test('World Foundation keeps exclusive Save V8 ownership', () => {
  const v8 = serializeCoreV8(coreWithPopulation(8));
  assert.equal(v8.saveVersion, 8);
  assert.equal(v8.gameVersion, '0.8.0-world-foundation');
  assert.ok('world' in v8);
  assert.equal('personhood' in v8, false);
});

test('direct hydrateCoreV8 remains Personhood-free', () => {
  const v8 = serializeCoreV8(coreWithPopulation(11));
  const loaded = hydrateCoreV8(structuredClone(v8));
  assert.equal(loaded.isPersonhoodAuthorityEnabled(), false);
  assert.equal(loaded.entityRegistry.listActive('person').length, 0);
});

test('canonical hydration migrates V8 to Personhood exactly once', () => {
  const v8 = serializeCoreV8(coreWithPopulation(17));
  const migrated = hydrateCore(structuredClone(v8));
  assert.equal(migrated.isPersonhoodAuthorityEnabled(), true);
  assert.equal(migrated.getPersonSnapshot().population, 17);
  assert.equal(migrated.entityRegistry.listActive('person').length, 17);
  assert.equal(migrated.kernel.random.listNames().includes('demographics/person-bootstrap'), true);
  const first = migrated.getPersonSnapshot();
  const v9 = serializeCore(migrated);
  assert.equal(v9.saveVersion, 9);
  const restored = hydrateCore(structuredClone(v9));
  assert.deepEqual(restored.getPersonSnapshot(), first);
  assert.equal(restored.kernel.random.listNames().includes('demographics/person-bootstrap'), false);
});

test('canonical V7 migration passes through World Foundation before Personhood', () => {
  const v7 = serializeCoreV7(coreWithPopulation(13));
  const migrated = hydrateCore(structuredClone(v7));
  assert.equal(migrated.isPersonhoodAuthorityEnabled(), true);
  assert.equal(migrated.world.diagnosticSnapshot().migrationMode, 'legacy-flat');
  assert.equal(migrated.getPersonSnapshot().population, 13);
  assert.equal(migrated.getPersonSnapshot().people.every((person) => person.provenance === 'bootstrap_background'), true);
  assert.equal(serializeCore(migrated).saveVersion, 9);
});

test('enabled Personhood serializes as V9 with the V8 world envelope', () => {
  const core = coreWithPopulation(25);
  core.enablePersonhoodAuthority();
  const save = serializeCore(core);
  assert.equal(save.saveVersion, 9);
  assert.equal(save.gameVersion, '0.9.0-personhood');
  assert.ok('world' in save);
  assert.ok('personhood' in save);
});

test('V9 exact restore rejects population mismatch before authority activation', () => {
  const core = coreWithPopulation(8);
  core.enablePersonhoodAuthority();
  const corrupt = structuredClone(serializeCoreV9(core)) as any;
  corrupt.personhood.people.pop();
  assert.throws(() => hydrateCore(corrupt), /person.*population|population.*person/i);
});
```

If `WorldFoundation.diagnosticSnapshot()` exposes the legacy migration mode under a different existing field, assert the existing `WorldMigratedTo1R` diagnostic/event instead; do not invent a new production field solely for this test.

- [ ] **Step 2: Verify RED**

```bash
node --experimental-strip-types --test tests/save-v9-personhood.test.ts
```

Expected: missing V9 exports and canonical migration behavior.

- [ ] **Step 3: Implement `src/save/saveV9.ts`**

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
  return { ...baseV8, saveVersion: 9, gameVersion: '0.9.0-personhood', personhood: core.getPersonSavePayload() };
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
  const v8: SaveV8 = { ...withoutPersonhood, saveVersion: 8, gameVersion: '0.8.0-world-foundation' };
  const core = hydrateCoreV8(v8);
  core.restorePersonhoodAuthority(personhood);
  return core;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
```

- [ ] **Step 4: Update only the top-level router in `src/save/save.ts`**

Add V9 imports/exports. Preserve `sanitizePausedServiceState` exactly. Route with:

```ts
export function serializeCore(core: SimulationCore): SaveV8 | SaveV9 {
  const sanitizedV7 = sanitizePausedServiceState(serializeCoreV7(core), core);
  const v8 = serializeCoreV8(core, sanitizedV7);
  return core.isPersonhoodAuthorityEnabled() ? serializeCoreV9(core, v8) : v8;
}

export function hydrateCore(input: unknown): SimulationCore {
  return hydrateCoreV9(input);
}
```

This is deliberate: canonical hydration owns migration policy. Direct `hydrateCoreV8` callers retain a pure compatibility load.

- [ ] **Step 5: Verify V9, V8, and lower-version contracts**

```bash
node --experimental-strip-types --test tests/save-v9-personhood.test.ts tests/person-persistence.test.ts tests/person-core-integration.test.ts
node --experimental-strip-types --test tests/*save*v8*.test.ts tests/*world*.test.ts
```

Expected: all PASS; `src/save/saveV8.ts` still identifies only `0.8.0-world-foundation`.

- [ ] **Step 6: Commit**

```bash
git add src/save/save.ts src/save/saveV9.ts tests/save-v9-personhood.test.ts
git commit -m "feat: extend world saves with personhood v9"
```

---

### Task 5: Add 100k CI determinism and 1M architecture stress gates

**Files:**
- Create: `tests/person-performance.test.ts`
- Create: `tools/personhood_stress.ts`

**Interfaces:**
- Produces: 100,000-resident CI correctness/determinism gate and a manual 1,000,000-resident architecture stress probe.

- [ ] **Step 1: Create the 100k CI gate**

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

- [ ] **Step 2: Run the 100k gate twice**

```bash
node --experimental-strip-types --test tests/person-performance.test.ts
node --experimental-strip-types --test tests/person-performance.test.ts
```

Expected: both PASS. If runtime cost fails the existing CI budget, profile Person bootstrap/store/registry before optimizing; do not reduce population or disable invariants.

- [ ] **Step 3: Create a manual 1M stress probe outside `tests/*.test.ts`**

Create `tools/personhood_stress.ts`:

```ts
import { SimulationCore } from '../src/simulation/core/SimulationCore.ts';
import { TerrainGrid } from '../src/world/terrain/TerrainGrid.ts';

const population = 1_000_000;
const terrain = TerrainGrid.flat(16, 10);
const core = new SimulationCore({ terrain, seed: 1907, startingFunds: 1_000_000 });
core.population.restore(population);
const started = performance.now();
core.enablePersonhoodAuthority();
const elapsedMs = performance.now() - started;
if (core.population.population !== population) throw new Error('1M population conservation failed');
if (core.entityRegistry.listActive('person').length !== population) throw new Error('1M entity registration failed');
console.log(JSON.stringify({ population, elapsedMs, people: core.getPersonSnapshot().people.length }));
```

If the existing `TerrainGrid` flat factory has a different name, use the existing flat-terrain constructor from current World Foundation tests; do not add a new terrain API for this probe.

Run manually:

```bash
node --experimental-strip-types tools/personhood_stress.ts
```

This is an architecture stress tier, not part of normal `npm test`.

- [ ] **Step 4: Commit**

```bash
git add tests/person-performance.test.ts tools/personhood_stress.ts src/simulation/people
git commit -m "test: gate personhood scale and determinism"
```

---

### Task 6: Full Phase 3R completion audit

**Files:**
- Modify only files tied to verified failures.

**Interfaces:**
- Produces: a green, reviewable PR #72 with no stale Personhood V8 ownership.

- [ ] **Step 1: Run focused Phase 3R tests**

```bash
node --experimental-strip-types --test tests/person-types.test.ts tests/person-store.test.ts tests/person-entity-registry.test.ts tests/person-bootstrap.test.ts tests/person-population-projection.test.ts tests/person-invariants.test.ts tests/person-persistence.test.ts tests/person-core-integration.test.ts tests/save-v9-personhood.test.ts tests/person-performance.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run full repository gates**

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

Expected: PASS.

- [ ] **Step 3: Verify save-version ownership**

```bash
if grep -R "0.8.0-personhood" src tests; then exit 1; fi
grep "0.8.0-world-foundation" src/save/saveV8.ts
grep "0.9.0-personhood" src/save/saveV9.ts tests/save-v9-personhood.test.ts
```

Expected: no stale Personhood-V8 literal.

- [ ] **Step 4: Verify branch scope**

```bash
git fetch origin main civic-2.0-phase-0b-forward-port
git merge-base --is-ancestor origin/civic-2.0-phase-0b-forward-port HEAD
git diff --name-only origin/civic-2.0-phase-0b-forward-port...HEAD
```

Expected: only Phase 3R Personhood, runtime/save integration, tests, tools, and approved docs.

- [ ] **Step 5: Push and verify the exact GitHub Actions run for HEAD**

```bash
git push origin feature/phase-3r-personhood-core
git rev-parse HEAD
```

Do not declare completion until GitHub Actions for that exact SHA is green.

## Completion Gate

- PR #72 targets `civic-2.0-phase-0b-forward-port`.
- Archive branch preserves the old Phase 3R head.
- V8 remains World Foundation-only.
- Canonical V8 and V7/older hydration performs one-time deterministic Personhood migration through existing World Foundation migration.
- Direct `hydrateCoreV8` stays Personhood-free.
- V9 exact restore reproduces people without bootstrap RNG.
- Person-derived population and EntityRegistry identity invariants hold.
- 100k deterministic CI gate passes.
- 1M architecture stress probe runs without violating identity/population conservation.
- Tests, typecheck, lint, build, and GitHub Actions are green.
