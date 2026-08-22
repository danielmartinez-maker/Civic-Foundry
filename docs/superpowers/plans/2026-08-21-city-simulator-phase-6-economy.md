# Civic Foundry Phase 6 — Firms, Production & Freight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace abstract commercial/industrial job capacity with a deterministic establishment economy whose firms, inventories, production, freight trucks, imports/exports, and lifecycle state causally interact with congestion, accessibility, utilities, taxes, and city demand.

**Architecture:** Add a focused `EconomyScheduler` that owns and coordinates Phase 6 firm/freight state while `SimulationCore` remains the top-level deterministic coordinator. Focused systems under `src/simulation/economy/` own firms, labor allocation, inventories, production, freight matching/vehicles, trade gateways, and lifecycle/firm-health logic; existing road traffic and municipal `EconomySystem` remain authoritative in their current domains.

**Tech Stack:** TypeScript ES modules, Node 22 built-in test runner with `--experimental-strip-types`, existing deterministic simulation systems, DOM/CSS browser UI, Python/Playwright smoke harness.

**Spec:** `docs/superpowers/specs/2026-08-21-city-simulator-phase-6-economy-design.md`

## Global Constraints

- Same seed + commands + save state must produce the same authoritative future state.
- Preserve Phase 3–5 road, traffic, service, transit, utility, zoning, building, treasury, and legacy-save behavior.
- Commercial/industrial employment becomes firm-derived in V6; residential capacity is unchanged.
- Storable commodities are exactly `industrial_inputs`, `manufactured_goods`, and `consumer_goods`; `logistics_capacity` is non-storable.
- `industrial_inputs` are imported from gateways only in Phase 6.
- `wholesale_logistics` converts `manufactured_goods` to `consumer_goods` 1:1 subject to labor, utility, storage, and logistics constraints.
- Freight gateways are deterministically derived from drivable boundary-road access and use stable coordinate-based IDs.
- No random bankruptcies; lifecycle transitions require deterministic sustained conditions.
- Freight trucks physically route over `TransportationGraph` and contribute weighted edge load to `TrafficSystem`.
- Save V6 migrates V5 without invented historical production, sales, trade, profit, or closure counters.
- Economic constants live in `src/data/economy.ts`.
- Presentation reads authoritative snapshots/getters only.
- Every production-code behavior change follows RED → GREEN → regression verification.

## File Map

Create:
- `src/data/economy.ts`
- `src/simulation/economy/FirmSystem.ts`
- `src/simulation/economy/LaborMarketSystem.ts`
- `src/simulation/economy/InventorySystem.ts`
- `src/simulation/economy/ProductionSystem.ts`
- `src/simulation/economy/TradeSystem.ts`
- `src/simulation/economy/FreightDemandSystem.ts`
- `src/simulation/economy/FreightVehicleSystem.ts`
- `src/simulation/economy/BusinessLifecycleSystem.ts`
- `src/simulation/economy/EconomyScheduler.ts`
- `src/save/saveV6.ts`
- `src/ui/EconomyPanel.ts`
- `src/rendering/EconomyOverlayLayer.ts`
- `src/rendering/FreightVehicleRenderer.ts`
- Phase 6 test files listed in each task.

Modify only required integration surfaces:
- `src/simulation/core/SimulationCore.ts`
- `src/simulation/employment/EmploymentSystem.ts`
- `src/save/save.ts`
- `src/app/GameApp.ts`
- `src/rendering/WorldRenderer.ts`
- `src/ui/Hud.ts`
- `src/ui/Inspector.ts`
- `src/ui/ToolController.ts`
- `src/styles.css`
- `package.json`
- project docs.

---

### Task 1: Economic constants, firms, and firm-derived labor

**Files:**
- Create: `src/data/economy.ts`
- Create: `src/simulation/economy/FirmSystem.ts`
- Create: `src/simulation/economy/LaborMarketSystem.ts`
- Test: `tests/economy-firms.test.ts`

