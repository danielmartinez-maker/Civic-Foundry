import { ROAD_DEFINITIONS, type RoadType } from '../../data/roads.ts';
import type { RoadCell, RoadSystem } from '../../world/roads/RoadSystem.ts';
import { buildTurnMovements } from './TurnMovementBuilder.ts';
import {
  ALL_VEHICLE_PERMISSIONS,
  LEGACY_LANE_COUNT,
  roadClassRank,
  type Carriageway,
  type Junction,
  type Lane,
  type RoadClass,
  type RoadSegment,
  type TransportNetworkAuthority,
  type TransportPhysicalNetwork,
} from './TransportNetworkTypes.ts';

export type LegacyRoadTypeSource = Readonly<{
  junctionId: string;
  roadType: RoadType;
}>;

export type LegacyProjection = Readonly<{
  physical: TransportPhysicalNetwork;
  sourceRoadTypes: readonly LegacyRoadTypeSource[];
  sourceRoadRevision: number;
}>;

export type LegacyAuthorityProjection = Readonly<{
  authority: TransportNetworkAuthority;
  sourceRoadTypes: readonly LegacyRoadTypeSource[];
  sourceRoadRevision: number;
}>;

export type LegacyProjectionDiagnostics = Readonly<{
  builds: number;
  roadCellsVisited: number;
  adjacencyChecks: number;
}>;

export const LEGACY_CELL_METERS = 10;

const CARDINAL = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
] as const;

function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

export function legacyJunctionId(x: number, y: number): string {
  return `j:legacy:${x},${y}`;
}

export function legacySegmentId(a: string, b: string): string {
  const [first, second] = [a, b].sort((left, right) => left.localeCompare(right));
  return `s:legacy:${first}>${second}`;
}

export function legacyCarriagewayId(segmentId: string, fromJunctionId: string, toJunctionId: string): string {
  return `c:${segmentId}:${fromJunctionId}>${toJunctionId}`;
}

export function legacyLaneId(carriagewayId: string, ordinal: number): string {
  return `l:${carriagewayId}:${ordinal}`;
}

function higherLegacyClass(a: RoadType, b: RoadType): RoadClass {
  return roadClassRank(a) >= roadClassRank(b) ? a : b;
}

function speedKph(type: RoadType): number {
  return ROAD_DEFINITIONS[type].freeFlowSpeedCellsPerSecond * LEGACY_CELL_METERS * 3.6;
}

function createDirectionalCarriageway(
  segmentId: string,
  startJunctionId: string,
  endJunctionId: string,
  fromJunctionId: string,
  toJunctionId: string,
  sourceType: RoadType,
): Readonly<{ carriageway: Carriageway; lanes: readonly Lane[] }> {
  const direction = fromJunctionId === startJunctionId ? 'forward' : 'backward';
  const carriagewayId = legacyCarriagewayId(segmentId, fromJunctionId, toJunctionId);
  const laneCount = LEGACY_LANE_COUNT[sourceType];
  const aggregateCapacity = ROAD_DEFINITIONS[sourceType].weightedVehicleCapacityPerMinute;
  const perLaneCapacity = aggregateCapacity / laneCount;
  const laneIds = Array.from({ length: laneCount }, (_, ordinal) => legacyLaneId(carriagewayId, ordinal));
  const lanes = laneIds.map((id, ordinal): Lane => ({
    id,
    carriagewayId,
    ordinal,
    kind: 'through',
    permissions: ALL_VEHICLE_PERMISSIONS,
    operatingState: 'open',
    baseCapacityPerMinute: perLaneCapacity,
    freeFlowSpeedKph: speedKph(sourceType),
  }));

  return {
    carriageway: {
      id: carriagewayId,
      segmentId,
      direction,
      fromJunctionId,
      toJunctionId,
      operatingClass: sourceType,
      laneIds,
    },
    lanes,
  };
}

export class LegacyRoadNetworkAdapter {
  private cachedRevision = -1;
  private cachedProjection: LegacyProjection | undefined;
  private cachedAuthorityProjection: LegacyAuthorityProjection | undefined;
  private builds = 0;
  private roadCellsVisited = 0;
  private adjacencyChecks = 0;

  get diagnostics(): LegacyProjectionDiagnostics {
    return {
      builds: this.builds,
      roadCellsVisited: this.roadCellsVisited,
      adjacencyChecks: this.adjacencyChecks,
    };
  }

