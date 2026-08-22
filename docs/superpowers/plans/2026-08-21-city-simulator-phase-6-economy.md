# Civic Foundry Phase 6 — Firms, Production & Freight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace abstract commercial/industrial job capacity with a deterministic establishment economy whose firms, inventories, production, freight trucks, imports/exports, and lifecycle state causally interact with congestion, accessibility, utilities, taxes, and city demand.

**Architecture:** Add a focused `EconomyScheduler` that owns and coordinates Phase 6 firm/freight state while `SimulationCore` remains the top-level deterministic coordinator. New focused systems under `src/simulation/economy/` own firms, labor allocation, inventories, production, freight matching/vehicles, trade gateways, and lifecycle/firm-health logic; existing road traffic and municipal `EconomySystem` remain authoritative in their current domains.

**Tech Stack:** TypeScript ES modules, Node 22 built-in test runner with `--experimental-strip-types`, existing deterministic simulation systems, browser UI with DOM/CSS, Python/Playwright smoke harness.

**Spec:** `docs/superpowers/specs/2026-08-21-city-simulator-phase-6-economy-design.md`

## Global Constraints

- Preserve deterministic behavior: same seed + commands + save state must produce the same authoritative future state.
- Preserve Phase 3–5 road, traffic, service, transit, utility, zoning, building, and treasury behavior unless a minimal compatibility change is required.
- Commercial/industrial employment becomes firm-derived after V6; residential capacity remains unchanged.
- Use only the three storable cargo commodities `industrial_inputs`, `manufactured_goods`, `consumer_goods`; `logistics_capacity` is non-storable.
- `industrial_inputs` are gateway-imported only in Phase 6.
- `wholesale_logistics` converts `manufactured_goods` to `consumer_goods` 1:1 subject to causal constraints.
- External freight gateways are derived from drivable boundary road access and use stable IDs.
- No random bankruptcies; formation/failure require deterministic sustained conditions.
- Freight trucks must physically route over `TransportationGraph` and contribute edge load to `TrafficSystem`.
- Save V6 must migrate V5 without fabricating historical production/trade/profit counters.
- Economic constants belong in a dedicated data module; presentation may not invent authoritative metrics.
- TDD is mandatory for every production-code behavior change.

---

## File Structure

Create focused Phase 6 modules:

- `src/data/economy.ts` — commodity/archetype recipes, cadences, costs, capacities, lifecycle thresholds.
- `src/simulation/economy/FirmSystem.ts` — establishment identity/state and deterministic archetype assignment.
- `src/simulation/economy/LaborMarketSystem.ts` — firm-derived employment allocation.
- `src/simulation/economy/InventorySystem.ts` — non-negative balances, reservations, shipment-owned cargo accounting.
- `src/simulation/economy/ProductionSystem.ts` — manufacturing, wholesale conversion, retail consumption.
- `src/simulation/economy/TradeSystem.ts` — derived boundary gateways and aggregate import/export counters.
- `src/simulation/economy/FreightDemandSystem.ts` — replenishment/export order generation and deterministic matching.
- `src/simulation/economy/FreightVehicleSystem.ts` — explicit weighted truck routes/progress/edge loads/delivery events.
- `src/simulation/economy/BusinessLifecycleSystem.ts` — formation, distress, recovery, downsizing, closure, firm health.
- `src/simulation/economy/EconomyScheduler.ts` — cadence/orchestration and immutable domain snapshot.
- `src/save/saveV6.ts` — V6 persistence/migration.
- `src/ui/EconomyPanel.ts` — citywide economy/freight diagnostics.
- `src/rendering/EconomyOverlayLayer.ts` — economy/freight overlays.
- `src/rendering/FreightVehicleRenderer.ts` — authoritative truck rendering.

Modify only integration surfaces that need Phase 6 data:
`SimulationCore.ts`, `BuildingSystem.ts` only if helper access is required, `save.ts`, `GameApp.ts`, `WorldRenderer.ts`, `Hud.ts`, `Inspector.ts`, `ToolController.ts`, `package.json`, docs, and smoke tests.

---

### Task 1: Economic data model, firms, and labor-derived employment

