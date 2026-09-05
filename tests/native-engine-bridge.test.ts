import test from "node:test";
import assert from "node:assert/strict";
import {
  NativeEngineBridge,
  isNativeShadowEnabled,
  nativeShadowEnabledFromGlobal,
} from "../src/native/NativeEngineBridge.ts";
import {
  ShadowSimulationRunner,
  createShadowSimulationSessionIfEnabled,
} from "../src/native/ShadowSimulationRunner.ts";
import type {
  NativeEngineAddon,
  NativeEngineHandle,
} from "../src/native/NativeEngineTypes.ts";

function makeWorldSnapshot(
  seed: number,
  width = 2,
  height = 1,
): Record<string, unknown> {
  const count = width * height;
  return {
    mode: "generated-1r",
    seed,
    config: { width, height, metersPerCell: 30, preset: "plain" },
    scenarioId: null,
    terrain: {
      width,
      height,
      metersPerCell: 30,
      samples: Array.from({ length: count }, () => ({
        elevationMeters: 100,
        slope: 0,
        aspectRadians: 0,
        soilClass: "loam",
        soilDepthMeters: 2,
        bearingCapacityKpa: 160,
        bedrockDepthMeters: 8,
        groundwaterDepthMeters: 5,
        vegetationClass: "grass",
        contaminationIndex: 0,
        landPreparationMultiplier: 1,
        surfaceWater: "none",
        buildable: true,
      })),
    },
    hydrology: {
      width,
      height,
      conditionedElevationMeters: Array(count).fill(100),
      receiver: Array(count).fill(null),
      watersheds: [],
      channels: [],
      flowAccumulation: Array(count).fill(1),
      watershedIds: Array(count).fill("watershed:0"),
      floodSusceptibility: Array(count).fill(0),
    },
    geography: { entities: [] },
    legacyCompatibility: null,
    lastFloodResult: null,
  };
}

function fakeAddon(): NativeEngineAddon & { calls: string[] } {
  const calls: string[] = [];
  const handle = {};
  let worldSnapshot: Record<string, unknown> = makeWorldSnapshot(1);
  return {
    calls,
    createEngine: () => {
      calls.push("create");
      return handle;
    },
    destroyEngine: () => {
      calls.push("destroy");
    },
    submitCommands: (_handle, json) => {
      calls.push(`submit:${json}`);
    },
    step: (_handle, ticks) => {
      calls.push(`step:${ticks}`);
    },
    loadV9: () => {
      calls.push("load");
    },
    saveV9: () => '{"saveVersion":9}',
    getSnapshot: () =>
      '{"hashVersion":1,"pendingCommands":[],"randomStreams":{},"seed":1,"speed":1,"tick":0}',
    getEvents: () => "[]",
    getDomainHash: (_handle: NativeEngineHandle, domain: string) => ({
      ownership: domain === "kernel" || domain === "world" ? 1 : 2,
      version: 1,
      value: 42n,
    }),
    createWorld: (_handle, json) => {
      calls.push(`world-create:${json}`);
      const request = JSON.parse(json) as {
        seed: number;
        config: { width: number; height: number };
      };
      worldSnapshot = makeWorldSnapshot(
        request.seed,
        request.config.width,
        request.config.height,
      );
      return JSON.stringify(worldSnapshot);
    },
    restoreWorld: (_handle, json) => {
      calls.push(`world-restore:${json}`);
      worldSnapshot = JSON.parse(json) as Record<string, unknown>;
      return JSON.stringify(worldSnapshot);
    },
    createLegacyWorld: (_handle, json) => {
      calls.push(`world-legacy:${json}`);
      const request = JSON.parse(json) as {
        seed: number;
        terrain: { width: number; height: number };
      };
      worldSnapshot = {
        ...makeWorldSnapshot(
          request.seed,
          request.terrain.width,
          request.terrain.height,
        ),
        mode: "legacy-flat",
      };
      return JSON.stringify(worldSnapshot);
    },
    runDesignStorm: (_handle, json) => {
      calls.push(`world-storm:${json}`);
      const request = JSON.parse(json) as {
        event?: { id: string };
        id?: string;
      };
      const eventId = request.event?.id ?? request.id ?? "storm";
      const count =
        Number((worldSnapshot.terrain as { width: number }).width) *
        Number((worldSnapshot.terrain as { height: number }).height);
      const result = {
        eventId,
        depthMeters: Array(count).fill(0),
        rainfallVolume: 1,
        infiltrationVolume: 1,
        retainedChannelSurfaceVolume: 0,
        overbankFloodVolume: 0,
        exportedVolume: 0,
        balanceError: 0,
      };
      worldSnapshot = { ...worldSnapshot, lastFloodResult: result };
      return JSON.stringify({ result, snapshot: worldSnapshot });
    },
  };
}

