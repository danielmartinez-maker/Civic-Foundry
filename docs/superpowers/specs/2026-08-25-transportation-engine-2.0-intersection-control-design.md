# Civic Foundry 2.0 — 3R-B Intersection Control Design

Date: 2026-08-25
Status: Approved design, implementation not started
Branch: `civic-2.0-3r-b-intersection-control`

## Summary

3R-B replaces the live V7 intersection queue/control path with a movement-aware U.S.-style intersection-control engine built on the 3R-A transportation authority.

The runtime model operates on explicit `TurnMovementId`, lane groups, carriageways, and junctions rather than a single undifferentiated node-capacity queue. It supports U.S.-style unsignalized control, fixed-time signals, protected/permissive turning, right-turn-on-red policy, pedestrian phases, arterial coordination, emergency-preemption hooks, transit-priority hooks, and controlled-access freeway semantics.

This is a live cutover, not a parallel shadow engine. `TrafficSystem` will use 3R-B during normal simulation. Persistence therefore advances from Save V7 to Save V8, with deterministic V7→V8 migration for active queued traffic.

The engineering reference baseline is the current FHWA Manual on Uniform Traffic Control Devices (MUTCD), 11th Edition with Revision 1, December 2025. Civic Foundry models traffic-engineering mechanisms that materially affect simulation outcomes; it does not attempt to encode every jurisdiction-specific legal rule or sign-installation detail.

## Locked decisions

- 3R-B replaces live V7 `IntersectionSystem` behavior.
- Save persistence advances to V8.
- V7 saves migrate deterministically to V8.
- The road/control model follows U.S. right-hand-traffic conventions.
- Default control is assigned deterministically from road hierarchy, geometry, demand, and policy, with explicit override support.
- Signalized left turns use protected/permissive operation by default, with protected-only operation where safety/control rules require it.
- Expressways and highways are controlled-access facilities.
- Expressway/highway mainlines do not allow ordinary at-grade STOP/YIELD/signalized intersections.
- Right-turn-on-red is a jurisdiction policy enabled by default in the U.S. ruleset, not a universal hard-coded law.
- Signal coordination and deterministic offsets are part of 3R-B.
- Adaptive signal optimization is deferred; 3R-B exposes the interface it will use later.
- Crashes, parking search, weather effects, dynamic reversible-lane scheduling, and lane-changing microsimulation remain outside 3R-B.

## Current architecture and migration seam

3R-A already provides:

- stable junction IDs;
- stable road-segment IDs;
- directional carriageways;
- explicit lanes;
- derived lane groups;
- explicit turn movements;
- vehicle permissions;
- movement-aware routing topology;
- deterministic V7 physical and graph compatibility projection.

The live traffic stack still assumes:

1. `TrafficSystem` follows V7 `TransportationGraph` edge IDs.
2. `IntersectionSystem` queues vehicles only by incoming edge and releases them from one node-level capacity budget.

3R-B removes assumption 2 immediately. It does not force every live route consumer to migrate to `MovementAwarePathfindingSystem` in the same tranche.

For the cutover, route continuation is resolved deterministically:

`current legacy edge + next legacy edge -> current carriageway + next carriageway -> TurnMovementId`

This compatibility bridge lets live traffic use movement-aware control while route planning remains compatible with current V7 graph consumers. A later 3R tranche can migrate all live routing to native 3R route states.

## Goals

3R-B must make intersection behavior emerge from physical and control semantics rather than a generic node-capacity constant.

The system must:

- queue vehicles for a specific movement and lane-group service path;
- determine physical movement/pedestrian conflicts;
- represent uncontrolled, YIELD, two-way STOP, all-way STOP, signal, merge, diverge, and ramp-terminal control;
- derive deterministic default plans from U.S. hierarchy, geometry, demand, and policy;
- preserve explicit overrides across valid topology/control rebuilds;
- service unsignalized movements using deterministic right-of-way and gap acceptance;
- service signalized movements using explicit phases and clearance intervals;
- support protected, permissive, stop/yield, clearance, and prohibited movement states;
- model pedestrian WALK/change/clearance occupancy as an explicit conflict source;
- support configurable right-turn-on-red;
- coordinate fixed-time signals along arterial corridors;
- expose emergency-preemption and transit-priority requests;
- reject illegal at-grade controlled-access intersections;
- persist authoritative continuation state for deterministic V8 resume;
- migrate V7 queued traffic without dropping, duplicating, or nondeterministically reordering vehicles;
- preserve existing trip completion/failure accounting and save/load determinism.

