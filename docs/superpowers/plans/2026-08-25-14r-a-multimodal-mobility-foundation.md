# Phase 14R-A Multimodal Mobility Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the live hard-coded `car | transit | unmet` choice seam with deterministic provider-based multimodal orchestration while preserving current car/transit behavior and Save V8 schema.

**Architecture:** Add canonical mobility types, immutable mode definitions, structured generalized cost, a deterministic provider registry/orchestrator, and compatibility providers for current car and transit authorities. `MobilityScheduler` remains the composition point; existing transit network/queue/vehicle/operations systems remain authoritative and unsupported future modes remain definitions only.

**Tech Stack:** TypeScript, Node.js `node:test`, existing Civic Foundry routing/transit systems, GitHub Actions CI.

**Spec:** `docs/superpowers/specs/2026-08-25-14r-a-multimodal-mobility-foundation-design.md`

## Global Constraints

- Canonical modes are exactly `walk`, `bicycle`, `car`, `ride_hail`, `bus`, `trolleybus`, `brt`, `tram`, `metro`, `commuter_rail`, `regional_rail`, `ferry`.
- `unmet` is an outcome, not a mode.
- Existing `TransitNetworkSystem`, `TransitVehicleSystem`, `PassengerQueueSystem`, and `TransitOperationsSystem` remain authoritative for bus/BRT/tram/metro.
- Existing weighted trip cohorts remain legacy compatibility demand; no real `PersonId` authority is introduced in 14R-A.
- Save V8 must not gain provider, mode-registry, route-cache, alternative, explanation, or canonical mode-share state.
- Unsupported future modes are unavailable until an authoritative provider exists; no placeholder execution or teleportation.
- Tie-breaking is deterministic: generalized cost, provider priority, canonical mode ID, alternative ID.
- No per-tick full-population scan.
- Existing road traffic submission, surface-transit congestion coupling, queue/capacity behavior, transit finance, World Foundation authority, and Transportation Engine 2.0 semantics remain unchanged.

## File Structure

Create:

- `src/simulation/mobility/MobilityTypes.ts`
- `src/simulation/mobility/MobilityModeRegistry.ts`
- `src/simulation/mobility/MobilityCost.ts`
- `src/simulation/mobility/MobilityChoiceSystem.ts`
- `src/simulation/mobility/MobilityProvider.ts`
- `src/simulation/mobility/MobilityOrchestrator.ts`
- `src/simulation/mobility/providers/LegacyCarMobilityProvider.ts`
- `src/simulation/mobility/providers/TransitJourneyExecutor.ts`
- `src/simulation/mobility/providers/LegacyTransitMobilityProvider.ts`
- `tests/support/mobility14rFixtures.ts`
- `tests/mobility14r-mode-choice.test.ts`
- `tests/mobility14r-providers.test.ts`
- `tests/mobility14r-performance.test.ts`

Modify:

- `src/simulation/mobility/MobilityScheduler.ts`
- `src/simulation/mobility/ModeChoiceSystem.ts`
- `tests/transit-integration.test.ts`
- `tests/transit-state.test.ts`
- `tests/save-v8.test.ts`

---

### Task 1: Canonical Types, Registry, Cost, and Test Fixtures

**Files:**
- Create: `src/simulation/mobility/MobilityTypes.ts`
- Create: `src/simulation/mobility/MobilityModeRegistry.ts`
- Create: `src/simulation/mobility/MobilityCost.ts`
- Create: `tests/support/mobility14rFixtures.ts`
- Create: `tests/mobility14r-mode-choice.test.ts`

**Interfaces:**
- Produces `MobilityModeId`, `MobilityJourneyRequest`, `MobilityTravelerCapabilities`, `MobilityCostBreakdown`, `MobilityAlternative`, `MobilityModeDefinition`, `getMobilityMode()`, `listMobilityModes()`, `buildMobilityCost()`.
- Test helpers produce `mobilityCapabilities()`, `mobilityRequest()`, and `mobilityAlternative()`.

- [ ] **Step 1: Write the failing registry/cost test**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { listMobilityModes } from '../src/simulation/mobility/MobilityModeRegistry.ts';
import { buildMobilityCost } from '../src/simulation/mobility/MobilityCost.ts';

