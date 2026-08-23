import test from 'node:test';
import assert from 'node:assert/strict';
import { HousingChoiceSystem, type HousingOption } from '../src/simulation/housing/HousingChoiceSystem.ts';

const baseOption: HousingOption = {
  buildingId: 'building:base',
  capacity: 20,
  monthlyRent: 500,
  personAccessibility: 0.75,
  serviceQuality: 0.75,
  neighborhoodQuality: 0.75,
  utilityRatio: 1,
};

function option(overrides: Partial<HousingOption>): HousingOption {
  return { ...baseOption, ...overrides };
}

test('cheaper otherwise-equivalent housing attracts more residents', () => {
  const cheap = option({ buildingId: 'building:cheap', monthlyRent: 420 });
  const expensive = option({ buildingId: 'building:expensive', monthlyRent: 900 });

  const result = new HousingChoiceSystem().evaluate(30, [expensive, cheap]);

  assert.ok(result.byBuilding['building:cheap']!.assignedResidents > result.byBuilding['building:expensive']!.assignedResidents);
  assert.ok(result.effectiveAffordableCapacity < result.physicalCapacity);
  assert.equal(result.housedResidents, 30);
  assert.equal(result.unplacedResidents, 0);
});

test('materially better quality can outweigh a modest rent premium', () => {
  const lowerQuality = option({
    buildingId: 'building:lower-quality',
    monthlyRent: 500,
    personAccessibility: 0.25,
    serviceQuality: 0.25,
    neighborhoodQuality: 0.25,
    utilityRatio: 0.4,
  });
  const higherQuality = option({
    buildingId: 'building:higher-quality',
    monthlyRent: 550,
    personAccessibility: 1,
    serviceQuality: 1,
    neighborhoodQuality: 1,
    utilityRatio: 1,
  });

  const result = new HousingChoiceSystem().evaluate(20, [lowerQuality, higherQuality]);

  assert.ok(result.byBuilding['building:higher-quality']!.assignedResidents > result.byBuilding['building:lower-quality']!.assignedResidents);
});

test('higher rents reduce affordable capacity and affordability while increasing cost burden', () => {
  const affordableSystem = new HousingChoiceSystem();
  const expensiveSystem = new HousingChoiceSystem();
  const affordable = affordableSystem.evaluate(30, [
    option({ buildingId: 'building:a', monthlyRent: 400 }),
    option({ buildingId: 'building:b', monthlyRent: 450 }),
  ]);
  const expensive = expensiveSystem.evaluate(30, [
    option({ buildingId: 'building:a', monthlyRent: 1_050 }),
    option({ buildingId: 'building:b', monthlyRent: 1_150 }),
  ]);

  assert.ok(expensive.effectiveAffordableCapacity < affordable.effectiveAffordableCapacity);
  assert.ok(expensive.affordabilityIndex < affordable.affordabilityIndex);
  assert.ok(expensive.costBurdenShare > affordable.costBurdenShare);
  assert.ok(expensive.costBurdenedResidents > affordable.costBurdenedResidents);
});

test('housing allocation respects physical capacity and total population', () => {
  const result = new HousingChoiceSystem().evaluate(100, [
    option({ buildingId: 'building:a', capacity: 12, monthlyRent: 420 }),
    option({ buildingId: 'building:b', capacity: 18, monthlyRent: 520 }),
  ]);

  assert.equal(result.physicalCapacity, 30);
  assert.equal(result.housedResidents, 30);
  assert.equal(result.unplacedResidents, 70);
  assert.ok(result.byBuilding['building:a']!.assignedResidents <= 12);
  assert.ok(result.byBuilding['building:b']!.assignedResidents <= 18);
  assert.ok(result.effectiveAffordableCapacity >= 0);
  assert.ok(result.effectiveAffordableCapacity <= result.physicalCapacity);
});

test('housing choice is deterministic and independent of option input order', () => {
  const first = new HousingChoiceSystem();
  const second = new HousingChoiceSystem();
  const options = [
    option({ buildingId: 'building:c', capacity: 12, monthlyRent: 650 }),
    option({ buildingId: 'building:a', capacity: 14, monthlyRent: 450 }),
    option({ buildingId: 'building:b', capacity: 16, monthlyRent: 520 }),
  ];

  const a = first.evaluate(35, options);
  const b = second.evaluate(35, [...options].reverse());

  assert.deepEqual(a, b);
  assert.deepEqual(first.snapshot(), second.snapshot());
});

test('empty housing stock yields finite zero allocation and neutral affordability', () => {
  const result = new HousingChoiceSystem().evaluate(25, []);

  assert.equal(result.population, 25);
  assert.equal(result.physicalCapacity, 0);
  assert.equal(result.effectiveAffordableCapacity, 0);
  assert.equal(result.housedResidents, 0);
  assert.equal(result.unplacedResidents, 25);
  assert.equal(result.affordabilityIndex, 1);
  assert.equal(result.costBurdenedResidents, 0);
  assert.equal(result.costBurdenShare, 0);
  assert.deepEqual(result.byBuilding, {});
});

test('housing choice rejects invalid population and option inputs', () => {
  const system = new HousingChoiceSystem();
  assert.throws(() => system.evaluate(-1, []), /population/);
  assert.throws(() => system.evaluate(Number.NaN, []), /population/);
  assert.throws(() => system.evaluate(10, [option({ capacity: -1 })]), /capacity/);
  assert.throws(() => system.evaluate(10, [option({ monthlyRent: Number.POSITIVE_INFINITY })]), /monthlyRent/);
  assert.throws(() => system.evaluate(10, [option({ personAccessibility: Number.NaN })]), /personAccessibility/);
});