import test from 'node:test';
import assert from 'node:assert/strict';
import { SimulationCore } from '../src/simulation/core/SimulationCore.ts';
import { TerrainGrid, type TerrainCell } from '../src/world/terrain/TerrainGrid.ts';
import { BUILDING_DEFINITION_BY_ID } from '../src/data/buildings.ts';

function flatTerrain(width = 20, height = 12): TerrainGrid {
  const cells: TerrainCell[] = Array.from({ length: width * height }, () => ({
    elevation: 0.5,
    water: false,
    buildable: true,
    biome: 'grass' as const,
  }));
  return new TerrainGrid(width, height, cells);
}

function redevelopmentCore(buildingCount: number, population: number): SimulationCore {
  const core = new SimulationCore({ terrain: flatTerrain(), startingFunds: 300_000, seed: 73 });
  assert.equal(core.buildRoad(Array.from({ length: 14 }, (_, i) => ({ x: i + 2, y: 6 })), 'local').ok, true);
  const zoneCells = Array.from({ length: buildingCount }, (_, i) => ({ x: i + 3, y: 5 }));
  assert.equal(core.paintZone(zoneCells, 'residential').painted, buildingCount);
  assert.equal(core.placeUtility('power', 4, 7).ok, true);
  assert.equal(core.placeUtility('water', 8, 7).ok, true);

  const lots = core.lots.list().filter((lot) => lot.zone === 'residential').sort((a, b) => a.id.localeCompare(b.id));
  assert.equal(lots.length, buildingCount);
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
  return core;
}

test('SimulationCore does not redevelop an occupied home when demolition would strand population', () => {
  const core = redevelopmentCore(1, 8);
  const before = core.buildings.list()[0]!;

  core.step(20);

  const after = core.buildings.getById(before.id);
  assert.ok(after);
  assert.equal(after.definitionId, 'residential_cottage');
  assert.equal(after.status, 'occupied');
  assert.equal(core.population.population, 8);
});

test('SimulationCore sends safeguarded occupied residential redevelopment through the existing developer market', () => {
  const core = redevelopmentCore(3, 6);
  const originalIds = new Set(core.buildings.list().map((building) => building.id));

  core.step(20);

  const replacements = core.buildings.list().filter((building) => building.status === 'construction');
  assert.ok(replacements.length >= 1, 'expected at least one safeguarded redevelopment award');
  for (const replacement of replacements) {
    assert.ok(originalIds.has(replacement.id), 'redevelopment must preserve deterministic building identity');
    assert.notEqual(replacement.definitionId, 'residential_cottage');
    assert.ok(replacement.developerId);
    assert.ok((replacement.projectCost ?? 0) > 0);
    assert.ok((replacement.requiredEquity ?? 0) > 0);
    assert.ok((BUILDING_DEFINITION_BY_ID[replacement.definitionId]?.intensity === 'medium')
      || (BUILDING_DEFINITION_BY_ID[replacement.definitionId]?.intensity === 'high'));
  }
  assert.equal(core.population.population, 6, 'demolition must not directly mutate aggregate population');
  assert.ok(core.buildings.residentialCapacity() >= core.population.population, 'remaining occupied stock must absorb current population');
  const committedBuildingIds = new Set(core.developerMarket.listCommitments().map((commitment) => commitment.buildingId));
  assert.ok(replacements.every((replacement) => committedBuildingIds.has(replacement.id)), 'active redevelopment must retain its authoritative developer commitment');
});
