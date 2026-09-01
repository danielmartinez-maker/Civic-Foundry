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
}
