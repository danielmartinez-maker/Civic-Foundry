import type { RandomStreamRegistry } from '../../simulation/kernel/RandomStreamRegistry.ts';
import { GeographyHierarchy } from '../geography/GeographyHierarchy.ts';
import type { GeographyEntity } from '../geography/GeographyTypes.ts';
import { normalizePolygon } from '../geometry/PolygonMath.ts';
import { GeometryIndex } from '../geometry/GeometryIndex.ts';
import { generateWorldComponents } from '../generation/WorldGenerator.ts';
import type { ScenarioWorldDefinition } from '../generation/ScenarioWorldDefinition.ts';
import { resolveWorldGenerationConfig, type WorldGenerationConfig } from '../generation/WorldGenerationConfig.ts';
import { FloodModel } from '../hydrology/FloodModel.ts';
import { resolveDepressions } from '../hydrology/DepressionResolver.ts';
import { HydrologyModel } from '../hydrology/HydrologyModel.ts';
import type { DesignStormEvent, FloodExternalSurface, FloodResult } from '../hydrology/HydrologyTypes.ts';
import { calculateLandPreparationMultiplier } from '../terrain/SoilModel.ts';
import { TerrainField } from '../terrain/TerrainField.ts';
import { generatedLegacyTerrain, materializeLegacyTerrain, physicalTerrainFromLegacy, snapshotLegacyTerrain } from '../terrain/LegacyTerrainAdapter.ts';
import { TerrainGrid } from '../terrain/TerrainGrid.ts';
import type { TerrainSample } from '../terrain/TerrainTypes.ts';
import type { LegacyTerrainSnapshot, WorldFoundationMode, WorldFoundationSnapshot } from './WorldFoundationTypes.ts';

function cloneFlood(result:FloodResult|null):FloodResult|null{return result===null?null:Object.freeze({...result,depthMeters:Object.freeze(result.depthMeters.slice())});}
function legacyGeography(width:number,height:number):GeographyHierarchy{
  const boundary=normalizePolygon([{x:0,y:0},{x:width,y:0},{x:width,y:height},{x:0,y:height}]);
  const entities:GeographyEntity[]=[
    {id:'region:0',kind:'region',parentId:null,boundary,sortKey:'0'},
    {id:'municipality:region:0:000',kind:'municipality',parentId:'region:0',boundary,sortKey:'0.0'},
    {id:'district:legacy:000',kind:'district',parentId:'municipality:region:0:000',boundary,sortKey:'0.0.0'},
    {id:'neighborhood:legacy:000',kind:'neighborhood',parentId:'district:legacy:000',boundary,sortKey:'0.0.0.0'},
    {id:'block:legacy:000',kind:'block',parentId:'neighborhood:legacy:000',boundary,sortKey:'0.0.0.0.0'},
  ];
  return new GeographyHierarchy(entities);
}
function hydrologyForLegacy(terrain:TerrainField):HydrologyModel{
  const count=terrain.width*terrain.height;const elevation=new Float64Array(count);
  for(let y=0;y<terrain.height;y++)for(let x=0;x<terrain.width;x++)elevation[y*terrain.width+x]=terrain.getPhysical(x,y).elevationMeters;
  const water=new Uint8Array(count);for(let y=0;y<terrain.height;y++)for(let x=0;x<terrain.width;x++)if(terrain.getPhysical(x,y).surfaceWater!=='none')water[y*terrain.width+x]=1;
  return HydrologyModel.build(terrain,resolveDepressions(terrain.width,terrain.height,elevation,water));
}

