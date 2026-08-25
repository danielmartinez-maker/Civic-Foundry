# Civic Foundry 2.0 — 3R-A Transportation Network Semantics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first Transportation Engine 2.0 tranche: deterministic road-segment, carriageway, lane, movement, lane-group, and movement-aware routing semantics while preserving V7 road/traffic behavior through compatibility projection.

**Architecture:** Add a new authoritative `src/simulation/transportation/` domain beside the existing V7 road/traffic stack. `RoadSystem` remains the legacy source during this tranche; a deterministic adapter projects legacy road cells into stable 2.0 physical topology, derived movement/lane-group builders create routing semantics, and a separate movement-aware pathfinder consumes them. Existing `TransportationGraph`, `TrafficSystem`, transit, freight, and service routing remain compatible until parity tests are green.

**Tech Stack:** TypeScript ES modules, Node built-in test runner with `--experimental-strip-types`, existing `RoadSystem`/`TransportationGraph`/`PathfindingSystem`, deterministic sorted arrays/maps, no new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-08-25-transportation-engine-2.0-network-semantics-design.md`

## Global Constraints

- Same authoritative input must produce byte-equivalent canonical transport snapshots and equal-cost routes.
- `RoadSystem`, `TrafficSystem`, `IntersectionSystem`, transit, freight, service, and rendering remain current V7 owners/consumers during 3R-A.
- Do not implement signal execution, live congestion rerouting, parking occupancy/cruising, crash generation, weather effects, dynamic reversible-lane scheduling, lane-change microsimulation, lane-editing UI, parcel driveways, or transit schedules.
- V7 local/collector/arterial projection must preserve current directed adjacency, free-flow ticks, and aggregate directional capacity within `1e-9`.
- Mixed-class legacy adjacency must preserve current source-cell directional behavior.
- No-op mutations and unchanged derived rebuilds must not inflate authoritative revisions.
- `topologyRevision` invalidates topology/route caches; `costEpoch` invalidates cost-sensitive route caches without rebuilding physical topology.
- Persist only authoritative transport entities and revisions; lane groups/routing indexes/legacy projections remain derived.
- New normal source files target under 500 LOC; 750 LOC is an architecture warning and 1,000 LOC requires review.
- Do not add runtime dependencies.
- Test command: `node --experimental-strip-types --test <test-files>`.
- Full gates: `npm test`, `npm run typecheck`, and `npm run lint`.

## File Map

Create under `src/simulation/transportation/`:

- `TransportNetworkTypes.ts` — stable IDs, road/lane/movement types, permission masks, snapshot contracts, legacy class defaults.
- `TransportNetworkStore.ts` — authoritative network ownership, invariant validation, transactional mutations, revisions, snapshot/restore.
- `LegacyRoadNetworkAdapter.ts` — deterministic V7 road-cell → 2.0 physical-network projection and source-revision cache.
- `TurnMovementBuilder.ts` — deterministic legal turn-movement derivation/classification from physical topology.
- `LaneGroupBuilder.ts` — derived compatible-lane grouping and capacity aggregation.
- `RoutingTopology.ts` — movement-aware adjacency/index read model built from authoritative state + lane groups.
- `MovementAwarePathfindingSystem.ts` — deterministic A* / Dijkstra-style route search with topology/cost cache keys.
- `LegacyTransportationGraphAdapter.ts` — 2.0 → current aggregate graph projection for parity verification.

Modify:

- `src/simulation/traffic/TransportationGraph.ts` — add one narrow method that can load a validated derived projection without changing existing `rebuildIfNeeded(roads)` behavior.

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

### Task 1: Transport 2.0 types, six-class hierarchy, and permission primitives

**Files:**
- Create: `src/simulation/transportation/TransportNetworkTypes.ts`
- Create: `tests/transport2-types.test.ts`

**Interfaces:**
- Consumes: existing `RoadType` and `ROAD_DEFINITIONS` only for legacy mapping/calibration.
- Produces: `RoadClass`, ID aliases, `LaneKind`, `LaneOperatingState`, `VehiclePermission`, `VehiclePermissionMask`, `VEHICLE_PERMISSION`, `ALL_VEHICLE_PERMISSIONS`, `Junction`, `RoadSegment`, `Carriageway`, `Lane`, `TurnMovement`, `LaneGroup`, `TransportPhysicalNetwork`, `TransportNetworkAuthority`, `TransportNetworkSnapshot`, `TransportMutationResult`, `roadClassRank()`, `permissionMask()`, `hasPermission()`, and `intersectPermissions()`.

- [ ] **Step 1: Write the failing type/default tests**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ROAD_CLASSES,
  LEGACY_LANE_COUNT,
  VEHICLE_PERMISSION,
  permissionMask,
  hasPermission,
  intersectPermissions,
} from '../src/simulation/transportation/TransportNetworkTypes.ts';

test('3R road hierarchy contains all six ordered classes', () => {
  assert.deepEqual(ROAD_CLASSES, ['local', 'collector', 'arterial', 'avenue', 'expressway', 'highway']);
});

test('legacy road classes map to required lane counts', () => {
  assert.equal(LEGACY_LANE_COUNT.local, 1);
  assert.equal(LEGACY_LANE_COUNT.collector, 2);
  assert.equal(LEGACY_LANE_COUNT.arterial, 3);
});

test('permission masks compose and intersect deterministically', () => {
  const general = permissionMask('privateCar', 'taxiRideHail', 'lightCommercial');
  assert.equal(hasPermission(general, 'privateCar'), true);
  assert.equal(hasPermission(general, 'bus'), false);
  assert.equal(intersectPermissions(general, VEHICLE_PERMISSION.privateCar), VEHICLE_PERMISSION.privateCar);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
node --experimental-strip-types --test tests/transport2-types.test.ts
```

