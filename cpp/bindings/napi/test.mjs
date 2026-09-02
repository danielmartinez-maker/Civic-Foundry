import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
const addon = require(resolve(process.argv[2]));
const handle = addon.createEngine({ seed: 7, startTick: 2, speed: 1 });
assert.equal(JSON.parse(addon.getSnapshot(handle)).tick, 2);
assert.throws(() => addon.step(handle, 0.5), /safe integer/);
assert.throws(
  () =>
    addon.submitCommands(
      handle,
      JSON.stringify([
        { sequence: 1, tick: 1, type: "missing-version", payload: null },
      ]),
    ),
  (error) => error?.code === 3,
);
assert.throws(
  () =>
    addon.submitCommands(
      handle,
      JSON.stringify([
        {
          version: 2,
          sequence: 1,
          tick: 1,
          type: "unsupported-version",
          payload: null,
        },
      ]),
    ),
  (error) => error?.code === 3,
);
assert.throws(
  () =>
    addon.submitCommands(
      handle,
      JSON.stringify([
        { version: 1, sequence: 1, tick: 1, type: "missing-payload" },
      ]),
    ),
  (error) => error?.code === 3,
);
addon.submitCommands(
  handle,
  JSON.stringify([
    {
      version: 1,
      sequence: 1,
      tick: 1,
      type: "past-but-valid",
      payload: { x: 1 },
    },
  ]),
);
addon.step(handle, 1);
const events = JSON.parse(addon.getEvents(handle));
assert.equal(events[0].type, "past-but-valid");
const kernel = addon.getDomainHash(handle, "kernel");
assert.equal(kernel.ownership, 1);
assert.equal(typeof kernel.value, "bigint");
const world = addon.getDomainHash(handle, "world");
assert.equal(world.ownership, 2);

const urbanPreview = JSON.parse(
  addon.rebuildUrbanLegacy(
    handle,
    JSON.stringify({
      terrain: [{ x: 0, y: 0, buildable: true }],
      roads: [],
      zoning: [{ x: 0, y: 0, zoningDistrictId: "residential" }],
    }),
  ),
);
assert.equal(urbanPreview.urbanFabric.parcels.length, 1);
assert.equal(urbanPreview.urbanFabric.parcels[0].id, "parcel:0,0");
assert.equal(urbanPreview.urbanFabric.parcels[0].areaM2, 400);
assert.equal(addon.getDomainHash(handle, "cadastre").ownership, 2);
const committedUrban = JSON.parse(
  addon.restoreUrbanState(
    handle,
    JSON.stringify({
      urbanFabric: urbanPreview.urbanFabric,
      zoningV2: urbanPreview.zoningV2,
      buildingsV2: urbanPreview.buildingsV2,
      propertyMarket: urbanPreview.propertyMarket,
    }),
  ),
);
assert.deepEqual(JSON.parse(addon.getUrbanSnapshot(handle)), committedUrban);
assert.equal(addon.getDomainHash(handle, "cadastre").ownership, 1);
assert.equal(addon.getDomainHash(handle, "buildings").ownership, 1);
assert.equal(addon.getDomainHash(handle, "zoning").ownership, 1);
assert.equal(addon.getDomainHash(handle, "property").ownership, 1);

const left = addon.createEngine({ seed: 7 });
const right = addon.createEngine({ seed: 7 });
addon.submitCommands(
  left,
  JSON.stringify([
    {
      version: 1,
      sequence: 1,
      tick: 1,
      type: "semantic",
      payload: { a: 1, b: 2 },
    },
  ]),
);
addon.submitCommands(
  right,
  JSON.stringify([
    {
      version: 1,
      sequence: 1,
      tick: 1,
      type: "semantic",
      payload: { b: 2, a: 1 },
    },
  ]),
);
assert.equal(
  addon.getDomainHash(left, "kernel").value,
  addon.getDomainHash(right, "kernel").value,
);
addon.destroyEngine(left);
addon.destroyEngine(right);
assert.throws(
  () => addon.saveV9(handle),
  (error) => error?.code === 2,
);
addon.destroyEngine(handle);
assert.throws(() => addon.step(handle, 1), /destroyed/);
