# Civic Foundry 2.0 — 3R-B Intersection Control Design

Date: 2026-08-25
Status: Approved design, implementation not started
Branch: `civic-2.0-3r-b-intersection-control`

## Summary

3R-B replaces the live V7 intersection queue/control path with a movement-aware U.S.-style intersection-control engine built on the 3R-A transportation authority.

The new runtime model operates on explicit `TurnMovementId`, lane groups, carriageways, and junctions rather than a single undifferentiated node-capacity queue. It supports U.S.-style unsignalized control, fixed-time traffic signals, protected/permissive turning, right-turn-on-red policy, pedestrian phases, arterial coordination, emergency preemption hooks, transit-priority hooks, and controlled-access freeway semantics.

This is a live cutover, not a parallel shadow engine. `TrafficSystem` will use the 3R-B controller during normal simulation. Persistence therefore advances from Save V7 to Save V8, with deterministic V7→V8 migration for active queued traffic.

The engineering reference baseline is the current FHWA Manual on Uniform Traffic Control Devices (MUTCD), 11th Edition with Revision 1, December 2025. Civic Foundry models the traffic-engineering mechanisms that materially affect simulation outcomes; it does not attempt to encode every jurisdiction-specific legal rule or sign-installation detail.

## Locked decisions

The following design decisions are approved and are not implementation-time choices:

- 3R-B replaces the live V7 `IntersectionSystem` behavior.
- Save persistence advances to V8.
- V7 saves migrate deterministically to V8.
- The road/control model follows U.S. right-hand-traffic conventions.
- Default intersection control is assigned deterministically from road hierarchy, geometry, and demand, with explicit override support.
- Signalized left turns use protected/permissive operation by default, with protected-only operation where conflict/speed/visibility rules require it.
- Expressways and highways are controlled-access facilities.
- Expressway/highway mainlines do not allow ordinary at-grade STOP/YIELD/signalized intersections.
- Right-turn-on-red is represented as a jurisdiction policy enabled by default in the U.S. ruleset, not as a universal hard-coded law.
- Signal coordination and deterministic offsets are part of 3R-B.
- Adaptive signal optimization is deferred; 3R-B exposes the interface it will use later.
- Crashes, parking search, weather effects, dynamic reversible-lane scheduling, and lane-changing microsimulation remain outside 3R-B.

## Current architecture and migration seam

3R-A already provides the authoritative transportation semantics required by 3R-B:

- stable junction IDs;
- stable road-segment IDs;
- directional carriageways;
- explicit lanes;
- derived lane groups;
- explicit turn movements;
- vehicle permissions;
- movement-aware routing topology;
- deterministic V7 physical and graph compatibility projection.

The existing live traffic stack still has two legacy assumptions:

1. `TrafficSystem` follows V7 `TransportationGraph` edge IDs.
2. `IntersectionSystem` queues vehicles only by incoming edge and releases them from a single node-level capacity budget.

3R-B removes assumption 2 immediately. It does not require a simultaneous migration of every live route consumer to `MovementAwarePathfindingSystem`.

For the live cutover, legacy route continuation is resolved deterministically at a junction:

`current legacy edge + next legacy edge -> current carriageway + next carriageway -> TurnMovementId`

This bridge is temporary compatibility infrastructure. It allows traffic to use movement-aware intersection control while route planning remains compatible with current V7 graph consumers. A later 3R tranche may migrate all live routing to native 3R route states.

## Goals

3R-B must make intersection behavior emerge from physical and control semantics rather than a generic node-capacity constant.

The system must:

