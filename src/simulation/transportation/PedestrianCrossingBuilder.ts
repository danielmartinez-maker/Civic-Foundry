import {
  isControlledAccessRoadClass,
  type PedestrianCrossing,
} from './IntersectionControlTypes.ts';
import type {
  Carriageway,
  Junction,
  JunctionId,
  Lane,
  LaneGroup,
  TransportNetworkAuthority,
} from './TransportNetworkTypes.ts';

type CardinalHeading = 'north' | 'east' | 'south' | 'west';

const CARDINAL_HEADINGS: readonly CardinalHeading[] = ['east', 'north', 'south', 'west'];

function headingFrom(junction: Junction, other: Junction): CardinalHeading | undefined {
  const dx = other.x - junction.x;
  const dy = other.y - junction.y;
  if (dx === 0 && dy < 0) return 'north';
  if (dx > 0 && dy === 0) return 'east';
  if (dx === 0 && dy > 0) return 'south';
  if (dx < 0 && dy === 0) return 'west';
  return undefined;
}

function isTravelLane(lane: Lane | undefined): boolean {
  return lane !== undefined
    && lane.operatingState === 'open'
    && lane.kind !== 'parking'
    && lane.kind !== 'shoulder';
}

export function buildPedestrianCrossings(
  authority: TransportNetworkAuthority,
  laneGroups: readonly LaneGroup[],
): readonly PedestrianCrossing[] {
  const junctionById = new Map(authority.junctions.map((junction) => [junction.id, junction]));
  const laneById = new Map(authority.lanes.map((lane) => [lane.id, lane]));
  const groupsByCarriageway = new Map<string, LaneGroup[]>();
  for (const group of [...laneGroups].sort((a, b) => a.id.localeCompare(b.id))) {
    const groups = groupsByCarriageway.get(group.carriagewayId) ?? [];
    groups.push(group);
    groupsByCarriageway.set(group.carriagewayId, groups);
  }

  const legsByJunction = new Map<JunctionId, Map<CardinalHeading, Carriageway[]>>();
  const addLeg = (junctionId: JunctionId, otherJunctionId: JunctionId, carriageway: Carriageway): void => {
    const junction = junctionById.get(junctionId);
    const other = junctionById.get(otherJunctionId);
    if (!junction || !other) return;
    const heading = headingFrom(junction, other);
    if (!heading) return;
    const legs = legsByJunction.get(junctionId) ?? new Map<CardinalHeading, Carriageway[]>();
    const carriageways = legs.get(heading) ?? [];
    carriageways.push(carriageway);
    legs.set(heading, carriageways);
    legsByJunction.set(junctionId, legs);
  };

  for (const carriageway of [...authority.carriageways].sort((a, b) => a.id.localeCompare(b.id))) {
    addLeg(carriageway.fromJunctionId, carriageway.toJunctionId, carriageway);
    addLeg(carriageway.toJunctionId, carriageway.fromJunctionId, carriageway);
  }

  const crossings: PedestrianCrossing[] = [];
  for (const junction of [...authority.junctions].sort((a, b) => a.id.localeCompare(b.id))) {
    const legs = legsByJunction.get(junction.id);
    if (!legs || CARDINAL_HEADINGS.some((heading) => !legs.has(heading))) continue;

    for (const heading of CARDINAL_HEADINGS) {
      const carriageways = [...(legs.get(heading) ?? [])].sort((a, b) => a.id.localeCompare(b.id));
      if (carriageways.length === 0) continue;
      if (carriageways.some((carriageway) => isControlledAccessRoadClass(carriageway.operatingClass))) {
        continue;
      }

      const crossedCarriagewayIds = Object.freeze(carriageways.map((carriageway) => carriageway.id));
      const crossedSet = new Set(crossedCarriagewayIds);
      const travelLaneIds = new Set<string>();
      for (const carriageway of carriageways) {
        for (const group of groupsByCarriageway.get(carriageway.id) ?? []) {
          for (const laneId of group.laneIds) {
            if (isTravelLane(laneById.get(laneId))) travelLaneIds.add(laneId);
          }
        }
      }

      const conflictingMovementIds = Object.freeze(
        authority.movements
          .filter((movement) => movement.allowed
            && movement.junctionId === junction.id
            && (crossedSet.has(movement.fromCarriagewayId) || crossedSet.has(movement.toCarriagewayId)))
          .map((movement) => movement.id)
          .sort((a, b) => a.localeCompare(b)),
      );

      crossings.push(Object.freeze({
        id: `pc:${junction.id}:${heading}`,
        junctionId: junction.id,
        crossedCarriagewayIds,
        conflictingMovementIds,
        lengthMeters: Math.max(7, travelLaneIds.size * 3.6),
      }));
    }
  }

  return Object.freeze(crossings.sort((a, b) => a.id.localeCompare(b.id)));
}
