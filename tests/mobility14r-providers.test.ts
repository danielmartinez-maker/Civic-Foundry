import test from 'node:test';
import assert from 'node:assert/strict';
import { TerrainGrid } from '../src/world/terrain/TerrainGrid.ts';
import { RoadSystem } from '../src/world/roads/RoadSystem.ts';
import { TreasurySystem } from '../src/simulation/treasury/TreasurySystem.ts';
import { TransportationGraph } from '../src/simulation/traffic/TransportationGraph.ts';
import { PathfindingSystem } from '../src/simulation/traffic/PathfindingSystem.ts';
import { TransitNetworkSystem } from '../src/simulation/transit/TransitNetworkSystem.ts';
import { MultimodalRoutingGraph } from '../src/simulation/transit/MultimodalRoutingGraph.ts';
import { JourneyPlanner } from '../src/simulation/transit/JourneyPlanner.ts';
import { PassengerQueueSystem } from '../src/simulation/transit/PassengerQueueSystem.ts';
import { MobilityScheduler } from '../src/simulation/mobility/MobilityScheduler.ts';
import { listMobilityModes } from '../src/simulation/mobility/MobilityModeRegistry.ts';
import { LegacyCarMobilityProvider } from '../src/simulation/mobility/providers/LegacyCarMobilityProvider.ts';
import { LegacyTransitMobilityProvider } from '../src/simulation/mobility/providers/LegacyTransitMobilityProvider.ts';
import type { MobilityRuntimeContext } from '../src/simulation/mobility/MobilityProvider.ts';
import { mobilityCapabilities, mobilityRequest } from './support/mobility14rFixtures.ts';

function providerFixture() {
  const terrain = TerrainGrid.generate(12, 5, 44);
  const roads = new RoadSystem(terrain);
  const treasury = new TreasurySystem(1_000_000);
  roads.placePath(Array.from({ length: 10 }, (_, i) => ({ x: i + 1, y: 2 })), 'local', treasury);
  const roadGraph = new TransportationGraph();
  roadGraph.rebuildIfNeeded(roads);

  const transit = new TransitNetworkSystem(terrain, roads);
  const firstStop = transit.placeStop('surface_stop', 2, 1, treasury).id!;
  const secondStop = transit.placeStop('surface_stop', 8, 1, treasury).id!;
  const lineId = transit.createLine('bus', '14R Bus');
  assert.equal(transit.setLineStops(lineId, [firstStop, secondStop]).ok, true);
  transit.setHeadway(lineId, 20);
  transit.setFare(lineId, 2);
  transit.setEnabled(lineId, true);

  const pathfinding = new PathfindingSystem();
  const multimodalGraph = new MultimodalRoutingGraph();
  multimodalGraph.rebuild(roadGraph, transit, () => 30, 10);
  const journeyPlanner = new JourneyPlanner();
  const passengers = new PassengerQueueSystem();
  const submissions: { sourceTripId: string; travelerWeight: number; edgeIds: readonly string[] }[] = [];
  const context: MobilityRuntimeContext = {
    tick: 100,
    costEpoch: 10,
    roadGraph,
    transit,
    pathfinding,
    roadTravelTime: (edge) => edge.freeFlowTicks,
    multimodalGraph,
    journeyPlanner,
    passengers,
    crowdingPenaltyTicks: 0,
    submitLegacyCarTrip: (sourceTripId, travelerWeight, route) => submissions.push({ sourceTripId, travelerWeight, edgeIds: route.edgeIds }),
  };
  const request = mobilityRequest({
    originRoadNodeId: 'n:2,2',
    destinationRoadNodeId: 'n:8,2',
    travelerWeight: 7,
    costEpoch: 10,
  });
  return { terrain, roads, treasury, roadGraph, transit, firstStop, secondStop, lineId, context, request, submissions };
}

test('legacy car provider preserves route semantics and requires actual car capabilities', () => {
  const fixture = providerFixture();
  const provider = new LegacyCarMobilityProvider();
  const alternatives = provider.buildAlternatives(fixture.request, fixture.context);
  assert.equal(alternatives.length, 1);
  assert.equal(alternatives[0]?.mode, 'car');

  assert.deepEqual(provider.buildAlternatives(mobilityRequest({
    ...fixture.request,
    capabilities: mobilityCapabilities({ privateVehicleAccess: false }),
  }), fixture.context), []);
  assert.deepEqual(provider.buildAlternatives(mobilityRequest({
    ...fixture.request,
    capabilities: mobilityCapabilities({ licensedDriver: false }),
  }), fixture.context), []);

  assert.equal(provider.execute(alternatives[0]!, fixture.request, fixture.context), true);
  assert.equal(fixture.submissions.length, 1);
  assert.equal(fixture.submissions[0]?.sourceTripId, fixture.request.sourceTripId);
  assert.equal(fixture.submissions[0]?.travelerWeight, 7);
});

test('legacy car provider rejects stale road-revision execution instead of submitting an obsolete route', () => {
  const fixture = providerFixture();
  const provider = new LegacyCarMobilityProvider();
  const alternative = provider.buildAlternatives(fixture.request, fixture.context)[0]!;
  fixture.roads.placePath([{ x: 11, y: 2 }], 'local', fixture.treasury);
  fixture.roadGraph.rebuildIfNeeded(fixture.roads);
  assert.equal(provider.execute(alternative, fixture.request, fixture.context), false);
  assert.equal(fixture.submissions.length, 0);
});

test('legacy transit provider exposes the actual canonical bus mode and queues through existing passenger authority', () => {
  const fixture = providerFixture();
  const provider = new LegacyTransitMobilityProvider();
  assert.deepEqual(provider.modes, ['bus', 'brt', 'tram', 'metro']);

  const alternatives = provider.buildAlternatives(fixture.request, fixture.context);
  assert.equal(alternatives.length, 1);
  assert.equal(alternatives[0]?.mode, 'bus');
  assert.equal(fixture.context.passengers.totalWaitingWeight(), 0);

  assert.equal(provider.execute(alternatives[0]!, fixture.request, fixture.context), true);
  assert.equal(fixture.context.passengers.totalWaitingWeight(), 7);
  const queued = fixture.context.passengers.snapshot().queues;
  assert.equal(queued.length, 1);
  assert.equal(queued[0]?.lineId, fixture.lineId);
  assert.equal(queued[0]?.stopId, fixture.firstStop);
});

test('future canonical modes stay registered but unavailable until a live provider owns them', () => {
  const canonical = listMobilityModes().map((mode) => mode.id);
  assert.ok(canonical.includes('ferry'));
  assert.ok(canonical.includes('trolleybus'));
  assert.ok(canonical.includes('regional_rail'));

  const scheduler = new MobilityScheduler();
  const ownedModes = scheduler.providers.list().flatMap((provider) => [...provider.modes]).sort();
  assert.deepEqual(ownedModes, ['brt', 'bus', 'car', 'metro', 'tram']);

  const fixture = providerFixture();
  fixture.transit.setEnabled(fixture.lineId, false);
  fixture.context.multimodalGraph.rebuild(fixture.roadGraph, fixture.transit, () => 30, fixture.context.costEpoch);
  const noCar = mobilityRequest({
    ...fixture.request,
    capabilities: mobilityCapabilities({ privateVehicleAccess: false, licensedDriver: false }),
  });
  const alternatives = scheduler.providers.list().flatMap((provider) => provider.buildAlternatives(noCar, fixture.context));
  assert.deepEqual(alternatives, []);
  assert.deepEqual(scheduler.orchestrator.resolveAndExecute(noCar, fixture.context), { outcome: 'unmet', alternative: null });
});
