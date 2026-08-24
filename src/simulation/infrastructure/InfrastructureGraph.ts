export type InfrastructureGraphNode = Readonly<{ id: string }>;

export type InfrastructureGraphEdge = Readonly<{
  id: string;
  from: string;
  to: string;
  capacity: number;
  operational?: boolean;
}>;

export type InfrastructureFlowResult = Readonly<{
  totalFlow: number;
  edgeFlow: Readonly<Record<string, number>>;
  edgeUtilization: Readonly<Record<string, number>>;
  residualCapacity: Readonly<Record<string, number>>;
}>;

type ResidualArc = Readonly<{
  edgeId: string;
  from: string;
  to: string;
  direction: 1 | -1;
}>;

export class InfrastructureGraph {
  private readonly nodes: readonly InfrastructureGraphNode[];
  private readonly edges: readonly InfrastructureGraphEdge[];
  private readonly nodeIds: ReadonlySet<string>;
  private readonly outgoing: ReadonlyMap<string, readonly InfrastructureGraphEdge[]>;

  constructor(nodes: readonly InfrastructureGraphNode[], edges: readonly InfrastructureGraphEdge[]) {
    const sortedNodes = [...nodes].sort((a, b) => a.id.localeCompare(b.id));
    const sortedEdges = [...edges].sort((a, b) => a.id.localeCompare(b.id));

    const nodeIds = new Set<string>();
    for (const node of sortedNodes) {
      if (!node.id) throw new Error('node id must be non-empty');
      if (nodeIds.has(node.id)) throw new Error(`duplicate node id: ${node.id}`);
      nodeIds.add(node.id);
    }

    const edgeIds = new Set<string>();
    for (const edge of sortedEdges) {
      if (!edge.id) throw new Error('edge id must be non-empty');
      if (edgeIds.has(edge.id)) throw new Error(`duplicate edge id: ${edge.id}`);
      edgeIds.add(edge.id);
      if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) throw new Error(`unknown edge endpoint: ${edge.id}`);
      if (!Number.isFinite(edge.capacity) || edge.capacity < 0) throw new Error(`edge capacity must be finite and non-negative: ${edge.id}`);
    }

    const outgoing = new Map<string, InfrastructureGraphEdge[]>();
    for (const edge of sortedEdges) {
      const list = outgoing.get(edge.from) ?? [];
      list.push(edge);
      outgoing.set(edge.from, list);
    }

    this.nodes = Object.freeze(sortedNodes.map((node) => Object.freeze({ ...node })));
    this.edges = Object.freeze(sortedEdges.map((edge) => Object.freeze({ ...edge })));
    this.nodeIds = nodeIds;
    this.outgoing = new Map([...outgoing.entries()].map(([id, list]) => [id, Object.freeze([...list])])) as ReadonlyMap<string, readonly InfrastructureGraphEdge[]>;
  }

  outgoingEdges(nodeId: string): readonly InfrastructureGraphEdge[] {
    return this.outgoing.get(nodeId) ?? [];
  }

  solveMaxFlow(sourceId: string, sinkId: string): InfrastructureFlowResult {
    if (!this.nodeIds.has(sourceId)) throw new Error(`unknown source node: ${sourceId}`);
    if (!this.nodeIds.has(sinkId)) throw new Error(`unknown sink node: ${sinkId}`);

    const flow = new Map<string, number>(this.edges.map((edge) => [edge.id, 0]));
    const edgeById = new Map(this.edges.map((edge) => [edge.id, edge] as const));

    if (sourceId !== sinkId) {
      const residualAdjacency = new Map<string, ResidualArc[]>();
      for (const edge of this.edges) {
        if (edge.operational === false || edge.capacity <= 0) continue;
        const forward: ResidualArc = { edgeId: edge.id, from: edge.from, to: edge.to, direction: 1 };
        const reverse: ResidualArc = { edgeId: edge.id, from: edge.to, to: edge.from, direction: -1 };
        const forwardList = residualAdjacency.get(forward.from) ?? [];
        forwardList.push(forward);
        residualAdjacency.set(forward.from, forwardList);
        const reverseList = residualAdjacency.get(reverse.from) ?? [];
        reverseList.push(reverse);
        residualAdjacency.set(reverse.from, reverseList);
      }
      for (const list of residualAdjacency.values()) {
        list.sort((a, b) => a.edgeId.localeCompare(b.edgeId) || b.direction - a.direction || a.to.localeCompare(b.to));
      }

      while (true) {
        const parent = new Map<string, ResidualArc>();
        const visited = new Set<string>([sourceId]);
        const queue: string[] = [sourceId];

        for (let i = 0; i < queue.length && !visited.has(sinkId); i++) {
          const node = queue[i];
          if (node === undefined) continue;
          for (const arc of residualAdjacency.get(node) ?? []) {
            if (visited.has(arc.to)) continue;
            const edge = edgeById.get(arc.edgeId);
            if (!edge) continue;
            const currentFlow = flow.get(edge.id) ?? 0;
            const residual = arc.direction === 1 ? edge.capacity - currentFlow : currentFlow;
            if (residual <= 1e-12) continue;
            visited.add(arc.to);
            parent.set(arc.to, arc);
            queue.push(arc.to);
            if (arc.to === sinkId) break;
          }
        }

        if (!visited.has(sinkId)) break;

        let bottleneck = Number.POSITIVE_INFINITY;
        let cursor = sinkId;
        const path: ResidualArc[] = [];
        while (cursor !== sourceId) {
          const arc = parent.get(cursor);
          if (!arc) throw new Error('residual path reconstruction failed');
          const edge = edgeById.get(arc.edgeId);
          if (!edge) throw new Error('residual edge missing');
          const currentFlow = flow.get(edge.id) ?? 0;
          const residual = arc.direction === 1 ? edge.capacity - currentFlow : currentFlow;
          bottleneck = Math.min(bottleneck, residual);
          path.push(arc);
          cursor = arc.from;
        }

        if (!Number.isFinite(bottleneck) || bottleneck <= 1e-12) break;
        for (const arc of path) {
          flow.set(arc.edgeId, (flow.get(arc.edgeId) ?? 0) + arc.direction * bottleneck);
        }
      }
    }

    const edgeFlow: Record<string, number> = {};
    const edgeUtilization: Record<string, number> = {};
    const residualCapacity: Record<string, number> = {};
    for (const edge of this.edges) {
      const realized = edge.operational === false ? 0 : Math.max(0, flow.get(edge.id) ?? 0);
      edgeFlow[edge.id] = realized;
      edgeUtilization[edge.id] = edge.capacity <= 0 || edge.operational === false ? 0 : realized / edge.capacity;
      residualCapacity[edge.id] = edge.operational === false ? 0 : Math.max(0, edge.capacity - realized);
    }

    const totalFlow = this.edges
      .filter((edge) => edge.from === sourceId)
      .reduce((sum, edge) => sum + edgeFlow[edge.id]!, 0)
      - this.edges
        .filter((edge) => edge.to === sourceId)
        .reduce((sum, edge) => sum + edgeFlow[edge.id]!, 0);

    return Object.freeze({
      totalFlow: Math.max(0, totalFlow),
      edgeFlow: Object.freeze(edgeFlow),
      edgeUtilization: Object.freeze(edgeUtilization),
      residualCapacity: Object.freeze(residualCapacity),
    });
  }
}
