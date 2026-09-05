import assert from "node:assert/strict";
import test from "node:test";
import { SimulationCore } from "../src/simulation/core/SimulationCore.ts";
import { LegacySimulationCore } from "../src/simulation/core/LegacySimulationCore.ts";
import { MovementAwareIntersectionAdapter } from "../src/simulation/transportation/MovementAwareIntersectionAdapter.ts";
import {
  TerrainGrid,
  type TerrainCell,
} from "../src/world/terrain/TerrainGrid.ts";

function flat(width = 9, height = 9): TerrainGrid {
  const cells: TerrainCell[] = Array.from({ length: width * height }, () => ({
    elevation: 0.5,
    water: false,
    buildable: true,
    biome: "grass",
  }));
  return new TerrainGrid(width, height, cells);
}

test("production SimulationCore cuts intersection authority over while legacy remains an oracle", () => {
  const core = new SimulationCore({
    terrain: flat(),
    startingFunds: 1_000_000,
  });
  const legacy = new LegacySimulationCore({
    terrain: flat(),
    startingFunds: 1_000_000,
  });

  assert.ok(core.intersections instanceof MovementAwareIntersectionAdapter);
  assert.equal(
    legacy.intersections instanceof MovementAwareIntersectionAdapter,
    false,
  );
  assert.ok(core.transportation3R);
});

test("production legacy-shaped intersection facade and 3R movement queues are the same live authority", () => {
  const core = new SimulationCore({
    terrain: flat(),
    startingFunds: 1_000_000,
  });
  assert.equal(
    core.buildRoad(
      [
        { x: 2, y: 4 },
        { x: 3, y: 4 },
        { x: 4, y: 4 },
        { x: 5, y: 4 },
        { x: 6, y: 4 },
      ],
      "local",
    ).ok,
    true,
  );
  assert.equal(
    core.buildRoad(
      [
        { x: 4, y: 2 },
        { x: 4, y: 3 },
        { x: 4, y: 4 },
        { x: 4, y: 5 },
        { x: 4, y: 6 },
      ],
      "local",
    ).ok,
    true,
  );
  core.transportation3R.refreshNetwork(core.roads, core.transportationGraph);

  const movement = core.transportation3R
    .networkSnapshot()
    .movements.find(
      (candidate) => candidate.allowed && candidate.turnKind === "through",
    );
  assert.ok(movement);
  const nodeId = core.transportation3R.legacyNodeIdForJunction(
    movement.junctionId,
  );
  const incomingEdgeId = core.transportation3R.legacyEdgeIdForCarriageway(
    movement.fromCarriagewayId,
  );
  const outgoingEdgeId = core.transportation3R.legacyEdgeIdForCarriageway(
    movement.toCarriagewayId,
  );
  assert.ok(nodeId && incomingEdgeId && outgoingEdgeId);

  core.intersections.enqueue(
    nodeId,
    incomingEdgeId,
    {
      vehicleId: "vehicle:cutover",
      travelerWeight: 1,
      queuedTick: 10,
    },
    outgoingEdgeId,
  );

  assert.equal(
    core.transportation3R.intersections.queueLength(movement.junctionId),
    1,
  );
  assert.equal(core.intersections.queueLength(nodeId), 1);
  const legacyProjection = core.intersections.snapshot();
  assert.equal(
    legacyProjection[nodeId]?.[0]?.entries[0]?.vehicleId,
    "vehicle:cutover",
  );
});
