import assert from "node:assert/strict";
import test from "node:test";
import { MobilityScheduler, type MobilityPersonTrip } from "../src/simulation/mobility/MobilityScheduler.ts";
import { PathfindingSystem } from "../src/simulation/traffic/PathfindingSystem.ts";
import { TransportationGraph } from "../src/simulation/traffic/TransportationGraph.ts";
import { TransitNetworkSystem } from "../src/simulation/transit/TransitNetworkSystem.ts";
import { TreasurySystem } from "../src/simulation/treasury/TreasurySystem.ts";
import { RoadSystem } from "../src/world/roads/RoadSystem.ts";
import { TerrainGrid, type TerrainCell } from "../src/world/terrain/TerrainGrid.ts";

function fixture() {
  const cells: TerrainCell[] = Array.from({ length: 6 * 5 }, () => ({
    elevation: 0.5,
    water: false,
    buildable: true,
    biome: "grass",
  }));
  const terrain = new TerrainGrid(6, 5, cells);
  const roads = new RoadSystem(terrain);
  const treasury = new TreasurySystem(100_000);
  assert.equal(
    roads.placePath(
      [
        { x: 1, y: 2 },
        { x: 2, y: 2 },
        { x: 3, y: 2 },
        { x: 4, y: 2 },
      ],
      "local",
      treasury,
    ).ok,
    true,
  );
  const graph = new TransportationGraph();
  graph.rebuildIfNeeded(roads);
  const transit = new TransitNetworkSystem(terrain, roads, () => false);
  return { graph, transit };
}

const trip: MobilityPersonTrip = Object.freeze({
  id: "person-trip:1",
  sourceTripId: "trip:1",
  originBuildingId: "building:a",
  destinationBuildingId: "building:b",
  originRoadNodeId: "n:1,2",
  destinationRoadNodeId: "n:4,2",
  departureTick: 1,
  travelerWeight: 1,
  purpose: "commute",
});

test("mobility rejects a car alternative when generalized-cost authority marks it unavailable", () => {
  const { graph, transit } = fixture();
  const pathfinding = new PathfindingSystem();
  const scheduler = new MobilityScheduler();
  let submitted = 0;
  const snapshot = scheduler.tick({
    tick: 1,
    roadGraph: graph,
    transit,
    pathfinding,
    roadTravelTime: (edge) => edge.freeFlowTicks,
    routeCar: (_trip, start, end) => pathfinding.findRoute(graph, start, end),
    generalizedCost: (mode, _trip, plan) =>
      mode === "car" ? null : plan.totalGeneralizedCost,
    generateTrips: () => [trip],
    submitCarTrip: () => {
      submitted++;
    },
  });

  assert.equal(submitted, 0);
  assert.equal(snapshot.carModeShare, 0);
  assert.equal(snapshot.unmetShare, 1);
});

test("mobility refuses a chosen car trip when parking reservation loses the final space", () => {
  const { graph, transit } = fixture();
  const pathfinding = new PathfindingSystem();
  const scheduler = new MobilityScheduler();
  let submitted = 0;
  const snapshot = scheduler.tick({
    tick: 1,
    roadGraph: graph,
    transit,
    pathfinding,
    roadTravelTime: (edge) => edge.freeFlowTicks,
    routeCar: (_trip, start, end) => pathfinding.findRoute(graph, start, end),
    generalizedCost: (_mode, _trip, plan) => plan.totalGeneralizedCost,
    reserveCarTrip: () => false,
    generateTrips: () => [trip],
    submitCarTrip: () => {
      submitted++;
    },
  });

  assert.equal(submitted, 0);
  assert.equal(snapshot.carModeShare, 0);
  assert.equal(snapshot.unmetShare, 1);
});
