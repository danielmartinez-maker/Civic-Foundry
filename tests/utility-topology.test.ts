import test from 'node:test';
import assert from 'node:assert/strict';
import { TerrainGrid } from '../src/world/terrain/TerrainGrid.ts';
import { RoadSystem } from '../src/world/roads/RoadSystem.ts';
import { TreasurySystem } from '../src/simulation/treasury/TreasurySystem.ts';
import { UtilityTopologySystem } from '../src/simulation/utilities/UtilityTopologySystem.ts';

const flatTerrain = (width = 8, height = 4): TerrainGrid => new TerrainGrid(
  width,
  height,
  Array.from({ length: width * height }, () => ({ elevation: 0.5, water: false, buildable: true, biome: 'grass' as const })),
);

const roadStrip = (terrain: TerrainGrid, treasury: TreasurySystem): RoadSystem => {
  const roads = new RoadSystem(terrain);
  assert.equal(roads.placePath([{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 1 }], 'local', treasury).ok, true);
  return roads;
};

test('distribution requires roads while transmission may use buildable off-road terrain', () => {
  const terrain = flatTerrain();
  const treasury = new TreasurySystem(100_000);
  const roads = roadStrip(terrain, treasury);
  const topology = new UtilityTopologySystem(terrain, roads);
  assert.equal(topology.placePath('power_distribution', 1, [{ x: 2, y: 1 }], treasury).ok, true);
  const denied = topology.placePath('water_main', 1, [{ x: 5, y: 2 }], treasury);
  assert.deepEqual(denied, { ok: false, cost: 100, reason: 'road right-of-way required' });
  assert.equal(topology.placePath('power_transmission', 1, [{ x: 5, y: 2 }], treasury).ok, true);
});

test('failed path placement is atomic', () => {
  const terrain = flatTerrain();
  const treasury = new TreasurySystem(100_000);
  const roads = roadStrip(terrain, treasury);
  const topology = new UtilityTopologySystem(terrain, roads);
  const before = treasury.balance;
  const result = topology.placePath('power_distribution', 1, [{ x: 1, y: 1 }, { x: 1, y: 1 }], treasury);
  assert.equal(result.ok, false);
  assert.equal(treasury.balance, before);
  assert.equal(topology.list().length, 0);
});

test('upgrade charges the tier delta and refuses tier 3', () => {
  const terrain = flatTerrain();
  const treasury = new TreasurySystem(100_000);
  const roads = roadStrip(terrain, treasury);
  const topology = new UtilityTopologySystem(terrain, roads);
  assert.equal(topology.placePath('power_distribution', 1, [{ x: 1, y: 1 }], treasury).ok, true);
  const before = treasury.balance;
  assert.equal(topology.upgradePath('power_distribution', [{ x: 1, y: 1 }], treasury).ok, true);
  assert.equal(before - treasury.balance, 90);
  assert.equal(topology.upgradePath('power_distribution', [{ x: 1, y: 1 }], treasury).ok, true);
  const tier3Balance = treasury.balance;
  const denied = topology.upgradePath('power_distribution', [{ x: 1, y: 1 }], treasury);
  assert.equal(denied.ok, false);
  assert.equal(denied.reason, 'maximum tier reached');
  assert.equal(treasury.balance, tier3Balance);
});

test('power and water corridors coexist at the same coordinate as separate layers', () => {
  const terrain = flatTerrain();
  const treasury = new TreasurySystem(100_000);
  const roads = roadStrip(terrain, treasury);
  const topology = new UtilityTopologySystem(terrain, roads);
  assert.equal(topology.placePath('power_distribution', 1, [{ x: 2, y: 1 }], treasury).ok, true);
  assert.equal(topology.placePath('water_main', 1, [{ x: 2, y: 1 }], treasury).ok, true);
  const cells = topology.list().filter((cell) => cell.x === 2 && cell.y === 1);
  assert.deepEqual(cells.map((cell) => cell.type).sort(), ['power_distribution', 'water_main']);
});

test('topology state restores exact ids, tiers, trip state and revision', () => {
  const terrain = flatTerrain();
  const treasury = new TreasurySystem(100_000);
  const roads = roadStrip(terrain, treasury);
  const original = new UtilityTopologySystem(terrain, roads);
  original.placePath('water_main', 1, [{ x: 1, y: 1 }, { x: 2, y: 1 }], treasury);
  const state = original.snapshotState();
  const mutated = {
    ...state,
    cells: state.cells.map((cell, index) => index === 0 ? { ...cell, saturatedCycles: 2, trippedUntilTick: 250 } : cell),
  };
  const restored = new UtilityTopologySystem(terrain, roads);
  restored.restoreState(mutated);
  assert.deepEqual(restored.snapshotState(), mutated);
});
