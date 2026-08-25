import test from 'node:test';
import assert from 'node:assert/strict';
import { TransportNetworkStore, validateTransportAuthority } from '../src/simulation/transportation/TransportNetworkStore.ts';
import { ALL_VEHICLE_PERMISSIONS, type TransportNetworkAuthority } from '../src/simulation/transportation/TransportNetworkTypes.ts';

function baseAuthority(): TransportNetworkAuthority {
  return {
    junctions: [
      { id: 'j:b', x: 1, y: 0 },
      { id: 'j:a', x: 0, y: 0 },
      { id: 'j:c', x: 2, y: 0 },
    ],
    segments: [
      {
        id: 's:b', roadClass: 'local', geometryRef: 'g:b', startJunctionId: 'j:b', endJunctionId: 'j:c',
        lengthMeters: 10, speedLimitKph: 30, condition: 1, accessPolicyId: 'all', carriagewayIds: ['c:b'],
      },
      {
        id: 's:a', roadClass: 'local', geometryRef: 'g:a', startJunctionId: 'j:a', endJunctionId: 'j:b',
        lengthMeters: 10, speedLimitKph: 30, condition: 1, accessPolicyId: 'all', carriagewayIds: ['c:a'],
      },
    ],
    carriageways: [
      { id: 'c:b', segmentId: 's:b', direction: 'forward', fromJunctionId: 'j:b', toJunctionId: 'j:c', operatingClass: 'local', laneIds: ['l:b'] },
      { id: 'c:a', segmentId: 's:a', direction: 'forward', fromJunctionId: 'j:a', toJunctionId: 'j:b', operatingClass: 'local', laneIds: ['l:a'] },
    ],
    lanes: [
      { id: 'l:b', carriagewayId: 'c:b', ordinal: 0, kind: 'through', permissions: ALL_VEHICLE_PERMISSIONS, operatingState: 'open', baseCapacityPerMinute: 60, freeFlowSpeedKph: 30 },
      { id: 'l:a', carriagewayId: 'c:a', ordinal: 0, kind: 'through', permissions: ALL_VEHICLE_PERMISSIONS, operatingState: 'open', baseCapacityPerMinute: 60, freeFlowSpeedKph: 30 },
    ],
    movements: [
      {
        id: 'm:a', junctionId: 'j:b', fromCarriagewayId: 'c:a', toCarriagewayId: 'c:b',
        fromLaneIds: ['l:a'], toLaneIds: ['l:b'], turnKind: 'through', permissions: ALL_VEHICLE_PERMISSIONS,
        allowed: true, basePenaltyTicks: 0,
      },
    ],
  };
}

test('store canonicalizes snapshots and no-op mutations do not inflate topology revision', () => {
  const store = new TransportNetworkStore();
  assert.deepEqual(store.replaceAuthority(baseAuthority()), { ok: true, changed: true });
  const first = store.snapshot();
  assert.deepEqual(first.junctions.map((item) => item.id), ['j:a', 'j:b', 'j:c']);
  assert.deepEqual(first.segments.map((item) => item.id), ['s:a', 's:b']);
  assert.deepEqual(first.carriageways.map((item) => item.id), ['c:a', 'c:b']);
  assert.deepEqual(first.lanes.map((item) => item.id), ['l:a', 'l:b']);
  const revision = first.topologyRevision;
  assert.deepEqual(store.setLaneOperatingState('l:a', 'open'), { ok: true, changed: false });
  assert.equal(store.snapshot().topologyRevision, revision);
  assert.deepEqual(store.replaceAuthority(baseAuthority()), { ok: true, changed: false });
  assert.equal(store.snapshot().topologyRevision, revision);
});

test('invalid authoritative replacement is rejected atomically', () => {
  const store = new TransportNetworkStore();
  store.replaceAuthority(baseAuthority());
  const before = JSON.stringify(store.snapshot());
  const authority = baseAuthority();
  const invalid: TransportNetworkAuthority = {
    ...authority,
    lanes: authority.lanes.map((lane) => lane.id === 'l:a' ? { ...lane, carriagewayId: 'missing' } : lane),
  };
  const result = store.replaceAuthority(invalid);
  assert.equal(result.ok, false);
  assert.equal(result.changed, false);
  assert.match(result.reason ?? '', /carriageway/i);
  assert.equal(JSON.stringify(store.snapshot()), before);
});

test('validator rejects duplicate lane ordinals and invalid movement lane ownership', () => {
  const duplicateOrdinal = baseAuthority();
  assert.throws(() => validateTransportAuthority({
    ...duplicateOrdinal,
    lanes: [...duplicateOrdinal.lanes, { ...duplicateOrdinal.lanes[0]!, id: 'l:b2' }],
    carriageways: duplicateOrdinal.carriageways.map((item) => item.id === 'c:b' ? { ...item, laneIds: ['l:b', 'l:b2'] } : item),
  }), /ordinal/i);

  const wrongMovementLane = baseAuthority();
  assert.throws(() => validateTransportAuthority({
    ...wrongMovementLane,
    movements: [{ ...wrongMovementLane.movements[0]!, fromLaneIds: ['l:b'] }],
  }), /lane/i);
});

test('validator rejects impossible movement geometry and invalid numeric capacity', () => {
  const wrongGeometry = baseAuthority();
  assert.throws(() => validateTransportAuthority({
    ...wrongGeometry,
    movements: [{ ...wrongGeometry.movements[0]!, junctionId: 'j:c' }],
  }), /junction|terminate|originate/i);

  const invalidCapacity = baseAuthority();
  assert.throws(() => validateTransportAuthority({
    ...invalidCapacity,
    lanes: invalidCapacity.lanes.map((lane) => lane.id === 'l:a' ? { ...lane, baseCapacityPerMinute: -1 } : lane),
  }), /capacity/i);
});

test('topology mutations increment revision only on change and cost epoch is independent', () => {
  const store = new TransportNetworkStore();
  store.replaceAuthority(baseAuthority());
  const initialRevision = store.snapshot().topologyRevision;

  assert.deepEqual(store.setLaneOperatingState('l:a', 'closed'), { ok: true, changed: true });
  assert.equal(store.snapshot().topologyRevision, initialRevision + 1);
  assert.deepEqual(store.setLanePermissions('l:a', 1), { ok: true, changed: true });
  assert.equal(store.snapshot().topologyRevision, initialRevision + 2);
  assert.deepEqual(store.setMovementAllowed('m:a', false), { ok: true, changed: true });
  assert.equal(store.snapshot().topologyRevision, initialRevision + 3);
  assert.deepEqual(store.setMovementPermissions('m:a', 1), { ok: true, changed: true });
  assert.equal(store.snapshot().topologyRevision, initialRevision + 4);

  const beforeEpochRevision = store.snapshot().topologyRevision;
  assert.equal(store.advanceCostEpoch(), 1);
  assert.equal(store.snapshot().costEpoch, 1);
  assert.equal(store.snapshot().topologyRevision, beforeEpochRevision);
});

test('snapshot restore preserves exact canonical bytes and revisions', () => {
  const original = new TransportNetworkStore();
  original.replaceAuthority(baseAuthority());
  original.setLaneOperatingState('l:a', 'closed');
  original.advanceCostEpoch();
  const snapshot = original.snapshot();

  const restored = new TransportNetworkStore();
  restored.restore(snapshot);
  assert.equal(JSON.stringify(restored.snapshot()), JSON.stringify(snapshot));
});
