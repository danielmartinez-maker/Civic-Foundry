# Civic Foundry 2.0 — 3R-A Transportation Network Semantics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build deterministic road-segment, carriageway, lane, movement, lane-group, and movement-aware routing semantics while preserving V7 road/traffic behavior through compatibility projection.

**Architecture:** Add a new authoritative `src/simulation/transportation/` domain beside the V7 road/traffic stack. `RoadSystem` remains the legacy source during 3R-A; a deterministic adapter projects road cells into 2.0 physical topology, movement/lane-group builders derive routing semantics, and a separate movement-aware pathfinder consumes them. Existing `TransportationGraph`, `TrafficSystem`, transit, freight, and service routing remain on compatibility contracts until parity is proven.

**Tech Stack:** TypeScript ES modules, Node built-in test runner with `--experimental-strip-types`, existing `RoadSystem`/`TransportationGraph`/`PathfindingSystem`, deterministic sorted arrays/maps, no new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-08-25-transportation-engine-2.0-network-semantics-design.md`

## Global Constraints

- Same authoritative input must produce byte-equivalent canonical transport snapshots and equal-cost routes.
- `RoadSystem`, `TrafficSystem`, `IntersectionSystem`, transit, freight, service, and rendering remain current V7 owners/consumers during 3R-A.
- Signals, live congestion rerouting, parking occupancy/cruising, crash generation, weather effects, dynamic reversible-lane scheduling, lane-change microsimulation, lane-editing UI, parcel driveways, and transit schedules are outside 3R-A.
- V7 local/collector/arterial projection must preserve current directed adjacency, free-flow ticks, and aggregate directional capacity within `1e-9`.
- Mixed-class legacy adjacency preserves current source-cell directional behavior.
- No-op mutations and unchanged derived rebuilds do not inflate authoritative revisions.
- `topologyRevision` invalidates topology and route caches; `costEpoch` invalidates cost-sensitive route caches without rebuilding physical topology.
- Persist only authoritative transport entities and revisions. Lane groups, routing indexes, and compatibility projections are derived.
- New normal source files target under 500 LOC; 750 LOC is an architecture warning and 1,000 LOC requires review.
- Do not add runtime dependencies.
- Focused test example: `node --experimental-strip-types --test tests/transport2-network-store.test.ts`.
- Full gates: `npm test`, `npm run typecheck`, and `npm run lint`.

## File Map

Create under `src/simulation/transportation/`:

- `TransportNetworkTypes.ts` — IDs, hierarchy, lane/movement types, permission masks, snapshot contracts.
- `TransportNetworkStore.ts` — authoritative ownership, invariants, transactional mutations, revisions, snapshot/restore.
- `LegacyRoadNetworkAdapter.ts` — deterministic V7 road-cell → 2.0 physical projection and source-revision cache.
- `TurnMovementBuilder.ts` — deterministic movement generation/classification.
- `LaneGroupBuilder.ts` — derived compatible-lane grouping and capacity aggregation.
- `RoutingTopology.ts` — movement-aware adjacency/index read model.
- `MovementAwarePathfindingSystem.ts` — deterministic route search and cache invalidation.
- `LegacyTransportationGraphAdapter.ts` — 2.0 → current aggregate graph projection.

Modify:

- `src/simulation/traffic/TransportationGraph.ts` — add a narrow projection-loading path while preserving `rebuildIfNeeded(roads)`.

Create tests:

- `tests/transport2-types.test.ts`
- `tests/transport2-network-store.test.ts`
- `tests/transport2-legacy-projection.test.ts`
- `tests/transport2-turn-movements.test.ts`
- `tests/transport2-lane-groups.test.ts`
- `tests/transport2-routing-topology.test.ts`
- `tests/transport2-routing.test.ts`
- `tests/transport2-compatibility.test.ts`
- `tests/transport2-scale-determinism.test.ts`

---

### Task 1: Transport 2.0 types, six-class hierarchy, and permissions

**Files:**
- Create: `src/simulation/transportation/TransportNetworkTypes.ts`
- Create: `tests/transport2-types.test.ts`

**Interfaces:**
- Consumes: `RoadType` only for legacy lane-count typing.
- Produces: `RoadClass`, ID aliases, lane/movement unions, permission helpers, entity types, `TransportPhysicalNetwork`, `TransportNetworkAuthority`, `TransportNetworkSnapshot`, `TransportMutationResult`.

- [ ] **Step 1: Write the failing tests**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { ROAD_CLASSES, LEGACY_LANE_COUNT, VEHICLE_PERMISSION, permissionMask, hasPermission, intersectPermissions } from '../src/simulation/transportation/TransportNetworkTypes.ts';

test('3R hierarchy contains all six classes', () => {
  assert.deepEqual(ROAD_CLASSES, ['local', 'collector', 'arterial', 'avenue', 'expressway', 'highway']);
});

test('legacy lane counts are fixed', () => {
  assert.deepEqual(LEGACY_LANE_COUNT, { local: 1, collector: 2, arterial: 3 });
});

test('permission masks compose deterministically', () => {
  const mask = permissionMask('privateCar', 'bus');
  assert.equal(hasPermission(mask, 'privateCar'), true);
  assert.equal(hasPermission(mask, 'heavyFreight'), false);
  assert.equal(intersectPermissions(mask, VEHICLE_PERMISSION.bus), VEHICLE_PERMISSION.bus);
});
```

