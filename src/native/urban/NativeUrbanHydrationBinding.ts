import type {
  NativeUrbanCommand,
  NativeUrbanSnapshot,
} from "../NativeEngineTypes.ts";
import type { SimulationCore } from "../../simulation/core/SimulationCore.ts";
import type {
  CadastralRuntimeMutationResult,
  CadastralRuntimeMutationService,
} from "../../simulation/land/CadastralRuntimeMutationService.ts";
import type { Parcel } from "../../world/cadastre/CadastralTypes.ts";
import type { NativeUrbanBridge } from "./NativeUrbanAuthority.ts";

function legacyZoneForParcel(parcel: Parcel) {
  const zone = parcel.zoningDistrictId;
  return zone === "residential" || zone === "commercial" || zone === "industrial"
    ? zone
    : undefined;
}

function projectNativeUrbanState(
  core: SimulationCore,
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

export function bindNativeUrbanMutationsAfterHydration(
  core: SimulationCore,
  bridge: NativeUrbanBridge,
): void {
  const service = core.cadastralMutations as CadastralRuntimeMutationService & {
    splitParcel: CadastralRuntimeMutationService["splitParcel"];
    assembleParcels: CadastralRuntimeMutationService["assembleParcels"];
    dedicateRightOfWay: CadastralRuntimeMutationService["dedicateRightOfWay"];
    createEasement: CadastralRuntimeMutationService["createEasement"];
    removeEasement: CadastralRuntimeMutationService["removeEasement"];
  };

  const apply = (command: NativeUrbanCommand): CadastralRuntimeMutationResult => {
    const response = bridge.applyUrbanCommand(command);
    projectNativeUrbanState(core, response.snapshot);
    return response.result;
  };

  service.splitParcel = (parcelId, cutLine) =>
    apply(Object.freeze({ type: "cadastre.split", parcelId, cutLine }));
  service.assembleParcels = (parcelIds) =>
    apply(Object.freeze({ type: "cadastre.assemble", parcelIds }));
  service.dedicateRightOfWay = (parcelId, dedication) =>
    apply(
      Object.freeze({
        type: "cadastre.dedicate-right-of-way",
        parcelId,
        dedication,
      }),
    );
  service.createEasement = (parcelIds, kind, geometry) =>
    apply(
      Object.freeze({
        type: "cadastre.create-easement",
        parcelIds,
        kind,
        geometry,
      }),
    );
  service.removeEasement = (easementId) =>
    apply(Object.freeze({ type: "cadastre.remove-easement", easementId }));
}
