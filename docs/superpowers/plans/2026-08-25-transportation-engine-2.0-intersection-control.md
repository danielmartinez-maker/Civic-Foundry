# Civic Foundry 2.0 — 3R-B Intersection Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Civic Foundry's live generic node-capacity intersection behavior with deterministic U.S.-style movement-aware intersection control for ordinary and service traffic, then make Save V9 canonical without breaking V3–V8 loading.

**Architecture:** 3R-B builds on 3R-A `TransportNetworkAuthority`, explicit `TurnMovementId`s, and derived `LaneGroup`s. Pure builders derive crossings, conflicts, hierarchy-based plans, fixed-time signals, and arterial coordination; focused runtime units own movement queues, right-of-way, signal/pedestrian continuation, and priority requests; `IntersectionControlSystem` orchestrates those pieces and is stepped exactly once per simulation tick. Legacy route planning remains edge-based through an indexed edge-to-movement resolver. `LegacySimulationCore.intersections` remains an inert old `IntersectionSystem` only while V3–V8 hydration needs somewhere to restore its historical queue snapshot; **all live vehicle movement uses `intersectionControl`**.

**Tech Stack:** TypeScript ES modules, Node 22 built-in test runner, existing 3R-A transportation modules, deterministic simulation kernel, GitHub Actions CI.

**Spec:** `docs/superpowers/specs/2026-08-25-transportation-engine-2.0-intersection-control-design.md`

**Persistence amendment:** `docs/superpowers/specs/2026-08-25-transportation-engine-2.0-intersection-control-save-v9-amendment.md` — authoritative over all Save V8/V7→V8 wording in the original spec.

## Global Constraints

- U.S. right-hand traffic; FHWA MUTCD 11th Edition with Revision 1 is the engineering reference, not a state-by-state legal database.
- `expressway` and `highway` are controlled-access mainline classes; ordinary at-grade STOP/YIELD/signal control is invalid there.
- `IntersectionControlSystem` is the sole **live** intersection authority for ordinary and service vehicles.
- Old `IntersectionSystem` may exist only as a historical V3–V8 hydration/serialization compatibility container and must never be stepped live after cutover.
- Legacy edge routes remain supported; do not force native 3R route migration in this tranche.
- Automatic control assignment is deterministic, hierarchy/demand based, reviewed only at fixed epochs, and hysteretic.
- Protected/permissive lefts are normal; protected-only remains explicit.
- RTOR defaults enabled under U.S. policy but still requires stop compliance, a safe gap, no active pedestrian conflict, and no prohibition.
- Pedestrian WALK/change/clearance is explicit runtime state; no pedestrian microsimulation.
- Emergency preemption outranks transit priority but cannot bypass safe clearance.
- Adaptive optimization, crashes, parking search, weather control, reversible-lane scheduling, and microscopic lane changing are deferred.
- Save V9 canonical values: `saveVersion: 9`, `gameVersion: '0.9.0-intersection-control'`; V8 and older remain supported load inputs.
- TDD every task: failing test → verify RED → minimal implementation → verify GREEN/regressions → commit.
- Hot paths use indexes. Never add per-vehicle whole-authority `.find()`/`.filter()` scans.
- A lane group has one per-tick discharge budget shared by every movement that uses it; compatible movements may not multiply that capacity.
- Final gate: `npm test`, `npm run typecheck`, `npm run lint`, `npm run assets:check`, `npm run build`, `npm run test:smoke`, `npm run test:smoke:phase7`, `npm run test:smoke:isometric`.

---

## File Structure

**Create** under `src/simulation/transportation/`:
`IntersectionControlTypes.ts`, `LegacyRouteMovementResolver.ts`, `PedestrianCrossingBuilder.ts`, `ConflictMatrixBuilder.ts`, `ControlPlanBuilder.ts`, `SignalPlanBuilder.ts`, `MovementQueueStore.ts`, `UnsignalizedController.ts`, `PedestrianController.ts`, `SignalController.ts`, `SignalCoordinationBuilder.ts`, `PriorityController.ts`, `IntersectionControlSystem.ts`, `IntersectionControlMigration.ts`.

**Create** `src/save/saveV9.ts`.

**Modify:** `src/simulation/traffic/TrafficSystem.ts`, `src/simulation/services/ServiceVehicleSystem.ts`, `src/simulation/core/LegacySimulationCore.ts`, `src/save/save.ts`, `docs/SAVE_FORMAT.md`, `docs/ARCHITECTURE.md`, `docs/SIMULATION.md`.

Do not repurpose `src/simulation/traffic/IntersectionSystem.ts`; it remains historical compatibility code unless a narrowly scoped regression fix is required.

---

### Task 1: Define public control, queue, signal, pedestrian, policy, demand, and snapshot types

