import type { SimulationCore } from '../simulation/core/SimulationCore.ts';

export type EconomyOverlayMode='none'|'firm-health'|'jobs'|'production'|'shortages'|'freight-volume'|'freight-routes'|'logistics-delay'|'gateways'|'trade-flow';
export type EconomyOverlayCell=Readonly<{firmId:string;buildingId:string;x:number;y:number;value:number;label:string}>;
export type EconomyOverlayRoute=Readonly<{vehicleId:string;edgeIds:readonly string[];value:number;label:string}>;
export type EconomyOverlayGateway=Readonly<{gatewayId:string;x:number;y:number;value:number;label:string}>;
export type EconomyOverlaySnapshot=Readonly<{mode:EconomyOverlayMode;cells:readonly EconomyOverlayCell[];routes:readonly EconomyOverlayRoute[];gateways:readonly EconomyOverlayGateway[];legend:string}>;
const clamp01=(v:number)=>Math.max(0,Math.min(1,Number.isFinite(v)?v:0));
export function mapEconomyOverlay(core:SimulationCore,mode:EconomyOverlayMode):EconomyOverlaySnapshot{
  const cells:EconomyOverlayCell[]=[];
  for(const firm of core.economyDomain.firms.list().filter(f=>f.status!=='closed')){
    const building=core.buildings.getById(firm.buildingId);if(!building)continue;const inventories=core.economyDomain.getFirmInventories(firm.id);
    let value=0,label='';
    if(mode==='firm-health'){value=clamp01(firm.cashHealth);label=`${Math.round(value*100)}% health`;}
    else if(mode==='jobs'){value=firm.jobCapacity<=0?0:clamp01(firm.filledJobs/firm.jobCapacity);label=`${firm.filledJobs}/${firm.jobCapacity} jobs`;}
    else if(mode==='production'){const inv=firm.zone==='industrial'?inventories.manufactured_goods:inventories.consumer_goods;value=inv.storageCapacity<=0?0:clamp01(inv.onHand/inv.storageCapacity);label=`${inv.onHand.toFixed(1)} stock`;}
    else if(mode==='shortages'){value=core.economyDomain.inventories.shortageRatio(firm.id);label=`${Math.round(value*100)}% shortage`;}
    else continue;
    cells.push({firmId:firm.id,buildingId:firm.buildingId,x:building.x,y:building.y,value,label});
  }
  const routes=core.economyDomain.freightVehicles.listVehicles().map(vehicle=>({vehicleId:vehicle.id,edgeIds:[...vehicle.routeEdgeIds],value:mode==='logistics-delay'?Math.max(0,vehicle.delayTicks):Math.max(0,vehicle.shipment.vehicleWeight),label:mode==='logistics-delay'?`${vehicle.delayTicks.toFixed(1)} ticks delay`:`${vehicle.shipment.quantity.toFixed(1)} cargo`}));
  const gatewayFlow=new Map<string,number>();for(const vehicle of core.economyDomain.freightVehicles.listVehicles()){if(vehicle.shipment.originKind==='gateway')gatewayFlow.set(vehicle.shipment.originId,(gatewayFlow.get(vehicle.shipment.originId)??0)+vehicle.shipment.quantity);if(vehicle.shipment.destinationKind==='gateway')gatewayFlow.set(vehicle.shipment.destinationId,(gatewayFlow.get(vehicle.shipment.destinationId)??0)+vehicle.shipment.quantity);}
  const gateways=core.economyDomain.trade.listGateways().map(g=>({gatewayId:g.id,x:g.x,y:g.y,value:gatewayFlow.get(g.id)??0,label:mode==='trade-flow'?`${(gatewayFlow.get(g.id)??0).toFixed(1)} flow`:`${g.id} · cap ${g.importCapacity}/${g.exportCapacity}`}));
  const legends:Record<EconomyOverlayMode,string>={none:'Economy overlay off.','firm-health':'Firm health: 0% distressed → 100% healthy.','jobs':'Jobs: 0% unfilled → 100% filled positions.',production:'Production stock: 0% empty → 100% output/storage capacity.',shortages:'Input shortage: 0% stocked → 100% target stock missing.','freight-volume':'Freight volume: active weighted truck routes; thicker means more vehicle load.','freight-routes':'Freight routes: active shipment paths on the road network.','logistics-delay':'Logistics delay: active freight delay in ticks along shipment routes.',gateways:`Freight gateways: ${gateways.length} boundary road connection${gateways.length===1?'':'s'}.`,'trade-flow':'Trade flow: current import/export cargo moving through each gateway.'};
  return Object.freeze({mode,cells:Object.freeze(cells.sort((a,b)=>a.firmId.localeCompare(b.firmId))),routes:Object.freeze((mode==='freight-volume'||mode==='freight-routes'||mode==='logistics-delay')?routes:[]),gateways:Object.freeze((mode==='gateways'||mode==='trade-flow')?gateways:[]),legend:legends[mode]});
}