**Interfaces:**
- `Commodity = 'industrial_inputs' | 'manufactured_goods' | 'consumer_goods'`
- `FirmArchetype = 'retail_local' | 'wholesale_logistics' | 'light_manufacturing' | 'assembly_manufacturing'`
- `FirmStatus = 'forming' | 'operating' | 'distressed' | 'closed'`
- `new FirmSystem(seed: number)`
- `FirmSystem.syncEligibleBuildings(buildings: readonly Building[], tick: number): void`
- `FirmSystem.list(): Firm[]`
- `FirmSystem.getByBuildingId(buildingId: string): Firm | undefined`
- `LaborMarketSystem.allocate(firms: readonly Firm[], population: number, inputs: { accessibility: number; utilityRatio: number }): EmploymentSnapshot`

- [ ] **Step 1: Write failing tests**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { FirmSystem } from '../src/simulation/economy/FirmSystem.ts';
import { LaborMarketSystem } from '../src/simulation/economy/LaborMarketSystem.ts';

const commercial = { id: 'building:a', lotId: 'a', x: 1, y: 1, zone: 'commercial', definitionId: 'commercial_shop', status: 'occupied', constructionStartedTick: 0, completionTick: 0 } as const;
const industrial = { id: 'building:b', lotId: 'b', x: 2, y: 1, zone: 'industrial', definitionId: 'industrial_workshop', status: 'occupied', constructionStartedTick: 0, completionTick: 0 } as const;

test('firm assignment is independent of input iteration order', () => {
  const a = new FirmSystem(42); a.syncEligibleBuildings([commercial, industrial], 100);
  const b = new FirmSystem(42); b.syncEligibleBuildings([industrial, commercial], 100);
  assert.deepEqual(a.list(), b.list());
});

test('labor snapshot totals are computed from active firms', () => {
  const firms = new FirmSystem(7); firms.syncEligibleBuildings([industrial], 100);
  const snapshot = new LaborMarketSystem().allocate(firms.list(), 20, { accessibility: 1, utilityRatio: 1 });
  assert.equal(snapshot.workforce, 10);
  assert.equal(snapshot.totalJobs, firms.list().reduce((sum, firm) => sum + firm.jobCapacity, 0));
  assert.equal(snapshot.employed + snapshot.unemployed, snapshot.workforce);
});
```

- [ ] **Step 2: Verify RED**

Run: `node --experimental-strip-types --test tests/economy-firms.test.ts`
Expected: module-not-found failure for the new Phase 6 systems.

- [ ] **Step 3: Implement the minimal constants, stable firm assignment/storage, and deterministic labor allocator**

`src/data/economy.ts` must define all archetype job capacity, base productivity, storage targets/capacity, recipe rates, economic cadences, price/cost constants, and lifecycle thresholds. `FirmSystem` sorts eligible building IDs before creating records; residential buildings are ignored. `LaborMarketSystem` stable-sorts active firms by accessibility/health score and then firm ID, allocating at most the aggregate workforce and never more than each firm’s capacity.

- [ ] **Step 4: Verify GREEN**

Run: `node --experimental-strip-types --test tests/economy-firms.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/data/economy.ts src/simulation/economy/FirmSystem.ts src/simulation/economy/LaborMarketSystem.ts tests/economy-firms.test.ts
git commit -m "feat: add deterministic firms and labor market"
```

---

### Task 2: Conservation-safe inventories and the local production chain

**Files:**
- Create: `src/simulation/economy/InventorySystem.ts`
- Create: `src/simulation/economy/ProductionSystem.ts`
- Test: `tests/economy-production.test.ts`

**Interfaces:**
- `InventorySystem.seed(firmId, commodity, quantity): void`
- `InventorySystem.get(firmId, commodity): InventoryRecord`
- `InventorySystem.dispatchCargo(firmId, commodity, quantity, shipmentId): CargoToken`
- `InventorySystem.receiveCargo(firmId, token): void`
- `InventorySystem.cancelCargo(token): void`
- `ProductionSystem.runFirmCycle(firm, inventories, inputs): FirmProductionResult`

- [ ] **Step 1: Write failing tests using real systems**

```ts
import { InventorySystem } from '../src/simulation/economy/InventorySystem.ts';
import { ProductionSystem } from '../src/simulation/economy/ProductionSystem.ts';

