import test from 'node:test';
import assert from 'node:assert/strict';
import { SimulationCore } from '../src/simulation/core/SimulationCore.ts';
import { hydrateCore, serializeCore } from '../src/save/save.ts';

type Cell = Readonly<{ x: number; y: number }>;
type AcceptancePlacement = Readonly<{
  road: readonly Cell[];
  zone: Cell;
  power: Cell;
  water: Cell;
}>;

const CARDINAL = Object.freeze([
  Object.freeze([0, -1] as const),
  Object.freeze([1, 0] as const),
  Object.freeze([0, 1] as const),
  Object.freeze([-1, 0] as const),
]);

function cellKey(cell: Cell): string {
  return `${cell.x},${cell.y}`;
}

function findAcceptancePlacement(core: SimulationCore): AcceptancePlacement {
  for (let y = 1; y < core.terrain.height - 1; y += 1) {
    for (let x = 1; x < core.terrain.width - 3; x += 1) {
      const road = Object.freeze([
        Object.freeze({ x, y }),
        Object.freeze({ x: x + 1, y }),
        Object.freeze({ x: x + 2, y }),
      ]);
      if (!road.every((cell) => core.terrain.isBuildable(cell.x, cell.y))) continue;

      const roadKeys = new Set(road.map(cellKey));
      const adjacentByKey = new Map<string, Cell>();
      for (const roadCell of road) {
        for (const [dx, dy] of CARDINAL) {
          const candidate = Object.freeze({ x: roadCell.x + dx, y: roadCell.y + dy });
          if (candidate.x < 0 || candidate.y < 0 || candidate.x >= core.terrain.width || candidate.y >= core.terrain.height) continue;
          if (roadKeys.has(cellKey(candidate)) || !core.terrain.isBuildable(candidate.x, candidate.y)) continue;
          adjacentByKey.set(cellKey(candidate), candidate);
        }
      }

      const adjacent = [...adjacentByKey.values()].sort((a, b) => a.y - b.y || a.x - b.x);
      if (adjacent.length < 3) continue;
      const zone = adjacent[0];
      const power = adjacent[1];
      const water = adjacent[2];
      if (!zone || !power || !water) continue;
      return Object.freeze({ road, zone, power, water });
    }
  }
  throw new Error('no deterministic 1R acceptance placement found');
}

test('Phase 1R generates, plays, floods, saves, restores, and continues deterministically', () => {
  const core = new SimulationCore({
    width: 48,
    height: 32,
    seed: 20260825,
    worldConfig: { preset: 'river_valley' },
  });

  assert.equal(core.world.mode, 'generated-1r');
  assert.equal(core.world.geography.list('region').length, 1);
  assert.ok(core.world.geography.list('municipality').length > 0);
  assert.ok(core.world.geography.list('district').length > 0);
  assert.ok(core.world.geography.list('neighborhood').length > 0);
  assert.ok(core.world.geography.list('block').length > 0);
  assert.ok(core.world.hydrology.channels().length >= 1);

  const placement = findAcceptancePlacement(core);
  const roadResult = core.buildRoad(placement.road, 'local');
  assert.equal(roadResult.ok, true);
  assert.ok(roadResult.cost > 0);

  const zoneResult = core.paintZone([placement.zone], 'residential');
  assert.equal(zoneResult.painted, 1);

  const powerResult = core.placeUtility('power', placement.power.x, placement.power.y);
  const waterResult = core.placeUtility('water', placement.water.x, placement.water.y);
  assert.equal(powerResult.ok, true);
  assert.equal(waterResult.ok, true);

  core.step(250);
  assert.equal(core.clock.tick, 250);

  const flood = core.runDesignStorm({
    id: 'acceptance-storm',
    rainfallMm: 80,
    durationHours: 2,
  });
  assert.ok(flood.depthMeters.every((depth) => Number.isFinite(depth) && depth >= 0));
  assert.ok(Math.abs(flood.balanceError) <= Math.max(1e-9, flood.rainfallVolume * 1e-9));

  const saved = serializeCore(core);
  assert.equal(saved.saveVersion, 9);
  assert.equal(saved.gameVersion, '0.9.0-urban-fabric');

  const loaded = hydrateCore(structuredClone(saved));
  assert.deepEqual(loaded.world.snapshotAuthoritative(), core.world.snapshotAuthoritative());
  assert.deepEqual(serializeCore(loaded), saved);

  core.step(300);
  loaded.step(300);
  assert.deepEqual(serializeCore(loaded), serializeCore(core));

  console.log('PHASE1R_HEADLESS_ACCEPTANCE', {
    road: placement.road,
    zone: placement.zone,
    power: placement.power,
    water: placement.water,
    floodedCells: flood.depthMeters.filter((depth) => depth > 0).length,
    balanceError: flood.balanceError,
    finalTick: core.clock.tick,
  });
});
