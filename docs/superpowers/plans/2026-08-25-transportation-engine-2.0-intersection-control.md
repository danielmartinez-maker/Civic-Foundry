# Civic Foundry 2.0 — 3R-B Intersection Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Civic Foundry's live generic node-capacity intersection behavior with a deterministic U.S.-style movement-aware intersection-control engine for ordinary and service traffic, then make Save V9 canonical without breaking V3–V8 loading.

**Architecture:** 3R-B builds on 3R-A `TransportNetworkAuthority`, explicit `TurnMovementId`s, and derived `LaneGroup`s. Focused pure builders derive crossings, conflicts, control plans, fixed-time signals, and coordination; focused runtime units own queues, unsignalized right-of-way, signal/pedestrian state, and priority requests; `IntersectionControlSystem` orchestrates them and is stepped exactly once per simulation tick. Legacy route planning remains edge-based through an indexed edge-to-movement resolver. `LegacySimulationCore.intersections` remains an inert `IntersectionSystem` only as a V3–V8 hydration compatibility container; **all live vehicle movement uses `intersectionControl`**, so there is still one live authority.

**Tech Stack:** TypeScript ES modules, Node 22 built-in test runner, existing 3R-A transportation modules, deterministic simulation kernel, GitHub Actions CI.

**Spec:** `docs/superpowers/specs/2026-08-25-transportation-engine-2.0-intersection-control-design.md`

**Persistence amendment:** `docs/superpowers/specs/2026-08-25-transportation-engine-2.0-intersection-control-save-v9-amendment.md` — authoritative over all Save V8/V7→V8 wording in the original spec.

## Global Constraints

- U.S. right-hand-traffic semantics; FHWA MUTCD 11th Edition with Revision 1 is the engineering reference, not a jurisdiction-by-jurisdiction legal database.
- `expressway` and `highway` are controlled-access mainline classes; ordinary at-grade STOP/YIELD/signal control is invalid on those mainlines.
- `IntersectionControlSystem` is the sole **live** intersection authority for ordinary and service vehicles.
- The old `IntersectionSystem` may remain instantiated only for historical V3–V8 serialization/hydration compatibility and must never be stepped by live simulation after the cutover.
- Legacy edge-based route planning remains supported in 3R-B; do not force a full migration to `MovementAwarePathfindingSystem`.
- Automatic control assignment is deterministic, hierarchy/demand based, reviewed only at fixed epochs, and uses hysteresis to prevent plan flapping.
- Protected/permissive left turns are the normal signal treatment; protected-only operation remains explicit and enforceable.
- RTOR is policy-driven, default enabled in the U.S. ruleset, and requires stop compliance, acceptable conflict gap, no pedestrian conflict, and no local prohibition.
- Pedestrian WALK/change/clearance is explicit controller state; no full pedestrian-agent simulation in 3R-B.
- Emergency preemption outranks transit priority but cannot bypass yellow/all-red or physical conflict clearance.
- Adaptive optimization, crashes, parking search, weather control, reversible-lane scheduling, and microscopic lane changing are out of scope.
- Save V9 is canonical: `saveVersion: 9`, `gameVersion: '0.9.0-intersection-control'`; V8 and older remain supported load inputs.
- TDD for every task: RED test → minimal GREEN implementation → focused regression → commit.
- New production coordinators stay focused and normally below the repository architecture-warning threshold; split responsibilities rather than suppressing warnings.
- Final gate: `npm test`, `npm run typecheck`, `npm run lint`, `npm run assets:check`, `npm run build`, `npm run test:smoke`, `npm run test:smoke:phase7`, `npm run test:smoke:isometric`.

---

## Locked File Structure

### New production files

