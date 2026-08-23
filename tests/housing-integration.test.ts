import test from 'node:test';
import assert from 'node:assert/strict';
import { PopulationSystem } from '../src/simulation/population/PopulationSystem.ts';
import { TripGenerationSystem } from '../src/simulation/traffic/TripGenerationSystem.ts';
import { HousingMarketSystem } from '../src/simulation/housing/HousingMarketSystem.ts';
import { SimulationCore } from '../src/simulation/core/SimulationCore.ts';
import { TerrainGrid, type TerrainCell } from '../src/world/terrain/TerrainGrid.ts';
import type { Building } from '../src/simulation/buildings/BuildingSystem.ts';
import type { Firm } from '../src/simulation/economy/FirmSystem.ts';

function flat(width = 20, height = 12): TerrainGrid {
  const cells: TerrainCell[] = Array.from({ length: width * height }, () => ({ elevation: 0.5, water: false, buildable: true, biome: 'grass' as const }));
  return new TerrainGrid(width, height, cells);
}

function occupied(id: string, zone: Building['zone']): Building {
  return {
    id, lotId: id.replace('building:', ''), x: id.endsWith('a') ? 2 : id.endsWith('b') ? 4 : 8, y: 4,
    zone, definitionId: zone === 'residential' ? 'residential_cottage' : 'commercial_shop',
    status: 'occupied', constructionStartedTick: 0, completionTick: 0,
  };
}

function operatingFirm(): Firm {
  return {
    id: 'firm:job', buildingId: 'building:job', zone: 'commercial', archetype: 'retail_local', status: 'operating',
    jobCapacity: 20, filledJobs: 10, vacancies: 10, productivity: 1, cashHealth: 0.8,
    consecutiveLossCycles: 0, consecutiveRecoveryCycles: 0, formationTick: 0, lastOperatingMargin: 0,
  };
}

test('PopulationSystem supports authoritative housing synchronization', () => {
  const population = new PopulationSystem();
  population.update(10, 1);
  assert.equal(population.population, 2);
  population.sync(7);
  assert.equal(population.population, 7);
  assert.throws(() => population.sync(-1), /population sync/i);
});

test('explicit household trip demand preserves origin weights and exact employer destination', () => {
  const generator = new TripGenerationSystem(17);
  const buildings = [occupied('building:a', 'residential'), occupied('building:b', 'residential'), occupied('building:job', 'commercial')];
  const trips = generator.generateHouseholdDemand(100, buildings, [
    { originBuildingId: 'building:a', destinationBuildingId: 'building:job', commuterWeight: 8, shoppingWeight: 20 },
    { originBuildingId: 'building:b', destinationBuildingId: 'building:job', commuterWeight: 2, shoppingWeight: 5 },
  ]);
  const commutes = trips.filter((trip) => trip.purpose === 'commute');
  assert.deepEqual(commutes.map((trip) => [trip.originBuildingId, trip.destinationBuildingId, trip.travelerWeight]), [
    ['building:a', 'building:job', 8],
    ['building:b', 'building:job', 2],
  ]);
  const shopping = trips.filter((trip) => trip.purpose === 'shopping');
  assert.deepEqual(shopping.map((trip) => [trip.originBuildingId, trip.travelerWeight]), [
    ['building:a', 20],
    ['building:b', 5],
  ]);
});

test('housing travel demand follows actual home assignment and linked firm building', () => {
  const housing = new HousingMarketSystem();
  housing.households.create({
    weight: 4, householdSize: 2, workers: 1, employedWorkers: 1, employerFirmIds: ['firm:job'], grossIncome: 3_000,
    tenure: 'renter', buildingId: 'building:a', unitRequirement: 1, vehicleAccess: false, liquidSavings: 2_000, housingCost: 600,
  }, 0);
  const [demand] = housing.travelDemand([operatingFirm()]);
  assert.equal(demand!.originBuildingId, 'building:a');
  assert.equal(demand!.destinationBuildingId, 'building:job');
  assert.equal(demand!.commuterWeight, 4);
  assert.equal(demand!.shoppingWeight, 2);
});

test('SimulationCore synchronizes compatibility population from housing state on housing cadence', () => {
  const core = new SimulationCore({ terrain: flat(), seed: 31 });
  core.housing.households.create({
    weight: 2, householdSize: 2, workers: 0, tenure: 'seeking', buildingId: null,
    unitRequirement: 1, vehicleAccess: false, liquidSavings: 0,
  }, 0);
  core.step(10);
  assert.equal(core.housing.population(), 4);
  assert.equal(core.population.population, 4);
});