Expected: FAIL because `TransportNetworkTypes.ts` does not exist.

- [ ] **Step 3: Implement the complete public type contract**

Use these exact public unions and helper shapes:

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

export const VEHICLE_PERMISSION: Readonly<Record<VehiclePermission, number>> = Object.freeze({
  privateCar: 1 << 0,
  taxiRideHail: 1 << 1,
  lightCommercial: 1 << 2,
  heavyFreight: 1 << 3,
  bus: 1 << 4,
  emergency: 1 << 5,
  bicycle: 1 << 6,
});

export const ALL_VEHICLE_PERMISSIONS = Object.values(VEHICLE_PERMISSION).reduce((mask, value) => mask | value, 0);

export function permissionMask(...permissions: readonly VehiclePermission[]): VehiclePermissionMask {
  return permissions.reduce((mask, permission) => mask | VEHICLE_PERMISSION[permission], 0);
}

export function hasPermission(mask: VehiclePermissionMask, permission: VehiclePermission): boolean {
  return (mask & VEHICLE_PERMISSION[permission]) !== 0;
}

export function intersectPermissions(...masks: readonly VehiclePermissionMask[]): VehiclePermissionMask {
  return masks.length === 0 ? 0 : masks.reduce((value, mask) => value & mask);
}

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

Also implement `roadClassRank()` using the index in `ROAD_CLASSES`; reject unknown runtime input with an error rather than returning an arbitrary rank.

- [ ] **Step 4: Run the focused test and typecheck**

```bash
node --experimental-strip-types --test tests/transport2-types.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/simulation/transportation/TransportNetworkTypes.ts tests/transport2-types.test.ts
git commit -m "feat: add transport 2 network types"
```

---

### Task 2: Authoritative transport network store, invariants, revisions, and canonical snapshots

**Files:**
- Create: `src/simulation/transportation/TransportNetworkStore.ts`
- Create: `tests/transport2-network-store.test.ts`

**Interfaces:**
- Consumes: all authoritative entity types from Task 1.
- Produces: `TransportNetworkStore`, `validateTransportAuthority(authority)`, `snapshot()`, `restore(snapshot)`, `replaceAuthority(authority)`, `setLaneOperatingState()`, `setLanePermissions()`, `setMovementAllowed()`, `setMovementPermissions()`, and `advanceCostEpoch()`.

- [ ] **Step 1: Write RED tests for canonical ordering, rejection atomicity, and revision semantics**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { TransportNetworkStore } from '../src/simulation/transportation/TransportNetworkStore.ts';
import type { TransportNetworkAuthority } from '../src/simulation/transportation/TransportNetworkTypes.ts';

const authority: TransportNetworkAuthority = {
  junctions: [
    { id: 'j:b', x: 1, y: 0 },
    { id: 'j:a', x: 0, y: 0 },
  ],
  segments: [{ id: 's:a', roadClass: 'local', geometryRef: 'g:a', startJunctionId: 'j:a', endJunctionId: 'j:b', lengthMeters: 10, speedLimitKph: 30, condition: 1, accessPolicyId: 'all', carriagewayIds: ['c:a'] }],
  carriageways: [{ id: 'c:a', segmentId: 's:a', direction: 'forward', fromJunctionId: 'j:a', toJunctionId: 'j:b', operatingClass: 'local', laneIds: ['l:a'] }],
  lanes: [{ id: 'l:a', carriagewayId: 'c:a', ordinal: 0, kind: 'through', permissions: 127, operatingState: 'open', baseCapacityPerMinute: 60, freeFlowSpeedKph: 30 }],
  movements: [],
};

