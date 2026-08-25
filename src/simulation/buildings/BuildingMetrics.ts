import type { UseType } from '../zoning/ZoningTypes.ts';
import type { BuildingMetrics, BuildingTypology, BuildingV2 } from './BuildingTypes.ts';

const USE_TYPES: readonly UseType[] = Object.freeze([
  'residential',
  'retail',
  'office',
  'hospitality',
  'light-industrial',
  'heavy-industrial',
  'logistics',
  'civic',
]);

export function calculateBuildingMetrics(
  building: BuildingV2,
  typology: BuildingTypology,
): BuildingMetrics {
  if (building.typologyId !== typology.id) {
    throw new Error(`building typology mismatch: ${building.typologyId} !== ${typology.id}`);
  }
  if (!Number.isFinite(building.grossFloorAreaM2) || building.grossFloorAreaM2 < 0) {
    throw new Error('gross floor area must be finite and non-negative');
  }
  if (!Number.isFinite(building.usableFloorAreaM2) || building.usableFloorAreaM2 < 0) {
    throw new Error('usable floor area must be finite and non-negative');
  }

  const floorAreaByUse = emptyUseArea();
  let hotelRooms = 0;
  let storageCapacity = 0;
  for (const floor of building.floors) {
    for (const allocation of floor.uses) {
      if (!Number.isFinite(allocation.floorAreaM2) || allocation.floorAreaM2 < 0) {
        throw new Error(`invalid floor-area allocation for ${allocation.use}`);
      }
      floorAreaByUse[allocation.use] += allocation.floorAreaM2;
      hotelRooms += allocation.hotelRooms ?? 0;
      storageCapacity += allocation.storageCapacity ?? 0;
    }
  }

  const allocatedUsableArea = USE_TYPES.reduce((sum, use) => sum + floorAreaByUse[use], 0);
  if (Math.abs(allocatedUsableArea - building.usableFloorAreaM2) > 0.01) {
    throw new Error('floor-use allocations must conserve usable floor area');
  }

  const residentialUnits = typology.averageResidentialUnitAreaM2 > 0
    ? Math.round(floorAreaByUse.residential / typology.averageResidentialUnitAreaM2)
    : 0;
  let jobCapacity = 0;
  for (const use of USE_TYPES) {
    if (use === 'residential') continue;
    const jobsPer1000M2 = typology.jobsPer1000M2ByUse[use] ?? 0;
    jobCapacity += floorAreaByUse[use] / 1_000 * jobsPer1000M2;
  }

  const areaInThousands = building.usableFloorAreaM2 / 1_000;
  return Object.freeze({
    grossFloorAreaM2: building.grossFloorAreaM2,
    usableFloorAreaM2: building.usableFloorAreaM2,
    floorAreaByUse: Object.freeze({ ...floorAreaByUse }),
    residentialUnits,
    jobCapacity: Math.round(jobCapacity),
    hotelRooms: Math.round(hotelRooms),
    storageCapacity,
    powerDemand: areaInThousands * typology.powerDemandPer1000M2,
    waterDemand: areaInThousands * typology.waterDemandPer1000M2,
    garbageGeneration: areaInThousands * typology.garbagePer1000M2,
    taxBase: building.usableFloorAreaM2 * typology.taxBasePerM2,
  });
}

function emptyUseArea(): Record<UseType, number> {
  return {
    residential: 0,
    retail: 0,
    office: 0,
    hospitality: 0,
    'light-industrial': 0,
    'heavy-industrial': 0,
    logistics: 0,
    civic: 0,
  };
}