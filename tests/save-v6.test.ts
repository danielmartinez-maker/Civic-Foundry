import test from 'node:test';
import assert from 'node:assert/strict';
import { hydrateCoreV6, serializeCoreV6, serializeCoreV5 } from '../src/save/save.ts';
import { SimulationCore } from '../src/simulation/core/SimulationCore.ts';
import { TerrainGrid, type TerrainCell } from '../src/world/terrain/TerrainGrid.ts';

function flat(width=40,height=24){const cells:TerrainCell[]=Array.from({length:width*height},()=>({elevation:0.5,water:false,buildable:true,biome:'grass' as const}));return new TerrainGrid(width,height,cells);}
function buildCity():SimulationCore{
  const core=new SimulationCore({terrain:flat(),startingFunds:1_000_000,seed:77});
  core.buildRoad(Array.from({length:40},(_,x)=>({x,y:12})),'collector');
  for(let x=4;x<=12;x++) core.paintZone([{x,y:11}],'residential');
  for(let x=22;x<=27;x++) core.paintZone([{x,y:11}],'commercial');
  for(let x=28;x<=34;x++) core.paintZone([{x,y:11}],'industrial');
  for(const [x,y] of [[6,13],[10,13],[14,13]] as const) core.placeUtility('power',x,y);
  for(const [x,y] of [[18,13],[22,13],[26,13]] as const) core.placeUtility('water',x,y);
  for(const [x,y] of [[30,13],[33,13],[36,13]] as const) core.placeUtility('landfill',x,y);
  return core;
}
function advanceUntilFreight(core:SimulationCore,max=3500):void{
  for(let i=0;i<max && core.economyDomain.freightVehicles.activeCount()===0;i++) core.step(1);
  assert.ok(core.economyDomain.freightVehicles.activeCount()>0,'expected active freight before save');
}

test('explicit Save V6 serializer preserves the Phase 6 economy envelope',()=>{
  const core=buildCity(); core.step(1200);
  const save=serializeCoreV6(core);
  assert.equal(save.saveVersion,6);
  assert.equal(save.gameVersion,'0.6.0-metropolitan');
  assert.ok('economyDomain' in save);
});

test('loading V5 through the V6 hydrator does not fabricate Phase 6 economic history',()=>{
  const core=buildCity(); core.step(800);
  const v5=serializeCoreV5(core);
  const loaded=hydrateCoreV6(v5);
  const economy=loaded.economyDomain.snapshot(loaded.clock.tick);
  assert.equal(economy.activeFirms,0);
  assert.equal(economy.cumulativeImports,0);
  assert.equal(economy.cumulativeExports,0);
  assert.equal(economy.businessFormations,0);
  assert.equal(economy.businessClosures,0);
});

test('Save V6 resumes active firms freight and financial accruals identically',()=>{
  const uninterrupted=buildCity(); advanceUntilFreight(uninterrupted);
  const save=serializeCoreV6(uninterrupted);
  const loaded=hydrateCoreV6(structuredClone(save));
  assert.deepEqual(serializeCoreV6(loaded),save);
  uninterrupted.step(700); loaded.step(700);
  assert.deepEqual(serializeCoreV6(loaded),serializeCoreV6(uninterrupted));
});

test('Save V6 rejects freight routes referencing missing road edges',()=>{
  const core=buildCity(); advanceUntilFreight(core);
  const save=structuredClone(serializeCoreV6(core));
  assert.ok(save.economyDomain.freightVehicles.vehicles.length>0);
  save.economyDomain.freightVehicles.vehicles[0]!.routeEdgeIds=['missing-edge'];
  assert.throws(()=>hydrateCoreV6(save),/freight.*road|road.*freight/i);
});