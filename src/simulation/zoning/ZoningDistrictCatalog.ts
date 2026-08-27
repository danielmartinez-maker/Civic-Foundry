import type { ZoneType } from '../core/types.ts';
import type { UseType, ZoningDistrict } from './ZoningTypes.ts';

type DistrictId = 'R2' | 'R5' | 'MU4' | 'MU8' | 'C6' | 'IND';

function district(
  id: DistrictId,
  permittedUses: readonly UseType[],
  maxFAR: number,
  maxHeightMeters: number,
  maxStories: number,
  maxCoverageRatio: number,
  frontSetbackMeters: number,
  rearSetbackMeters: number,
  sideSetbackMeters: number,
  minParcelAreaM2: number,
  minFrontageMeters: number,
): ZoningDistrict {
  return Object.freeze({
    id,
    permittedUses: Object.freeze([...permittedUses]),
    conditionalUses: Object.freeze([]),
    maxFAR,
    maxHeightMeters,
    maxStories,
    maxCoverageRatio,
    frontSetbackMeters,
    rearSetbackMeters,
    sideSetbackMeters,
    minParcelAreaM2,
    minFrontageMeters,
  });
}

export const ZONING_DISTRICTS = Object.freeze({
  R2: district('R2', ['residential'], 1.5, 12, 2, 0.55, 4, 5, 2, 250, 8),
  R5: district('R5', ['residential'], 4, 30, 8, 0.70, 2, 4, 1.5, 180, 7),
  MU4: district('MU4', ['residential', 'retail', 'office', 'hospitality'], 4, 30, 8, 0.75, 0, 3, 0, 150, 6),
  MU8: district('MU8', ['residential', 'retail', 'office', 'hospitality'], 8, 90, 25, 0.80, 0, 3, 0, 250, 10),
  C6: district('C6', ['retail', 'office', 'hospitality'], 6, 60, 16, 0.80, 0, 3, 0, 180, 8),
  IND: district('IND', ['light-industrial', 'heavy-industrial', 'logistics'], 2, 24, 5, 0.80, 5, 5, 3, 500, 15),
});

export type ZoningDistrictId = keyof typeof ZONING_DISTRICTS;

const LEGACY_ZONE_TO_DISTRICT: Readonly<Record<ZoneType, ZoningDistrictId>> = Object.freeze({
  residential: 'R2',
  commercial: 'C6',
  industrial: 'IND',
});

export function districtForLegacyZone(zone: ZoneType): ZoningDistrict {
  return ZONING_DISTRICTS[LEGACY_ZONE_TO_DISTRICT[zone]];
}

export function getZoningDistrict(id: string): ZoningDistrict | undefined {
  return Object.prototype.hasOwnProperty.call(ZONING_DISTRICTS, id)
    ? ZONING_DISTRICTS[id as ZoningDistrictId]
    : undefined;
}

export function isZoningDistrictId(id: string): id is ZoningDistrictId {
  return getZoningDistrict(id) !== undefined;
}
