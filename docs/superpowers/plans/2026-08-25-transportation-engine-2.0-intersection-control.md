# Civic Foundry 2.0 — 3R-B Intersection Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Civic Foundry's live node-capacity intersection queue with a deterministic U.S.-style movement-aware intersection-control engine, migrate ordinary and service traffic to it, and make Save V9 the canonical persistence format.

**Architecture:** 3R-B builds on the existing 3R-A `TransportNetworkAuthority`, explicit `TurnMovementId`s, and derived lane groups. New focused transportation-control modules derive conflicts and control plans, own movement queues and controller runtime, and expose one `IntersectionControlSystem` authority consumed by both `TrafficSystem` and `ServiceVehicleSystem`; legacy route planning remains edge-based for this tranche through an indexed edge-to-movement resolver. Save V9 extends existing World Foundation Save V8, removes the obsolete legacy intersection queue from canonical output, and migrates V8 queue state deterministically into movement queues.

**Tech Stack:** TypeScript ES modules, Node 22 built-in test runner, existing `TransportationGraph`/3R-A transport semantics, deterministic simulation kernel, GitHub Actions CI.

**Spec:** `docs/superpowers/specs/2026-08-25-transportation-engine-2.0-intersection-control-design.md`

**Persistence amendment:** `docs/superpowers/specs/2026-08-25-transportation-engine-2.0-intersection-control-save-v9-amendment.md` — authoritative over all Save V8/V7→V8 wording in the original spec.

## Global Constraints

- U.S. right-hand-traffic semantics; FHWA MUTCD 11th Edition with Revision 1 is the engineering reference, not a jurisdiction-by-jurisdiction legal database.
- `expressway` and `highway` are controlled-access mainline classes; ordinary at-grade STOP/YIELD/signal control is invalid on those mainlines.
- `IntersectionControlSystem` becomes the sole live intersection authority for ordinary and service vehicles.
- Legacy edge-based route planning remains supported during 3R-B; do not force a full migration to `MovementAwarePathfindingSystem`.
- Automatic control assignment is hierarchy/demand based, deterministic, reviewed only at fixed review epochs, and uses hysteresis to prevent plan flapping.
- Protected/permissive left turns are the default signal treatment; protected-only operation remains explicit and enforceable.
- RTOR is policy-driven, default enabled in the U.S. ruleset, and still requires stop compliance, acceptable gap, no pedestrian conflict, and no local prohibition.
- Pedestrian WALK/change/clearance is explicit controller state; no full pedestrian-agent simulation in 3R-B.
- Emergency preemption has precedence over transit priority but may not skip physical conflict clearance.
- Adaptive signal optimization, crashes, parking search, weather control, reversible-lane scheduling, and microscopic lane changing are out of scope.
- Save V9 is canonical: `saveVersion: 9`, `gameVersion: '0.9.0-intersection-control'`; Save V8 remains a supported legacy input.
- Preserve deterministic stable ordering and existing V3–V8 load compatibility.
- TDD for every task: RED test → minimal GREEN implementation → focused regression → commit.
- Keep new production coordinators focused and normally below the repository architecture-warning threshold; split helpers instead of growing a monolith.
- Full acceptance gate: `npm test`, `npm run typecheck`, `npm run lint`, `npm run assets:check`, `npm run build`, `npm run test:smoke`, `npm run test:smoke:phase7`, and `npm run test:smoke:isometric`.

---

## File Structure

### New transportation-control files

- `src/simulation/transportation/IntersectionControlTypes.ts` — public immutable control, queue, signal, pedestrian, snapshot, policy, and demand types.
- `src/simulation/transportation/LegacyRouteMovementResolver.ts` — indexed legacy edge → carriageway → movement/lane-group compatibility mapping.
- `src/simulation/transportation/ConflictMatrixBuilder.ts` — pure deterministic vehicle/pedestrian conflict derivation.
- `src/simulation/transportation/ControlPlanBuilder.ts` — hierarchy-based automatic control, review cadence/hysteresis, overrides, controlled-access validation.
- `src/simulation/transportation/SignalPlanBuilder.ts` — deterministic fixed-time U.S.-style phase plan and clearance timing construction.
- `src/simulation/transportation/MovementQueueStore.ts` — authoritative movement queues, partial weighted service, pending release, snapshot/restore.
- `src/simulation/transportation/UnsignalizedController.ts` — uncontrolled/YIELD/two-way STOP/all-way STOP/ramp-terminal eligibility and deterministic gap acceptance.
- `src/simulation/transportation/SignalController.ts` — fixed-time phase execution, protected/permissive/clearance state, RTOR eligibility.
- `src/simulation/transportation/PedestrianController.ts` — aggregate crossing demand and WALK/change/clearance occupancy.
- `src/simulation/transportation/PriorityController.ts` — emergency preemption and transit-priority request ordering/transition intent.
- `src/simulation/transportation/SignalCoordinationBuilder.ts` — deterministic arterial groups and offsets.
- `src/simulation/transportation/IntersectionControlSystem.ts` — sole orchestration/snapshot API; no geometry or route ownership.
- `src/simulation/transportation/IntersectionControlMigration.ts` — legacy V8 queue → V9 movement-control migration helper.
- `src/save/saveV9.ts` — canonical Save V9 envelope and V8→V9 hydration path.

### Existing files intentionally modified

