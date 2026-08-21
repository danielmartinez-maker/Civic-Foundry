import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { TerrainGrid, type TerrainCell } from '../src/world/terrain/TerrainGrid.ts';
import { RoadSystem } from '../src/world/roads/RoadSystem.ts';
import { TreasurySystem } from '../src/simulation/treasury/TreasurySystem.ts';
import { TransportationGraph } from '../src/simulation/traffic/TransportationGraph.ts';
import { PathfindingSystem } from '../src/simulation/traffic/PathfindingSystem.ts';
import { TransitNetworkSystem } from '../src/simulation/transit/TransitNetworkSystem.ts';
import { MobilityScheduler, type MobilityPersonTrip, type MobilitySnapshot } from '../src/simulation/mobility/MobilityScheduler.ts';
import type { TransitMode } from '../src/data/transit.ts';

function flatTerrain(width = 18, height = 6): TerrainGrid {
  const cells: TerrainCell[] = Array.from({ length: width * height }, () => ({ elevation: 0.5, water: false, buildable: true, biome: 'grass' as const }));
  return new TerrainGrid(width, height, cells);
}

type Corridor = Readonly<{
  graph: TransportationGraph;
  transit: TransitNetworkSystem;
  pathfinding: PathfindingSystem;
  lineId: string | null;
  startNodeId: string;
  endNodeId: string;
}>;

function corridor(options: Readonly<{ mode?: TransitMode; headway?: number; fare?: number; enabled?: boolean }> = {}): Corridor {
  const terrain = flatTerrain();
  const roads = new RoadSystem(terrain);
  const treasury = new TreasurySystem(2_000_000);
  assert.equal(roads.placePath(Array.from({ length: 14 }, (_, i) => ({ x: i + 2, y: 3 })), 'local', treasury).ok, true);
  const graph = new TransportationGraph();
  graph.rebuildIfNeeded(roads);
  const transit = new TransitNetworkSystem(terrain, roads);
  const mode = options.mode;
  let lineId: string | null = null;
  if (mode) {
    const type = mode === 'metro' ? 'metro_station' : 'surface_stop';
    const a = transit.placeStop(type, 3, 2, treasury).id!;
    const b = transit.placeStop(type, 14, 2, treasury).id!;
    lineId = transit.createLine(mode, `${mode}-corridor`);
    assert.equal(transit.setLineStops(lineId, [a, b]).ok, true);
    transit.setHeadway(lineId, options.headway ?? 20);
    transit.setFare(lineId, options.fare ?? 0);
    transit.setEnabled(lineId, options.enabled ?? true);
  }
  return { graph, transit, pathfinding: new PathfindingSystem(), lineId, startNodeId: 'n:3,3', endNodeId: 'n:14,3' };
}

function trip(index: number, tick: number, weight = 20): MobilityPersonTrip {
  return Object.freeze({
    id: `phase5-person:${index}`,
    sourceTripId: `phase5-road:${index}`,
    originBuildingId: 'origin',
    destinationBuildingId: 'destination',
    originRoadNodeId: 'n:3,3',
    destinationRoadNodeId: 'n:14,3',
    departureTick: tick,
    travelerWeight: weight,
    purpose: 'commute',
  });
}

function runCorridor(scenario: Corridor, options: Readonly<{ ticks: number; roadMultiplier: number; demandEvery?: number; demandWeight?: number; fleetLimit?: number }>): Readonly<{ snapshot: MobilitySnapshot; carWeight: number; waitingWeight: number; scheduler: MobilityScheduler }> {
  const scheduler = new MobilityScheduler();
  if (scenario.lineId && options.fleetLimit !== undefined) scheduler.operations.setFleetLimit(scenario.lineId, options.fleetLimit);
  let carWeight = 0;
  let nextTrip = 1;
  for (let tick = 0; tick <= options.ticks; tick++) {
    const demandEvery = options.demandEvery ?? 100;
    scheduler.tick({
      tick,
      roadGraph: scenario.graph,
      transit: scenario.transit,
      pathfinding: scenario.pathfinding,
      roadTravelTime: (edge) => edge.freeFlowTicks * options.roadMultiplier,
      costEpoch: 0,
      generateTrips: () => tick > 0 && tick % demandEvery === 0 ? [trip(nextTrip++, tick, options.demandWeight ?? 20)] : [],
      submitCarTrip: (_personTrip, weight) => { carWeight += weight; },
    });
  }
  return Object.freeze({ snapshot: scheduler.snapshot(), carWeight, waitingWeight: scheduler.passengers.totalWaitingWeight(), scheduler });
}

test('strong transit lowers weighted car traffic and improves person accessibility while poor transit does not falsely win', () => {
  const carOnly = runCorridor(corridor(), { ticks: 600, roadMultiplier: 4 });
  const strong = runCorridor(corridor({ mode: 'brt', headway: 20, fare: 0 }), { ticks: 600, roadMultiplier: 4, fleetLimit: 12 });
  const poor = runCorridor(corridor({ mode: 'bus', headway: 600, fare: 20 }), { ticks: 600, roadMultiplier: 1, fleetLimit: 1 });

  assert.ok(strong.carWeight < carOnly.carWeight, `${strong.carWeight} should be below ${carOnly.carWeight}`);
  assert.ok(strong.snapshot.personAccessibility > carOnly.snapshot.personAccessibility, `${strong.snapshot.personAccessibility} should exceed ${carOnly.snapshot.personAccessibility}`);
  assert.ok(strong.snapshot.transitModeShare > 0.5);
  assert.equal(poor.snapshot.carModeShare, 1);
  assert.equal(poor.snapshot.transitModeShare, 0);
  console.log('PHASE5_COMPARISON', JSON.stringify({ carOnly: { carWeight: carOnly.carWeight, accessibility: carOnly.snapshot.personAccessibility }, strong: { carWeight: strong.carWeight, accessibility: strong.snapshot.personAccessibility, transitShare: strong.snapshot.transitModeShare }, poor: { carWeight: poor.carWeight, accessibility: poor.snapshot.personAccessibility, transitShare: poor.snapshot.transitModeShare } }));
});

