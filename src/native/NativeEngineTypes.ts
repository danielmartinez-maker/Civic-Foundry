import type { BuildingV2 } from "../simulation/buildings/BuildingTypes.ts";
import type { PropertyMarketSnapshot } from "../simulation/development/PropertyMarketSystem.ts";
import type { ParcelZoningAssignment } from "../simulation/zoning/ZoningTypes.ts";
import type {
  CadastralSnapshot,
  EasementKind,
} from "../world/cadastre/CadastralTypes.ts";
import type { WorldPoint } from "../world/cadastre/Geometry.ts";

export const NATIVE_COMMAND_PROTOCOL_VERSION = 1 as const;

export const NATIVE_DOMAIN_OWNERSHIP = Object.freeze({
  owned: 1,
  unowned: 2,
} as const);

export type NativeEngineHandle = object;

export type NativeCommand = Readonly<{
  sequence: number;
  tick: number;
  type: string;
  payload: unknown;
}>;

export type NativeCommandEnvelope = NativeCommand &
  Readonly<{
    version: typeof NATIVE_COMMAND_PROTOCOL_VERSION;
  }>;

export type NativeSnapshot = Readonly<{
  hashVersion: number;
  pendingCommands: readonly unknown[];
  randomStreams: Readonly<Record<string, number>>;
  seed: number;
  speed: 0 | 1 | 2 | 4;
  tick: number;
}>;

export type NativeEvent = Readonly<{
  sequence: number;
  tick: number;
  type: string;
  source: string;
  payload: string;
}>;

export type NativeDomainHash = Readonly<{
  ownership: "owned" | "unowned";
  version: number;
  value: bigint;
}>;

export type NativeUrbanLegacyRequest = Readonly<{
  terrain: readonly Readonly<{ x: number; y: number; buildable: boolean }>[];
  roads: readonly Readonly<{ x: number; y: number; roadRef: string }>[];
  zoning: readonly Readonly<{
    x: number;
    y: number;
    zoningDistrictId: string;
  }>[];
}>;

export type NativeUrbanState = Readonly<{
  urbanFabric: CadastralSnapshot;
  zoningV2: Readonly<{ parcelAssignments: readonly ParcelZoningAssignment[] }>;
  buildingsV2: readonly BuildingV2[];
  propertyMarket: PropertyMarketSnapshot;
}>;

export type NativeUrbanSnapshot = NativeUrbanState &
  Readonly<{
    legacyLots: readonly Readonly<{
      parcelId: string;
      x: number;
      y: number;
      faithful: boolean;
    }>[];
    compatibilityDiagnostics: readonly string[];
  }>;

export type NativeBuildingRuntimeTypology = Readonly<{
  id: string;
  name: string;
  maintenanceCostPerM2: number;
  complexityFactor: number;
}>;

export type NativeBuildingLifecycleRuntimeInput = Readonly<{
  buildingId: string;
  maintenanceSpend: number;
  occupancyRatio: number;
  utilizationRatio: number;
  environmentalStress: number;
  serviceStress: number;
}>;

export type NativeUrbanCommand =
  | Readonly<{
      type: "cadastre.split";
      parcelId: string;
      cutLine: readonly WorldPoint[];
    }>
  | Readonly<{
      type: "cadastre.assemble";
      parcelIds: readonly string[];
    }>
  | Readonly<{
      type: "cadastre.dedicate-right-of-way";
      parcelId: string;
      dedication: readonly WorldPoint[];
    }>
  | Readonly<{
      type: "cadastre.create-easement";
      parcelIds: readonly string[];
      kind: EasementKind;
      geometry: readonly WorldPoint[];
    }>
  | Readonly<{
      type: "cadastre.remove-easement";
      easementId: string;
    }>
  | Readonly<{
      type: "buildings.reconcile";
      buildingsV2: readonly BuildingV2[];
      typologies: readonly NativeBuildingRuntimeTypology[];
      lifecycleInputs: readonly NativeBuildingLifecycleRuntimeInput[];
    }>;

export type NativeUrbanMutationResult = Readonly<{
  committed: boolean;
  resultingParcelIds: readonly string[];
  retiredParcelIds: readonly string[];
  rejectionReasons: readonly string[];
  parcelReferenceRewrites: Readonly<Record<string, string>>;
}>;

export type NativeUrbanCommandResponse = Readonly<{
  result: NativeUrbanMutationResult;
  snapshot: NativeUrbanSnapshot;
}>;

export interface NativeEngineAddon {
  createEngine(
    config?: Readonly<{
      seed?: number;
      startTick?: number;
      speed?: 0 | 1 | 2 | 4;
    }>,
  ): NativeEngineHandle;
  destroyEngine(handle: NativeEngineHandle): void;
  submitCommands(handle: NativeEngineHandle, commandsJson: string): void;
  step(handle: NativeEngineHandle, ticks: number): void;
  loadV9(handle: NativeEngineHandle, saveJson: string): void;
  saveV9(handle: NativeEngineHandle): string;
  getSnapshot(handle: NativeEngineHandle): string;
  getEvents(handle: NativeEngineHandle): string;
  getDomainHash(
    handle: NativeEngineHandle,
    domain: string,
  ): Readonly<{ ownership: number; version: number; value: bigint }>;
  createWorld(handle: NativeEngineHandle, requestJson: string): string;
  restoreWorld(handle: NativeEngineHandle, snapshotJson: string): string;
  createLegacyWorld(handle: NativeEngineHandle, requestJson: string): string;
  runDesignStorm(handle: NativeEngineHandle, requestJson: string): string;
  rebuildUrbanLegacy?(handle: NativeEngineHandle, requestJson: string): string;
  restoreUrbanState?(handle: NativeEngineHandle, snapshotJson: string): string;
  applyUrbanCommand?(handle: NativeEngineHandle, requestJson: string): string;
  getUrbanSnapshot?(handle: NativeEngineHandle): string;
}
