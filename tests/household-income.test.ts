import test from 'node:test';
import assert from 'node:assert/strict';
import { HouseholdCohortSystem } from '../src/simulation/housing/HouseholdCohortSystem.ts';
import { HouseholdIncomeSystem } from '../src/simulation/housing/HouseholdIncomeSystem.ts';
import type { Firm } from '../src/simulation/economy/FirmSystem.ts';

function firm(id: string, archetype: Firm['archetype'], filledJobs: number, cashHealth = 0.8): Firm {
  return {
    id,
    buildingId: `building:${id}`,
    zone: archetype === 'retail_local' || archetype === 'wholesale_logistics' ? 'commercial' : 'industrial',
    archetype,
    status: 'operating',
    jobCapacity: Math.max(filledJobs, 20),
    filledJobs,
    vacancies: 0,
    productivity: 1,
    cashHealth,
    consecutiveLossCycles: 0,
    consecutiveRecoveryCycles: 0,
    formationTick: 0,
    lastOperatingMargin: 0,
  };
}

function householdsWithTwentyWorkers(): HouseholdCohortSystem {
  const households = new HouseholdCohortSystem();
  households.create({
    weight: 10,
    householdSize: 3,
    workers: 2,
    tenure: 'renter',
    buildingId: 'building:home',
    unitRequirement: 1,
    vehicleAccess: true,
    liquidSavings: 2_000,
    housingCost: 800,
  }, 0);
  return households;
}

test('employment matches actual filled firm job quotas exactly', () => {
  const households = householdsWithTwentyWorkers();
  const firms = [firm('firm:a', 'retail_local', 7), firm('firm:b', 'assembly_manufacturing', 5)];
  const snapshot = new HouseholdIncomeSystem().reconcile(households, firms);
  assert.equal(snapshot.totalWorkers, 20);
  assert.equal(snapshot.employedWorkers, 12);
  assert.equal(households.list().reduce((sum, h) => sum + h.employedWorkers * h.weight, 0), 12);
  assert.equal(households.list().reduce((sum, h) => sum + h.employerFirmIds.length * h.weight, 0), 12);
});

test('higher-wage firm archetypes produce higher household income for equal employment', () => {
  const retail = householdsWithTwentyWorkers();
  const assembly = householdsWithTwentyWorkers();
  const system = new HouseholdIncomeSystem();
  system.reconcile(retail, [firm('firm:r', 'retail_local', 10)]);
  system.reconcile(assembly, [firm('firm:a', 'assembly_manufacturing', 10)]);
  const retailIncome = retail.list().reduce((sum, h) => sum + h.grossIncome * h.weight, 0);
  const assemblyIncome = assembly.list().reduce((sum, h) => sum + h.grossIncome * h.weight, 0);
  assert.ok(assemblyIncome > retailIncome);
});

test('distressed firms still employ their filled quota while closed firms do not', () => {
  const households = householdsWithTwentyWorkers();
  const distressed = { ...firm('firm:d', 'light_manufacturing', 4, 0.3), status: 'distressed' as const };
  const closed = { ...firm('firm:c', 'assembly_manufacturing', 10), status: 'closed' as const };
  const snapshot = new HouseholdIncomeSystem().reconcile(households, [closed, distressed]);
  assert.equal(snapshot.employedWorkers, 4);
  assert.deepEqual(new Set(households.list().flatMap((h) => h.employerFirmIds)), new Set(['firm:d']));
});
