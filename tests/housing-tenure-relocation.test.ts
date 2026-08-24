import assert from 'node:assert/strict';
import test from 'node:test';
import { HousingTenureSystem, type HousingTenureBuildingInput, type HousingTenureOption } from '../src/simulation/housing/HousingTenureSystem.ts';

async function loadRelocationModule(): Promise<Record<string, any>> {
  try {
    return await import('../src/simulation/housing/HousingRelocationSystem.ts');
  } catch {
    return {};
  }
}

const baseInput: HousingTenureBuildingInput = Object.freeze({
  buildingId: 'home',
  intensity: 'low',
  capacity: 100,
  askingRent: 1_000,
  personAccessibility: 0.8,
  serviceQuality: 0.8,
  neighborhoodQuality: 0.8,
  utilityRatio: 0.9,
});

function tenureOptions(inputs: readonly HousingTenureBuildingInput[]): readonly HousingTenureOption[] {
  return new HousingTenureSystem().evaluate(0.045, inputs).options;
}

test('housing tenure splits physical capacity by residential intensity', () => {
  const system = new HousingTenureSystem();

  const low = system.evaluate(0.045, [baseInput]);
  assert.equal(low.byBuilding.home.totalCapacity, 100);
  assert.equal(low.byBuilding.home.ownershipCapacity, 60);
  assert.equal(low.byBuilding.home.rentalCapacity, 40);

  const medium = system.evaluate(0.045, [{ ...baseInput, intensity: 'medium' }]);
  assert.equal(medium.byBuilding.home.ownershipCapacity, 40);
  assert.equal(medium.byBuilding.home.rentalCapacity, 60);

  const high = system.evaluate(0.045, [{ ...baseInput, intensity: 'high' }]);
  assert.equal(high.byBuilding.home.ownershipCapacity, 25);
  assert.equal(high.byBuilding.home.rentalCapacity, 75);
});

test('housing tenure passes through asking rent and derives finite owner economics', () => {
  const system = new HousingTenureSystem();

  const snapshot = system.evaluate(0.045, [baseInput]);
  const economics = snapshot.byBuilding.home!;
  assert.equal(economics.askingRent, 1_000);
  assert.ok(Number.isFinite(economics.impliedPurchasePrice));
  assert.ok(economics.impliedPurchasePrice > 0);
  assert.ok(Number.isFinite(economics.monthlyOwnerCost));
  assert.ok(economics.monthlyOwnerCost > 0);

  const renter = snapshot.options.find((option) => option.tenure === 'renter');
  const owner = snapshot.options.find((option) => option.tenure === 'owner');
  assert.equal(renter?.monthlyCost, 1_000);
  assert.equal(renter?.capacity, 40);
  assert.equal(owner?.capacity, 60);
  assert.equal(owner?.impliedPurchasePrice, economics.impliedPurchasePrice);
});

test('higher financing rates increase monthly owner burden under identical rent conditions', () => {
  const system = new HousingTenureSystem();

  const lowRate = system.evaluate(0.045, [baseInput]).byBuilding.home!;
  const highRate = system.evaluate(0.10, [baseInput]).byBuilding.home!;

  assert.ok(highRate.monthlyOwnerCost > lowRate.monthlyOwnerCost);
});

test('persistent housing initialization conserves population, respects capacity, and is input-order deterministic', async () => {
  const module = await loadRelocationModule();
  assert.equal(typeof module.HousingRelocationSystem, 'function');
  const options = tenureOptions([
    { ...baseInput, buildingId: 'building:a', capacity: 60, askingRent: 500 },
    { ...baseInput, buildingId: 'building:b', intensity: 'medium', capacity: 60, askingRent: 550 },
  ]);

  const first = new module.HousingRelocationSystem();
  const second = new module.HousingRelocationSystem();
  const a = first.initialize(80, options);
  const b = second.initialize(80, [...options].reverse());

  assert.equal(a.housedResidents + a.unplacedResidents, 80);
  assert.deepEqual(first.snapshotState(), second.snapshotState());
  assert.deepEqual(a, b);

  for (const option of options) {
    const assigned = first.snapshotState().allocations
      .filter((allocation: any) => allocation.buildingId === option.buildingId && allocation.tenure === option.tenure)
      .reduce((sum: number, allocation: any) => sum + allocation.residents, 0);
    assert.ok(assigned <= option.capacity + 1e-9);
  }
});

