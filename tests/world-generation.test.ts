import test from 'node:test';
import assert from 'node:assert/strict';
import { RandomStreamRegistry } from '../src/simulation/kernel/RandomStreamRegistry.ts';
import { resolveWorldGenerationConfig, WORLD_FORM_PRESETS } from '../src/world/generation/WorldGenerationConfig.ts';
import { generatePhysicalTerrain, type TerrainGenerationStreams } from '../src/world/terrain/TerrainGenerator.ts';

function streams(seed:number): TerrainGenerationStreams {
  const registry = new RandomStreamRegistry(seed);
  return {
    topography: registry.stream('world.topography'),
    soils: registry.stream('world.soils'),
    groundwater: registry.stream('world.groundwater'),
    vegetation: registry.stream('world.vegetation'),
  };
}

test('generation config validates dimensions and exposes exactly six presets', () => {
  assert.deepEqual(WORLD_FORM_PRESETS, ['plain','river_valley','basin','rolling_uplands','ridge_edge','coastal_lowland']);
  assert.deepEqual(resolveWorldGenerationConfig({ width:20,height:14,metersPerCell:25,preset:'plain' }), { width:20,height:14,metersPerCell:25,preset:'plain' });
  assert.throws(() => resolveWorldGenerationConfig({ width:0 }), /width/);
  assert.throws(() => resolveWorldGenerationConfig({ metersPerCell:-1 }), /metersPerCell/);
});

test('same seed and config produce byte-equivalent physical terrain while different seeds differ', () => {
  const config = resolveWorldGenerationConfig({ width:24,height:16,preset:'rolling_uplands' });
  const a = generatePhysicalTerrain(config, streams(42)).snapshotAuthoritative();
  const b = generatePhysicalTerrain(config, streams(42)).snapshotAuthoritative();
  const c = generatePhysicalTerrain(config, streams(43)).snapshotAuthoritative();
  assert.deepEqual(a,b);
  assert.notDeepEqual(a.samples.map(s=>s.elevationMeters), c.samples.map(s=>s.elevationMeters));
});

test('all six presets produce finite playable physical terrain with zero generated contamination', () => {
  for (const preset of WORLD_FORM_PRESETS) {
    const config = resolveWorldGenerationConfig({ width:28,height:18,preset });
    const field = generatePhysicalTerrain(config, streams(100 + WORLD_FORM_PRESETS.indexOf(preset)));
    let buildable = 0;
    for (const sample of field.snapshotAuthoritative().samples) {
      for (const value of [sample.elevationMeters,sample.slope,sample.aspectRadians,sample.soilDepthMeters,sample.bearingCapacityKpa,sample.bedrockDepthMeters,sample.groundwaterDepthMeters,sample.landPreparationMultiplier]) assert.ok(Number.isFinite(value));
      assert.equal(sample.contaminationIndex, 0);
      if (sample.buildable) buildable++;
    }
    const fraction = buildable / (config.width * config.height);
    assert.ok(fraction > 0.25, `${preset} buildable fraction ${fraction}`);
    assert.ok(fraction <= 1);
    if (preset === 'coastal_lowland') assert.ok(fraction < 0.95, `coastal buildable fraction ${fraction}`);
  }
});

test('named RNG streams isolate vegetation draws from topography, soil, and groundwater', () => {
  const config = resolveWorldGenerationConfig({ width:20,height:12,preset:'river_valley' });
  const normal = streams(987);
  const perturbed = streams(987);
  for (let i=0;i<100;i++) perturbed.vegetation.next();
  const a = generatePhysicalTerrain(config, normal).snapshotAuthoritative();
  const b = generatePhysicalTerrain(config, perturbed).snapshotAuthoritative();
  assert.deepEqual(a.samples.map(s=>[s.elevationMeters,s.slope,s.soilClass,s.groundwaterDepthMeters]), b.samples.map(s=>[s.elevationMeters,s.slope,s.soilClass,s.groundwaterDepthMeters]));
  assert.notDeepEqual(a.samples.map(s=>s.vegetationClass), b.samples.map(s=>s.vegetationClass));
});
