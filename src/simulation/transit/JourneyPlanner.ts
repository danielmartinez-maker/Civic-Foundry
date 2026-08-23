import type { MultimodalEdge, MultimodalEdgeKind, MultimodalRoutingGraph } from './MultimodalRoutingGraph.ts';
import type { TransitMode } from '../../data/transit.ts';

export type JourneyMode = 'car' | 'transit';
export type JourneyPlannerOptions = Readonly<{ mode: JourneyMode; transferPenaltyTicks?: number; fareWeightTicksPerCurrency?: number; parkingImpedanceTicks?: number; costKey?: string }>;
export type JourneyLeg = Readonly<{ edgeId: string; kind: MultimodalEdgeKind; from: string; to: string; ticks: number; lineId?: string; mode?: TransitMode; fare?: number }>;
export type JourneyPlan = Readonly<{ mode: JourneyMode; nodeIds: readonly string[]; legs: readonly JourneyLeg[]; totalGeneralizedCost: number; walkingTicks: number; expectedWaitTicks: number; inVehicleTicks: number; transferPenaltyTicks: number; fare: number; boardings: number; transfers: number }>;
export type JourneyPlannerDiagnostics = { requests: number; cacheHits: number; cacheMisses: number };
type State = Readonly<{ nodeId: string; boardings: number }>;
type QueueEntry = Readonly<State & { cost: number }>;
type Prior = Readonly<{ stateKey: string; edge: MultimodalEdge }>;
const stateKey = (nodeId: string, boardings: number): string => `${nodeId}|${boardings}`;

export class JourneyPlanner {
  readonly diagnostics: JourneyPlannerDiagnostics = { requests: 0, cacheHits: 0, cacheMisses: 0 };
  private readonly cache = new Map<string, JourneyPlan | null>();
  private cachedRevision = -1;

