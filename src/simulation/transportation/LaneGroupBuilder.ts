import type {
  Lane,
  LaneGroup,
  TransportNetworkAuthority,
  TurnMovement,
} from './TransportNetworkTypes.ts';

function isNormalTravelLane(lane: Lane): boolean {
  return lane.operatingState === 'open' && lane.kind !== 'parking' && lane.kind !== 'shoulder';
}

function compareStrings(a: string, b: string): number {
  return a.localeCompare(b);
}

function sameStrings(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function movementIndex(authority: TransportNetworkAuthority): ReadonlyMap<string, readonly string[]> {
  const movementIdsByLaneId = new Map<string, string[]>();
  const movements = [...authority.movements].sort((a, b) => a.id.localeCompare(b.id));

  for (const movement of movements) {
    if (!movement.allowed) continue;
    for (const laneId of movement.fromLaneIds) {
      const ids = movementIdsByLaneId.get(laneId) ?? [];
      ids.push(movement.id);
      movementIdsByLaneId.set(laneId, ids);
    }
  }

  for (const ids of movementIdsByLaneId.values()) ids.sort(compareStrings);
  return movementIdsByLaneId;
}

function groupId(carriagewayId: string, laneIds: readonly string[]): string {
  return `lg:${carriagewayId}:${laneIds.join('+')}`;
}

function laneMovements(index: ReadonlyMap<string, readonly string[]>, laneId: string): readonly string[] {
  return index.get(laneId) ?? [];
}

function canMerge(
  previousLane: Lane,
  lane: Lane,
  previousMovements: readonly string[],
  movements: readonly string[],
): boolean {
  return lane.ordinal === previousLane.ordinal + 1
    && lane.permissions === previousLane.permissions
    && lane.freeFlowSpeedKph === previousLane.freeFlowSpeedKph
    && sameStrings(previousMovements, movements);
}

export function buildLaneGroups(authority: TransportNetworkAuthority): readonly LaneGroup[] {
  const laneById = new Map(authority.lanes.map((lane) => [lane.id, lane]));
  const movementIdsByLaneId = movementIndex(authority);
  const groups: LaneGroup[] = [];

  for (const carriageway of [...authority.carriageways].sort((a, b) => a.id.localeCompare(b.id))) {
    const lanes = carriageway.laneIds.map((laneId) => {
      const lane = laneById.get(laneId);
      if (!lane) throw new Error(`Carriageway ${carriageway.id} references missing lane ${laneId}`);
      if (lane.carriagewayId !== carriageway.id) {
        throw new Error(`Lane ${lane.id} belongs to ${lane.carriagewayId}, not ${carriageway.id}`);
      }
      return lane;
    }).sort((a, b) => a.ordinal - b.ordinal || a.id.localeCompare(b.id));

    const travelLanes = lanes.filter(isNormalTravelLane);
    let currentLanes: Lane[] = [];
    let currentMovementIds: readonly string[] = [];

    const flush = (): void => {
      if (currentLanes.length === 0) return;
      const laneIds = currentLanes.map((lane) => lane.id);
      groups.push({
        id: groupId(carriageway.id, laneIds),
        carriagewayId: carriageway.id,
        laneIds,
        movementIds: [...currentMovementIds],
        permissions: currentLanes[0]!.permissions,
        capacityPerMinute: currentLanes.reduce((sum, lane) => sum + lane.baseCapacityPerMinute, 0),
        freeFlowSpeedKph: Math.min(...currentLanes.map((lane) => lane.freeFlowSpeedKph)),
      });
      currentLanes = [];
      currentMovementIds = [];
    };

    for (const lane of travelLanes) {
      const movements = laneMovements(movementIdsByLaneId, lane.id);
      const previousLane = currentLanes[currentLanes.length - 1];
      if (!previousLane || canMerge(previousLane, lane, currentMovementIds, movements)) {
        if (!previousLane) currentMovementIds = movements;
        currentLanes.push(lane);
        continue;
      }
      flush();
      currentLanes.push(lane);
      currentMovementIds = movements;
    }
    flush();
  }

  return groups.sort((a, b) => a.id.localeCompare(b.id));
}
