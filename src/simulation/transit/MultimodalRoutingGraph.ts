import type { TransitMode } from '../../data/transit.ts';
import type { TransportationGraph } from '../traffic/TransportationGraph.ts';
import type { TransitNetworkSystem, TransitLine, TransitStop } from './TransitNetworkSystem.ts';

export type MultimodalEdgeKind = 'car' | 'walk' | 'board' | 'ride' | 'alight';

export type MultimodalEdge = Readonly<{
  id: string;
  from: string;
  to: string;
  kind: MultimodalEdgeKind;
  ticks: number;
  lineId?: string;
  mode?: TransitMode;
  fare?: number;
  waitTicks?: number;
}>;

export type LineTravelTimeProvider = (lineId: string, fromStopId: string, toStopId: string, mode: TransitMode) => number;

const CARDINAL = [[0, -1], [1, 0], [0, 1], [-1, 0]] as const;
const stopNodeId = (stopId: string): string => `stop:${stopId}`;
const platformNodeId = (lineId: string, stopId: string): string => `platform:${lineId}:${stopId}`;

export class MultimodalRoutingGraph {
  nodes: string[] = [];
  edges: MultimodalEdge[] = [];
  revision = 0;
  sourceRoadRevision = -1;
  sourceTransitRevision = -1;
  sourceCostEpoch = -1;
  private readonly outgoing = new Map<string, MultimodalEdge[]>();
  private readonly nodeSet = new Set<string>();

  rebuild(roadGraph: TransportationGraph, transit: TransitNetworkSystem, lineTravelTimeProvider: LineTravelTimeProvider, costEpoch = 0): boolean {
    if (roadGraph.revision === this.sourceRoadRevision && transit.revision === this.sourceTransitRevision && costEpoch === this.sourceCostEpoch) return false;
    const nodes = new Set<string>();
    const edges: MultimodalEdge[] = [];
    for (const node of roadGraph.nodes) nodes.add(node.id);
    for (const edge of roadGraph.edges) edges.push({ id: `car:${edge.id}`, from: edge.from, to: edge.to, kind: 'car', ticks: edge.freeFlowTicks });

    const stops = transit.listStops();
    const accessByStop = new Map<string, string[]>();
    for (const stop of stops) {
      const stopNode = stopNodeId(stop.id);
      nodes.add(stopNode);
      const accessNodes = this.roadAccessNodes(stop, roadGraph);
      accessByStop.set(stop.id, accessNodes);
      for (const roadNode of accessNodes) {
        edges.push({ id: `walk:${roadNode}>${stopNode}`, from: roadNode, to: stopNode, kind: 'walk', ticks: 8 });
        edges.push({ id: `walk:${stopNode}>${roadNode}`, from: stopNode, to: roadNode, kind: 'walk', ticks: 8 });
      }
    }

    for (const line of transit.listLines().filter((candidate) => candidate.enabled && candidate.stopIds.length >= 2)) this.addLine(line, transit, roadGraph, accessByStop, lineTravelTimeProvider, nodes, edges);

    this.nodes = [...nodes].sort();
    this.edges = edges.filter((edge) => Number.isFinite(edge.ticks) && edge.ticks >= 0).sort((a, b) => a.id.localeCompare(b.id));
    this.nodeSet.clear();
    for (const node of this.nodes) this.nodeSet.add(node);
    this.outgoing.clear();
    for (const edge of this.edges) {
      const list = this.outgoing.get(edge.from) ?? [];
      list.push(edge);
      this.outgoing.set(edge.from, list);
    }
    for (const list of this.outgoing.values()) list.sort((a, b) => a.id.localeCompare(b.id));
    this.sourceRoadRevision = roadGraph.revision;
    this.sourceTransitRevision = transit.revision;
    this.sourceCostEpoch = costEpoch;
    this.revision++;
    return true;
  }

  hasNode(id: string): boolean { return this.nodeSet.has(id); }
  outgoingEdges(id: string): readonly MultimodalEdge[] { return this.outgoing.get(id) ?? []; }

  private addLine(line: TransitLine, transit: TransitNetworkSystem, roadGraph: TransportationGraph, accessByStop: ReadonlyMap<string, string[]>, provider: LineTravelTimeProvider, nodes: Set<string>, edges: MultimodalEdge[]): void {
    for (const stopId of line.stopIds) {
      const stopNode = stopNodeId(stopId);
      const platform = platformNodeId(line.id, stopId);
      nodes.add(platform);
      edges.push({ id: `board:${line.id}:${stopId}`, from: stopNode, to: platform, kind: 'board', ticks: line.headwayTicks / 2, waitTicks: line.headwayTicks / 2, fare: line.fare, lineId: line.id, mode: line.mode });
      edges.push({ id: `alight:${line.id}:${stopId}`, from: platform, to: stopNode, kind: 'alight', ticks: 1, lineId: line.id, mode: line.mode });
    }
    for (let i = 0; i < line.stopIds.length - 1; i++) {
      const fromStopId = line.stopIds[i];
      const toStopId = line.stopIds[i + 1];
      if (!fromStopId || !toStopId) continue;
      if (line.mode !== 'metro' && !this.surfaceStopsConnected(fromStopId, toStopId, accessByStop, roadGraph)) continue;
      const forward = provider(line.id, fromStopId, toStopId, line.mode);
      const reverse = provider(line.id, toStopId, fromStopId, line.mode);
      if (Number.isFinite(forward) && forward > 0) edges.push({ id: `ride:${line.id}:${fromStopId}>${toStopId}`, from: platformNodeId(line.id, fromStopId), to: platformNodeId(line.id, toStopId), kind: 'ride', ticks: forward, lineId: line.id, mode: line.mode });
      if (Number.isFinite(reverse) && reverse > 0) edges.push({ id: `ride:${line.id}:${toStopId}>${fromStopId}`, from: platformNodeId(line.id, toStopId), to: platformNodeId(line.id, fromStopId), kind: 'ride', ticks: reverse, lineId: line.id, mode: line.mode });
    }
    void transit;
  }

  private roadAccessNodes(stop: TransitStop, roadGraph: TransportationGraph): string[] {
    return CARDINAL.map(([dx, dy]) => roadGraph.findNodeAt(stop.x + dx, stop.y + dy)?.id).filter((id): id is string => id !== undefined).sort();
  }

  private surfaceStopsConnected(fromStopId: string, toStopId: string, accessByStop: ReadonlyMap<string, string[]>, roadGraph: TransportationGraph): boolean {
    const starts = accessByStop.get(fromStopId) ?? [];
    const targets = new Set(accessByStop.get(toStopId) ?? []);
    if (starts.length === 0 || targets.size === 0) return false;
    const seen = new Set(starts);
    const queue = [...starts].sort();
    for (let i = 0; i < queue.length; i++) {
      const current = queue[i];
      if (!current) continue;
      if (targets.has(current)) return true;
      for (const edge of [...roadGraph.outgoingEdges(current)].sort((a, b) => a.id.localeCompare(b.id))) {
        if (seen.has(edge.to)) continue;
        seen.add(edge.to);
        queue.push(edge.to);
      }
    }
    return false;
  }
}
