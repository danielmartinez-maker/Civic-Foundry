# Civic Foundry 2.0 — Phase 0B Entity Registry & Referential Integrity Design

## Status

Approved direction in chat on 2026-08-24. This specification defines the second Civic Foundry 2.0 Foundry Kernel tranche after Phase 0A.

Phase 0A introduced the deterministic `SimulationKernel` beneath the existing V7 simulation and preserved exact V7 compatibility. Phase 0B adds stable cross-domain identity and referential-integrity infrastructure without migrating gameplay-domain ownership or changing the V7 save schema.

This tranche is intentionally a compatibility layer. Existing V7 systems remain authoritative for their state while the registry projects their durable entities into a typed identity graph that later Civic Foundry 2.0 phases can adopt directly.

## Relationship to the Master Architecture

The Civic Foundry 2.0 master architecture requires an `EntityRegistry` that provides:

- stable typed entity identifiers;
- cross-domain reference validation;
- deletion and replacement rules that prevent orphan references;
- deterministic behavior across replay and save/load;
- a migration path from V7 string IDs to durable Civic Foundry 2.0 identity.

The master architecture names future entity classes including person/cohort, household, parcel, building, unit, firm, vehicle, facility, project, contract, network node/edge, and government body.

Phase 0B establishes the identity substrate for those future systems. It does not yet implement those future domain models.

## Why This Tranche Comes Next

Current V7 systems allocate and interpret identifiers independently:

- lots use coordinate-derived IDs such as `lot:8,12`;
- buildings use `building:${lot.id}`;
- redevelopment may replace a building while reusing the same V7 building string ID;
- firms allocate sequential IDs such as `firm:1` and reference buildings by raw string;
- service facilities allocate `service:*` IDs;
- transit stops and lines allocate independent sequential IDs;
- traffic vehicles allocate `vehicle:*` IDs and retain building references;
- several systems rebuild or restore state independently.

This is acceptable inside the V7 compatibility baseline, but it is not sufficient for later 2.0 systems where entities must survive cross-domain references, replacement, save/load, diagnostics, and migration.

The most dangerous current case is identity reincarnation: a V7 string can refer to one physical/logical entity at one time and a replacement entity later. A future stale reference must never silently bind to the replacement merely because the string ID was reused.

Phase 0B solves that problem before SpatialIndex, EconomicLedger, household simulation, parcels, contracts, and government systems begin depending on shared identity.

# Goals

Phase 0B must provide:

1. A canonical typed entity-kind model.
2. Generation-aware entity handles that distinguish successive incarnations of the same legacy string ID.
3. A deterministic `EntityRegistry` for active and historical entity identity.
4. A deterministic cross-domain `EntityReferenceGraph`.
5. Explicit strong, owned, weak/historical, and external/derived reference semantics.
6. A compatibility projector that reconstructs entity identity from existing V7 authoritative state.
7. Deterministic referential-integrity diagnostics and invariants.
8. Kernel integration after the existing `legacy-v7-city` compatibility system.
9. Exact V7 parity preservation.
10. Rebuild-on-hydrate behavior with no Save V8 requirement.
11. A stable API that later 2.0 systems can use directly without depending on V7 string conventions.

# Non-Goals

Phase 0B does **not**:

- replace existing V7 IDs inside gameplay systems;
- change any V7 public mutation API;
- migrate roads, parcels, households, firms, vehicles, transit, services, utilities, or housing ownership into the registry;
- make the registry authoritative for domain state;
- introduce a new save version;
- persist registry state independently;
- fabricate historical entity incarnations that cannot be reconstructed;
- implement SpatialIndex;
- implement EconomicLedger;
- implement StatisticsEngine or HistoryStore;
- implement household/person agents;
- implement Phase 1R parcels or geography;
- change redevelopment behavior;
- change traffic routing or transit behavior;
- change simulation cadence, formulas, RNG consumption, or balance;
- change UI behavior.

# Core Design Principle

The registry owns **identity metadata and reference metadata only**.

Domain systems continue to own all gameplay state.

For example:

- `BuildingSystem` remains authoritative for building definition, construction state, location, and development metadata;
- `FirmSystem` remains authoritative for firm status, jobs, productivity, and cash health;
- `TransitNetworkSystem` remains authoritative for stop and line topology;
- `TrafficSystem` remains authoritative for active traffic vehicles.

The registry answers questions such as:

- What kind of entity is this?
- Is this incarnation active?
- Was this legacy string reused?
- Which generation is current?
- Does this reference point to the intended incarnation?
- Which active entities strongly reference this entity?
- Is deletion/replacement legal under declared reference rules?
- Does the projected V7 entity graph contain dangling or invalid references?

It does not answer gameplay-domain questions such as capacity, rent, jobs, signal timing, or health.

# Package Layout

Phase 0B introduces a focused package:

```text
src/entities/
  EntityTypes.ts
  EntityRegistry.ts
  EntityReferenceGraph.ts
  EntityProjection.ts
  LegacyV7EntityProjector.ts
  EntityDiagnostics.ts
```

Tests live in focused files under `tests/`.

Normal source-file limits from the master architecture remain in force.

# Entity Kinds

## Canonical Type

```ts
export type EntityKind =
  | 'lot'
  | 'building'
  | 'firm'
  | 'utility-facility'
  | 'service-facility'
  | 'transit-stop'
  | 'transit-line'
  | 'traffic-vehicle'
  | 'service-vehicle'
  | 'freight-vehicle'
  | 'incident'
  | 'project'
  | 'person'
  | 'cohort'
  | 'household'
  | 'parcel'
  | 'unit'
  | 'facility'
  | 'contract'
  | 'network-node'
  | 'network-edge'
  | 'government-body';
```

The union includes future master-architecture kinds even when Phase 0B does not yet project instances of them. This prevents repeated changes to the fundamental identity contract while still allowing later phases to activate kinds incrementally.

Kinds must be compared with ordinal string semantics. No locale-sensitive comparison may affect deterministic ordering.

# Entity Identity

## Legacy Identity

A legacy identity is the pair:

```ts
export type LegacyEntityKey = Readonly<{
  kind: EntityKind;
  legacyId: string;
}>;
```

`legacyId` preserves the identifier used by the current V7 domain owner.

Examples:

- `{ kind: 'lot', legacyId: 'lot:8,12' }`
- `{ kind: 'building', legacyId: 'building:lot:8,12' }`
- `{ kind: 'firm', legacyId: 'firm:4' }`
- `{ kind: 'transit-stop', legacyId: 'transit-stop:3' }`

The pair, not the raw string alone, identifies the namespace. Two different kinds may therefore reuse the same raw string without collision.

## Generation-Aware Handle

The canonical Civic Foundry 2.0 identity handle is:

```ts
export type EntityHandle<K extends EntityKind = EntityKind> = Readonly<{
  kind: K;
  legacyId: string;
  generation: number;
}>;
```

Rules:

- `generation` is a positive integer starting at 1;
- `(kind, legacyId, generation)` uniquely identifies one incarnation;
- a later entity using the same `(kind, legacyId)` receives a later generation;
- an old handle never resolves to a later generation;
- generations never decrement within one registry reconstruction;
- generation assignment must be deterministic from the projected authoritative state/history available in V7.

## Canonical String Form

For stable maps, diagnostics, snapshots, and hashes, a handle has a canonical serialization:

```text
<kind>|<legacyId>|g<generation>
```

Example:

```text
building|building:lot:8,12|g2
```

The implementation must escape or length-prefix fields if needed so arbitrary valid legacy IDs cannot create ambiguous serialized keys.

No system may depend on JavaScript object insertion order when constructing canonical registry output.

# Active and Historical Identity

The registry distinguishes:

- **active incarnation** — currently represented by the projected authoritative V7 state;
- **historical incarnation** — known to have existed but no longer active;
- **unknown identity** — no known incarnation can be reconstructed.

Phase 0B historical knowledge is deliberately limited to what can be reconstructed exactly.

The registry must not invent prior generations merely because a current V7 ID could theoretically have been reused before the save was made.

Where V7 data exposes enough information to distinguish reincarnations during a live session, the registry may retain those known historical handles in memory. On save/load, only reconstructable history may reappear.

This follows the master invariant: no fabricated history.

