# Phase 8A — Utility Networks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace road-component power/water service with explicit deterministic capacity networks, local development headroom, overload trips, Save V8 persistence, and player-facing infrastructure controls/diagnostics.

**Architecture:** Keep `SimulationCore.utilities` as the public facade. Introduce a minimal generic `InfrastructureGraph` for deterministic capacity flow, domain-owned utility topology, independently testable power/water solvers, and candidate-specific development headroom computed from residual network capacity. Persist only authoritative topology/facility/trip state in Save V8; rebuild graphs, flows, pressure and overlays after load.

**Tech Stack:** TypeScript 5.x ES modules, Node 22 built-in test runner with strip-types, browser-native Canvas 2D, Python Playwright + Chromium smoke tests, dependency-free runtime.

**Spec:** `docs/superpowers/specs/2026-08-24-phase-8a-utility-networks-design.md`

## Global Constraints

- Save version becomes `8`; game version becomes `0.8.0-metropolitan-infrastructure`.
- V7 → V8 migration deterministically seeds Tier 1 road-following distribution/main networks on legacy road components that contain a corresponding source.
- `landfill` stays on the existing garbage/public-service path; it is not part of the new power/water flow graph.
- Power/water service must come from explicit network flow; road connectivity alone is insufficient in a native V8 city.
- Distribution/main may be placed only on existing road cells; transmission/trunk may use roads or other buildable terrain.
- Buildings connect only to cardinal-adjacent `power_distribution` / `water_main`; they never connect directly to transmission/trunk.
- Corridor tier is exactly `1 | 2 | 3`; capacities are the values in the approved spec.
- Water pressure uses 8.0 source/pump head, 0.25 per traversed edge, and `8 * uphill elevation delta` additional loss.
- Three consecutive 50-tick evaluations at >= 0.98 incident-edge utilization trip a corridor cell for exactly 100 simulation ticks.
- Existing downstream utility consumers remain causal consumers of the new delivered ratios; do not add parallel development/population bonuses.
- No runtime npm dependency may be introduced.

---

### Task 1: Deterministic capacity graph

**Files:**
- Create: `src/simulation/infrastructure/InfrastructureGraph.ts`
- Create: `tests/infrastructure-graph.test.ts`

**Interfaces:**
- Produces:
  - `InfrastructureGraphNode = { id: string }`
  - `InfrastructureGraphEdge = { id: string; from: string; to: string; capacity: number; operational?: boolean }`
  - `InfrastructureFlowResult = { totalFlow: number; edgeFlow: Readonly<Record<string, number>>; edgeUtilization: Readonly<Record<string, number>>; residualCapacity: Readonly<Record<string, number>> }`
  - `InfrastructureGraph.solveMaxFlow(sourceId: string, sinkId: string): InfrastructureFlowResult`
  - `InfrastructureGraph.outgoingEdges(nodeId: string): readonly InfrastructureGraphEdge[]`
- Consumes: none beyond standard TypeScript.

- [ ] **Step 1: Write deterministic RED tests**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { InfrastructureGraph } from '../src/simulation/infrastructure/InfrastructureGraph.ts';

test('max flow respects the narrowest capacity and reports residual capacity', () => {
  const graph = new InfrastructureGraph(
    [{ id: 's' }, { id: 'a' }, { id: 't' }],
    [
      { id: 'e1', from: 's', to: 'a', capacity: 10 },
      { id: 'e2', from: 'a', to: 't', capacity: 4 },
    ],
  );
  const result = graph.solveMaxFlow('s', 't');
  assert.equal(result.totalFlow, 4);
  assert.equal(result.edgeFlow.e1, 4);
  assert.equal(result.edgeFlow.e2, 4);
  assert.equal(result.residualCapacity.e1, 6);
  assert.equal(result.edgeUtilization.e2, 1);
});

test('max flow is independent of node and edge input order', () => {
  const nodes = [{ id: 's' }, { id: 'a' }, { id: 'b' }, { id: 't' }];
  const edges = [
    { id: 'sa', from: 's', to: 'a', capacity: 5 },
    { id: 'sb', from: 's', to: 'b', capacity: 5 },
    { id: 'at', from: 'a', to: 't', capacity: 5 },
    { id: 'bt', from: 'b', to: 't', capacity: 5 },
  ];
  const a = new InfrastructureGraph(nodes, edges).solveMaxFlow('s', 't');
  const b = new InfrastructureGraph([...nodes].reverse(), [...edges].reverse()).solveMaxFlow('s', 't');
  assert.deepEqual(a, b);
});

