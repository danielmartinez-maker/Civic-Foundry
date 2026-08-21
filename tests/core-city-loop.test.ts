import test from 'node:test';
import assert from 'node:assert/strict';
import { EmploymentSystem } from '../src/simulation/employment/EmploymentSystem.ts';
import { TaxSystem } from '../src/simulation/tax/TaxSystem.ts';
import { DemandSystem } from '../src/simulation/demand/DemandSystem.ts';
import { UtilitySystem } from '../src/simulation/utilities/UtilitySystem.ts';
import { GarbageSystem } from '../src/simulation/garbage/GarbageSystem.ts';
import { EconomySystem } from '../src/simulation/economy/EconomySystem.ts';
import { TerrainGrid, type TerrainCell } from '../src/world/terrain/TerrainGrid.ts';
import { TreasurySystem } from '../src/simulation/treasury/TreasurySystem.ts';
import { RoadSystem } from '../src/world/roads/RoadSystem.ts';
import type { Building } from '../src/simulation/buildings/BuildingSystem.ts';

function flatTerrain(width = 16, height = 10): TerrainGrid {
  const cells: TerrainCell[] = Array.from({ length: width * height }, () => ({ elevation: 0.5, water: false, buildable: true, biome: 'grass' as const }));
  return new TerrainGrid(width, height, cells);
}

function building(id: string, x: number, y: number, zone: Building['zone']): Building {
  return { id, lotId: `lot:${id}`, x, y, zone, definitionId: `${zone}_fixture`, status: 'occupied', constructionStartedTick: 0, completionTick: 0 };
}

test('employment derives workforce, employed workers, unemployment, and vacancies', () => {
  const system = new EmploymentSystem();
  assert.deepEqual(system.evaluate(20, 8), { workforce: 10, totalJobs: 8, employed: 8, unemployed: 2, vacancies: 0, unemploymentRate: 0.2 });
  assert.deepEqual(system.evaluate(10, 20), { workforce: 5, totalJobs: 20, employed: 5, unemployed: 0, vacancies: 15, unemploymentRate: 0 });
});

test('tax system clamps rates and derives revenue from occupied building tax bases', () => {
  const taxes = new TaxSystem();
  taxes.setRate('residential', 0.5);
  assert.equal(taxes.getRate('residential'), 0.25);
  taxes.setRate('commercial', 0.12);
  const revenue = taxes.calculateRevenue([building('r', 2, 2, 'residential'), building('c', 3, 2, 'commercial')]);
  assert.equal(revenue.residential, 30);
  assert.equal(revenue.commercial, 26.4);
  assert.equal(revenue.total, 56.4);
});

test('utility service is zero without capacity and full when connected capacity is sufficient', () => {
  const terrain = flatTerrain();
  const treasury = new TreasurySystem(100_000);
  const roads = new RoadSystem(terrain);
  roads.placePath(Array.from({ length: 10 }, (_, i) => ({ x: i + 2, y: 5 })), 'local', treasury);
  const utilities = new UtilitySystem(terrain, roads);
  const buildings = [building('r', 4, 4, 'residential'), building('c', 5, 4, 'commercial')];
  const empty = utilities.evaluate(buildings);
  assert.equal(empty.power.serviceRatio, 0);
  assert.equal(empty.water.serviceRatio, 0);
  assert.equal(utilities.placeFacility('power', 3, 6, treasury).ok, true);
  assert.equal(utilities.placeFacility('water', 6, 6, treasury).ok, true);
  const served = utilities.evaluate(buildings);
  assert.equal(served.power.serviceRatio, 1);
  assert.equal(served.water.serviceRatio, 1);
});