test('14R-A exposes exactly twelve canonical modes', () => {
  assert.deepEqual(listMobilityModes().map((m) => m.id), [
    'walk','bicycle','car','ride_hail','bus','trolleybus','brt','tram','metro','commuter_rail','regional_rail','ferry',
  ]);
});

test('generalized cost rejects invalid components and sums valid ones', () => {
  const cost = buildMobilityCost({
    accessEgressTicks: 1, expectedWaitTicks: 2, movementTicks: 3,
    transferPenaltyTicks: 4, fareImpedanceTicks: 5, parkingImpedanceTicks: 6,
    congestionDelayTicks: 7, crowdingPenaltyTicks: 8, reliabilityPenaltyTicks: 9,
    switchingPenaltyTicks: 10,
  });
  assert.equal(cost?.generalizedCost, 55);
  assert.equal(buildMobilityCost({
    accessEgressTicks: -1, expectedWaitTicks: 0, movementTicks: 0,
    transferPenaltyTicks: 0, fareImpedanceTicks: 0, parkingImpedanceTicks: 0,
    congestionDelayTicks: 0, crowdingPenaltyTicks: 0, reliabilityPenaltyTicks: 0,
    switchingPenaltyTicks: 0,
  }), null);
});
```

- [ ] **Step 2: Run RED**

```bash
node --experimental-strip-types --test tests/mobility14r-mode-choice.test.ts
```

Expected: module-not-found failure.

- [ ] **Step 3: Implement the exact public types**

```ts
export type MobilityModeId = 'walk'|'bicycle'|'car'|'ride_hail'|'bus'|'trolleybus'|'brt'|'tram'|'metro'|'commuter_rail'|'regional_rail'|'ferry';
export type MobilityModeFamily = 'active'|'private_vehicle'|'for_hire'|'surface_transit'|'rail_transit'|'water_transit';
export type MobilityModeDefinition = Readonly<{ id: MobilityModeId; label: string; family: MobilityModeFamily; infrastructureFamily: 'pedestrian'|'bicycle'|'road'|'electric_road'|'rail'|'water'; scheduled: boolean; capacityConstrained: boolean; ordinaryRoadCapacity: boolean; dedicatedGuideway: boolean; providerPriority: number }>;
export type MobilityTravelerCapabilities = Readonly<{ privateVehicleAccess: boolean; licensedDriver: boolean; bicycleAccess: boolean; rideHailAvailable: boolean; mobilityLimited: boolean; farePaymentAccess: boolean; maxWalkTicks?: number }>;
export type MobilityJourneyRequest = Readonly<{ id: string; sourceTripId: string; provenance: 'legacy_cohort'|'person'; personId?: string; originRoadNodeId: string|null; destinationRoadNodeId: string|null; departureTick: number; travelerWeight: number; purpose: 'commute'|'shopping'; capabilities: MobilityTravelerCapabilities; costEpoch: number }>;
export type MobilityCostBreakdown = Readonly<{ accessEgressTicks:number; expectedWaitTicks:number; movementTicks:number; transferPenaltyTicks:number; fareImpedanceTicks:number; parkingImpedanceTicks:number; congestionDelayTicks:number; crowdingPenaltyTicks:number; reliabilityPenaltyTicks:number; switchingPenaltyTicks:number; generalizedCost:number }>;
export type MobilityAlternative = Readonly<{ id:string; mode:MobilityModeId; providerId:string; providerPriority:number; cost:MobilityCostBreakdown; expectedArrivalTick:number; execution:unknown }>;
export type MobilityChoiceOutcome = Readonly<{ outcome:MobilityModeId|'unmet'; alternative:MobilityAlternative|null }>;
```

- [ ] **Step 4: Implement immutable mode definitions**

Use one frozen record with all twelve IDs. Priorities: `car=10`; `bus|brt|tram|metro=20`; foundation-only modes `30`. Relevant definitions must encode bus as road/surface transit, trolleybus as electric-road/surface transit, metro/commuter/regional rail as rail/dedicated guideway, ferry as water/dedicated guideway, and walk/bicycle as active modes.

- [ ] **Step 5: Implement cost validation**

```ts
export function buildMobilityCost(input: Omit<MobilityCostBreakdown,'generalizedCost'>): MobilityCostBreakdown|null {
  const values = Object.values(input);
  if (values.some((value) => !Number.isFinite(value) || value < 0)) return null;
  const generalizedCost = values.reduce((sum, value) => sum + value, 0);
  return Object.freeze({ ...input, generalizedCost });
}
```

- [ ] **Step 6: Create shared test fixtures with exact signatures**

```ts
export const mobilityCapabilities = (overrides: Partial<MobilityTravelerCapabilities> = {}): MobilityTravelerCapabilities => Object.freeze({
  privateVehicleAccess: true, licensedDriver: true, bicycleAccess: false,
  rideHailAvailable: false, mobilityLimited: false, farePaymentAccess: true,
  ...overrides,
});

