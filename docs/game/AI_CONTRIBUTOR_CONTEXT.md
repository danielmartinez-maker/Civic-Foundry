# Civic Foundry — AI Contributor Context

## Purpose

This is the fast operational briefing for an AI agent or unfamiliar contributor working on Civic Foundry.

Read it before proposing implementation changes.

## Mandatory reading order

For substantial work:

1. [`../README.md`](../README.md) — documentation map and source-of-truth precedence.
2. [`CURRENT_STATE.md`](CURRENT_STATE.md) — what is actually implemented now.
3. [`STATUS_AND_AUTHORITY.md`](STATUS_AND_AUTHORITY.md) — which subsystem owns each fact.
4. [`ROADMAP.md`](ROADMAP.md) — current phase sequence and target state.
5. Relevant domain doc under `docs/game/`.
6. [`../ARCHITECTURE.md`](../ARCHITECTURE.md) and relevant ADR/spec for technical implementation.
7. [`../../CONTRIBUTING.md`](../../CONTRIBUTING.md), [`../ENGINEERING_STANDARDS.md`](../ENGINEERING_STANDARDS.md) and [`../TESTING.md`](../TESTING.md) before code changes.

## First rule: verify status

Civic Foundry has detailed specifications for systems that are not yet implemented.

Never infer implementation from documentation depth.

Before stating that a capability exists:

- check `CURRENT_STATE.md`;
- inspect current code/accepted branch;
- inspect current architecture/save docs;
- verify tests or merge evidence when material.

Use **Implemented**, **Transitional** and **Target** precisely.

## Current architecture anchors

Preserve these unless an approved change explicitly replaces them:

- `SimulationCore` — public gameplay compatibility facade during migration.
- `SimulationKernel` — deterministic execution/scheduling infrastructure.
- `WorldFoundation` — sole physical/geographic authority.
- `CadastralGraph` — sole legal-land authority.
- `LotSystem` — derived compatibility facade, not land authority.
- canonical `BuildingV2` — Urban Fabric physical building representation within accepted scope.
- `GpuWorldRenderer` — production presentation owner, read-only relative to simulation authority.
- Electron — desktop host only.
- Save V9 — current default persistence envelope.

## Never create a second authority as a shortcut

Bad pattern:

```text
new feature needs parcel data
→ create independent parcel map inside feature
→ mutate it separately
```

Correct direction:

```text
read canonical CadastralGraph
→ derive/cache the view you need
→ invalidate/rebuild from canonical revisions
```

The same rule applies to geography, buildings, routes, ownership, population and future networks.

## Progressive replacement rule

Civic Foundry 2.0 is not a clean-slate rewrite.

For a domain replacement:

1. identify existing owner/compatibility behavior;
2. freeze important behavior in regression fixtures;
3. introduce the new domain interface/state;
4. validate parity/invariants where appropriate;
5. migrate persistence deliberately;
6. transfer authority only after acceptance;
7. remove legacy code only after nothing authoritative depends on it.

Do not delete a legacy path merely because a future spec describes its replacement.

## Determinism requirements

Assume determinism is mandatory for authoritative behavior.

Avoid:

- `Math.random()` or equivalent uncontrolled randomness;
- dependence on render frame timing;
- nondeterministic iteration affecting outcomes;
- current wall-clock time in simulation decisions;
- concurrency races that alter authoritative order;
- unstable ID generation.

Use project deterministic RNG/scheduling patterns.

## Simulation cadence

Do not put economic, demographic or market behavior in the renderer/update loop merely because the loop is convenient.

Each subsystem should run on an explicit simulation cadence appropriate to the domain.

## Conservation and invariants

Identify conserved quantities before implementing a system.

Examples:

- money;
- population/cohort weight;
- occupancy;
- inventory;
- cargo;
- passenger weight;
- capital/debt;
- network capacity assignment.

Write tests that prove the quantity cannot be duplicated or lost during state transitions.

## Cross-domain changes

If a mutation changes IDs/references owned by several domains, use or design a transaction boundary.

Cadastral runtime mutation is the reference pattern: stage a complete candidate, validate dependent references, commit in fixed order, rollback on failure.

Avoid partial updates with “repair later” semantics.

## Save compatibility

Before adding authoritative state, answer:

- Is the state genuinely authoritative or rebuildable?
- Does Save V9 need a new version?
- How do V9/older saves initialize it?
- Can migration avoid inventing history?
- What references must validate after hydration?
- Does save → load → continue remain deterministic?

Never bump a save version casually and never repurpose an older schema silently.

## Presentation changes

Renderer/UI code should consume simulation state and emit actions. It cannot become an authoritative model.

Keep:

- selection;
- animation interpolation;
- visual geometry caches;
- tool previews;
- overlay state

in presentation unless the underlying fact is itself gameplay state.

## Transportation caution

3R Transportation Engine 2.0 is the next major target replacement. Existing traffic/transit behavior is still current compatibility authority.

Do not implement lane/signal/parking concepts by creating a disconnected mini-network that competes with inherited road authority. Follow the accepted 3R design/plan and transfer authority deliberately.

## Prism Engine terminology

See [`PRISM_ENGINE.md`](PRISM_ENGINE.md).

As of the current documented repo state, the accepted runtime architecture is described through `SimulationKernel`, `SimulationCore`, domain owners and `GpuWorldRenderer`. “Prism Engine” should not be treated as a separate already-integrated engine module unless current repository code/specs explicitly establish it.

## Testing expectation

Material behavior changes should include the appropriate mix of:

- unit tests;
- integration tests;
- invariants;
- deterministic replay/continuation tests;
- migration fixtures;
- performance tests;
- browser/desktop smoke tests where presentation changes.

Do not weaken tests to make a replacement pass.

## Performance expectation

Before adding high-cardinality agents, ask whether explicit identity changes gameplay. Use cohorts/aggregation when appropriate.

Profile before exotic optimization. Prefer bounded cadence, spatial indexing and revisioned caches.

## Documentation expectation

When accepted runtime truth changes, update documentation in the same work:

- runtime ownership → `ARCHITECTURE.md` + authority/domain docs;
- persistence → `SAVE_FORMAT.md` + current state;
- completed phase → root README + `CURRENT_STATE.md` + `ROADMAP.md`;
- game identity/player-facing rule → relevant game docs.

## Vocabulary discipline

Use stable project terms from [`GLOSSARY.md`](GLOSSARY.md). In particular, distinguish:

- parcel vs lot;
- physical geography vs legal land;
- canonical vs legacy;
- authoritative vs derived;
- implemented vs target;
- simulation state vs presentation state.

## Before claiming completion

Verify the relevant repository gates and evidence. A feature is not complete because code was written or a local happy-path test passed.

Civic Foundry’s central engineering risk is architectural drift across many interacting systems. Favor explicit boundaries, tests and accurate status language over expedient parallel models.