test('store canonicalizes snapshots and no-op mutations do not inflate topology revision', () => {
  const store = new TransportNetworkStore();
  assert.equal(store.replaceAuthority(authority).ok, true);
  const first = store.snapshot();
  assert.deepEqual(first.junctions.map((item) => item.id), ['j:a', 'j:b']);
  const revision = first.topologyRevision;
  assert.deepEqual(store.setLaneOperatingState('l:a', 'open'), { ok: true, changed: false });
  assert.equal(store.snapshot().topologyRevision, revision);
});

test('invalid replacement is atomic', () => {
  const store = new TransportNetworkStore();
  store.replaceAuthority(authority);
  const before = JSON.stringify(store.snapshot());
  const invalid = { ...authority, lanes: [{ ...authority.lanes[0]!, carriagewayId: 'missing' }] };
  assert.equal(store.replaceAuthority(invalid).ok, false);
  assert.equal(JSON.stringify(store.snapshot()), before);
});

test('cost epoch advances without topology revision', () => {
  const store = new TransportNetworkStore();
  store.replaceAuthority(authority);
  const topologyRevision = store.snapshot().topologyRevision;
  store.advanceCostEpoch();
  assert.equal(store.snapshot().topologyRevision, topologyRevision);
  assert.equal(store.snapshot().costEpoch, 1);
});
```

- [ ] **Step 2: Run RED**

```bash
node --experimental-strip-types --test tests/transport2-network-store.test.ts
```

Expected: FAIL because the store is absent.

- [ ] **Step 3: Implement store validation and transactional replacement**

Use private maps keyed by stable ID, but validate a complete candidate before swapping ownership. Validation must check: unique IDs, finite coordinates/numbers, segment endpoints, carriageway→segment/endpoints, lane→carriageway, unique lane ordinal per carriageway, movement junction/endpoints, movement lane membership, non-negative capacities/speeds, and finite penalties.

Public method signatures:

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

Mutation implementation pattern:

```ts
setLaneOperatingState(laneId: LaneId, state: LaneOperatingState): TransportMutationResult {
  const lane = this.lanes.get(laneId);
  if (!lane) return { ok: false, changed: false, reason: 'lane not found' };
  if (lane.operatingState === state) return { ok: true, changed: false };
  this.lanes.set(laneId, Object.freeze({ ...lane, operatingState: state }));
  this.topologyRevision++;
  return { ok: true, changed: true };
}
```

`restore()` must validate first, replace atomically, then restore exact non-negative integer revisions from the snapshot instead of incrementing them.

- [ ] **Step 4: Add invariant-specific tests**

Add cases rejecting duplicate lane ordinals, movement lanes from the wrong carriageway, movement incoming carriageways that do not terminate at the junction, negative capacity, and non-finite speed. Each case must assert the store snapshot is unchanged after rejection.

- [ ] **Step 5: Run focused and neighboring tests**

```bash
node --experimental-strip-types --test tests/transport2-types.test.ts tests/transport2-network-store.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/simulation/transportation/TransportNetworkStore.ts tests/transport2-network-store.test.ts
git commit -m "feat: add authoritative transport network store"
```

---

### Task 3: Deterministic legacy road → physical network projection

**Files:**
- Create: `src/simulation/transportation/LegacyRoadNetworkAdapter.ts`
- Create: `tests/transport2-legacy-projection.test.ts`

**Interfaces:**
- Consumes: `RoadSystem`, `ROAD_DEFINITIONS`, `LEGACY_LANE_COUNT`, `TransportPhysicalNetwork`.
- Produces: `LegacyRoadNetworkAdapter.projectIfNeeded(roads)`, `LegacyProjection`, stable ID helpers, and projection diagnostics.

Define:

```ts
export type LegacyProjection = Readonly<{
  physical: TransportPhysicalNetwork;
  sourceRoadRevision: number;
}>;

