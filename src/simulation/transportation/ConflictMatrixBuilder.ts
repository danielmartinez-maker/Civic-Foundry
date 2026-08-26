import type {
  PedestrianCrossing,
  PedestrianCrossingId,
} from './IntersectionControlTypes.ts';
import type {
  Carriageway,
  Junction,
  JunctionId,
  TransportNetworkAuthority,
  TurnMovement,
  TurnMovementId,
} from './TransportNetworkTypes.ts';

export type ConflictParticipantId = TurnMovementId | PedestrianCrossingId;

export type JunctionConflictMatrix = Readonly<{
  junctionId: JunctionId;
  participants: readonly ConflictParticipantId[];
  conflicts(a: ConflictParticipantId, b: ConflictParticipantId): boolean;
}>;

type CardinalHeading = 'north' | 'east' | 'south' | 'west';

function pairKey(a: string, b: string): string {
  return a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
}

function headingFrom(junction: Junction, other: Junction): CardinalHeading | undefined {
  const dx = other.x - junction.x;
  const dy = other.y - junction.y;
  if (dx === 0 && dy < 0) return 'north';
  if (dx > 0 && dy === 0) return 'east';
  if (dx === 0 && dy > 0) return 'south';
  if (dx < 0 && dy === 0) return 'west';
  return undefined;
}

function opposite(a: CardinalHeading, b: CardinalHeading): boolean {
  return (a === 'north' && b === 'south')
    || (a === 'south' && b === 'north')
    || (a === 'east' && b === 'west')
    || (a === 'west' && b === 'east');
}

function sharesIncomingLane(a: TurnMovement, b: TurnMovement): boolean {
  const bLanes = new Set(b.fromLaneIds);
  return a.fromLaneIds.some((laneId) => bLanes.has(laneId));
}

function approachHeading(
  movement: TurnMovement,
  junction: Junction,
  carriagewayById: ReadonlyMap<string, Carriageway>,
  junctionById: ReadonlyMap<string, Junction>,
): CardinalHeading | undefined {
  const carriageway = carriagewayById.get(movement.fromCarriagewayId);
  if (!carriageway || carriageway.toJunctionId !== junction.id) return undefined;
  const origin = junctionById.get(carriageway.fromJunctionId);
  return origin ? headingFrom(junction, origin) : undefined;
}

function vehicleMovementsConflict(
  a: TurnMovement,
  b: TurnMovement,
  junction: Junction,
  carriagewayById: ReadonlyMap<string, Carriageway>,
  junctionById: ReadonlyMap<string, Junction>,
): boolean {
  if (a.id === b.id) return false;

  // Two movements cannot consume the same constrained departure at once.
  if (a.toCarriagewayId === b.toCarriagewayId) return true;
  if (sharesIncomingLane(a, b)) return true;

  const aApproach = approachHeading(a, junction, carriagewayById, junctionById);
  const bApproach = approachHeading(b, junction, carriagewayById, junctionById);
  if (!aApproach || !bApproach) return true;

  if (a.turnKind === 'through' && b.turnKind === 'through') {
    return !opposite(aApproach, bApproach);
  }

  if (a.turnKind === 'left' && b.turnKind === 'through' && opposite(aApproach, bApproach)) {
    return true;
  }
  if (b.turnKind === 'left' && a.turnKind === 'through' && opposite(aApproach, bApproach)) {
    return true;
  }

  // Opposing protected lefts occupy distinct paths in the cardinal legacy geometry.
  if (a.turnKind === 'left' && b.turnKind === 'left' && opposite(aApproach, bApproach)) {
    return false;
  }

  // Distinct right turns stay in separate corner/departure paths. Shared departures
  // were already rejected above.
  if (a.turnKind === 'right' && b.turnKind === 'right') return false;

  // Remaining cardinal combinations cross or merge within the conflict area.
  return true;
}

export function buildConflictMatrices(
  authority: TransportNetworkAuthority,
  crossings: readonly PedestrianCrossing[],
): readonly JunctionConflictMatrix[] {
  const junctionById = new Map(authority.junctions.map((junction) => [junction.id, junction]));
  const carriagewayById = new Map(authority.carriageways.map((carriageway) => [carriageway.id, carriageway]));
  const movementsByJunction = new Map<JunctionId, TurnMovement[]>();
  for (const movement of [...authority.movements].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!movement.allowed) continue;
    const movements = movementsByJunction.get(movement.junctionId) ?? [];
    movements.push(movement);
    movementsByJunction.set(movement.junctionId, movements);
  }

  const crossingsByJunction = new Map<JunctionId, PedestrianCrossing[]>();
  for (const crossing of [...crossings].sort((a, b) => a.id.localeCompare(b.id))) {
    const junctionCrossings = crossingsByJunction.get(crossing.junctionId) ?? [];
    junctionCrossings.push(crossing);
    crossingsByJunction.set(crossing.junctionId, junctionCrossings);
  }

  const junctionIds = new Set<JunctionId>([
    ...movementsByJunction.keys(),
    ...crossingsByJunction.keys(),
  ]);
  const matrices: JunctionConflictMatrix[] = [];

  for (const junctionId of [...junctionIds].sort((a, b) => a.localeCompare(b))) {
    const junction = junctionById.get(junctionId);
    if (!junction) continue;
    const movements = movementsByJunction.get(junctionId) ?? [];
    const junctionCrossings = crossingsByJunction.get(junctionId) ?? [];
    const participants = Object.freeze([
      ...movements.map((movement) => movement.id),
      ...junctionCrossings.map((crossing) => crossing.id),
    ].sort((a, b) => a.localeCompare(b)));
    const participantSet = new Set(participants);
    const conflicts = new Set<string>();

    for (let i = 0; i < movements.length; i += 1) {
      for (let j = i + 1; j < movements.length; j += 1) {
        if (vehicleMovementsConflict(
          movements[i],
          movements[j],
          junction,
          carriagewayById,
          junctionById,
        )) {
          conflicts.add(pairKey(movements[i].id, movements[j].id));
        }
      }
    }

    for (const crossing of junctionCrossings) {
      for (const movementId of crossing.conflictingMovementIds) {
        if (participantSet.has(movementId)) {
          conflicts.add(pairKey(crossing.id, movementId));
        }
      }
    }

    matrices.push(Object.freeze({
      junctionId,
      participants,
      conflicts(a: ConflictParticipantId, b: ConflictParticipantId): boolean {
        if (a === b || !participantSet.has(a) || !participantSet.has(b)) return false;
        return conflicts.has(pairKey(a, b));
      },
    }));
  }

  return Object.freeze(matrices);
}
