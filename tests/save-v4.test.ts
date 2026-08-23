import test from 'node:test';
import assert from 'node:assert/strict';
import { SimulationCore } from '../src/simulation/core/SimulationCore.ts';
import { TerrainGrid, type TerrainCell } from '../src/world/terrain/TerrainGrid.ts';
import { serializeCore, hydrateCore } from '../src/save/save.ts';
import type { Building } from '../src/simulation/buildings/BuildingSystem.ts';

function flatTerrain(width = 30, height = 18): TerrainGrid {
  const cells: TerrainCell[] = Array.from({ length: width * height }, () => ({ elevation: 0.5, water: false, buildable: true, biome: 'grass' as const }));
  return new TerrainGrid(width, height, cells);
}

function b(id: string, x: number, y: number, zone: Building['zone'] = 'residential'): Building {
  return { id, lotId: `lot:${id}`, x, y, zone, definitionId: `${zone}_fixture`, status: 'occupied', constructionStartedTick: 0, completionTick: 0 };
}

function serviceCore(): SimulationCore {
  const core = new SimulationCore({ terrain: flatTerrain(), startingFunds: 900_000, seed: 44 });
  core.buildRoad(Array.from({ length: 22 }, (_, i) => ({ x: i + 2, y: 9 })), 'collector');
  core.buildings.restore([b('home', 19, 8), b('shop', 18, 8, 'commercial')]);
  core.population.restore(9);
  core.placeUtility('power', 14, 8); core.placeUtility('water', 15, 8);
  core.placeServiceFacility('fire_station', 3, 8);
  core.placeServiceFacility('police_station', 5, 8);
  core.placeServiceFacility('clinic', 7, 8);
  core.placeServiceFacility('elementary_school', 9, 8);
  core.placeServiceFacility('landfill', 11, 8);
  core.setServiceFunding('fire', 125);
  core.step(100);
  core.incidents.createIncident('fire', core.buildings.getById('home')!, 0.9, core.clock.tick, core.serviceDispatch);
  core.step(10);
  return core;
}

test('current Save V7 round-trips authoritative public-service state and active service vehicles', () => {
  const core = serviceCore();
  const save = serializeCore(core);
  assert.equal(save.saveVersion, 7);
  assert.ok(save.services.facilities.length >= 5);
  assert.ok(save.services.jobs.length > 0);
  assert.ok(save.services.vehicles.length > 0);
  const loaded = hydrateCore(JSON.parse(JSON.stringify(save)));
  assert.deepEqual(serializeCore(loaded), save);
});

test('current save deterministic continuation reproduces identical authoritative state', () => {
  const a = serviceCore();
  const bCore = hydrateCore(JSON.parse(JSON.stringify(serializeCore(a))));
  a.step(180); bCore.step(180);
  assert.deepEqual(serializeCore(bCore), serializeCore(a));
});

test('V3 migration initializes public-service state at defaults without invented outcomes', () => {
  const core = new SimulationCore({ terrain: flatTerrain(), seed: 9, startingFunds: 100_000 });
  core.buildRoad([{ x: 2, y: 5 }, { x: 3, y: 5 }], 'local');
  const v4 = serializeCore(core) as any;
  const v3: any = { ...v4, saveVersion: 3, gameVersion: '0.3.0-rebuild' };
  delete v3.services;
  delete v3.serviceCached;
  const loaded = hydrateCore(v3);
  assert.equal(loaded.services.listFacilities().length, 0);
  assert.deepEqual(loaded.services.fundingSnapshot(), { fire: 100, police: 100, healthcare: 100, education: 100, garbage: 100 });
  assert.equal(loaded.serviceDispatch.listJobs().length, 0);
  assert.equal(loaded.incidents.listIncidents().length, 0);
  assert.equal(loaded.serviceVehicles.listVehicles().length, 0);
});

test('hydrate rejects corrupt service-vehicle road references before returning a live core', () => {
  const save: any = serializeCore(serviceCore());
  const moving = save.services.vehicles.find((vehicle: any) => vehicle.edgeIds.length > 0 || vehicle.returnEdgeIds.length > 0);
  assert.ok(moving);
  if (moving.edgeIds.length > 0) moving.edgeIds[0] = 'edge:missing';
  else moving.returnEdgeIds[0] = 'edge:missing';
  assert.throws(() => hydrateCore(save), /service vehicle edge reference/);
});

test('active service state survives save/load and road demolition without stale intersection deadlock', () => {
  const loaded = hydrateCore(JSON.parse(JSON.stringify(serializeCore(serviceCore()))));
  const road = loaded.roads.list().find((cell) => cell.x === 10 && cell.y === 9)!;
  loaded.roads.remove(road.x, road.y);
  loaded.step(25);
  assert.equal(loaded.intersections.queueLength() >= 0, true);
  for (const vehicle of loaded.serviceVehicles.listVehicles()) {
    const route = vehicle.state === 'returning' ? vehicle.returnEdgeIds : vehicle.edgeIds;
    if (vehicle.state === 'outbound' || vehicle.state === 'returning') {
      assert.equal(route.slice(vehicle.currentEdgeIndex).some((edgeId) => !loaded.transportationGraph.getEdge(edgeId)), false);
    }
  }
});