  plan(graph: MultimodalRoutingGraph, startNodeId: string, endNodeId: string, options: JourneyPlannerOptions): JourneyPlan | null {
    this.diagnostics.requests++;
    if (this.cachedRevision !== graph.revision) { this.cache.clear(); this.cachedRevision = graph.revision; }
    if (!graph.hasNode(startNodeId) || !graph.hasNode(endNodeId)) { this.diagnostics.cacheMisses++; return null; }
    const transferPenalty = Math.max(0, options.transferPenaltyTicks ?? 20);
    const fareWeight = Math.max(0, options.fareWeightTicksPerCurrency ?? 4);
    const parking = Math.max(0, options.parkingImpedanceTicks ?? 0);
    const cacheKey = `${graph.revision}|${options.costKey ?? ''}|${options.mode}|${transferPenalty}|${fareWeight}|${parking}|${startNodeId}|${endNodeId}`;
    if (this.cache.has(cacheKey)) { this.diagnostics.cacheHits++; return this.cache.get(cacheKey) ?? null; }
    this.diagnostics.cacheMisses++;

    const startKey = stateKey(startNodeId, 0);
    const best = new Map<string, number>([[startKey, 0]]);
    const states = new Map<string, State>([[startKey, { nodeId: startNodeId, boardings: 0 }]]);
    const previous = new Map<string, Prior>();
    const open: QueueEntry[] = [{ nodeId: startNodeId, boardings: 0, cost: 0 }];
    let finalKey: string | null = null;
    let finalCost = Number.POSITIVE_INFINITY;

    while (open.length > 0) {
      open.sort((a, b) => a.cost - b.cost || a.nodeId.localeCompare(b.nodeId) || a.boardings - b.boardings);
      const current = open.shift();
      if (!current) break;
      const currentKey = stateKey(current.nodeId, current.boardings);
      const known = best.get(currentKey);
      if (known === undefined || current.cost > known + 1e-9) continue;
      if (current.nodeId === endNodeId) {
        const cost = current.cost + (options.mode === 'car' ? parking : 0);
        if (cost < finalCost - 1e-9 || (Math.abs(cost - finalCost) <= 1e-9 && currentKey.localeCompare(finalKey ?? '\uffff') < 0)) { finalCost = cost; finalKey = currentKey; }
        continue;
      }
      if (current.cost >= finalCost) continue;
      for (const edge of graph.outgoingEdges(current.nodeId)) {
        if (!this.edgeAllowed(edge, options.mode)) continue;
        const nextBoardings = current.boardings + (edge.kind === 'board' ? 1 : 0);
        if (nextBoardings > 6) continue;
        let edgeCost = edge.ticks;
        if (edge.kind === 'board') { edgeCost += Math.max(0, edge.fare ?? 0) * fareWeight; if (current.boardings > 0) edgeCost += transferPenalty; }
        if (!Number.isFinite(edgeCost) || edgeCost < 0) continue;
        const nextCost = current.cost + edgeCost;
        const nextKey = stateKey(edge.to, nextBoardings);
        const priorCost = best.get(nextKey);
        const prior = previous.get(nextKey);
        const shouldReplace = priorCost === undefined || nextCost < priorCost - 1e-9 || (Math.abs(nextCost - priorCost) <= 1e-9 && edge.id.localeCompare(prior?.edge.id ?? '\uffff') < 0);
        if (!shouldReplace) continue;
        best.set(nextKey, nextCost);
        states.set(nextKey, { nodeId: edge.to, boardings: nextBoardings });
        previous.set(nextKey, { stateKey: currentKey, edge });
        open.push({ nodeId: edge.to, boardings: nextBoardings, cost: nextCost });
      }
    }
    if (!finalKey || !Number.isFinite(finalCost)) { this.cache.set(cacheKey, null); return null; }
    const reversedEdges: MultimodalEdge[] = [];
    const reversedNodes: string[] = [];
    let cursor = finalKey;
    const finalState = states.get(cursor);
    if (!finalState) return null;
    reversedNodes.push(finalState.nodeId);
    while (cursor !== startKey) {
      const prior = previous.get(cursor);
      if (!prior) { this.cache.set(cacheKey, null); return null; }
      reversedEdges.push(prior.edge); cursor = prior.stateKey;
      const state = states.get(cursor); if (state) reversedNodes.push(state.nodeId);
    }
    const pathEdges = reversedEdges.reverse();
    const nodeIds = reversedNodes.reverse();
    const boardings = pathEdges.filter((edge) => edge.kind === 'board').length;
    const transfers = Math.max(0, boardings - 1);
    const plan: JourneyPlan = Object.freeze({
      mode: options.mode,
      nodeIds: Object.freeze(nodeIds),
      legs: Object.freeze(pathEdges.map((edge) => Object.freeze({ edgeId: edge.id, kind: edge.kind, from: edge.from, to: edge.to, ticks: edge.ticks, ...(edge.lineId ? { lineId: edge.lineId } : {}), ...(edge.mode ? { mode: edge.mode } : {}), ...(edge.fare !== undefined ? { fare: edge.fare } : {}) }))),
      totalGeneralizedCost: finalCost,
      walkingTicks: pathEdges.filter((edge) => edge.kind === 'walk').reduce((sum, edge) => sum + edge.ticks, 0),
      expectedWaitTicks: pathEdges.filter((edge) => edge.kind === 'board').reduce((sum, edge) => sum + (edge.waitTicks ?? edge.ticks), 0),
      inVehicleTicks: pathEdges.filter((edge) => edge.kind === 'ride' || edge.kind === 'car').reduce((sum, edge) => sum + edge.ticks, 0),
      transferPenaltyTicks: transfers * transferPenalty,
      fare: pathEdges.filter((edge) => edge.kind === 'board').reduce((sum, edge) => sum + Math.max(0, edge.fare ?? 0), 0),
      boardings, transfers,
    });
    this.cache.set(cacheKey, plan);
    return plan;
  }

  clearCache(): void { this.cache.clear(); this.cachedRevision = -1; }
  private edgeAllowed(edge: MultimodalEdge, mode: JourneyMode): boolean { return mode === 'car' ? edge.kind === 'car' : edge.kind !== 'car'; }
}
