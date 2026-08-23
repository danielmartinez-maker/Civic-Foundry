import test from 'node:test';
import assert from 'node:assert/strict';
import { LandHousingMarketSystem } from '../src/simulation/development/LandHousingMarketSystem.ts';

const baseInputs = {
  demand: { residential: 0.7, commercial: 0.3, industrial: 0.25 },
  population: 80,
  residentialCapacity: 100,
  employmentUtilization: 0.75,
  personAccessibility: 0.8,
  freightAccessibility: 0.7,
  serviceQuality: 0.8,
  utilityRatio: 0.95,
} as const;

const goodParcel = {
  personAccessibility: 0.85,
  freightAccessibility: 0.75,
  serviceQuality: 0.85,
  neighborhoodQuality: 0.85,
  utilityRatio: 1,
  frontageAccessBonus: 0.07,
} as const;

test('tight residential capacity increases housing pressure and rent while reducing vacancy', () => {
  const scarceSystem = new LandHousingMarketSystem();
  const abundantSystem = new LandHousingMarketSystem();

  const scarce = scarceSystem.evaluate({ ...baseInputs, population: 95, residentialCapacity: 100 });
  const abundant = abundantSystem.evaluate({ ...baseInputs, population: 30, residentialCapacity: 100 });

  assert.ok(scarce.housingPressure > abundant.housingPressure);
  assert.ok(scarce.housingRentIndex > abundant.housingRentIndex);
  assert.ok(scarce.housingVacancyRate < abundant.housingVacancyRate);
});

test('stronger commercial demand raises commercial rent and land indexes', () => {
  const weak = new LandHousingMarketSystem().evaluate({
    ...baseInputs,
    demand: { ...baseInputs.demand, commercial: -0.4 },
  });
  const strong = new LandHousingMarketSystem().evaluate({
    ...baseInputs,
    demand: { ...baseInputs.demand, commercial: 0.95 },
  });

  assert.ok(strong.zones.commercial.marketPressure > weak.zones.commercial.marketPressure);
  assert.ok(strong.zones.commercial.rentIndex > weak.zones.commercial.rentIndex);
  assert.ok(strong.zones.commercial.landValueIndex > weak.zones.commercial.landValueIndex);
  assert.ok(strong.zones.commercial.vacancyRate < weak.zones.commercial.vacancyRate);
});

test('industrial parcel signals weight freight access more heavily than person access', () => {
  const system = new LandHousingMarketSystem();
  system.evaluate(baseInputs);

  const freightRich = system.parcelSignal('industrial', {
    ...goodParcel,
    personAccessibility: 0.3,
    freightAccessibility: 1,
  });
  const personRich = system.parcelSignal('industrial', {
    ...goodParcel,
    personAccessibility: 1,
    freightAccessibility: 0.3,
  });

  assert.ok(freightRich.marketRentMultiplier > personRich.marketRentMultiplier);
  assert.ok(freightRich.landValueMultiplier > personRich.landValueMultiplier);
  assert.ok(freightRich.marketVacancyRate < personRich.marketVacancyRate);
});

test('local service and utility deficiencies weaken parcel economics', () => {
  const system = new LandHousingMarketSystem();
  system.evaluate(baseInputs);

  const healthy = system.parcelSignal('residential', goodParcel);
  const deficient = system.parcelSignal('residential', {
    ...goodParcel,
    serviceQuality: 0.2,
    neighborhoodQuality: 0.25,
    utilityRatio: 0.2,
  });

  assert.ok(healthy.marketRentMultiplier > deficient.marketRentMultiplier);
  assert.ok(healthy.landValueMultiplier > deficient.landValueMultiplier);
  assert.ok(healthy.marketVacancyRate < deficient.marketVacancyRate);
});

test('identical market inputs and parcel context are deterministic', () => {
  const first = new LandHousingMarketSystem();
  const second = new LandHousingMarketSystem();

  assert.deepEqual(first.evaluate(baseInputs), second.evaluate(baseInputs));
  assert.deepEqual(
    first.parcelSignal('commercial', goodParcel),
    second.parcelSignal('commercial', goodParcel),
  );
  assert.deepEqual(first.snapshot(), second.snapshot());
});

test('market rejects invalid non-finite and negative count inputs', () => {
  const system = new LandHousingMarketSystem();
  assert.throws(() => system.evaluate({ ...baseInputs, population: -1 }), /population/);
  assert.throws(() => system.evaluate({ ...baseInputs, residentialCapacity: -1 }), /residentialCapacity/);
  assert.throws(() => system.evaluate({ ...baseInputs, personAccessibility: Number.NaN }), /personAccessibility/);
  system.evaluate(baseInputs);
  assert.throws(
    () => system.parcelSignal('residential', { ...goodParcel, utilityRatio: Number.POSITIVE_INFINITY }),
    /utilityRatio/,
  );
});