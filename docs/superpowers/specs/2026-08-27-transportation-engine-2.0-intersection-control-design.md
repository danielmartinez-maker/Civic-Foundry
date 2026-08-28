# Civic Foundry 2.0 — 3R-B Intersection Control Design

## Status

Approved in chat on 2026-08-27 as the second implementation tranche of **Phase 3R — Transportation Engine 2.0**.

This specification builds directly on the merged 3R-A Transportation Network Semantics foundation. It introduces movement-specific intersection control, deterministic signal timing, conflict matrices, queue service, legacy signal-plan generation, and a compatibility boundary for existing traffic consumers.

The tranche intentionally follows a progressive-replacement strategy. The new 3R-B subsystem becomes authoritative for intersection-control state, while legacy traffic consumers continue to operate through a deterministic compatibility adapter until their own migration gates pass.

## Product Intent

The current transportation engine can represent stable junctions, carriageways, lanes, lane groups, and legal turn movements, but the active intersection service model is still aggregate. Existing queueing is approach-level and uses one node-wide service pool; it has no movement-specific conflicts, signal phases, protected turns, coordination offsets, or pedestrian timing.

3R-B closes that authority gap without prematurely coupling the project to 3R-C dynamic rerouting, crash/disruption logic, explicit parking, or lane-changing microsimulation.

The result must make intersection behavior respond directionally and deterministically to:

- legal movement topology;
- lane-group capacity;
- signal phase state;
- road hierarchy;
- junction geometry;
- signal offsets;
- emergency priority;
- authored control overrides.

## Scope

3R-B includes:

1. Authoritative intersection-control state separate from physical road topology.
2. Stable intersection-control, signal-plan, and signal-phase identity.
3. Deterministic conflict-matrix derivation from 3R-A movement geometry.
4. Movement-specific queue state keyed by `TurnMovementId`.
5. Fixed-time signal plans.
6. Protected movement phases.
7. Amber and all-red clearance intervals.
8. Coordination offsets.
9. Pedestrian timing reservations and clearance windows.
10. Deterministic default signal-plan generation for migrated legacy roads.
11. Topology-change reconciliation and stale-reference invalidation.
12. A controller strategy interface for later adaptive signal logic.
13. A deterministic compatibility adapter for the current traffic/intersection consumer contract.
14. Unit, determinism, migration, conservation, integration, and scale tests.

3R-B explicitly excludes:

- live adaptive optimization;
- actuated detector logic beyond the interface boundary;
- congestion-aware route-choice updates;
- bounded vehicle rerouting;
- crash generation;
- incident-capacity degradation;
- weather effects;
- parking occupancy and cruising;
- permissive-gap acceptance modeling;
- lane-changing microsimulation;
- explicit pedestrian agents or pedestrian-route simulation;
- transit signal priority execution;
- emergency preemption execution;
- signal-editing UI.

Those behaviors remain later 3R tranches or later mobility phases.

## Architectural Rules

### Ownership

`TransportNetworkStore` remains authoritative for physical/legal transportation topology:

- junctions;
- road segments;
- carriageways;
- lanes;
- legal turn movements;
- lane and movement permissions;
- topology revision;
- network cost epoch.

3R-B introduces `IntersectionControlStore` as the authoritative owner of intersection-control policy:

- junction control mode;
- fixed-time signal plans;
- phase definitions;
- plan offsets;
- pedestrian timing reservations;
- authored control overrides;
- `intersectionControlRevision`.

3R-B introduces `MovementQueueSystem` as the runtime authority for movement-specific queue state:

- queued vehicles/travelers by `TurnMovementId`;
- deterministic ordering metadata;
- service-credit accumulation where required;
- release acknowledgements;
- queue diagnostics.

Derived state includes:

- lane groups;
- movement conflict matrices;
- active phase at a given simulation tick;
- current movement signal indication;
- compatibility projections;
- controller read models;
- queue analytics indexes.

Derived state is rebuildable and must not be persisted as independent authority.

### Authority separation

Signal timing never mutates physical/legal topology. A green or red indication does not alter `topologyRevision` and does not toggle `TurnMovement.allowed`.

