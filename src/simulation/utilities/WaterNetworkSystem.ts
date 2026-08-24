import { UTILITY_CORRIDOR_CAPACITY, UTILITY_DEFINITIONS } from '../../data/utilities.ts';
import type { TerrainGrid } from '../../world/terrain/TerrainGrid.ts';
import { InfrastructureGraph, type InfrastructureGraphEdge, type InfrastructureGraphNode } from '../infrastructure/InfrastructureGraph.ts';
import type { CellCoord } from '../core/types.ts';
import type { UtilityCorridorCell, UtilityCorridorType, UtilityFacility } from './UtilityInfrastructureTypes.ts';

export type WaterDemandNode = Readonly<{ id: string; x: number; y: number; demand: number }>;

export type WaterBuildingService = Readonly<{
  demand: number;
  delivered: number;
  serviceRatio: number;
  pressureEligible: boolean;
  pressureMargin: number;
  connectionCellIds: readonly string[];
}>;

export type WaterCorridorService = Readonly<{
  capacity: number;
  flow: number;
  utilization: number;
  residualCapacity: number;
  operational: boolean;
  pressureHead: number;
}>;

export type WaterNetworkSnapshot = Readonly<{
  production: number;
  demand: number;
  delivered: number;
  unserved: number;
  serviceRatio: number;
  perBuilding: Readonly<Record<string, WaterBuildingService>>;
  perCorridor: Readonly<Record<string, WaterCorridorService>>;
  pressureByCorridor: Readonly<Record<string, number>>;
  edgeFlow: Readonly<Record<string, number>>;
  edgeCapacity: Readonly<Record<string, number>>;
}>;

export type WaterHeadroomResult = Readonly<{
  demand: number;
  deliverable: number;
  serviceRatio: number;
  pressureEligible: boolean;
  pressureMargin: number;
  limitingReason?: 'no-main-connection' | 'pressure' | 'capacity';
}>;

type BuildOptions = Readonly<{
  corridors: readonly UtilityCorridorCell[];
  facilities: readonly UtilityFacility[];
  demands: readonly WaterDemandNode[];
  tick: number;
  reservedFlow?: Readonly<Record<string, number>>;
}>;

type PressureResult = Readonly<{
  headByCellId: Readonly<Record<string, number>>;
  pumpTransitions: Readonly<Record<string, readonly [UtilityCorridorCell, UtilityCorridorCell]>>;
}>;

type BuiltNetwork = Readonly<{
  graph: InfrastructureGraph;
  edges: readonly InfrastructureGraphEdge[];
  demandSinkEdges: Readonly<Record<string, string>>;
  demandConnections: Readonly<Record<string, readonly string[]>>;
  pressure: PressureResult;
  corridors: readonly UtilityCorridorCell[];
}>;

const CARDINAL = [[0, -1], [1, 0], [0, 1], [-1, 0]] as const;
const SUPER_SOURCE = 'water:super-source';
const SUPER_SINK = 'water:super-sink';
const SOURCE_HEAD = 8;
const EDGE_HEAD_LOSS = 0.25;
const ELEVATION_HEAD_FACTOR = 8;
const EPSILON = 1e-12;
const WATER_TYPES = new Set<UtilityCorridorType>(['water_main', 'water_trunk']);

const coordKey = (x: number, y: number): string => `${x},${y}`;
const nodeId = (cell: UtilityCorridorCell): string => `water:${cell.type}:${cell.x},${cell.y}`;
const corridorCapacity = (cell: UtilityCorridorCell): number => UTILITY_CORRIDOR_CAPACITY[cell.type][cell.tier];
const operational = (cell: UtilityCorridorCell, tick: number): boolean => cell.trippedUntilTick <= tick;

function stableRecord<T>(entries: readonly (readonly [string, T])[]): Readonly<Record<string, T>> {
  return Object.freeze(Object.fromEntries([...entries].sort((a, b) => a[0].localeCompare(b[0]))) as Record<string, T>);
}

