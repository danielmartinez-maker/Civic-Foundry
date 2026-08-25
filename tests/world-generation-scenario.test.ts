import test from 'node:test';import assert from 'node:assert/strict';
import { RandomStreamRegistry } from '../src/simulation/kernel/RandomStreamRegistry.ts';
import { normalizePolygon } from '../src/world/geometry/PolygonMath.ts';
import { resolveWorldGenerationConfig } from '../src/world/generation/WorldGenerationConfig.ts';
import { generateWorldComponents } from '../src/world/generation/WorldGenerator.ts';
import type { ScenarioWorldDefinition } from '../src/world/generation/ScenarioWorldDefinition.ts';

const lake=normalizePolygon([{x:5,y:0},{x:8,y:0},{x:8,y:6},{x:5,y:6}]);
const dirty=normalizePolygon([{x:0,y:0},{x:2,y:0},{x:2,y:2},{x:0,y:2}]);
const clay=normalizePolygon([{x:2,y:2},{x:5,y:2},{x:5,y:5},{x:2,y:5}]);
const scenario:ScenarioWorldDefinition={id:'authored',generation:{preset:'basin'},elevationOverrides:[{x:2,y:2,elevationMeters:17}],permanentWaterPolygons:[{class:'lake',polygon:lake}],soilRegions:[{soilClass:'clay',polygon:clay}],groundwaterRegions:[{depthMeters:.4,polygon:clay}],contaminationRegions:[{index:.7,polygon:dirty}]};

test('scenario generation settings and physical overrides take precedence over generated terrain',()=>{const base=resolveWorldGenerationConfig({width:8,height:6,preset:'plain'});const g=generateWorldComponents(77,base,new RandomStreamRegistry(77),scenario);assert.equal(g.config.preset,'basin');assert.equal(g.scenarioId,'authored');assert.equal(g.terrain.getPhysical(2,2).elevationMeters,17);assert.equal(g.terrain.getPhysical(3,3).soilClass,'clay');assert.equal(g.terrain.getPhysical(3,3).groundwaterDepthMeters,.4);assert.equal(g.terrain.getPhysical(0,0).contaminationIndex,.7);assert.equal(g.terrain.getPhysical(6,2).surfaceWater,'lake');assert.equal(g.terrain.getPhysical(6,2).buildable,false);});

test('generated worlds keep contamination zero unless a scenario authors it',()=>{const c=resolveWorldGenerationConfig({width:8,height:6,preset:'plain'});const g=generateWorldComponents(77,c,new RandomStreamRegistry(77));assert.equal(g.terrain.snapshotAuthoritative().samples.every(s=>s.contaminationIndex===0),true);});

test('same seed plus scenario is byte-equivalent',()=>{const c=resolveWorldGenerationConfig({width:8,height:6,preset:'plain'});const a=generateWorldComponents(42,c,new RandomStreamRegistry(42),scenario);const b=generateWorldComponents(42,c,new RandomStreamRegistry(42),scenario);assert.deepEqual(a.terrain.snapshotAuthoritative(),b.terrain.snapshotAuthoritative());assert.deepEqual(a.hydrology.snapshotAuthoritative(),b.hydrology.snapshotAuthoritative());assert.deepEqual(a.geography.snapshot(),b.geography.snapshot());});

test('malformed scenario overrides are rejected before generation completes',()=>{const c=resolveWorldGenerationConfig({width:8,height:6});assert.throws(()=>generateWorldComponents(1,c,new RandomStreamRegistry(1),{id:'bad',elevationOverrides:[{x:99,y:0,elevationMeters:1}]}),/out of bounds/);assert.throws(()=>generateWorldComponents(1,c,new RandomStreamRegistry(1),{id:'bad-root',rootBoundary:normalizePolygon([{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}])}),/root boundary/);});
