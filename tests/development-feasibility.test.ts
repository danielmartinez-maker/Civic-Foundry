import test from 'node:test';
import assert from 'node:assert/strict';
import * as buildingCatalog from '../src/data/buildings.ts';

test('building catalog exposes multiple deterministic development variants per zone', () => {
  const catalog = buildingCatalog as unknown as {
    BUILDING_DEFINITIONS: Record<string, { id: string; zone: string }>;
    BUILDING_VARIANTS?: Record<string, readonly Array<{
      id: string;
      zone: string;
      baseConstructionCost: number;
      baseRent: number;
      softCostRatio: number;
      operatingExpenseRatio: number;
      baseVacancy: number;
    }>>;
    getBuildingDefinition?: (id: string) => unknown;
  };

  assert.ok(catalog.BUILDING_VARIANTS, 'expected BUILDING_VARIANTS export');
  assert.equal(typeof catalog.getBuildingDefinition, 'function', 'expected getBuildingDefinition export');
  assert.deepEqual(Object.keys(catalog.BUILDING_VARIANTS!), ['residential', 'commercial', 'industrial']);

  for (const zone of ['residential', 'commercial', 'industrial'] as const) {
    const variants = catalog.BUILDING_VARIANTS![zone]!;
    assert.ok(variants.length >= 3, `${zone} should expose at least three project variants`);
    assert.equal(catalog.BUILDING_DEFINITIONS[zone]!.zone, zone);
    for (const definition of variants) {
      assert.equal(catalog.getBuildingDefinition!(definition.id), definition);
      assert.ok(definition.baseConstructionCost > 0);
      assert.ok(definition.baseRent > 0);
      assert.ok(definition.softCostRatio >= 0 && definition.softCostRatio < 1);
      assert.ok(definition.operatingExpenseRatio >= 0 && definition.operatingExpenseRatio < 1);
      assert.ok(definition.baseVacancy >= 0 && definition.baseVacancy < 1);
    }
  }
});
