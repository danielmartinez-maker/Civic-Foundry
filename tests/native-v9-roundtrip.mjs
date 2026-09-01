import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";

import { SimulationCore } from "../src/simulation/core/SimulationCore.ts";
import { hydrateCoreV9, serializeCoreV9 } from "../src/save/saveV9.ts";
import { TerrainGrid } from "../src/world/terrain/TerrainGrid.ts";

const require = createRequire(import.meta.url);
const addon = require(resolve(process.argv[2]));

function flatTerrain(width = 8, height = 6) {
  return new TerrainGrid(
    width,
    height,
    Array.from({ length: width * height }, () => ({
      elevation: 0.5,
      water: false,
      buildable: true,
      biome: "grass",
    })),
  );
}

function liveUrbanFixture() {
  const core = new SimulationCore({
    terrain: flatTerrain(),
    seed: 91,
    startingFunds: 500_000,
  });
  assert.equal(core.buildRoad([{ x: 2, y: 3 }], "local").ok, true);
  assert.equal(core.paintZone([{ x: 2, y: 2 }], "residential").painted, 1);
  core.buildings.restore([
    {
      id: "building:lot:2,2",
      lotId: "lot:2,2",
      x: 2,
      y: 2,
      zone: "residential",
      definitionId: "residential_cottage",
      status: "occupied",
      constructionStartedTick: 0,
      completionTick: 0,
    },
  ]);
  core.rebuildCadastreFromLegacyState();
  const parcel = core.cadastre.listParcels()[0];
  assert.ok(parcel);
  core.zoning.assignParcel(parcel.id, "R5");
  core.propertyMarket.restore({
    holdings: [
      { parcelId: parcel.id, ownerId: "owner:a", reservationValue: 100_000 },
    ],
    transactions: [],
    nextTransactionId: 1,
  });
  core.propertyMarket.transact({
    tick: 3,
    parcelIds: [parcel.id],
    buyerId: "owner:b",
    sellerId: "owner:a",
    purpose: "sale",
    price: 120_000,
    landValue: 80_000,
    improvementValue: 40_000,
  });
  const save = serializeCoreV9(core);
  assert.ok(save.buildingsV2[0]?.footprint.length);
  assert.ok(save.buildingsV2[0]?.lifecycle);
  assert.ok(save.transit);
  assert.ok(save.economyDomain);
  return save;
}

function historicalParcelFixture() {
  const save = structuredClone(liveUrbanFixture());
  const liveParcelId = save.urbanFabric.parcels[0]?.id;
  assert.ok(liveParcelId);
  const retiredParcelId = "parcel:retired:roundtrip";
  save.urbanFabric.lineage.push({
    id: "lineage:roundtrip:1",
    tick: 4,
    kind: "split",
    sourceParcelIds: [retiredParcelId],
    resultingParcelIds: [liveParcelId],
  });
  const historical = structuredClone(save.propertyMarket.transactions[0]);
  assert.ok(historical);
  historical.id = "property:tx:2";
  historical.parcelIds = [retiredParcelId];
  save.propertyMarket.transactions.push(historical);
  save.propertyMarket.nextTransactionId += 1;
  return save;
}

function firstMismatch(left, right, path = "") {
  if (Object.is(left, right)) return undefined;
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) {
      return `${path}/length: ${left.length} !== ${right.length}`;
    }
    for (let index = 0; index < left.length; index += 1) {
      const mismatch = firstMismatch(
        left[index],
        right[index],
        `${path}/${index}`,
      );
      if (mismatch) return mismatch;
    }
    return undefined;
  }
  if (
    left !== null &&
    right !== null &&
    typeof left === "object" &&
    typeof right === "object" &&
    !Array.isArray(left) &&
    !Array.isArray(right)
  ) {
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    const keyMismatch = firstMismatch(leftKeys, rightKeys, `${path}/$keys`);
    if (keyMismatch) return keyMismatch;
    for (const key of leftKeys) {
      const escaped = key.replaceAll("~", "~0").replaceAll("/", "~1");
      const mismatch = firstMismatch(
        left[key],
        right[key],
        `${path}/${escaped}`,
      );
      if (mismatch) return mismatch;
    }
    return undefined;
  }
  return `${path || "/"}: ${JSON.stringify(left)} !== ${JSON.stringify(right)}`;
}

function assertSame(left, right, label) {
  const mismatch = firstMismatch(left, right);
  assert.equal(mismatch, undefined, `${label}: first mismatch at ${mismatch}`);
}

function roundTrip(label, original) {
  const native = addon.createEngine({
    seed: original.seed,
    startTick: original.clock.tick,
    speed: original.clock.speed,
  });
  try {
    addon.loadV9(native, JSON.stringify(original));
    const nativeSave = JSON.parse(addon.saveV9(native));
    assertSame(nativeSave, original, `${label} TS -> C++ -> JSON`);

    const hydrated = hydrateCoreV9(structuredClone(nativeSave));
    const tsAgain = serializeCoreV9(hydrated);
    addon.loadV9(native, JSON.stringify(tsAgain));
    const nativeAgain = JSON.parse(addon.saveV9(native));
    assertSame(nativeAgain, nativeSave, `${label} C++ -> TS -> C++`);
  } finally {
    addon.destroyEngine(native);
  }
}

const live = liveUrbanFixture();
roundTrip("live urban fabric", live);
roundTrip("historical parcel lineage", historicalParcelFixture());

const malformedEngine = addon.createEngine({ seed: live.seed });
try {
  const malformedCases = [
    {
      name: "duplicate holding",
      code: 3,
      value: (() => {
        const save = structuredClone(live);
        save.propertyMarket.holdings.push(
          structuredClone(save.propertyMarket.holdings[0]),
        );
        return JSON.stringify(save);
      })(),
    },
    {
      name: "dangling building parcel",
      code: 3,
      value: (() => {
        const save = structuredClone(live);
        save.buildingsV2[0].parcelIds = ["parcel:missing"];
        return JSON.stringify(save);
      })(),
    },
    {
      name: "dangling transit stop",
      code: 3,
      value: (() => {
        const save = structuredClone(live);
        save.transit.network.stops = [
          { id: "s1", type: "surface_stop", x: 0, y: 0 },
        ];
        save.transit.network.lines = [
          {
            id: "l1",
            name: "bad",
            mode: "bus",
            stopIds: ["missing"],
            headwayTicks: 20,
            fare: 1,
            enabled: false,
          },
        ];
        return JSON.stringify(save);
      })(),
    },
    {
      name: "duplicate economy inventory key",
      code: 3,
      value: (() => {
        const save = structuredClone(live);
        save.economyDomain.inventories.records = [
          { firmId: "f1", commodity: "goods" },
          { firmId: "f1", commodity: "goods" },
        ];
        return JSON.stringify(save);
      })(),
    },
    {
      name: "wrong save version",
      code: 5,
      value: JSON.stringify({ ...structuredClone(live), saveVersion: 8 }),
    },
    {
      name: "non-finite token",
      code: 3,
      value: JSON.stringify(live).replace(/"tick":\d+/, '"tick":NaN'),
    },
  ];

  for (const malformed of malformedCases) {
    assert.throws(
      () => addon.loadV9(malformedEngine, malformed.value),
      (error) => error?.code === malformed.code,
      malformed.name,
    );
  }
} finally {
  addon.destroyEngine(malformedEngine);
}

console.log("Native Save V9 differential round-trip passed.");
