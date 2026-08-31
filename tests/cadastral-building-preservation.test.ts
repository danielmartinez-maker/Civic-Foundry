import test from 'node:test';
import assert from 'node:assert/strict';
import { SimulationCore } from '../src/simulation/core/SimulationCore.ts';
import { TerrainGrid, type TerrainCell } from '../src/world/terrain/TerrainGrid.ts';

function flatTerrain(width = 10, height = 8): TerrainGrid {
  const cells: TerrainCell[] = Array.from({ length: width * height }, () => ({
    elevation: 0.5,
    water: false,
    buildable: true,
    biome: 'grass' as const,
  }));
  return new TerrainGrid(width, height, cells);
}

test('unrelated zoning rebuild preserves canonical building identity and lifecycle state', () => {
  const core = new SimulationCore({ terrain: flatTerrain(), startingFunds: 300_000, seed: 117 });
  assert.equal(core.buildRoad([
    { x: 1, y: 4 },
    { x: 2, y: 4 },
    { x: 3, y: 4 },
  ], 'local').ok, true);
  assert.equal(core.paintZone([{ x: 2, y: 3 }], 'residential').painted, 1);
  const lot = core.lots.list().find((item) => item.zone === 'residential');
  assert.ok(lot);
  core.buildings.restore([{
    id: `building:${lot.id}`,
    lotId: lot.id,
    x: lot.x,
    y: lot.y,
    zone: 'residential',
    definitionId: 'residential_cottage',
    status: 'occupied',
    constructionStartedTick: 10,
    completionTick: 20,
  }]);
  core.rebuildCadastreFromLegacyState();

  const canonical = core.buildings.listV2()[0];
  assert.ok(canonical);
  const preserved = {
    ...canonical,
    ownerId: 'owner:preserved',
    lifecycle: {
      ...canonical.lifecycle,
      ageTicks: 4_500,
      condition: 42,
      structuralCondition: 55,
      systemsCondition: 44,
      exteriorCondition: 33,
      maintenanceBacklog: 1_234,
      deferredMaintenanceTicks: 77,
      effectiveAge: 18,
      vacancyDurationTicks: 12,
      distressScore: 61,
      lastMajorRenovationTick: 321,
    },
    project: {
      phase: 'renovation' as const,
      startedTick: 400,
      completionTick: 500,
      progress: 0.4,
      kind: 'renovation' as const,
      renovationScope: 'major' as const,
      targetCondition: 90,
    },
  };
  core.buildings.restoreV2([preserved]);

  assert.equal(core.paintZone([{ x: 8, y: 1 }], 'commercial').painted, 1);

  const after = core.buildings.listV2()[0];
  assert.ok(after);
  assert.equal(after.id, preserved.id);
  assert.equal(after.typologyId, preserved.typologyId);
  assert.equal(after.ownerId, preserved.ownerId);
  assert.deepEqual(after.lifecycle, preserved.lifecycle);
  assert.deepEqual(after.project, preserved.project);
});