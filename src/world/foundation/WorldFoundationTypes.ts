import type { GeographySnapshot } from '../geography/GeographyTypes.ts';
import type { HydrologySnapshot, FloodResult } from '../hydrology/HydrologyTypes.ts';
import type { TerrainFieldSnapshot } from '../terrain/TerrainTypes.ts';
import type { TerrainCell } from '../terrain/TerrainGrid.ts';
import type { WorldGenerationConfig } from '../generation/WorldGenerationConfig.ts';

export type WorldFoundationMode = 'generated-1r' | 'legacy-flat' | 'legacy-explicit';
export type LegacyTerrainSnapshot = Readonly<{ width: number; height: number; cells: readonly TerrainCell[] }>;
export type WorldFoundationSnapshot = Readonly<{
  mode: WorldFoundationMode;
  seed: number;
  config: WorldGenerationConfig;
  scenarioId: string | null;
  terrain: TerrainFieldSnapshot;
  hydrology: HydrologySnapshot;
  geography: GeographySnapshot;
  legacyCompatibility: LegacyTerrainSnapshot | null;
  lastFloodResult: FloodResult | null;
}>;

export type WorldGeneratedPayload = Readonly<{
  seed: number;
  preset: WorldGenerationConfig['preset'];
  width: number;
  height: number;
  scenarioId: string | null;
}>;
export type WorldMigratedTo1RPayload = Readonly<{ fromSaveVersion: number; mode: 'legacy-flat' }>;
export type FloodEventStartedPayload = Readonly<{ eventId: string; rainfallMm: number; durationHours: number }>;
export type FloodEventResolvedPayload = Readonly<{ eventId: string; floodedCells: number; balanceError: number }>;
