import type {
  NativeEngineAddon,
  NativeEngineHandle,
} from "./NativeEngineTypes.ts";

export type DesktopNativeEngineApi = Readonly<{
  available(): boolean;
  createEngine(
    config?: Readonly<{
      seed?: number;
      startTick?: number;
      speed?: 0 | 1 | 2 | 4;
    }>,
  ): boolean;
  destroyEngine(): boolean;
  submitCommands(commandsJson: string): boolean;
  step(ticks: number): boolean;
  loadV9(saveJson: string): boolean;
  saveV9(): string;
  getSnapshot(): string;
  getEvents(): string;
  getDomainHash(
    domain: string,
  ): Readonly<{ ownership: number; version: number; value: string }>;
}>;

const desktopHandle = Object.freeze({ desktopNativeEngine: true });

function apiFromScope(scope: unknown): DesktopNativeEngineApi | undefined {
  if (!scope || typeof scope !== "object") return undefined;
  const candidate = (scope as Readonly<Record<string, unknown>>)
    .__CIVIC_NATIVE_DESKTOP__;
  if (!candidate || typeof candidate !== "object") return undefined;
  const api = candidate as Partial<DesktopNativeEngineApi>;
  if (
    typeof api.available !== "function" ||
    typeof api.createEngine !== "function" ||
    typeof api.destroyEngine !== "function" ||
    typeof api.submitCommands !== "function" ||
    typeof api.step !== "function" ||
    typeof api.loadV9 !== "function" ||
    typeof api.saveV9 !== "function" ||
    typeof api.getSnapshot !== "function" ||
    typeof api.getEvents !== "function" ||
    typeof api.getDomainHash !== "function"
  )
    return undefined;
  return api as DesktopNativeEngineApi;
}

export class DesktopNativeEngineAddon implements NativeEngineAddon {
  private readonly api: DesktopNativeEngineApi;
  private active = false;

  constructor(api: DesktopNativeEngineApi) {
    this.api = api;
  }

  createEngine(
    config: Readonly<{
      seed?: number;
      startTick?: number;
      speed?: 0 | 1 | 2 | 4;
    }> = {},
  ): NativeEngineHandle {
    if (this.active)
      throw new Error("desktop native engine is already initialized");
    this.api.createEngine(config);
    this.active = true;
    return desktopHandle;
  }

  destroyEngine(handle: NativeEngineHandle): void {
    this.requireHandle(handle);
    this.api.destroyEngine();
    this.active = false;
  }

  submitCommands(handle: NativeEngineHandle, commandsJson: string): void {
    this.requireHandle(handle);
    this.api.submitCommands(commandsJson);
  }

  step(handle: NativeEngineHandle, ticks: number): void {
    this.requireHandle(handle);
    this.api.step(ticks);
  }

  loadV9(handle: NativeEngineHandle, saveJson: string): void {
    this.requireHandle(handle);
    this.api.loadV9(saveJson);
  }

  saveV9(handle: NativeEngineHandle): string {
    this.requireHandle(handle);
    return this.api.saveV9();
  }

  getSnapshot(handle: NativeEngineHandle): string {
    this.requireHandle(handle);
    return this.api.getSnapshot();
  }

  getEvents(handle: NativeEngineHandle): string {
    this.requireHandle(handle);
    return this.api.getEvents();
  }

  getDomainHash(
    handle: NativeEngineHandle,
    domain: string,
  ): Readonly<{ ownership: number; version: number; value: bigint }> {
    this.requireHandle(handle);
    const result = this.api.getDomainHash(domain);
    return Object.freeze({
      ownership: result.ownership,
      version: result.version,
      value: BigInt(result.value),
    });
  }

  private requireHandle(handle: NativeEngineHandle): void {
    if (!this.active || handle !== desktopHandle)
      throw new Error("invalid desktop native engine handle");
  }
}

export function desktopNativeEngineAddonFromGlobal(
  scope: unknown = globalThis,
): NativeEngineAddon | undefined {
  const api = apiFromScope(scope);
  if (!api || !api.available()) return undefined;
  return new DesktopNativeEngineAddon(api);
}

export function hasDesktopNativeHost(scope: unknown = globalThis): boolean {
  return apiFromScope(scope) !== undefined;
}