- [ ] **Step 2: Verify RED**

```bash
node --experimental-strip-types --test tests/transport2-types.test.ts
```

Expected: module-not-found failure.

- [ ] **Step 3: Implement the public contract**

```ts
import type { RoadType } from '../../data/roads.ts';

export const ROAD_CLASSES = ['local', 'collector', 'arterial', 'avenue', 'expressway', 'highway'] as const;
export type RoadClass = typeof ROAD_CLASSES[number];
export const LEGACY_LANE_COUNT: Readonly<Record<RoadType, number>> = Object.freeze({ local: 1, collector: 2, arterial: 3 });

export type JunctionId = string;
export type RoadSegmentId = string;
export type CarriagewayId = string;
export type LaneId = string;
export type TurnMovementId = string;
export type LaneGroupId = string;

export type VehiclePermission = 'privateCar' | 'taxiRideHail' | 'lightCommercial' | 'heavyFreight' | 'bus' | 'emergency' | 'bicycle';
export type VehiclePermissionMask = number;
export const VEHICLE_PERMISSION: Readonly<Record<VehiclePermission, number>> = Object.freeze({ privateCar: 1 << 0, taxiRideHail: 1 << 1, lightCommercial: 1 << 2, heavyFreight: 1 << 3, bus: 1 << 4, emergency: 1 << 5, bicycle: 1 << 6 });
export const ALL_VEHICLE_PERMISSIONS = Object.values(VEHICLE_PERMISSION).reduce((value, bit) => value | bit, 0);
export const permissionMask = (...permissions: readonly VehiclePermission[]): VehiclePermissionMask => permissions.reduce((value, permission) => value | VEHICLE_PERMISSION[permission], 0);
export const hasPermission = (mask: VehiclePermissionMask, permission: VehiclePermission): boolean => (mask & VEHICLE_PERMISSION[permission]) !== 0;
export const intersectPermissions = (...masks: readonly VehiclePermissionMask[]): VehiclePermissionMask => masks.length === 0 ? 0 : masks.reduce((value, mask) => value & mask);

export type LaneKind = 'through' | 'turn' | 'bus' | 'bike' | 'parking' | 'reversible' | 'shoulder';
export type LaneOperatingState = 'open' | 'closed';
export type TravelDirection = 'forward' | 'backward';
export type TurnKind = 'left' | 'through' | 'right' | 'u-turn';

export type Junction = Readonly<{ id: JunctionId; x: number; y: number; sourceLegacyCell?: string }>;
export type RoadSegment = Readonly<{ id: RoadSegmentId; roadClass: RoadClass; geometryRef: string; startJunctionId: JunctionId; endJunctionId: JunctionId; lengthMeters: number; speedLimitKph: number; condition: number; accessPolicyId: string; tollPolicyId?: string; carriagewayIds: readonly CarriagewayId[]; sourceLegacyCells?: readonly string[] }>;
export type Carriageway = Readonly<{ id: CarriagewayId; segmentId: RoadSegmentId; direction: TravelDirection; fromJunctionId: JunctionId; toJunctionId: JunctionId; operatingClass: RoadClass; laneIds: readonly LaneId[] }>;
export type Lane = Readonly<{ id: LaneId; carriagewayId: CarriagewayId; ordinal: number; kind: LaneKind; permissions: VehiclePermissionMask; operatingState: LaneOperatingState; baseCapacityPerMinute: number; freeFlowSpeedKph: number }>;
export type TurnMovement = Readonly<{ id: TurnMovementId; junctionId: JunctionId; fromCarriagewayId: CarriagewayId; toCarriagewayId: CarriagewayId; fromLaneIds: readonly LaneId[]; toLaneIds: readonly LaneId[]; turnKind: TurnKind; permissions: VehiclePermissionMask; allowed: boolean; basePenaltyTicks: number }>;
export type LaneGroup = Readonly<{ id: LaneGroupId; carriagewayId: CarriagewayId; laneIds: readonly LaneId[]; movementIds: readonly TurnMovementId[]; permissions: VehiclePermissionMask; capacityPerMinute: number; freeFlowSpeedKph: number }>;
export type TransportPhysicalNetwork = Readonly<{ junctions: readonly Junction[]; segments: readonly RoadSegment[]; carriageways: readonly Carriageway[]; lanes: readonly Lane[] }>;
export type TransportNetworkAuthority = Readonly<TransportPhysicalNetwork & { movements: readonly TurnMovement[] }>;
export type TransportNetworkSnapshot = Readonly<TransportNetworkAuthority & { topologyRevision: number; costEpoch: number }>;
export type TransportMutationResult = Readonly<{ ok: boolean; changed: boolean; reason?: string }>;
```

