import test from 'node:test';
import assert from 'node:assert/strict';
import { SystemScheduler } from '../src/simulation/kernel/SystemScheduler.ts';
import type { KernelSystemDefinition } from '../src/simulation/kernel/KernelTypes.ts';

const noop = (): void => {};

function system(id: string, options: Partial<KernelSystemDefinition> = {}): KernelSystemDefinition {
  return {
    id,
    reads: [],
    writes: [],
    cadence: { every: 1 },
    execute: noop,
    ...options,
  };
}

test('scheduler order is independent of registration order', () => {
  const a = new SystemScheduler();
  a.register(system('zeta'));
  a.register(system('alpha'));
  const b = new SystemScheduler();
  b.register(system('alpha'));
  b.register(system('zeta'));
  assert.deepEqual(a.compile().map((item) => item.id), ['alpha', 'zeta']);
  assert.deepEqual(b.compile().map((item) => item.id), ['alpha', 'zeta']);
});

test('order then ordinal id deterministically break ties for independent systems', () => {
  const scheduler = new SystemScheduler();
  scheduler.register(system('beta', { order: 5 }));
  scheduler.register(system('gamma', { order: -1 }));
  scheduler.register(system('alpha', { order: 5 }));
  assert.deepEqual(scheduler.compile().map((item) => item.id), ['gamma', 'alpha', 'beta']);
});

test('after and before dependencies constrain topological order', () => {
  const scheduler = new SystemScheduler();
  scheduler.register(system('analytics', { after: ['traffic'] }));
  scheduler.register(system('traffic'));
  scheduler.register(system('commands', { before: ['traffic'] }));
  assert.deepEqual(scheduler.compile().map((item) => item.id), ['commands', 'traffic', 'analytics']);
});

test('dueSystems honors cadence and offset', () => {
  const scheduler = new SystemScheduler();
  scheduler.register(system('every-tick'));
  scheduler.register(system('even', { cadence: { every: 2, offset: 0 } }));
  scheduler.register(system('odd', { cadence: { every: 2, offset: 1 } }));
  scheduler.register(system('five-offset-two', { cadence: { every: 5, offset: 2 } }));
  assert.deepEqual(scheduler.dueSystems(1).map((item) => item.id), ['every-tick', 'odd']);
  assert.deepEqual(scheduler.dueSystems(2).map((item) => item.id), ['even', 'every-tick', 'five-offset-two']);
  assert.deepEqual(scheduler.dueSystems(7).map((item) => item.id), ['every-tick', 'five-offset-two', 'odd']);
});

test('registration rejects invalid ids cadence domains and self dependencies', () => {
  const scheduler = new SystemScheduler();
  assert.throws(() => scheduler.register(system('')), /kernel system id must not be empty/);
  assert.throws(() => scheduler.register(system('bad-every', { cadence: { every: 0 } })), /invalid cadence/);
  assert.throws(() => scheduler.register(system('bad-offset', { cadence: { every: 2, offset: 2 } })), /invalid cadence/);
  assert.throws(() => scheduler.register(system('dup-read', { reads: ['traffic', 'traffic'] })), /duplicate read domain/);
  assert.throws(() => scheduler.register(system('dup-write', { writes: ['traffic', 'traffic'] })), /duplicate write domain/);
  assert.throws(() => scheduler.register(system('read-write', { reads: ['traffic'], writes: ['traffic'] })), /domain declared as read and write/);
  assert.throws(() => scheduler.register(system('self-after', { after: ['self-after'] })), /self dependency/);
  assert.throws(() => scheduler.register(system('self-before', { before: ['self-before'] })), /self dependency/);
});

test('registration rejects duplicate system ids', () => {
  const scheduler = new SystemScheduler();
  scheduler.register(system('traffic'));
  assert.throws(() => scheduler.register(system('traffic')), /duplicate kernel system: traffic/);
});

test('compile rejects unknown dependencies before execution', () => {
  const scheduler = new SystemScheduler();
  scheduler.register(system('traffic', { after: ['roads'] }));
  assert.throws(() => scheduler.compile(), /unknown kernel dependency: roads -> traffic/);
});

test('compile rejects dependency cycles and names participants', () => {
  const scheduler = new SystemScheduler();
  scheduler.register(system('a', { after: ['c'] }));
  scheduler.register(system('b', { after: ['a'] }));
  scheduler.register(system('c', { after: ['b'] }));
  assert.throws(() => scheduler.compile(), /kernel dependency cycle:.*a.*b.*c/);
});

test('overlapping same-domain writers require an explicit dependency path', () => {
  const scheduler = new SystemScheduler();
  scheduler.register(system('traffic-flow', { writes: ['traffic'] }));
  scheduler.register(system('road-closure', { writes: ['traffic'] }));
  assert.throws(() => scheduler.compile(), /ambiguous write conflict on domain traffic: road-closure, traffic-flow|ambiguous write conflict on domain traffic: traffic-flow, road-closure/);
});

test('explicit dependency path permits overlapping same-domain writers', () => {
  const scheduler = new SystemScheduler();
  scheduler.register(system('base', { writes: ['traffic'] }));
  scheduler.register(system('middle', { after: ['base'] }));
  scheduler.register(system('closure', { writes: ['traffic'], after: ['middle'] }));
  assert.deepEqual(scheduler.compile().map((item) => item.id), ['base', 'middle', 'closure']);
});

test('mathematically non-overlapping writers do not conflict', () => {
  const scheduler = new SystemScheduler();
  scheduler.register(system('even', { writes: ['market'], cadence: { every: 2, offset: 0 } }));
  scheduler.register(system('odd', { writes: ['market'], cadence: { every: 2, offset: 1 } }));
  assert.deepEqual(scheduler.compile().map((item) => item.id), ['even', 'odd']);
});

test('listSystems returns deterministic copies without depending on registration order', () => {
  const scheduler = new SystemScheduler();
  scheduler.register(system('z'));
  scheduler.register(system('a'));
  assert.deepEqual(scheduler.listSystems().map((item) => item.id), ['a', 'z']);
});
