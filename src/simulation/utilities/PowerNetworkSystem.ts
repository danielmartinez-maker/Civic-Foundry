import { UTILITY_CORRIDOR_CAPACITY, UTILITY_DEFINITIONS } from '../../data/utilities.ts';
import { InfrastructureGraph, type InfrastructureGraphEdge, type InfrastructureGraphNode } from '../infrastructure/InfrastructureGraph.ts';
import type { UtilityCorridorCell, UtilityCorridorType, UtilityFacility } from './UtilityInfrastructureTypes.ts';

export type PowerDemandNode = Readonly<{ id: string; x: number; y: number; demand: number }>;

export type PowerBuildingService = Readonly<{
  demand: number;
  delivered: number;
  serviceRatio: number;
  connectionCellIds: readonly string[];
}>;

export type PowerCorridorService = Readonly<{
  capacity: number;
  flow: number;
  utilization: number;
  residualCapacity: number;
  operational: boolean;
}>;

export type PowerNetworkSnapshot = Readonly<{
  production: number;
  demand: number;
  delivered: number;
  unserved: number;
  serviceRatio: number;
  perBuilding: Readonly<Record<string, PowerBuildingService>>;
  perCorridor: Readonly<Record<string, PowerCorridorService>>;
  edgeFlow: Readonly<Record<string, number>>;
  edgeCapacity: Readonly<Record<string, number>>;
}>;

export type PowerHeadroomResult = Readonly<{
  demand: number;
  deliverable: number;
  serviceRatio: number;
  limitingReason?: 'no-distribution-connection' | 'capacity';
}>;

type BuildOptions = Readonly<{
  corridors: readonly UtilityCorridorCell[];
  facilities: readonly UtilityFacility[];
  demands: readonly PowerDemandNode[];
  tick: number;
  reservedFlow?: Readonly<Record<string, number>>;
}>;

type BuiltNetwork = Readonly<{
  graph: InfrastructureGraph;
  nodes: readonly InfrastructureGraphNode[];
  edges: readonly InfrastructureGraphEdge[];
  demandSinkEdges: Readonly<Record<string, string>>;
  demandConnections: Readonly<Record<string, readonly string[]>>;
  corridors: readonly UtilityCorridorCell[];
}>;

const CARDINAL = [[0, -1], [1, 0], [0, 1], [-1, 0]] as const;
const SUPER_SOURCE = 'power:super-source';
const SUPER_SINK = 'power:super-sink';
const POWER_TYPES = new Set<UtilityCorridorType>(['power_distribution', 'power_transmission']);

const coordKey = (x: number, y: number): string => `${x},${y}`;
const nodeId = (cell: UtilityCorridorCell): string => `power:${cell.type}:${cell.x},${cell.y}`;
const corridorCapacity = (cell: UtilityCorridorCell): number => UTILITY_CORRIDOR_CAPACITY[cell.type][cell.tier];
const operational = (cell: UtilityCorridorCell, tick: number): boolean => cell.trippedUntilTick <= tick;

function validateDemand(demand: PowerDemandNode): void {
  if (!demand.id) throw new Error('power demand id must be non-empty');
  if (!Number.isInteger(demand.x) || !Number.isInteger(demand.y)) throw new Error('power demand coordinates must be integers');
  if (!Number.isFinite(demand.demand) || demand.demand < 0) throw new Error('power demand must be finite and non-negative');
}

