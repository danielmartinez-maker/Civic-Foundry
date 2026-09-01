import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const bindingPath = process.env.CIVIC_TRANSPORT_NAPI;
assert.ok(bindingPath, 'CIVIC_TRANSPORT_NAPI must point to the built addon');
const native = require(bindingPath);
const handle = native.create();
assert.equal(typeof handle, 'number');
native.loadLegacyRoads(handle, [
  { x: 0, y: 0, roadClass: 0, oneWay: false, oneWayDirection: 0 },
  { x: 1, y: 0, roadClass: 1, oneWay: false, oneWayDirection: 0 },
  { x: 2, y: 0, roadClass: 2, oneWay: false, oneWayDirection: 0 },
], 4);
const route = JSON.parse(native.findRouteJson(handle, 'j:legacy:0,0', 'j:legacy:2,0', 1));
assert.equal(route.junctionIds[0], 'j:legacy:0,0');
assert.equal(route.junctionIds.at(-1), 'j:legacy:2,0');
const snapshot = JSON.parse(native.snapshotJson(handle));
assert.equal(snapshot.roadSegmentCount, 2);
assert.ok(native.domainHash(handle) > 0n);
native.destroy(handle);
assert.throws(() => native.snapshotJson(handle));
console.log('transport napi smoke passed');
