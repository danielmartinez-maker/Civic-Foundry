import test from 'node:test';
import assert from 'node:assert/strict';
import { LegacyV7EntityProjector, type LegacyV7EntitySource } from '../src/entities/LegacyV7EntityProjector.ts';
import { TerrainGrid, type TerrainCell } from '../src/world/terrain/TerrainGrid.ts';
import { TreasurySystem } from '../src/simulation/treasury/TreasurySystem.ts';
import { RoadSystem } from '../src/world/roads/RoadSystem.ts';
import { TransportationGraph } from '../src/simulation/traffic/TransportationGraph.ts';
import { PathfindingSystem } from '../src/simulation/traffic/PathfindingSystem.ts';
import { IntersectionSystem } from '../src/simulation/traffic/IntersectionSystem.ts';
import { TrafficSystem } from '../src/simulation/traffic/TrafficSystem.ts';
import type { TripRequest } from '../src/simulation/traffic/TripGenerationSystem.ts';

function flatTerrain(width = 20, height = 14): TerrainGrid {
  const cells: TerrainCell[] = Array.from({ length: width * height }, () => ({
    elevation: 0.5,
    water: false,
    buildable: true,
    biome: 'grass' as const,
  }));
  return new TerrainGrid(width, height, cells);
}

function trip(id: string): TripRequest {
  return {
    id,
    originBuildingId: 'home',
    destinationBuildingId: 'job',
    departureTick: 0,
    travelerWeight: 1,
    purpose: 'commute',
  };
}

function trafficProjectionSource(): LegacyV7EntitySource {
  return {
    lots: { entityRevision: 0, list: () => [] },
    buildings: { entityRevision: 0, list: () => [] },
    economyDomain: {
      firms: { entityRevision: 0, list: () => [] },
      freightVehicles: { entityRevision: 0, listVehicles: () => [] },
    },
    utilities: { entityRevision: 0, listFacilities: () => [] },
    services: { entityRevision: 0, listFacilities: () => [] },
    transit: { revision: 0, listStops: () => [], listLines: () => [] },
    traffic: {
      entityRevision: 1,
      activeVehicles: [{
        id: 'vehicle:1',
        tripId: 'trip:1',
        purpose: 'commute',
        travelerWeight: 1,
        originBuildingId: 'home',
        destinationBuildingId: 'job',
        edgeIds: ['edge:1'],
        currentEdgeIndex: 0,
        edgeProgressTicks: 0,
        departureTick: 10,
        accumulatedDelayTicks: 0,
        freeFlowTicks: 4,
        status: 'queued',
      }],
    },
    serviceVehicles: { entityRevision: 0, listVehicles: () => [] },
    incidents: { entityRevision: 0, listIncidents: () => [] },
  } as LegacyV7EntitySource;
}

test('traffic entity revision ignores queued or moving motion-state transitions', () => {
  const terrain = flatTerrain();
  const treasury = new TreasurySystem(100_000);
  const roads = new RoadSystem(terrain);
  roads.placePath([{ x: 2, y: 6 }, { x: 3, y: 6 }, { x: 4, y: 6 }, { x: 5, y: 6 }, { x: 6, y: 6 }], 'local', treasury);
  roads.placePath([{ x: 4, y: 5 }, { x: 4, y: 6 }, { x: 4, y: 7 }], 'local', treasury);
  const graph = new TransportationGraph();
  graph.rebuildIfNeeded(roads);
  const pathfinding = new PathfindingSystem();
  const intersections = new IntersectionSystem();
  const traffic = new TrafficSystem();
  const route = pathfinding.findRoute(graph, graph.findNodeAt(2, 6)!.id, graph.findNodeAt(6, 6)!.id)!;
  const vehicleId = traffic.submitTrip(trip('revision-status'), route, 0)!;
  const revisionAfterSubmit = traffic.entityRevision;

  for (let tick = 1; tick <= 100; tick++) {
    traffic.step(graph, intersections, tick);
    if (traffic.getVehicle(vehicleId)?.status === 'queued') break;
  }

  assert.equal(traffic.getVehicle(vehicleId)?.status, 'queued');
  assert.equal(
    traffic.entityRevision,
    revisionAfterSubmit,
    'motion-state changes do not alter projected entity identity or references',
  );
});

test('traffic projection excludes transient motion status from identity metadata', () => {
  const trafficPartition = new LegacyV7EntityProjector()
    .projectPartitions(trafficProjectionSource())
    .find((partition) => partition.id === 'traffic');
  assert.ok(trafficPartition);
  const entity = trafficPartition.projection.entities.find((item) => item.kind === 'traffic-vehicle');
  assert.ok(entity);
  assert.deepEqual(entity.metadata, { purpose: 'commute' });
});
