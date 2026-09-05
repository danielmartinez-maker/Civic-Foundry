import test from "node:test";
import assert from "node:assert/strict";

import {
  DesktopNativeEngineAddon,
  desktopNativeEngineAddonFromGlobal,
  hasDesktopNativeHost,
  type DesktopNativeEngineApi,
} from "../src/native/DesktopNativeEngineAddon.ts";
import { NativeEngineBridge } from "../src/native/NativeEngineBridge.ts";

function fakeDesktopApi(): DesktopNativeEngineApi & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    available: () => true,
    createEngine: (config = {}) => { calls.push(`create:${JSON.stringify(config)}`); return true; },
    destroyEngine: () => { calls.push("destroy"); return true; },
    submitCommands: (json) => { calls.push(`submit:${json}`); return true; },
    step: (ticks) => { calls.push(`step:${ticks}`); return true; },
    loadV9: (json) => { calls.push(`load:${json}`); return true; },
    saveV9: () => '{"saveVersion":9}',
    getSnapshot: () => '{"hashVersion":1,"pendingCommands":[],"randomStreams":{},"seed":7,"speed":1,"tick":0}',
    getEvents: () => "[]",
    getDomainHash: () => ({ ownership: 1, version: 1, value: "42" }),
  };
}

test("desktop addon adapts the hardened preload API to NativeEngineBridge", () => {
  const api = fakeDesktopApi();
  const bridge = new NativeEngineBridge(new DesktopNativeEngineAddon(api), { seed: 7 });
  bridge.submit([{ sequence: 1, tick: 0, type: "transport.legacy_roads.replace", payload: { revision: 0, cells: [] } }]);
  bridge.step(0);
  assert.equal(bridge.domainHash("transportation").value, 42n);
  bridge.dispose();
  assert.deepEqual(api.calls.map((call) => call.split(":", 1)[0]), ["create", "submit", "step", "destroy"]);
});

test("desktop native discovery distinguishes browser fallback from unavailable desktop addon", () => {
  assert.equal(hasDesktopNativeHost({}), false);
  assert.equal(desktopNativeEngineAddonFromGlobal({}), undefined);

  const unavailable = fakeDesktopApi();
  const scope = { __CIVIC_NATIVE_DESKTOP__: { ...unavailable, available: () => false } };
  assert.equal(hasDesktopNativeHost(scope), true);
  assert.equal(desktopNativeEngineAddonFromGlobal(scope), undefined);

  const available = fakeDesktopApi();
  assert.ok(desktopNativeEngineAddonFromGlobal({ __CIVIC_NATIVE_DESKTOP__: available }));
});
