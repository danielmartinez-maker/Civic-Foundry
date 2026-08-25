import { PARKING_RANK, QUALITY_RANK } from '../data/urbanFabric.ts';
import { getUrbanPrototype } from '../data/urbanPrototypes.ts';
import type { SimulationCore } from '../simulation/core/SimulationCore.ts';
import type {
  DeveloperCommitment,
  SemanticDeveloperMarketStateSnapshot,
} from '../simulation/development/DevelopmentTypes.ts';
import { urbanBusinessSiteFromView } from '../simulation/urban/UrbanBuildingView.ts';
import type {
  BuildingQualityTier,
  PrivateParkingProfile,
  RenovationStateSnapshot,
  UrbanFabricStateSnapshot,
} from '../simulation/urban/UrbanTypes.ts';
import { hydrateCoreV7, serializeCoreV7, type SaveV7 } from './saveV7.ts';

export type SaveV8 = Omit<SaveV7, 'saveVersion' | 'gameVersion' | 'developmentMarket'> & Readonly<{
  saveVersion: 8;
  gameVersion: '0.8.0-urban-fabric';
  developmentMarket: SemanticDeveloperMarketStateSnapshot;
  urbanFabricState: UrbanFabricStateSnapshot;
  renovationState: RenovationStateSnapshot;
}>;

type MutableCoreMode = { urbanDevelopmentMode: 'legacy' | 'semantic' };
type DeveloperMarketCommitmentInternals = { commitments: Map<string, DeveloperCommitment> };

export function serializeCoreV8(core: SimulationCore): SaveV8 {
  const v7 = serializeCoreV7(core);
  return {
    ...v7,
    saveVersion: 8,
    gameVersion: '0.8.0-urban-fabric',
    developmentMarket: Object.freeze({
      developers: Object.freeze(core.developerMarket.listDevelopers()),
      commitments: Object.freeze(core.developerMarket.listCommitments()),
    }),
    urbanFabricState: core.urbanFabric.snapshotState(),
    renovationState: core.renovation.snapshotState(),
  };
}

export function hydrateCoreV8(input: unknown): SimulationCore {
  if (!isRecord(input)) throw new Error('save must be an object');
  if (input.saveVersion !== 8) return migrateLegacyToV8(input);

  validateEnvelope(input);
  const save = input as unknown as SaveV8;
  validateSemanticDeveloperState(save.developmentMarket);
  validateCommitmentConflicts(save.developmentMarket, save.renovationState);

  const { urbanFabricState: _urbanFabricState, renovationState: _renovationState, ...v8WithoutUrban } = save;
  const v7: SaveV7 = {
    ...v8WithoutUrban,
    saveVersion: 7,
    gameVersion: '0.7.0-metropolitan',
  };
  const core = hydrateCoreV7(v7);
  setSemanticMode(core);

  const liveBuildingIds = core.buildings.list().map((building) => building.id);
  core.urbanFabric.restoreState(save.urbanFabricState, liveBuildingIds, { requireAllLiveBuildings: true });
  installSemanticDeveloperCommitments(core, save.developmentMarket);
  validateCrossDomainState(core, save);
  core.renovation.restoreState(save.renovationState);

  if (save.housingState !== undefined) core.restoreHousingState(save.housingState);
  else core.restoreHousingState();
  restoreSemanticEconomyContext(core);
  return core;
}

function migrateLegacyToV8(input: unknown): SimulationCore {
  const core = hydrateCoreV7(input);
  const migrationTick = core.clock.tick;
  setSemanticMode(core);
  core.initializeUrbanFabricFromLegacy(migrationTick);
  const housing = core.housingRelocation.snapshotState();
  core.restoreHousingState(housing);
  restoreSemanticEconomyContext(core);
  return core;
}

function setSemanticMode(core: SimulationCore): void {
  const mutable = core as unknown as MutableCoreMode;
  mutable.urbanDevelopmentMode = 'semantic';
}

function restoreSemanticEconomyContext(core: SimulationCore): void {
  const sites = core.urbanBuildingViews()
    .map(urbanBusinessSiteFromView)
    .filter((site) => site.totalJobCapacity > 0);
  core.economyDomain.restoreSemanticDerivedContext(sites);
}

function installSemanticDeveloperCommitments(
  core: SimulationCore,
  state: SemanticDeveloperMarketStateSnapshot,
): void {
  const value = Reflect.get(core.developerMarket, 'commitments');
  if (!(value instanceof Map)) throw new Error('developer market commitment storage unavailable');
  const commitments = value as Map<string, DeveloperCommitment>;
  commitments.clear();
  for (const commitment of state.commitments) {
    commitments.set(commitment.buildingId, Object.freeze({ ...commitment }));
  }
}

function validateEnvelope(record: Record<string, unknown>): void {
  if (record.gameVersion !== '0.8.0-urban-fabric') throw new Error('invalid V8 game version');
  const urban = requireRecord(record.urbanFabricState, 'urbanFabricState');
  if (!Array.isArray(urban.buildings)) throw new Error('urbanFabricState.buildings must be an array');
  const renovation = requireRecord(record.renovationState, 'renovationState');
  if (!Array.isArray(renovation.commitments)) throw new Error('renovationState.commitments must be an array');
  const development = requireRecord(record.developmentMarket, 'developmentMarket');
  if (!Array.isArray(development.developers)) throw new Error('developmentMarket.developers must be an array');
  if (!Array.isArray(development.commitments)) throw new Error('developmentMarket.commitments must be an array');
}

