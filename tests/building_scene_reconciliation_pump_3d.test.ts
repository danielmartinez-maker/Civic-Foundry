import assert from 'node:assert/strict';
import test from 'node:test';
import type { WorldPresentationSnapshot } from '../src/rendering/3d/presentation/PresentationTypes.ts';
import { BuildingSceneReconciliationPump } from '../src/rendering/3d/scene/BuildingSceneReconciliationPump.ts';

function snapshot(world: number): WorldPresentationSnapshot {
  return Object.freeze({
    revision: Object.freeze({ world, buildings: world, environment: 0 }),
    visualTime: 'day',
    buildings: Object.freeze([]),
    dirty: Object.freeze({
      structuralBuildings: Object.freeze([]),
      appearanceBuildings: Object.freeze([]),
      removedBuildings: Object.freeze([]),
    }),
  });
}

function deferred(): Readonly<{ promise: Promise<void>; resolve(): void }> {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return Object.freeze({ promise, resolve });
}

test('building reconciliation is serialized and coalesces queued frames to the newest snapshot', async () => {
  const first = deferred();
  const calls: number[] = [];
  let active = 0;
  let maxActive = 0;
  const pump = new BuildingSceneReconciliationPump({
    applySnapshot: async (next) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      calls.push(next.revision.world);
      if (next.revision.world === 1) await first.promise;
      active -= 1;
    },
  });

  pump.submit(snapshot(1), Object.freeze({ x: 0, y: 10, z: 0 }));
  await Promise.resolve();
  pump.submit(snapshot(2), Object.freeze({ x: 1, y: 10, z: 0 }));
  pump.submit(snapshot(3), Object.freeze({ x: 2, y: 10, z: 0 }));

  assert.deepEqual(calls, [1]);
  first.resolve();
  await pump.whenIdle();

  assert.deepEqual(calls, [1, 3]);
  assert.equal(maxActive, 1);
  pump.dispose();
});

test('reconciliation errors are reported without wedging a newer pending snapshot', async () => {
  const first = deferred();
  const calls: number[] = [];
  const errors: string[] = [];
  const pump = new BuildingSceneReconciliationPump({
    applySnapshot: async (next) => {
      calls.push(next.revision.world);
      if (next.revision.world === 1) {
        await first.promise;
        throw new Error('asset load failed');
      }
    },
    onError: (error) => errors.push(error instanceof Error ? error.message : String(error)),
  });

  pump.submit(snapshot(1), Object.freeze({ x: 0, y: 10, z: 0 }));
  await Promise.resolve();
  pump.submit(snapshot(2), Object.freeze({ x: 0, y: 10, z: 1 }));
  first.resolve();
  await pump.whenIdle();

  assert.deepEqual(calls, [1, 2]);
  assert.deepEqual(errors, ['asset load failed']);
  pump.dispose();
});

test('dispose drops queued reconciliation work and future submissions', async () => {
  const first = deferred();
  const calls: number[] = [];
  const pump = new BuildingSceneReconciliationPump({
    applySnapshot: async (next) => {
      calls.push(next.revision.world);
      if (next.revision.world === 1) await first.promise;
    },
  });

  pump.submit(snapshot(1), Object.freeze({ x: 0, y: 10, z: 0 }));
  await Promise.resolve();
  pump.submit(snapshot(2), Object.freeze({ x: 0, y: 10, z: 1 }));
  pump.dispose();
  pump.submit(snapshot(3), Object.freeze({ x: 0, y: 10, z: 2 }));
  first.resolve();
  await pump.whenIdle();

  assert.deepEqual(calls, [1]);
});
