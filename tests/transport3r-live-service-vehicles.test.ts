import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TerrainGrid, type TerrainCell } from '../src/world/terrain/TerrainGrid.ts';
import { RoadSystem } from '../src/world/roads/RoadSystem.ts';
import { TransportationGraph } from '../src/simulation/traffic/TransportationGraph.ts';
import { PathfindingSystem, type RouteResult } from '../src/simulation/traffic/PathfindingSystem.ts';
import {
  ServiceVehicleSystem,
  type ServiceVehicle,
  type ServiceVehicleEvent,
} from '../src/simulation/services/ServiceVehicleSystem.ts';
import type { ServiceDepartment, ServiceVehicleType } from '../src/data/services.ts';
import type { IntersectionControlSystem } from '../src/simulation/transportation/IntersectionControlSystem.ts';
import type {
  IntersectionPriorityRequest,
  MovementQueueEntry,
} from '../src/simulation/transportation/IntersectionControlTypes.ts';
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

function routeAcross(graph: TransportationGraph): RouteResult {
  const pathfinding = new PathfindingSystem();
  const start = graph.findNodeAt(2, 4);
  const end = graph.findNodeAt(6, 4);
  assert.ok(start && end);
  const route = pathfinding.findRoute(graph, start.id, end.id);
  assert.ok(route);
  return route;
}

function departmentFor(type: ServiceVehicleType): ServiceDepartment {
  if (type === 'garbage_truck') return 'garbage';
  if (type === 'fire_engine') return 'fire';
  if (type === 'ambulance') return 'healthcare';
  return 'police';
}

function outboundVehicle(
  route: RouteResult,
  vehicleType: ServiceVehicleType,
  id = `service-vehicle:test:${vehicleType}`,
  edgeIds: readonly string[] = route.edgeIds,
  currentNodeId: string | null = route.nodeIds[0] ?? null,
): ServiceVehicle {
  return {
    id,
    facilityId: 'facility:test',
    department: departmentFor(vehicleType),
    vehicleType,
    currentJobId: `job:${id}`,
    edgeIds: [...edgeIds],
    returnEdgeIds: [],
    currentEdgeIndex: 0,
    edgeProgressTicks: 0,
    currentSpeed: 0,
    state: 'outbound',
    accumulatedDelayTicks: 0,
    currentNodeId,
    destinationNodeId: route.nodeIds.at(-1) ?? null,
    homeNodeId: route.nodeIds[0] ?? null,
    serviceRemainingTicks: 0,
  };
}