- queue vehicles for a specific movement and lane-group service path;
- determine which movements conflict physically;
- represent uncontrolled, YIELD, STOP, all-way STOP, signal, merge, diverge, and ramp-terminal control;
- derive a deterministic default control plan from U.S. road hierarchy and geometry;
- preserve explicit player/system overrides across topology rebuilds when still valid;
- service unsignalized movements using deterministic right-of-way and gap acceptance;
- service signalized movements using explicit phases and clearance intervals;
- support protected, permissive, and prohibited turn states;
- model pedestrian WALK/change/clearance occupancy as an explicit source of vehicle conflicts;
- support right-turn-on-red under configurable jurisdiction policy;
- coordinate fixed-time signals along arterial corridors;
- expose emergency preemption and transit-priority requests without implementing a future adaptive optimizer;
- reject illegal at-grade controlled-access intersections;
- persist all authoritative continuation state required for deterministic Save V8 resume;
- migrate existing V7 queued traffic without dropping, duplicating, or reordering vehicles nondeterministically;
- preserve existing trip completion/failure accounting and save/load determinism.

## Non-goals

3R-B does not implement:

- crash generation or crash blocking;
- parking occupancy or parking search;
- weather-dependent intersection behavior;
- dynamic congestion rerouting;
- adaptive/AI signal-plan optimization;
- full NEMA hardware emulation;
- detector hardware simulation at individual loop/camera level;
- jurisdiction-by-jurisdiction traffic code databases;
- sign placement, mast-arm geometry, pavement-marking rendering, or signal-head artwork;
- microscopic lane changing;
- freeway weaving models beyond explicit merge/diverge control eligibility;
- a player-facing intersection-control UI.

Control overrides are exposed as simulation APIs and persisted state so a future UI can use them without changing the control architecture.

## U.S. engineering reference baseline

The reference is:

- FHWA MUTCD, 11th Edition with Revision 1, December 2025.
- Current-edition page: https://mutcd.fhwa.dot.gov/kno_11th_Editionr1.htm
- FHWA MUTCD portal: https://mutcd.fhwa.dot.gov/

The MUTCD is a traffic-control-device standard, not a full traffic-flow simulation specification. Civic Foundry therefore uses it as a standards baseline for control modes and signal semantics while applying deterministic simulation rules for queue discharge, gap acceptance, conflict occupancy, and timing-plan generation.

The ruleset must distinguish between:

- national engineering/control semantics;
- simulation defaults;
- configurable jurisdiction policy.

For example, right-turn-on-red is not encoded as an unconditional movement entitlement. It is a policy flag whose default is enabled for the U.S. ruleset and which may be disabled globally or at a specific junction/movement.

## Core architecture

`IntersectionControlSystem` becomes the authoritative live intersection controller.

It depends on the 3R-A transportation authority and derived lane groups, and owns only control/queue state. It must not become the owner of road geometry or transportation topology.

Recommended component boundaries:

### `IntersectionControlTypes.ts`

Owns public immutable types and stable IDs for:

- control plans;
- controller state;
- movement service state;
- phase definitions;
- phase runtime state;
- pedestrian crossings and pedestrian phase state;
- queue entries;
- control overrides;
- coordination groups;
- priority/preemption requests;
- controller snapshot state.

### `ConflictMatrixBuilder.ts`

Builds deterministic movement and pedestrian conflict relationships from junction geometry, carriageways, lanes, and `TurnMovement` definitions.

It is pure derived state and is not persisted.

### `ControlPlanBuilder.ts`

Builds default `JunctionControlPlan` values from:

- road hierarchy;
- facility access class;
- junction leg count;
- approach geometry;
- traffic demand metrics;
- pedestrian demand metrics;
- crash-history input when available;
- explicit control overrides.

The builder must be deterministic for the same topology, metrics, policy, and overrides.

### `MovementQueueStore.ts`

Owns authoritative per-movement queues.

It is responsible for:

- one active queue record per vehicle;
- queue ordering;
- movement/lane-group association;
- traveler weight;
- queued tick;
- stop-compliance state;
- partial service accounting where weighted vehicles consume fractional capacity;
- released-but-not-yet-acknowledged state;
- snapshot and restore.

### `UnsignalizedController.ts`

Determines service eligibility for:

- uncontrolled movements;
- YIELD-controlled movements;
- two-way STOP;
- all-way STOP;
- ramp-terminal STOP/YIELD control.

It uses conflict occupancy and deterministic gap acceptance.

### `SignalController.ts`

Owns fixed-time signal execution:

- active phase;
- elapsed phase ticks;
- cycle position;
- protected/permissive service state;
- yellow interval;
- all-red interval;
- phase change;
- coordination offset;
- preemption/priority transition hooks.

The signal controller executes a plan; it does not decide road topology.

### `PedestrianController.ts`

Owns pedestrian crossing service/occupancy state:

- WALK entry interval;
- pedestrian change interval;
- clearance occupancy;
- crossing demand;
- conflicts with vehicle movements.

### `PriorityController.ts`

Consumes deterministic requests for:

- emergency preemption;
- transit signal priority.

3R-B implements the request and transition contract. It does not implement future citywide adaptive optimization.

### `IntersectionControlSystem.ts`

Coordinates the above units for the live simulation.

It is the single runtime API used by traffic consumers to:

- enqueue a vehicle for a movement;
- step controllers;
- retrieve released vehicles;
- acknowledge a release;
- remove failed/despawned vehicles;
- inspect queue/controller state;
- snapshot/restore V8 state.

It must remain orchestration-focused. Geometry, conflict generation, plan construction, queue storage, and signal execution stay in separate files.

## Stable IDs

3R-B must reuse 3R-A stable IDs whenever possible.

Recommended IDs:

- movement queue key: existing `TurnMovementId`;
- signal phase: `sp:<junctionId>:<ordinal>:<stableMovementSignature>`;
- pedestrian crossing: `pc:<junctionId>:<crossingSignature>`;
- coordination group: `scg:<stableCorridorSignature>`;
- controller plan: `icp:<junctionId>`;
- control override: keyed directly by `junctionId`.

IDs must not depend on array iteration order.

## Control plan model

Each junction receives exactly one control plan.

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

A plan contains at minimum:

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

`JunctionControlPolicy` contains configuration that affects legality/service without changing road topology, including:

- right-turn-on-red enabled/disabled;
- protected-only movement overrides;
- prohibited permissive movement overrides;
- minimum-stop duration policy;
- gap-acceptance profile;
- pedestrian service policy;
- emergency preemption enabled/disabled;
- transit priority enabled/disabled.

## Hierarchy-based automatic control assignment

Automatic assignment follows U.S.-style hierarchy and is deterministic.

The builder does not blindly signal intersections based on road class alone. It combines hierarchy and demand/warrant-like inputs.

### Local × local

Default to uncontrolled operation when geometry and demand remain simple.

Escalate to minor-road YIELD/STOP where hierarchy, sight-distance proxy, approach geometry, or traffic demand warrants control.

### Local × collector / local × arterial

The lower-order approach receives STOP or YIELD control by default.

The higher-order road retains priority unless a signal plan is warranted.

### Collector × collector

Default to two-way STOP where one road can be identified as the priority street.

Use all-way STOP only when a deterministic warrant score supports it. All-way STOP must not be the default traffic-calming behavior.

### Collector × arterial / arterial × arterial

Evaluate signal suitability using deterministic inputs such as:

- approach demand;
- major/minor street imbalance;
- pedestrian demand;
- left-turn demand;
- speed;
- conflict burden;
- delay;
- crash-history signal when available;
- corridor role.

If signal criteria are not satisfied, use major/minor street priority control rather than installing a signal automatically.

### Ramp terminals

Ramp-terminal control may be STOP, YIELD, or signalized depending on demand, geometry, and conflicting surface-street traffic.

### Overrides

An explicit override may request a supported control type or policy change.

Overrides must:

- survive deterministic plan rebuilds;
- be validated against current topology;
- be rejected if illegal for the facility type;
- fall back to automatic control only when the override becomes structurally impossible after topology change.

## Controlled-access facility semantics

`expressway` and `highway` road classes are controlled-access mainline facilities.

Mainline rules:

- no ordinary at-grade cross-street turn movement;
- no ordinary STOP control;
- no ordinary YIELD-controlled crossing of the mainline;
- no ordinary surface-street traffic signal on the mainline;
- access occurs through explicit merge/diverge or interchange/ramp-terminal movement structure;
- mainline through movement retains priority over entering ramp traffic unless a future managed-control feature explicitly changes it.

