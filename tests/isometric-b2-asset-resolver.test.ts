import test from 'node:test';
import assert from 'node:assert/strict';
import type { AssetManifestEntry } from '../src/rendering/assets/AssetTypes.ts';
import { PASS_B2_ASSET_MANIFEST } from '../src/rendering/assets/PassB2AssetManifest.ts';
import {
  buildPublicRealmAssetCatalog,
  resolvePublicRealmVisual,
} from '../src/rendering/public-realm/PublicRealmAssetResolver.ts';
import type { PublicRealmDescriptor } from '../src/rendering/public-realm/PublicRealmTypes.ts';

const descriptor: PublicRealmDescriptor = Object.freeze({
  context: Object.freeze({
    kind: 'building', stableId: 'building:podium', selectionKey: 'parcel:p|edge:e',
    typologyId: 'podium_mixed_use', stories: 12, realizedFAR: 4, coverageRatio: .7,
    uses: ['residential','retail'], roadType: 'collector', hasAccessEdge: true,
    atIntersection: false, curbsideSuppressedByGeometry: true, worldFacing: 0,
    siteAnchor: {x:5,y:5}, frontageAnchor: {x:5,y:6},
  }),
  profile: 'urban-core', parkingForm: 'garage-entry',
  channelKeys: Object.freeze({
    surface: 'k|surface', access: 'k|access', vegetation: 'k|vegetation',
    furniture: 'k|furniture', parking: 'k|parking', accent: 'k|accent',
  }),
});

test('catalog indexes B2 variants once by family and subcategory', () => {
  const catalog = buildPublicRealmAssetCatalog(PASS_B2_ASSET_MANIFEST.entries);
  assert.equal(catalog.byVariantKey.get('realm_sidewalk_paver_01')?.length, 1);
  assert.equal(catalog.byVariantKey.get('realm_garage_podium_entry_01')?.length, 4);
  assert.ok(catalog.bySubcategory.get('vegetation')?.includes('realm_tree_mature_01'));
});

test('camera rotation changes directional orientation but not selected family', () => {
  const catalog = buildPublicRealmAssetCatalog(PASS_B2_ASSET_MANIFEST.entries);
  const north = resolvePublicRealmVisual(descriptor, 0, catalog);
  const east = resolvePublicRealmVisual(descriptor, 1, catalog);
  const northGarage = [...north.surface, ...north.vertical].find((entry) => entry.variantKey === 'realm_garage_podium_entry_01');
  const eastGarage = [...east.surface, ...east.vertical].find((entry) => entry.variantKey === 'realm_garage_podium_entry_01');
  assert.ok(northGarage && eastGarage);
  assert.equal(northGarage.variantKey, eastGarage.variantKey);
  assert.equal(northGarage.orientation, 0);
  assert.equal(eastGarage.orientation, 1);
});

test('unrelated candidate families do not reshuffle existing channel selections', () => {
  const base = buildPublicRealmAssetCatalog(PASS_B2_ASSET_MANIFEST.entries);
  const before = resolvePublicRealmVisual(descriptor, 0, base);
  const unrelated: AssetManifestEntry = Object.freeze({
    assetId: 'realm_unrelated_01_o0', variantKey: 'realm_unrelated_01', atlasId: 'public_realm',
    sourceRect: {x:0,y:0,width:128,height:192}, footprint: {width:1,height:1}, anchor: {x:64,y:160},
    category: 'public-realm', subcategory: 'unrelated', orientation: 0, weight: 1,
    tags: ['symmetric','north-american','pass-b2'],
  });
  const expanded = buildPublicRealmAssetCatalog([...PASS_B2_ASSET_MANIFEST.entries, unrelated]);
  const after = resolvePublicRealmVisual(descriptor, 0, expanded);
  assert.deepEqual(before.surface.map((entry) => entry.assetId), after.surface.map((entry) => entry.assetId));
  assert.deepEqual(before.vertical.map((entry) => entry.assetId), after.vertical.map((entry) => entry.assetId));
});