test('garbage backlog grows without landfill and clears with connected processing capacity', () => {
  const terrain = flatTerrain();
  const treasury = new TreasurySystem(100_000);
  const roads = new RoadSystem(terrain);
  roads.placePath(Array.from({ length: 10 }, (_, i) => ({ x: i + 2, y: 5 })), 'local', treasury);
  const utilities = new UtilitySystem(terrain, roads);
  const garbage = new GarbageSystem();
  const buildings = [building('r', 4, 4, 'residential')];
  const first = garbage.evaluate(buildings, roads, utilities.listFacilities());
  assert.equal(first.generated, 2);
  assert.equal(first.processed, 0);
  assert.equal(first.backlog, 2);
  utilities.placeFacility('landfill', 8, 6, treasury);
  const second = garbage.evaluate(buildings, roads, utilities.listFacilities());
  assert.equal(second.serviceRatio, 1);
  assert.equal(second.backlog, 0);
});

test('demand responds to housing/jobs/services/taxes rather than arbitrary values', () => {
  const demand = new DemandSystem();
  const healthy = demand.evaluate({ population: 10, housingCapacity: 10, workforce: 5, employed: 5, totalJobs: 8, powerRatio: 1, waterRatio: 1, garbageRatio: 1, taxRates: { residential: 0.1, commercial: 0.1, industrial: 0.1 }, trafficJobAccessibility: 1, trafficCommercialAccessibility: 1 });
  const failing = demand.evaluate({ population: 10, housingCapacity: 20, workforce: 5, employed: 1, totalJobs: 1, powerRatio: 0, waterRatio: 0, garbageRatio: 0, taxRates: { residential: 0.25, commercial: 0.25, industrial: 0.25 }, trafficJobAccessibility: 1, trafficCommercialAccessibility: 1 });
  assert.ok(healthy.residential > failing.residential);
  assert.ok(healthy.commercial > failing.commercial);
  assert.ok(healthy.industrial > failing.industrial);
  for (const value of Object.values(healthy)) assert.ok(value >= -1 && value <= 1);
});

test('economy settles taxes and operating costs without making treasury negative', () => {
  const treasury = new TreasurySystem(50);
  const economy = new EconomySystem();
  const settlement = economy.settle(treasury, { total: 30, residential: 10, commercial: 10, industrial: 10 }, 120);
  assert.equal(settlement.taxRevenue, 30);
  assert.equal(settlement.paidOperatingCost, 80);
  assert.equal(settlement.unpaidOperatingCost, 40);
  assert.equal(treasury.balance, 0);
});

import { SimulationCore } from '../src/simulation/core/SimulationCore.ts';

function buildManagedCore(withUtilities: boolean): SimulationCore {
  const core = new SimulationCore({ terrain: flatTerrain(20, 12), startingFunds: 150_000, seed: 17 });
  core.buildRoad(Array.from({ length: 14 }, (_, i) => ({ x: i + 2, y: 6 })), 'local');
  core.paintZone([{ x: 3, y: 5 }, { x: 4, y: 5 }, { x: 5, y: 5 }], 'residential');
  core.paintZone([{ x: 7, y: 5 }, { x: 8, y: 5 }], 'commercial');
  core.paintZone([{ x: 10, y: 5 }, { x: 11, y: 5 }], 'industrial');
  if (withUtilities) {
    assert.equal(core.placeUtility('power', 4, 7).ok, true);
    assert.equal(core.placeUtility('water', 8, 7).ok, true);
    assert.equal(core.placeUtility('landfill', 12, 7).ok, true);
  }
  return core;
}

test('SimulationCore city grows with managed services and stalls without them', () => {
  const managed = buildManagedCore(true);
  const unmanaged = buildManagedCore(false);
  managed.step(1200);
  unmanaged.step(1200);
  assert.ok(managed.population.population > 0);
  assert.equal(managed.utilitySnapshot.power.serviceRatio, 1);
  assert.equal(managed.utilitySnapshot.water.serviceRatio, 1);
  assert.equal(managed.garbageSnapshot.serviceRatio, 1);
  assert.equal(unmanaged.population.population, 0);
  assert.equal(unmanaged.utilitySnapshot.power.serviceRatio, 0);
  assert.equal(unmanaged.utilitySnapshot.water.serviceRatio, 0);
  assert.ok(unmanaged.garbageSnapshot.backlog > 0);
});
