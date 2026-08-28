import { legacyJunctionId } from './LegacyRoadNetworkAdapter.ts';
import type {
  CarriagewayId,
  JunctionId,
  LaneGroup,
  LaneGroupId,
  TransportNetworkAuthority,
  TurnMovement,
  TurnMovementId,
} from './TransportNetworkTypes.ts';

const EDGE = /^e:n:(-?\d+),(-?\d+)>n:(-?\d+),(-?\d+)$/;

type LegacyEdgeEndpoints = Readonly<{
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
}>;

export type ResolvedRouteMovement = Readonly<{
  junctionId: JunctionId;
  movementId: TurnMovementId;
  fromCarriagewayId: CarriagewayId;
  toCarriagewayId: CarriagewayId;
  laneGroupIds: readonly LaneGroupId[];
}>;

function parseLegacyEdge(edgeId: string): LegacyEdgeEndpoints | undefined {
  const match = EDGE.exec(edgeId);
  if (!match) return undefined;
  return {
    fromX: Number(match[1]),
    fromY: Number(match[2]),
    toX: Number(match[3]),
    toY: Number(match[4]),
  };
}

function pair(fromId: string, toId: string): string {
  return `${fromId}>${toId}`;
}

export class LegacyRouteMovementResolver {
  private readonly carriagewayByJunctionPair = new Map<string, CarriagewayId>();
  private readonly movementByCarriagewayPair = new Map<string, TurnMovement>();
  private readonly laneGroupIdsByMovementId = new Map<TurnMovementId, readonly LaneGroupId[]>();

  constructor(authority: TransportNetworkAuthority, laneGroups: readonly LaneGroup[]) {
    for (const carriageway of [...authority.carriageways].sort((a, b) => a.id.localeCompare(b.id))) {
      this.carriagewayByJunctionPair.set(
        pair(carriageway.fromJunctionId, carriageway.toJunctionId),
        carriageway.id,
      );
    }

    const movementById = new Map<TurnMovementId, TurnMovement>();
    for (const movement of [...authority.movements].sort((a, b) => a.id.localeCompare(b.id))) {
      if (!movement.allowed) continue;
      movementById.set(movement.id, movement);
      this.movementByCarriagewayPair.set(
        pair(movement.fromCarriagewayId, movement.toCarriagewayId),
        movement,
      );
    }

    const mutableLaneGroupsByMovement = new Map<TurnMovementId, LaneGroupId[]>();
    for (const laneGroup of [...laneGroups].sort((a, b) => a.id.localeCompare(b.id))) {
      for (const movementId of [...laneGroup.movementIds].sort((a, b) => a.localeCompare(b))) {
        const movement = movementById.get(movementId);
        if (!movement || movement.fromCarriagewayId !== laneGroup.carriagewayId) continue;
        const ids = mutableLaneGroupsByMovement.get(movementId) ?? [];
        ids.push(laneGroup.id);
        mutableLaneGroupsByMovement.set(movementId, ids);
      }
    }

    for (const [movementId, laneGroupIds] of mutableLaneGroupsByMovement) {
      this.laneGroupIdsByMovementId.set(
        movementId,
        Object.freeze([...laneGroupIds].sort((a, b) => a.localeCompare(b))),
      );
    }
  }

  resolve(currentEdgeId: string, nextEdgeId: string): ResolvedRouteMovement | undefined {
    const current = parseLegacyEdge(currentEdgeId);
    const next = parseLegacyEdge(nextEdgeId);
    if (!current || !next) return undefined;
    if (current.toX !== next.fromX || current.toY !== next.fromY) return undefined;

    const fromJunctionId = legacyJunctionId(current.fromX, current.fromY);
    const junctionId = legacyJunctionId(current.toX, current.toY);
    const toJunctionId = legacyJunctionId(next.toX, next.toY);

    const fromCarriagewayId = this.carriagewayByJunctionPair.get(pair(fromJunctionId, junctionId));
    const toCarriagewayId = this.carriagewayByJunctionPair.get(pair(junctionId, toJunctionId));
    if (!fromCarriagewayId || !toCarriagewayId) return undefined;

    const movement = this.movementByCarriagewayPair.get(pair(fromCarriagewayId, toCarriagewayId));
    if (!movement || movement.junctionId !== junctionId) return undefined;

    const laneGroupIds = this.laneGroupIdsByMovementId.get(movement.id);
    if (!laneGroupIds || laneGroupIds.length === 0) return undefined;

    return {
      junctionId,
      movementId: movement.id,
      fromCarriagewayId,
      toCarriagewayId,
      laneGroupIds,
    };
  }
}
