import type {
  NativeUrbanLegacyRequest,
  NativeUrbanSnapshot,
  NativeUrbanState,
} from "../NativeEngineTypes.ts";

export interface NativeUrbanBridge {
  rebuildUrbanLegacy(request: NativeUrbanLegacyRequest): NativeUrbanSnapshot;
  restoreUrbanState(snapshot: NativeUrbanState): NativeUrbanSnapshot;
  urbanSnapshot(): NativeUrbanSnapshot;
  loadV9(save: unknown): void;
  saveV9<T = unknown>(): T;
}

export type NativeUrbanAuthorityOverride = Readonly<{
  enabled: boolean;
  bridge: NativeUrbanBridge;
}>;

const overrides: NativeUrbanAuthorityOverride[] = [];

function isBridge(value: unknown): value is NativeUrbanBridge {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Readonly<Record<string, unknown>>;
  return (
    typeof candidate.rebuildUrbanLegacy === "function" &&
    typeof candidate.restoreUrbanState === "function" &&
    typeof candidate.urbanSnapshot === "function" &&
    typeof candidate.loadV9 === "function" &&
    typeof candidate.saveV9 === "function"
  );
}

export function withNativeUrbanAuthorityOverride<T>(
  override: NativeUrbanAuthorityOverride,
  operation: () => T,
): T {
  overrides.push(override);
  try {
    return operation();
  } finally {
    overrides.pop();
  }
}

export function nativeUrbanAuthorityEnabledFromGlobal(
  scope: unknown = globalThis,
): boolean {
  if (!scope || typeof scope !== "object") return false;
  const value = (scope as Readonly<Record<string, unknown>>)
    .__CIVIC_NATIVE_URBAN_AUTHORITY__;
  return value === true || value === "1" || value === "true" || value === "on";
}

export function activeNativeUrbanAuthorityOverride(
  scope: unknown = globalThis,
): NativeUrbanAuthorityOverride | undefined {
  const override = overrides[overrides.length - 1];
  if (override) return override;
  if (!nativeUrbanAuthorityEnabledFromGlobal(scope)) return undefined;
  if (!scope || typeof scope !== "object") return undefined;
  const bridge = (scope as Readonly<Record<string, unknown>>)
    .__CIVIC_NATIVE_URBAN_BRIDGE__;
  if (!isBridge(bridge)) {
    throw new Error(
      "native urban authority is enabled but __CIVIC_NATIVE_URBAN_BRIDGE__ is unavailable",
    );
  }
  return Object.freeze({ enabled: true, bridge });
}
