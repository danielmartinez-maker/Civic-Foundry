import test from 'node:test';
import assert from 'node:assert/strict';
import { SimulationCore } from '../src/simulation/core/SimulationCore.ts';
import { TerrainGrid, type TerrainCell } from '../src/world/terrain/TerrainGrid.ts';
import { FreightVehicleSystem, type FreightShipment } from '../src/simulation/economy/FreightVehicleSystem.ts';
import { TrafficSystem } from '../src/simulation/traffic/TrafficSystem.ts';

function flat(width=10,height=5){const cells:TerrainCell[]=Array.from({length:width*height},()=>({elevation:0.5,water:false,buildable:true,biome:'grass' as const}));return new TerrainGrid(width,height,cells);}
function setup(){const core=new SimulationCore({terrain:flat(),startingFunds:1_000_000});core.buildRoad(Array.from({length:10},(_,x)=>({x,y:2})),'local');core.transportationGraph.rebuildIfNeeded(core.roads);const start=core.transportationGraph.findNodeAt(0,2)!;const end=core.transportationGraph.findNodeAt(9,2)!;const route=core.pathfinding.findRoute(core.transportationGraph,start.id,end.id)!;return{core,route,start,end};}
function shipment(start:string,end:string,weight=3):FreightShipment{return{id:'shipment:1',orderId:'order:1',commodity:'industrial_inputs',quantity:10,vehicleWeight:weight,originKind:'gateway',originId:'gateway:0:2',destinationKind:'firm',destinationId:'firm:1',originNodeId:start,destinationNodeId:end,createdTick:0,generalizedCost:10};}

test('active freight vehicle contributes vehicleWeight to its current road edge',()=>{const {start,end,route}=setup();const freight=new FreightVehicleSystem();freight.dispatch(shipment(start.id,end.id,3),route,0);assert.ok(Object.values(freight.edgeLoads()).some(load=>load===3));});

test('freight load increases authoritative traffic travel time',()=>{const {core,start,end,route}=setup();const traffic=new TrafficSystem();traffic.refreshMetrics(core.transportationGraph,{});const base=traffic.getEdgeTravelTime(core.transportationGraph.getEdge(route.edgeIds[0]!)!);const freight=new FreightVehicleSystem();for(let i=0;i<20;i++)freight.dispatch({...shipment(start.id,end.id,3),id:`shipment:${i}`,orderId:`order:${i}`},route,0);traffic.refreshMetrics(core.transportationGraph,freight.edgeLoads());const loaded=traffic.getEdgeTravelTime(core.transportationGraph.getEdge(route.edgeIds[0]!)!);assert.ok(loaded>base);});

test('completed vehicle releases all road load and emits delivered event',()=>{const {core,start,end,route}=setup();const freight=new FreightVehicleSystem();freight.dispatch(shipment(start.id,end.id,2),route,0);let delivered=false;for(let tick=1;tick<500&&!delivered;tick++){const events=freight.step(core.transportationGraph,e=>e.freeFlowTicks,tick);delivered=events.some(e=>e.type==='delivered');}assert.equal(delivered,true);assert.deepEqual(freight.edgeLoads(),{});});