test('non-operational edges carry zero flow', () => {
  const graph = new InfrastructureGraph(
    [{ id: 's' }, { id: 't' }],
    [{ id: 'e', from: 's', to: 't', capacity: 10, operational: false }],
  );
  assert.equal(graph.solveMaxFlow('s', 't').totalFlow, 0);
});
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `node --experimental-strip-types --test tests/infrastructure-graph.test.ts`

Expected: FAIL because `InfrastructureGraph.ts` does not exist.

- [ ] **Step 3: Implement the graph with sorted deterministic traversal**

Use Edmonds-Karp style augmenting paths. Canonicalize node/edge order by ID in the constructor; create residual reverse arcs internally without exposing them as authoritative edges. Reject duplicate IDs, missing endpoints, negative/non-finite capacity, and missing source/sink IDs.

Core shape:

```ts
export type InfrastructureGraphEdge = Readonly<{
  id: string;
  from: string;
  to: string;
  capacity: number;
  operational?: boolean;
}>;

export class InfrastructureGraph {
  private readonly nodes: readonly InfrastructureGraphNode[];
  private readonly edges: readonly InfrastructureGraphEdge[];

  constructor(nodes: readonly InfrastructureGraphNode[], edges: readonly InfrastructureGraphEdge[]) {
    this.nodes = [...nodes].sort((a, b) => a.id.localeCompare(b.id));
    this.edges = [...edges].sort((a, b) => a.id.localeCompare(b.id));
    // validate IDs/endpoints/capacity here
  }

  solveMaxFlow(sourceId: string, sinkId: string): InfrastructureFlowResult {
    // deterministic BFS over stable edge IDs, augment until no path remains
  }
}
```

- [ ] **Step 4: Run focused tests GREEN**

Run: `node --experimental-strip-types --test tests/infrastructure-graph.test.ts`

Expected: 3 tests pass, 0 fail.

- [ ] **Step 5: Commit Task 1**

```bash
git add src/simulation/infrastructure/InfrastructureGraph.ts tests/infrastructure-graph.test.ts
git commit -m "feat: add deterministic infrastructure capacity graph"
```

---

### Task 2: Utility definitions and authoritative corridor topology

**Files:**
- Modify: `src/data/utilities.ts`
- Create: `src/simulation/utilities/UtilityInfrastructureTypes.ts`
- Create: `src/simulation/utilities/UtilityTopologySystem.ts`
- Create: `tests/utility-topology.test.ts`

**Interfaces:**
- Produces:
  - `UtilityFacilityType = 'power' | 'water' | 'landfill' | 'power_substation' | 'water_pump'`
  - `UtilityCorridorType = 'power_distribution' | 'power_transmission' | 'water_main' | 'water_trunk'`
  - `UtilityTier = 1 | 2 | 3`
  - `UtilityCorridorCell = { id: string; type: UtilityCorridorType; tier: UtilityTier; x: number; y: number; saturatedCycles: number; trippedUntilTick: number }`
  - `UtilityTopologyState = { cells: UtilityCorridorCell[]; revision: number; nextCorridorId: number }`
  - `UtilityTopologySystem.placePath(type, tier, coords, treasury)`
  - `UtilityTopologySystem.upgradePath(type, coords, treasury)`
  - `UtilityTopologySystem.removeAt(type, x, y)`
  - `UtilityTopologySystem.snapshotState()` / `restoreState()`
- Consumes: `TerrainGrid`, `RoadSystem`, `TreasurySystem`.

- [ ] **Step 1: Extend utility data definitions**

Define exact corridor capacities from the spec:

```ts
export const UTILITY_CORRIDOR_CAPACITY = Object.freeze({
  power_distribution: Object.freeze({ 1: 180, 2: 360, 3: 720 }),
  power_transmission: Object.freeze({ 1: 720, 2: 1_440, 3: 2_880 }),
  water_main: Object.freeze({ 1: 150, 2: 300, 3: 600 }),
  water_trunk: Object.freeze({ 1: 600, 2: 1_200, 3: 2_400 }),
});
```

Use monotonic construction/operating costs with backbone lower cost per capacity but higher absolute cost. Lock these concrete values for implementation/testing:

```ts
export const UTILITY_CORRIDOR_COST = Object.freeze({
  power_distribution: Object.freeze({ 1: 120, 2: 210, 3: 380 }),
  power_transmission: Object.freeze({ 1: 300, 2: 520, 3: 900 }),
  water_main: Object.freeze({ 1: 100, 2: 180, 3: 330 }),
  water_trunk: Object.freeze({ 1: 260, 2: 450, 3: 780 }),
});

export const UTILITY_CORRIDOR_OPERATING_COST = Object.freeze({
  power_distribution: Object.freeze({ 1: 1.0, 2: 1.6, 3: 2.5 }),
  power_transmission: Object.freeze({ 1: 1.8, 2: 2.8, 3: 4.3 }),
  water_main: Object.freeze({ 1: 0.8, 2: 1.3, 3: 2.1 }),
  water_trunk: Object.freeze({ 1: 1.5, 2: 2.4, 3: 3.7 }),
});
```

