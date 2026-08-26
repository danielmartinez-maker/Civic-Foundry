import assert from 'node:assert/strict';
import test from 'node:test';
import { PersonBootstrapSystem } from '../src/simulation/people/PersonBootstrapSystem.ts';

test('bootstrap creates exactly one persistent person per legacy resident', () => {
  const system = new PersonBootstrapSystem(1234);
  const people = system.bootstrapPopulation({ population: 100, simulationStartTick: 10_000 });
  assert.equal(people.length, 100);
  assert.equal(new Set(people.map((person) => person.id)).size, 100);
  assert.equal(people[0]?.id, 'person:1');
  assert.equal(people.at(-1)?.id, 'person:100');
  assert.ok(people.every((person) => person.provenance === 'bootstrap_background'));
  assert.ok(people.every((person) => person.alive && person.resident));
  assert.ok(people.every((person) => person.birthTick <= 10_000));
});

test('bootstrap is deterministic for the same seed and inputs and isolated across seeds', () => {
  const a = new PersonBootstrapSystem(99).bootstrapPopulation({ population: 25, simulationStartTick: 500 });
  const b = new PersonBootstrapSystem(99).bootstrapPopulation({ population: 25, simulationStartTick: 500 });
  const c = new PersonBootstrapSystem(100).bootstrapPopulation({ population: 25, simulationStartTick: 500 });
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
});

test('bootstrap creates no people for zero population', () => {
  const people = new PersonBootstrapSystem(1).bootstrapPopulation({ population: 0, simulationStartTick: 0 });
  assert.deepEqual(people, []);
});

test('bootstrap rejects invalid population and simulation ticks', () => {
  const system = new PersonBootstrapSystem(1);
  assert.throws(() => system.bootstrapPopulation({ population: -1, simulationStartTick: 0 }), /population/i);
  assert.throws(() => system.bootstrapPopulation({ population: 1.5, simulationStartTick: 0 }), /population/i);
  assert.throws(() => system.bootstrapPopulation({ population: 1, simulationStartTick: Number.NaN }), /simulationStartTick/i);
});
