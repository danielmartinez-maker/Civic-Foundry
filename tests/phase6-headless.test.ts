import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { SimulationCore } from '../src/simulation/core/SimulationCore.ts';
import { TerrainGrid, type TerrainCell } from '../src/world/terrain/TerrainGrid.ts';
import { ProductionSystem } from '../src/simulation/economy/ProductionSystem.ts';
import { InventorySystem } from '../src/simulation/economy/InventorySystem.ts';
import { FreightDemandSystem } from '../src/simulation/economy/FreightDemandSystem.ts';
import { FreightVehicleSystem, type FreightShipment } from '../src/simulation/economy/FreightVehicleSystem.ts';
import { TrafficSystem } from '../src/simulation/traffic/TrafficSystem.ts';
import { BusinessLifecycleSystem } from '../src/simulation/economy/BusinessLifecycleSystem.ts';
import { FirmSystem, type Firm } from '../src/simulation/economy/FirmSystem.ts';
import { TradeSystem } from '../src/simulation/economy/TradeSystem.ts';
import { hydrateCore, serializeCore, serializeCoreV5 } from '../src/save/save.ts';
import type { Building } from '../src/simulation/buildings/BuildingSystem.ts';

function flat(width=40,height=24){const cells:TerrainCell[]=Array.from({length:width*height},()=>({elevation:.5,water:false,buildable:true,biome:'grass' as const}));return new TerrainGrid(width,height,cells);}
function buildCity(seed=77):SimulationCore{
  const core=new SimulationCore({terrain:flat(),startingFunds:2_000_000,seed});
  core.buildRoad(Array.from({length:40},(_,x)=>({x,y:12})),'collector');
  for(let x=4;x<=14;x++) core.paintZone([{x,y:11}],'residential');
  for(let x=20;x<=27;x++) core.paintZone([{x,y:11}],'commercial');
  for(let x=28;x<=36;x++) core.paintZone([{x,y:11}],'industrial');
  for(const [x,y] of [[6,13],[10,13],[14,13]] as const) core.placeUtility('power',x,y);
  for(const [x,y] of [[18,13],[22,13],[26,13]] as const) core.placeUtility('water',x,y);
  for(const [x,y] of [[30,13],[33,13],[36,13]] as const) core.placeUtility('landfill',x,y);
  return core;
}
const baseFirm=(patch:Partial<Firm>={}):Firm=>({id:'firm:1',buildingId:'building:1',zone:'industrial',archetype:'light_manufacturing',status:'operating',jobCapacity:14,filledJobs:14,vacancies:0,productivity:1,cashHealth:.6,consecutiveLossCycles:0,consecutiveRecoveryCycles:0,formationTick:0,lastOperatingMargin:0,...patch});

test('1 firms replace raw building jobs',()=>{const core=buildCity();core.step(1200);const active=core.economyDomain.firms.list().filter(f=>f.status==='operating'||f.status==='distressed');assert.ok(active.length>0);assert.equal(core.employmentSnapshot.totalJobs,active.reduce((s,f)=>s+f.jobCapacity,0));assert.equal(core.employmentSnapshot.employed,active.reduce((s,f)=>s+f.filledJobs,0));});

test('2 manufacturing requires industrial inputs',()=>{const inv=new InventorySystem();const result=new ProductionSystem().runFirmCycle(baseFirm(),inv,{utilityRatio:1,serviceRatio:1,localDemand:1});assert.equal(result.produced.manufactured_goods??0,0);inv.seed('firm:1','industrial_inputs',20);const restored=new ProductionSystem().runFirmCycle(baseFirm(),inv,{utilityRatio:1,serviceRatio:1,localDemand:1});assert.ok((restored.produced.manufactured_goods??0)>0);});

test('3 lower-cost local manufactured goods beat imports',()=>{const demand=new FreightDemandSystem();const order={id:'order:1',commodity:'manufactured_goods' as const,quantity:5,destinationKind:'firm' as const,destinationId:'firm:d',createdTick:0,priority:1,status:'waiting' as const};const match=demand.matchOrder(order,[{kind:'firm',id:'firm:local',available:5},{kind:'gateway',id:'gateway:0:1',available:Infinity}],c=>c.kind==='firm'?15:80);assert.equal(match?.originKind,'firm');});