Add `roadClassRank(value: RoadClass): number` using `ROAD_CLASSES.indexOf(value)` and throw if runtime input is invalid.

- [ ] **Step 4: Verify GREEN**

```bash
node --experimental-strip-types --test tests/transport2-types.test.ts
npm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add src/simulation/transportation/TransportNetworkTypes.ts tests/transport2-types.test.ts
git commit -m "feat: add transport 2 network types"
```

---

### Task 2: Authoritative network store, invariants, and revisions

**Files:**
- Create: `src/simulation/transportation/TransportNetworkStore.ts`
- Create: `tests/transport2-network-store.test.ts`

**Interfaces:**
- Consumes: Task 1 authority/snapshot types.
- Produces: `TransportNetworkStore`, `validateTransportAuthority()`, `replaceAuthority()`, lane/movement mutations, `advanceCostEpoch()`, `snapshot()`, `restore()`.

- [ ] **Step 1: Write RED tests for canonical ordering and atomicity**

```ts
const store = new TransportNetworkStore();
assert.equal(store.replaceAuthority(authority).ok, true);
assert.deepEqual(store.snapshot().junctions.map((item) => item.id), ['j:a', 'j:b']);
const before = JSON.stringify(store.snapshot());
const invalid = { ...authority, lanes: [{ ...authority.lanes[0]!, carriagewayId: 'missing' }] };
assert.equal(store.replaceAuthority(invalid).ok, false);
assert.equal(JSON.stringify(store.snapshot()), before);
```

Add tests for duplicate IDs, duplicate lane ordinal in one carriageway, movement lane belonging to the wrong carriageway, wrong movement junction orientation, negative capacity, and non-finite speed.

- [ ] **Step 2: Verify RED**

```bash
node --experimental-strip-types --test tests/transport2-network-store.test.ts
```

- [ ] **Step 3: Implement exact public methods**

```ts
export class TransportNetworkStore {
  topologyRevision = 0;
  costEpoch = 0;
  replaceAuthority(authority: TransportNetworkAuthority): TransportMutationResult;
  setLaneOperatingState(laneId: LaneId, state: LaneOperatingState): TransportMutationResult;
  setLanePermissions(laneId: LaneId, permissions: VehiclePermissionMask): TransportMutationResult;
  setMovementAllowed(movementId: TurnMovementId, allowed: boolean): TransportMutationResult;
  setMovementPermissions(movementId: TurnMovementId, permissions: VehiclePermissionMask): TransportMutationResult;
  advanceCostEpoch(): number;
  snapshot(): TransportNetworkSnapshot;
  restore(snapshot: TransportNetworkSnapshot): void;
}
```

Validate the complete candidate before swapping private maps. Canonical snapshot arrays sort by stable ID. `replaceAuthority()` increments `topologyRevision` only when canonical authoritative content changes. Lane/movement no-ops return `{ ok: true, changed: false }`. `advanceCostEpoch()` increments only `costEpoch`. `restore()` validates first and restores exact snapshot revisions rather than incrementing them.