# Generation Rules

## Default Rule

When a projected active entity with `(kind, legacyId)` appears for the first time in a registry lifetime, it receives generation 1 unless the projector can deterministically derive a higher known incarnation count from authoritative information.

## Disappearance

When an active projected entity disappears:

- its handle becomes historical;
- the legacy key has no active generation;
- inbound strong or owned references are validated before the projection commit completes;
- weak/historical references may remain valid.

## Reappearance

If the same `(kind, legacyId)` appears again after a confirmed disappearance in the same registry lifetime, it receives the next generation.

## Replacement In One Sync

A projector may explicitly report a replacement transition when authoritative data proves that an old incarnation was replaced by a new one despite the legacy key remaining present.

This is required for building redevelopment where the V7 building string ID may be reused.

The projector therefore supports explicit incarnation tokens described below.

# Incarnation Tokens

A raw legacy ID alone cannot always distinguish replacements. Projectors may attach a deterministic `incarnationToken`:

```ts
export type ProjectedEntity = Readonly<{
  kind: EntityKind;
  legacyId: string;
  incarnationToken: string;
  metadata?: Readonly<Record<string, string | number | boolean | null>>;
}>;
```

The token is not itself the public entity ID. It is a deterministic compatibility signal used to decide whether the current V7 record represents the same incarnation as the previous projection.

Examples:

- lot: coordinate identity and current lot derivation token;
- building: `constructionStartedTick` plus other immutable creation attributes needed to distinguish redevelopment;
- firm: `formationTick` plus legacy firm ID;
- transit stop: stable legacy ID in V7 because removal/recreation receives a new sequential ID;
- traffic vehicle: legacy vehicle ID plus departure tick;
- incident: legacy incident ID plus creation tick if available.

Tokens must use only authoritative/reconstructable data.

If the projector cannot prove replacement, it must preserve the current generation rather than speculate.

# EntityRegistry

## Responsibilities

`EntityRegistry` owns:

- active handle lookup by `(kind, legacyId)`;
- known historical handles;
- current incarnation tokens;
- deterministic generation advancement;
- stable listing and snapshots;
- immutable return values;
- registration/projection commit semantics.

It does not own reference edges; those belong to `EntityReferenceGraph`.

## Proposed API

```ts
export class EntityRegistry {
  resolve<K extends EntityKind>(kind: K, legacyId: string): EntityHandle<K> | undefined;
  require<K extends EntityKind>(kind: K, legacyId: string): EntityHandle<K>;
  isActive(handle: EntityHandle): boolean;
  isKnown(handle: EntityHandle): boolean;
  currentGeneration(kind: EntityKind, legacyId: string): number | undefined;
  listActive(kind?: EntityKind): readonly EntityHandle[];
  listHistorical(kind?: EntityKind): readonly EntityHandle[];
  beginProjection(): EntityProjectionBuilder;
  snapshot(): EntityRegistrySnapshot;
}
```

Direct ad hoc registration by gameplay systems is intentionally not required in Phase 0B. The V7 compatibility path updates the registry through projection transactions.

Future 2.0 domain systems may gain explicit registry allocation APIs in later specs once those systems become authoritative users.

# Projection Transactions

Entity synchronization must be atomic from the perspective of diagnostics and reference validation.

The registry therefore uses a projection transaction:

```ts
const projection = registry.beginProjection();
projection.entity(...);
projection.entity(...);
projection.reference(...);
projection.commit();
```

A failed projection must not leave half-updated identity state.

The implementation may stage data in owned maps/arrays and replace committed state only after validation succeeds.

Projection inputs are normalized and deterministically sorted before generation or reference decisions are finalized.

# EntityReferenceGraph

## Purpose

The reference graph records semantic relationships between entity handles without taking ownership of domain state.

Example:

```text
firm|firm:4|g1
  --strong:firm-building-->
building|building:lot:8,12|g2
```

## Reference Record

```ts
export type EntityReferenceKind = 'strong' | 'owned' | 'weak' | 'external';

export type EntityReference = Readonly<{
  source: EntityHandle;
  target: EntityHandle;
  semantics: EntityReferenceKind;
  relation: string;
}>;
```

