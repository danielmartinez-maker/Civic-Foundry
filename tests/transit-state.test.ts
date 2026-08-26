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
import { TransitOperationsSystem } from '../src/simulation/transit/TransitOperationsSystem.ts';
import { MobilityScheduler, type MobilityPersonTrip } from '../src/simulation/mobility/MobilityScheduler.ts';

function setup() {
  const terrain = TerrainGrid.generate(12, 5, 44);
  const roads = new RoadSystem(terrain);
  const treasury = new TreasurySystem(1_000_000);
  roads.placePath(Array.from({ length: 10 }, (_, i) => ({ x: i + 1, y: 2 })), 'local', treasury);
  const graph = new TransportationGraph(); graph.rebuildIfNeeded(roads);
  const transit = new TransitNetworkSystem(terrain, roads);
  const a = transit.placeStop('surface_stop', 2, 1, treasury).id!;
  const b = transit.placeStop('surface_stop', 8, 1, treasury).id!;
  const line = transit.createLine('bus', 'State Line');
  assert.equal(transit.setLineStops(line, [a, b]).ok, true);
  transit.setHeadway(line, 20); transit.setFare(line, 2); transit.setEnabled(line, true);
  return { terrain, roads, treasury, graph, transit, a, b, line, path: new PathfindingSystem() };
}

function cohort(id: string, lineId: string, from: string, to: string, weight: number): TransitPassengerCohort {
  return { id, personTripId: id, travelerWeight: weight, lineId, directionKey: 'forward', boardingStopId: from, alightingStopId: to, destinationRoadNodeId: 'n:9,2', enqueuedTick: 0, transferLegs: [] };
}

test('active transit vehicles snapshot and restore exactly', () => {
  const s = setup();
  const queues = new PassengerQueueSystem();
  const vehicles = new TransitVehicleSystem();
  const operations = new TransitOperationsSystem();
  operations.setFleetLimit(s.line, 1);
  queues.enqueue(s.a, s.line, 'forward', cohort('p1', s.line, s.a, s.b, 30));
  for (let tick = 0; tick < 18; tick++) operations.step(tick, s.transit, vehicles, queues, s.graph, s.path, (edge) => edge.freeFlowTicks * 1.5);

  const vehicleState = vehicles.snapshotState();
  const operationState = operations.snapshotState();
  const cloneVehicles = new TransitVehicleSystem();
  const cloneOperations = new TransitOperationsSystem();
  cloneVehicles.restoreState(vehicleState);
  cloneOperations.restoreState(operationState);

  assert.deepEqual(cloneVehicles.snapshotState(), vehicleState);
  assert.deepEqual(cloneOperations.snapshotState(), operationState);
  assert.deepEqual(cloneVehicles.listVehicles(), vehicles.listVehicles());
});

test('restored operations continue deterministically from active run', () => {
  const s = setup();
  const q1 = new PassengerQueueSystem(), q2 = new PassengerQueueSystem();
  const v1 = new TransitVehicleSystem(), v2 = new TransitVehicleSystem();
  const o1 = new TransitOperationsSystem(), o2 = new TransitOperationsSystem();
  o1.setFleetLimit(s.line, 1);
  q1.enqueue(s.a, s.line, 'forward', cohort('p1', s.line, s.a, s.b, 30));
  for (let tick = 0; tick < 18; tick++) o1.step(tick, s.transit, v1, q1, s.graph, s.path, (edge) => edge.freeFlowTicks * 1.5);
  q2.restore(q1.snapshot()); v2.restoreState(v1.snapshotState()); o2.restoreState(o1.snapshotState());
  for (let tick = 18; tick < 80; tick++) {
    o1.step(tick, s.transit, v1, q1, s.graph, s.path, (edge) => edge.freeFlowTicks * 1.5);
    o2.step(tick, s.transit, v2, q2, s.graph, s.path, (edge) => edge.freeFlowTicks * 1.5);
  }
  assert.deepEqual(v2.snapshotState(), v1.snapshotState());
  assert.deepEqual(o2.snapshotState(), o1.snapshotState());
  assert.deepEqual(q2.snapshot(), q1.snapshot());
});

test('mobility scheduler preserves decision window and fiscal cursors across restore', () => {
  const s = setup();
  const mobility = new MobilityScheduler();
  mobility.operations.setFleetLimit(s.line, 1);
  const trip: MobilityPersonTrip = { id: 'person:t1', sourceTripId: 't1', originBuildingId: 'a', destinationBuildingId: 'b', originRoadNodeId: 'n:2,2', destinationRoadNodeId: 'n:8,2', departureTick: 20, travelerWeight: 12, purpose: 'commute' };
  for (let tick = 0; tick <= 30; tick++) mobility.tick({ tick, roadGraph: s.graph, transit: s.transit, pathfinding: s.path, roadTravelTime: (edge) => edge.freeFlowTicks * 4, generateTrips: () => tick === 20 ? [trip] : [], submitCarTrip: () => {} });
  mobility.consumeFiscalDelta();
  const state = mobility.snapshotState();
  assert.ok(state.decisions.length > 0);
  assert.deepEqual(Object.keys(state.decisions[0]!).sort(), [
    'chosenCost', 'expectedWaitTicks', 'mode', 'purpose', 'travelerWeight',
  ]);
  const clone = new MobilityScheduler();
  clone.restoreState(state);
  assert.deepEqual(clone.snapshotState(), state);
  assert.deepEqual(clone.snapshot(), mobility.snapshot());
  assert.deepEqual(clone.consumeFiscalDelta(), { operatingCost: 0, fareRevenue: 0 });
});