- `src/simulation/transportation/IntersectionControlTypes.ts` — stable control, queue, crossing, signal, policy, demand, revision, and snapshot types.
- `src/simulation/transportation/LegacyRouteMovementResolver.ts` — indexed legacy edge pair → explicit movement/lane groups.
- `src/simulation/transportation/PedestrianCrossingBuilder.ts` — deterministic derived surface-street crossings.
- `src/simulation/transportation/ConflictMatrixBuilder.ts` — deterministic vehicle/pedestrian conflicts.
- `src/simulation/transportation/ControlPlanBuilder.ts` — hierarchy/demand assignment, review cadence/hysteresis, overrides, controlled-access validation.
- `src/simulation/transportation/SignalPlanBuilder.ts` — deterministic fixed-time U.S.-style phase construction and clearance timing.
- `src/simulation/transportation/MovementQueueStore.ts` — authoritative movement queue + pending-release state.
- `src/simulation/transportation/UnsignalizedController.ts` — STOP/YIELD/all-way-stop/gap logic.
- `src/simulation/transportation/PedestrianController.ts` — aggregate WALK/change/clearance runtime.
- `src/simulation/transportation/SignalController.ts` — fixed-time signal runtime and movement states.
- `src/simulation/transportation/SignalCoordinationBuilder.ts` — deterministic arterial groups/offsets.
- `src/simulation/transportation/PriorityController.ts` — emergency/transit requests.
- `src/simulation/transportation/IntersectionControlSystem.ts` — sole live control orchestration API.
- `src/simulation/transportation/IntersectionControlMigration.ts` — V3–V8 legacy queue → 3R-B control snapshot migration.
- `src/save/saveV9.ts` — canonical V9 envelope/hydration.

### Existing production files modified

- `src/simulation/traffic/TrafficSystem.ts`
- `src/simulation/services/ServiceVehicleSystem.ts`
- `src/simulation/core/LegacySimulationCore.ts`
- `src/save/save.ts`
- `docs/SAVE_FORMAT.md`
- `docs/ARCHITECTURE.md`
- `docs/SIMULATION.md`

`src/simulation/traffic/IntersectionSystem.ts` remains unchanged unless a narrowly scoped compatibility fix is required by a historical-save regression. It is not a live 3R-B controller.

---

### Task 1: Define 3R-B public control types and U.S. defaults

**Files:**
- Create: `src/simulation/transportation/IntersectionControlTypes.ts`
- Test: `tests/transport3r-intersection-types.test.ts`

**Interfaces produced:**

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
  travelerWeight: number;
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
```

`IntersectionControlSnapshot` must contain canonical sorted arrays for `plans`, `queues`, `signalRuntime`, `pedestrianRuntime`, `priorityRequests`, `coordinationGroups`, `overrides`, plus `controlPlanRevision`, `controlRuntimeEpoch`, and `lastPlanReviewTick`.

- [ ] **Step 1: Write RED runtime-default tests** for RTOR, 10-tick minimum stop, 6000-tick review cadence, and controlled-access classification (`expressway`/`highway` true; `arterial` false).
- [ ] **Step 2: Run:** `node --experimental-strip-types --test tests/transport3r-intersection-types.test.ts` → expected FAIL because module is absent.
- [ ] **Step 3: Implement the exact unions, immutable snapshots/policies, validation helpers, and `isControlledAccessRoadClass(roadClass)` shown above.** Reject non-finite/negative timing and capacity values in snapshot validators.
- [ ] **Step 4: Run focused test + `npm run typecheck`** → PASS.
- [ ] **Step 5: Commit:** `git commit -am` is not allowed for new files; use `git add ... && git commit -m "feat: define 3R-B intersection control types"`.

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

- [ ] **Step 1: RED tests:** build a plus-shaped `RoadSystem`; project with `LegacyRoadNetworkAdapter`; derive `buildLaneGroups`; verify straight/right/left edge pairs resolve to the correct explicit `TurnMovement`; malformed, U-turn-without-movement, and non-contiguous pairs return `undefined`.
- [ ] **Step 2: Run focused test** → FAIL.
- [ ] **Step 3: Implement indexed parsing** using only canonical edge IDs:

```ts
const EDGE = /^e:n:(-?\d+),(-?\d+)>n:(-?\d+),(-?\d+)$/;
```

Build maps for junction-pair→carriageway, carriageway-pair→movement, and movement→incoming lane groups. Reuse `legacyJunctionId`; do not use repeated authority-array scans in `resolve()`.
- [ ] **Step 4: Run focused test + `tests/transport2-compatibility.test.ts` + `tests/transport2-turn-movements.test.ts`** → PASS.
- [ ] **Step 5: Commit:** `feat: resolve legacy routes to 3R movements`.

---

### Task 3: Derive pedestrian crossings and physical conflict matrices

**Files:**
- Create: `src/simulation/transportation/PedestrianCrossingBuilder.ts`
- Create: `src/simulation/transportation/ConflictMatrixBuilder.ts`
- Test: `tests/transport3r-conflicts.test.ts`

**Interfaces:**

```ts
export function buildPedestrianCrossings(
  authority: TransportNetworkAuthority,
  laneGroups: readonly LaneGroup[],
): readonly PedestrianCrossing[];

