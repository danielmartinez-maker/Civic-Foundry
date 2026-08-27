import {
  normalizePoint,
  polygonArea,
  polygonCentroid,
  type PolygonRing,
} from '../../world/cadastre/Geometry.ts';
import type { Parcel } from '../../world/cadastre/CadastralTypes.ts';
import { ZoningComplianceSystem } from '../zoning/ZoningComplianceSystem.ts';
import type { ParcelDevelopmentEnvelope, UseType, ZoningCandidate } from '../zoning/ZoningTypes.ts';
import type {
  BuildingFloor,
  BuildingTypology,
  DevelopmentCandidate,
  FloorUseAllocation,
} from './BuildingTypes.ts';

const UTILIZATION_TARGETS = Object.freeze([0.55, 0.75, 0.90, 1.00] as const);
const EPSILON = 1e-9;

export class BuildingMassingSystem {
  private readonly compliance = new ZoningComplianceSystem();

  generate(
    parcel: Parcel,
    envelope: ParcelDevelopmentEnvelope,
    typologies: readonly BuildingTypology[],
  ): readonly DevelopmentCandidate[] {
    if (envelope.parcelId !== parcel.id) throw new Error('parcel and envelope identifiers must match');
    if (envelope.maxGrossFloorAreaM2 <= 0 || envelope.maxFootprintAreaM2 <= 0 || envelope.buildableFootprint.length < 3) {
      return Object.freeze([]);
    }

    const candidates: DevelopmentCandidate[] = [];
    const dedupe = new Set<string>();
    const permitted = new Set(envelope.permittedUses);

    for (const typology of [...typologies].sort((a, b) => a.id.localeCompare(b.id))) {
      validateTypology(typology);
      const legalUses = typology.allowedUses.filter((use) => permitted.has(use));
      if (legalUses.length === 0) continue;
      const useMix = normalizedUseMix(typology, legalUses);
      const heightStoryLimit = Math.floor(envelope.maxHeightMeters / typology.floorToFloorHeightMeters);
      const maxStories = Math.min(envelope.maxStories, typology.maxStories, heightStoryLimit);
      const minStories = Math.max(1, typology.minStories);
      if (maxStories < minStories) continue;

      for (const targetUtilization of UTILIZATION_TARGETS) {
        const targetGFA = envelope.maxGrossFloorAreaM2 * targetUtilization;
        const preferredStories = Math.max(minStories, Math.min(maxStories, typology.preferredStories));
        const footprintArea = Math.min(envelope.maxFootprintAreaM2, targetGFA / preferredStories);
        if (footprintArea <= EPSILON) continue;
        const stories = Math.max(minStories, Math.min(maxStories, Math.ceil(targetGFA / footprintArea)));
        const grossFloorAreaM2 = Math.min(targetGFA, footprintArea * stories, envelope.maxGrossFloorAreaM2);
        const actualFootprintArea = Math.min(footprintArea, grossFloorAreaM2 / stories);
        const footprint = scaledFootprint(envelope.buildableFootprint, actualFootprintArea);
        const realizedFootprintArea = polygonArea(footprint);
        const usableFloorAreaM2 = grossFloorAreaM2 * typology.efficiencyRatio;
        const floors = createFloors(
          stories,
          grossFloorAreaM2,
          usableFloorAreaM2,
          typology.floorToFloorHeightMeters,
          useMix,
        );
        const uses = uniqueUses(floors);
        const realizedFAR = grossFloorAreaM2 / parcel.areaM2;
        const coverageRatio = realizedFootprintArea / parcel.areaM2;
        const heightMeters = stories * typology.floorToFloorHeightMeters;
        const zoningCandidate: ZoningCandidate = {
          footprint,
          realizedFAR,
          coverageRatio,
          heightMeters,
          stories,
          uses,
        };
        const compliance = this.compliance.evaluate(zoningCandidate, envelope);
        if (!compliance.legal) continue;

        const key = candidateKey(typology.id, stories, realizedFootprintArea, floors);
        if (dedupe.has(key)) continue;
        dedupe.add(key);
        candidates.push(Object.freeze({
          id: `candidate:${parcel.id}:${typology.id}:${Math.round(targetUtilization * 100)}`,
          parcelIds: Object.freeze([parcel.id]),
          typologyId: typology.id,
          targetUtilization,
          footprint,
          grossFloorAreaM2,
          usableFloorAreaM2,
          heightMeters,
          stories,
          realizedFAR,
          coverageRatio,
          floors,
          uses,
          zoningLegal: true,
        }));
      }
    }

    return Object.freeze(candidates);
  }
}