test('capacity reduction creates queues, raises experienced wait, and lowers transit attractiveness', () => {
  const highCapacity = runCorridor(corridor({ mode: 'brt', headway: 20, fare: 0 }), { ticks: 1_000, roadMultiplier: 4, demandEvery: 20, demandWeight: 100, fleetLimit: 24 });
  const lowCapacity = runCorridor(corridor({ mode: 'brt', headway: 20, fare: 0 }), { ticks: 1_000, roadMultiplier: 4, demandEvery: 20, demandWeight: 100, fleetLimit: 1 });

  assert.ok(lowCapacity.waitingWeight > highCapacity.waitingWeight, `${lowCapacity.waitingWeight} should exceed ${highCapacity.waitingWeight}`);
  assert.ok(lowCapacity.snapshot.meanWaitTicks > highCapacity.snapshot.meanWaitTicks, `${lowCapacity.snapshot.meanWaitTicks} should exceed ${highCapacity.snapshot.meanWaitTicks}`);
  assert.ok(lowCapacity.snapshot.transitModeShare < highCapacity.snapshot.transitModeShare, `${lowCapacity.snapshot.transitModeShare} should be below ${highCapacity.snapshot.transitModeShare}`);
  assert.ok(lowCapacity.snapshot.personAccessibility < highCapacity.snapshot.personAccessibility, `${lowCapacity.snapshot.personAccessibility} should be below ${highCapacity.snapshot.personAccessibility}`);
  console.log('PHASE5_CAPACITY', JSON.stringify({ high: { waiting: highCapacity.waitingWeight, wait: highCapacity.snapshot.meanWaitTicks, share: highCapacity.snapshot.transitModeShare, access: highCapacity.snapshot.personAccessibility }, low: { waiting: lowCapacity.waitingWeight, wait: lowCapacity.snapshot.meanWaitTicks, share: lowCapacity.snapshot.transitModeShare, access: lowCapacity.snapshot.personAccessibility } }));
});

test('10,000 stable mixed-mode journey plans reuse the cache above 95%', () => {
  const scenario = corridor({ mode: 'brt', headway: 20, fare: 0 });
  const scheduler = new MobilityScheduler();
  scheduler.tick({ tick: 0, roadGraph: scenario.graph, transit: scenario.transit, pathfinding: scenario.pathfinding, roadTravelTime: (edge) => edge.freeFlowTicks * 2, costEpoch: 0, generateTrips: () => [], submitCarTrip: () => {} });
  const before = performance.now();
  for (let i = 0; i < 10_000; i++) {
    const plan = scheduler.journeyPlanner.plan(scheduler.multimodalGraph, scenario.startNodeId, scenario.endNodeId, {
      mode: i % 2 === 0 ? 'transit' : 'car', transferPenaltyTicks: 20, fareWeightTicksPerCurrency: 4, costKey: 'phase5-stable',
    });
    assert.ok(plan);
  }
  const elapsedMs = performance.now() - before;
  const diagnostics = scheduler.journeyPlanner.diagnostics;
  const hitRatio = diagnostics.cacheHits / Math.max(1, diagnostics.requests);
  assert.ok(hitRatio > 0.95, `cache hit ratio ${hitRatio}`);
  assert.ok(Number.isFinite(elapsedMs));
  console.log('PHASE5_JOURNEY_BENCHMARK', JSON.stringify({ elapsedMs: Number(elapsedMs.toFixed(2)), requests: diagnostics.requests, hits: diagnostics.cacheHits, hitRatio }));
});

test('5,000 active-transit ticks remain finite with real vehicles, queues, and mode choice', () => {
  const scenario = corridor({ mode: 'brt', headway: 30, fare: 1 });
  const before = performance.now();
  const result = runCorridor(scenario, { ticks: 5_000, roadMultiplier: 3, demandEvery: 100, demandWeight: 30, fleetLimit: 8 });
  const elapsedMs = performance.now() - before;
  assert.ok(Number.isFinite(elapsedMs));
  assert.ok(Number.isFinite(result.snapshot.personAccessibility));
  assert.ok(Number.isFinite(result.snapshot.meanWaitTicks));
  assert.ok(scenario.lineId);
  assert.ok(result.scheduler.operations.snapshotLineWithVehicles(scenario.lineId!, result.scheduler.vehicles).dispatchedRuns > 0);
  assert.ok(result.scheduler.vehicles.activeCount() > 0);
  console.log('PHASE5_TICK_BENCHMARK', JSON.stringify({ elapsedMs: Number(elapsedMs.toFixed(2)), msPer1000Ticks: Number((elapsedMs / 5).toFixed(2)), activeTransitVehicles: result.scheduler.vehicles.activeCount(), waitingWeight: result.waitingWeight, transitShare: result.snapshot.transitModeShare, accessibility: result.snapshot.personAccessibility }));
});
