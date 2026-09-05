import type { BuildingV2 } from '../../simulation/buildings/BuildingTypes.ts';
import type { AssetManifestEntry, AssetOrientation } from './AssetTypes.ts';
import { PASS_A_BUILDING_VARIANTS } from './PassAAssetManifest.ts';
import { PASS_B1_MIXED_USE_FAMILIES } from './PassB1AssetManifest.ts';
import { resolveVariantEntry, selectWeightedVariantKey } from './VariantSelector.ts';

type BuildingCondition = NonNullable<AssetManifestEntry['condition']>;
type LegacyZone = 'residential' | 'commercial' | 'industrial';
type LegacyIntensity = 'low' | 'medium' | 'high';
type LegacyPresentation = readonly [LegacyZone, LegacyIntensity, string];

const LEGACY_TYPOLOGY_PRESENTATION: Readonly<Record<string, LegacyPresentation>> = Object.freeze({
  'typology:residential_cottage': ['residential', 'low', 'residential_cottage'],
  'typology:residential_rowhouse': ['residential', 'medium', 'residential_rowhouse'],
  'typology:residential_apartment': ['residential', 'high', 'residential_apartment'],
  'typology:commercial_shop': ['commercial', 'low', 'commercial_shop'],
  'typology:commercial_block': ['commercial', 'medium', 'commercial_block'],
  'typology:commercial_office': ['commercial', 'high', 'commercial_office'],
  'typology:industrial_workshop': ['industrial', 'low', 'industrial_workshop'],
  'typology:industrial_warehouse': ['industrial', 'medium', 'industrial_warehouse'],
  'typology:industrial_plant': ['industrial', 'high', 'industrial_plant'],
});

function selectStableFamily(stableKey: string, candidates: readonly string[]): string {
  if (candidates.length === 0) return PASS_A_BUILDING_VARIANTS[0][0];
  return selectWeightedVariantKey(stableKey, candidates.map((variantKey) => ({ variantKey, weight: 1 })));
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
  const [zone, intensity, definitionId] = legacy;
  const candidates = PASS_A_BUILDING_VARIANTS
    .filter(([, candidateZone, candidateIntensity]) => candidateZone === zone && candidateIntensity === intensity)
    .map(([family]) => family);
  return selectStableFamily(`${building.id}|${definitionId}`, candidates);
}

export function buildingVariantKey(
  building: Pick<BuildingV2, 'id' | 'typologyId' | 'status' | 'lifecycle'>,
): string {
  const family = buildingVisualFamily(building);
  const condition = buildingConditionFor(building);
  if (!isMixedUseTypology(building.typologyId) && condition === 'maintained') return family;
  return `${family}__${condition}`;
}

export function selectBuildingVisualEntry(
  building: Pick<BuildingV2, 'id' | 'typologyId' | 'status' | 'lifecycle'>,
  orientation: AssetOrientation,
  entries: readonly AssetManifestEntry[],
): AssetManifestEntry | undefined {
  return resolveVariantEntry(entries, buildingVariantKey(building), orientation);
}
