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

export type NativeCommandEnvelope = NativeCommand & Readonly<{ version: typeof NATIVE_COMMAND_PROTOCOL_VERSION }>;

export type NativeTransportationSnapshot = Readonly<{
  schemaVersion: number;
  topologyRevision: number;
  costRevision: number;
  junctions: readonly Readonly<{ id: string; x: number; y: number }>[];
  segments: readonly Readonly<{ id: string; startJunctionId: string; endJunctionId: string; carriagewayIds: readonly string[] }>[];
  carriageways: readonly Readonly<{ id: string; segmentId: string; fromJunctionId: string; toJunctionId: string; laneIds: readonly string[] }>[];
  lanes: readonly Readonly<{ id: string; carriagewayId: string; ordinal: number; permissions: number; open: boolean }>[];
  movements: readonly Readonly<{ id: string; junctionId: string; fromCarriagewayId: string; toCarriagewayId: string; fromLaneIds: readonly string[]; toLaneIds: readonly string[]; permissions: number; allowed: boolean }>[];
  traffic: Readonly<{ loads: readonly Readonly<{ carriagewayId: string; weightedVehicles: number }>[] }>;
  roadTraffic: Readonly<{
    nextVehicleId: number;
    completedTrips: number;
    failedTrips: number;
    congestionEpoch: number;
    vehicles: readonly Readonly<{
      id: string;
      tripId: string;
      cause: string;
      travelerWeight: number;
      originId: string;
      destinationId: string;
      carriagewayIds: readonly string[];
      currentCarriagewayIndex: number;
      carriagewayProgressTicks: number;
      departureTick: number;
      accumulatedDelayTicks: number;
      freeFlowTicks: number;
      status: "moving" | "queued";
      queuedJunctionId: string | null;
    }>[];
  }>;
  transit: Readonly<{
    revision: number;
    stops: readonly Readonly<{ id: string; x: number; y: number; mode: string }>[];
    lines: readonly Readonly<{ id: string; mode: string; stopIds: readonly string[]; fare: number; headwayTicks: number; enabled: boolean }>[];
  }>;
  queues: Readonly<{ nextSplitId: number; queues: readonly unknown[] }>;
  operations: Readonly<{ nextRunId: number; vehicles: readonly unknown[] }>;
}>;

export type NativeSnapshot = Readonly<{
  hashVersion: number;
  pendingCommands: readonly unknown[];
  randomStreams: Readonly<Record<string, number>>;
  seed: number;
  speed: 0 | 1 | 2 | 4;
  tick: number;
  transportation?: NativeTransportationSnapshot;
}>;

export type NativeEvent = Readonly<{ sequence: number; tick: number; type: string; source: string; payload: string }>;
export type NativeDomainHash = Readonly<{ ownership: "owned" | "unowned"; version: number; value: bigint }>;

export interface NativeEngineAddon {
  createEngine(config?: Readonly<{ seed?: number; startTick?: number; speed?: 0 | 1 | 2 | 4 }>): NativeEngineHandle;
  destroyEngine(handle: NativeEngineHandle): void;
  submitCommands(handle: NativeEngineHandle, commandsJson: string): void;
  step(handle: NativeEngineHandle, ticks: number): void;
  loadV9(handle: NativeEngineHandle, saveJson: string): void;
  saveV9(handle: NativeEngineHandle): string;
  getSnapshot(handle: NativeEngineHandle): string;
  getEvents(handle: NativeEngineHandle): string;
  getDomainHash(handle: NativeEngineHandle, domain: string): Readonly<{ ownership: number; version: number; value: bigint }>;
}
