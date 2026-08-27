import type { SimulationCore } from '../../simulation/core/SimulationCore.ts';
import type { BuildingV2 } from '../../simulation/buildings/BuildingTypes.ts';
import type { UseType } from '../../simulation/zoning/ZoningTypes.ts';
import { LEGACY_CELL_SIZE_METERS } from '../../world/cadastre/Geometry.ts';
import { roadConnectivityMask } from '../assets/RoadAutotile.ts';
import type { WorldFacing, PublicRealmContext } from './PublicRealmTypes.ts';

function key(x: number, y: number): string { return `${x},${y}`; }

function parseRoadRef(value: string | undefined): { x: number; y: number } | undefined {
  if (!value) return undefined;
  const [rawX, rawY] = value.split(',');
  const x = Number(rawX);
  const y = Number(rawY);
  return Number.isInteger(x) && Number.isInteger(y) ? { x, y } : undefined;
}

function facingToward(dx: number, dy: number): WorldFacing {
  if (Math.abs(dx) > Math.abs(dy)) return (dx >= 0 ? 1 : 3) as WorldFacing;
  return (dy >= 0 ? 2 : 0) as WorldFacing;
}

function bitCount(mask: number): number {
  let value = mask & 0x0f;
  let count = 0;
  while (value !== 0) { count += value & 1; value >>>= 1; }
  return count;
}

function buildingUses(building: BuildingV2): readonly UseType[] {
  return Object.freeze([...new Set(building.floors.flatMap((floor) => floor.uses.map((allocation) => allocation.use)))].sort());
}

export function buildPublicRealmContextIndex(core: SimulationCore): readonly PublicRealmContext[] {
  const roadByKey = new Map(core.roads.list().map((road) => [key(road.x, road.y), road] as const));
  const edgeById = new Map(core.cadastre.listEdges().map((edge) => [edge.id, edge] as const));
  const buildings = core.buildings.listV2().sort((left, right) => left.id.localeCompare(right.id));
  const buildingByParcel = new Map<string, BuildingV2>();
  for (const building of buildings) {
    for (const parcelId of [...building.parcelIds].sort()) {
      if (!buildingByParcel.has(parcelId)) buildingByParcel.set(parcelId, building);
    }
  }

  const contexts: PublicRealmContext[] = [];
  const parcels = [...core.cadastre.listParcels()].sort((left, right) => left.id.localeCompare(right.id));
  for (const parcel of parcels) {
    const building = buildingByParcel.get(parcel.id);
    if (!building) continue;
    const siteAnchor = Object.freeze({
      x: parcel.centroid.x / LEGACY_CELL_SIZE_METERS,
      y: parcel.centroid.y / LEGACY_CELL_SIZE_METERS,
    });
    for (const edgeId of [...parcel.frontageEdgeIds].sort()) {
      const edge = edgeById.get(edgeId);
      if (!edge || edge.kind !== 'street-frontage') continue;
      const roadCoord = parseRoadRef(edge.roadRef);
      if (!roadCoord) continue;
      const road = roadByKey.get(key(roadCoord.x, roadCoord.y));
      if (!road) continue;
      const hasAccessEdge = parcel.accessEdgeIds.includes(edge.id);
      const mask = roadConnectivityMask(roadCoord.x, roadCoord.y, (x, y) => roadByKey.get(key(x, y))?.type);
      contexts.push(Object.freeze({
        kind: 'building',
        stableId: building.id,
        selectionKey: `${parcel.id}|${edge.id}`,
        typologyId: building.typologyId,
        stories: building.stories,
        realizedFAR: building.realizedFAR,
        coverageRatio: building.coverageRatio,
        uses: buildingUses(building),
        roadType: road.type,
        hasAccessEdge,
        atIntersection: bitCount(mask) >= 3,
        curbsideSuppressedByGeometry: hasAccessEdge,
        worldFacing: facingToward(siteAnchor.x - roadCoord.x, siteAnchor.y - roadCoord.y),
        siteAnchor,
        frontageAnchor: Object.freeze({ x: roadCoord.x, y: roadCoord.y }),
      }));
    }
  }

  const cardinal = Object.freeze([
    Object.freeze({ dx: 0, dy: -1 }),
    Object.freeze({ dx: 1, dy: 0 }),
    Object.freeze({ dx: 0, dy: 1 }),
    Object.freeze({ dx: -1, dy: 0 }),
  ]);
  for (const facility of core.services.listFacilities().sort((left, right) => left.id.localeCompare(right.id))) {
    const adjacent = cardinal
      .map(({ dx, dy }) => ({ x: facility.x + dx, y: facility.y + dy }))
      .map((coord) => ({ ...coord, road: roadByKey.get(key(coord.x, coord.y)) }))
      .filter((candidate): candidate is { x: number; y: number; road: NonNullable<typeof candidate.road> } => candidate.road !== undefined)
      .sort((left, right) => key(left.x, left.y).localeCompare(key(right.x, right.y)))[0];
    const frontageAnchor = adjacent
      ? Object.freeze({ x: adjacent.x, y: adjacent.y })
      : Object.freeze({ x: facility.x, y: facility.y });
    contexts.push(Object.freeze({
      kind: 'facility',
      stableId: facility.id,
      selectionKey: facility.id,
      facilityType: facility.type,
      ...(adjacent ? { roadType: adjacent.road.type } : {}),
      worldFacing: adjacent
        ? facingToward(facility.x - adjacent.x, facility.y - adjacent.y)
        : 0,
      siteAnchor: Object.freeze({ x: facility.x, y: facility.y }),
      frontageAnchor,
    }));
  }

  return Object.freeze(contexts.sort((left, right) => left.selectionKey.localeCompare(right.selectionKey)));
}