- `src/simulation/traffic/TrafficSystem.ts` — queue/release against movement authority instead of legacy node queue.
- `src/simulation/services/ServiceVehicleSystem.ts` — same cutover for service/emergency vehicles and preemption requests.
- `src/simulation/core/LegacySimulationCore.ts` — instantiate 3R-A projection + 3R-B controller and pass one control authority to all live road vehicles.
- `src/save/save.ts` — make V9 default while retaining V3–V8 exports.
- `docs/SAVE_FORMAT.md`, `docs/ARCHITECTURE.md`, `docs/SIMULATION.md` — document V9 and new live authority.

### New tests

- `tests/transport3r-intersection-types.test.ts`
- `tests/transport3r-route-movement-resolver.test.ts`
- `tests/transport3r-conflicts.test.ts`
- `tests/transport3r-control-plans.test.ts`
- `tests/transport3r-movement-queues.test.ts`
- `tests/transport3r-unsignalized.test.ts`
- `tests/transport3r-signals.test.ts`
- `tests/transport3r-pedestrians.test.ts`
- `tests/transport3r-priority-coordination.test.ts`
- `tests/transport3r-intersection-control.test.ts`
- `tests/transport3r-live-traffic.test.ts`
- `tests/transport3r-live-service-vehicles.test.ts`
- `tests/save-v9.test.ts`
- `tests/transport3r-intersection-scale.test.ts`

---

### Task 1: Define the 3R-B public control model and U.S. policy defaults

**Files:**
- Create: `src/simulation/transportation/IntersectionControlTypes.ts`
- Test: `tests/transport3r-intersection-types.test.ts`

**Interfaces:**
- Consumes: `JunctionId`, `CarriagewayId`, `LaneGroupId`, `TurnMovementId` from `TransportNetworkTypes.ts`.
- Produces: `JunctionControlType`, `MovementServiceState`, `JunctionControlPolicy`, `JunctionControlPlan`, `SignalPhase`, `SignalTimingPlan`, `PedestrianCrossing`, `MovementQueueEntry`, `IntersectionPriorityRequest`, `IntersectionControlDemandSnapshot`, `IntersectionControlSnapshot`, and `US_INTERSECTION_POLICY`.

- [ ] **Step 1: Write the failing type/runtime-default test**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { US_INTERSECTION_POLICY, isControlledAccessRoadClass } from '../src/simulation/transportation/IntersectionControlTypes.ts';

test('U.S. intersection defaults enable RTOR and classify freeway classes as controlled access', () => {
  assert.equal(US_INTERSECTION_POLICY.rightTurnOnRed, true);
  assert.equal(US_INTERSECTION_POLICY.minimumStopTicks, 10);
  assert.equal(US_INTERSECTION_POLICY.controlReviewTicks, 6000);
  assert.equal(isControlledAccessRoadClass('expressway'), true);
  assert.equal(isControlledAccessRoadClass('highway'), true);
  assert.equal(isControlledAccessRoadClass('arterial'), false);
});
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `node --experimental-strip-types --test tests/transport3r-intersection-types.test.ts`

Expected: FAIL because `IntersectionControlTypes.ts` does not exist.

- [ ] **Step 3: Implement the immutable public types and exact defaults**

Use these canonical unions and defaults:

