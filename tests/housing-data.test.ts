import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILDING_VARIANTS } from '../src/data/buildings.ts';
import {
  HOUSING_CADENCE,
  HOUSING_PRODUCT_OPTIONS,
  defaultLegacyProductAllocation,
} from '../src/data/housing.ts';

test('residential definitions expose valid physical housing inventory', () => {
  assert.deepEqual(HOUSING_CADENCE, { conditions: 10, economics: 50, market: 100, redevelopment: 250 });
  for (const definition of BUILDING_VARIANTS.residential) {
    assert.ok(definition.housingUnits > 0);
    assert.ok(definition.residentCapacity >= definition.housingUnits);
    assert.ok(definition.overcrowdingMultiplier >= 1 && definition.overcrowdingMultiplier <= 1.6);
    assert.ok(HOUSING_PRODUCT_OPTIONS[definition.id]!.length > 0);
    const allocation = defaultLegacyProductAllocation(definition.id, definition.housingUnits);
    assert.equal(allocation.rentalUnits + allocation.forSaleUnits, definition.housingUnits);
  }
});

test('non-residential definitions expose no housing inventory', () => {
  for (const zone of ['commercial', 'industrial'] as const) {
    for (const definition of BUILDING_VARIANTS[zone]) {
      assert.equal(definition.housingUnits, 0);
      assert.equal(definition.overcrowdingMultiplier, 1);
    }
  }
});

test('legacy tenure allocation is deterministic and conserves units', () => {
  assert.deepEqual(defaultLegacyProductAllocation('residential_cottage', 4), {
    product: 'for_sale',
    rentalUnits: 0,
    forSaleUnits: 4,
  });
  assert.deepEqual(defaultLegacyProductAllocation('residential_rowhouse', 12), {
    product: 'mixed',
    rentalUnits: 6,
    forSaleUnits: 6,
  });
  assert.deepEqual(defaultLegacyProductAllocation('residential_apartment', 32), {
    product: 'rental',
    rentalUnits: 32,
    forSaleUnits: 0,
  });
});
