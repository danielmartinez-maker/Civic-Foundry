import test from 'node:test';
import assert from 'node:assert/strict';
import { HouseholdCohortSystem } from '../src/simulation/housing/HouseholdCohortSystem.ts';
import { HousingChoiceSystem } from '../src/simulation/housing/HousingChoiceSystem.ts';
import type { HousingCandidate } from '../src/simulation/housing/HousingTypes.ts';

function household(grossIncome: number, liquidSavings = 20_000, vehicleAccess = false) {
  const cohorts = new HouseholdCohortSystem();
  return cohorts.create({
    weight: 1,
    householdSize: 2,
    workers: 1,
    employedWorkers: 1,
    grossIncome,
    disposableHousingIncome: grossIncome * 0.8,
    employmentStability: 0.8,
    tenure: 'renter',
    buildingId: 'building:current',
    unitRequirement: 1,
    vehicleAccess,
    liquidSavings,
    housingCost: Math.min(900, grossIncome * 0.3),
  }, 0);
}

function candidate(overrides: Partial<HousingCandidate> = {}): HousingCandidate {
  return {
    buildingId: 'building:candidate',
    tenure: 'renter',
    housingCost: 900,
    askingPrice: 0,
    availableUnits: 1,
    residentsPerUnit: 3,
    accessibility: 0.7,
    services: 0.7,
    neighborhood: 0.7,
    quality: 0.7,
    density: 0.6,
    overcrowdingRatio: 0,
    displacementRisk: 0,
    ...overrides,
  };
}

test('severe rent burden is rejected even with superior location utility', () => {
  const result = new HousingChoiceSystem().evaluateCandidate(
    household(2_000),
    candidate({ housingCost: 1_200, accessibility: 1, services: 1, neighborhood: 1, quality: 1 }),
    { marketInterestRate: 0.05, voluntaryMove: true },
  );
  assert.equal(result.eligible, false);
  assert.ok(result.rejectionReasons.includes('housing-burden'));
});

test('higher mortgage rates reduce maximum affordable purchase price', () => {
  const buyer = household(8_000, 100_000, true);
  const system = new HousingChoiceSystem();
  const low = system.quoteMortgage(buyer, 0.04, 100_000);
  const high = system.quoteMortgage(buyer, 0.09, 100_000);
  assert.ok(high.maximumAffordablePrice < low.maximumAffordablePrice);
  assert.ok(low.maximumAffordablePrice > 0);
});

test('carless household ranks higher person accessibility when other housing attributes match', () => {
  const h = household(5_000, 20_000, false);
  const system = new HousingChoiceSystem();
  const ranked = system.rankCandidates(h, [
    candidate({ buildingId: 'building:far', accessibility: 0.25 }),
    candidate({ buildingId: 'building:near', accessibility: 0.95 }),
  ], { marketInterestRate: 0.05, voluntaryMove: true });
  assert.equal(ranked[0]!.buildingId, 'building:near');
  assert.ok(ranked[0]!.components.commute > ranked[1]!.components.commute);
});

test('owner candidate rejects insufficient down payment even when payment would be manageable', () => {
  const result = new HousingChoiceSystem().evaluateCandidate(
    household(10_000, 2_000, true),
    candidate({ tenure: 'owner', housingCost: 0, askingPrice: 120_000 }),
    { marketInterestRate: 0.04, voluntaryMove: true },
  );
  assert.equal(result.eligible, false);
  assert.ok(result.rejectionReasons.includes('down-payment'));
});