## Non-goals

3R-B does not implement:

- crash generation or crash blocking;
- parking occupancy/search;
- weather-dependent control;
- dynamic congestion rerouting;
- adaptive/AI signal optimization;
- full NEMA hardware emulation;
- individual detector hardware simulation;
- jurisdiction-by-jurisdiction traffic-code databases;
- sign placement, mast-arm geometry, markings, or signal-head artwork;
- microscopic lane changing;
- freeway weaving beyond explicit merge/diverge eligibility;
- a player-facing intersection-control UI.

Control overrides are exposed as simulation APIs and persisted state so a future UI can use them without changing the architecture.

## U.S. engineering reference baseline

Reference:

- FHWA MUTCD, 11th Edition with Revision 1, December 2025.
- https://mutcd.fhwa.dot.gov/kno_11th_Editionr1.htm
- https://mutcd.fhwa.dot.gov/

The MUTCD is a traffic-control-device standard, not a complete traffic-flow simulation specification. Civic Foundry therefore uses it as a standards baseline for control modes and signal semantics while applying deterministic simulation rules for queue discharge, gap acceptance, conflict occupancy, timing-plan generation, and review cadence.

The ruleset distinguishes:

- national engineering/control semantics;
- simulation defaults;
- configurable jurisdiction policy.

Right-turn-on-red, for example, is a policy flag whose U.S. default is enabled and which may be disabled globally, per junction, or per movement.

## Core architecture

`IntersectionControlSystem` becomes the authoritative live controller. It depends on 3R-A transportation authority and derived lane groups and owns only control/queue state. It does not own road geometry or transportation topology.

### `IntersectionControlTypes.ts`

Public immutable types and stable IDs for:

- control plans;
- planning metrics/state;
- controller runtime state;
- movement service state;
- signal phases;
- pedestrian crossings/runtime state;
- queue entries;
- control overrides;
- coordination groups;
- priority/preemption requests;
- snapshots.

### `ConflictMatrixBuilder.ts`

Pure derived builder for movement and pedestrian conflict relations from junction geometry, carriageways, lanes, and `TurnMovement` definitions.

### `ControlPlanBuilder.ts`

Builds deterministic `JunctionControlPlan` values from:

- road hierarchy;
- facility access class;
- junction leg count;
- approach geometry;
- planning metrics snapshot;
- explicit control overrides;
- U.S. policy configuration.

### `MovementQueueStore.ts`

Authoritative per-movement queue state:

- one queue record per vehicle;
- deterministic ordering;
- movement/lane-group association;
- traveler weight;
- queued tick;
- stop-compliance state;
- partial service accounting;
- pending-release acknowledgement;
- snapshot/restore.

### `UnsignalizedController.ts`

Service eligibility for uncontrolled, YIELD, two-way STOP, all-way STOP, and ramp-terminal STOP/YIELD control.

### `SignalController.ts`

Fixed-time signal execution:

- active phase;
- elapsed phase ticks;
- cycle position;
- protected/permissive state;
- yellow/all-red clearance;
- coordination offset;
- preemption/priority transitions.

### `PedestrianController.ts`

Aggregate pedestrian crossing demand, WALK/change/clearance state, and crosswalk conflict occupancy.

### `PriorityController.ts`

Consumes deterministic emergency-preemption and transit-priority requests without bypassing physical conflict clearance.

### `IntersectionControlSystem.ts`

Orchestrates the above. Live consumers use it to:

- enqueue a vehicle for a movement;
- step controllers;
- retrieve releases;
- acknowledge release;
- remove failed/despawned vehicles;
- inspect state;
- snapshot/restore V8 state.

