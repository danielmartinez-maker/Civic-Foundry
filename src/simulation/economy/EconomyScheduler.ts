import { ARCHETYPES, ECONOMY_CADENCE, ECONOMY_PRICES, type Commodity } from '../../data/economy.ts';
import type { Building } from '../buildings/BuildingSystem.ts';
import type { UrbanBusinessSite } from '../urban/UrbanBuildingView.ts';
import type { EmploymentSnapshot } from '../employment/EmploymentSystem.ts';
import { EmploymentSystem } from '../employment/EmploymentSystem.ts';
import type { PathfindingSystem, RouteResult } from '../traffic/PathfindingSystem.ts';
import type { TransportationEdge, TransportationGraph } from '../traffic/TransportationGraph.ts';
import { FirmSystem, type Firm } from './FirmSystem.ts';
import { LaborMarketSystem } from './LaborMarketSystem.ts';
import { InventorySystem, type InventoryStateSnapshot } from './InventorySystem.ts';
import { ProductionSystem } from './ProductionSystem.ts';
import { TradeSystem, type TradeStateSnapshot } from './TradeSystem.ts';
import { FreightDemandSystem, type FreightCandidate, type FreightDemandStateSnapshot, type FreightMatch, type FreightOrder } from './FreightDemandSystem.ts';
import { FreightVehicleSystem, type FreightShipment, type FreightVehicleStateSnapshot } from './FreightVehicleSystem.ts';
import { BusinessLifecycleSystem, type FirmCycleFinancials } from './BusinessLifecycleSystem.ts';

export type EconomyDomainSnapshot=Readonly<{
  activeFirms:number;formingFirms:number;distressedFirms:number;closedFirms:number;
  employment:EmploymentSnapshot;industrialOutput:number;wholesaleThroughput:number;retailSales:number;shortageRate:number;
  freightVolumeInTransit:number;averageFreightDelay:number;averageLogisticsCost:number;queuedOrders:number;queueDelay:number;
  cumulativeImports:number;cumulativeExports:number;cumulativeImportValue:number;cumulativeExportValue:number;
  businessFormations:number;businessClosures:number;aggregateFirmHealth:number;
}>;
export type EconomySchedulerStateSnapshot=Readonly<{
  firms:ReturnType<FirmSystem['snapshotState']>;inventories:InventoryStateSnapshot;trade:TradeStateSnapshot;orders:FreightDemandStateSnapshot;freightVehicles:FreightVehicleStateSnapshot;
  nextShipmentId:number;lastGraphRevision:number;financials:readonly Readonly<{firmId:string;values:FirmCycleFinancials}>[];businessFormations:number;businessClosures:number;industrialOutput:number;wholesaleThroughput:number;retailSales:number;freightDelayTotal:number;freightDeliveries:number;logisticsCostTotal:number;logisticsShipments:number;employment:EmploymentSnapshot;
}>;
export type EconomyTickInputs=Readonly<{
  tick:number;buildings?:readonly Building[];businessSites?:readonly UrbanBusinessSite[];population:number;graph:TransportationGraph;pathfinding:PathfindingSystem;roadTravelTime:(edge:TransportationEdge)=>number;
  utilityRatio:number;serviceRatio:number;personAccessibility:number;localDemand:number;width:number;height:number;taxRate:number;
}>;

type MutableFinancials={revenue:number;inputCost:number;wageCost:number;utilityCost:number;taxCost:number;logisticsCost:number;shortagePenalty:number;operatingMargin:number};
type RoutedCandidate=Readonly<{originNode:string;destinationNode:string;route:RouteResult}>;
const CARDINAL=[[0,-1],[1,0],[0,1],[-1,0]] as const;