export const mobilityRequest = (overrides: Partial<MobilityJourneyRequest> = {}): MobilityJourneyRequest => Object.freeze({
  id: 'journey:1', sourceTripId: 'trip:1', provenance: 'legacy_cohort',
  originRoadNodeId: 'n:1,1', destinationRoadNodeId: 'n:2,1', departureTick: 100,
  travelerWeight: 1, purpose: 'commute', capabilities: mobilityCapabilities(), costEpoch: 10,
  ...overrides,
});

export const mobilityAlternative = (providerId:string, providerPriority:number, mode:MobilityModeId, id:string, generalizedCost:number): MobilityAlternative => Object.freeze({
  id, mode, providerId, providerPriority,
  cost: Object.freeze({ accessEgressTicks:0, expectedWaitTicks:0, movementTicks:generalizedCost, transferPenaltyTicks:0, fareImpedanceTicks:0, parkingImpedanceTicks:0, congestionDelayTicks:0, crowdingPenaltyTicks:0, reliabilityPenaltyTicks:0, switchingPenaltyTicks:0, generalizedCost }),
  expectedArrivalTick: 100 + generalizedCost,
  execution: Object.freeze({ kind: 'synthetic' }),
});
```

- [ ] **Step 7: Run GREEN and commit**

```bash
node --experimental-strip-types --test tests/mobility14r-mode-choice.test.ts
git add src/simulation/mobility/MobilityTypes.ts src/simulation/mobility/MobilityModeRegistry.ts src/simulation/mobility/MobilityCost.ts tests/support/mobility14rFixtures.ts tests/mobility14r-mode-choice.test.ts
git commit -m "feat: add multimodal mobility model"
```

---

### Task 2: Generalized Choice Engine and Provider Orchestrator

**Files:**
- Create: `src/simulation/mobility/MobilityChoiceSystem.ts`
- Create: `src/simulation/mobility/MobilityProvider.ts`
- Create: `src/simulation/mobility/MobilityOrchestrator.ts`
- Modify: `src/simulation/mobility/ModeChoiceSystem.ts`
- Modify: `tests/mobility14r-mode-choice.test.ts`

**Interfaces:**
- `MobilityChoiceSystem.choose(alternatives)` returns `MobilityChoiceOutcome`.
- `MobilityAlternativeProvider` exposes `id`, `priority`, `modes`, `buildAlternatives()`, `execute()`.
- `MobilityProviderRegistry` rejects duplicate provider IDs and duplicate executable mode ownership.
- `MobilityOrchestrator.resolveAndExecute()` performs one bounded stale-result retry.

- [ ] **Step 1: Add RED deterministic-choice/provider tests**

```ts
const choice = new MobilityChoiceSystem().choose([
  mobilityAlternative('z-provider',20,'metro','z',80),
  mobilityAlternative('a-provider',10,'car','a',80),
  mobilityAlternative('b-provider',10,'bus','b',80),
]);
assert.equal(choice.outcome, 'bus');
assert.equal(choice.alternative?.id, 'b');
```

Create three synthetic providers registered in reverse order and assert registry output order is `a-provider`, `b-provider`, `z-provider`; assert only the winner executes. Add a provider whose first execution returns `false` and second succeeds; assert exactly two build cycles and two execution attempts. A provider failing twice must yield `unmet`.

- [ ] **Step 2: Run RED**

```bash
node --experimental-strip-types --test tests/mobility14r-mode-choice.test.ts
```

- [ ] **Step 3: Implement exact choice comparator**

```ts
const compareAlternatives = (a:MobilityAlternative,b:MobilityAlternative):number =>
  a.cost.generalizedCost-b.cost.generalizedCost || a.providerPriority-b.providerPriority || a.mode.localeCompare(b.mode) || a.id.localeCompare(b.id);
