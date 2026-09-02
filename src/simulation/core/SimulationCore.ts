import type { RoadType } from '../../data/roads.ts';
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

function resolveNativeWorldOptions(options: SimulationCoreOptions): SimulationCoreOptions {
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
  constructor(options: SimulationCoreOptions = {}) {
    super(resolveNativeWorldOptions(options));
    this.tripGeneration.setDemandWeightMode('exact');
    this.kernel.registerTransactionParticipant({
      id: 'civic-foundry-authoritative-state',
      snapshot: () => captureAuthoritativeTransactionCheckpoint(this),
      restore: (snapshot) => restoreAuthoritativeTransactionCheckpoint(this, snapshot),
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