export class WorldFoundation {
  readonly mode:WorldFoundationMode;readonly seed:number;readonly config:WorldGenerationConfig;readonly scenarioId:string|null;
  readonly terrain:TerrainField;readonly hydrology:HydrologyModel;readonly geography:GeographyHierarchy;readonly spatialIndex:GeometryIndex;
  private readonly legacyCompatibility:LegacyTerrainSnapshot|null;private lastFloodResult:FloodResult|null;
  private constructor(input:{mode:WorldFoundationMode;seed:number;config:WorldGenerationConfig;scenarioId:string|null;terrain:TerrainField;hydrology:HydrologyModel;geography:GeographyHierarchy;legacyCompatibility:LegacyTerrainSnapshot|null;lastFloodResult:FloodResult|null}){
    this.mode=input.mode;this.seed=input.seed;this.config=input.config;this.scenarioId=input.scenarioId;this.terrain=input.terrain;this.hydrology=input.hydrology;this.geography=input.geography;this.legacyCompatibility=input.legacyCompatibility;this.lastFloodResult=cloneFlood(input.lastFloodResult);
    if(this.terrain.width!==this.hydrology.width||this.terrain.height!==this.hydrology.height)throw new Error('world terrain/hydrology dimensions do not match');
    this.spatialIndex=new GeometryIndex({minX:0,minY:0,maxX:this.terrain.width,maxY:this.terrain.height});
    this.spatialIndex.rebuild(this.geography.list(),this.hydrology.channels());
  }
  static generate(input:{seed:number;config:WorldGenerationConfig;randomRegistry:RandomStreamRegistry;scenario?:ScenarioWorldDefinition}):WorldFoundation{
    const parts=generateWorldComponents(input.seed,input.config,input.randomRegistry,input.scenario);
    return new WorldFoundation({mode:'generated-1r',seed:input.seed,config:parts.config,scenarioId:parts.scenarioId,terrain:parts.terrain,hydrology:parts.hydrology,geography:parts.geography,legacyCompatibility:null,lastFloodResult:null});
  }
  static fromLegacyTerrain(terrain:TerrainGrid,seed:number,mode:'legacy-flat'|'legacy-explicit'):WorldFoundation{
    const compatibility=snapshotLegacyTerrain(terrain);const physical=physicalTerrainFromLegacy(compatibility);const config=resolveWorldGenerationConfig({width:terrain.width,height:terrain.height,metersPerCell:30,preset:'plain'});
    return new WorldFoundation({mode,seed,config,scenarioId:null,terrain:physical,hydrology:hydrologyForLegacy(physical),geography:legacyGeography(terrain.width,terrain.height),legacyCompatibility:compatibility,lastFloodResult:null});
  }
  static restore(snapshot:WorldFoundationSnapshot):WorldFoundation{
    const terrain=TerrainField.restore(snapshot.terrain);const hydrology=HydrologyModel.restore(snapshot.hydrology);const geography=GeographyHierarchy.restore(snapshot.geography);
    const compatibility=snapshot.legacyCompatibility===null?null:Object.freeze({width:snapshot.legacyCompatibility.width,height:snapshot.legacyCompatibility.height,cells:Object.freeze(snapshot.legacyCompatibility.cells.map(cell=>Object.freeze({...cell})))});
    return new WorldFoundation({mode:snapshot.mode,seed:snapshot.seed,config:resolveWorldGenerationConfig(snapshot.config),scenarioId:snapshot.scenarioId,terrain,hydrology,geography,legacyCompatibility:compatibility,lastFloodResult:snapshot.lastFloodResult});
  }
  terrainSampleAt(x:number,y:number):TerrainSample{
    const physical=this.terrain.getPhysical(x,y);const hydro=this.hydrology.sampleAt(x,y);
    return Object.freeze({...physical,...hydro,landPreparationMultiplier:this.preparationMultiplierAt(x,y)});
  }
  legacyTerrain():TerrainGrid{return this.legacyCompatibility?materializeLegacyTerrain(this.legacyCompatibility):generatedLegacyTerrain(this.terrain,this.hydrology);}
  preparationMultiplierAt(x:number,y:number):number{
    if(this.mode!=='generated-1r'){this.terrain.getPhysical(x,y);return 1;}
    const p=this.terrain.getPhysical(x,y);const h=this.hydrology.sampleAt(x,y);
    return calculateLandPreparationMultiplier({slope:p.slope,soilClass:p.soilClass,bedrockDepthMeters:p.bedrockDepthMeters,groundwaterDepthMeters:p.groundwaterDepthMeters,contaminationIndex:p.contaminationIndex,floodSusceptibility:h.floodSusceptibility});
  }
  runDesignStorm(event:DesignStormEvent,externalSurface?:FloodExternalSurface):FloodResult{const result=new FloodModel().run(event,this.terrain,this.hydrology,externalSurface);this.lastFloodResult=cloneFlood(result);return cloneFlood(result)!;}
  floodDepthAt(x:number,y:number):number{if(!this.terrain.inBounds(x,y))throw new Error(`flood coordinate out of bounds: ${x},${y}`);return this.lastFloodResult?.depthMeters[y*this.terrain.width+x]??0;}
  snapshotAuthoritative():WorldFoundationSnapshot{return Object.freeze({mode:this.mode,seed:this.seed,config:Object.freeze({...this.config}),scenarioId:this.scenarioId,terrain:this.terrain.snapshotAuthoritative(),hydrology:this.hydrology.snapshotAuthoritative(),geography:this.geography.snapshot(),legacyCompatibility:this.legacyCompatibility===null?null:Object.freeze({width:this.legacyCompatibility.width,height:this.legacyCompatibility.height,cells:Object.freeze(this.legacyCompatibility.cells.map(cell=>({...cell})))}),lastFloodResult:cloneFlood(this.lastFloodResult)});}
  diagnosticSnapshot():Readonly<{mode:WorldFoundationMode;width:number;height:number;watersheds:number;channels:number;lastFloodedCells:number}>{return Object.freeze({mode:this.mode,width:this.terrain.width,height:this.terrain.height,watersheds:this.hydrology.watersheds().length,channels:this.hydrology.channels().length,lastFloodedCells:this.lastFloodResult?.depthMeters.filter(depth=>depth>0).length??0});}
}
