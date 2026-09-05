import { GeographyHierarchy } from "../../world/geography/GeographyHierarchy.ts";
import { GeometryIndex } from "../../world/geometry/GeometryIndex.ts";
import type { ScenarioWorldDefinition } from "../../world/generation/ScenarioWorldDefinition.ts";
import {
  resolveWorldGenerationConfig,
  type WorldGenerationConfig,
} from "../../world/generation/WorldGenerationConfig.ts";
import { HydrologyModel } from "../../world/hydrology/HydrologyModel.ts";
import type {
  DesignStormEvent,
  FloodExternalSurface,
  FloodResult,
} from "../../world/hydrology/HydrologyTypes.ts";
import { calculateLandPreparationMultiplier } from "../../world/terrain/SoilModel.ts";
import { TerrainField } from "../../world/terrain/TerrainField.ts";
import {
  generatedLegacyTerrain,
  materializeLegacyTerrain,
} from "../../world/terrain/LegacyTerrainAdapter.ts";
import type { TerrainGrid } from "../../world/terrain/TerrainGrid.ts";
import type { TerrainSample } from "../../world/terrain/TerrainTypes.ts";
import type {
  WorldFoundationMode,
  WorldFoundationSnapshot,
} from "../../world/foundation/WorldFoundationTypes.ts";

export type NativeWorldCreateRequest = Readonly<{
  seed: number;
  config: WorldGenerationConfig;
  scenario?: ScenarioWorldDefinition;
}>;

export type NativeLegacyWorldRequest = Readonly<{
  seed: number;
  mode: "legacy-flat" | "legacy-explicit";
  terrain: Readonly<{
    width: number;
    height: number;
    cells: readonly unknown[];
  }>;
}>;

export interface NativeWorldBridge {
  createWorld(request: NativeWorldCreateRequest): WorldFoundationSnapshot;
  restoreWorld(snapshot: WorldFoundationSnapshot): WorldFoundationSnapshot;
  createLegacyWorld(request: NativeLegacyWorldRequest): WorldFoundationSnapshot;
  runDesignStorm(
    event: DesignStormEvent,
    externalSurface?: FloodExternalSurface,
  ): Readonly<{ result: FloodResult; snapshot: WorldFoundationSnapshot }>;
}

export type NativeWorldAuthorityOverride = Readonly<{
  enabled: boolean;
  bridge: NativeWorldBridge;
}>;

const overrides: NativeWorldAuthorityOverride[] = [];

function cloneFlood(result: FloodResult | null): FloodResult | null {
  if (result === null) return null;
  return Object.freeze({
    ...result,
    depthMeters: Object.freeze(result.depthMeters.slice()),
  });
}

function cloneSnapshot(
  snapshot: WorldFoundationSnapshot,
): WorldFoundationSnapshot {
  return Object.freeze({
    mode: snapshot.mode,
    seed: snapshot.seed,
    config: Object.freeze({ ...resolveWorldGenerationConfig(snapshot.config) }),
    scenarioId: snapshot.scenarioId,
    terrain: Object.freeze({
      width: snapshot.terrain.width,
      height: snapshot.terrain.height,
      metersPerCell: snapshot.terrain.metersPerCell,
      samples: Object.freeze(
        snapshot.terrain.samples.map((sample) => Object.freeze({ ...sample })),
      ),
    }),
    hydrology: Object.freeze({
      width: snapshot.hydrology.width,
      height: snapshot.hydrology.height,
      conditionedElevationMeters: Object.freeze(
        snapshot.hydrology.conditionedElevationMeters.slice(),
      ),
      receiver: Object.freeze(snapshot.hydrology.receiver.slice()),
      watersheds: Object.freeze(
        snapshot.hydrology.watersheds.map((item) => Object.freeze({ ...item })),
      ),
      channels: Object.freeze(
        snapshot.hydrology.channels.map((item) => Object.freeze({ ...item })),
      ),
      flowAccumulation: Object.freeze(
        snapshot.hydrology.flowAccumulation.slice(),
      ),
      watershedIds: Object.freeze(snapshot.hydrology.watershedIds.slice()),
      floodSusceptibility: Object.freeze(
        snapshot.hydrology.floodSusceptibility.slice(),
      ),
    }),
    geography: Object.freeze({
      entities: Object.freeze(
        snapshot.geography.entities.map((entity) =>
          Object.freeze({
            ...entity,
            boundary: Object.freeze({
              points: Object.freeze(
                entity.boundary.points.map((point) =>
                  Object.freeze({ ...point }),
                ),
              ),
            }),
          }),
        ),
      ),
    }),
    legacyCompatibility:
      snapshot.legacyCompatibility === null
        ? null
        : Object.freeze({
            width: snapshot.legacyCompatibility.width,
            height: snapshot.legacyCompatibility.height,
            cells: Object.freeze(
              snapshot.legacyCompatibility.cells.map((cell) =>
                Object.freeze({ ...cell }),
              ),
            ),
          }),
    lastFloodResult: cloneFlood(snapshot.lastFloodResult),
  });
}

