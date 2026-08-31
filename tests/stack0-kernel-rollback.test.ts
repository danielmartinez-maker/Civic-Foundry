import test from 'node:test';
import assert from 'node:assert/strict';
import { SimulationClock } from '../src/simulation/core/SimulationClock.ts';
import { SimulationKernel } from '../src/simulation/kernel/SimulationKernel.ts';

test('failed kernel ticks restore authoritative participants and kernel sequencing exactly', () => {
  const clock = new SimulationClock();
  const kernel = new SimulationKernel({ clock, seed: 91 });
  const domain = { value: 7 };

  kernel.registerTransactionParticipant({
    id: 'test-domain',
    snapshot: () => domain.value,
    restore: (snapshot) => {
      domain.value = snapshot;
    },
  });
  kernel.commands.registerHandler('Mutate', (_command, context) => {
    domain.value = 11;
    context.events.append(context.tick, { type: 'CommandMutation', source: 'test', payload: { value: domain.value } });
    context.random.stream('rollback').next();
  });
  kernel.commands.enqueue({ type: 'Mutate', payload: null }, 1);
  kernel.registerSystem({
    id: 'forced-failure',
    reads: [],
    writes: ['test-domain'],
    cadence: { every: 1 },
    execute: (context) => {
      domain.value = 19;
      context.events.append(context.tick, { type: 'SystemMutation', source: 'test', payload: { value: domain.value } });
      context.random.stream('rollback').next();
      throw new Error('forced stack0 rollback failure');
    },
  });

  const commandsBefore = kernel.commands.snapshot();
  const eventsBefore = kernel.events.snapshot();
  const randomBefore = kernel.random.snapshot();

  assert.throws(() => kernel.step(1), /forced stack0 rollback failure/);
  assert.equal(clock.tick, 0);
  assert.equal(domain.value, 7);
  assert.deepEqual(kernel.commands.snapshot(), commandsBefore);
  assert.deepEqual(kernel.events.snapshot(), eventsBefore);
  assert.deepEqual(kernel.random.snapshot(), randomBefore);
  assert.equal(kernel.diagnosticSnapshot().faulted, true);
});
