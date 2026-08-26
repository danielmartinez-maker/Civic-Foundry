# Phase 14R-A Multimodal Mobility Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hard-coded `car | transit | unmet` mobility-choice seam with a deterministic provider-based multimodal foundation while preserving current V7/V8 car and bus/BRT/tram/metro behavior and Save V8 schema.

**Architecture:** Introduce canonical mobility types, a deterministic mode registry, structured generalized costs, a provider registry/orchestrator, and compatibility providers for private car and existing transit. `MobilityScheduler` remains the city-loop composition point; existing transit network/vehicle/queue/operations systems remain authoritative, while unsupported future modes are registered as definitions only and cannot execute until a real provider exists.

**Tech Stack:** TypeScript, Node.js built-in `node:test`, existing Civic Foundry simulation systems, deterministic in-memory registries, GitHub Actions CI.

**Spec:** `docs/superpowers/specs/2026-08-25-14r-a-multimodal-mobility-foundation-design.md`

## Global Constraints

- Canonical modes are exactly: `walk`, `bicycle`, `car`, `ride_hail`, `bus`, `trolleybus`, `brt`, `tram`, `metro`, `commuter_rail`, `regional_rail`, `ferry`.
- `unmet` is an outcome, not a mobility mode.
- Existing `TransitNetworkSystem`, `TransitVehicleSystem`, `PassengerQueueSystem`, and `TransitOperationsSystem` remain authoritative for V7 bus/BRT/tram/metro operations during 14R-A.
- Existing V7/V8 save loading and deterministic continuation must remain valid.
- Save V8 schema must not gain 14R-A mode definitions, provider registration, route caches, alternatives, mode-share analytics, or generalized-cost explanations.
- Existing weighted trip cohorts remain compatibility demand; 14R-A must not claim they are actual `PersonId` residents.
- Unsupported future modes must return no executable alternative; no teleportation or placeholder trip execution.
- Alternative generation, provider iteration, generalized-cost calculation, tie-breaking, and execution selection must be deterministic.
- Tie-breaking order is: lower generalized cost, lower provider priority, lexicographically smaller canonical mode ID, lexicographically smaller alternative ID.
- No per-tick full-population scan may be introduced.
- Existing car submission, surface-transit congestion coupling, transit capacity, fare accounting, operating cost, UI compatibility, World Foundation authority, and Transportation Engine 2.0 road semantics must remain intact.

---

## File Structure

New mobility-foundation files:

- `src/simulation/mobility/MobilityTypes.ts` — canonical mode IDs, journey request, capability snapshot, cost breakdown, alternative/result types.
- `src/simulation/mobility/MobilityModeRegistry.ts` — immutable canonical mode definitions and deterministic listing/lookup.
- `src/simulation/mobility/MobilityCost.ts` — finite/non-negative cost validation and generalized-cost construction.
- `src/simulation/mobility/MobilityChoiceSystem.ts` — arbitrary-alternative deterministic choice engine.
- `src/simulation/mobility/MobilityProvider.ts` — provider/runtime interfaces and deterministic provider registry.
- `src/simulation/mobility/MobilityOrchestrator.ts` — builds alternatives from providers, chooses, executes, and performs one bounded stale-result replan.
- `src/simulation/mobility/providers/LegacyCarMobilityProvider.ts` — wraps current road pathfinding and car submission.
- `src/simulation/mobility/providers/TransitJourneyExecutor.ts` — owns transit-plan queue execution currently embedded in `MobilityScheduler`.
- `src/simulation/mobility/providers/LegacyTransitMobilityProvider.ts` — wraps current `JourneyPlanner` and transit execution while reporting a canonical transit mode.

Existing files to modify:

- `src/simulation/mobility/MobilityScheduler.ts` — replace direct car/transit branching with orchestrator calls; keep legacy persisted decision state unchanged; add derived canonical mode-share analytics.
- `src/simulation/mobility/ModeChoiceSystem.ts` — retain as a compatibility adapter for existing tests/consumers, but stop using it as the live scheduler authority.
- `tests/transit-mode-choice.test.ts` — retain legacy adapter parity assertions.
- `tests/transit-integration.test.ts` — assert scheduler parity and canonical mode analytics.
- `tests/transit-state.test.ts` — assert existing persisted mobility state shape remains compatible.
- `tests/save-v8.test.ts` — assert 14R-A adds no Save V8 schema fields.

New test files:

- `tests/mobility14r-mode-registry.test.ts`
- `tests/mobility14r-choice.test.ts`
- `tests/mobility14r-orchestrator.test.ts`
- `tests/mobility14r-car-provider.test.ts`
- `tests/mobility14r-transit-provider.test.ts`
- `tests/mobility14r-performance.test.ts`

---

### Task 1: Canonical Mobility Types and Mode Registry

