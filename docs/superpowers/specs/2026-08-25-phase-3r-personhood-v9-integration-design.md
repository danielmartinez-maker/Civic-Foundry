# Phase 3R — Personhood V9 Integration Architecture

**Date:** 2026-08-25
**Status:** Approved architecture; implementation pending written-spec review
**Target PR:** #72 — `feature/phase-3r-personhood-core`
**Dependency spine:** PR #89 — `civic-2.0-phase-0b-forward-port`

## Purpose

Phase 3R makes one persistent `Person` the authoritative unit for every detailed-city resident. The existing PR #72 implementation was built on the older `civic-2.0-phase-0b-inline` stack and independently claimed Save V8 for Personhood. Current `main` now owns Save V8 as `0.8.0-world-foundation`, so Personhood must be reconciled onto the forward-ported Phase 0B architecture and extend the existing persistence chain rather than replace it.

This design defines the architecture for that reconciliation. It does not broaden Phase 3R into families, schedules, jobs, education, health, memories, motivations, person-level travel, or other later Human Simulation tranches.

## Architectural Decision

PR #72 will be re-stacked onto the Phase 0B forward-port branch from PR #89, and Personhood persistence will move from its stale Save V8 contract to a new Save V9 contract.

The canonical save chain becomes:

```text
legacy saves -> V7 metropolitan -> V8 world-foundation -> V9 personhood
```

Version ownership is permanent once landed:

- **Save V7** remains the metropolitan compatibility envelope.
- **Save V8** remains owned by World Foundation with game version `0.8.0-world-foundation`.
- **Save V9** becomes owned by Personhood with game version `0.9.0-personhood`.

Phase 3R must never reinterpret a World Foundation V8 save as a Personhood V8 save.

## Dependency and Branch Architecture

### Current problem

PR #72 currently targets `civic-2.0-phase-0b-inline`. That branch has diverged materially from current `main`. Meanwhile PR #89 exists specifically to forward-port Phase 0B onto the current World Foundation / Transport 2.0 mainline.

Continuing Phase 3R directly on the old Phase 0B stack would preserve short-term local compatibility at the cost of a second, larger reconciliation later. Rebasing PR #72 directly onto `main` would also be incorrect because Phase 3R requires Phase 0B entity-registry contracts that are being reconciled in PR #89.

### Required dependency spine

The intended stack is:

```text
main
  └─ PR #89: civic-2.0-phase-0b-forward-port
       └─ PR #72: feature/phase-3r-personhood-core
```

PR #72 remains an isolated feature branch. `main`, PR #20, and PR #63 are not modified as part of this work.

The re-stack must preserve Phase 3R's Person domain work while accepting the current mainline implementations of World Foundation and other newer systems as authoritative where overlap exists.

## Persistence Architecture

### Save V9 shape

`SaveV9` extends the landed `SaveV8` envelope and adds canonical Personhood state:

```ts
export type SaveV9 = Omit<SaveV8, 'saveVersion' | 'gameVersion'> & Readonly<{
  saveVersion: 9;
  gameVersion: '0.9.0-personhood';
  personhood: PersonSavePayload;
}>;
```

The exact type composition may be adapted to existing conventions after the re-stack, but the ownership rule is fixed: V9 must contain the full V8-compatible world envelope plus a canonical Personhood payload.

### Serialization

When Personhood authority is enabled, canonical serialization must:

1. Serialize the existing V8 World Foundation envelope through the existing V8 serializer.
2. Add the canonical Personhood payload produced from `PersonStore`.
3. Replace only the version header with `saveVersion: 9` and `gameVersion: '0.9.0-personhood'`.
4. Preserve all V8 compatibility fields exactly as required by the V8 contract.

The V9 serializer must not independently reconstruct World Foundation state, terrain compatibility state, or older save fields. It delegates those responsibilities to the prior-version serializer.

If Personhood authority is not enabled, compatibility code may continue to serialize the highest valid pre-Personhood version required by the integration branch. Phase 3R completion requires normal detailed-city construction and canonical migration paths to activate Personhood authority before normal gameplay persistence.

### Version-router semantics

Prior-version APIs remain semantically pure:

- `serializeCoreV8` always emits a World Foundation V8 envelope and never adds Personhood.
- `hydrateCoreV8` hydrates World Foundation/legacy state and never bootstraps Persons as a hidden side effect.
- `serializeCoreV9` requires Personhood authority and emits the V8-derived envelope plus the Person payload.
- `hydrateCoreV9` restores genuine V9 input exactly and never bootstraps Persons.