const inventories = new InventorySystem();
const production = new ProductionSystem();
const manufacturer = { id: 'firm:m', buildingId: 'b:m', zone: 'industrial', archetype: 'light_manufacturing', status: 'operating', jobCapacity: 10, filledJobs: 10, vacancies: 0, productivity: 1, cashHealth: 0.5, consecutiveLossCycles: 0, consecutiveRecoveryCycles: 0, formationTick: 0 } as const;
const wholesaler = { ...manufacturer, id: 'firm:w', buildingId: 'b:w', zone: 'commercial', archetype: 'wholesale_logistics' } as const;

test('manufacturer produces no goods without industrial inputs', () => {
  const result = production.runFirmCycle(manufacturer, inventories, { utilityRatio: 1, serviceRatio: 1, localDemand: 1 });
  assert.equal(result.produced.manufactured_goods ?? 0, 0);
  assert.ok(result.lostOutputFromInputShortage > 0);
});

test('wholesale conversion is one-to-one', () => {
  inventories.seed(wholesaler.id, 'manufactured_goods', 12);
  const result = production.runFirmCycle(wholesaler, inventories, { utilityRatio: 1, serviceRatio: 1, localDemand: 1 });
  assert.equal(result.consumed.manufactured_goods, result.produced.consumer_goods);
});

test('shipment cargo can be delivered only once', () => {
  inventories.seed('firm:s', 'manufactured_goods', 10);
  const token = inventories.dispatchCargo('firm:s', 'manufactured_goods', 6, 'shipment:1');
  assert.equal(inventories.get('firm:s', 'manufactured_goods').onHand, 4);
  inventories.receiveCargo('firm:d', token);
  assert.equal(inventories.get('firm:d', 'manufactured_goods').onHand, 6);
  assert.throws(() => inventories.receiveCargo('firm:d', token));
});
```

- [ ] **Step 2: Verify RED**

Run: `node --experimental-strip-types --test tests/economy-production.test.ts`
Expected: module-not-found failure.

- [ ] **Step 3: Implement inventory records/tokens and manufacturer, wholesaler, and retailer cycles**

Dispatched cargo is removed from source on-hand inventory and becomes shipment-owned exactly once. Successful receipt consumes the token. Cancelled local cargo returns to its source only when that source still exists; external import cancellation never creates local stock. Production is capped by labor ratio, utility/service ratio, required input, and output headroom.

- [ ] **Step 4: Verify GREEN**

Run: `node --experimental-strip-types --test tests/economy-production.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/simulation/economy/InventorySystem.ts src/simulation/economy/ProductionSystem.ts tests/economy-production.test.ts
git commit -m "feat: add inventories and production chain"
```

---

### Task 3: Derived gateways, freight orders, and deterministic matching

**Files:**
- Create: `src/simulation/economy/TradeSystem.ts`
- Create: `src/simulation/economy/FreightDemandSystem.ts`
- Test: `tests/economy-freight-demand.test.ts`

**Interfaces:**
- `TradeSystem.rebuildGateways(graph: TransportationGraph, width: number, height: number): void`
- `TradeSystem.listGateways(): FreightGateway[]`
- `FreightDemandSystem.createReplenishmentOrders(firms, inventories, tick): FreightOrder[]`
- `FreightDemandSystem.matchOrder(order, candidates, costFn): FreightMatch | undefined`

- [ ] **Step 1: Write failing tests**

```ts
import { TransportationGraph } from '../src/simulation/traffic/TransportationGraph.ts';
import { TradeSystem } from '../src/simulation/economy/TradeSystem.ts';
import { FreightDemandSystem } from '../src/simulation/economy/FreightDemandSystem.ts';

test('gateway list is stable for the same boundary graph', () => {
  const graph = new TransportationGraph();
  // Use the same RoadSystem helper pattern as transport-graph.test.ts to build boundary roads at (0,2) and (9,2), then rebuild graph.
  const trade = new TradeSystem();
  trade.rebuildGateways(graph, 10, 5);
  assert.deepEqual(trade.listGateways().map((g) => g.id).sort(), trade.listGateways().map((g) => g.id));
  assert.ok(trade.listGateways().every((g) => g.id.startsWith('gateway:')));
});

