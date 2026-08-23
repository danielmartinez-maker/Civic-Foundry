import test from 'node:test';
import assert from 'node:assert/strict';
import { EconomyPanel } from '../src/ui/EconomyPanel.ts';
import { renderFirmInspection, type FirmInspectionDto } from '../src/ui/Inspector.ts';
import { mapEconomyOverlay, type EconomyOverlayMode } from '../src/rendering/EconomyOverlayLayer.ts';
import { locateFreightVehicle } from '../src/rendering/FreightVehicleRenderer.ts';
import { collectHudMetrics } from '../src/ui/Hud.ts';
import type { EconomyDomainSnapshot } from '../src/simulation/economy/EconomyScheduler.ts';
import { SimulationCore } from '../src/simulation/core/SimulationCore.ts';
import { TerrainGrid, type TerrainCell } from '../src/world/terrain/TerrainGrid.ts';
import { FreightVehicleSystem, type FreightShipment } from '../src/simulation/economy/FreightVehicleSystem.ts';

function sampleEconomySnapshot():EconomyDomainSnapshot{return {activeFirms:12,formingFirms:2,distressedFirms:3,closedFirms:1,employment:{workforce:100,totalJobs:88,employed:75,unemployed:25,vacancies:13,unemploymentRate:.25},industrialOutput:46,wholesaleThroughput:31,retailSales:920,shortageRate:.18,freightVolumeInTransit:74,averageFreightDelay:12,averageLogisticsCost:23,queuedOrders:4,queueDelay:35,cumulativeImports:150,cumulativeExports:90,cumulativeImportValue:1200,cumulativeExportValue:1440,businessFormations:14,businessClosures:2,aggregateFirmHealth:.62};}
function sampleDistressedFirmInspection():FirmInspectionDto{return {id:'firm:7',archetype:'light_manufacturing',status:'distressed',filledJobs:8,jobCapacity:14,vacancies:6,throughput:2.5,inputShortage:.4,logisticsCost:18,operatingMargin:-12,cashHealth:.22,distressReason:'logistics cost',inventories:{industrial_inputs:3,manufactured_goods:12,consumer_goods:0},inboundShipments:2,outboundShipments:1};}
function flat(width=12,height=6){const cells:TerrainCell[]=Array.from({length:width*height},()=>({elevation:.5,water:false,buildable:true,biome:'grass' as const}));return new TerrainGrid(width,height,cells);}
function economyCore(){const core=new SimulationCore({terrain:flat(),startingFunds:1_000_000,seed:17});core.buildRoad(Array.from({length:12},(_,x)=>({x,y:3})),'collector');for(let x=3;x<=5;x++)core.paintZone([{x,y:2}],'commercial');for(let x=6;x<=8;x++)core.paintZone([{x,y:2}],'industrial');core.step(800);return core;}

test('economy panel includes authoritative citywide causal metrics',()=>{const html=new EconomyPanel().render(sampleEconomySnapshot());for(const label of ['Active firms','Industrial output','Retail sales','Input shortage','Freight delay','Imports','Exports'])assert.match(html,new RegExp(label));});

test('firm inspection exposes shortage logistics margin and cash health',()=>{const html=renderFirmInspection(sampleDistressedFirmInspection());for(const label of ['Input shortage','Logistics cost','Operating margin','Cash health'])assert.match(html,new RegExp(label));});

test('all economy overlays expose deterministic legends and authoritative values',()=>{const core=economyCore();const modes:EconomyOverlayMode[]=['firm-health','jobs','production','shortages','freight-volume','freight-routes','logistics-delay','gateways','trade-flow'];for(const mode of modes){const mapped=mapEconomyOverlay(core,mode);assert.equal(mapped.mode,mode);assert.ok(mapped.legend.length>0);assert.match(mapped.legend,/\d|%|flow|route|firm|job|stock|delay/i);}});

test('HUD exposes Phase 6 economy totals from the scheduler snapshot',()=>{const core=economyCore();const economy=core.economyDomain.snapshot(core.clock.tick);const hud=collectHudMetrics(core);assert.equal(hud.activeFirms,economy.activeFirms);assert.equal(hud.distressedFirms,economy.distressedFirms);assert.equal(hud.inputShortageRate,economy.shortageRate);assert.equal(hud.freightVolumeInTransit,economy.freightVolumeInTransit);assert.equal(hud.importVolume,economy.cumulativeImports);assert.equal(hud.exportVolume,economy.cumulativeExports);});

test('freight render position derives from authoritative route progress',()=>{const core=new SimulationCore({terrain:flat(),startingFunds:100_000});core.buildRoad(Array.from({length:12},(_,x)=>({x,y:3})),'collector');core.transportationGraph.rebuildIfNeeded(core.roads);const start=core.transportationGraph.findNodeAt(0,3)!;const end=core.transportationGraph.findNodeAt(11,3)!;const route=core.pathfinding.findRoute(core.transportationGraph,start.id,end.id)!;const shipment:FreightShipment={id:'shipment:p',orderId:'order:p',commodity:'industrial_inputs',quantity:10,vehicleWeight:1,originKind:'gateway',originId:'gateway:0:3',destinationKind:'firm',destinationId:'firm:1',originNodeId:start.id,destinationNodeId:end.id,createdTick:0,generalizedCost:route.totalCost};const system=new FreightVehicleSystem();const vehicle=system.dispatch(shipment,route,0);const position=locateFreightVehicle(vehicle,core.transportationGraph,new Map());assert.deepEqual(position,{x:0,y:3});});