It must remain an orchestration layer. Geometry, conflict generation, planning, queues, signal execution, and unsignalized priority stay separate.

## Stable IDs

Reuse 3R-A stable IDs wherever possible.

Recommended IDs:

- movement queue key: existing `TurnMovementId`;
- signal phase: `sp:<junctionId>:<ordinal>:<stableMovementSignature>`;
- pedestrian crossing: `pc:<junctionId>:<crossingSignature>`;
- coordination group: `scg:<stableCorridorSignature>`;
- controller plan: `icp:<junctionId>`;
- control override: keyed by `junctionId`.

IDs must not depend on array iteration order.

## Control plan model

Each junction receives exactly one authoritative plan.

```ts
type JunctionControlType =
  | 'uncontrolled'
  | 'yield'
  | 'twoWayStop'
  | 'allWayStop'
  | 'signal'
  | 'merge'
  | 'diverge'
  | 'rampTerminal';
```

```ts
type JunctionControlPlan = Readonly<{
  id: string;
  junctionId: JunctionId;
  controlType: JunctionControlType;
  source: 'automatic' | 'override';
  controlledApproachIds: readonly CarriagewayId[];
  phasePlan?: SignalTimingPlan;
  policy: JunctionControlPolicy;
}>;
```

`JunctionControlPolicy` includes:

- right-turn-on-red policy;
- protected-only movement overrides;
- prohibited permissive movement overrides;
- minimum-stop duration;
- gap-acceptance profile;
- pedestrian service policy;
- emergency-preemption enablement;
- transit-priority enablement.

## Hierarchy-based automatic control assignment

Automatic assignment follows U.S.-style hierarchy and uses deterministic planning metrics.

### Local × local

Default to uncontrolled operation for simple low-demand geometry. Escalate to minor-road YIELD/STOP when hierarchy, sight-distance proxy, geometry, or planning demand justifies control.

### Local × collector / local × arterial

The lower-order approach receives STOP or YIELD by default. The higher-order street retains priority unless signal suitability is met.

### Collector × collector

Default to two-way STOP where one road is the clear priority street. Use all-way STOP only when the deterministic suitability score supports it.

### Collector × arterial / arterial × arterial

Evaluate signal suitability from deterministic inputs such as:

- approach demand;
- major/minor imbalance;
- pedestrian demand;
- left-turn demand;
- speed;
- conflict burden;
- delay;
- crash-history input when available;
- corridor role.

If signal suitability is not met, use major/minor priority control rather than installing a signal automatically.

### Ramp terminals

Ramp-terminal control may be STOP, YIELD, or signal based on demand, geometry, and surface-street conflicts.

### Overrides

Overrides must:

- survive deterministic plan rebuilds while valid;
- be validated against current topology;
- be rejected if illegal for the facility type;
- fall back to automatic control only when structurally impossible after topology change.

## Automatic control review lifecycle

Automatic plans are authoritative infrastructure state between explicit review events. They do **not** change every tick as demand fluctuates.

A control review occurs only when:

- relevant transportation topology changes; or
- a deterministic configured planning-review epoch is reached; or
- an explicit override is added/removed/changed.

At a planning-review epoch, `ControlPlanBuilder` consumes a canonical `ControlPlanningMetricsSnapshot` captured for that tick. The snapshot contains only metrics available to the simulation at that time, such as approach demand, queued delay, pedestrian demand, left-turn demand, speeds, and optional crash-history aggregates.

The control-planning state stores at minimum:

- `lastReviewTick`;
- per-junction previous automatic control type;
- the current canonical planning thresholds/policy revision.

Escalation and de-escalation use separate deterministic thresholds/hysteresis so a junction cannot oscillate between STOP and signal control around one boundary.

A built control plan remains authoritative until the next valid review. Signal phases therefore do not rebuild in response to ordinary per-tick queue fluctuations.

## Controlled-access facility semantics

`expressway` and `highway` are controlled-access mainline road classes.

Mainline rules:

