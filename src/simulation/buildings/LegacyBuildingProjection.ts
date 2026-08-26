import { getBuildingDefinition } from '../../data/buildings.ts';
import {
  LEGACY_CELL_SIZE_METERS,
  normalizePoint,
  polygonArea,
  polygonCentroid,
  type PolygonRing,
} from '../../world/cadastre/Geometry.ts';
import type { Parcel } from '../../world/cadastre/CadastralTypes.ts';
import type { UseType } from '../zoning/ZoningTypes.ts';
import type { Building } from './BuildingSystem.ts';
import type {
  BuildingFloor,
  BuildingTypology,
  DevelopmentCandidate,
  FloorUseAllocation,
} from './BuildingTypes.ts';

const EPSILON = 1e-9;

/**
 * Reconstructs a deterministic physical representation for a pre-Urban-Fabric
 * building. This deliberately does not apply current zoning as a creation
 * filter: existing structures are projected first, then compliance is
 * evaluated separately so they can survive as legal nonconforming stock.
 */
export function projectLegacyBuildingCandidate(
  building: Building,
  parcel: Parcel,
  typology: BuildingTypology,
): DevelopmentCandidate {
  const definition = getBuildingDefinition(building.definitionId);
  if (definition.zone !== building.zone) throw new Error(`legacy building zone mismatch: ${building.id}`);
  if (typology.legacyDefinitionId !== building.definitionId) {
    throw new Error(`legacy building typology mismatch: ${building.id}`);
  }
  if (!Number.isFinite(parcel.areaM2) || parcel.areaM2 <= 0) throw new Error(`invalid parcel area: ${parcel.id}`);

  const sourceFootprint = legacyCellFootprint(building.x, building.y);
  const sourceAreaM2 = polygonArea(sourceFootprint);
  const grossFloorAreaM2 = legacyReferenceAreaM2(definition.residentCapacity, definition.jobCapacity);
  const stories = Math.max(
    1,
    Math.ceil(typology.preferredStories),
    Math.ceil(grossFloorAreaM2 / sourceAreaM2),
  );
  const targetFootprintAreaM2 = Math.min(sourceAreaM2, grossFloorAreaM2 / stories);
  const footprint = scaledFootprint(sourceFootprint, targetFootprintAreaM2);
  const realizedFootprintAreaM2 = polygonArea(footprint);
  const usableFloorAreaM2 = grossFloorAreaM2 * typology.efficiencyRatio;
  const useMix = normalizedUseMix(typology);
  const floors = createFloors(
    stories,
    grossFloorAreaM2,
    usableFloorAreaM2,
    typology.floorToFloorHeightMeters,
    useMix,
  );
  const uses = uniqueUses(floors);

  return Object.freeze({
    id: `legacy-projection:${building.id}`,
    parcelIds: Object.freeze([parcel.id]),
    typologyId: typology.id,
    targetUtilization: 1,
    footprint,
    grossFloorAreaM2,
    usableFloorAreaM2,
    heightMeters: stories * typology.floorToFloorHeightMeters,
    stories,
    realizedFAR: grossFloorAreaM2 / parcel.areaM2,
    coverageRatio: realizedFootprintAreaM2 / parcel.areaM2,
    floors,
    uses,
    zoningLegal: false,
  });
}

function legacyReferenceAreaM2(residentCapacity: number, jobCapacity: number): number {
  const residentialArea = Math.max(0, residentCapacity) * 32;
  const jobArea = Math.max(0, jobCapacity) * 28;
  return Math.max(120, residentialArea + jobArea);
}

function legacyCellFootprint(x: number, y: number): PolygonRing {
  const minX = x * LEGACY_CELL_SIZE_METERS;
  const minY = y * LEGACY_CELL_SIZE_METERS;
  const maxX = minX + LEGACY_CELL_SIZE_METERS;
  const maxY = minY + LEGACY_CELL_SIZE_METERS;
  return Object.freeze([
    Object.freeze({ x: minX, y: minY }),
    Object.freeze({ x: maxX, y: minY }),
    Object.freeze({ x: maxX, y: maxY }),
    Object.freeze({ x: minX, y: maxY }),
  ]);
}

function scaledFootprint(source: PolygonRing, targetAreaM2: number): PolygonRing {
  const sourceAreaM2 = polygonArea(source);
  if (sourceAreaM2 <= EPSILON) throw new Error('legacy source footprint must have positive area');
  if (!Number.isFinite(targetAreaM2) || targetAreaM2 <= EPSILON) throw new Error('legacy target footprint must have positive area');
  const scale = Math.min(1, Math.sqrt(targetAreaM2 / sourceAreaM2));
  const centroid = polygonCentroid(source);
  return Object.freeze(source.map((point) => normalizePoint({
    x: centroid.x + (point.x - centroid.x) * scale,
    y: centroid.y + (point.y - centroid.y) * scale,
  })));
}

function normalizedUseMix(typology: BuildingTypology): Readonly<Partial<Record<UseType, number>>> {
  const weighted: Partial<Record<UseType, number>> = {};
  let total = 0;
  for (const use of typology.allowedUses) {
    const weight = typology.defaultUseMix[use] ?? 0;
    if (!Number.isFinite(weight) || weight < 0) throw new Error(`invalid use mix for ${typology.id}:${use}`);
    if (weight > 0) {
      weighted[use] = weight;
      total += weight;
    }
  }
  if (total <= EPSILON) return Object.freeze({ [typology.primaryUse]: 1 });
  for (const use of Object.keys(weighted) as UseType[]) weighted[use] = weighted[use]! / total;
  return Object.freeze(weighted);
}

function createFloors(
  stories: number,
  grossFloorAreaM2: number,
  usableFloorAreaM2: number,
  floorHeightMeters: number,
  useMix: Readonly<Partial<Record<UseType, number>>>,
): readonly BuildingFloor[] {
  const floors: BuildingFloor[] = [];
  let remainingGross = grossFloorAreaM2;
  let remainingUsable = usableFloorAreaM2;
  for (let level = 1; level <= stories; level += 1) {
    const remainingStories = stories - level + 1;
    const floorGross = level === stories ? remainingGross : remainingGross / remainingStories;
    const floorUsable = level === stories ? remainingUsable : remainingUsable / remainingStories;
    floors.push(Object.freeze({
      level,
      elevationMeters: (level - 1) * floorHeightMeters,
      grossAreaM2: floorGross,
      usableAreaM2: floorUsable,
      uses: allocationsForArea(floorUsable, useMix),
    }));
    remainingGross -= floorGross;
    remainingUsable -= floorUsable;
  }
  return Object.freeze(floors);
}

function allocationsForArea(
  usableAreaM2: number,
  useMix: Readonly<Partial<Record<UseType, number>>>,
): readonly FloorUseAllocation[] {
  const entries = Object.entries(useMix)
    .filter((entry): entry is [UseType, number] => typeof entry[1] === 'number' && entry[1] > 0)
    .sort(([left], [right]) => left.localeCompare(right));
  const allocations: FloorUseAllocation[] = [];
  let remaining = usableAreaM2;
  for (let index = 0; index < entries.length; index += 1) {
    const [use, share] = entries[index]!;
    const floorAreaM2 = index === entries.length - 1 ? remaining : usableAreaM2 * share;
    allocations.push(Object.freeze({ use, floorAreaM2 }));
    remaining -= floorAreaM2;
  }
  return Object.freeze(allocations);
}

function uniqueUses(floors: readonly BuildingFloor[]): readonly UseType[] {
  return Object.freeze([...new Set(
    floors.flatMap((floor) => floor.uses.map((allocation) => allocation.use)),
  )].sort());
}