test('industrial input order rejects local suppliers', () => {
  const demand = new FreightDemandSystem();
  const match = demand.matchOrder({ id: 'o1', commodity: 'industrial_inputs', quantity: 5, destinationKind: 'firm', destinationId: 'firm:i', createdTick: 10, priority: 1, status: 'waiting' }, [
    { kind: 'firm', id: 'firm:local', available: 50 },
    { kind: 'gateway', id: 'gateway:0:2', available: Infinity },
  ], (candidate) => candidate.kind === 'firm' ? 1 : 10);
  assert.equal(match?.originKind, 'gateway');
});

test('lower generalized cost wins, then stable id breaks ties', () => {
  const demand = new FreightDemandSystem();
  const order = { id: 'o2', commodity: 'manufactured_goods', quantity: 5, destinationKind: 'firm', destinationId: 'firm:w', createdTick: 10, priority: 1, status: 'waiting' } as const;
  const match = demand.matchOrder(order, [
    { kind: 'firm', id: 'firm:b', available: 5 },
    { kind: 'firm', id: 'firm:a', available: 5 },
  ], () => 20);
  assert.equal(match?.originId, 'firm:a');
});
```

- [ ] **Step 2: Verify RED**

Run: `node --experimental-strip-types --test tests/economy-freight-demand.test.ts`
Expected: module-not-found failure.

- [ ] **Step 3: Implement gateway derivation, order records, matching, and aggregate trade counters**

Gateway IDs are `gateway:<x>:<y>` from boundary-access graph nodes. Matching sorts by generalized cost then origin ID. Local supply is considered before import only when the resulting generalized cost is lower; `industrial_inputs` skip local candidates entirely.

- [ ] **Step 4: Verify GREEN**

Run: `node --experimental-strip-types --test tests/economy-freight-demand.test.ts tests/transport-graph.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/simulation/economy/TradeSystem.ts src/simulation/economy/FreightDemandSystem.ts tests/economy-freight-demand.test.ts
git commit -m "feat: add freight gateways and order matching"
```

---

### Task 4: Explicit freight vehicles and shared congestion

**Files:**
- Create: `src/simulation/economy/FreightVehicleSystem.ts`
- Modify: `src/simulation/core/SimulationCore.ts`
- Test: `tests/economy-freight-vehicles.test.ts`

**Interfaces:**
- `FreightVehicleSystem.dispatch(shipment: FreightShipment, route: Route, tick: number): FreightVehicle`
- `FreightVehicleSystem.step(graph, intersections, roadTravelTime, tick): FreightVehicleEvent[]`
- `FreightVehicleSystem.edgeLoads(): Readonly<Record<string, number>>`
- `FreightVehicleSystem.snapshot()/restore(...)`

- [ ] **Step 1: Write failing tests against the real route/graph pattern used by `transit-vehicles.test.ts`**

```ts
test('active freight vehicle contributes vehicleWeight to its current road edge', () => {
  const { graph, route } = buildTwoEdgeRoadHarness();
  const freight = new FreightVehicleSystem();
  freight.dispatch({ id: 'shipment:1', orderId: 'o1', commodity: 'manufactured_goods', quantity: 10, vehicleWeight: 3, originKind: 'firm', originId: 'a', destinationKind: 'firm', destinationId: 'b' }, route, 0);
  assert.ok(Object.values(freight.edgeLoads()).some((load) => load === 3));
});
```

The test file must declare `buildTwoEdgeRoadHarness()` locally by copying the minimal graph/road fixture construction pattern already used in the existing traffic/transit tests; it must return `{ graph: TransportationGraph; route: Route }` and must not add test-only methods to production classes.

- [ ] **Step 2: Verify RED**

Run: `node --experimental-strip-types --test tests/economy-freight-vehicles.test.ts`
Expected: module-not-found failure.

- [ ] **Step 3: Implement vehicle progress/events and merge `freight.edgeLoads()` into `SimulationCore.mergeEdgeLoads(...)` alongside service and mobility loads**

Re-use existing graph edge travel time and intersection APIs; do not special-case freight inside `TrafficSystem`. If an edge disappears, emit `needs-replan` or `failed` with current-node context; never teleport to destination.

- [ ] **Step 4: Verify GREEN and traffic regressions**

Run: `node --experimental-strip-types --test tests/economy-freight-vehicles.test.ts tests/traffic-routing.test.ts tests/traffic-simulation.test.ts tests/transit-vehicles.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/simulation/economy/FreightVehicleSystem.ts src/simulation/core/SimulationCore.ts tests/economy-freight-vehicles.test.ts
git commit -m "feat: route freight trucks through traffic"
```

---

### Task 5: EconomyScheduler and authoritative employment integration

**Files:**
- Create: `src/simulation/economy/EconomyScheduler.ts`
- Modify: `src/simulation/core/SimulationCore.ts`
- Modify: `src/simulation/employment/EmploymentSystem.ts`
- Test: `tests/economy-integration.test.ts`

**Interfaces:**
- `EconomyScheduler.tick(inputs: EconomyTickInputs): EconomyDomainSnapshot`
- `EconomyScheduler.snapshot(): EconomyDomainSnapshot`
- `EconomyScheduler.snapshotState(): EconomySchedulerStateSnapshot`
- `EconomyScheduler.restoreState(state): void`
- `EconomyScheduler.firms: FirmSystem`
- `EconomyScheduler.freightVehicles: FreightVehicleSystem`

- [ ] **Step 1: Write failing integration test using only public production APIs**

```ts
test('city employment equals active establishment employment after lifecycle formation', () => {
  const core = buildBoundaryConnectedMixedUseCity();
  core.step(1000);
  const active = core.economyDomain.firms.list().filter((firm) => firm.status !== 'closed');
  assert.ok(active.length > 0);
  assert.equal(core.employmentSnapshot.totalJobs, active.reduce((sum, firm) => sum + firm.jobCapacity, 0));
  assert.equal(core.employmentSnapshot.employed, active.reduce((sum, firm) => sum + firm.filledJobs, 0));
});
```

`buildBoundaryConnectedMixedUseCity()` is declared in the test file and uses only existing public `SimulationCore` commands: boundary-connected roads, commercial/industrial zoning, required utilities/services, and enough ticks for buildings to occupy before the Phase 6 lifecycle cadence runs.

- [ ] **Step 2: Verify RED**

Run: `node --experimental-strip-types --test tests/economy-integration.test.ts`
Expected: property/module failure because `economyDomain` does not exist.

- [ ] **Step 3: Implement scheduler ownership/cadences and replace `buildings.jobCapacity()` as the V6 authoritative employment source**

Expose `readonly economyDomain: EconomyScheduler` while retaining `readonly economy: EconomySystem` for municipal settlement. `EmploymentSystem` may keep its public snapshot shape but must support evaluation from explicit firm job/employed totals instead of requiring raw building capacity.

- [ ] **Step 4: Verify GREEN and city-loop regressions**

Run: `node --experimental-strip-types --test tests/economy-integration.test.ts tests/core-city-loop.test.ts tests/phase3-headless.test.ts tests/phase4-headless.test.ts tests/phase5-headless.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/simulation/economy/EconomyScheduler.ts src/simulation/core/SimulationCore.ts src/simulation/employment/EmploymentSystem.ts tests/economy-integration.test.ts
git commit -m "feat: integrate firm economy into city loop"
```

---

### Task 6: Firm finance and deterministic lifecycle

**Files:**
- Create: `src/simulation/economy/BusinessLifecycleSystem.ts`
- Modify: `src/simulation/economy/FirmSystem.ts`
- Modify: `src/simulation/economy/EconomyScheduler.ts`
- Test: `tests/economy-lifecycle.test.ts`

**Interfaces:**
- `BusinessLifecycleSystem.evaluateFirm(firm, financials, tick): FirmLifecycleUpdate`
- `BusinessLifecycleSystem.scoreFormation(candidate, context): number`
- `FirmCycleFinancials = { revenue; inputCost; wageCost; utilityCost; taxCost; logisticsCost; shortagePenalty; operatingMargin }`

- [ ] **Step 1: Write failing lifecycle tests**

```ts
test('one bad lifecycle cycle cannot close an operating firm', () => {
  const system = new BusinessLifecycleSystem();
  const firm = makeOperatingFirm({ cashHealth: 0.7 });
  const update = system.evaluateFirm(firm, { revenue: 0, inputCost: 10, wageCost: 10, utilityCost: 5, taxCost: 5, logisticsCost: 20, shortagePenalty: 10, operatingMargin: -60 }, 100);
  assert.notEqual(update.status, 'closed');
});

