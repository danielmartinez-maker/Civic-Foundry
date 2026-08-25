# Civic Foundry 2.0 — 3R-A Transportation Network Semantics Design

## Status

Approved in chat on 2026-08-25 as the first implementation tranche of **Phase 3R — Transportation Engine 2.0**.

This specification is intentionally narrower than the full 3R target. It creates the durable physical/logical network semantics required by later signal control, dynamic routing, explicit parking, crashes, transit priority, and disruption while preserving current V7 traffic behavior through compatibility projections.

The tranche is based on `main` and must not require unmerged Phase 2R work. Parcel access, private parking, and mixed-use building access integrate later through additive contracts.

## Product Intent

The current transportation stack is deterministic and useful but aggregate:

- roads are tile cells with one road class;
- each road cell becomes one graph node;
- cardinal adjacency creates bidirectional aggregate edges;
- intersection queues are approach-level;
- routing state is node-only;
- speed and capacity are aggregate road-definition properties.

3R-A introduces explicit road segments, directional carriageways, lanes, lane groups, legal turn movements, vehicle permissions, and stable network identity. Later 3R work must be able to attach signals, protected turns, lane-specific queues, tolls, closures, crash effects, parking access, and generalized costs without another foundational graph rewrite.

## Scope

3R-A includes:

1. Six-class road hierarchy.
2. Stable road-segment and junction identity.
3. Directional carriageways.
4. Explicit lane kinds and operating states.
5. Lane-level vehicle permissions.
6. Derived lane groups for scalable capacity accounting.
7. Explicit legal turn movements.
8. One-way and turn-restriction semantics.
9. Movement-aware routing topology.
10. Separate topology and dynamic-cost revision channels.
11. Deterministic V7 road-cell projection.
12. A compatibility graph for current traffic/transit/freight/service consumers.
13. Canonical save-ready network snapshots.
14. Unit, regression, determinism, migration, and scale tests.

3R-A explicitly excludes signal phase execution, adaptive signals, live congestion rerouting, parking occupancy/cruising, crash generation, weather effects, dynamic reversible-lane scheduling, lane-change microsimulation, lane-editing UI, driveway placement, and transit schedule operations.

## Architectural Rules

### Ownership

`TransportNetworkStore` is the 3R-A authoritative owner of:

- junctions;
- road segments;
- carriageways;
- lanes;
- explicit turn movements/restrictions;
- topology revision;
- cost epoch.

Derived state includes routing adjacency, lane groups, legacy graph projections, conflict candidates, renderer read models, and analytics indexes. Derived state is rebuildable and is never persisted as authority.

`RoadSystem` remains the authoritative V7 road-cell owner during compatibility migration. `LegacyRoadNetworkAdapter` deterministically projects those cells into the 3R-A model; it does not mutate them.

### Stable identity

IDs must never depend on array insertion order, map iteration order, congestion, queues, signal state, or route-search order.

New 2.0 road authoring will eventually supply persistent entity IDs. Legacy projection uses deterministic IDs derived from cell coordinates and direction.

### Progressive replacement

During 3R-A:

- existing `TrafficSystem` keeps aggregate vehicles;
- existing `IntersectionSystem` keeps approach queues;
- current transit/freight/service routing remains on the compatibility graph;
- current rendering does not need lane-level art;
- movement-aware routing is introduced separately and proven before consumers migrate.

No current consumer is forced to understand lanes in this tranche.

### Tiered fidelity

Lanes are explicit because lane configuration changes legal movements, capacity, transit priority, parking, and intersection behavior. Routine discretionary lane changing between intersections is not microsimulated. Later vehicle simulation may select compatible lane groups at bounded decision points.

## Domain Model

### RoadClass

```ts
export type RoadClass =
  | 'local'
  | 'collector'
  | 'arterial'
  | 'avenue'
  | 'expressway'
  | 'highway';
```

Road class provides policy/design defaults. Actual lane count, speed, permissions, and operating capacity remain explicit state.

V7 maps directly preserve `local`, `collector`, and `arterial`.

### Junction

```ts
export type JunctionId = string;

export type Junction = Readonly<{
  id: JunctionId;
  x: number;
  y: number;
  sourceLegacyCell?: string;
}>;
```

