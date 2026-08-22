import type { Commodity } from '../../data/economy.ts';
import type { Firm } from './FirmSystem.ts';
import type { InventorySystem } from './InventorySystem.ts';

export type FreightOrderStatus='waiting'|'dispatched'|'delivered'|'cancelled';
export type FreightOrder=Readonly<{id:string;commodity:Commodity;quantity:number;destinationKind:'firm'|'gateway';destinationId:string;createdTick:number;priority:number;status:FreightOrderStatus;assignedShipmentId?:string}>;
export type FreightCandidate=Readonly<{kind:'firm'|'gateway';id:string;available:number}>;
export type FreightMatch=Readonly<{orderId:string;commodity:Commodity;quantity:number;originKind:'firm'|'gateway';originId:string;destinationKind:'firm'|'gateway';destinationId:string;generalizedCost:number}>;
export type FreightDemandStateSnapshot=Readonly<{orders:readonly FreightOrder[];nextOrderId:number}>;

type MutableOrder={id:string;commodity:Commodity;quantity:number;destinationKind:'firm'|'gateway';destinationId:string;createdTick:number;priority:number;status:FreightOrderStatus;assignedShipmentId?:string};

export class FreightDemandSystem{
  private orders=new Map<string,MutableOrder>(); private nextOrderId=1;
  createReplenishmentOrders(firms:readonly Firm[],inventories:InventorySystem,tick:number):FreightOrder[]{
    const created:FreightOrder[]=[];
    for(const firm of [...firms].sort((a,b)=>a.id.localeCompare(b.id))){
      if(firm.status!=='operating'&&firm.status!=='distressed')continue;
      inventories.syncFirm(firm);
      const required:Commodity[] = firm.archetype==='retail_local'?['consumer_goods']:firm.archetype==='wholesale_logistics'?['manufactured_goods']:['industrial_inputs'];
      for(const commodity of required){
        const inv=inventories.get(firm.id,commodity); const inFlight=this.listOrders().filter(o=>o.destinationId===firm.id&&o.commodity===commodity&&(o.status==='waiting'||o.status==='dispatched')).reduce((s,o)=>s+o.quantity,0);
        const shortage=Math.max(0,inv.targetStock-inv.onHand-inFlight); if(shortage<=0.01)continue;
        const order:MutableOrder={id:`order:${this.nextOrderId++}`,commodity,quantity:shortage,destinationKind:'firm',destinationId:firm.id,createdTick:tick,priority:1,status:'waiting'};this.orders.set(order.id,order);created.push({...order});
      }
    }
    return created;
  }
  createExportOrder(originFirmId:string,commodity:Commodity,quantity:number,gatewayId:string,tick:number):FreightOrder{const order:MutableOrder={id:`order:${this.nextOrderId++}`,commodity,quantity:Math.max(0,quantity),destinationKind:'gateway',destinationId:gatewayId,createdTick:tick,priority:0.5,status:'waiting'};this.orders.set(order.id,order);return{...order};}
  listOrders():FreightOrder[]{return[...this.orders.values()].map(o=>({...o})).sort((a,b)=>a.id.localeCompare(b.id));}
  getOrder(id:string):FreightOrder|undefined{const o=this.orders.get(id);return o?{...o}:undefined;}
  matchOrder(order:FreightOrder,candidates:readonly FreightCandidate[],costFn:(candidate:FreightCandidate)=>number):FreightMatch|undefined{
    const eligible=candidates.filter(c=>c.available+1e-9>=order.quantity&&(order.commodity!=='industrial_inputs'||c.kind==='gateway')).map(c=>({candidate:c,cost:costFn(c)})).filter(x=>Number.isFinite(x.cost)&&x.cost>=0).sort((a,b)=>a.cost-b.cost||a.candidate.id.localeCompare(b.candidate.id));
    const best=eligible[0]; if(!best)return undefined; return{orderId:order.id,commodity:order.commodity,quantity:order.quantity,originKind:best.candidate.kind,originId:best.candidate.id,destinationKind:order.destinationKind,destinationId:order.destinationId,generalizedCost:best.cost};
  }
  markDispatched(orderId:string,shipmentId:string):void{const o=this.orders.get(orderId);if(o){o.status='dispatched';o.assignedShipmentId=shipmentId;}}
  markDelivered(orderId:string):void{const o=this.orders.get(orderId);if(o)o.status='delivered';}
  cancel(orderId:string):void{const o=this.orders.get(orderId);if(o)o.status='cancelled';}
  cancelForFirm(firmId:string):void{for(const o of this.orders.values())if(o.destinationId===firmId&&(o.status==='waiting'||o.status==='dispatched'))o.status='cancelled';}
  waitingAge(tick:number):number{const waiting=this.listOrders().filter(o=>o.status==='waiting');return waiting.length===0?0:waiting.reduce((s,o)=>s+Math.max(0,tick-o.createdTick),0)/waiting.length;}
  snapshotState():FreightDemandStateSnapshot{return{orders:this.listOrders(),nextOrderId:this.nextOrderId};}
  restoreState(state:FreightDemandStateSnapshot):void{this.orders.clear();for(const o of state.orders)this.orders.set(o.id,{...o});this.nextOrderId=state.nextOrderId;}
}