**Files:**
- Create: `src/simulation/mobility/MobilityTypes.ts`
- Create: `src/simulation/mobility/MobilityModeRegistry.ts`
- Create: `tests/mobility14r-mode-registry.test.ts`

**Interfaces:**
- Consumes: existing trip-purpose strings `'commute' | 'shopping'` and current road-node access IDs.
- Produces: `MobilityModeId`, `MobilityModeDefinition`, `MobilityJourneyRequest`, `MobilityTravelerCapabilities`, `MobilityCostBreakdown`, `MobilityAlternative`, `MobilityChoiceOutcome`, `MOBILITY_MODE_DEFINITIONS`, `getMobilityMode()`, and `listMobilityModes()`.

- [ ] **Step 1: Write the failing canonical-registry test**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { getMobilityMode, listMobilityModes } from '../src/simulation/mobility/MobilityModeRegistry.ts';

const EXPECTED = [
  'walk', 'bicycle', 'car', 'ride_hail', 'bus', 'trolleybus',
  'brt', 'tram', 'metro', 'commuter_rail', 'regional_rail', 'ferry',
] as const;

test('14R-A registers the exact canonical mobility modes deterministically', () => {
  assert.deepEqual(listMobilityModes().map((mode) => mode.id), EXPECTED);
  assert.equal(getMobilityMode('car')?.family, 'private_vehicle');
  assert.equal(getMobilityMode('metro')?.dedicatedGuideway, true);
  assert.equal(getMobilityMode('bus')?.ordinaryRoadCapacity, true);
  assert.equal(getMobilityMode('ferry')?.infrastructureFamily, 'water');
});

