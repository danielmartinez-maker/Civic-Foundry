import type { TransportationEdge, TransportationGraph } from './TransportationGraph.ts';

export type RouteResult = Readonly<{ nodeIds: readonly string[]; edgeIds: readonly string[]; totalCost: number }>;
export type PathfindingOptions = Readonly<{
  edgeCost?: (edge: TransportationEdge) => number;
  costKey?: string;
}>;

export type PathfindingDiagnostics = {
  requests: number;
  cacheHits: number;
  cacheMisses: number;
};

type QueueEntry = { nodeId: string; g: number; f: number };

export class PathfindingSystem {
  readonly diagnostics: PathfindingDiagnostics = { requests: 0, cacheHits: 0, cacheMisses: 0 };
  private readonly cache = new Map<string, RouteResult | null>();
  private cachedRevision = -1;

  findRoute(graph: TransportationGraph, startNodeId: string, endNodeId: string, options: PathfindingOptions = {}): RouteResult | null {
    this.diagnostics.requests++;
    if (this.cachedRevision !== graph.revision) {
      this.cache.clear();
      this.cachedRevision = graph.revision;
    }
    if (!graph.getNode(startNodeId) || !graph.getNode(endNodeId)) {
      this.diagnostics.cacheMisses++;
      return null;
    }

    const canCache = options.edgeCost === undefined || options.costKey !== undefined;
    const cacheKey = `${graph.revision}|${options.costKey ?? 'free-flow'}|${startNodeId}|${endNodeId}`;
    if (canCache && this.cache.has(cacheKey)) {
      this.diagnostics.cacheHits++;
      return this.cache.get(cacheKey) ?? null;
    }
    this.diagnostics.cacheMisses++;

    if (startNodeId === endNodeId) {
      const route: RouteResult = Object.freeze({
        nodeIds: Object.freeze([startNodeId]),
        edgeIds: Object.freeze([]),
        totalCost: 0,
      });
      if (canCache) this.cache.set(cacheKey, route);
      return route;
    }

    const startNode = graph.getNode(startNodeId)!;
    const endNode = graph.getNode(endNodeId)!;
    const edgeCost = options.edgeCost ?? ((edge: TransportationEdge) => edge.freeFlowTicks);
    const heuristicScale = options.edgeCost ? 0 : 1;
    const heuristic = (nodeId: string): number => {
      const node = graph.getNode(nodeId);
      if (!node) return 0;
      return (Math.abs(node.x - endNode.x) + Math.abs(node.y - endNode.y)) * heuristicScale;
    };

    const open: QueueEntry[] = [{ nodeId: startNode.id, g: 0, f: heuristic(startNode.id) }];
    const best = new Map<string, number>([[startNode.id, 0]]);
    const previousNode = new Map<string, string>();
    const previousEdge = new Map<string, string>();

    while (open.length > 0) {
      open.sort((a, b) => a.f - b.f || a.g - b.g || a.nodeId.localeCompare(b.nodeId));
      const current = open.shift();
      if (!current) break;
      const known = best.get(current.nodeId);
      if (known === undefined || current.g > known + 1e-9) continue;
      if (current.nodeId === endNode.id) break;

      for (const edge of graph.outgoingEdges(current.nodeId)) {
        const cost = edgeCost(edge);
        if (!Number.isFinite(cost) || cost < 0) continue;
        const nextG = current.g + cost;
        const priorG = best.get(edge.to);
        const priorEdgeId = previousEdge.get(edge.to);
        const improves = priorG === undefined || nextG < priorG - 1e-9;
        const tiesDeterministically = priorG !== undefined && Math.abs(nextG - priorG) <= 1e-9 && edge.id.localeCompare(priorEdgeId ?? '\uffff') < 0;
        if (!improves && !tiesDeterministically) continue;
        best.set(edge.to, nextG);
        previousNode.set(edge.to, current.nodeId);
        previousEdge.set(edge.to, edge.id);
        open.push({ nodeId: edge.to, g: nextG, f: nextG + heuristic(edge.to) });
      }
    }

    if (!best.has(endNode.id)) {
      if (canCache) this.cache.set(cacheKey, null);
      return null;
    }

    const nodeIds: string[] = [endNode.id];
    const edgeIds: string[] = [];
    let cursor = endNode.id;
    while (cursor !== startNode.id) {
      const prior = previousNode.get(cursor);
      const edgeId = previousEdge.get(cursor);
      if (!prior || !edgeId) {
        if (canCache) this.cache.set(cacheKey, null);
        return null;
      }
      nodeIds.push(prior);
      edgeIds.push(edgeId);
      cursor = prior;
    }
    nodeIds.reverse();
    edgeIds.reverse();
    const route: RouteResult = Object.freeze({
      nodeIds: Object.freeze(nodeIds),
      edgeIds: Object.freeze(edgeIds),
      totalCost: best.get(endNode.id) ?? 0,
    });
    if (canCache) this.cache.set(cacheKey, route);
    return route;
  }

  clearCache(): void {
    this.cache.clear();
    this.cachedRevision = -1;
  }
}