export type ConflictParticipantId = TurnMovementId | PedestrianCrossingId;
export type JunctionConflictMatrix = Readonly<{
  junctionId: JunctionId;
  participants: readonly ConflictParticipantId[];
  conflicts(a: ConflictParticipantId, b: ConflictParticipantId): boolean;
}>;

export function buildConflictMatrices(
  authority: TransportNetworkAuthority,
  crossings: readonly PedestrianCrossing[],
): readonly JunctionConflictMatrix[];
```

- [ ] **Step 1: RED crossing tests:** a cardinal four-leg surface intersection yields one stable crossing per leg, IDs are geometry-derived (`pc:<junctionId>:<stable-signature>`), crossing length is `max(7, crossedTravelLaneCount * 3.6)` meters, and controlled-access mainlines do not fabricate ordinary crossings.
- [ ] **Step 2: RED conflict tests:** opposing through compatible; left vs opposing through conflict; perpendicular through conflict; distinct-departure rights compatible; shared constrained departure lane-group conflict; vehicle/pedestrian path conflict; symmetry; no self-conflict; output stable under shuffled input.
- [ ] **Step 3: Run focused test** → FAIL.
- [ ] **Step 4: Implement crossings as pure derived state and cardinal movement paths behind private geometry helpers.** Keep public conflict API geometry-neutral for later non-cardinal roads.
- [ ] **Step 5: Run focused test twice** and compare canonical serialized conflict pairs → identical/PASS.
- [ ] **Step 6: Commit:** `feat: derive intersection crossings and conflicts`.

---

### Task 4: Build hierarchy-based U.S. control plans and fixed-time signal plans

**Files:**
- Create: `src/simulation/transportation/ControlPlanBuilder.ts`
- Create: `src/simulation/transportation/SignalPlanBuilder.ts`
- Test: `tests/transport3r-control-plans.test.ts`

**Interfaces:**

```ts
export type ControlPlanBuildResult = Readonly<{
  plans: readonly JunctionControlPlan[];
  changed: boolean;
  reviewedAtTick: number;
}>;

export function buildControlPlans(input: ControlPlanBuildInput): ControlPlanBuildResult;
export function buildSignalTimingPlan(input: SignalPlanBuildInput): SignalTimingPlan;
```

**Deterministic signal score:**

```ts
score = hierarchyBase
  + Math.min(40, totalMovementDemandPerMinute * 0.25)
  + Math.min(20, pedestrianDemandPerMinute * 0.5)
  + Math.min(20, leftTurnDemandPerMinute * 0.5)
  + Math.min(20, conflictCount * 2)
  + Math.min(20, crashRiskScore * 20);