- no ordinary at-grade cross-street turn movement;
- no ordinary STOP control;
- no ordinary YIELD-controlled crossing;
- no ordinary surface-street traffic signal;
- access occurs through explicit merge/diverge or interchange/ramp-terminal structure;
- mainline through movement retains priority over entering ramp traffic unless a future managed-control feature changes it.

The initial implementation may derive controlled-access status from road class rather than introducing a new persisted road-schema field, provided the API leaves room for future explicit access-control attributes.

Invalid combinations fail validation instead of silently degrading to surface-street control.

## Conflict matrix

A movement cannot be released solely because its control state says it may proceed. It must also satisfy physical conflict rules.

`ConflictMatrixBuilder` creates a symmetric per-junction relation over:

- vehicle movements;
- pedestrian crossings.

At minimum it distinguishes:

- crossing conflicts;
- opposing through/left conflicts;
- constrained shared-departure merge conflicts;
- pedestrian crossing conflicts;
- compatible movements.

A movement never conflicts with itself.

For the legacy cardinal grid, classification must be exact and deterministic. The public representation must not preclude future non-cardinal/native geometry.

The matrix is derived and rebuilt only when relevant topology or crossing geometry changes.

## Movement service states

```ts
type MovementServiceState =
  | 'prohibited'
  | 'stop'
  | 'yield'
  | 'permissive'
  | 'protected'
  | 'clearance';
```

Semantics:

- `prohibited`: entry not permitted.
- `stop`: eligibility requires stop compliance plus right-of-way rules.
- `yield`: entry requires an acceptable conflict gap.
- `permissive`: signal/control permits entry after yielding to conflicts.
- `protected`: exclusive/non-conflicting service window subject to downstream capacity and explicitly compatible simultaneous movements.
- `clearance`: transition/clearance state; no new protected service is granted except where the plan explicitly defines continuation.

## Queue model

The live queue unit is the movement, not the node.

```ts
type MovementQueueEntry = Readonly<{
  vehicleId: string;
  movementId: TurnMovementId;
  laneGroupIds: readonly LaneGroupId[];
  travelerWeight: number;
  queuedTick: number;
  priority: 'normal' | 'transit' | 'emergency';
  stoppedSinceTick?: number;
  released?: boolean;
}>;
```

Invariants:

- a vehicle exists in at most one active queue;
- a vehicle is never both queued and pending-released;
- queue order is deterministic;
- emergency priority never bypasses an occupied physical conflict zone;
- weighted service cannot become negative;
- partial service is deterministic;
- releases remain pending until acknowledged;
- repeated stepping in the same tick cannot spend service capacity twice.

Ordinary ordering:

1. control eligibility;
2. right-of-way/arrival rule;
3. queued tick;
4. stable vehicle ID.

Controller-specific emergency/transit policy may precede ordinary ordering, with stable ID as the final deterministic tie-break.

## Capacity and discharge

3R-B removes the live single-node service bucket.

Movement discharge derives from:

- eligible lane groups;
- lane-group capacity;
- movement permission;
- active control state;
- conflicting occupancy;
- pedestrian occupancy;
- downstream service availability.

The initial implementation may use deterministic per-tick fractional capacity derived from lane-group `capacityPerMinute` rather than microscopic headways. This preserves Civic Foundry's weighted-agent model while making service lane/movement specific.

## Unsignalized control

### Uncontrolled

Compatible movements proceed when no conflicting higher-priority occupancy blocks them.

### YIELD

No mandatory stop. A movement proceeds when deterministic gap acceptance finds sufficient conflict-free time.

### Two-way STOP

Minor approaches must complete the configured minimum stop duration before eligibility. Major-street traffic retains priority. Minor movements then use gap acceptance against conflicts.

### All-way STOP

Right-of-way order:

1. completed-stop arrival time;
2. deterministic geometric priority for simultaneous arrivals;
3. stable movement ID;
4. stable vehicle ID.

The geometry rule must be explicit and fully tested for cardinal arrival combinations. Stable IDs are reproducibility tie-breakers, not substitutes for right-of-way logic.

