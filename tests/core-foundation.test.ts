import test from 'node:test';
import assert from 'node:assert/strict';
import { SeededRandom } from '../src/simulation/core/SeededRandom.ts';
import { SimulationClock } from '../src/simulation/core/SimulationClock.ts';
import { TerrainGrid } from '../src/world/terrain/TerrainGrid.ts';
import { TreasurySystem } from '../src/simulation/treasury/TreasurySystem.ts';

test('seeded random reproduces the same sequence and state', () => {
  const a = new SeededRandom(12345);
  const b = new SeededRandom(12345);
  const seqA = [a.next(), a.next(), a.next(), a.next()];
  const seqB = [b.next(), b.next(), b.next(), b.next()];
  assert.deepEqual(seqA, seqB);
  const state = a.getState();
  const expected = a.next();
  a.setState(state);
  assert.equal(a.next(), expected);
});

test('terrain generation is deterministic and produces finite buildability data', () => {
  const a = TerrainGrid.generate(24, 16, 42);
  const b = TerrainGrid.generate(24, 16, 42);
  assert.deepEqual(a.snapshot(), b.snapshot());
  assert.equal(a.width, 24);
  assert.equal(a.height, 16);
  let buildable = 0;
  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      const cell = a.get(x, y);
      assert.ok(Number.isFinite(cell.elevation));
      if (cell.buildable) buildable++;
    }
  }
  assert.ok(buildable > 0 && buildable < a.width * a.height);
});

test('treasury refuses overspend and never becomes negative', () => {
  const treasury = new TreasurySystem(100);
  assert.equal(treasury.tryDebit(40, 'road'), true);
  assert.equal(treasury.balance, 60);
  assert.equal(treasury.tryDebit(61, 'too much'), false);
  assert.equal(treasury.balance, 60);
  treasury.credit(15, 'tax');
  assert.equal(treasury.balance, 75);
  assert.ok(treasury.transactions.length === 2);
});

test('simulation clock advances deterministically and supports explicit speed modes', () => {
  const clock = new SimulationClock();
  clock.setSpeed(4);
  clock.step(7);
  assert.equal(clock.tick, 7);
  assert.equal(clock.speed, 4);
  clock.setSpeed(0);
  clock.step(3);
  assert.equal(clock.tick, 10);
});
