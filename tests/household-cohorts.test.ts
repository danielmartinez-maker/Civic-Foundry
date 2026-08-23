import test from 'node:test';
import assert from 'node:assert/strict';
import { HouseholdCohortSystem } from '../src/simulation/housing/HouseholdCohortSystem.ts';

const base = {
  weight: 10,
  householdSize: 3,
  workers: 2,
  employedWorkers: 1,
  employerFirmIds: ['firm:1'],
  grossIncome: 4_000,
  disposableHousingIncome: 3_200,
  employmentStability: 0.7,
  tenure: 'renter' as const,
  buildingId: 'building:a',
  unitRequirement: 1,
  vehicleAccess: true,
  liquidSavings: 8_000,
  housingCost: 900,
};

test('split preserves represented households population income and savings', () => {
  const system = new HouseholdCohortSystem();
  const original = system.create(base, 0);
  const split = system.split(original.id, 3, 'capacity');
  assert.equal(split.branch.weight, 3);
  assert.equal(split.remainder.weight, 7);
  assert.equal(split.remainder.id, original.id);
  assert.notEqual(split.branch.id, original.id);
  assert.equal(system.representedHouseholds(), 10);
  assert.equal(system.residentPopulation(), 30);
  assert.equal(system.list().reduce((sum, h) => sum + h.grossIncome * h.weight, 0), 40_000);
  assert.equal(system.list().reduce((sum, h) => sum + h.liquidSavings * h.weight, 0), 80_000);
});

test('compatible stable cohorts merge into the lexical survivor without losing state', () => {
  const system = new HouseholdCohortSystem();
  const a = system.create(base, 0);
  const b = system.create(base, 0);
  assert.equal(system.mergeCompatible(), 1);
  const [survivor] = system.list();
  assert.equal(survivor!.id, [a.id, b.id].sort()[0]);
  assert.equal(survivor!.weight, 20);
  assert.equal(system.representedHouseholds(), 20);
  assert.equal(system.residentPopulation(), 60);
});

test('assignment search displacement and removal preserve household identity', () => {
  const system = new HouseholdCohortSystem();
  const household = system.create({ ...base, weight: 1 }, 10);
  system.assignResidence(household.id, 'building:b', 'owner', 1_100, null, 'purchase');
  let current = system.get(household.id)!;
  assert.equal(current.buildingId, 'building:b');
  assert.equal(current.tenure, 'owner');
  assert.equal(current.searchState, 'stable');
  assert.equal(current.lastMoveReason, 'purchase');

  system.markSearching(household.id, 'job-loss');
  current = system.get(household.id)!;
  assert.equal(current.searchState, 'searching');
  assert.equal(current.lastMoveReason, 'job-loss');

  system.markDisplaced(household.id, 'redevelopment');
  current = system.get(household.id)!;
  assert.equal(current.buildingId, null);
  assert.equal(current.tenure, 'seeking');
  assert.equal(current.displacementState, 'displaced');
  assert.equal(current.searchState, 'searching');

  const removed = system.remove(household.id);
  assert.equal(removed?.id, household.id);
  assert.equal(system.get(household.id), undefined);
});

test('split rejects invalid weights and restore validates before mutation', () => {
  const system = new HouseholdCohortSystem();
  const original = system.create(base, 0);
  assert.throws(() => system.split(original.id, 0, 'invalid'), /split weight/i);
  assert.throws(() => system.split(original.id, original.weight, 'invalid'), /split weight/i);

  const snapshot = system.snapshotState();
  const corrupt = structuredClone(snapshot) as { households: Array<{ id: string; weight: number }> ; nextId: number };
  corrupt.households.push({ ...corrupt.households[0]!, id: corrupt.households[0]!.id });
  assert.throws(() => system.restoreState(corrupt as never), /duplicate household id/i);
  assert.equal(system.list().length, 1);
});