- [ ] **Step 4: Add explicit no-op/revision tests**

```ts
const revision = store.snapshot().topologyRevision;
assert.deepEqual(store.setLaneOperatingState('l:a', 'open'), { ok: true, changed: false });
assert.equal(store.snapshot().topologyRevision, revision);
const epoch = store.snapshot().costEpoch;
store.advanceCostEpoch();
assert.equal(store.snapshot().topologyRevision, revision);
assert.equal(store.snapshot().costEpoch, epoch + 1);
```

- [ ] **Step 5: Verify and commit**

```bash
node --experimental-strip-types --test tests/transport2-types.test.ts tests/transport2-network-store.test.ts
npm run typecheck
git add src/simulation/transportation/TransportNetworkStore.ts tests/transport2-network-store.test.ts
git commit -m "feat: add authoritative transport network store"
```

---

### Task 3: Deterministic V7 physical-network projection

**Files:**
- Create: `src/simulation/transportation/LegacyRoadNetworkAdapter.ts`
- Create: `tests/transport2-legacy-projection.test.ts`

**Interfaces:**
- Consumes: `RoadSystem`, `ROAD_DEFINITIONS`, Task 1 types.
- Produces: `LegacyProjection`, `LegacyProjectionDiagnostics`, stable ID helpers, `LegacyRoadNetworkAdapter.projectIfNeeded()`.

```ts
export type LegacyProjection = Readonly<{ physical: TransportPhysicalNetwork; sourceRoadRevision: number }>;
export type LegacyProjectionDiagnostics = { builds: number; roadCellsVisited: number; adjacencyChecks: number };
export const LEGACY_CELL_METERS = 10;
```

- [ ] **Step 1: Write RED exact-ID/capacity tests**

```ts
const projected = adapter.projectIfNeeded(roads);
assert.deepEqual(projected.physical.junctions.map((item) => item.id), ['j:legacy:2,5', 'j:legacy:3,5', 'j:legacy:4,5']);
assert.equal(projected.physical.segments.length, 2);
const forward = projected.physical.carriageways.find((item) => item.fromJunctionId === 'j:legacy:2,5' && item.toJunctionId === 'j:legacy:3,5');
assert.equal(forward?.operatingClass, 'local');
assert.equal(projected.physical.lanes.filter((lane) => lane.carriagewayId === forward?.id).reduce((sum, lane) => sum + lane.baseCapacityPerMinute, 0), 60);
```

Add a mixed collector→arterial adjacency test proving the forward operating class comes from the forward source cell and reverse comes from the reverse source cell.

- [ ] **Step 2: Verify RED**

```bash
node --experimental-strip-types --test tests/transport2-legacy-projection.test.ts
```

- [ ] **Step 3: Implement stable IDs and O(R + A) projection**

```ts
export const legacyJunctionId = (x: number, y: number): string => `j:legacy:${x},${y}`;
export const legacySegmentId = (a: string, b: string): string => `s:legacy:${[a, b].sort().join('>')}`;
export const legacyCarriagewayId = (segmentId: string, from: string, to: string): string => `c:${segmentId}:${from}>${to}`;
export const legacyLaneId = (carriagewayId: string, ordinal: number): string => `l:${carriagewayId}:${ordinal}`;
```

Visit each road once and perform exactly four cardinal lookups. Create an unordered physical segment only when `sourceKey.localeCompare(neighborKey) < 0`. Create both directional carriageways. Directional `operatingClass`, speed, and capacity come from the source cell. Lane counts are local=1, collector=2, arterial=3; divide legacy directional capacity evenly so lane sums are exact within `1e-9`. Convert speed using `freeFlowSpeedKph = cellsPerSecond * LEGACY_CELL_METERS * 3.6`.

- [ ] **Step 4: Add unchanged-source cache test**

```ts
const first = adapter.projectIfNeeded(roads);
const builds = adapter.diagnostics.builds;
assert.equal(adapter.projectIfNeeded(roads), first);
assert.equal(adapter.diagnostics.builds, builds);
roads.remove(3, 5);
assert.notEqual(adapter.projectIfNeeded(roads), first);
assert.equal(adapter.diagnostics.builds, builds + 1);
```

- [ ] **Step 5: Verify and commit**

