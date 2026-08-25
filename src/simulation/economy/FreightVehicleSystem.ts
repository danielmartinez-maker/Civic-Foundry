import type { Commodity } from '../../data/economy.ts';
import type { RouteResult } from '../traffic/PathfindingSystem.ts';
import type { TransportationEdge, TransportationGraph } from '../traffic/TransportationGraph.ts';

export type FreightShipment=Readonly<{id:string;orderId:string;commodity:Commodity;quantity:number;vehicleWeight:number;originKind:'firm'|'gateway';originId:string;destinationKind:'firm'|'gateway';destinationId:string;originNodeId:string;destinationNodeId:string;createdTick:number;generalizedCost:number}>;
export type FreightVehicleStatus='moving'|'failed';
export type FreightVehicle=Readonly<{id:string;shipment:FreightShipment;routeEdgeIds:readonly string[];currentEdgeIndex:number;edgeProgressTicks:number;departureTick:number;expectedArrivalTick:number;delayTicks:number;status:FreightVehicleStatus}>;
type MutableFreightVehicle={id:string;shipment:FreightShipment;routeEdgeIds:string[];currentEdgeIndex:number;edgeProgressTicks:number;departureTick:number;expectedArrivalTick:number;delayTicks:number;status:FreightVehicleStatus};
export type FreightVehicleEvent=Readonly<{type:'delivered'|'failed'|'needs-replan';vehicleId:string;shipment:FreightShipment;delayTicks:number;currentNodeId?:string}>;
export type FreightVehicleStateSnapshot=Readonly<{nextVehicleId:number;dispatchCapacity:number;vehicles:readonly FreightVehicle[]}>;

export class FreightVehicleSystem{
  private vehicles=new Map<string,MutableFreightVehicle>(); private nextVehicleId=1; private dispatchCapacity=100; private _entityRevision=0;
  get entityRevision():number{return this._entityRevision;}
  setDispatchCapacity(count:number):void{this.dispatchCapacity=Math.max(0,Math.floor(Number.isFinite(count)?count:0));}
  getDispatchCapacity():number{return this.dispatchCapacity;}
  hasDispatchCapacity():boolean{return this.activeCount()<this.dispatchCapacity;}
  dispatch(shipment:FreightShipment,route:RouteResult,tick:number):FreightVehicle{
    if(!this.hasDispatchCapacity())throw new Error('freight dispatch capacity exhausted');
    if(route.edgeIds.length===0)throw new Error('freight route must contain at least one edge');
    const id=`freight-vehicle:${this.nextVehicleId++}`; const v:MutableFreightVehicle={id,shipment:{...shipment},routeEdgeIds:[...route.edgeIds],currentEdgeIndex:0,edgeProgressTicks:0,departureTick:tick,expectedArrivalTick:tick+route.totalCost,delayTicks:0,status:'moving'};this.vehicles.set(id,v);this._entityRevision++;return this.copy(v);
  }
  activeCount():number{return this.vehicles.size;}
  listVehicles():FreightVehicle[]{return[...this.vehicles.values()].map(v=>this.copy(v)).sort((a,b)=>a.id.localeCompare(b.id));}
  getVehicle(id:string):FreightVehicle|undefined{const v=this.vehicles.get(id);return v?this.copy(v):undefined;}
  edgeLoads():Record<string,number>{const result:Record<string,number>={};for(const v of this.vehicles.values()){if(v.status!=='moving')continue;const edge=v.routeEdgeIds[v.currentEdgeIndex];if(edge)result[edge]=(result[edge]??0)+Math.max(0,v.shipment.vehicleWeight);}return result;}
  step(graph:TransportationGraph,roadTravelTime:(edge:TransportationEdge)=>number,tick:number):FreightVehicleEvent[]{
    const events:FreightVehicleEvent[]=[];
    for(const v of [...this.vehicles.values()].sort((a,b)=>a.id.localeCompare(b.id))){
      const edgeId=v.routeEdgeIds[v.currentEdgeIndex]; const edge=edgeId?graph.getEdge(edgeId):undefined;
      if(!edge){const prior=v.currentEdgeIndex>0?graph.getEdge(v.routeEdgeIds[v.currentEdgeIndex-1]!):undefined;const event:FreightVehicleEvent=prior?{type:'needs-replan',vehicleId:v.id,shipment:{...v.shipment},delayTicks:v.delayTicks,currentNodeId:prior.to}:{type:'failed',vehicleId:v.id,shipment:{...v.shipment},delayTicks:v.delayTicks};events.push(event);this.vehicles.delete(v.id);this._entityRevision++;continue;}
      const travel=Math.max(edge.freeFlowTicks,roadTravelTime(edge)); v.edgeProgressTicks++; v.delayTicks+=Math.max(0,travel-edge.freeFlowTicks)/Math.max(1,travel);
      if(v.edgeProgressTicks+1e-9<travel)continue; v.edgeProgressTicks=0; v.currentEdgeIndex++;
      if(v.currentEdgeIndex>=v.routeEdgeIds.length){events.push({type:'delivered',vehicleId:v.id,shipment:{...v.shipment},delayTicks:Math.max(0,tick-v.expectedArrivalTick)});this.vehicles.delete(v.id);this._entityRevision++;}
    }
    return events;
  }
  snapshotState():FreightVehicleStateSnapshot{return{nextVehicleId:this.nextVehicleId,dispatchCapacity:this.dispatchCapacity,vehicles:this.listVehicles()};}
  restoreState(state:FreightVehicleStateSnapshot):void{if(!Number.isInteger(state.nextVehicleId)||state.nextVehicleId<1)throw new Error('invalid freight vehicle id state');if(!Number.isInteger(state.dispatchCapacity)||state.dispatchCapacity<0)throw new Error('invalid freight dispatch capacity');this.vehicles.clear();for(const v of state.vehicles)this.vehicles.set(v.id,{...v,shipment:{...v.shipment},routeEdgeIds:[...v.routeEdgeIds]});this.nextVehicleId=state.nextVehicleId;this.dispatchCapacity=state.dispatchCapacity;this._entityRevision++;}
  removeForShipment(shipmentId:string):void{for(const [id,v] of this.vehicles)if(v.shipment.id===shipmentId){this.vehicles.delete(id);this._entityRevision++;}}
  private copy(v:MutableFreightVehicle):FreightVehicle{return{...v,shipment:{...v.shipment},routeEdgeIds:[...v.routeEdgeIds]};}
}