function movementResult(id = 'm:service'): ResolvedRouteMovement {
  return Object.freeze({
    junctionId: 'j:service',
    movementId: id,
    fromCarriagewayId: 'cw:service:in',
    toCarriagewayId: 'cw:service:out',
    laneGroupIds: Object.freeze(['lg:service']),
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
  readonly priorityRequests: IntersectionPriorityRequest[] = [];
  queueRequired = true;

  requiresQueue(_movementId: string): boolean {
    return this.queueRequired;
  }

  enqueue(entry: MovementQueueEntry): boolean {
    this.enqueued.push(entry);
    return true;
  }

  acknowledge(vehicleId: string): void {
    this.acknowledged.push(vehicleId);
  }

  removeVehicle(vehicleId: string): void {
    this.removed.push(vehicleId);
  }

  submitPriorityRequest(request: IntersectionPriorityRequest): void {
    this.priorityRequests.push(request);
  }

  step(): never {
    throw new Error('ServiceVehicleSystem must never step IntersectionControlSystem');
  }

  // Historical methods keep the RED fixture executable against the pre-cutover implementation.
  snapshot(): Record<string, never> {
    return {};
  }

  stepNode(): never {
    throw new Error('legacy IntersectionSystem.stepNode must not be used by the 3R path');
  }
}

function invokeStep(
  system: ServiceVehicleSystem,
  graph: TransportationGraph,
  controls: RecordingControls,
  resolver: RecordingResolver,
  releasedVehicleIds: ReadonlySet<string>,
  pathfinding: PathfindingSystem,
  tick: number,
): ServiceVehicleEvent[] {
  return system.step(
    graph,
    controls as unknown as IntersectionControlSystem,
    resolver as unknown as LegacyRouteMovementResolver,
    releasedVehicleIds,
    pathfinding,
    (edge) => edge.freeFlowTicks,
    tick,
  );
}

function runUntil(
  predicate: () => boolean,
  system: ServiceVehicleSystem,
  graph: TransportationGraph,
  controls: RecordingControls,
  resolver: RecordingResolver,
  pathfinding: PathfindingSystem,
  startTick = 1,
): number {
  for (let tick = startTick; tick <= startTick + 300; tick += 1) {
    invokeStep(system, graph, controls, resolver, new Set(), pathfinding, tick);
    if (predicate()) return tick;
  }
  throw new Error('service vehicle fixture did not reach expected state');
}

test('garbage truck queues with traveler weight 2 on its resolved movement', () => {
  const graph = graphFixture();
  const route = routeAcross(graph);
  const system = new ServiceVehicleSystem();
  const vehicle = outboundVehicle(route, 'garbage_truck');
  system.restore([vehicle]);
  const controls = new RecordingControls();
  const resolver = new RecordingResolver();
  const pathfinding = new PathfindingSystem();

  const queuedTick = runUntil(
    () => system.getVehicle(vehicle.id)?.queuedNodeId !== undefined,
    system,
    graph,
    controls,
    resolver,
    pathfinding,
  );

  assert.deepEqual(resolver.calls.at(-1), [route.edgeIds[0], route.edgeIds[1]]);
  assert.deepEqual(controls.enqueued[0], {
    vehicleId: vehicle.id,
    movementId: 'm:service',
    laneGroupIds: ['lg:service'],
    travelerWeight: 2,
    queuedTick,
    priority: 'normal',
  });
  assert.deepEqual(controls.priorityRequests, []);
});

test('emergency vehicle queues weight 1 and submits stable preemption request', () => {
  const graph = graphFixture();
  const route = routeAcross(graph);
  const system = new ServiceVehicleSystem();
  const vehicle = outboundVehicle(route, 'fire_engine');
  system.restore([vehicle]);
  const controls = new RecordingControls();
  const resolver = new RecordingResolver();
  const pathfinding = new PathfindingSystem();

  const queuedTick = runUntil(
    () => system.getVehicle(vehicle.id)?.queuedNodeId !== undefined,
    system,
    graph,
    controls,
    resolver,
    pathfinding,
  );

  assert.equal(controls.enqueued[0]?.travelerWeight, 1);
  assert.equal(controls.enqueued[0]?.priority, 'emergency');
  assert.deepEqual(controls.priorityRequests, [{
    id: `ipr:${vehicle.id}:m:service`,
    junctionId: 'j:service',
    movementId: 'm:service',
    kind: 'emergencyPreemption',
    requestedTick: queuedTick,
    expiresTick: queuedTick + 100,
  }]);
});

test('service-owned release advances once and acknowledges while traffic-owned release is ignored', () => {
  const graph = graphFixture();
  const route = routeAcross(graph);
  const system = new ServiceVehicleSystem();
  const vehicle = outboundVehicle(route, 'garbage_truck', 'service-vehicle:test:release');
  system.restore([vehicle]);
  const controls = new RecordingControls();
  const resolver = new RecordingResolver();
  const pathfinding = new PathfindingSystem();

  const queuedTick = runUntil(
    () => system.getVehicle(vehicle.id)?.queuedNodeId !== undefined,
    system,
    graph,
    controls,
    resolver,
    pathfinding,
  );
  invokeStep(system, graph, controls, resolver, new Set(['vehicle:traffic:1']), pathfinding, queuedTick + 1);
  assert.equal(system.getVehicle(vehicle.id)?.currentEdgeIndex, 0);
  assert.deepEqual(controls.acknowledged, []);

  invokeStep(system, graph, controls, resolver, new Set([vehicle.id, 'vehicle:traffic:1']), pathfinding, queuedTick + 2);
  const released = system.getVehicle(vehicle.id);
  assert.ok(released);
  assert.equal(released.currentEdgeIndex, 1);
  assert.equal(released.queuedNodeId, undefined);
  assert.deepEqual(controls.acknowledged, [vehicle.id]);
});

test('missing-edge reroute continues through explicit movement resolution', () => {
  const graph = graphFixture();
  const route = routeAcross(graph);
  const system = new ServiceVehicleSystem();
  const vehicle = outboundVehicle(route, 'ambulance', 'service-vehicle:test:reroute', ['edge:missing']);
  system.restore([vehicle]);
  const controls = new RecordingControls();
  const resolver = new RecordingResolver();
  const pathfinding = new PathfindingSystem();

  runUntil(
    () => resolver.calls.length > 0,
    system,
    graph,
    controls,
    resolver,
    pathfinding,
  );
  const rerouted = system.getVehicle(vehicle.id);
  assert.ok(rerouted);
  assert.ok(rerouted.edgeIds.length >= 2);
  assert.deepEqual(resolver.calls[0], [rerouted.edgeIds[0], rerouted.edgeIds[1]]);
});

test('failed reroute removes any shared-controller membership and emits failed event', () => {
  const graph = graphFixture();
  const route = routeAcross(graph);
  const system = new ServiceVehicleSystem();
  const vehicle = outboundVehicle(route, 'garbage_truck', 'service-vehicle:test:failure', ['edge:missing'], 'node:missing');
  system.restore([vehicle]);
  const controls = new RecordingControls();
  const resolver = new RecordingResolver();
  const pathfinding = new PathfindingSystem();

  const events = invokeStep(system, graph, controls, resolver, new Set(), pathfinding, 1);
  assert.deepEqual(events, [{ type: 'failed', vehicleId: vehicle.id, jobId: `job:${vehicle.id}` }]);
  assert.deepEqual(controls.removed, [vehicle.id]);
  assert.equal(system.getVehicle(vehicle.id)?.state, 'idle');
});

test('simple explicit non-conflicting continuation bypasses the service queue', () => {
  const graph = graphFixture('plus');
  const route = routeAcross(graph);
  const system = new ServiceVehicleSystem();
  const vehicle = outboundVehicle(route, 'garbage_truck', 'service-vehicle:test:bypass');
  system.restore([vehicle]);
  const controls = new RecordingControls();
  controls.queueRequired = false;
  const resolver = new RecordingResolver();
  const pathfinding = new PathfindingSystem();

  runUntil(
    () => (system.getVehicle(vehicle.id)?.currentEdgeIndex ?? 0) >= 1,
    system,
    graph,
    controls,
    resolver,
    pathfinding,
  );
  assert.equal(controls.enqueued.length, 0);
  assert.ok(resolver.calls.length > 0);
});

test('the 3R service-vehicle path contains no legacy node heuristic or controller stepping', () => {
  const source = readFileSync(
    new URL('../src/simulation/services/ServiceVehicleSystem.ts', import.meta.url),
    'utf8',
  );
  const start = source.indexOf('private stepWithIntersectionControl(');
  const end = source.indexOf('private stepLegacyCompatibility(', start);
  assert.ok(start >= 0 && end > start, '3R service path and legacy compatibility boundary must exist');
  const live3RPath = source.slice(start, end);

  assert.doesNotMatch(live3RPath, /outgoingEdges\(edge\.to\)\.length\s*>\s*2/);
  assert.doesNotMatch(live3RPath, /\.stepNode\(/);
  assert.doesNotMatch(live3RPath, /controls\.step\(/);
});
