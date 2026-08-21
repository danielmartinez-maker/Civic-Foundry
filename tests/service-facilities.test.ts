import test from 'node:test';
import assert from 'node:assert/strict';
import { TerrainGrid, type TerrainCell } from '../src/world/terrain/TerrainGrid.ts';
import { TreasurySystem } from '../src/simulation/treasury/TreasurySystem.ts';
import { RoadSystem } from '../src/world/roads/RoadSystem.ts';
import { SERVICE_DEFINITIONS } from '../src/data/services.ts';
import { ServiceFacilitySystem } from '../src/simulation/services/ServiceFacilitySystem.ts';
import { SimulationCore } from '../src/simulation/core/SimulationCore.ts';

function flatTerrain(width = 18, height = 12): TerrainGrid {
  const cells: TerrainCell[] = Array.from({ length: width * height }, () => ({ elevation: 0.5, water: false, buildable: true, biome: 'grass' as const }));
  return new TerrainGrid(width, height, cells);
}

function fixture() {
  const terrain = flatTerrain();
  const treasury = new TreasurySystem(200_000);
  const roads = new RoadSystem(terrain);
  roads.placePath(Array.from({ length: 12 }, (_, i) => ({ x: i + 2, y: 6 })), 'collector', treasury);
  const occupied = new Set<string>();
  const services = new ServiceFacilitySystem(terrain, roads, (x, y) => occupied.has(`${x},${y}`));
  return { terrain, treasury, roads, occupied, services };
}

test('service definitions are data-driven and include all Phase 4 facility families', () => {
  assert.equal(SERVICE_DEFINITIONS.fire_station.department, 'fire');
  assert.equal(SERVICE_DEFINITIONS.police_station.vehicleType, 'patrol_car');
  assert.equal(SERVICE_DEFINITIONS.clinic.vehicleType, 'ambulance');
  assert.equal(SERVICE_DEFINITIONS.elementary_school.studentCapacity, 120);
  assert.equal(SERVICE_DEFINITIONS.landfill.vehicleType, 'garbage_truck');
  assert.equal(SERVICE_DEFINITIONS.recycling_center.department, 'garbage');
  assert.ok(Object.isFrozen(SERVICE_DEFINITIONS));
  assert.ok(Object.isFrozen(SERVICE_DEFINITIONS.fire_station));
});

test('service facility placement validates road access, occupancy, funds, and deterministic IDs atomically', () => {
  const { services, treasury, occupied } = fixture();
  const starting = treasury.balance;
  const noRoad = services.placeFacility('fire_station', 1, 1, treasury);
  assert.equal(noRoad.ok, false);
  assert.match(noRoad.reason ?? '', /road access/i);
  assert.equal(treasury.balance, starting);

  occupied.add('4,5');
  const blocked = services.placeFacility('fire_station', 4, 5, treasury);
  assert.equal(blocked.ok, false);
  assert.match(blocked.reason ?? '', /occupied/i);
  assert.equal(treasury.balance, starting);

  const first = services.placeFacility('fire_station', 5, 5, treasury);
  const second = services.placeFacility('police_station', 7, 5, treasury);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.deepEqual(services.listFacilities().map((facility) => facility.id), ['service:1', 'service:2']);
  assert.equal(treasury.balance, starting - SERVICE_DEFINITIONS.fire_station.constructionCost - SERVICE_DEFINITIONS.police_station.constructionCost);

  const duplicate = services.placeFacility('clinic', 5, 5, treasury);
  assert.equal(duplicate.ok, false);
  assert.equal(services.listFacilities().length, 2);
});

test('department budgets clamp to 50..150 and affect staffing, capacity, vehicles, and operating cost', () => {
  const { services, treasury } = fixture();
  assert.equal(services.placeFacility('fire_station', 5, 5, treasury).ok, true);
  assert.equal(services.getFunding('fire'), 100);
  assert.equal(services.fundingEffectiveness('fire'), 1);
  assert.equal(services.activeVehicleCount('service:1'), 2);

  services.setFunding('fire', 10);
  assert.equal(services.getFunding('fire'), 50);
  assert.equal(services.fundingEffectiveness('fire'), 0.675);
  assert.equal(services.activeVehicleCount('service:1'), 1);
  assert.ok(services.effectiveStaffing('service:1') < SERVICE_DEFINITIONS.fire_station.staffingRequired);

  services.setFunding('fire', 200);
  assert.equal(services.getFunding('fire'), 150);
  assert.equal(services.fundingEffectiveness('fire'), 1.25);
  assert.ok(services.effectiveCapacity('service:1') > SERVICE_DEFINITIONS.fire_station.baseCapacity);
  assert.equal(services.operatingCostByDepartment().fire, SERVICE_DEFINITIONS.fire_station.monthlyOperatingCost * 1.5);
});

test('SimulationCore exposes public-service placement and department funding without bypassing treasury', () => {
  const core = new SimulationCore({ terrain: flatTerrain(), startingFunds: 250_000, seed: 91 });
  assert.equal(core.buildRoad(Array.from({ length: 10 }, (_, i) => ({ x: i + 3, y: 6 })), 'collector').ok, true);
  const before = core.treasury.balance;
  const placed = core.placeServiceFacility('clinic', 6, 5);
  assert.equal(placed.ok, true);
  assert.equal(core.services.listFacilities()[0]?.type, 'clinic');
  assert.equal(core.treasury.balance, before - SERVICE_DEFINITIONS.clinic.constructionCost);
  core.setServiceFunding('healthcare', 125);
  assert.equal(core.services.getFunding('healthcare'), 125);
});
