import test from "node:test";
import assert from "node:assert/strict";

import { BuildingSystem } from "../src/simulation/buildings/BuildingSystem.ts";
import { SimulationCore } from "../src/simulation/core/SimulationCore.ts";
import { PerformanceAttribution } from "../src/simulation/diagnostics/PerformanceAttribution.ts";
import { PathfindingSystem } from "../src/simulation/traffic/PathfindingSystem.ts";
import { TransportationGraph } from "../src/simulation/traffic/TransportationGraph.ts";

test("operation performance measurement uses the injected monotonic clock and preserves return values", () => {
  let now = 10;
  const performance = new PerformanceAttribution(() => now);
  const result = performance.measure(
    "diagnostics.sample",
    () => {
      now += 7;
      return 42;
    },
    { budgetMs: 5 },
  );

  assert.equal(result, 42);
  assert.deepEqual(performance.snapshot()["diagnostics.sample"], {
    calls: 1,
    averageMs: 7,
    p95Ms: 7,
    maxMs: 7,
    overBudget: 1,
    cacheHitRate: null,
  });
});

test("legacy pathfinding attributes transportation and freight searches with cache outcomes", () => {
  const performance = new PerformanceAttribution(() => 0);
  const pathfinding = new PathfindingSystem();
  pathfinding.attachPerformanceAttribution(performance);
  const graph = new TransportationGraph();

  assert.equal(
    pathfinding.findRoute(graph, "missing-a", "missing-b"),
    null,
  );
  assert.equal(
    pathfinding.findRoute(graph, "missing-a", "missing-b", {
      costKey: "freight-free-flow",
    }),
    null,
  );

  const metrics = performance.snapshot();
  assert.equal(metrics["pathfinding.transportation"]?.calls, 1);
  assert.equal(metrics["pathfinding.transportation"]?.cacheHitRate, 0);
  assert.equal(metrics["pathfinding.freight"]?.calls, 1);
  assert.equal(metrics["pathfinding.freight"]?.cacheHitRate, 0);
});

test("canonical building spatial lookup publishes attributable timing", () => {
  const performance = new PerformanceAttribution(() => 0);
  const buildings = new BuildingSystem();
  buildings.attachPerformanceAttribution(performance);

  assert.equal(buildings.getV2At(0, 0), undefined);
  assert.equal(performance.snapshot()["building.spatial-lookup"]?.calls, 1);
});

test("SimulationCore emits causal mutation traces and attributes topology and reconciliation work", () => {
  const core = new SimulationCore({ width: 12, height: 10, seed: 808 });
  core.diagnostics.trace.clear();

  const road = core.buildRoad(
    [
      { x: 2, y: 4 },
      { x: 3, y: 4 },
      { x: 4, y: 4 },
    ],
    "local",
  );
  assert.equal(road.ok, true);

  const traceCodes = core.diagnostics.trace.list().map((entry) => entry.code);
  assert.ok(traceCodes.includes("road-build-committed"));
  assert.ok(traceCodes.includes("cadastre-rebuild-committed"));

  const performance = core.diagnostics.snapshot().performance;
  assert.ok((performance["topology.rebuild-cadastre"]?.calls ?? 0) >= 1);
  assert.ok((performance["building.reconcile-canonical"]?.calls ?? 0) >= 1);
});