```bash
node --experimental-strip-types --test tests/transport2-legacy-projection.test.ts tests/transport-graph.test.ts
npm run typecheck
git add src/simulation/transportation/LegacyRoadNetworkAdapter.ts tests/transport2-legacy-projection.test.ts
git commit -m "feat: project legacy roads into lane topology"
```

---

### Task 4: Turn movements and restriction semantics

**Files:**
- Create: `src/simulation/transportation/TurnMovementBuilder.ts`
- Modify: `src/simulation/transportation/LegacyRoadNetworkAdapter.ts`
- Create: `tests/transport2-turn-movements.test.ts`

**Interfaces:**
- Consumes: `TransportPhysicalNetwork`.
- Produces: `buildTurnMovements()`, `movementEffectivePermissions()`, `projectAuthorityIfNeeded()`.

- [ ] **Step 1: Write RED four-way/T-junction tests**

For a five-cell plus intersection, assert 12 legal non-U-turn movements at the center. For northbound arrival, assert one left, one through, one right, and zero U-turns. For a T-junction, assert only physically present exits become movements.

- [ ] **Step 2: Verify RED**

```bash
node --experimental-strip-types --test tests/transport2-turn-movements.test.ts
```

- [ ] **Step 3: Implement deterministic heading classification**

```ts
const dot = dx1 * dx2 + dy1 * dy2;
const cross = dx1 * dy2 - dy1 * dx2;
if (dot === 1) return 'through';
if (dot === -1) return 'u-turn';
if (cross === 1) return 'right';
if (cross === -1) return 'left';
throw new Error('invalid cardinal turn geometry');
```

The grid has `y` increasing downward; tests define the left/right contract. Omit default U-turn movements. Movement IDs are:

```ts
export const movementId = (junctionId: string, fromCarriagewayId: string, toCarriagewayId: string): string => `m:${junctionId}:${fromCarriagewayId}>${toCarriagewayId}`;
```

Movement lane membership includes open travel-capable lanes and excludes parking/shoulder. Default penalties are through=0, right=1, left=2 ticks. Effective permissions intersect incoming eligible lane permissions, movement permissions, and outgoing eligible lane permissions.

- [ ] **Step 4: Integrate authority projection and test explicit restrictions**

```ts
projectAuthorityIfNeeded(roads: RoadSystem): Readonly<{ authority: TransportNetworkAuthority; sourceRoadRevision: number }>;
```

Unchanged road revision returns the same authority projection object. Use `TransportNetworkStore.setMovementAllowed()` and `.setMovementPermissions()` to prove restrictions survive canonical snapshotting.

- [ ] **Step 5: Verify and commit**

```bash
node --experimental-strip-types --test tests/transport2-turn-movements.test.ts tests/transport2-legacy-projection.test.ts tests/transport2-network-store.test.ts
npm run typecheck
git add src/simulation/transportation/TurnMovementBuilder.ts src/simulation/transportation/LegacyRoadNetworkAdapter.ts tests/transport2-turn-movements.test.ts
git commit -m "feat: add explicit transport turn movements"
```

---

### Task 5: Derived lane groups and capacity conservation

**Files:**
- Create: `src/simulation/transportation/LaneGroupBuilder.ts`
- Create: `tests/transport2-lane-groups.test.ts`

**Interfaces:**
- Consumes: `TransportNetworkAuthority`.
- Produces: `buildLaneGroups(authority): readonly LaneGroup[]`.

- [ ] **Step 1: Write RED grouping tests**

Cover: two identical collector lanes merge to capacity 120; closed lanes are excluded; parking/shoulder are excluded; different permission masks split groups; different movement sets split groups.

```ts
const groups = buildLaneGroups(authority);
const group = groups.find((item) => item.carriagewayId === collectorCarriageway.id);
assert.equal(group?.laneIds.length, 2);
assert.equal(group?.capacityPerMinute, 120);
```

- [ ] **Step 2: Verify RED**

```bash
node --experimental-strip-types --test tests/transport2-lane-groups.test.ts
```

- [ ] **Step 3: Implement deterministic contiguous grouping**

Sort lanes by ordinal. Exclude closed, parking, and shoulder lanes. Build each lane's sorted movement-ID set from `TurnMovement.fromLaneIds`. Merge adjacent lanes only when permissions, free-flow speed, and movement-ID sets match. Use stable group ID `lg:${carriagewayId}:${laneIds.join('+')}`. Capacity is the exact sum; group speed is the minimum member speed.