```

`choose([])` returns `{ outcome:'unmet', alternative:null }`; sort a copy, never the caller array.

- [ ] **Step 4: Implement runtime/provider contracts**

```ts
export type MobilityRuntimeContext = Readonly<{
  tick:number; costEpoch:number; roadGraph:TransportationGraph; transit:TransitNetworkSystem;
  pathfinding:PathfindingSystem; roadTravelTime:(edge:TransportationEdge)=>number;
  multimodalGraph:MultimodalRoutingGraph; journeyPlanner:JourneyPlanner; passengers:PassengerQueueSystem;
  crowdingPenaltyTicks:number;
  submitLegacyCarTrip:(sourceTripId:string, travelerWeight:number, route:RouteResult)=>void;
}>;

export interface MobilityAlternativeProvider {
  readonly id:string; readonly priority:number; readonly modes:readonly MobilityModeId[];
  buildAlternatives(request:MobilityJourneyRequest, context:MobilityRuntimeContext):readonly MobilityAlternative[];
  execute(alternative:MobilityAlternative, request:MobilityJourneyRequest, context:MobilityRuntimeContext):boolean;
}
```

- [ ] **Step 5: Implement registry/orchestrator validation**

Registry ordering is `priority || id.localeCompare()`. Reject duplicate IDs and duplicate mode ownership. Orchestrator must reject alternatives whose `providerId`, `providerPriority`, or mode do not match the emitting provider; then choose and execute. If execution is stale (`false`), rebuild all provider alternatives once and retry once.

- [ ] **Step 6: Keep `ModeChoiceSystem` as a compatibility adapter**

Retain its current public signature/result. Preserve legacy equal-cost car preference and crowding behavior, but internally use `MobilityChoiceSystem` for non-tied alternatives. `MobilityScheduler` will stop using this class in Task 5.

- [ ] **Step 7: Verify and commit**

```bash
node --experimental-strip-types --test tests/mobility14r-mode-choice.test.ts tests/transit-mode-choice.test.ts
git add src/simulation/mobility/MobilityChoiceSystem.ts src/simulation/mobility/MobilityProvider.ts src/simulation/mobility/MobilityOrchestrator.ts src/simulation/mobility/ModeChoiceSystem.ts tests/mobility14r-mode-choice.test.ts
git commit -m "feat: add mobility provider orchestration"
```

---

### Task 3: Legacy Car and Transit Providers

**Files:**
- Create: `src/simulation/mobility/providers/LegacyCarMobilityProvider.ts`
- Create: `src/simulation/mobility/providers/TransitJourneyExecutor.ts`
- Create: `src/simulation/mobility/providers/LegacyTransitMobilityProvider.ts`
- Create: `tests/mobility14r-providers.test.ts`

**Interfaces:**
- `legacy-car` owns `car`.
- `legacy-transit` owns exactly `bus`, `brt`, `tram`, `metro`.
- Transit execution continues through `PassengerQueueSystem`.

- [ ] **Step 1: Write RED provider tests using real small-network fixtures**

Create a `TerrainGrid.generate(12,5,44)` fixture, a local road path from x=1..10 at y=2, a `TransportationGraph`, and a `TransitNetworkSystem` with two surface stops and one enabled bus line. Use `PathfindingSystem`, `MultimodalRoutingGraph`, `JourneyPlanner`, and `PassengerQueueSystem` to build a real `MobilityRuntimeContext`.

Assert car provider returns one alternative with capabilities on and `[]` when `privateVehicleAccess:false` or `licensedDriver:false`. Assert successful car execution calls the submission callback once and stale road revision execution returns `false`.

Assert transit provider owns exactly `['bus','brt','tram','metro']`, returns a bus alternative for the bus fixture, and enqueues through the existing passenger queue on execution.

- [ ] **Step 2: Run RED**

```bash
node --experimental-strip-types --test tests/mobility14r-providers.test.ts
```

- [ ] **Step 3: Implement legacy car provider**

Use current route lookup unchanged:

```ts
const route = context.pathfinding.findRoute(context.roadGraph,start,end,{ edgeCost:context.roadTravelTime, costKey:`mobility-car:${context.costEpoch}` });
```

Return `[]` without both car-access capabilities or without a route. Cost uses `movementTicks=route.totalCost` and all other components zero. Execution descriptor stores `kind:'legacy-car'`, route, road revision, cost epoch. Execute only if revision/epoch still match.

- [ ] **Step 4: Extract transit queue execution from `MobilityScheduler`**

Move existing enqueue/direction/stop-ID behavior into `TransitJourneyExecutor.enqueue(request,plan,transit,passengers)`. Keep cohort fields and FIFO/capacity authority exactly as today.

Add `dominantTransitMode(plan)` that sums `ride` ticks by `bus|brt|tram|metro`; choose highest ride-tick total, tie by mode ID. Return `null` with no transit ride leg.

- [ ] **Step 5: Implement legacy transit provider**

Use existing planner parameters exactly:

```ts
context.journeyPlanner.plan(context.multimodalGraph,start,end,{ mode:'transit', transferPenaltyTicks:20, fareWeightTicksPerCurrency:4, costKey:`mobility-transit:${context.costEpoch}` });
```

Cost components: `walkingTicks`, `expectedWaitTicks`, `inVehicleTicks`, `transferPenaltyTicks`, `fare*4`, current crowding penalty; other components zero. Execution descriptor stores transit revision, multimodal revision, cost epoch, and plan. Reject stale descriptors and otherwise delegate to `TransitJourneyExecutor`.

- [ ] **Step 6: Verify providers plus existing transit behavior**

```bash
node --experimental-strip-types --test tests/mobility14r-providers.test.ts tests/transit-passengers.test.ts tests/transit-vehicles.test.ts tests/transit-routing.test.ts
```

- [ ] **Step 7: Commit**

```bash
git add src/simulation/mobility/providers tests/mobility14r-providers.test.ts
git commit -m "feat: adapt legacy mobility providers"
```

---

### Task 4: Scheduler Cutover and Canonical Mode Analytics

**Files:**
- Modify: `src/simulation/mobility/MobilityScheduler.ts`
- Modify: `tests/transit-integration.test.ts`
- Modify: `tests/transit-state.test.ts`

**Interfaces:**
- Scheduler registers only `legacy-car` and `legacy-transit`.
- Existing persisted `MobilityDecision` and `MobilitySchedulerStateSnapshot` shapes remain unchanged.
- `MobilitySnapshot` gains derived `modeShares: Readonly<Record<MobilityModeId,number>>`.

- [ ] **Step 1: Add RED integration assertions**

For the existing competitive BRT scenario:

```ts
assert.equal(snapshot.transitModeShare,1);
assert.equal(snapshot.modeShares.brt,1);
assert.equal(snapshot.modeShares.car,0);
```

For the poor-transit scenario:

```ts
assert.equal(snapshot.carModeShare,1);
assert.equal(snapshot.modeShares.car,1);
```

In state tests assert persisted decisions still expose only `mode`, `travelerWeight`, `purpose`, `chosenCost`, `expectedWaitTicks`.

- [ ] **Step 2: Run RED**

```bash
node --experimental-strip-types --test tests/transit-integration.test.ts tests/transit-state.test.ts
```

- [ ] **Step 3: Convert each legacy trip into a compatibility request**

```ts
const request:MobilityJourneyRequest = Object.freeze({
  id:trip.id, sourceTripId:trip.sourceTripId, provenance:'legacy_cohort',
  originRoadNodeId:trip.originRoadNodeId, destinationRoadNodeId:trip.destinationRoadNodeId,
  departureTick:trip.departureTick, travelerWeight:trip.travelerWeight, purpose:trip.purpose,
  capabilities:Object.freeze({ privateVehicleAccess:true, licensedDriver:true, bicycleAccess:false, rideHailAvailable:false, mobilityLimited:false, farePaymentAccess:true }),
  costEpoch,
});
```

No `personId` on this path.

- [ ] **Step 4: Replace live branch logic with one orchestrator call**

Keep current tick order: rebuild multimodal graph, advance transit operations, generate trips, orchestrate choices. Build one runtime context per tick. `submitLegacyCarTrip()` resolves `sourceTripId` to the generated `MobilityPersonTrip` and calls the existing `MobilityTickContext.submitCarTrip()`.

- [ ] **Step 5: Preserve save shape while adding derived mode analytics**

Do not add canonical mode/provider/cost-breakdown fields to persisted decisions. Continue storing compatibility mode as `car`, `transit`, or `unmet`. Track canonical winning weights in a separate in-memory Map excluded from `snapshotState()`. `restoreState()` clears this derived map.

`MobilitySnapshot.modeShares` must always return all twelve canonical keys. Existing `transitModeShare` remains the combined legacy transit-family share.

- [ ] **Step 6: Run scheduler regressions**

```bash
node --experimental-strip-types --test tests/transit-integration.test.ts tests/transit-state.test.ts tests/transit-mode-choice.test.ts tests/phase5-headless.test.ts
```

- [ ] **Step 7: Commit**

```bash
git add src/simulation/mobility/MobilityScheduler.ts tests/transit-integration.test.ts tests/transit-state.test.ts
git commit -m "feat: cut mobility scheduler to providers"
```

---

### Task 5: Save V8 and Unsupported-Mode Safety Gates

**Files:**
- Modify: `tests/save-v8.test.ts`
- Modify: `tests/mobility14r-providers.test.ts`

- [ ] **Step 1: Add explicit Save V8 schema guard**

```ts
const save = serializeCore(core);
assert.deepEqual(Object.keys(save.transit.mobility).sort(), [
  'crowdingPenaltyTicks','decisions','fiscalFareCursor','fiscalOperatingCursor','operations','passengers','vehicles',
].sort());
assert.equal('modeShares' in save.transit.mobility,false);
assert.equal('providers' in save.transit.mobility,false);
assert.equal('alternatives' in save.transit.mobility,false);
```

- [ ] **Step 2: Add unsupported-mode safety test**

Assert the canonical registry contains ferry/trolleybus/regional rail while the live scheduler provider registry owns only car/bus/BRT/tram/metro. With car capability disabled and no transit route, orchestration must return `unmet`; no future mode alternative may appear.

- [ ] **Step 3: Run save/safety regressions**

```bash
node --experimental-strip-types --test tests/save-v5.test.ts tests/save-v7.test.ts tests/save-v8.test.ts tests/mobility14r-providers.test.ts
```

The existing exact V8 round-trip assertion must remain unchanged and green.

- [ ] **Step 4: Commit**

```bash
git add tests/save-v8.test.ts tests/mobility14r-providers.test.ts
git commit -m "test: lock 14R-A compatibility boundaries"
```

---

### Task 6: Performance and Full Verification

**Files:**
- Create: `tests/mobility14r-performance.test.ts`

- [ ] **Step 1: Add a 10,000-request diagnostic test**

Use two synthetic providers with counters and `MobilityOrchestrator`. Process 10,000 `mobilityRequest({ id:`journey:${i}`, sourceTripId:`trip:${i}` })` requests. Assert each provider is called exactly 10,000 times, proving work scales with registered providers rather than city population. Do not register future-mode providers; assert the registry length is `2`.

Also run a stable real road/transit fixture twice and assert `PathfindingSystem.diagnostics.cacheHits` and `JourneyPlanner.diagnostics.cacheHits` increase on the second pass.

Print:

```ts
console.log('PHASE14R_A_MOBILITY_10K_BENCHMARK', JSON.stringify({ requests:10000, elapsedMs, carCacheHits, transitCacheHits }));
```

- [ ] **Step 2: Run focused performance test**

```bash
node --experimental-strip-types --test tests/mobility14r-performance.test.ts
```

- [ ] **Step 3: Run complete verification**

```bash
npm test
npm run typecheck
npm run lint
npm run assets:check
npm run build
npm run test:smoke
npm run test:smoke:phase7
npm run test:smoke:isometric
```

All commands must exit `0`.

- [ ] **Step 4: Audit final diff**

Confirm no new save version, no `PersonId` authority, no household/schedule implementation, no ride-hail fleet, no bicycle simulation, no trolleybus/rail/ferry execution, and no replacement of World Foundation or Transportation Engine 2.0 authority.

- [ ] **Step 5: Commit benchmark and record exact-head CI evidence on PR #90**

```bash
git add tests/mobility14r-performance.test.ts
git commit -m "test: verify 14R-A mobility performance"
```

Record exact head SHA, test count, benchmark line, static/build/smoke results, and Save V8 compatibility in PR #90. Keep the PR draft and unmerged until explicit merge authorization.