export type LegacyProjectionDiagnostics = Readonly<{
  builds: number;
  roadCellsVisited: number;
  adjacencyChecks: number;
}>;
```

- [ ] **Step 1: Write RED projection tests**

Build a three-cell local road and assert exact IDs/counts; build adjacent collector/arterial cells and assert each directional carriageway uses the source cell class; assert lane capacity sums match current aggregate edge capacity.

Core assertion pattern:

```ts
const projected = adapter.projectIfNeeded(roads);
assert.deepEqual(projected.physical.junctions.map((item) => item.id), ['j:legacy:2,5', 'j:legacy:3,5', 'j:legacy:4,5']);
assert.equal(projected.physical.segments.length, 2);
const forward = projected.physical.carriageways.find((item) => item.fromJunctionId === 'j:legacy:2,5' && item.toJunctionId === 'j:legacy:3,5');
assert.equal(forward?.operatingClass, 'local');
const forwardLanes = projected.physical.lanes.filter((lane) => lane.carriagewayId === forward?.id);
assert.equal(forwardLanes.reduce((sum, lane) => sum + lane.baseCapacityPerMinute, 0), 60);
```

- [ ] **Step 2: Run RED**

```bash
node --experimental-strip-types --test tests/transport2-legacy-projection.test.ts
```

Expected: FAIL because the adapter is absent.

- [ ] **Step 3: Implement stable legacy IDs and O(R + A) projection**

Use four cardinal adjacency checks per road cell, create each unordered adjacency only when `sourceKey.localeCompare(neighborKey) < 0`, and create both directional carriageways from that one physical segment.

Exact helper outputs:

```ts
export const legacyJunctionId = (x: number, y: number): string => `j:legacy:${x},${y}`;
export const legacySegmentId = (a: string, b: string): string => `s:legacy:${[a, b].sort().join('>')}`;
export const legacyCarriagewayId = (segmentId: string, from: string, to: string): string => `c:${segmentId}:${from}>${to}`;
export const legacyLaneId = (carriagewayId: string, ordinal: number): string => `l:${carriagewayId}:${ordinal}`;
```

For each direction, lane count comes from the source cell class. Per-lane capacity is `ROAD_DEFINITIONS[sourceType].weightedVehicleCapacityPerMinute / laneCount`. Convert V7 speed to a deterministic `freeFlowSpeedKph` using one project-wide constant `LEGACY_CELL_METERS`; choose and export `LEGACY_CELL_METERS = 10`, then verify that the reverse conversion in the compatibility adapter reproduces `freeFlowTicks` exactly within tolerance.

- [ ] **Step 4: Add unchanged-revision cache test**

```ts
const first = adapter.projectIfNeeded(roads);
const builds = adapter.diagnostics.builds;
const second = adapter.projectIfNeeded(roads);
assert.equal(second, first);
assert.equal(adapter.diagnostics.builds, builds);
roads.remove(3, 5);
assert.notEqual(adapter.projectIfNeeded(roads), first);
assert.equal(adapter.diagnostics.builds, builds + 1);
```

- [ ] **Step 5: Run focused tests**

```bash
node --experimental-strip-types --test tests/transport2-legacy-projection.test.ts tests/transport-graph.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/simulation/transportation/LegacyRoadNetworkAdapter.ts tests/transport2-legacy-projection.test.ts
git commit -m "feat: project legacy roads into lane topology"
```

---

### Task 4: Explicit deterministic turn movements and restriction semantics

**Files:**
- Create: `src/simulation/transportation/TurnMovementBuilder.ts`
- Create: `tests/transport2-turn-movements.test.ts`
- Modify: `src/simulation/transportation/LegacyRoadNetworkAdapter.ts`

**Interfaces:**
- Consumes: `TransportPhysicalNetwork` from Task 3.
- Produces: `buildTurnMovements(physical)`, `movementEffectivePermissions(movement, laneById)`, and adapter method `projectAuthorityIfNeeded(roads)` returning `TransportNetworkAuthority` with generated movements.

- [ ] **Step 1: Write RED movement tests for four-way and T junctions**

Create a plus-shaped five-cell road fixture. At the center, assert exactly 12 non-U-turn movements for four incoming × three legal non-reverse exits. For one incoming northbound carriageway, assert one `left`, one `through`, one `right`, and no `u-turn` movement.

Also add a T-junction fixture and assert only geometrically available movements are generated.

- [ ] **Step 2: Run RED**

```bash
node --experimental-strip-types --test tests/transport2-turn-movements.test.ts
```

Expected: FAIL because the builder is absent.

- [ ] **Step 3: Implement heading classification using coordinates**

Represent headings as integer vectors from carriageway `fromJunction` to `toJunction`. Reject zero-length or non-cardinal legacy geometry. For an incoming vector `(dx1, dy1)` and outgoing `(dx2, dy2)`:

```ts
const dot = dx1 * dx2 + dy1 * dy2;
const cross = dx1 * dy2 - dy1 * dx2;
if (dot === 1) return 'through';
if (dot === -1) return 'u-turn';
if (cross === 1) return 'right';
if (cross === -1) return 'left';
throw new Error('invalid cardinal turn geometry');
```

The game uses screen/grid `y` increasing downward, so the tests above are the authority for left/right semantics. Omit default U-turn movements entirely.

Generate stable IDs as:

```ts
export const movementId = (junctionId: string, fromCarriagewayId: string, toCarriagewayId: string): string =>
  `m:${junctionId}:${fromCarriagewayId}>${toCarriagewayId}`;