export class EconomyScheduler{
  readonly firms:FirmSystem; readonly labor=new LaborMarketSystem(); readonly inventories=new InventorySystem(); readonly production=new ProductionSystem(); readonly trade=new TradeSystem(); readonly freightDemand=new FreightDemandSystem(); readonly freightVehicles=new FreightVehicleSystem(); readonly lifecycle=new BusinessLifecycleSystem();
  private readonly employmentSystem=new EmploymentSystem(); private cachedBuildings=new Map<string,Building>(); private cachedBusinessSites=new Map<string,UrbanBusinessSite>(); private lastGraphRevision=-1; private nextShipmentId=1;
  private financials=new Map<string,MutableFinancials>();
  private industrialOutput=0; private wholesaleThroughput=0; private retailSales=0; private freightDelayTotal=0; private freightDeliveries=0; private logisticsCostTotal=0; private logisticsShipments=0; private businessFormations=0; private businessClosures=0;
  private employment:EmploymentSnapshot;
  constructor(seed:number){this.firms=new FirmSystem(seed);this.employment=this.employmentSystem.evaluate(0,0);}

  tick(input:EconomyTickInputs):EconomyDomainSnapshot{
    if(input.graph.revision!==this.lastGraphRevision){this.trade.rebuildGateways(input.graph,input.width,input.height);this.lastGraphRevision=input.graph.revision;}
    const events=this.freightVehicles.step(input.graph,input.roadTravelTime,input.tick);this.applyFreightEvents(events);
    if(input.tick%ECONOMY_CADENCE.lifecycle===0&&(input.businessSites||input.buildings)){if(input.businessSites){this.cachedBusinessSites=new Map(input.businessSites.map(site=>[site.buildingId,{...site}]));this.firms.syncEligibleSites(input.businessSites,input.tick);}else if(input.buildings){this.cachedBuildings=new Map(input.buildings.map(b=>[b.id,{...b}]));this.firms.syncEligibleBuildings(input.buildings,input.tick);}this.runLifecycle(input);}
    if(input.tick%ECONOMY_CADENCE.production===0){this.allocateLabor(input);this.runProduction(input);}
    if(input.tick%ECONOMY_CADENCE.replenishment===0){this.freightDemand.createReplenishmentOrders(this.firms.list(),this.inventories,input.tick);this.createExportOrders(input);this.dispatchWaitingOrders(input);}
    return this.snapshot(input.tick);
  }

  snapshot(tick=0):EconomyDomainSnapshot{
    const list=this.firms.list();const active=list.filter(f=>f.status==='operating'||f.status==='distressed');
    const shortage=active.length===0?0:active.reduce((s,f)=>s+this.inventories.shortageRatio(f.id),0)/active.length;
    const inTransit=this.freightVehicles.listVehicles().reduce((s,v)=>s+v.shipment.quantity,0);
    return Object.freeze({activeFirms:active.length,formingFirms:list.filter(f=>f.status==='forming').length,distressedFirms:list.filter(f=>f.status==='distressed').length,closedFirms:list.filter(f=>f.status==='closed').length,employment:{...this.employment},industrialOutput:this.industrialOutput,wholesaleThroughput:this.wholesaleThroughput,retailSales:this.retailSales,shortageRate:shortage,freightVolumeInTransit:inTransit,averageFreightDelay:this.freightDeliveries===0?0:this.freightDelayTotal/this.freightDeliveries,averageLogisticsCost:this.logisticsShipments===0?0:this.logisticsCostTotal/this.logisticsShipments,queuedOrders:this.freightDemand.listOrders().filter(o=>o.status==='waiting').length,queueDelay:this.freightDemand.waitingAge(tick),cumulativeImports:this.trade.cumulativeImports,cumulativeExports:this.trade.cumulativeExports,cumulativeImportValue:this.trade.cumulativeImportValue,cumulativeExportValue:this.trade.cumulativeExportValue,businessFormations:this.businessFormations,businessClosures:this.businessClosures,aggregateFirmHealth:active.length===0?0:active.reduce((s,f)=>s+f.cashHealth,0)/active.length});
  }