A topology mutation that removes or changes a referenced movement invalidates affected derived control state and may require a deterministic control-plan rebuild.

Authored signal-plan changes increment `intersectionControlRevision`. Merely advancing the simulation clock or changing active phase because time advanced does not increment the revision.

Later routing-cost consumers may respond to changed signal policy by advancing `TransportNetworkStore.costEpoch` through an explicit integration contract. 3R-B does not overload topology revision for this purpose.

### Progressive replacement

3R-B does not require the current aggregate vehicle model to become lane-microscopic.

The new control engine is introduced beside the current `IntersectionSystem` contract. A compatibility adapter translates legacy approach-level demand into stable movement demand when sufficient route context exists, and projects movement releases back into the legacy acknowledgement contract.

Legacy consumers are not rewritten wholesale in this tranche. Migration occurs only after parity and conservation gates pass.

### Determinism

All control decisions must be deterministic for identical:

- transportation authority;
- control authority;
- queue state;
- simulation tick;
- traveler attributes;
- random-independent policy inputs.

No result may depend on object insertion order, `Map` iteration order, frame rate, wall-clock time, rendering cadence, or nondeterministic floating-point reduction order.

## Domain Model

### Intersection control identity

```ts
export type IntersectionControlId = string;
export type SignalPlanId = string;
export type SignalPhaseId = string;
```

Default-generated IDs derive only from stable junction identity and deterministic plan vocabulary.

Recommended canonical forms:

```text
ic:<junctionId>
sp:<junctionId>:default
phase:<junctionId>:<ordinal>:<movement-signature>
```

Exact string formatting may differ, but identity rules must remain stable and test-covered.

### Control mode

```ts
export type IntersectionControlMode =
  | 'uncontrolled'
  | 'fixed-time';
```

3R-B core implements only these execution modes. The controller interface may expose future adaptive modes, but no adaptive mode is authoritative until a later approved tranche.

### IntersectionControl

```ts
export type IntersectionControl = Readonly<{
  id: IntersectionControlId;
  junctionId: JunctionId;
  mode: IntersectionControlMode;
  signalPlanId?: SignalPlanId;
  source: 'generated' | 'authored';
}>;
```

A fixed-time control must reference exactly one valid signal plan for the same junction.

### Signal phase

```ts
export type SignalPhase = Readonly<{
  id: SignalPhaseId;
  protectedMovementIds: readonly TurnMovementId[];
  greenTicks: number;
  amberTicks: number;
  allRedTicks: number;
  pedestrianWalkTicks: number;
  pedestrianClearanceTicks: number;
}>;
```

`protectedMovementIds` is authoritative signal permission for the phase. 3R-B core does not model permissive turns across conflicting traffic. A movement is either protected for service during the green interval or not serviceable by that phase.

`pedestrianWalkTicks` and `pedestrianClearanceTicks` reserve time inside the phase contract so future pedestrian movement can consume it without a signal-schema rewrite. 3R-B does not yet create pedestrian agents or pedestrian queues.

All timing values are non-negative safe integers. `greenTicks` must be positive for every service phase. Generated plans must obey project constants for minimum green, amber, all-red, and pedestrian clearance.

### Signal plan

```ts
export type SignalPlan = Readonly<{
  id: SignalPlanId;
  junctionId: JunctionId;
  phases: readonly SignalPhase[];
  offsetTicks: number;
  source: 'generated' | 'authored';
}>;
```

Phase order is authoritative and stable. `offsetTicks` is normalized into the plan cycle length.

The plan cycle length is the exact integer sum of all phase intervals:

```text
cycle = Σ(green + amber + allRed)
```

Pedestrian walk/clearance timing must fit within the corresponding phase timing contract and may not extend the cycle implicitly.

### IntersectionControlSnapshot

```ts
export type IntersectionControlSnapshot = Readonly<{
  intersectionControlRevision: number;
  controls: readonly IntersectionControl[];
  plans: readonly SignalPlan[];
}>;
```

Snapshot ordering is canonical by stable ID. Derived conflict matrices, active phases, lane groups, and queues are excluded.

## Conflict Matrix

### Purpose

A conflict matrix answers whether two legal movements at the same junction may receive simultaneous protected service.