```

Movement lane membership uses open travel-capable incoming/outgoing lanes, excluding `parking` and `shoulder`. `permissions` is the intersection of the union of eligible incoming lane permissions and union of eligible outgoing lane permissions. Default `allowed` is true and default `basePenaltyTicks` is `0` for through, `1` for right, `2` for left.

- [ ] **Step 4: Add permission and prohibited-turn tests**

Use the store from Task 2 to set one movement `allowed=false` and verify the canonical snapshot retains that explicit restriction. Add a movement with bus-only permissions and assert `movementEffectivePermissions()` excludes private cars.

- [ ] **Step 5: Integrate movement generation into legacy authority projection**

Expose:

```ts
projectAuthorityIfNeeded(roads: RoadSystem): Readonly<{ authority: TransportNetworkAuthority; sourceRoadRevision: number }>;
```

This combines the cached physical projection with `buildTurnMovements()`; unchanged `RoadSystem.revision` returns the same authority projection object.

- [ ] **Step 6: Run tests and commit**

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
- Produces: `buildLaneGroups(authority): readonly LaneGroup[]` and `laneGroupMovementIndex(authority)`.

- [ ] **Step 1: Write RED grouping tests**

Cover these cases:

1. Legacy collector direction groups two identical through lanes into one group with capacity 120.
2. Closed lanes are omitted.
3. `parking` and `shoulder` lanes are omitted from normal travel groups.
4. Adjacent lanes with different permission masks produce separate groups.
5. Adjacent lanes with different downstream movement sets produce separate groups.

Representative assertion:

```ts
const groups = buildLaneGroups(authority);
const group = groups.find((item) => item.carriagewayId === collectorCarriageway.id);
assert.equal(group?.laneIds.length, 2);
assert.equal(group?.capacityPerMinute, 120);
```

- [ ] **Step 2: Run RED**

```bash
node --experimental-strip-types --test tests/transport2-lane-groups.test.ts
```

Expected: FAIL because the builder is absent.

- [ ] **Step 3: Implement deterministic contiguous grouping**

For each carriageway, sort lanes by ordinal. Exclude closed, parking, and shoulder lanes. Build each lane's sorted movement-ID set from `TurnMovement.fromLaneIds`; two adjacent lanes may merge only if permissions, free-flow speed, and movement-ID sets are equal. Group ID must be stable from carriageway and member lane IDs:

```ts
const groupId = `lg:${carriagewayId}:${laneIds.join('+')}`;
```

Capacity is the exact sum of member lane capacities. Free-flow speed is the minimum member lane speed so grouping never manufactures a faster path.

- [ ] **Step 4: Add legacy capacity-conservation assertions**

Project one local, one collector, and one arterial carriageway from Task 3/4 and assert group capacities equal `60`, `120`, and `240` respectively within `1e-9`.

- [ ] **Step 5: Run tests and commit**

```bash
node --experimental-strip-types --test tests/transport2-lane-groups.test.ts tests/transport2-legacy-projection.test.ts
npm run typecheck
git add src/simulation/transportation/LaneGroupBuilder.ts tests/transport2-lane-groups.test.ts
git commit -m "feat: derive transport lane groups"
```

---

### Task 6: Movement-aware routing topology read model

**Files:**
- Create: `src/simulation/transportation/RoutingTopology.ts`
- Create: `tests/transport2-routing-topology.test.ts`

**Interfaces:**
- Consumes: `TransportNetworkSnapshot`, derived `LaneGroup[]`.
- Produces: `RoutingState`, `RoutingArc`, `RoutingTopology`, `routingStateKey()`, `buildRoutingTopology(snapshot, laneGroups)`.

Use exact shapes:

```ts
export type RoutingState = Readonly<{ junctionId: JunctionId; incomingCarriagewayId?: CarriagewayId }>;
export type RoutingArc = Readonly<{
  id: string;
  fromStateKey: string;
  toState: RoutingState;
  carriagewayId: CarriagewayId;
  laneGroupIds: readonly LaneGroupId[];
  movementId?: TurnMovementId;
  permissions: VehiclePermissionMask;
  traversalTicks: number;
  movementPenaltyTicks: number;
}>;
```

- [ ] **Step 1: Write RED topology tests**

Assert that origin state at a junction exposes all legal outgoing carriageways; after entering an intersection, the state keyed by incoming carriageway exposes only arcs backed by authoritative allowed movements. Assert `allowed=false` movement disappears and bus-only movement exposes bus-only permissions.

- [ ] **Step 2: Run RED**

```bash
node --experimental-strip-types --test tests/transport2-routing-topology.test.ts
```

Expected: FAIL because routing topology is absent.

- [ ] **Step 3: Implement topology indexes**

Build immutable maps/indexes once per `snapshot.topologyRevision`:

- junction → outgoing carriageways;
- carriageway → compatible lane groups;
- `(junction,incoming carriageway)` → allowed movements;
- stable state key → sorted routing arcs.

Origin state key format:

```ts
export const routingStateKey = (state: RoutingState): string =>
  `${state.junctionId}|${state.incomingCarriagewayId ?? '-'}`;
