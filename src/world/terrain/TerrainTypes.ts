export type SoilClass = 'rock' | 'gravel' | 'sand' | 'loam' | 'clay' | 'alluvium' | 'peat' | 'fill_disturbed';
export type VegetationClass = 'none' | 'grass' | 'forest' | 'scrub' | 'wetland';
export type SurfaceWaterClass = 'none' | 'lake' | 'river' | 'coast';
export type WatershedId = string;

export type TerrainPhysicalSample = Readonly<{
  elevationMeters: number;
  slope: number;
  aspectRadians: number;
  soilClass: SoilClass;
  soilDepthMeters: number;
  bearingCapacityKpa: number;
  bedrockDepthMeters: number;
  groundwaterDepthMeters: number;
  vegetationClass: VegetationClass;
  contaminationIndex: number;
  landPreparationMultiplier: number;
  surfaceWater: SurfaceWaterClass;
  buildable: boolean;
}>;

export type TerrainSample = TerrainPhysicalSample & Readonly<{
  conditionedElevationMeters: number;
  watershedId: WatershedId;
  flowAccumulation: number;
  floodSusceptibility: number;
}>;

export type TerrainFieldSnapshot = Readonly<{
  width: number;
  height: number;
  metersPerCell: number;
  samples: readonly TerrainPhysicalSample[];
}>;