- [ ] **Step 4: Add V7 conservation tests**

Assert projected lane-group capacities equal local=60, collector=120, arterial=240 within `1e-9`.

- [ ] **Step 5: Verify and commit**

```bash
node --experimental-strip-types --test tests/transport2-lane-groups.test.ts tests/transport2-legacy-projection.test.ts
npm run typecheck
git add src/simulation/transportation/LaneGroupBuilder.ts tests/transport2-lane-groups.test.ts
git commit -m "feat: derive transport lane groups"
```

---

### Task 6: Movement-aware routing topology

**Files:**
- Create: `src/simulation/transportation/RoutingTopology.ts`
- Create: `tests/transport2-routing-topology.test.ts`

**Interfaces:**
- Consumes: `TransportNetworkSnapshot`, `LaneGroup[]`.
- Produces: `RoutingState`, `RoutingArc`, `RoutingTopology`, `routingStateKey()`, `buildRoutingTopology()`.

```ts
export type RoutingState = Readonly<{ junctionId: JunctionId; incomingCarriagewayId?: CarriagewayId }>;
export type RoutingArc = Readonly<{ id: string; fromStateKey: string; toState: RoutingState; carriagewayId: CarriagewayId; laneGroupIds: readonly LaneGroupId[]; movementId?: TurnMovementId; permissions: VehiclePermissionMask; traversalTicks: number; movementPenaltyTicks: number }>;
```

- [ ] **Step 1: Write RED topology tests**

Assert origin states expose legal outgoing carriageways; entered-intersection states expose only movement-backed outgoing arcs; prohibited movements disappear; bus-only movements expose bus-only route permissions.

- [ ] **Step 2: Verify RED**

```bash
node --experimental-strip-types --test tests/transport2-routing-topology.test.ts
```

- [ ] **Step 3: Implement immutable indexes and state keys**

```ts
export const routingStateKey = (state: RoutingState): string => `${state.junctionId}|${state.incomingCarriagewayId ?? '-'}`;
```

Build junction→outgoing carriageways, carriageway→lane groups, and `(junction,incoming carriageway)`→allowed movements. For an origin state, emit outgoing traversal arcs with no movement penalty. For an entered state, emit an arc only when an authoritative allowed movement connects incoming→outgoing and effective permissions are nonzero. `toState` at the next junction uses `incomingCarriagewayId` equal to the traversed outgoing carriageway.

Traversal ticks use segment length and lane-group speed: convert KPH to meters/second and multiply seconds by 10 simulation ticks/second. Legacy one-cell segments must reproduce current `freeFlowTicks` within tolerance.

- [ ] **Step 4: Add no-fabricated-connectivity test**

Remove a left-turn movement from authority, rebuild topology, and assert no left-turn arc exists despite both physical carriageways still existing.

- [ ] **Step 5: Verify and commit**

```bash
node --experimental-strip-types --test tests/transport2-routing-topology.test.ts tests/transport2-turn-movements.test.ts tests/transport2-lane-groups.test.ts
npm run typecheck
git add src/simulation/transportation/RoutingTopology.ts tests/transport2-routing-topology.test.ts
git commit -m "feat: build movement aware routing topology"
```

---

### Task 7: Deterministic movement-aware pathfinding and cache invalidation

**Files:**
- Create: `src/simulation/transportation/MovementAwarePathfindingSystem.ts`
- Create: `tests/transport2-routing.test.ts`

**Interfaces:**
- Consumes: `RoutingTopology` with `revision` equal to the source snapshot's `topologyRevision`.
- Produces: `MovementRouteResult`, `MovementRouteOptions`, `MovementAwarePathfindingSystem.findRoute()` and diagnostics.

```ts
export type MovementRouteResult = Readonly<{ junctionIds: readonly JunctionId[]; carriagewayIds: readonly CarriagewayId[]; movementIds: readonly TurnMovementId[]; totalCost: number }>;
export type MovementRouteOptions = Readonly<{ permissions: VehiclePermissionMask; costEpoch: number; costKey?: string; arcCost?: (arc: RoutingArc) => number }>;
```

- [ ] **Step 1: Write RED route tests**

Cover direct route, prohibited-left detour, disconnected one-way route, bus-only shortcut rejected for private cars, deterministic equal-cost tie, and origin==destination zero-cost route.