The matrix is derived from the current `TransportNetworkAuthority` and is rebuilt whenever the relevant topology revision changes.

### Conflict rules

Two distinct movements conflict if any of the following is true:

1. Their incoming lane sets overlap in a way that requires the same lane service resource at the same time.
2. Their outgoing lane sets overlap and create an immediate merge conflict.
3. Their interior swept paths cross inside the junction conflict area.
4. One movement's swept path enters the protected envelope reserved by the other movement's swept path.

A movement never conflicts with itself for matrix representation purposes; the diagonal is always false.

The matrix must be symmetric:

```text
conflict(a, b) === conflict(b, a)
```

### Geometry source

For the current 3R-A legacy projection, movement geometry is deterministically reconstructable from:

- junction coordinates;
- incoming carriageway origin junction;
- outgoing carriageway destination junction;
- lane ordinals;
- turn kind.

The builder must normalize each movement into a small junction-local path representation. It must not introduce a competing global road-geometry authority.

When richer 1R road geometry becomes available, the builder may consume a geometry-provider interface without changing conflict-matrix consumers.

### Validation

A fixed-time phase is invalid if any two protected movement IDs in the phase conflict.

Unknown movement IDs, duplicate movement IDs, movements from another junction, or disallowed movements invalidate the plan.

## Fixed-Time Signal Execution

### Simulation-tick clock

Signals execute on simulation ticks only.

For a plan with cycle length `C`, active cycle position is:

```text
position = mod(simulationTick + normalizedOffsetTicks, C)
```

where `mod` is a deterministic non-negative integer modulo operation.

Wall-clock time, render delta, and animation frame cadence never participate.

### Phase intervals

Each phase executes in this order:

1. green;
2. amber;
3. all-red clearance.

During green, only `protectedMovementIds` are serviceable.

During amber, no new normal movement service begins in 3R-B core. Existing already-released entities are unaffected because they have left the queue authority boundary.

During all-red, no movement receives new service.

This conservative model deliberately avoids yellow-dilemma and permissive-gap behavior until a later tranche.

### Coordination offsets

Offsets are stable integer tick values. Generated offsets may be zero in the first implementation unless a deterministic corridor rule is explicitly implemented and tested.

The engine must nevertheless support non-zero authored offsets now, because coordination is part of the 3R-B contract.

Two identical plans with different offsets must produce predictably shifted active-phase schedules and byte-equivalent results after save/rebuild of their authoritative plan definitions.

## Deterministic Legacy Signal-Plan Generation

### Compatibility policy

Migrated V7 intersections do receive deterministic default signal plans where topology indicates control is appropriate.

The approved default rule is:

- four-way junctions: fixed-time signal plan;
- three-way junctions: fixed-time signal plan when at least one participating road is `collector` or higher in the hierarchy;
- simple two-way continuation: uncontrolled;
- dead ends: uncontrolled.

For legacy V7 data, the practical road classes are `local`, `collector`, and `arterial`. The rule is written against hierarchy rank so later `avenue`, `expressway`, and `highway` approaches do not need a new generator contract.

### Phase grouping

Four-way generated plans use deterministic axis-based protected phases:

- one phase serves compatible north/south movements;
- one phase serves compatible east/west movements;
- additional protected-turn phases are introduced only when required by the derived conflict matrix and movement/lane configuration.

Three-way generated plans group compatible movements by the dominant road axis and side-road approach.

The generator must never place a conflicting movement pair in the same protected phase merely to minimize phase count.

### Green allocation

Generated plans allocate green time using a deterministic road-hierarchy weight derived from participating approach classes.

Higher-class approaches receive proportionally greater green allocation, subject to:

- a minimum green per service phase;
- deterministic integer rounding;
- stable remainder assignment by phase ID;
- fixed amber and all-red constants;
- minimum pedestrian clearance reservation.

The generator must not use live queue length, congestion, random values, or array order. Dynamic optimization belongs to later adaptive-control work.

### Generated versus authored plans

Generated plans are deterministic defaults. Authored controls override generated controls for the same junction.

A topology change that leaves all authored plan references valid preserves the authored plan. A topology change that removes or invalidates referenced movements marks the authored plan invalid and prevents silent partial execution.

