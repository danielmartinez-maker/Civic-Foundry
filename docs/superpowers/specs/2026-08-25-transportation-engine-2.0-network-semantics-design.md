# Civic Foundry 2.0 — 3R-A Transportation Network Semantics Design

## Status

Approved in chat on 2026-08-25 as the first implementation tranche of **Phase 3R — Transportation Engine 2.0**.

This design is intentionally narrower than the full Phase 3R target. It introduces the durable physical and logical network model required by later signal, routing, parking, crash, transit-priority, and disruption work while preserving current V7 traffic behavior through compatibility projections.

This tranche is based on `main` and must not require unmerged Phase 2R work. Any later integration with explicit parcel access points, private parking, or mixed-use building access occurs through additive interfaces after those systems are available.

## Product Intent

The current transportation stack is deterministic and useful, but its authoritative model is still aggregate:

- roads are tile cells with one road class;
- each road cell becomes one graph node;
- adjacent road cells create bidirectional aggregate edges;
- intersection queues are approach-level rather than movement-level;
- routing state is node-only;
- road capacity and speed are properties of aggregate road definitions.

3R-A replaces those assumptions with explicit road segments, directional carriageways, lanes, lane groups, turn movements, access permissions, and stable network identity.

The goal is to make the network expressive enough that later phases can model protected turns, signal phases, lane-specific queues, transit priority, tolling, closures, crashes, parking access, reversible lanes, and generalized route costs without another foundational graph rewrite.

## Scope

3R-A includes:

1. Expanded road hierarchy.
2. Stable authoritative road-segment identity.
3. Directional carriageway semantics.
4. Explicit lanes and lane kinds.
5. Lane-level vehicle permissions.
6. Lane groups for simulation-efficient capacity accounting.
7. Explicit turn movements at intersections.
8. Movement restrictions and one-way behavior.
9. Movement-aware routing topology.
10. Separate topology and dynamic-cost revision channels.
11. V7 road-cell compatibility projection.
12. Deterministic derived compatibility graph for current consumers.
13. Save-ready snapshot types for the new network domain.
14. Unit, regression, determinism, and migration tests.

3R-A does not include:

- signal phase execution;
- stop/yield priority service logic beyond topology metadata;
- adaptive signals;
- live congestion-based rerouting;
- parking occupancy or cruising;
- crash generation;
- weather effects;
- dynamic lane reversal scheduling;
- lane-change microsimulation;
- player-facing lane editing UI;
- parcel-driveway placement;
- transit schedule operations.

Those remain later Phase 3R/5R responsibilities.

## Architectural Principles

### Authoritative versus derived state

The authoritative 3R-A transportation domain owns physical network semantics: segments, carriageways, lanes, operating permissions, and explicit legal turn movements.

Derived state includes:

- routing adjacency;
- lane-group capacity views;
- legacy `TransportationGraph` projections;
- intersection conflict candidates;
- renderer-friendly geometry views;
- analytics indexes.

Derived state must be rebuildable from authoritative transportation state.

### Stable identity

Network entity identifiers may not depend on array insertion order, iteration order of maps, or transient routing state.

Identifiers are stable across rebuilds when the underlying authoritative road entity is unchanged.

Legacy-road migration generates IDs from deterministic source identity. New 2.0 road authoring will later supply persistent segment IDs directly.

### Progressive replacement

Current systems remain available during 3R-A:

- `RoadSystem` continues to own V7 road cells;
- `TrafficSystem` continues to operate current aggregate vehicles;
- `IntersectionSystem` continues current approach queues;
- existing transit, freight, service, and rendering consumers continue to read a compatibility graph.

3R-A introduces the next-generation network beside those systems and projects backward to their current contracts.

No existing consumer is forced to understand lanes until its own migration tranche.

### Tiered fidelity

Lanes are explicit because lane configuration changes capacity, legal movements, transit priority, parking, and intersection behavior.

Routine discretionary lane changing between intersections is not microsimulated in 3R-A. Vehicles later select compatible lane groups and movement queues at bounded decision points.

This preserves gameplay-relevant lane semantics without turning every road segment into a car-following simulation.

## Domain Model

### RoadClass

The 2.0 hierarchy is:

- `local`
- `collector`
- `arterial`
- `avenue`
- `expressway`
- `highway`

Road class is a design and policy classification. It provides defaults, not immutable physics.

A segment's actual lanes, speed regime, permissions, and capacity are authoritative and may differ from class defaults.

The existing V7 hierarchy maps directly:

- `local` → `local`
- `collector` → `collector`
- `arterial` → `arterial`

### RoadSegment

A `RoadSegment` represents one physical street segment between two topological junctions or terminal endpoints.

Required fields:

```ts
export type RoadSegmentId = string;

export type RoadSegment = Readonly<{
  id: RoadSegmentId;
  roadClass: RoadClass;
  geometryRef: string;
  startJunctionId: JunctionId;
  endJunctionId: JunctionId;
  lengthMeters: number;
  speedLimitKph: number;
  condition: number;
  tollPolicyId?: string;
  accessPolicyId: string;
  carriagewayIds: readonly CarriagewayId[];
  sourceLegacyCells?: readonly string[];
}>;
```

`geometryRef` is an opaque reference in this tranche. 3R-A must not invent a competing geometry owner before Phase 1R road geometry is available.

For V7 projection, one legacy road cell may initially project to a short segment with deterministic pseudo-geometry metadata derived from cell coordinates. The interface remains compatible with later explicit geometry.

### Junction

A `Junction` is a topological point where carriageways begin/end or movements may connect.

```ts
export type Junction = Readonly<{
  id: JunctionId;
  x: number;
  y: number;
  sourceLegacyCell?: string;
}>;
```

The current grid can use cell-center coordinates during compatibility migration.

Later 1R/road-geometry integration may replace coordinate semantics without changing movement identity contracts.

### Carriageway

A carriageway is a directional bundle of adjacent traffic lanes belonging to one road segment.

```ts
export type TravelDirection = 'forward' | 'backward';

export type Carriageway = Readonly<{
  id: CarriagewayId;
  segmentId: RoadSegmentId;
  direction: TravelDirection;
  fromJunctionId: JunctionId;
  toJunctionId: JunctionId;
  laneIds: readonly LaneId[];
}>;
```

A two-way street normally has two carriageways. A one-way street may have one active travel carriageway.

Bike-only or transit-only directional facilities may share the same segment while remaining separate lane semantics.

### Lane

Supported lane kinds in 3R-A:

- `through`
- `turn`
- `bus`
- `bike`
- `parking`
- `reversible`
- `shoulder`

```ts
export type LaneKind =
  | 'through'
  | 'turn'
  | 'bus'
  | 'bike'
  | 'parking'
  | 'reversible'
  | 'shoulder';

export type LaneOperatingState = 'open' | 'closed';

export type Lane = Readonly<{
  id: LaneId;
  carriagewayId: CarriagewayId;
  ordinal: number;
  kind: LaneKind;
  permissions: VehiclePermissionMask;
  operatingState: LaneOperatingState;
  baseCapacityPerMinute: number;
  freeFlowSpeedKph: number;
  allowedMovementIds: readonly TurnMovementId[];
}>;
```

`ordinal` has a stable meaning within a carriageway and must not be generated from arbitrary iteration order.

Parking lanes are explicit lane entities but are excluded from travel capacity by default.

Shoulders are also excluded from normal travel capacity unless their operating policy later changes.

Reversible lanes exist in the data model but 3R-A does not schedule direction changes. Their current direction/open state is authoritative input.

### Vehicle permissions

The initial permission vocabulary is:

- private car
- taxi/ride-hail
- light commercial
- heavy freight
- bus
- emergency
- bicycle

Permissions are represented by a deterministic bit mask or equivalent immutable flags.

A lane or movement can forbid a vehicle class without deleting physical connectivity.

Emergency exemptions are explicit policy, not silently inferred by route finding.

### LaneGroup

`LaneGroup` is derived state used to avoid unnecessary lane-level vehicle microsimulation.

A lane group combines adjacent lanes that share:

- direction;
- compatible permissions;
- compatible downstream movement set;
- operating state;
- comparable free-flow behavior.

```ts
export type LaneGroup = Readonly<{
  id: LaneGroupId;
  carriagewayId: CarriagewayId;
  laneIds: readonly LaneId[];
  movementIds: readonly TurnMovementId[];
  permissions: VehiclePermissionMask;
  capacityPerMinute: number;
  freeFlowSpeedKph: number;
}>;
```

Lane grouping is derived and may change when lane permissions or allowed movements change.

Later queueing systems may queue travelers by lane group rather than individual lane.

### TurnMovement

A `TurnMovement` is the legal directed connection from an incoming carriageway/lane set through a junction to an outgoing carriageway/lane set.