```ts
export type JunctionControlType = 'uncontrolled' | 'yield' | 'twoWayStop' | 'allWayStop' | 'signal' | 'merge' | 'diverge' | 'rampTerminal';
export type MovementServiceState = 'prohibited' | 'stop' | 'yield' | 'permissive' | 'protected' | 'clearance';
export type QueuePriority = 'normal' | 'transit' | 'emergency';

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

Define snapshots with sorted readonly arrays rather than `Map`/`Set`. `IntersectionControlSnapshot` must contain `plans`, `queues`, `signalRuntime`, `pedestrianRuntime`, `priorityRequests`, `coordinationGroups`, `overrides`, `controlPlanRevision`, `controlRuntimeEpoch`, and `lastPlanReviewTick`.

- [ ] **Step 4: Run focused test GREEN, then typecheck**

Run:
- `node --experimental-strip-types --test tests/transport3r-intersection-types.test.ts`
- `npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/simulation/transportation/IntersectionControlTypes.ts tests/transport3r-intersection-types.test.ts
git commit -m "feat: define 3R-B intersection control types"
```

---

### Task 2: Resolve legacy edge routes to explicit 3R movements

**Files:**
- Create: `src/simulation/transportation/LegacyRouteMovementResolver.ts`
- Test: `tests/transport3r-route-movement-resolver.test.ts`

**Interfaces:**
- Consumes: `TransportNetworkAuthority`, `LaneGroup[]`, legacy edge IDs emitted by `LegacyTransportationGraphAdapter`.
- Produces:

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

- [ ] **Step 1: Write RED tests for straight, left, malformed, and non-contiguous edge pairs**

Build a plus-shaped `RoadSystem`, project with `LegacyRoadNetworkAdapter`, derive groups with `buildLaneGroups`, and assert that `e:n:0,1>n:1,1` followed by `e:n:1,1>n:2,1` resolves to the matching `through` movement and incoming lane groups whose `movementIds` include that movement. Assert malformed/non-contiguous pairs return `undefined`.

- [ ] **Step 2: Run RED**

Run: `node --experimental-strip-types --test tests/transport3r-route-movement-resolver.test.ts`

Expected: FAIL because resolver is missing.

- [ ] **Step 3: Implement an indexed resolver**

Parse only the canonical legacy shape:

```ts
const EDGE = /^e:n:(-?\d+),(-?\d+)>n:(-?\d+),(-?\d+)$/;
```

At construction, index carriageways by `fromJunctionId>toJunctionId`, movements by `fromCarriagewayId>toCarriagewayId`, and incoming lane groups by `movementId`. Reuse `legacyJunctionId(x, y)`; never discover identities by array position. `resolve()` must perform O(1)-style map lookups after parsing.

- [ ] **Step 4: Run GREEN and existing compatibility tests**

Run:
- `node --experimental-strip-types --test tests/transport3r-route-movement-resolver.test.ts`
- `node --experimental-strip-types --test tests/transport2-compatibility.test.ts tests/transport2-turn-movements.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/simulation/transportation/LegacyRouteMovementResolver.ts tests/transport3r-route-movement-resolver.test.ts
git commit -m "feat: resolve legacy routes to 3R movements"
```

---

### Task 3: Build deterministic movement and pedestrian conflict matrices

**Files:**
- Create: `src/simulation/transportation/ConflictMatrixBuilder.ts`
- Test: `tests/transport3r-conflicts.test.ts`

**Interfaces:**
- Consumes: `TransportNetworkAuthority`, optional `PedestrianCrossing[]`.
- Produces:

```ts
export type ConflictParticipantId = TurnMovementId | PedestrianCrossingId;
export type JunctionConflictMatrix = Readonly<{
  junctionId: JunctionId;
  participants: readonly ConflictParticipantId[];
  conflicts(a: ConflictParticipantId, b: ConflictParticipantId): boolean;
}>;
export function buildConflictMatrices(authority: TransportNetworkAuthority, crossings: readonly PedestrianCrossing[]): readonly JunctionConflictMatrix[];
```

- [ ] **Step 1: Write RED geometry tests**

Use one exact cardinal four-leg fixture and assert: opposing through movements are compatible, left-vs-opposing-through conflicts, perpendicular through movements conflict, two rights with distinct departure lanes are compatible, shared constrained departure lanes conflict, pedestrian crossings conflict with crossing/permissive turns, matrix is symmetric, and a participant never conflicts with itself.

- [ ] **Step 2: Run RED**

Run: `node --experimental-strip-types --test tests/transport3r-conflicts.test.ts`

Expected: FAIL because builder is missing.

- [ ] **Step 3: Implement cardinal path conflict derivation behind a geometry-neutral API**

Represent each movement's approach/junction/departure as normalized points; compare center-line path segments for crossing conflicts, explicitly handle same-departure merge conflicts, and apply crossing conflict sets for pedestrians. Sort junctions and participant IDs before output. Keep cardinal-specific math private so future non-cardinal geometry can replace it without changing consumers.

- [ ] **Step 4: Run GREEN and determinism repeat**

Run the focused file twice and assert serialized participant/conflict pairs are identical.

- [ ] **Step 5: Commit**

```bash
git add src/simulation/transportation/ConflictMatrixBuilder.ts tests/transport3r-conflicts.test.ts
git commit -m "feat: derive intersection conflict matrices"
```

---

### Task 4: Build hierarchy-based U.S. control plans, fixed signal plans, and controlled-access validation

**Files:**
- Create: `src/simulation/transportation/ControlPlanBuilder.ts`
- Create: `src/simulation/transportation/SignalPlanBuilder.ts`
- Test: `tests/transport3r-control-plans.test.ts`

**Interfaces:**
- Consumes: authority, lane groups, conflict matrices, `IntersectionControlDemandSnapshot`, prior plans, overrides, policy, tick.
- Produces:

```ts
export type ControlPlanBuildResult = Readonly<{
  plans: readonly JunctionControlPlan[];
  changed: boolean;
}>;
export function buildControlPlans(input: ControlPlanBuildInput): ControlPlanBuildResult;
export function buildSignalTimingPlan(input: SignalPlanBuildInput): SignalTimingPlan;
```

- [ ] **Step 1: Write RED hierarchy/warrant tests**

Cover exact expectations:
- low-demand local×local → `uncontrolled`;
- local entering collector/arterial → lower-order approach controlled by `yield` or `twoWayStop` policy, with major approach priority;
- collector×collector → `twoWayStop` by default;
- signal score ≥ 100 at collector/arterial or arterial/arterial → `signal`;
- an existing signal remains signal while score is 80–99 and exits only below 80 at a review epoch;
- no automatic plan changes when `tick - lastPlanReviewTick < 6000`;
- illegal highway/expressway mainline `signal`/`allWayStop` override throws;
- controlled-access merge/diverge topology maps to `merge`/`diverge`/`rampTerminal` only.

Use a deterministic signal score:

```ts
score = hierarchyBase
  + Math.min(40, totalMovementDemandPerMinute * 0.25)
  + Math.min(20, pedestrianDemandPerMinute * 0.5)
  + Math.min(20, leftTurnDemandPerMinute * 0.5)
  + Math.min(20, conflictCount * 2)
  + Math.min(20, crashRiskScore * 20);