`relation` is an ordinal deterministic identifier such as:

- `firm-building`
- `transit-line-stop`
- `vehicle-origin-building`
- `vehicle-destination-building`
- `service-vehicle-facility`

Relations are not free-form user labels. They are stable developer-defined identifiers.

# Reference Semantics

## Strong Reference

A strong reference requires the target incarnation to be active at projection commit.

Examples:

- active firm → current building;
- active transit line → current stop;
- active service vehicle → current service facility where the vehicle cannot exist independently.

A dangling strong reference fails referential-integrity validation.

## Owned Reference

An owned reference is a stronger lifecycle constraint.

The target is the logical owner/parent of the source. Removing or replacing the target requires the source to be removed, closed, reparented, or otherwise explicitly reconciled in the same projection.

Examples in future phases may include:

- unit → building;
- project component → project;
- contract subrecord → contract.

Phase 0B uses owned semantics only where current V7 behavior makes ownership unambiguous.

## Weak / Historical Reference

A weak reference may point to a historical incarnation.

It must still point to a **known exact handle**. It may not silently resolve by legacy ID to whatever generation happens to be current.

Examples:

- completed historical records that name a former building;
- an active trip's recorded origin building after demolition, if gameplay semantics permit the trip to continue.

## External / Derived Reference

An external reference documents a relationship whose target is outside the authoritative entity registry for this tranche or belongs to rebuildable derived topology.

Examples may include route edge IDs before network entities migrate into the registry.

External references are diagnostic and do not impose entity lifecycle constraints.

They must not be used as a loophole for relationships that clearly require strong integrity.

# Deletion and Replacement Rules

The projection commit validates lifecycle transitions.

## Strong Inbound References

An entity may not disappear while an unreconciled active strong inbound reference remains.

The projection must either:

- remove the source;
- retarget the source to a valid new handle;
- change the reference semantics only if the domain design explicitly permits it.

## Owned Inbound References

Owned dependents must be reconciled in the same projection transaction.

## Weak Inbound References

Weak references remain attached to the historical target handle.

They never auto-retarget to a new generation.

## Replacement

Replacement creates a new generation when the incarnation token changes or the projector explicitly marks the legacy identity as replaced.

All references must then be reconsidered according to semantics.

A strong reference to generation 1 does not become a reference to generation 2 automatically.

# LegacyV7EntityProjector

## Role

`LegacyV7EntityProjector` is the compatibility bridge from current authoritative systems to the registry.

It reads existing V7 systems through their public snapshots/list APIs and produces a deterministic `EntityProjection`.

It does not mutate gameplay state.

## Initial Entity Coverage

Phase 0B must project at minimum:

1. lots;
2. buildings;
3. firms;
4. utility facilities;
5. service facilities;
6. transit stops;
7. transit lines;
8. active traffic vehicles;
9. service vehicles when stable IDs/references are available through existing APIs;
10. freight vehicles when stable IDs/references are available through existing APIs;
11. incidents/projects only where existing V7 records expose stable, reconstructable identity.

If one of items 9–11 cannot be projected without adding gameplay APIs or changing authoritative semantics, the spec permits deferring that individual kind. Such deferral must be explicit in implementation documentation and tests; it must not weaken the required minimum items 1–8.

## Initial Reference Coverage

Required references:

- building → lot;
- active firm → building;
- transit line → each stop;
- active traffic vehicle → origin building;
- active traffic vehicle → destination building.

Additional service/freight references should be projected where their existing APIs expose exact relationships safely.

# V7-Specific Semantics

## Lots

Lots are currently derived from zoning and road frontage and may be rebuilt.

Phase 0B treats a lot as active when it appears in the current `LotSystem` projection.

Because the current lot ID is coordinate-derived, disappearance followed by reappearance in the same registry lifetime is a new generation unless the projector can prove continuity.

This conservative rule prevents a stale reference from attaching to a newly recreated legal parcel at the same cell.

## Buildings

A building is referenced to its lot.

The building incarnation token must include `constructionStartedTick` and enough immutable creation information to distinguish redevelopment replacement while preserving generation across ordinary status changes from construction to occupied.

Changing `status` from `construction` to `occupied` must **not** create a new generation.

