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
      const legalUses = typology.permittedUses.filter((use) => permitted.has(use));
      if (legalUses.length === 0) continue;
      const heightStoryLimit = Math.floor(envelope.maxHeightMeters / typology.floorToFloorHeightMeters);
      const maxStories = Math.min(envelope.maxStories, heightStoryLimit);
      if (maxStories < 1) continue;

      for (const utilization of UTILIZATION_TARGETS) {
        const targetGFA = envelope.maxGrossFloorAreaM2 * utilization;
        const preferredStories = Math.max(1, Math.min(maxStories, typology.preferredStories));
        const footprintArea = Math.min(envelope.maxFootprintAreaM2, targetGFA / preferredStories);
        if (footprintArea <= EPSILON) continue;
        const stories = Math.max(1, Math.min(maxStories, Math.ceil(targetGFA / footprintArea)));
        const grossFloorAreaM2 = Math.min(targetGFA, footprintArea * stories, envelope.maxGrossFloorAreaM2);
        const actualFootprintArea = Math.min(footprintArea, grossFloorAreaM2);
        const footprint = scaledFootprint(envelope.buildableFootprint, actualFootprintArea);
        const realizedFootprintArea = polygonArea(footprint);
        const usableFloorAreaM2 = grossFloorAreaM2 * typology.efficiencyRatio;
        const floors = createFloors(
          stories,
          grossFloorAreaM2,
          usableFloorAreaM2,
          typology.floorToFloorHeightMeters,
          legalUses,
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
          id: `candidate:${parcel.id}:${typology.id}:${Math.round(utilization * 100)}`,
          parcelIds: Object.freeze([parcel.id]),
          typologyId: typology.id,
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

    return Object.freeze(candidates.sort((a, b) => a.id.localeCompare(b.id)));
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
  legalUses: readonly UseType[],
): readonly BuildingFloor[] {
  const floors: BuildingFloor[] = [];
  let remainingGross = grossFloorAreaM2;
  let remainingUsable = usableFloorAreaM2;
  for (let level = 1; level <= stories; level += 1) {
    const remainingFloors = stories - level + 1;
    const grossAreaM2 = level === stories ? remainingGross : grossFloorAreaM2 / stories;
    const usableAreaM2 = level === stories ? remainingUsable : usableFloorAreaM2 / stories;
    const use = useForFloor(level, stories, legalUses);
    const allocation: FloorUseAllocation = Object.freeze({ use, floorAreaM2: usableAreaM2 });
    floors.push(Object.freeze({
      level,
      elevationMeters: (level - 1) * floorHeight,
      grossAreaM2,
      usableAreaM2,
      uses: Object.freeze([allocation]),
    }));
    remainingGross -= grossAreaM2;
    remainingUsable -= usableAreaM2;
    if (remainingFloors <= 1) break;
  }
  return Object.freeze(floors);
}

function useForFloor(level: number, stories: number, legalUses: readonly UseType[]): UseType {
  if (legalUses.length === 1) return legalUses[0]!;
  if (level === 1 && legalUses.includes('retail')) return 'retail';
  const upper = legalUses.filter((use) => use !== 'retail');
  if (upper.length === 0) return legalUses[0]!;
  if (upper.includes('residential') && upper.includes('office')) {
    return level <= Math.max(2, Math.floor(stories * 0.35)) ? 'office' : 'residential';
  }
  return upper[0]!;
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
  if (typology.permittedUses.length === 0) throw new Error(`typology ${typology.id} must permit at least one use`);
  if (!Number.isFinite(typology.preferredStories) || typology.preferredStories < 1) throw new Error(`invalid preferred stories for ${typology.id}`);
  if (!Number.isFinite(typology.floorToFloorHeightMeters) || typology.floorToFloorHeightMeters <= 0) throw new Error(`invalid floor height for ${typology.id}`);
  if (!Number.isFinite(typology.efficiencyRatio) || typology.efficiencyRatio <= 0 || typology.efficiencyRatio > 1) throw new Error(`invalid efficiency for ${typology.id}`);
}
