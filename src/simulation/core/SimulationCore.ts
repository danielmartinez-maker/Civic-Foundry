import type { RoadType } from '../../data/roads.ts';
import type {
  NativeUrbanLegacyRequest,
  NativeUrbanState,
} from '../../native/NativeEngineTypes.ts';
import {
  activeNativeUrbanAuthorityOverride,
  type NativeUrbanBridge,
} from '../../native/urban/NativeUrbanAuthority.ts';
import {
  NativeWorldAuthority,
  activeNativeWorldAuthorityOverride,
} from '../../native/world/NativeWorldAuthority.ts';
import type { Parcel } from '../../world/cadastre/CadastralTypes.ts';
import type { WorldFoundation } from '../../world/foundation/WorldFoundation.ts';
import { resolveWorldGenerationConfig } from '../../world/generation/WorldGenerationConfig.ts';
import {
  captureAuthoritativeTransactionCheckpoint,
  restoreAuthoritativeTransactionCheckpoint,
} from './AuthoritativeTransactionCheckpoint.ts';
import { SimulationCore as SimulationCoreBase } from './SimulationCoreBase.ts';
import type { SimulationCoreOptions } from './SimulationCoreBase.ts';
import type { CellCoord, ZoneType } from './types.ts';
import { LegacyCadastreRebuildService } from '../land/LegacyCadastreRebuildService.ts';
import type {
  CadastralRuntimeMutationResult,
  CadastralRuntimeMutationService,
} from '../land/CadastralRuntimeMutationService.ts';

export { withSimulationCoreHydrationOverride } from './SimulationCoreBase.ts';
export type { SimulationCoreOptions } from './SimulationCoreBase.ts';

const rebuildServices = new WeakMap<
  SimulationCoreBase,
  LegacyCadastreRebuildService
>();
const installedMutationBridges = new WeakSet<SimulationCoreBase>();

class ProtectedCanonicalParcelMutationError extends Error {
  constructor() {
    super('legacy land edit would change protected canonical parcel topology');
    this.name = 'ProtectedCanonicalParcelMutationError';
  }
}

function legacyZoneForParcel(parcel: Parcel): ZoneType | undefined {
  const zone = parcel.zoningDistrictId;
  return zone === 'residential' ||
    zone === 'commercial' ||
    zone === 'industrial'
    ? zone
    : undefined;
}

function resolveNativeWorldOptions(
  options: SimulationCoreOptions,
): SimulationCoreOptions {
  const override = activeNativeWorldAuthorityOverride();
  if (!override?.enabled || options.world) return options;

  const seed = options.seed ?? 1;
  const nativeWorld = options.terrain
    ? NativeWorldAuthority.fromLegacyTerrain(
        override.bridge,
        options.terrain,
        seed,
        options.terrainMode ?? 'legacy-explicit',
      )
    : NativeWorldAuthority.generate(override.bridge, {
        seed,
        config: resolveWorldGenerationConfig({
          ...options.worldConfig,
          ...(options.width !== undefined ? { width: options.width } : {}),
          ...(options.height !== undefined ? { height: options.height } : {}),
        }),
        ...(options.scenarioWorld ? { scenario: options.scenarioWorld } : {}),
      });

  return Object.freeze({
    ...options,
    world: nativeWorld as unknown as WorldFoundation,
  });
}

function rebuildServiceFor(
  core: SimulationCoreBase,
): LegacyCadastreRebuildService {
  let service = rebuildServices.get(core);
  if (!service) {
    service = new LegacyCadastreRebuildService({
      cadastre: core.cadastre,
      lots: core.lots,
      zoning: core.zoning,
      buildings: core.buildings,
      propertyMarket: core.propertyMarket,
      legacyZoneResolver: legacyZoneForParcel,
    });
    rebuildServices.set(core, service);
  }
  return service;
}

function reconcileCanonicalBuildingProjection(core: SimulationCoreBase): void {
  const target = core as unknown as {
    reconcileCanonicalBuildingProjection: () => void;
  };
  target.reconcileCanonicalBuildingProjection();
}

