import type { AssetManifestEntry, AssetOrientation } from '../assets/AssetTypes.ts';
import { resolveVariantEntry, selectWeightedVariantKey } from '../assets/VariantSelector.ts';
import type { PublicRealmDescriptor, PublicRealmProfile } from './PublicRealmTypes.ts';
import { rotateWorldFacing } from './PublicRealmVisualResolver.ts';

export type PublicRealmAssetCatalog = Readonly<{
  byVariantKey: ReadonlyMap<string, readonly AssetManifestEntry[]>;
  bySubcategory: ReadonlyMap<string, readonly string[]>;
}>;

export type PublicRealmVisualSelection = Readonly<{
  surface: readonly AssetManifestEntry[];
  vertical: readonly AssetManifestEntry[];
}>;

const SURFACE_FAMILIES: Readonly<Record<PublicRealmProfile, readonly string[]>> = Object.freeze({
  'urban-core': Object.freeze(['realm_sidewalk_paver_01', 'realm_plaza_concrete_01']),
  'main-street': Object.freeze(['realm_sidewalk_concrete_01', 'realm_sidewalk_paver_01']),
  'residential-green': Object.freeze(['realm_sidewalk_concrete_01', 'realm_grass_verge_01']),
  'suburban-auto-oriented': Object.freeze(['realm_permeable_pavers_01', 'realm_grass_verge_01']),
  'industrial-logistics': Object.freeze(['realm_plaza_concrete_01', 'realm_sidewalk_concrete_01']),
  'civic-public-space': Object.freeze(['realm_plaza_stone_01', 'realm_plaza_concrete_01']),
});

const ACCESS_FAMILIES: Readonly<Record<PublicRealmProfile, readonly string[]>> = Object.freeze({
  'urban-core': Object.freeze(['realm_curb_standard_01', 'realm_curb_ramp_01']),
  'main-street': Object.freeze(['realm_curb_standard_01', 'realm_curb_ramp_01']),
  'residential-green': Object.freeze(['realm_curb_standard_01', 'realm_curb_ramp_01']),
  'suburban-auto-oriented': Object.freeze(['realm_parking_lot_entrance_01', 'realm_curb_standard_01']),
  'industrial-logistics': Object.freeze(['realm_service_apron_01', 'realm_loading_apron_01']),
  'civic-public-space': Object.freeze(['realm_curb_ramp_01', 'realm_curb_standard_01']),
});

const VEGETATION_FAMILIES: Readonly<Record<PublicRealmProfile, readonly string[]>> = Object.freeze({
  'urban-core': Object.freeze(['realm_tree_pit_01', 'realm_tree_pit_02', 'realm_tree_ornamental_01']),
  'main-street': Object.freeze(['realm_tree_mature_01', 'realm_tree_mature_02', 'realm_tree_pit_01']),
  'residential-green': Object.freeze(['realm_tree_mature_02', 'realm_tree_mature_03', 'realm_tree_young_01']),
  'suburban-auto-oriented': Object.freeze(['realm_tree_ornamental_02', 'realm_hedge_01', 'realm_tree_young_02']),
  'industrial-logistics': Object.freeze(['realm_median_planting_01', 'realm_hedge_02']),
  'civic-public-space': Object.freeze(['realm_tree_ornamental_01', 'realm_tree_mature_04', 'realm_tree_pit_02']),
});

const FURNITURE_FAMILIES: Readonly<Record<PublicRealmProfile, readonly string[]>> = Object.freeze({
  'urban-core': Object.freeze(['realm_ped_lamp_01', 'realm_bench_01', 'realm_planter_01']),
  'main-street': Object.freeze(['realm_ped_lamp_01', 'realm_bench_01', 'realm_planter_01']),
  'residential-green': Object.freeze(['realm_road_lamp_01', 'realm_hydrant_01', 'realm_bench_01']),
  'suburban-auto-oriented': Object.freeze(['realm_road_lamp_01', 'realm_hydrant_01']),
  'industrial-logistics': Object.freeze(['realm_road_lamp_01', 'realm_bollards_01']),
  'civic-public-space': Object.freeze(['realm_ped_lamp_01', 'realm_bench_01', 'realm_bollards_01']),
});

const ACCENT_FAMILIES: Readonly<Record<PublicRealmProfile, readonly string[]>> = Object.freeze({
  'urban-core': Object.freeze(['realm_small_square_01', 'realm_commercial_forecourt_01']),
  'main-street': Object.freeze(['realm_cafe_market_01', 'realm_cafe_market_02', 'realm_commercial_forecourt_02']),
  'residential-green': Object.freeze(['realm_pocket_plaza_01']),
  'suburban-auto-oriented': Object.freeze([]),
  'industrial-logistics': Object.freeze([]),
  'civic-public-space': Object.freeze(['realm_civic_forecourt_01', 'realm_civic_forecourt_02', 'realm_fountain_plinth_01']),
});

