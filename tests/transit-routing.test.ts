import test from 'node:test';
import assert from 'node:assert/strict';
import { TerrainGrid, type TerrainCell } from '../src/world/terrain/TerrainGrid.ts';
import { TreasurySystem } from '../src/simulation/treasury/TreasurySystem.ts';
import { RoadSystem } from '../src/world/roads/RoadSystem.ts';
import { TransportationGraph } from '../src/simulation/traffic/TransportationGraph.ts';
import { TransitNetworkSystem } from '../src/simulation/transit/TransitNetworkSystem.ts';
import { MultimodalRoutingGraph } from '../src/simulation/transit/MultimodalRoutingGraph.ts';
import { JourneyPlanner } from '../src/simulation/transit/JourneyPlanner.ts';

function terrain(width = 14, height = 8): TerrainGrid {
  const cells: TerrainCell[] = Array.from({ length: width * height }, () => ({ elevation: 0.5, water: false, buildable: true, biome: 'grass' }));
  return new TerrainGrid(width, height, cells);
}
function corridor() {
  const map = terrain(); const treasury = new TreasurySystem(500_000); const roads = new RoadSystem(map);
  roads.placePath(Array.from({ length: 12 }, (_, i) => ({ x: i + 1, y: 4 })), 'collector', treasury);
  const roadGraph = new TransportationGraph(); roadGraph.rebuildIfNeeded(roads);
  return { map, treasury, roads, roadGraph, transit: new TransitNetworkSystem(map, roads) };
}
function stop(transit: TransitNetworkSystem, treasury: TreasurySystem, x: number, type: 'surface_stop' | 'metro_station' = 'surface_stop') { return transit.placeStop(type, x, 3, treasury).id!; }

test('direct transit journey exposes walking, waiting, ride, fare, and deterministic legs', () => {
  const { treasury, roadGraph, transit } = corridor(); const a = stop(transit, treasury, 2); const b = stop(transit, treasury, 10);
  const line = transit.createLine('bus', 'Fast 1'); transit.setLineStops(line, [a, b]); transit.setHeadway(line, 20); transit.setFare(line, 2); transit.setEnabled(line, true);
  const graph = new MultimodalRoutingGraph(); graph.rebuild(roadGraph, transit, () => 28);
  const plan = new JourneyPlanner().plan(graph, 'n:2,4', 'n:10,4', { mode: 'transit', fareWeightTicksPerCurrency: 4 });
  assert.ok(plan); assert.equal(plan!.boardings, 1); assert.equal(plan!.transfers, 0); assert.equal(plan!.fare, 2); assert.equal(plan!.expectedWaitTicks, 10);
  assert.ok(plan!.legs.some((leg) => leg.kind === 'ride' && leg.lineId === line)); assert.ok(plan!.totalGeneralizedCost > plan!.inVehicleTicks);
});

test('a two-line journey counts one transfer and applies a transfer penalty', () => {
  const { treasury, roadGraph, transit } = corridor(); const a = stop(transit, treasury, 2); const mid = stop(transit, treasury, 6); const b = stop(transit, treasury, 10);
  const l1 = transit.createLine('bus', 'A'); const l2 = transit.createLine('bus', 'B');
  transit.setLineStops(l1, [a, mid]); transit.setHeadway(l1, 20); transit.setFare(l1, 0); transit.setEnabled(l1, true);
  transit.setLineStops(l2, [mid, b]); transit.setHeadway(l2, 20); transit.setFare(l2, 0); transit.setEnabled(l2, true);
  const graph = new MultimodalRoutingGraph(); graph.rebuild(roadGraph, transit, () => 15);
  const plan = new JourneyPlanner().plan(graph, 'n:2,4', 'n:10,4', { mode: 'transit', transferPenaltyTicks: 25 });
  assert.ok(plan); assert.equal(plan!.boardings, 2); assert.equal(plan!.transfers, 1); assert.equal(plan!.transferPenaltyTicks, 25);
});