function isBridge(value: unknown): value is NativeWorldBridge {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Readonly<Record<string, unknown>>;
  return (
    typeof candidate.createWorld === "function" &&
    typeof candidate.restoreWorld === "function" &&
    typeof candidate.createLegacyWorld === "function" &&
    typeof candidate.runDesignStorm === "function"
  );
}

export function withNativeWorldAuthorityOverride<T>(
  override: NativeWorldAuthorityOverride,
  operation: () => T,
): T {
  overrides.push(override);
  try {
    return operation();
  } finally {
    overrides.pop();
  }
}

export function nativeWorldAuthorityEnabledFromGlobal(
  scope: unknown = globalThis,
): boolean {
  if (!scope || typeof scope !== "object") return false;
  const value = (scope as Readonly<Record<string, unknown>>)
    .__CIVIC_NATIVE_WORLD_AUTHORITY__;
  return value === true || value === "1" || value === "true" || value === "on";
}

export function activeNativeWorldAuthorityOverride(
  scope: unknown = globalThis,
): NativeWorldAuthorityOverride | undefined {
  const override = overrides[overrides.length - 1];
  if (override) return override;
  if (!nativeWorldAuthorityEnabledFromGlobal(scope)) return undefined;
  if (!scope || typeof scope !== "object") return undefined;
  const bridge = (scope as Readonly<Record<string, unknown>>)
    .__CIVIC_NATIVE_WORLD_BRIDGE__;
  if (!isBridge(bridge)) {
    throw new Error(
      "native world authority is enabled but __CIVIC_NATIVE_WORLD_BRIDGE__ is unavailable",
    );
  }
  return Object.freeze({ enabled: true, bridge });
}

export class NativeWorldAuthority {
  readonly bridge: NativeWorldBridge;
  mode: WorldFoundationMode;
  seed: number;
  config: WorldGenerationConfig;
  scenarioId: string | null;
  terrain: TerrainField;
  hydrology: HydrologyModel;
  geography: GeographyHierarchy;
  spatialIndex: GeometryIndex;
  private snapshotValue: WorldFoundationSnapshot;

  private constructor(
    bridge: NativeWorldBridge,
    snapshot: WorldFoundationSnapshot,
  ) {
    this.bridge = bridge;
    this.snapshotValue = cloneSnapshot(snapshot);
    this.mode = this.snapshotValue.mode;
    this.seed = this.snapshotValue.seed;
    this.config = this.snapshotValue.config;
    this.scenarioId = this.snapshotValue.scenarioId;
    this.terrain = TerrainField.restore(this.snapshotValue.terrain);
    this.hydrology = HydrologyModel.restore(this.snapshotValue.hydrology);
    this.geography = GeographyHierarchy.restore(this.snapshotValue.geography);
    this.spatialIndex = this.buildSpatialIndex();
  }

  static generate(
    bridge: NativeWorldBridge,
    request: NativeWorldCreateRequest,
  ): NativeWorldAuthority {
    return new NativeWorldAuthority(bridge, bridge.createWorld(request));
  }

  static restore(
    bridge: NativeWorldBridge,
    snapshot: WorldFoundationSnapshot,
  ): NativeWorldAuthority {
    return new NativeWorldAuthority(bridge, bridge.restoreWorld(snapshot));
  }

