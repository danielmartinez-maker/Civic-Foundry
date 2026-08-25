import test from 'node:test';
import assert from 'node:assert/strict';
import { SimulationCore } from '../src/simulation/core/SimulationCore.ts';
import { TerrainGrid, type TerrainCell } from '../src/world/terrain/TerrainGrid.ts';
import { hydrateCore, serializeCore } from '../src/save/save.ts';

function flatTerrain(width = 30, height = 18): TerrainGrid {
  const cells: TerrainCell[] = Array.from({ length: width * height }, () => ({
    elevation: 0.5,
    water: false,
    buildable: true,
    biome: 'grass' as const,
  }));
  return new TerrainGrid(width, height, cells);
}

function buildHousingCity(): SimulationCore {
  const core = new SimulationCore({ terrain: flatTerrain(), startingFunds: 1_000_000, seed: 7441 });
  assert.equal(core.buildRoad(Array.from({ length: 22 }, (_, index) => ({ x: index + 3, y: 10 })), 'collector').ok, true);
  const residentialCells = Array.from({ length: 6 }, (_, index) => ({ x: index + 5, y: 9 }));
  assert.equal(core.paintZone(residentialCells, 'residential').painted, residentialCells.length);
  assert.equal(core.placeUtility('power', 6, 11).ok, true);
  assert.equal(core.placeUtility('water', 10, 11).ok, true);

  const lots = core.lots.list()
    .filter((lot) => lot.zone === 'residential')
    .sort((a, b) => a.id.localeCompare(b.id));
  assert.equal(lots.length, 6);
  core.buildings.restore(lots.map((lot) => ({
    id: `building:${lot.id}`,
    lotId: lot.id,
    x: lot.x,
    y: lot.y,
    zone: 'residential' as const,
    definitionId: 'residential_cottage',
    status: 'occupied' as const,
    constructionStartedTick: 0,
    completionTick: 0,
  })));
  core.population.restore(45);
  core.setDevelopmentPolicy({
    affordableHousingShare: 0.15,
    redevelopmentAffordableFloor: 0.90,
    lowerIncomeRelocationProtection: 0.95,
  });
  core.step(10);
  return core;
}

function assertHousingInvariants(core: SimulationCore): void {
  const state = core.housingRelocation.snapshotState();
  const snapshot = core.housingRelocationSnapshot;
  const represented = state.allocations.reduce((sum, item) => sum + item.residents, 0)
    + state.unplaced.reduce((sum, item) => sum + item.residents, 0);
  assert.ok(Math.abs(represented - core.population.population) < 1e-6, 'authoritative relocation state must conserve population');
  assert.ok(Math.abs(snapshot.housedResidents + snapshot.unplacedResidents - snapshot.population) < 1e-6, 'housing snapshot must conserve population');
  assert.ok(Math.abs(snapshot.renterResidents + snapshot.ownerResidents - snapshot.housedResidents) < 1e-6, 'tenure totals must equal housed residents');

  for (const value of [snapshot.renterShare, snapshot.ownerShare, snapshot.rentalVacancyRate, snapshot.ownershipVacancyRate]) {
    assert.ok(Number.isFinite(value));
    assert.ok(value >= 0 && value <= 1);
  }

  const capacityByOption = new Map<string, number>(
    core.housingTenureSnapshot.options.map((option) => [`${option.buildingId}|${option.tenure}`, option.capacity]),
  );
  const assignedByOption = new Map<string, number>();
  for (const allocation of state.allocations) {
    assert.ok(Number.isFinite(allocation.residents) && allocation.residents >= 0);
    const key = `${allocation.buildingId}|${allocation.tenure}`;
    assert.ok(capacityByOption.has(key), `allocation must reference a current tenure option: ${key}`);
    assignedByOption.set(key, (assignedByOption.get(key) ?? 0) + allocation.residents);
  }
  for (const [key, residents] of assignedByOption) {
    assert.ok(residents <= (capacityByOption.get(key) ?? 0) + 1e-6, `allocation must not exceed tenure capacity: ${key}`);
  }
  for (const unplaced of state.unplaced) {
    assert.ok(Number.isFinite(unplaced.residents) && unplaced.residents >= 0);
  }

  for (const building of Object.values(snapshot.byBuilding)) {
    assert.ok(Math.abs(building.renterResidents + building.ownerResidents - building.assignedResidents) < 1e-6);
    assert.ok(Number.isFinite(building.rentalOccupancyRate) && building.rentalOccupancyRate >= 0 && building.rentalOccupancyRate <= 1);
    assert.ok(Number.isFinite(building.ownershipOccupancyRate) && building.ownershipOccupancyRate >= 0 && building.ownershipOccupancyRate <= 1);
  }

  for (const total of Object.values(snapshot.totals)) {
    assert.ok(Number.isFinite(total) && total >= 0);
  }
}

test('Phase 7 tenure and relocation remain conserved and bounded through long-run city cycles, displacement, policy changes, and current Save V8', () => {
  const core = buildHousingCity();
  assertHousingInvariants(core);

  let displaced = false;
  for (let cycle = 0; cycle < 30; cycle++) {
    if (cycle === 5) {
      const target = Object.values(core.housingRelocationSnapshot.byBuilding)
        .filter((item) => item.assignedResidents > 0)
        .sort((a, b) => a.buildingId.localeCompare(b.buildingId))[0];
      assert.ok(target, 'expected an occupied residential cohort before forced displacement');
      const building = core.buildings.getById(target.buildingId);
      assert.ok(building);
      const result = core.bulldozeAt(building.x, building.y);
      assert.deepEqual(result, { ok: true, kind: 'building' });
      assert.ok(core.housingRelocationSnapshot.displacedResidentsThisCycle > 0);
      displaced = true;
      assertHousingInvariants(core);
    }

    if (cycle === 15) {
      core.setDevelopmentPolicy({
        affordableHousingShare: 0.25,
        lowerIncomeRelocationProtection: 1,
      });
      assertHousingInvariants(core);
    }

    core.step(50);
    assertHousingInvariants(core);
  }
  assert.equal(displaced, true);

  const save = serializeCore(core);
  assert.equal(save.saveVersion, 8);
  assert.deepEqual(save.housingState, core.housingRelocation.snapshotState());
  const loaded = hydrateCore(structuredClone(save));
  assertHousingInvariants(loaded);
  assert.deepEqual(serializeCore(loaded), save);
});