Redevelopment that replaces one building with another under the same V7 building ID **must** create a new generation when the available V7 state proves the replacement.

## Firms

An active firm must strongly reference its active building.

Closed firms may remain known historically if they are still present in the V7 firm snapshot.

Firm incarnation continuity is based on the firm ID plus reconstructable formation identity such as `formationTick`.

If a building is replaced and an old firm is closed by existing V7 behavior, the registry must not silently retarget that closed firm to the replacement building.

## Transit

Each transit line strongly references every stop in its current ordered `stopIds`.

The graph preserves the fact that a line has multiple stop references. Reference ordering is not itself semantic for integrity, but the projector snapshot must preserve stable ordering for deterministic hashes.

A removed stop cannot remain as a strong target of an active line.

Current V7 behavior that removes a deleted stop from affected lines should therefore project as a valid graph.

## Traffic Vehicles

Active traffic vehicles preserve origin and destination building IDs.

These references are initially modeled as **weak/historical** because the vehicle may already be in motion when the source or destination building changes. Phase 0B must not change existing traffic behavior by forcing vehicle cancellation solely due to registry integrity.

If a referenced building remains active, the weak reference points to that exact active generation at the moment the vehicle is first projected.

If the building is later replaced, the vehicle's existing handle remains attached to the prior generation rather than auto-retargeting.

This is one of the main reasons generation-aware handles are required.

# Projection Continuity Cache

To preserve weak references and detect replacements during a live session, the projector/registry maintains a non-authoritative continuity cache containing:

- last incarnation token per legacy key;
- last active handle per legacy key;
- known historical handles;
- prior resolved handles for reference-bearing active source entities when needed.

This cache is diagnostic/migration infrastructure.

It is not added to Save V7.

After hydration, continuity is reconstructed only from available V7 authoritative state. Exact historical distinctions that cannot be reconstructed are intentionally absent.

# Hydration Reconstruction of Historical Weak Targets

Phase 0B must not use the current active entity merely because its raw V7 ID matches a weak reference that may predate replacement.

When hydrating a Save V7, the projector may reconstruct a minimal historical incarnation **only when surviving authoritative state proves that an earlier incarnation existed**.

For example, if an active traffic vehicle has:

```text
originBuildingId = building:lot:8,12
departureTick = 120
```

and the current building with that same V7 ID has:

```text
constructionStartedTick = 170
```

then the surviving authoritative timestamps prove that the vehicle's origin reference cannot refer to the current building incarnation. The projector may therefore reconstruct:

- one historical building handle representing the proven pre-current incarnation;
- one current building handle representing the active incarnation;
- the vehicle's weak origin reference targeting the proven historical handle.

This reconstruction records **identity existence only**. It must not invent definition, owner, construction cost, demolition tick, or any other historical attributes not present in surviving authoritative state.

If the surviving state proves only that at least one prior incarnation existed, Phase 0B reconstructs only the minimum number of generations required by the evidence. It must not guess that multiple unobserved replacements occurred.

If authoritative state cannot distinguish whether a weak raw-string reference targets the current incarnation or an earlier one, the projector must not silently choose. The reference must be represented as an explicit unresolved compatibility diagnostic or external/derived reference according to the implementation plan, and it must not participate as a falsely resolved weak handle.

The implementation plan must define the exact deterministic evidence rules for each required weak-reference relation. Tests must cover both provable historical reconstruction and ambiguous cases.

This rule preserves both master invariants:

- no fabricated history;
- stale references never silently retarget to a replacement.

# Kernel Integration

Phase 0A currently schedules one compatibility system:

```text
legacy-v7-city
```

Phase 0B adds registry synchronization and integrity validation after that system:

```text
legacy-v7-city
    ↓
entity-registry-sync
    ↓
entity-reference-invariants
```

## `entity-registry-sync`

Properties:

- cadence: every tick initially;
- reads current V7 domain state;
- writes only entity-registry/identity domains;
- deterministic;
- no gameplay mutation;
- ordered `after: ['legacy-v7-city']`.

If profiling later proves every-tick full projection too expensive, implementation may add revision-based fast paths, but the externally observable registry state after each kernel tick must remain equivalent.