**Files:**
- Create: `src/data/economy.ts`
- Create: `src/simulation/economy/FirmSystem.ts`
- Create: `src/simulation/economy/LaborMarketSystem.ts`
- Test: `tests/economy-firms.test.ts`

**Interfaces:**
- Consumes: `Building`, `ZoneType`, city seed, aggregate workforce, accessibility/utility viability inputs.
- Produces:
  - `Commodity = 'industrial_inputs' | 'manufactured_goods' | 'consumer_goods'`
  - `FirmArchetype = 'retail_local' | 'wholesale_logistics' | 'light_manufacturing' | 'assembly_manufacturing'`
  - `FirmStatus = 'forming' | 'operating' | 'distressed' | 'closed'`
  - `FirmSystem.syncEligibleBuildings(buildings, tick): void`
  - `FirmSystem.list(): Firm[]`
  - `FirmSystem.getByBuildingId(buildingId): Firm | undefined`
  - `LaborMarketSystem.allocate(firms, population, inputs): EmploymentSnapshot`

- [ ] **Step 1: Write failing firm/archetype tests**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { FirmSystem } from '../src/simulation/economy/FirmSystem.ts';
import { LaborMarketSystem } from '../src/simulation/economy/LaborMarketSystem.ts';

test('eligible commercial and industrial buildings form stable deterministic establishments', () => {
  const firmsA = new FirmSystem(42);
  const firmsB = new FirmSystem(42);
  const buildings = [
    { id: 'building:a', lotId: 'a', x: 1, y: 1, zone: 'commercial', definitionId: 'commercial_shop', status: 'occupied', constructionStartedTick: 0, completionTick: 0 },
    { id: 'building:b', lotId: 'b', x: 2, y: 1, zone: 'industrial', definitionId: 'industrial_workshop', status: 'occupied', constructionStartedTick: 0, completionTick: 0 },
  ] as const;
  firmsA.syncEligibleBuildings(buildings, 100);
  firmsB.syncEligibleBuildings([...buildings].reverse(), 100);
  assert.deepEqual(firmsA.list(), firmsB.list());
  assert.equal(firmsA.list().length, 2);
});