  removeBuilding(buildingId:string,tick:number):void{const firm=this.firms.getByBuildingId(buildingId);if(!firm)return;this.firms.update(firm.id,{status:'closed',closureTick:tick,filledJobs:0,vacancies:0,distressReason:'building removed'});this.cleanupClosedFirm(firm.id);this.financials.delete(firm.id);this.businessClosures++;}
  getFirmAtBuilding(buildingId:string):Firm|undefined{return this.firms.getByBuildingId(buildingId);}
  getFirmInventories(firmId:string){return this.inventories.listForFirm(firmId);}
  getFirmFinancials(firmId:string):FirmCycleFinancials{const values=this.financials.get(firmId)??this.blankFinancials();return{...values,operatingMargin:values.revenue-values.inputCost-values.wageCost-values.utilityCost-values.taxCost-values.logisticsCost-values.shortagePenalty};}
  snapshotState():EconomySchedulerStateSnapshot{return{firms:this.firms.snapshotState(),inventories:this.inventories.snapshotState(),trade:this.trade.snapshotState(),orders:this.freightDemand.snapshotState(),freightVehicles:this.freightVehicles.snapshotState(),nextShipmentId:this.nextShipmentId,lastGraphRevision:this.lastGraphRevision,financials:[...this.financials.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([firmId,values])=>({firmId,values:{...values}})),businessFormations:this.businessFormations,businessClosures:this.businessClosures,industrialOutput:this.industrialOutput,wholesaleThroughput:this.wholesaleThroughput,retailSales:this.retailSales,freightDelayTotal:this.freightDelayTotal,freightDeliveries:this.freightDeliveries,logisticsCostTotal:this.logisticsCostTotal,logisticsShipments:this.logisticsShipments,employment:{...this.employment}};}
  restoreState(state:EconomySchedulerStateSnapshot):void{this.firms.restoreState(state.firms);this.inventories.restoreState(state.inventories);this.trade.restoreState(state.trade);this.freightDemand.restoreState(state.orders);this.freightVehicles.restoreState(state.freightVehicles);this.nextShipmentId=state.nextShipmentId;this.lastGraphRevision=state.lastGraphRevision;this.financials=new Map(state.financials.map(item=>[item.firmId,{...item.values}]));this.businessFormations=state.businessFormations;this.businessClosures=state.businessClosures;this.industrialOutput=state.industrialOutput;this.wholesaleThroughput=state.wholesaleThroughput;this.retailSales=state.retailSales;this.freightDelayTotal=state.freightDelayTotal;this.freightDeliveries=state.freightDeliveries;this.logisticsCostTotal=state.logisticsCostTotal;this.logisticsShipments=state.logisticsShipments;this.employment={...state.employment};}
  restoreDerivedContext(buildings:readonly Building[]):void{this.cachedBuildings=new Map(buildings.map(building=>[building.id,{...building}]));}
  restoreSemanticDerivedContext(sites:readonly UrbanBusinessSite[]):void{this.cachedBusinessSites=new Map(sites.map(site=>[site.buildingId,{...site}]));}
  reconcileBusinessSites(sites:readonly UrbanBusinessSite[],tick:number,population:number):EmploymentSnapshot{if(!Number.isInteger(tick)||tick<0)throw new Error('tick must be a non-negative integer');this.cachedBusinessSites=new Map(sites.map(site=>[site.buildingId,{...site}]));this.firms.syncEligibleSites(sites,tick);const active=this.firms.list().filter(firm=>firm.status==='operating'||firm.status==='distressed');const totalJobs=active.reduce((sum,firm)=>sum+firm.jobCapacity,0);const employedJobs=active.reduce((sum,firm)=>sum+firm.filledJobs,0);this.employment=this.employmentSystem.evaluateFromFirmTotals(population,totalJobs,employedJobs);return{...this.employment};}

