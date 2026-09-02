import type {
  NativeLegacyWorldRequest,
  NativeWorldBridge,
  NativeWorldCreateRequest,
} from "./world/NativeWorldAuthority.ts";
import type { WorldFoundationSnapshot } from "../world/foundation/WorldFoundationTypes.ts";
import type {
  DesignStormEvent,
  FloodExternalSurface,
  FloodResult,
} from "../world/hydrology/HydrologyTypes.ts";
import {
  NATIVE_COMMAND_PROTOCOL_VERSION,
  NATIVE_DOMAIN_OWNERSHIP,
  type NativeCommand,
  type NativeCommandEnvelope,
  type NativeDomainHash,
  type NativeEngineAddon,
  type NativeEngineHandle,
  type NativeEvent,
  type NativeSnapshot,
} from "./NativeEngineTypes.ts";

function requireNonNegativeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error(`${label} must be a non-negative safe integer`);
}

function requireUnicodeScalarString(value: string, label: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff)
        throw new Error(`${label} must be JSON-compatible Unicode`);
      index += 1;
      continue;
    }
    if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff)
      throw new Error(`${label} must be JSON-compatible Unicode`);
  }
}

function normalizeJsonValue(
  value: unknown,
  path: string,
  ancestors = new Set<object>(),
): unknown {
  if (value === null) return null;
  switch (typeof value) {
    case "boolean":
      return value;
    case "string":
      requireUnicodeScalarString(value, path);
      return value;
    case "number":
      if (!Number.isFinite(value))
        throw new Error(`${path} must contain only JSON-compatible values`);
      return Object.is(value, -0) ? 0 : value;
    case "object": {
      if (ancestors.has(value)) throw new Error(`${path} must not contain JSON cycles`);
      ancestors.add(value);
      try {
        if (Array.isArray(value)) {
          const normalized: unknown[] = [];
          for (let index = 0; index < value.length; index += 1) {
            if (!(index in value))
              throw new Error(`${path} must not contain sparse arrays`);
            normalized.push(
              normalizeJsonValue(value[index], `${path}[${index}]`, ancestors),
            );
          }
          return Object.freeze(normalized);
        }

        const prototype = Object.getPrototypeOf(value);
        if (prototype !== Object.prototype && prototype !== null)
          throw new Error(`${path} must contain only JSON-compatible values`);
        if (Object.getOwnPropertySymbols(value).length > 0)
          throw new Error(`${path} must contain only JSON-compatible values`);

        const descriptors = Object.getOwnPropertyDescriptors(value);
        const normalized: Record<string, unknown> = {};
        for (const key of Object.keys(value).sort()) {
          requireUnicodeScalarString(key, `${path} key`);
          const descriptor = descriptors[key];
          if (!descriptor || !("value" in descriptor))
            throw new Error(`${path} must not contain accessors`);
          normalized[key] = normalizeJsonValue(
            descriptor.value,
            `${path}.${key}`,
            ancestors,
          );
        }
        return Object.freeze(normalized);
      } finally {
        ancestors.delete(value);
      }
    }
    default:
      throw new Error(`${path} must contain only JSON-compatible values`);
  }
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
        requireUnicodeScalarString(command.type, "command type");
        seen.add(command.sequence);
        return Object.freeze({
          sequence: command.sequence,
          tick: command.tick,
          type: command.type,
          payload: normalizeJsonValue(command.payload, "command payload"),
        });
      })
      .sort((left, right) => left.sequence - right.sequence),
  );
}

function toWireEnvelopes(
  commands: readonly NativeCommand[],
): readonly NativeCommandEnvelope[] {
  return Object.freeze(
    commands.map((command) =>
      Object.freeze({
        version: NATIVE_COMMAND_PROTOCOL_VERSION,
        ...command,
      }),
    ),
  );
}

