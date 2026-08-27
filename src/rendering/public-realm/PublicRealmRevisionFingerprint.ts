import type { SimulationCore } from '../../simulation/core/SimulationCore.ts';
import { stableHash32 } from '../assets/VariantSelector.ts';

export function publicRealmRevisionFingerprint(core: SimulationCore): string {
  const roads = core.roads.list()
    .map((road) => `${road.x},${road.y},${road.type}`)
    .sort()
    .join(';');
  const parcels = [...core.cadastre.listParcels()]
    .map((parcel) => [
      parcel.id,
      parcel.zoningDistrictId,
      `${parcel.centroid.x},${parcel.centroid.y}`,
      [...parcel.frontageEdgeIds].sort().join(','),
      [...parcel.accessEdgeIds].sort().join(','),
    ].join(':'))
    .sort()
    .join(';');
  const edges = [...core.cadastre.listEdges()]
    .map((edge) => `${edge.id}:${edge.kind}:${edge.roadRef ?? ''}`)
    .sort()
    .join(';');
  const buildings = core.buildings.listV2()
    .map((building) => {
      const uses = building.floors.flatMap((floor) => floor.uses.map((allocation) => allocation.use)).sort();
      return [
        building.id,
        [...building.parcelIds].sort().join(','),
        building.typologyId,
        building.stories,
        building.realizedFAR,
        building.coverageRatio,
        uses.join(','),
      ].join(':');
    })
    .sort()
    .join(';');
  const facilities = core.services.listFacilities()
    .map((facility) => `${facility.id}:${facility.type}:${facility.x},${facility.y}`)
    .sort()
    .join(';');

  const parts = [
    `roads:${core.roads.revision}:${roads}`,
    `parcels:${parcels}`,
    `edges:${edges}`,
    `buildings:${buildings}`,
    `facilities:${facilities}`,
  ];
  return stableHash32(parts.join('|')).toString(16).padStart(8, '0');
}