```

Traversal ticks convert lane-group speed back to current simulation units using `LEGACY_CELL_METERS` and the carriageway segment length. For legacy one-cell segments, this must equal current `freeFlowTicks` within tolerance.

For a non-origin state, an arc exists only when a legal movement connects the incoming carriageway to the outgoing carriageway and effective permissions are nonzero. `movementPenaltyTicks` comes from the movement. At origins there is no movement penalty and no movement ID.

- [ ] **Step 4: Add no-fabricated-connectivity tests**

Delete a left-turn movement from an authority snapshot, rebuild topology, and assert no arc exists for that turn even though both physical carriageways still exist.

- [ ] **Step 5: Run tests and commit**

```bash
node --experimental-strip-types --test tests/transport2-routing-topology.test.ts tests/transport2-turn-movements.test.ts tests/transport2-lane-groups.test.ts
npm run typecheck
git add src/simulation/transportation/RoutingTopology.ts tests/transport2-routing-topology.test.ts
git commit -m "feat: build movement aware routing topology"
```

---

### Task 7: Deterministic movement-aware pathfinding and revision-aware caches

**Files:**
- Create: `src/simulation/transportation/MovementAwarePathfindingSystem.ts`
- Create: `tests/transport2-routing.test.ts`

**Interfaces:**
- Consumes: `RoutingTopology`, `topologyRevision`, `costEpoch`.
- Produces: `MovementRouteResult`, `MovementRouteOptions`, `MovementAwarePathfindingSystem.findRoute()` and diagnostics.

Define:

```ts
export type MovementRouteResult = Readonly<{
  junctionIds: readonly JunctionId[];
  carriagewayIds: readonly CarriagewayId[];
  movementIds: readonly TurnMovementId[];
  totalCost: number;
}>;