function validateSemanticDeveloperState(state: SemanticDeveloperMarketStateSnapshot): void {
  const developerIds = new Set<string>();
  const committedByDeveloper = new Map<string, number>();
  for (const developer of state.developers) {
    if (!developer.id) throw new Error('developer id is required');
    if (developerIds.has(developer.id)) throw new Error(`duplicate developer id: ${developer.id}`);
    developerIds.add(developer.id);
  }

  const buildingIds = new Set<string>();
  const awardIds = new Set<string>();
  for (const commitment of state.commitments) {
    validateSemanticCommitment(commitment);
    if (!developerIds.has(commitment.developerId)) throw new Error(`unknown development developer: ${commitment.developerId}`);
    if (buildingIds.has(commitment.buildingId)) throw new Error(`duplicate development building commitment: ${commitment.buildingId}`);
    if (awardIds.has(commitment.awardId)) throw new Error(`duplicate development award: ${commitment.awardId}`);
    buildingIds.add(commitment.buildingId);
    awardIds.add(commitment.awardId);
    committedByDeveloper.set(
      commitment.developerId,
      (committedByDeveloper.get(commitment.developerId) ?? 0) + commitment.equity,
    );
  }

  for (const developer of state.developers) {
    const expected = committedByDeveloper.get(developer.id) ?? 0;
    if (Math.abs(expected - developer.committedCapital) > 1e-6) {
      throw new Error(`${developer.id}.committedCapital does not match active commitments`);
    }
  }
}

function validateSemanticCommitment(commitment: DeveloperCommitment): void {
  if (!commitment.awardId || !commitment.buildingId || !commitment.lotId || !commitment.definitionId || !commitment.developerId) {
    throw new Error('development commitment identifiers are required');
  }
  if (!(commitment.qualityTier in QUALITY_RANK)) {
    throw new Error(`invalid quality tier: ${String(commitment.qualityTier)}`);
  }
  if (!(commitment.parkingProfile in PARKING_RANK)) {
    throw new Error(`invalid parking profile: ${String(commitment.parkingProfile)}`);
  }
  if (!Number.isInteger(commitment.parkingSpaces) || commitment.parkingSpaces < 0) {
    throw new Error('parkingSpaces must be a non-negative integer');
  }
  if (commitment.parkingProfile === 'legacy-none' && commitment.parkingSpaces !== 0) {
    throw new Error('legacy-none parking must have zero spaces');
  }
  getUrbanPrototype(commitment.useMixKey);
  for (const [name, value] of [
    ['equity', commitment.equity],
    ['expectedReturn', commitment.expectedReturn],
  ] as const) {
    if (!Number.isFinite(value)) throw new Error(`${commitment.buildingId}.${name} must be finite`);
  }
  if (commitment.equity < 0) throw new Error(`${commitment.buildingId}.equity must be non-negative`);
  for (const [name, value] of [
    ['awardTick', commitment.awardTick],
    ['completionTick', commitment.completionTick],
    ['releaseTick', commitment.releaseTick],
  ] as const) {
    if (!Number.isInteger(value) || value < 0) throw new Error(`${commitment.buildingId}.${name} must be a non-negative integer`);
  }
  if (commitment.completionTick < commitment.awardTick || commitment.releaseTick < commitment.completionTick) {
    throw new Error(`${commitment.buildingId} has invalid development commitment timing`);
  }
}

function validateCommitmentConflicts(
  development: SemanticDeveloperMarketStateSnapshot,
  renovation: RenovationStateSnapshot,
): void {
  const redeveloping = new Set(development.commitments.map((commitment) => commitment.buildingId));
  for (const commitment of renovation.commitments) {
    if (redeveloping.has(commitment.buildingId)) {
      throw new Error(`renovation/redevelopment commitment conflict: ${commitment.buildingId}`);
    }
  }
}

function validateCrossDomainState(core: SimulationCore, save: SaveV8): void {
  const buildings = new Map(core.buildings.list().map((building) => [building.id, building] as const));
  for (const commitment of save.developmentMarket.commitments) {
    const building = buildings.get(commitment.buildingId);
    if (!building) throw new Error('invalid development building reference');
    if (building.lotId !== commitment.lotId) throw new Error('invalid development lot reference');
    if (building.definitionId !== commitment.definitionId) throw new Error('invalid development definition reference');
    if (building.developerId && building.developerId !== commitment.developerId) {
      throw new Error('invalid development building owner reference');
    }
  }

  const occupiedResidents = new Map<string, number>();
  for (const allocation of save.housingState?.allocations ?? []) {
    occupiedResidents.set(
      allocation.buildingId,
      (occupiedResidents.get(allocation.buildingId) ?? 0) + allocation.residents,
    );
  }

  for (const state of save.urbanFabricState.buildings) {
    if (state.lifecycleState !== 'abandoned') continue;
    if ((occupiedResidents.get(state.buildingId) ?? 0) > 1e-9) {
      throw new Error(`abandoned building retains occupied residents: ${state.buildingId}`);
    }
    const firm = core.economyDomain.getFirmAtBuilding(state.buildingId);
    if (firm && firm.status !== 'closed') {
      throw new Error(`abandoned building retains active firm occupancy: ${state.buildingId}`);
    }
  }

  for (const view of core.urbanBuildingViews()) {
    const firm = core.economyDomain.getFirmAtBuilding(view.buildingId);
    if (!firm || firm.status === 'closed') continue;
    if (firm.jobCapacity > view.jobCapacity + 1e-9 || firm.filledJobs > view.jobCapacity + 1e-9) {
      throw new Error(`firm occupancy exceeds semantic job capacity: ${view.buildingId}`);
    }
  }
}

function requireRecord(value: unknown, name: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${name} must be an object`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

void (null as BuildingQualityTier | PrivateParkingProfile | null);