## Referential Invariant

The kernel invariant runner gains a registry invariant that validates:

- handle uniqueness;
- generation validity;
- active mapping consistency;
- no duplicate active incarnation for one legacy key;
- no dangling strong reference;
- no dangling owned reference;
- source handles exist;
- weak references target known handles when deterministically resolvable;
- unresolved compatibility references are explicitly classified and never masquerade as resolved handles;
- reference graph has deterministic canonical ordering.

Invariant failure must include enough diagnostic data to identify:

- tick;
- source handle;
- target handle if applicable;
- relation;
- semantics;
- failure category.

# Snapshot and Diagnostics

The registry exposes a deterministic diagnostic snapshot.

```ts
export type EntityRegistrySnapshot = Readonly<{
  active: readonly EntityHandle[];
  historical: readonly EntityHandle[];
  references: readonly EntityReference[];
}>;
```

If unresolved compatibility references exist, diagnostics expose them separately from `references` so consumers cannot mistake them for resolved entity handles.

The kernel diagnostic snapshot may include this entity snapshot through the existing `SnapshotRegistry`.

Canonical ordering:

1. entity kind ordinal;
2. legacy ID ordinal;
3. generation numeric;
4. for references: source canonical key, relation ordinal, target canonical key, semantics ordinal.

No locale-sensitive sort may affect the output.

The snapshot is diagnostic and is not part of Save V7.

# EntityDiagnostics

`EntityDiagnostics` provides pure helpers for:

- registry counts by kind;
- active/historical counts;
- inbound/outbound reference counts;
- dangling-reference reports;
- unresolved compatibility-reference reports;
- generation history per legacy key;
- canonical snapshot digest support for tests;
- concise invariant failure formatting.

Diagnostics must not mutate registry state.

# Error Semantics

Programming/configuration errors throw before projection commit when possible.

Examples:

- empty kind/ID where disallowed;
- invalid generation;
- duplicate projected entity with conflicting incarnation token;
- duplicate identical relation record where duplicates are forbidden;
- source projected with contradictory lifecycle state;
- strong reference to unknown target;
- owned reference to unknown target.

Unknown weak targets fail as resolved weak references. If the V7 compatibility projector cannot resolve them exactly, it must classify them explicitly as unresolved compatibility references rather than invent a target generation.

A failed projection leaves the previously committed registry/reference state unchanged.

# Determinism Requirements

Phase 0B must remain deterministic under all equivalent input orderings.

Tests must prove:

- projection result independent of source array iteration order;
- reference graph independent of source iteration order;
- generation advancement independent of map insertion order;
- canonical snapshot hash identical across repeat runs;
- hydration reconstruction identical across repeat runs;
- evidence-derived historical reconstruction is order-independent;
- unresolved compatibility-reference classification is deterministic;
- no `localeCompare`-dependent ordering in canonical kernel/entity infrastructure;
- no randomness used in registry identity assignment.

The registry must not consume any existing gameplay RNG stream.

# Persistence and Save Compatibility

## No Save V8

Phase 0B does not add registry state to the save schema.

`serializeCoreV7` output must remain structurally and byte-canonically compatible with the committed Phase 0A parity fixture.

## Hydration Sequence

Hydration remains conceptually:

```text
construct SimulationCore
→ restore V7 authoritative domains
→ restore shared clock and legacy RNG state
→ rebuild dependent derived V7 state
→ rebuild EntityRegistry from restored authoritative state
→ reconstruct only evidence-proven historical identity needed by surviving references
→ rebuild EntityReferenceGraph
→ classify any genuinely ambiguous compatibility references explicitly
→ run entity referential-integrity validation
→ return hydrated core
```

The exact hook may be implemented through a `SimulationCore` refresh method invoked after restore or through a safe registry synchronization entrypoint, but no gameplay tick may be consumed merely to rebuild the registry.

## Save/Load Equivalence

For a fixed V7 save:

- hydrate A → registry snapshot hash X;
- hydrate B → registry snapshot hash X;
- unresolved compatibility diagnostics, if any, are identical across both hydrations;
- hydrate → continue N ticks must match the existing V7 parity fixture;
- registry rebuild must not alter gameplay state or RNG state.

