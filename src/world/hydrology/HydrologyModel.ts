import { TerrainField } from '../terrain/TerrainField.ts';
import type { HydrologySample, HydrologySnapshot, ChannelSegment, WatershedRecord } from './HydrologyTypes.ts';
import { DrainageGraph } from './DrainageGraph.ts';
import { buildWatersheds } from './WatershedModel.ts';

function clamp01(value: number): number { return Math.max(0, Math.min(1, value)); }
function validateArray(name: string, values: readonly number[], count: number): void {
  if (values.length !== count || values.some((value) => !Number.isFinite(value))) throw new Error(`invalid hydrology ${name}`);
}
function channelDistanceFactor(index:number, width:number, channels:readonly ChannelSegment[]): number {
  if (channels.length === 0) return 0;
  const x=index%width; const y=Math.floor(index/width);
  let best=Infinity;
  for (const channel of channels) {
    for (const target of [channel.fromIndex, channel.toIndex]) {
      const tx=target%width; const ty=Math.floor(target/width);
      best=Math.min(best, Math.max(Math.abs(x-tx),Math.abs(y-ty)));
    }
  }
  return best <= 0 ? 1 : best === 1 ? 0.65 : best === 2 ? 0.3 : 0;
}

export class HydrologyModel {
  readonly width:number;
  readonly height:number;
  private readonly conditionedElevation: readonly number[];
  private readonly receiver: readonly (number|null)[];
  private readonly watershedRecords: readonly WatershedRecord[];
  private readonly channelRecords: readonly ChannelSegment[];
  private readonly accumulation: readonly number[];
  private readonly watershedByCell: readonly string[];
  private readonly susceptibility: readonly number[];

  private constructor(snapshot:HydrologySnapshot) {
    this.width=snapshot.width; this.height=snapshot.height;
    this.conditionedElevation=Object.freeze(snapshot.conditionedElevationMeters.slice());
    this.receiver=Object.freeze(snapshot.receiver.slice());
    this.watershedRecords=Object.freeze(snapshot.watersheds.map((item)=>Object.freeze({...item})));
    this.channelRecords=Object.freeze(snapshot.channels.map((item)=>Object.freeze({...item})));
    this.accumulation=Object.freeze(snapshot.flowAccumulation.slice());
    this.watershedByCell=Object.freeze(snapshot.watershedIds.slice());
    this.susceptibility=Object.freeze(snapshot.floodSusceptibility.slice());
  }

  static build(terrain:TerrainField, conditionedElevation:Float64Array): HydrologyModel {
    const count=terrain.width*terrain.height;
    if (conditionedElevation.length!==count) throw new Error('hydrology elevation dimensions do not match terrain');
    for (const value of conditionedElevation) if (!Number.isFinite(value)) throw new Error('conditioned elevation must be finite');
    const water=new Uint8Array(count);
    for(let y=0;y<terrain.height;y++) for(let x=0;x<terrain.width;x++) if(terrain.getPhysical(x,y).surfaceWater!=='none') water[y*terrain.width+x]=1;
    const graph=DrainageGraph.build(terrain.width,terrain.height,conditionedElevation,water);
    const computed=buildWatersheds(graph,terrain.metersPerCell);
    const minElevation=Math.min(...conditionedElevation); const maxElevation=Math.max(...conditionedElevation); const range=Math.max(1e-9,maxElevation-minElevation);
    const maxAccumulation=Math.max(1,...computed.flowAccumulation);
    const susceptibility:number[]=[];
    for(let index=0;index<count;index++) {
      const accumulationFactor=Math.log1p(computed.flowAccumulation[index]!)/Math.log1p(maxAccumulation);
      const lowlandFactor=1-(conditionedElevation[index]!-minElevation)/range;
      const channelFactor=channelDistanceFactor(index,terrain.width,computed.channels);
      susceptibility.push(Number(clamp01(accumulationFactor*0.52+lowlandFactor*0.30+channelFactor*0.18).toFixed(6)));
    }
    return new HydrologyModel({
      width:terrain.width,height:terrain.height,
      conditionedElevationMeters:Object.freeze(Array.from(conditionedElevation)),
      receiver:graph.snapshotReceivers(),watersheds:computed.watersheds,channels:computed.channels,
      flowAccumulation:computed.flowAccumulation,watershedIds:computed.watershedIds,
      floodSusceptibility:Object.freeze(susceptibility),
    });
  }

  sampleAt(x:number,y:number): HydrologySample {
    if(!Number.isInteger(x)||!Number.isInteger(y)||x<0||y<0||x>=this.width||y>=this.height) throw new Error(`hydrology coordinate out of bounds: ${x},${y}`);
    const index=y*this.width+x;
    return Object.freeze({conditionedElevationMeters:this.conditionedElevation[index]!,watershedId:this.watershedByCell[index]!,flowAccumulation:this.accumulation[index]!,floodSusceptibility:this.susceptibility[index]!});
  }
  channels():readonly ChannelSegment[]{return Object.freeze(this.channelRecords.map((item)=>({...item})));}
  watersheds():readonly WatershedRecord[]{return Object.freeze(this.watershedRecords.map((item)=>({...item})));}
  snapshotAuthoritative():HydrologySnapshot{return Object.freeze({width:this.width,height:this.height,conditionedElevationMeters:Object.freeze(this.conditionedElevation.slice()),receiver:Object.freeze(this.receiver.slice()),watersheds:this.watersheds(),channels:this.channels(),flowAccumulation:Object.freeze(this.accumulation.slice()),watershedIds:Object.freeze(this.watershedByCell.slice()),floodSusceptibility:Object.freeze(this.susceptibility.slice())});}
  static restore(snapshot:HydrologySnapshot):HydrologyModel {
    if(!Number.isInteger(snapshot.width)||snapshot.width<=0||!Number.isInteger(snapshot.height)||snapshot.height<=0) throw new Error('invalid hydrology dimensions');
    const count=snapshot.width*snapshot.height;
    validateArray('conditioned elevation',snapshot.conditionedElevationMeters,count);
    validateArray('flow accumulation',snapshot.flowAccumulation,count);
    validateArray('flood susceptibility',snapshot.floodSusceptibility,count);
    if(snapshot.receiver.length!==count||snapshot.watershedIds.length!==count) throw new Error('invalid hydrology cell arrays');
    for(const receiver of snapshot.receiver) if(receiver!==null&&(!Number.isInteger(receiver)||receiver<0||receiver>=count)) throw new Error('invalid hydrology receiver');
    for(const value of snapshot.floodSusceptibility) if(value<0||value>1) throw new Error('invalid flood susceptibility');
    return new HydrologyModel(snapshot);
  }
}
