import test from 'node:test';
import assert from 'node:assert/strict';
import { SimulationCore } from '../src/simulation/core/SimulationCore.ts';
import { SimulationKernel } from '../src/simulation/kernel/SimulationKernel.ts';
import { serializeCoreV7, hydrateCoreV7 } from '../src/save/saveV7.ts';

test('SimulationCore retains the Phase 0A compatibility system and adds ordered Phase 0B entity sync', () => {
  const core = new SimulationCore({ width: 12, height: 8, seed: 41 });
  assert.ok(core.kernel instanceof SimulationKernel);
  assert.equal(core.kernel.clock, core.clock);
  assert.deepEqual(core.kernel.scheduler.listSystems().map((system) => system.id), ['entity-registry-sync', 'legacy-v7-city']);
  assert.deepEqual(core.kernel.scheduler.dueSystems(1).map((system) => system.id), ['legacy-v7-city', 'entity-registry-sync']);
});

test('SimulationCore step delegates clock advancement to its kernel', () => {
  const core = new SimulationCore({ width: 12, height: 8, seed: 42 });
  let clockSteps = 0;
  const originalStep = core.clock.step.bind(core.clock);
  core.clock.step = (ticks = 1): void => {
    clockSteps += ticks;
    originalStep(ticks);
  };
  core.step(7);
  assert.equal(core.clock.tick, 7);
  assert.equal(clockSteps, 7);
  assert.equal(core.kernel.diagnosticSnapshot().tick, 7);
});

test('Save V7 excludes all Phase 0A and Phase 0B diagnostic infrastructure', () => {
  const core = new SimulationCore({ width: 12, height: 8, seed: 43 });
  core.kernel.random.stream('diagnostic').next();
  core.kernel.events.append(0, { type: 'Diagnostic', source: 'test', payload: { value: 1 } });
  const save = serializeCoreV7(core) as unknown as Record<string, unknown>;
  for (const key of [
    'kernel', 'commands', 'events', 'randomStreams', 'invariants', 'snapshots',
    'entityRegistry', 'entityReferences', 'entityDiagnostics', 'entityHistory', 'unresolvedEntityReferences',
  ]) {
    assert.equal(Object.hasOwn(save, key), false, `Save V7 unexpectedly contains ${key}`);
  }
});

test('hydrated V7 core receives fresh derived infrastructure around the restored shared clock', () => {
  const original = new SimulationCore({ width: 12, height: 8, seed: 44 });
  original.step(75);
  const save = serializeCoreV7(original);
  const hydrated = hydrateCoreV7(save);
  assert.equal(hydrated.clock.tick, 75);
  assert.equal(hydrated.kernel.clock, hydrated.clock);
  assert.equal(hydrated.kernel.diagnosticSnapshot().tick, 75);
  assert.equal(hydrated.kernel.events.list().length, 0);
  assert.deepEqual(hydrated.kernel.random.listNames(), []);
  assert.deepEqual(hydrated.entityRegistry.snapshot(), original.entityRegistry.snapshot());
  assert.deepEqual(hydrated.entityReferences.snapshot(), original.entityReferences.snapshot());
  original.step(25);
  hydrated.step(25);
  assert.deepEqual(serializeCoreV7(hydrated), serializeCoreV7(original));
});
