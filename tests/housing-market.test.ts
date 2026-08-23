import test from 'node:test';
import assert from 'node:assert/strict';
import { HousingMarketSystem } from '../src/simulation/housing/HousingMarketSystem.ts';
import type { Building } from '../src/simulation/buildings/BuildingSystem.ts';
import type { Firm } from '../src/simulation/economy/FirmSystem.ts';

function building(id: string, rentalUnits: number, forSaleUnits: number): Building {
  return {
    id,
    lotId: id.replace('building:', ''),
    x: Number(id.charCodeAt(id.length - 1) % 10),
    y: 4,
    zone: 'residential',
    definitionId: 'residential_rowhouse',
    status: 'occupied',
    constructionStartedTick: 0,
    completionTick: 0,
    housingProduct: rentalUnits > 0 && forSaleUnits > 0 ? 'mixed' : rentalUnits > 0 ? 'rental' : 'for_sale',
    rentalProductUnits: rentalUnits,
    forSaleProductUnits: forSaleUnits,
  };
}

function firm(id: string, filledJobs: number): Firm {
  return {
    id,
    buildingId: `job-building:${id}`,
    zone: 'commercial',
    archetype: 'retail_local',
    status: 'operating',
    jobCapacity: Math.max(20, filledJobs),
    filledJobs,
    vacancies: 0,
    productivity: 1,
    cashHealth: 0.8,
    consecutiveLossCycles: 0,
    consecutiveRecoveryCycles: 0,
    formationTick: 0,
    lastOperatingMargin: 0,
  };
}

const conditions = (ids: readonly string[]) => Object.fromEntries(ids.map((id) => [id, {
  quality: 0.75,
  accessibility: 0.8,
  services: 0.75,
  neighborhood: 0.75,
  habitability: 1,
}]));

test('persistent vacancy cuts rent while qualified excess demand raises it within normal upward inertia', () => {
  const vacant = new HousingMarketSystem();
  const v = building('building:v', 12, 0);
  vacant.tick({ tick: 100, buildings: [v], firms: [], marketInterestRate: 0.05, employmentVacancies: 0, conditionsByBuilding: conditions([v.id]) });
  assert.equal(vacant.supply.get(v.id)!.askingRent, 480 * 0.94);

  const tight = new HousingMarketSystem();
  const t = building('building:t', 12, 0);
  tight.supply.syncBuildings([t], 0);
  tight.supply.occupy(t.id, 'renter', 12, 24);
  tight.households.create({
    weight: 4, householdSize: 2, workers: 1, tenure: 'seeking', buildingId: null,
    unitRequirement: 1, vehicleAccess: false, liquidSavings: 10_000,
  }, 0);
  tight.tick({ tick: 100, buildings: [t], firms: [firm('firm:t', 4)], marketInterestRate: 0.05, employmentVacancies: 0, conditionsByBuilding: conditions([t.id]) });
  const askingRent = tight.supply.get(t.id)!.askingRent;
  assert.ok(askingRent > 480);
  assert.ok(askingRent <= 480 * 1.03 + 1e-9);
});

test('market clears only available units and deterministically splits a larger cohort', () => {
  const market = new HousingMarketSystem();
  const home = building('building:p', 3, 9);
  market.households.create({
    weight: 10, householdSize: 2, workers: 1, tenure: 'seeking', buildingId: null,
    unitRequirement: 1, vehicleAccess: false, liquidSavings: 5_000,
  }, 0);
  market.tick({ tick: 100, buildings: [home], firms: [firm('firm:p', 10)], marketInterestRate: 0.05, employmentVacancies: 0, conditionsByBuilding: conditions([home.id]) });

  const housed = market.households.list().filter((h) => h.buildingId === home.id);
  const searching = market.households.list().filter((h) => h.searchState === 'searching');
  assert.equal(housed.reduce((sum, h) => sum + h.weight, 0), 3);
  assert.equal(searching.reduce((sum, h) => sum + h.weight, 0), 7);
  assert.equal(market.supply.get(home.id)!.vacantRentableUnits, 0);
  assert.equal(market.population(), 20);
});

test('migration requires viable housing and unhoused households leave only after three market cycles', () => {
  const noHousing = new HousingMarketSystem();
  noHousing.tick({ tick: 100, buildings: [], firms: [firm('firm:j', 1)], marketInterestRate: 0.05, employmentVacancies: 5, conditionsByBuilding: {} });
  assert.equal(noHousing.population(), 0);
  assert.equal(noHousing.snapshot().inMigrationHouseholds, 0);

  const withHousing = new HousingMarketSystem();
  const home = building('building:m', 12, 0);
  withHousing.tick({ tick: 100, buildings: [home], firms: [firm('firm:m', 1)], marketInterestRate: 0.05, employmentVacancies: 4, conditionsByBuilding: conditions([home.id]) });
  assert.ok(withHousing.population() > 0);
  assert.ok(withHousing.snapshot().inMigrationHouseholds > 0);

  const out = new HousingMarketSystem();
  const displaced = out.households.create({
    weight: 2, householdSize: 2, workers: 0, tenure: 'seeking', buildingId: null,
    unitRequirement: 1, vehicleAccess: false, liquidSavings: 0,
  }, 0);
  out.households.markDisplaced(displaced.id, 'redevelopment');
  const emptyInput = (tick: number) => ({ tick, buildings: [] as Building[], firms: [] as Firm[], marketInterestRate: 0.05, employmentVacancies: 0, conditionsByBuilding: {} });
  out.tick(emptyInput(100));
  out.tick(emptyInput(200));
  assert.equal(out.households.representedHouseholds(), 2);
  out.tick(emptyInput(300));
  assert.equal(out.households.representedHouseholds(), 0);
  assert.equal(out.snapshot().outMigrationHouseholds, 2);
});

test('housing market state restores and continues deterministically', () => {
  const a = new HousingMarketSystem();
  const home = building('building:s', 12, 0);
  const input = (tick: number) => ({ tick, buildings: [home], firms: [firm('firm:s', 4)], marketInterestRate: 0.05, employmentVacancies: 2, conditionsByBuilding: conditions([home.id]) });
  a.tick(input(100));
  const state = a.snapshotState();
  const b = new HousingMarketSystem();
  b.restoreState(structuredClone(state));
  assert.deepEqual(b.snapshotState(), state);
  a.tick(input(200));
  b.tick(input(200));
  assert.deepEqual(b.snapshotState(), a.snapshotState());
});
