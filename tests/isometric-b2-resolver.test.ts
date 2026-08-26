import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveParkingForm,
  resolvePublicRealmDescriptor,
  resolvePublicRealmProfile,
  rotateWorldFacing,
} from '../src/rendering/public-realm/PublicRealmVisualResolver.ts';
import type {
  PublicRealmBuildingContext,
  PublicRealmFacilityContext,
} from '../src/rendering/public-realm/PublicRealmTypes.ts';

const building = (overrides: Partial<PublicRealmBuildingContext> = {}): PublicRealmBuildingContext => ({
  kind: 'building', stableId: 'building:test', selectionKey: 'parcel:test|edge:test',
  typologyId: 'typology:residential_cottage', stories: 2, realizedFAR: .8, coverageRatio: .45,
  uses: ['residential'], roadType: 'local', hasAccessEdge: true, atIntersection: false,
  curbsideSuppressedByGeometry: false, worldFacing: 0,
  siteAnchor: {x:4,y:4}, frontageAnchor: {x:4,y:5}, ...overrides,
});

const facility = (type: PublicRealmFacilityContext['facilityType']): PublicRealmFacilityContext => ({
  kind: 'facility', stableId: `service:${type}`, selectionKey: `service:${type}`,
  facilityType: type, roadType: 'collector', worldFacing: 0,
  siteAnchor: {x:6,y:6}, frontageAnchor: {x:6,y:7},
});

test('service facilities map only to approved civic/industrial profiles', () => {
  for (const type of ['fire_station','police_station','clinic','elementary_school'] as const) {
    assert.equal(resolvePublicRealmProfile(facility(type)), 'civic-public-space');
  }
  for (const type of ['landfill','recycling_center'] as const) {
    assert.equal(resolvePublicRealmProfile(facility(type)), 'industrial-logistics');
  }
  assert.equal(resolveParkingForm(facility('fire_station'), 'civic-public-space'), 'none');
});

test('building profile precedence and numerical boundaries are exact', () => {
  assert.equal(resolvePublicRealmProfile(building({ uses: ['civic'] })), 'civic-public-space');
  assert.equal(resolvePublicRealmProfile(building({ uses: ['residential','logistics'] })), 'industrial-logistics');
  assert.equal(resolvePublicRealmProfile(building({ typologyId: 'main_street_mixed_use', stories: 8 })), 'main-street');
  assert.equal(resolvePublicRealmProfile(building({ typologyId: 'podium_mixed_use', uses: ['residential','retail'], stories: 12 })), 'urban-core');
  assert.equal(resolvePublicRealmProfile(building({ typologyId: 'custom', uses: ['retail'], stories: 2, coverageRatio: 0.350001 })), 'main-street');
  assert.equal(resolvePublicRealmProfile(building({ typologyId: 'custom', uses: ['retail'], stories: 7, coverageRatio: 0.6 })), 'main-street');
  assert.equal(resolvePublicRealmProfile(building({ typologyId: 'custom', uses: ['retail'], stories: 8, coverageRatio: 0.6 })), 'urban-core');
  assert.equal(resolvePublicRealmProfile(building({ typologyId: 'custom', stories: 7, realizedFAR: 3, uses: ['office'] })), 'urban-core');
  assert.equal(resolvePublicRealmProfile(building({ typologyId: 'custom', stories: 4, uses: ['residential'] })), 'residential-green');
  assert.equal(resolvePublicRealmProfile(building({ typologyId: 'custom', stories: 5, uses: ['residential'], coverageRatio: 0.35 })), 'suburban-auto-oriented');
  assert.equal(resolvePublicRealmProfile(building({ typologyId: 'custom', uses: [] })), undefined);
});

test('parking form obeys eligibility, access suppression, and precedence', () => {
  assert.equal(resolveParkingForm(building({ typologyId: 'podium_mixed_use', stories: 12, hasAccessEdge: true }), 'urban-core'), 'garage-entry');
  assert.equal(resolveParkingForm(building({ typologyId: 'podium_mixed_use', stories: 12, hasAccessEdge: false }), 'urban-core'), 'none');
  assert.equal(resolveParkingForm(building({ coverageRatio: 0.35, uses: ['retail'] }), 'suburban-auto-oriented'), 'surface-lot-edge');
  assert.equal(resolveParkingForm(building({ roadType: 'arterial' }), 'residential-green'), 'driveway');
  assert.equal(resolveParkingForm(building({ hasAccessEdge: false, roadType: 'collector' }), 'residential-green'), 'curbside-dressing');
  assert.equal(resolveParkingForm(building({ hasAccessEdge: false, roadType: 'collector', atIntersection: true }), 'residential-green'), 'none');
  assert.equal(resolveParkingForm(building({ hasAccessEdge: false, roadType: 'local', curbsideSuppressedByGeometry: true }), 'residential-green'), 'none');
});

test('descriptor channel keys and orientation are stable', () => {
  const descriptor = resolvePublicRealmDescriptor(building());
  assert.ok(descriptor);
  assert.equal(descriptor.channelKeys.surface, 'parcel:test|edge:test|surface');
  assert.equal(descriptor.channelKeys.vegetation, 'parcel:test|edge:test|vegetation');
  assert.equal(rotateWorldFacing(0, 1), 1);
  assert.equal(rotateWorldFacing(3, 1), 0);
});
