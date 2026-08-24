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
- Consumes: no simulation-domain types.

- [ ] **Step 1: Write the failing graph tests**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { InfrastructureGraph } from '../src/simulation/infrastructure/InfrastructureGraph.ts';

test('max flow respects the bottleneck and reports residual capacity', () => {
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

test('max flow is independent of input ordering', () => {
  const nodes = [{ id: 's' }, { id: 'a' }, { id: 'b' }, { id: 't' }];
  const edges = [
    { id: 'sa', from: 's', to: 'a', capacity: 5 },
    { id: 'sb', from: 's', to: 'b', capacity: 5 },
    { id: 'at', from: 'a', to: 't', capacity: 5 },
    { id: 'bt', from: 'b', to: 't', capacity: 5 },
  ];
  const first = new InfrastructureGraph(nodes, edges).solveMaxFlow('s', 't');
  const second = new InfrastructureGraph([...nodes].reverse(), [...edges].reverse()).solveMaxFlow('s', 't');
  assert.deepEqual(first, second);
});

test('non-operational edges carry zero flow', () => {
  const graph = new InfrastructureGraph(
    [{ id: 's' }, { id: 't' }],
    [{ id: 'e', from: 's', to: 't', capacity: 10, operational: false }],
  );
  assert.equal(graph.solveMaxFlow('s', 't').totalFlow, 0);
  assert.equal(graph.solveMaxFlow('s', 't').edgeFlow.e, 0);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --experimental-strip-types --test tests/infrastructure-graph.test.ts`

Expected: FAIL because `InfrastructureGraph.ts` does not exist.

- [ ] **Step 3: Implement deterministic Edmonds-Karp flow**

```ts
export type InfrastructureGraphNode = Readonly<{ id: string }>;
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
    // Validate duplicate IDs, endpoint existence and finite non-negative capacity before building adjacency.
  }

  solveMaxFlow(sourceId: string, sinkId: string): InfrastructureFlowResult {
    // Build a residual graph, BFS augmenting paths in stable edge-ID order,
    // then project residual values back onto the original authoritative edge IDs.
  }
}
```

The actual implementation must include the validation described in the comment above; the comment is not a deferred requirement.

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
  - `UtilityCorridorCell`
  - `UtilityFacility`
  - `UtilityTopologyState`
  - `UtilityInfrastructureState`
  - `UtilityTopologySystem.placePath(type, tier, coords, treasury)`
  - `UtilityTopologySystem.upgradePath(type, coords, treasury)`
  - `UtilityTopologySystem.removeAt(type, x, y)`
  - `UtilityTopologySystem.snapshotState()` / `restoreState()`
- Consumes: `TerrainGrid`, `RoadSystem`, `TreasurySystem`, `CellCoord`.

- [ ] **Step 1: Define exact data contracts and costs**

```ts
export type UtilityCorridorType = 'power_distribution' | 'power_transmission' | 'water_main' | 'water_trunk';
export type UtilityTier = 1 | 2 | 3;

export type UtilityCorridorCell = Readonly<{
  id: string;
  type: UtilityCorridorType;
  tier: UtilityTier;
  x: number;
  y: number;
  saturatedCycles: number;
  trippedUntilTick: number;
}>;

export type UtilityFacility = Readonly<{
  id: string;
  type: UtilityFacilityType;
  x: number;
  y: number;
  inputCoord?: CellCoord;
  outputCoord?: CellCoord;
}>;

export type UtilityTopologyState = Readonly<{
  cells: readonly UtilityCorridorCell[];
  revision: number;
  nextCorridorId: number;
}>;

export type UtilityInfrastructureState = Readonly<{
  topology: UtilityTopologyState;
  facilities: readonly UtilityFacility[];
  nextFacilityId: number;
}>;
```

In `src/data/utilities.ts`, add:

```ts
export const UTILITY_CORRIDOR_CAPACITY = Object.freeze({
  power_distribution: Object.freeze({ 1: 180, 2: 360, 3: 720 }),
  power_transmission: Object.freeze({ 1: 720, 2: 1_440, 3: 2_880 }),
  water_main: Object.freeze({ 1: 150, 2: 300, 3: 600 }),
  water_trunk: Object.freeze({ 1: 600, 2: 1_200, 3: 2_400 }),
});

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

Extend facility definitions with:

```ts
power_substation: Object.freeze({ id: 'power_substation', constructionCost: 24_000, operatingCost: 320, capacity: 1_440 }),
water_pump: Object.freeze({ id: 'water_pump', constructionCost: 18_000, operatingCost: 260, capacity: 1_200 }),
```

- [ ] **Step 2: Write deterministic topology test fixtures and RED tests**

Use a known-flat terrain fixture:

```ts
const flatTerrain = (width = 8, height = 4): TerrainGrid => new TerrainGrid(
  width,
  height,
  Array.from({ length: width * height }, () => ({ elevation: 0.5, water: false, buildable: true, biome: 'grass' as const })),
);

const roadStrip = (terrain: TerrainGrid, treasury: TreasurySystem): RoadSystem => {
  const roads = new RoadSystem(terrain);
  assert.equal(roads.placePath([{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 1 }], 'local', treasury).ok, true);
  return roads;
};
```

Then assert:

```ts
test('distribution requires roads while transmission may use buildable off-road terrain', () => {
  const terrain = flatTerrain();
  const treasury = new TreasurySystem(100_000);
  const roads = roadStrip(terrain, treasury);
  const topology = new UtilityTopologySystem(terrain, roads);
  assert.equal(topology.placePath('power_distribution', 1, [{ x: 2, y: 1 }], treasury).ok, true);
  const denied = topology.placePath('water_main', 1, [{ x: 5, y: 2 }], treasury);
  assert.deepEqual(denied, { ok: false, cost: 100, reason: 'road right-of-way required' });
  assert.equal(topology.placePath('power_transmission', 1, [{ x: 5, y: 2 }], treasury).ok, true);
});

test('failed path placement is atomic', () => {
  const terrain = flatTerrain();
  const treasury = new TreasurySystem(100_000);
  const roads = roadStrip(terrain, treasury);
  const topology = new UtilityTopologySystem(terrain, roads);
  const before = treasury.balance;
  const result = topology.placePath('power_distribution', 1, [{ x: 1, y: 1 }, { x: 1, y: 1 }], treasury);
  assert.equal(result.ok, false);
  assert.equal(treasury.balance, before);
  assert.equal(topology.list().length, 0);
});

test('upgrade charges the tier delta and refuses tier 3', () => {
  const terrain = flatTerrain();
  const treasury = new TreasurySystem(100_000);
  const roads = roadStrip(terrain, treasury);
  const topology = new UtilityTopologySystem(terrain, roads);
  topology.placePath('power_distribution', 1, [{ x: 1, y: 1 }], treasury);
  const before = treasury.balance;
  assert.equal(topology.upgradePath('power_distribution', [{ x: 1, y: 1 }], treasury).ok, true);
  assert.equal(before - treasury.balance, 90);
  topology.upgradePath('power_distribution', [{ x: 1, y: 1 }], treasury);
  const tier3Balance = treasury.balance;
  assert.equal(topology.upgradePath('power_distribution', [{ x: 1, y: 1 }], treasury).ok, false);
  assert.equal(treasury.balance, tier3Balance);
});
```

Add a fourth test that places `power_distribution` and `water_main` at `{x:2,y:1}` and asserts both cells remain present as separate layers.

- [ ] **Step 3: Run focused test RED**

Run: `node --experimental-strip-types --test tests/utility-topology.test.ts`

Expected: FAIL because topology types/system do not exist.

- [ ] **Step 4: Implement `UtilityTopologySystem`**

Validation must finish before treasury debit. Distribution/main require `roads.has(x,y)`; backbone requires `terrain.isBuildable(x,y)`. Duplicate request coordinates and already-present same-layer cells fail atomically. Stable cell IDs are `utility-corridor:<nextCorridorId>` assigned only after successful debit. `removeAt(type,x,y)` removes only that layer and increments revision once.

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
  - `UtilityCorridorCell[]`
  - `UtilityFacility[]`
  - `PowerDemandNode = { id: string; x: number; y: number; demand: number }`
  - `InfrastructureGraph`
- Produces:
  - `PowerNetworkSnapshot`
  - `PowerNetworkSystem.evaluate({ corridors, facilities, demands, tick })`
  - `PowerNetworkSystem.evaluateAdditionalHeadroom({ x, y, demand, snapshot, corridors, facilities })`

- [ ] **Step 1: Write RED tests with an explicit solver fixture**

Create helpers in the test file:

```ts
const cell = (id: string, type: UtilityCorridorType, x: number, y: number, tier: UtilityTier = 1): UtilityCorridorCell => ({
  id, type, x, y, tier, saturatedCycles: 0, trippedUntilTick: 0,
});
const source: UtilityFacility = { id: 'utility:1', type: 'power', x: 0, y: 1 };
```

Then test:

```ts
test('explicit distribution is required for power delivery', () => {
  const system = new PowerNetworkSystem();
  const demand = [{ id: 'b1', x: 2, y: 1, demand: 6 }];
  const noNetwork = system.evaluate({ corridors: [], facilities: [source], demands: demand, tick: 0 });
  assert.equal(noNetwork.perBuilding.b1?.serviceRatio, 0);
  const corridors = [cell('c1', 'power_distribution', 1, 1), cell('c2', 'power_distribution', 2, 1)];
  const connected = system.evaluate({ corridors, facilities: [source], demands: demand, tick: 0 });
  assert.equal(connected.perBuilding.b1?.delivered, 6);
  assert.equal(connected.perBuilding.b1?.serviceRatio, 1);
});

test('transmission does not directly serve a building', () => {
  const system = new PowerNetworkSystem();
  const snapshot = system.evaluate({
    corridors: [cell('t1', 'power_transmission', 1, 1), cell('t2', 'power_transmission', 2, 1)],
    facilities: [source],
    demands: [{ id: 'b1', x: 2, y: 1, demand: 6 }],
    tick: 0,
  });
  assert.equal(snapshot.perBuilding.b1?.serviceRatio, 0);
});
```

For the substation test, use transmission cell `{1,1}`, distribution cell `{3,1}`, a substation at `{2,1}` with `inputCoord:{1,1}` and `outputCoord:{3,1}`, and demand at `{4,1}`; assert full service. For the bottleneck test, use one shared Tier 1 distribution edge feeding demand `240` and a second independent branch feeding demand `6`; assert the heavy branch is partial and the independent branch remains `1.0`. Reverse corridor/demand arrays and deep-compare the full snapshot.

- [ ] **Step 2: Run RED**

Run: `node --experimental-strip-types --test tests/power-network.test.ts`

Expected: FAIL because `PowerNetworkSystem.ts` is missing.

- [ ] **Step 3: Implement canonical graph construction**

Use stable IDs:

```ts
const nodeId = (type: UtilityCorridorType, x: number, y: number): string => `${type}:${x},${y}`;
const superSource = 'power:super-source';
const superSink = 'power:super-sink';
```

Adjacent compatible power cells form two directed edges with capacity `min(capacity(A), capacity(B))`. Power sources inject into cardinal-adjacent distribution/transmission. Building virtual sink edges exist only when cardinal-adjacent to operational `power_distribution`. `power_substation` edges are directional `input transmission -> substation -> output distribution` and capped by the facility capacity.

- [ ] **Step 4: Implement residual additional-headroom evaluation**

Reserve current realized edge flow from the last snapshot, build residual capacities, add a virtual candidate building sink, and solve only the additional flow. Return `deliverable: 0`, `serviceRatio: 0`, `limitingReason: 'no-distribution-connection'` when no operational adjacent distribution exists.

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
- Consumes: `TerrainGrid`, water corridors/facilities, `WaterDemandNode = { id; x; y; demand }`, `InfrastructureGraph`.
- Produces: `WaterNetworkSnapshot`, per-building pressure margin, and `evaluateAdditionalHeadroom(...)`.

- [ ] **Step 1: Write RED tests with controlled elevation**

Use:

```ts
const terrainWithElevation = (elevations: number[]): TerrainGrid => new TerrainGrid(
  elevations.length,
  1,
  elevations.map((elevation) => ({ elevation, water: false, buildable: true, biome: 'grass' as const })),
);
```

Test a flat `[0.5,0.5,0.5]` main and assert a demand adjacent to the final `water_main` receives full service. Then use `[0.5,0.5,1.8]`; the uphill loss from `0.5` to `1.8` exceeds the 8.0 source head after edge loss, so assert `pressureEligible === false`, `serviceRatio === 0`, and `pressureMargin <= 0`.

For a pump, use terrain `[0.5,0.5,1.0,1.0,1.0]`, trunk input at x=1, pump at x=2 with `inputCoord:{x:1,y:0}` and `outputCoord:{x:3,y:0}`, main output at x=3, demand at x=4, and assert the pump makes pressure eligible. Set demand above `1_200` and assert delivered flow is never above pump capacity.

Add a trunk-only demand test asserting zero direct building service, and reverse all inputs to assert identical pressure/flow snapshots.

- [ ] **Step 2: Run RED**

Run: `node --experimental-strip-types --test tests/water-network.test.ts`

Expected: FAIL because `WaterNetworkSystem.ts` does not exist.

- [ ] **Step 3: Implement deterministic pressure propagation**

For every traversed edge:

```ts
const nextHead = currentHead
  - 0.25
  - 8 * Math.max(0, destinationElevation - sourceElevation);
```

Only edges with `nextHead > 0` are pressure eligible. Process the highest remaining head first; tie-break by stable node ID. A pump accepts only from its persisted input corridor and resets outgoing head to exactly `8.0` at its persisted output corridor, subject to its `1_200` transfer capacity.

- [ ] **Step 4: Run max flow over pressure-eligible topology**

Building virtual sink edges exist only beside `water_main`. Expose delivered flow, service ratio, pressure eligibility and pressure margin. Pressure is an eligibility constraint, not a continuous multiplier on delivered quantity.

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
- Modify: existing utility/core tests only where V8 intentionally changes road-component assumptions.

**Interfaces:**
- Produces:
  - `buildPath(type, tier, coords, treasury)`
  - `upgradePath(type, coords, treasury)`
  - `removePathAt(type, x, y)`
  - extended `placeFacility(...)` for sources/substation/pump
  - `evaluate(buildings, tick): UtilitySnapshot`
  - `evaluateDevelopmentHeadroom(x, y, powerDemand, waterDemand): DevelopmentUtilityHeadroom`
  - `snapshotState(): UtilityInfrastructureState`
  - `restoreState(state): void`
- Retains existing `listFacilities()`, `operatingCost()`, `power`, `water`, and `perBuilding` snapshot consumers.

- [ ] **Step 1: Write facade RED tests**

Create a flat 8×4 terrain, a local road strip x=1..5 at y=1, a source at x=0,y=1, and a lightweight occupied-building fixture matching `Building` shape at x=5,y=2 with `definitionId:'residential_cottage'`.

Assert in code:

```ts
const beforeNetwork = utilities.evaluate([building], 50);
assert.equal(beforeNetwork.perBuilding[building.id]?.power, 0);
utilities.buildPath('power_distribution', 1, [
  { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 1 }, { x: 4, y: 1 }, { x: 5, y: 1 },
], treasury);
const afterNetwork = utilities.evaluate([building], 50);
assert.ok((afterNetwork.perBuilding[building.id]?.power ?? 0) > 0);
```

Add exact tests for operating cost using one Tier 1 `power_distribution` cell (1.0), one Tier 2 `water_main` cell (1.3), and a `power_substation` facility (320) plus existing source operating cost; assert the numeric sum.

For overload, construct a branch whose flow puts an incident edge at 100% utilization, evaluate at ticks 50 and 100 and assert `saturatedCycles` 1 then 2, evaluate at tick 150 and assert `trippedUntilTick === 250` and zero flow through that cell, evaluate at tick 249 and assert still tripped, then at tick 250 assert operational. Call evaluations at ticks 60/70/80 between those boundaries and assert the counter does not change.

For headroom, create residual power capacity 20 and residual water capacity 10, request demand `(20,20)`, and assert `powerServiceRatio===1`, `waterServiceRatio===0.5`, `utilityRatio===0.5`, and `limitingReason==='water-capacity'`.

- [ ] **Step 2: Run RED**

Run: `node --experimental-strip-types --test tests/utility-network-system.test.ts`

Expected: FAIL on missing facade APIs/new snapshot fields.

- [ ] **Step 3: Compose topology and resource solvers**

Keep constructor `new UtilitySystem(terrain, roads)`. Add private `topology`, `powerNetwork`, `waterNetwork`, `lastSnapshot`, and `flowRevision` fields. Re-export `UtilityFacility` so existing imports do not churn unnecessarily.

Native V8 source placement (`power` or `water`) auto-seeds exactly one Tier 1 matching distribution/main cell on the lexicographically first cardinal-adjacent road cell when none exists there. V7 migration does not use this mutation path.

Substation/pump placement requires both endpoints before debit; endpoint types must be `power_transmission -> power_distribution` and `water_trunk -> water_main` respectively.

- [ ] **Step 4: Implement overload state mutation only on 50-tick boundaries**

A cell is saturated when any incident realized edge utilization is `>= 0.98`. At `tick % 50 === 0`, increment or reset once. On the third consecutive saturated cycle set `trippedUntilTick=tick+100` and reset `saturatedCycles=0`. Tripped means `tick < trippedUntilTick`; recovered means `tick >= trippedUntilTick`.

- [ ] **Step 5: Implement cached development headroom**

Use cache key:

```ts
`${this.topology.revision}|${this.flowRevision}|${x},${y}|${powerDemand}|${waterDemand}`
```

Return exact fields:

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

Clear the cache on topology/facility/trip-state change or when realized flow changes.

- [ ] **Step 6: Run focused and full tests GREEN**

```bash
node --experimental-strip-types --test tests/utility-network-system.test.ts
npm test
npm run typecheck
```

Expected: focused tests and the full suite pass.

- [ ] **Step 7: Commit Task 5**

```bash
git add src/simulation/utilities/UtilitySystem.ts src/simulation/utilities/UtilityInfrastructureTypes.ts tests/utility-network-system.test.ts tests
git commit -m "feat: make utility networks authoritative"
```

---

### Task 6: Integrate current utility flow and candidate-specific headroom into `SimulationCore`

**Files:**
- Modify: `src/simulation/core/SimulationCore.ts`
- Create: `tests/phase8a-core-integration.test.ts`
- Modify: development tests only where they intentionally assert the new local utility behavior.

**Interfaces:**
- Consumes: `UtilitySystem.evaluate(buildings,tick)` and `evaluateDevelopmentHeadroom(...)`.
- Produces core mutation APIs:
  - `buildUtilityPath(type, tier, cells)`
  - `upgradeUtilityPath(type, cells)`
  - `removeUtilityAt(type, x, y)`
  - extended `placeUtility(type, x, y, inputCoord?, outputCoord?)`

- [ ] **Step 1: Write RED integration tests**

Use a real `SimulationCore` with deterministic flat terrain and funds. Build roads/zoning/source/network through public APIs. Assert:

```ts
const before = core.utilitySnapshot.perBuilding[residentialBuilding.id]?.power ?? 0;
assert.equal(before, 0);
assert.equal(core.buildUtilityPath('power_distribution', 1, roadCells).ok, true);
const after = core.utilitySnapshot.perBuilding[residentialBuilding.id]?.power ?? 0;
assert.ok(after > 0);
```

For development gating, create one lot where low-intensity demand fits but `residential_apartment` demand exceeds residual local capacity. Evaluate the development market and assert the apartment feasibility result includes `utilities`. Upgrade the bottleneck to Tier 2 with no other state changes and assert the same definition no longer has `utilities` as a rejection reason.

Add a service-order test by mutating a utility path before a 10-tick service evaluation and asserting `serviceDemandSnapshot` reads the newly updated `utilitySnapshot.perBuilding` on that evaluation rather than the prior state.

- [ ] **Step 2: Run RED**

Run: `node --experimental-strip-types --test tests/phase8a-core-integration.test.ts`

Expected: FAIL because typed network mutations/candidate headroom are not wired.

- [ ] **Step 3: Pass the current tick into every utility evaluation**

Constructor initialization uses `0`; service/core loops use `this.clock.tick`:

```ts
this.utilitySnapshot = this.utilities.evaluate(this.buildings.occupied(), this.clock.tick);
```

Keep utility evaluation before service demand and before 50-tick city demand/population settlement.

- [ ] **Step 4: Make utility context candidate-specific without changing `DevelopmentFeasibilitySystem`**

Change signatures:

```ts
private localParcelContextForLot(
  lot: Lot,
  utilityDemand?: Readonly<{ power: number; water: number }>,
): LocalParcelContext

private developmentContextForLot(
  lot: Lot,
  definition: BuildingDefinition,
): DevelopmentParcelContext
```

When `utilityDemand` exists, call `evaluateDevelopmentHeadroom` and use its `utilityRatio`. Evaluate every building definition separately:

```ts
for (const definition of BUILDING_VARIANTS[lot.zone]) {
  opportunities.push(...this.developmentFeasibility.evaluateLot(
    lot,
    [definition],
    this.developmentContextForLot(lot, definition),
  ));
}
```

Use the same definition-specific context for redevelopment replacement evaluation. Existing-building housing/market diagnostics continue to use current delivered local utility service, not a prospective demand query.

- [ ] **Step 5: Add typed public utility mutation methods**

Each successful mutation immediately reevaluates utility service and refreshes market/housing/redevelopment snapshots that consume utility outcomes. UI must not receive direct access to mutate topology collections.

- [ ] **Step 6: Run integration and full verification GREEN**

```bash
node --experimental-strip-types --test tests/phase8a-core-integration.test.ts
npm test
npm run typecheck
```

Expected: all tests/typecheck pass.

- [ ] **Step 7: Commit Task 6**

```bash
git add src/simulation/core/SimulationCore.ts tests/phase8a-core-integration.test.ts tests
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
- Produces `SaveV8`, `serializeCoreV8`, `hydrateCoreV8`; default `serializeCore`/`hydrateCore` route to V8.
- Consumes V7 hydrate/serialize and `UtilitySystem.snapshotState()/restoreState()`.

- [ ] **Step 1: Write Save V8 RED tests**

Create a V8 core with one Tier 2 power corridor, one Tier 1 water main, source facilities, and an active tripped corridor. Serialize, hydrate, then assert:

```ts
assert.equal(save.saveVersion, 8);
assert.equal(save.gameVersion, '0.8.0-metropolitan-infrastructure');
assert.deepEqual(restored.utilities.snapshotState(), core.utilities.snapshotState());
```

Advance original/restored by 150 ticks and assert both authoritative utility state and derived `utilitySnapshot` deep-equal.

For V7 migration, serialize an explicit V7 fixture whose road component has adjacent power/water sources, load it with `hydrateCoreV8`, and assert every road cell in that component has Tier 1 `power_distribution` and `water_main`, every `saturatedCycles` is 0, every `trippedUntilTick` is 0, and no transmission/trunk/substation/pump exists. A second component without a water source must have no seeded `water_main`.

Clone a valid V8 save and mutate: duplicate a corridor ID, set `tier=4`, point a substation endpoint at a missing corridor, and set one coordinate outside terrain; each clone must throw on hydrate.

- [ ] **Step 2: Run RED**

Run: `node --experimental-strip-types --test tests/save-v8.test.ts`

Expected: FAIL because `saveV8.ts` is missing.

- [ ] **Step 3: Implement Save V8 envelope**

```ts
export type SaveV8 = Omit<SaveV7, 'saveVersion' | 'gameVersion'> & {
  saveVersion: 8;
  gameVersion: '0.8.0-metropolitan-infrastructure';
  utilityInfrastructure: UtilityInfrastructureState;
  highwayInfrastructure?: never;
};
```

Persist only authoritative corridor/facility/tier/saturation/trip/ID state. Do not persist graph edges, flow, pressure, utilization or headroom cache.

- [ ] **Step 4: Implement V7 migration without treasury mutations**

Hydrate V7 first, derive road components deterministically, inspect each legacy source's adjacent road component, and construct `UtilityInfrastructureState` directly. Seed every road cell in a qualifying component with one corresponding Tier 1 distribution/main cell. Stable migration IDs are assigned by resource then `(y,x)` order. Restore the resulting state directly into `UtilitySystem`.

- [ ] **Step 5: Switch default save API/package version**

`src/save/save.ts` keeps explicit V4/V5/V6/V7 exports and makes default functions V8. Set package version to `0.8.0-metropolitan-infrastructure` and add:

```json
"test:smoke:phase8a": "python tests/smoke/phase8a_utility_networks_smoke.py"
```

- [ ] **Step 6: Run Save V8 and full historical save tests GREEN**

```bash
node --experimental-strip-types --test tests/save-v8.test.ts
npm test
npm run typecheck
```

Expected: all pass.

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
- Produces `InfrastructureOverlayMode = 'none' | 'power-utilization' | 'water-pressure' | 'outages'` and panel state derived from core utility snapshots.
- Tool IDs: `utility-power-distribution`, `utility-power-transmission`, `utility-water-main`, `utility-water-trunk`, `utility-substation`, `utility-pump`, `utility-upgrade`.

- [ ] **Step 1: Write presentation RED tests with exact expected labels/values**

Create a core with one power and one water corridor. Use `collectInfrastructurePanelState(core)` and assert:

```ts
assert.equal(panel.power.production, core.utilitySnapshot.power.production);
assert.equal(panel.power.delivered, core.utilitySnapshot.power.served);
assert.equal(panel.water.unserved, core.utilitySnapshot.water.unserved);
assert.equal(panel.networkOperatingCost, core.utilitySnapshot.networkOperatingCost);
assert.equal(panel.trippedSegments, core.utilitySnapshot.trippedSegments);
```

Map `power-utilization` and assert every returned overlay datum is finite and its legend has numeric `min`/`max`. Trip one corridor and assert `outages` marks only that coordinate as tripped. Inspect a corridor and assert rows include `Type`, `Tier`, `Capacity`, `Utilization`, `Residual capacity`, `Saturation cycles`, and `Trip expiry`. Inspect a residential building and assert rows include `Power delivered`, `Water delivered`, and `Utility limiting reason`.

For ToolController, use a real core, set `utility-power-distribution`, call `applyPath`, and assert topology length increases; set `utility-upgrade`, call `applyPath`, and assert selected cell tier increases; facility placement must call the core public method rather than mutating `core.utilities` collections directly.

- [ ] **Step 2: Run RED**

Run: `node --experimental-strip-types --test tests/phase8a-presentation.test.ts`

Expected: FAIL on missing panel/overlay/tool IDs.

- [ ] **Step 3: Implement panel and typed tools**

Add panel values for production/demand/delivered/unserved/reserve margin, network operating cost, saturated count and tripped count. Corridor draw tools use `core.buildUtilityPath`; upgrade uses `core.upgradeUtilityPath`; substation/pump use selected input/output corridor coordinates held by app/controller state and pass them to `core.placeUtility`.

- [ ] **Step 4: Implement infrastructure overlays**

`power-utilization` reads realized utilization from the power snapshot. `water-pressure` reads pressure margin from the water snapshot. `outages` maps authoritative trip state. The Infrastructure overlay is mutually exclusive with existing traffic/service/transit/economy/Land-Housing overlays.

- [ ] **Step 5: Render utility corridors as a separate world layer**

Render both utility layers when co-located using deterministic offsets/line treatment. Rendering is read-only and must never infer or alter topology.

- [ ] **Step 6: Update app identity and save copy**

Change the header to Phase 8A / Metropolitan Infrastructure and save button to `Save V8`. Preserve backward browser-save loading by attempting the existing storage key before any new V8-specific key; do not delete previous stored data.

- [ ] **Step 7: Run presentation/full build GREEN**

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
- Modify: `package.json` only if the smoke command was not already added in Task 7.

**Interfaces:** no new production API.

- [ ] **Step 1: Write long-run deterministic invariants**

Build a deterministic city with both networks, a deliberate Tier 1 bottleneck, an upgrade, and a saturation/trip/recovery cycle. Advance 1,500 ticks. At every 50-tick boundary run:

```ts
assert.ok(snapshot.power.served <= snapshot.power.production + 1e-9);
assert.ok(snapshot.water.served <= snapshot.water.production + 1e-9);
for (const segment of Object.values(snapshot.powerNetwork.segments)) {
  assert.ok(Number.isFinite(segment.utilization));
  assert.ok(segment.utilization >= 0);
  if (segment.tripped) assert.equal(segment.realizedFlow, 0);
}
for (const service of Object.values(snapshot.perBuilding)) {
  assert.ok(service.power >= 0 && service.power <= 1);
  assert.ok(service.water >= 0 && service.water <= 1);
}
```

Run the identical seeded scenario twice and deep-compare final `utilities.snapshotState()` and `utilitySnapshot`.

- [ ] **Step 2: Run long-run test GREEN**

Run: `node --experimental-strip-types --test tests/phase8a-utility-network-invariants.test.ts`

Expected: pass with finite, capacity-safe, deterministic values.

- [ ] **Step 3: Implement Chromium smoke with exact actions/assertions**

The Python test launches the built app, clicks `tool-utility-power-distribution`, draws a road-following distribution path, clicks `tool-utility-water-main`, draws a water path, opens the infrastructure panel, selects `power-utilization`, and asserts the overlay legend is non-empty. It then selects `water-pressure`, asserts a numeric legend, uses `tool-utility-upgrade` on one corridor cell, inspects that cell and asserts text contains `Tier 2`, saves, reloads, re-inspects the same cell, and prints:

```py
print("PHASE8A_UTILITY_NETWORKS_SMOKE_PASS")
```

- [ ] **Step 4: Run browser acceptance**

```bash
npm run build
python -m playwright install --with-deps chromium
npm run test:smoke:phase8a
```

Expected output contains `PHASE8A_UTILITY_NETWORKS_SMOKE_PASS` and exits 0.

- [ ] **Step 5: Update README baseline/roadmap**

State that V8 `0.8.0-metropolitan-infrastructure` is canonical after merge; Phase 8A Utility Networks is complete; explicit power/water corridors, bottlenecks, pressure, upgrades, trips and local development headroom are authoritative; Phase 8B Metropolitan Roads is next and extends the same Save V8 envelope. Do not mark all Phase 8 complete yet.

- [ ] **Step 6: Run final clean verification**

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm run test:smoke:phase8a
```

Expected: zero failures/errors and successful Chromium smoke.

- [ ] **Step 7: Commit Task 9**

```bash
git add tests/phase8a-utility-network-invariants.test.ts tests/smoke/phase8a_utility_networks_smoke.py README.md package.json
git commit -m "test: close Phase 8A utility network acceptance"
```

---

### Task 10: PR verification and merge gate

**Files:** no production files expected.

**Interfaces:** produces a reviewed PR from `phase8a-utility-networks` to `main`.

- [ ] **Step 1: Open/update the PR with exact scope**

PR body summarizes shared capacity graph, explicit power/water topology, pressure, overload trips, development headroom, Save V8 migration, UI/overlays, long-run test and Chromium acceptance. Explicitly state Phase 8B is not part of this PR.

- [ ] **Step 2: Verify CI on the exact candidate head**

Require `npm test`, typecheck, lint, build and Phase 8A Chromium acceptance on the same code state. Record exact test count and head SHA in the PR description.

- [ ] **Step 3: Perform review-focused diff inspection**

Check topology mutation atomicity/treasury semantics, max-flow determinism, production conservation, water pressure direction/elevation math, 50-tick saturation mutation vs 10-tick observational evaluations, exact trip-expiry boundary, candidate-specific residual headroom for vacant and redevelopment candidates, V7 migration with zero invented history, malformed-save rejection, and UI snapshot purity.

If review finds a defect, add a reproducing RED test before fixing it.

- [ ] **Step 4: Check PR reviews/comments/inline threads**

There must be no unresolved requested changes, unresolved inline threads, or unaddressed correctness comments.

- [ ] **Step 5: Merge with expected-head protection**

Merge only with the exact verified head SHA supplied to the merge API. After merge, confirm `main` points at the merge commit containing that verified Phase 8A head.