function scaledFootprint(source: PolygonRing, targetArea: number): PolygonRing {
  const sourceArea = polygonArea(source);
  if (sourceArea <= EPSILON) throw new Error('buildable footprint must have positive area');
  const scale = Math.min(1, Math.sqrt(targetArea / sourceArea));
  const centroid = polygonCentroid(source);
  return Object.freeze(source.map((point) => normalizePoint({
    x: centroid.x + (point.x - centroid.x) * scale,
    y: centroid.y + (point.y - centroid.y) * scale,
  })));
}

function createFloors(
  stories: number,
  grossFloorAreaM2: number,
  usableFloorAreaM2: number,
  floorHeight: number,
  useMix: Readonly<Partial<Record<UseType, number>>>,
): readonly BuildingFloor[] {
  const floors: BuildingFloor[] = [];
  let remainingGross = grossFloorAreaM2;
  let remainingUsable = usableFloorAreaM2;
  for (let level = 1; level <= stories; level += 1) {
    const remainingFloors = stories - level + 1;
    const grossAreaM2 = level === stories ? remainingGross : grossFloorAreaM2 / stories;
    const usableAreaM2 = level === stories ? remainingUsable : usableFloorAreaM2 / stories;
    const uses = allocationsForArea(usableAreaM2, useMix);
    floors.push(Object.freeze({
      level,
      elevationMeters: (level - 1) * floorHeight,
      grossAreaM2,
      usableAreaM2,
      uses,
    }));
    remainingGross -= grossAreaM2;
    remainingUsable -= usableAreaM2;
    if (remainingFloors <= 1) break;
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

function normalizedUseMix(
  typology: BuildingTypology,
  legalUses: readonly UseType[],
): Readonly<Partial<Record<UseType, number>>> {
  let total = 0;
  const weighted: Partial<Record<UseType, number>> = {};
  for (const use of legalUses) {
    const weight = typology.defaultUseMix[use] ?? 0;
    if (!Number.isFinite(weight) || weight < 0) throw new Error(`invalid use mix for ${typology.id}:${use}`);
    if (weight > 0) {
      weighted[use] = weight;
      total += weight;
    }
  }
  if (total <= EPSILON) {
    const fallback = legalUses.includes(typology.primaryUse) ? typology.primaryUse : legalUses[0]!;
    return Object.freeze({ [fallback]: 1 });
  }
  for (const use of Object.keys(weighted) as UseType[]) weighted[use] = weighted[use]! / total;
  return Object.freeze(weighted);
}

function uniqueUses(floors: readonly BuildingFloor[]): readonly UseType[] {
  return Object.freeze([...new Set(floors.flatMap((floor) => floor.uses.map((allocation) => allocation.use)))].sort());
}

function candidateKey(
  typologyId: string,
  stories: number,
  footprintAreaM2: number,
  floors: readonly BuildingFloor[],
): string {
  const useArea = new Map<UseType, number>();
  for (const floor of floors) {
    for (const allocation of floor.uses) useArea.set(allocation.use, (useArea.get(allocation.use) ?? 0) + allocation.floorAreaM2);
  }
  const useMix = [...useArea.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([use, area]) => `${use}:${Math.round(area * 100)}`)
    .join('|');
  return `${typologyId}:${stories}:${Math.round(footprintAreaM2 * 100)}:${useMix}`;
}

function validateTypology(typology: BuildingTypology): void {
  if (typology.allowedUses.length === 0) throw new Error(`typology ${typology.id} must allow at least one use`);
  if (!typology.allowedUses.includes(typology.primaryUse)) throw new Error(`typology ${typology.id} primary use must be allowed`);
  if (!Number.isInteger(typology.minStories) || typology.minStories < 1) throw new Error(`invalid minimum stories for ${typology.id}`);
  if (!Number.isInteger(typology.maxStories) || typology.maxStories < typology.minStories) throw new Error(`invalid maximum stories for ${typology.id}`);
  if (!Number.isFinite(typology.preferredStories) || typology.preferredStories < typology.minStories || typology.preferredStories > typology.maxStories) {
    throw new Error(`invalid preferred stories for ${typology.id}`);
  }
  if (!Number.isFinite(typology.floorToFloorHeightMeters) || typology.floorToFloorHeightMeters <= 0) throw new Error(`invalid floor height for ${typology.id}`);
  if (!Number.isFinite(typology.efficiencyRatio) || typology.efficiencyRatio <= 0 || typology.efficiencyRatio > 1) throw new Error(`invalid efficiency for ${typology.id}`);
}