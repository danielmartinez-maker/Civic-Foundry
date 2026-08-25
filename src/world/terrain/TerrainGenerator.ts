import type { SeededRandom } from '../../simulation/core/SeededRandom.ts';
import type { WorldGenerationConfig } from '../generation/WorldGenerationConfig.ts';
import { calculateLandPreparationMultiplier, SOIL_PROPERTIES } from './SoilModel.ts';
import { TerrainField } from './TerrainField.ts';
import type { SoilClass, SurfaceWaterClass, TerrainPhysicalSample, VegetationClass } from './TerrainTypes.ts';

export type TerrainGenerationStreams = Readonly<{
  topography: SeededRandom;
  soils: SeededRandom;
  groundwater: SeededRandom;
  vegetation: SeededRandom;
}>;

type NoiseOctave = Readonly<{ frequency:number; amplitude:number; phaseX:number; phaseY:number; phaseD:number }>;

function makeOctaves(rng: SeededRandom): readonly NoiseOctave[] {
  return Object.freeze([1,2,4,8].map((frequency, index) => Object.freeze({
    frequency,
    amplitude: 1 / Math.pow(1.9, index),
    phaseX: rng.next() * Math.PI * 2,
    phaseY: rng.next() * Math.PI * 2,
    phaseD: rng.next() * Math.PI * 2,
  })));
}

function continuousNoise(nx:number, ny:number, octaves:readonly NoiseOctave[]): number {
  let value = 0; let weight = 0;
  for (const octave of octaves) {
    const f = octave.frequency * Math.PI * 2;
    const component = Math.sin(nx * f + octave.phaseX) * 0.48
      + Math.cos(ny * f + octave.phaseY) * 0.37
      + Math.sin((nx + ny) * f * 0.67 + octave.phaseD) * 0.15;
    value += component * octave.amplitude;
    weight += octave.amplitude;
  }
  return weight > 0 ? value / weight : 0;
}

function presetElevation(config:WorldGenerationConfig, nx:number, ny:number, noise:number, riverPhase:number): number {
  const dx = nx - 0.5; const dy = ny - 0.5;
  const radial = Math.min(1, Math.hypot(dx, dy) / Math.SQRT1_2);
  switch (config.preset) {
    case 'plain': return 95 + noise * 8;
    case 'river_valley': {
      const riverX = 0.5 + Math.sin(ny * Math.PI * 2 + riverPhase) * 0.08;
      const distance = Math.abs(nx - riverX);
      return 135 + noise * 18 + (0.5 - ny) * 12 - Math.exp(-(distance * distance) / 0.012) * 58;
    }
    case 'basin': return 78 + radial * 62 + noise * 16;
    case 'rolling_uplands': return 118 + noise * 34 + radial * 8;
    case 'ridge_edge': return 92 + (1 - nx) * 78 + noise * 22;
    case 'coastal_lowland': return 8 + (1 - nx) * 95 + noise * 10 + dy * 4;
  }
}

function gradient(values:readonly number[], width:number, height:number, x:number, y:number, cellSize:number): readonly [number,number] {
  const left = values[y * width + Math.max(0,x-1)]!;
  const right = values[y * width + Math.min(width-1,x+1)]!;
  const up = values[Math.max(0,y-1) * width + x]!;
  const down = values[Math.min(height-1,y+1) * width + x]!;
  const dxCells = x === 0 || x === width - 1 ? 1 : 2;
  const dyCells = y === 0 || y === height - 1 ? 1 : 2;
  return [(right-left)/(dxCells*cellSize),(down-up)/(dyCells*cellSize)];
}

function chooseSoil(slope:number, groundwater:number, normalizedElevation:number, rng:SeededRandom): SoilClass {
  const roll = rng.next();
  if (slope > 0.48 || normalizedElevation > 0.88) return 'rock';
  if (groundwater < 0.9 && normalizedElevation < 0.40) return roll < 0.28 ? 'peat' : 'alluvium';
  if (normalizedElevation < 0.28 && roll < 0.42) return 'alluvium';
  if (roll < 0.16) return 'gravel';
  if (roll < 0.36) return 'sand';
  if (roll < 0.68) return 'loam';
  return 'clay';
}