```

Hierarchy bases: local/local 20, local/collector 35, collector/collector 50, collector/arterial 65, arterial/arterial 80.

- [ ] **Step 1: RED control tests:** low-demand local/local→`uncontrolled`; local→collector/arterial lower road controlled; collector×collector→`twoWayStop`; score ≥100 on signal-eligible major intersection→`signal`; existing signal stays while score 80–99 and exits below 80 only at review epoch; no plan change before 6000 ticks; valid override survives rebuild; illegal freeway/highway `signal`/`allWayStop` override throws; controlled-access merge/diverge/ramp-terminal topology accepts only compatible types.
- [ ] **Step 2: Run focused test** → FAIL.
- [ ] **Step 3: Implement deterministic automatic assignment, override validation, review cadence, and hysteresis.** No-op rebuild sets `changed: false` and does not increment structural revision in callers.
- [ ] **Step 4: Implement signal plan generation:** opposing non-conflicting through/right groups; lefts permissive by default; protected-left phase only for `protectedOnly` policy/override; reject conflicting protected movements.
- [ ] **Step 5: Use exact clearance formulas:** yellow `clamp(round((3 + speedKph / 80) * 10), 30, 50)` ticks; all-red `clamp(round((junctionClearanceMeters / max(speedKph / 3.6, 1)) * 10), 10, 30)`; minimum protected green 80 ticks; deterministic demand split thereafter.
- [ ] **Step 6: Run focused test + typecheck** → PASS.
- [ ] **Step 7: Commit:** `feat: build U.S. intersection control plans`.

---

### Task 5: Implement authoritative movement queues and pending-release accounting

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

- [ ] **Step 1: RED tests:** one queue per vehicle; deterministic queue order; partial weighted service; pending release not served twice; acknowledge/remove; duplicate/unknown restore rejection; stable snapshot order.
- [ ] **Step 2: Run focused test** → FAIL.
- [ ] **Step 3: Implement `queuesByMovement`, `vehicleLocation`, and `pendingReleased` indexes.** `serve()` decrements head remaining weight until zero, then moves the vehicle to pending release. Emergency/transit labels are stored but controller policy—not the queue store—decides right-of-way.
- [ ] **Step 4: Run focused test twice** → PASS and identical snapshots.
- [ ] **Step 5: Commit:** `feat: add movement-aware intersection queues`.

---

### Task 6: Implement deterministic unsignalized U.S. right-of-way

**Files:**
- Create: `src/simulation/transportation/UnsignalizedController.ts`
- Test: `tests/transport3r-unsignalized.test.ts`

**Interface:**

```ts
export function requiredGapTicks(
  movement: TurnMovement,
  approachSpeedKph: number,
  vehiclePermissionMask?: number,
): number;

