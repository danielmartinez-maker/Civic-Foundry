import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  NativeWorldAuthority,
  nativeWorldAuthorityEnabledFromGlobal,
  withNativeWorldAuthorityOverride,
  type NativeWorldBridge,
  type NativeWorldCreateRequest,
} from "../src/native/world/NativeWorldAuthority.ts";
import { SimulationCore } from "../src/simulation/core/SimulationCore.ts";
import { RandomStreamRegistry } from "../src/simulation/kernel/RandomStreamRegistry.ts";
import { WorldFoundation } from "../src/world/foundation/WorldFoundation.ts";
import type { WorldFoundationSnapshot } from "../src/world/foundation/WorldFoundationTypes.ts";
import { resolveWorldGenerationConfig } from "../src/world/generation/WorldGenerationConfig.ts";
import type { DesignStormEvent, FloodResult } from "../src/world/hydrology/HydrologyTypes.ts";

function referenceWorld(seed = 1337): WorldFoundation {
  const config = resolveWorldGenerationConfig({
    width: 6,
    height: 5,
    metersPerCell: 30,
    preset: "rolling_uplands",
  });
  return WorldFoundation.generate({
    seed,
    config,
    randomRegistry: new RandomStreamRegistry(seed),
  });
}

class FakeNativeWorldBridge implements NativeWorldBridge {
  createCalls: NativeWorldCreateRequest[] = [];
  restoreCalls = 0;
  stormCalls: DesignStormEvent[] = [];
  private world: WorldFoundation;

  constructor(world = referenceWorld()) {
    this.world = WorldFoundation.restore(world.snapshotAuthoritative());
  }

  createWorld(request: NativeWorldCreateRequest): WorldFoundationSnapshot {
    this.createCalls.push(structuredClone(request));
    return this.world.snapshotAuthoritative();
  }

  restoreWorld(snapshot: WorldFoundationSnapshot): WorldFoundationSnapshot {
    this.restoreCalls += 1;
    this.world = WorldFoundation.restore(snapshot);
    return this.world.snapshotAuthoritative();
  }

  createLegacyWorld(request: Readonly<{ seed: number; mode: "legacy-flat" | "legacy-explicit"; terrain: Readonly<{ width: number; height: number; cells: readonly unknown[] }> }>): WorldFoundationSnapshot {
    throw new Error(`legacy path not expected in this fixture: ${request.seed}:${request.mode}:${request.terrain.width}`);
  }

  runDesignStorm(event: DesignStormEvent): Readonly<{ result: FloodResult; snapshot: WorldFoundationSnapshot }> {
    this.stormCalls.push(structuredClone(event));
    const result = this.world.runDesignStorm(event);
    return Object.freeze({ result, snapshot: this.world.snapshotAuthoritative() });
  }
}

test("native WorldFoundation authority is a snapshot facade and never reconstructs the TypeScript WorldFoundation", () => {
  const reference = referenceWorld();
  const snapshot = reference.snapshotAuthoritative();
  const bridge = new FakeNativeWorldBridge(reference);
  const world = NativeWorldAuthority.fromSnapshot(bridge, snapshot);

  assert.deepEqual(world.snapshotAuthoritative(), snapshot);
  assert.deepEqual(world.legacyTerrain().snapshot(), reference.legacyTerrain().snapshot());
  assert.equal(world.preparationMultiplierAt(2, 2), reference.preparationMultiplierAt(2, 2));
  assert.equal(world.seed, snapshot.seed);
  assert.equal(world.scenarioId, snapshot.scenarioId);

  const source = readFileSync(
    new URL("../src/native/world/NativeWorldAuthority.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /from ["'][^"']*WorldFoundation\.ts["']/);
  assert.doesNotMatch(source, /WorldFoundation\.(?:generate|restore|fromLegacyTerrain)/);
});

test("Task 19 feature gate makes SimulationCore read the native WorldFoundation snapshot", () => {
  const bridge = new FakeNativeWorldBridge();
  const core = withNativeWorldAuthorityOverride(
    { enabled: true, bridge },
    () =>
      new SimulationCore({
        seed: 1337,
        width: 6,
        height: 5,
        worldConfig: { metersPerCell: 30, preset: "rolling_uplands" },
      }),
  );

  assert.ok(core.world instanceof NativeWorldAuthority);
  assert.equal(bridge.createCalls.length, 1);
  assert.deepEqual(core.world.snapshotAuthoritative(), referenceWorld().snapshotAuthoritative());
  assert.deepEqual(core.terrain.snapshot(), core.world.legacyTerrain().snapshot());
});

test("native design storms cross the bridge and refresh the native snapshot instead of mutating a TS world", () => {
  const bridge = new FakeNativeWorldBridge();
  const core = withNativeWorldAuthorityOverride(
    { enabled: true, bridge },
    () => new SimulationCore({ seed: 1337, width: 6, height: 5 }),
  );
  const before = core.world.snapshotAuthoritative();
  const event: DesignStormEvent = { id: "storm:task19", rainfallMm: 42, durationHours: 2 };

  const result = core.runDesignStorm(event);

  assert.equal(bridge.stormCalls.length, 1);
  assert.deepEqual(bridge.stormCalls[0], event);
  assert.equal(result.eventId, event.id);
  assert.equal(before.lastFloodResult, null);
  assert.deepEqual(core.world.snapshotAuthoritative().lastFloodResult, result);
});

test("disabled native world gate preserves the TypeScript reference path for parity and browser smoke", () => {
  const bridge = new FakeNativeWorldBridge();
  const core = withNativeWorldAuthorityOverride(
    { enabled: false, bridge },
    () => new SimulationCore({ seed: 1337, width: 6, height: 5 }),
  );
  assert.ok(core.world instanceof WorldFoundation);
  assert.equal(bridge.createCalls.length, 0);
});

test("native world authority global gate is explicit and defaults off", () => {
  assert.equal(nativeWorldAuthorityEnabledFromGlobal({}), false);
  assert.equal(nativeWorldAuthorityEnabledFromGlobal({ __CIVIC_NATIVE_WORLD_AUTHORITY__: true }), true);
  assert.equal(nativeWorldAuthorityEnabledFromGlobal({ __CIVIC_NATIVE_WORLD_AUTHORITY__: "1" }), true);
  assert.equal(nativeWorldAuthorityEnabledFromGlobal({ __CIVIC_NATIVE_WORLD_AUTHORITY__: "false" }), false);
});
