import assert from "node:assert/strict";
import test from "node:test";
import { TreasurySystem } from "../src/simulation/treasury/TreasurySystem.ts";
import { TransportationGraph } from "../src/simulation/traffic/TransportationGraph.ts";
import { Transportation3RRuntime } from "../src/simulation/transportation/Transportation3RRuntime.ts";
import { VEHICLE_PERMISSION } from "../src/simulation/transportation/TransportNetworkTypes.ts";
import { RoadSystem } from "../src/world/roads/RoadSystem.ts";
import {
  TerrainGrid,
  type TerrainCell,
} from "../src/world/terrain/TerrainGrid.ts";

function flat(width = 7, height = 5): TerrainGrid {
  const cells: TerrainCell[] = Array.from({ length: width * height }, () => ({
    elevation: 0.5,
    water: false,
    buildable: true,
    biome: "grass",
  }));
  return new TerrainGrid(width, height, cells);
}

function roadsWithDetour(): { roads: RoadSystem; graph: TransportationGraph } {
  const roads = new RoadSystem(flat());
  const treasury = new TreasurySystem(100_000);
  assert.equal(
    roads.placePath(
      [
        { x: 1, y: 2 },
        { x: 2, y: 2 },
        { x: 3, y: 2 },
        { x: 4, y: 2 },
        { x: 5, y: 2 },
        { x: 2, y: 1 },
        { x: 3, y: 1 },
        { x: 4, y: 1 },
      ],
      "local",
      treasury,
    ).ok,
    true,
  );
  return { roads, graph: new TransportationGraph() };
}

test("3R runtime owns the network projection while preserving legacy route shape", () => {
  const { roads, graph } = roadsWithDetour();
  const runtime = new Transportation3RRuntime();
  assert.equal(runtime.refreshNetwork(roads, graph), true);
  assert.equal(graph.sourceRoadRevision, roads.revision);
  assert.ok(runtime.networkSnapshot().movements.length > 0);

  const route = runtime.findLegacyRoute(graph, "n:1,2", "n:5,2", {
    permissions: VEHICLE_PERMISSION.privateCar,
    destinationAccessible: true,
  });
  assert.ok(route);
  assert.deepEqual(route.nodeIds, [
    "n:1,2",
    "n:2,2",
    "n:3,2",
    "n:4,2",
    "n:5,2",
  ]);
  assert.equal(route.edgeIds.length, 4);
});

test("3R incidents feed routing state and deterministically divert around a closed segment", () => {
  const { roads, graph } = roadsWithDetour();
  const runtime = new Transportation3RRuntime();
  runtime.refreshNetwork(roads, graph);
  const directEdge = "e:n:2,2>n:3,2";
  const segmentId = runtime.segmentIdForLegacyEdge(directEdge);
  assert.ok(segmentId);
  runtime.incidents.upsert({
    id: "incident:closure",
    kind: "closure",
    segmentId,
    laneIds: [],
    startTick: 10,
    endTick: 30,
    capacityMultiplier: 0,
    traversalPenaltyTicks: 100,
    requiredResponse: "road-service",
  });
  runtime.updateCosts(graph, [], 10);

  const diverted = runtime.findLegacyRoute(graph, "n:1,2", "n:5,2", {
    permissions: VEHICLE_PERMISSION.privateCar,
    destinationAccessible: true,
  });
  assert.ok(diverted);
  assert.equal(diverted.edgeIds.includes(directEdge), false);
  assert.deepEqual(diverted.nodeIds, [
    "n:1,2",
    "n:2,2",
    "n:2,1",
    "n:3,1",
    "n:4,1",
    "n:4,2",
    "n:5,2",
  ]);
});