```ts
export type TurnKind = 'left' | 'through' | 'right' | 'u-turn';

export type TurnMovement = Readonly<{
  id: TurnMovementId;
  junctionId: JunctionId;
  fromCarriagewayId: CarriagewayId;
  toCarriagewayId: CarriagewayId;
  fromLaneIds: readonly LaneId[];
  toLaneIds: readonly LaneId[];
  turnKind: TurnKind;
  permissions: VehiclePermissionMask;
  allowed: boolean;
  basePenaltyTicks: number;
}>;
```

Turn legality is explicit.

A route may not infer that all physically adjacent road segments are mutually reachable.

U-turns default to prohibited unless explicitly created.

### Movement identity

Movement IDs are generated from stable junction, incoming carriageway, and outgoing carriageway identity. They do not depend on signal phases, current congestion, or queue state.

Later signal systems refer to these stable movement IDs.

## Legacy Road Projection

### Purpose

`LegacyRoadNetworkAdapter` converts current `RoadSystem` state into the new 3R-A authoritative-compatible network representation without changing V7 gameplay.

This is a deterministic projection during the compatibility period; it does not mutate `RoadSystem`.

### Grid projection

For each legacy road cell:

1. Create a stable junction at the cell coordinate.
2. For each cardinal neighboring road cell, derive directed connection semantics.
3. Collapse or retain per-cell segment granularity according to the deterministic compatibility algorithm below.

For 3R-A, the compatibility algorithm intentionally retains **one-cell directional segment granularity** between adjacent legacy road-cell junctions. This matches current graph topology exactly and avoids introducing route differences from segment collapsing.

Later explicit road authoring can use longer physical segments without changing the 3R-A interfaces.

### Default V7 lane configurations

Legacy roads must preserve effective directional capacity and speed.

Default lane configurations are therefore calibrated so that projected travel groups reproduce current aggregate V7 capacity values before signals or parking effects are enabled.

Recommended deterministic defaults:

- `local`: one general travel lane per direction;
- `collector`: two general travel lanes per direction;
- `arterial`: three general travel lanes per direction.

The per-lane base capacities are calibrated from existing aggregate directional capacities rather than using external traffic-engineering values in this tranche.

For example, if the legacy local edge exposes 60 weighted vehicles/minute, its single projected travel lane exposes 60. A collector with two lanes divides its 120 aggregate capacity deterministically across the two lanes, and an arterial divides 240 across three lanes.

The exact sum of compatible travel-lane capacity for a projected legacy direction must equal the legacy edge capacity within floating-point tolerance.

Parking, shoulders, bike lanes, and turn pockets are not fabricated during V7 migration.

### Mixed road-class adjacency

Current `TransportationGraph` assigns an edge's road type using its source cell.

The compatibility projection must preserve this directional asymmetry where adjacent cells have different road types. The forward and reverse carriageways may therefore inherit different legacy source-class defaults during projection even though a future explicit road editor would normally represent such transitions with segment boundaries.

This rule is required for V7 path-cost parity.

## Network Store

Introduce a focused transportation-domain store rather than expanding `TransportationGraph` into an authoritative owner.

Recommended classes/modules:

- `TransportNetworkTypes.ts`
- `TransportNetworkStore.ts`
- `LegacyRoadNetworkAdapter.ts`
- `LaneGroupBuilder.ts`
- `TurnMovementBuilder.ts`
- `RoutingTopology.ts`
- `LegacyTransportationGraphAdapter.ts`

### TransportNetworkStore

Owns authoritative network entities:

- junctions;
- road segments;
- carriageways;
- lanes;
- movement restrictions/explicit movements;
- topology revision;
- cost epoch.

Public mutation methods validate references before committing changes.

The store must not own live traffic volume, signal phase, parking occupancy, or crash state in 3R-A.

### Read models

The store exposes sorted immutable snapshots/read methods.

No caller receives direct mutable maps.

Sorting keys are stable entity IDs unless spatial order is specifically required.

## Routing Topology

### Why node-only routing is insufficient

The current A* state can only answer "which node am I at?". Turn restrictions depend on the edge/carriageway used to enter that junction.

3R-A therefore introduces routing state with incoming context.

### RoutingState

```ts
export type RoutingState = Readonly<{
  junctionId: JunctionId;
  incomingCarriagewayId?: CarriagewayId;
}>;
```

At route origin, `incomingCarriagewayId` is absent.

After traversing a carriageway, the next expansion selects only legal outgoing `TurnMovement`s compatible with the traveler/vehicle permission mask.

The graph searched by the 2.0 router is therefore a movement-aware directed state graph.

