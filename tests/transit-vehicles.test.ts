import test from 'node:test';
import assert from 'node:assert/strict';
import { TerrainGrid } from '../src/world/terrain/TerrainGrid.ts';
import { RoadSystem } from '../src/world/roads/RoadSystem.ts';
import { TreasurySystem } from '../src/simulation/treasury/TreasurySystem.ts';
import { TransportationGraph } from '../src/simulation/traffic/TransportationGraph.ts';
import { PathfindingSystem } from '../src/simulation/traffic/PathfindingSystem.ts';
import { TrafficSystem } from '../src/simulation/traffic/TrafficSystem.ts';
import { TransitNetworkSystem } from '../src/simulation/transit/TransitNetworkSystem.ts';
import { PassengerQueueSystem, type TransitPassengerCohort } from '../src/simulation/transit/PassengerQueueSystem.ts';
import { TransitVehicleSystem } from '../src/simulation/transit/TransitVehicleSystem.ts';
import { TransitOperationsSystem } from '../src/simulation/transit/TransitOperationsSystem.ts';

function setup(mode: 'bus'|'brt'|'tram'|'metro' = 'bus') {
  const terrain=TerrainGrid.generate(12,5,4); const roads=new RoadSystem(terrain); const treasury=new TreasurySystem(1_000_000);
  roads.placePath(Array.from({length:10},(_,i)=>({x:i+1,y:2})), 'local', treasury);
  const graph=new TransportationGraph(); graph.rebuildIfNeeded(roads);
  const network=new TransitNetworkSystem(terrain,roads); const stopType=mode==='metro'?'metro_station':'surface_stop';
  const a=network.placeStop(stopType,2,1,treasury).id!; const b=network.placeStop(stopType,8,1,treasury).id!;
  const line=network.createLine(mode,'L1'); assert.equal(network.setLineStops(line,[a,b]).ok,true); network.setEnabled(line,true); network.setHeadway(line,20);
  return {terrain,roads,treasury,graph,network,a,b,line,path:new PathfindingSystem(),traffic:new TrafficSystem(),queues:new PassengerQueueSystem()};
}
function cohort(id:string,lineId:string,from:string,to:string,weight:number,directionKey='forward'):TransitPassengerCohort{return{id,personTripId:id,travelerWeight:weight,lineId,directionKey,boardingStopId:from,alightingStopId:to,destinationRoadNodeId:'n:9,2',enqueuedTick:0,transferLegs:[]};}

test('scheduled dispatch respects fleet limit and records missed runs',()=>{
 const s=setup('bus'); const vehicles=new TransitVehicleSystem(); const ops=new TransitOperationsSystem(); ops.setFleetLimit(s.line,1);
 for(let tick=0;tick<=45;tick++) ops.step(tick,s.network,vehicles,s.queues,s.graph,s.path,e=>e.freeFlowTicks);
 assert.equal(ops.snapshotLine(s.line).dispatchedRuns,1); assert.ok(ops.snapshotLine(s.line).missedRuns>=1); assert.equal(vehicles.listVehicles().filter(v=>v.lineId===s.line).length,1);
});

test('vehicle dwells, boards finite capacity, moves, and alights',()=>{
 const s=setup('bus'); const vehicles=new TransitVehicleSystem(); const ops=new TransitOperationsSystem(); ops.setFleetLimit(s.line,1);
 s.queues.enqueue(s.a,s.line,'forward',cohort('p1',s.line,s.a,s.b,80));
 for(let tick=0;tick<65;tick++) ops.step(tick,s.network,vehicles,s.queues,s.graph,s.path,e=>e.freeFlowTicks);
 const snap=ops.snapshotLine(s.line); assert.equal(snap.boardings,60); assert.equal(snap.completedPassengerWeight,60); assert.equal(s.queues.waitingWeight(s.a,s.line,'forward'),20); assert.equal(snap.fareRevenue,120);
});

test('surface transit creates real road load that enters traffic metrics',()=>{
 const s=setup('tram'); const vehicles=new TransitVehicleSystem(); const ops=new TransitOperationsSystem(); ops.setFleetLimit(s.line,1);
 for(let tick=0;tick<20;tick++) ops.step(tick,s.network,vehicles,s.queues,s.graph,s.path,e=>e.freeFlowTicks);
 const loads=vehicles.edgeLoads(); assert.ok(Object.values(loads).some(v=>v>0)); s.traffic.refreshMetrics(s.graph,loads); assert.ok(s.traffic.edgeMetrics.some(m=>m.weightedVehicles>0));
});

test('bus is congestion-sensitive while metro is congestion-insulated',()=>{
 const bus=setup('bus'), metro=setup('metro'); const vb=new TransitVehicleSystem(), vm=new TransitVehicleSystem(); const ob=new TransitOperationsSystem(), om=new TransitOperationsSystem(); ob.setFleetLimit(bus.line,1); om.setFleetLimit(metro.line,1);
 const congested=(e:any)=>e.freeFlowTicks*4;
 for(let tick=0;tick<120;tick++){ob.step(tick,bus.network,vb,bus.queues,bus.graph,bus.path,congested);om.step(tick,metro.network,vm,metro.queues,metro.graph,metro.path,congested);}
 assert.ok(ob.snapshotLine(bus.line).delayTicks>0); assert.equal(om.snapshotLine(metro.line).delayTicks,0);
});

test('BRT absorbs less congestion delay than ordinary bus',()=>{
 const bus=setup('bus'), brt=setup('brt'); const vb=new TransitVehicleSystem(), vr=new TransitVehicleSystem(); const ob=new TransitOperationsSystem(), or=new TransitOperationsSystem(); ob.setFleetLimit(bus.line,1); or.setFleetLimit(brt.line,1);
 const congested=(e:any)=>e.freeFlowTicks*4;
 for(let tick=0;tick<120;tick++){ob.step(tick,bus.network,vb,bus.queues,bus.graph,bus.path,congested);or.step(tick,brt.network,vr,brt.queues,brt.graph,brt.path,congested);}
 assert.ok(or.snapshotLine(brt.line).delayTicks<ob.snapshotLine(bus.line).delayTicks);
});

test('road deletion fails a surface run safely without stale load',()=>{
 const s=setup('bus'); const vehicles=new TransitVehicleSystem(); const ops=new TransitOperationsSystem(); ops.setFleetLimit(s.line,1);
 for(let tick=0;tick<15;tick++) ops.step(tick,s.network,vehicles,s.queues,s.graph,s.path,e=>e.freeFlowTicks);
 s.roads.remove(5,2); s.graph.rebuildIfNeeded(s.roads);
 for(let tick=15;tick<30;tick++) ops.step(tick,s.network,vehicles,s.queues,s.graph,s.path,e=>e.freeFlowTicks);
 assert.ok(ops.snapshotLine(s.line).failedRuns>=1); assert.equal(Object.keys(vehicles.edgeLoads()).length,0);
});
