import { RandomStreamRegistry } from '../../simulation/kernel/RandomStreamRegistry.ts';
import { generateAdministrativeHierarchy } from '../geography/AdministrativeBoundaryGenerator.ts';
import { GeographyHierarchy } from '../geography/GeographyHierarchy.ts';
import { normalizePolygon, pointInPolygon } from '../geometry/PolygonMath.ts';
import type { Polygon2 } from '../geometry/GeometryTypes.ts';
import { resolveDepressions } from '../hydrology/DepressionResolver.ts';
import { HydrologyModel } from '../hydrology/HydrologyModel.ts';
import { calculateLandPreparationMultiplier, SOIL_PROPERTIES } from '../terrain/SoilModel.ts';
import { TerrainField } from '../terrain/TerrainField.ts';
import { generatePhysicalTerrain } from '../terrain/TerrainGenerator.ts';
import type { TerrainPhysicalSample } from '../terrain/TerrainTypes.ts';
import type { ScenarioWorldDefinition } from './ScenarioWorldDefinition.ts';
import { resolveWorldGenerationConfig, type WorldGenerationConfig } from './WorldGenerationConfig.ts';

export type GeneratedWorldComponents = Readonly<{ config:WorldGenerationConfig; terrain:TerrainField; hydrology:HydrologyModel; geography:GeographyHierarchy; scenarioId:string|null }>;
type MutableTerrainSample = { -readonly [K in keyof TerrainPhysicalSample]: TerrainPhysicalSample[K] };

function rootFor(config:WorldGenerationConfig, scenario?:ScenarioWorldDefinition): Polygon2 {
  return scenario?.rootBoundary
    ? normalizePolygon(scenario.rootBoundary.points)
    : normalizePolygon([{x:0,y:0},{x:config.width,y:0},{x:config.width,y:config.height},{x:0,y:config.height}]);
}
function validateRoot(root:Polygon2, config:WorldGenerationConfig): void {
  for (let y=0;y<config.height;y++) for (let x=0;x<config.width;x++) {
    if (!pointInPolygon({x:x+0.5,y:y+0.5}, root, true)) throw new Error('scenario root boundary must contain all cell centers');
  }
}
function gradient(values:readonly number[], width:number, height:number, x:number, y:number, cellSize:number): readonly [number,number] {
  const left=values[y*width+Math.max(0,x-1)]!; const right=values[y*width+Math.min(width-1,x+1)]!;
  const up=values[Math.max(0,y-1)*width+x]!; const down=values[Math.min(height-1,y+1)*width+x]!;
  return [(right-left)/((x===0||x===width-1?1:2)*cellSize),(down-up)/((y===0||y===height-1?1:2)*cellSize)];
}
function validatePolygon(polygon:Polygon2): Polygon2 { return normalizePolygon(polygon.points); }

export function generateWorldComponents(seed:number, config:WorldGenerationConfig, registry:RandomStreamRegistry, scenario?:ScenarioWorldDefinition): GeneratedWorldComponents {
  if (!Number.isInteger(seed)) throw new Error('world seed must be an integer');
  if (scenario && scenario.id.trim().length===0) throw new Error('scenario id must not be empty');
  const effective=resolveWorldGenerationConfig({...config,...scenario?.generation});
  const root=rootFor(effective,scenario);
  validateRoot(root,effective);

  const generated=generatePhysicalTerrain(effective,{
    topography:registry.stream('world.topography'),
    soils:registry.stream('world.soils'),
    groundwater:registry.stream('world.groundwater'),
    vegetation:registry.stream('world.vegetation'),
  });
  const samples:MutableTerrainSample[]=generated.snapshotAuthoritative().samples.map((sample)=>({...sample}));
  const point=(x:number,y:number)=>({x:x+0.5,y:y+0.5});

  for (const override of scenario?.elevationOverrides ?? []) {
    if (!Number.isInteger(override.x)||!Number.isInteger(override.y)||override.x<0||override.y<0||override.x>=effective.width||override.y>=effective.height) throw new Error('scenario elevation override out of bounds');
    if (!Number.isFinite(override.elevationMeters)) throw new Error('scenario elevation must be finite');
    samples[override.y*effective.width+override.x]!.elevationMeters=override.elevationMeters;
  }

  const forCellsInPolygon=(raw:Polygon2, fn:(sample:MutableTerrainSample)=>void): void => {
    const polygon=validatePolygon(raw);
    for (let y=0;y<effective.height;y++) for (let x=0;x<effective.width;x++) {
      if (pointInPolygon(point(x,y),polygon,true)) fn(samples[y*effective.width+x]!);
    }
  };
  for (const region of scenario?.soilRegions ?? []) {
    forCellsInPolygon(region.polygon,(sample)=>{
      sample.soilClass=region.soilClass;
      sample.bearingCapacityKpa=SOIL_PROPERTIES[region.soilClass].bearingCapacityKpa;
    });
  }
  for (const region of scenario?.groundwaterRegions ?? []) {
    if (!Number.isFinite(region.depthMeters)||region.depthMeters<0) throw new Error('scenario groundwater depth invalid');
    forCellsInPolygon(region.polygon,(sample)=>{ sample.groundwaterDepthMeters=region.depthMeters; });
  }
  for (const region of scenario?.contaminationRegions ?? []) {
    if (!Number.isFinite(region.index)||region.index<0||region.index>1) throw new Error('scenario contamination index invalid');
    forCellsInPolygon(region.polygon,(sample)=>{ sample.contaminationIndex=region.index; });
  }
  for (const region of scenario?.permanentWaterPolygons ?? []) {
    forCellsInPolygon(region.polygon,(sample)=>{
      sample.surfaceWater=region.class;
      sample.vegetationClass=region.class==='coast'?'none':'wetland';
      sample.buildable=false;
    });
  }

  const elevations=samples.map((sample)=>sample.elevationMeters);
  for (let y=0;y<effective.height;y++) for (let x=0;x<effective.width;x++) {
    const sample=samples[y*effective.width+x]!;
    const [gx,gy]=gradient(elevations,effective.width,effective.height,x,y,effective.metersPerCell);
    sample.slope=Math.hypot(gx,gy);
    sample.aspectRadians=Math.atan2(gy,gx);
    sample.landPreparationMultiplier=calculateLandPreparationMultiplier({
      slope:sample.slope,
      soilClass:sample.soilClass,
      bedrockDepthMeters:sample.bedrockDepthMeters,
      groundwaterDepthMeters:sample.groundwaterDepthMeters,
      contaminationIndex:sample.contaminationIndex,
      floodSusceptibility:0,
    });
  }

  const terrain=TerrainField.fromSamples(effective.width,effective.height,effective.metersPerCell,samples);
  const permanentWater=new Uint8Array(effective.width*effective.height);
  for (let y=0;y<effective.height;y++) for (let x=0;x<effective.width;x++) {
    if (terrain.getPhysical(x,y).surfaceWater!=='none') permanentWater[y*effective.width+x]=1;
  }
  const conditioned=resolveDepressions(effective.width,effective.height,new Float64Array(elevations),permanentWater);
  const hydrology=HydrologyModel.build(terrain,conditioned);
  const geography=scenario?.administrativeBoundaries
    ? GeographyHierarchy.restore(scenario.administrativeBoundaries)
    : new GeographyHierarchy(generateAdministrativeHierarchy(root,registry.stream('world.boundaries')));

  return Object.freeze({config:effective,terrain,hydrology,geography,scenarioId:scenario?.id??null});
}