### Gap acceptance

Required gap is a deterministic function of:

- movement kind;
- vehicle class/permission profile;
- conflicting approach speed;
- junction geometry;
- pedestrian occupancy.

No RNG is used for individual acceptance decisions.

## Signal control

3R-B implements deterministic fixed-time plans.

```ts
type SignalTimingPlan = Readonly<{
  cycleTicks: number;
  offsetTicks: number;
  phases: readonly SignalPhase[];
}>;
```

A phase defines:

- protected movement IDs;
- permissive movement IDs;
- pedestrian WALK crossings;
- green/service duration;
- yellow duration;
- all-red duration;
- optional coordination metadata.

### Protected/permissive left turns

Protected/permissive is the normal U.S. default where geometry and conflict rules allow it.

Permissive lefts yield to:

- opposing conflicting through/right traffic;
- active pedestrian occupancy;
- other explicitly conflicting priority movements.

Protected-only operation is selected by the deterministic safety/control profile or explicit override. The representation supports permissive-only, protected-only, protected/permissive, and future variable-by-plan operation.

### Right turns and right-turn-on-red

Right turns may proceed permissively with compatible green service unless prohibited.

Right-turn-on-red requires:

- jurisdiction policy enabled;
- no junction/movement prohibition;
- completed stop;
- no conflicting pedestrian occupancy;
- acceptable vehicle gap;
- downstream service availability.

### Yellow and all-red clearance

Yellow and all-red are explicit runtime intervals. Their durations are derived deterministically from approach speed and junction geometry through a clearance-timing policy and remain fixed within a built plan.

## Pedestrian control

Pedestrian crossings are explicit conflict participants, not a generic delay multiplier.

Runtime crossing states represent:

- DON'T WALK/hold;
- WALK entry;
- pedestrian change interval;
- residual clearance occupancy.

Permissive turns yield to active crossing occupancy. Protected vehicle movements cannot conflict with pedestrian entry/occupancy unless geometry is explicitly non-conflicting.

Clearance timing derives from crossing length and configured walking-speed policy.

3R-B uses aggregate pedestrian demand/occupancy; it does not add full pedestrian agents.

## Signal coordination

Signalized junctions on the same arterial may belong to a `SignalCoordinationGroup` with:

- ordered member junctions;
- common/compatible cycle timing;
- deterministic offsets;
- dominant progression direction;
- plan revision.

The initial coordinator targets deterministic progression in the dominant direction using free-flow travel time between signals. It does not perform online adaptive optimization.

## Emergency preemption and transit priority

```ts
type IntersectionPriorityRequest = Readonly<{
  id: string;
  junctionId: JunctionId;
  movementId: TurnMovementId;
  kind: 'emergencyPreemption' | 'transitPriority';
  requestedTick: number;
  expiresTick: number;
}>;
```

Emergency preemption has precedence over transit priority.

Neither may violate conflict clearance. The controller transitions through required clearance before granting an incompatible requested movement.

Transit priority may extend or advance compatible service only within bounded plan rules.

## Live `TrafficSystem` integration

`TrafficSystem` remains the owner of active vehicle/trip progression.

At the end of a non-terminal edge:

1. resolve current and next legacy edge;
2. map them to 3R carriageways;
3. resolve the explicit `TurnMovement` at the shared junction;
4. derive compatible lane groups;
5. enqueue the vehicle for that movement;
6. keep `currentEdgeIndex` unchanged while queued;
7. increment accumulated delay while queued;
8. on acknowledged release, advance one edge, reset edge progress, resume moving.

If no legal movement exists, the trip fails through the existing failure path. The controller never fabricates a turn.

If topology changes while queued and the movement disappears, the vehicle fails/removes deterministically unless the same route continuation resolves to a valid replacement movement without changing route intent.

`TrafficSystem` no longer detects intersections solely via `graph.outgoingEdges(edge.to).length > 2`; it uses explicit 3R junction/control and route-movement semantics.

## Legacy edge-to-movement resolver

A focused derived compatibility unit maps V7 graph edges to 3R semantics.

