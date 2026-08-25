import type { GeographySnapshot } from '../geography/GeographyTypes.ts';
import type { Polygon2 } from '../geometry/GeometryTypes.ts';
import type { SoilClass, SurfaceWaterClass } from '../terrain/TerrainTypes.ts';
import type { WorldGenerationConfig } from './WorldGenerationConfig.ts';

export type ScenarioWorldDefinition = Readonly<{
  id: string;
  generation?: Partial<WorldGenerationConfig>;
  rootBoundary?: Polygon2;
  elevationOverrides?: readonly Readonly<{ x:number; y:number; elevationMeters:number }>[];
  permanentWaterPolygons?: readonly Readonly<{ class:Exclude<SurfaceWaterClass,'none'>; polygon:Polygon2 }>[];
  soilRegions?: readonly Readonly<{ soilClass:SoilClass; polygon:Polygon2 }>[];
  groundwaterRegions?: readonly Readonly<{ depthMeters:number; polygon:Polygon2 }>[];
  contaminationRegions?: readonly Readonly<{ index:number; polygon:Polygon2 }>[];
  administrativeBoundaries?: GeographySnapshot;
}>;