Add facilities:

```ts
power_substation: { constructionCost: 24_000, operatingCost: 320, capacity: 1_440 },
water_pump: { constructionCost: 18_000, operatingCost: 260, capacity: 1_200 },
```

- [ ] **Step 2: Write RED topology tests**

Cover all atomic placement rules:

```ts
test('distribution and mains require roads while backbone may use buildable terrain', () => { /* assert exact ok/reason results */ });
test('failed path placement debits nothing and creates no partial cells', () => { /* use duplicate/unbuildable cell */ });
test('upgrade charges only tier delta and tier 3 cannot upgrade', () => { /* assert treasury delta and final tiers */ });
test('power and water layers can coexist on the same coordinate', () => { /* same road cell, separate types */ });
```

- [ ] **Step 3: Run focused topology test RED**

Run: `node --experimental-strip-types --test tests/utility-topology.test.ts`

Expected: FAIL because topology types/system do not exist.

- [ ] **Step 4: Implement `UtilityTopologySystem`**

Validation order must be pure before treasury debit. Distribution/main validate `roads.has(x,y)`. Backbone validates `terrain.isBuildable(x,y)`. Duplicate coordinates in one request fail atomically. Stable cell IDs use `utility-corridor:<nextCorridorId>` assigned in canonical input order after validation.

`removeAt(type,x,y)` removes only the requested utility layer and increments revision exactly once when successful.

- [ ] **Step 5: Run focused tests GREEN**

Run: `node --experimental-strip-types --test tests/utility-topology.test.ts`

Expected: all topology tests pass.

- [ ] **Step 6: Commit Task 2**

```bash
git add src/data/utilities.ts src/simulation/utilities/UtilityInfrastructureTypes.ts src/simulation/utilities/UtilityTopologySystem.ts tests/utility-topology.test.ts
git commit -m "feat: add authoritative utility corridor topology"
```

---

### Task 3: Power network solver

**Files:**
- Create: `src/simulation/utilities/PowerNetworkSystem.ts`
- Create: `tests/power-network.test.ts`

**Interfaces:**
- Consumes:
  - corridor cells from `UtilityTopologySystem`
  - `InfrastructureGraph`
  - utility facilities
  - occupied building demands
- Produces:
  - `PowerNetworkSnapshot`
  - `evaluate(input): PowerNetworkSnapshot`
  - `evaluateAdditionalHeadroom(input): { deliverable: number; serviceRatio: number; limitingReason?: string }`

- [ ] **Step 1: Write power RED tests**

Include:

```ts
test('road connectivity alone does not power a building without explicit distribution', () => { /* delivered = 0 */ });
test('distribution supplies a cardinal-adjacent building and respects exact demand', () => { /* ratio = 1 */ });
test('a tier-1 bottleneck creates partial service while a separate branch remains fully served', () => { /* assert branch ratios */ });
test('a building adjacent only to transmission receives zero direct service', () => { /* ratio = 0 */ });
test('a directional substation transfers transmission input to distribution output', () => { /* service restored */ });
test('equivalent input orderings produce identical edge flow/utilization snapshots', () => { /* deepEqual */ });
```

- [ ] **Step 2: Run RED**

Run: `node --experimental-strip-types --test tests/power-network.test.ts`

Expected: FAIL because `PowerNetworkSystem.ts` is missing.

- [ ] **Step 3: Implement graph construction and flow extraction**

Use deterministic node IDs by layer and coordinate:

```ts
const corridorNodeId = (type: UtilityCorridorType, x: number, y: number) => `${type}:${x},${y}`;
const sourceNodeId = (facilityId: string) => `power-source:${facilityId}`;
const buildingSinkId = (buildingId: string) => `power-building:${buildingId}`;
```

Adjacent compatible cells form directed pairs, each capacity = `min(capacity(cellA), capacity(cellB))`. Power sources inject into cardinal-adjacent distribution/transmission. A `power_substation` must have one explicitly restored/persisted `inputCoord` on transmission and one `outputCoord` on distribution; create only `transmission -> substation -> distribution` transfer edges, capacity = facility capacity.

Use a super-source and super-sink so one max-flow call serves all producers/consumers. Per-building delivered flow is the flow on its virtual sink edge.

- [ ] **Step 4: Implement additional-headroom query without mutating authoritative flow**

Take the current realized edge flow as reserved capacity, build a residual-capacity graph, add one virtual candidate sink adjacent to distribution, and solve for additional deliverability. Return zero with `no-distribution-connection` if no adjacent distribution cell is operational.