export function unsignalizedServiceState(context: UnsignalizedDecisionContext): MovementServiceState;
```

- [ ] **Step 1: RED tests:** 10-tick STOP dwell; YIELD clear gap; YIELD blocked by higher-priority conflict; major-street priority; all-way STOP completed-stop arrival order; simultaneous arrivals resolved by geometric priority then stable movement ID then vehicle ID; pedestrian occupancy blocks conflicting movement.
- [ ] **Step 2: Run focused test** → FAIL.
- [ ] **Step 3: Implement exact deterministic gap baseline:** right 20 ticks, through 30, left 40; add `round(max(0, speedKph - 40) / 10) * 5`; heavy freight adds 10. A queued higher-priority conflict blocks entry; otherwise require `tick - lastConflictReleaseTick >= requiredGapTicks`. No RNG.
- [ ] **Step 4: Run focused test + turn-movement regression** → PASS.
- [ ] **Step 5: Commit:** `feat: add U.S. unsignalized right of way`.

---

### Task 7: Implement aggregate pedestrian runtime and fixed-time signal execution

**Files:**
- Create: `src/simulation/transportation/PedestrianController.ts`
- Create: `src/simulation/transportation/SignalController.ts`
- Test: `tests/transport3r-pedestrians.test.ts`
- Test: `tests/transport3r-signals.test.ts`

- [ ] **Step 1: RED pedestrian tests:** WALK accepts aggregate crossing demand; change interval stops new entry; residual clearance occupancy lasts `ceil(crossingLengthMeters / 1.1 * 10)` ticks; conflicting permissive turns observe occupancy; snapshot/restore mid-clearance is exact.
- [ ] **Step 2: Implement `PedestrianController`** with immutable derived crossing definitions and persisted runtime only; run pedestrian test → PASS.
- [ ] **Step 3: RED signal tests:** phase progression; protected through; protected/permissive left; protected-only left; yellow; all-red; RTOR allowed only after stop+gap; RTOR policy prohibition; pedestrian conflict; exact mid-phase snapshot/restore.
- [ ] **Step 4: Implement `SignalController`.** Timing plan is immutable until control-plan revision changes. Yellow/all-red are explicit modes. `permissive` never bypasses conflict checks. RTOR returns `stop` before stop dwell and `yield` afterward, never `protected`.
- [ ] **Step 5: Run both focused tests + typecheck** → PASS.
- [ ] **Step 6: Commit:** `feat: execute pedestrian and signal control`.

---

### Task 8: Add deterministic arterial coordination and priority/preemption

**Files:**
- Create: `src/simulation/transportation/SignalCoordinationBuilder.ts`
- Create: `src/simulation/transportation/PriorityController.ts`
- Test: `tests/transport3r-priority-coordination.test.ts`

- [ ] **Step 1: RED coordination tests:** three contiguous arterial signals form one stable group; compatible common cycle; offsets equal cumulative free-flow travel ticks modulo cycle; shuffled source arrays yield same group/order; unrelated local signals stay out.
- [ ] **Step 2: Implement coordination builder** using stable corridor signature and dominant direction; run coordination tests → PASS.
- [ ] **Step 3: RED priority tests:** emergency outranks transit; expired request removed; incompatible emergency request first asks signal controller for safe yellow/all-red transition; transit priority can boundedly extend/advance compatible phase only; request order is kind, requested tick, stable request ID.
- [ ] **Step 4: Implement `PriorityController`** with snapshot/restore and idempotent same-ID refresh.
- [ ] **Step 5: Run focused test** → PASS.
- [ ] **Step 6: Commit:** `feat: coordinate signals and priority requests`.

---

### Task 9: Assemble the authoritative `IntersectionControlSystem`

**Files:**
- Create: `src/simulation/transportation/IntersectionControlSystem.ts`
- Test: `tests/transport3r-intersection-control.test.ts`

**Public API:**

```ts
export class IntersectionControlSystem {
  syncNetwork(authority: TransportNetworkAuthority, laneGroups: readonly LaneGroup[], demand: IntersectionControlDemandSnapshot, tick: number): void;
  enqueue(entry: MovementQueueEntry): boolean;
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

- [ ] **Step 1: RED orchestration tests:** movement release; conflicts cannot double-release; lane-group service `capacityPerMinute / 600` weight per simulation tick; signal gates service; same-tick repeated `step()` returns same pending IDs without spending capacity again; topology rebuilds matrices/plans; no-op sync keeps `controlPlanRevision`; valid override persists; invalid controlled-access override rejected.
- [ ] **Step 2: Run focused test** → FAIL.
- [ ] **Step 3: Implement indexed orchestration.** Index movement→junction, movement→incoming groups, carriageway→speed, junction→matrix, junction→plan. Step only active queued/pedestrian/signal/priority junctions. Track last conflicting release tick for gap acceptance. `step()` returns all pending-released IDs sorted; it does not know which vehicle subsystem owns them.
- [ ] **Step 4: Run all 3R-B focused tests so far** → PASS.
- [ ] **Step 5: Commit:** `feat: add authoritative intersection control system`.

---

### Task 10: Cut ordinary `TrafficSystem` to movement-aware queues without stepping the controller

**Files:**
- Modify: `src/simulation/traffic/TrafficSystem.ts`
- Test: `tests/transport3r-live-traffic.test.ts`
- Regression: `tests/traffic-simulation.test.ts`, `tests/traffic-routing.test.ts`

**New step shape:**

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

- [ ] **Step 1: RED tests:** queued vehicle maps current+next edge to one movement; remains on current edge; delay increments; a released ID owned by traffic advances exactly one edge and calls `controls.acknowledge(id)`; IDs belonging to another subsystem are ignored/not acknowledged; illegal route movement fails cleanly; degree>2 heuristic is no longer used.
- [ ] **Step 2: Run focused test** → FAIL.
- [ ] **Step 3: Implement queueing:** resolve current/next edge and call `controls.enqueue({ vehicleId, movementId, laneGroupIds, travelerWeight, queuedTick: tick, priority: 'normal' })`. Do **not** call `controls.step()` from `TrafficSystem`.
- [ ] **Step 4: Process `releasedVehicleIds` before movement advancement:** only acknowledge IDs found in `this.vehicles` and status `queued`; advance exactly one edge; reset progress/status.
- [ ] **Step 5: Run new + legacy traffic tests** → PASS; update only assertions tied to obsolete node-capacity behavior.
- [ ] **Step 6: Commit:** `feat: route live traffic through 3R intersection control`.

---

### Task 11: Cut service/emergency vehicles to the same live controller

**Files:**
- Modify: `src/simulation/services/ServiceVehicleSystem.ts`
- Test: `tests/transport3r-live-service-vehicles.test.ts`
- Regression: `tests/service-core-integration.test.ts`, `tests/service-dispatch.test.ts`

**New step shape:**

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

- [ ] **Step 1: RED tests:** garbage truck queues with weight 2; emergency vehicle weight 1; fire/police/medical submits `emergencyPreemption`; released service ID advances exactly once and acknowledges; ordinary-traffic IDs are ignored; missing-edge reroute still works before re-resolution; failure removes controller membership.
- [ ] **Step 2: Run focused test** → FAIL.
- [ ] **Step 3: Implement movement queueing and deterministic request ID** `ipr:${vehicle.id}:${movementId}` with expiry `tick + 100`; same ID refreshes instead of duplicates. Preserve `queuedNodeId` only as vehicle presentation/save metadata.
- [ ] **Step 4: Do not call `controls.step()` here.** Process only owned IDs from central release set.
- [ ] **Step 5: Run new + service regressions** → PASS.
- [ ] **Step 6: Commit:** `feat: route service vehicles through 3R control`.

---

### Task 12: Make 3R-B live in `LegacySimulationCore` while preserving an inert legacy save container

**Files:**
- Modify: `src/simulation/core/LegacySimulationCore.ts`
- Test: `tests/transport3r-core-control.test.ts`
- Regression: `tests/core-city-loop.test.ts`, `tests/phase6-headless.test.ts`

**Core fields:**

```ts
readonly intersections: IntersectionSystem; // compatibility-only; never stepped live after 3R-B
readonly intersectionControl: IntersectionControlSystem; // sole live authority
private readonly transportNetworkAdapter: LegacyRoadNetworkAdapter;
private controlResolver?: LegacyRouteMovementResolver;
private controlResolverRoadRevision = -1;
```

- [ ] **Step 1: RED core test:** central road junction receives a 3R control plan; `intersectionControl` exists; compatibility `intersections` stays empty during new live queueing; ordinary and service vehicles use the same `intersectionControl` instance.
- [ ] **Step 2: Run focused test** → FAIL.
- [ ] **Step 3: Instantiate 3R-A projection + 3R-B controller.** Cache projected authority, lane groups, and resolver by `roads.revision`; rebuild only when revision changes.
- [ ] **Step 4: Use this exact per-tick control order:**

```ts
this.transportationGraph.rebuildIfNeeded(this.roads);
const runtime = this.syncTransportControlRuntime();
this.intersectionControl.syncNetwork(runtime.authority, runtime.laneGroups, runtime.demand, this.clock.tick);
const released = new Set(this.intersectionControl.step(this.clock.tick));

const serviceEvents = this.serviceVehicles.step(
  this.transportationGraph,
  this.intersectionControl,
  runtime.resolver,
  released,
  this.pathfinding,
  (edge) => this.traffic.getEdgeTravelTime(edge),
  this.clock.tick,
);

// existing mobility/economy work...
this.traffic.step(
  this.transportationGraph,
  this.intersectionControl,
  runtime.resolver,
  released,
  this.clock.tick,
  edgeLoads,
);
```

This guarantees **one** controller capacity spend per tick. Vehicles enqueued later in the tick become eligible on the next tick, matching the existing queue cadence.
- [ ] **Step 5: Build demand snapshots deterministically** from controller-observed movement arrivals/queues plus available traffic metrics. Use zero pedestrian demand when no aggregate mobility source exists; pedestrian APIs/runtime remain operational and testable, and future mobility can supply demand without changing controller interfaces.
- [ ] **Step 6: Verify no live call to `this.intersections.stepNode()` remains in core/traffic/service code.** Keep `this.intersections` only so old save hydrators can populate a legacy snapshot before V9 migration.
- [ ] **Step 7: Run focused + core regressions + typecheck** → PASS.
- [ ] **Step 8: Commit:** `feat: make 3R intersection control live authority`.

---

### Task 13: Implement Save V9 and migrate V8 legacy queue state exactly once

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

**Migration API:**

```ts
export function migrateLegacyIntersectionSnapshot(
  core: SimulationCore,
  legacy: IntersectionSnapshot,
): IntersectionControlSnapshot;
```

- [ ] **Step 1: RED canonical tests:** default `serializeCore()` emits V9/game version, includes `intersectionControl`, omits canonical legacy `intersections`, and round-trips mid-signal phase, queued STOP vehicle, pending release, pedestrian runtime, override, coordination state, and priority request.
- [ ] **Step 2: RED V8 migration fixtures:** no queues; queued ordinary traffic; queued emergency service vehicle; `released: true` pending entry. Each migrated vehicle appears exactly once with movement, weight, queuedTick, and priority preserved; pending release never spends capacity again.
- [ ] **Step 3: Implement migration from the inert compatibility container:** call existing `hydrateCoreV8(input)` first; read `core.intersections.snapshot()`; rebuild 3R authority/lane groups/resolver from restored roads; locate each queued vehicle in `core.traffic` or `core.serviceVehicles`; resolve its current+next active route edges; build movement queue entries; initialize signal runtime from restored tick + deterministic timing offset; initialize pedestrian occupancy empty; throw on orphan/duplicate/route mismatch.
- [ ] **Step 4: Clear the compatibility container after migration** with `core.intersections.restore({})`; all subsequent live continuation is in `core.intersectionControl`.
- [ ] **Step 5: Implement V9 hydration without round-tripping V9 control state through legacy queues:** construct an inherited V8 payload from V9 fields with `saveVersion: 8`, `gameVersion: '0.8.0-world-foundation'`, and `intersections: {}` solely to hydrate inherited world/city fields; then rebuild authority and call `core.intersectionControl.restore(save.intersectionControl, authority, laneGroups)`.
- [ ] **Step 6: Implement V9 serialization:** get inherited V8 fields, discard its `intersections`, and attach `core.intersectionControl.snapshot()`. Canonical V9 has no second persisted live queue authority.
- [ ] **Step 7: Make `save.ts` default to `serializeCoreV9`/`hydrateCoreV9` and retain named legacy exports.** V3–V8 loading must continue. Historical explicit serializers remain available but are not required to downgrade V9-only controller continuation faithfully; document this rather than silently claiming round-trip equivalence.
- [ ] **Step 8: Run V9 + V8 + V7 + V6 tests** → PASS.
- [ ] **Step 9: Commit:** `feat: add Save V9 intersection control persistence`.

---

### Task 14: Add structural scale and determinism acceptance

**Files:**
- Create: `tests/transport3r-intersection-scale.test.ts`
- Modify: `src/simulation/transportation/IntersectionControlSystem.ts` only if diagnostics/index fixes are required.

- [ ] **Step 1: Build 100×100 road-cell fixture** and a high-active-queue fixture across many intersections.
- [ ] **Step 2: RED structural assertions:** no per-vehicle full authority `.find()` scans; resolver uses indexes; controller reports only active junctions stepped; unchanged road revision does not rebuild authority/lane groups/resolver/control topology.
- [ ] **Step 3: Add minimal read-only diagnostics** if absent: `networkRebuilds`, `activeJunctionsStepped`, `movementLookups`, `conflictLookups`, `queueHeadsExamined`.
- [ ] **Step 4: Log but do not assert wall-clock diagnostics:** `roadCells`, `junctions`, `movements`, `plans`, `queuedVehicles`, diagnostics, `buildMs`, `stepMs`.
- [ ] **Step 5: Run focused scale test twice** → identical structural counts/PASS.
- [ ] **Step 6: Commit:** `test: add 3R-B intersection scale acceptance`.

---

### Task 15: Update authoritative documentation to V9/3R-B

**Files:**
- Modify: `docs/SAVE_FORMAT.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/SIMULATION.md`

- [ ] **Step 1: `SAVE_FORMAT.md`:** canonical V9, game version, inherited V8 World Foundation, authoritative `intersectionControl`, derived conflict/lane indexes, V8→V9 migration, V3–V8 legacy loads.
- [ ] **Step 2: `ARCHITECTURE.md`:** 3R-A owns physical/legal transport topology; 3R-B owns live control/queue state; inert `IntersectionSystem` exists only as historical-save compatibility during old hydration.
- [ ] **Step 3: `SIMULATION.md`:** movement queues, U.S. STOP/YIELD/all-way STOP, fixed signals, protected/permissive lefts, RTOR, pedestrian clearance, coordination, controlled-access semantics, emergency/transit hooks, one central controller step per tick.
- [ ] **Step 4: Search current authoritative docs/source comments for stale claims that V7/V8 is canonical or legacy `IntersectionSystem` is live.** Do not rewrite historical specs/plans except the already committed V9 amendment.
- [ ] **Step 5: Commit:** `docs: document 3R-B and Save V9`.

---

### Task 16: Full regression, architecture review, and PR completion gate

**Files:** modify only files required by failures/review findings.

- [ ] **Step 1: Run `npm test`** → 0 failures.
- [ ] **Step 2: Run `npm run typecheck`, `npm run lint`, `npm run assets:check`, `npm run build`** → all exit 0.
- [ ] **Step 3: Run `npm run test:smoke`, `npm run test:smoke:phase7`, `npm run test:smoke:isometric`** → all pass.
- [ ] **Step 4: Architecture checklist:** no live `IntersectionSystem.stepNode` use in core/traffic/service; one central `intersectionControl.step` per tick; ordinary + service release sets share one capacity spend; legacy object only compatibility; expressway/highway at-grade controls rejected; all signal/STOP/RTOR/pedestrian/coordination/priority behaviors tested; V9 default and V8 load green; no placeholder markers in new production code; production coordinators remain focused.
- [ ] **Step 5: Invoke `superpowers:requesting-code-review`** against branch base/head. For every valid Critical/Important finding: first add a RED regression, then fix, rerun focused gates, and commit.
- [ ] **Step 6: After the final code change, rerun Steps 1–3 fresh.** Do not make completion claims from earlier CI.
- [ ] **Step 7: Update draft PR body** with exact test count, static/build/smoke results, Save V9 migration evidence, scale diagnostics, and explicit deferrals. Do not mark ready or merge without user authorization.

---

## Acceptance Traceability

- Stable public control semantics: Task 1.
- Legacy route compatibility: Task 2.
- Explicit pedestrian crossings + physical conflicts: Task 3.
- Hierarchy control, warrants/hysteresis, controlled access, fixed signal plans: Task 4.
- Movement queues/pending releases: Task 5.
- STOP/YIELD/all-way STOP/gap acceptance: Task 6.
- Pedestrian runtime, protected/permissive/protected-only turns, RTOR, yellow/all-red: Task 7.
- Coordination, emergency preemption, transit-priority hooks: Task 8.
- Sole runtime controller API and lane-group discharge: Task 9.
- Ordinary live traffic cutover: Task 10.
- Service/emergency live cutover: Task 11.
- Exactly one live controller step + inert historical-save container: Task 12.
- Save V9 canonical, V8→V9 migration, V3–V8 loading: Task 13.
- Metropolitan structural performance/determinism: Task 14.
- Current documentation: Task 15.
- Full CI/review gate: Task 16.

## Execution Rule

No implementation code precedes Task 1's RED test. Complete tasks in order because later tasks consume exact interfaces defined earlier. Commit each independently green task. Never merge 3R-B without explicit user authorization.