  private runLifecycle(input:EconomyTickInputs):void{
    const gateways=this.trade.listGateways();
    for(const firm of this.firms.list().filter(f=>f.status==='forming')){
      const access=this.accessNodesForFirm(firm,input.graph);
      const reachable=access.some(nodeId=>gateways.some(g=>input.pathfinding.findRoute(input.graph,nodeId,g.nodeId,{costKey:'freight-free-flow'})!==null));
      const score=this.lifecycle.scoreFormation({reachableGateway:reachable,utilityRatio:input.utilityRatio,laborAvailability:this.employment.workforce===0?1:Math.max(0,1-this.employment.unemploymentRate),accessibility:input.personAccessibility,localDemand:Math.min(1,input.localDemand),sectorGap:1,taxRate:input.taxRate});
      if(score>=0.35){this.firms.update(firm.id,{status:'operating',vacancies:firm.jobCapacity});this.inventories.syncFirm({...firm,status:'operating'});this.financials.set(firm.id,this.blankFinancials());this.businessFormations++;}
    }
    for(const firm of this.firms.list().filter(f=>(f.status==='operating'||f.status==='distressed')&&f.formationTick<input.tick)){
      const accrual=this.financials.get(firm.id)??this.blankFinancials();
      const taxCost=accrual.revenue*Math.max(0,input.taxRate);
      const values={...accrual,taxCost,operatingMargin:accrual.revenue-accrual.inputCost-accrual.wageCost-accrual.utilityCost-taxCost-accrual.logisticsCost-accrual.shortagePenalty};
      const update=this.lifecycle.evaluateFirm(firm,values,input.tick);
      this.firms.update(firm.id,update);
      if(update.status==='closed'){this.cleanupClosedFirm(firm.id);this.businessClosures++;this.financials.delete(firm.id);}else this.financials.set(firm.id,this.blankFinancials());
    }
  }
  private allocateLabor(input:EconomyTickInputs):void{const allocation=this.labor.allocateDetailed(this.firms.list(),input.population,{accessibility:input.personAccessibility,utilityRatio:input.utilityRatio});for(const firm of this.firms.list()){const filled=allocation.filledByFirm[firm.id]??0;if(firm.status==='operating'||firm.status==='distressed')this.firms.update(firm.id,{filledJobs:filled,vacancies:Math.max(0,firm.jobCapacity-filled)});}this.employment=allocation.snapshot;}
  private runProduction(input:EconomyTickInputs):void{for(const firm of this.firms.list().filter(f=>f.status==='operating'||f.status==='distressed')){const result=this.production.runFirmCycle(firm,this.inventories,{utilityRatio:input.utilityRatio,serviceRatio:input.serviceRatio,localDemand:input.localDemand});const acc=this.accrual(firm.id);acc.wageCost+=firm.filledJobs*ECONOMY_PRICES.wagePerJob;acc.utilityCost+=firm.filledJobs*ECONOMY_PRICES.utilityPerJob*(2-Math.max(0,Math.min(1,input.utilityRatio)));acc.shortagePenalty+=result.lostOutputFromInputShortage*2;if(firm.archetype==='retail_local'){const revenue=result.soldConsumerGoods*ECONOMY_PRICES.consumer_goods;this.retailSales+=revenue;acc.revenue+=revenue;}else if(firm.archetype==='wholesale_logistics')this.wholesaleThroughput+=result.throughput;else this.industrialOutput+=result.throughput;this.financials.set(firm.id,acc);}}
  private createExportOrders(input:EconomyTickInputs):void{
    const gateways=this.trade.listGateways().filter(gateway=>gateway.exportCapacity>0);if(gateways.length===0)return;
    for(const firm of this.firms.list().filter(f=>f.status==='operating'&&(f.archetype==='light_manufacturing'||f.archetype==='assembly_manufacturing'))){
      const inv=this.inventories.get(firm.id,'manufactured_goods');const existing=this.freightDemand.listOrders().some(o=>o.originFirmId===firm.id&&o.destinationKind==='gateway'&&(o.status==='waiting'||o.status==='dispatched'));const surplus=Math.max(0,inv.onHand-Math.max(5,inv.targetStock));
      if(existing||surplus<5)continue;
      const starts=this.accessNodesForFirm(firm,input.graph);let best:{gatewayId:string;cost:number}|null=null;
      for(const gateway of gateways){for(const start of starts){const route=input.pathfinding.findRoute(input.graph,start,gateway.nodeId,{edgeCost:input.roadTravelTime,costKey:`freight:${Math.floor(input.tick/10)}`});if(!route)continue;const cost=this.routeCost(route,input);if(!best||cost<best.cost-1e-9||(Math.abs(cost-best.cost)<=1e-9&&gateway.id.localeCompare(best.gatewayId)<0))best={gatewayId:gateway.id,cost};}}
      if(best)this.freightDemand.createExportOrder(firm.id,'manufactured_goods',Math.min(10,surplus),best.gatewayId,input.tick);
    }
  }
  private dispatchWaitingOrders(input:EconomyTickInputs):void{
    for(const order of this.freightDemand.listOrders().filter(o=>o.status==='waiting').sort((a,b)=>b.priority-a.priority||a.id.localeCompare(b.id))){
      if(!this.freightVehicles.hasDispatchCapacity())break;
      const destinationNodes=this.destinationNodes(order,input.graph);if(destinationNodes.length===0)continue;
      const candidates=this.candidates(order);
      const match=this.freightDemand.matchOrder(order,candidates,candidate=>{const routed=this.bestCandidateRoute(candidate,destinationNodes,input);return routed?this.routeCost(routed.route,input):Infinity;});
      if(!match)continue;
      const routed=this.bestCandidateRoute({kind:match.originKind,id:match.originId,available:match.quantity},destinationNodes,input);if(!routed)continue;
      this.dispatchMatch(order,match,routed,input);
    }
  }
  private dispatchMatch(order:FreightOrder,match:FreightMatch,routed:RoutedCandidate,input:EconomyTickInputs):void{
    const shipmentId=`shipment:${this.nextShipmentId++}`;try{if(match.originKind==='firm')this.inventories.dispatchCargo(match.originId,match.commodity,match.quantity,shipmentId);else this.inventories.createExternalCargo(match.commodity,match.quantity,shipmentId);}catch{return;}
    const shipment:FreightShipment={id:shipmentId,orderId:order.id,commodity:match.commodity,quantity:match.quantity,vehicleWeight:Math.max(1,match.quantity/10),originKind:match.originKind,originId:match.originId,destinationKind:match.destinationKind,destinationId:match.destinationId,originNodeId:routed.originNode,destinationNodeId:routed.destinationNode,createdTick:input.tick,generalizedCost:match.generalizedCost};
    this.freightVehicles.dispatch(shipment,routed.route,input.tick);this.freightDemand.markDispatched(order.id,shipmentId);this.logisticsCostTotal+=match.generalizedCost;this.logisticsShipments++;const costTarget=match.destinationKind==='firm'?match.destinationId:(order.originFirmId??'');if(costTarget){const acc=this.accrual(costTarget);acc.logisticsCost+=match.generalizedCost*0.1;this.financials.set(costTarget,acc);}
  }
  private applyFreightEvents(events:ReturnType<FreightVehicleSystem['step']>):void{for(const event of events){const token=this.inventories.getCargo(event.shipment.id);if(!token)continue;if(event.type==='delivered'){if(event.shipment.destinationKind==='firm')this.inventories.receiveCargo(event.shipment.destinationId,token);else this.inventories.completeExport(token);if(event.shipment.originKind==='gateway')this.trade.recordImport(event.shipment.quantity,event.shipment.quantity*ECONOMY_PRICES[event.shipment.commodity]);if(event.shipment.destinationKind==='gateway')this.trade.recordExport(event.shipment.quantity,event.shipment.quantity*ECONOMY_PRICES[event.shipment.commodity]);if(event.shipment.originKind==='firm'){const acc=this.accrual(event.shipment.originId);acc.revenue+=event.shipment.quantity*ECONOMY_PRICES[event.shipment.commodity];this.financials.set(event.shipment.originId,acc);}if(event.shipment.destinationKind==='firm'){const acc=this.accrual(event.shipment.destinationId);acc.inputCost+=event.shipment.quantity*ECONOMY_PRICES[event.shipment.commodity];this.financials.set(event.shipment.destinationId,acc);}this.freightDemand.markDelivered(event.shipment.orderId);this.freightDelayTotal+=event.delayTicks;this.freightDeliveries++;}else{this.inventories.cancelCargo(token);this.freightDemand.retry(event.shipment.orderId);}}}
  private accrual(firmId:string):MutableFinancials{return{...(this.financials.get(firmId)??this.blankFinancials())};}
  private blankFinancials():MutableFinancials{return{revenue:0,inputCost:0,wageCost:0,utilityCost:0,taxCost:0,logisticsCost:0,shortagePenalty:0,operatingMargin:0};}
  private cleanupClosedFirm(firmId:string):void{this.freightDemand.cancelForFirm(firmId);for(const vehicle of this.freightVehicles.listVehicles()){const s=vehicle.shipment;if(s.originId!==firmId&&s.destinationId!==firmId)continue;const token=this.inventories.getCargo(s.id);if(token){try{this.inventories.cancelCargo(token);}catch{}}this.freightVehicles.removeForShipment(s.id);this.freightDemand.cancel(s.orderId);}this.inventories.removeFirm(firmId);}
  private candidates(order:FreightOrder):FreightCandidate[]{if(order.destinationKind==='gateway'&&order.originFirmId){const inv=this.inventories.get(order.originFirmId,order.commodity);return[{kind:'firm',id:order.originFirmId,available:inv.onHand}];}const result:FreightCandidate[]=[];if(order.commodity!=='industrial_inputs'){for(const firm of this.firms.list().filter(f=>f.status==='operating'||f.status==='distressed')){if(firm.id===order.destinationId)continue;const available=this.inventories.get(firm.id,order.commodity).onHand;if(available>=order.quantity)result.push({kind:'firm',id:firm.id,available});}}for(const gateway of this.trade.listGateways())result.push({kind:'gateway',id:gateway.id,available:Infinity});return result;}
  private destinationNodes(order:FreightOrder,graph:TransportationGraph):string[]{if(order.destinationKind==='gateway'){const node=this.trade.getGateway(order.destinationId)?.nodeId;return node?[node]:[];}return this.accessNodesForFirm(this.firms.get(order.destinationId),graph);}
  private candidateNodes(id:string,kind:'firm'|'gateway',graph:TransportationGraph):string[]{if(kind==='gateway'){const node=this.trade.getGateway(id)?.nodeId;return node?[node]:[];}return this.accessNodesForFirm(this.firms.get(id),graph);}
  private accessNodesForFirm(firm:Firm|undefined,graph:TransportationGraph):string[]{if(!firm)return[];const site=this.cachedBusinessSites.get(firm.buildingId);const building=site??this.cachedBuildings.get(firm.buildingId);if(!building)return[];return CARDINAL.map(([dx,dy])=>graph.findNodeAt(building.x+dx,building.y+dy)?.id).filter((id):id is string=>id!==undefined).sort();}
  private bestCandidateRoute(candidate:FreightCandidate,destinationNodes:readonly string[],input:EconomyTickInputs):RoutedCandidate|null{const origins=this.candidateNodes(candidate.id,candidate.kind,input.graph);let best:RoutedCandidate|null=null;for(const originNode of origins){for(const destinationNode of destinationNodes){const route=input.pathfinding.findRoute(input.graph,originNode,destinationNode,{edgeCost:input.roadTravelTime,costKey:`freight:${Math.floor(input.tick/10)}`});if(!route)continue;if(!best||route.totalCost<best.route.totalCost-1e-9||(Math.abs(route.totalCost-best.route.totalCost)<=1e-9&&`${originNode}|${destinationNode}`.localeCompare(`${best.originNode}|${best.destinationNode}`)<0))best={originNode,destinationNode,route};}}return best;}
  private routeCost(route:RouteResult,input:EconomyTickInputs):number{return route.edgeIds.reduce((s,id)=>{const edge=input.graph.getEdge(id);return s+(edge?input.roadTravelTime(edge):0);},0);}
}