test("native bridge owns lifecycle and normalizes command order before shadow submission", () => {
  const addon = fakeAddon();
  const bridge = new NativeEngineBridge(addon, { seed: 1 });
  const normalized = bridge.submit([
    { sequence: 2, tick: 3, type: "b", payload: { b: 2 } },
    { sequence: 1, tick: 3, type: "a", payload: { a: 1 } },
  ]);
  assert.deepEqual(
    normalized.map((item) => item.sequence),
    [1, 2],
  );
  const submitted = addon.calls.find((call) => call.startsWith("submit:"));
  assert.ok(submitted);
  assert.deepEqual(JSON.parse(submitted.slice("submit:".length)), [
    { version: 1, sequence: 1, tick: 3, type: "a", payload: { a: 1 } },
    { version: 1, sequence: 2, tick: 3, type: "b", payload: { b: 2 } },
  ]);
  assert.deepEqual(normalized, [
    { sequence: 1, tick: 3, type: "a", payload: { a: 1 } },
    { sequence: 2, tick: 3, type: "b", payload: { b: 2 } },
  ]);
  bridge.dispose();
  bridge.dispose();
  assert.equal(addon.calls.filter((call) => call === "destroy").length, 1);
  assert.throws(() => bridge.step(), /disposed/);
});

test("native bridge rejects lossy payloads and normalizes JSON numeric semantics", () => {
  const addon = fakeAddon();
  const bridge = new NativeEngineBridge(addon);
  const sparseArray: unknown[] = Array(3);
  sparseArray[0] = 1;
  sparseArray[2] = 3;
  const invalidPayloads: ReadonlyArray<readonly [unknown, RegExp]> = [
    [undefined, /JSON-compatible/],
    [Number.NaN, /JSON-compatible/],
    [Number.POSITIVE_INFINITY, /JSON-compatible/],
    [Number.NEGATIVE_INFINITY, /JSON-compatible/],
    [1n, /JSON-compatible/],
    [{ nested: undefined }, /JSON-compatible/],
    [new Date(0), /JSON-compatible/],
    [sparseArray, /sparse arrays/],
  ];
  for (const [index, [payload, expected]] of invalidPayloads.entries()) {
    assert.throws(
      () =>
        bridge.submit([
          { sequence: index + 1, tick: 0, type: "invalid", payload },
        ]),
      expected,
    );
  }
  assert.throws(
    () =>
      bridge.submit([
        {
          sequence: Number.MAX_SAFE_INTEGER + 1,
          tick: 0,
          type: "unsafe-sequence",
          payload: null,
        },
      ]),
    /safe integer/,
  );
  assert.throws(
    () =>
      bridge.loadV9({
        saveVersion: 9,
        compatibility: { nonFinite: Number.NaN },
      }),
    /Save V9.*JSON-compatible/,
  );
  const normalized = bridge.submit([
    {
      sequence: 100,
      tick: 0,
      type: "negative-zero",
      payload: { value: -0 },
    },
  ]);
  const normalizedCommand = normalized[0];
  assert.ok(normalizedCommand);
  const payload = normalizedCommand.payload as Readonly<{ value: number }>;
  assert.equal(payload.value, 0);
  assert.equal(Object.is(payload.value, -0), false);
  bridge.dispose();
});