- [ ] **Step 5: Run focused tests GREEN**

Run: `node --experimental-strip-types --test tests/power-network.test.ts`

Expected: all power tests pass.

- [ ] **Step 6: Commit Task 3**

```bash
git add src/simulation/utilities/PowerNetworkSystem.ts tests/power-network.test.ts
git commit -m "feat: add deterministic power network flow"
```

---

### Task 4: Water pressure and capacity solver

**Files:**
- Create: `src/simulation/utilities/WaterNetworkSystem.ts`
- Create: `tests/water-network.test.ts`

**Interfaces:**
- Consumes: terrain elevation, water corridor topology, water source/pump facilities, occupied building water demand, `InfrastructureGraph`.
- Produces:
  - `WaterNetworkSnapshot`
  - per-building delivered ratio and pressure margin
  - corridor utilization/residual capacity
  - `evaluateAdditionalHeadroom(...)`

- [ ] **Step 1: Write water RED tests**

```ts
test('water main supplies an adjacent building only while pressure remains positive', () => { /* short flat main => full */ });
test('uphill elevation can make a connected building pressure-ineligible', () => { /* delivered = 0, margin <= 0 */ });
test('a directional pump resets outgoing head to 8 and is throughput constrained', () => { /* downstream service restored but <= capacity */ });
test('water trunk never connects directly to a building sink', () => { /* zero without main */ });
test('input ordering does not change pressure eligibility or water flow assignment', () => { /* deepEqual */ });
```

- [ ] **Step 2: Run RED**

Run: `node --experimental-strip-types --test tests/water-network.test.ts`

Expected: FAIL because `WaterNetworkSystem.ts` does not exist.

- [ ] **Step 3: Implement deterministic best-remaining-head propagation**

For each source/pump outlet, propagate:

```ts
nextHead = currentHead - 0.25 - 8 * Math.max(0, destinationElevation - sourceElevation);
```

Only retain edges/nodes reachable with `nextHead > 0`. Use highest remaining head first; ties by stable node ID. Pumps are directional bridges with persisted `inputCoord` and `outputCoord`; outgoing pump head resets to exactly `8.0` and pump transfer capacity constrains flow.

- [ ] **Step 4: Run max flow only on pressure-eligible edges**

Use the same super-source/super-sink pattern as power. Expose the minimum positive pressure margin reaching each building connection as a diagnostic; pressure does not scale delivered flow except by making an edge eligible/ineligible.

- [ ] **Step 5: Run focused tests GREEN**

Run: `node --experimental-strip-types --test tests/water-network.test.ts`

Expected: all water tests pass.

- [ ] **Step 6: Commit Task 4**

```bash
git add src/simulation/utilities/WaterNetworkSystem.ts tests/water-network.test.ts
git commit -m "feat: add pressure-constrained water network"
```

---

### Task 5: Refactor `UtilitySystem` into the Phase 8A facade and add overload protection

**Files:**
- Modify: `src/simulation/utilities/UtilitySystem.ts`
- Modify: `src/simulation/utilities/UtilityInfrastructureTypes.ts`
- Create: `tests/utility-network-system.test.ts`
- Modify: existing utility tests that construct legacy `UtilitySystem` directly, preserving legacy helper behavior only where migration tests require it.

**Interfaces:**
- Produces:
  - `buildPath(type, tier, coords, treasury)`
  - `upgradePath(type, coords, treasury)`
  - `removePathAt(type, x, y)`
  - expanded `placeFacility(...)` supporting substation/pump endpoints
  - `evaluate(buildings, tick): UtilitySnapshot`
  - `evaluateDevelopmentHeadroom(x, y, powerDemand, waterDemand): DevelopmentUtilityHeadroom`
  - `snapshotState(): UtilityInfrastructureState`
  - `restoreState(state): void`
- `UtilitySnapshot` retains existing `power`, `water`, and `perBuilding` fields and adds `powerNetwork`, `waterNetwork`, `networkOperatingCost`, `saturatedSegments`, `trippedSegments`.

- [ ] **Step 1: Write facade RED tests for exact public behavior**

Cover:

```ts
test('explicit corridor network replaces road-component distribution', () => { /* source + road but no corridor => 0; add corridor => service */ });
test('network operating cost includes every corridor tier and new facility', () => { /* exact numeric total */ });
test('three consecutive saturated 50-tick evaluations trip a corridor cell for 100 ticks', () => { /* assert trippedUntilTick */ });
test('tripped corridor carries zero flow and returns exactly at expiry', () => { /* tick boundary assertions */ });
test('development headroom reports residual power/water capacity and limiting reason', () => { /* exact ratios */ });
```