test('labor market employment is derived from firms rather than raw building job capacity', () => {
  const firms = new FirmSystem(7);
  firms.syncEligibleBuildings([{ id: 'building:i', lotId: 'i', x: 1, y: 1, zone: 'industrial', definitionId: 'industrial_workshop', status: 'occupied', constructionStartedTick: 0, completionTick: 0 }], 100);
  const snapshot = new LaborMarketSystem().allocate(firms.list(), 20, { accessibility: 1, utilityRatio: 1 });
  assert.equal(snapshot.totalJobs, firms.list().reduce((sum, firm) => sum + firm.jobCapacity, 0));
  assert.equal(snapshot.workforce, 10);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node --experimental-strip-types --test tests/economy-firms.test.ts`
Expected: FAIL because the Phase 6 firm/labor modules do not exist.

- [ ] **Step 3: Implement data constants, stable archetype assignment, firm storage, and deterministic labor allocation**

Use sorted building IDs before mutation. Residential buildings are ignored. Define all numeric job capacities, production recipes, storage targets, lifecycle thresholds, and cadences in `src/data/economy.ts`; do not scatter literals through systems.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `node --experimental-strip-types --test tests/economy-firms.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/data/economy.ts src/simulation/economy/FirmSystem.ts src/simulation/economy/LaborMarketSystem.ts tests/economy-firms.test.ts
git commit -m "feat: add deterministic firms and labor market"
```

---

### Task 2: Conservation-safe inventories and production chain

**Files:**
- Create: `src/simulation/economy/InventorySystem.ts`
- Create: `src/simulation/economy/ProductionSystem.ts`
- Test: `tests/economy-production.test.ts`

**Interfaces:**
- Consumes: `Firm[]`, commodity/archetype data, labor fill, utility/service viability, population/commercial demand.
- Produces:
  - `InventorySystem.get(firmId, commodity): InventoryRecord`
  - `InventorySystem.add/remove/reserveInbound/reserveOutbound/releaseReservation(...)`
  - `InventorySystem.dispatchCargo(...)` and `InventorySystem.receiveCargo(...)`
  - `ProductionSystem.runCycle(firms, inventories, inputs): ProductionCycleSnapshot`

- [ ] **Step 1: Write failing inventory/production tests**

```ts
test('manufacturer cannot produce without industrial inputs', () => {
  const result = runManufacturerCycle({ industrialInputs: 0, laborRatio: 1, utilityRatio: 1, outputHeadroom: 100 });
  assert.equal(result.manufacturedGoodsProduced, 0);
  assert.ok(result.lostOutputFromInputShortage > 0);
});

test('wholesale converts manufactured goods to consumer goods one for one', () => {
  const result = runWholesaleCycle({ manufacturedGoods: 12, laborRatio: 1, utilityRatio: 1, outputHeadroom: 20 });
  assert.equal(result.manufacturedGoodsConsumed, 12);
  assert.equal(result.consumerGoodsProduced, 12);
});

test('shipment-owned cargo is conserved exactly once', () => {
  const inventories = makeInventoryHarness();
  inventories.seed('source', 'manufactured_goods', 10);
  const cargo = inventories.dispatchCargo('source', 'manufactured_goods', 6, 'shipment:1');
  assert.equal(inventories.get('source', 'manufactured_goods').onHand, 4);
  inventories.receiveCargo('dest', cargo);
  assert.equal(inventories.get('dest', 'manufactured_goods').onHand, 6);
  assert.throws(() => inventories.receiveCargo('dest', cargo));
});
```

- [ ] **Step 2: Verify RED**

Run: `node --experimental-strip-types --test tests/economy-production.test.ts`
Expected: FAIL because inventory/production APIs are absent.

- [ ] **Step 3: Implement minimal inventory ledger and production/retail/wholesale cycles**

Inventory balances and reservations must never become negative. Dispatched cargo leaves source availability and is owned by a shipment token until one terminal delivery/cancel/loss path consumes that token.

- [ ] **Step 4: Verify GREEN**

Run: `node --experimental-strip-types --test tests/economy-production.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/simulation/economy/InventorySystem.ts src/simulation/economy/ProductionSystem.ts tests/economy-production.test.ts
git commit -m "feat: add inventories and production chain"
```

---

### Task 3: Derived freight gateways and deterministic order matching

**Files:**
- Create: `src/simulation/economy/TradeSystem.ts`
- Create: `src/simulation/economy/FreightDemandSystem.ts`
- Test: `tests/economy-freight-demand.test.ts`

**Interfaces:**
- Consumes: `TransportationGraph`, road boundary coordinates/nodes, firm inventories/targets, current road generalized costs.
- Produces:
  - `TradeSystem.rebuildGateways(graph, roads, terrain): void`
  - `TradeSystem.listGateways(): FreightGateway[]`
  - `FreightDemandSystem.createOrders(...): FreightOrder[]`
  - `FreightDemandSystem.matchOrders(...): FreightMatch[]`

- [ ] **Step 1: Write failing gateway/matching tests**

```ts
test('boundary road access derives stable freight gateway ids', () => {
  const first = buildGatewayHarness(['0,2', '9,2']);
  const second = buildGatewayHarness(['9,2', '0,2']);
  assert.deepEqual(first.listGateways(), second.listGateways());
  assert.deepEqual(first.listGateways().map((g) => g.id), ['gateway:0:2', 'gateway:9:2']);
});

test('industrial inputs always source from a gateway', () => {
  const matches = matchIndustrialInputOrderWithReachableLocalFirmsAndGateway();
  assert.equal(matches[0].originKind, 'gateway');
});

test('local manufactured goods beat a more expensive import route', () => {
  const match = matchManufacturedGoods({ localCost: 20, importCost: 80 });
  assert.equal(match.originKind, 'firm');
});
```

- [ ] **Step 2: Verify RED**

Run: `node --experimental-strip-types --test tests/economy-freight-demand.test.ts`
Expected: FAIL because gateway/trade/matching systems do not exist.

- [ ] **Step 3: Implement stable gateway derivation, import/export accounting shell, order generation, and deterministic generalized-cost matching**

Gateway IDs derive from boundary coordinates. Stable sorting uses cost then origin ID. `industrial_inputs` never choose local sources.

- [ ] **Step 4: Verify GREEN**

Run: `node --experimental-strip-types --test tests/economy-freight-demand.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/simulation/economy/TradeSystem.ts src/simulation/economy/FreightDemandSystem.ts tests/economy-freight-demand.test.ts
git commit -m "feat: add freight gateways and order matching"
```

---

### Task 4: Explicit freight trucks and road congestion integration

**Files:**
- Create: `src/simulation/economy/FreightVehicleSystem.ts`
- Modify: `src/simulation/core/SimulationCore.ts`
- Test: `tests/economy-freight-vehicles.test.ts`

**Interfaces:**
- Consumes: `TransportationGraph`, `PathfindingSystem`, current edge travel-time callback, matched freight orders/cargo.
- Produces:
  - `FreightVehicleSystem.dispatch(match, route, tick): FreightVehicle`
  - `FreightVehicleSystem.step(graph, intersections, pathfinding, roadTravelTime, tick): FreightVehicleEvent[]`
  - `FreightVehicleSystem.edgeLoads(): Readonly<Record<string, number>>`
  - delivery/failure events for scheduler inventory settlement.

- [ ] **Step 1: Write failing vehicle/congestion tests**

```ts
test('freight vehicle contributes weighted edge load until delivered', () => {
  const { freight, graph, route } = makeFreightVehicleHarness();
  freight.dispatch(makeShipment({ vehicleWeight: 3 }), route, 0);
  const loads = freight.edgeLoads();
  assert.ok(Object.values(loads).some((load) => load >= 3));
});

test('high freight corridor increases authoritative traffic travel time', () => {
  const baseline = runCorridorScenario({ freightTrips: 0 });
  const freight = runCorridorScenario({ freightTrips: 40 });
  assert.ok(freight.travelTime > baseline.travelTime);
});
```

- [ ] **Step 2: Verify RED**

Run: `node --experimental-strip-types --test tests/economy-freight-vehicles.test.ts`
Expected: FAIL because freight vehicles are absent.

- [ ] **Step 3: Implement freight vehicle state/progress and merge freight edge loads with existing service/transit/car loads in `SimulationCore`**

Do not modify `TrafficSystem` to special-case freight; use the existing edge-load integration seam. Route invalidation must yield deterministic failure/replan events rather than teleportation.

- [ ] **Step 4: Verify GREEN and run traffic regression tests**

Run:
`node --experimental-strip-types --test tests/economy-freight-vehicles.test.ts tests/traffic-routing.test.ts tests/traffic-simulation.test.ts tests/transit-vehicles.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/simulation/economy/FreightVehicleSystem.ts src/simulation/core/SimulationCore.ts tests/economy-freight-vehicles.test.ts
git commit -m "feat: route freight trucks through traffic"
```

---

### Task 5: EconomyScheduler and authoritative city-loop integration

**Files:**
- Create: `src/simulation/economy/EconomyScheduler.ts`
- Modify: `src/simulation/core/SimulationCore.ts`
- Modify: `src/simulation/employment/EmploymentSystem.ts`
- Test: `tests/economy-integration.test.ts`

**Interfaces:**
- Consumes: occupied buildings, population/workforce, utilities/services, accessibility, taxes, graph/pathfinding/traffic costs.
- Produces:
  - `EconomyScheduler.tick(inputs): EconomyDomainSnapshot`
  - `EconomyScheduler.snapshot(): EconomyDomainSnapshot`
  - `EconomyScheduler.snapshotState(): EconomySchedulerStateSnapshot`
  - `EconomyScheduler.restoreState(state): void`
  - firm-derived `EmploymentSnapshot` for the existing demand/population loop.

- [ ] **Step 1: Write failing integration tests**

```ts
test('occupied commercial and industrial shells contribute no jobs before firm formation', () => {
  const core = makeBuiltEconomyCity();
  core.economyDomain.clearFirmsForTest();
  core.step(50);
  assert.equal(core.employmentSnapshot.totalJobs, 0);
});

test('formed establishments drive employment snapshot and city demand', () => {
  const core = makeBuiltEconomyCity();
  core.step(500);
  const firmJobs = core.economyDomain.firms.list().filter((f) => f.status !== 'closed').reduce((sum, f) => sum + f.jobCapacity, 0);
  assert.equal(core.employmentSnapshot.totalJobs, firmJobs);
});
```

- [ ] **Step 2: Verify RED**

Run: `node --experimental-strip-types --test tests/economy-integration.test.ts`
Expected: FAIL because scheduler/domain integration does not exist.

- [ ] **Step 3: Implement `EconomyScheduler`, replace raw `buildings.jobCapacity()` as authoritative V6 employment input, and preserve compatibility snapshot shape**

`SimulationCore` may expose the scheduler as `readonly economyDomain: EconomyScheduler`; keep `readonly economy: EconomySystem` for municipal recurring settlement.

- [ ] **Step 4: Verify GREEN and run Phase 3–5 city-loop regressions**

Run:
`node --experimental-strip-types --test tests/economy-integration.test.ts tests/core-city-loop.test.ts tests/phase3-headless.test.ts tests/phase4-headless.test.ts tests/phase5-headless.test.ts`
Expected: PASS after explicit historical tests continue to use their intended legacy save/version paths.

- [ ] **Step 5: Commit**

```bash
git add src/simulation/economy/EconomyScheduler.ts src/simulation/core/SimulationCore.ts src/simulation/employment/EmploymentSystem.ts tests/economy-integration.test.ts
git commit -m "feat: integrate firm economy into city loop"
```

---

### Task 6: Firm finance, lifecycle, distress/recovery/failure

**Files:**
- Create: `src/simulation/economy/BusinessLifecycleSystem.ts`
- Modify: `src/simulation/economy/FirmSystem.ts`
- Modify: `src/simulation/economy/EconomyScheduler.ts`
- Test: `tests/economy-lifecycle.test.ts`

**Interfaces:**
- Consumes: per-firm sales/export revenue, input/import cost, wages, utility/tax burden, logistics delay/cost, shortages, demand, current cash health.
- Produces:
  - `FirmCycleFinancials`
  - status transitions with sustained counters
  - deterministic formation/closure counts and distress reason.

- [ ] **Step 1: Write failing lifecycle tests**

```ts
test('one bad cycle does not close a viable firm', () => {
  const lifecycle = makeLifecycleHarness();
  const firm = lifecycle.seedOperatingFirm({ cashHealth: 0.7 });
  lifecycle.evaluateFirm(firm.id, badCycle(), 100);
  assert.notEqual(lifecycle.getFirm(firm.id)?.status, 'closed');
});

test('sustained losses close the same firm on the same lifecycle evaluation', () => {
  const a = runLifecycleSequence(99, [badCycle(), badCycle(), badCycle(), badCycle()]);
  const b = runLifecycleSequence(99, [badCycle(), badCycle(), badCycle(), badCycle()]);
  assert.deepEqual(a, b);
  assert.ok(a.some((state) => state.status === 'closed'));
});

test('congested logistics route reduces operating health versus free flow', () => {
  const free = runFirmScenario({ logisticsDelay: 0, logisticsCost: 10 });
  const congested = runFirmScenario({ logisticsDelay: 80, logisticsCost: 60 });
  assert.ok(congested.cashHealth < free.cashHealth);
});
```

- [ ] **Step 2: Verify RED**

Run: `node --experimental-strip-types --test tests/economy-lifecycle.test.ts`
Expected: FAIL because lifecycle/financial behavior is absent.

- [ ] **Step 3: Implement normalized firm financial cycle and sustained lifecycle transitions**

All thresholds/cadences come from `src/data/economy.ts`. Closure cleans jobs, reservations, and pending work through scheduler-owned cleanup callbacks.

- [ ] **Step 4: Verify GREEN**

Run: `node --experimental-strip-types --test tests/economy-lifecycle.test.ts tests/economy-integration.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/simulation/economy/BusinessLifecycleSystem.ts src/simulation/economy/FirmSystem.ts src/simulation/economy/EconomyScheduler.ts tests/economy-lifecycle.test.ts
git commit -m "feat: add deterministic business lifecycle"
```

---

### Task 7: Save V6 and deterministic V5 migration

**Files:**
- Create: `src/save/saveV6.ts`
- Modify: `src/save/save.ts`
- Test: `tests/save-v6.test.ts`

**Interfaces:**
- Consumes: V5 serializer/hydrator and `EconomySchedulerStateSnapshot`.
- Produces:
  - `SaveV6`
  - `serializeCoreV6(core): SaveV6`
  - `hydrateCoreV6(input): SimulationCore`
  - default `serializeCore`/`hydrateCore` routed through V6.

- [ ] **Step 1: Write failing save/migration tests**

```ts
test('default save is V6 and resumes active freight/economy deterministically', () => {
  const uninterrupted = makeEconomyCityWithActiveFreight();
  uninterrupted.step(300);
  const loaded = hydrateCore(serializeCore(uninterrupted));
  uninterrupted.step(500);
  loaded.step(500);
  assert.equal(authoritativeHash(loaded), authoritativeHash(uninterrupted));
});

test('V5 migration preserves old authoritative state and starts with no fabricated economic history', () => {
  const v5 = serializeCoreV5(makePhase5City());
  const migrated = hydrateCore(v5);
  assert.equal(migrated.clock.tick, v5.clock.tick);
  assert.equal(migrated.economyDomain.snapshot().cumulativeImports, 0);
  assert.equal(migrated.economyDomain.snapshot().cumulativeExports, 0);
});
```

- [ ] **Step 2: Verify RED**

Run: `node --experimental-strip-types --test tests/save-v6.test.ts`
Expected: FAIL because V6 save support is absent.

- [ ] **Step 3: Implement V6 serializer/hydrator, reference validation, stable migration candidate initialization, and public default cutover**

Persist firms, inventories/reservations, orders/shipments/truck progress, gateway trade state, lifecycle counters, ID counters, and cadence state. Do not persist derived route caches or presentation state.

- [ ] **Step 4: Verify GREEN plus historical save suites**

Run:
`node --experimental-strip-types --test tests/save-v3.test.ts tests/save-v4.test.ts tests/save-v5.test.ts tests/save-v6.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/save/saveV6.ts src/save/save.ts tests/save-v6.test.ts
git commit -m "feat: add deterministic Save V6"
```

---

### Task 8: Economy/Freight presentation and inspection

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
- Consumes: immutable economy snapshot, firm/order/shipment/gateway getters, freight vehicle positions.
- Produces economy panel, inspectors, and overlay modes:
  `firm-health | jobs | production | shortages | freight-volume | freight-routes | logistics-delay | gateways | trade-flow`.

- [ ] **Step 1: Write failing presentation contract tests**

```ts
test('economy panel renders authoritative firm and freight metrics', () => {
  const html = renderEconomyPanel(makeEconomySnapshot());
  for (const label of ['Active firms', 'Industrial output', 'Retail sales', 'Input shortage', 'Average freight delay', 'Imports', 'Exports']) {
    assert.match(html, new RegExp(label));
  }
});

test('firm inspector exposes causal constraints and financial components', () => {
  const html = renderFirmInspector(makeDistressedFirmInspection());
  assert.match(html, /Input shortage/);
  assert.match(html, /Logistics cost/);
  assert.match(html, /Operating margin/);
  assert.match(html, /Cash health/);
});
```

- [ ] **Step 2: Verify RED**

Run: `node --experimental-strip-types --test tests/economy-presentation.test.ts`
Expected: FAIL because economy UI/rendering modules are absent.

- [ ] **Step 3: Implement panel, inspectors, authoritative truck rendering, and overlays**

Keep UI observational: no “spawn firm” or “create goods” controls. Color is not the sole encoding; overlays include intensity/labels/pattern or inspector values.

- [ ] **Step 4: Verify GREEN plus existing presentation tests**

Run:
`node --experimental-strip-types --test tests/economy-presentation.test.ts tests/presentation-contract.test.ts tests/transit-presentation.test.ts tests/service-presentation.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/EconomyPanel.ts src/rendering/EconomyOverlayLayer.ts src/rendering/FreightVehicleRenderer.ts src/app/GameApp.ts src/rendering/WorldRenderer.ts src/ui/Hud.ts src/ui/Inspector.ts src/ui/ToolController.ts src/styles.css tests/economy-presentation.test.ts
git commit -m "feat: add economy and freight presentation"
```

---

### Task 9: Phase 6 acceptance and performance suite

**Files:**
- Create: `tests/phase6-headless.test.ts`
- Modify as needed: focused Phase 6 systems only when acceptance exposes a causal gap.

**Interfaces:**
- Consumes all Phase 6 public APIs.
- Produces deterministic acceptance scenarios and representative performance diagnostics.

- [ ] **Step 1: Add acceptance tests for every spec chain**

Implement concrete scenarios covering:
1. firms replace raw jobs;
2. production requires inputs;
3. local supply can beat imports;
4. freight creates real congestion;
5. congestion harms firm economics;
6. better route/access improves logistics cost;
7. reduced truck capacity raises queues/shortages;
8. import/export conservation;
9. sustained deterministic formation/failure;
10. closed-firm cleanup;
11. Save V6 continuation;
12. V5 migration transparency.

Use assertions on authoritative values, not UI text.

- [ ] **Step 2: Run and verify RED where integration gaps remain**

Run: `node --experimental-strip-types --test tests/phase6-headless.test.ts`
Expected: any failures must correspond to an unimplemented causal requirement, not flaky timing.

- [ ] **Step 3: Make only the minimal production changes needed to close acceptance gaps**

Do not weaken assertions to fit implementation. Preserve deterministic stable ordering and conservation invariants.

- [ ] **Step 4: Add and run performance diagnostics**

The file must report representative timing for:
- 2,000 active establishments lifecycle/production evaluation;
- 10,000 freight order matches using indexed candidates;
- 5,000 active-economy ticks;
- route/cache reuse on stable freight OD pairs.

Run: `node --experimental-strip-types --test tests/phase6-headless.test.ts`
Expected: PASS with diagnostic timings printed and no hard cross-hardware microsecond thresholds.

- [ ] **Step 5: Commit**

```bash
git add tests/phase6-headless.test.ts src/simulation/economy src/simulation/core/SimulationCore.ts
git commit -m "test: add Phase 6 economic acceptance suite"
```

---

### Task 10: Browser smoke, docs, version, and final verification

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

**Interfaces:**
- Browser smoke must exercise real UI/state and verify V6 save/load restoration.

- [ ] **Step 1: Write Phase 6 smoke before switching the npm script**

Smoke scenario must:
- build boundary-connected roads plus residential/commercial/industrial zones;
- allow firms to form;
- verify economy panel metrics and at least one firm inspector;
- observe freight activity and a freight overlay;
- save V6;
- destructively modify road/economic topology;
- reload and verify exact serialized V6 restoration of firm/freight state.

- [ ] **Step 2: Run smoke and verify any RED condition is due to missing browser integration**

Run: `python tests/smoke/phase6_smoke.py`
Expected before final integration: FAIL at the first absent Phase 6 UI/save assertion.

- [ ] **Step 3: Update package/docs and any minimal smoke-facing integration**

Set package version to `0.6.0-metropolitan` and `test:smoke` to `python tests/smoke/phase6_smoke.py`. Document firm economy, freight, Save V6, balancing constants, deterministic acceptance, and known non-goals.

- [ ] **Step 4: Run complete verification**

Run:
```bash
npm test
npm run typecheck
npm run lint
npm run build
npm run test:smoke
git diff --check
grep -RInE 'TODO|TBD|FIXME|PLACEHOLDER|coming soon' src tests docs README.md package.json || true
```
Expected:
- every test passes;
- typecheck/lint/build pass;
- Phase 6 smoke passes;
- `git diff --check` emits nothing;
- placeholder scan has no Phase 6 unfinished markers.

- [ ] **Step 5: Commit verified Phase 6 checkpoint**

```bash
git add package.json README.md docs tests/smoke/phase6_smoke.py
git commit -m "feat: complete verified Phase 6 economy"
```

- [ ] **Step 6: Publish only after verification**

Fast-forward `metropolitan-era` to the verified Phase 6 commit, keep PR #2 draft/open, then verify GitHub Actions on the exact published SHA. Update the PR body with the Phase 6 checkpoint SHA/tree and CI result. Do not merge the PR.