test('repeating the same sustained-loss sequence produces identical closure tick', () => {
  const run = () => {
    const system = new BusinessLifecycleSystem();
    let firm = makeOperatingFirm({ cashHealth: 0.2 });
    let closedAt = -1;
    for (const tick of [100, 200, 300, 400, 500]) {
      const update = system.evaluateFirm(firm, severeLossFinancials(), tick);
      firm = { ...firm, ...update };
      if (firm.status === 'closed' && closedAt < 0) closedAt = tick;
    }
    return closedAt;
  };
  assert.equal(run(), run());
  assert.ok(run() > 100);
});
```

The test file defines `makeOperatingFirm()` as a literal `Firm` factory and `severeLossFinancials()` as a literal `FirmCycleFinancials` factory; neither helper exists in production.

- [ ] **Step 2: Verify RED**

Run: `node --experimental-strip-types --test tests/economy-lifecycle.test.ts`
Expected: module-not-found failure.

- [ ] **Step 3: Implement financial component calculation, sustained counters, formation scoring, distress/recovery/downsize/closure, and scheduler cleanup hooks**

All numeric thresholds/cadences come from `src/data/economy.ts`. Closing a firm removes its jobs, cancels waiting orders, reconciles reservations, and redirects/cancels active cargo without duplication.

- [ ] **Step 4: Verify GREEN**

Run: `node --experimental-strip-types --test tests/economy-lifecycle.test.ts tests/economy-integration.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/simulation/economy/BusinessLifecycleSystem.ts src/simulation/economy/FirmSystem.ts src/simulation/economy/EconomyScheduler.ts tests/economy-lifecycle.test.ts
git commit -m "feat: add deterministic business lifecycle"
```

---

### Task 7: Save V6 and V5 migration

**Files:**
- Create: `src/save/saveV6.ts`
- Modify: `src/save/save.ts`
- Test: `tests/save-v6.test.ts`

**Interfaces:**
- `SaveV6 = Omit<SaveV5, 'saveVersion' | 'gameVersion'> & { saveVersion: 6; gameVersion: '0.6.0-metropolitan'; economyDomain: EconomySchedulerStateSnapshot }`
- `serializeCoreV6(core: SimulationCore): SaveV6`
- `hydrateCoreV6(input: unknown): SimulationCore`
- Public `serializeCore` and `hydrateCore` default to V6; explicit V5 functions remain exported.

- [ ] **Step 1: Write failing V6 tests**

```ts
test('default serialization advances to V6', () => {
  const core = new SimulationCore();
  assert.equal(serializeCore(core).saveVersion, 6);
});

