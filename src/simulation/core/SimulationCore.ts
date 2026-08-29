import { SimulationCore as SimulationCoreBase } from './SimulationCoreBase.ts';
import type { Parcel } from '../../world/cadastre/CadastralTypes.ts';
import { LegacyCadastreRebuildService } from '../land/LegacyCadastreRebuildService.ts';
import type { ZoneType } from './types.ts';

export { withSimulationCoreHydrationOverride } from './SimulationCoreBase.ts';
export type { SimulationCoreOptions } from './SimulationCoreBase.ts';

const rebuildServices = new WeakMap<SimulationCoreBase, LegacyCadastreRebuildService>();

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
      legacyZoneResolver: legacyZoneForParcel,
    });
    rebuildServices.set(core, service);
  }
  return service;
}

export class SimulationCore extends SimulationCoreBase {
  override rebuildCadastreFromLegacyState(): void {
    const candidate = this.parcelGeneration.rebuild(this.terrain, this.roads, this.zoning);
    rebuildServiceFor(this).rebuild(candidate, this.clock.tick, () => {
      super.rebuildCadastreFromLegacyState();
    });
  }
}