export type MovementRouteOptions = Readonly<{
  permissions: VehiclePermissionMask;
  costEpoch: number;
  costKey?: string;
  arcCost?: (arc: RoutingArc) => number;
}>;
```

- [ ] **Step 1: Write RED route tests**

Cover: direct route, prohibited-left-turn detour, no route when one-way/restrictions disconnect destination, bus-only shortcut rejected for private-car permissions, deterministic equal-cost tie, and origin==destination zero-cost route.

- [ ] **Step 2: Run RED**

```bash
node --experimental-strip-types --test tests/transport2-routing.test.ts
```

Expected: FAIL because pathfinding is absent.

- [ ] **Step 3: Implement deterministic search**

Use the existing `PathfindingSystem` principles: sorted open list, non-negative finite arc costs, deterministic ties. Default arc cost is:

```ts
const defaultArcCost = (arc: RoutingArc): number => arc.traversalTicks + arc.movementPenaltyTicks;
```

Filter arcs when `(arc.permissions & options.permissions) === 0`.

Stable queue ordering:

```ts
open.sort((a, b) => a.f - b.f || a.g - b.g || a.stateKey.localeCompare(b.stateKey) || a.viaArcId.localeCompare(b.viaArcId));
```

Use zero heuristic initially for correctness with movement-dependent costs; optimize later only with proof.

Reconstruct carriageways and movement IDs from predecessor records; omit origin's absent movement ID.

- [ ] **Step 4: Implement two-dimensional cache invalidation**

Cache key must include:

```ts
`${topology.revision}|${options.costEpoch}|${options.permissions}|${options.costKey ?? 'static'}|${startJunctionId}|${endJunctionId}`
```

If `arcCost` is supplied without `costKey`, do not cache. When topology revision changes, clear all cache. A new `costEpoch` must miss cost-sensitive cache but must not rebuild `RoutingTopology`.

- [ ] **Step 5: Add diagnostics tests**

Assert repeated identical request hits cache; `costEpoch+1` misses cache while topology object identity remains unchanged; topology rebuild/revision change clears cache.

- [ ] **Step 6: Run tests and commit**

```bash
node --experimental-strip-types --test tests/transport2-routing.test.ts tests/transport2-routing-topology.test.ts
npm run typecheck
git add src/simulation/transportation/MovementAwarePathfindingSystem.ts tests/transport2-routing.test.ts
git commit -m "feat: add movement aware transport routing"
```

---

### Task 8: Legacy TransportationGraph compatibility projection and V7 parity

**Files:**
- Create: `src/simulation/transportation/LegacyTransportationGraphAdapter.ts`
- Modify: `src/simulation/traffic/TransportationGraph.ts`
- Create: `tests/transport2-compatibility.test.ts`

**Interfaces:**
- Consumes: legacy-projected 3R authority, current `TransportationNode`/`TransportationEdge` shapes.
- Produces: `TransportationGraphProjection`, `LegacyTransportationGraphAdapter.project()`, and `TransportationGraph.loadProjection()`.

Define projection shape in the adapter:

```ts
export type TransportationGraphProjection = Readonly<{
  nodes: readonly TransportationNode[];
  edges: readonly TransportationEdge[];
  sourceRoadRevision: number;
}>;
```

Add this public method to `TransportationGraph` without changing `rebuildIfNeeded(roads)`:

```ts
loadProjection(projection: TransportationGraphProjection): boolean;
```

- [ ] **Step 1: Write RED parity tests against the existing graph builder**

For local, mixed collector/arterial, intersection, and road-removal fixtures:

1. Build current `TransportationGraph` from `RoadSystem`.
2. Build 3R authority from the same roads.
3. Project back via `LegacyTransportationGraphAdapter`.
4. Load into a second `TransportationGraph`.
5. Compare sorted public nodes/edges field-by-field, including `roadType`, `freeFlowTicks`, `capacityPerMinute`, and `intersectionServiceRate`.

Also run current `PathfindingSystem` over both graphs and assert identical `nodeIds`, `edgeIds`, and `totalCost`.

- [ ] **Step 2: Run RED**

```bash
node --experimental-strip-types --test tests/transport2-compatibility.test.ts
```

Expected: FAIL because the adapter/load method is absent.

- [ ] **Step 3: Implement exact legacy projection**

Map each legacy junction back to node ID `n:x,y`. For each legacy directional carriageway, emit edge ID exactly `e:n:x1,y1>n:x2,y2`. Derive current `RoadType` from `carriageway.operatingClass`; legacy projection must reject `avenue`, `expressway`, or `highway` because current `TransportationEdge.roadType` cannot represent them.

Recompute current fields from `ROAD_DEFINITIONS[roadType]` rather than from rounded KPH values:

```ts
freeFlowSpeedCellsPerSecond: definition.freeFlowSpeedCellsPerSecond,
freeFlowTicks: 10 / definition.freeFlowSpeedCellsPerSecond,
capacityPerMinute: sumCompatibleLaneCapacity,
intersectionServiceRate: definition.intersectionServiceRate,
```

- [ ] **Step 4: Implement `TransportationGraph.loadProjection()` by reusing one private index rebuild helper**

Refactor current `rebuildIfNeeded()` so both legacy road rebuilding and projection loading call a private method that sorts nodes/edges and rebuilds `nodeById`, `edgeById`, and `outgoing`. Existing public behavior and tests must remain unchanged.

`loadProjection()` returns false when `sourceRoadRevision` and all projected IDs/fields match the currently loaded projection; otherwise it loads the projection, increments graph `revision`, and updates `sourceRoadRevision`.

- [ ] **Step 5: Run the complete transportation compatibility set**

```bash
node --experimental-strip-types --test tests/transport2-compatibility.test.ts tests/transport-graph.test.ts tests/traffic-routing.test.ts tests/traffic-simulation.test.ts tests/transit-routing.test.ts tests/transit-integration.test.ts tests/economy-freight-vehicles.test.ts tests/service-dispatch.test.ts tests/service-accessibility.test.ts
npm run typecheck
```

Expected: PASS with no current consumer switched to 2.0 routing.

- [ ] **Step 6: Commit**

```bash
git add src/simulation/transportation/LegacyTransportationGraphAdapter.ts src/simulation/traffic/TransportationGraph.ts tests/transport2-compatibility.test.ts
git commit -m "feat: preserve v7 transport graph compatibility"
```

---

### Task 9: Canonical determinism, 10k-road scale evidence, and full regression gate

**Files:**
- Create: `tests/transport2-scale-determinism.test.ts`
- Modify only if required by failing evidence: files introduced in Tasks 1–8.

**Interfaces:**
- Consumes: complete 3R-A stack.
- Produces: acceptance evidence for canonical snapshot determinism, O(1) unchanged-source projection checks, bounded adjacency work, route determinism, and full V7 regression compatibility.

- [ ] **Step 1: Write canonical snapshot determinism test**

Build the same legacy road set in two different placement orders that result in the same final `RoadSystem` cells, project both, load into separate stores, and assert:

```ts
assert.equal(JSON.stringify(storeA.snapshot()), JSON.stringify(storeB.snapshot()));
```

Build movement topology/lane groups and run the same equal-cost route on both; assert identical route JSON.

- [ ] **Step 2: Write 10,000-cell projection diagnostics test**

Use a `100 x 100` buildable `TerrainGrid`, sufficient treasury, and one 10,000-cell road placement covering every coordinate exactly once. After projection assert:

```ts
assert.equal(adapter.diagnostics.roadCellsVisited, 10_000);
assert.ok(adapter.diagnostics.adjacencyChecks <= 40_000);
const builds = adapter.diagnostics.builds;
adapter.projectIfNeeded(roads);
assert.equal(adapter.diagnostics.builds, builds);
```

Also assert the second unchanged call does not increase `roadCellsVisited` or `adjacencyChecks`.

- [ ] **Step 3: Add snapshot restore byte-equivalence test**

```ts
const snapshot = store.snapshot();
const restored = new TransportNetworkStore();
restored.restore(snapshot);
assert.equal(JSON.stringify(restored.snapshot()), JSON.stringify(snapshot));
```

Then rebuild lane groups/routing topology from the restored snapshot and assert derived state is identical to the pre-restore derived state.

- [ ] **Step 4: Run the focused 3R-A suite**

```bash
node --experimental-strip-types --test tests/transport2-*.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run full repository verification**

