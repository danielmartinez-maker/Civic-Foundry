import { HydrologyModel } from '../hydrology/HydrologyModel.ts';
import { TerrainField } from './TerrainField.ts';
import { TerrainGrid, type TerrainCell } from './TerrainGrid.ts';
import type { LegacyTerrainSnapshot } from '../foundation/WorldFoundationTypes.ts';

export function snapshotLegacyTerrain(terrain:TerrainGrid):LegacyTerrainSnapshot{
  return Object.freeze({width:terrain.width,height:terrain.height,cells:Object.freeze(terrain.snapshot().map(cell=>Object.freeze({...cell})))});
}
export function materializeLegacyTerrain(snapshot:LegacyTerrainSnapshot):TerrainGrid{
  return TerrainGrid.fromCells(snapshot.width,snapshot.height,snapshot.cells);
}
export function physicalTerrainFromLegacy(snapshot:LegacyTerrainSnapshot):TerrainField{
  const samples=snapshot.cells.map(cell=>({
    elevationMeters:cell.elevation*100,slope:0,aspectRadians:0,soilClass:'loam' as const,soilDepthMeters:2,bearingCapacityKpa:160,
    bedrockDepthMeters:8,groundwaterDepthMeters:5,vegetationClass:cell.biome==='forest'?'forest' as const:'grass' as const,
    contaminationIndex:0,landPreparationMultiplier:1,surfaceWater:cell.water?'lake' as const:'none' as const,buildable:cell.buildable,
  }));
  return TerrainField.fromSamples(snapshot.width,snapshot.height,30,samples);
}
export function generatedLegacyTerrain(terrain:TerrainField,hydrology:HydrologyModel):TerrainGrid{
  if(terrain.width!==hydrology.width||terrain.height!==hydrology.height)throw new Error('generated legacy terrain dimensions do not match hydrology');
  const physical=terrain.snapshotAuthoritative().samples;
  const elevations=physical.map(sample=>sample.elevationMeters);const min=Math.min(...elevations),max=Math.max(...elevations),range=Math.max(1e-9,max-min);
  const cells:TerrainCell[]=physical.map(sample=>{
    const water=sample.surfaceWater!=='none';
    const biome:TerrainCell['biome']=water?'water':(!sample.buildable&&sample.soilClass==='rock')?'rock':sample.vegetationClass==='forest'?'forest':'grass';
    return Object.freeze({elevation:Number(((sample.elevationMeters-min)/range).toFixed(6)),water,buildable:sample.buildable,biome});
  });
  return TerrainGrid.fromCells(terrain.width,terrain.height,cells);
}