The control layer must fail closed: an invalid signal plan may not release traffic as if it were valid. The reconciliation API must either produce a valid rebuilt generated plan or surface a deterministic validation failure for authored state.

## Movement Queue System

### Queue key

Runtime queues are keyed by `TurnMovementId`, not by incoming edge or junction alone.

```ts
export type MovementQueueEntry = Readonly<{
  vehicleId: string;
  travelerWeight: number;
  queuedTick: number;
  priority: 'normal' | 'emergency';
}>;
```

Additional immutable route/permission metadata may be included if implementation requires it, but ordering semantics remain explicit.

### Deterministic ordering

Within a movement queue, release precedence is:

1. emergency before normal;
2. lower `queuedTick` first;
3. stable `vehicleId` lexical order.

Across simultaneously serviceable movements, the service scheduler must use a deterministic stable movement order or a documented deterministic fairness rotation keyed to simulation tick. It may not depend on `Map` iteration order.

### Capacity accounting

A movement's service budget is bounded by the compatible source lane-group capacity and the active signal indication.

Capacity is expressed in traveler-weight units consistently with the existing aggregate traffic model. Fractional service credit may accumulate deterministically if conversion from per-minute capacity to per-tick budget is not integral.

The implementation must ensure:

- red movements release zero new traveler weight;
- all-red and amber release zero new normal traveler weight;
- service never exceeds available deterministic capacity credit;
- a queue entry is not released twice in the same tick;
- partial traveler-weight service cannot corrupt acknowledgement semantics;
- total queued + released + explicitly removed traveler weight is conserved.

### Release acknowledgement

The existing traffic engine relies on a release state that persists until the owning vehicle system acknowledges/removes the released vehicle. 3R-B must preserve an equivalent contract during compatibility migration.

A released entry cannot reappear as serviceable merely because the next simulation tick begins.

## Compatibility Adapter

### Purpose

`LegacyIntersectionControlAdapter` allows current aggregate traffic consumers to coexist with movement-specific 3R-B authority.

The adapter must be narrow and removable. It must not become a second intersection-control owner.

### Responsibilities

The adapter may:

- translate legacy incoming-edge queue requests into a movement queue when the next outgoing route edge is known;
- apply deterministic fallback mapping when a legacy consumer lacks lane-level detail but movement identity is still inferable;
- project movement release acknowledgements into the legacy vehicle-removal contract;
- expose aggregate queue diagnostics by summing canonical movement queues.

The adapter may not:

- invent illegal turns;
- bypass a red signal;
- mutate signal plans;
- mutate transport topology;
- silently choose among materially different legal movements using nondeterministic state.

If a legacy request lacks enough route context to identify a legal outgoing movement, the adapter must use an explicit compatibility policy and test it. Silent arbitrary movement selection is prohibited.

## Adaptive-Control Interface

3R-B defines an interface boundary for later adaptive control without implementing adaptive optimization.

```ts
export type IntersectionControllerInput = Readonly<{
  junctionId: JunctionId;
  simulationTick: number;
  plan: SignalPlan;
  queueSnapshot: readonly MovementQueueReadModel[];
}>;

export interface IntersectionController {
  resolve(input: IntersectionControllerInput): IntersectionControllerDecision;
}
```

The fixed-time controller is the only production implementation in 3R-B.

Future adaptive implementations must remain deterministic for equivalent inputs or explicitly consume deterministic kernel random streams. They may not use wall-clock timers or renderer state.

## Topology Reconciliation

`IntersectionControlStore` tracks the topology revision against which its generated controls were last reconciled.

When `TransportNetworkStore.topologyRevision` changes:

1. derived lane groups are rebuilt;
2. affected conflict matrices are rebuilt;
3. generated control plans for affected junctions are regenerated deterministically;
4. authored plans are revalidated against current movement IDs and conflicts;
5. stale movement queues referencing removed movements are reconciled through an explicit policy before the next service step.

Generated control state may be replaced automatically because it is deterministic derived/default authority.

Authored control state must never be silently rewritten into a different semantic plan. Invalid authored plans are surfaced as validation failures until explicitly replaced or a documented migration rule applies.