**Files:**
- Create: `src/simulation/transportation/IntersectionControlTypes.ts`
- Test: `tests/transport3r-intersection-types.test.ts`

**Produces:**

```ts
export type PedestrianCrossingId = string;
export type SignalPhaseId = string;
export type JunctionControlType = 'uncontrolled' | 'yield' | 'twoWayStop' | 'allWayStop' | 'signal' | 'merge' | 'diverge' | 'rampTerminal';
export type MovementServiceState = 'prohibited' | 'stop' | 'yield' | 'permissive' | 'protected' | 'clearance';
export type QueuePriority = 'normal' | 'transit' | 'emergency';

export type MovementQueueEntry = Readonly<{
  vehicleId: string;
  movementId: TurnMovementId;
  laneGroupIds: readonly LaneGroupId[];
  travelerWeight: number; // remaining queued weight
  queuedTick: number;
  priority: QueuePriority;
  stoppedSinceTick?: number;
  released?: boolean;
}>;

export const US_INTERSECTION_POLICY = Object.freeze({
  rightTurnOnRed: true,
  minimumStopTicks: 10,
  controlReviewTicks: 6000,
  signalEnterScore: 100,
  signalExitScore: 80,
  allWayStopEnterScore: 70,
  allWayStopExitScore: 55,
  pedestrianWalkTicks: 70,
  pedestrianWalkingSpeedMps: 1.1,
});

export function isControlledAccessRoadClass(value: RoadClass): boolean {
  return value === 'expressway' || value === 'highway';
}
```

`IntersectionControlSnapshot` is canonical sorted readonly arrays of plans, queues, signal runtime, pedestrian runtime, priority requests, coordination groups, overrides plus `controlPlanRevision`, `controlRuntimeEpoch`, and `lastPlanReviewTick`.

- [ ] **Step 1:** Write tests asserting the exact defaults above, controlled-access classification, and validator rejection of negative/non-finite timing/weight values.
- [ ] **Step 2:** Run `node --experimental-strip-types --test tests/transport3r-intersection-types.test.ts`; verify module-not-found/undefined-symbol RED.
- [ ] **Step 3:** Implement the types/defaults and validation functions exactly as specified; use readonly arrays in persisted types, never `Map`/`Set`.
- [ ] **Step 4:** Run focused test and `npm run typecheck`; require PASS.
- [ ] **Step 5:** `git add src/simulation/transportation/IntersectionControlTypes.ts tests/transport3r-intersection-types.test.ts && git commit -m "feat: define 3R-B intersection control types"`.

---

### Task 2: Resolve legacy route edge pairs to explicit 3R movements

**Files:**
- Create: `src/simulation/transportation/LegacyRouteMovementResolver.ts`
- Test: `tests/transport3r-route-movement-resolver.test.ts`

**Interface:**

```ts
export type ResolvedRouteMovement = Readonly<{
  junctionId: JunctionId;
  movementId: TurnMovementId;
  fromCarriagewayId: CarriagewayId;
  toCarriagewayId: CarriagewayId;
  laneGroupIds: readonly LaneGroupId[];
}>;

export class LegacyRouteMovementResolver {
  constructor(authority: TransportNetworkAuthority, laneGroups: readonly LaneGroup[]);
  resolve(currentEdgeId: string, nextEdgeId: string): ResolvedRouteMovement | undefined;
}
```

- [ ] **Step 1:** RED tests on a plus-shaped projected `RoadSystem`: straight/right/left resolve; malformed, non-contiguous, and default-prohibited U-turn pairs return `undefined`; returned lane groups are incoming groups whose `movementIds` contain the movement.
- [ ] **Step 2:** Run focused test; verify RED.
- [ ] **Step 3:** Implement canonical parser/indexes:

```ts
const EDGE = /^e:n:(-?\d+),(-?\d+)>n:(-?\d+),(-?\d+)$/;
// constructor builds:
// junctionPair -> carriageway
// fromCarriageway>toCarriageway -> movement
// movementId -> incoming lane groups
```

Reuse `legacyJunctionId(x,y)`. `resolve()` is parsing + map lookups only.
- [ ] **Step 4:** Run focused test, `tests/transport2-compatibility.test.ts`, `tests/transport2-turn-movements.test.ts`; require PASS.
- [ ] **Step 5:** Commit `feat: resolve legacy routes to 3R movements`.

---

### Task 3: Derive pedestrian crossings and deterministic physical conflicts

**Files:**
- Create: `src/simulation/transportation/PedestrianCrossingBuilder.ts`
- Create: `src/simulation/transportation/ConflictMatrixBuilder.ts`
- Test: `tests/transport3r-conflicts.test.ts`

**Interfaces:**

