import test from 'node:test';
import assert from 'node:assert/strict';
import { hydrateCore, serializeCore, serializeCoreV7 } from '../src/save/save.ts';
import { SimulationCore } from '../src/simulation/core/SimulationCore.ts';
import { TerrainGrid, type TerrainCell } from '../src/world/terrain/TerrainGrid.ts';
import type { UrbanBuildingState } from '../src/simulation/urban/UrbanTypes.ts';

function flatTerrain(width = 8, height = 8): TerrainGrid {
  const cells: TerrainCell[] = Array.from({ length: width * height }, () => ({
    elevation: 0.5,
    water: false,
    buildable: true,
    biome: 'grass' as const,
  }));
  return new TerrainGrid(width, height, cells);
}

function coreWithResidentialBuilding(mode: 'legacy' | 'semantic' = 'semantic'): { core: SimulationCore; buildingId: string } {
  const core = new SimulationCore({
    terrain: flatTerrain(),
    startingFunds: 250_000,
    seed: 83,
    urbanDevelopmentMode: mode,
  });
  assert.equal(core.buildRoad([{ x: 1, y: 2 }, { x: 2, y: 2 }], 'local').ok, true);
  assert.equal(core.paintZone([{ x: 1, y: 1 }], 'residential').painted, 1);
  const lot = core.lots.list().find((item) => item.id === 'lot:1,1');
  assert.ok(lot);
  const buildingId = `building:${lot.id}`;
  core.buildings.restore([{
    id: buildingId,
    lotId: lot.id,
    x: lot.x,
    y: lot.y,
    zone: 'residential',
    definitionId: 'residential_rowhouse',
    status: 'occupied',
    constructionStartedTick: 0,
    completionTick: 0,
  }]);
  if (mode === 'semantic') {
    core.urbanFabric.install({
      buildingId,
      useComponents: [{ use: 'residential', areaShareBps: 10_000, residentCapacity: 28, jobCapacity: 0, taxBase: 250 }],
      qualityTier: 'premium',
      conditionScore: 63,
      lifecycleState: 'aging',
      conditionEstablishedTick: 0,
      lastConditionTick: 0,
      renovationCount: 2,
      parking: { profile: 'standard', spaces: 6 },
    });
  }
  return { core, buildingId };
}

function asMutableSave(value: unknown): any {
  return structuredClone(value) as any;
}

function semanticSave(): { save: any; buildingId: string } {
  const { core, buildingId } = coreWithResidentialBuilding('semantic');
  return { save: asMutableSave(serializeCore(core)), buildingId };
}

test('V7 migration establishes explicit B1 baseline at the migration tick', () => {
  const { core: legacy } = coreWithResidentialBuilding('legacy');
  legacy.clock.restore(137, 1);
  const v7 = serializeCoreV7(legacy);

  const migrated = hydrateCore(asMutableSave(v7));
  const save = serializeCore(migrated) as any;

  assert.equal(save.saveVersion, 8);
  assert.equal(save.gameVersion, '0.8.0-urban-fabric');
  assert.equal(migrated.urbanDevelopmentMode, 'semantic');
  assert.equal(save.urbanFabricState.buildings.length, 1);
  const state = save.urbanFabricState.buildings[0] as UrbanBuildingState;
  assert.equal(state.qualityTier, 'standard');
  assert.equal(state.conditionScore, 80);
  assert.deepEqual(state.parking, { profile: 'legacy-none', spaces: 0 });
  assert.equal(state.lifecycleState, 'stabilized');
  assert.equal(state.conditionEstablishedTick, 137);
  assert.equal(state.lastConditionTick, 137);
  assert.equal(state.renovationCount, 0);

  migrated.step(62);
  assert.equal(migrated.clock.tick, 199);
  assert.equal(migrated.urbanFabric.get(state.buildingId)!.conditionScore, 80);
  migrated.step(1);
  assert.ok(migrated.urbanFabric.get(state.buildingId)!.conditionScore < 80);
});

test('V8 round trip is byte-equivalent for authoritative semantic state', () => {
  const { core } = coreWithResidentialBuilding('semantic');
  const raw = JSON.stringify(serializeCore(core));
  const parsed = JSON.parse(raw) as any;
  assert.equal(parsed.saveVersion, 8);
  assert.deepEqual(parsed.urbanFabricState, core.urbanFabric.snapshotState());
  assert.deepEqual(parsed.renovationState, core.renovation.snapshotState());

  const restored = hydrateCore(JSON.parse(raw));
  assert.equal(restored.urbanDevelopmentMode, 'semantic');
  assert.equal(JSON.stringify(serializeCore(restored)), raw);
});

test('V8 preserves active renovation commitments exactly', () => {
  const { core, buildingId } = coreWithResidentialBuilding('semantic');
  const current = core.urbanFabric.get(buildingId)!;
  core.urbanFabric.replace({ ...current, conditionScore: 55, lifecycleState: 'aging' });
  const commitment = core.startRenovation(buildingId, 'local_builder');

  const save = serializeCore(core) as any;
  assert.equal(save.saveVersion, 8);
  assert.deepEqual(save.renovationState.commitments, [commitment]);

  const restored = hydrateCore(asMutableSave(save));
  assert.deepEqual(restored.renovation.snapshotState(), core.renovation.snapshotState());
  assert.equal(restored.urbanFabric.get(buildingId)!.lifecycleState, 'renovating');
});

