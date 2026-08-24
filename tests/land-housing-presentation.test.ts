import test from 'node:test';
import assert from 'node:assert/strict';
import { SimulationCore } from '../src/simulation/core/SimulationCore.ts';
import { TerrainGrid, type TerrainCell } from '../src/world/terrain/TerrainGrid.ts';
import { LandHousingPanel } from '../src/ui/LandHousingPanel.ts';
import { inspectCell } from '../src/ui/Inspector.ts';
import { mapLandHousingOverlay, type LandHousingOverlayMode } from '../src/rendering/LandHousingOverlayLayer.ts';
import type { LandHousingMarketSnapshot } from '../src/simulation/development/LandHousingMarketSystem.ts';
import type { HousingChoiceSnapshot } from '../src/simulation/housing/HousingChoiceSystem.ts';
import type { RedevelopmentPressureSnapshot } from '../src/simulation/development/RedevelopmentPressureSystem.ts';
import type { RedevelopmentExecutionSnapshot } from '../src/simulation/development/RedevelopmentExecutionSystem.ts';

function flatTerrain(width = 20, height = 12): TerrainGrid {
  const cells: TerrainCell[] = Array.from({ length: width * height }, () => ({
    elevation: 0.5,
    water: false,
    buildable: true,
    biome: 'grass' as const,
  }));
  return new TerrainGrid(width, height, cells);
}

function housingCore(buildingCount = 2, population = 16): SimulationCore {
  const core = new SimulationCore({ terrain: flatTerrain(), startingFunds: 300_000, seed: 81 });
  assert.equal(core.buildRoad(Array.from({ length: 14 }, (_, i) => ({ x: i + 2, y: 6 })), 'local').ok, true);
  const zoneCells = Array.from({ length: buildingCount }, (_, i) => ({ x: i + 3, y: 5 }));
  assert.equal(core.paintZone(zoneCells, 'residential').painted, buildingCount);
  assert.equal(core.placeUtility('power', 4, 7).ok, true);
  assert.equal(core.placeUtility('water', 8, 7).ok, true);
  const lots = core.lots.list().filter((lot) => lot.zone === 'residential').sort((a, b) => a.id.localeCompare(b.id));
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
  core.population.restore(population);
  core.step(10);
  return core;
}

function sampleMarket(): LandHousingMarketSnapshot {
  return {
    zones: {
      residential: { zone: 'residential', marketPressure: 0.92, rentIndex: 1.28, vacancyRate: 0.06, landValueIndex: 1.31 },
      commercial: { zone: 'commercial', marketPressure: 0.64, rentIndex: 1.08, vacancyRate: 0.12, landValueIndex: 1.11 },
      industrial: { zone: 'industrial', marketPressure: 0.71, rentIndex: 1.14, vacancyRate: 0.10, landValueIndex: 1.18 },
    },
    housingPressure: 0.92,
    housingRentIndex: 1.28,
    housingVacancyRate: 0.06,
  };
}

function sampleHousing(): HousingChoiceSnapshot {
  const lower = { band: 'lower' as const, targetResidents: 45, assignedResidents: 38, unplacedResidents: 7, averageRentBurden: 0.41, costBurdenedResidents: 24 };
  const middle = { band: 'middle' as const, targetResidents: 40, assignedResidents: 40, unplacedResidents: 0, averageRentBurden: 0.31, costBurdenedResidents: 11 };
  const upper = { band: 'upper' as const, targetResidents: 15, assignedResidents: 15, unplacedResidents: 0, averageRentBurden: 0.22, costBurdenedResidents: 0 };
  return {
    population: 100,
    physicalCapacity: 118,
    effectiveAffordableCapacity: 91,
    housedResidents: 93,
    unplacedResidents: 7,
    affordabilityIndex: 0.77,
    costBurdenedResidents: 35,
    costBurdenShare: 35 / 93,
    byBand: { lower, middle, upper },
    byBuilding: {},
  };
}