```ts
export function buildPedestrianCrossings(authority: TransportNetworkAuthority, laneGroups: readonly LaneGroup[]): readonly PedestrianCrossing[];

export type ConflictParticipantId = TurnMovementId | PedestrianCrossingId;
export type JunctionConflictMatrix = Readonly<{
  junctionId: JunctionId;
  participants: readonly ConflictParticipantId[];
  conflicts(a: ConflictParticipantId, b: ConflictParticipantId): boolean;
}>;

export function buildConflictMatrices(authority: TransportNetworkAuthority, crossings: readonly PedestrianCrossing[]): readonly JunctionConflictMatrix[];
```

- [ ] **Step 1:** RED crossing tests: one stable candidate crossing per leg at a cardinal four-leg surface junction; ID `pc:<junctionId>:<stable-leg-signature>`; length `Math.max(7, crossedTravelLaneCount * 3.6)` meters; do not fabricate ordinary mainline crossings across controlled-access classes.
- [ ] **Step 2:** RED conflict tests: opposing through compatible; left/opposing-through conflict; perpendicular-through conflict; distinct-departure rights compatible; same constrained departure group conflicts; crossing pedestrian conflicts; symmetric; no self-conflict; shuffled input gives same serialized matrix.
- [ ] **Step 3:** Run focused test; verify RED.
- [ ] **Step 4:** Implement stable crossing derivation and private cardinal path geometry:

```ts
for (const junction of sortedJunctions) {
  const incoming = incomingByJunction.get(junction.id) ?? [];
  // derive surface crossing definitions from stable leg headings/lane counts
  // derive movement path as incoming endpoint -> junction center -> outgoing endpoint
  // segment-intersection + same-departure checks populate a symmetric Set<string>
}
```

Keep cardinal math private so public APIs can support later non-cardinal geometry.
- [ ] **Step 5:** Run focused test twice; require identical results/PASS.
- [ ] **Step 6:** Commit `feat: derive intersection crossings and conflicts`.

---

### Task 4: Build deterministic U.S. control plans and fixed-time signal plans

**Files:**
- Create: `src/simulation/transportation/ControlPlanBuilder.ts`
- Create: `src/simulation/transportation/SignalPlanBuilder.ts`
- Test: `tests/transport3r-control-plans.test.ts`

**Exact automatic rules:**

```ts
// before overrides/signal escalation
local x local: total demand < 20/min => uncontrolled; otherwise yield on stable lower-priority approach
local x collector: minor local => yield if minor demand < 20/min, otherwise twoWayStop
local x arterial: minor local => twoWayStop
collector x collector: twoWayStop; allWayStop when allWayStop score >= 70
collector x arterial: twoWayStop until signal score >= 100
arterial x arterial: twoWayStop until signal score >= 100
```

For equal hierarchy, major approach is greater demand; stable carriageway ID breaks exact demand ties.

**Signal score:**

```ts
score = hierarchyBase
  + Math.min(40, totalMovementDemandPerMinute * 0.25)
  + Math.min(20, pedestrianDemandPerMinute * 0.5)
  + Math.min(20, leftTurnDemandPerMinute * 0.5)
  + Math.min(20, conflictCount * 2)
  + Math.min(20, crashRiskScore * 20);
```

Bases: 20 local/local, 35 local/collector, 50 collector/collector, 65 collector/arterial, 80 arterial/arterial. Only collector/arterial and arterial/arterial are signal-eligible by this first automatic policy. Existing signal exits only below score 80 at a review epoch. Existing all-way STOP exits only below score 55.

- [ ] **Step 1:** RED tests for every rule above, 6000-tick review cadence, hysteresis, valid override persistence, invalid freeway/highway at-grade override rejection, and merge/diverge/ramp-terminal controlled-access validity.
- [ ] **Step 2:** Run focused test; verify RED.
- [ ] **Step 3:** Implement automatic selection/override validation with deterministic sorted inputs and no-op comparison:

```ts
if (!topologyChanged && !overrideChanged && tick - lastPlanReviewTick < policy.controlReviewTicks) return previous;
const next = buildCandidatePlans(...);
return { plans: canonical(next), changed: !samePlans(previous, next), reviewedAtTick: tick };
```

- [ ] **Step 4:** Implement fixed signal plan generation: opposite compatible through/right groups; lefts permissive by default; protected-left phase only when policy/override flags `protectedOnly`; throw if any protected pair conflicts.
- [ ] **Step 5:** Use exact timing:

```ts
const yellowTicks = clamp(Math.round((3 + speedKph / 80) * 10), 30, 50);
const allRedTicks = clamp(Math.round((junctionClearanceMeters / Math.max(speedKph / 3.6, 1)) * 10), 10, 30);
const minimumGreenTicks = 80;
```

Distribute green above minimum deterministically by phase demand; stable phase ID breaks ties.
- [ ] **Step 6:** Run focused test + typecheck; require PASS.
- [ ] **Step 7:** Commit `feat: build U.S. intersection control plans`.