The implementation may derive controlled-access status initially from road class rather than introducing a new persisted road-schema field, provided the API leaves room for a future explicit access-control attribute.

Invalid combinations fail validation rather than silently degrading to a surface-street intersection.

## Conflict matrix

A movement may not be released solely because its signal/control state says "go." It must also satisfy physical conflict rules.

`ConflictMatrixBuilder` creates a symmetric conflict relation for each junction.

Conflict participants include:

- vehicle turn movements;
- pedestrian crossings.

Vehicle movement conflicts are derived from approach/departure geometry and movement paths through the junction conflict area.

At minimum the matrix distinguishes:

- crossing conflicts;
- opposing through/left conflicts;
- merge conflicts into the same constrained departure lane group;
- pedestrian crossing conflicts;
- non-conflicting compatible movements.

The conflict matrix is deterministic derived state and is rebuilt when transportation topology changes.

A movement never conflicts with itself.

For the cardinal legacy grid, conflict classification must be exact and deterministic. The representation must not preclude future non-cardinal/native geometry.

## Movement service states

Each movement has an instantaneous service state:

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

- `prohibited`: entry is not permitted.
- `stop`: the movement may become eligible only after stop-compliance and right-of-way rules are satisfied.
- `yield`: the movement may enter only with an acceptable conflict gap.
- `permissive`: signal/control permits entry after yielding to conflicting traffic and pedestrians.
- `protected`: the controller provides an exclusive/non-conflicting service window subject only to downstream capacity and explicit allowed simultaneous movements.
- `clearance`: the movement is clearing or held during a yellow/all-red transition; no new protected entry is granted unless the plan explicitly allows continuation under the defined transition semantics.

## Queue model

The live queue unit becomes the movement, not the node.

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

Queue invariants:

- a vehicle may exist in at most one active intersection queue;
- a vehicle may not be both queued and pending-released;
- queue order is deterministic;
- emergency priority may affect controller preemption but does not permit teleporting through an occupied physical conflict zone;
- weighted service cannot become negative;
- partial weighted service is deterministic;
- a release remains pending until the owning traffic system acknowledges it;
- repeated controller stepping in the same tick cannot spend the same service capacity twice.

Queue ordering for ordinary vehicles is:

1. control eligibility;
2. right-of-way/arrival rule;
3. queued tick;
4. stable vehicle ID.

Controller-specific rules may insert emergency/transit priority before ordinary ordering, but stable ID remains the final deterministic tie-break.

## Capacity and discharge

3R-B removes the live assumption that an intersection has one generic service-rate bucket.

Available movement discharge is derived from:

- eligible lane groups;
- lane-group capacity;
- movement permission;
- active signal/control state;
- conflicting occupancy;
- pedestrian occupancy;
- downstream movement availability.

The first implementation may use deterministic per-tick fractional capacity derived from lane-group `capacityPerMinute` rather than microscopic car-following headways.

This preserves Civic Foundry's weighted-agent simulation model while making capacity lane/movement specific.

## Unsignalized control

### Uncontrolled

Compatible movements may proceed when no conflicting higher-priority occupancy blocks them.

### YIELD

A queued movement does not need a mandatory stop. It may proceed when deterministic gap acceptance says the conflict window is sufficient.

### Two-way STOP

STOP-controlled minor approaches must complete the configured minimum stop duration before becoming eligible.

Major-street movement retains priority.

Minor movements then use gap acceptance against major-street and other conflicting occupancy.

### All-way STOP

Right-of-way order is:

1. completed-stop arrival time;
2. deterministic geometric priority for simultaneous arrivals;
3. stable movement ID;
4. stable vehicle ID.

The geometry rule must be explicit and tested for every cardinal arrival combination. Stable IDs are reproducibility tie-breakers, not substitutes for right-of-way logic.

### Gap acceptance

Gap acceptance is deterministic.

Required gap is a function of:

- movement kind;
- vehicle class/permission profile;
- conflicting approach speed;
- junction geometry;
- pedestrian occupancy.

No RNG is used for individual acceptance decisions in 3R-B.

## Signal control

