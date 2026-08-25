import { movementEffectivePermissions } from './TurnMovementBuilder.ts';
import type {
  Carriageway,
  CarriagewayId,
  JunctionId,
  LaneGroup,
  LaneGroupId,
  TransportNetworkSnapshot,
  TurnMovement,
  TurnMovementId,
  VehiclePermissionMask,
} from './TransportNetworkTypes.ts';

export type RoutingState = Readonly<{
  junctionId: JunctionId;
  incomingCarriagewayId?: CarriagewayId;
}>;

export type RoutingArc = Readonly<{
  id: string;
  fromStateKey: string;
  toState: RoutingState;
  carriagewayId: CarriagewayId;
  laneGroupIds: readonly LaneGroupId[];
  movementId?: TurnMovementId;
  permissions: VehiclePermissionMask;
  traversalTicks: number;
  movementPenaltyTicks: number;
}>;

export type RoutingTopology = Readonly<{
  revision: number;
  states: readonly RoutingState[];
  arcs: readonly RoutingArc[];
  outgoingArcs(state: RoutingState): readonly RoutingArc[];
}>;

const SIMULATION_TICKS_PER_SECOND = 10;

export function routingStateKey(state: RoutingState): string {
  return `${state.junctionId}|${state.incomingCarriagewayId ?? '-'}`;
}

function compareStrings(a: string, b: string): number {
  return a.localeCompare(b);
}

function permissionUnion(groups: readonly LaneGroup[]): VehiclePermissionMask {
  return groups.reduce((mask, group) => mask | group.permissions, 0);
}

function laneGroupsForMovement(
  groups: readonly LaneGroup[],
  movement: TurnMovement,
): readonly LaneGroup[] {
  const allowedLaneIds = new Set(movement.toLaneIds);
  return groups.filter((group) => group.laneIds.some((laneId) => allowedLaneIds.has(laneId)));
}

function traversalTicks(
  snapshot: TransportNetworkSnapshot,
  carriageway: Carriageway,
  groups: readonly LaneGroup[],
): number {
  const segment = snapshot.segments.find((candidate) => candidate.id === carriageway.segmentId);
  if (!segment) throw new Error(`Carriageway ${carriageway.id} references missing segment ${carriageway.segmentId}`);
  if (groups.length === 0) throw new Error(`Carriageway ${carriageway.id} has no routable lane groups`);

  const speedKph = Math.min(...groups.map((group) => group.freeFlowSpeedKph));
  if (!Number.isFinite(speedKph) || speedKph <= 0) {
    throw new Error(`Carriageway ${carriageway.id} has invalid routing speed ${speedKph}`);
  }
  if (!Number.isFinite(segment.lengthMeters) || segment.lengthMeters <= 0) {
    throw new Error(`Segment ${segment.id} has invalid routing length ${segment.lengthMeters}`);
  }

  const metersPerSecond = speedKph / 3.6;
  return (segment.lengthMeters / metersPerSecond) * SIMULATION_TICKS_PER_SECOND;
}

function arcId(
  fromStateKey: string,
  carriagewayId: string,
  movementId?: string,
): string {
  return `ra:${fromStateKey}>${movementId ?? 'origin'}>${carriagewayId}`;
}