- [ ] **Step 2: Verify RED**

```bash
node --experimental-strip-types --test tests/transport2-routing.test.ts
```

- [ ] **Step 3: Implement deterministic search**

Default cost:

```ts
const defaultArcCost = (arc: RoutingArc): number => arc.traversalTicks + arc.movementPenaltyTicks;
```

Reject arcs when `(arc.permissions & options.permissions) === 0` or cost is negative/non-finite. Use zero heuristic initially. Sort the open set by `f`, then `g`, then stable state key, then stable incoming arc ID. Reconstruct junction, carriageway, and movement sequences from predecessor records.

- [ ] **Step 4: Implement exact cache semantics**

```ts
const cacheKey = `${topology.revision}|${options.costEpoch}|${options.permissions}|${options.costKey ?? 'static'}|${startJunctionId}|${endJunctionId}`;
```

Do not cache custom `arcCost` when `costKey` is absent. A topology revision change clears all cache. A cost-epoch change causes a cache miss but does not rebuild `RoutingTopology`.

- [ ] **Step 5: Add diagnostics assertions**

Repeated identical request hits cache; `costEpoch+1` misses while topology object identity is unchanged; rebuilt topology with incremented revision clears cache.

- [ ] **Step 6: Verify and commit**

```bash
node --experimental-strip-types --test tests/transport2-routing.test.ts tests/transport2-routing-topology.test.ts
npm run typecheck
git add src/simulation/transportation/MovementAwarePathfindingSystem.ts tests/transport2-routing.test.ts
git commit -m "feat: add movement aware transport routing"
```

---

### Task 8: Legacy TransportationGraph compatibility parity

**Files:**
- Create: `src/simulation/transportation/LegacyTransportationGraphAdapter.ts`
- Modify: `src/simulation/traffic/TransportationGraph.ts`
- Create: `tests/transport2-compatibility.test.ts`

**Interfaces:**
- Consumes: legacy-projected 3R authority and current `TransportationNode`/`TransportationEdge` shapes.
- Produces: `TransportationGraphProjection`, `LegacyTransportationGraphAdapter.project()`, `TransportationGraph.loadProjection()`.

```ts
export type TransportationGraphProjection = Readonly<{ nodes: readonly TransportationNode[]; edges: readonly TransportationEdge[]; sourceRoadRevision: number }>;
```

- [ ] **Step 1: Write RED parity tests**

For local, mixed-class, intersection, and road-removal fixtures, build current `TransportationGraph` from `RoadSystem`, build 3R authority from the same roads, project back, load into a second graph, and compare sorted nodes/edges field-by-field. Run current `PathfindingSystem` on both and assert identical route nodes, edge IDs, and total cost.

- [ ] **Step 2: Verify RED**

```bash
node --experimental-strip-types --test tests/transport2-compatibility.test.ts
```

- [ ] **Step 3: Implement exact aggregate projection**

Map legacy junction `j:legacy:x,y` to node `n:x,y`; map directional carriageway to edge `e:n:x1,y1>n:x2,y2`. Require `operatingClass` to be local/collector/arterial for V7 compatibility. Use current `ROAD_DEFINITIONS[roadType]` for speed and intersection service rate, and use summed compatible open travel-lane capacity for `capacityPerMinute`:

```ts
freeFlowSpeedCellsPerSecond: definition.freeFlowSpeedCellsPerSecond,
freeFlowTicks: 10 / definition.freeFlowSpeedCellsPerSecond,
capacityPerMinute: summedLaneCapacity,
intersectionServiceRate: definition.intersectionServiceRate,
```

- [ ] **Step 4: Add `TransportationGraph.loadProjection()` through one shared private index-loader**

Refactor existing graph rebuild so both `rebuildIfNeeded(roads)` and `loadProjection()` feed a private routine that sorts nodes/edges and rebuilds `nodeById`, `edgeById`, and `outgoing`. Existing `rebuildIfNeeded()` behavior remains unchanged. Loading changed projection increments graph `revision`; unchanged identical projection returns false.

- [ ] **Step 5: Run transportation regression set**