The canonical Phase 3R router owns migration policy:

- V9 input -> `hydrateCoreV9` exact restore.
- V8 input -> `hydrateCoreV8`, then one-time deterministic Personhood materialization.
- V7-or-older input -> existing lower-version/World Foundation migration, then one-time deterministic Personhood materialization.

This separation prevents lower-version compatibility tests and callers from acquiring new Personhood side effects merely because Phase 3R exists.

Canonical serialization must not mutate a legacy runtime merely to make it saveable. If authority is not yet enabled, it may emit the highest valid pre-Personhood save. The production cutover instead ensures normal Phase 3R detailed-city runtimes have Personhood authority enabled before canonical persistence is expected to emit V9.

### V9 hydration

For a genuine V9 save:

1. Validate the V9 header.
2. Validate that `personhood` is structurally present before mutation.
3. Remove the Personhood extension and reconstruct a valid V8 envelope.
4. Delegate world and legacy hydration to `hydrateCoreV8`.
5. Restore Personhood from the persisted payload without running bootstrap.
6. Verify population conservation between the restored compatibility population envelope and living resident Persons.
7. Register Person entities and diagnostics through the Phase 0B entity-registry integration.

A V9 restore must reproduce the exact persisted Person identities and must not consume the `demographics/person-bootstrap` RNG stream.

### V8-to-V9 migration

A World Foundation V8 save contains no Personhood payload. Loading it through the canonical Phase 3R router performs a one-time Person materialization:

1. Hydrate the V8 save through the existing V8 loader so World Foundation remains authoritative.
2. Read the restored legacy/detailed-city resident population compatibility count.
3. Enable Personhood authority once.
4. Deterministically materialize one Person per resident using the dedicated `demographics/person-bootstrap` RNG stream.
5. Attach the Person-derived population projection.
6. Mark generated biographies/provenance as `bootstrap_background`, never as observed simulation history.
7. On the next canonical save, emit V9.

The original V8 input remains valid and unmodified. Migration is in-memory until the user saves.

### V7-and-older migration

Older saves must not bypass World Foundation migration. Their migration path is conceptually:

```text
V7-or-older input
  -> existing World Foundation migration/hydration
  -> V8-equivalent runtime state
  -> one-time Personhood materialization
  -> V9 on next save
```

Phase 3R must reuse the existing prior-version migration code rather than duplicate terrain/world migration behavior.

### Corruption and mismatch handling

Hydration must fail before partially enabling Personhood if any of these conditions occur:

- malformed Person payload;
- duplicate Person identities;
- invalid Person entity kinds or IDs;
- Person payload population disagrees with the authoritative compatibility population envelope;
- incompatible V9 game version;
- invalid underlying V8 world envelope.

Where a lower-layer V8/world error already exists, V9 should preserve that error boundary instead of masking it with a generic Personhood failure.

## Runtime Authority Boundaries

### PersonStore

`PersonStore` remains the sole owner of authoritative detailed-city Person records.

### EntityRegistry

The Phase 0B `EntityRegistry` owns cross-domain identity registration and referential-integrity visibility. Personhood must integrate through its public contracts and must not introduce a second entity registry or parallel global identity map.

### PopulationSystem

Once Personhood authority is active, detailed-city population is derived from living resident Persons. `PopulationSystem` becomes a compatibility/read-model adapter for legacy consumers until later tranches remove aggregate dependencies.

No subsystem may mutate the aggregate population count independently while Personhood authority is active.

### World Foundation

World Foundation remains the sole physical/geographic authority. Personhood may reference buildings, network entities, households, or locations through IDs, but it must not duplicate terrain, parcel, world, or physical-state ownership.

## Determinism

The migration must preserve deterministic simulation behavior.

- Person bootstrap uses only the named `demographics/person-bootstrap` stream.
- Adding or restoring Persons must not perturb traffic, development, firms, weather, transport, or other named RNG streams.
- Restoring a V9 save consumes no bootstrap draws.
- Repeated migration of the same pre-V9 save with the same seed must produce byte-equivalent canonical Person snapshots, subject to the repository's existing canonical serialization conventions.
- Person listing and serialization order remains stable and deterministic.

## Reconciliation Rules

