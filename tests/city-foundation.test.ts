import test from 'node:test';
import assert from 'node:assert/strict';
import { TerrainGrid, type TerrainCell } from '../src/world/terrain/TerrainGrid.ts';
import { TreasurySystem } from '../src/simulation/treasury/TreasurySystem.ts';
import { RoadSystem } from '../src/world/roads/RoadSystem.ts';
import { ZoningSystem } from '../src/simulation/zoning/ZoningSystem.ts';
import { LotSystem } from '../src/world/lots/LotSystem.ts';
import { BuildingSystem } from '../src/simulation/buildings/BuildingSystem.ts';
import { PopulationSystem } from '../src/simulation/population/PopulationSystem.ts';

function flatTerrain(width = 12, height = 8): TerrainGrid {
  const cells: TerrainCell[] = Array.from({ length: width * height }, () => ({
    elevation: 0.5,
    water: false,
    buildable: true,
    biome: 'grass' as const,
  }));
  return new TerrainGrid(width, height, cells);
}

test('road placement validates terrain, charges exact cost, and increments revision', () => {
  const terrain = flatTerrain();
  const treasury = new TreasurySystem(1000);
  const roads = new RoadSystem(terrain);
  const cells = [{ x: 2, y: 3 }, { x: 3, y: 3 }, { x: 4, y: 3 }];
  const result = roads.placePath(cells, 'local', treasury);
  assert.equal(result.ok, true);
  assert.equal(result.cost, 120);
  assert.equal(treasury.balance, 880);
  assert.equal(roads.revision, 1);
  assert.equal(roads.list().length, 3);
  const duplicate = roads.placePath([{ x: 3, y: 3 }], 'local', treasury);
  assert.equal(duplicate.ok, false);
  assert.equal(treasury.balance, 880);
});

test('zoning only paints buildable non-road cells and lots require road frontage', () => {
  const terrain = flatTerrain();
  const treasury = new TreasurySystem(1000);
  const roads = new RoadSystem(terrain);
  roads.placePath([{ x: 2, y: 3 }, { x: 3, y: 3 }, { x: 4, y: 3 }], 'local', treasury);
  const zoning = new ZoningSystem(terrain, roads);
  assert.equal(zoning.paint([{ x: 2, y: 2 }, { x: 3, y: 2 }], 'residential').painted, 2);
  assert.equal(zoning.paint([{ x: 2, y: 3 }], 'commercial').painted, 0);
  assert.equal(zoning.paint([{ x: 8, y: 1 }], 'industrial').painted, 1);
  const lots = new LotSystem();
  lots.rebuild(roads, zoning);
  assert.equal(lots.list().length, 2);
  assert.deepEqual(lots.list().map((lot) => lot.zone), ['residential', 'residential']);
});

test('buildings move from construction to occupied and expose real capacities', () => {
  const terrain = flatTerrain();
  const treasury = new TreasurySystem(1000);
  const roads = new RoadSystem(terrain);
  roads.placePath([{ x: 2, y: 3 }, { x: 3, y: 3 }, { x: 4, y: 3 }], 'local', treasury);
  const zoning = new ZoningSystem(terrain, roads);
  zoning.paint([{ x: 2, y: 2 }], 'residential');
  zoning.paint([{ x: 3, y: 2 }], 'commercial');
  const lots = new LotSystem();
  lots.rebuild(roads, zoning);
  const buildings = new BuildingSystem();
  buildings.evaluateDevelopment(0, lots.list(), { residential: 1, commercial: 1, industrial: 1 });
  assert.equal(buildings.list().length, 2);
  assert.ok(buildings.list().every((b) => b.status === 'construction'));
  buildings.tick(100);
  assert.ok(buildings.list().every((b) => b.status === 'occupied'));
  assert.ok(buildings.residentialCapacity() > 0);
  assert.ok(buildings.jobCapacity() > 0);
});

test('population is bounded by occupied residential capacity and can decline', () => {
  const population = new PopulationSystem(0);
  population.update(10, 1);
  assert.equal(population.population, 2);
  for (let i = 0; i < 10; i++) population.update(10, 1);
  assert.equal(population.population, 10);
  population.update(10, 0);
  assert.equal(population.population, 8);
  population.update(0, 1);
  assert.equal(population.population, 0);
});

import { SimulationCore } from '../src/simulation/core/SimulationCore.ts';

test('SimulationCore integrates roads, zoning, lots, development, and population', () => {
  const core = new SimulationCore({ terrain: flatTerrain(), startingFunds: 100_000, seed: 9 });
  assert.equal(core.buildRoad([{ x: 2, y: 4 }, { x: 3, y: 4 }, { x: 4, y: 4 }], 'local').ok, true);
  assert.equal(core.paintZone([{ x: 2, y: 3 }, { x: 3, y: 3 }], 'residential').painted, 2);
  assert.equal(core.placeUtility('power', 2, 5).ok, true);
  assert.equal(core.placeUtility('water', 3, 5).ok, true);
  assert.equal(core.placeUtility('landfill', 4, 5).ok, true);
  core.step(120);
  assert.equal(core.lots.list().length, 2);
  assert.equal(core.buildings.occupied().length, 2);
  assert.ok(core.population.population > 0);
});
