import type { Commodity } from '../../data/economy.ts';
import type { TransportationGraph } from '../traffic/TransportationGraph.ts';

export type FreightGateway = Readonly<{ id:string; nodeId:string; x:number; y:number; importCapacity:number; exportCapacity:number; inboundQueue:number; outboundQueue:number; externalPriceIndex:Readonly<Record<Commodity,number>>; externalDemandIndex:number }>;
export type TradeStateSnapshot = Readonly<{ gateways:readonly FreightGateway[]; cumulativeImports:number; cumulativeExports:number; cumulativeImportValue:number; cumulativeExportValue:number }>;

export class TradeSystem {
  private gateways: FreightGateway[]=[];
  cumulativeImports=0; cumulativeExports=0; cumulativeImportValue=0; cumulativeExportValue=0;
  rebuildGateways(graph:TransportationGraph,width:number,height:number):void{
    const old=new Map(this.gateways.map(g=>[g.id,g]));
    this.gateways=graph.nodes.filter(n=>n.x===0||n.y===0||n.x===width-1||n.y===height-1).map(n=>{
      const id=`gateway:${n.x}:${n.y}`; const prior=old.get(id);
      return prior ?? {id,nodeId:n.id,x:n.x,y:n.y,importCapacity:60,exportCapacity:60,inboundQueue:0,outboundQueue:0,externalPriceIndex:{industrial_inputs:1,manufactured_goods:1,consumer_goods:1},externalDemandIndex:1};
    }).sort((a,b)=>a.id.localeCompare(b.id));
  }
  listGateways():FreightGateway[]{return this.gateways.map(g=>({...g,externalPriceIndex:{...g.externalPriceIndex}}));}
  getGateway(id:string):FreightGateway|undefined{const g=this.gateways.find(x=>x.id===id);return g?{...g,externalPriceIndex:{...g.externalPriceIndex}}:undefined;}
  recordImport(quantity:number,value:number):void{this.cumulativeImports+=Math.max(0,quantity);this.cumulativeImportValue+=Math.max(0,value);}
  recordExport(quantity:number,value:number):void{this.cumulativeExports+=Math.max(0,quantity);this.cumulativeExportValue+=Math.max(0,value);}
  snapshotState():TradeStateSnapshot{return{gateways:this.listGateways(),cumulativeImports:this.cumulativeImports,cumulativeExports:this.cumulativeExports,cumulativeImportValue:this.cumulativeImportValue,cumulativeExportValue:this.cumulativeExportValue};}
  restoreState(state:TradeStateSnapshot):void{this.gateways=state.gateways.map(g=>({...g,externalPriceIndex:{...g.externalPriceIndex}}));this.cumulativeImports=state.cumulativeImports;this.cumulativeExports=state.cumulativeExports;this.cumulativeImportValue=state.cumulativeImportValue;this.cumulativeExportValue=state.cumulativeExportValue;}
}
