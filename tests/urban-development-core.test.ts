import test from 'node:test';
import assert from 'node:assert/strict';
import { SimulationCore } from '../src/simulation/core/SimulationCore.ts';
import { TerrainGrid, type TerrainCell } from '../src/world/terrain/TerrainGrid.ts';

function flatTerrain(width = 20, height = 12): TerrainGrid {
  const cells: TerrainCell[] = Array.from({ length: width * height }, () => ({
    elevation: 0.5,
    water: false,
    buildable: true,
    biome: 'grass' as const,
  }));
  return new TerrainGrid(width, height, cells);
}

function semanticDevelopmentCore(): SimulationCore {
  const core = new SimulationCore({
    terrain: flatTerrain(),
    startingFunds: 2_000_000,
    seed: 41,
    urbanDevelopmentMode: 'semantic',
  });
  assert.equal(core.buildRoad(Array.from({ length: 14 }, (_, i) => ({ x: i + 2, y: 6 })), 'arterial').ok, true);
  core.paintZone([{ x: 3, y: 5 }, { x: 4, y: 5 }, { x: 5, y: 5 }], 'residential');
  core.paintZone([{ x: 7, y: 5 }, { x: 8, y: 5 }], 'commercial');
  core.paintZone([{ x: 10, y: 5 }, { x: 11, y: 5 }], 'industrial');
  assert.equal(core.placeUtility('power', 4, 7).ok, true);
  assert.equal(core.placeUtility('water', 8, 7).ok, true);
  core.step(1);
  core.demandSnapshot = Object.freeze({ residential: 1, commercial: 1, industrial: 1 });
  return core;
}

function runDevelopmentPass(core: SimulationCore): void {
  const method = Reflect.get(core, 'evaluateDevelopmentMarket');
  assert.equal(typeof method, 'function');
  Reflect.apply(method as (...args: never[]) => unknown, core, []);
}

test('semantic Core development installs the exact winning quality, parking, and use mix state', () => {
  const core = semanticDevelopmentCore();
  runDevelopmentPass(core);

  const commitments = core.developerMarket.listCommitments();
  assert.ok(commitments.length > 0, 'expected at least one semantic development award');
  for (const commitment of commitments) {
    const building = core.buildings.getById(commitment.buildingId);
    const state = core.urbanFabric.get(commitment.buildingId);
    assert.ok(building, `missing awarded building ${commitment.buildingId}`);
    assert.ok(state, `missing semantic state ${commitment.buildingId}`);
    assert.ok(commitment.useMixKey.startsWith(commitment.definitionId));
    assert.equal(state.qualityTier, commitment.qualityTier);
    assert.equal(state.parking.profile, commitment.parkingProfile);
    assert.equal(state.parking.spaces, commitment.parkingSpaces);
    assert.notEqual(state.parking.profile, 'legacy-none');
    assert.equal(
      state.useComponents.reduce((sum, component) => sum + component.areaShareBps, 0),
      10_000,
    );
  }
});

test('legacy Core mode remains the default for V7 parity', () => {
  const core = new SimulationCore({ terrain: flatTerrain(), seed: 41 });
  assert.equal(core.urbanDevelopmentMode, 'legacy');
});
