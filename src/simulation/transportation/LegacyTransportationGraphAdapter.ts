import { ROAD_DEFINITIONS, type RoadType } from '../../data/roads.ts';
import type {
  TransportationEdge,
  TransportationGraphProjection,
  TransportationNode,
} from '../traffic/TransportationGraph.ts';
import type { LegacyAuthorityProjection } from './LegacyRoadNetworkAdapter.ts';
import { buildLaneGroups } from './LaneGroupBuilder.ts';
import type { Carriageway, RoadClass, TransportNetworkAuthority } from './TransportNetworkTypes.ts';

function asLegacyRoadType(roadClass: RoadClass): RoadType {
  if (roadClass === 'local' || roadClass === 'collector' || roadClass === 'arterial') return roadClass;
  throw new Error(`Road class ${roadClass} cannot be projected to the V7 transportation graph`);
}

function legacyNodeId(x: number, y: number): string {
  return `n:${x},${y}`;
}

function roadTypeAtJunction(
  junctionId: string,
  authority: TransportNetworkAuthority,
  carriagewaysByFrom: ReadonlyMap<string, readonly Carriageway[]>,
): RoadType {
  const outgoing = carriagewaysByFrom.get(junctionId) ?? [];
  if (outgoing.length === 0) {
    throw new Error(`Legacy junction ${junctionId} has no outgoing carriageway from which to recover its V7 road type`);
  }
  const classes = [...new Set(outgoing.map((carriageway) => asLegacyRoadType(carriageway.operatingClass)))];
  if (classes.length !== 1) {
    throw new Error(`Legacy junction ${junctionId} has inconsistent source road classes: ${classes.join(', ')}`);
  }
  return classes[0]!;
}

export class LegacyTransportationGraphAdapter {
  project(source: LegacyAuthorityProjection): TransportationGraphProjection {
    const authority = source.authority;
    const junctionById = new Map(authority.junctions.map((junction) => [junction.id, junction]));
    const carriagewaysByFrom = new Map<string, Carriageway[]>();
    for (const carriageway of authority.carriageways) {
      const list = carriagewaysByFrom.get(carriageway.fromJunctionId) ?? [];
      list.push(carriageway);
      carriagewaysByFrom.set(carriageway.fromJunctionId, list);
    }

    const nodes: TransportationNode[] = authority.junctions.map((junction) => ({
      id: legacyNodeId(junction.x, junction.y),
      x: junction.x,
      y: junction.y,
      roadType: roadTypeAtJunction(junction.id, authority, carriagewaysByFrom),
    }));

    const laneGroups = buildLaneGroups(authority);
    const capacityByCarriageway = new Map<string, number>();
    for (const group of laneGroups) {
      capacityByCarriageway.set(
        group.carriagewayId,
        (capacityByCarriageway.get(group.carriagewayId) ?? 0) + group.capacityPerMinute,
      );
    }

    const edges: TransportationEdge[] = authority.carriageways.map((carriageway) => {
      const fromJunction = junctionById.get(carriageway.fromJunctionId);
      const toJunction = junctionById.get(carriageway.toJunctionId);
      if (!fromJunction || !toJunction) {
        throw new Error(`Legacy carriageway ${carriageway.id} references a missing junction`);
      }
      const roadType = asLegacyRoadType(carriageway.operatingClass);
      const definition = ROAD_DEFINITIONS[roadType];
      const from = legacyNodeId(fromJunction.x, fromJunction.y);
      const to = legacyNodeId(toJunction.x, toJunction.y);
      return {
        id: `e:${from}>${to}`,
        from,
        to,
        roadType,
        lengthCells: 1,
        freeFlowSpeedCellsPerSecond: definition.freeFlowSpeedCellsPerSecond,
        freeFlowTicks: 10 / definition.freeFlowSpeedCellsPerSecond,
        capacityPerMinute: capacityByCarriageway.get(carriageway.id) ?? 0,
        intersectionServiceRate: definition.intersectionServiceRate,
      };
    });

    nodes.sort((a, b) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id));
    edges.sort((a, b) => a.id.localeCompare(b.id));
    return {
      nodes,
      edges,
      sourceRoadRevision: source.sourceRoadRevision,
    };
  }
}
