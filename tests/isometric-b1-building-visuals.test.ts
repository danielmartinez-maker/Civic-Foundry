import test from 'node:test';
import assert from 'node:assert/strict';
import { NEW_BUILDING_LIFECYCLE, type BuildingV2 } from '../src/simulation/buildings/BuildingTypes.ts';
import { PASS_A_BUILDING_VARIANTS } from '../src/rendering/assets/PassAAssetManifest.ts';
import { PASS_B1_MIXED_USE_FAMILIES } from '../src/rendering/assets/PassB1AssetManifest.ts';

async function loadResolver() {
  return import('../src/rendering/assets/BuildingVisualResolver.ts');
}

function building(
  exteriorCondition: number,
  overrides: Partial<Pick<BuildingV2, 'id' | 'typologyId' | 'status'>> = {},
) {
  return {
    id: overrides.id ?? 'building:test:1',
    typologyId: overrides.typologyId ?? 'typology:residential_cottage',
    status: overrides.status ?? 'occupied',
    lifecycle: { ...NEW_BUILDING_LIFECYCLE, exteriorCondition },
  };
}

function baseFamily(variantKey: string): string {
  return variantKey.replace(/__(new|maintained|aging|neglected|abandoned)$/, '');
}

test('building visual resolver module is available', async () => {
  await assert.doesNotReject(async () => {
    const resolver = await loadResolver();
    assert.equal(typeof resolver.buildingConditionFor, 'function');
    assert.equal(typeof resolver.buildingVisualFamily, 'function');
    assert.equal(typeof resolver.buildingVariantKey, 'function');
  });
});

test('building condition thresholds use exact exterior-condition boundaries', async () => {
  const { buildingConditionFor } = await loadResolver();
  const cases = [
    [100, 'new'], [90, 'new'], [89.99, 'maintained'], [70, 'maintained'],
    [69.99, 'aging'], [45, 'aging'], [44.99, 'neglected'], [20, 'neglected'],
    [19.99, 'abandoned'], [0, 'abandoned'],
  ] as const;
  for (const [condition, expected] of cases) {
    assert.equal(buildingConditionFor(building(condition)), expected, `condition ${condition}`);
  }
});

test('abandoned authoritative status overrides healthy exterior condition', async () => {
  const { buildingConditionFor } = await loadResolver();
  assert.equal(buildingConditionFor(building(100, { status: 'abandoned' })), 'abandoned');
});

test('mixed-use typologies resolve only to their authored three-family sets', async () => {
  const { buildingVisualFamily } = await loadResolver();
  for (const typologyId of ['main_street_mixed_use', 'podium_mixed_use'] as const) {
    const allowed = PASS_B1_MIXED_USE_FAMILIES
      .filter(([, candidateTypology]) => candidateTypology === typologyId)
      .map(([family]) => family);
    for (const id of ['building:a', 'building:b', 'building:c', 'building:d']) {
      assert.ok(allowed.includes(buildingVisualFamily({ id, typologyId }) as never));
    }
  }
});

test('architectural family is stable while building condition changes', async () => {
  const { buildingVariantKey } = await loadResolver();
  for (const typologyId of ['main_street_mixed_use', 'podium_mixed_use', 'typology:residential_cottage']) {
    const healthy = buildingVariantKey(building(95, { id: 'building:stable', typologyId }));
    const aging = buildingVariantKey(building(50, { id: 'building:stable', typologyId }));
    const abandoned = buildingVariantKey(building(5, { id: 'building:stable', typologyId }));
    assert.equal(baseFamily(healthy), baseFamily(aging));
    assert.equal(baseFamily(healthy), baseFamily(abandoned));
  }
});

test('maintained legacy buildings retain Pass A variant keys', async () => {
  const { buildingVariantKey } = await loadResolver();
  const legacyTypologies = [
    ['typology:residential_cottage', 'residential', 'low'],
    ['typology:residential_rowhouse', 'residential', 'medium'],
    ['typology:residential_apartment', 'residential', 'high'],
    ['typology:commercial_shop', 'commercial', 'low'],
    ['typology:commercial_block', 'commercial', 'medium'],
    ['typology:commercial_office', 'commercial', 'high'],
    ['typology:industrial_workshop', 'industrial', 'low'],
    ['typology:industrial_warehouse', 'industrial', 'medium'],
    ['typology:industrial_plant', 'industrial', 'high'],
  ] as const;
  for (const [typologyId, zone, intensity] of legacyTypologies) {
    const allowed = PASS_A_BUILDING_VARIANTS
      .filter(([, candidateZone, candidateIntensity]) => candidateZone === zone && candidateIntensity === intensity)
      .map(([family]) => family);
    const key = buildingVariantKey(building(75, { id: `building:${typologyId}`, typologyId }));
    assert.ok(allowed.includes(key as never), `${typologyId} resolved ${key}`);
  }
});

test('camera orientation is absent from visual-family selection contract', async () => {
  const { buildingVisualFamily } = await loadResolver();
  const input = { id: 'building:orientation-stable', typologyId: 'podium_mixed_use' };
  const family = buildingVisualFamily(input);
  for (const orientation of [0, 1, 2, 3]) {
    assert.equal(buildingVisualFamily({ ...input }), family, `orientation ${orientation}`);
  }
});
