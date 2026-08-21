import type { TransportationEdge, TransportationGraph } from '../traffic/TransportationGraph.ts';
import type { PathfindingSystem } from '../traffic/PathfindingSystem.ts';
import type { PassengerQueueSystem } from './PassengerQueueSystem.ts';
import type { TransitNetworkSystem } from './TransitNetworkSystem.ts';
import type { TransitVehicleEvent, TransitVehicleSystem } from './TransitVehicleSystem.ts';
import type { TransitMode } from '../../data/transit.ts';

export type TransitLineOperationsSnapshot = Readonly<{
  lineId: string; fleetLimit: number; activeVehicles: number; dispatchedRuns: number; missedRuns: number; failedRuns: number;
  boardings: number; completedPassengerWeight: number; fareRevenue: number; delayTicks: number; vehicleTicks: number;
  operatingCost: number; costRecovery: number; reliability: number;
}>;
type LineState={fleetLimit:number;nextDispatchTick:number;dispatchedRuns:number;missedRuns:number;failedRuns:number;boardings:number;completedPassengerWeight:number;fareRevenue:number;delayTicks:number;vehicleTicks:number;operatingCost:number};
const COST_PER_TICK:Readonly<Record<TransitMode,number>>=Object.freeze({bus:0.06,brt:0.09,tram:0.12,metro:0.25});

export class TransitOperationsSystem {
  private readonly state = new Map<string,LineState>();
  setFleetLimit(lineId:string,count:number):number { const s=this.ensure(lineId); s.fleetLimit=Math.max(0,Math.floor(Number.isFinite(count)?count:0)); return s.fleetLimit; }
  step(tick:number,network:TransitNetworkSystem,vehicles:TransitVehicleSystem,queues:PassengerQueueSystem,graph:TransportationGraph,pathfinding:PathfindingSystem,roadTravelTime:(edge:TransportationEdge)=>number):void {
    const lines=network.listLines().sort((a,b)=>a.id.localeCompare(b.id));
    for(const line of lines){const s=this.ensure(line.id); if(s.nextDispatchTick===0&&tick>0)s.nextDispatchTick=0; if(!line.enabled)continue; while(tick>=s.nextDispatchTick){if(vehicles.activeCount(line.id)<s.fleetLimit){if(vehicles.dispatchRun(line,tick)){s.dispatchedRuns++;}else{s.missedRuns++;}}else{s.missedRuns++;}s.nextDispatchTick+=line.headwayTicks;if(line.headwayTicks<=0)break;}}
    const delayBefore = new Map(vehicles.listVehicles().map((v) => [v.id, v.delayTicks] as const));
    for(const v of vehicles.listVehicles()){const line=network.getLine(v.lineId);if(!line)continue;const s=this.ensure(v.lineId);s.vehicleTicks++;s.operatingCost+=COST_PER_TICK[line.mode];}
    const events=vehicles.step(tick,network,queues,graph,pathfinding,roadTravelTime);
    for (const v of vehicles.listVehicles()) { const delta = Math.max(0, v.delayTicks - (delayBefore.get(v.id) ?? 0)); if (delta > 0) this.ensure(v.lineId).delayTicks += delta; }
    this.apply(events);
  }
  snapshotLine(lineId:string):TransitLineOperationsSnapshot { const s=this.ensure(lineId); const active=0; const costRecovery=s.operatingCost<=0?(s.fareRevenue>0?1:0):s.fareRevenue/s.operatingCost; const reliability=s.vehicleTicks<=0?1:Math.max(0,Math.min(1,1-s.delayTicks/Math.max(1,s.vehicleTicks))); return {lineId,fleetLimit:s.fleetLimit,activeVehicles:active,dispatchedRuns:s.dispatchedRuns,missedRuns:s.missedRuns,failedRuns:s.failedRuns,boardings:s.boardings,completedPassengerWeight:s.completedPassengerWeight,fareRevenue:s.fareRevenue,delayTicks:s.delayTicks,vehicleTicks:s.vehicleTicks,operatingCost:s.operatingCost,costRecovery,reliability}; }
  snapshotLineWithVehicles(lineId:string,vehicles:TransitVehicleSystem):TransitLineOperationsSnapshot { return {...this.snapshotLine(lineId),activeVehicles:vehicles.activeCount(lineId)}; }
  listLineIds(): string[] { return [...this.state.keys()].sort(); }
  private apply(events:readonly TransitVehicleEvent[]):void { for(const e of events){const s=this.ensure(e.lineId);if(e.type==='boarded'){s.boardings+=e.weight??0;s.fareRevenue+=e.fareRevenue??0;}else if(e.type==='passenger_completed')s.completedPassengerWeight+=e.weight??0;else if(e.type==='run_failed'){s.failedRuns++;}} }
  private ensure(id:string):LineState { let s=this.state.get(id); if(!s){s={fleetLimit:2,nextDispatchTick:0,dispatchedRuns:0,missedRuns:0,failedRuns:0,boardings:0,completedPassengerWeight:0,fareRevenue:0,delayTicks:0,vehicleTicks:0,operatingCost:0};this.state.set(id,s);} return s; }
}