function chooseVegetation(surfaceWater:SurfaceWaterClass, groundwater:number, slope:number, rng:SeededRandom): VegetationClass {
  if (surfaceWater !== 'none') return surfaceWater === 'coast' ? 'none' : 'wetland';
  if (groundwater < 1.2 && slope < 0.20) return 'wetland';
  const roll = rng.next();
  if (roll < 0.18 && slope < 0.45) return 'forest';
  if (roll < 0.36) return 'scrub';
  return 'grass';
}

export function generatePhysicalTerrain(config:WorldGenerationConfig, streams:TerrainGenerationStreams): TerrainField {
  const octaves = makeOctaves(streams.topography);
  const riverPhase = streams.topography.next() * Math.PI * 2;
  const elevation:number[] = [];
  for (let y=0;y<config.height;y++) {
    const ny = config.height === 1 ? 0.5 : y/(config.height-1);
    for (let x=0;x<config.width;x++) {
      const nx = config.width === 1 ? 0.5 : x/(config.width-1);
      const noise = continuousNoise(nx,ny,octaves);
      elevation.push(Number(presetElevation(config,nx,ny,noise,riverPhase).toFixed(6)));
    }
  }
  const minElevation = Math.min(...elevation); const maxElevation = Math.max(...elevation);
  const range = Math.max(1e-9,maxElevation-minElevation);
  const samples:TerrainPhysicalSample[] = [];
  for (let y=0;y<config.height;y++) {
    for (let x=0;x<config.width;x++) {
      const index=y*config.width+x;
      const e=elevation[index]!;
      const [gx,gy]=gradient(elevation,config.width,config.height,x,y,config.metersPerCell);
      const slope=Math.hypot(gx,gy);
      const aspectRadians=Math.atan2(gy,gx);
      const normalizedElevation=(e-minElevation)/range;
      let groundwaterDepthMeters=1.2 + streams.groundwater.next()*8.5 + normalizedElevation*2.5;
      if (config.preset==='river_valley') groundwaterDepthMeters=Math.max(0.35,groundwaterDepthMeters-2.2*(1-Math.abs(x/(Math.max(1,config.width-1))-0.5)*2));
      if (config.preset==='coastal_lowland') groundwaterDepthMeters=Math.max(0.25,groundwaterDepthMeters-(x/Math.max(1,config.width-1))*4.5);
      groundwaterDepthMeters=Number(groundwaterDepthMeters.toFixed(5));
      const surfaceWater:SurfaceWaterClass = config.preset==='coastal_lowland' && x >= Math.ceil(config.width*0.90) ? 'coast' : 'none';
      const soilClass=chooseSoil(slope,groundwaterDepthMeters,normalizedElevation,streams.soils);
      const soil=SOIL_PROPERTIES[soilClass];
      const soilDepthMeters=Number((0.6 + streams.soils.next()*3.8 + (soilClass==='alluvium'?1.4:0)).toFixed(5));
      const bedrockDepthMeters=Number((1.5 + streams.soils.next()*10 + soilDepthMeters*0.6).toFixed(5));
      const bearingCapacityKpa=Number((soil.bearingCapacityKpa*(0.9+streams.soils.next()*0.2)).toFixed(5));
      const contaminationIndex=0;
      const landPreparationMultiplier=calculateLandPreparationMultiplier({ slope,soilClass,bedrockDepthMeters,groundwaterDepthMeters,contaminationIndex,floodSusceptibility:0 });
      const vegetationClass=chooseVegetation(surfaceWater,groundwaterDepthMeters,slope,streams.vegetation);
      samples.push({
        elevationMeters:e,
        slope:Number(slope.toFixed(8)),
        aspectRadians:Number(aspectRadians.toFixed(8)),
        soilClass,
        soilDepthMeters,
        bearingCapacityKpa,
        bedrockDepthMeters,
        groundwaterDepthMeters,
        vegetationClass,
        contaminationIndex,
        landPreparationMultiplier:Number(landPreparationMultiplier.toFixed(6)),
        surfaceWater,
        buildable:true,
      });
    }
  }
  return TerrainField.fromSamples(config.width,config.height,config.metersPerCell,samples);
}
