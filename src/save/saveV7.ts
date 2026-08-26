import type { SimulationCore } from '../simulation/core/SimulationCore.ts';
import type { DeveloperMarketStateSnapshot } from '../simulation/development/DevelopmentTypes.ts';
import type { DevelopmentPolicyState } from '../simulation/development/DevelopmentPolicySystem.ts';
import type { HousingRelocationState } from '../simulation/housing/HousingRelocationSystem.ts';
import { hydrateCoreV6, serializeCoreV6, type SaveV6 } from './saveV6.ts';

export type SaveV7 = Omit<SaveV6, 'saveVersion' | 'gameVersion'> & {
  saveVersion: 7;
  gameVersion: '0.7.0-metropolitan';
  developmentMarket: DeveloperMarketStateSnapshot;
  developmentPolicy?: DevelopmentPolicyState;
  housingState?: HousingRelocationState;
};

export function serializeCoreV7(core: SimulationCore): SaveV7 {
  const v6 = serializeCoreV6(core);
  return {
    ...v6,
    saveVersion: 7,
    gameVersion: '0.7.0-metropolitan',
    developmentMarket: core.developerMarket.snapshotState(),
    developmentPolicy: core.developmentPolicySnapshot,
    housingState: core.housingRelocation.snapshotState(),
  };
}

export function hydrateCoreV7(input: unknown): SimulationCore {
  if (!isRecord(input)) throw new Error('save must be an object');
  if (input.saveVersion !== 7) {
    const core = hydrateCoreV6(input);
    core.restoreHousingState();
    core.rebuildCadastreFromLegacyState();
    return core;
  }
  validateEnvelope(input);
  const save = input as unknown as SaveV7;
  const { developmentMarket, developmentPolicy, housingState, ...v7WithoutDevelopment } = save;
  const v6: SaveV6 = {
    ...v7WithoutDevelopment,
    saveVersion: 6,
    gameVersion: '0.6.0-metropolitan',
  };
  const core = hydrateCoreV6(v6);
  validateDevelopmentReferences(core, developmentMarket);
  core.developerMarket.restoreState(developmentMarket);
  if (developmentPolicy !== undefined) core.setDevelopmentPolicy(developmentPolicy);
  core.restoreHousingState(housingState);
  core.rebuildCadastreFromLegacyState();
  return core;
}

function validateEnvelope(record: Record<string, unknown>): void {
  if (record.gameVersion !== '0.7.0-metropolitan') throw new Error('invalid V7 game version');
  const development = requireRecord(record.developmentMarket, 'developmentMarket');
  if (!Array.isArray(development.developers)) throw new Error('developmentMarket.developers must be an array');
  if (!Array.isArray(development.commitments)) throw new Error('developmentMarket.commitments must be an array');
  if (record.developmentPolicy !== undefined) requireRecord(record.developmentPolicy, 'developmentPolicy');
  if (record.housingState !== undefined) {
    const housing = requireRecord(record.housingState, 'housingState');
    if (!Array.isArray(housing.allocations)) throw new Error('housingState.allocations must be an array');
    if (!Array.isArray(housing.unplaced)) throw new Error('housingState.unplaced must be an array');
    requireRecord(housing.totals, 'housingState.totals');
  }
}

function validateDevelopmentReferences(core: SimulationCore, state: DeveloperMarketStateSnapshot): void {
  const developerIds = new Set(state.developers.map((developer) => developer.id));
  const buildings = new Map(core.buildings.list().map((building) => [building.id, building] as const));
  for (const commitment of state.commitments) {
    if (!developerIds.has(commitment.developerId)) throw new Error('invalid development developer reference');
    const building = buildings.get(commitment.buildingId);
    if (!building) throw new Error('invalid development building reference');
    if (building.lotId !== commitment.lotId) throw new Error('invalid development lot reference');
    if (building.definitionId !== commitment.definitionId) throw new Error('invalid development definition reference');
    if (building.developerId && building.developerId !== commitment.developerId) throw new Error('invalid development building owner reference');
  }
}

function requireRecord(value: unknown, name: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${name} must be an object`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
