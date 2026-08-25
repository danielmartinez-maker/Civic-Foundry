import test from 'node:test';
import assert from 'node:assert/strict';
import { UrbanFabricDomain } from '../src/simulation/urban/UrbanFabricDomain.ts';
import type { UrbanBuildingState } from '../src/simulation/urban/UrbanTypes.ts';

function state(buildingId = 'building:lot:1,1'): UrbanBuildingState {
  return {
    buildingId,
    useComponents: [
      { use: 'residential', areaShareBps: 7500, residentCapacity: 24, jobCapacity: 0, taxBase: 300 },
      { use: 'commercial', areaShareBps: 2500, residentCapacity: 0, jobCapacity: 8, taxBase: 100 },
    ],
    qualityTier: 'standard',
    conditionScore: 100,
    lifecycleState: 'lease-up',
    conditionEstablishedTick: 0,
    lastConditionTick: 0,
    renovationCount: 0,
    parking: { profile: 'standard', spaces: 8 },
  };
}

test('mixed-use semantic state conserves basis points and snapshots immutably', () => {
  const domain = new UrbanFabricDomain();
  domain.install(state());
  assert.equal(domain.list().length, 1);
  assert.equal(domain.get('building:lot:1,1')?.useComponents.reduce((sum, item) => sum + item.areaShareBps, 0), 10_000);

  const snapshot = domain.snapshotState();
  assert.deepEqual(snapshot.buildings, [state()]);
  assert.notEqual(snapshot.buildings[0], domain.get('building:lot:1,1'));
});

test('urban domain rejects invalid shares, duplicate IDs, bad condition, and bad parking', () => {
  const domain = new UrbanFabricDomain();
  domain.install(state());
  assert.throws(() => domain.install(state()), /already exists|duplicate/i);
  assert.throws(() => domain.install({
    ...state('bad-shares'),
    useComponents: [{ use: 'residential', areaShareBps: 9000, residentCapacity: 10, jobCapacity: 0, taxBase: 100 }],
  }), /10,000/);
  assert.throws(() => domain.install({ ...state('bad-condition'), conditionScore: 101 }), /condition/i);
  assert.throws(() => domain.install({ ...state('bad-parking'), parking: { profile: 'standard', spaces: 1.5 } }), /parking/i);
});

test('urban domain rejects invalid capacity ownership and validates live building references', () => {
  const domain = new UrbanFabricDomain();
  assert.throws(() => domain.install({
    ...state('bad-use'),
    useComponents: [{ use: 'residential', areaShareBps: 10_000, residentCapacity: 10, jobCapacity: 2, taxBase: 100 }],
  }), /residential.*job/i);

  domain.install(state('building:a'));
  domain.install(state('building:b'));
  assert.doesNotThrow(() => domain.validateAgainst(new Set(['building:a', 'building:b'])));
  assert.throws(() => domain.validateAgainst(new Set(['building:a'])), /building:b|missing|unknown/i);
  assert.throws(() => domain.validateAgainst(new Set(['building:a', 'building:b', 'building:c']), { requireAllLiveBuildings: true }), /building:c|missing/i);
});

test('restore rejects duplicate semantic records', () => {
  const domain = new UrbanFabricDomain();
  assert.throws(() => domain.restoreState({ buildings: [state('building:a'), state('building:a')] }), /duplicate/i);
});
