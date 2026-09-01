import {
  NATIVE_DOMAIN_OWNERSHIP,
  type NativeCommand,
  type NativeDomainHash,
  type NativeEngineAddon,
  type NativeEngineHandle,
  type NativeEvent,
  type NativeSnapshot,
} from "./NativeEngineTypes.ts";

function requireNonNegativeInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || !Number.isFinite(value) || value < 0)
    throw new Error(`${label} must be a non-negative integer`);
}

function normalizeCommands(
  commands: readonly NativeCommand[],
): readonly NativeCommand[] {
  const seen = new Set<number>();
  return Object.freeze(
    commands
      .map((command) => {
        requireNonNegativeInteger(command.sequence, "command sequence");
        requireNonNegativeInteger(command.tick, "command tick");
        if (command.sequence < 1)
          throw new Error("command sequence must be positive");
        if (seen.has(command.sequence))
          throw new Error(`duplicate command sequence: ${command.sequence}`);
        if (command.type.trim().length === 0)
          throw new Error("command type must not be empty");
        seen.add(command.sequence);
        return Object.freeze({
          sequence: command.sequence,
          tick: command.tick,
          type: command.type,
          payload: structuredClone(command.payload),
        });
      })
      .sort((left, right) => left.sequence - right.sequence),
  );
}

export class NativeEngineBridge {
  private readonly addon: NativeEngineAddon;
  private handle: NativeEngineHandle | null;

  constructor(
    addon: NativeEngineAddon,
    config: Readonly<{
      seed?: number;
      startTick?: number;
      speed?: 0 | 1 | 2 | 4;
    }> = {},
  ) {
    if (config.seed !== undefined)
      requireNonNegativeInteger(config.seed, "native seed");
    if (config.startTick !== undefined)
      requireNonNegativeInteger(config.startTick, "native start tick");
    if (config.speed !== undefined && ![0, 1, 2, 4].includes(config.speed))
      throw new Error("native speed must be one of 0, 1, 2, 4");
    this.addon = addon;
    this.handle = addon.createEngine(config);
  }

  dispose(): void {
    if (!this.handle) return;
    this.addon.destroyEngine(this.handle);
    this.handle = null;
  }

  submit(commands: readonly NativeCommand[]): readonly NativeCommand[] {
    const normalized = normalizeCommands(commands);
    this.addon.submitCommands(this.requireHandle(), JSON.stringify(normalized));
    return normalized;
  }

  step(ticks = 1): void {
    requireNonNegativeInteger(ticks, "native ticks");
    this.addon.step(this.requireHandle(), ticks);
  }

  loadV9(save: unknown): void {
    this.addon.loadV9(this.requireHandle(), JSON.stringify(save));
  }

  saveV9<T = unknown>(): T {
    return JSON.parse(this.addon.saveV9(this.requireHandle())) as T;
  }

  snapshot(): NativeSnapshot {
    return JSON.parse(
      this.addon.getSnapshot(this.requireHandle()),
    ) as NativeSnapshot;
  }

  drainEvents(): readonly NativeEvent[] {
    return JSON.parse(
      this.addon.getEvents(this.requireHandle()),
    ) as readonly NativeEvent[];
  }

  domainHash(domain: string): NativeDomainHash {
    if (domain.trim().length === 0) throw new Error("domain must not be empty");
    const raw = this.addon.getDomainHash(this.requireHandle(), domain);
    const ownership =
      raw.ownership === NATIVE_DOMAIN_OWNERSHIP.owned
        ? "owned"
        : raw.ownership === NATIVE_DOMAIN_OWNERSHIP.unowned
          ? "unowned"
          : undefined;
    if (!ownership)
      throw new Error(`unknown native domain ownership: ${raw.ownership}`);
    return Object.freeze({ ownership, version: raw.version, value: raw.value });
  }

  private requireHandle(): NativeEngineHandle {
    if (!this.handle) throw new Error("native engine bridge is disposed");
    return this.handle;
  }
}

export function isNativeShadowEnabled(value: unknown): boolean {
  return value === true || value === "1" || value === "true" || value === "on";
}

export function nativeShadowEnabledFromGlobal(
  scope: unknown = globalThis,
): boolean {
  if (!scope || typeof scope !== "object") return false;
  return isNativeShadowEnabled(
    (scope as Readonly<Record<string, unknown>>).__CIVIC_NATIVE_SHADOW__,
  );
}
