import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILDING_VARIANTS } from '../src/data/buildings.ts';
import { SimulationCore } from '../src/simulation/core/SimulationCore.ts';
import { DevelopmentFeasibilitySystem } from '../src/simulation/development/DevelopmentFeasibilitySystem.ts';
import type { DevelopmentParcelContext } from '../src/simulation/development/DevelopmentTypes.ts';
import { TreasurySystem } from '../src/simulation/treasury/TreasurySystem.ts';
import type { Lot } from '../src/world/lots/LotSystem.ts';
import { RoadSystem } from '../src/world/roads/RoadSystem.ts';
import { TerrainGrid, type TerrainCell } from '../src/world/terrain/TerrainGrid.ts';

function flat(width = 8, height = 6): TerrainGrid {
  const cells: TerrainCell[] = Array.from({ length: width * height }, () => ({ elevation: 0.5, water: false, buildable: true, biome: 'grass' }));
  return new TerrainGrid(width, height, cells);
}

const context: DevelopmentParcelContext = {
  demand: 1,
  taxRate: 0.05,
  personAccessibility: 0.9,
  freightAccessibility: 0.8,
  serviceQuality: 0.9,
  neighborhoodQuality: 0.85,
  utilityRatio: 0.95,
  constructionCostIndex: 1,
  marketInterestRate: 0.06,
  zoningMaxIntensity: 'high',
  marketPressure: 0.8,
  marketRentMultiplier: 1.1,
  marketVacancyRate: 0.08,
  landValueMultiplier: 1,
};

const residentialLow = BUILDING_VARIANTS.residential.find((definition) => definition.intensity === 'low')!;

function lotAt(x: number, y: number): Lot {
  return { id: `lot:${x},${y}`, x, y, zone: 'residential', frontageRoadKey: `${x},${y + 1}` };
}

test('RoadSystem sums terrain multipliers per new cell and rounds the total once', () => {
  const terrain = flat(3, 1);
  const treasury = new TreasurySystem(1_000);
  const multipliers = [1, 1.5, 2] as const;
  const roads = new RoadSystem(terrain, (x) => multipliers[x]!);
  const result = roads.placePath([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }], 'local', treasury);
  assert.deepEqual(result, { ok: true, cost: 180 });
  assert.equal(treasury.balance, 820);
});

test('direct terrain SimulationCore preserves exact legacy road cost', () => {
  const core = new SimulationCore({ terrain: flat(), startingFunds: 1_000, seed: 7 });
  const result = core.buildRoad([{ x: 1, y: 2 }, { x: 2, y: 2 }, { x: 3, y: 2 }], 'local');
  assert.equal(result.ok, true);
  assert.equal(result.cost, 120);
  assert.equal(core.treasury.balance, 880);
});

test('generated 1R preparation multiplier increases hard construction cost while legacy stays neutral', () => {
  const generated = new SimulationCore({ width: 24, height: 16, seed: 42, worldConfig: { preset: 'rolling_uplands' } });
  let candidate: { x: number; y: number; multiplier: number } | undefined;
  for (let y = 0; y < generated.terrain.height && !candidate; y++) {
    for (let x = 0; x < generated.terrain.width; x++) {
      if (!generated.terrain.isBuildable(x, y)) continue;
      const multiplier = generated.world.preparationMultiplierAt(x, y);
      if (multiplier > 1.05) { candidate = { x, y, multiplier }; break; }
    }
  }
  assert.ok(candidate, 'expected at least one buildable generated cell with non-neutral preparation cost');

  const lot = lotAt(candidate.x, candidate.y);
  const raw = new DevelopmentFeasibilitySystem().evaluateLot(lot, [residentialLow], context)[0]!;
  const terrainAware = generated.developmentFeasibility.evaluateLot(lot, [residentialLow], context)[0]!;
  assert.ok(terrainAware.hardConstructionCost > raw.hardConstructionCost);

  const legacy = new SimulationCore({ terrain: flat(), seed: 42 });
  const legacyLot = lotAt(2, 2);
  const legacyRaw = new DevelopmentFeasibilitySystem().evaluateLot(legacyLot, [residentialLow], context)[0]!;
  const legacyAware = legacy.developmentFeasibility.evaluateLot(legacyLot, [residentialLow], context)[0]!;
  assert.equal(legacyAware.hardConstructionCost, legacyRaw.hardConstructionCost);
});

test('invalid terrain road cost multiplier is rejected as configuration corruption', () => {
  const roads = new RoadSystem(flat(2, 1), () => Number.NaN);
  assert.throws(() => roads.placePath([{ x: 0, y: 0 }], 'local', new TreasurySystem(1_000)), /invalid road terrain cost multiplier/);
});