```ts
resolveMovement(
  currentEdgeId: string,
  nextEdgeId: string,
  authority: TransportNetworkAuthority,
): ResolvedRouteMovement | undefined
```

It reuses the stable coordinate/ID conventions of `LegacyRoadNetworkAdapter` and `LegacyTransportationGraphAdapter` and never derives identity from array position.

## Revisions

3R-B separates:

- `topologyRevision`: existing 3R-A physical/legal topology revision;
- `controlPlanRevision`: structural control-plan changes;
- `controlRuntimeEpoch`: optional runtime cost epoch for timing/priority changes that affect future route cost without changing movement legality.

Rules:

- topology changes rebuild affected conflicts and plans;
- no-op rebuilds do not inflate revisions;
- control-plan changes do not pretend road topology changed;
- signal phase stepping does not increment structural revisions each tick;
- future dynamic routing may consume control-runtime epochs without topology rebuild.

## Save V8

V8 becomes canonical.

Unlike V7, V8 persists the **canonical built control plans themselves** because plans may depend on planning metrics captured at explicit review epochs. Rebuilding a plan from only the current instantaneous demand after load could produce a different controller than the one that existed when the save was made.

V8 persists at minimum:

- canonical `JunctionControlPlan[]`;
- plan fingerprints/stable IDs;
- control overrides;
- control-planning state including `lastReviewTick` and policy/threshold revision;
- active signal phase index;
- elapsed phase ticks;
- cycle position/offset continuation;
- movement queues;
- queued stop-compliance state;
- pending released vehicle IDs;
- active pedestrian runtime state;
- active priority/preemption requests;
- control-plan revision;
- runtime counters required for deterministic continuation.

Derived data is not persisted:

- conflict matrices;
- lane groups;
- edge-to-movement lookup indexes;
- recomputable analytics.

On hydration:

1. restore transportation topology;
2. validate persisted plans against current junctions, carriageways, movements, facility-access rules, and stable plan fingerprints;
3. rebuild conflict matrices and lane groups;
4. restore controller runtime only after plan validation;
5. restore queues and pending releases;
6. restore planning review state and priority requests.

Hydration fails if a persisted plan cannot be validated against the restored topology. It never silently substitutes a newly generated plan while resuming mid-cycle.

## V7 → V8 migration

V7 persists traffic state and legacy `IntersectionSystem` queues.

Migration preserves every active queued/released vehicle exactly once.

For each V7 queue entry:

1. locate the active traffic vehicle;
2. validate its queued junction;
3. read current and next route edge;
4. resolve those edges to a 3R `TurnMovementId`;
5. derive compatible lane groups;
6. create the V8 movement queue entry preserving traveler weight and queued tick;
7. initialize stop-compliance conservatively from the migrated control type;
8. preserve pending-release semantics so capacity is not charged twice.

Controller migration:

- rebuild 3R authority from restored roads;
- capture a deterministic initial `ControlPlanningMetricsSnapshot` from state actually available in the V7 candidate;
- build canonical initial control plans from hierarchy, geometry, available demand metrics, and U.S. policy;
- do not fabricate historical crash metrics, pedestrian occupancy, or player overrides;
- persist the resulting plans as V8 authority on the next save;
- signal controllers initialize deterministic phase/cycle position from restored simulation tick and coordination offset;
- set `lastReviewTick` to the restored migration tick so automatic plans do not immediately rebuild again;
- pedestrian runtime occupancy starts empty because V7 has no equivalent persisted state.

Migration fails on inconsistent queue references instead of dropping orphaned vehicles.

## Snapshot determinism and restore validation

Canonical ordering:

- control plans by junction ID;
- movement queues by movement ID;
- queue entries by authoritative queue order;
- phases by stable phase ID/order;
- pedestrian crossings by crossing ID;
- priority requests by request ID.

Restore rejects:

- duplicate queued vehicle IDs;
- duplicate pending-release IDs;
- unknown movement IDs;
- unknown lane-group references that cannot be rebuilt;
- invalid phase indices;
- non-finite/negative capacity, weight, or timing values;
- impossible control types for controlled-access facilities;
- plan fingerprints inconsistent with persisted plan contents;
- controller runtime whose phase/plan identity is invalid.

