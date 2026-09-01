import assert from "node:assert/strict";
import test from "node:test";

import { FreightDemandSystem, type FreightOrder } from "../src/simulation/economy/FreightDemandSystem.ts";
import { TradeSystem } from "../src/simulation/economy/TradeSystem.ts";
import { SimulationCore } from "../src/simulation/core/SimulationCore.ts";
import { TerrainGrid, type TerrainCell } from "../src/world/terrain/TerrainGrid.ts";

function flat(width = 10, height = 5) {
  const cells: TerrainCell[] = Array.from({ length: width * height }, () => ({
    elevation: 0.5,
    water: false,
    buildable: true,
    biome: "grass" as const,
  }));
  return new TerrainGrid(width, height, cells);
}

test("gateway list is stable for boundary-connected road graph", () => {
  const core = new SimulationCore({ terrain: flat() });
  core.buildRoad(
    Array.from({ length: 10 }, (_, x) => ({ x, y: 2 })),
    "local",
  );
  core.transportationGraph.rebuildIfNeeded(core.roads);
  const trade = new TradeSystem();
  trade.rebuildGateways(core.transportationGraph, 10, 5);
  assert.deepEqual(
    trade.listGateways().map((gateway) => gateway.id),
    ["gateway:0:2", "gateway:9:2"],
  );
});

test("industrial input order rejects local suppliers", () => {
  const demand = new FreightDemandSystem();
  const order: FreightOrder = {
    id: "o1",
    commodity: "industrial_inputs",
    quantity: 5,
    destinationKind: "firm",
    destinationId: "firm:i",
    createdTick: 10,
    priority: 1,
    status: "waiting",
  };
  const match = demand.matchOrder(
    order,
    [
      { kind: "firm", id: "firm:local", available: 50 },
      { kind: "gateway", id: "gateway:0:2", available: Infinity },
    ],
    (candidate) => (candidate.kind === "firm" ? 1 : 10),
  );
  assert.equal(match?.originKind, "gateway");
});

test("lower generalized cost wins and stable id breaks ties", () => {
  const demand = new FreightDemandSystem();
  const order: FreightOrder = {
    id: "o2",
    commodity: "manufactured_goods",
    quantity: 5,
    destinationKind: "firm",
    destinationId: "firm:w",
    createdTick: 10,
    priority: 1,
    status: "waiting",
  };
  const match = demand.matchOrder(
    order,
    [
      { kind: "firm", id: "firm:b", available: 5 },
      { kind: "firm", id: "firm:a", available: 5 },
    ],
    () => 20,
  );
  assert.equal(match?.originId, "firm:a");
});