function parseNativeJson<T>(text: string, label: string): T {
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} returned invalid JSON: ${detail}`);
  }
}

export class NativeEngineBridge implements NativeWorldBridge {
  private readonly addon: NativeEngineAddon;
  private handle: NativeEngineHandle | null;
  private currentWorldSnapshot: WorldFoundationSnapshot | null = null;

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
    this.currentWorldSnapshot = null;
  }

  submit(commands: readonly NativeCommand[]): readonly NativeCommand[] {
    const normalized = normalizeCommands(commands);
    const envelopes = toWireEnvelopes(normalized);
    this.addon.submitCommands(this.requireHandle(), JSON.stringify(envelopes));
    return normalized;
  }

  step(ticks = 1): void {
    requireNonNegativeInteger(ticks, "native ticks");
    this.addon.step(this.requireHandle(), ticks);
  }

  loadV9(save: unknown): void {
    const normalized = normalizeJsonValue(save, "Save V9");
    this.addon.loadV9(this.requireHandle(), JSON.stringify(normalized));
  }

  saveV9<T = unknown>(): T {
    return parseNativeJson<T>(
      this.addon.saveV9(this.requireHandle()),
      "native Save V9",
    );
  }

  snapshot(): NativeSnapshot {
    return parseNativeJson<NativeSnapshot>(
      this.addon.getSnapshot(this.requireHandle()),
      "native kernel snapshot",
    );
  }

  drainEvents(): readonly NativeEvent[] {
    return parseNativeJson<readonly NativeEvent[]>(
      this.addon.getEvents(this.requireHandle()),
      "native events",
    );
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

  createWorld(request: NativeWorldCreateRequest): WorldFoundationSnapshot {
    const normalized = normalizeJsonValue(request, "native world create request");
    const snapshot = parseNativeJson<WorldFoundationSnapshot>(
      this.addon.createWorld(this.requireHandle(), JSON.stringify(normalized)),
      "native world create",
    );
    this.currentWorldSnapshot = snapshot;
    return snapshot;
  }

  restoreWorld(snapshot: WorldFoundationSnapshot): WorldFoundationSnapshot {
    const normalized = normalizeJsonValue(snapshot, "native world snapshot");
    const restored = parseNativeJson<WorldFoundationSnapshot>(
      this.addon.restoreWorld(this.requireHandle(), JSON.stringify(normalized)),
      "native world restore",
    );
    this.currentWorldSnapshot = restored;
    return restored;
  }

  createLegacyWorld(request: NativeLegacyWorldRequest): WorldFoundationSnapshot {
    const normalized = normalizeJsonValue(request, "native legacy world request");
    const snapshot = parseNativeJson<WorldFoundationSnapshot>(
      this.addon.createLegacyWorld(
        this.requireHandle(),
        JSON.stringify(normalized),
      ),
      "native legacy world create",
    );
    this.currentWorldSnapshot = snapshot;
    return snapshot;
  }

  runDesignStorm(
    event: DesignStormEvent,
    externalSurface?: FloodExternalSurface,
  ): Readonly<{ result: FloodResult; snapshot: WorldFoundationSnapshot }> {
    const snapshot = this.currentWorldSnapshot;
    if (!snapshot)
      throw new Error("native world must be created or restored before design storm");

    let payload: unknown = event;
    if (externalSurface) {
      const imperviousFraction: number[] = [];
      for (let y = 0; y < snapshot.terrain.height; y += 1) {
        for (let x = 0; x < snapshot.terrain.width; x += 1) {
          const fraction = externalSurface.imperviousFractionAt(x, y);
          if (!Number.isFinite(fraction) || fraction < 0 || fraction > 1)
            throw new Error(
              `impervious fraction at ${x},${y} must be finite and in [0,1]`,
            );
          imperviousFraction.push(fraction);
        }
      }
      payload = { event, imperviousFraction };
    }

    const normalized = normalizeJsonValue(payload, "native design storm request");
    const response = parseNativeJson<
      Readonly<{ result: FloodResult; snapshot: WorldFoundationSnapshot }>
    >(
      this.addon.runDesignStorm(
        this.requireHandle(),
        JSON.stringify(normalized),
      ),
      "native design storm",
    );
    this.currentWorldSnapshot = response.snapshot;
    return response;
  }

  private requireHandle(): NativeEngineHandle {
    if (!this.handle) throw new Error("native engine bridge is disposed");
    return this.handle;
  }
}

export function isNativeShadowEnabled(value: unknown): boolean {
  return value === true || value === "1" || value === "true" || value === "on";
}

export function nativeShadowEnabledFromGlobal(scope: unknown = globalThis): boolean {
  if (!scope || typeof scope !== "object") return false;
  return isNativeShadowEnabled(
    (scope as Readonly<Record<string, unknown>>).__CIVIC_NATIVE_SHADOW__,
  );
}