function validateDemand(demand: WaterDemandNode): void {
  if (!demand.id) throw new Error('water demand id must be non-empty');
  if (!Number.isInteger(demand.x) || !Number.isInteger(demand.y)) throw new Error('water demand coordinates must be integers');
  if (!Number.isFinite(demand.demand) || demand.demand < 0) throw new Error('water demand must be finite and non-negative');
}

function sortedWaterCorridors(corridors: readonly UtilityCorridorCell[]): UtilityCorridorCell[] {
  return corridors
    .filter((cell) => WATER_TYPES.has(cell.type))
    .map((cell) => ({ ...cell }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export class WaterNetworkSystem {
  private readonly terrain: TerrainGrid;

  constructor(terrain: TerrainGrid) {
    this.terrain = terrain;
  }

  evaluate(input: Readonly<{
    corridors: readonly UtilityCorridorCell[];
    facilities: readonly UtilityFacility[];
    demands: readonly WaterDemandNode[];
    tick: number;
  }>): WaterNetworkSnapshot {
    if (!Number.isFinite(input.tick) || input.tick < 0) throw new Error('water tick must be finite and non-negative');
    const demands = [...input.demands].map((item) => ({ ...item })).sort((a, b) => a.id.localeCompare(b.id));
    const demandIds = new Set<string>();
    for (const demand of demands) {
      validateDemand(demand);
      if (demandIds.has(demand.id)) throw new Error(`duplicate water demand id: ${demand.id}`);
      demandIds.add(demand.id);
    }

    const built = this.buildNetwork({ ...input, demands });
    const flow = built.graph.solveMaxFlow(SUPER_SOURCE, SUPER_SINK);
    const totalDemand = demands.reduce((sum, item) => sum + item.demand, 0);
    const production = input.facilities
      .filter((facility) => facility.type === 'water')
      .reduce((sum) => sum + UTILITY_DEFINITIONS.water.capacity, 0);

    const perBuildingEntries: Array<readonly [string, WaterBuildingService]> = [];
    for (const demand of demands) {
      const sinkEdge = built.demandSinkEdges[demand.id];
      const delivered = sinkEdge ? (flow.edgeFlow[sinkEdge] ?? 0) : 0;
      const connections = built.demandConnections[demand.id] ?? [];
      const pressureMargin = connections.reduce(
        (best, cellId) => Math.max(best, built.pressure.headByCellId[cellId] ?? 0),
        0,
      );
      perBuildingEntries.push([demand.id, Object.freeze({
        demand: demand.demand,
        delivered,
        serviceRatio: demand.demand <= 0 ? 1 : Math.min(1, delivered / demand.demand),
        pressureEligible: pressureMargin > 0,
        pressureMargin,
        connectionCellIds: Object.freeze([...connections]),
      })]);
    }

    const perCorridorEntries: Array<readonly [string, WaterCorridorService]> = [];
    for (const cell of built.corridors) {
      const incident = built.edges.filter((edge) => edge.from === nodeId(cell) || edge.to === nodeId(cell));
      let maxUtilization = 0;
      let maxFlow = 0;
      let minResidual = corridorCapacity(cell);
      for (const edge of incident) {
        maxUtilization = Math.max(maxUtilization, flow.edgeUtilization[edge.id] ?? 0);
        maxFlow = Math.max(maxFlow, flow.edgeFlow[edge.id] ?? 0);
        minResidual = Math.min(minResidual, flow.residualCapacity[edge.id] ?? edge.capacity);
      }
      perCorridorEntries.push([cell.id, Object.freeze({
        capacity: corridorCapacity(cell),
        flow: maxFlow,
        utilization: maxUtilization,
        residualCapacity: Math.max(0, minResidual),
        operational: operational(cell, input.tick),
        pressureHead: built.pressure.headByCellId[cell.id] ?? 0,
      })]);
    }

    const delivered = perBuildingEntries.reduce((sum, [, item]) => sum + item.delivered, 0);
    return Object.freeze({
      production,
      demand: totalDemand,
      delivered,
      unserved: Math.max(0, totalDemand - delivered),
      serviceRatio: totalDemand <= 0 ? 1 : delivered / totalDemand,
      perBuilding: stableRecord(perBuildingEntries),
      perCorridor: stableRecord(perCorridorEntries),
      pressureByCorridor: stableRecord(Object.entries(built.pressure.headByCellId)),
      edgeFlow: stableRecord(Object.entries(flow.edgeFlow)),
      edgeCapacity: stableRecord(built.edges.map((edge) => [edge.id, edge.capacity] as const)),
    });
  }

  evaluateAdditionalHeadroom(input: Readonly<{
    x: number;
    y: number;
    demand: number;
    snapshot: WaterNetworkSnapshot;
    corridors: readonly UtilityCorridorCell[];
    facilities: readonly UtilityFacility[];
    tick: number;
  }>): WaterHeadroomResult {
    if (!Number.isFinite(input.demand) || input.demand < 0) throw new Error('water headroom demand must be finite and non-negative');
    if (input.demand === 0) {
      return Object.freeze({ demand: 0, deliverable: 0, serviceRatio: 1, pressureEligible: true, pressureMargin: SOURCE_HEAD });
    }

    const active = sortedWaterCorridors(input.corridors).filter((cell) => operational(cell, input.tick));
    const connections = active
      .filter((cell) => cell.type === 'water_main' && Math.abs(cell.x - input.x) + Math.abs(cell.y - input.y) === 1)
      .sort((a, b) => a.id.localeCompare(b.id));
    if (connections.length === 0) {
      return Object.freeze({
        demand: input.demand,
        deliverable: 0,
        serviceRatio: 0,
        pressureEligible: false,
        pressureMargin: 0,
        limitingReason: 'no-main-connection',
      });
    }

    const pressure = this.evaluatePressure(active, input.facilities, input.tick);
    const pressureMargin = connections.reduce((best, cell) => Math.max(best, pressure.headByCellId[cell.id] ?? 0), 0);
    if (pressureMargin <= 0) {
      return Object.freeze({
        demand: input.demand,
        deliverable: 0,
        serviceRatio: 0,
        pressureEligible: false,
        pressureMargin: 0,
        limitingReason: 'pressure',
      });
    }

    const candidate: WaterDemandNode = { id: 'water:headroom-candidate', x: input.x, y: input.y, demand: input.demand };
    const built = this.buildNetwork({
      corridors: input.corridors,
      facilities: input.facilities,
      demands: [candidate],
      tick: input.tick,
      reservedFlow: input.snapshot.edgeFlow,
    });
    const flow = built.graph.solveMaxFlow(SUPER_SOURCE, SUPER_SINK);
    const sinkEdge = built.demandSinkEdges[candidate.id];
    const deliverable = sinkEdge ? Math.min(input.demand, flow.edgeFlow[sinkEdge] ?? 0) : 0;
    const serviceRatio = deliverable / input.demand;
    return Object.freeze({
      demand: input.demand,
      deliverable,
      serviceRatio,
      pressureEligible: true,
      pressureMargin,
      ...(serviceRatio < 1 ? { limitingReason: 'capacity' as const } : {}),
    });
  }

  private evaluatePressure(
    corridors: readonly UtilityCorridorCell[],
    facilities: readonly UtilityFacility[],
    tick: number,
  ): PressureResult {
    const active = sortedWaterCorridors(corridors).filter((cell) => operational(cell, tick));
    const byLayerCoord = new Map(active.map((cell) => [`${cell.type}|${coordKey(cell.x, cell.y)}`, cell] as const));
    const byCoord = new Map<string, UtilityCorridorCell[]>();
    for (const cell of active) {
      const list = byCoord.get(coordKey(cell.x, cell.y)) ?? [];
      list.push(cell);
      list.sort((a, b) => a.type.localeCompare(b.type) || a.id.localeCompare(b.id));
      byCoord.set(coordKey(cell.x, cell.y), list);
    }

    const pumps = [...facilities]
      .filter((facility) => facility.type === 'water_pump' && facility.inputCoord && facility.outputCoord)
      .sort((a, b) => a.id.localeCompare(b.id));
    const pumpTransitions = new Map<string, readonly [UtilityCorridorCell, UtilityCorridorCell]>();
    for (const pump of pumps) {
      const input = this.selectPumpEndpoint(byCoord, pump.inputCoord!, true);
      const output = this.selectPumpEndpoint(byCoord, pump.outputCoord!, false);
      if (input && output) pumpTransitions.set(pump.id, [input, output]);
    }

    const head = new Map<string, number>();
    const queue: Array<{ cell: UtilityCorridorCell; head: number }> = [];
    const push = (cell: UtilityCorridorCell, candidateHead: number): void => {
      if (!(candidateHead > 0)) return;
      if (candidateHead <= (head.get(cell.id) ?? 0) + EPSILON) return;
      head.set(cell.id, candidateHead);
      queue.push({ cell, head: candidateHead });
    };

    const sources = [...facilities].filter((facility) => facility.type === 'water').sort((a, b) => a.id.localeCompare(b.id));
    for (const source of sources) {
      for (const cell of active) {
        if (Math.abs(cell.x - source.x) + Math.abs(cell.y - source.y) === 1) push(cell, SOURCE_HEAD);
      }
    }

    while (queue.length > 0) {
      queue.sort((a, b) => b.head - a.head || a.cell.id.localeCompare(b.cell.id));
      const current = queue.shift();
      if (!current) continue;
      if (current.head + EPSILON < (head.get(current.cell.id) ?? 0)) continue;

      for (const [dx, dy] of CARDINAL) {
        const neighbor = byLayerCoord.get(`${current.cell.type}|${coordKey(current.cell.x + dx, current.cell.y + dy)}`);
        if (!neighbor) continue;
        const candidate = current.head - this.edgePressureLoss(current.cell, neighbor);
        push(neighbor, candidate);
      }

      for (const [pumpId, [input, output]] of [...pumpTransitions.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
        if (input.id !== current.cell.id || current.head <= 0) continue;
        void pumpId;
        push(output, SOURCE_HEAD);
      }
    }

    return Object.freeze({
      headByCellId: stableRecord([...head.entries()]),
      pumpTransitions: stableRecord([...pumpTransitions.entries()]),
    });
  }

  private buildNetwork(options: BuildOptions): BuiltNetwork {
    const corridors = sortedWaterCorridors(options.corridors);
    const active = corridors.filter((cell) => operational(cell, options.tick));
    const byLayerCoord = new Map(active.map((cell) => [`${cell.type}|${coordKey(cell.x, cell.y)}`, cell] as const));
    const pressure = this.evaluatePressure(active, options.facilities, options.tick);
    const nodes: InfrastructureGraphNode[] = [{ id: SUPER_SOURCE }, { id: SUPER_SINK }];
    const edges: InfrastructureGraphEdge[] = [];
    const demandSinkEdges: Record<string, string> = {};
    const demandConnections: Record<string, readonly string[]> = {};
    for (const cell of active) nodes.push({ id: nodeId(cell) });

    const edgeSeen = new Set<string>();
    const addEdge = (edge: InfrastructureGraphEdge): void => {
      if (edgeSeen.has(edge.id)) throw new Error(`duplicate generated water edge: ${edge.id}`);
      edgeSeen.add(edge.id);
      const reserved = Math.max(0, options.reservedFlow?.[edge.id] ?? 0);
      edges.push({ ...edge, capacity: Math.max(0, edge.capacity - reserved) });
    };

    for (const cell of active) {
      const currentHead = pressure.headByCellId[cell.id] ?? 0;
      if (currentHead <= 0) continue;
      for (const [dx, dy] of CARDINAL) {
        const neighbor = byLayerCoord.get(`${cell.type}|${coordKey(cell.x + dx, cell.y + dy)}`);
        if (!neighbor) continue;
        if (currentHead - this.edgePressureLoss(cell, neighbor) <= 0) continue;
        addEdge({
          id: `water:link:${cell.id}>${neighbor.id}`,
          from: nodeId(cell),
          to: nodeId(neighbor),
          capacity: Math.min(corridorCapacity(cell), corridorCapacity(neighbor)),
        });
      }
    }

    const facilities = [...options.facilities].sort((a, b) => a.id.localeCompare(b.id));
    for (const facility of facilities) {
      if (facility.type === 'water') {
        const sourceNode = `water:source:${facility.id}`;
        nodes.push({ id: sourceNode });
        addEdge({ id: `water:source-cap:${facility.id}`, from: SUPER_SOURCE, to: sourceNode, capacity: UTILITY_DEFINITIONS.water.capacity });
        for (const cell of active) {
          if (Math.abs(cell.x - facility.x) + Math.abs(cell.y - facility.y) !== 1) continue;
          if ((pressure.headByCellId[cell.id] ?? 0) <= 0) continue;
          addEdge({ id: `water:source-link:${facility.id}>${cell.id}`, from: sourceNode, to: nodeId(cell), capacity: UTILITY_DEFINITIONS.water.capacity });
        }
      }
      if (facility.type === 'water_pump') {
        const transition = pressure.pumpTransitions[facility.id];
        if (!transition) continue;
        const [input, output] = transition;
        if ((pressure.headByCellId[input.id] ?? 0) <= 0 || (pressure.headByCellId[output.id] ?? 0) <= 0) continue;
        const pumpNode = `water:pump:${facility.id}`;
        nodes.push({ id: pumpNode });
        addEdge({ id: `water:pump-in:${facility.id}`, from: nodeId(input), to: pumpNode, capacity: UTILITY_DEFINITIONS.water_pump.capacity });
        addEdge({ id: `water:pump-out:${facility.id}`, from: pumpNode, to: nodeId(output), capacity: UTILITY_DEFINITIONS.water_pump.capacity });
      }
    }

    const demands = [...options.demands].sort((a, b) => a.id.localeCompare(b.id));
    for (const demand of demands) {
      validateDemand(demand);
      const demandNode = `water:demand:${demand.id}`;
      nodes.push({ id: demandNode });
      const connections = active
        .filter((cell) => cell.type === 'water_main'
          && Math.abs(cell.x - demand.x) + Math.abs(cell.y - demand.y) === 1
          && (pressure.headByCellId[cell.id] ?? 0) > 0)
        .sort((a, b) => a.id.localeCompare(b.id));
      demandConnections[demand.id] = Object.freeze(connections.map((cell) => cell.id));
      for (const cell of connections) {
        addEdge({ id: `water:demand-link:${cell.id}>${demand.id}`, from: nodeId(cell), to: demandNode, capacity: demand.demand });
      }
      const sinkEdge = `water:demand-cap:${demand.id}`;
      addEdge({ id: sinkEdge, from: demandNode, to: SUPER_SINK, capacity: demand.demand });
      demandSinkEdges[demand.id] = sinkEdge;
    }

    return Object.freeze({
      graph: new InfrastructureGraph(nodes, edges),
      edges: Object.freeze(edges.map((edge) => Object.freeze({ ...edge }))),
      demandSinkEdges: Object.freeze({ ...demandSinkEdges }),
      demandConnections: Object.freeze({ ...demandConnections }),
      pressure,
      corridors: Object.freeze(corridors.map((cell) => Object.freeze({ ...cell }))),
    });
  }

  private edgePressureLoss(from: UtilityCorridorCell, to: UtilityCorridorCell): number {
    const fromElevation = this.terrain.get(from.x, from.y).elevation;
    const toElevation = this.terrain.get(to.x, to.y).elevation;
    return EDGE_HEAD_LOSS + ELEVATION_HEAD_FACTOR * Math.max(0, toElevation - fromElevation);
  }

  private selectPumpEndpoint(
    byCoord: ReadonlyMap<string, UtilityCorridorCell[]>,
    coord: CellCoord,
    input: boolean,
  ): UtilityCorridorCell | undefined {
    const cells = [...(byCoord.get(coordKey(coord.x, coord.y)) ?? [])];
    cells.sort((a, b) => {
      const aPriority = input ? (a.type === 'water_trunk' ? 0 : 1) : (a.type === 'water_main' ? 0 : 1);
      const bPriority = input ? (b.type === 'water_trunk' ? 0 : 1) : (b.type === 'water_main' ? 0 : 1);
      return aPriority - bPriority || a.id.localeCompare(b.id);
    });
    return cells[0];
  }
}