function captureNativeUrbanState(core: SimulationCoreBase): NativeUrbanState {
  return Object.freeze({
    urbanFabric: core.cadastre.snapshot(),
    zoningV2: Object.freeze({
      parcelAssignments: core.zoning.listParcelAssignments(),
    }),
    buildingsV2: core.buildings.listV2(),
    propertyMarket: core.propertyMarket.snapshot(),
  });
}

function projectNativeUrbanState(
  core: SimulationCoreBase,
  snapshot: NativeUrbanState,
): void {
  core.cadastre.replaceSnapshot(snapshot.urbanFabric);
  core.lots.rebuildFromCadastre(core.cadastre, legacyZoneForParcel);
  core.zoning.restoreParcelAssignments(snapshot.zoningV2.parcelAssignments);
  core.buildings.restoreV2(snapshot.buildingsV2);
  const historicalParcelIds = new Set(
    core.cadastre.listLineage().flatMap((event) => event.sourceParcelIds),
  );
  core.propertyMarket.restore(snapshot.propertyMarket, {
    isHistoricalParcelId: (parcelId) => historicalParcelIds.has(parcelId),
  });
}

function commitNativeUrbanState(
  core: SimulationCoreBase,
  bridge: NativeUrbanBridge,
): void {
  const authoritative = bridge.restoreUrbanState(captureNativeUrbanState(core));
  projectNativeUrbanState(core, authoritative);
}

function nativeLegacyRebuildRequest(
  core: SimulationCoreBase,
): NativeUrbanLegacyRequest {
  const terrain: Array<Readonly<{ x: number; y: number; buildable: boolean }>> = [];
  for (let y = 0; y < core.terrain.height; y += 1) {
    for (let x = 0; x < core.terrain.width; x += 1) {
      terrain.push(
        Object.freeze({ x, y, buildable: core.terrain.isBuildable(x, y) }),
      );
    }
  }
  return Object.freeze({
    terrain: Object.freeze(terrain),
    roads: Object.freeze(
      core.roads.list().map((road) =>
        Object.freeze({
          x: road.x,
          y: road.y,
          roadRef: `${road.x},${road.y}`,
        }),
      ),
    ),
    zoning: Object.freeze(
      core.zoning.list().map((cell) =>
        Object.freeze({
          x: cell.x,
          y: cell.y,
          zoningDistrictId: cell.zone,
        }),
      ),
    ),
  });
}

function installNativeMutationBridge(
  core: SimulationCoreBase,
  bridge: NativeUrbanBridge,
): void {
  if (installedMutationBridges.has(core)) return;
  installedMutationBridges.add(core);

  const service = core.cadastralMutations as CadastralRuntimeMutationService & {
    splitParcel: CadastralRuntimeMutationService['splitParcel'];
    assembleParcels: CadastralRuntimeMutationService['assembleParcels'];
    dedicateRightOfWay: CadastralRuntimeMutationService['dedicateRightOfWay'];
    createEasement: CadastralRuntimeMutationService['createEasement'];
    removeEasement: CadastralRuntimeMutationService['removeEasement'];
  };
  const sync = (result: CadastralRuntimeMutationResult) => {
    if (result.committed) commitNativeUrbanState(core, bridge);
    return result;
  };

  const splitParcel = service.splitParcel.bind(service);
  service.splitParcel = (parcelId, cutLine) => sync(splitParcel(parcelId, cutLine));
  const assembleParcels = service.assembleParcels.bind(service);
  service.assembleParcels = (parcelIds) => sync(assembleParcels(parcelIds));
  const dedicateRightOfWay = service.dedicateRightOfWay.bind(service);
  service.dedicateRightOfWay = (parcelId, dedication) =>
    sync(dedicateRightOfWay(parcelId, dedication));
  const createEasement = service.createEasement.bind(service);
  service.createEasement = (parcelIds, kind, geometry) =>
    sync(createEasement(parcelIds, kind, geometry));
  const removeEasement = service.removeEasement.bind(service);
  service.removeEasement = (easementId) => sync(removeEasement(easementId));
}

