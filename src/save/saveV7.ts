import { SimulationCore } from '../simulation/core/SimulationCore.ts';
import { hydrateCoreV6, serializeCoreV6, SAVE_VERSION_V6, type SaveGameV6 } from './saveV6.ts';
import type { DeveloperMarketState } from '../simulation/development/DeveloperMarketSystem.ts';
import type { DevelopmentPolicyState } from '../simulation/development/DevelopmentPolicySystem.ts';
import type { HousingRelocationState } from '../simulation/housing/HousingRelocationSystem.ts';

export const SAVE_VERSION_V7 = '0.7.0-metropolitan' as const;

export type SaveGameV7 = Readonly<{
  version: typeof SAVE_VERSION_V7;
  seed: SaveGameV6['seed'];
  rngState: SaveGameV6['rngState'];
  clock: SaveGameV6['clock'];
  terrain: SaveGameV6['terrain'];
  treasury: SaveGameV6['treasury'];
  roads: SaveGameV6['roads'];
  zoning: SaveGameV6['zoning'];
  buildings: SaveGameV6['buildings'];
  population: SaveGameV6['population'];
  taxes: SaveGameV6['taxes'];
  utilityFacilities: SaveGameV6['utilityFacilities'];
  nextUtilityId: SaveGameV6['nextUtilityId'];
  garbage: SaveGameV6['garbage'];
  tripGenerationRngState: SaveGameV6['tripGenerationRngState'];
  traffic: SaveGameV6['traffic'];
  serviceFacilities: SaveGameV6['serviceFacilities'];
  serviceFunding: SaveGameV6['serviceFunding'];
  serviceFiscalPaymentRatio: SaveGameV6['serviceFiscalPaymentRatio'];
  nextServiceFacilityId: SaveGameV6['nextServiceFacilityId'];
  serviceJobs: SaveGameV6['serviceJobs'];
  nextServiceJobId: SaveGameV6['nextServiceJobId'];
  serviceVehicles: SaveGameV6['serviceVehicles'];
  incidentRngState: SaveGameV6['incidentRngState'];
  incidents: SaveGameV6['incidents'];
  nextIncidentId: SaveGameV6['nextIncidentId'];
  waste: SaveGameV6['waste'];
  transit: SaveGameV6['transit'];
  mobility: SaveGameV6['mobility'];
  firms: SaveGameV6['firms'];
  firmLifecycle: SaveGameV6['firmLifecycle'];
  firmFormationRngState: SaveGameV6['firmFormationRngState'];
  production: SaveGameV6['production'];
  inventory: SaveGameV6['inventory'];
  trade: SaveGameV6['trade'];
  freightDemand: SaveGameV6['freightDemand'];
  freightVehicles: SaveGameV6['freightVehicles'];
  nextFreightVehicleId: SaveGameV6['nextFreightVehicleId'];
  economyScheduler: SaveGameV6['economyScheduler'];
  developerMarket: DeveloperMarketState;
  developmentPolicy: DevelopmentPolicyState;
  housingRelocation: HousingRelocationState;
}>;

export type AnySaveGameV7 = SaveGameV7 | SaveGameV6;

export function serializeCoreV7(core: SimulationCore): SaveGameV7 {
  return {
    ...serializeCoreV6(core),
    version: SAVE_VERSION_V7,
    developerMarket: core.developerMarket.snapshotState(),
    developmentPolicy: core.developmentPolicySnapshot,
    housingRelocation: core.housingRelocation.snapshotState(),
  };
}

export function hydrateCoreV7(input: AnySaveGameV7): SimulationCore {
  if (input.version !== SAVE_VERSION_V7) {
    const core = hydrateCoreV6(input);
    core.developerMarket.restore({ developers: [], commitments: [] });
    core.developmentPolicy.restore();
    core.restoreHousingState();
    core.rebuildEntityProjection();
    return core;
  }
  const core = hydrateCoreV6(input);
  core.developerMarket.restore(input.developerMarket);
  core.developmentPolicy.restore(input.developmentPolicy);
  core.restoreHousingState(input.housingRelocation);
  core.rebuildEntityProjection();
  return core;
}

export { SAVE_VERSION_V6 };