## Persistence

### Save version

3R-B does **not** increment the canonical save format beyond Save V9 in this tranche.

The reason is architectural: the initial progressive-replacement implementation can deterministically rebuild default generated controls from the existing persisted road/network state, and derived conflict/phase runtime state must not be persisted.

Save V10 becomes justified only when production gameplay allows irreducible authored intersection-control state that cannot be reconstructed from Save V9 inputs.

### Persisted versus rebuilt state

Not persisted in 3R-B core:

- generated default signal plans;
- conflict matrices;
- lane groups;
- active phase position;
- movement queues;
- compatibility projections;
- controller read models.

If authored overrides become user-visible before a future save-version tranche, they must not be enabled as durable gameplay state until persistence support is explicitly added. The engine may support authored plans in tests/tools as an in-memory API contract without falsely treating them as Save V9 durable state.

This restriction prevents silent save-data loss.

## Error Handling and Validation

Public mutation APIs return structured success/failure results where that matches 3R-A conventions. Pure builders and restore/validation functions may throw on invalid internal authority snapshots.

Validation must reject at minimum:

- empty or duplicate stable IDs;
- fixed-time control without a plan;
- plan referencing the wrong junction;
- duplicate phase IDs;
- zero/negative required green duration;
- non-finite or non-integer timing values;
- duplicate movement references inside a phase;
- unknown movement IDs;
- disallowed movement IDs;
- movement IDs from another junction;
- conflicting protected movements in one phase;
- offset outside normalizable integer range;
- malformed revision values;
- queues referencing unknown movements after reconciliation.

Invalid authority must fail closed rather than degrading to uncontrolled intersection service without an explicit migration policy.

## Proposed Module Boundaries

Implementation should prefer focused modules rather than enlarging the legacy `IntersectionSystem`.

Recommended files:

```text
src/simulation/transportation/
  IntersectionControlTypes.ts
  IntersectionControlStore.ts
  MovementConflictMatrix.ts
  DefaultSignalPlanBuilder.ts
  FixedTimeSignalController.ts
  MovementQueueSystem.ts
  LegacyIntersectionControlAdapter.ts
```

Existing 3R-A modules remain responsible for topology, lanes, lane groups, and movement-aware routing.

Exact file names may change during implementation if repo conventions make a different split cleaner, but the ownership boundaries in this specification are normative.

## Data Flow

For a normal simulation tick:

1. Read current `TransportNetworkSnapshot` and topology revision.
2. Reconcile control-derived state if topology revision changed.
3. Resolve the intersection control for each active junction.
4. Resolve fixed-time phase from simulation tick and offset.
5. Build the set of serviceable protected movements.
6. Compute deterministic per-movement service capacity from compatible lane groups.
7. Drain eligible movement queues according to stable priority/order rules.
8. Publish releases through the compatibility boundary.
9. Await owning traffic-system acknowledgement/removal.
10. Expose deterministic diagnostics/read models for analytics and later 3R-C cost estimation.

No rendering system participates in this flow.

## Testing Strategy

### Type and validation tests

Verify:

- stable control/plan/phase identity;
- canonical snapshot ordering;
- invalid timing rejection;
- invalid movement references rejection;
- cross-junction reference rejection;
- conflicting phase rejection;
- duplicate reference rejection.

### Conflict-matrix tests

Verify:

- symmetry;
- false diagonal;
- opposed through movements may run together when geometry permits;
- crossing through movements conflict;
- left-turn versus opposed-through conflicts;
- merge conflicts are detected;
- lane-overlap conflicts are detected;
- results are invariant to authority array order.

### Signal timing tests

Verify:

- exact green/amber/all-red boundaries;
- deterministic cycle wrap;
- non-zero offset phase shift;
- no frame-time dependence;
- stable behavior at large safe-integer simulation ticks;
- generated plan timing satisfies minimum constraints.

### Legacy migration tests

Verify:

- four-way local legacy junction generates a fixed-time plan;
- three-way all-local junction remains uncontrolled;
- three-way junction with collector/arterial approach generates a fixed-time plan;
- two-way continuation remains uncontrolled;
- generated plan and IDs are invariant to legacy road insertion order;
- road hierarchy changes alter green allocation directionally and deterministically.