# Backward Compatibility

Phase 0B must preserve:

- all existing `SimulationCore` public methods;
- all existing V7 entity string IDs returned to UI/gameplay code;
- all current save versions and migration behavior;
- existing timing/cadence of gameplay systems;
- existing redevelopment formulas and behavior;
- existing transit behavior;
- existing traffic behavior;
- existing firm lifecycle behavior.

The new registry is additive compatibility infrastructure.

# Performance Design

The registry must support later city scale without becoming a per-tick O(N²) bottleneck.

## Required Characteristics

- primary active lookup: expected O(1) map lookup by canonical legacy key;
- handle-known lookup: expected O(1);
- reference adjacency: indexed by source and target for expected O(1) lookup plus edge count;
- canonical lists: sorting only when snapshot/diagnostic output requires it;
- no full deep clone of domain state;
- projector reads only required identity/reference fields;
- no scheduler recompilation per tick;
- no unbounded diagnostic history growth.

## Phase 0B Performance Gate

Use a representative developed-city fixture and compare the same workload before/after Phase 0B.

- median simulation regression <= 5% target;
- >5% triggers investigation and repeat measurement under controlled conditions;
- registry snapshot generation may be benchmarked separately;
- later 10k+ entity workloads should establish the shape needed for 1R/2R.

Performance evidence must distinguish projection cost from unrelated CI runner contention.

# Testing Strategy

## Unit Tests — Entity Identity

Test:

- handle validation;
- canonical key stability;
- generation starts at 1;
- disappearance/reappearance advances generation;
- unchanged incarnation token preserves generation;
- changed token advances generation;
- old handle never resolves as current;
- active/historical listing order is deterministic.

## Unit Tests — Reference Graph

Test:

- strong reference requires active target;
- owned reference requires active target;
- weak reference may target known historical handle;
- weak reference cannot auto-retarget after replacement;
- unresolved compatibility reference remains separate from resolved graph;
- external reference behavior;
- inbound/outbound lookup;
- duplicate relation normalization;
- canonical reference ordering.

## Transaction Tests

Test:

- failed projection does not partially commit;
- conflicting duplicate entity fails;
- replacement plus source retarget in same projection succeeds;
- target removal with unreconciled strong source fails;
- owned dependent removal/reconciliation succeeds atomically.

## V7 Projector Tests

Test at minimum:

- empty city;
- roads/zoning producing lots;
- building construction → occupied does not change generation;
- building redevelopment under reused V7 ID advances generation;
- firm → building strong reference;
- firm closure after building removal does not retarget;
- transit line → stop strong references;
- stop deletion and line repair remain valid;
- active traffic vehicle keeps original building generation as weak reference;
- hydration reconstructs a pre-current historical building handle when timestamps prove it existed;
- ambiguous post-hydration weak references are never silently bound to current replacements;
- deterministic projection independent of source ordering.

## Hydration Tests

Test:

- same Save V7 hydrated twice gives identical registry snapshot;
- same Save V7 hydrated twice gives identical unresolved-reference diagnostics;
- evidence-derived historical generation reconstruction is deterministic;
- registry rebuild consumes no simulation tick;
- registry rebuild consumes no gameplay RNG draw;
- save serialization contains no new registry fields;
- save→hydrate→continue preserves Phase 0A V7 parity.

## Kernel Tests

Test:

- `entity-registry-sync` runs after `legacy-v7-city`;
- entity invariant runs after synchronization;
- invalid projection aborts tick with diagnostic error;
- `step(0)` remains no-op;
- repeated deterministic steps produce same entity snapshot hashes.

## Regression Tests

The immutable Phase 0A parity fixture remains the primary behavior gate.

The fixture must never be updated merely to accommodate Phase 0B.

Existing save tests, Phase 3–7 integration tests, typecheck, lint, build, and browser smoke remain required.

# Expected Production Changes

Normal Phase 0B production scope:

```text
src/entities/*
src/simulation/core/SimulationCore.ts
src/simulation/kernel/*   # only if minimal integration hooks are required
```

Possible read-only/public-snapshot helper additions to existing domain systems are allowed only when necessary to project currently authoritative identity safely.

