import type { SoilClass } from './TerrainTypes.ts';

export type SoilEngineeringProperties = Readonly<{
  infiltrationMmPerHour: number;
  bearingCapacityKpa: number;
  erodibility: number;
  preparationBase: number;
}>;

export const SOIL_PROPERTIES: Readonly<Record<SoilClass, SoilEngineeringProperties>> = Object.freeze({
  rock: Object.freeze({ infiltrationMmPerHour: 4, bearingCapacityKpa: 600, erodibility: 0.10, preparationBase: 1.05 }),
  gravel: Object.freeze({ infiltrationMmPerHour: 35, bearingCapacityKpa: 300, erodibility: 0.20, preparationBase: 0.90 }),
  sand: Object.freeze({ infiltrationMmPerHour: 28, bearingCapacityKpa: 180, erodibility: 0.45, preparationBase: 1.00 }),
  loam: Object.freeze({ infiltrationMmPerHour: 18, bearingCapacityKpa: 160, erodibility: 0.35, preparationBase: 1.00 }),
  clay: Object.freeze({ infiltrationMmPerHour: 5, bearingCapacityKpa: 120, erodibility: 0.25, preparationBase: 1.18 }),
  alluvium: Object.freeze({ infiltrationMmPerHour: 12, bearingCapacityKpa: 90, erodibility: 0.55, preparationBase: 1.28 }),
  peat: Object.freeze({ infiltrationMmPerHour: 8, bearingCapacityKpa: 35, erodibility: 0.30, preparationBase: 1.70 }),
  fill_disturbed: Object.freeze({ infiltrationMmPerHour: 10, bearingCapacityKpa: 80, erodibility: 0.50, preparationBase: 1.35 }),
});

export type LandPreparationInputs = Readonly<{
  slope: number;
  soilClass: SoilClass;
  bedrockDepthMeters: number;
  groundwaterDepthMeters: number;
  contaminationIndex: number;
  floodSusceptibility: number;
}>;

function clamp(value: number, min: number, max: number): number { return Math.max(min, Math.min(max, value)); }
function requireFinite(name: string, value: number): void { if (!Number.isFinite(value)) throw new Error(`${name} must be finite`); }

export function calculateLandPreparationMultiplier(input: LandPreparationInputs): number {
  requireFinite('slope', input.slope);
  requireFinite('bedrockDepthMeters', input.bedrockDepthMeters);
  requireFinite('groundwaterDepthMeters', input.groundwaterDepthMeters);
  requireFinite('contaminationIndex', input.contaminationIndex);
  requireFinite('floodSusceptibility', input.floodSusceptibility);
  if (input.slope < 0 || input.bedrockDepthMeters < 0 || input.groundwaterDepthMeters < 0) throw new Error('terrain preparation depths and slope must be non-negative');
  const soil = SOIL_PROPERTIES[input.soilClass];
  if (!soil) throw new Error(`invalid soil class: ${String(input.soilClass)}`);
  const slopeFactor = 1 + clamp(input.slope, 0, 1.5) * 0.85;
  const groundwaterFactor = 1 + clamp((2.5 - input.groundwaterDepthMeters) / 2.5, 0, 1) * 0.35;
  const contaminationFactor = 1 + clamp(input.contaminationIndex, 0, 1) * 0.60;
  const bedrockFactor = 1 + clamp((input.bedrockDepthMeters - 5) / 15, 0, 1) * 0.18;
  const floodFactor = 1 + clamp(input.floodSusceptibility, 0, 1) * 0.40;
  return clamp(soil.preparationBase * slopeFactor * groundwaterFactor * contaminationFactor * bedrockFactor * floodFactor, 0.75, 3.0);
}