---

### Task 5: Implement authoritative movement queues and pending releases

**Files:**
- Create: `src/simulation/transportation/MovementQueueStore.ts`
- Test: `tests/transport3r-movement-queues.test.ts`

**Interface:**

```ts
export class MovementQueueStore {
  enqueue(entry: MovementQueueEntry): boolean;
  peek(movementId: TurnMovementId): MovementQueueEntry | undefined;
  entries(movementId?: TurnMovementId): readonly MovementQueueEntry[];
  serve(movementId: TurnMovementId, capacityWeight: number): readonly string[];
  acknowledge(vehicleId: string): void;
  removeVehicle(vehicleId: string): void;
  hasVehicle(vehicleId: string): boolean;
  pendingReleasedIds(): readonly string[];
  snapshot(): MovementQueueSnapshot;
  restore(snapshot: MovementQueueSnapshot, validMovementIds: ReadonlySet<string>, validLaneGroupIds: ReadonlySet<string>): void;
}
```

- [ ] **Step 1:** RED tests: one active queue location per vehicle; deterministic head order; partial weighted service; pending release returned but not charged twice; acknowledge/remove; duplicate/unknown restore rejection; canonical snapshot order.
- [ ] **Step 2:** Run focused test; verify RED.
- [ ] **Step 3:** Implement three indexes:

```ts
private readonly queuesByMovement = new Map<TurnMovementId, MutableEntry[]>();
private readonly vehicleLocation = new Map<string, TurnMovementId>();
private readonly pendingReleased = new Map<string, PendingRelease>();
```

`serve()` reduces remaining `travelerWeight`; at zero it removes queue membership and inserts pending release. Queue store never itself grants emergency right-of-way.
- [ ] **Step 4:** Run focused test twice; require PASS/identical snapshots.
- [ ] **Step 5:** Commit `feat: add movement-aware intersection queues`.

---

### Task 6: Implement unsignalized STOP/YIELD/all-way-stop/gap acceptance

**Files:**
- Create: `src/simulation/transportation/UnsignalizedController.ts`
- Test: `tests/transport3r-unsignalized.test.ts`

- [ ] **Step 1:** RED tests: minimum 10-tick STOP dwell; clear YIELD gap; blocked YIELD; major-street priority; all-way STOP completed-stop arrival ordering; simultaneous arrivals resolved by geometric priority, then movement ID, then vehicle ID; active pedestrian conflict blocks service.
- [ ] **Step 2:** Run focused test; verify RED.
- [ ] **Step 3:** Implement exact gap rule:

```ts
const base = movement.turnKind === 'right' ? 20 : movement.turnKind === 'through' ? 30 : 40;
const speedPenalty = Math.round(Math.max(0, approachSpeedKph - 40) / 10) * 5;
const heavyPenalty = isHeavyFreight ? 10 : 0;
return base + speedPenalty + heavyPenalty;
```

A waiting higher-priority conflicting head blocks entry; otherwise `tick - lastConflictReleaseTick` must meet required gap. No RNG.
- [ ] **Step 4:** Run focused test + `tests/transport2-turn-movements.test.ts`; require PASS.
- [ ] **Step 5:** Commit `feat: add U.S. unsignalized right of way`.

---

### Task 7: Implement pedestrian runtime and fixed-time signal execution

**Files:**
- Create: `src/simulation/transportation/PedestrianController.ts`
- Create: `src/simulation/transportation/SignalController.ts`
- Test: `tests/transport3r-pedestrians.test.ts`
- Test: `tests/transport3r-signals.test.ts`

- [ ] **Step 1:** RED pedestrian tests: WALK admits aggregate demand; change interval admits no new crossing demand; residual occupancy lasts `Math.ceil(crossingLengthMeters / 1.1 * 10)` ticks; conflicting permissive turn observes occupancy; snapshot/restore mid-clearance exact.
- [ ] **Step 2:** Implement pedestrian runtime state machine:

```ts
type PedestrianInterval = 'hold' | 'walk' | 'change' | 'clearance';
// derived crossing definitions are immutable; persist interval/elapsed/occupancy only
```

Run pedestrian tests; require PASS.
- [ ] **Step 3:** RED signal tests: protected through, protected/permissive left, protected-only left, yellow, all-red, RTOR stop→yield behavior, RTOR disabled, pedestrian blocking, mid-phase snapshot/restore.
- [ ] **Step 4:** Implement signal runtime:

```ts
type SignalRuntimeMode = 'green' | 'yellow' | 'allRed';
// plan intervals remain fixed until plan revision changes
// permissive returns permissive, never protected
// RTOR returns stop before dwell and yield afterward
```

- [ ] **Step 5:** Run both focused files + typecheck; require PASS.
- [ ] **Step 6:** Commit `feat: execute pedestrian and signal control`.

