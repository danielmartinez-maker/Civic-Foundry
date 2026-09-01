import assert from "node:assert/strict";
import test from "node:test";

import { HydrologyModel } from "../src/world/hydrology/HydrologyModel.ts";
import { TerrainField } from "../src/world/terrain/TerrainField.ts";
import type { TerrainPhysicalSample } from "../src/world/terrain/TerrainTypes.ts";

function funnelTerrain(
  width = 7,
  height = 7,
): { terrain: TerrainField; conditioned: Float64Array } {
  const samples: TerrainPhysicalSample[] = [];
  const elevation = new Float64Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const e = 100 + Math.abs(x - 3) * 10 + (height - 1 - y);
      elevation[y * width + x] = e;
      samples.push({
        elevationMeters: e,
        slope: 0.05,
        aspectRadians: 0,
        soilClass: "loam",
        soilDepthMeters: 2,
        bearingCapacityKpa: 160,
        bedrockDepthMeters: 5,
        groundwaterDepthMeters: 3,
        vegetationClass: "grass",
        contaminationIndex: 0,
        landPreparationMultiplier: 1,
        surfaceWater: "none",
        buildable: true,
      });
    }
  }
  return {
    terrain: TerrainField.fromSamples(width, height, 30, samples),
    conditioned: elevation,
  };
}

test("hydrology model assigns every cell to one watershed and conserves accumulation downstream", () => {
  const { terrain, conditioned } = funnelTerrain();
  const model = HydrologyModel.build(terrain, conditioned);
  const snapshot = model.snapshotAuthoritative();
  assert.equal(snapshot.watershedIds.length, 49);
  assert.equal(
    snapshot.watershedIds.every((id) => id.length > 0),
    true,
  );
  assert.equal(
    snapshot.watersheds.reduce((sum, item) => sum + item.memberCount, 0),
    49,
  );
  for (let index = 0; index < snapshot.receiver.length; index++) {
    const receiver = snapshot.receiver[index];
    if (receiver !== null && receiver !== undefined) {
      assert.ok(
        snapshot.flowAccumulation[receiver]! >=
          snapshot.flowAccumulation[index]!,
      );
    }
  }
});

test("terrain-derived channels follow drainage receivers and include the high-accumulation trunk", () => {
  const { terrain, conditioned } = funnelTerrain();
  const model = HydrologyModel.build(terrain, conditioned);
  const snapshot = model.snapshotAuthoritative();
  assert.ok(snapshot.channels.length > 0);
  for (const channel of snapshot.channels)
    assert.equal(channel.toIndex, snapshot.receiver[channel.fromIndex]);
  assert.ok(snapshot.channels.some((channel) => channel.accumulation >= 12));
});

test("static flood susceptibility is higher in the convergent lowland than on a ridge cell", () => {
  const { terrain, conditioned } = funnelTerrain();
  const model = HydrologyModel.build(terrain, conditioned);
  const lowland = model.sampleAt(3, 5);
  const ridge = model.sampleAt(1, 1);
  assert.ok(lowland.flowAccumulation > ridge.flowAccumulation);
  assert.ok(lowland.floodSusceptibility > ridge.floodSusceptibility);
  assert.ok(
    lowland.floodSusceptibility >= 0 && lowland.floodSusceptibility <= 1,
  );
});

test("hydrology snapshot restores exactly", () => {
  const { terrain, conditioned } = funnelTerrain();
  const snapshot = HydrologyModel.build(
    terrain,
    conditioned,
  ).snapshotAuthoritative();
  const restored = HydrologyModel.restore(snapshot);
  assert.deepEqual(restored.snapshotAuthoritative(), snapshot);
});
