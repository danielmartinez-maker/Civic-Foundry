import test from 'node:test';
import assert from 'node:assert/strict';
import { TerrainGrid } from '../src/world/terrain/TerrainGrid.ts';
import { RoadSystem } from '../src/world/roads/RoadSystem.ts';
import { TreasurySystem } from '../src/simulation/treasury/TreasurySystem.ts';
import { TransportationGraph } from '../src/simulation/traffic/TransportationGraph.ts';
import { PathfindingSystem } from '../src/simulation/traffic/PathfindingSystem.ts';
import { TransitNetworkSystem } from '../src/simulation/transit/TransitNetworkSystem.ts';
import { PassengerQueueSystem, type TransitPassengerCohort } from '../src/simulation/transit/PassengerQueueSystem.ts';
import { TransitVehicleSystem } from '../src/simulation/transit/TransitVehicleSystem.ts';

function passenger(lineId: string, from: string, to: string): TransitPassengerCohort {
  return {
    id: 'cohort:recovery',
    personTripId: 'trip:recovery',
    travelerWeight: 7,
    lineId,
    directionKey: 'forward',
    boardingStopId: from,
    alightingStopId: to,
    destinationRoadNodeId: 'n:9,2',
    enqueuedTick: 0,
    transferLegs: [],
  };
}

test('failed transit runs requeue onboard passenger cohorts without loss or duplication', () => {
  const terrain = TerrainGrid.generate(12, 5, 4);
  const roads = new RoadSystem(terrain);
  const treasury = new TreasurySystem(1_000_000);
  roads.placePath(Array.from({ length: 10 }, (_, index) => ({ x: index + 1, y: 2 })), 'local', treasury);
  const graph = new TransportationGraph();
  graph.rebuildIfNeeded(roads);
  const network = new TransitNetworkSystem(terrain, roads);
  const firstStop = network.placeStop('surface_stop', 2, 1, treasury).id!;
  const secondStop = network.placeStop('surface_stop', 8, 1, treasury).id!;
  const lineId = network.createLine('bus', 'Recovery line');
  assert.equal(network.setLineStops(lineId, [firstStop, secondStop]).ok, true);
  network.setEnabled(lineId, true);

  const queues = new PassengerQueueSystem();
  assert.equal(queues.enqueue(firstStop, lineId, 'forward', passenger(lineId, firstStop, secondStop)), true);
  const vehicles = new TransitVehicleSystem();
  const line = network.getLine(lineId)!;
  const vehicleId = vehicles.dispatchRun(line, 0)!;
  const pathfinding = new PathfindingSystem();

  vehicles.step(0, network, queues, graph, pathfinding, (edge) => edge.freeFlowTicks);
  assert.equal(queues.waitingWeight(firstStop, lineId, 'forward'), 0);
  assert.equal(vehicles.getVehicle(vehicleId)!.onboard.reduce((sum, cohort) => sum + cohort.travelerWeight, 0), 7);

  network.setEnabled(lineId, false);
  const failureEvents = vehicles.step(1, network, queues, graph, pathfinding, (edge) => edge.freeFlowTicks);

  assert.equal(vehicles.getVehicle(vehicleId), undefined);
  assert.equal(queues.waitingWeight(firstStop, lineId, 'forward'), 7);
  const recovered = queues.peek(firstStop, lineId, 'forward');
  assert.equal(recovered.length, 1);
  assert.equal(recovered[0]!.id, 'cohort:recovery');
  assert.equal(recovered[0]!.travelerWeight, 7);
  assert.equal(failureEvents.filter((event) => event.type === 'run_failed').length, 1);
  assert.equal(failureEvents.find((event) => event.type === 'run_failed')!.weight, 7);
});
