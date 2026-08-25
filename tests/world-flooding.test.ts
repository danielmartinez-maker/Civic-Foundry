import test from 'node:test';
import assert from 'node:assert/strict';
import { FloodModel } from '../src/world/hydrology/FloodModel.ts';
import { HydrologyModel } from '../src/world/hydrology/HydrologyModel.ts';
import { TerrainField } from '../src/world/terrain/TerrainField.ts';
import type { SoilClass, TerrainPhysicalSample } from '../src/world/terrain/TerrainTypes.ts';

function field(centerSoil: SoilClass = 'loam'): TerrainField {
  const samples: TerrainPhysicalSample[] = Array.from({ length: 9 }, (_, index) => ({
    elevationMeters: [3,2,1,3,2,1,3,2,1][index]!, slope:0.05, aspectRadians:0,
    soilClass:index===4?centerSoil:'loam', soilDepthMeters:2, bearingCapacityKpa:160,
    bedrockDepthMeters:5, groundwaterDepthMeters:3, vegetationClass:'grass', contaminationIndex:0,
    landPreparationMultiplier:1, surfaceWater:'none', buildable:true,
  }));
  return TerrainField.fromSamples(3,3,30,samples);
}
function hydro(terrain:TerrainField):HydrologyModel { return HydrologyModel.build(terrain,new Float64Array([3,2,1,3,2,1,3,2,1])); }
const runoff = (result: ReturnType<FloodModel['run']>) => result.rainfallVolume - result.infiltrationVolume;

test('zero rainfall produces exact zero flood state and balance', () => {
  const terrain=field(); const result=new FloodModel().run({id:'zero',rainfallMm:0,durationHours:2},terrain,hydro(terrain));
  assert.deepEqual(result.depthMeters,Array(9).fill(0));
  assert.equal(result.rainfallVolume,0); assert.equal(result.infiltrationVolume,0); assert.equal(result.balanceError,0);
});

test('more rainfall cannot reduce runoff and repeated identical events are deterministic', () => {
  const terrain=field(); const model=hydro(terrain); const flood=new FloodModel();
  const low=flood.run({id:'low',rainfallMm:40,durationHours:2},terrain,model);
  const high=flood.run({id:'high',rainfallMm:80,durationHours:2},terrain,model);
  assert.ok(runoff(high)>=runoff(low));
  assert.deepEqual(flood.run({id:'high',rainfallMm:80,durationHours:2},terrain,model),high);
  assert.equal(high.depthMeters.every((value)=>Number.isFinite(value)&&value>=0),true);
});

test('clay infiltrates less than gravel under the same storm', () => {
  const clay=field('clay'); const gravel=field('gravel'); const flood=new FloodModel();
  const clayResult=flood.run({id:'soil',rainfallMm:80,durationHours:2},clay,hydro(clay));
  const gravelResult=flood.run({id:'soil',rainfallMm:80,durationHours:2},gravel,hydro(gravel));
  assert.ok(clayResult.infiltrationVolume<gravelResult.infiltrationVolume);
});

test('impervious surface reduces infiltration and every event closes its water balance', () => {
  const terrain=field(); const model=hydro(terrain); const flood=new FloodModel();
  const natural=flood.run({id:'surface',rainfallMm:80,durationHours:2},terrain,model);
  const paved=flood.run({id:'surface',rainfallMm:80,durationHours:2},terrain,model,{imperviousFractionAt:()=>1});
  assert.ok(paved.infiltrationVolume<natural.infiltrationVolume);
  for(const result of [natural,paved]) {
    const tolerance=Math.max(1e-9,result.rainfallVolume*1e-9);
    assert.ok(Math.abs(result.balanceError)<=tolerance,`balance ${result.balanceError}`);
  }
});
