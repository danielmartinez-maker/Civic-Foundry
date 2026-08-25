import test from 'node:test';
import assert from 'node:assert/strict';
import { SimulationCore } from '../src/simulation/core/SimulationCore.ts';
import { TerrainGrid, type TerrainCell } from '../src/world/terrain/TerrainGrid.ts';

function flat(width = 12, height = 8): TerrainGrid {
  const cells: TerrainCell[] = Array.from({ length: width * height }, () => ({
    elevation: 0.5,
    water: false,
    buildable: true,
    biome: 'grass' as const,
  }));
  return new TerrainGrid(width, height, cells);
}

type CoreInternals = SimulationCore & {
  syncEntityProjection: () => void;
  entityProjector: {
    projectPartitions: (source: SimulationCore) => readonly unknown[];
  };
};

test('unchanged authoritative entity revisions skip projector polling entirely', () => {
  const core = new SimulationCore({ terrain: flat(), seed: 77 }) as CoreInternals;
  const projector = core.entityProjector;
  const original = projector.projectPartitions.bind(projector);
  let calls = 0;
  projector.projectPartitions = (source) => {
    calls++;
    return original(source);
  };

  core.step(1);

  assert.equal(calls, 0, 'stable entity revisions should bypass projectPartitions');
  assert.equal(core.clock.tick, 1);
});

test('explicit entity projection rebuild still forces projector work when revisions are unchanged', () => {
  const core = new SimulationCore({ terrain: flat(), seed: 78 }) as CoreInternals;
  const projector = core.entityProjector;
  const original = projector.projectPartitions.bind(projector);
  let calls = 0;
  projector.projectPartitions = (source) => {
    calls++;
    return original(source);
  };

  core.rebuildEntityProjection();

  assert.equal(calls, 1, 'forced rebuild must not be hidden by the revision fast path');
});

test('failed entity sync does not advance the successful revision gate', () => {
  const core = new SimulationCore({ terrain: flat(), seed: 79 }) as CoreInternals;
  core.buildRoad([{ x: 1, y: 3 }, { x: 2, y: 3 }, { x: 3, y: 3 }], 'local');

  const projector = core.entityProjector;
  const original = projector.projectPartitions.bind(projector);
  let calls = 0;
  projector.projectPartitions = (source) => {
    calls++;
    if (calls === 1) throw new Error('synthetic projection failure');
    return original(source);
  };

  assert.throws(() => core.syncEntityProjection(), /synthetic projection failure/);
  core.syncEntityProjection();

  assert.equal(calls, 2, 'same authoritative revision must retry after a failed sync');
});