---

### Task 8: Add arterial coordination and priority/preemption

**Files:**
- Create: `src/simulation/transportation/SignalCoordinationBuilder.ts`
- Create: `src/simulation/transportation/PriorityController.ts`
- Test: `tests/transport3r-priority-coordination.test.ts`

- [ ] **Step 1:** RED coordination fixture: three contiguous arterial signals form one stable group; common compatible cycle; each offset is cumulative free-flow travel ticks modulo cycle; shuffled input unchanged; unrelated local signal excluded.
- [ ] **Step 2:** Implement stable corridor grouping:

```ts
const offsetTicks = cumulativeTravelTicks % cycleTicks;
const id = `scg:${stableCorridorSignature}`;
```

Run coordination tests; require PASS.
- [ ] **Step 3:** RED priority tests: emergency outranks transit; expiry works; incompatible emergency request demands safe transition before grant; transit priority only boundedly advances/extends compatible phase; ordering is kind → requestedTick → requestId.
- [ ] **Step 4:** Implement request store/selection with same-ID refresh, canonical snapshot/restore, and no topology mutation.
- [ ] **Step 5:** Run focused test; require PASS.
- [ ] **Step 6:** Commit `feat: coordinate signals and priority requests`.

---

### Task 9: Assemble the sole live `IntersectionControlSystem`

**Files:**
- Create: `src/simulation/transportation/IntersectionControlSystem.ts`
- Test: `tests/transport3r-intersection-control.test.ts`

**API:**

```ts
export class IntersectionControlSystem {
  syncNetwork(authority: TransportNetworkAuthority, laneGroups: readonly LaneGroup[], demand: IntersectionControlDemandSnapshot, tick: number): void;
  enqueue(entry: MovementQueueEntry): boolean;
  requiresQueue(movementId: TurnMovementId): boolean;
  step(tick: number): readonly string[];
  acknowledge(vehicleId: string): void;
  removeVehicle(vehicleId: string): void;
  submitPriorityRequest(request: IntersectionPriorityRequest): void;
  setOverride(override: JunctionControlOverride): void;
  clearOverride(junctionId: JunctionId): void;
  planFor(junctionId: JunctionId): JunctionControlPlan | undefined;
  queueLength(junctionId?: JunctionId): number;
  snapshot(): IntersectionControlSnapshot;
  restore(snapshot: IntersectionControlSnapshot, authority: TransportNetworkAuthority, laneGroups: readonly LaneGroup[]): void;
}
```

- [ ] **Step 1:** RED orchestration tests: control gates movement; conflict prevents incompatible same-window release; same-tick `step()` cannot double-spend; topology rebuild/no-op revision semantics; override behavior; simple degree-2 non-conflicting `uncontrolled` continuation makes `requiresQueue()` false.
- [ ] **Step 2:** RED capacity-conservation test: two otherwise compatible movements sharing one incoming lane group may collectively consume at most that group's `capacityPerMinute / 600` weight in a simulation tick.
- [ ] **Step 3:** Run focused test; verify RED.
- [ ] **Step 4:** Implement indexes and shared lane-group budgets:

```ts
const laneBudget = new Map<LaneGroupId, number>();
for (const group of activeGroups) laneBudget.set(group.id, group.capacityPerMinute / 600);
const movementBudget = Math.min(...entry.laneGroupIds.map(id => laneBudget.get(id) ?? 0));
// after service, subtract consumed weight from every lane group used by that queue entry
```

Index movement→junction, movement→incoming groups, carriageway→speed, junction→matrix, junction→plan. Step only active queued/pedestrian/signal/priority junctions. Track last conflict release tick. Return all pending-released IDs sorted; controller does not know owning subsystem.
- [ ] **Step 5:** Run all focused 3R-B tests to date; require PASS.
- [ ] **Step 6:** Commit `feat: add authoritative intersection control system`.

---

### Task 10: Cut ordinary `TrafficSystem` to the new controller without stepping it

**Files:**
- Modify: `src/simulation/traffic/TrafficSystem.ts`
- Test: `tests/transport3r-live-traffic.test.ts`
- Regression: `tests/traffic-simulation.test.ts`, `tests/traffic-routing.test.ts`

**New signature:**

```ts
step(
  graph: TransportationGraph,
  controls: IntersectionControlSystem,
  resolver: LegacyRouteMovementResolver,
  releasedVehicleIds: ReadonlySet<string>,
  tick: number,
  extraEdgeLoads?: Readonly<Record<string, number>>,
): void;
```

- [ ] **Step 1:** RED tests: current+next edge resolves exact movement; queued vehicle remains on current edge and accumulates delay; owned released ID advances one edge and acknowledges; foreign released ID ignored; invalid movement fails cleanly; degree>2 heuristic gone; simple `requiresQueue() === false` continuation advances without intersection queue delay.
- [ ] **Step 2:** Run focused test; verify RED.
- [ ] **Step 3:** Implement release handling before moving vehicles:

```ts
for (const id of releasedVehicleIds) {
  const vehicle = this.vehicles.get(id);
  if (!vehicle || vehicle.status !== 'queued') continue;
  vehicle.currentEdgeIndex++;
  vehicle.edgeProgressTicks = 0;
  vehicle.status = 'moving';
  delete vehicle.queuedNodeId;
  controls.acknowledge(id);
}
```

- [ ] **Step 4:** At a non-terminal edge, resolve current+next. If `!resolved`, fail. If `!controls.requiresQueue(resolved.movementId)`, advance directly. Otherwise enqueue:

```ts
controls.enqueue({ vehicleId: vehicle.id, movementId: resolved.movementId, laneGroupIds: resolved.laneGroupIds, travelerWeight: vehicle.travelerWeight, queuedTick: tick, priority: 'normal' });
```

Never call `controls.step()` here.
- [ ] **Step 5:** Run new + legacy traffic tests; require PASS.
- [ ] **Step 6:** Commit `feat: route live traffic through 3R intersection control`.

---

### Task 11: Cut service/emergency vehicles to the same controller

**Files:**
- Modify: `src/simulation/services/ServiceVehicleSystem.ts`
- Test: `tests/transport3r-live-service-vehicles.test.ts`
- Regression: `tests/service-core-integration.test.ts`, `tests/service-dispatch.test.ts`

**New signature:**

```ts
step(
  graph: TransportationGraph,
  controls: IntersectionControlSystem,
  resolver: LegacyRouteMovementResolver,
  releasedVehicleIds: ReadonlySet<string>,
  pathfinding: PathfindingSystem,
  edgeCost: (edge: TransportationEdge) => number,
  tick: number,
): ServiceVehicleEvent[];
```

- [ ] **Step 1:** RED tests: garbage truck queues weight 2; emergency type weight 1 + preemption request; service-owned release advances once/acknowledges; traffic-owned release ignored; missing-edge reroute still resolves a new movement; failure removes queue membership; simple non-conflicting continuation bypasses queue.
- [ ] **Step 2:** Run focused test; verify RED.
- [ ] **Step 3:** Implement owned release logic equivalent to TrafficSystem, then route resolution/`requiresQueue()`.
- [ ] **Step 4:** Emergency queueing submits:

```ts
controls.submitPriorityRequest({
  id: `ipr:${vehicle.id}:${resolved.movementId}`,
  junctionId: resolved.junctionId,
  movementId: resolved.movementId,
  kind: 'emergencyPreemption',
  requestedTick: tick,
  expiresTick: tick + 100,
});
```

Same ID refreshes; never call `controls.step()` here.
- [ ] **Step 5:** Run new + service regressions; require PASS.
- [ ] **Step 6:** Commit `feat: route service vehicles through 3R control`.

---

### Task 12: Make 3R-B live in `LegacySimulationCore` with one controller step per tick

**Files:**
- Modify: `src/simulation/core/LegacySimulationCore.ts`
- Test: `tests/transport3r-core-control.test.ts`
- Regression: `tests/core-city-loop.test.ts`, `tests/phase6-headless.test.ts`

**Core ownership:**

```ts
readonly intersections: IntersectionSystem; // V3-V8 compatibility container only
readonly intersectionControl: IntersectionControlSystem; // sole live authority
private readonly transportNetworkAdapter: LegacyRoadNetworkAdapter;
private controlRuntimeRoadRevision = -1;
```

- [ ] **Step 1:** RED test: central road junction has a 3R plan; `intersectionControl` is used by both road-vehicle systems; old `intersections` stays empty during new live queueing.
- [ ] **Step 2:** Run focused test; verify RED.
- [ ] **Step 3:** Instantiate adapter/controller and cache `{authority, laneGroups, resolver}` by `roads.revision`:

```ts
if (this.controlRuntimeRoadRevision !== this.roads.revision) {
  const projection = this.transportNetworkAdapter.projectAuthorityIfNeeded(this.roads);
  const laneGroups = buildLaneGroups(projection.authority);
  this.controlRuntime = { authority: projection.authority, laneGroups, resolver: new LegacyRouteMovementResolver(projection.authority, laneGroups) };
  this.controlRuntimeRoadRevision = this.roads.revision;
}
```

- [ ] **Step 4:** Replace the old live order with **exactly one** controller step before both vehicle consumers:

```ts
this.transportationGraph.rebuildIfNeeded(this.roads);
const runtime = this.syncTransportControlRuntime();
this.intersectionControl.syncNetwork(runtime.authority, runtime.laneGroups, this.buildIntersectionDemand(runtime), this.clock.tick);
const released = new Set(this.intersectionControl.step(this.clock.tick));

const serviceEvents = this.serviceVehicles.step(
  this.transportationGraph, this.intersectionControl, runtime.resolver, released,
  this.pathfinding, (edge) => this.traffic.getEdgeTravelTime(edge), this.clock.tick,
);

// Keep the existing economy/mobility scheduling in its current relative order.
// After edgeLoads is computed, call:
this.traffic.step(
  this.transportationGraph, this.intersectionControl, runtime.resolver, released,
  this.clock.tick, edgeLoads,
);
```

The implementation must preserve every existing statement between `serviceEvents` and `edgeLoads` from the current `runLegacyV7Tick()`; only its intersection-control arguments/order change. Vehicles queued during this tick become service candidates next tick.
- [ ] **Step 5:** Demand snapshot uses deterministic observed movement arrivals/queue rates and available traffic metrics. If no current pedestrian aggregate exists, pass zero pedestrian demand; do not fabricate pedestrian agents.
- [ ] **Step 6:** Search `TrafficSystem.ts`, `ServiceVehicleSystem.ts`, and `LegacySimulationCore.ts` for `stepNode(`; expected zero live occurrences.
- [ ] **Step 7:** Run focused/core regressions + typecheck; require PASS.
- [ ] **Step 8:** Commit `feat: make 3R intersection control live authority`.

---

### Task 13: Implement Save V9 and deterministic V8→V9 queue migration

**Files:**
- Create: `src/simulation/transportation/IntersectionControlMigration.ts`
- Create: `src/save/saveV9.ts`
- Modify: `src/save/save.ts`
- Test: `tests/save-v9.test.ts`
- Regression: `tests/save-v8.test.ts`, `tests/save-v7.test.ts`, `tests/save-v6.test.ts`

**Canonical type:**

```ts
export type SaveV9 = Omit<SaveV8, 'saveVersion' | 'gameVersion' | 'intersections'> & Readonly<{
  saveVersion: 9;
  gameVersion: '0.9.0-intersection-control';
  intersectionControl: IntersectionControlSnapshot;
}>;
```

- [ ] **Step 1:** RED canonical tests: default save is V9; contains `intersectionControl`; omits `intersections`; round-trip exact mid-signal phase, queued STOP state, pending release, pedestrian runtime, override, coordination state, and priority request.
- [ ] **Step 2:** RED V8 fixtures: (a) no queues, (b) queued ordinary vehicle, (c) queued emergency service vehicle, (d) legacy `released: true` pending entry. For normal queued entries preserve weight, queuedTick, priority. For legacy released entries preserve **vehicle identity, incoming-edge route intent, and exactly-once pending-release status**; do not invent original weight/queue timestamp because V8's pending representation stores `travelerWeight: 0` and `queuedTick: 0`.
- [ ] **Step 3:** Implement migration helper:

```ts
export function migrateLegacyIntersectionSnapshot(core: SimulationCore, legacy: IntersectionSnapshot): IntersectionControlSnapshot {
  // rebuild authority/lane groups/resolver from core.roads
  // enumerate every legacy entry exactly once
  // find owner in core.traffic or core.serviceVehicles
  // derive owner's active currentEdge + nextEdge
  // resolve explicit movement and incoming lane groups
  // queued entry -> preserve remaining weight/tick/priority
  // released entry -> create canonical pending-release marker with zero remaining weight
  // throw on orphan, duplicate, route mismatch, missing movement
}
```

Initialize migrated signal cycle from restored simulation tick + canonical offset; pedestrian occupancy empty because V8 has no equivalent.
- [ ] **Step 4:** Non-V9 input flow:

```ts
const core = hydrateCoreV8(input);
const migrated = migrateLegacyIntersectionSnapshot(core, core.intersections.snapshot());
core.intersections.restore({});
const runtime = rebuild3RRuntime(core.roads);
core.intersectionControl.restore(migrated, runtime.authority, runtime.laneGroups);
return core;
```

- [ ] **Step 5:** V9 input flow must not project V9 queues backward. Build inherited V8 object with V9's inherited fields plus `saveVersion: 8`, `gameVersion: '0.8.0-world-foundation'`, `intersections: {}`; hydrate inherited state; rebuild authority/lane groups; restore saved `intersectionControl` directly.
- [ ] **Step 6:** V9 serialization obtains inherited V8 fields, removes `intersections`, and attaches `core.intersectionControl.snapshot()`. Make `save.ts` default to V9 while retaining named legacy exports. Document explicit older serializers as historical formats, not faithful downgrade exporters of V9-only controller state.
- [ ] **Step 7:** Run V9/V8/V7/V6 tests; require PASS.
- [ ] **Step 8:** Commit `feat: add Save V9 intersection control persistence`.

---

### Task 14: Add metropolitan structural scale/determinism acceptance