```

Set hierarchy base to 20 local/local, 35 local/collector, 50 collector/collector, 65 collector/arterial, 80 arterial/arterial.

- [ ] **Step 2: Run RED**

Run: `node --experimental-strip-types --test tests/transport3r-control-plans.test.ts`

- [ ] **Step 3: Implement automatic plan selection and hysteresis**

Control review occurs on topology change, override change, or when at least `policy.controlReviewTicks` elapsed. A no-op rebuild returns the prior plan object values and `changed: false`. Overrides win only after structural validation.

- [ ] **Step 4: Implement deterministic signal-plan generation**

For the cardinal U.S. grid:
- group opposing compatible through/right movements;
- attach compatible lefts as permissive by default;
- create protected-left phase groups only for movements flagged `protectedOnly` by policy/override;
- calculate yellow as `clamp(round((3 + speedKph / 80) * 10), 30, 50)` ticks;
- calculate all-red as `clamp(round((junctionClearanceMeters / max(speedKph / 3.6, 1)) * 10), 10, 30)` ticks;
- use minimum protected green of 80 ticks and deterministic demand split thereafter;
- reject a phase containing conflicting protected participants.

- [ ] **Step 5: Run GREEN plus typecheck**

Run:
- focused test;
- `npm run typecheck`.

- [ ] **Step 6: Commit**

```bash
git add src/simulation/transportation/ControlPlanBuilder.ts src/simulation/transportation/SignalPlanBuilder.ts tests/transport3r-control-plans.test.ts
git commit -m "feat: build U.S. intersection control plans"
```

---

### Task 5: Implement authoritative movement queues and release accounting

**Files:**
- Create: `src/simulation/transportation/MovementQueueStore.ts`
- Test: `tests/transport3r-movement-queues.test.ts`

**Interfaces:**
- Produces:

```ts
export class MovementQueueStore {
  enqueue(entry: MovementQueueEntry): boolean;
  peek(movementId: TurnMovementId): MovementQueueEntry | undefined;
  entries(movementId?: TurnMovementId): readonly MovementQueueEntry[];
  serve(movementId: TurnMovementId, capacityWeight: number): readonly string[];
  acknowledge(vehicleId: string): void;
  removeVehicle(vehicleId: string): void;
  hasVehicle(vehicleId: string): boolean;
  snapshot(): MovementQueueSnapshot;
  restore(snapshot: MovementQueueSnapshot, validMovementIds: ReadonlySet<string>, validLaneGroupIds: ReadonlySet<string>): void;
}
```

- [ ] **Step 1: Write RED invariants**

Test one-queue-per-vehicle, deterministic queue order (`priority class`, then queued/stop eligibility metadata, then `queuedTick`, then stable ID), partial weighted service, pending release idempotence, acknowledge/remove behavior, duplicate/unknown restore rejection, canonical snapshot ordering.

- [ ] **Step 2: Run RED**

Run: `node --experimental-strip-types --test tests/transport3r-movement-queues.test.ts`

- [ ] **Step 3: Implement minimal indexed store**

Maintain `queuesByMovement`, `vehicleLocation`, and `pendingReleased`. `serve()` may decrement the head entry's remaining `travelerWeight`; once fully consumed, move it to pending release. Never spend the same pending release again.

- [ ] **Step 4: Run GREEN**

Run focused test twice to verify deterministic snapshot identity.

- [ ] **Step 5: Commit**

```bash
git add src/simulation/transportation/MovementQueueStore.ts tests/transport3r-movement-queues.test.ts
git commit -m "feat: add movement-aware intersection queues"
```

---

### Task 6: Implement unsignalized U.S. right-of-way and deterministic gap acceptance

**Files:**
- Create: `src/simulation/transportation/UnsignalizedController.ts`
- Test: `tests/transport3r-unsignalized.test.ts`

**Interfaces:**
- Produces:

```ts
export type UnsignalizedDecisionContext = Readonly<{
  tick: number;
  plan: JunctionControlPlan;
  movement: TurnMovement;
  head: MovementQueueEntry;
  conflictingHeads: readonly Readonly<{ movement: TurnMovement; entry: MovementQueueEntry; priorityRank: number; lastReleaseTick?: number }>[];
  pedestrianConflictActive: boolean;
  approachSpeedKph: number;
}>;
export function unsignalizedServiceState(context: UnsignalizedDecisionContext): MovementServiceState;
export function requiredGapTicks(movement: TurnMovement, approachSpeedKph: number, vehiclePermissionMask?: number): number;
```

- [ ] **Step 1: Write RED tests**

Cover mandatory 10-tick stop dwell, YIELD with clear gap, YIELD blocked by higher-priority conflicting head, major-street priority, all-way STOP completed-stop order, simultaneous-arrival geometric priority then movement ID then vehicle ID, and pedestrian blocking.

- [ ] **Step 2: Run RED**

Run focused test.

- [ ] **Step 3: Implement deterministic rules**

Required gap baseline: right 20 ticks, through 30, left 40; add `round(max(0, approachSpeedKph - 40) / 10) * 5`; heavy freight adds 10. A conflicting higher-priority queued head blocks acceptance; otherwise require `tick - lastConflictReleaseTick >= requiredGapTicks`. No RNG.

- [ ] **Step 4: Run GREEN**

Run focused test and `tests/transport2-turn-movements.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/simulation/transportation/UnsignalizedController.ts tests/transport3r-unsignalized.test.ts
git commit -m "feat: add U.S. unsignalized right of way"
```

---

### Task 7: Implement pedestrian runtime and fixed-time signal execution

**Files:**
- Create: `src/simulation/transportation/PedestrianController.ts`
- Create: `src/simulation/transportation/SignalController.ts`
- Test: `tests/transport3r-pedestrians.test.ts`
- Test: `tests/transport3r-signals.test.ts`

**Interfaces:**
- `PedestrianController.step(plan, demand, tick)` exposes active crossing IDs and snapshot/restore.
- `SignalController.step(plan, runtime, tick, pedestrianState)` returns stable phase runtime and movement states.
- `SignalController.serviceState(movementId)` returns one `MovementServiceState`.

- [ ] **Step 1: Write RED pedestrian tests**

Verify WALK permits aggregate entry, change interval prevents new entry but preserves occupancy, clearance remains active for `ceil(crossingLengthMeters / 1.1 * 10)` ticks, and conflicting permissive turns observe active occupancy.

- [ ] **Step 2: Implement `PedestrianController` and run GREEN**

Persist only runtime occupancy/interval state; crossing geometry remains derived.

- [ ] **Step 3: Write RED signal tests**

Cover fixed phase progression, protected through, permissive left, protected-only left, yellow, all-red, RTOR allowed after stop+gap, RTOR disabled by policy, and pedestrian conflict blocking.

- [ ] **Step 4: Implement `SignalController`**

Treat plan intervals as immutable until plan revision changes. Phase transitions are deterministic; yellow/all-red are explicit runtime modes. `permissive` never bypasses conflict checks. RTOR returns `stop` until stop dwell is met, then `yield` subject to policy/conflict conditions.

- [ ] **Step 5: Run GREEN and typecheck**

Run both focused files and `npm run typecheck`.

- [ ] **Step 6: Commit**

```bash
git add src/simulation/transportation/PedestrianController.ts src/simulation/transportation/SignalController.ts tests/transport3r-pedestrians.test.ts tests/transport3r-signals.test.ts
git commit -m "feat: execute pedestrian and signal control"
```

---

### Task 8: Add arterial coordination and priority/preemption request semantics

**Files:**
- Create: `src/simulation/transportation/SignalCoordinationBuilder.ts`
- Create: `src/simulation/transportation/PriorityController.ts`
- Test: `tests/transport3r-priority-coordination.test.ts`

**Interfaces:**
- `buildSignalCoordinationGroups(plans, authority): readonly SignalCoordinationGroup[]`
- `PriorityController.submit(request)`, `.step(...)`, `.snapshot()`, `.restore(...)`.

- [ ] **Step 1: Write RED coordination tests**

For three signalized arterial junctions in a line, require common compatible cycle length and offsets equal to cumulative free-flow travel ticks modulo cycle; stable corridor signature/order must not depend on source array order.

- [ ] **Step 2: Implement coordination builder and run GREEN**

Group only contiguous signalized junctions sharing the same dominant arterial corridor; do not coordinate unrelated local roads.

- [ ] **Step 3: Write RED priority tests**

Verify emergency request outranks transit request, expired requests vanish, incompatible emergency movement first requests safe yellow/all-red transition rather than immediate green, and transit priority may extend/advance compatible service only within plan bounds.

- [ ] **Step 4: Implement priority controller and run GREEN**

Use request order: emergency before transit, then requested tick, then request ID. Expose transition intent; do not mutate road topology.

- [ ] **Step 5: Commit**

```bash
git add src/simulation/transportation/SignalCoordinationBuilder.ts src/simulation/transportation/PriorityController.ts tests/transport3r-priority-coordination.test.ts
git commit -m "feat: coordinate signals and priority requests"
```

---

### Task 9: Assemble the sole `IntersectionControlSystem` authority

**Files:**
- Create: `src/simulation/transportation/IntersectionControlSystem.ts`
- Test: `tests/transport3r-intersection-control.test.ts`

**Interfaces:**

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

- [ ] **Step 1: Write RED orchestration tests**

Cover: movement queue release under uncontrolled compatible movements; conflicting movements not released in same conflict window; lane-group capacity applied as `capacityPerMinute / 600` weight per simulation tick; signal state gates release; same-tick repeated `step()` is idempotent; topology revision rebuilds matrices/plans; no-op sync does not inflate `controlPlanRevision`; override persists if valid and is removed/rejected when structurally impossible.

- [ ] **Step 2: Run RED**

Run focused test.

- [ ] **Step 3: Implement orchestration using earlier focused modules**

Indexes must include movement→junction, movement→incoming lane groups, carriageway→speed, junction→conflict matrix, and plan-by-junction. Step only junctions with active queues, active pedestrian runtime, active signal runtime, or priority requests. Do not scan every road cell per queued vehicle.

- [ ] **Step 4: Run GREEN plus focused 3R-B suite**

Run all `tests/transport3r-*.test.ts` created so far using Node's test runner shell expansion.

- [ ] **Step 5: Commit**

```bash
git add src/simulation/transportation/IntersectionControlSystem.ts tests/transport3r-intersection-control.test.ts
git commit -m "feat: add authoritative intersection control system"
```

---

### Task 10: Cut ordinary `TrafficSystem` over to movement-aware control

**Files:**
- Modify: `src/simulation/traffic/TrafficSystem.ts`
- Test: `tests/transport3r-live-traffic.test.ts`
- Regression: `tests/traffic-simulation.test.ts`, `tests/traffic-routing.test.ts`

**Interfaces:**
- Replace the `IntersectionSystem` parameter with `IntersectionControlSystem` plus a `LegacyRouteMovementResolver` supplied for the current authority revision.
- Preserve existing `TrafficVehicle` edge-route representation and trip accounting.

- [ ] **Step 1: Write RED live-cutover tests**

Assert a vehicle reaching a controlled junction resolves current+next edge to one explicit movement, remains on the current edge while queued, increments delay, advances exactly one edge after controller release, and fails cleanly if no legal movement maps the route. Assert the old `graph.outgoingEdges(edge.to).length > 2` heuristic is no longer the decision boundary.

- [ ] **Step 2: Run RED**

Run focused live traffic test.

- [ ] **Step 3: Change `TrafficSystem.step`**

Use this flow:

```ts
const resolved = resolver.resolve(edge.id, nextEdge.id);
if (!resolved) { this.fail(vehicle, controls, tick); continue; }
vehicle.status = 'queued';
vehicle.queuedNodeId = resolved.junctionId;
controls.enqueue({
  vehicleId: vehicle.id,
  movementId: resolved.movementId,
  laneGroupIds: resolved.laneGroupIds,
  travelerWeight: vehicle.travelerWeight,
  queuedTick: tick,
  priority: 'normal',
});
```

Controller release/acknowledge advances exactly one edge. `fail()` must remove the vehicle from `IntersectionControlSystem`.

- [ ] **Step 4: Run GREEN + legacy traffic regression**

Run:
- new live test;
- `tests/traffic-simulation.test.ts`;
- `tests/traffic-routing.test.ts`.

Update legacy tests only where they were asserting the obsolete node-capacity mechanism; preserve all trip outcome and edge metric assertions.

- [ ] **Step 5: Commit**

```bash
git add src/simulation/traffic/TrafficSystem.ts tests/transport3r-live-traffic.test.ts tests/traffic-simulation.test.ts tests/traffic-routing.test.ts
git commit -m "feat: route live traffic through 3R intersection control"
```

---

### Task 11: Cut service/emergency vehicles over and exercise preemption

**Files:**
- Modify: `src/simulation/services/ServiceVehicleSystem.ts`
- Test: `tests/transport3r-live-service-vehicles.test.ts`
- Regression: `tests/service-core-integration.test.ts`, `tests/service-dispatch.test.ts`

**Interfaces:**
- `ServiceVehicleSystem.step` consumes `IntersectionControlSystem` and `LegacyRouteMovementResolver` instead of `IntersectionSystem`.

- [ ] **Step 1: Write RED service-vehicle tests**

Cover garbage truck weight 2 movement queueing; fire/police/ambulance weight 1 emergency queueing; emergency vehicle submits deterministic `emergencyPreemption` request for its movement; release advances the same current route without teleporting; reroute-on-missing-edge still works before re-resolving movement; removal/failure clears controller membership.

- [ ] **Step 2: Run RED**

Run focused service test.

- [ ] **Step 3: Implement service cutover**

Preserve `queuedNodeId` for vehicle presentation/save compatibility, but intersection authority comes only from movement queue membership. Generate preemption request ID deterministically:

```ts
`ipr:${vehicle.id}:${resolved.movementId}`
```

with a bounded expiry such as `tick + 100`; resubmission with same ID refreshes rather than duplicates.

- [ ] **Step 4: Run GREEN + service regressions**

Run new service test and existing service integration/dispatch tests.

- [ ] **Step 5: Commit**

```bash
git add src/simulation/services/ServiceVehicleSystem.ts tests/transport3r-live-service-vehicles.test.ts tests/service-core-integration.test.ts tests/service-dispatch.test.ts
git commit -m "feat: route service vehicles through 3R control"
```

---

### Task 12: Wire 3R-A authority projection and 3R-B control into the live simulation core

**Files:**
- Modify: `src/simulation/core/LegacySimulationCore.ts`
- Test: `tests/transport3r-live-traffic.test.ts`
- Test: `tests/transport3r-live-service-vehicles.test.ts`
- Regression: `tests/core-city-loop.test.ts`, `tests/phase6-headless.test.ts`

**Interfaces:**
- Add core-owned `LegacyRoadNetworkAdapter`, derived lane groups/resolver cache, and `IntersectionControlSystem`.
- Keep `TransportationGraph` for legacy route consumers.

- [ ] **Step 1: Write RED core integration assertion**

Construct a core, build a plus/cross road network, step simulation, and assert `core.intersections` is the new `IntersectionControlSystem` authority with a plan for the central 3R junction; assert ordinary/service vehicles reference the same controller instance.

- [ ] **Step 2: Run RED**

Run focused integration tests.

- [ ] **Step 3: Replace core wiring**

In each tick, after `transportationGraph.rebuildIfNeeded(this.roads)`:

```ts
const projected = this.transportNetworkAdapter.projectAuthorityIfNeeded(this.roads);
const laneGroups = buildLaneGroups(projected.authority);
this.syncIntersectionRuntime(projected.authority, laneGroups);
```

Cache lane groups and `LegacyRouteMovementResolver` by `roads.revision`; do not rebuild them every tick when revision is unchanged. Build demand input from controller-observed movement arrivals/queues and available traffic metrics; initial pedestrian demand may be zero unless supplied by existing mobility aggregate, but pedestrian controller APIs/tests remain operational.

Pass the same `IntersectionControlSystem` + resolver to service vehicles and ordinary traffic. Ensure controller `step(tick)` is performed once per simulation tick centrally, not independently by each consumer, so capacity cannot be double-spent across subsystems.

- [ ] **Step 4: Run GREEN + core regressions**

Run focused tests, core city loop, Phase 6 headless, and typecheck.

- [ ] **Step 5: Commit**

```bash
git add src/simulation/core/LegacySimulationCore.ts tests/transport3r-live-traffic.test.ts tests/transport3r-live-service-vehicles.test.ts tests/core-city-loop.test.ts tests/phase6-headless.test.ts
git commit -m "feat: make 3R intersection control live authority"
```

---

### Task 13: Implement Save V9 and deterministic V8 queue migration

**Files:**
- Create: `src/simulation/transportation/IntersectionControlMigration.ts`
- Create: `src/save/saveV9.ts`
- Modify: `src/save/save.ts`
- Test: `tests/save-v9.test.ts`
- Regression: `tests/save-v8.test.ts`, `tests/save-v7.test.ts`

**Interfaces:**

```ts
export type SaveV9 = Omit<SaveV8, 'saveVersion' | 'gameVersion' | 'intersections'> & Readonly<{
  saveVersion: 9;
  gameVersion: '0.9.0-intersection-control';
  intersectionControl: IntersectionControlSnapshot;
}>;