test('V8 preserves semantic developer commitment fields', () => {
  const { core, buildingId } = coreWithResidentialBuilding('semantic');
  const awards = core.developerMarket.allocate([{
    lotId: 'lot:1,1',
    definitionId: 'residential_rowhouse',
    zone: 'residential',
    legal: true,
    feasible: true,
    landValue: 12_000,
    accessScore: 0.85,
    achievableRent: 900,
    rentableCapacity: 28,
    grossPotentialRent: 9_000,
    vacancyRate: 0.05,
    effectiveGrossIncome: 8_550,
    operatingExpenses: 1_500,
    propertyTaxes: 12,
    netOperatingIncome: 24_000,
    hardConstructionCost: 30_000,
    parkingCost: 2_000,
    softCosts: 4_000,
    sitePreparationCost: 0,
    preFinanceDevelopmentCost: 45_000,
    marketFinancingCost: 1_000,
    totalDevelopmentCost: 46_000,
    capRate: 0.065,
    stabilizedValue: 180_000,
    yieldOnCost: 0.52,
    returnOnCost: 2.91,
    residualLandValue: 90_000,
    riskScore: 0.2,
    rejectionReasons: [],
    qualityTier: 'premium',
    parkingProfile: 'reduced',
    parkingSpaces: 2,
    useMixKey: 'residential_rowhouse',
  }], { tick: 10, marketInterestRate: 0.04 });
  assert.equal(awards.length, 1);
  assert.equal(awards[0]!.buildingId, buildingId);
  const before = core.developerMarket.listCommitments();
  assert.equal(before.length, 1);

  const save = serializeCore(core) as any;
  assert.equal(save.developmentMarket.commitments[0]!.qualityTier, 'premium');
  assert.equal(save.developmentMarket.commitments[0]!.parkingProfile, 'reduced');
  assert.equal(save.developmentMarket.commitments[0]!.parkingSpaces, 2);
  assert.equal(save.developmentMarket.commitments[0]!.useMixKey, 'residential_rowhouse');

  const restored = hydrateCore(asMutableSave(save));
  assert.deepEqual(restored.developerMarket.listCommitments(), before);
});

test('V8 rejects duplicate or missing urban semantic records', () => {
  const { save } = semanticSave();
  assert.equal(save.saveVersion, 8);

  const duplicate = asMutableSave(save);
  duplicate.urbanFabricState.buildings.push(structuredClone(duplicate.urbanFabricState.buildings[0]));
  assert.throws(() => hydrateCore(duplicate), /duplicate urban building/i);

  const missing = asMutableSave(save);
  missing.urbanFabricState.buildings = [];
  assert.throws(() => hydrateCore(missing), /missing urban semantic record/i);
});

test('V8 rejects bad semantic shares, enums, parking, and condition', () => {
  const { save } = semanticSave();

  const badShares = asMutableSave(save);
  badShares.urbanFabricState.buildings[0].useComponents[0].areaShareBps = 9_999;
  assert.throws(() => hydrateCore(badShares), /area shares/i);

  const badEnum = asMutableSave(save);
  badEnum.urbanFabricState.buildings[0].qualityTier = 'platinum';
  assert.throws(() => hydrateCore(badEnum), /quality tier/i);

  const badParking = asMutableSave(save);
  badParking.urbanFabricState.buildings[0].parking.spaces = -1;
  assert.throws(() => hydrateCore(badParking), /parking spaces/i);

  const badCondition = asMutableSave(save);
  badCondition.urbanFabricState.buildings[0].conditionScore = 101;
  assert.throws(() => hydrateCore(badCondition), /conditionScore/i);
});

test('V8 rejects abandoned buildings that still contain residents', () => {
  const { core } = coreWithResidentialBuilding('semantic');
  core.population.restore(6);
  core.restoreHousingState();
  const save = asMutableSave(serializeCore(core));
  assert.ok(save.housingState.allocations.some((item: any) => item.residents > 0));
  save.urbanFabricState.buildings[0].lifecycleState = 'abandoned';

  assert.throws(() => hydrateCore(save), /abandoned.*occup|occup.*abandoned/i);
});

test('V8 rejects renovation and redevelopment commitments for the same building', () => {
  const { core, buildingId } = coreWithResidentialBuilding('semantic');
  const current = core.urbanFabric.get(buildingId)!;
  core.urbanFabric.replace({ ...current, conditionScore: 55, lifecycleState: 'aging' });
  core.startRenovation(buildingId, 'local_builder');
  const save = asMutableSave(serializeCore(core));
  const developer = save.developmentMarket.developers.find((item: any) => item.id === 'local_builder');
  assert.ok(developer);
  developer.committedCapital += 1_000;
  save.developmentMarket.commitments.push({
    awardId: 'development:conflict',
    buildingId,
    lotId: 'lot:1,1',
    definitionId: 'residential_rowhouse',
    developerId: 'local_builder',
    qualityTier: 'standard',
    parkingProfile: 'legacy-none',
    parkingSpaces: 0,
    useMixKey: 'residential_rowhouse',
    equity: 1_000,
    awardTick: 0,
    completionTick: 100,
    releaseTick: 200,
    expectedReturn: 0.1,
  });

  assert.throws(() => hydrateCore(save), /renovation|redevelopment|conflict/i);
});
