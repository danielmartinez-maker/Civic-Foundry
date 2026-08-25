import { SOIL_PROPERTIES } from '../terrain/SoilModel.ts';
import { TerrainField } from '../terrain/TerrainField.ts';
import type { DesignStormEvent, FloodExternalSurface, FloodResult } from './HydrologyTypes.ts';
import { HydrologyModel } from './HydrologyModel.ts';

function clamp01(value:number):number{return Math.max(0,Math.min(1,value));}
function validateEvent(event:DesignStormEvent):void{
  if(event.id.trim().length===0)throw new Error('flood event id must not be empty');
  if(!Number.isFinite(event.rainfallMm)||event.rainfallMm<0)throw new Error('rainfallMm must be finite and non-negative');
  if(!Number.isFinite(event.durationHours)||event.durationHours<0)throw new Error('durationHours must be finite and non-negative');
  if(event.saturationFactor!==undefined&&(!Number.isFinite(event.saturationFactor)||event.saturationFactor<0||event.saturationFactor>1))throw new Error('saturationFactor must be within [0, 1]');
}
function topologicalOrder(receiver:readonly(number|null)[]):number[]{
  const indegree=new Int32Array(receiver.length);
  for(const target of receiver)if(target!==null)indegree[target]=indegree[target]!+1;
  const zero:number[]=[];for(let i=0;i<receiver.length;i++)if(indegree[i]===0)zero.push(i);
  zero.sort((a,b)=>a-b);const order:number[]=[];
  while(zero.length){const current=zero.shift()!;order.push(current);const target=receiver[current]??null;if(target!==null){indegree[target]=indegree[target]!-1;if(indegree[target]===0){const p=zero.findIndex(v=>v>target);if(p<0)zero.push(target);else zero.splice(p,0,target);}}}
  if(order.length!==receiver.length)throw new Error('hydrology receiver cycle during flood routing');
  return order;
}

export class FloodModel {
  run(event:DesignStormEvent,terrain:TerrainField,hydrology:HydrologyModel,externalSurface?:FloodExternalSurface):FloodResult {
    validateEvent(event);
    if(terrain.width!==hydrology.width||terrain.height!==hydrology.height)throw new Error('flood terrain/hydrology dimensions do not match');
    const count=terrain.width*terrain.height;
    const cellArea=terrain.metersPerCell*terrain.metersPerCell;
    const rainfallPerCell=event.rainfallMm/1000*cellArea;
    const rainfallVolume=rainfallPerCell*count;
    if(rainfallVolume===0)return Object.freeze({eventId:event.id,depthMeters:Object.freeze(Array(count).fill(0)),rainfallVolume:0,infiltrationVolume:0,retainedChannelSurfaceVolume:0,overbankFloodVolume:0,exportedVolume:0,balanceError:0});

    const snapshot=hydrology.snapshotAuthoritative();
    const incoming=new Float64Array(count);
    const localRunoff=new Float64Array(count);
    let infiltrationVolume=0;
    const saturation=event.saturationFactor??1;
    for(let y=0;y<terrain.height;y++)for(let x=0;x<terrain.width;x++){
      const index=y*terrain.width+x;
      const physical=terrain.getPhysical(x,y);
      let impervious=0;
      if(externalSurface){impervious=externalSurface.imperviousFractionAt(x,y);if(!Number.isFinite(impervious))throw new Error('impervious surface fraction must be finite');impervious=clamp01(impervious);}
      const capacityMm=SOIL_PROPERTIES[physical.soilClass].infiltrationMmPerHour*event.durationHours*saturation*(1-impervious);
      const infiltrationMm=Math.min(event.rainfallMm,Math.max(0,capacityMm));
      const infiltration=infiltrationMm/1000*cellArea;
      infiltrationVolume+=infiltration;
      localRunoff[index]=Math.max(0,rainfallPerCell-infiltration);
    }

    const channelCapacity=new Map<number,number>(snapshot.channels.map(channel=>[channel.fromIndex,channel.capacityVolumeM3] as const));
    const depth=new Float64Array(count);
    let retainedChannelSurfaceVolume=0;
    let overbankFloodVolume=0;
    let exportedVolume=0;
    for(const index of topologicalOrder(snapshot.receiver)){
      const volume=localRunoff[index]!+incoming[index]!;
      if(volume<=0)continue;
      const x=index%terrain.width;const y=Math.floor(index/terrain.width);
      if(terrain.getPhysical(x,y).surfaceWater!=='none'){
        retainedChannelSurfaceVolume+=volume;
        continue;
      }
      const capacity=channelCapacity.get(index);
      if(capacity!==undefined){
        const retained=Math.min(volume,capacity);
        retainedChannelSurfaceVolume+=retained;
        const overflow=Math.max(0,volume-retained);
        if(overflow>0){overbankFloodVolume+=overflow;depth[index]=overflow/cellArea;}
        continue;
      }
      const receiver=snapshot.receiver[index]??null;
      if(receiver===null)exportedVolume+=volume;
      else incoming[receiver]=incoming[receiver]!+volume;
    }
    const accounted=infiltrationVolume+retainedChannelSurfaceVolume+overbankFloodVolume+exportedVolume;
    const balanceError=rainfallVolume-accounted;
    return Object.freeze({eventId:event.id,depthMeters:Object.freeze(Array.from(depth)),rainfallVolume,infiltrationVolume,retainedChannelSurfaceVolume,overbankFloodVolume,exportedVolume,balanceError});
  }
}