  projectIfNeeded(roads: RoadSystem): LegacyProjection {
    if (this.cachedProjection && this.cachedRevision === roads.revision) return this.cachedProjection;

    const cells = roads.list();
    const byKey = new Map<string, RoadCell>();
    const junctions: Junction[] = [];
    const sourceRoadTypes: LegacyRoadTypeSource[] = [];
    const segments: RoadSegment[] = [];
    const carriageways: Carriageway[] = [];
    const lanes: Lane[] = [];

    this.builds += 1;
    this.roadCellsVisited += cells.length;

    for (const cell of cells) {
      const key = cellKey(cell.x, cell.y);
      const junctionId = legacyJunctionId(cell.x, cell.y);
      byKey.set(key, cell);
      junctions.push({
        id: junctionId,
        x: cell.x,
        y: cell.y,
        sourceLegacyCell: key,
      });
      sourceRoadTypes.push({ junctionId, roadType: cell.type });
    }

    for (const cell of cells) {
      const sourceKey = cellKey(cell.x, cell.y);
      for (const offset of CARDINAL) {
        this.adjacencyChecks += 1;
        const neighbor = byKey.get(cellKey(cell.x + offset.x, cell.y + offset.y));
        if (!neighbor) continue;

        const neighborKey = cellKey(neighbor.x, neighbor.y);
        if (sourceKey.localeCompare(neighborKey) >= 0) continue;

        const startKey = sourceKey;
        const endKey = neighborKey;
        const startJunctionId = legacyJunctionId(cell.x, cell.y);
        const endJunctionId = legacyJunctionId(neighbor.x, neighbor.y);
        const segmentId = legacySegmentId(startKey, endKey);

        const forward = createDirectionalCarriageway(
          segmentId,
          startJunctionId,
          endJunctionId,
          startJunctionId,
          endJunctionId,
          cell.type,
        );
        const backward = createDirectionalCarriageway(
          segmentId,
          startJunctionId,
          endJunctionId,
          endJunctionId,
          startJunctionId,
          neighbor.type,
        );

        const segmentClass = higherLegacyClass(cell.type, neighbor.type);
        segments.push({
          id: segmentId,
          roadClass: segmentClass,
          geometryRef: `legacy:${startKey}>${endKey}`,
          startJunctionId,
          endJunctionId,
          lengthMeters: LEGACY_CELL_METERS,
          speedLimitKph: Math.max(speedKph(cell.type), speedKph(neighbor.type)),
          condition: 1,
          accessPolicyId: 'legacy:all',
          carriagewayIds: [forward.carriageway.id, backward.carriageway.id].sort((a, b) => a.localeCompare(b)),
          sourceLegacyCells: [startKey, endKey],
        });
        carriageways.push(forward.carriageway, backward.carriageway);
        lanes.push(...forward.lanes, ...backward.lanes);
      }
    }

    const projection: LegacyProjection = {
      physical: {
        junctions: junctions.sort((a, b) => a.id.localeCompare(b.id)),
        segments: segments.sort((a, b) => a.id.localeCompare(b.id)),
        carriageways: carriageways.sort((a, b) => a.id.localeCompare(b.id)),
        lanes: lanes.sort((a, b) => a.id.localeCompare(b.id)),
      },
      sourceRoadTypes: sourceRoadTypes.sort((a, b) => a.junctionId.localeCompare(b.junctionId)),
      sourceRoadRevision: roads.revision,
    };

    this.cachedRevision = roads.revision;
    this.cachedProjection = projection;
    this.cachedAuthorityProjection = undefined;
    return projection;
  }

  projectAuthorityIfNeeded(roads: RoadSystem): LegacyAuthorityProjection {
    const projection = this.projectIfNeeded(roads);
    if (this.cachedAuthorityProjection && this.cachedAuthorityProjection.sourceRoadRevision === projection.sourceRoadRevision) {
      return this.cachedAuthorityProjection;
    }
    const authorityProjection: LegacyAuthorityProjection = {
      authority: {
        ...projection.physical,
        movements: buildTurnMovements(projection.physical),
      },
      sourceRoadTypes: projection.sourceRoadTypes,
      sourceRoadRevision: projection.sourceRoadRevision,
    };
    this.cachedAuthorityProjection = authorityProjection;
    return authorityProjection;
  }
}
