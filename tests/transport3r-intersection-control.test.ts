import assert from "node:assert/strict";
import test from "node:test";
import { IntersectionControlSystem } from "../src/simulation/transportation/IntersectionControlSystem.ts";
import type { TransportNetworkAuthority } from "../src/simulation/transportation/TransportNetworkTypes.ts";

const NETWORK: TransportNetworkAuthority = {
  junctions: [
    { id: "j:center", x: 0, y: 0 },
    { id: "j:west", x: -1, y: 0 },
    { id: "j:east", x: 1, y: 0 },
    { id: "j:north", x: 0, y: -1 },
    { id: "j:south", x: 0, y: 1 },
  ],
  segments: [],
  carriageways: [
    {
      id: "c:west-in",
      segmentId: "s:west",
      direction: "forward",
      fromJunctionId: "j:west",
      toJunctionId: "j:center",
      operatingClass: "local",
      laneIds: ["l:west-in"],
    },
    {
      id: "c:east-out",
      segmentId: "s:east",
      direction: "forward",
      fromJunctionId: "j:center",
      toJunctionId: "j:east",
      operatingClass: "local",
      laneIds: ["l:east-out"],
    },
    {
      id: "c:north-in",
      segmentId: "s:north",
      direction: "forward",
      fromJunctionId: "j:north",
      toJunctionId: "j:center",
      operatingClass: "local",
      laneIds: ["l:north-in"],
    },
    {
      id: "c:south-out",
      segmentId: "s:south",
      direction: "forward",
      fromJunctionId: "j:center",
      toJunctionId: "j:south",
      operatingClass: "local",
      laneIds: ["l:south-out"],
    },
  ],
  lanes: [
    {
      id: "l:west-in",
      carriagewayId: "c:west-in",
      ordinal: 0,
      kind: "through",
      permissions: 127,
      operatingState: "open",
      baseCapacityPerMinute: 600,
      freeFlowSpeedKph: 30,
    },
    {
      id: "l:east-out",
      carriagewayId: "c:east-out",
      ordinal: 0,
      kind: "through",
      permissions: 127,
      operatingState: "open",
      baseCapacityPerMinute: 600,
      freeFlowSpeedKph: 30,
    },
    {
      id: "l:north-in",
      carriagewayId: "c:north-in",
      ordinal: 0,
      kind: "through",
      permissions: 127,
      operatingState: "open",
      baseCapacityPerMinute: 600,
      freeFlowSpeedKph: 30,
    },
    {
      id: "l:south-out",
      carriagewayId: "c:south-out",
      ordinal: 0,
      kind: "through",
      permissions: 127,
      operatingState: "open",
      baseCapacityPerMinute: 600,
      freeFlowSpeedKph: 30,
    },
  ],
  movements: [
    {
      id: "m:west-through",
      junctionId: "j:center",
      fromCarriagewayId: "c:west-in",
      toCarriagewayId: "c:east-out",
      fromLaneIds: ["l:west-in"],
      toLaneIds: ["l:east-out"],
      turnKind: "through",
      permissions: 127,
      allowed: true,
      basePenaltyTicks: 0,
    },
    {
      id: "m:north-right",
      junctionId: "j:center",
      fromCarriagewayId: "c:north-in",
      toCarriagewayId: "c:east-out",
      fromLaneIds: ["l:north-in"],
      toLaneIds: ["l:east-out"],
      turnKind: "right",
      permissions: 127,
      allowed: true,
      basePenaltyTicks: 0,
    },
    {
      id: "m:north-through",
      junctionId: "j:center",
      fromCarriagewayId: "c:north-in",
      toCarriagewayId: "c:south-out",
      fromLaneIds: ["l:north-in"],
      toLaneIds: ["l:south-out"],
      turnKind: "through",
      permissions: 127,
      allowed: true,
      basePenaltyTicks: 0,
    },
  ],
};

test("stop control owns deterministic per-movement queues and discharges one eligible movement at a time", () => {
  const control = new IntersectionControlSystem();
  control.configure(NETWORK);
  control.setControlType("j:center", "stop");
  control.enqueue("m:west-through", {
    vehicleId: "vehicle:b",
    travelerWeight: 1,
    queuedTick: 1,
    priority: "normal",
  });
  control.enqueue("m:north-through", {
    vehicleId: "vehicle:a",
    travelerWeight: 1,
    queuedTick: 1,
    priority: "normal",
  });

  assert.equal(control.queueDemand("m:west-through"), 1);
  assert.equal(control.queueDemand("m:north-through"), 1);
  assert.deepEqual(control.stepJunction("j:center", 2), ["vehicle:a"]);
  control.removeVehicle("vehicle:a");
  assert.deepEqual(control.stepJunction("j:center", 3), ["vehicle:b"]);
});

test("signal control exposes protected and permissive movement permissions and deterministic phase service", () => {
  const control = new IntersectionControlSystem();
  control.configure(NETWORK);
  control.setControlType("j:center", "signal");

  assert.equal(control.movementPermission("m:west-through", 5), "protected");
  assert.equal(control.movementPermission("m:north-through", 5), "prohibited");
  assert.equal(control.movementPermission("m:north-right", 5), "permissive");

  control.enqueue("m:west-through", {
    vehicleId: "vehicle:h",
    travelerWeight: 1,
    queuedTick: 1,
    priority: "normal",
  });
  control.enqueue("m:north-through", {
    vehicleId: "vehicle:v",
    travelerWeight: 1,
    queuedTick: 1,
    priority: "normal",
  });
  assert.deepEqual(control.stepJunction("j:center", 5), ["vehicle:h"]);
  control.removeVehicle("vehicle:h");
  assert.deepEqual(control.stepJunction("j:center", 45), ["vehicle:v"]);
});

test("intersection state round-trips deterministically with pending releases intact", () => {
  const control = new IntersectionControlSystem();
  control.configure(NETWORK);
  control.setControlType("j:center", "signal");
  control.enqueue("m:west-through", {
    vehicleId: "vehicle:1",
    travelerWeight: 1,
    queuedTick: 1,
    priority: "emergency",
  });
  assert.deepEqual(control.stepJunction("j:center", 5), ["vehicle:1"]);
  const snapshot = control.snapshot();

  const restored = new IntersectionControlSystem();
  restored.configure(NETWORK);
  restored.restore(snapshot);
  assert.deepEqual(restored.snapshot(), snapshot);
  assert.deepEqual(restored.stepJunction("j:center", 6), ["vehicle:1"]);
  restored.removeVehicle("vehicle:1");
  assert.equal(restored.queueLength(), 0);
});
