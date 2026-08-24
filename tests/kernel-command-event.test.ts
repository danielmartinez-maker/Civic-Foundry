import test from 'node:test';
import assert from 'node:assert/strict';
import { CommandBus } from '../src/simulation/kernel/CommandBus.ts';
import { DomainEventJournal } from '../src/simulation/kernel/DomainEventJournal.ts';
import type { KernelStepContext } from '../src/simulation/kernel/KernelTypes.ts';

function context(bus: CommandBus, events = new DomainEventJournal(), tick = 1): KernelStepContext {
  return { tick, commands: bus, events, random: {}, snapshots: {} };
}

test('command sequences are monotonic and FIFO across command types', () => {
  const bus = new CommandBus();
  const seen: number[] = [];
  bus.registerHandler('a', (command) => seen.push(command.sequence));
  bus.registerHandler('b', (command) => seen.push(command.sequence));
  assert.equal(bus.enqueue({ type: 'b', payload: { value: 1 } }, 1), 1);
  assert.equal(bus.enqueue({ type: 'a', payload: { value: 2 } }, 1), 2);
  assert.equal(bus.enqueue({ type: 'b', payload: { value: 3 } }, 1), 3);
  const dispatched = bus.dispatchReady(1, context(bus));
  assert.deepEqual(seen, [1, 2, 3]);
  assert.deepEqual(dispatched.map((item) => item.sequence), [1, 2, 3]);
  assert.equal(bus.getNextSequence(), 4);
});

test('queued command payload is deeply isolated from later external mutation', () => {
  const bus = new CommandBus();
  const payload = { nested: { value: 1 }, rows: [{ count: 2 }] };
  bus.enqueue({ type: 'x', payload }, 1);
  payload.nested.value = 7;
  payload.rows[0]!.count = 9;
  const queued = bus.pending()[0]!;
  assert.deepEqual(queued.command.payload, { nested: { value: 1 }, rows: [{ count: 2 }] });
  assert.equal(Object.isFrozen(queued.command.payload), true);
});

test('future-tick commands remain pending until eligible', () => {
  const bus = new CommandBus();
  const seen: number[] = [];
  bus.registerHandler('future', (command) => seen.push(command.sequence));
  bus.enqueue({ type: 'future', payload: {} }, 5);
  bus.enqueue({ type: 'future', payload: {} }, 2);
  assert.deepEqual(bus.dispatchReady(1, context(bus, undefined, 1)), []);
  assert.deepEqual(bus.pending().map((item) => item.sequence), [1, 2]);
  bus.dispatchReady(2, context(bus, undefined, 2));
  assert.deepEqual(seen, [2]);
  assert.deepEqual(bus.pending().map((item) => item.sequence), [1]);
  bus.dispatchReady(5, context(bus, undefined, 5));
  assert.deepEqual(seen, [2, 1]);
  assert.deepEqual(bus.pending(), []);
});

test('commands enqueued during dispatch wait for the next drain', () => {
  const bus = new CommandBus();
  const seen: number[] = [];
  bus.registerHandler('root', (command) => {
    seen.push(command.sequence);
    bus.enqueue({ type: 'child', payload: {} }, command.enqueuedTick);
  });
  bus.registerHandler('child', (command) => seen.push(command.sequence));
  bus.enqueue({ type: 'root', payload: {} }, 1);
  bus.dispatchReady(1, context(bus));
  assert.deepEqual(seen, [1]);
  assert.deepEqual(bus.pending().map((item) => item.sequence), [2]);
  bus.dispatchReady(1, context(bus));
  assert.deepEqual(seen, [1, 2]);
});

test('duplicate command handlers are rejected', () => {
  const bus = new CommandBus();
  bus.registerHandler('BuildRoad', () => {});
  assert.throws(() => bus.registerHandler('BuildRoad', () => {}), /duplicate command handler: BuildRoad/);
  assert.throws(() => bus.registerHandler('', () => {}), /command type must not be empty/);
});