### Queue/conservation tests

Verify:

- red movement does not discharge;
- green movement discharges within capacity;
- amber/all-red do not start new normal releases;
- larger lane-group capacity increases or preserves throughput, never decreases it solely because of capacity;
- emergency priority is deterministic;
- weighted travelers consume capacity correctly;
- no vehicle is released twice before acknowledgement;
- traveler weight is conserved across enqueue, service, acknowledgement, and removal.

### Topology-reconciliation tests

Verify:

- removed movement invalidates affected generated control and triggers deterministic rebuild;
- authored invalid movement reference fails closed;
- unaffected junction control IDs/plans remain stable;
- topology revision changes do not spuriously increment control revision unless authoritative control state changes;
- stale queue references are reconciled deterministically.

### Compatibility tests

Verify:

- current legacy traffic/intersection tests continue to pass through the compatibility boundary;
- existing V7 maps remain loadable;
- route legality remains owned by 3R-A movements;
- compatibility projection never invents u-turns or prohibited movements.

### Scale and determinism tests

At a representative large synthetic network:

- conflict matrices build within the existing simulation-test performance envelope;
- fixed-time control stepping scales with active controlled junctions and queued movements, not all theoretical movement pairs globally;
- repeated runs produce byte-equivalent canonical snapshots and diagnostics;
- reversed/shuffled source arrays produce identical results.

## Acceptance Criteria

3R-B is complete only when all of the following hold:

1. Intersection service can be expressed and executed by stable `TurnMovementId`.
2. Protected signal phases cannot contain conflicting movements.
3. Four-way migrated legacy intersections receive deterministic fixed-time signal plans.
4. Eligible three-way migrated intersections receive deterministic fixed-time signal plans under the approved hierarchy rule.
5. Two-way continuations remain uncontrolled.
6. Signal timing is simulation-tick deterministic and supports offsets.
7. Red/amber/all-red service rules are enforced.
8. Movement queues conserve traveler weight and preserve release acknowledgement semantics.
9. Emergency priority is deterministic.
10. Lane-group capacity changes throughput directionally.
11. Topology edits deterministically invalidate/rebuild affected generated control state.
12. The legacy traffic stack can continue through a compatibility adapter without becoming a second control authority.
13. Save V9 compatibility is preserved without pretending in-memory authored overrides are durable.
14. Existing transportation, traffic, save, architecture, typecheck, lint, build, and browser/visual smoke gates remain green.
15. `npm run verify` passes on the implementation branch before merge consideration.

## Deferred Follow-On Work

### 3R-B2 — Adaptive / actuated control

May add:

- detector state;
- queue-responsive green extension;
- phase skipping;
- bounded adaptive optimization;
- transit signal priority;
- emergency preemption;
- corridor progression tuning.

### 3R-C — Dynamic Routing and Disruption

Consumes 3R-A topology/cost revisions and 3R-B control delay estimates for:

- predicted travel time;
- congestion cost;
- bounded rerouting;
- tolls;
- incident delay;
- crash capacity effects;
- closures.

### 3R-D — Explicit Parking

Adds parking inventory, access, occupancy, search/cruising cost, and generalized-cost effects.

## Non-Negotiable Invariants

- `WorldFoundation` remains the sole physical/geographic authority.
- `TransportNetworkStore` remains the sole 3R physical/legal transportation topology authority.
- `IntersectionControlStore` owns control policy, not road legality.
- Signal state never changes `TurnMovement.allowed` merely because a light is red.
- `topologyRevision` is not a signal clock.
- `intersectionControlRevision` is not a frame counter.
- Default signal generation is deterministic and hierarchy-aware.
- Generated control may be rebuilt; authored semantic state may not be silently rewritten.
- Derived conflict matrices, lane groups, and active phases are not persisted as authority.
- Save V9 remains canonical for this tranche.
- Existing legacy interfaces remain compatibility surfaces, not parallel authorities.
- No merge to `main` occurs until the implementation plan, RED/GREEN work, regression verification, and explicit approval gates are complete.
