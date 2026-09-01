import assert from "node:assert/strict";
import test from "node:test";
import { hydrateCore, serializeCore } from "../src/save/save.ts";
import { serializeCoreV9 } from "../src/save/saveV9.ts";
import { SimulationCore } from "../src/simulation/core/SimulationCore.ts";
import {
  TerrainGrid,
  type TerrainCell,
} from "../src/world/terrain/TerrainGrid.ts";

function flat(width = 8, height = 6): TerrainGrid {
  const cells: TerrainCell[] = Array.from({ length: width * height }, () => ({
    elevation: 0.5,
    water: false,
    buildable: true,
    biome: "grass",
  }));
  return new TerrainGrid(width, height, cells);
}

function transportationCore(): SimulationCore {
  const core = new SimulationCore({
    terrain: flat(),
    startingFunds: 1_000_000,
  });
  assert.equal(
    core.buildRoad(
      [
        { x: 1, y: 3 },
        { x: 2, y: 3 },
        { x: 3, y: 3 },
        { x: 4, y: 3 },
        { x: 5, y: 3 },
        { x: 6, y: 3 },
      ],
      "collector",
    ).ok,
    true,
  );
  core.transportation3R.refreshNetwork(core.roads, core.transportationGraph);
  const edgeId = "e:n:2,3>n:3,3";
  const segmentId = core.transportation3R.segmentIdForLegacyEdge(edgeId);
  assert.ok(segmentId);
  core.transportation3R.incidents.upsert({
    id: "incident:v10",
    kind: "crash",
    segmentId,
    laneIds: [],
    startTick: 0,
    endTick: 100,
    capacityMultiplier: 0.5,
    traversalPenaltyTicks: 20,
    requiredResponse: "police",
  });
  core.transportation3R.parking.upsert({
    id: "parking:v10",
    destinationId: "building:destination",
    capacity: 2,
    occupied: 1,
    legal: true,
    pricePerTrip: 3,
    baseSearchTicks: 5,
    curbRegulation: "metered",
  });
  core.transportation3R.updateCosts(core.transportationGraph, [], 10);
  return core;
}

test("default save advances to V10 and round-trips Transportation 3R authority exactly", () => {
  const core = transportationCore();
  const save = serializeCore(core);
  assert.equal(save.saveVersion, 10);
  assert.equal(save.gameVersion, "0.10.0-transportation-3r");
  assert.equal(save.transportation3R.incidents.incidents.length, 1);
  assert.equal(save.transportation3R.parking.facilities.length, 1);
  assert.ok(save.transportation3R.dynamicRouting.costEpoch > 0);

  const restored = hydrateCore(structuredClone(save));
  assert.deepEqual(serializeCore(restored), save);
  assert.deepEqual(
    restored.transportation3R.incidents.snapshot(),
    core.transportation3R.incidents.snapshot(),
  );
  assert.deepEqual(
    restored.transportation3R.parking.snapshot(),
    core.transportation3R.parking.snapshot(),
  );
});

test("explicit V9 remains loadable and initializes new Transportation 3R history neutrally", () => {
  const core = transportationCore();
  const v9 = serializeCoreV9(core);
  assert.equal(v9.saveVersion, 9);

  const restored = hydrateCore(structuredClone(v9));
  assert.equal(
    restored.transportation3R.incidents.snapshot().incidents.length,
    0,
  );
  assert.equal(
    restored.transportation3R.parking.snapshot().facilities.length,
    0,
  );
  assert.equal(restored.transportation3R.dynamicRouting.costEpoch, 0);
  assert.ok(
    restored.transportation3R.networkSnapshot().carriageways.length > 0,
  );
  assert.equal(serializeCore(restored).saveVersion, 10);
});
