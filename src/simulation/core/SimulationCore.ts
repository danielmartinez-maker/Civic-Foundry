import { BUILDING_TYPOLOGIES } from '../../data/buildingTypologies.ts';
import type { RoadType } from '../../data/roads.ts';
import type {
  NativeBuildingLifecycleRuntimeInput,
  NativeBuildingRuntimeTypology,
  NativeDevelopmentHbuApproval,
  NativeHighestBestUseInput,
  NativeUrbanCommand,
  NativeUrbanLegacyRequest,
  NativeUrbanSnapshot,
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
import type { Lot } from '../../world/lots/LotSystem.ts';
import type { BuildingV2 } from '../buildings/BuildingTypes.ts';
import type {
  DevelopmentFeasibilityResult,
  PhysicalDevelopmentFeasibilityResult,
} from '../development/DevelopmentTypes.ts';
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
const nativeUrbanBridges = new WeakMap<SimulationCoreBase, NativeUrbanBridge>();
const installedMutationBridges = new WeakSet<SimulationCoreBase>();
type PendingHbuApproval = Omit<NativeDevelopmentHbuApproval, 'buildingId'> &
  Readonly<{ typologyId: string }>;
const nativeHbuApprovals = new WeakMap<
  SimulationCoreBase,
  Map<string, PendingHbuApproval>
>();
const nativeBuildingRuntimeTypologies: readonly NativeBuildingRuntimeTypology[] =
  Object.freeze(
    BUILDING_TYPOLOGIES.map((typology) =>
      Object.freeze({
        id: typology.id,
        name: typology.name,
        maintenanceCostPerM2: typology.maintenanceCostPerM2,
        complexityFactor: typology.complexityFactor,
      }),
    ),
  );

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

function boundedRatio(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function hbuApprovalKey(parcelIds: readonly string[], typologyId: string): string {
  return `${[...parcelIds].sort((a, b) => a.localeCompare(b)).join('|')}::${typologyId}`;
}

function nativeBuildingLifecycleInput(
  building: BuildingV2,
): NativeBuildingLifecycleRuntimeInput | undefined {
  const shared = Object.freeze({
    buildingId: building.id,
    maintenanceSpend: 0,
    environmentalStress: 0.1,
    serviceStress: 0.1,
  });
  switch (building.status) {
    case 'occupied':
      return Object.freeze({
        ...shared,
        occupancyRatio: 0.9,
        utilizationRatio: 0.75,
      });
    case 'vacant':
      return Object.freeze({
        ...shared,
        occupancyRatio: 0.05,
        utilizationRatio: 0.1,
      });
    case 'abandoned':
      return Object.freeze({
        ...shared,
        occupancyRatio: 0,
        utilizationRatio: 0,
      });
    default:
      return undefined;
  }
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

function nativeUrbanBridgeFor(
  core: SimulationCoreBase,
): NativeUrbanBridge | undefined {
  const installed = nativeUrbanBridges.get(core);
  if (installed) return installed;
  const override = activeNativeUrbanAuthorityOverride();
  if (!override?.enabled) return undefined;
  nativeUrbanBridges.set(core, override.bridge);
  return override.bridge;
}

function reconcileCanonicalBuildingProjection(core: SimulationCoreBase): void {
  const target = core as unknown as {
    reconcileCanonicalBuildingProjection: () => void;
  };
  target.reconcileCanonicalBuildingProjection();
}

function projectNativeUrbanState(
  core: SimulationCoreBase,
  snapshot: NativeUrbanSnapshot,
): void {
  core.cadastre.replaceSnapshot(snapshot.urbanFabric);
  core.lots.rebuildFromCadastre(core.cadastre, legacyZoneForParcel);
  core.zoning.restoreParcelAssignments(snapshot.zoningV2.parcelAssignments);
  core.buildings.restoreV2(snapshot.buildingsV2);
  core.buildings.restoreLegacyProjectionFromV2(
    snapshot.buildingsV2,
    core.lots.list(),
    snapshot.legacyLots,
  );
  const historicalParcelIds = new Set(
    core.cadastre.listLineage().flatMap((event) => event.sourceParcelIds),
  );
  core.propertyMarket.restore(snapshot.propertyMarket, {
    isHistoricalParcelId: (parcelId) => historicalParcelIds.has(parcelId),
  });
}

function bootstrapNativeBuildingProjection(
  core: SimulationCoreBase,
  bridge: NativeUrbanBridge,
): void {
  const nativeBuildingIds = new Set(
    bridge.urbanSnapshot().buildingsV2.map((building) => building.id),
  );
  const buildingsV2 = core.buildings.listV2();
  if (!buildingsV2.some((building) => !nativeBuildingIds.has(building.id))) return;

  const lifecycleInputs = buildingsV2.flatMap((building) => {
    const input = nativeBuildingLifecycleInput(building);
    return input ? [input] : [];
  });
  const response = bridge.applyUrbanCommand(
    Object.freeze({
      type: 'buildings.reconcile',
      buildingsV2,
      typologies: nativeBuildingRuntimeTypologies,
      lifecycleInputs: Object.freeze(lifecycleInputs),
      requireHbuForNewBuildings: false,
      hbuApprovals: Object.freeze([]),
    }),
  );
  if (!response.result.committed) {
    throw new Error(
      `native building bootstrap rejected: ${response.result.rejectionReasons.join(', ')}`,
    );
  }
}

function reconcileNativeBuildingProposal(
  core: SimulationCoreBase,
  bridge: NativeUrbanBridge,
): void {
  const nativeBefore = bridge.urbanSnapshot();
  const nativeBuildingIds = new Set(
    nativeBefore.buildingsV2.map((building) => building.id),
  );
  const buildingsV2 = core.buildings.listV2();
  const lifecycleInputs = buildingsV2.flatMap((building) => {
    const input = nativeBuildingLifecycleInput(building);
    return input ? [input] : [];
  });
  const pendingApprovals = nativeHbuApprovals.get(core) ?? new Map();
  const hbuApprovals: NativeDevelopmentHbuApproval[] = [];
  for (const building of buildingsV2) {
    if (nativeBuildingIds.has(building.id)) continue;
    const key = hbuApprovalKey(building.parcelIds, building.typologyId);
    const pending = pendingApprovals.get(key);
    if (!pending) {
      throw new Error(`new BuildingV2 lacks HBU approval: ${building.id}`);
    }
    hbuApprovals.push(
      Object.freeze({
        buildingId: building.id,
        candidateId: pending.candidateId,
        parcelIds: pending.parcelIds,
        zoningLegal: pending.zoningLegal,
        hbuInput: pending.hbuInput,
      }),
    );
  }
  const response = bridge.applyUrbanCommand(
    Object.freeze({
      type: 'buildings.reconcile',
      buildingsV2,
      typologies: nativeBuildingRuntimeTypologies,
      lifecycleInputs: Object.freeze(lifecycleInputs),
      requireHbuForNewBuildings: true,
      hbuApprovals: Object.freeze(hbuApprovals),
    }),
  );
  if (!response.result.committed) {
    throw new Error(
      `native building reconciliation rejected: ${response.result.rejectionReasons.join(', ')}`,
    );
  }
  nativeHbuApprovals.set(core, new Map());
  projectNativeUrbanState(core, response.snapshot);
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

  const apply = (command: NativeUrbanCommand): CadastralRuntimeMutationResult => {
    const response = bridge.applyUrbanCommand(command);
    projectNativeUrbanState(core, response.snapshot);
    return response.result;
  };

  service.splitParcel = (parcelId, cutLine) =>
    apply(Object.freeze({ type: 'cadastre.split', parcelId, cutLine }));
  service.assembleParcels = (parcelIds) =>
    apply(Object.freeze({ type: 'cadastre.assemble', parcelIds }));
  service.dedicateRightOfWay = (parcelId, dedication) =>
    apply(
      Object.freeze({
        type: 'cadastre.dedicate-right-of-way',
        parcelId,
        dedication,
      }),
    );
  service.createEasement = (parcelIds, kind, geometry) =>
    apply(
      Object.freeze({
        type: 'cadastre.create-easement',
        parcelIds,
        kind,
        geometry,
      }),
    );
  service.removeEasement = (easementId) =>
    apply(Object.freeze({ type: 'cadastre.remove-easement', easementId }));
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
    const urbanBridge = nativeUrbanBridgeFor(this);
    if (urbanBridge) {
      projectNativeUrbanState(this, urbanBridge.urbanSnapshot());
      installNativeMutationBridge(this, urbanBridge);
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
        const urbanBridge = nativeUrbanBridgeFor(this);
        if (urbanBridge) reconcileNativeBuildingProposal(this, urbanBridge);
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
    const urbanBridge = nativeUrbanBridgeFor(this);
    if (!urbanBridge) {
      super.step(ticks);
      return;
    }
    if (!Number.isInteger(ticks) || !Number.isFinite(ticks) || ticks < 0) {
      super.step(ticks);
      return;
    }
    for (let index = 0; index < ticks; index += 1) {
      bootstrapNativeBuildingProjection(this, urbanBridge);
      const checkpoint = captureAuthoritativeTransactionCheckpoint(this);
      try {
        super.step(1);
        reconcileNativeBuildingProposal(this, urbanBridge);
        urbanBridge.step(1);
        projectNativeUrbanState(this, urbanBridge.urbanSnapshot());
      } catch (error) {
        restoreAuthoritativeTransactionCheckpoint(this, checkpoint);
        throw error;
      }
    }
  }

  protected override collectVacantDevelopmentOpportunities(
    lots: readonly Lot[],
    occupiedLots: ReadonlySet<string>,
  ): DevelopmentFeasibilityResult[] {
    const opportunities = super.collectVacantDevelopmentOpportunities(
      lots,
      occupiedLots,
    );
    const hurdles = this.developerMarket
      .listDevelopers()
      .map((developer) => developer.hurdleRate);
    const developerHurdleRate = boundedRatio(
      hurdles.length > 0 ? Math.min(...hurdles) : 1,
    );
    const approvals = new Map<string, PendingHbuApproval>();
    nativeHbuApprovals.set(this, approvals);

    return opportunities.filter((opportunity) => {
      if (!opportunity.legal || !opportunity.feasible) return true;
      const physical = opportunity as Partial<PhysicalDevelopmentFeasibilityResult>;
      if (!physical.candidateId || !physical.typologyId || !physical.siteId) {
        return false;
      }
      const parcelIds = Object.freeze([physical.siteId]);
      const hbuInput: NativeHighestBestUseInput = Object.freeze({
        parcelIds,
        holdValue: Math.max(0, opportunity.landValue),
        buildingCondition: 0,
        developerHurdleRate,
        renovationNetValue: 0,
        renovationExpectedReturn: 0,
        renovationRiskScore: 0,
        conversionNetValue: 0,
        conversionExpectedReturn: 0,
        conversionRiskScore: 0,
        redevelopmentNetValue: Math.max(0, opportunity.residualLandValue),
        redevelopmentExpectedReturn: boundedRatio(opportunity.returnOnCost),
        redevelopmentRiskScore: boundedRatio(opportunity.riskScore),
      });
      const decision = this.highestBestUse.evaluate(hbuInput);
      if (decision.bestStrategy !== 'redevelop') return false;

      approvals.set(
        hbuApprovalKey(parcelIds, physical.typologyId),
        Object.freeze({
          candidateId: physical.candidateId,
          typologyId: physical.typologyId,
          parcelIds,
          zoningLegal: opportunity.legal,
          hbuInput,
        }),
      );
      return true;
    });
  }

  override rebuildCadastreFromLegacyState(): void {
    const urbanBridge = nativeUrbanBridgeFor(this);
    if (urbanBridge) {
      try {
        const authoritative = urbanBridge.rebuildUrbanLegacy(
          nativeLegacyRebuildRequest(this),
        );
        projectNativeUrbanState(this, authoritative);
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('protected-parcel-topology-change')) {
          throw new ProtectedCanonicalParcelMutationError();
        }
        throw error;
      }
    }

    const candidate = this.parcelGeneration.rebuild(
      this.terrain,
      this.roads,
      this.zoning,
    );
    const result = rebuildServiceFor(this).rebuild(candidate, this.clock.tick);
    if (!result.committed) throw new ProtectedCanonicalParcelMutationError();
    reconcileCanonicalBuildingProjection(this);
  }
}
