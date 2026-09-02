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

function fakeAddon(): NativeEngineAddon & { calls: string[] } {
  const calls: string[] = [];
  const handle = {};
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
      ownership: domain === "kernel" ? 1 : 2,
      version: 1,
      value: 42n,
    }),
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
  const invalidPayloads: unknown[] = [
    undefined,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    1n,
    { nested: undefined },
    new Date(0),
    sparseArray,
  ];
  for (const [index, payload] of invalidPayloads.entries()) {
    assert.throws(
      () =>
        bridge.submit([
          { sequence: index + 1, tick: 0, type: "invalid", payload },
        ]),
      /JSON-compatible/,
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
    runner.compareDomains(["kernel", "world"]).map((item) => ({
      domain: item.domain,
      ownership: item.native.ownership,
      matches: item.matches,
    })),
    [
      { domain: "kernel", ownership: "owned", matches: true },
      { domain: "world", ownership: "unowned", matches: undefined },
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
