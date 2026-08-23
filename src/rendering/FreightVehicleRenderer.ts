import type { FreightVehicle, FreightVehicleSystem } from '../simulation/economy/FreightVehicleSystem.ts';
import type { TransportationGraph } from '../simulation/traffic/TransportationGraph.ts';
import type { CanvasPoint } from './WorldRenderer.ts';

export type FreightVehiclePosition=Readonly<{x:number;y:number}>;
export function locateFreightVehicle(vehicle:FreightVehicle,graph:TransportationGraph,travelTicksByEdge:ReadonlyMap<string,number>):FreightVehiclePosition|null{
  const edgeId=vehicle.routeEdgeIds[vehicle.currentEdgeIndex];const edge=edgeId?graph.getEdge(edgeId):undefined;if(!edge)return null;
  const from=graph.getNode(edge.from),to=graph.getNode(edge.to);if(!from||!to)return null;
  const travel=travelTicksByEdge.get(edge.id)??edge.freeFlowTicks;const progress=Math.max(0,Math.min(1,vehicle.edgeProgressTicks/Math.max(1,travel)));
  return{x:from.x+(to.x-from.x)*progress,y:from.y+(to.y-from.y)*progress};
}
export class FreightVehicleRenderer{
  draw(ctx:CanvasRenderingContext2D,graph:TransportationGraph,vehicles:FreightVehicleSystem,travelTicksByEdge:ReadonlyMap<string,number>,worldToCanvas:(x:number,y:number)=>CanvasPoint,cellSize:number):void{
    for(const vehicle of vehicles.listVehicles()){const location=locateFreightVehicle(vehicle,graph,travelTicksByEdge);if(!location)continue;const p=worldToCanvas(location.x,location.y);const size=Math.max(4,cellSize*.24);ctx.save();ctx.fillStyle='#d9a64a';ctx.strokeStyle='#0c1114';ctx.lineWidth=1.1;ctx.fillRect(p.x+cellSize/2-size/2,p.y+cellSize/2-size/2,size,size*.7);ctx.strokeRect(p.x+cellSize/2-size/2,p.y+cellSize/2-size/2,size,size*.7);ctx.restore();}
  }
}
