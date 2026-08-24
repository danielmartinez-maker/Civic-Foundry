import test from 'node:test';
import assert from 'node:assert/strict';
import { TerrainGrid } from '../src/world/terrain/TerrainGrid.ts';
import { WaterNetworkSystem } from '../src/simulation/utilities/WaterNetworkSystem.ts';
import type { UtilityCorridorCell, UtilityCorridorType, UtilityFacility, UtilityTier } from '../src/simulation/utilities/UtilityInfrastructureTypes.ts';

const terrainWithElevation = (elevations: number[]): TerrainGrid => new TerrainGrid(
  elevations.length,
  1,
  elevations.map((elevation) => ({ elevation, water: false, buildable: true, biome: 'grass' as const })),
);
const flatTerrain = (width: number, height: number, elevation = 0.5): TerrainGrid => new TerrainGrid(
  width,
  height,
  Array.from({ length: width * height }, () => ({ elevation, water: false, buildable: true, biome: 'grass' as const })),
);
const cell = (id: string, type: UtilityCorridorType, x: number, y = 0, tier: UtilityTier = 1): UtilityCorridorCell => ({
  id, type, x, y, tier, saturatedCycles: 0, trippedUntilTick: 0,
});
const source: UtilityFacility = { id: 'utility:1', type: 'water', x: 0, y: 0 };

test('flat explicit water main supplies a connected demand', () => {
  const terrain = terrainWithElevation([0.5, 0.5, 0.5, 0.5]);
  const system = new WaterNetworkSystem(terrain);
  const snapshot = system.evaluate({
    corridors: [cell('m1', 'water_main', 1), cell('m2', 'water_main', 2)],
    facilities: [source],
    demands: [{ id: 'b1', x: 3, y: 0, demand: 5 }],
    tick: 0,
  });
  assert.equal(snapshot.perBuilding.b1?.pressureEligible, true);
  assert.equal(snapshot.perBuilding.b1?.delivered, 5);
  assert.equal(snapshot.perBuilding.b1?.serviceRatio, 1);
});

test('uphill elevation can make a connected consumer pressure-ineligible', () => {
  const terrain = terrainWithElevation([0.5, 0.5, 1.8, 1.8]);
  const system = new WaterNetworkSystem(terrain);
  const snapshot = system.evaluate({
    corridors: [cell('m1', 'water_main', 1), cell('m2', 'water_main', 2)],
    facilities: [source],
    demands: [{ id: 'b1', x: 3, y: 0, demand: 5 }],
    tick: 0,
  });
  assert.equal(snapshot.perBuilding.b1?.pressureEligible, false);
  assert.equal(snapshot.perBuilding.b1?.serviceRatio, 0);
  assert.ok((snapshot.perBuilding.b1?.pressureMargin ?? 1) <= 0);
});

test('water trunk does not directly serve a building', () => {
  const terrain = terrainWithElevation([0.5, 0.5, 0.5]);
  const system = new WaterNetworkSystem(terrain);
  const snapshot = system.evaluate({
    corridors: [cell('t1', 'water_trunk', 1)],
    facilities: [source],
    demands: [{ id: 'b1', x: 2, y: 0, demand: 5 }],
    tick: 0,
  });
  assert.equal(snapshot.perBuilding.b1?.serviceRatio, 0);
});

test('pump bridges trunk to main, resets pressure, and remains transfer-capacity constrained', () => {
  const terrain = terrainWithElevation([0.5, 0.5, 1.0, 1.0, 1.0]);
  const system = new WaterNetworkSystem(terrain);
  const corridors = [cell('t1', 'water_trunk', 1, 0, 3), cell('m1', 'water_main', 3, 0, 3)];
  const pump: UtilityFacility = {
    id: 'utility:pump', type: 'water_pump', x: 2, y: 0,
    inputCoord: { x: 1, y: 0 }, outputCoord: { x: 3, y: 0 },
  };
  const full = system.evaluate({
    corridors, facilities: [source, pump], demands: [{ id: 'b1', x: 4, y: 0, demand: 150 }], tick: 0,
  });
  assert.equal(full.perBuilding.b1?.pressureEligible, true);
  assert.equal(full.perBuilding.b1?.serviceRatio, 1);
  assert.ok((full.perBuilding.b1?.pressureMargin ?? 0) > 0);

  const branchTerrain = flatTerrain(5, 3);
  const branchSystem = new WaterNetworkSystem(branchTerrain);
  const branchCorridors = [
    cell('t1', 'water_trunk', 1, 1, 3),
    cell('m0', 'water_main', 3, 1, 3),
    cell('m1', 'water_main', 4, 1, 3),
    cell('m2', 'water_main', 3, 2, 3),
  ];
  const branchPump: UtilityFacility = {
    id: 'utility:pump', type: 'water_pump', x: 2, y: 1,
    inputCoord: { x: 1, y: 1 }, outputCoord: { x: 3, y: 1 },
  };
  const sources: UtilityFacility[] = Array.from({ length: 9 }, (_, index) => ({ id: `utility:${index + 1}`, type: 'water' as const, x: 0, y: 1 }));
  const capped = branchSystem.evaluate({
    corridors: branchCorridors,
    facilities: [...sources, branchPump],
    demands: [{ id: 'b1', x: 4, y: 2, demand: 1_400 }],
    tick: 0,
  });
  assert.equal(capped.perBuilding.b1?.delivered, 1_200);
});

test('water pressure and flow snapshot is input-order deterministic', () => {
  const terrain = terrainWithElevation([0.5, 0.5, 0.5, 0.5]);
  const system = new WaterNetworkSystem(terrain);
  const corridors = [cell('m1', 'water_main', 1), cell('m2', 'water_main', 2)];
  const facilities = [source];
  const demands = [{ id: 'b2', x: 3, y: 0, demand: 4 }, { id: 'b1', x: 2, y: 0, demand: 5 }];
  const first = system.evaluate({ corridors, facilities, demands, tick: 0 });
  const second = system.evaluate({ corridors: [...corridors].reverse(), facilities: [...facilities].reverse(), demands: [...demands].reverse(), tick: 0 });
  assert.deepEqual(first, second);
});

test('water additional headroom distinguishes pressure failure from residual capacity', () => {
  const flat = terrainWithElevation([0.5, 0.5, 0.5, 0.5]);
  const corridors = [cell('m1', 'water_main', 1), cell('m2', 'water_main', 2)];
  const system = new WaterNetworkSystem(flat);
  const snapshot = system.evaluate({ corridors, facilities: [source], demands: [{ id: 'existing', x: 3, y: 0, demand: 140 }], tick: 0 });
  const headroom = system.evaluateAdditionalHeadroom({ x: 2, y: 0, demand: 30, snapshot, corridors, facilities: [source], tick: 0 });
  assert.equal(headroom.deliverable, 10);
  assert.equal(headroom.limitingReason, 'capacity');

  const steep = terrainWithElevation([0.5, 0.5, 1.8, 1.8]);
  const steepSystem = new WaterNetworkSystem(steep);
  const steepSnapshot = steepSystem.evaluate({ corridors, facilities: [source], demands: [], tick: 0 });
  const pressure = steepSystem.evaluateAdditionalHeadroom({ x: 3, y: 0, demand: 5, snapshot: steepSnapshot, corridors, facilities: [source], tick: 0 });
  assert.equal(pressure.deliverable, 0);
  assert.equal(pressure.limitingReason, 'pressure');
});
