import test from 'node:test';
import assert from 'node:assert/strict';
import { SOIL_PROPERTIES, calculateLandPreparationMultiplier } from '../src/world/terrain/SoilModel.ts';
import { TerrainField } from '../src/world/terrain/TerrainField.ts';
import type { TerrainPhysicalSample } from '../src/world/terrain/TerrainTypes.ts';

function sample(patch: Partial<TerrainPhysicalSample> = {}): TerrainPhysicalSample {
  return {
    elevationMeters: 120,
    slope: 0.08,
    aspectRadians: 0,
    soilClass: 'loam',
    soilDepthMeters: 2,
    bearingCapacityKpa: 160,
    bedrockDepthMeters: 4,
    groundwaterDepthMeters: 6,
    vegetationClass: 'grass',
    contaminationIndex: 0,
    landPreparationMultiplier: 1,
    surfaceWater: 'none',
    buildable: true,
    ...patch,
  };
}

test('soil model exposes exactly eight locked engineering property sets', () => {
  assert.deepEqual(Object.keys(SOIL_PROPERTIES).sort(), ['alluvium','clay','fill_disturbed','gravel','loam','peat','rock','sand']);
  for (const properties of Object.values(SOIL_PROPERTIES)) {
    assert.ok(Number.isFinite(properties.infiltrationMmPerHour) && properties.infiltrationMmPerHour >= 0);
    assert.ok(Number.isFinite(properties.bearingCapacityKpa) && properties.bearingCapacityKpa > 0);
    assert.ok(Number.isFinite(properties.erodibility) && properties.erodibility >= 0 && properties.erodibility <= 1);
    assert.ok(Number.isFinite(properties.preparationBase) && properties.preparationBase > 0);
  }
});

test('weak wet peat costs more to prepare than strong drained gravel', () => {
  const gravel = calculateLandPreparationMultiplier({ slope:0.05, soilClass:'gravel', bedrockDepthMeters:3, groundwaterDepthMeters:8, contaminationIndex:0, floodSusceptibility:0 });
  const peat = calculateLandPreparationMultiplier({ slope:0.05, soilClass:'peat', bedrockDepthMeters:8, groundwaterDepthMeters:0.5, contaminationIndex:0, floodSusceptibility:0.6 });
  assert.ok(peat > gravel);
  assert.ok(gravel >= 0.75 && peat <= 3);
});

test('slope, shallow groundwater, contamination, deep bedrock, and flood susceptibility increase preparation cost directionally', () => {
  const base = { slope:0.05, soilClass:'loam' as const, bedrockDepthMeters:3, groundwaterDepthMeters:8, contaminationIndex:0, floodSusceptibility:0 };
  const baseline = calculateLandPreparationMultiplier(base);
  assert.ok(calculateLandPreparationMultiplier({ ...base, slope:0.35 }) > baseline);
  assert.ok(calculateLandPreparationMultiplier({ ...base, groundwaterDepthMeters:0.6 }) > baseline);
  assert.ok(calculateLandPreparationMultiplier({ ...base, contaminationIndex:0.8 }) > baseline);
  assert.ok(calculateLandPreparationMultiplier({ ...base, bedrockDepthMeters:12 }) > baseline);
  assert.ok(calculateLandPreparationMultiplier({ ...base, floodSusceptibility:0.8 }) > baseline);
});

test('TerrainField derives permanent water and extreme slopes as unbuildable without banning contamination alone', () => {
  const field = TerrainField.fromSamples(3, 1, 30, [
    sample({ surfaceWater:'lake', buildable:true }),
    sample({ slope:0.9, buildable:true }),
    sample({ contaminationIndex:1, buildable:true }),
  ]);
  assert.equal(field.isBuildable(0,0), false);
  assert.equal(field.isBuildable(1,0), false);
  assert.equal(field.isBuildable(2,0), true);
});

test('TerrainField validates dimensions and physical values and returns isolated snapshots', () => {
  assert.throws(() => TerrainField.fromSamples(2, 2, 30, [sample()]), /sample count/);
  assert.throws(() => TerrainField.fromSamples(1, 1, 30, [sample({ elevationMeters:Number.NaN })]), /finite/);
  const field = TerrainField.fromSamples(2, 1, 30, [sample({ landPreparationMultiplier:1.2 }), sample({ elevationMeters:121 })]);
  assert.equal(field.inBounds(1,0), true);
  assert.equal(field.inBounds(2,0), false);
  assert.equal(field.preparationMultiplierAt(0,0), 1.2);
  assert.equal(field.getPhysical(1,0).elevationMeters, 121);
  const snapshot = field.snapshotAuthoritative();
  const mutated = structuredClone(snapshot) as { samples: TerrainPhysicalSample[] };
  mutated.samples[0] = sample({ elevationMeters:999 });
  assert.equal(field.getPhysical(0,0).elevationMeters, 120);
  assert.deepEqual(TerrainField.restore(snapshot).snapshotAuthoritative(), snapshot);
});
