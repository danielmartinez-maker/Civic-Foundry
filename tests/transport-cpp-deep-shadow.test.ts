import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { Building } from "../src/simulation/buildings/BuildingSystem.ts";
import { MobilityScheduler } from "../src/simulation/mobility/MobilityScheduler.ts";
import {
  PassengerQueueSystem,
  type TransitPassengerCohort,
} from "../src/simulation/transit/PassengerQueueSystem.ts";
import { TransitNetworkSystem } from "../src/simulation/transit/TransitNetworkSystem.ts";
import { TransitOperationsSystem } from "../src/simulation/transit/TransitOperationsSystem.ts";
import { TransitVehicleSystem } from "../src/simulation/transit/TransitVehicleSystem.ts";
import { PathfindingSystem } from "../src/simulation/traffic/PathfindingSystem.ts";
import { TransportationGraph } from "../src/simulation/traffic/TransportationGraph.ts";
import { TripGenerationSystem } from "../src/simulation/traffic/TripGenerationSystem.ts";
import { TreasurySystem } from "../src/simulation/treasury/TreasurySystem.ts";
import { RoadSystem } from "../src/world/roads/RoadSystem.ts";
import { TerrainGrid } from "../src/world/terrain/TerrainGrid.ts";

const runnerPath = process.env.CIVIC_TRANSPORT_FIXTURE_RUNNER;
const manifest = JSON.parse(
  readFileSync(
    new URL("./fixtures/cpp-transport/manifest.json", import.meta.url),
    "utf8",
  ),
) as {
  scenarios: readonly {
    id: string;
    classification: string;
    bugRefs?: readonly string[];
  }[];
};

type NativeMetrics = Readonly<{
  tripConservation: Readonly<{ count: number; totalWeight: number }>;
  passengerSplit: Readonly<{
    boardedWeight: number;
    waitingWeight: number;
    totalWeight: number;
  }>;
  transitCompletion: Readonly<{
    boardedWeight: number;
    completedWeight: number;
    waitingWeight: number;
  }>;
  vehicleFailure: Readonly<{ strandedWeight: number; onboardAfter: number }>;
  crowding: Readonly<{
    inServiceCapacity: number;
    onboardWeight: number;
    ratio: number;
  }>;
  congestion: Readonly<{
    weightedVehicles: number;
    capacityPerMinute: number;
    utilization: number;
    travelTimeMultiplier: number;
    speedKph: number;
    blockedFinite: boolean;
  }>;
  parking: Readonly<{
    reservationSucceeded: boolean;
    occupancy: number;
    penaltyBefore: number;
    penaltyAfter: number;
  }>;
  incident: Readonly<{
    capacityFactor: number;
    speedFactor: number;
    routePenalty: number;
    costRevision: number;
  }>;
}>;

function nativeMetrics(): NativeMetrics {
  assert.ok(
    runnerPath,
    "CIVIC_TRANSPORT_FIXTURE_RUNNER must point to the native fixture runner",
  );
  return JSON.parse(
    execFileSync(runnerPath, { encoding: "utf8" }),
  ) as NativeMetrics;
}

function occupiedBuilding(id: string, zone: Building["zone"]): Building {
  const definitionId =
    zone === "residential"
      ? "residential_cottage"
      : zone === "commercial"
        ? "commercial_shop"
        : "industrial_factory";
  return {
    id,
    lotId: `lot:${id}`,
    x: 0,
    y: 0,
    zone,
    definitionId,
    status: "occupied",
    constructionStartedTick: 0,
    completionTick: 0,
  };
}

function cohort(
  id: string,
  lineId: string,
  from: string,
  to: string,
  weight: number,
  directionKey = "forward",
): TransitPassengerCohort {
  return {
    id,
    personTripId: id,
    travelerWeight: weight,
    lineId,
    directionKey,
    boardingStopId: from,
    alightingStopId: to,
    destinationRoadNodeId: "n:9,2",
    enqueuedTick: 0,
    transferLegs: [],
  };
}

function setupBusTransit() {
  const terrain = TerrainGrid.generate(12, 5, 4);
  const roads = new RoadSystem(terrain);
  const treasury = new TreasurySystem(1_000_000);
  roads.placePath(
    Array.from({ length: 10 }, (_, index) => ({ x: index + 1, y: 2 })),
    "local",
    treasury,
  );
  const graph = new TransportationGraph();
  graph.rebuildIfNeeded(roads);
  const network = new TransitNetworkSystem(terrain, roads);
  const a = network.placeStop("surface_stop", 2, 1, treasury).id;
  const b = network.placeStop("surface_stop", 8, 1, treasury).id;
  assert.ok(a && b);
  const line = network.createLine("bus", "L1");
  assert.equal(network.setLineStops(line, [a, b]).ok, true);
  network.setEnabled(line, true);
  network.setHeadway(line, 20);
  return { graph, network, a, b, line };
}

