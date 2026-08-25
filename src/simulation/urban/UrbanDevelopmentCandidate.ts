import type { BuildingDefinition } from '../../data/buildings.ts';
import { getBuildingDefinition } from '../../data/buildings.ts';
import {
  PARKING_PROFILE_DEFINITIONS,
  PARKING_RANK,
  QUALITY_RANK,
  deterministicParkingSpaces,
} from '../../data/urbanFabric.ts';
import { URBAN_PROTOTYPE_BY_DEFINITION_ID } from '../../data/urbanPrototypes.ts';
import type { BuildingQualityTier, PrivateParkingProfile, UrbanUseComponent } from './UrbanTypes.ts';

export type DevelopmentParkingProfile = Exclude<PrivateParkingProfile, 'legacy-none'>;

export type UrbanDevelopmentCandidate = Readonly<{
  definitionId: string;
  qualityTier: BuildingQualityTier;
  parkingProfile: DevelopmentParkingProfile;
  parkingSpaces: number;
  useMixKey: string;
}>;

const QUALITY_ORDER = (Object.keys(QUALITY_RANK) as BuildingQualityTier[])
  .slice()
  .sort((a, b) => QUALITY_RANK[a] - QUALITY_RANK[b]);
const PARKING_ORDER = (Object.keys(PARKING_RANK) as PrivateParkingProfile[])
  .filter((profile): profile is DevelopmentParkingProfile => profile !== 'legacy-none')
  .sort((a, b) => PARKING_RANK[a] - PARKING_RANK[b]);

function singleUseComponents(definition: BuildingDefinition): readonly UrbanUseComponent[] {
  return Object.freeze([Object.freeze({
    use: definition.zone,
    areaShareBps: 10_000,
    residentCapacity: definition.residentCapacity,
    jobCapacity: definition.jobCapacity,
    taxBase: definition.taxBase,
  })]);
}

export function urbanComponentsForDefinition(definitionId: string): readonly UrbanUseComponent[] {
  const prototype = URBAN_PROTOTYPE_BY_DEFINITION_ID[definitionId];
  if (prototype) return prototype.components;
  return singleUseComponents(getBuildingDefinition(definitionId));
}

function rawParkingBaseline(definitionId: string): number {
  return urbanComponentsForDefinition(definitionId).reduce((sum, component) => {
    if (component.use === 'residential') return sum + component.residentCapacity * 0.20;
    if (component.use === 'commercial') return sum + component.jobCapacity * 0.35;
    return sum + component.jobCapacity * 0.20;
  }, 0);
}

export function baselineParkingSpacesForDefinition(definitionId: string): number {
  return deterministicParkingSpaces(rawParkingBaseline(definitionId));
}

export function parkingSpacesForProfile(definitionId: string, profile: DevelopmentParkingProfile): number {
  return deterministicParkingSpaces(rawParkingBaseline(definitionId) * PARKING_PROFILE_DEFINITIONS[profile].spaceMultiplier);
}

export function useMixKeyForDefinition(definitionId: string): string {
  const components = urbanComponentsForDefinition(definitionId)
    .slice()
    .sort((a, b) => a.use.localeCompare(b.use) || a.areaShareBps - b.areaShareBps);
  return [
    definitionId,
    ...components.map((component) => [
      component.use,
      component.areaShareBps,
      component.residentCapacity,
      component.jobCapacity,
      component.taxBase,
    ].join(':')),
  ].join('|');
}

export function compareUrbanDevelopmentCandidates(a: UrbanDevelopmentCandidate, b: UrbanDevelopmentCandidate): number {
  return a.definitionId.localeCompare(b.definitionId)
    || QUALITY_RANK[a.qualityTier] - QUALITY_RANK[b.qualityTier]
    || PARKING_RANK[a.parkingProfile] - PARKING_RANK[b.parkingProfile]
    || a.useMixKey.localeCompare(b.useMixKey);
}

export function enumerateUrbanCandidates(definitions: readonly BuildingDefinition[]): UrbanDevelopmentCandidate[] {
  const result: UrbanDevelopmentCandidate[] = [];
  for (const definition of definitions.slice().sort((a, b) => a.id.localeCompare(b.id))) {
    const useMixKey = useMixKeyForDefinition(definition.id);
    for (const qualityTier of QUALITY_ORDER) {
      for (const parkingProfile of PARKING_ORDER) {
        result.push(Object.freeze({
          definitionId: definition.id,
          qualityTier,
          parkingProfile,
          parkingSpaces: parkingSpacesForProfile(definition.id, parkingProfile),
          useMixKey,
        }));
      }
    }
  }
  return result.sort(compareUrbanDevelopmentCandidates);
}