For legacy projection, coordinates are current cell-center coordinates. Later explicit road geometry may replace coordinate semantics without changing junction identity contracts.

### RoadSegment

A `RoadSegment` is one physical street segment between two junctions.

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
  accessPolicyId: string;
  tollPolicyId?: string;
  carriagewayIds: readonly CarriagewayId[];
  sourceLegacyCells?: readonly string[];
}>;
```

`geometryRef` is opaque in 3R-A. The transportation domain must not invent a competing geometry owner before the 1R road-geometry model is available.

### Carriageway

A carriageway is a directional bundle of adjacent lanes on one segment.

```ts
export type CarriagewayId = string;
export type TravelDirection = 'forward' | 'backward';

export type Carriageway = Readonly<{
  id: CarriagewayId;
  segmentId: RoadSegmentId;
  direction: TravelDirection;
  fromJunctionId: JunctionId;
  toJunctionId: JunctionId;
  operatingClass: RoadClass;
  laneIds: readonly LaneId[];
}>;
```

`operatingClass` is directional. New 2.0 roads will normally match the parent segment class, but the distinction is required for exact V7 compatibility where the current directed edge inherits its source road cell's type.

A two-way street normally has two carriageways. A one-way street may expose only one routable carriageway.

### Lane

```ts
export type LaneId = string;
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
}>;
```

Movement membership is **not duplicated on `Lane`**. `TurnMovement.fromLaneIds` and `toLaneIds` are the authoritative movement-to-lane relationship; lane→movement indexes are derived.

Lane ordinals are unique and stable within each carriageway.

Parking lanes and shoulders contribute zero normal travel capacity. Reversible lanes are representable, but 3R-A does not schedule reversals; their current direction/open state is authoritative input.

### Vehicle permissions

The initial vocabulary is:

- private car;
- taxi/ride-hail;
- light commercial;
- heavy freight;
- bus;
- emergency;
- bicycle.

Permissions use a deterministic bit mask or equivalent immutable flags. Emergency exemptions must be explicit policy rather than silently inferred by routing.

### TurnMovement

```ts
export type TurnMovementId = string;
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

A route cannot infer that all physically adjacent road segments connect legally. U-turns are prohibited by default unless an explicit movement authorizes them.

Movement IDs depend only on stable junction/incoming/outgoing carriageway IDs. Signals, queues, congestion, and incidents never alter movement identity.

### LaneGroup

`LaneGroup` is derived state for scalable queue/capacity behavior.