Any such helper must:

- expose existing state without changing domain ownership;
- be deterministic;
- avoid gameplay behavior changes;
- be covered by existing/new tests.

Phase 0B should not otherwise modify:

```text
src/app/
src/ui/
src/rendering/
src/data/
```

and should not change gameplay formulas inside development, economy, traffic, transit, housing, or service systems.

# Migration Strategy for Later Phases

Phase 0B deliberately separates **compatibility projection** from **future native allocation**.

Later migration sequence:

1. a replacement domain defines its authoritative 2.0 entity model;
2. that domain allocates/retains `EntityHandle`s directly;
3. compatibility projector stops synthesizing that entity kind;
4. cross-domain consumers switch from raw strings to typed handles;
5. save migration persists authoritative handle/generation data when required;
6. legacy V7 projection path for that domain is removed only after parity and migration acceptance.

This prevents a big-bang ID rewrite.

# Deferred Phase 0 Platform Work

After Phase 0B, the intended Foundry Kernel sequence is:

- **Phase 0C — SpatialIndex**
- **Phase 0D — EconomicLedger**
- **Phase 0E — StatisticsEngine, HistoryStore & Causality Tracing**

Those names are planning labels for the remaining Phase 0 master-architecture capabilities. Each still requires its own approved design/spec/implementation plan before code changes.

Phase 1R begins only after the required Phase 0 platform capabilities needed by World Foundation 2.0 are accepted.

# Acceptance Criteria

Phase 0B is complete only when all of the following are satisfied.

## Identity

1. Typed entity kinds and generation-aware handles exist.
2. `(kind, legacyId, generation)` uniquely identifies an incarnation.
3. Reused legacy IDs cannot make stale handles resolve to replacements.
4. Building redevelopment under a reused V7 ID is recognized as a replacement where V7 state proves it.
5. Construction → occupied lifecycle does not create false replacement generations.

## Referential Integrity

6. Required building→lot, firm→building, transit-line→stop, and traffic-vehicle→building references are projected.
7. Strong and owned dangling references fail validation.
8. Weak references may target known historical incarnations and never auto-retarget.
9. Ambiguous compatibility references are explicitly unresolved rather than falsely resolved.
10. Reference graph ordering is deterministic.
11. Projection is atomic on failure.

## Determinism

12. Equivalent source orderings produce byte-equivalent canonical registry snapshots.
13. Repeat runs produce identical registry hashes.
14. Evidence-derived historical reconstruction is deterministic and minimal.
15. No gameplay RNG state is consumed or altered.
16. Registry synchronization is frame-rate independent and kernel-scheduled.

## Compatibility

17. Existing immutable V7 parity fixture remains exact.
18. Save V7 schema remains unchanged.
19. Existing public V7 string IDs remain unchanged.
20. Save→hydrate reconstructs identical registry state and unresolved diagnostics without advancing the clock.
21. Existing gameplay-domain tests remain green.
22. Browser smoke remains green.

## Performance

23. Representative simulation median regression is at or below the 5% target, or any larger measured delta is investigated and resolved/justified before merge.
24. Registry lookup/reference operations meet the expected bounded complexity described in this spec.
25. Diagnostic history or snapshots do not grow unbounded per tick.

## Documentation and Review

26. `docs/ARCHITECTURE.md` documents the registry boundary and compatibility projection.
27. README architecture notes are updated if user-facing developer documentation requires it.
28. Implementation evidence records tests, parity, save compatibility, performance, and final commit SHA.
29. Legacy domain ownership is not removed in Phase 0B.

# Completion Gate

As with every Civic Foundry 2.0 tranche, Phase 0B may merge only after:

1. this phase-specific design is approved;
2. the implementation plan is approved;
3. tests are written before production behavior changes;
4. implementation is complete;
5. typecheck/lint/build are green;
6. unit/integration/invariant tests are green;
7. deterministic save/load/replay gates are green;
8. migration/compatibility fixtures are green;
9. performance budget is met or investigated;
10. browser smoke passes where relevant;
11. architecture documentation is updated;
12. exact V7 parity remains green;
13. code review is complete;
14. fresh verification evidence is recorded before completion is claimed.
