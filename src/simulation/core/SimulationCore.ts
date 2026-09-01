import { SimulationCore as SimulationCoreBase } from './SimulationCoreBase.ts';
import type { Parcel } from '../../world/cadastre/CadastralTypes.ts';
import { LegacyCadastreRebuildService } from '../land/LegacyCadastreRebuildService.ts';
import { SimulationDiagnosticsService } from '../diagnostics/SimulationDiagnosticsService.ts';
import type { CellCoord, ZoneType } from './types.ts';
import type { RoadType } from '../../data/roads.ts';
import {
  captureAuthoritativeTransactionCheckpoint,
  restoreAuthoritativeTransactionCheckpoint,
} from './AuthoritativeTransactionCheckpoint.ts';

export { withSimulationCoreHydrationOverride } from './SimulationCoreBase.ts';
export type { SimulationCoreOptions } from './SimulationCoreBase.ts';

const rebuildServices = new WeakMap<SimulationCoreBase, LegacyCadastreRebuildService>();

class ProtectedCanonicalParcelMutationError extends Error {
  constructor() {
    super('legacy land edit would change protected canonical parcel topology');
    this.name = 'ProtectedCanonicalParcelMutationError';
  }
}

function legacyZoneForParcel(parcel: Parcel): ZoneType | undefined {
  const zone = parcel.zoningDistrictId;
  return zone === 'residential' || zone === 'commercial' || zone === 'industrial' ? zone : undefined;
}

function rebuildServiceFor(core: SimulationCoreBase): LegacyCadastreRebuildService {
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
  // Compatibility bridge for the PR #104 extraction: this is the existing canonical
  // reconciliation algorithm, still TypeScript-private on the extracted base class.
  const target = core as unknown as { reconcileCanonicalBuildingProjection: () => void };
  target.reconcileCanonicalBuildingProjection();
}

export class SimulationCore extends SimulationCoreBase {
  readonly diagnostics: SimulationDiagnosticsService;

  constructor(...args: ConstructorParameters<typeof SimulationCoreBase>) {
    super(...args);
    this.tripGeneration.setDemandWeightMode('exact');
    this.kernel.registerTransactionParticipant({
      id: 'civic-foundry-authoritative-state',
      snapshot: () => captureAuthoritativeTransactionCheckpoint(this),
      restore: (snapshot) => restoreAuthoritativeTransactionCheckpoint(this, snapshot),
    });
    this.diagnostics = new SimulationDiagnosticsService({
      kernel: this.kernel,
      captureAuthority: () => captureAuthoritativeTransactionCheckpoint(this),
      revisions: () => Object.freeze({
        topology: this.roads.revision,
        trafficCongestion: this.traffic.congestionEpoch,
      }),
      captureDomains: () => {
        const cadastre = this.cadastre.snapshot();
        const liveParcelIds = new Set(cadastre.parcels.map((parcel) => parcel.id));
        const invalidBuildingParcelReferences = this.buildings
          .listV2()
          .reduce(
            (count, building) =>
              count + building.parcelIds.filter((parcelId) => !liveParcelIds.has(parcelId)).length,
            0,
          );
        const invalidPropertyParcelReferences = this.propertyMarket
          .snapshot()
          .holdings.filter((holding) => !liveParcelIds.has(holding.parcelId)).length;
        return Object.freeze({
          world: Object.freeze({
            nodes: cadastre.nodes.length,
            edges: cadastre.edges.length,
            blocks: cadastre.blocks.length,
            parcels: cadastre.parcels.length,
            easements: cadastre.easements.length,
            lineage: cadastre.lineage.length,
            topologyRevision: this.roads.revision,
          }),
          buildings: Object.freeze({
            canonical: this.buildings.listV2().length,
            legacy: this.buildings.list().length,
          }),
          transport: Object.freeze({
            segments: this.transportationGraph.edges.length,
            activeVehicles: this.traffic.activeVehicles.length,
            completedTrips: this.traffic.completedTrips,
            failedTrips: this.traffic.failedTrips,
            congestionEpoch: this.traffic.congestionEpoch,
          }),
          transit: Object.freeze({
            lines: this.transit.listLines().length,
            stops: this.transit.listStops().length,
            vehicles: this.mobility.vehicles.listVehicles().length,
          }),
          economy: Object.freeze({
            firms: this.economyDomain.firms.list().length,
            freightVehicles: this.economyDomain.freightVehicles.listVehicles().length,
          }),
          services: Object.freeze({
            facilities: this.services.listFacilities().length,
            activeJobs: this.serviceDispatch.listJobs().length,
          }),
          integrity: Object.freeze({
            invalidBuildingParcelReferences,
            invalidPropertyParcelReferences,
            totalInvalidReferences:
              invalidBuildingParcelReferences + invalidPropertyParcelReferences,
          }),
        });
      },
    });
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
      if (error instanceof ProtectedCanonicalParcelMutationError) return { painted: 0 };
      throw error;
    }
  }

  override bulldozeAt(x: number, y: number): { ok: boolean; kind?: 'road' | 'building' | 'zone'; reason?: string } {
    const checkpoint = captureAuthoritativeTransactionCheckpoint(this);
    try {
      return super.bulldozeAt(x, y);
    } catch (error) {
      restoreAuthoritativeTransactionCheckpoint(this, checkpoint);
      if (error instanceof ProtectedCanonicalParcelMutationError) return { ok: false, reason: error.message };
      throw error;
    }
  }

  override rebuildCadastreFromLegacyState(): void {
    const candidate = this.parcelGeneration.rebuild(this.terrain, this.roads, this.zoning);
    const result = rebuildServiceFor(this).rebuild(candidate, this.clock.tick);
    if (!result.committed) throw new ProtectedCanonicalParcelMutationError();
    reconcileCanonicalBuildingProjection(this);
  }
}