test('V5 migration has zero historical trade counters', () => {
  const phase5 = new SimulationCore();
  const migrated = hydrateCore(serializeCoreV5(phase5));
  const snapshot = migrated.economyDomain.snapshot();
  assert.equal(snapshot.cumulativeImports, 0);
  assert.equal(snapshot.cumulativeExports, 0);
});
```

Add a continuation test by constructing a boundary-connected economy city, stepping until at least one active shipment exists, serializing, hydrating, then advancing both copies the same number of ticks and comparing a stable JSON representation of authoritative V6 state plus prior V5 state.

- [ ] **Step 2: Verify RED**

Run: `node --experimental-strip-types --test tests/save-v6.test.ts`
Expected: default save version remains 5 / V6 module absent.

- [ ] **Step 3: Implement V6 serializer/hydrator and reference validation**

Persist firms, inventories and cargo tokens/reservations, orders, shipments/truck progress, gateway trade queues/counters, lifecycle counters, stable ID counters, and scheduler cadence state. V5 migration initializes an empty economic history and stable formation candidates from occupied buildings; no production/trade is backdated.

- [ ] **Step 4: Verify GREEN plus historical save suites**

Run: `node --experimental-strip-types --test tests/save-v3.test.ts tests/save-v4.test.ts tests/save-v5.test.ts tests/save-v6.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/save/saveV6.ts src/save/save.ts tests/save-v6.test.ts
git commit -m "feat: add deterministic Save V6"
```

---

### Task 8: Economy/Freight panel, overlays, and inspectors

**Files:**
- Create: `src/ui/EconomyPanel.ts`
- Create: `src/rendering/EconomyOverlayLayer.ts`
- Create: `src/rendering/FreightVehicleRenderer.ts`
- Modify: `src/app/GameApp.ts`
- Modify: `src/rendering/WorldRenderer.ts`
- Modify: `src/ui/Hud.ts`
- Modify: `src/ui/Inspector.ts`
- Modify: `src/ui/ToolController.ts`
- Modify: `src/styles.css`
- Test: `tests/economy-presentation.test.ts`

**Interfaces:**
- Economy overlays: `firm-health | jobs | production | shortages | freight-volume | freight-routes | logistics-delay | gateways | trade-flow`.
- `EconomyPanel.render(snapshot: EconomyDomainSnapshot): string`
- Inspector additions consume firm/shipment/gateway inspection DTOs from scheduler getters.
- Freight renderer consumes authoritative vehicle route/progress state only.

- [ ] **Step 1: Write failing presentation tests**

```ts
test('economy panel includes authoritative citywide causal metrics', () => {
  const panel = new EconomyPanel();
  const html = panel.render(sampleEconomySnapshot());
  for (const label of ['Active firms', 'Industrial output', 'Retail sales', 'Input shortage', 'Freight delay', 'Imports', 'Exports']) assert.match(html, new RegExp(label));
});