## Error handling

Invalid control topology is a deterministic simulation error, not an implicit fallback.

Examples:

- highway mainline assigned `allWayStop`;
- signal phase with conflicting protected movements;
- persisted queue referencing a missing movement;
- queued vehicle route continuation not matching its movement;
- duplicate vehicle queue membership;
- negative timing;
- override referencing a removed junction;
- crossing referencing missing geometry.

Demand conditions that merely prevent service are not errors; they result in continued queuing.

## Determinism rules

All 3R-B behavior is deterministic for the same:

- simulation state;
- road topology;
- planning metrics snapshot;
- traffic/pedestrian demand;
- overrides;
- policy configuration;
- tick sequence.

No RNG is used for:

- plan selection;
- phase generation;
- offsets;
- all-way-stop tie breaking;
- gap acceptance;
- queue ordering;
- V7→V8 migration.

Stable IDs are final tie-breakers after domain-specific priority rules.

## Performance requirements

- conflict matrices precompute per relevant topology revision;
- movement/lane/carriageway lookups use indexes rather than repeated whole-array scans;
- controller stepping touches active controlled junctions/queues rather than every road cell for every vehicle;
- lane-group capacity lookup is indexed;
- edge-to-movement resolution is indexed;
- snapshot sorting occurs at the snapshot boundary where practical;
- coordination rebuilds only affected corridors;
- automatic control-plan review occurs only at explicit review epochs/topology changes, not every tick.

Acceptance benchmarking includes a dense 10,000-road-cell legacy projection plus a high-intersection queue fixture. Wall-clock results are diagnostics; deterministic structural-operation counts are the primary complexity gate.

## Testing strategy

Implementation follows TDD.

### Conflict matrix

Test:

- opposing through compatibility;
- opposing left/through conflict;
- crossing through conflict;
- compatible right turns;
- shared-departure merge conflict;
- pedestrian conflict;
- symmetry;
- stable ordering.

### Control planning

Test:

- local/local automatic control;
- local/collector priority;
- local/arterial priority;
- collector/collector two-way STOP default;
- all-way STOP escalation;
- arterial signal escalation;
- review cadence prevents per-tick replanning;
- hysteresis prevents threshold flapping;
- override persistence;
- invalid controlled-access override rejection;
- expressway/highway merge/diverge semantics.

### Unsignalized controller

Test:

- mandatory STOP dwell;
- YIELD with clear gap;
- YIELD blocked by conflict;
- major-street priority;
- all-way STOP arrival order;
- deterministic simultaneous arrival;
- partial weighted service;
- same-tick double-spend protection.

### Signal controller

Test:

- fixed phase progression;
- protected through;
- protected/permissive left;
- protected-only left;
- permissive yielding;
- yellow;
- all-red;
- right turn on red allowed/prohibited;
- pedestrian blocking;
- coordination offsets;
- emergency-preemption transition;
- bounded transit-priority extension/advance.

### Traffic integration

Test:

- legacy current+next edge resolves correct movement;
- live traffic queues by movement;
- queued vehicle remains on current edge;
- release advances exactly one edge;
- pending release cannot spend capacity twice;
- invalid route movement fails cleanly;
- topology invalidation cleans queued vehicles deterministically;
- non-controlled simple continuation remains efficient;
- trip outcome accounting remains intact.

### Persistence

Test:

- V8 round trip;
- canonical control-plan round trip;
- active signal mid-phase round trip;
- queued STOP vehicle round trip;
- pending release round trip;
- planning-review state round trip;
- priority request round trip;
- deterministic snapshot equality;
- invalid duplicate queue rejection;
- invalid plan/controller rejection;
- V7→V8 queued migration;
- V7 pending-release migration;
- V7 no-queue migration;
- repeated migration/hydration determinism.

### Regression

Full existing suite remains green, including:

- 3R-A semantics;
- V7 historical load support;
- V5/V6 migration support;
- browser smoke;
- isometric smoke;
- build/typecheck/lint/asset validation.

V7 remains a supported legacy load format after V8 becomes canonical.

## Acceptance criteria

3R-B is complete only when:

- `IntersectionControlSystem` is the live traffic controller;
- legacy node-level generic capacity release is no longer the live decision mechanism;
- vehicles queue for explicit `TurnMovementId` values;
- conflicts are explicit/tested;
- lane-group capacity contributes to service;
- U.S.-style STOP/YIELD/all-way STOP works;
- fixed-time signals work;
- protected/permissive and protected-only lefts work;
- right-turn-on-red is configurable/operational;
- pedestrian WALK/change/clearance affects turns;
- coordination offsets work;
- emergency-preemption and transit-priority request hooks work;
- expressway/highway mainlines reject ordinary at-grade control;
- automatic hierarchy-based planning is deterministic and non-flapping;
- explicit overrides survive valid rebuilds;
- Save V8 is canonical;
- canonical plans persist and restore exactly;
- V7 saves migrate deterministically;
- active queued/released traffic is preserved exactly once through migration;
- no trip is silently rerouted merely to satisfy control mismatch;
- structural performance tests show bounded indexed behavior;
- full CI/browser/visual smoke passes.

## Recommended source layout

`src/simulation/transportation/`

- `IntersectionControlTypes.ts`
- `ConflictMatrixBuilder.ts`
- `ControlPlanBuilder.ts`
- `MovementQueueStore.ts`
- `UnsignalizedController.ts`
- `SignalController.ts`
- `PedestrianController.ts`
- `PriorityController.ts`
- `LegacyRouteMovementResolver.ts`
- `IntersectionControlSystem.ts`

Existing files likely touched:

- `TrafficSystem.ts`;
- save schema/serializer/hydrator modules;
- simulation-core wiring;
- `docs/SAVE_FORMAT.md`;
- `docs/ARCHITECTURE.md` and/or `docs/SIMULATION.md`.

Exact persistence filenames may follow the repository's existing structure, but these responsibility boundaries remain fixed.

## Risks and mitigations

### Live cutover changes throughput materially

Mitigate with deterministic baseline fixtures, before/after throughput diagnostics, capacity-conservation tests, and controller tests before the TrafficSystem cutover.

### V7 queued vehicles become orphaned

Mitigate with route-derived movement resolution, one-to-one vehicle validation, hydration failure on inconsistent references, and pending-release migration fixtures.

### Conflict geometry becomes tied to the cardinal grid

Keep geometry behind `ConflictMatrixBuilder`; treat cardinal classification as the initial exact implementation, not the public API.

### Control plans flap with demand

Plans change only at explicit review epochs/topology changes and use deterministic hysteresis. Canonical built plans persist in V8.

### `IntersectionControlSystem` becomes monolithic

Keep queue storage, signal execution, unsignalized priority, pedestrian control, conflict building, planning, and priority logic in separate modules; retain architecture-size warnings.

### Standards fidelity becomes regulatory overengineering

Encode traffic-flow mechanisms that affect simulation outcomes, keep legal variations configurable, and do not simulate every device-installation detail.

## Future extension seams

3R-B leaves interfaces for:

- adaptive signal optimization;
- control-delay-aware dynamic route costs;
- crash-induced movement closures;
- parking-generated turn demand;
- dedicated transit lanes/queue jumps;
- reversible lanes;
- freeway ramp metering;
- non-cardinal/native geometry;
- player intersection-editing UI;
- jurisdiction presets beyond the default U.S. ruleset.

Future features must express changes through topology, control plans, policy, or priority requests. They may not bypass 3R-B control authority.

## Final architectural principle

A vehicle crosses a junction because:

- its route names a legal movement;
- that movement has usable lanes;
- the U.S.-style control plan permits or conditionally permits it;
- conflicts and pedestrians allow it;
- the movement has discharge capacity;
- required stop, phase, and clearance rules are satisfied.

That chain becomes the sole live intersection authority for Civic Foundry 2.0.