function sortedPowerCorridors(corridors: readonly UtilityCorridorCell[]): UtilityCorridorCell[] {
  return corridors
    .filter((cell) => POWER_TYPES.has(cell.type))
    .map((cell) => ({ ...cell }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function stableRecord<T>(entries: readonly (readonly [string, T])[]): Readonly<Record<string, T>> {
  return Object.freeze(Object.fromEntries([...entries].sort((a, b) => a[0].localeCompare(b[0]))) as Record<string, T>);
}

export class PowerNetworkSystem {
  evaluate(input: Readonly<{
    corridors: readonly UtilityCorridorCell[];
    facilities: readonly UtilityFacility[];
    demands: readonly PowerDemandNode[];
    tick: number;
  }>): PowerNetworkSnapshot {
    if (!Number.isFinite(input.tick) || input.tick < 0) throw new Error('power tick must be finite and non-negative');
    const demands = [...input.demands].map((item) => ({ ...item })).sort((a, b) => a.id.localeCompare(b.id));
    for (const demand of demands) validateDemand(demand);
    const demandIds = new Set<string>();
    for (const demand of demands) {
      if (demandIds.has(demand.id)) throw new Error(`duplicate power demand id: ${demand.id}`);
      demandIds.add(demand.id);
    }

    const built = this.buildNetwork({ ...input, demands });
    const flow = built.graph.solveMaxFlow(SUPER_SOURCE, SUPER_SINK);
    const totalDemand = demands.reduce((sum, item) => sum + item.demand, 0);
    const production = input.facilities
      .filter((facility) => facility.type === 'power')
      .reduce((sum) => sum + UTILITY_DEFINITIONS.power.capacity, 0);

    const perBuildingEntries: Array<readonly [string, PowerBuildingService]> = [];
    for (const demand of demands) {
      const sinkEdge = built.demandSinkEdges[demand.id];
      const delivered = sinkEdge ? (flow.edgeFlow[sinkEdge] ?? 0) : 0;
      perBuildingEntries.push([demand.id, Object.freeze({
        demand: demand.demand,
        delivered,
        serviceRatio: demand.demand <= 0 ? 1 : Math.min(1, delivered / demand.demand),
        connectionCellIds: Object.freeze([...(built.demandConnections[demand.id] ?? [])]),
      })]);
    }

    const perCorridorEntries: Array<readonly [string, PowerCorridorService]> = [];
    for (const cell of built.corridors) {
      const incident = built.edges.filter((edge) => edge.from === nodeId(cell) || edge.to === nodeId(cell));
      let maxUtilization = 0;
      let maxFlow = 0;
      let minResidual = corridorCapacity(cell);
      for (const edge of incident) {
        const utilization = flow.edgeUtilization[edge.id] ?? 0;
        const realized = flow.edgeFlow[edge.id] ?? 0;
        maxUtilization = Math.max(maxUtilization, utilization);
        maxFlow = Math.max(maxFlow, realized);
        minResidual = Math.min(minResidual, flow.residualCapacity[edge.id] ?? edge.capacity);
      }
      perCorridorEntries.push([cell.id, Object.freeze({
        capacity: corridorCapacity(cell),
        flow: maxFlow,
        utilization: maxUtilization,
        residualCapacity: Math.max(0, minResidual),
        operational: operational(cell, input.tick),
      })]);
    }

    const delivered = perBuildingEntries.reduce((sum, [, item]) => sum + item.delivered, 0);
    const edgeCapacity = stableRecord(built.edges.map((edge) => [edge.id, edge.capacity] as const));
    return Object.freeze({
      production,
      demand: totalDemand,
      delivered,
      unserved: Math.max(0, totalDemand - delivered),
      serviceRatio: totalDemand <= 0 ? 1 : delivered / totalDemand,
      perBuilding: stableRecord(perBuildingEntries),
      perCorridor: stableRecord(perCorridorEntries),
      edgeFlow: stableRecord(Object.entries(flow.edgeFlow)),
      edgeCapacity,
    });
  }

  evaluateAdditionalHeadroom(input: Readonly<{
    x: number;
    y: number;
    demand: number;
    snapshot: PowerNetworkSnapshot;
    corridors: readonly UtilityCorridorCell[];
    facilities: readonly UtilityFacility[];
    tick: number;
  }>): PowerHeadroomResult {
    if (!Number.isFinite(input.demand) || input.demand < 0) throw new Error('power headroom demand must be finite and non-negative');
    if (input.demand === 0) return Object.freeze({ demand: 0, deliverable: 0, serviceRatio: 1 });

    const activeDistribution = sortedPowerCorridors(input.corridors)
      .filter((cell) => cell.type === 'power_distribution' && operational(cell, input.tick));
    const connections = activeDistribution.filter((cell) => Math.abs(cell.x - input.x) + Math.abs(cell.y - input.y) === 1);
    if (connections.length === 0) {
      return Object.freeze({ demand: input.demand, deliverable: 0, serviceRatio: 0, limitingReason: 'no-distribution-connection' });
    }

    const candidate: PowerDemandNode = { id: 'power:headroom-candidate', x: input.x, y: input.y, demand: input.demand };
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
    const serviceRatio = input.demand <= 0 ? 1 : deliverable / input.demand;
    return Object.freeze({
      demand: input.demand,
      deliverable,
      serviceRatio,
      ...(serviceRatio < 1 ? { limitingReason: 'capacity' as const } : {}),
    });
  }

  private buildNetwork(options: BuildOptions): BuiltNetwork {
    const corridors = sortedPowerCorridors(options.corridors);
    const cellsByLayerCoord = new Map(corridors.map((cell) => [`${cell.type}|${coordKey(cell.x, cell.y)}`, cell] as const));
    const nodes: InfrastructureGraphNode[] = [{ id: SUPER_SOURCE }, { id: SUPER_SINK }];
    const edges: InfrastructureGraphEdge[] = [];
    const demandSinkEdges: Record<string, string> = {};
    const demandConnections: Record<string, readonly string[]> = {};

    const active = corridors.filter((cell) => operational(cell, options.tick));
    for (const cell of active) nodes.push({ id: nodeId(cell) });

    const edgeSeen = new Set<string>();
    const addEdge = (edge: InfrastructureGraphEdge): void => {
      if (edgeSeen.has(edge.id)) throw new Error(`duplicate generated power edge: ${edge.id}`);
      edgeSeen.add(edge.id);
      const reserved = Math.max(0, options.reservedFlow?.[edge.id] ?? 0);
      edges.push({ ...edge, capacity: Math.max(0, edge.capacity - reserved) });
    };

    for (const cell of active) {
      for (const [dx, dy] of CARDINAL) {
        const neighbor = cellsByLayerCoord.get(`${cell.type}|${coordKey(cell.x + dx, cell.y + dy)}`);
        if (!neighbor || !operational(neighbor, options.tick)) continue;
        addEdge({
          id: `power:link:${cell.id}>${neighbor.id}`,
          from: nodeId(cell),
          to: nodeId(neighbor),
          capacity: Math.min(corridorCapacity(cell), corridorCapacity(neighbor)),
        });
      }
    }

    const facilities = [...options.facilities].sort((a, b) => a.id.localeCompare(b.id));
    for (const facility of facilities) {
      if (facility.type === 'power') {
        const facilityNode = `power:source:${facility.id}`;
        nodes.push({ id: facilityNode });
        addEdge({ id: `power:source-cap:${facility.id}`, from: SUPER_SOURCE, to: facilityNode, capacity: UTILITY_DEFINITIONS.power.capacity });
        for (const cell of active) {
          if (Math.abs(cell.x - facility.x) + Math.abs(cell.y - facility.y) !== 1) continue;
          addEdge({ id: `power:source-link:${facility.id}>${cell.id}`, from: facilityNode, to: nodeId(cell), capacity: UTILITY_DEFINITIONS.power.capacity });
        }
      }
      if (facility.type === 'power_substation' && facility.inputCoord && facility.outputCoord) {
        const input = cellsByLayerCoord.get(`power_transmission|${coordKey(facility.inputCoord.x, facility.inputCoord.y)}`);
        const output = cellsByLayerCoord.get(`power_distribution|${coordKey(facility.outputCoord.x, facility.outputCoord.y)}`);
        if (!input || !output || !operational(input, options.tick) || !operational(output, options.tick)) continue;
        const facilityNode = `power:substation:${facility.id}`;
        nodes.push({ id: facilityNode });
        addEdge({ id: `power:substation-in:${facility.id}`, from: nodeId(input), to: facilityNode, capacity: UTILITY_DEFINITIONS.power_substation.capacity });
        addEdge({ id: `power:substation-out:${facility.id}`, from: facilityNode, to: nodeId(output), capacity: UTILITY_DEFINITIONS.power_substation.capacity });
      }
    }

    const demands = [...options.demands].sort((a, b) => a.id.localeCompare(b.id));
    for (const demand of demands) {
      validateDemand(demand);
      const demandNode = `power:demand:${demand.id}`;
      nodes.push({ id: demandNode });
      const connections = active
        .filter((cell) => cell.type === 'power_distribution' && Math.abs(cell.x - demand.x) + Math.abs(cell.y - demand.y) === 1)
        .sort((a, b) => a.id.localeCompare(b.id));
      demandConnections[demand.id] = Object.freeze(connections.map((cell) => cell.id));
      for (const cell of connections) {
        addEdge({ id: `power:demand-link:${cell.id}>${demand.id}`, from: nodeId(cell), to: demandNode, capacity: demand.demand });
      }
      const sinkEdge = `power:demand-cap:${demand.id}`;
      addEdge({ id: sinkEdge, from: demandNode, to: SUPER_SINK, capacity: demand.demand });
      demandSinkEdges[demand.id] = sinkEdge;
    }

    const graph = new InfrastructureGraph(nodes, edges);
    return Object.freeze({
      graph,
      nodes: Object.freeze(nodes.map((node) => Object.freeze({ ...node }))),
      edges: Object.freeze(edges.map((edge) => Object.freeze({ ...edge }))),
      demandSinkEdges: Object.freeze({ ...demandSinkEdges }),
      demandConnections: Object.freeze({ ...demandConnections }),
      corridors: Object.freeze(corridors.map((cell) => Object.freeze({ ...cell }))),
    });
  }
}