test('firm inspection exposes shortage, logistics, margin, and cash health', () => {
  const html = renderFirmInspection(sampleDistressedFirmInspection());
  for (const label of ['Input shortage', 'Logistics cost', 'Operating margin', 'Cash health']) assert.match(html, new RegExp(label));
});
```

The test file declares literal `sampleEconomySnapshot()` and `sampleDistressedFirmInspection()` factories matching the exported DTO types. `renderFirmInspection` must be an exported pure formatter from `Inspector.ts`, so the browser inspector and tests share the real formatter.

- [ ] **Step 2: Verify RED**

Run: `node --experimental-strip-types --test tests/economy-presentation.test.ts`
Expected: module/export failure.

- [ ] **Step 3: Implement panel, overlay layer, freight renderer, HUD summary, and firm/shipment/gateway inspectors**

The panel is observational. No control creates firms, goods, or shipments. Overlay legend/pattern/text and inspector values supplement color encoding.

- [ ] **Step 4: Verify GREEN plus prior presentation suites**

Run: `node --experimental-strip-types --test tests/economy-presentation.test.ts tests/presentation-contract.test.ts tests/transit-presentation.test.ts tests/service-presentation.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/EconomyPanel.ts src/rendering/EconomyOverlayLayer.ts src/rendering/FreightVehicleRenderer.ts src/app/GameApp.ts src/rendering/WorldRenderer.ts src/ui/Hud.ts src/ui/Inspector.ts src/ui/ToolController.ts src/styles.css tests/economy-presentation.test.ts
git commit -m "feat: add economy and freight presentation"
```

---

### Task 9: Phase 6 causal acceptance and performance

**Files:**
- Create: `tests/phase6-headless.test.ts`
- Modify: `src/simulation/economy/FreightDemandSystem.ts`
- Modify: `src/simulation/economy/FreightVehicleSystem.ts`
- Modify: `src/simulation/economy/BusinessLifecycleSystem.ts`
- Modify: `src/simulation/economy/EconomyScheduler.ts`

**Interfaces:** Existing public Phase 6 APIs only; no test-only production APIs.

- [ ] **Step 1: Write acceptance scenarios before changing production code**

`tests/phase6-headless.test.ts` must contain separate deterministic tests proving:
1. firms replace raw jobs;
2. no industrial inputs means no manufacturing output;
3. a lower-cost local manufactured-goods route beats an import;
4. freight raises actual road edge load/travel time;
5. congested freight raises logistics cost and lowers firm health;
6. adding a shorter/higher-capacity route lowers generalized logistics cost without a flat health bonus;
7. lower freight dispatch capacity raises queued orders, delay, and shortages;
8. delivered imports/exports conserve cargo volume;
9. formation/closure ticks are identical for identical seed/state;
10. closure/bulldoze cleanup leaves no orphaned jobs/reservations/negative inventory;
11. V6 save continuation matches uninterrupted state;
12. V5 migration starts with zero fabricated economic history.

- [ ] **Step 2: Run the acceptance suite and record each genuine causal failure**

Run: `node --experimental-strip-types --test tests/phase6-headless.test.ts`
Expected: RED only where one of the 12 required chains is not yet implemented.

- [ ] **Step 3: Close acceptance gaps in their owning system**

- supplier/matching gap → `FreightDemandSystem.ts`;
- route/vehicle/capacity gap → `FreightVehicleSystem.ts`;
- health/closure gap → `BusinessLifecycleSystem.ts`;
- cadence/cleanup/integration gap → `EconomyScheduler.ts`.

Do not weaken assertions to fit current behavior.

- [ ] **Step 4: Add performance diagnostics in the same test file**

Create deterministic benchmark tests for:
- 2,000 active establishments through production/lifecycle evaluation;
- 10,000 freight order matches using indexed candidates rather than all-pairs scans;
- 5,000 ticks with active economy/freight;
- repeated stable freight OD planning demonstrating route/cache reuse.

Print elapsed milliseconds and cache counters as diagnostics; do not enforce cross-hardware microsecond thresholds.

- [ ] **Step 5: Verify GREEN and commit**

Run: `node --experimental-strip-types --test tests/phase6-headless.test.ts`
Expected: PASS.

```bash
git add tests/phase6-headless.test.ts src/simulation/economy/FreightDemandSystem.ts src/simulation/economy/FreightVehicleSystem.ts src/simulation/economy/BusinessLifecycleSystem.ts src/simulation/economy/EconomyScheduler.ts
git commit -m "test: add Phase 6 economic acceptance suite"
```

---

### Task 10: Browser smoke, docs, version, and publication verification

**Files:**
- Create: `tests/smoke/phase6_smoke.py`
- Modify: `package.json`
- Modify: `README.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/SIMULATION.md`
- Modify: `docs/SAVE_FORMAT.md`
- Modify: `docs/TESTING.md`
- Modify: `docs/BALANCING.md`
- Modify: `docs/DEVELOPMENT_LOG.md`

- [ ] **Step 1: Write browser smoke first**

The smoke uses the same Chromium/`page.set_content` strategy as Phase 5 and must:
- build boundary-connected roads plus residential/commercial/industrial zones;
- supply utilities/services and step until firms form;
- verify economy panel metrics and one firm inspector;
- verify active freight and one freight overlay;
- serialize a V6 save;
- destructively alter road/economic topology;
- load and verify exact serialized restoration of firm/freight authoritative state.

- [ ] **Step 2: Run smoke and verify RED at the first missing Phase 6 browser contract**

Run: `python tests/smoke/phase6_smoke.py`
Expected: FAIL before the final browser integration/version cutover is complete.

- [ ] **Step 3: Finish smoke-facing integration and documentation**

Set `package.json` version to `0.6.0-metropolitan` and `test:smoke` to `python tests/smoke/phase6_smoke.py`. Update docs with the new economy domain boundary, commodity chain, freight/gateway model, Save V6, balancing constants, test coverage, and Phase 6 completion log.

- [ ] **Step 4: Run complete local verification**

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm run test:smoke
git diff --check
grep -RInE 'TODO|TBD|FIXME|PLACEHOLDER|coming soon' src tests docs README.md package.json || true
```

Expected: all tests pass; typecheck/lint/build/smoke pass; `git diff --check` prints nothing; placeholder scan contains no unfinished Phase 6 marker.

- [ ] **Step 5: Commit the verified checkpoint**

```bash
git add package.json README.md docs tests/smoke/phase6_smoke.py src
git commit -m "feat: complete verified Phase 6 economy"
```

- [ ] **Step 6: Publish without merging PR #2**

Fast-forward `metropolitan-era` to the verified Phase 6 commit. Confirm the published tree SHA equals the locally verified tree, verify GitHub Actions tests/typecheck/lint/build on that exact SHA, update PR #2’s body with the Phase 6 checkpoint SHA/tree/CI result, and keep the PR open and draft.