- [ ] **Step 2: Run RED**

Run: `node --experimental-strip-types --test tests/utility-network-system.test.ts`

Expected: FAIL on missing methods/new snapshot fields.

- [ ] **Step 3: Compose topology + solvers in `UtilitySystem`**

Constructor stays `new UtilitySystem(terrain, roads)`. Add private `topology`, `powerNetwork`, `waterNetwork`, and `lastEvaluationTick` fields. Existing `listFacilities()` remains stable for callers.

Facility records become:

```ts
export type UtilityFacility = Readonly<{
  id: string;
  type: UtilityFacilityType;
  x: number;
  y: number;
  inputCoord?: CellCoord;
  outputCoord?: CellCoord;
}>;
```

Power/water legacy source placement still requires road access and automatically seeds one Tier 1 distribution/main corridor cell on the lexicographically first cardinal-adjacent road cell **only for a native V8 newly placed source**. Substation/pump placement requires valid input/output corridor endpoints and charges atomically.

- [ ] **Step 4: Implement overload counters exactly on 50-tick evaluations**

Only mutate saturation/trip state when `tick % 50 === 0`; the 10-tick service-loop evaluations must be observational. A corridor is saturated when any incident realized edge utilization >= `0.98`. Increment once per 50-tick evaluation; reset to zero if below threshold. On third consecutive saturated cycle set `trippedUntilTick = tick + 100` and reset counter to zero. While `tick < trippedUntilTick`, exclude the cell from graphs. At `tick >= trippedUntilTick`, it is operational again.

- [ ] **Step 5: Implement cached development headroom**

Cache key:

```ts
`${topologyRevision}|${flowRevision}|${x},${y}|${powerDemand}|${waterDemand}`
```

Invalidate when topology, trip state, facilities, or current realized flow changes. Return:

```ts
{
  powerHeadroom,
  waterHeadroom,
  powerServiceRatio,
  waterServiceRatio,
  utilityRatio: Math.min(powerServiceRatio, waterServiceRatio),
  waterPressureEligible,
  waterPressureMargin,
  limitingReason,
}
```

- [ ] **Step 6: Run utility + existing core utility tests GREEN**

Run:

```bash
node --experimental-strip-types --test tests/utility-network-system.test.ts
npm test
```

Expected: focused tests pass; any existing tests that assume old road-component service are updated only where the intended V8 behavior changed.

- [ ] **Step 7: Commit Task 5**

```bash
git add src/simulation/utilities/UtilitySystem.ts src/simulation/utilities/UtilityInfrastructureTypes.ts tests/utility-network-system.test.ts tests/*.test.ts
git commit -m "feat: make utility networks authoritative"
```

---

### Task 6: Integrate real utility flow and candidate-specific headroom into `SimulationCore`

**Files:**
- Modify: `src/simulation/core/SimulationCore.ts`
- Modify: `src/simulation/development/DevelopmentTypes.ts` only if a diagnostic field is required; do not add a feasibility callback API.
- Create: `tests/phase8a-core-integration.test.ts`
- Modify: `tests/development-feasibility.test.ts` only for expected V8 utility semantics.

**Interfaces:**
- Consumes: `UtilitySystem.evaluate(buildings, tick)` and `evaluateDevelopmentHeadroom(...)`.
- Produces typed core mutations:
  - `buildUtilityPath(...)`
  - `upgradeUtilityPath(...)`
  - `removeUtilityAt(...)`
  - extended `placeUtility(...)`

- [ ] **Step 1: Write RED integration tests**

```ts
test('core utility service changes immediately after explicit network topology mutation', () => { /* build/remove corridor and inspect snapshot */ });
test('high-demand development candidate is rejected when residual local headroom is below its minimum utility ratio', () => { /* candidate rejection includes utilities */ });
test('upgrading the same bottleneck makes the same candidate feasible without a development bonus', () => { /* same market inputs, only utility upgrade changes */ });
test('service loop evaluates utilities before systems that consume current per-building utility state', () => { /* assert same-tick service demand sees new ratio */ });
```

- [ ] **Step 2: Run RED**

Run: `node --experimental-strip-types --test tests/phase8a-core-integration.test.ts`

Expected: FAIL because typed network mutations and candidate-specific headroom are not wired.

- [ ] **Step 3: Change all utility evaluation calls to include current tick**

Constructor initialization uses tick `0`; service/core loops use `this.clock.tick`:

```ts
this.utilitySnapshot = this.utilities.evaluate(this.buildings.occupied(), this.clock.tick);
```

Ensure utility evaluation remains before service-demand evaluation and before the 50-tick core demand/population settlement.

