import type { BuildingV2 } from '../simulation/buildings/BuildingTypes.ts';
import type { SimulationCore } from '../simulation/core/SimulationCore.ts';
import type { PropertyMarketSnapshot } from '../simulation/development/PropertyMarketSystem.ts';
import type { ParcelZoningAssignment } from '../simulation/zoning/ZoningTypes.ts';
import type { CadastralSnapshot } from '../world/cadastre/CadastralTypes.ts';
import { hydrateCoreV8, serializeCoreV8, type SaveV8 } from './saveV8.ts';

export type SaveV9 = Omit<SaveV8, 'saveVersion' | 'gameVersion'> & Readonly<{
  saveVersion: 9;
  gameVersion: '0.9.0-urban-fabric';
  urbanFabric: CadastralSnapshot;
  zoningV2: Readonly<{
    parcelAssignments: readonly ParcelZoningAssignment[];
  }>;
  buildingsV2: readonly BuildingV2[];
  propertyMarket: PropertyMarketSnapshot;
}>;

export function serializeCoreV9(core: SimulationCore, baseV8: SaveV8 = serializeCoreV8(core)): SaveV9 {
  return {
    ...baseV8,
    saveVersion: 9,
    gameVersion: '0.9.0-urban-fabric',
    urbanFabric: core.cadastre.snapshot(),
    zoningV2: Object.freeze({
      parcelAssignments: core.zoning.listParcelAssignments(),
    }),
    buildingsV2: core.buildings.listV2(),
    propertyMarket: core.propertyMarket.snapshot(),
  };
}

export function hydrateCoreV9(input: unknown): SimulationCore {
  if (!isRecord(input) || input.saveVersion !== 9) return hydrateCoreV8(input);
  if (input.gameVersion !== '0.9.0-urban-fabric') throw new Error('invalid V9 game version');
  if (!isRecord(input.urbanFabric)) throw new Error('urbanFabric must be an object');
  if (!isRecord(input.zoningV2) || !Array.isArray(input.zoningV2.parcelAssignments)) {
    throw new Error('zoningV2 parcel assignments must be an array');
  }
  if (!Array.isArray(input.buildingsV2)) throw new Error('buildingsV2 must be an array');
  if (!isRecord(input.propertyMarket)) throw new Error('propertyMarket must be an object');

  const save = input as unknown as SaveV9;
  const {
    urbanFabric: _urbanFabric,
    zoningV2: _zoningV2,
    buildingsV2: _buildingsV2,
    propertyMarket: _propertyMarket,
    ...withoutUrbanFabric
  } = save;
  const v8: SaveV8 = {
    ...withoutUrbanFabric,
    saveVersion: 8,
    gameVersion: '0.8.0-world-foundation',
  };
  const core = hydrateCoreV8(v8);

  core.cadastre.replaceSnapshot(save.urbanFabric);
  validateUrbanFabricReferences(core, save.zoningV2.parcelAssignments, save.buildingsV2, save.propertyMarket);
  core.zoning.restoreParcelAssignments(save.zoningV2.parcelAssignments);
  core.buildings.restoreV2(save.buildingsV2);
  core.propertyMarket.restore(save.propertyMarket);
  return core;
}

function validateUrbanFabricReferences(
  core: SimulationCore,
  assignments: readonly ParcelZoningAssignment[],
  buildings: readonly BuildingV2[],
  propertyMarket: PropertyMarketSnapshot,
): void {
  const requireParcel = (parcelId: string, source: string): void => {
    if (!core.cadastre.getParcel(parcelId)) throw new Error(`${source} references missing parcel: ${parcelId}`);
  };

  for (const assignment of assignments) requireParcel(assignment.parcelId, 'zoning assignment');
  for (const building of buildings) {
    for (const parcelId of building.parcelIds) requireParcel(parcelId, `building ${building.id}`);
  }
  for (const holding of propertyMarket.holdings) requireParcel(holding.parcelId, 'property holding');
  for (const transaction of propertyMarket.transactions) {
    for (const parcelId of transaction.parcelIds) requireParcel(parcelId, `property transaction ${transaction.id}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
