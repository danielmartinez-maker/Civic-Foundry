import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TerrainGrid, type TerrainCell } from '../src/world/terrain/TerrainGrid.ts';
import { RoadSystem } from '../src/world/roads/RoadSystem.ts';
import { TransportationGraph } from '../src/simulation/traffic/TransportationGraph.ts';
import { PathfindingSystem } from '../src/simulation/traffic/PathfindingSystem.ts';
import { TrafficSystem } from '../src/simulation/traffic/TrafficSystem.ts';
import type { TripRequest } from '../src/simulation/traffic/TripGenerationSystem.ts';
import type { IntersectionControlSystem } from '../src/simulation/transportation/IntersectionControlSystem.ts';
import type { MovementQueueEntry } from '../src/simulation/transportation/IntersectionControlTypes.ts';
import type {
  LegacyRouteMovementResolver,
  ResolvedRouteMovement,
} from '../src/simulation/transportation/LegacyRouteMovementResolver.ts';

function flatTerrain(width = 10, height = 10): TerrainGrid {
  const cells: TerrainCell[] = Array.from({ length: width * height }, () => ({
    elevation: 0.5,
    water: false,
    buildable: true,
    biome: 'grass' as const,
  }));
  return new TerrainGrid(width, height, cells);
}

function graphFixture(kind: 'linear' | 'plus' = 'linear'): TransportationGraph {
  const roads = new RoadSystem(flatTerrain());
  const cells = [
    { x: 2, y: 4, type: 'local' as const },
    { x: 3, y: 4, type: 'local' as const },
    { x: 4, y: 4, type: 'local' as const },
    { x: 5, y: 4, type: 'local' as const },
    { x: 6, y: 4, type: 'local' as const },
  ];
  if (kind === 'plus') {
    cells.push(
      { x: 4, y: 3, type: 'local' as const },
      { x: 4, y: 5, type: 'local' as const },
    );
  }
  roads.restore(cells, 1);
  const graph = new TransportationGraph();
  graph.rebuildIfNeeded(roads);
  return graph;
}

function trip(id = 'trip:1'): TripRequest {
  return {
    id,
    originBuildingId: 'home',
    destinationBuildingId: 'job',
    departureTick: 0,
    travelerWeight: 1,
    purpose: 'commute',
  };
}

function movementResult(id = 'm:fixture'): ResolvedRouteMovement {
  return Object.freeze({
    junctionId: 'j:fixture',
    movementId: id,
    fromCarriagewayId: 'cw:in',
    toCarriagewayId: 'cw:out',
    laneGroupIds: Object.freeze(['lg:fixture']),
  });
}

class RecordingResolver {
  readonly calls: Array<readonly [string, string]> = [];
  result: ResolvedRouteMovement | undefined = movementResult();

  resolve(currentEdgeId: string, nextEdgeId: string): ResolvedRouteMovement | undefined {
    this.calls.push([currentEdgeId, nextEdgeId]);
    return this.result;
  }
}

class RecordingControls {
  readonly enqueued: MovementQueueEntry[] = [];
  readonly acknowledged: string[] = [];
  readonly removed: string[] = [];
  queueRequired = true;

  requiresQueue(_movementId: string): boolean {
    return this.queueRequired;
  }

  enqueue(entry: MovementQueueEntry): boolean {
    if (typeof entry === 'object' && entry !== null && 'movementId' in entry) this.enqueued.push(entry);
    return true;
  }

  acknowledge(vehicleId: string): void {
    this.acknowledged.push(vehicleId);
  }

  removeVehicle(vehicleId: string): void {
    this.removed.push(vehicleId);
  }

  step(): never {
    throw new Error('TrafficSystem must never step IntersectionControlSystem');
  }

  // Historical methods keep the RED test executable against the pre-cutover TrafficSystem.
  snapshot(): Record<string, never> {
    return {};
  }

  stepNode(): never {
    throw new Error('legacy IntersectionSystem.stepNode must not be used');
  }
}

function invokeStep(
  traffic: TrafficSystem,
  graph: TransportationGraph,
  controls: RecordingControls,
  resolver: RecordingResolver,
  releasedVehicleIds: ReadonlySet<string>,
  tick: number,
): void {
  traffic.step(
    graph,
    controls as unknown as IntersectionControlSystem,
    resolver as unknown as LegacyRouteMovementResolver,
    releasedVehicleIds,
    tick,
  );
}

function routeAcross(graph: TransportationGraph) {
  const pathfinding = new PathfindingSystem();
  const start = graph.findNodeAt(2, 4);
  const end = graph.findNodeAt(6, 4);
  assert.ok(start && end);
  const route = pathfinding.findRoute(graph, start.id, end.id);
  assert.ok(route);
  return route;
}

function runUntil(
  predicate: () => boolean,
  traffic: TrafficSystem,
  graph: TransportationGraph,
  controls: RecordingControls,
  resolver: RecordingResolver,
  startTick = 1,
): number {
  for (let tick = startTick; tick <= startTick + 300; tick += 1) {
    invokeStep(traffic, graph, controls, resolver, new Set(), tick);
    if (predicate()) return tick;
  }
  throw new Error('traffic fixture did not reach expected state');
}

