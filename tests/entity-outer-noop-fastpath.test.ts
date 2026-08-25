import test from 'node:test';
import assert from 'node:assert/strict';
import { SimulationCore } from '../src/simulation/core/SimulationCore.ts';
import { TerrainGrid, type TerrainCell } from '../src/world/terrain/TerrainGrid.ts';
import type { EntityProjectionPartition } from '../src/entities/EntityProjection.ts';

function flat(width = 12, height = 8): TerrainGrid {
  const cells: TerrainCell[] = Array.from({ length: width * height }, () => ({
    elevation: 0.5,
    water: false,
    buildable: true,
    biome: 'grass' as const,
  }));
  return new TerrainGrid(width, height, cells);
}

type ProjectorProbe = {
  projectPartitions: (source: SimulationCore) => readonly EntityProjectionPartition[];
};

test('projectPartitions reuses the same frozen array when every partition object is unchanged', () => {
  const core = new SimulationCore({ terrain: flat(), seed: 401 });
  const projector = (core as unknown as { entityProjector: ProjectorProbe }).entityProjector;

  const first = projector.projectPartitions(core);
  const second = projector.projectPartitions(core);

  assert.equal(Object.isFrozen(first), true);
  assert.strictEqual(second, first, 'unchanged partition sets should reuse aggregate array identity');
});

test('projectPartitions returns a new aggregate array when a partition revision changes', () => {
  const core = new SimulationCore({ terrain: flat(), startingFunds: 100_000, seed: 402 });
  const projector = (core as unknown as { entityProjector: ProjectorProbe }).entityProjector;
  const before = projector.projectPartitions(core);

  assert.equal(core.buildRoad([{ x: 2, y: 4 }, { x: 3, y: 4 }, { x: 4, y: 4 }], 'local').ok, true);
  core.paintZone([{ x: 3, y: 3 }], 'residential');
  const after = projector.projectPartitions(core);

  assert.notStrictEqual(after, before, 'a changed partition must invalidate aggregate array identity');
  assert.notStrictEqual(after.find((partition) => partition.id === 'lots'), before.find((partition) => partition.id === 'lots'));
});

test('core skips coordinator iteration when projector returns the last successfully committed partition array', () => {
  const core = new SimulationCore({ terrain: flat(), seed: 403 });
  const projector = (core as unknown as { entityProjector: ProjectorProbe }).entityProjector;
  const original = projector.projectPartitions.bind(projector);
  const stable = original(core);
  let iterations = 0;
  const counted = new Proxy(stable, {
    get(target, property, receiver) {
      if (property === Symbol.iterator) {
        return function* () {
          iterations++;
          yield* target;
        };
      }
      return Reflect.get(target, property, receiver);
    },
  });
  projector.projectPartitions = () => counted;

  core.rebuildEntityProjection();
  const afterFirst = iterations;
  core.rebuildEntityProjection();

  assert.ok(afterFirst > 0, 'first new aggregate identity should enter coordinator once');
  assert.equal(iterations, afterFirst, 'same successfully committed aggregate identity must bypass coordinator');
});
