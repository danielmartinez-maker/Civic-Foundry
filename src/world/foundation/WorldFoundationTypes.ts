import type { GeographySnapshot } from '../geography/GeographyTypes.ts';
import type { HydrologySnapshot, FloodResult } from '../hydrology/HydrologyTypes.ts';
import type { TerrainFieldSnapshot } from '../terrain/TerrainTypes.ts';
import type { TerrainCell } from '../terrain/TerrainGrid.ts';
import type { WorldGenerationConfig } from '../generation/WorldGenerationConfig.ts';

export type WorldFoundationMode='generated-1r'|'legacy-flat'|'legacy-explicit';
export type LegacyTerrainSnapshot=Readonly<{width:number;height:number;cells:readonly TerrainCell[]}>;
export type WorldFoundationSnapshot=Readonly<{
  mode:WorldFoundationMode;seed:number;config:WorldGenerationConfig;scenarioId:string|null;
  terrain:TerrainFieldSnapshot;hydrology:HydrologySnapshot;geography:GeographySnapshot;
  legacyCompatibility:LegacyTerrainSnapshot|null;lastFloodResult:FloodResult|null;
}>;