- [ ] **Step 4: Make development context candidate-specific without changing `DevelopmentFeasibilitySystem`**

Change local context to accept optional candidate demand:

```ts
private localParcelContextForLot(
  lot: Lot,
  utilityDemand?: Readonly<{ power: number; water: number }>,
): LocalParcelContext
```

If `utilityDemand` is supplied, call `evaluateDevelopmentHeadroom` at the lot/building coordinate and use its `utilityRatio`; otherwise derive current local utility ratio for existing-building housing/market diagnostics.

Change:

```ts
private developmentContextForLot(lot: Lot, definition: BuildingDefinition): DevelopmentParcelContext
```

and compute candidate context with `definition.powerDemand` / `definition.waterDemand`.

Evaluate candidate definitions individually:

```ts
for (const definition of BUILDING_VARIANTS[lot.zone]) {
  opportunities.push(...this.developmentFeasibility.evaluateLot(
    lot,
    [definition],
    this.developmentContextForLot(lot, definition),
  ));
}
```

Apply the same candidate-specific context to redevelopment replacements.

- [ ] **Step 5: Add typed public mutation APIs**

Do not let UI mutate topology objects directly. Core methods validate/charge through `UtilitySystem`, refresh `utilitySnapshot` immediately on success, then refresh affected market/housing/redevelopment snapshots where utility outcomes are consumed.

- [ ] **Step 6: Run focused + full suite GREEN**

Run:

```bash
node --experimental-strip-types --test tests/phase8a-core-integration.test.ts
npm test
npm run typecheck
```

Expected: all tests/typecheck pass.

- [ ] **Step 7: Commit Task 6**

```bash
git add src/simulation/core/SimulationCore.ts src/simulation/development/DevelopmentTypes.ts tests/phase8a-core-integration.test.ts tests/development-feasibility.test.ts
git commit -m "feat: integrate utility headroom into city development"
```

---

### Task 7: Save V8 and deterministic V7 migration

**Files:**
- Create: `src/save/saveV8.ts`
- Modify: `src/save/save.ts`
- Modify: `package.json`
- Create: `tests/save-v8.test.ts`

**Interfaces:**
- Produces:
  - `SaveV8`
  - `serializeCoreV8(core): SaveV8`
  - `hydrateCoreV8(input): SimulationCore`
  - default `serializeCore`/`hydrateCore` route to V8
- Consumes: `UtilitySystem.snapshotState()` / `restoreState()` and V7 serializer/hydrator.

- [ ] **Step 1: Write Save V8 RED tests**

Cover exact behavior:

```ts
test('default save API emits Save V8 and round-trips utility topology, tiers, facilities, saturation counters and active trip state', () => { /* deepEqual authoritative state */ });
test('V8 continuation reproduces identical future utility trips and delivered service', () => { /* hydrate, advance both, compare */ });
test('V7 migration seeds tier-1 road-following power/water networks with zero invented outage history', () => { /* every road in source component seeded */ });
test('V7 component without a corresponding source seeds no corridor for that resource', () => { /* empty */ });
test('malformed V8 rejects duplicate corridor identity, invalid tiers, invalid facility endpoints and out-of-bounds cells', () => { /* assert throws */ });
```

- [ ] **Step 2: Run RED**

Run: `node --experimental-strip-types --test tests/save-v8.test.ts`

Expected: FAIL because `saveV8.ts` is missing.

- [ ] **Step 3: Implement `SaveV8` envelope**

```ts
export type SaveV8 = Omit<SaveV7, 'saveVersion' | 'gameVersion'> & {
  saveVersion: 8;
  gameVersion: '0.8.0-metropolitan-infrastructure';
  utilityInfrastructure: UtilityInfrastructureState;
  highwayInfrastructure?: never;
};
```

Do not persist derived graph, flow, pressure, utilization or cache data.

- [ ] **Step 4: Implement V7 migration before restoring utility state**

Hydrate V7 city first. Build road components using the existing `buildRoadComponentIndex`/equivalent deterministic traversal. For each road component with an adjacent legacy `power` source, seed Tier 1 `power_distribution` on every road cell in that component; same for `water_main` and water sources. All cells start `saturatedCycles: 0`, `trippedUntilTick: 0`.

Migration must not call player placement APIs or debit treasury.

- [ ] **Step 5: Switch default save API and package version**

`src/save/save.ts` exports V8 while retaining explicit V5/V6/V7 APIs. Set package version to `0.8.0-metropolitan-infrastructure` and add:

```json
"test:smoke:phase8a": "python tests/smoke/phase8a_utility_networks_smoke.py"
```

- [ ] **Step 6: Run Save V8 + all historical save tests GREEN**

Run:

```bash
node --experimental-strip-types --test tests/save-v8.test.ts
npm test
npm run typecheck
```

Expected: all migration and prior explicit-save tests pass.

- [ ] **Step 7: Commit Task 7**

```bash
git add src/save/saveV8.ts src/save/save.ts package.json tests/save-v8.test.ts
git commit -m "feat: persist utility infrastructure in Save V8"
```

---

### Task 8: Infrastructure UI, overlays, tools, and inspectors

**Files:**
- Create: `src/ui/InfrastructurePanel.ts`
- Create: `src/rendering/InfrastructureOverlayLayer.ts`
- Modify: `src/ui/ToolController.ts`
- Modify: `src/ui/Inspector.ts`
- Modify: `src/app/GameApp.ts`
- Modify: `src/rendering/WorldRenderer.ts`
- Modify: `src/styles.css`
- Create: `tests/phase8a-presentation.test.ts`

**Interfaces:**
- Produces:
  - `InfrastructureOverlayMode = 'none' | 'power-utilization' | 'water-pressure' | 'outages'`
  - infrastructure panel state from `core.utilitySnapshot` and utility authoritative topology
  - tool IDs for four corridor draw tools, substation/pump placement, and utility upgrade
- Consumes only public `SimulationCore` mutation/snapshot APIs.

- [ ] **Step 1: Write presentation RED tests**

Assert stable human-facing/test IDs:

```ts
test('infrastructure panel exposes production, demand, delivered, reserve margin, operating cost, saturated and tripped counts', () => { /* HTML/state assertions */ });
test('infrastructure overlays map authoritative utilization, pressure and outage state', () => { /* numeric legend + cell values */ });
test('segment inspector explains type, tier, capacity, utilization, residual, saturation cycles and trip expiry', () => { /* inspection rows */ });
test('building inspector exposes delivered power/water and limiting network reason', () => { /* inspection rows */ });
test('tool controller routes corridor paths and facilities only through SimulationCore', () => { /* spy-like fake core or real core */ });
```

- [ ] **Step 2: Run RED**

Run: `node --experimental-strip-types --test tests/phase8a-presentation.test.ts`

Expected: FAIL on missing panel/overlay/tool IDs.

- [ ] **Step 3: Add tools and panel**

Add tool IDs:

```ts
'utility-power-distribution'
'utility-power-transmission'
'utility-water-main'
'utility-water-trunk'
'utility-substation'
'utility-pump'
'utility-upgrade'
```

Path tools call `core.buildUtilityPath(...)`; upgrade calls `core.upgradeUtilityPath(...)`; cell facilities call the extended `core.placeUtility(...)` with explicit selected endpoints gathered from the panel/controller state.

Infrastructure panel must show power/water production/demand/delivered/unserved/reserve margin, network operating cost, saturated count and tripped count.

- [ ] **Step 4: Add infrastructure overlay renderer**

Map topology coordinates to derived snapshot metrics. `power-utilization` and `water-pressure` include numeric min/max legends. `outages` is binary operational/tripped with the trip expiry tick in inspector detail. Overlay state is mutually exclusive with traffic/service/transit/economy/Land-Housing overlays.

- [ ] **Step 5: Extend world rendering without changing authoritative topology**

Render utility corridors as a separate visual layer. Co-located power/water corridors must both remain visible via deterministic offset/line treatment. Rendering never determines connectivity.

- [ ] **Step 6: Update app identity and save labels to Phase 8A/V8**

Update header eyebrow and save button copy to `Save V8`. Keep the local-storage key backward-compatible by attempting the existing key first; do not delete old browser saves.

- [ ] **Step 7: Run presentation + full suite GREEN**

Run:

```bash
node --experimental-strip-types --test tests/phase8a-presentation.test.ts
npm test
npm run typecheck
npm run build
```

Expected: all pass.

- [ ] **Step 8: Commit Task 8**

```bash
git add src/ui/InfrastructurePanel.ts src/rendering/InfrastructureOverlayLayer.ts src/ui/ToolController.ts src/ui/Inspector.ts src/app/GameApp.ts src/rendering/WorldRenderer.ts src/styles.css tests/phase8a-presentation.test.ts
git commit -m "feat: add Phase 8A infrastructure controls and diagnostics"
```

---

### Task 9: Long-run invariants, Chromium acceptance, and documentation

**Files:**
- Create: `tests/phase8a-utility-network-invariants.test.ts`
- Create: `tests/smoke/phase8a_utility_networks_smoke.py`
- Modify: `README.md`
- Modify: `package.json` only if smoke script was not already added in Task 7.

**Interfaces:**
- No new production interface; verifies the integrated system.

- [ ] **Step 1: Write long-run invariant test**

