import {
  ALL_VEHICLE_PERMISSIONS,
  intersectPermissions,
  type Carriageway,
  type Junction,
  type Lane,
  type TransportNetworkAuthority,
  type TransportPhysicalNetwork,
  type TurnKind,
  type TurnMovement,
  type VehiclePermissionMask,
} from './TransportNetworkTypes.ts';

function isTravelLane(lane: Lane): boolean {
  return lane.operatingState === 'open' && lane.kind !== 'parking' && lane.kind !== 'shoulder';
}

function lanePermissionUnion(lanes: readonly Lane[]): VehiclePermissionMask {
  return lanes.reduce((mask, lane) => mask | lane.permissions, 0);
}

function movementId(junctionId: string, fromCarriagewayId: string, toCarriagewayId: string): string {
  return `m:${junctionId}:${fromCarriagewayId}>${toCarriagewayId}`;
}

function normalizedHeading(from: Junction, to: Junction): Readonly<{ x: number; y: number }> {
  const dx = Math.sign(to.x - from.x);
  const dy = Math.sign(to.y - from.y);
  if ((dx === 0 && dy === 0) || (dx !== 0 && dy !== 0)) {
    throw new Error(`Movement geometry must be cardinal: ${from.id} -> ${to.id}`);
  }
  return { x: dx, y: dy };
}

export function classifyTurn(
  incomingFrom: Junction,
  junction: Junction,
  outgoingTo: Junction,
): TurnKind {
  const incoming = normalizedHeading(incomingFrom, junction);
  const outgoing = normalizedHeading(junction, outgoingTo);
  const dot = incoming.x * outgoing.x + incoming.y * outgoing.y;
  const cross = incoming.x * outgoing.y - incoming.y * outgoing.x;

  if (dot === 1) return 'through';
  if (dot === -1) return 'u-turn';
  if (cross === 1) return 'right';
  if (cross === -1) return 'left';
  throw new Error(`Unable to classify turn at ${junction.id}`);
}

function turnPenalty(turnKind: TurnKind): number {
  switch (turnKind) {
    case 'through': return 0;
    case 'right': return 1;
    case 'left': return 2;
    case 'u-turn': return 4;
  }
}

export function buildTurnMovements(physical: TransportPhysicalNetwork): readonly TurnMovement[] {
  const junctionById = new Map(physical.junctions.map((junction) => [junction.id, junction]));
  const laneById = new Map(physical.lanes.map((lane) => [lane.id, lane]));
  const carriageways = [...physical.carriageways].sort((a, b) => a.id.localeCompare(b.id));
  const incomingByJunction = new Map<string, Carriageway[]>();
  const outgoingByJunction = new Map<string, Carriageway[]>();

  for (const carriageway of carriageways) {
    const incoming = incomingByJunction.get(carriageway.toJunctionId) ?? [];
    incoming.push(carriageway);
    incomingByJunction.set(carriageway.toJunctionId, incoming);
    const outgoing = outgoingByJunction.get(carriageway.fromJunctionId) ?? [];
    outgoing.push(carriageway);
    outgoingByJunction.set(carriageway.fromJunctionId, outgoing);
  }

  const movements: TurnMovement[] = [];
  for (const junction of [...physical.junctions].sort((a, b) => a.id.localeCompare(b.id))) {
    const incoming = incomingByJunction.get(junction.id) ?? [];
    const outgoing = outgoingByJunction.get(junction.id) ?? [];
    for (const from of incoming) {
      const incomingFrom = junctionById.get(from.fromJunctionId);
      if (!incomingFrom) throw new Error(`Missing incoming endpoint ${from.fromJunctionId}`);
      const fromLanes = from.laneIds
        .map((laneId) => laneById.get(laneId))
        .filter((lane): lane is Lane => lane !== undefined && isTravelLane(lane))
        .sort((a, b) => a.ordinal - b.ordinal || a.id.localeCompare(b.id));
      if (fromLanes.length === 0) continue;

      for (const to of outgoing) {
        const outgoingTo = junctionById.get(to.toJunctionId);
        if (!outgoingTo) throw new Error(`Missing outgoing endpoint ${to.toJunctionId}`);
        const turnKind = classifyTurn(incomingFrom, junction, outgoingTo);
        if (turnKind === 'u-turn') continue;

        const toLanes = to.laneIds
          .map((laneId) => laneById.get(laneId))
          .filter((lane): lane is Lane => lane !== undefined && isTravelLane(lane))
          .sort((a, b) => a.ordinal - b.ordinal || a.id.localeCompare(b.id));
        if (toLanes.length === 0) continue;

        movements.push({
          id: movementId(junction.id, from.id, to.id),
          junctionId: junction.id,
          fromCarriagewayId: from.id,
          toCarriagewayId: to.id,
          fromLaneIds: fromLanes.map((lane) => lane.id),
          toLaneIds: toLanes.map((lane) => lane.id),
          turnKind,
          permissions: ALL_VEHICLE_PERMISSIONS,
          allowed: true,
          basePenaltyTicks: turnPenalty(turnKind),
        });
      }
    }
  }

  return movements.sort((a, b) => a.id.localeCompare(b.id));
}

export function movementEffectivePermissionsFromLaneIndex(
  laneById: ReadonlyMap<string, Lane>,
  movement: TurnMovement,
): VehiclePermissionMask {
  if (!movement.allowed) return 0;
  const incoming = movement.fromLaneIds
    .map((laneId) => laneById.get(laneId))
    .filter((lane): lane is Lane => lane !== undefined && isTravelLane(lane));
  const outgoing = movement.toLaneIds
    .map((laneId) => laneById.get(laneId))
    .filter((lane): lane is Lane => lane !== undefined && isTravelLane(lane));
  return intersectPermissions(
    lanePermissionUnion(incoming),
    movement.permissions,
    lanePermissionUnion(outgoing),
  );
}

export function movementEffectivePermissions(
  authority: TransportNetworkAuthority,
  movement: TurnMovement,
): VehiclePermissionMask {
  const laneById = new Map(authority.lanes.map((lane) => [lane.id, lane]));
  return movementEffectivePermissionsFromLaneIndex(laneById, movement);
}