export function buildRoutingTopology(
  snapshot: TransportNetworkSnapshot,
  laneGroups: readonly LaneGroup[],
): RoutingTopology {
  const carriagewayById = new Map(snapshot.carriageways.map((carriageway) => [carriageway.id, carriageway]));
  const groupsByCarriageway = new Map<string, LaneGroup[]>();
  for (const group of [...laneGroups].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!carriagewayById.has(group.carriagewayId)) {
      throw new Error(`Lane group ${group.id} references missing carriageway ${group.carriagewayId}`);
    }
    const groups = groupsByCarriageway.get(group.carriagewayId) ?? [];
    groups.push(group);
    groupsByCarriageway.set(group.carriagewayId, groups);
  }

  const outgoingByJunction = new Map<string, Carriageway[]>();
  const incomingByJunction = new Map<string, Carriageway[]>();
  for (const carriageway of [...snapshot.carriageways].sort((a, b) => a.id.localeCompare(b.id))) {
    const outgoing = outgoingByJunction.get(carriageway.fromJunctionId) ?? [];
    outgoing.push(carriageway);
    outgoingByJunction.set(carriageway.fromJunctionId, outgoing);

    const incoming = incomingByJunction.get(carriageway.toJunctionId) ?? [];
    incoming.push(carriageway);
    incomingByJunction.set(carriageway.toJunctionId, incoming);
  }

  const movementsByEnteredState = new Map<string, TurnMovement[]>();
  for (const movement of [...snapshot.movements].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!movement.allowed) continue;
    const key = routingStateKey({
      junctionId: movement.junctionId,
      incomingCarriagewayId: movement.fromCarriagewayId,
    });
    const movements = movementsByEnteredState.get(key) ?? [];
    movements.push(movement);
    movementsByEnteredState.set(key, movements);
  }

  const states: RoutingState[] = [];
  const arcs: RoutingArc[] = [];
  const outgoingByStateKey = new Map<string, RoutingArc[]>();

  const addArc = (state: RoutingState, arc: RoutingArc): void => {
    arcs.push(arc);
    const key = routingStateKey(state);
    const outgoing = outgoingByStateKey.get(key) ?? [];
    outgoing.push(arc);
    outgoingByStateKey.set(key, outgoing);
  };

  for (const junction of [...snapshot.junctions].sort((a, b) => a.id.localeCompare(b.id))) {
    const originState: RoutingState = { junctionId: junction.id };
    states.push(originState);
    const originKey = routingStateKey(originState);

    for (const carriageway of outgoingByJunction.get(junction.id) ?? []) {
      const groups = groupsByCarriageway.get(carriageway.id) ?? [];
      const permissions = permissionUnion(groups);
      if (groups.length === 0 || permissions === 0) continue;
      const laneGroupIds = groups.map((group) => group.id).sort(compareStrings);
      addArc(originState, {
        id: arcId(originKey, carriageway.id),
        fromStateKey: originKey,
        toState: {
          junctionId: carriageway.toJunctionId,
          incomingCarriagewayId: carriageway.id,
        },
        carriagewayId: carriageway.id,
        laneGroupIds,
        permissions,
        traversalTicks: traversalTicks(snapshot, carriageway, groups),
        movementPenaltyTicks: 0,
      });
    }

    for (const incoming of incomingByJunction.get(junction.id) ?? []) {
      const enteredState: RoutingState = {
        junctionId: junction.id,
        incomingCarriagewayId: incoming.id,
      };
      states.push(enteredState);
      const enteredKey = routingStateKey(enteredState);
      const movements = movementsByEnteredState.get(enteredKey) ?? [];

      for (const movement of movements) {
        const outgoing = carriagewayById.get(movement.toCarriagewayId);
        if (!outgoing) throw new Error(`Movement ${movement.id} references missing outgoing carriageway ${movement.toCarriagewayId}`);
        if (outgoing.fromJunctionId !== junction.id) {
          throw new Error(`Movement ${movement.id} exits from ${outgoing.fromJunctionId}, not ${junction.id}`);
        }

        const groups = laneGroupsForMovement(groupsByCarriageway.get(outgoing.id) ?? [], movement);
        if (groups.length === 0) continue;
        const permissions = movementEffectivePermissions(snapshot, movement) & permissionUnion(groups);
        if (permissions === 0) continue;
        const laneGroupIds = groups.map((group) => group.id).sort(compareStrings);

        addArc(enteredState, {
          id: arcId(enteredKey, outgoing.id, movement.id),
          fromStateKey: enteredKey,
          toState: {
            junctionId: outgoing.toJunctionId,
            incomingCarriagewayId: outgoing.id,
          },
          carriagewayId: outgoing.id,
          laneGroupIds,
          movementId: movement.id,
          permissions,
          traversalTicks: traversalTicks(snapshot, outgoing, groups),
          movementPenaltyTicks: movement.basePenaltyTicks,
        });
      }
    }
  }

  states.sort((a, b) => routingStateKey(a).localeCompare(routingStateKey(b)));
  arcs.sort((a, b) => a.id.localeCompare(b.id));
  for (const outgoing of outgoingByStateKey.values()) outgoing.sort((a, b) => a.id.localeCompare(b.id));

  return {
    revision: snapshot.topologyRevision,
    states,
    arcs,
    outgoingArcs(state: RoutingState): readonly RoutingArc[] {
      return outgoingByStateKey.get(routingStateKey(state)) ?? [];
    },
  };
}