function samplePressure(): RedevelopmentPressureSnapshot {
  return {
    parcels: [{
      buildingId: 'building:lot:1',
      lotId: 'lot:1',
      existingDefinitionId: 'residential_cottage',
      bestReplacementDefinitionId: 'residential_apartments',
      currentUseValue: 50_000,
      demolitionCost: 4_000,
      displacementCost: 2_000,
      netRedevelopmentValue: 18_000,
      pressure: 0.36,
    }],
    highPressureCount: 1,
    averagePressure: 0.36,
  };
}

function sampleExecution(): RedevelopmentExecutionSnapshot {
  return {
    opportunities: [],
    decisions: [{ lotId: 'lot:1', buildingId: 'building:lot:1', definitionId: 'residential_apartments', pressure: 0.36, reason: 'active-commitment' }],
    remainingPhysicalCapacity: 118,
    remainingEffectiveAffordableCapacity: 91,
  };
}

test('land and housing panel exposes market, affordability, income-band, and redevelopment diagnostics', () => {
  const html = new LandHousingPanel().render(sampleMarket(), sampleHousing(), samplePressure(), sampleExecution());
  for (const label of [
    'Residential market', 'Commercial market', 'Industrial market', 'Rent index', 'Vacancy', 'Land value',
    'Physical capacity', 'Effective affordable capacity', 'Affordability', 'Cost burden', 'Unplaced residents',
    'Lower income', 'Middle income', 'Upper income', 'High-pressure parcels', 'Active commitment',
  ]) assert.match(html, new RegExp(label, 'i'));
});

test('affordability and occupancy overlays map authoritative housing allocation deterministically', () => {
  const core = housingCore();
  const modes: LandHousingOverlayMode[] = ['affordability', 'occupancy'];
  for (const mode of modes) {
    const mapped = mapLandHousingOverlay(core, mode);
    assert.equal(mapped.mode, mode);
    assert.ok(mapped.legend.length > 0);
    assert.equal(mapped.cells.length, 2);
    assert.deepEqual(mapped.cells.map((cell) => cell.buildingId), [...mapped.cells.map((cell) => cell.buildingId)].sort());
    for (const cell of mapped.cells) {
      const allocation = core.housingChoiceSnapshot.byBuilding[cell.buildingId];
      assert.ok(allocation);
      assert.equal(cell.value, mode === 'affordability' ? allocation.affordabilityScore : allocation.occupancyRate);
      assert.match(cell.label, /%/);
    }
  }
});

test('redevelopment pressure overlay exposes deterministic planner reasons', () => {
  const core = housingCore();
  const mapped = mapLandHousingOverlay(core, 'redevelopment-pressure');
  assert.equal(mapped.mode, 'redevelopment-pressure');
  assert.ok(mapped.legend.length > 0);
  assert.ok(mapped.cells.length > 0);
  assert.deepEqual(mapped.cells.map((cell) => cell.buildingId), [...mapped.cells.map((cell) => cell.buildingId)].sort());
  for (const cell of mapped.cells) {
    const pressure = core.redevelopmentPressureSnapshot.parcels.find((item) => item.buildingId === cell.buildingId);
    assert.ok(pressure);
    assert.equal(cell.rawValue, pressure.pressure);
    const decision = core.redevelopmentExecutionSnapshot.decisions.find((item) => item.buildingId === cell.buildingId);
    if (decision) assert.match(cell.detail, new RegExp(decision.reason.replaceAll('-', ' '), 'i'));
  }
});

test('residential building inspection explains housing allocation and redevelopment status', () => {
  const core = housingCore();
  const building = core.buildings.occupied().sort((a, b) => a.id.localeCompare(b.id))[0]!;
  const inspection = inspectCell(core, building.x, building.y);
  assert.equal(inspection.kind, 'building');
  const text = inspection.lines.join('\n');
  for (const label of ['Housing occupancy', 'Affordability', 'Average rent burden', 'Cost-burdened residents', 'Redevelopment pressure', 'Redevelopment status']) {
    assert.match(text, new RegExp(label, 'i'));
  }
});