test('4 explicit freight raises real road travel time',()=>{const core=new SimulationCore({terrain:flat(12,6),startingFunds:100_000});core.buildRoad(Array.from({length:12},(_,x)=>({x,y:3})),'local');core.transportationGraph.rebuildIfNeeded(core.roads);const start=core.transportationGraph.findNodeAt(0,3)!,end=core.transportationGraph.findNodeAt(11,3)!;const route=core.pathfinding.findRoute(core.transportationGraph,start.id,end.id)!;const traffic=new TrafficSystem();traffic.refreshMetrics(core.transportationGraph,{});const edge=core.transportationGraph.getEdge(route.edgeIds[0]!)!;const base=traffic.getEdgeTravelTime(edge);const freight=new FreightVehicleSystem();for(let i=0;i<30;i++){const shipment:FreightShipment={id:`s:${i}`,orderId:`o:${i}`,commodity:'industrial_inputs',quantity:10,vehicleWeight:2,originKind:'gateway',originId:'gateway:0:3',destinationKind:'firm',destinationId:'firm:1',originNodeId:start.id,destinationNodeId:end.id,createdTick:0,generalizedCost:route.totalCost};freight.dispatch(shipment,route,0);}traffic.refreshMetrics(core.transportationGraph,freight.edgeLoads());assert.ok(traffic.getEdgeTravelTime(edge)>base);});

test('5 congestion-driven logistics cost lowers firm health',()=>{const lifecycle=new BusinessLifecycleSystem();const firm=baseFirm();const free=lifecycle.evaluateFirm(firm,{revenue:50,inputCost:10,wageCost:10,utilityCost:2,taxCost:2,logisticsCost:2,shortagePenalty:0,operatingMargin:24},250);const congested=lifecycle.evaluateFirm(firm,{revenue:50,inputCost:10,wageCost:10,utilityCost:2,taxCost:2,logisticsCost:40,shortagePenalty:0,operatingMargin:-14},250);assert.ok(congested.cashHealth<free.cashHealth);assert.ok(congested.lastOperatingMargin<free.lastOperatingMargin);});

test('6 a shorter freight route reduces generalized cost without a flat health bonus',()=>{const lifecycle=new BusinessLifecycleSystem();const firm=baseFirm();const shortCost=8,longCost=32;const short=lifecycle.evaluateFirm(firm,{revenue:45,inputCost:12,wageCost:10,utilityCost:2,taxCost:2,logisticsCost:shortCost,shortagePenalty:0,operatingMargin:11},250);const long=lifecycle.evaluateFirm(firm,{revenue:45,inputCost:12,wageCost:10,utilityCost:2,taxCost:2,logisticsCost:longCost,shortagePenalty:0,operatingMargin:-13},250);assert.ok(shortCost<longCost);assert.ok(short.cashHealth>long.cashHealth);});

test('7 freight dispatch capacity causes queues delay and eventual shortages',()=>{const constrained=buildCity(91);const flowing=buildCity(91);constrained.economyDomain.freightVehicles.setDispatchCapacity(0);flowing.economyDomain.freightVehicles.setDispatchCapacity(100);constrained.step(2200);flowing.step(2200);const low=constrained.economyDomain.snapshot(constrained.clock.tick),high=flowing.economyDomain.snapshot(flowing.clock.tick);assert.ok(low.queuedOrders>high.queuedOrders);assert.ok(low.queueDelay>high.queueDelay);assert.ok(low.shortageRate>high.shortageRate);});

test('8 delivered imports and exports conserve cargo volume',()=>{const inv=new InventorySystem(),trade=new TradeSystem();const inbound=inv.createExternalCargo('consumer_goods',7,'shipment:in');inv.receiveCargo('firm:r',inbound);trade.recordImport(7,70);assert.equal(inv.get('firm:r','consumer_goods').onHand,7);assert.equal(trade.cumulativeImports,7);inv.seed('firm:m','manufactured_goods',10);const outbound=inv.dispatchCargo('firm:m','manufactured_goods',5,'shipment:out');inv.completeExport(outbound);trade.recordExport(5,80);assert.equal(inv.get('firm:m','manufactured_goods').onHand,5);assert.equal(trade.cumulativeExports,5);});

test('9 formation and closure ticks are deterministic for identical seed and state',()=>{const building:Building={id:'building:i',lotId:'i',x:2,y:2,zone:'industrial',definitionId:'industrial_workshop',status:'occupied',constructionStartedTick:0,completionTick:0};const run=()=>{const firms=new FirmSystem(44);firms.syncEligibleBuildings([building],250);const f=firms.list()[0]!;firms.update(f.id,{status:'operating',formationTick:250});const lifecycle=new BusinessLifecycleSystem();for(const tick of [500,750,1000,1250,1500]){const current=firms.get(f.id)!;const update=lifecycle.evaluateFirm(current,{revenue:0,inputCost:20,wageCost:20,utilityCost:10,taxCost:0,logisticsCost:20,shortagePenalty:20,operatingMargin:-90},tick);firms.update(f.id,update);if(update.status==='closed')break;}return firms.get(f.id)!;};const a=run(),b=run();assert.equal(a.formationTick,b.formationTick);assert.equal(a.closureTick,b.closureTick);assert.equal(a.status,'closed');});

