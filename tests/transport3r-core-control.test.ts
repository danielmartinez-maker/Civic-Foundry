import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SimulationCore } from '../src/simulation/core/LegacySimulationCore.ts';
import { TerrainGrid, type TerrainCell } from '../src/world/terrain/TerrainGrid.ts';
import { legacyJunctionId } from '../src/simulation/transportation/LegacyRoadNetworkAdapter.ts';
import type { IntersectionControlSystem } from '../src/simulation/transportation/IntersectionControlSystem.ts';

function flatTerrain(width = 8, height = 8): TerrainGrid {
  const cells: TerrainCell[] = Array.from({ length: width * height }, () => ({
    elevation: 0.5,
    water: false,
    buildable: true,
    biome: 'grass' as const,
  }));
  return new TerrainGrid(width, height, cells);
}

function buildCross(core: SimulationCore): void {
  assert.equal(core.buildRoad([
    { x: 1, y: 3 }, { x: 2, y: 3 }, { x: 3, y: 3 }, { x: 4, y: 3 }, { x: 5, y: 3 },
  ], 'local').ok, true);
  assert.equal(core.buildRoad([{ x: 3, y: 1 }, { x: 3, y: 2 }], 'local').ok, true);
  assert.equal(core.buildRoad([{ x: 3, y: 4 }, { x: 3, y: 5 }], 'local').ok, true);
}

function controlFor(core: SimulationCore): IntersectionControlSystem {
  const control = (core as unknown as { intersectionControl?: IntersectionControlSystem }).intersectionControl;
  assert.ok(control, 'LegacySimulationCore must expose the live 3R intersection controller');
  return control;
}

test('LegacySimulationCore provisions a 3R control plan for a central road junction', () => {
  const core = new SimulationCore({ terrain: flatTerrain(), startingFunds: 100_000, seed: 31 });
  buildCross(core);

  core.step(1);

  const plan = controlFor(core).planFor(legacyJunctionId(3, 3));
  assert.ok(plan, 'central four-way junction must have a canonical 3R control plan');
});

test('LegacySimulationCore steps 3R control once and shares one release set with both vehicle consumers', () => {
  const core = new SimulationCore({ terrain: flatTerrain(), startingFunds: 100_000, seed: 32 });
  buildCross(core);
  const controls = controlFor(core);
  let controlSteps = 0;
  const releasedIds = ['released:fixture'];
  const originalControlStep = controls.step.bind(controls);
  controls.step = ((tick: number) => {
    controlSteps += 1;
    assert.equal(tick, core.clock.tick);
    return releasedIds;
  }) as typeof controls.step;

  let serviceArgs: unknown[] | undefined;
  let trafficArgs: unknown[] | undefined;
  const serviceVehicles = core.serviceVehicles as unknown as { step: (...args: unknown[]) => unknown };
  const traffic = core.traffic as unknown as { step: (...args: unknown[]) => unknown };
  const originalServiceStep = serviceVehicles.step;
  const originalTrafficStep = traffic.step;
  serviceVehicles.step = (...args: unknown[]) => {
    serviceArgs = args;
    return [];
  };
  traffic.step = (...args: unknown[]) => {
    trafficArgs = args;
  };

  try {
    core.step(1);
  } finally {
    controls.step = originalControlStep;
    serviceVehicles.step = originalServiceStep;
    traffic.step = originalTrafficStep;
  }

  assert.equal(controlSteps, 1, 'controller must step exactly once per simulation tick');
  assert.ok(serviceArgs && trafficArgs, 'both vehicle systems must be stepped');
  assert.equal(serviceArgs[1], controls);
  assert.equal(trafficArgs[1], controls);
  assert.ok(serviceArgs[3] instanceof Set, 'service vehicles must receive the shared release set');
  assert.equal(serviceArgs[3], trafficArgs[3], 'service and traffic must consume the exact same Set instance');
  assert.deepEqual([...(serviceArgs[3] as ReadonlySet<string>)], releasedIds);
});

test('new live traffic queues in 3R control while the legacy intersection container stays empty', () => {
  const core = new SimulationCore({ terrain: flatTerrain(), startingFunds: 100_000, seed: 33 });
  buildCross(core);
  core.step(1);
  const controls = controlFor(core);
  const originalControlStep = controls.step.bind(controls);
  controls.step = (() => []) as typeof controls.step;

  const graph = core.transportationGraph;
  const firstEdgeId = 'e:n:2,3>n:3,3';
  const secondEdgeId = 'e:n:3,3>n:3,2';
  const first = graph.getEdge(firstEdgeId);
  const second = graph.getEdge(secondEdgeId);
  assert.ok(first && second, 'cross fixture must expose the route through the central junction');
  const vehicleId = core.traffic.submitTrip({
    id: 'trip:core-control',
    originBuildingId: 'origin',
    destinationBuildingId: 'destination',
    departureTick: core.clock.tick,
    travelerWeight: 1,
    purpose: 'commute',
  }, {
    edgeIds: [firstEdgeId, secondEdgeId],
    totalCost: first.freeFlowTicks + second.freeFlowTicks,
  }, core.clock.tick);
  assert.ok(vehicleId);

  try {
    for (let i = 0; i < 30 && controls.queueLength() === 0; i += 1) core.step(1);
  } finally {
    controls.step = originalControlStep;
  }

  assert.ok(controls.queueLength() > 0, 'vehicle should be queued by the live 3R authority');
  assert.deepEqual(core.intersections.snapshot(), {}, 'legacy IntersectionSystem must remain hydration-only');
});

test('live vehicle/core source contains no legacy stepNode controller path', () => {
  for (const relative of [
    '../src/simulation/traffic/TrafficSystem.ts',
    '../src/simulation/services/ServiceVehicleSystem.ts',
    '../src/simulation/core/LegacySimulationCore.ts',
  ]) {
    const source = readFileSync(new URL(relative, import.meta.url), 'utf8');
    assert.equal(source.includes('stepNode('), false, `${relative} must not contain a live legacy stepNode path`);
  }
});
