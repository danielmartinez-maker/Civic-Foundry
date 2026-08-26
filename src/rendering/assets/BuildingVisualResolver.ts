import type { BuildingV2 } from '../../simulation/buildings/BuildingTypes.ts';
import type { AssetManifestEntry } from './AssetTypes.ts';
import { PASS_A_BUILDING_VARIANTS } from './PassAAssetManifest.ts';
import { PASS_B1_MIXED_USE_FAMILIES } from './PassB1AssetManifest.ts';

type BuildingCondition = NonNullable<AssetManifestEntry['condition']>;
type LegacyZone = 'residential' | 'commercial' | 'industrial';
type LegacyIntensity = 'low' | 'medium' | 'high';

const LEGACY_TYPOLOGY_PRESENTATION: Readonly<Record<string, readonly [LegacyZone, LegacyIntensity]>> = Object.freeze({
  'typology:residential_cottage': ['residential', 'low'],
  'typology:residential_rowhouse': ['residential', 'medium'],
  'typology:residential_apartment': ['residential', 'high'],
  'typology:commercial_shop': ['commercial', 'low'],
  'typology:commercial_block': ['commercial', 'medium'],
  'typology:commercial_office': ['commercial', 'high'],
  'typology:industrial_workshop': ['industrial', 'low'],
  'typology:industrial_warehouse': ['industrial', 'medium'],
  'typology:industrial_plant': ['industrial', 'high'],
});

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function selectStableFamily(id: string, candidates: readonly string[]): string {
  if (candidates.length === 0) return PASS_A_BUILDING_VARIANTS[0][0];
  return candidates[stableHash(id) % candidates.length]!;
}

function isMixedUseTypology(typologyId: string): boolean {
  return PASS_B1_MIXED_USE_FAMILIES.some(([, candidateTypology]) => candidateTypology === typologyId);
}

export function buildingConditionFor(
  building: Pick<BuildingV2, 'status' | 'lifecycle'>,
): BuildingCondition {
  if (building.status === 'abandoned') return 'abandoned';
  const exteriorCondition = building.lifecycle.exteriorCondition;
  if (exteriorCondition >= 90) return 'new';
  if (exteriorCondition >= 70) return 'maintained';
  if (exteriorCondition >= 45) return 'aging';
  if (exteriorCondition >= 20) return 'neglected';
  return 'abandoned';
}

export function buildingVisualFamily(
  building: Pick<BuildingV2, 'id' | 'typologyId'>,
): string {
  if (isMixedUseTypology(building.typologyId)) {
    const candidates = PASS_B1_MIXED_USE_FAMILIES
      .filter(([, typologyId]) => typologyId === building.typologyId)
      .map(([family]) => family);
    return selectStableFamily(building.id, candidates);
  }

  const legacy = LEGACY_TYPOLOGY_PRESENTATION[building.typologyId];
  if (!legacy) return selectStableFamily(building.id, PASS_A_BUILDING_VARIANTS.map(([family]) => family));
  const [zone, intensity] = legacy;
  const candidates = PASS_A_BUILDING_VARIANTS
    .filter(([, candidateZone, candidateIntensity]) => candidateZone === zone && candidateIntensity === intensity)
    .map(([family]) => family);
  return selectStableFamily(building.id, candidates);
}

export function buildingVariantKey(
  building: Pick<BuildingV2, 'id' | 'typologyId' | 'status' | 'lifecycle'>,
): string {
  const family = buildingVisualFamily(building);
  const condition = buildingConditionFor(building);
  if (!isMixedUseTypology(building.typologyId) && condition === 'maintained') return family;
  return `${family}__${condition}`;
}
