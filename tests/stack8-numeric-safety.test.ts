import test from "node:test";
import assert from "node:assert/strict";

import { TrafficSystem } from "../src/simulation/traffic/TrafficSystem.ts";
import { TransportationGraph } from "../src/simulation/traffic/TransportationGraph.ts";
import { IntersectionSystem } from "../src/simulation/traffic/IntersectionSystem.ts";
import { RoadSystem } from "../src/world/roads/RoadSystem.ts";
import {
  TerrainGrid,
  type TerrainCell,
} from "../src/world/terrain/TerrainGrid.ts";
import { TreasurySystem } from "../src/simulation/treasury/TreasurySystem.ts";
import { EngineFailure } from "../src/simulation/diagnostics/EngineFailure.ts";

function graphFixture(): TransportationGraph {
  const cells: TerrainCell[] = Array.from({ length: 24 }, () => ({
    elevation: 0.5,
    water: false,
    buildable: true,
    biome: "grass" as const,
  }));
  const roads = new RoadSystem(new TerrainGrid(6, 4, cells));
  roads.placePath(
    [
      { x: 1, y: 2 },
      { x: 2, y: 2 },
      { x: 3, y: 2 },
      { x: 4, y: 2 },
    ],
    "local",
    new TreasurySystem(100_000),
  );
  const graph = new TransportationGraph();
  graph.rebuildIfNeeded(roads);
  return graph;
}

function expectNumericFailure(run: () => unknown, code: string): void {
  assert.throws(
    run,
    (error: unknown) =>
      error instanceof EngineFailure &&
      error.category === "InvariantViolation" &&
      error.code === code,
  );
}

test("traffic rejects non-finite traveler weight before creating authority state", () => {
  const traffic = new TrafficSystem();
  expectNumericFailure(
    () =>
      traffic.submitTrip(
        {
          id: "nan-trip",
          originBuildingId: "a",
          destinationBuildingId: "b",
          departureTick: 0,
          travelerWeight: Number.NaN,
          purpose: "commute",
        },
        { nodeIds: ["a", "b"], edgeIds: ["e"], totalCost: 1 },
        0,
      ),
    "traffic-non-finite-traveler-weight",
  );
  assert.equal(traffic.activeVehicles.length, 0);
});

test("traffic rejects non-finite free-flow time before creating authority state", () => {
  const traffic = new TrafficSystem();
  expectNumericFailure(
    () =>
      traffic.submitTrip(
        {
          id: "infinite-trip",
          originBuildingId: "a",
          destinationBuildingId: "b",
          departureTick: 0,
          travelerWeight: 1,
          purpose: "commute",
        },
        { nodeIds: ["a", "b"], edgeIds: ["e"], totalCost: 1 },
        0,
        Number.POSITIVE_INFINITY,
      ),
    "traffic-non-finite-free-flow-time",
  );
  assert.equal(traffic.activeVehicles.length, 0);
});

test("traffic rejects non-finite external loads before step mutation", () => {
  const graph = graphFixture();
  const traffic = new TrafficSystem();
  const intersections = new IntersectionSystem();
  const edgeId = graph.edges[0]!.id;
  const before = traffic.snapshotState();
  expectNumericFailure(
    () => traffic.step(graph, intersections, 1, { [edgeId]: Number.NaN }),
    "traffic-non-finite-external-load",
  );
  assert.deepEqual(traffic.snapshotState(), before);
});
