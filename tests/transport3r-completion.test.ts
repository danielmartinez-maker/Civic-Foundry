import assert from "node:assert/strict";
import test from "node:test";
import { DynamicRoutingSystem } from "../src/simulation/transportation/DynamicRoutingSystem.ts";
import { GeneralizedTravelCostSystem } from "../src/simulation/transportation/GeneralizedTravelCostSystem.ts";
import { ParkingAuthoritySystem } from "../src/simulation/transportation/ParkingAuthoritySystem.ts";
import { TransportationIncidentSystem } from "../src/simulation/transportation/TransportationIncidentSystem.ts";
import type {
  RoutingArc,
  RoutingState,
  RoutingTopology,
} from "../src/simulation/transportation/RoutingTopology.ts";
import { ALL_VEHICLE_PERMISSIONS } from "../src/simulation/transportation/TransportNetworkTypes.ts";

function topology(arcs: readonly RoutingArc[]): RoutingTopology {
  const states: RoutingState[] = [
    { junctionId: "A" },
    { junctionId: "B", incomingCarriagewayId: "c1" },
    { junctionId: "C", incomingCarriagewayId: "c3" },
    { junctionId: "D", incomingCarriagewayId: "c2" },
    { junctionId: "D", incomingCarriagewayId: "c4" },
  ];
  return {
    revision: 1,
    states,
    arcs,
    outgoingArcs(state) {
      const key = `${state.junctionId}|${state.incomingCarriagewayId ?? "-"}`;
      return arcs.filter((arc) => arc.fromStateKey === key);
    },
  };
}

const ROUTING_TOPOLOGY = topology([
  {
    id: "a-c1",
    fromStateKey: "A|-",
    toState: { junctionId: "B", incomingCarriagewayId: "c1" },
    carriagewayId: "c1",
    laneGroupIds: ["lg1"],
    permissions: ALL_VEHICLE_PERMISSIONS,
    traversalTicks: 10,
    movementPenaltyTicks: 0,
  },
  {
    id: "b-c2",
    fromStateKey: "B|c1",
    toState: { junctionId: "D", incomingCarriagewayId: "c2" },
    carriagewayId: "c2",
    laneGroupIds: ["lg2"],
    movementId: "m1",
    permissions: ALL_VEHICLE_PERMISSIONS,
    traversalTicks: 10,
    movementPenaltyTicks: 0,
  },
  {
    id: "a-c3",
    fromStateKey: "A|-",
    toState: { junctionId: "C", incomingCarriagewayId: "c3" },
    carriagewayId: "c3",
    laneGroupIds: ["lg3"],
    permissions: ALL_VEHICLE_PERMISSIONS,
    traversalTicks: 15,
    movementPenaltyTicks: 0,
  },
  {
    id: "c-c4",
    fromStateKey: "C|c3",
    toState: { junctionId: "D", incomingCarriagewayId: "c4" },
    carriagewayId: "c4",
    laneGroupIds: ["lg4"],
    movementId: "m2",
    permissions: ALL_VEHICLE_PERMISSIONS,
    traversalTicks: 15,
    movementPenaltyTicks: 0,
  },
]);

test("dynamic routing reacts deterministically to congestion, restrictions, incidents, and destination accessibility", () => {
  const routing = new DynamicRoutingSystem();
  const firstEpoch = routing.updateState({
    travelTimeTicksByCarriageway: { c1: 10, c2: 10, c3: 15, c4: 15 },
    blockedCarriagewayIds: [],
    incidentPenaltyTicksByCarriageway: {},
  });
  assert.equal(firstEpoch, 1);
  const fast = routing.findRoute(ROUTING_TOPOLOGY, "A", "D", {
    permissions: ALL_VEHICLE_PERMISSIONS,
    destinationAccessible: true,
  });
  assert.deepEqual(fast?.carriagewayIds, ["c1", "c2"]);
  const again = routing.findRoute(ROUTING_TOPOLOGY, "A", "D", {
    permissions: ALL_VEHICLE_PERMISSIONS,
    destinationAccessible: true,
  });
  assert.deepEqual(again, fast);
  assert.ok(routing.diagnostics.cacheHits >= 1);

  const unchangedEpoch = routing.updateState({
    travelTimeTicksByCarriageway: { c4: 15, c3: 15, c2: 10, c1: 10 },
    blockedCarriagewayIds: [],
    incidentPenaltyTicksByCarriageway: {},
  });
  assert.equal(unchangedEpoch, firstEpoch);

  const secondEpoch = routing.updateState({
    travelTimeTicksByCarriageway: { c1: 10, c2: 10, c3: 15, c4: 15 },
    blockedCarriagewayIds: ["c1"],
    incidentPenaltyTicksByCarriageway: { c2: 50 },
  });
  assert.equal(secondEpoch, firstEpoch + 1);
  const diverted = routing.findRoute(ROUTING_TOPOLOGY, "A", "D", {
    permissions: ALL_VEHICLE_PERMISSIONS,
    destinationAccessible: true,
  });
  assert.deepEqual(diverted?.carriagewayIds, ["c3", "c4"]);
  assert.equal(
    routing.findRoute(ROUTING_TOPOLOGY, "A", "D", {
      permissions: ALL_VEHICLE_PERMISSIONS,
      destinationAccessible: false,
    }),
    null,
  );
});

