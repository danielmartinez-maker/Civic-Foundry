import test from 'node:test';
import assert from 'node:assert/strict';
import { TerrainGrid, type TerrainCell } from '../src/world/terrain/TerrainGrid.ts';
import { TreasurySystem } from '../src/simulation/treasury/TreasurySystem.ts';
import { RoadSystem } from '../src/world/roads/RoadSystem.ts';
import { ZoningSystem } from '../src/simulation/zoning/ZoningSystem.ts';
import { LotSystem, type Lot } from '../src/world/lots/LotSystem.ts';
import { ParcelGenerationSystem } from '../src/world/cadastre/ParcelGenerationSystem.ts';
import { CadastralGraph } from '../src/world/cadastre/CadastralGraph.ts';
import { BuildingSystem } from '../src/simulation/buildings/BuildingSystem.ts';
import { PopulationSystem } from '../src/simulation/population/PopulationSystem.ts';
import { getBuildingDefinition } from '../src/data/buildings.ts';
import type { DevelopmentAward } from '../src/simulation/development/DevelopmentTypes.ts';
import type { ZoneType } from '../src/simulation/core/types.ts';

function flatTerrain(width = 12, height = 8): TerrainGrid {
  const cells: TerrainCell[] = Array.from({ length: width * height }, () => ({
    elevation: 0.5,
    water: false,
    buildable: true,
    biome: 'grass' as const,
  }));
  return new TerrainGrid(width, height, cells);
}

function awardForLot(lot: Lot, definitionId: string, tick = 0): DevelopmentAward {
  const definition = getBuildingDefinition(definitionId);
  const completionTick = tick + definition.constructionTicks;
  return {
    id: `bid:${lot.id}`,
    lotId: lot.id,
    definitionId,
    zone: lot.zone,
    developerId: 'fixture_developer',
    expectedReturn: 0.2,
    expectedReturnMargin: 0.1,
    requiredEquity: 10_000,
    financingCost: 1_000,
    totalDevelopmentCost: 50_000,
    preferenceBonus: 0,
    capitalEfficiencyBonus: 0,
    residualValueBonus: 0,
    riskPenalty: 0,
    rankScore: 0.1,
    residualLandValue: 20_000,
    awardId: `award:${lot.id}`,
    buildingId: `building:${lot.id}`,
    awardTick: tick,
    completionTick,
    releaseTick: completionTick + 100,
  };
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

test('cadastral compatibility lots preserve legacy frontage cells while deriving from one parcel', () => {
  const terrain = flatTerrain();
  const treasury = new TreasurySystem(1000);
  const roads = new RoadSystem(terrain);
  roads.placePath([{ x: 2, y: 3 }, { x: 3, y: 3 }, { x: 4, y: 3 }], 'local', treasury);
  const zoning = new ZoningSystem(terrain, roads);
  assert.equal(zoning.paint([{ x: 2, y: 2 }, { x: 3, y: 2 }], 'residential').painted, 2);
  assert.equal(zoning.paint([{ x: 2, y: 3 }], 'commercial').painted, 0);
  assert.equal(zoning.paint([{ x: 8, y: 1 }], 'industrial').painted, 1);

  const graph = new CadastralGraph(new ParcelGenerationSystem().rebuild(terrain, roads, zoning));
  assert.equal(graph.listParcels().length, 2, 'frontage pair plus isolated zoned cell should remain canonical parcels');
  const frontageParcels = graph.listParcels().filter((parcel) => parcel.frontageEdgeIds.length > 0);
  assert.equal(frontageParcels.length, 1, 'two compatible frontage cells should become one canonical cadastral parcel');

  const lots = new LotSystem();
  lots.rebuildFromCadastre(graph, (parcel) => parcel.zoningDistrictId as ZoneType);
  assert.deepEqual(
    lots.list(),
    [
      { id: 'lot:2,2', x: 2, y: 2, zone: 'residential', frontageRoadKey: '2,3' },
      { id: 'lot:3,2', x: 3, y: 2, zone: 'residential', frontageRoadKey: '3,3' },
    ],
  );
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
  for (const lot of lots.list()) {
    const definitionId = lot.zone === 'residential' ? 'residential_cottage' : 'commercial_shop';
    buildings.startDevelopment(0, lot, awardForLot(lot, definitionId));
  }
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
  assert.deepEqual(core.lots.list().map((lot) => lot.id), ['lot:2,3', 'lot:3,3']);
  assert.equal(core.buildings.occupied().length, 2);
  assert.ok(core.population.population > 0);
});