```bash
npm test
npm run typecheck
npm run lint
```

Expected: all commands exit 0.

- [ ] **Step 6: Record performance evidence only if compatibility rebuild materially regresses**

Run the 10k test three times with Node timing outside the authoritative test assertion:

```bash
for i in 1 2 3; do time node --experimental-strip-types --test tests/transport2-scale-determinism.test.ts; done
```

If the new compatibility path materially exceeds the current graph rebuild on the same fixture, optimize the adapter/index construction before merge. Do not add flaky wall-clock thresholds to the unit test; diagnostics are the deterministic complexity gate.

- [ ] **Step 7: Commit final acceptance tests/fixes**

```bash
git add tests/transport2-scale-determinism.test.ts src/simulation/transportation src/simulation/traffic/TransportationGraph.ts
git commit -m "test: prove transport 2 determinism and scale"
```

---

## Final Review Checklist

After Task 9, verify all 18 design acceptance criteria explicitly:

- [ ] Six road classes exist.
- [ ] Stable deterministic IDs exist for segment/junction/carriageway/lane/movement.
- [ ] One-way topology is representable without reverse synthesis.
- [ ] All seven lane kinds are representable.
- [ ] Lane/movement permissions affect 2.0 legality.
- [ ] Junctions expose explicit movements.
- [ ] Default U-turn routing is prohibited.
- [ ] Prohibited turns detour or fail deterministically.
- [ ] Lane groups conserve capacity.
- [ ] V7 free-flow and capacity parity holds.
- [ ] Mixed-class source-edge behavior is preserved.
- [ ] `topologyRevision` invalidates physical route caches.
- [ ] `costEpoch` invalidates cost-sensitive caches only.
- [ ] No-op mutations/rebuilds do not inflate revisions.
- [ ] Snapshot→restore→snapshot is byte-equivalent.
- [ ] Existing traffic/transit/freight/service/kernel regressions remain green.
- [ ] 10k-road fixture proves bounded/linear projection work via diagnostics.
- [ ] No new production coordinator violates file-size guidance.

Do not merge 3R-A if any checklist item is unproven.