test("generalized travel cost produces an explainable causal breakdown and rejects non-finite inputs", () => {
  const costs = new GeneralizedTravelCostSystem();
  const result = costs.evaluate({
    mode: "car",
    available: true,
    inVehicleTimeTicks: 100,
    waitTimeTicks: 0,
    accessEgressTicks: 8,
    transferCount: 0,
    transferPenaltyTicks: 20,
    reliabilityPenaltyTicks: 12,
    parkingSearchTicks: 10,
    moneyCost: 3,
    moneyWeightTicksPerCurrency: 5,
  });
  assert.ok(result);
  assert.equal(result.totalTicks, 145);
  assert.deepEqual(result.breakdown, {
    inVehicleTimeTicks: 100,
    waitTimeTicks: 0,
    accessEgressTicks: 8,
    transferPenaltyTicks: 0,
    reliabilityPenaltyTicks: 12,
    parkingSearchTicks: 10,
    moneyImpedanceTicks: 15,
  });
  assert.equal(costs.evaluate({ ...result.input, available: false }), null);
  assert.throws(
    () => costs.evaluate({ ...result.input, inVehicleTimeTicks: Number.NaN }),
    /finite/,
  );
});

test("transportation incidents own deterministic roadway effects without owning emergency dispatch", () => {
  const incidents = new TransportationIncidentSystem();
  incidents.upsert({
    id: "incident:1",
    kind: "crash",
    segmentId: "s1",
    laneIds: ["l1"],
    startTick: 5,
    endTick: 15,
    capacityMultiplier: 0.5,
    traversalPenaltyTicks: 30,
    requiredResponse: "police",
  });
  incidents.advance(4);
  assert.deepEqual(incidents.active(), []);
  incidents.advance(5);
  assert.equal(incidents.active().length, 1);
  assert.deepEqual(incidents.effectsForSegment("s1"), {
    capacityMultiplier: 0.5,
    closedLaneIds: ["l1"],
    traversalPenaltyTicks: 30,
  });
  assert.deepEqual(incidents.serviceRequests(), [
    { incidentId: "incident:1", requiredResponse: "police" },
  ]);
  const snapshot = incidents.snapshot();
  const restored = new TransportationIncidentSystem();
  restored.restore(snapshot);
  assert.deepEqual(restored.snapshot(), snapshot);
  restored.advance(15);
  assert.equal(restored.active().length, 0);
});

test("parking authority conserves capacity and exposes price, legality, availability, curb rules, and search impedance", () => {
  const parking = new ParkingAuthoritySystem();
  parking.upsert({
    id: "parking:dest:1",
    destinationId: "dest",
    capacity: 2,
    occupied: 0,
    legal: true,
    pricePerTrip: 4,
    baseSearchTicks: 6,
    curbRegulation: "metered",
  });
  assert.equal(parking.reserve("dest", "vehicle:b"), "parking:dest:1");
  assert.equal(parking.reserve("dest", "vehicle:a"), "parking:dest:1");
  assert.equal(parking.reserve("dest", "vehicle:c"), null);
  assert.deepEqual(parking.destinationState("dest"), {
    capacity: 2,
    occupied: 2,
    available: 0,
    legalCapacity: 2,
    pricePerTrip: 4,
    searchPenaltyTicks: 18,
    curbRegulations: ["metered"],
  });
  assert.equal(parking.release("vehicle:a"), true);
  assert.equal(parking.destinationState("dest").available, 1);
  const snapshot = parking.snapshot();
  const restored = new ParkingAuthoritySystem();
  restored.restore(snapshot);
  assert.deepEqual(restored.snapshot(), snapshot);
  assert.throws(
    () =>
      parking.upsert({
        id: "bad",
        destinationId: "dest",
        capacity: 1,
        occupied: 2,
        legal: true,
        pricePerTrip: 0,
        baseSearchTicks: 0,
        curbRegulation: "none",
      }),
    /occupancy/,
  );
});