test('handler exceptions abort the drain and restore undispatched ready commands', () => {
  const bus = new CommandBus();
  const seen: number[] = [];
  bus.registerHandler('ok', (command) => seen.push(command.sequence));
  bus.registerHandler('explode', (command) => {
    seen.push(command.sequence);
    throw new Error('boom');
  });
  bus.enqueue({ type: 'ok', payload: {} }, 1);
  bus.enqueue({ type: 'explode', payload: {} }, 1);
  bus.enqueue({ type: 'ok', payload: {} }, 1);
  assert.throws(() => bus.dispatchReady(1, context(bus)), /boom/);
  assert.deepEqual(seen, [1, 2]);
  assert.deepEqual(bus.pending().map((item) => item.sequence), [3]);
});

test('missing handler fails without silently dropping later ready commands', () => {
  const bus = new CommandBus();
  const seen: number[] = [];
  bus.registerHandler('ok', (command) => seen.push(command.sequence));
  bus.enqueue({ type: 'missing', payload: {} }, 1);
  bus.enqueue({ type: 'ok', payload: {} }, 1);
  assert.throws(() => bus.dispatchReady(1, context(bus)), /no command handler: missing/);
  assert.deepEqual(seen, []);
  assert.deepEqual(bus.pending().map((item) => item.sequence), [2]);
});

test('command enqueue and dispatch reject invalid ticks and empty types', () => {
  const bus = new CommandBus();
  assert.throws(() => bus.enqueue({ type: '', payload: {} }, 0), /command type must not be empty/);
  assert.throws(() => bus.enqueue({ type: 'x', payload: {} }, -1), /command tick must be a non-negative integer/);
  assert.throws(() => bus.enqueue({ type: 'x', payload: {} }, 1.5), /command tick must be a non-negative integer/);
  assert.throws(() => bus.dispatchReady(-1, context(bus)), /command tick must be a non-negative integer/);
});

test('domain events preserve monotonic sequence and stable append order', () => {
  const journal = new DomainEventJournal();
  const first = journal.append(3, { type: 'FirmOpened', source: 'economy', payload: { id: 'a' } });
  const second = journal.append(3, { type: 'FirmClosed', source: 'economy', payload: { id: 'b' } });
  assert.equal(first.sequence, 1);
  assert.equal(second.sequence, 2);
  assert.deepEqual(journal.list().map((event) => event.type), ['FirmOpened', 'FirmClosed']);
  assert.equal(journal.getNextSequence(), 3);
});

test('event since filtering and diagnostic clear do not rewind sequence', () => {
  const journal = new DomainEventJournal();
  journal.append(1, { type: 'a', source: 'test', payload: {} });
  journal.append(2, { type: 'b', source: 'test', payload: {} });
  journal.append(3, { type: 'c', source: 'test', payload: {} });
  assert.deepEqual(journal.since(1).map((event) => event.sequence), [2, 3]);
  journal.clearDiagnosticHistory();
  assert.deepEqual(journal.list(), []);
  assert.equal(journal.getNextSequence(), 4);
  assert.equal(journal.append(4, { type: 'd', source: 'test', payload: {} }).sequence, 4);
});

test('event payload is deeply isolated from later external mutation', () => {
  const journal = new DomainEventJournal();
  const payload = { nested: { value: 1 }, rows: [{ count: 2 }] };
  const event = journal.append(5, { type: 'x', source: 'test', payload });
  payload.nested.value = 2;
  payload.rows[0]!.count = 9;
  assert.deepEqual(event.payload, { nested: { value: 1 }, rows: [{ count: 2 }] });
  assert.equal(Object.isFrozen(event.payload), true);
});

test('domain event journal validates event identity and tick', () => {
  const journal = new DomainEventJournal();
  assert.throws(() => journal.append(-1, { type: 'x', source: 'test', payload: {} }), /event tick must be a non-negative integer/);
  assert.throws(() => journal.append(1.5, { type: 'x', source: 'test', payload: {} }), /event tick must be a non-negative integer/);
  assert.throws(() => journal.append(1, { type: '', source: 'test', payload: {} }), /event type must not be empty/);
  assert.throws(() => journal.append(1, { type: 'x', source: '', payload: {} }), /event source must not be empty/);
});