test('unsupported ids never synthesize a mobility definition', () => {
  assert.equal(getMobilityMode('teleport' as never), undefined);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
node --experimental-strip-types --test tests/mobility14r-mode-registry.test.ts
```

Expected: FAIL because `MobilityModeRegistry.ts` does not exist.

- [ ] **Step 3: Implement the canonical mobility types**

Create `src/simulation/mobility/MobilityTypes.ts` with these exact public shapes:

```ts
export type MobilityModeId =
  | 'walk' | 'bicycle' | 'car' | 'ride_hail'
  | 'bus' | 'trolleybus' | 'brt' | 'tram' | 'metro'
  | 'commuter_rail' | 'regional_rail' | 'ferry';

export type MobilityModeFamily =
  | 'active' | 'private_vehicle' | 'for_hire'
  | 'surface_transit' | 'rail_transit' | 'water_transit';

export type MobilityInfrastructureFamily =
  | 'pedestrian' | 'bicycle' | 'road' | 'electric_road'
  | 'rail' | 'water';

export type MobilityModeDefinition = Readonly<{
  id: MobilityModeId;
  label: string;
  family: MobilityModeFamily;
  infrastructureFamily: MobilityInfrastructureFamily;
  scheduled: boolean;
  capacityConstrained: boolean;
  ordinaryRoadCapacity: boolean;
  dedicatedGuideway: boolean;
  providerPriority: number;
}>;

export type MobilityTravelerCapabilities = Readonly<{
  privateVehicleAccess: boolean;
  licensedDriver: boolean;
  bicycleAccess: boolean;
  rideHailAvailable: boolean;
  mobilityLimited: boolean;
  farePaymentAccess: boolean;
  maxWalkTicks?: number;
}>;

export type MobilityJourneyRequest = Readonly<{
  id: string;
  sourceTripId: string;
  provenance: 'legacy_cohort' | 'person';
  personId?: string;
  originRoadNodeId: string | null;
  destinationRoadNodeId: string | null;
  departureTick: number;
  travelerWeight: number;
  purpose: 'commute' | 'shopping';
  capabilities: MobilityTravelerCapabilities;
  costEpoch: number;
}>;

export type MobilityCostBreakdown = Readonly<{
  accessEgressTicks: number;
  expectedWaitTicks: number;
  movementTicks: number;
  transferPenaltyTicks: number;
  fareImpedanceTicks: number;
  parkingImpedanceTicks: number;
  congestionDelayTicks: number;
  crowdingPenaltyTicks: number;
  reliabilityPenaltyTicks: number;
  switchingPenaltyTicks: number;
  generalizedCost: number;
}>;

export type MobilityAlternative = Readonly<{
  id: string;
  mode: MobilityModeId;
  providerId: string;
  providerPriority: number;
  cost: MobilityCostBreakdown;
  expectedArrivalTick: number;
  execution: unknown;
}>;

export type MobilityChoiceOutcome = Readonly<{
  outcome: MobilityModeId | 'unmet';
  alternative: MobilityAlternative | null;
}>;
```

- [ ] **Step 4: Implement immutable deterministic mode definitions**

Create `src/simulation/mobility/MobilityModeRegistry.ts` with one frozen definition per canonical ID. Use provider priorities `10` car, `20` existing transit-family modes, and `30` foundation-only modes so current car/transit tie behavior can be preserved where costs tie. `listMobilityModes()` must return the fixed canonical declaration order above, not Map insertion order from callers.

Representative entries must be exactly:

```ts
car: Object.freeze({
  id: 'car', label: 'Private Car', family: 'private_vehicle',
  infrastructureFamily: 'road', scheduled: false,
  capacityConstrained: false, ordinaryRoadCapacity: true,
  dedicatedGuideway: false, providerPriority: 10,
}),
bus: Object.freeze({
  id: 'bus', label: 'Bus', family: 'surface_transit',
  infrastructureFamily: 'road', scheduled: true,
  capacityConstrained: true, ordinaryRoadCapacity: true,
  dedicatedGuideway: false, providerPriority: 20,
}),
metro: Object.freeze({
  id: 'metro', label: 'Metro', family: 'rail_transit',
  infrastructureFamily: 'rail', scheduled: true,
  capacityConstrained: true, ordinaryRoadCapacity: false,
  dedicatedGuideway: true, providerPriority: 20,
}),
ferry: Object.freeze({
  id: 'ferry', label: 'Ferry', family: 'water_transit',
  infrastructureFamily: 'water', scheduled: true,
  capacityConstrained: true, ordinaryRoadCapacity: false,
  dedicatedGuideway: true, providerPriority: 30,
}),
```

- [ ] **Step 5: Run the focused test and verify GREEN**

```bash
node --experimental-strip-types --test tests/mobility14r-mode-registry.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 1**

```bash
git add src/simulation/mobility/MobilityTypes.ts src/simulation/mobility/MobilityModeRegistry.ts tests/mobility14r-mode-registry.test.ts
git commit -m "feat: add canonical multimodal registry"
```

---

### Task 2: Structured Generalized Cost and Arbitrary Alternative Choice

**Files:**
- Create: `src/simulation/mobility/MobilityCost.ts`
- Create: `src/simulation/mobility/MobilityChoiceSystem.ts`
- Create: `tests/mobility14r-choice.test.ts`
- Modify: `src/simulation/mobility/ModeChoiceSystem.ts`
- Test: `tests/transit-mode-choice.test.ts`

**Interfaces:**
- Consumes: `MobilityAlternative`, `MobilityCostBreakdown` from Task 1 and existing `JourneyPlan` for the compatibility adapter.
- Produces: `buildMobilityCost()`, `MobilityChoiceSystem.choose(alternatives)`, while retaining `ModeChoiceSystem.choose(carPlan, transitPlan, context)` for legacy callers/tests.

- [ ] **Step 1: Write RED tests for cost validation and deterministic arbitrary choice**

Create `tests/mobility14r-choice.test.ts` using a helper that builds alternatives and assert:

```ts
const choice = new MobilityChoiceSystem().choose([
  alternative('provider-z', 20, 'metro', 'z', 80),
  alternative('provider-a', 10, 'car', 'a', 80),
  alternative('provider-b', 10, 'bus', 'b', 80),
]);
assert.equal(choice.outcome, 'bus');
assert.equal(choice.alternative?.id, 'b');
```

This verifies the documented tie order: cost, provider priority, mode ID (`bus` sorts before `car`), alternative ID.

Also assert:

```ts
assert.equal(buildMobilityCost({
  accessEgressTicks: 1, expectedWaitTicks: 2, movementTicks: 3,
  transferPenaltyTicks: 4, fareImpedanceTicks: 5,
  parkingImpedanceTicks: 6, congestionDelayTicks: 7,
  crowdingPenaltyTicks: 8, reliabilityPenaltyTicks: 9,
  switchingPenaltyTicks: 10,
})?.generalizedCost, 55);

assert.equal(buildMobilityCost({
  accessEgressTicks: -1, expectedWaitTicks: 0, movementTicks: 0,
  transferPenaltyTicks: 0, fareImpedanceTicks: 0,
  parkingImpedanceTicks: 0, congestionDelayTicks: 0,
  crowdingPenaltyTicks: 0, reliabilityPenaltyTicks: 0,
  switchingPenaltyTicks: 0,
}), null);
```

- [ ] **Step 2: Run focused tests and verify RED**

```bash
node --experimental-strip-types --test tests/mobility14r-choice.test.ts
```

Expected: FAIL because the new cost/choice modules do not exist.

- [ ] **Step 3: Implement `buildMobilityCost()`**

`src/simulation/mobility/MobilityCost.ts` must validate all ten input components with `Number.isFinite(value) && value >= 0`; any invalid component returns `null`. Otherwise sum all components into `generalizedCost` and freeze the returned object.

- [ ] **Step 4: Implement deterministic `MobilityChoiceSystem`**

The comparator must be exactly:

```ts
const compareAlternatives = (a: MobilityAlternative, b: MobilityAlternative): number =>
  a.cost.generalizedCost - b.cost.generalizedCost
  || a.providerPriority - b.providerPriority
  || a.mode.localeCompare(b.mode)
  || a.id.localeCompare(b.id);
```

`choose([])` returns `{ outcome: 'unmet', alternative: null }`. Do not mutate the caller's array; choose from `[...alternatives].sort(compareAlternatives)`.

- [ ] **Step 5: Keep `ModeChoiceSystem` as a compatibility adapter**

Do not delete the existing public class. Internally convert the current car and transit `JourneyPlan` arguments into two `MobilityAlternative` values and delegate the winner selection to `MobilityChoiceSystem`. Preserve its existing return type and crowding semantics so all historical tests remain unchanged.

For the adapter, assign car provider priority `10`, transit provider priority `20`, but preserve the historical equal-cost car preference by applying the existing epsilon decision before delegating when `Math.abs(carCost - transitCost) <= 1e-9`.

- [ ] **Step 6: Run new and legacy choice tests**

```bash
node --experimental-strip-types --test tests/mobility14r-choice.test.ts tests/transit-mode-choice.test.ts
```

Expected: all tests PASS, including the legacy equal-cost-car assertion.

- [ ] **Step 7: Commit Task 2**

```bash
git add src/simulation/mobility/MobilityCost.ts src/simulation/mobility/MobilityChoiceSystem.ts src/simulation/mobility/ModeChoiceSystem.ts tests/mobility14r-choice.test.ts tests/transit-mode-choice.test.ts
git commit -m "feat: generalize mobility choice engine"
```

---

### Task 3: Provider Contract, Registry, and Orchestrator

**Files:**
- Create: `src/simulation/mobility/MobilityProvider.ts`
- Create: `src/simulation/mobility/MobilityOrchestrator.ts`
- Create: `tests/mobility14r-orchestrator.test.ts`

**Interfaces:**
- Consumes: Task 1 request/alternative types and Task 2 `MobilityChoiceSystem`.
- Produces: `MobilityRuntimeContext`, `MobilityAlternativeProvider`, `MobilityProviderRegistry`, and `MobilityOrchestrator.resolveAndExecute()`.

- [ ] **Step 1: Write RED tests with three synthetic providers**

The test must register providers in reverse order and prove registry order is independent of registration order:

```ts
registry.register(provider('z-provider', 20, 'metro', 70));
registry.register(provider('a-provider', 10, 'car', 90));
registry.register(provider('b-provider', 10, 'bus', 70));
assert.deepEqual(registry.list().map((p) => p.id), ['a-provider', 'b-provider', 'z-provider']);
```

Also assert the orchestrator executes only the chosen provider and returns `unmet` when every provider returns `[]`.

Add a stale-execution test where the first `execute()` returns `false`; `resolveAndExecute()` must rebuild alternatives once and execute the replacement once. A second execution failure returns `unmet` rather than looping.

- [ ] **Step 2: Run test and verify RED**

```bash
node --experimental-strip-types --test tests/mobility14r-orchestrator.test.ts
```

Expected: FAIL because provider/orchestrator modules do not exist.

- [ ] **Step 3: Implement the provider runtime contract**

Define `MobilityRuntimeContext` with the concrete compatibility dependencies 14R-A needs:

```ts
export type MobilityRuntimeContext = Readonly<{
  tick: number;
  costEpoch: number;
  roadGraph: TransportationGraph;
  transit: TransitNetworkSystem;
  pathfinding: PathfindingSystem;
  roadTravelTime: (edge: TransportationEdge) => number;
  multimodalGraph: MultimodalRoutingGraph;
  journeyPlanner: JourneyPlanner;
  passengers: PassengerQueueSystem;
  crowdingPenaltyTicks: number;
  submitLegacyCarTrip: (sourceTripId: string, travelerWeight: number, route: RouteResult) => void;
}>;
```

Define the provider interface:

```ts
export interface MobilityAlternativeProvider {
  readonly id: string;
  readonly priority: number;
  readonly modes: readonly MobilityModeId[];
  buildAlternatives(request: MobilityJourneyRequest, context: MobilityRuntimeContext): readonly MobilityAlternative[];
  execute(alternative: MobilityAlternative, request: MobilityJourneyRequest, context: MobilityRuntimeContext): boolean;
}
```

- [ ] **Step 4: Implement deterministic provider registration**

`MobilityProviderRegistry.register()` must reject duplicate IDs and duplicate provider ownership of the same mode when both providers claim to be executable authorities in this tranche. `list()` returns providers sorted by `priority || id.localeCompare()`.

Do not auto-register a fake provider for foundation-only modes.

- [ ] **Step 5: Implement bounded orchestration**

`MobilityOrchestrator.resolveAndExecute(request, context)` must:

1. call each registered provider once in deterministic registry order;
2. flatten provider alternatives;
3. reject alternatives whose `providerId`, `providerPriority`, or mode ownership do not match the emitting provider;
4. choose via `MobilityChoiceSystem`;
5. execute only the winner;
6. if execution returns `false`, rebuild/choose once more;
7. if the second execution fails, return `unmet`.

- [ ] **Step 6: Run focused tests and verify GREEN**

```bash
node --experimental-strip-types --test tests/mobility14r-orchestrator.test.ts tests/mobility14r-choice.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 3**

```bash
git add src/simulation/mobility/MobilityProvider.ts src/simulation/mobility/MobilityOrchestrator.ts tests/mobility14r-orchestrator.test.ts
git commit -m "feat: add mobility provider orchestrator"
```

---

### Task 4: Legacy Private-Car Provider

**Files:**
- Create: `src/simulation/mobility/providers/LegacyCarMobilityProvider.ts`
- Create: `tests/mobility14r-car-provider.test.ts`

**Interfaces:**
- Consumes: provider/runtime contract from Task 3 and current `PathfindingSystem`/`RouteResult`.
- Produces: provider ID `legacy-car`, mode ownership `['car']`, structured car alternatives, and existing car-route submission through `submitLegacyCarTrip()`.

- [ ] **Step 1: Write RED tests for parity and capability exclusion**

Build a small connected road graph and assert:

```ts
const alternatives = provider.buildAlternatives(request({
  privateVehicleAccess: true,
  licensedDriver: true,
}), context);
assert.equal(alternatives.length, 1);
assert.equal(alternatives[0]?.mode, 'car');
assert.equal(alternatives[0]?.cost.generalizedCost, expectedRoute.totalCost);
```

Then assert `[]` when either `privateVehicleAccess` or `licensedDriver` is false, and assert execution invokes `submitLegacyCarTrip(sourceTripId, travelerWeight, route)` exactly once.

- [ ] **Step 2: Run test and verify RED**

```bash
node --experimental-strip-types --test tests/mobility14r-car-provider.test.ts
```

Expected: FAIL because the provider does not exist.

- [ ] **Step 3: Implement car alternative generation**

`LegacyCarMobilityProvider.buildAlternatives()` must return `[]` for missing origin/destination nodes or missing capabilities. Otherwise call current pathfinding with:

```ts
context.pathfinding.findRoute(context.roadGraph, start, end, {
  edgeCost: context.roadTravelTime,
  costKey: `mobility-car:${context.costEpoch}`,
});
```

Build cost with `movementTicks = route.totalCost` and all other 14R-A cost components zero. Store an immutable execution descriptor:

```ts
{
  kind: 'legacy-car',
  route,
  roadRevision: context.roadGraph.revision,
  costEpoch: context.costEpoch,
}
```

- [ ] **Step 4: Implement execution validation**

Before submission, `execute()` must verify descriptor kind, `roadRevision === context.roadGraph.revision`, and `costEpoch === context.costEpoch`. A stale descriptor returns `false` without submitting traffic.

- [ ] **Step 5: Run focused tests and verify GREEN**

```bash
node --experimental-strip-types --test tests/mobility14r-car-provider.test.ts tests/traffic-routing.test.ts tests/traffic-simulation.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 4**

```bash
git add src/simulation/mobility/providers/LegacyCarMobilityProvider.ts tests/mobility14r-car-provider.test.ts
git commit -m "feat: adapt legacy car mobility provider"
```

---

### Task 5: Extract Existing Transit Queue Execution from the Scheduler

**Files:**
- Create: `src/simulation/mobility/providers/TransitJourneyExecutor.ts`
- Create: `tests/mobility14r-transit-provider.test.ts`
- Modify: `src/simulation/mobility/MobilityScheduler.ts`

**Interfaces:**
- Consumes: current `JourneyPlan`, `TransitNetworkSystem`, and `PassengerQueueSystem`.
- Produces: `TransitJourneyExecutor.enqueue(request, plan, transit, passengers)` and `dominantTransitMode(plan)`.

- [ ] **Step 1: Write RED tests around the existing queue semantics**

Create a journey-plan fixture with a bus boarding/ride/alight sequence and assert `TransitJourneyExecutor.enqueue()` creates one queue cohort whose fields exactly preserve:

```ts
{
  id: `transit-passenger:${request.id}`,
  personTripId: request.id,
  travelerWeight: request.travelerWeight,
  lineId: lineId,
  boardingStopId: firstStop,
  alightingStopId: secondStop,
  destinationRoadNodeId: request.destinationRoadNodeId,
  enqueuedTick: request.departureTick,
}
```

Also build a mixed bus+metro plan and assert `dominantTransitMode(plan)` returns the mode with the largest sum of `ride` ticks; ties resolve lexicographically by canonical transit mode ID.

- [ ] **Step 2: Run focused test and verify RED**

```bash
node --experimental-strip-types --test tests/mobility14r-transit-provider.test.ts
```

Expected: FAIL because `TransitJourneyExecutor.ts` does not exist.

- [ ] **Step 3: Move the existing scheduler transit-enqueue logic without changing behavior**

Move the current `enqueueTransitTrip()`, `directionForPlan()`, `stopIdFromNode()`, and `stopIdFromPlatform()` behavior into `TransitJourneyExecutor`.

The executor must continue using `PassengerQueueSystem.enqueue()`; it must not create another queue or directly mutate transit vehicles.

- [ ] **Step 4: Implement deterministic dominant transit mode**

For every `ride` leg with a current `TransitMode`, sum `leg.ticks` by mode. Sort candidate modes by descending accumulated ride ticks, then lexicographically ascending mode ID. Return `null` when no transit ride leg exists.

- [ ] **Step 5: Keep scheduler behavior intact temporarily**

Instantiate `TransitJourneyExecutor` in `MobilityScheduler` and delegate the existing private enqueue path to it. Do not switch scheduler choice authority to the orchestrator yet; this task is a mechanical extraction only.

- [ ] **Step 6: Run transit regression tests**

```bash
node --experimental-strip-types --test tests/mobility14r-transit-provider.test.ts tests/transit-passengers.test.ts tests/transit-vehicles.test.ts tests/transit-integration.test.ts tests/transit-state.test.ts
```

Expected: PASS with unchanged capacity/queue semantics.

- [ ] **Step 7: Commit Task 5**

```bash
git add src/simulation/mobility/providers/TransitJourneyExecutor.ts src/simulation/mobility/MobilityScheduler.ts tests/mobility14r-transit-provider.test.ts
git commit -m "refactor: isolate transit journey execution"
```

---

### Task 6: Legacy Transit Alternative Provider

**Files:**
- Create: `src/simulation/mobility/providers/LegacyTransitMobilityProvider.ts`
- Modify: `tests/mobility14r-transit-provider.test.ts`

**Interfaces:**
- Consumes: `TransitJourneyExecutor`, current `JourneyPlanner`, `MultimodalRoutingGraph`, and transit network.
- Produces: provider ID `legacy-transit`, ownership of `bus | brt | tram | metro`, canonical transit alternatives, and queue execution through the existing passenger authority.

- [ ] **Step 1: Add RED tests for distinct canonical transit modes and unsupported modes**

For one bus scenario and one metro scenario, assert `buildAlternatives()` returns one executable alternative whose `mode` equals the actual dominant plan mode.

Also assert the provider's `modes` are exactly:

```ts
['bus', 'brt', 'tram', 'metro']
```

and never include `trolleybus`, `commuter_rail`, `regional_rail`, or `ferry`.

- [ ] **Step 2: Run focused test and verify RED**

```bash
node --experimental-strip-types --test tests/mobility14r-transit-provider.test.ts
```

Expected: FAIL on missing `LegacyTransitMobilityProvider`.

- [ ] **Step 3: Implement existing transit-plan wrapping**

Call the current planner with the same compatibility parameters used by `MobilityScheduler` today:

```ts
const plan = context.journeyPlanner.plan(
  context.multimodalGraph,
  start,
  end,
  {
    mode: 'transit',
    transferPenaltyTicks: 20,
    fareWeightTicksPerCurrency: 4,
    costKey: `mobility-transit:${context.costEpoch}`,
  },
);
```

Return no alternative for a missing plan or a plan with no dominant current transit mode.

Build the structured cost from existing plan values:

- `accessEgressTicks = plan.walkingTicks`
- `expectedWaitTicks = plan.expectedWaitTicks`
- `movementTicks = plan.inVehicleTicks`
- `transferPenaltyTicks = plan.transferPenaltyTicks`
- `fareImpedanceTicks = plan.fare * 4`
- `crowdingPenaltyTicks = context.crowdingPenaltyTicks`
- all other 14R-A components `0`

The sum must equal the current compatibility transit generalized cost plus the current crowding penalty.

- [ ] **Step 4: Add stale-plan execution validation**

The transit execution descriptor must include:

```ts
{
  kind: 'legacy-transit',
  plan,
  transitRevision: context.transit.revision,
  multimodalRevision: context.multimodalGraph.revision,
  costEpoch: context.costEpoch,
}
```

`execute()` returns `false` when any revision/epoch is stale. Otherwise delegate to `TransitJourneyExecutor.enqueue()`.

- [ ] **Step 5: Run focused and existing transit tests**

```bash
node --experimental-strip-types --test tests/mobility14r-transit-provider.test.ts tests/transit-routing.test.ts tests/transit-passengers.test.ts tests/transit-vehicles.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 6**

```bash
git add src/simulation/mobility/providers/LegacyTransitMobilityProvider.ts tests/mobility14r-transit-provider.test.ts
git commit -m "feat: adapt legacy transit mobility provider"
```

---

### Task 7: Cut `MobilityScheduler` Over to Provider Orchestration

**Files:**
- Modify: `src/simulation/mobility/MobilityScheduler.ts`
- Modify: `tests/transit-integration.test.ts`
- Modify: `tests/transit-state.test.ts`

**Interfaces:**
- Consumes: `MobilityProviderRegistry`, `MobilityOrchestrator`, `LegacyCarMobilityProvider`, `LegacyTransitMobilityProvider`.
- Produces: live provider-based choice/execution while retaining the existing persisted `MobilityDecision` shape and compatibility snapshot metrics; adds derived `modeShares` keyed by canonical `MobilityModeId`.

- [ ] **Step 1: Write RED scheduler-integration assertions**

Extend the existing competitive BRT integration test with:

```ts
assert.equal(x.transitModeShare, 1);
assert.equal(x.modeShares.brt, 1);
assert.equal(x.modeShares.car, 0);
```

Extend the poor-transit test with:

```ts
assert.equal(m.snapshot().carModeShare, 1);
assert.equal(m.snapshot().modeShares.car, 1);
```

Add a state-shape assertion proving persisted decisions still contain only the historical fields and historical `mode: 'car' | 'transit' | 'unmet'` values.

- [ ] **Step 2: Run integration/state tests and verify RED**

```bash
node --experimental-strip-types --test tests/transit-integration.test.ts tests/transit-state.test.ts
```

Expected: FAIL because `modeShares` does not exist.

- [ ] **Step 3: Register only executable current providers**

In the scheduler constructor/field initialization, register exactly:

```ts
this.providers.register(new LegacyCarMobilityProvider());
this.providers.register(new LegacyTransitMobilityProvider(this.transitExecutor));
```

Do not register providers for walk, bicycle, ride-hail, trolleybus, commuter rail, regional rail, or ferry in 14R-A.

- [ ] **Step 4: Convert legacy trips into explicit compatibility requests**

For every generated `MobilityPersonTrip`, create:

```ts
const request: MobilityJourneyRequest = Object.freeze({
  id: trip.id,
  sourceTripId: trip.sourceTripId,
  provenance: 'legacy_cohort',
  originRoadNodeId: trip.originRoadNodeId,
  destinationRoadNodeId: trip.destinationRoadNodeId,
  departureTick: trip.departureTick,
  travelerWeight: trip.travelerWeight,
  purpose: trip.purpose,
  capabilities: Object.freeze({
    privateVehicleAccess: true,
    licensedDriver: true,
    bicycleAccess: false,
    rideHailAvailable: false,
    mobilityLimited: false,
    farePaymentAccess: true,
  }),
  costEpoch,
});
```

No `personId` is added on the legacy path.

- [ ] **Step 5: Replace direct car/transit branching with one orchestrator call**

Keep the existing order: rebuild multimodal graph, advance transit operations, then route generated trips.

Build `MobilityRuntimeContext` once per tick. Its `submitLegacyCarTrip()` closure must resolve `sourceTripId` back to the current generated legacy trip and call the existing `MobilityTickContext.submitCarTrip()` with the original `MobilityPersonTrip` object.

Remove live use of `ModeChoiceSystem` from `MobilityScheduler` after parity is green. The compatibility `ModeChoiceSystem` file remains for external/tests.

- [ ] **Step 6: Preserve persisted decision schema exactly**

Do not add `canonicalMode`, provider ID, or cost breakdown fields to `MobilityDecision` or `MobilitySchedulerStateSnapshot.decisions` because that object is serialized by Save V5 and inherited by V8.

When a canonical mode wins, continue recording historical compatibility mode as:

```ts
const compatibilityMode = winner === 'car'
  ? 'car'
  : isTransitMode(winner)
    ? 'transit'
    : 'unmet';
```

Maintain a separate non-persisted `modeDecisionWeights` map for canonical mode analytics. `restoreState()` clears this derived map rather than extending save state.

- [ ] **Step 7: Add canonical mode-share analytics**

Extend `MobilitySnapshot` with:

```ts
modeShares: Readonly<Record<MobilityModeId, number>>;
```

Return all twelve keys every time. The denominator is the same total compatibility decision weight used by current car/transit/unmet shares. Transit compatibility share remains the combined historical transit-family decision weight, preserving current behavior.

- [ ] **Step 8: Run scheduler integration/state regressions**

```bash
node --experimental-strip-types --test tests/transit-integration.test.ts tests/transit-state.test.ts tests/transit-mode-choice.test.ts tests/phase5-headless.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit Task 7**

```bash
git add src/simulation/mobility/MobilityScheduler.ts tests/transit-integration.test.ts tests/transit-state.test.ts
git commit -m "feat: route mobility through multimodal providers"
```

---

### Task 8: Save V8 Compatibility and Unsupported-Mode Safety Gates

**Files:**
- Modify: `tests/save-v8.test.ts`
- Modify: `tests/mobility14r-orchestrator.test.ts`
- Test: `tests/save-v5.test.ts`
- Test: `tests/save-v7.test.ts`

**Interfaces:**
- Consumes: completed 14R-A runtime.
- Produces: explicit proof that no new authoritative 14R-A state enters Save V8 and unsupported future modes remain unavailable.

- [ ] **Step 1: Add a Save V8 schema RED/guard test**

In `tests/save-v8.test.ts`, create a city with transit state and assert the mobility payload keys remain exactly the historical set:

```ts
const save = serializeCore(core);
assert.deepEqual(
  Object.keys(save.transit.mobility).sort(),
  ['crowdingPenaltyTicks', 'decisions', 'fiscalFareCursor', 'fiscalOperatingCursor', 'operations', 'passengers', 'vehicles'],
);
assert.equal('modeShares' in save.transit.mobility, false);
assert.equal('providers' in save.transit.mobility, false);
assert.equal('alternatives' in save.transit.mobility, false);
```

- [ ] **Step 2: Add unsupported-mode safety assertions**

In the orchestrator test, verify the canonical registry can describe `ferry`, `regional_rail`, and `trolleybus` while the live provider registry contains no provider owning those modes. A request with car capability disabled and no transit route must resolve to `unmet`; it must not produce one of the foundation-only modes.

- [ ] **Step 3: Run save and safety tests**

```bash
node --experimental-strip-types --test tests/save-v5.test.ts tests/save-v7.test.ts tests/save-v8.test.ts tests/mobility14r-orchestrator.test.ts
```

Expected: PASS. If the Save V8 key assertion fails because production code added 14R-A derived state, remove that serialization change rather than changing the expected key list.

- [ ] **Step 4: Verify deterministic round-trip with current mobility state**

Run the existing V8 exact round-trip test unchanged. `serializeCore(hydrateCore(structuredClone(save)))` must remain deep-equal to the original save.

- [ ] **Step 5: Commit Task 8**

```bash
git add tests/save-v8.test.ts tests/mobility14r-orchestrator.test.ts
git commit -m "test: lock 14R-A save compatibility"
```

---

### Task 9: Performance, No-Full-City-Scan Evidence, and Full Verification

**Files:**
- Create: `tests/mobility14r-performance.test.ts`
- Modify only if required by measured defect: mobility files created in Tasks 1–7.

**Interfaces:**
- Consumes: complete 14R-A provider stack.
- Produces: performance diagnostics proving provider iteration scales with registered providers and unavailable modes do not trigger routing work.

- [ ] **Step 1: Write the performance/instrumentation test**

Use instrumented synthetic providers and pathfinding counters to process 10,000 compatibility journey requests. Assert:

```ts
assert.equal(unavailableFutureProviderBuildCalls, 0);
assert.equal(registry.list().length, 2); // legacy car + legacy transit in the live scheduler
assert.equal(fullPopulationEnumerationCount, 0);
```

For a stable repeated road/transit network scenario, capture planner diagnostics before/after repeated requests and assert cache hits increase on the stable second pass.

Print a diagnostic record rather than a hard hardware deadline:

```ts
console.log('PHASE14R_A_MOBILITY_10K_BENCHMARK', JSON.stringify({
  requests: 10_000,
  elapsedMs,
  carCacheHits,
  transitCacheHits,
}));
```

- [ ] **Step 2: Run performance test and verify GREEN**

```bash
node --experimental-strip-types --test tests/mobility14r-performance.test.ts
```

Expected: PASS and one benchmark diagnostic line.

- [ ] **Step 3: Run the complete TypeScript unit suite**

```bash
npm test
```

Expected: all tests PASS.

- [ ] **Step 4: Run static checks**

```bash
npm run typecheck
npm run lint
npm run assets:check
```

Expected: all commands exit `0`.

- [ ] **Step 5: Build and run browser/visual smoke gates**

```bash
npm run build
npm run test:smoke
npm run test:smoke:phase7
npm run test:smoke:isometric
```

Expected: all commands exit `0` and existing visual/transit compatibility remains intact.

- [ ] **Step 6: Review the final diff against the design boundary**

The final changed-file list must contain only the 14R-A mobility foundation, focused mobility/transit/save tests, and the approved design/plan documents. Confirm there is no new Save V9/V10 file, no `PersonId` authority implementation, no household/schedule simulation, no ride-hail fleet, no bicycle simulation, no rail/ferry fake execution, and no replacement of World Foundation or Transportation Engine 2.0 authority.

- [ ] **Step 7: Commit performance evidence if the test file is not already committed**

```bash
git add tests/mobility14r-performance.test.ts
git commit -m "test: verify 14R-A mobility performance"
```

- [ ] **Step 8: Push exact-head CI and record evidence on PR #90**

Record the exact head SHA, unit-test totals, benchmark diagnostic, typecheck/lint/assets/build results, browser/visual smoke results, Save V8 compatibility proof, and the fact that only car plus current transit providers are executable in 14R-A. Keep PR #90 draft and unmerged until explicit integration authorization is given.