test('disconnected stops provide no transit journey', () => {
  const { map, treasury, roads, roadGraph, transit } = corridor(); const otherTreasury = new TreasurySystem(100_000);
  roads.placePath([{ x: 1, y: 6 }, { x: 2, y: 6 }], 'local', otherTreasury); roadGraph.rebuildIfNeeded(roads);
  const a = transit.placeStop('surface_stop', 2, 3, treasury).id!; const b = transit.placeStop('surface_stop', 2, 5, treasury).id!;
  const line = transit.createLine('bus', 'Disconnected'); transit.setLineStops(line, [a, b]); transit.setEnabled(line, true);
  const graph = new MultimodalRoutingGraph(); graph.rebuild(roadGraph, transit, () => 20);
  assert.equal(new JourneyPlanner().plan(graph, 'n:10,4', 'n:2,6', { mode: 'transit' }), null); void map;
});

test('equal-cost alternatives tie-break deterministically by edge and line ID', () => {
  const { treasury, roadGraph, transit } = corridor(); const a = stop(transit, treasury, 2); const b = stop(transit, treasury, 10);
  const first = transit.createLine('bus', 'First'); const second = transit.createLine('bus', 'Second');
  for (const line of [first, second]) { transit.setLineStops(line, [a, b]); transit.setHeadway(line, 20); transit.setFare(line, 0); transit.setEnabled(line, true); }
  const graph = new MultimodalRoutingGraph(); graph.rebuild(roadGraph, transit, () => 20);
  const plan = new JourneyPlanner().plan(graph, 'n:2,4', 'n:10,4', { mode: 'transit' }); assert.ok(plan);
  assert.equal(plan!.legs.find((leg) => leg.kind === 'ride')?.lineId, first);
});

test('route cache hits on stable topology and invalidates after transit revision changes', () => {
  const { treasury, roadGraph, transit } = corridor(); const a = stop(transit, treasury, 2); const b = stop(transit, treasury, 10);
  const line = transit.createLine('bus', 'Cache'); transit.setLineStops(line, [a, b]); transit.setEnabled(line, true);
  const graph = new MultimodalRoutingGraph(); graph.rebuild(roadGraph, transit, () => 20); const planner = new JourneyPlanner();
  assert.ok(planner.plan(graph, 'n:2,4', 'n:10,4', { mode: 'transit' })); assert.ok(planner.plan(graph, 'n:2,4', 'n:10,4', { mode: 'transit' })); assert.equal(planner.diagnostics.cacheHits, 1);
  transit.setHeadway(line, 180); assert.equal(graph.rebuild(roadGraph, transit, () => 20), true); assert.ok(planner.plan(graph, 'n:2,4', 'n:10,4', { mode: 'transit' })); assert.equal(planner.diagnostics.cacheMisses, 2);
});

test('planner chooses the lower generalized-cost transit alternative', () => {
  const { treasury, roadGraph, transit } = corridor(); const a = stop(transit, treasury, 2); const b = stop(transit, treasury, 10);
  const frequent = transit.createLine('bus', 'Frequent'); const slow = transit.createLine('bus', 'Slow');
  transit.setLineStops(frequent, [a, b]); transit.setHeadway(frequent, 20); transit.setFare(frequent, 2); transit.setEnabled(frequent, true);
  transit.setLineStops(slow, [a, b]); transit.setHeadway(slow, 200); transit.setFare(slow, 0); transit.setEnabled(slow, true);
  const graph = new MultimodalRoutingGraph(); graph.rebuild(roadGraph, transit, (lineId) => lineId === frequent ? 30 : 35);
  const plan = new JourneyPlanner().plan(graph, 'n:2,4', 'n:10,4', { mode: 'transit', fareWeightTicksPerCurrency: 4 }); assert.ok(plan);
  assert.equal(plan!.legs.find((leg) => leg.kind === 'ride')?.lineId, frequent);
});
