import test from 'node:test';
import assert from 'node:assert/strict';
import { TerrainGrid } from '../src/world/terrain/TerrainGrid.ts';
import { RoadSystem } from '../src/world/roads/RoadSystem.ts';
import { TreasurySystem } from '../src/simulation/treasury/TreasurySystem.ts';
import { UtilitySystem } from '../src/simulation/utilities/UtilitySystem.ts';
import type { Building } from '../src/simulation/buildings/BuildingSystem.ts';

const flatTerrain = (width = 8, height = 4): TerrainGrid => new TerrainGrid(
  width,
  height,
  Array.from({ length: width * height }, () => ({ elevation: 0.5, water: false, buildable: true, biome: 'grass' as const })),
);

const building = (id: string, x: number, y: number, definitionId = 'residential_cottage', zone: Building['zone'] = 'residential'): Building => ({
  id, lotId: `lot:${id}`, x, y, zone, definitionId, status: 'occupied', constructionStartedTick: 0, completionTick: 0,
});

const setup = () => {
  const terrain = flatTerrain();
  const treasury = new TreasurySystem(500_000);
  const roads = new RoadSystem(terrain);
  assert.equal(roads.placePath(Array.from({ length: 5 }, (_, i) => ({ x: i + 1, y: 1 })), 'local', treasury).ok, true);
  return { terrain, treasury, roads, utilities: new UtilitySystem(terrain, roads) };
};

test('native utility service requires explicit distribution beyond the source stub', () => {
  const { treasury, utilities } = setup();
  const home = building('home', 5, 2);
  assert.equal(utilities.placeFacility('power', 0, 1, treasury).ok, true);
  const beforeNetwork = utilities.evaluate([home], 50);
  assert.equal(beforeNetwork.perBuilding[home.id]?.power, 0);
  assert.equal(utilities.buildPath('power_distribution', 1, [
    { x: 2, y: 1 }, { x: 3, y: 1 }, { x: 4, y: 1 }, { x: 5, y: 1 },
  ], treasury).ok, true);
  const afterNetwork = utilities.evaluate([home], 60);
  assert.ok((afterNetwork.perBuilding[home.id]?.power ?? 0) > 0);
});

test('network operating cost sums facility and corridor tier costs exactly', () => {
  const { treasury, utilities } = setup();
  assert.equal(utilities.placeFacility('power', 0, 1, treasury).ok, true); // auto-stub x=1,y=1
  assert.equal(utilities.buildPath('power_distribution', 1, [{ x: 2, y: 1 }], treasury).ok, true);
  assert.equal(utilities.buildPath('power_transmission', 1, [{ x: 1, y: 2 }], treasury).ok, true);
  assert.equal(utilities.buildPath('water_main', 2, [{ x: 3, y: 1 }], treasury).ok, true);
  assert.equal(utilities.placeFacility(
    'power_substation', 2, 2, treasury,
    { x: 1, y: 2 }, { x: 2, y: 1 },
  ).ok, true);
  assert.equal(utilities.operatingCost(), 584.1);
});

test('overload protection accounts once per 50-tick boundary, trips for 100 ticks, and recovers', () => {
  const { treasury, utilities } = setup();
  assert.equal(utilities.placeFacility('power', 0, 1, treasury).ok, true);
  assert.equal(utilities.buildPath('power_distribution', 1, [{ x: 2, y: 1 }, { x: 3, y: 1 }], treasury).ok, true);
  const loads = [
    building('plant-a', 3, 0, 'industrial_plant', 'industrial'),
    building('plant-b', 3, 2, 'industrial_plant', 'industrial'),
  ];

  const at50 = utilities.evaluate(loads, 50);
  const segmentId = Object.values(at50.powerNetwork.segments).find((segment) => segment.x === 2 && segment.y === 1)?.id;
  assert.ok(segmentId);
  assert.equal(at50.powerNetwork.segments[segmentId!]?.saturatedCycles, 1);
  utilities.evaluate(loads, 60);
  utilities.evaluate(loads, 70);
  const at80 = utilities.evaluate(loads, 80);
  assert.equal(at80.powerNetwork.segments[segmentId!]?.saturatedCycles, 1);

  const at100 = utilities.evaluate(loads, 100);
  assert.equal(at100.powerNetwork.segments[segmentId!]?.saturatedCycles, 2);
  const at150 = utilities.evaluate(loads, 150);
  assert.equal(at150.powerNetwork.segments[segmentId!]?.trippedUntilTick, 250);
  assert.equal(at150.powerNetwork.segments[segmentId!]?.tripped, true);
  assert.equal(at150.powerNetwork.segments[segmentId!]?.realizedFlow, 0);
  assert.equal(utilities.evaluate(loads, 249).powerNetwork.segments[segmentId!]?.tripped, true);
  assert.equal(utilities.evaluate(loads, 250).powerNetwork.segments[segmentId!]?.tripped, false);
});

test('development headroom combines residual power and water capacity and reports the limiting network', () => {
  const { treasury, utilities } = setup();
  assert.equal(utilities.placeFacility('power', 0, 1, treasury).ok, true);
  assert.equal(utilities.placeFacility('water', 1, 2, treasury).ok, true);
  assert.equal(utilities.buildPath('power_distribution', 1, [{ x: 2, y: 1 }, { x: 3, y: 1 }], treasury).ok, true);
  assert.equal(utilities.buildPath('water_main', 1, [{ x: 2, y: 1 }, { x: 3, y: 1 }], treasury).ok, true);
  const existing = building('plant', 3, 0, 'industrial_plant', 'industrial');
  utilities.evaluate([existing], 100);
  const headroom = utilities.evaluateDevelopmentHeadroom(3, 2, 90, 200);
  assert.equal(headroom.powerHeadroom, 90);
  assert.equal(headroom.waterHeadroom, 100);
  assert.equal(headroom.powerServiceRatio, 1);
  assert.equal(headroom.waterServiceRatio, 0.5);
  assert.equal(headroom.utilityRatio, 0.5);
  assert.equal(headroom.limitingReason, 'water-capacity');
});

test('utility infrastructure state round-trips corridors, facilities, endpoints, and overload cursor', () => {
  const { terrain, treasury, roads, utilities } = setup();
  utilities.placeFacility('power', 0, 1, treasury);
  utilities.buildPath('power_distribution', 1, [{ x: 2, y: 1 }], treasury);
  utilities.evaluate([], 50);
  const state = utilities.snapshotState();
  const restored = new UtilitySystem(terrain, roads);
  restored.restoreState(state);
  assert.deepEqual(restored.snapshotState(), state);
});