test("native engine bridge is the concrete NativeWorldBridge and materializes flood surfaces", () => {
  const addon = fakeAddon();
  const bridge = new NativeEngineBridge(addon, { seed: 5 });
  const created = bridge.createWorld({
    seed: 5,
    config: { width: 2, height: 1, metersPerCell: 30, preset: "plain" },
  });
  assert.equal(created.seed, 5);
  assert.equal(created.terrain.width, 2);
  assert.equal(bridge.domainHash("world").ownership, "owned");

  const storm = bridge.runDesignStorm(
    { id: "native-storm", rainfallMm: 25, durationHours: 2 },
    { imperviousFractionAt: (x) => x * 0.5 },
  );
  assert.equal(storm.result.eventId, "native-storm");
  const stormCall = addon.calls.find((call) => call.startsWith("world-storm:"));
  assert.ok(stormCall);
  assert.deepEqual(
    (
      JSON.parse(stormCall.slice("world-storm:".length)) as {
        imperviousFraction: number[];
      }
    ).imperviousFraction,
    [0, 0.5],
  );

  const restored = bridge.restoreWorld(created);
  assert.equal(restored.seed, 5);
  assert.throws(
    () =>
      bridge.runDesignStorm(
        { id: "invalid-surface", rainfallMm: 1, durationHours: 1 },
        { imperviousFractionAt: () => Number.NaN },
      ),
    /impervious fraction/,
  );
  bridge.dispose();
});

test("shadow runner feeds identical normalized commands to both runtimes and ignores unowned domains", () => {
  const addon = fakeAddon();
  const bridge = new NativeEngineBridge(addon);
  const received: number[][] = [];
  const steps: number[] = [];
  const runner = new ShadowSimulationRunner(
    {
      submit: (commands) =>
        received.push(commands.map((item) => item.sequence)),
      step: (ticks) => steps.push(ticks),
      domainHash: () => 42n,
    },
    bridge,
  );
  runner.submit([
    { sequence: 2, tick: 1, type: "b", payload: null },
    { sequence: 1, tick: 1, type: "a", payload: null },
  ]);
  runner.step(4);
  assert.deepEqual(received, [[1, 2]]);
  assert.deepEqual(steps, [4]);
  assert.deepEqual(
    runner.compareDomains(["kernel", "services"]).map((item) => ({
      domain: item.domain,
      ownership: item.native.ownership,
      matches: item.matches,
    })),
    [
      { domain: "kernel", ownership: "owned", matches: true },
      { domain: "services", ownership: "unowned", matches: undefined },
    ],
  );
  bridge.dispose();
});

test("native shadow mode is opt-in and disabled by default-like values", () => {
  assert.equal(isNativeShadowEnabled(undefined), false);
  assert.equal(isNativeShadowEnabled(false), false);
  assert.equal(isNativeShadowEnabled("0"), false);
  assert.equal(isNativeShadowEnabled("true"), true);
  assert.equal(isNativeShadowEnabled(true), true);
  assert.equal(nativeShadowEnabledFromGlobal({}), false);
  assert.equal(
    nativeShadowEnabledFromGlobal({ __CIVIC_NATIVE_SHADOW__: "1" }),
    true,
  );
});

test("shadow feature flag constructs a dev/test session only when explicitly enabled", () => {
  const reference = {
    submit: () => undefined,
    step: () => undefined,
    domainHash: () => 42n,
  };

  const disabledAddon = fakeAddon();
  const disabled = createShadowSimulationSessionIfEnabled(
    reference,
    disabledAddon,
    { seed: 3 },
    {},
  );
  assert.equal(disabled, null);
  assert.deepEqual(disabledAddon.calls, []);

  const enabledAddon = fakeAddon();
  const enabled = createShadowSimulationSessionIfEnabled(
    reference,
    enabledAddon,
    { seed: 3 },
    { __CIVIC_NATIVE_SHADOW__: "1" },
  );
  assert.ok(enabled);
  assert.deepEqual(enabledAddon.calls, ["create"]);
  enabled.runner.step(1);
  enabled.dispose();
  enabled.dispose();
  assert.equal(
    enabledAddon.calls.filter((call) => call === "destroy").length,
    1,
  );
});
