import type { TransportationEdge, TransportationGraph } from './TransportationGraph.ts';

export type RouteResult = Readonly<{
  nodeIds: readonly string[];
  edgeIds: readonly string[];
  totalCost: number;
}>;

export type RouteOptions = Readonly<{
  edgeCost?: (edge: TransportationEdge) => number;
  costKey?: string;
}>;

export type PathfindingDiagnostics = {
  requests: number;
  cacheHits: number;
  cacheMisses: number;
};

type QueueEntry = Readonly<{ nodeId: string; cost: number }>;

export class PathfindingSystem {
  readonly diagnostics: PathfindingDiagnostics = { requests: 0, cacheHits: 0, cacheMisses: 0 };
  private readonly cache = new Map<string, RouteResult | null>();
  private cachedGraphRevision = -1;

  findRoute(graph: TransportationGraph, startNodeId: string, endNodeId: string, options: RouteOptions = {}): RouteResult | null {
    this.diagnostics.requests++;
    if (this.cachedGraphRevision !== graph.revision) {
      this.cache.clear();
      this.cachedGraphRevision = graph.revision;
    }

    if (!graph.getNode(startNodeId) || !graph.getNode(endNodeId)) {
      this.diagnostics.cacheMisses++;
      return null;
    }
    if (startNodeId === endNodeId) {
      return { nodeIds: [startNodeId], edgeIds: [], totalCost: 0 };
    }

    const canCache = options.edgeCost === undefined || options.costKey !== undefined;
    const costKey = options.costKey ?? 'free-flow';
    const cacheKey = `${graph.revision}|${costKey}|${startNodeId}|${endNodeId}`;
    if (canCache && this.cache.has(cacheKey)) {
      this.diagnostics.cacheHits++;
      return this.cache.get(cacheKey) ?? null;
    }
    this.diagnostics.cacheMisses++;

    const edgeCost = options.edgeCost ?? ((edge: TransportationEdge) => edge.freeFlowTicks);
    const best = new Map<string, number>([[startNodeId, 0]]);
    const previous = new Map<string, { nodeId: string; edgeId: string }>();
    const open: QueueEntry[] = [{ nodeId: startNodeId, cost: 0 }];

    while (open.length > 0) {
      open.sort((a, b) => a.cost - b.cost || a.nodeId.localeCompare(b.nodeId));
      const current = open.shift();
      if (!current) break;
      const known = best.get(current.nodeId);
      if (known === undefined || current.cost > known + 1e-9) continue;
      if (current.nodeId === endNodeId) break;

      const outgoing = [...graph.outgoingEdges(current.nodeId)].sort((a, b) => a.id.localeCompare(b.id));
      for (const edge of outgoing) {
        const rawCost = edgeCost(edge);
        if (!Number.isFinite(rawCost) || rawCost < 0) continue;
        const nextCost = current.cost + rawCost;
        const priorCost = best.get(edge.to);
        const priorStep = previous.get(edge.to);
        const shouldReplace = priorCost === undefined
          || nextCost < priorCost - 1e-9
          || (Math.abs(nextCost - priorCost) <= 1e-9 && edge.id.localeCompare(priorStep?.edgeId ?? '\uffff') < 0);
        if (!shouldReplace) continue;
        best.set(edge.to, nextCost);
        previous.set(edge.to, { nodeId: current.nodeId, edgeId: edge.id });
        open.push({ nodeId: edge.to, cost: nextCost });
      }
    }

    const totalCost = best.get(endNodeId);
    if (totalCost === undefined) {
      if (canCache) this.cache.set(cacheKey, null);
      return null;
    }

    const nodeIds: string[] = [endNodeId];
    const edgeIds: string[] = [];
    let cursor = endNodeId;
    while (cursor !== startNodeId) {
      const step = previous.get(cursor);
      if (!step) {
        if (canCache) this.cache.set(cacheKey, null);
        return null;
      }
      edgeIds.push(step.edgeId);
      cursor = step.nodeId;
      nodeIds.push(cursor);
    }
    nodeIds.reverse();
    edgeIds.reverse();
    const route: RouteResult = Object.freeze({
      nodeIds: Object.freeze(nodeIds),
      edgeIds: Object.freeze(edgeIds),
      totalCost,
    });
    if (canCache) this.cache.set(cacheKey, route);
    return route;
  }

  clearCache(): void {
    this.cache.clear();
    this.cachedGraphRevision = -1;
  }
}
