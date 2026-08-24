import assert from 'node:assert/strict';
import test from 'node:test';

async function loadTenureModule(): Promise<Record<string, any>> {
  try {
    return await import('../src/simulation/housing/HousingTenureSystem.ts');
  } catch {
    return {};
  }
}

const baseInput = Object.freeze({
  buildingId: 'home',
  intensity: 'low' as const,
  capacity: 100,
  askingRent: 1_000,
  personAccessibility: 0.8,
  serviceQuality: 0.8,
  neighborhoodQuality: 0.8,
  utilityRatio: 0.9,
});

test('housing tenure splits physical capacity by residential intensity', async () => {
  const module = await loadTenureModule();
  assert.equal(typeof module.HousingTenureSystem, 'function');
  const system = new module.HousingTenureSystem();

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

test('housing tenure passes through asking rent and derives finite owner economics', async () => {
  const module = await loadTenureModule();
  assert.equal(typeof module.HousingTenureSystem, 'function');
  const system = new module.HousingTenureSystem();

  const snapshot = system.evaluate(0.045, [baseInput]);
  const economics = snapshot.byBuilding.home;
  assert.equal(economics.askingRent, 1_000);
  assert.ok(Number.isFinite(economics.impliedPurchasePrice));
  assert.ok(economics.impliedPurchasePrice > 0);
  assert.ok(Number.isFinite(economics.monthlyOwnerCost));
  assert.ok(economics.monthlyOwnerCost > 0);

  const renter = snapshot.options.find((option: any) => option.tenure === 'renter');
  const owner = snapshot.options.find((option: any) => option.tenure === 'owner');
  assert.equal(renter?.monthlyCost, 1_000);
  assert.equal(renter?.capacity, 40);
  assert.equal(owner?.capacity, 60);
  assert.equal(owner?.impliedPurchasePrice, economics.impliedPurchasePrice);
});

test('higher financing rates increase monthly owner burden under identical rent conditions', async () => {
  const module = await loadTenureModule();
  assert.equal(typeof module.HousingTenureSystem, 'function');
  const system = new module.HousingTenureSystem();

  const lowRate = system.evaluate(0.045, [baseInput]).byBuilding.home;
  const highRate = system.evaluate(0.10, [baseInput]).byBuilding.home;

  assert.ok(highRate.monthlyOwnerCost > lowRate.monthlyOwnerCost);
});