3R-B implements fixed-time signal plans with deterministic phase execution.

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

The normal U.S. signalized default is protected/permissive operation where geometry and conflict rules allow it.

Permissive left turns yield to:

- opposing through/right traffic that conflicts;
- active pedestrian occupancy;
- any other explicitly conflicting movement with priority.

Protected-only operation is selected where the plan builder's deterministic safety profile indicates it is required, including high-speed/high-conflict conditions or an explicit override.

The runtime representation supports:

- permissive only;
- protected only;
- protected/permissive;
- future variable-by-plan operation.

### Right turns

Right turns may proceed with compatible green service as permissive movements unless prohibited.

Right-turn-on-red requires all of:

- U.S. jurisdiction policy enabled;
- no junction/movement prohibition;
- completed stop;
- no conflicting pedestrian occupancy;
- acceptable vehicle conflict gap;
- downstream service availability.

### Yellow and all-red clearance

Yellow and all-red intervals are explicit controller states.

Their configured duration is derived deterministically from approach speed and junction geometry through a clearance-timing policy.

Timing must not be recomputed every tick. It is part of a built signal plan and remains stable until the plan is rebuilt.

## Pedestrian control

Pedestrian crossings are explicit conflict participants, not a generic delay multiplier.

A crossing has runtime states sufficient to represent:

- DON'T WALK/hold;
- WALK entry;
- pedestrian change interval;
- residual clearance occupancy.

Vehicles making permissive turns must yield to active pedestrian crossing occupancy.

Protected vehicle movements that conflict with a pedestrian crossing cannot be active simultaneously with pedestrian entry/occupancy unless the plan explicitly defines a non-conflicting geometry.

Pedestrian clearance timing is derived from crossing length and configured walking-speed policy.

3R-B does not add a full pedestrian agent simulation; aggregate crossing demand and occupancy are sufficient for this tranche.

## Signal coordination

Signalized junctions on the same arterial corridor may belong to a `SignalCoordinationGroup`.

A group contains:

- ordered member junctions;
- common or compatible cycle timing;
- deterministic offsets;
- dominant progression direction;
- plan revision.

The initial coordination algorithm optimizes deterministic progression for the dominant corridor direction using free-flow travel time between signals.

It does not perform online adaptive optimization.

Topology or timing-plan changes rebuild affected coordination groups deterministically.

## Emergency preemption and transit priority

The system exposes explicit requests:

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

Neither request can violate physical conflict clearance. The controller must transition through required yellow/all-red or equivalent safe-clearance states before granting an incompatible requested movement.

Transit priority may extend or advance compatible service within bounded plan rules.

The exact adaptive optimization strategy is deferred, but this request contract is authoritative in 3R-B so future emergency/transit systems do not need to bypass the controller.

## Live `TrafficSystem` integration

`TrafficSystem` remains the owner of active vehicle/trip progression in 3R-B.

At the end of a non-terminal edge:

1. resolve the current edge and next edge;
2. resolve those legacy graph edges to 3R carriageways;
3. resolve the corresponding explicit `TurnMovement` at the shared junction;
4. derive compatible lane group IDs;
5. enqueue the vehicle in `IntersectionControlSystem` for that movement;
6. keep the vehicle's `currentEdgeIndex` unchanged while queued;
7. increment accumulated delay while queued;
8. when released and acknowledged, advance `currentEdgeIndex`, reset edge progress, and resume moving.

If no legal movement exists for the route continuation, the trip fails through the existing traffic failure path rather than fabricating a movement.

If topology changes while a vehicle is queued and its movement disappears, the vehicle is failed/removed deterministically unless a valid same-route movement can be resolved without changing route intent.

`TrafficSystem` must no longer detect an intersection using only `graph.outgoingEdges(edge.to).length > 2`. Control is based on the 3R junction/control plan and explicit route movement.

## Legacy edge-to-movement resolver

A focused compatibility unit maps live V7 graph edges to 3R semantics.

Recommended API:

```ts
resolveMovement(
  currentEdgeId: string,
  nextEdgeId: string,
  authority: TransportNetworkAuthority,
): ResolvedRouteMovement | undefined
```