test('current and next legacy edges resolve the exact movement and queued traffic stays on its current edge', () => {
  const graph = graphFixture('linear');
  const controls = new RecordingControls();
  const resolver = new RecordingResolver();
  const traffic = new TrafficSystem();
  const route = routeAcross(graph);
  const vehicleId = traffic.submitTrip(trip(), route, 0);
  assert.ok(vehicleId);

  const queuedTick = runUntil(
    () => traffic.getVehicle(vehicleId)?.status === 'queued',
    traffic,
    graph,
    controls,
    resolver,
  );
  const vehicle = traffic.getVehicle(vehicleId);
  assert.ok(vehicle);
  assert.equal(vehicle.currentEdgeIndex, 0);
  assert.deepEqual(resolver.calls.at(-1), [route.edgeIds[0], route.edgeIds[1]]);
  assert.equal(controls.enqueued.length, 1);
  assert.deepEqual(controls.enqueued[0], {
    vehicleId,
    movementId: 'm:fixture',
    laneGroupIds: ['lg:fixture'],
    travelerWeight: 1,
    queuedTick,
    priority: 'normal',
  });

  const delayBefore = vehicle.accumulatedDelayTicks;
  invokeStep(traffic, graph, controls, resolver, new Set(), queuedTick + 1);
  assert.equal(traffic.getVehicle(vehicleId)?.currentEdgeIndex, 0);
  assert.equal(traffic.getVehicle(vehicleId)?.accumulatedDelayTicks, delayBefore + 1);
});

test('owned released ID advances exactly one edge and acknowledges while foreign releases are ignored', () => {
  const graph = graphFixture('linear');
  const controls = new RecordingControls();
  const resolver = new RecordingResolver();
  const traffic = new TrafficSystem();
  const route = routeAcross(graph);
  const vehicleId = traffic.submitTrip(trip('trip:release'), route, 0);
  assert.ok(vehicleId);

  const queuedTick = runUntil(
    () => traffic.getVehicle(vehicleId)?.status === 'queued',
    traffic,
    graph,
    controls,
    resolver,
  );
  invokeStep(traffic, graph, controls, resolver, new Set(['foreign']), queuedTick + 1);
  assert.equal(traffic.getVehicle(vehicleId)?.status, 'queued');
  assert.deepEqual(controls.acknowledged, []);

  invokeStep(traffic, graph, controls, resolver, new Set([vehicleId, 'foreign']), queuedTick + 2);
  const released = traffic.getVehicle(vehicleId);
  assert.ok(released);
  assert.equal(released.status, 'moving');
  assert.equal(released.currentEdgeIndex, 1);
  assert.deepEqual(controls.acknowledged, [vehicleId]);
});

test('unresolvable route movement fails cleanly and removes any controller membership', () => {
  const graph = graphFixture('linear');
  const controls = new RecordingControls();
  const resolver = new RecordingResolver();
  resolver.result = undefined;
  const traffic = new TrafficSystem();
  const route = routeAcross(graph);
  const vehicleId = traffic.submitTrip(trip('trip:invalid'), route, 0);
  assert.ok(vehicleId);

  runUntil(
    () => traffic.getVehicle(vehicleId) === undefined,
    traffic,
    graph,
    controls,
    resolver,
  );
  assert.equal(traffic.recentOutcomes.at(-1)?.success, false);
  assert.deepEqual(controls.removed, [vehicleId]);
});

test('explicit requiresQueue false bypasses even a degree-greater-than-two legacy junction', () => {
  const graph = graphFixture('plus');
  const controls = new RecordingControls();
  controls.queueRequired = false;
  const resolver = new RecordingResolver();
  const traffic = new TrafficSystem();
  const route = routeAcross(graph);
  const vehicleId = traffic.submitTrip(trip('trip:bypass'), route, 0);
  assert.ok(vehicleId);

  runUntil(
    () => (traffic.getVehicle(vehicleId)?.currentEdgeIndex ?? 0) >= 1,
    traffic,
    graph,
    controls,
    resolver,
  );
  assert.equal(traffic.getVehicle(vehicleId)?.status, 'moving');
  assert.equal(controls.enqueued.length, 0);
  assert.ok(resolver.calls.length > 0);
});

test('the 3R TrafficSystem path contains no legacy node heuristic or controller stepping', () => {
  const source = readFileSync(
    new URL('../src/simulation/traffic/TrafficSystem.ts', import.meta.url),
    'utf8',
  );
  const start = source.indexOf('private stepWithIntersectionControl(');
  const end = source.indexOf('private stepLegacyCompatibility(', start);
  assert.ok(start >= 0 && end > start, '3R traffic path and legacy compatibility boundary must exist');
  const live3RPath = source.slice(start, end);

  assert.doesNotMatch(live3RPath, /outgoingEdges\(edge\.to\)\.length\s*>\s*2/);
  assert.doesNotMatch(live3RPath, /\.stepNode\(/);
  assert.doesNotMatch(live3RPath, /controls\.step\(/);
});