**Files:**
- Create: `tests/transport3r-intersection-scale.test.ts`
- Modify `IntersectionControlSystem.ts` only if read-only diagnostics/index fixes are needed.

- [ ] **Step 1:** Build 100×100 road-cell projection plus high-active-queue fixture.
- [ ] **Step 2:** Assert structural properties: no per-vehicle authority scans; unchanged road revision does not rebuild authority/lane groups/resolver/control topology; only active junctions step; shared lane-group budget is not multiplied by movement count.
- [ ] **Step 3:** If needed, expose diagnostics:

```ts
type IntersectionControlDiagnostics = Readonly<{
  networkRebuilds: number;
  activeJunctionsStepped: number;
  movementLookups: number;
  conflictLookups: number;
  queueHeadsExamined: number;
}>;
```

- [ ] **Step 4:** Log wall-clock values without assertions:

```ts
console.log('TRANSPORT3R_INTERSECTION_SCALE', { roadCells, junctions, movements, plans, queuedVehicles, ...diagnostics, buildMs, stepMs });
```

- [ ] **Step 5:** Run twice; structural counts identical/PASS.
- [ ] **Step 6:** Commit `test: add 3R-B intersection scale acceptance`.

---

### Task 15: Update current authoritative documentation

**Files:** `docs/SAVE_FORMAT.md`, `docs/ARCHITECTURE.md`, `docs/SIMULATION.md`.

- [ ] **Step 1:** `SAVE_FORMAT.md`: V9 canonical, inherited V8 World Foundation, `intersectionControl` authority, derived indexes, V8→V9 migration, V3–V8 legacy loading.
- [ ] **Step 2:** `ARCHITECTURE.md`: 3R-A owns physical/legal topology; 3R-B owns live control/queue state; old `IntersectionSystem` is hydration compatibility only.
- [ ] **Step 3:** `SIMULATION.md`: movement queues; STOP/YIELD/all-way STOP; fixed signals; protected/permissive/protected-only lefts; RTOR; pedestrian clearance; coordination; controlled access; emergency/transit hooks; one controller step/tick.
- [ ] **Step 4:** Search current docs/source comments for stale claims that V7/V8 is canonical or old `IntersectionSystem` is live. Preserve historical plan/spec documents except the committed V9 amendment.
- [ ] **Step 5:** Commit `docs: document 3R-B and Save V9`.

---

### Task 16: Full regression, review, and PR completion gate

- [ ] **Step 1:** `npm test`; require 0 failures.
- [ ] **Step 2:** `npm run typecheck && npm run lint && npm run assets:check && npm run build`; require exit 0.
- [ ] **Step 3:** `npm run test:smoke && npm run test:smoke:phase7 && npm run test:smoke:isometric`; require PASS.
- [ ] **Step 4:** Architecture audit: no live old `stepNode`; exactly one `intersectionControl.step` per tick; shared release set cannot double-spend; old object compatibility-only; shared lane capacity conserved; controlled-access at-grade control rejected; signal/STOP/RTOR/pedestrian/coordination/priority behaviors covered; V9 default/V8 load green; no placeholder markers in new production code; focused source files.
- [ ] **Step 5:** Invoke `superpowers:requesting-code-review` against branch base/head. Every valid Critical/Important finding gets a RED regression before its fix, focused verification, and commit.
- [ ] **Step 6:** After the final code change, rerun Steps 1–3 fresh. Completion claims must cite this fresh evidence.
- [ ] **Step 7:** Update the draft PR body with exact test count, build/static/smoke results, V9 migration evidence, structural scale diagnostics, live-authority cutover, and explicit deferrals. Do not mark ready or merge without user authorization.

---

## Acceptance Traceability

- Public U.S. control semantics: Task 1.
- Legacy route compatibility: Task 2.
- Pedestrian crossings/conflicts: Task 3.
- Hierarchy, warrants, hysteresis, controlled access, fixed signal plans: Task 4.
- Movement queues/pending releases: Task 5.
- STOP/YIELD/all-way STOP/gaps: Task 6.
- Pedestrian runtime, left-turn modes, RTOR, clearance: Task 7.
- Coordination/preemption/transit hooks: Task 8.
- Sole controller API, simple-junction bypass, shared lane capacity: Task 9.
- Ordinary traffic cutover: Task 10.
- Service/emergency cutover: Task 11.
- Exactly one live controller step and inert legacy hydration container: Task 12.
- Save V9 + V8 migration + V3–V8 loading: Task 13.
- Structural scale/determinism: Task 14.
- Current docs: Task 15.
- Full verification/review: Task 16.

## Execution Rule

No implementation code precedes Task 1's RED test. Execute tasks in order because later tasks consume earlier interfaces. Each task ends green and committed. Never merge 3R-B without explicit user authorization.