### RoutingArc

A routing arc represents:

1. traversal of one carriageway/lane group;
2. the movement required to continue through the destination junction.

Static 3R-A cost includes:

- free-flow traversal time;
- base movement penalty;
- static toll placeholder when provided;
- prohibition represented as absence rather than infinite cost.

Live congestion, signal delay, crash delay, and parking generalized cost are deferred to later 3R tranches.

### Deterministic tie-breaking

The current pathfinder's deterministic edge-ID tie-break principle is retained.

For equal-cost 2.0 routing states, ordering is:

1. total cost;
2. accumulated traversal cost;
3. routing-state stable key;
4. routing-arc stable ID.

The same network snapshot and request must return the same route.

## Revision Model

### topologyRevision

Increment when a mutation can change legal physical routing:

- segment added/removed;
- carriageway added/removed;
- lane added/removed;
- lane direction changed;
- lane opened/closed when closure removes legal travel;
- lane permissions changed;
- turn movement added/removed;
- movement allowed flag changed;
- movement permissions changed;
- endpoint connectivity changed.

A topology revision invalidates derived routing topology and all cached routes.

### costEpoch

Increment when topology remains legal but generalized cost changes.

In 3R-A, this channel is introduced but minimally used. Later owners will advance it for:

- congestion epochs;
- signal timing changes;
- incidents/crashes;
- toll changes;
- parking scarcity/access costs;
- dynamic transit priority.

A cost-epoch change invalidates only cost-sensitive route caches, not physical topology indexes.

### No revision inflation

No-op mutations must not increment revisions.

Rebuilding derived state from unchanged authoritative state must not increment `topologyRevision`.

## Compatibility Graph

`LegacyTransportationGraphAdapter` exposes the current `TransportationGraph`-compatible read model from the 3R network during migration.

Its acceptance requirement is behavioral parity with existing legacy graph generation for V7 roads:

- same road-cell node identity contract where current consumers require it;
- same directed adjacency;
- same free-flow ticks within tolerance;
- same directional capacity within tolerance;
- same deterministic rebuild behavior;
- route invalidation when source road revision changes.

The compatibility graph is derived state. The long-term authoritative network is the 3R-A store.

Existing `TransportationGraph` may remain unchanged initially and be fed by the adapter, or its implementation may delegate to this projection if that reduces duplication without breaking tests.

## Validation and Invariants

### Referential integrity

Every:

- carriageway references an existing segment;
- lane references an existing carriageway;
- segment endpoint references an existing junction;
- movement references existing incoming/outgoing carriageways at the same junction;
- lane movement reference points to an existing movement;
- movement lane references belong to the stated carriageways.

Invalid restore data fails fast.

### Direction consistency

A carriageway's `fromJunctionId` and `toJunctionId` must match one of its segment's two endpoint orientations.

A turn movement's incoming carriageway must terminate at the movement junction.

The outgoing carriageway must originate at that same junction.

### Lane ordinal uniqueness

Lane ordinals are unique inside each carriageway.

### Capacity validity

Travel-lane capacities are finite and non-negative.

Parking lanes and shoulders contribute zero normal travel capacity unless an explicit operating policy activates them in a later phase.

### Permission validity

A movement's effective allowed permissions are the intersection of:

- incoming lane permissions;
- movement permissions;
- outgoing lane permissions.

A movement with an empty effective permission set is not routable.

### No fabricated connectivity

No derived router may synthesize a movement that is absent or explicitly prohibited in authoritative movement state.

### Legacy capacity conservation

For each projected V7 directional edge, summed compatible lane-group capacity equals current legacy directional edge capacity within `1e-9` tolerance.

### Deterministic projection

The same ordered legacy road snapshot produces byte-equivalent sorted 3R-A snapshot data.

## Snapshot and Persistence Contract

3R-A defines save-ready data structures even if the first implementation does not yet bump the live save-format version.

```ts
export type TransportNetworkSnapshot = Readonly<{
  junctions: readonly Junction[];
  segments: readonly RoadSegment[];
  carriageways: readonly Carriageway[];
  lanes: readonly Lane[];
  movements: readonly TurnMovement[];
  topologyRevision: number;
  costEpoch: number;
}>;
```

Snapshot arrays are sorted by stable ID.

Derived lane groups and routing indexes are not persisted.

Restore rebuilds all derived indexes and validates invariants before exposing the network.

When Phase 3R persistence is activated, legacy saves may regenerate this snapshot from `RoadSystem` rather than fabricating historical lane edits.