```ts
export type LaneGroupId = string;

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

A lane group combines adjacent lanes only when they share compatible permissions, operating state, downstream movement set, and comparable free-flow behavior. Movement IDs are obtained from the authoritative movement index, not from duplicated lane fields.

## Deterministic Legacy Projection

### Legacy ID scheme

For cell key `x,y`:

- junction: `j:legacy:x,y`

For adjacent cells A and B, sort the two cell keys lexicographically and create one physical segment:

- segment: `s:legacy:<minKey>><maxKey>`

Each direction receives one carriageway:

- `c:<segmentId>:<fromJunctionId>><toJunctionId>`

Lanes use stable ordinal identity:

- `l:<carriagewayId>:<ordinal>`

Movement identity:

- `m:<junctionId>:<fromCarriagewayId>><toCarriagewayId>`

These exact legacy prefixes are compatibility identities, not a required format for future authored 2.0 entities.

### Segment construction

Each unordered cardinal adjacency pair of legacy road cells produces exactly one physical `RoadSegment` with up to two directional carriageways. This preserves current one-cell edge granularity without incorrectly treating a physical segment itself as directional.

For legacy projection only, the segment `roadClass` is the higher-ranked class of its two endpoint/source cells using:

`local < collector < arterial`.

This parent class is descriptive. Directional behavior comes from each carriageway's `operatingClass`.

### Directional V7 parity

Current `TransportationGraph` derives a directed edge's type, speed, and capacity from its **source road cell**. The adapter must preserve this asymmetry.

For carriageway A→B:

- `operatingClass = roadType(A)`;
- free-flow speed derives from `roadType(A)`;
- aggregate directional capacity derives from `roadType(A)`.

For B→A, the same rules use `roadType(B)`.

This guarantees mixed-class adjacency does not silently change current route costs.

### Required default V7 lane configurations

The initial compatibility projection uses exactly:

- `local`: 1 general travel lane per direction;
- `collector`: 2 general travel lanes per direction;
- `arterial`: 3 general travel lanes per direction.

Per-lane capacities are calibrated from the existing aggregate directional edge capacity. The sum of open compatible travel-lane capacity for one projected carriageway must equal the current V7 directed edge capacity within `1e-9`.

Examples:

- local 60 → one lane at 60;
- collector 120 → two lanes at 60 each;
- arterial 240 → three lanes at 80 each.

No parking lanes, bike lanes, shoulders, turn pockets, or reversible lanes are fabricated during V7 migration.

### Legacy movement generation

At each legacy junction, `TurnMovementBuilder` examines incoming and outgoing carriageways that geometrically meet at that junction.

For cardinal grid geometry:

- same heading = `through`;
- +90° normalized rotation = one turn side;
- -90° normalized rotation = the opposite turn side;
- reverse heading = `u-turn`.

The implementation must encode left/right consistently with the game's coordinate convention and prove it with tests rather than rely on visual intuition.

U-turn movements are created as prohibited or omitted according to the chosen builder representation, but routing behavior must be equivalent: no default U-turn route exists.

## Network Store

Target modules:

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

If repository conventions require co-location under `src/simulation/traffic/transport2/`, the implementation may use that path while preserving the same ownership boundaries.

### TransportNetworkStore responsibilities

The store:

- validates references before commit;
- applies method-scope transactional mutations;
- exposes immutable sorted reads/snapshots;
- owns `topologyRevision` and `costEpoch`;
- never owns live traffic volume, signal phase, parking occupancy, or crash state in 3R-A.

No caller receives mutable authoritative maps.

## Routing Topology

### Movement-aware state

Node-only A* cannot correctly express turn restrictions because legality depends on how the route entered the junction.

```ts
export type RoutingState = Readonly<{
  junctionId: JunctionId;
  incomingCarriagewayId?: CarriagewayId;
}>;
```

At route origin the incoming carriageway is absent. After traversal, expansion considers only allowed turn movements compatible with the request's vehicle permission mask.

### Routing arcs

A routing arc combines travel through one carriageway/lane group with the legal movement needed to continue at its destination junction.

3R-A static generalized cost includes:

- free-flow traversal time;
- base turn penalty;
- static toll placeholder if supplied.

Signal delay, live congestion, crash delay, parking cost, and experienced-cost learning are deferred.

A prohibited connection is absent from legal expansion rather than represented by an arbitrary giant cost.

### Deterministic tie breaking

Equal-cost routing uses this stable order:

1. total estimated cost;
2. accumulated cost;
3. routing-state stable key;
4. routing-arc stable ID.

Same network snapshot + same route request must return the same route.

## Revision Model

### topologyRevision

Increment when legal physical routing can change, including:

- segment/carriageway/lane add or removal;
- endpoint connectivity change;
- lane direction change;
- travel lane open/close change;
- lane permission change;
- movement add/remove;
- movement `allowed` change;
- movement permission change;
- movement lane membership change.

Topology changes invalidate derived routing topology and all route caches.

### costEpoch

Increment when route legality/topology is unchanged but generalized cost changes. 3R-A introduces the channel; later owners advance it for congestion, signal timing, incidents, tolls, parking scarcity, and transit priority.

A cost-epoch change invalidates cost-sensitive route caches without rebuilding physical topology.

### No revision inflation

No-op mutations do not increment revisions. Rebuilding derived indexes from unchanged authority never increments authoritative revisions.

## Compatibility Graph

`LegacyTransportationGraphAdapter` exposes the existing `TransportationGraph` contract from 3R-A state during migration.

For legacy maps it must preserve:

- current road-cell node identity where consumers depend on it;
- current directed cardinal adjacency;
- free-flow ticks within floating-point tolerance;
- directional capacity within tolerance;
- directional mixed-class behavior;
- deterministic rebuild semantics;
- route invalidation after source-road topology changes.

The compatibility graph is derived state. The long-term authoritative network is `TransportNetworkStore`.

## Invariants

### Referential integrity

Every carriageway references an existing segment. Every segment endpoint references an existing junction. Every lane references an existing carriageway. Every movement references incoming/outgoing carriageways meeting at the same junction. Movement lane IDs must belong to the stated carriageways.

### Direction consistency

Incoming movement carriageways terminate at the movement junction. Outgoing carriageways originate there. Carriageway endpoints must match a valid orientation of their parent segment.

### Lane ordinal uniqueness

No two lanes in one carriageway share an ordinal.

### Capacity validity

Capacities/speeds are finite and non-negative. Parking lanes and shoulders contribute zero normal travel capacity.

### Permission validity

A movement's effective permission set is the intersection of incoming eligible lane permissions, movement permissions, and outgoing eligible lane permissions. An empty effective set is unroutable.

### No fabricated connectivity

Derived routing may never synthesize an absent or prohibited authoritative movement.

### Legacy capacity conservation

For each projected V7 directed edge, summed compatible lane-group capacity equals current aggregate edge capacity within `1e-9`.

### Canonical determinism

The same ordered legacy road snapshot produces byte-equivalent canonical 3R-A snapshots, movement IDs, lane-group IDs, and equal-cost routes.

## Snapshot Contract

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

Arrays are sorted by stable ID. Lane groups, routing indexes, legacy projections, and other derived views are not persisted.

Restore validates all invariants before exposing the network, then rebuilds derived indexes.

3R-A does not require a live save-format version bump. When Phase 3R persistence becomes authoritative, legacy saves may regenerate the network from V7 road cells rather than fabricate historical lane edits.

## Error Handling

Hard failures are used for invalid program/data contracts, including duplicate IDs, missing references, impossible movement geometry, duplicate lane ordinals, and non-finite numeric values.

Expected invalid gameplay mutations return typed rejections. A rejected mutation cannot leave partial topology changes.

## Integration Boundaries

### TrafficSystem

No active-vehicle lane migration occurs in 3R-A. Existing traffic continues using compatibility edge IDs.

### IntersectionSystem

Existing approach queues remain. `TurnMovementId` becomes the stable contract consumed by 3R-B movement queues and signals.

### PathfindingSystem

Current pathfinding remains for compatibility consumers. 3R-A adds a separate movement-aware router. Shared A* utilities may be extracted only after parity tests prove behavior.

### Transit

Bus-lane semantics exist, but current transit routing need not consume them yet.

### Freight and services

Heavy-truck and emergency permission semantics are representable, but existing systems stay on compatibility routing during 3R-A.

### Rendering

No lane-art overhaul is required. Presentation may read lane/carriageway metadata but cannot become authoritative.

### Phase 1R / 2R

3R-A does not own parcel geometry, driveway points, building parking inventory, zoning parking requirements, or explicit 1R road geometry. It exposes IDs/interfaces that later integration can attach to.

## Test Strategy

### `tests/transport2-network-store.test.ts`

Covers stable IDs, transactional mutations, reference validation, lane ordinals, permission mutation, no-op revisions, and canonical snapshot/restore.

### `tests/transport2-legacy-projection.test.ts`

Covers local/collector/arterial required defaults, exact directional adjacency, mixed-class source-edge behavior, capacity conservation, deterministic projection, and road removal invalidation.

### `tests/transport2-turn-movements.test.ts`

Covers T-junctions, four-way intersections, left/through/right classification, one-way streets, prohibited turns, default U-turn prohibition, and permission-filtered movement legality.

### `tests/transport2-lane-groups.test.ts`

Covers compatibility grouping, parking/shoulder exclusion, capacity summation, movement-set separation, and closed-lane exclusion.

### `tests/transport2-routing.test.ts`

Covers movement-aware routing, no-left-turn detours, one-way routing, vehicle-class restrictions, deterministic equal-cost ties, topology-revision invalidation, and cost-epoch invalidation without topology rebuild.

### Existing regression gate

At minimum keep green:

- `tests/transport-graph.test.ts`;
- `tests/traffic-routing.test.ts`;
- `tests/traffic-simulation.test.ts`;
- transit routing/integration tests;
- freight vehicle tests;
- service dispatch/accessibility tests using road routing;
- kernel determinism/parity tests.

No V7 map changes aggregate route behavior merely because 3R-A is enabled.

### Scale gate

Add a fixture representative of at least 10,000 legacy road cells.

Required complexity properties:

- unchanged-source rebuild check is O(1) by revision;
- full legacy projection is O(R + A), where R is road entities/cells and A cardinal adjacency;
- movement generation is bounded by local junction degree, not global pair scans;
- `costEpoch` invalidation does not rebuild topology;
- no routine tick/frame path serializes the full network snapshot.

If the compatibility layer materially increases current graph-rebuild cost on the same fixture, record a before/after benchmark before merge and either optimize or document an accepted budget.

## Implementation Order

1. Transport 2.0 IDs/types and snapshot contract.
2. `TransportNetworkStore` invariants and revisions.
3. Deterministic V7 projection.
4. Explicit turn movements/restrictions.
5. Lane-group derivation.
6. Movement-aware routing topology/pathfinding.
7. Legacy compatibility graph adapter.
8. Current traffic/transit/freight/service regression proof.
9. Determinism and 10k-road scale evidence.

Current production traffic consumers must not switch to movement-aware routing until the compatibility gate is green.

## Acceptance Criteria

3R-A is complete only when:

1. All six 2.0 road classes exist.
2. Segments, junctions, carriageways, lanes, and movements have stable deterministic identity.
3. One-way streets are representable without synthetic reverse connectivity.
4. Through, turn, bus, bike, parking, reversible, and shoulder lanes are representable.
5. Lane and movement permissions affect 2.0 route legality.
6. Junctions expose explicit turn movements.
7. U-turns are prohibited by default.
8. A prohibited turn causes a deterministic legal detour or no route.
9. Lane groups conserve compatible travel capacity.
10. V7 local/collector/arterial projection preserves free-flow and aggregate directional capacity.
11. Mixed V7 road classes preserve current source-edge directional behavior.
12. `topologyRevision` deterministically invalidates physical route caches.
13. `costEpoch` invalidates cost-sensitive caches without physical topology rebuild.
14. No-op mutations/rebuilds do not inflate revisions.
15. Canonical snapshot→restore→snapshot is byte-equivalent.
16. Existing V7 transportation, traffic, transit, freight, service, and kernel regression suites remain green.
17. A 10k-road-cell fixture demonstrates bounded/linear projection behavior.
18. No new production coordinator exceeds Civic Foundry 2.0 file-size guidance without explicit review.

## Deferred Interfaces

### 3R-B — Intersection Control

Consumes stable movements and lane groups for conflict matrices, movement queues, fixed-time signals, protected turns, offsets, pedestrian phases, and adaptive-control interfaces.

### 3R-C — Dynamic Routing and Disruption

Consumes `topologyRevision`/`costEpoch` for predicted time, congestion, bounded rerouting, tolls, incident delay, crash capacity effects, and closures.

### 3R-D — Explicit Parking

Consumes destination access/generalized-cost interfaces for curb/private inventory, lots/garages, pricing, occupancy, cruising, and parking-access walk cost.

3R-A must not hard-code assumptions that block these later extensions.

## Guardrails

- Do not rewrite `TrafficSystem` in 3R-A.
- Do not implement signal execution before movement identity is proven.
- Do not fabricate parking/bike/shoulder infrastructure during V7 migration.
- Preserve V7 capacity and route behavior before introducing new balancing constants.
- Do not persist lane groups or routing indexes.
- Do not make rendering authoritative.
- Do not let UI mutations bypass the network owner.
- Do not rebuild the full network per simulation tick.
- Do not let random iteration order affect IDs, movement order, or route ties.

## Completion Definition

3R-A is the durable semantic foundation for Transportation Engine 2.0. It is complete when explicit lane/movement topology exists, V7 behavior remains compatible, deterministic migration and routing are proven, and later 3R systems can attach to stable movement/lane identities without redesigning the network core.
