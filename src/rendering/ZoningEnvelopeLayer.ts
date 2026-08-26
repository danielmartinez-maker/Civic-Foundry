import type { SimulationCore } from '../simulation/core/SimulationCore.ts';
import { districtForLegacyZone, getZoningDistrict } from '../simulation/zoning/ZoningDistrictCatalog.ts';
import type { ZoningDistrict } from '../simulation/zoning/ZoningTypes.ts';
import type { Parcel } from '../world/cadastre/CadastralTypes.ts';
import type { MultiPolygon, PolygonRing } from '../world/cadastre/Geometry.ts';

export type ZoningEnvelopeSnapshot = Readonly<{
  parcelId: string;
  districtId: string;
  parcelBoundary: PolygonRing;
  buildableFootprint: MultiPolygon;
  maxHeightMeters: number;
  effectiveFAR: number;
  effectiveCoverageRatio: number;
  limitingConstraints: readonly string[];
}>;

export function mapZoningEnvelope(core: SimulationCore, parcelId: string): ZoningEnvelopeSnapshot {
  const parcel = core.cadastre.getParcel(parcelId);
  if (!parcel) throw new Error(`unknown parcel: ${parcelId}`);
  const district = resolveDistrict(parcel, core);
  if (!district) throw new Error(`parcel has no dimensional zoning district: ${parcelId}`);

  const envelope = core.buildableEnvelopes.evaluate(parcel.id, core.cadastre, district);
  return {
    parcelId: parcel.id,
    districtId: district.id,
    parcelBoundary: core.cadastre.parcelPolygon(parcel.id),
    buildableFootprint: envelope.buildableFootprint,
    maxHeightMeters: envelope.maxHeightMeters,
    effectiveFAR: envelope.effectiveFAR,
    effectiveCoverageRatio: envelope.effectiveCoverageRatio,
    limitingConstraints: envelope.limitingConstraints.map((constraint) => constraint.code),
  };
}

function resolveDistrict(parcel: Parcel, core: SimulationCore): ZoningDistrict | undefined {
  const assignment = core.zoning.getParcelAssignment(parcel.id);
  if (assignment) return getZoningDistrict(assignment.districtId);
  const explicit = getZoningDistrict(parcel.zoningDistrictId);
  if (explicit) return explicit;
  if (parcel.zoningDistrictId === 'residential' || parcel.zoningDistrictId === 'commercial' || parcel.zoningDistrictId === 'industrial') {
    return districtForLegacyZone(parcel.zoningDistrictId);
  }
  return undefined;
}
