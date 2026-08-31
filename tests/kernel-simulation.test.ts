import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { SimulationClock } from '../src/simulation/core/SimulationClock.ts';
import { SimulationCore } from '../src/simulation/core/SimulationCore.ts';
import { SimulationKernel } from '../src/simulation/kernel/SimulationKernel.ts';
import { CommandBus } from '../src/simulation/kernel/CommandBus.ts';
import { DomainEventJournal } from '../src/simulation/kernel/DomainEventJournal.ts';
import { InvariantRunner } from '../src/simulation/kernel/InvariantRunner.ts';
import { RandomStreamRegistry } from '../src/simulation/kernel/RandomStreamRegistry.ts';
import { SnapshotRegistry } from '../src/simulation/kernel/SnapshotRegistry.ts';
import { SystemScheduler } from '../src/simulation/kernel/SystemScheduler.ts';
import type { KernelStepContext } from '../src/simulation/kernel/KernelTypes.ts';
import { TerrainGrid, type TerrainCell } from '../src/world/terrain/TerrainGrid.ts';

function flatTerrain(width = 40, height = 24): TerrainGrid {
  const cells: TerrainCell[] = Array.from({ length: width * height }, () => ({ elevation: 0.5, water: false, buildable: true, biome: 'grass' as const }));
  return new TerrainGrid(width, height, cells);
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

function measure(operation: () => void): number {
  const start = performance.now();
  operation();
  return performance.now() - start;
}

function samples(operation: () => void, count = 3): number[] {
  return Array.from({ length: count }, () => measure(operation));
}

function timeCityTicks(ticks: number): number {
  const core = new SimulationCore({ terrain: flatTerrain(), seed: 42, startingFunds: 5_000_000 });
  core.step(100);
  const start = performance.now();
  core.step(ticks);
  return performance.now() - start;
}

test('kernel advances shared clock and executes due systems exactly once per tick', () => {
  const clock = new SimulationClock();
  const kernel = new SimulationKernel({ clock, seed: 42 });
  const seen: number[] = [];
  kernel.registerSystem({ id: 'every-tick', reads: [], writes: ['test'], cadence: { every: 1 }, execute: ({ tick }) => seen.push(tick) });
  kernel.step(3);
  assert.equal(clock.tick, 3);
  assert.deepEqual(seen, [1, 2, 3]);
});

test('kernel fixed tick order is clock then commands then systems then invariants', () => {
  const clock = new SimulationClock();
  const kernel = new SimulationKernel({ clock, seed: 7 });
  const order: string[] = [];
  kernel.commands.registerHandler('Ping', (command, context) => order.push(`command:${command.sequence}:${context.tick}`));
  kernel.commands.enqueue({ type: 'Ping', payload: null }, 1);
  kernel.registerSystem({ id: 'system', reads: [], writes: ['test'], cadence: { every: 1 }, execute: ({ tick }) => order.push(`system:${tick}`) });
  kernel.invariants.register({ id: 'test-order', cadence: { every: 1 }, check: ({ tick }) => order.push(`invariant:${tick}`) });
  kernel.step(1);
  assert.deepEqual(order, ['command:1:1', 'system:1', 'invariant:1']);
});

test('kernel validates requested tick count before any state mutation', () => {
  for (const ticks of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    const clock = new SimulationClock();
    const kernel = new SimulationKernel({ clock, seed: 1 });
    assert.throws(() => kernel.step(ticks), /ticks must be a non-negative integer/);
    assert.equal(clock.tick, 0);
  }
  const clock = new SimulationClock();
  const kernel = new SimulationKernel({ clock, seed: 1 });
  kernel.step(0);
  assert.equal(clock.tick, 0);
});

test('invalid scheduler configuration fails before a tick advances', () => {
  const clock = new SimulationClock();
  const kernel = new SimulationKernel({ clock, seed: 1 });
  kernel.registerSystem({ id: 'a', reads: [], writes: ['shared'], cadence: { every: 1 }, execute: () => {} });
  kernel.registerSystem({ id: 'b', reads: [], writes: ['shared'], cadence: { every: 1 }, execute: () => {} });
  assert.throws(() => kernel.step(1), /ambiguous write conflict/);
  assert.equal(clock.tick, 0);
});

test('registering after compile invalidates and recompiles scheduler once before next tick', () => {
  const clock = new SimulationClock();
  const kernel = new SimulationKernel({ clock, seed: 1 });
  const seen: string[] = [];
  kernel.registerSystem({ id: 'a', reads: [], writes: ['a'], cadence: { every: 1 }, execute: () => seen.push('a') });
  kernel.compile();
  kernel.step(1);
  kernel.registerSystem({ id: 'b', reads: [], writes: ['b'], cadence: { every: 1 }, execute: () => seen.push('b') });
  kernel.step(1);
  assert.deepEqual(seen, ['a', 'a', 'b']);
  assert.equal(clock.tick, 2);
});

test('kernel exposes built-in clock invariant and deterministic diagnostic snapshot', () => {
  const clock = new SimulationClock();
  const kernel = new SimulationKernel({ clock, seed: 9 });
  kernel.registerSystem({ id: 'zeta', reads: [], writes: ['z'], cadence: { every: 1 }, execute: () => {} });
  kernel.registerSystem({ id: 'alpha', reads: [], writes: ['a'], cadence: { every: 2 }, execute: () => {} });
  kernel.random.stream('traffic').next();
  kernel.events.append(0, { type: 'Diagnostic', source: 'test', payload: { ok: true } });
  kernel.commands.registerHandler('Future', () => {});
  kernel.commands.enqueue({ type: 'Future', payload: null }, 5);
  const snapshot = kernel.diagnosticSnapshot();
  assert.deepEqual(snapshot.systems, ['alpha', 'zeta']);
  assert.equal(snapshot.tick, 0);
  assert.equal(snapshot.pendingCommands, 1);
  assert.equal(snapshot.nextCommandSequence, 2);
  assert.equal(snapshot.retainedEvents, 1);
  assert.equal(snapshot.nextEventSequence, 2);
  assert.deepEqual(Object.keys(snapshot.randomStreams as Record<string, number>), ['traffic']);
  assert.ok(kernel.invariants.list().some((item) => item.id === 'kernel-clock-valid'));
  assert.deepEqual(kernel.snapshots.capture('kernel'), snapshot);
});

test('system exceptions roll back the current tick and prevent later systems', () => {
  const clock = new SimulationClock();
  const kernel = new SimulationKernel({ clock, seed: 1 });
  const seen: string[] = [];
  kernel.registerSystem({ id: 'a-fail', reads: [], writes: ['a'], cadence: { every: 1 }, execute: () => { seen.push('fail'); throw new Error('system boom'); } });
  kernel.registerSystem({ id: 'z-later', reads: [], writes: ['z'], cadence: { every: 1 }, execute: () => seen.push('later') });
  assert.throws(() => kernel.step(1), /system boom/);
  assert.equal(clock.tick, 0);
  assert.deepEqual(seen, ['fail']);
});

test('Phase 0A compatibility stepping remains finite across repeated deterministic headless runs', () => {
  const values = [timeCityTicks(1_000), timeCityTicks(1_000), timeCityTicks(1_000)];
  assert.ok(values.every((value) => Number.isFinite(value) && value >= 0));
  console.log('PHASE0A_KERNEL_CITY_BENCHMARK', JSON.stringify({ ticks: 1_000, samplesMs: values.map((value) => Number(value.toFixed(2))), medianMs: Number(median(values).toFixed(2)) }));
});

test('Phase 0A profiles per-tick kernel collection overhead without changing behavior', () => {
  const iterations = 100_000;
  const rawClock = samples(() => {
    const clock = new SimulationClock();
    for (let i = 0; i < iterations; i++) clock.step(1);
  });

  const emptyKernel = samples(() => {
    const kernel = new SimulationKernel({ clock: new SimulationClock(), seed: 1 });
    kernel.step(iterations);
  });

  const oneSystemKernel = samples(() => {
    const kernel = new SimulationKernel({ clock: new SimulationClock(), seed: 1 });
    kernel.registerSystem({ id: 'noop', reads: [], writes: ['noop'], cadence: { every: 1 }, execute: () => {} });
    kernel.step(iterations);
  });

  const bus = new CommandBus();
  const events = new DomainEventJournal();
  const random = new RandomStreamRegistry(1);
  const snapshots = new SnapshotRegistry();
  const context: KernelStepContext = { tick: 0, commands: bus, events, random, snapshots };
  const emptyCommandBus = samples(() => {
    for (let i = 0; i < iterations; i++) bus.dispatchReady(i, context);
  });

  const scheduler = new SystemScheduler();
  scheduler.register({ id: 'noop', reads: [], writes: ['noop'], cadence: { every: 1 }, execute: () => {} });
  scheduler.compile();
  const dueSystems = samples(() => {
    for (let i = 1; i <= iterations; i++) scheduler.dueSystems(i);
  });

  const invariantRunner = new InvariantRunner();
  invariantRunner.register({ id: 'noop', cadence: { every: 1 }, check: () => {} });
  const invariants = samples(() => {
    for (let i = 1; i <= iterations; i++) invariantRunner.runDue(i, context);
  });

  const result = {
    iterations,
    rawClockMedianMs: Number(median(rawClock).toFixed(2)),
    emptyKernelMedianMs: Number(median(emptyKernel).toFixed(2)),
    oneSystemKernelMedianMs: Number(median(oneSystemKernel).toFixed(2)),
    emptyCommandBusMedianMs: Number(median(emptyCommandBus).toFixed(2)),
    dueSystemsMedianMs: Number(median(dueSystems).toFixed(2)),
    invariantRunnerMedianMs: Number(median(invariants).toFixed(2)),
  };
  assert.ok(Object.values(result).every((value) => Number.isFinite(value)));
  console.log('PHASE0A_KERNEL_HOT_PATH_PROFILE', JSON.stringify(result));
});