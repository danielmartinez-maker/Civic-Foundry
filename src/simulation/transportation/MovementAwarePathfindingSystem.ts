import { routingStateKey, type RoutingArc, type RoutingState, type RoutingTopology } from './RoutingTopology.ts';
import type {
  CarriagewayId,
  JunctionId,
  TurnMovementId,
  VehiclePermissionMask,
} from './TransportNetworkTypes.ts';

export type MovementRouteResult = Readonly<{
  junctionIds: readonly JunctionId[];
  carriagewayIds: readonly CarriagewayId[];
  movementIds: readonly TurnMovementId[];
  totalCost: number;
}>;

export type MovementRouteOptions = Readonly<{
  permissions: VehiclePermissionMask;
  costEpoch: number;
  costKey?: string;
  arcCost?: (arc: RoutingArc) => number;
}>;

export type MovementPathfindingDiagnostics = {
  requests: number;
  cacheHits: number;
  cacheMisses: number;
};

type QueueEntry = Readonly<{
  state: RoutingState;
  stateKey: string;
  g: number;
  f: number;
  incomingArcId: string;
}>;

const EPSILON = 1e-9;

function defaultArcCost(arc: RoutingArc): number {
  return arc.traversalTicks + arc.movementPenaltyTicks;
}

function hasOriginState(topology: RoutingTopology, junctionId: string): boolean {
  const key = routingStateKey({ junctionId });
  return topology.states.some((candidate) => routingStateKey(candidate) === key);
}

export class MovementAwarePathfindingSystem {
  readonly diagnostics: MovementPathfindingDiagnostics = { requests: 0, cacheHits: 0, cacheMisses: 0 };
  private readonly cache = new Map<string, MovementRouteResult | null>();
  private cachedTopologyRevision = -1;

  findRoute(
    topology: RoutingTopology,
    startJunctionId: JunctionId,
    endJunctionId: JunctionId,
    options: MovementRouteOptions,
  ): MovementRouteResult | null {
    this.diagnostics.requests++;

    if (this.cachedTopologyRevision !== topology.revision) {
      this.cache.clear();
      this.cachedTopologyRevision = topology.revision;
    }

    const canCache = options.arcCost === undefined || options.costKey !== undefined;
    const cacheKey = `${topology.revision}|${options.costEpoch}|${options.permissions}|${options.costKey ?? 'static'}|${startJunctionId}|${endJunctionId}`;
    if (canCache && this.cache.has(cacheKey)) {
      this.diagnostics.cacheHits++;
      return this.cache.get(cacheKey) ?? null;
    }
    this.diagnostics.cacheMisses++;

    if (!hasOriginState(topology, startJunctionId) || !hasOriginState(topology, endJunctionId)) {
      if (canCache) this.cache.set(cacheKey, null);
      return null;
    }

    if (startJunctionId === endJunctionId) {
      const route: MovementRouteResult = Object.freeze({
        junctionIds: Object.freeze([startJunctionId]),
        carriagewayIds: Object.freeze([]),
        movementIds: Object.freeze([]),
        totalCost: 0,
      });
      if (canCache) this.cache.set(cacheKey, route);
      return route;
    }

    const startState: RoutingState = { junctionId: startJunctionId };
    const startKey = routingStateKey(startState);
    const costOf = options.arcCost ?? defaultArcCost;
    const open: QueueEntry[] = [{ state: startState, stateKey: startKey, g: 0, f: 0, incomingArcId: '' }];
    const best = new Map<string, number>([[startKey, 0]]);
    const stateByKey = new Map<string, RoutingState>([[startKey, startState]]);
    const previousStateKey = new Map<string, string>();
    const previousArc = new Map<string, RoutingArc>();
    let goalKey: string | undefined;

    while (open.length > 0) {
      open.sort((a, b) =>
        a.f - b.f
        || a.g - b.g
        || a.stateKey.localeCompare(b.stateKey)
        || a.incomingArcId.localeCompare(b.incomingArcId));
      const current = open.shift();
      if (!current) break;
      const known = best.get(current.stateKey);
      if (known === undefined || current.g > known + EPSILON) continue;
      if (current.state.junctionId === endJunctionId) {
        goalKey = current.stateKey;
        break;
      }

      for (const arc of topology.outgoingArcs(current.state)) {
        if ((arc.permissions & options.permissions) === 0) continue;
        const cost = costOf(arc);
        if (!Number.isFinite(cost) || cost < 0) continue;

        const nextState = arc.toState;
        const nextKey = routingStateKey(nextState);
        const nextG = current.g + cost;
        const priorG = best.get(nextKey);
        const priorArcId = previousArc.get(nextKey)?.id;
        const improves = priorG === undefined || nextG < priorG - EPSILON;
        const tiesDeterministically = priorG !== undefined
          && Math.abs(nextG - priorG) <= EPSILON
          && arc.id.localeCompare(priorArcId ?? '\uffff') < 0;
        if (!improves && !tiesDeterministically) continue;

        best.set(nextKey, nextG);
        stateByKey.set(nextKey, nextState);
        previousStateKey.set(nextKey, current.stateKey);
        previousArc.set(nextKey, arc);
        open.push({
          state: nextState,
          stateKey: nextKey,
          g: nextG,
          f: nextG,
          incomingArcId: arc.id,
        });
      }
    }

    if (!goalKey) {
      if (canCache) this.cache.set(cacheKey, null);
      return null;
    }

    const junctionIds: JunctionId[] = [];
    const carriagewayIds: CarriagewayId[] = [];
    const movementIds: TurnMovementId[] = [];
    let cursor = goalKey;

    while (cursor !== startKey) {
      const currentState = stateByKey.get(cursor);
      const prior = previousStateKey.get(cursor);
      const arc = previousArc.get(cursor);
      if (!currentState || !prior || !arc) {
        if (canCache) this.cache.set(cacheKey, null);
        return null;
      }
      junctionIds.push(currentState.junctionId);
      carriagewayIds.push(arc.carriagewayId);
      if (arc.movementId) movementIds.push(arc.movementId);
      cursor = prior;
    }

    junctionIds.push(startJunctionId);
    junctionIds.reverse();
    carriagewayIds.reverse();
    movementIds.reverse();

    const route: MovementRouteResult = Object.freeze({
      junctionIds: Object.freeze(junctionIds),
      carriagewayIds: Object.freeze(carriagewayIds),
      movementIds: Object.freeze(movementIds),
      totalCost: best.get(goalKey) ?? 0,
    });
    if (canCache) this.cache.set(cacheKey, route);
    return route;
  }

  clearCache(): void {
    this.cache.clear();
    this.cachedTopologyRevision = -1;
  }
}