Construct a deterministic city with both networks, a deliberate tier-1 bottleneck, an upgrade, and a saturation/trip/recovery cycle. Advance at least 1,500 ticks and at every 50-tick boundary assert:

```ts
assert.ok(snapshot.power.served <= snapshot.power.production + 1e-9);
assert.ok(snapshot.water.served <= snapshot.water.production + 1e-9);
for (const segment of Object.values(snapshot.powerNetwork.segments)) {
  assert.ok(Number.isFinite(segment.utilization));
  assert.ok(segment.utilization >= 0);
  if (segment.tripped) assert.equal(segment.realizedFlow, 0);
}
for (const [buildingId, service] of Object.entries(snapshot.perBuilding)) {
  assert.ok(service.power >= 0 && service.power <= 1);
  assert.ok(service.water >= 0 && service.water <= 1);
  assert.ok(buildingId.length > 0);
}
```

Run the identical seeded scenario twice and deep-compare final authoritative utility state and derived utility snapshot.

- [ ] **Step 2: Run long-run test GREEN**

Run: `node --experimental-strip-types --test tests/phase8a-utility-network-invariants.test.ts`

Expected: pass with finite, conserved, deterministic results.

- [ ] **Step 3: Implement Chromium smoke**

The smoke test must:

1. launch the built game
2. draw a power distribution path
3. draw a water main path
4. inspect the infrastructure panel
5. switch to power utilization overlay and assert legend/overlay presence
6. switch to water pressure overlay and assert legend/overlay presence
7. perform one tier upgrade and verify the inspector/panel reflects the higher tier/capacity
8. save and load V8 and verify the path remains visible/inspectable
9. print `PHASE8A_UTILITY_NETWORKS_SMOKE_PASS`

- [ ] **Step 4: Run browser acceptance**

Run:

```bash
npm run build
python -m playwright install --with-deps chromium
npm run test:smoke:phase8a
```

Expected output contains `PHASE8A_UTILITY_NETWORKS_SMOKE_PASS` and exits 0.

- [ ] **Step 5: Update README baseline and roadmap wording**

README must state:

- V8 `0.8.0-metropolitan-infrastructure` is canonical after merge
- Phase 8A Utility Networks is complete
- explicit power/water corridors, bottlenecks, pressure, upgrades, trips and local development headroom are authoritative
- Phase 8B Metropolitan Roads remains next and will extend the same Save V8 envelope
- commands include `npm run test:smoke:phase8a`

Do **not** mark all Phase 8 complete until 8B merges.

- [ ] **Step 6: Run final clean verification**

Run:

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm run test:smoke:phase8a
```

Expected: zero test failures, zero TypeScript errors, successful build, successful Chromium smoke.

- [ ] **Step 7: Commit Task 9**

```bash
git add tests/phase8a-utility-network-invariants.test.ts tests/smoke/phase8a_utility_networks_smoke.py README.md package.json
git commit -m "test: close Phase 8A utility network acceptance"
```

---

### Task 10: PR verification and merge gate

**Files:**
- No production files expected.
- PR description references both Phase 8A spec and this plan.

**Interfaces:**
- Produces a reviewed PR from `phase8a-utility-networks` to `main`.

- [ ] **Step 1: Open/update the PR with exact scope**

PR body must summarize: shared capacity graph, explicit power/water topology, pressure, overload trips, development headroom, Save V8 migration, UI/overlays, long-run test, Chromium acceptance. Explicitly state that Phase 8B is not part of this PR.

- [ ] **Step 2: Verify CI on the exact candidate head**

Require `npm test`, typecheck, lint, build and Phase 8A Chromium acceptance on the same code state. Record exact test count and head SHA in the PR description.

- [ ] **Step 3: Perform review-focused diff inspection**

Specifically inspect:

- topology mutation atomicity and treasury semantics
- max-flow determinism/input-order independence
- source/facility production conservation
- water pressure direction/elevation math
- 50-tick saturation mutation vs 10-tick observational evaluations
- `trippedUntilTick` boundary (`tick < expiry` tripped; `tick >= expiry` operational)
- candidate-specific residual headroom during both vacant-lot and redevelopment evaluation
- V7 migration creating no invented outage/upgrade history
- Save V8 rejecting malformed references
- UI reading snapshots rather than manufacturing service outcomes

If review finds a defect, add a reproducing RED test before fixing it.

- [ ] **Step 4: Check PR reviews/comments/inline threads**

There must be no unresolved requested changes, unresolved inline threads, or unaddressed correctness comments before merge.

- [ ] **Step 5: Merge with expected-head protection**

Merge only with the exact verified head SHA supplied to the merge API. After merge, confirm `main` points at the merge commit containing the verified Phase 8A head.