## Error Handling

3R-A uses explicit validation errors for programmer/data-contract violations and typed mutation results for expected gameplay-invalid operations.

Examples of hard failures:

- restoring a lane whose carriageway does not exist;
- duplicate stable IDs;
- movement whose carriageways do not meet at its junction;
- non-finite capacity/speed values;
- duplicate lane ordinal within a carriageway.

Examples of normal rejected mutations:

- request to close the only permitted travel lane when caller policy forbids disconnection;
- duplicate road-segment creation command;
- unsupported lane permission combination requested by a future editor.

The store must be transactional at method scope: a rejected mutation cannot leave partially changed topology.

## Integration Boundaries

### TrafficSystem

No lane migration is required in 3R-A.

Current traffic vehicles continue using aggregate legacy edge IDs via the compatibility graph.

A later 3R tranche migrates active vehicles to lane-group/movement route state.

### IntersectionSystem

Current approach queues remain unchanged in 3R-A.

The new `TurnMovement` identity becomes the contract consumed by the future movement-queue and signal-control system.

### PathfindingSystem

Current pathfinding remains for compatibility consumers.

Introduce a separate movement-aware 2.0 router rather than forcing current node-only callers to supply incoming-state context immediately.

Later migration can unify shared A* infrastructure after behavior parity is demonstrated.

### Transit

Bus lane permission semantics are present in 3R-A, but existing transit routing is not required to consume them yet.

### Freight and service vehicles

Vehicle permission masks make later heavy-truck restrictions and emergency exemptions possible. Existing systems remain on compatibility routing for this tranche.

### Rendering

No art overhaul is required.

The new network may expose read-only lane/carriageway metadata for future overlays, but 3R-A acceptance does not depend on lane markings being rendered.

### Phase 1R / 2R

3R-A treats road geometry and parcel/building access as external future integration contracts.

It does not take ownership of parcel geometry, driveway points, building parking inventory, or zoning parking rules.

## Implementation Shape

Target source structure:

```text
src/simulation/transportation/
  TransportNetworkTypes.ts
  TransportNetworkStore.ts
  LegacyRoadNetworkAdapter.ts
  TurnMovementBuilder.ts
  LaneGroupBuilder.ts
  RoutingTopology.ts
  MovementAwarePathfindingSystem.ts
  LegacyTransportationGraphAdapter.ts
```

If naming conventions in the repository strongly favor `traffic/`, these modules may live under `src/simulation/traffic/transport2/`, but all 3R-A files must remain cohesive and avoid enlarging existing 8k–12k byte traffic files into new coordinators.

Normal source-file target remains below 500 LOC according to the Civic Foundry 2.0 architecture.

## Test Strategy

### New unit tests

`tests/transport2-network-store.test.ts`

Covers:

- stable IDs;
- transactional mutations;
- referential integrity;
- lane ordinals;
- permission updates;
- no-op revision behavior;
- snapshot/restore equivalence.

`tests/transport2-legacy-projection.test.ts`

Covers:

- local/collector/arterial defaults;
- exact legacy directional adjacency;
- mixed road-class adjacency;
- capacity conservation;
- deterministic projection;
- road removal invalidation.

`tests/transport2-turn-movements.test.ts`

Covers:

- T junctions;
- four-way intersections;
- left/through/right classification;
- one-way streets;
- prohibited turns;
- U-turn default prohibition;
- permission-filtered movements.

`tests/transport2-routing.test.ts`

Covers:

- movement-aware routing;
- no-left-turn detours;
- one-way routing;
- vehicle-class restrictions;
- deterministic equal-cost tie breaking;
- cache invalidation on `topologyRevision`;
- cost-cache invalidation on `costEpoch` without topology rebuild.

`tests/transport2-lane-groups.test.ts`

Covers:

- grouping only compatible adjacent lanes;
- parking/shoulder exclusion;
- capacity summation;
- movement-set differences splitting groups;
- closed lane exclusion.

### Existing regression tests

At minimum, keep green:

- `tests/transport-graph.test.ts`
- `tests/traffic-routing.test.ts`
- `tests/traffic-simulation.test.ts`
- transit routing/integration tests
- service dispatch/accessibility tests using road routing
- freight vehicle tests
- kernel determinism/parity tests

No existing V7 road map should change aggregate route behavior merely because 3R-A is present.

### Determinism tests

Given identical legacy road snapshots:

- sorted 3R-A snapshots match exactly;
- turn movement IDs match exactly;
- lane-group IDs match exactly;
- equal-cost routes match exactly;
- repeated derived rebuilds do not change authoritative revisions.

### Performance tests

3R-A adds a scale fixture representative of at least 10,000 legacy road cells.

Acceptance targets are relative rather than speculative absolute milliseconds:

- unchanged-source `rebuildIfNeeded` must be O(1) revision check behavior;
- full legacy projection must be O(R + A), where R is road cells/entities and A is cardinal adjacency;
- movement generation must be bounded by local junction degree rather than global pair scans;
- route-cache invalidation must not rebuild topology when only `costEpoch` changes;
- no routine frame/tick path may serialize the full network snapshot.

A benchmark regression over the same fixture must be recorded before merging if the new compatibility layer increases current graph rebuild cost materially.

## Migration Sequence

Implementation should follow this dependency order:

1. Define transport 2.0 IDs/types and snapshot contract.
2. Implement `TransportNetworkStore` invariants and revision semantics.
3. Implement deterministic V7 legacy projection.
4. Implement explicit turn-movement generation and restrictions.
5. Implement lane-group derivation.
6. Implement movement-aware routing topology/pathfinding.
7. Implement legacy compatibility graph projection.
8. Prove current traffic/transit/freight/service regressions remain green.
9. Add scale/determinism evidence.

Production integration must not switch current traffic consumers to movement-aware routing until the compatibility gate is green.

## Acceptance Criteria

3R-A is complete only when all of the following are true:

1. Six road classes are represented in the 2.0 type system.
2. Road segments, carriageways, lanes, and junctions have stable deterministic IDs.
3. One-way streets are representable without synthetic reverse travel connectivity.
4. Through, turn, bus, bike, parking, reversible, and shoulder lanes are representable.
5. Vehicle-class lane and movement restrictions affect 2.0 route legality.
6. Junctions expose explicit legal turn movements.
7. U-turns are prohibited by default.
8. A no-turn restriction produces a deterministic legal detour or no route.
9. Lane groups conserve compatible travel capacity.
10. V7 local/collector/arterial roads project to equivalent free-flow and aggregate directional capacity.
11. Mixed legacy road-class adjacency preserves current directional edge behavior.
12. `topologyRevision` invalidates physical route caches deterministically.
13. `costEpoch` invalidates cost-sensitive caches without rebuilding physical topology.
14. No-op derived rebuilds do not change authoritative revisions.
15. Snapshot/restore is byte-equivalent after canonical sorting.
16. Existing V7 transportation, traffic, transit, freight, service, and kernel regression suites remain green.
17. A 10k-road-cell projection demonstrates linear/bounded build complexity.
18. No new production coordinator exceeds the Civic Foundry 2.0 architectural size guidance without explicit review.

## Deferred 3R Interfaces

3R-A deliberately exposes stable extension points for later work:

### 3R-B Intersection Control

Consumes stable `TurnMovementId`s and lane groups to implement:

- conflict matrices;
- movement queues;
- fixed-time signals;
- protected turns;
- offsets;
- pedestrian phases;
- adaptive policy interface.

### 3R-C Dynamic Routing and Disruption

Consumes `topologyRevision` and `costEpoch` to add:

- predicted travel time;
- current/experienced congestion;
- bounded rerouting;
- toll cost;
- incident delay;
- crash/closure capacity effects.

### 3R-D Parking

Consumes destination access and generalized-cost interfaces to add:

- curb inventory;
- private spaces;
- lots/garages;
- price;
- occupancy;
- cruising penalty;
- parking access walk cost.

The 3R-A model must not hard-code assumptions that prevent these additions.

## Non-Goals and Guardrails

- Do not rewrite `TrafficSystem` during 3R-A.
- Do not add signal simulation before movement identity is proven.
- Do not fabricate parking spaces during V7 migration.
- Do not add traffic engineering constants from external sources unless required by a later balancing pass; preserve V7 behavior first.
- Do not persist derived lane groups or routing indexes.
- Do not make rendering authoritative.
- Do not let a UI mutation bypass the transportation-domain owner.
- Do not create per-tick full-network rebuilds.
- Do not allow random iteration order to affect IDs, movement order, or routing tie breaks.

## Completion Definition

3R-A establishes the durable semantics layer for Transportation Engine 2.0 while current Civic Foundry traffic remains operational through compatibility adapters.

After 3R-A is accepted, Phase 3R can proceed to movement-level intersection control without changing the fundamental identity or routing topology model again.
