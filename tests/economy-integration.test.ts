import test from 'node:test';
import assert from 'node:assert/strict';
import { SimulationCore } from '../src/simulation/core/SimulationCore.ts';
import { TerrainGrid, type TerrainCell } from '../src/world/terrain/TerrainGrid.ts';

function flat(width=40,height=24){const cells:TerrainCell[]=Array.from({length:width*height},()=>({elevation:0.5,water:false,buildable:true,biome:'grass' as const}));return new TerrainGrid(width,height,cells);}
export function buildBoundaryConnectedMixedUseCity():SimulationCore{
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

test('city employment equals active establishment employment after lifecycle formation',()=>{
  const core=buildBoundaryConnectedMixedUseCity(); core.step(1200);
  const active=core.economyDomain.firms.list().filter(f=>f.status==='operating'||f.status==='distressed');
  assert.ok(active.length>0);
  assert.equal(core.employmentSnapshot.totalJobs,active.reduce((s,f)=>s+f.jobCapacity,0));
  assert.equal(core.employmentSnapshot.employed,active.reduce((s,f)=>s+f.filledJobs,0));
});

test('boundary-connected operating economy eventually creates freight',()=>{
  const core=buildBoundaryConnectedMixedUseCity(); core.step(1500);
  assert.ok(core.economyDomain.snapshot().cumulativeImports>0 || core.economyDomain.freightVehicles.activeCount()>0);
});

test('freight edge load participates in core traffic metrics',()=>{
  const core=buildBoundaryConnectedMixedUseCity(); core.step(1500);
  const freightLoads=core.economyDomain.freightVehicles.edgeLoads();
  if(Object.keys(freightLoads).length>0) assert.ok(core.traffic.edgeMetrics.some(m=>(freightLoads[m.edgeId]??0)>0 && m.weightedVehicles>0));
});