```bash
node --experimental-strip-types --test tests/transport2-compatibility.test.ts tests/transport-graph.test.ts tests/traffic-routing.test.ts tests/traffic-simulation.test.ts tests/transit-routing.test.ts tests/transit-integration.test.ts tests/economy-freight-vehicles.test.ts tests/service-dispatch.test.ts tests/service-accessibility.test.ts
npm run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add src/simulation/transportation/LegacyTransportationGraphAdapter.ts src/simulation/traffic/TransportationGraph.ts tests/transport2-compatibility.test.ts
git commit -m "feat: preserve v7 transport graph compatibility"
```

---

### Task 9: Canonical determinism, 10k-road scale evidence, and full regression gate

**Files:**
- Create: `tests/transport2-scale-determinism.test.ts`
- Modify only when failing evidence identifies a defect: files created in Tasks 1–8.

**Interfaces:**
- Consumes: complete 3R-A stack.
- Produces: deterministic/scale acceptance evidence.

- [ ] **Step 1: Write canonical snapshot/route determinism test**

Build the same final legacy road set in two different placement orders, project both, load separate stores, and assert:

```ts
assert.equal(JSON.stringify(storeA.snapshot()), JSON.stringify(storeB.snapshot()));
assert.equal(JSON.stringify(routeA), JSON.stringify(routeB));
```

- [ ] **Step 2: Write 10,000-cell diagnostics test**

Use a 100×100 buildable terrain, sufficient treasury, and 10,000 unique road coordinates. After projection:

```ts
assert.equal(adapter.diagnostics.roadCellsVisited, 10_000);
assert.ok(adapter.diagnostics.adjacencyChecks <= 40_000);
const builds = adapter.diagnostics.builds;
const visited = adapter.diagnostics.roadCellsVisited;
const checks = adapter.diagnostics.adjacencyChecks;
adapter.projectIfNeeded(roads);
assert.equal(adapter.diagnostics.builds, builds);
assert.equal(adapter.diagnostics.roadCellsVisited, visited);
assert.equal(adapter.diagnostics.adjacencyChecks, checks);
```

- [ ] **Step 3: Add snapshot restore byte-equivalence test**

```ts
const snapshot = store.snapshot();
const restored = new TransportNetworkStore();
restored.restore(snapshot);
assert.equal(JSON.stringify(restored.snapshot()), JSON.stringify(snapshot));
```

Rebuild lane groups/routing topology after restore and assert derived output JSON equals pre-restore derived output JSON.

- [ ] **Step 4: Run focused 3R-A suite**

```bash
node --experimental-strip-types --test tests/transport2-*.test.ts
```

- [ ] **Step 5: Run full repository verification**

```bash
npm test
npm run typecheck
npm run lint
```

All commands must exit 0.

- [ ] **Step 6: Collect non-flaky performance evidence**

```bash
for i in 1 2 3; do time node --experimental-strip-types --test tests/transport2-scale-determinism.test.ts; done
```

Do not add wall-clock assertions. Diagnostics are the deterministic complexity gate. If the compatibility path materially regresses the current graph rebuild on the same fixture, optimize before merge.

- [ ] **Step 7: Commit acceptance evidence/fixes**

```bash
git add tests/transport2-scale-determinism.test.ts src/simulation/transportation src/simulation/traffic/TransportationGraph.ts
git commit -m "test: prove transport 2 determinism and scale"
```

---

## Final Review Checklist

- [ ] Six road classes exist.
- [ ] Stable IDs exist for segment/junction/carriageway/lane/movement.
- [ ] One-way topology works without reverse synthesis.
- [ ] Through, turn, bus, bike, parking, reversible, shoulder lane kinds are representable.
- [ ] Lane/movement permissions affect 2.0 legality.
- [ ] Junctions expose explicit movements.
- [ ] Default U-turn routing is prohibited.
- [ ] Prohibited turns detour or fail deterministically.
- [ ] Lane groups conserve capacity.
- [ ] V7 free-flow and capacity parity holds.
- [ ] Mixed-class source-edge behavior is preserved.
- [ ] `topologyRevision` invalidates physical route caches.
- [ ] `costEpoch` invalidates cost-sensitive caches without topology rebuild.
- [ ] No-op mutations/rebuilds do not inflate revisions.
- [ ] Snapshot→restore→snapshot is byte-equivalent.
- [ ] Existing traffic/transit/freight/service/kernel regressions remain green.
- [ ] 10k-road fixture proves bounded projection work via diagnostics.
- [ ] No new production coordinator violates file-size guidance.

Do not merge 3R-A while any checklist item remains unproven.