test('displacing a building moves its actual cohorts into the displaced search queue and rehousing preserves resident mass', async () => {
  const module = await loadRelocationModule();
  assert.equal(typeof module.HousingRelocationSystem, 'function');
  const system = new module.HousingRelocationSystem();
  const initialOptions = tenureOptions([
    { ...baseInput, buildingId: 'building:a', capacity: 60, askingRent: 450 },
    { ...baseInput, buildingId: 'building:b', capacity: 20, askingRent: 900 },
  ]);
  system.initialize(50, initialOptions);

  const before = system.snapshotState();
  const occupantsOfA = before.allocations
    .filter((allocation: any) => allocation.buildingId === 'building:a')
    .reduce((sum: number, allocation: any) => sum + allocation.residents, 0);
  assert.ok(occupantsOfA > 0);

  const displaced = system.displaceBuilding('building:a');
  assert.equal(displaced, occupantsOfA);
  assert.equal(
    system.snapshotState().unplaced.filter((cohort: any) => cohort.displaced).reduce((sum: number, cohort: any) => sum + cohort.residents, 0),
    occupantsOfA,
  );

  const replacementOptions = tenureOptions([
    { ...baseInput, buildingId: 'building:b', intensity: 'medium', capacity: 100, askingRent: 500 },
  ]);
  const after = system.reconcile({ population: 50, options: replacementOptions, allowVoluntaryMoves: false });
  assert.equal(after.housedResidents + after.unplacedResidents, 50);
  assert.ok(after.rehousedDisplacedResidentsThisCycle > 0);
  assert.equal(system.snapshotState().allocations.some((allocation: any) => allocation.buildingId === 'building:a'), false);
});

test('failed displaced search remains explicit unplaced state rather than disappearing', async () => {
  const module = await loadRelocationModule();
  assert.equal(typeof module.HousingRelocationSystem, 'function');
  const system = new module.HousingRelocationSystem();
  const options = tenureOptions([{ ...baseInput, buildingId: 'building:a', capacity: 100, askingRent: 450 }]);
  system.initialize(40, options);
  const displaced = system.displaceBuilding('building:a');
  assert.ok(displaced > 0);

  const snapshot = system.reconcile({ population: 40, options: [], allowVoluntaryMoves: false });
  const state = system.snapshotState();
  assert.equal(snapshot.housedResidents, 0);
  assert.equal(snapshot.unplacedResidents, 40);
  assert.equal(snapshot.failedSearchResidentsThisCycle, 40);
  assert.equal(state.unplaced.reduce((sum: number, cohort: any) => sum + cohort.residents, 0), 40);
  assert.ok(state.unplaced.every((cohort: any) => cohort.displaced));
});

test('severely burdened residents stay housed when no better alternative exists', async () => {
  const module = await loadRelocationModule();
  assert.equal(typeof module.HousingRelocationSystem, 'function');
  const system = new module.HousingRelocationSystem();
  const expensive = tenureOptions([
    { ...baseInput, buildingId: 'building:a', capacity: 100, askingRent: 2_500 },
  ]);
  const initialized = system.initialize(30, expensive);
  assert.equal(initialized.unplacedResidents, 0);

  const after = system.reconcile({ population: 30, options: expensive, allowVoluntaryMoves: true });
  assert.equal(after.housedResidents, 30);
  assert.equal(after.unplacedResidents, 0);
  assert.ok(after.costBurdenedResidents > 0);
});