export class SimulationCore extends SimulationCoreBase {
  constructor(options: SimulationCoreOptions = {}) {
    super(resolveNativeWorldOptions(options));
    this.tripGeneration.setDemandWeightMode('exact');
    this.kernel.registerTransactionParticipant({
      id: 'civic-foundry-authoritative-state',
      snapshot: () => captureAuthoritativeTransactionCheckpoint(this),
      restore: (snapshot) =>
        restoreAuthoritativeTransactionCheckpoint(this, snapshot),
    });
    const urbanOverride = activeNativeUrbanAuthorityOverride();
    if (urbanOverride?.enabled) {
      commitNativeUrbanState(this, urbanOverride.bridge);
      installNativeMutationBridge(this, urbanOverride.bridge);
    }
  }

  override buildRoad(cells: readonly CellCoord[], type: RoadType) {
    const checkpoint = captureAuthoritativeTransactionCheckpoint(this);
    try {
      return super.buildRoad(cells, type);
    } catch (error) {
      restoreAuthoritativeTransactionCheckpoint(this, checkpoint);
      if (error instanceof ProtectedCanonicalParcelMutationError) {
        return { ok: false, cost: 0, reason: error.message };
      }
      throw error;
    }
  }

  override paintZone(cells: readonly CellCoord[], zone: ZoneType): { painted: number } {
    const checkpoint = captureAuthoritativeTransactionCheckpoint(this);
    try {
      return super.paintZone(cells, zone);
    } catch (error) {
      restoreAuthoritativeTransactionCheckpoint(this, checkpoint);
      if (error instanceof ProtectedCanonicalParcelMutationError) {
        return { painted: 0 };
      }
      throw error;
    }
  }

  override bulldozeAt(
    x: number,
    y: number,
  ): { ok: boolean; kind?: 'road' | 'building' | 'zone'; reason?: string } {
    const checkpoint = captureAuthoritativeTransactionCheckpoint(this);
    try {
      const result = super.bulldozeAt(x, y);
      if (result.ok && result.kind === 'building') {
        const urbanOverride = activeNativeUrbanAuthorityOverride();
        if (urbanOverride?.enabled) {
          commitNativeUrbanState(this, urbanOverride.bridge);
        }
      }
      return result;
    } catch (error) {
      restoreAuthoritativeTransactionCheckpoint(this, checkpoint);
      if (error instanceof ProtectedCanonicalParcelMutationError) {
        return { ok: false, reason: error.message };
      }
      throw error;
    }
  }

  override step(ticks = 1): void {
    const checkpoint = captureAuthoritativeTransactionCheckpoint(this);
    try {
      super.step(ticks);
      const urbanOverride = activeNativeUrbanAuthorityOverride();
      if (urbanOverride?.enabled) {
        commitNativeUrbanState(this, urbanOverride.bridge);
      }
    } catch (error) {
      restoreAuthoritativeTransactionCheckpoint(this, checkpoint);
      throw error;
    }
  }

  override rebuildCadastreFromLegacyState(): void {
    const urbanOverride = activeNativeUrbanAuthorityOverride();
    const candidate = urbanOverride?.enabled
      ? urbanOverride.bridge.rebuildUrbanLegacy(
          nativeLegacyRebuildRequest(this),
        ).urbanFabric
      : this.parcelGeneration.rebuild(this.terrain, this.roads, this.zoning);
    const result = rebuildServiceFor(this).rebuild(candidate, this.clock.tick);
    if (!result.committed) throw new ProtectedCanonicalParcelMutationError();
    reconcileCanonicalBuildingProjection(this);
    if (urbanOverride?.enabled) {
      commitNativeUrbanState(this, urbanOverride.bridge);
    }
  }
}