The resolver must reuse the same legacy coordinate/stable-ID conventions used by `LegacyRoadNetworkAdapter` and `LegacyTransportationGraphAdapter`.

It must not reverse-engineer movement identity through array position.

The resolver is derived compatibility infrastructure and is not persisted.

## Topology and control revisions

3R-B introduces explicit revision separation:

- `topologyRevision`: existing 3R-A physical/legal topology revision;
- `controlPlanRevision`: increments when automatic/override control plans change;
- `controlRuntimeEpoch`: optional monotonic runtime epoch for timing/priority changes that affect route cost but not movement legality.

Rules:

- topology changes rebuild conflict matrices and affected control plans;
- no-op rebuilds do not inflate revisions;
- control-plan changes do not pretend the road topology changed;
- signal phase stepping does not increment structural revisions every tick;
- future dynamic routing may consume control-runtime cost epochs without forcing topology rebuilds.

## Save V8

V8 becomes the canonical save envelope for 3R-B.

The V8 intersection-control state persists authoritative continuation data that cannot be safely reconstructed after load.

At minimum V8 persists:

- control overrides;
- automatic/control plan identity or sufficient policy state to validate deterministic rebuild;
- active signal phase index;
- elapsed phase ticks;
- cycle position/offset continuation where required;
- movement queues;
- queued stop-compliance state;
- pending released vehicle IDs;
- active pedestrian crossing runtime state;
- active priority/preemption requests;
- control-plan revision;
- any runtime counters required for deterministic continuation.

Derived data is not persisted:

- conflict matrices;
- lane groups;
- edge-to-movement lookup indexes;
- deterministic default control plans when no continuation state depends on preserving a prior built version;
- analytics summaries.

If a rebuilt deterministic plan disagrees with persisted controller continuation in a way that cannot be validated, hydration fails rather than silently resuming under a different phase definition.

## V7 → V8 migration

V7 persists traffic state and legacy `IntersectionSystem` queues.

Migration must preserve every active vehicle exactly once.

For each V7 intersection queue entry:

1. locate the active traffic vehicle by `vehicleId`;
2. validate that the vehicle is queued at the same junction represented by the V7 queue;
3. read its current edge and next edge from the persisted route;
4. resolve those edges to a 3R `TurnMovementId` using the deterministic legacy edge-to-movement resolver;
5. derive the movement's compatible lane groups;
6. create the V8 movement queue entry preserving traveler weight and queued tick;
7. initialize stop-compliance state conservatively from the migrated control type;
8. preserve pending-released semantics so an already released V7 vehicle is not charged capacity twice.

Migration of controller state:

- rebuild 3R physical authority from restored roads;
- build deterministic default control plans;
- apply no fabricated historical player overrides;
- signal controllers start from deterministic phase/cycle position derived from restored simulation tick and coordination offset;
- unsignalized controllers have no hidden historical state beyond migrated queue/stop state;
- pedestrian runtime occupancy starts empty unless V7 has an explicit persisted equivalent, which it currently does not.

Migration fails on inconsistent queue references instead of dropping orphaned vehicles silently.

## Snapshot determinism

V8 snapshots must have canonical stable ordering.

Required ordering:

- junction/control-plan records by junction ID;
- movement queues by movement ID;
- queue entries by authoritative queue order;
- phases by stable phase ID/order;
- pedestrian crossings by crossing ID;
- priority requests by request ID.

Restore must reject:

- duplicate queued vehicle IDs;
- duplicate pending-released IDs;
- unknown movement IDs;
- unknown lane-group references that cannot be rebuilt;
- invalid phase indices;
- non-finite or negative capacity/weight/timing values;
- impossible control types for controlled-access facilities;
- controller state whose plan identity cannot be validated.

## Error handling

Invalid control topology is a deterministic simulation error, not an implicit fallback.

Examples that must throw or fail validation:

- a highway mainline junction assigned `allWayStop`;
- a signal phase containing two protected movements that conflict;
- a persisted queue referencing a nonexistent movement;
- a queued vehicle whose live route continuation does not match its movement;
- duplicate vehicle queue membership;
- negative signal interval timing;
- an override that references a removed junction;
- a pedestrian crossing that references missing conflict geometry.

Runtime demand conditions that merely prevent service are not errors; they result in continued queuing.

## Determinism rules

All 3R-B behavior must be deterministic for the same:

- simulation state;
- road topology;
- traffic demand;
- pedestrian demand;
- control overrides;
- policy configuration;
- tick sequence.

No RNG is used for:

- control-plan selection;
- signal phase generation;
- signal offsets;
- all-way-stop tie breaking;
- gap acceptance;
- queue ordering;
- V7→V8 migration.

Stable IDs are always the final tie-breaker after domain-specific priority rules.

## Performance requirements

3R-B must remain bounded for metropolitan networks.

Design requirements:

- conflict matrices are precomputed per topology/control-plan revision, not recomputed per vehicle per tick;
- movement/lane/carriageway indexes are maps, not repeated whole-array scans;
- controller stepping touches active controlled junctions/queues rather than scanning every road cell for every vehicle;
- lane-group capacity lookup is indexed;
- legacy edge-to-movement resolution is indexed by edge/carriageway identity;
- snapshot output sorts only at the snapshot boundary where practical;
- signal coordination rebuilds only affected corridors.

Acceptance benchmarking must include a dense 10,000-road-cell legacy projection and a high-intersection queue fixture. Wall-clock values are diagnostic, while deterministic structural-operation counts are the primary complexity gate.

## Testing strategy

Implementation follows TDD.

### Conflict matrix tests

Cover:

- opposing through compatibility;
- opposing left/through conflict;
- crossing through conflict;
- compatible right turns;
- shared departure merge conflict;
- pedestrian conflict;
- symmetry;
- stable deterministic ordering.

### Control-plan tests

Cover:

- local/local automatic control;
- local/collector priority;
- local/arterial priority;
- collector/collector two-way STOP default;
- all-way STOP warrant escalation;
- arterial signal warrant escalation;
- override persistence;
- invalid controlled-access override rejection;
- expressway/highway mainline merge/diverge semantics.

### Unsignalized-controller tests

Cover:

- mandatory STOP dwell;
- YIELD with clear gap;
- YIELD blocked by conflict;
- major-street priority;
- all-way STOP arrival ordering;
- deterministic simultaneous-arrival tie resolution;
- partial weighted service;
- same-tick double-spend protection.

### Signal-controller tests

Cover:

- fixed phase progression;
- protected through service;
- protected/permissive left turn;
- protected-only left turn;
- permissive left yielding;
- yellow interval;
- all-red interval;
- right turn on red allowed;
- right turn on red prohibited;
- pedestrian conflict blocking;
- coordination offsets;
- emergency preemption transition;
- transit-priority bounded extension/advance.

### Traffic integration tests

Cover:

- current edge + next edge resolves correct movement;
- live traffic queues by movement;
- vehicle remains on current edge while queued;
- release advances exactly one edge;
- pending release cannot spend capacity twice;
- invalid route movement fails trip cleanly;
- topology invalidation cleans queued vehicles deterministically;
- ordinary non-controlled degree-2 continuation remains efficient;
- existing trip outcome accounting remains intact.

### Persistence tests

Cover:

- V8 round trip;
- active signal mid-phase round trip;
- queued STOP vehicle round trip;
- pending released vehicle round trip;
- priority request round trip;
- deterministic snapshot equality;
- invalid duplicate queue rejection;
- invalid plan/controller state rejection;
- V7→V8 migration with queued vehicles;
- V7 pending-release migration;
- V7 save with no queues;
- migration determinism over repeated hydrate/serialize cycles.

### Regression tests

The full existing test suite must remain green, including:

- 3R-A transport semantics;
- V7 historical fixture loading;
- V5/V6 migration support;
- browser smoke;
- isometric smoke;
- build/typecheck/lint/asset validation.

V7 remains a supported legacy load format after V8 becomes canonical.

## Acceptance criteria

3R-B is complete only when all of the following are true:

- `IntersectionControlSystem` is the live traffic intersection controller.
- Legacy node-level generic capacity release is no longer the live decision mechanism.
- Vehicles queue for explicit `TurnMovementId` values.
- Movement conflicts are explicit and tested.
- Lane-group capacity contributes to service.
- U.S.-style STOP/YIELD/all-way STOP logic is operational.
- Fixed-time signals are operational.
- Protected/permissive left turns are operational.
- Protected-only left turns are representable and operational.
- Right-turn-on-red policy is configurable and operational.
- Pedestrian WALK/change/clearance occupancy affects vehicle turns.
- Signal coordination offsets are operational.
- Emergency preemption and transit-priority request hooks are operational.
- Expressway/highway mainlines reject ordinary at-grade control.
- Automatic hierarchy-based control assignment is deterministic.
- Explicit overrides survive valid rebuilds.
- Save V8 is canonical.
- V7 saves migrate deterministically to V8.
- Existing active queued traffic is preserved exactly once through migration.
- No current traffic trip is silently rerouted merely to satisfy an intersection control mismatch.
- Structural performance tests show indexed/bounded control lookup behavior.
- Full CI, browser smoke, and visual smoke pass.

## Recommended source layout

New/expanded transportation-control files should remain focused and generally below the existing architecture-warning threshold:

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

- `TrafficSystem.ts`
- save schema/serializer/hydrator modules;
- simulation-core wiring that instantiates/restores intersection control;
- `docs/SAVE_FORMAT.md`;
- `docs/ARCHITECTURE.md` and/or `docs/SIMULATION.md` where the live intersection authority is documented.

The implementation plan may adjust exact filenames to match the repository's persistence-module structure, but must preserve these responsibility boundaries.

## Risks and mitigations

### Risk: live cutover changes traffic throughput materially

Mitigation:

- deterministic baseline fixtures;
- before/after throughput diagnostics;
- explicit capacity conservation tests;
- signal/STOP behavior tests before TrafficSystem cutover.

### Risk: V7 queued vehicles become orphaned during migration

Mitigation:

- route-derived movement resolution;
- one-to-one queued vehicle validation;
- fail hydration on inconsistent references;
- migration fixtures including pending releases.

### Risk: conflict geometry becomes overly tied to the legacy cardinal grid

Mitigation:

- keep conflict computation behind `ConflictMatrixBuilder`;
- use movement path/approach geometry abstractions;
- treat cardinal classification as the initial exact geometry implementation, not the public API.

### Risk: `IntersectionControlSystem` grows into another monolithic coordinator

Mitigation:

- queue storage, signal execution, unsignalized priority, pedestrian control, conflict building, and plan construction remain separate modules;
- architecture-size warnings remain enforced.

### Risk: standards fidelity becomes regulatory overengineering

Mitigation:

- encode traffic-flow mechanisms that affect simulation outcomes;
- keep state/jurisdiction legal variations configurable;
- do not simulate sign hardware or every MUTCD installation detail.

## Future extension seams

3R-B intentionally leaves stable interfaces for later tranches:

- adaptive signal optimization consuming queue and delay metrics;
- congestion-aware route costs using control runtime epochs;
- crash-induced movement closures;
- parking-generated turn demand;
- dedicated transit lanes and queue jumps;
- reversible-lane control;
- freeway ramp metering;
- non-cardinal/native road geometry;
- player intersection-editing UI;
- jurisdiction presets beyond the default U.S. ruleset.

None of those future features may bypass the 3R-B control authority. They must express changes through topology, control plans, policy, or priority requests.

## Final architectural principle

3R-B changes intersections from a generic capacity bottleneck into explicit pieces of transportation infrastructure.

A vehicle crosses a junction because:

- its route names a legal movement;
- that movement has usable lanes;
- the junction's U.S.-style control plan permits or conditionally permits it;
- conflicting traffic and pedestrians allow it;
- the movement has discharge capacity;
- the controller has completed any required stop, phase, or clearance rule.

That control chain becomes the sole live intersection authority for Civic Foundry 2.0.