When re-stacking PR #72 onto PR #89:

1. Preserve PR #89/mainline versions of World Foundation, Save V8, and newer physical simulation code.
2. Port Phase 3R Person domain files and tests on top of the forward-ported EntityRegistry.
3. Reconcile `SimulationCore` surgically; do not replace newer mainline integration wholesale with the older Phase 0B-era copy from PR #72.
4. Reconcile `save.ts` against the current version router rather than copying PR #72's stale V7/V8 router.
5. Remove the semantic claim that `saveV8.ts` belongs to Personhood.
6. Introduce Personhood as the next available version, expected to be V9 on the approved dependency spine.
7. If another save version lands on the exact dependency spine before implementation begins, increment Personhood to the next available version rather than colliding. The architectural rule is "next available after reconciliation," not the literal number 9 at any cost.

## TDD Strategy

The stale Personhood-V8 tests are not patched in place merely to turn CI green. They are replaced or renamed to express the corrected architecture first.

### RED contracts

The first reconciliation tests must establish:

1. World Foundation V8 remains recognized as V8 and is not interpreted as Personhood.
2. Direct `hydrateCoreV8` remains Personhood-free.
3. Canonical hydration of V8 performs the one-time Personhood migration.
4. Canonical Personhood saves emit the next available save version, expected V9.
5. V9 contains both a valid V8-derived world envelope and canonical Personhood payload.
6. V9 restore reproduces exact Persons without bootstrap RNG usage.
7. V8-to-V9 migration materializes residents exactly once.
8. V7-or-older migration passes through World Foundation migration before Personhood materialization.
9. Corrupt Person population envelopes fail before partial Person mutation.
10. Existing V8 World Foundation round-trip tests remain green.

Only after those tests fail for the intended reason should production persistence code be changed.

### GREEN implementation

Implement the minimum changes necessary to satisfy the new contracts:

- add the new Personhood save module;
- update the canonical save router;
- adapt `SimulationCore` restore/enable boundaries where required;
- preserve prior-version loaders and serializers;
- remove/retire Personhood's stale V8 module semantics;
- update focused Personhood persistence tests.

No unrelated refactor is part of the GREEN step.

## Verification Gates

Phase 3R persistence is not complete until all of these pass on the reconciled branch:

1. focused Person persistence tests;
2. V8 World Foundation persistence/migration tests;
3. V9 Personhood persistence/migration tests;
4. Person-core integration tests;
5. entity-registry integrity tests affected by the re-stack;
6. deterministic parity tests;
7. full repository test suite;
8. typecheck;
9. lint;
10. production build.

After persistence and core cutover are green, Phase 3R proceeds to its existing scale gates:

- **100k residents:** correctness + deterministic CI/performance gate;
- **1M residents:** architecture stress tier, not a normal CI requirement unless the master roadmap explicitly changes that policy.

## Rollback and Failure Containment

The reconciliation must remain reversible at the branch level.

- No changes are made directly to `main`.
- PR #72 remains draft until the dependency re-stack, persistence migration, and full verification gates pass.
- PR #89 remains independently reviewable as the Phase 0B forward-port.
- A failing V9 migration must not require modifying or deleting valid V8 saves.
- If PR #89's contracts change during reconciliation, Phase 3R adapts through its EntityRegistry/public interfaces rather than forking those interfaces.

## Non-Goals

This architecture does not implement:

- households/families beyond IDs required by existing Person records;
- jobs or career histories;
- school enrollment;
- adaptive schedules;
- motivations, memory, relationships, or social graphs;
- health or inheritance;
- person-level traffic/travel simulation;
- UI workflows for individual Sims;
- cadastral authority changes;
- World Foundation ownership changes.

Those remain later roadmap tranches.

## Completion Criteria

This architectural reconciliation is complete when:

- PR #72 is based on the current Phase 0B forward-port dependency spine;
- World Foundation retains exclusive Save V8 ownership;
- Personhood owns the next available save version, expected V9;
- every detailed-city resident has one persistent Person identity in authoritative mode;
- V8 and older saves migrate deterministically without rewriting their stored data;
- V9 restores exact Person identity without bootstrap;
- aggregate population is a derived compatibility projection under Personhood authority;
- no unrelated mainline authority is replaced;
- focused and full CI gates are green;
- the 100k Phase 3R scale/determinism gate passes before completion is declared.