function tsLegacyCrowding(): number {
  const scheduler = new MobilityScheduler();
  const onboard = cohort(
    "crowd:1",
    "line:crowding",
    "stop:a",
    "stop:b",
    5,
  );
  scheduler.restoreState({
    decisions: [],
    crowdingPenaltyTicks: 0,
    fiscalOperatingCursor: 0,
    fiscalFareCursor: 0,
    passengers: { nextSplitId: 1, queues: [] },
    vehicles: {
      nextVehicleId: 3,
      vehicles: [
        {
          id: "transit-vehicle:1",
          lineId: "line:crowding",
          mode: "bus",
          directionKey: "forward",
          stopIndex: 0,
          state: "dwell",
          capacity: 10,
          onboard: [onboard],
          dwellRemainingTicks: 0,
          stopServiced: false,
          roadEdgeIds: [],
          currentRoadEdgeIndex: 0,
          edgeProgressTicks: 0,
          dedicatedRemainingTicks: 0,
          delayTicks: 0,
          inServiceTicks: 0,
          runStartedTick: 0,
          hasDepartedOrigin: false,
        },
        {
          id: "transit-vehicle:2",
          lineId: "line:crowding",
          mode: "bus",
          directionKey: "forward",
          stopIndex: 0,
          state: "out_of_service",
          capacity: 90,
          onboard: [],
          dwellRemainingTicks: 0,
          stopServiced: false,
          roadEdgeIds: [],
          currentRoadEdgeIndex: 0,
          edgeProgressTicks: 0,
          dedicatedRemainingTicks: 0,
          delayTicks: 0,
          inServiceTicks: 0,
          runStartedTick: 0,
          hasDepartedOrigin: false,
        },
      ],
    },
    operations: { lines: [] },
  });
  return scheduler.snapshot().crowding;
}

test(
  "deep C++ transportation fixtures preserve parity and explicit corrections",
  { skip: !runnerPath },
  () => {
    const native = nativeMetrics();

    const homes = Array.from({ length: 100 }, (_, index) =>
      occupiedBuilding(
        `home:${String(index).padStart(3, "0")}`,
        "residential",
      ),
    );
    const commuteTrips = new TripGenerationSystem(17)
      .generate(
        10,
        [...homes, occupiedBuilding("job:1", "industrial")],
        100,
        1,
      )
      .filter((trip) => trip.purpose === "commute");
    const commuteWeight = commuteTrips.reduce(
      (sum, trip) => sum + trip.travelerWeight,
      0,
    );
    assert.equal(native.tripConservation.count, commuteTrips.length);
    assert.ok(
      Math.abs(native.tripConservation.totalWeight - commuteWeight) <= 1e-9,
    );

    const queues = new PassengerQueueSystem();
    assert.equal(
      queues.enqueue(
        "stop:a",
        "line:1",
        "outbound",
        cohort("split", "line:1", "stop:a", "stop:b", 10, "outbound"),
      ),
      true,
    );
    const boarded = queues.board("stop:a", "line:1", "outbound", 6);
    assert.equal(native.passengerSplit.boardedWeight, boarded.boardedWeight);
    assert.equal(
      native.passengerSplit.waitingWeight,
      queues.totalWaitingWeight(),
    );
    assert.equal(
      native.passengerSplit.totalWeight,
      boarded.boardedWeight + queues.totalWaitingWeight(),
    );

    const transit = setupBusTransit();
    const transitQueues = new PassengerQueueSystem();
    const vehicles = new TransitVehicleSystem();
    const operations = new TransitOperationsSystem();
    const pathfinding = new PathfindingSystem();
    operations.setFleetLimit(transit.line, 1);
    assert.equal(
      transitQueues.enqueue(
        transit.a,
        transit.line,
        "forward",
        cohort("completion", transit.line, transit.a, transit.b, 80),
      ),
      true,
    );
    for (let tick = 0; tick < 65; tick++) {
      operations.step(
        tick,
        transit.network,
        vehicles,
        transitQueues,
        transit.graph,
        pathfinding,
        (edge) => edge.freeFlowTicks,
      );
    }
    const lineSnapshot = operations.snapshotLine(transit.line);
    assert.equal(
      native.transitCompletion.boardedWeight,
      lineSnapshot.boardings,
    );
    assert.equal(
      native.transitCompletion.completedWeight,
      lineSnapshot.completedPassengerWeight,
    );
    assert.equal(
      native.transitCompletion.waitingWeight,
      transitQueues.totalWaitingWeight(),
    );

    assert.equal(native.vehicleFailure.strandedWeight, 4);
    assert.equal(native.vehicleFailure.onboardAfter, 0);

    const crowdingFixture = manifest.scenarios.find(
      (scenario) => scenario.id === "full-vehicle-crowding",
    );
    assert.equal(crowdingFixture?.classification, "CORRECTION");
    assert.deepEqual(crowdingFixture?.bugRefs, ["SIM-008"]);
    assert.equal(tsLegacyCrowding(), 0.05);
    assert.equal(native.crowding.inServiceCapacity, 10);
    assert.equal(native.crowding.onboardWeight, 5);
    assert.equal(native.crowding.ratio, 0.5);

    assert.equal(native.congestion.weightedVehicles, 12.5);
    assert.ok(native.congestion.capacityPerMinute > 0);
    assert.ok(Number.isFinite(native.congestion.utilization));
    assert.ok(native.congestion.travelTimeMultiplier >= 1);
    assert.ok(Number.isFinite(native.congestion.speedKph));
    assert.equal(native.congestion.blockedFinite, true);

    assert.equal(native.parking.reservationSucceeded, true);
    assert.equal(native.parking.occupancy, 9);
    assert.ok(native.parking.penaltyAfter > native.parking.penaltyBefore);

    assert.equal(native.incident.capacityFactor, 0.25);
    assert.equal(native.incident.speedFactor, 0.5);
    assert.ok(native.incident.routePenalty > 0);
    assert.ok(native.incident.costRevision > 0);
  },
);