export function buildPublicRealmAssetCatalog(entries: readonly AssetManifestEntry[]): PublicRealmAssetCatalog {
  const byVariantKey = new Map<string, AssetManifestEntry[]>();
  const subcategorySets = new Map<string, Set<string>>();
  for (const entry of entries) {
    if (entry.category !== 'public-realm') continue;
    const family = byVariantKey.get(entry.variantKey) ?? [];
    family.push(entry);
    byVariantKey.set(entry.variantKey, family);
    const subcategory = entry.subcategory ?? '';
    const names = subcategorySets.get(subcategory) ?? new Set<string>();
    names.add(entry.variantKey);
    subcategorySets.set(subcategory, names);
  }
  const frozenByVariant = new Map<string, readonly AssetManifestEntry[]>();
  for (const [variantKey, family] of byVariantKey) {
    frozenByVariant.set(variantKey, Object.freeze([...family].sort((a, b) => (a.orientation ?? 0) - (b.orientation ?? 0))));
  }
  const frozenBySubcategory = new Map<string, readonly string[]>();
  for (const [subcategory, names] of subcategorySets) {
    frozenBySubcategory.set(subcategory, Object.freeze([...names].sort()));
  }
  return Object.freeze({ byVariantKey: frozenByVariant, bySubcategory: frozenBySubcategory });
}

function chooseFamily(stableKey: string, candidates: readonly string[]): string | undefined {
  if (candidates.length === 0) return undefined;
  return selectWeightedVariantKey(stableKey, candidates.map((variantKey) => ({ variantKey, weight: 1 })));
}

function resolveFamily(
  stableKey: string,
  candidates: readonly string[],
  descriptor: PublicRealmDescriptor,
  cameraTurns: AssetOrientation,
  catalog: PublicRealmAssetCatalog,
): AssetManifestEntry | undefined {
  const variantKey = chooseFamily(stableKey, candidates);
  if (!variantKey) return undefined;
  const entries = catalog.byVariantKey.get(variantKey) ?? Object.freeze([]);
  const symmetric = entries.some((entry) => entry.tags?.includes('symmetric'));
  const orientation = symmetric ? 0 : rotateWorldFacing(descriptor.context.worldFacing, cameraTurns);
  return resolveVariantEntry(entries, variantKey, orientation);
}

function parkingFamilies(descriptor: PublicRealmDescriptor): readonly string[] {
  if (descriptor.context.kind === 'facility') return Object.freeze([]);
  switch (descriptor.parkingForm) {
    case 'driveway':
      return Object.freeze(['realm_driveway_cut_01']);
    case 'surface-lot-edge':
      return Object.freeze(['realm_parking_surface_01', 'realm_parking_landscaped_edge_01']);
    case 'garage-entry':
      return Object.freeze([
        descriptor.context.typologyId === 'podium_mixed_use'
          ? 'realm_garage_podium_entry_01'
          : 'realm_garage_structured_entry_01',
      ]);
    case 'curbside-dressing':
      return Object.freeze(['realm_curbside_cars_01']);
    default:
      return Object.freeze([]);
  }
}

export function resolvePublicRealmVisual(
  descriptor: PublicRealmDescriptor,
  cameraTurns: AssetOrientation,
  catalog: PublicRealmAssetCatalog,
): PublicRealmVisualSelection {
  const surface: AssetManifestEntry[] = [];
  const vertical: AssetManifestEntry[] = [];

  const baseSurface = resolveFamily(
    descriptor.channelKeys.surface,
    SURFACE_FAMILIES[descriptor.profile],
    descriptor,
    cameraTurns,
    catalog,
  );
  if (baseSurface) surface.push(baseSurface);

  const access = resolveFamily(
    descriptor.channelKeys.access,
    ACCESS_FAMILIES[descriptor.profile],
    descriptor,
    cameraTurns,
    catalog,
  );
  if (access) surface.push(access);

  const vegetation = resolveFamily(
    descriptor.channelKeys.vegetation,
    VEGETATION_FAMILIES[descriptor.profile],
    descriptor,
    cameraTurns,
    catalog,
  );
  if (vegetation) vertical.push(vegetation);

  const furniture = resolveFamily(
    descriptor.channelKeys.furniture,
    FURNITURE_FAMILIES[descriptor.profile],
    descriptor,
    cameraTurns,
    catalog,
  );
  if (furniture) vertical.push(furniture);

  const accent = resolveFamily(
    descriptor.channelKeys.accent,
    ACCENT_FAMILIES[descriptor.profile],
    descriptor,
    cameraTurns,
    catalog,
  );
  if (accent) {
    if (accent.variantKey.startsWith('realm_fountain_plinth_')) vertical.push(accent);
    else surface.push(accent);
  }

  for (const variantKey of parkingFamilies(descriptor)) {
    const entries = catalog.byVariantKey.get(variantKey) ?? Object.freeze([]);
    const orientation = rotateWorldFacing(descriptor.context.worldFacing, cameraTurns);
    const entry = resolveVariantEntry(entries, variantKey, orientation);
    if (!entry) continue;
    if (variantKey.includes('garage_') || variantKey === 'realm_curbside_cars_01') vertical.push(entry);
    else surface.push(entry);
  }

  return Object.freeze({ surface: Object.freeze(surface), vertical: Object.freeze(vertical) });
}