  static fromSnapshot(
    bridge: NativeWorldBridge,
    snapshot: WorldFoundationSnapshot,
  ): NativeWorldAuthority {
    return new NativeWorldAuthority(bridge, snapshot);
  }

  static fromLegacyTerrain(
    bridge: NativeWorldBridge,
    terrain: TerrainGrid,
    seed: number,
    mode: "legacy-flat" | "legacy-explicit",
  ): NativeWorldAuthority {
    return new NativeWorldAuthority(
      bridge,
      bridge.createLegacyWorld({
        seed,
        mode,
        terrain: Object.freeze({
          width: terrain.width,
          height: terrain.height,
          cells: Object.freeze(
            terrain.snapshot().map((cell) => Object.freeze({ ...cell })),
          ),
        }),
      }),
    );
  }

  terrainSampleAt(x: number, y: number): TerrainSample {
    const physical = this.terrain.getPhysical(x, y);
    const hydro = this.hydrology.sampleAt(x, y);
    return Object.freeze({
      ...physical,
      ...hydro,
      landPreparationMultiplier: this.preparationMultiplierAt(x, y),
    });
  }

  legacyTerrain(): TerrainGrid {
    const compatibility = this.snapshotValue.legacyCompatibility;
    return compatibility
      ? materializeLegacyTerrain(compatibility)
      : generatedLegacyTerrain(this.terrain, this.hydrology);
  }

  preparationMultiplierAt(x: number, y: number): number {
    if (this.mode !== "generated-1r") {
      this.terrain.getPhysical(x, y);
      return 1;
    }
    const physical = this.terrain.getPhysical(x, y);
    const hydro = this.hydrology.sampleAt(x, y);
    return calculateLandPreparationMultiplier({
      slope: physical.slope,
      soilClass: physical.soilClass,
      bedrockDepthMeters: physical.bedrockDepthMeters,
      groundwaterDepthMeters: physical.groundwaterDepthMeters,
      contaminationIndex: physical.contaminationIndex,
      floodSusceptibility: hydro.floodSusceptibility,
    });
  }

  runDesignStorm(
    event: DesignStormEvent,
    externalSurface?: FloodExternalSurface,
  ): FloodResult {
    const next = this.bridge.runDesignStorm(event, externalSurface);
    this.refresh(next.snapshot);
    return cloneFlood(next.result)!;
  }

  floodDepthAt(x: number, y: number): number {
    if (!this.terrain.inBounds(x, y)) {
      throw new Error(`flood coordinate out of bounds: ${x},${y}`);
    }
    return (
      this.snapshotValue.lastFloodResult?.depthMeters[
        y * this.terrain.width + x
      ] ?? 0
    );
  }

  snapshotAuthoritative(): WorldFoundationSnapshot {
    return cloneSnapshot(this.snapshotValue);
  }

  diagnosticSnapshot(): Readonly<{
    mode: WorldFoundationMode;
    width: number;
    height: number;
    watersheds: number;
    channels: number;
    lastFloodedCells: number;
  }> {
    return Object.freeze({
      mode: this.mode,
      width: this.terrain.width,
      height: this.terrain.height,
      watersheds: this.hydrology.watersheds().length,
      channels: this.hydrology.channels().length,
      lastFloodedCells:
        this.snapshotValue.lastFloodResult?.depthMeters.filter(
          (depth) => depth > 0,
        ).length ?? 0,
    });
  }

  private refresh(snapshot: WorldFoundationSnapshot): void {
    const next = cloneSnapshot(snapshot);
    if (next.seed !== this.seed) {
      throw new Error("native world snapshot changed seed during mutation");
    }
    this.snapshotValue = next;
    this.mode = next.mode;
    this.config = next.config;
    this.scenarioId = next.scenarioId;
    this.terrain = TerrainField.restore(next.terrain);
    this.hydrology = HydrologyModel.restore(next.hydrology);
    this.geography = GeographyHierarchy.restore(next.geography);
    this.spatialIndex = this.buildSpatialIndex();
  }

  private buildSpatialIndex(): GeometryIndex {
    const index = new GeometryIndex({
      minX: 0,
      minY: 0,
      maxX: this.terrain.width,
      maxY: this.terrain.height,
    });
    index.rebuild(this.geography.list(), this.hydrology.channels());
    return index;
  }
}
