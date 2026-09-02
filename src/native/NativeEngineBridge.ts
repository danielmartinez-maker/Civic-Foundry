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
import {
  SOCIOECONOMIC_AUTHORITY_GATES,
  type SocioeconomicAuthorityCutoverAdapter,
  type SocioeconomicAuthorityGate,
} from "./SocioeconomicAuthorityCutover.ts";

const SOCIOECONOMIC_DOMAIN_BY_GATE: Readonly<
  Record<SocioeconomicAuthorityGate, string>
> = Object.freeze({
  inventory_freight: "economy.inventory_freight",
  firms_production: "economy.firms_production",
  labor: "economy.labor",
  households_housing: "population.households_housing",
  personhood_lifecycle: "population.personhood_lifecycle",
});

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
      if (ancestors.has(value))
        throw new Error(`${path} must not contain JSON cycles`);
      ancestors.add(value);
      try {
        if (Array.isArray(value)) {
          const normalized: unknown[] = [];
          for (let index = 0; index < value.length; index += 1) {
            if (!(index in value))
              throw new Error(
                `${path} must contain only JSON-compatible values; sparse arrays are not supported`,
              );
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

function validateSocioeconomicGateBatch(
  gates: readonly SocioeconomicAuthorityGate[],
): void {
  if (gates.length === 0)
    throw new Error(
      "socioeconomic authority transfer requires at least one gate",
    );
  const seen = new Set<SocioeconomicAuthorityGate>();
  let previous = -1;
  for (const gate of gates) {
    const index = SOCIOECONOMIC_AUTHORITY_GATES.indexOf(gate);
    if (index < 0)
      throw new Error(`unknown socioeconomic authority gate: ${gate}`);
    if (seen.has(gate))
      throw new Error(`duplicate socioeconomic authority gate: ${gate}`);
    if (index <= previous)
      throw new Error(
        "socioeconomic authority gates must be supplied in declared order",
      );
    seen.add(gate);
    previous = index;
  }
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
    const envelopes = toWireEnvelopes(normalized);
    this.addon.submitCommands(this.requireHandle(), JSON.stringify(envelopes));
    return normalized;
  }

  transferSocioeconomicAuthority(
    gates: readonly SocioeconomicAuthorityGate[],
    sequenceStart: number,
    cutover: SocioeconomicAuthorityCutoverAdapter,
  ): void {
    validateSocioeconomicGateBatch(gates);
    requireNonNegativeInteger(sequenceStart, "socioeconomic transfer sequence");
    if (sequenceStart < 1)
      throw new Error("socioeconomic transfer sequence must be positive");
    if (sequenceStart > Number.MAX_SAFE_INTEGER - gates.length + 1)
      throw new Error(
        "socioeconomic transfer sequence range exceeds safe integers",
      );

    for (const gate of gates) {
      if (!cutover.typescriptWriteEnabled(gate))
        throw new Error(`TypeScript writes are already disabled for ${gate}`);
      const native = this.domainHash(SOCIOECONOMIC_DOMAIN_BY_GATE[gate]);
      if (native.ownership !== "unowned")
        throw new Error(`native socioeconomic gate is already owned: ${gate}`);
    }

    const tick = this.snapshot().tick + 1;
    requireNonNegativeInteger(tick, "socioeconomic transfer tick");
    const disabled: SocioeconomicAuthorityGate[] = [];
    try {
      for (const gate of gates) {
        cutover.disableTypescriptWrites(gate);
        disabled.push(gate);
        if (cutover.typescriptWriteEnabled(gate))
          throw new Error(`failed to disable TypeScript writes for ${gate}`);
      }

      const commands = gates.map((gate, index) => ({
        sequence: sequenceStart + index,
        tick,
        type: `native.socioeconomic.transfer.${gate}`,
        payload: null,
      }));
      this.submit(commands);
    } catch (error) {
      for (const gate of disabled.reverse())
        cutover.enableTypescriptWrites(gate);
      throw error;
    }

    // Once the transfer commands have entered the native command queue, fail closed.
    // A failed native tick retains its pending command queue for deterministic retry, so
    // re-enabling TypeScript here could create dual writers on a later native step.
    this.step(1);
    for (const gate of gates) {
      const native = this.domainHash(SOCIOECONOMIC_DOMAIN_BY_GATE[gate]);
      if (native.ownership !== "owned")
        throw new Error(`native socioeconomic transfer did not claim ${gate}`);
      if (cutover.typescriptWriteEnabled(gate))
        throw new Error(
          `dual socioeconomic writers detected after transfer: ${gate}`,
        );
    }
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