test('10 closing a firm cleans jobs orders cargo and inventories safely',()=>{const core=buildCity();core.step(1200);const firm=core.economyDomain.firms.list().find(f=>f.status==='operating'||f.status==='distressed');assert.ok(firm);const building=core.buildings.getById(firm!.buildingId)!;core.bulldozeAt(building.x,building.y);core.step(100);const closed=core.economyDomain.firms.get(firm!.id)!;assert.equal(closed.status,'closed');assert.equal(closed.filledJobs,0);assert.ok(core.economyDomain.freightDemand.listOrders().filter(o=>(o.status==='waiting'||o.status==='dispatched')&&(o.destinationId===firm!.id||o.originFirmId===firm!.id)).length===0);assert.ok(core.economyDomain.inventories.snapshotState().records.every(r=>r.firmId!==firm!.id&&r.record.onHand>=0));});

test('11 Save V6 continuation matches uninterrupted economy state',()=>{const a=buildCity();a.step(1000);const b=hydrateCore(structuredClone(serializeCore(a)));a.step(300);b.step(300);assert.deepEqual(serializeCore(b),serializeCore(a));});

test('12 V5 migration fabricates no Phase 6 economic history',()=>{const legacy=buildCity();legacy.step(600);const migrated=hydrateCore(serializeCoreV5(legacy));const s=migrated.economyDomain.snapshot(migrated.clock.tick);assert.equal(s.activeFirms,0);assert.equal(s.cumulativeImports,0);assert.equal(s.cumulativeExports,0);assert.equal(s.businessFormations,0);assert.equal(s.businessClosures,0);});

test('performance: 2000 firm lifecycle evaluations are diagnostic-only fast',()=>{const lifecycle=new BusinessLifecycleSystem();const start=performance.now();for(let i=0;i<2000;i++)lifecycle.evaluateFirm(baseFirm({id:`firm:${i}`}),{revenue:40,inputCost:10,wageCost:10,utilityCost:2,taxCost:2,logisticsCost:4,shortagePenalty:0,operatingMargin:12},250);console.log(`phase6 perf lifecycle2000_ms=${(performance.now()-start).toFixed(1)}`);});

test('performance: 10000 indexed freight matches avoid all-pairs scans',()=>{const demand=new FreightDemandSystem();const candidates=[{kind:'firm' as const,id:'firm:a',available:100},{kind:'gateway' as const,id:'gateway:0:1',available:Infinity}];const order={id:'o',commodity:'manufactured_goods' as const,quantity:5,destinationKind:'firm' as const,destinationId:'firm:d',createdTick:0,priority:1,status:'waiting' as const};const start=performance.now();for(let i=0;i<10_000;i++)assert.ok(demand.matchOrder(order,candidates,c=>c.kind==='firm'?10:20));console.log(`phase6 perf match10000_ms=${(performance.now()-start).toFixed(1)}`);});

test('performance: 5000 active economy ticks remain an interactive diagnostic',()=>{const core=buildCity(120);const start=performance.now();core.step(5000);console.log(`phase6 perf economy5000_ms=${(performance.now()-start).toFixed(1)} firms=${core.economyDomain.snapshot().activeFirms}`);assert.equal(core.clock.tick,5000);});

test('performance: stable freight OD route planning reuses cache',()=>{const core=new SimulationCore({terrain:flat(40,8)});core.buildRoad(Array.from({length:40},(_,x)=>({x,y:4})),'collector');core.transportationGraph.rebuildIfNeeded(core.roads);const a=core.transportationGraph.findNodeAt(0,4)!,b=core.transportationGraph.findNodeAt(39,4)!;const before=core.pathfinding.diagnostics.cacheHits;for(let i=0;i<100;i++)assert.ok(core.pathfinding.findRoute(core.transportationGraph,a.id,b.id,{costKey:'freight-free-flow'}));const hits=core.pathfinding.diagnostics.cacheHits-before;console.log(`phase6 perf route_cache_hits=${hits}/100`);assert.ok(hits>=99);});
