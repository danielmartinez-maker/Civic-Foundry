import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { TerrainGrid } from '../src/world/terrain/TerrainGrid.ts';
import { RoadSystem } from '../src/world/roads/RoadSystem.ts';
import { TreasurySystem } from '../src/simulation/treasury/TreasurySystem.ts';
import { TransportationGraph } from '../src/simulation/traffic/TransportationGraph.ts';
import { PathfindingSystem } from '../src/simulation/traffic/PathfindingSystem.ts';
import { TransitNetworkSystem } from '../src/simulation/transit/TransitNetworkSystem.ts';
import { MultimodalRoutingGraph } from '../src/simulation/transit/MultimodalRoutingGraph.ts';
import { JourneyPlanner } from '../src/simulation/transit/JourneyPlanner.ts';
import { MobilityProviderRegistry, type MobilityAlternativeProvider, type MobilityRuntimeContext } from '../src/simulation/mobility/MobilityProvider.ts';
import { MobilityOrchestrator } from '../src/simulation/mobility/MobilityOrchestrator.ts';
import type { MobilityModeId } from '../src/simulation/mobility/MobilityTypes.ts';
import { mobilityAlternative, mobilityRequest } from './support/mobility14rFixtures.ts';

type ProviderCounter = { builds: number; executes: number };

function countedProvider(
  id: string,
  priority: number,
  mode: MobilityModeId,
  cost: number,
  counter: ProviderCounter,
): MobilityAlternativeProvider {
  return {
    id,
    priority,
    modes: Object.freeze([mode]),
    buildAlternatives: (request) => {
      counter.builds++;
      return Object.freeze([mobilityAlternative(id, priority, mode, `${id}:${request.id}`, cost)]);
    },
    execute: () => {
      counter.executes++;
      return true;
    },
  };
}

const EMPTY_RUNTIME = Object.freeze({}) as MobilityRuntimeContext;

test('10,000 mobility requests scale with the two registered providers and stable real routes reuse caches', () => {
  const car = { builds: 0, executes: 0 };
  const transit = { builds: 0, executes: 0 };
  const registry = new MobilityProviderRegistry([
    countedProvider('bench-car', 10, 'car', 40, car),
    countedProvider('bench-transit', 20, 'bus', 60, transit),
  ]);
  const orchestrator = new MobilityOrchestrator(registry);
  assert.equal(registry.list().length, 2);

  const started = performance.now();
  for (let i = 0; i < 10_000; i++) {
    const outcome = orchestrator.resolveAndExecute(mobilityRequest({
      id: `journey:${i}`,
      sourceTripId: `trip:${i}`,
    }), EMPTY_RUNTIME);
    assert.equal(outcome.outcome, 'car');
  }
  const elapsedMs = performance.now() - started;
  assert.equal(car.builds, 10_000);
  assert.equal(transit.builds, 10_000);
  assert.equal(car.executes, 10_000);
  assert.equal(transit.executes, 0);

  const terrain = TerrainGrid.generate(12, 5, 77);
  const roads = new RoadSystem(terrain);
  const treasury = new TreasurySystem(1_000_000);
  roads.placePath(Array.from({ length: 10 }, (_, i) => ({ x: i + 1, y: 2 })), 'local', treasury);
  const roadGraph = new TransportationGraph();
  roadGraph.rebuildIfNeeded(roads);
  const transitNetwork = new TransitNetworkSystem(terrain, roads);
  const firstStop = transitNetwork.placeStop('surface_stop', 2, 1, treasury).id!;
  const secondStop = transitNetwork.placeStop('surface_stop', 8, 1, treasury).id!;
  const lineId = transitNetwork.createLine('bus', 'Performance Bus');
  assert.equal(transitNetwork.setLineStops(lineId, [firstStop, secondStop]).ok, true);
  transitNetwork.setHeadway(lineId, 20);
  transitNetwork.setFare(lineId, 1);
  transitNetwork.setEnabled(lineId, true);

  const pathfinding = new PathfindingSystem();
  const roadCost = (edge: { freeFlowTicks: number }): number => edge.freeFlowTicks;
  const firstRoute = pathfinding.findRoute(roadGraph, 'n:2,2', 'n:8,2', {
    edgeCost: roadCost,
    costKey: '14r-perf-car',
  });
  assert.ok(firstRoute);
  const carHitsBefore = pathfinding.diagnostics.cacheHits;
  assert.deepEqual(pathfinding.findRoute(roadGraph, 'n:2,2', 'n:8,2', {
    edgeCost: roadCost,
    costKey: '14r-perf-car',
  }), firstRoute);
  assert.ok(pathfinding.diagnostics.cacheHits > carHitsBefore);

  const multimodal = new MultimodalRoutingGraph();
  multimodal.rebuild(roadGraph, transitNetwork, () => 30, 10);
  const planner = new JourneyPlanner();
  const options = {
    mode: 'transit' as const,
    transferPenaltyTicks: 20,
    fareWeightTicksPerCurrency: 4,
    costKey: '14r-perf-transit',
  };
  const firstPlan = planner.plan(multimodal, 'n:2,2', 'n:8,2', options);
  assert.ok(firstPlan);
  const transitHitsBefore = planner.diagnostics.cacheHits;
  assert.deepEqual(planner.plan(multimodal, 'n:2,2', 'n:8,2', options), firstPlan);
  assert.ok(planner.diagnostics.cacheHits > transitHitsBefore);

  console.log('PHASE14R_A_MOBILITY_10K_BENCHMARK', JSON.stringify({
    requests: 10_000,
    elapsedMs: Number(elapsedMs.toFixed(2)),
    carCacheHits: pathfinding.diagnostics.cacheHits,
    transitCacheHits: planner.diagnostics.cacheHits,
  }));
});