export function serializeCoreV9(core: SimulationCore, baseV8?: SaveV8): SaveV9;
export function hydrateCoreV9(input: unknown): SimulationCore;
```

- [ ] **Step 1: Write RED canonical V9 tests**

Assert default `serializeCore()` emits version 9/game version above, includes `intersectionControl`, omits canonical legacy `intersections`, and round-trips an active signal mid-phase, queued STOP vehicle, pending release, priority request, override, and pedestrian runtime state exactly.

- [ ] **Step 2: Write RED V8→V9 migration tests**

Create V8 fixtures containing:
- no intersection queues;
- queued ordinary traffic;
- queued emergency service vehicle;
- a `released: true` pending legacy entry.

After `hydrateCore`, each vehicle must be represented exactly once, movement resolved from current+next route edges, weight/queuedTick/priority preserved, and pending release must not spend capacity twice.

- [ ] **Step 3: Implement `IntersectionControlMigration`**

Migration takes restored core + the original V8 intersection snapshot, rebuilds 3R authority/lane groups/resolver, maps each legacy entry by the owning traffic/service vehicle's active route, and returns a canonical `IntersectionControlSnapshot`. Throw on orphan vehicle, route mismatch, duplicate representation, unknown movement, or invalid pending release.

Signal runtime for migrated V8 starts deterministically from restored simulation tick + canonical timing plan offset. Pedestrian runtime starts empty because V8 has no authoritative equivalent.

- [ ] **Step 4: Implement `saveV9.ts` and default routing in `save.ts`**

For V9 input: validate game version and `intersectionControl`; hydrate the inherited V8 payload, then restore controller state against rebuilt authority. For non-V9 input: hydrate through existing `hydrateCoreV8`, then migrate legacy intersection state to the new controller. Preserve explicit exports for `hydrateCoreV8`/`serializeCoreV8` and older versions.

Do not fabricate a second legacy intersection snapshot in V9 canonical output.

- [ ] **Step 5: Run GREEN + historical save regressions**

Run:
- `tests/save-v9.test.ts`;
- `tests/save-v8.test.ts`;
- `tests/save-v7.test.ts`;
- `tests/save-v6.test.ts`.

- [ ] **Step 6: Commit**

```bash
git add src/simulation/transportation/IntersectionControlMigration.ts src/save/saveV9.ts src/save/save.ts tests/save-v9.test.ts tests/save-v8.test.ts tests/save-v7.test.ts
git commit -m "feat: add Save V9 intersection control persistence"
```

---

### Task 14: Add structural scale/determinism acceptance for metropolitan intersections

**Files:**
- Create: `tests/transport3r-intersection-scale.test.ts`

**Interfaces:**
- Consumes public 3R-A projection, plan/conflict builders, resolver, and `IntersectionControlSystem` diagnostics.

- [ ] **Step 1: Write RED instrumentation assertions**

Build a 100×100 road-cell fixture. Require deterministic counts for junctions/movements/control plans and instrument lookup paths so a controller step over active queues does not call whole-authority `.find()`/`.filter()` scans per vehicle. Add an active-queue fixture at many intersections.

- [ ] **Step 2: Run RED if diagnostics/index guarantees are missing**

Run focused scale test and record structural failure, not a wall-clock threshold.

- [ ] **Step 3: Add only the minimal diagnostics/index fixes needed**

Expose read-only diagnostics such as `activeJunctionsStepped`, `movementLookups`, `conflictLookups`, `queueHeadsExamined`, and `networkRebuilds`; keep all hot-path identity lookup map-based.

- [ ] **Step 4: Run GREEN and log wall-clock diagnostics without asserting them**

Print a compact object:

```ts
console.log('TRANSPORT3R_INTERSECTION_SCALE', {
  roadCells,
  junctions,
  movements,
  plans,
  queuedVehicles,
  activeJunctionsStepped,
  networkRebuilds,
  buildMs,
  stepMs,
});
```

- [ ] **Step 5: Commit**

```bash
git add tests/transport3r-intersection-scale.test.ts src/simulation/transportation/IntersectionControlSystem.ts
git commit -m "test: add 3R-B intersection scale acceptance"
```

---

### Task 15: Update authoritative documentation and eliminate stale V7/V8 claims

**Files:**
- Modify: `docs/SAVE_FORMAT.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/SIMULATION.md`
- Modify: `package.json` only if repository game-version metadata is intentionally coupled to canonical save version; otherwise leave package version unchanged and document why.

- [ ] **Step 1: Update Save Format to V9**

Document `saveVersion: 9`, `gameVersion: '0.9.0-intersection-control'`, inherited V8 World Foundation state, authoritative `intersectionControl`, rebuilt conflict/lane-group indexes, and V8→V9 migration. State that V3–V8 remain legacy load formats.

- [ ] **Step 2: Update architecture/simulation authority**

Replace documentation that describes the old node-capacity `IntersectionSystem` as live. Document 3R-A topology ownership versus 3R-B control ownership, live traffic/service cutover, movement queues, signals, STOP/YIELD, pedestrians, controlled-access semantics, and deferred adaptive/crash/parking work.

- [ ] **Step 3: Scan for stale canonical-version/control-language claims**

Run repository searches for `Save Format — V7`, `saveVersion: 8` documentation claims, and descriptions of `IntersectionSystem` as current live authority. Fix only documentation that is factually stale; retain historical design/plan docs as history.

- [ ] **Step 4: Commit**

```bash
git add docs/SAVE_FORMAT.md docs/ARCHITECTURE.md docs/SIMULATION.md
git commit -m "docs: document 3R-B and Save V9"
```

---

### Task 16: Full regression, architecture review, and PR completion gate

**Files:**
- Modify only files required by failures found in this gate.

- [ ] **Step 1: Run the complete test suite**

Run: `npm test`

Expected: 0 failures.

- [ ] **Step 2: Run static/build gates**

Run:
- `npm run typecheck`
- `npm run lint`
- `npm run assets:check`
- `npm run build`

Expected: all exit 0.

- [ ] **Step 3: Run browser/visual smoke gates**

Run:
- `npm run test:smoke`
- `npm run test:smoke:phase7`
- `npm run test:smoke:isometric`

Expected: all pass.

- [ ] **Step 4: Perform final architecture checklist**

Verify explicitly:
- no live import/use of legacy `IntersectionSystem` remains in `TrafficSystem`, `ServiceVehicleSystem`, or `LegacySimulationCore`;
- legacy `IntersectionSystem` remains only where historical save compatibility/tests require it;
- `IntersectionControlSystem` does not own road topology;
- ordinary + service vehicles share one controller step per tick;
- no duplicate capacity spend across consumers;
- expressway/highway mainlines reject ordinary at-grade controls;
- protected/permissive + protected-only lefts, RTOR, pedestrian clearance, coordination, emergency preemption, and transit priority are covered by tests;
- V9 is default and V8 loads;
- no `TODO`/`TBD`/placeholder remains in new production files;
- new production files remain focused; split any coordinator exceeding the architecture warning rather than suppressing the warning.

- [ ] **Step 5: Request code review and fix all Critical/Important findings**

Use `superpowers:requesting-code-review` against the branch base and current head. For each valid finding: add a RED regression, implement the fix, rerun focused + full applicable gates, and commit.

- [ ] **Step 6: Fresh final verification**

Rerun the entire Step 1–3 command set after the last code change. Completion claims require this fresh evidence.

- [ ] **Step 7: Update the draft PR body with exact verification evidence**

Include test count, all CI/static/smoke results, Save V9 migration coverage, scale diagnostics, live-authority cutover statement, and any deliberate deferrals. Do not mark ready or merge without explicit user authorization.

---

## Acceptance Traceability

- Explicit movement/lane-group queues: Tasks 2, 5, 9–12.
- Physical conflict matrix: Task 3.
- U.S. hierarchy, STOP/YIELD/all-way STOP, warrants/hysteresis: Tasks 4, 6.
- Fixed-time signals, protected/permissive/protected-only lefts, yellow/all-red, RTOR: Tasks 4, 7.
- Pedestrian WALK/change/clearance: Task 7.
- Arterial coordination: Task 8.
- Emergency preemption/transit priority: Tasks 8, 11.
- Controlled-access expressway/highway constraints: Tasks 1, 4, 16.
- Sole live authority for traffic + service vehicles: Tasks 9–12.
- Legacy edge-route compatibility without full routing migration: Tasks 2, 10–12.
- Save V9 canonical + V8 migration + older compatibility: Task 13.
- Determinism/performance: Tasks 3–9, 13–14.
- Documentation and stale-state cleanup: Task 15.
- Full CI/review gate: Task 16.

## Execution Notes

The branch already contains the approved design spec and Save V9 amendment. No implementation code should precede Task 1's RED test. Each task is independently reviewable and should leave the branch green before proceeding, except during an intentional RED commit/run used to demonstrate the failing test. Do not merge this branch without explicit user authorization.