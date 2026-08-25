import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILDING_VARIANTS } from '../src/data/buildings.ts';
import { UrbanFabricDomain } from '../src/simulation/urban/UrbanFabricDomain.ts';
import { buildUrbanBuildingView } from '../src/simulation/urban/UrbanBuildingView.ts';
import { RenovationSystem } from '../src/simulation/urban/RenovationSystem.ts';
import type { Building } from '../src/simulation/buildings/BuildingSystem.ts';
import type { UrbanBuildingState } from '../src/simulation/urban/UrbanTypes.ts';

const building: Building = Object.freeze({
  id: 'building:a',
  lotId: 'lot:a',
  x: 2,
  y: 3,
  zone: 'residential',
  definitionId: 'residential_rowhouse',
  status: 'occupied',
  constructionStartedTick: 0,
  completionTick: 70,
});

function urbanState(overrides: Partial<UrbanBuildingState> = {}): UrbanBuildingState {
  return {
    buildingId: building.id,
    useComponents: [{
      use: 'residential',
      areaShareBps: 10_000,
      residentCapacity: 28,
      jobCapacity: 0,
      taxBase: 250,
    }],
    qualityTier: 'standard',
    conditionScore: 55,
    lifecycleState: 'aging',
    conditionEstablishedTick: 0,
    lastConditionTick: 500,
    renovationCount: 0,
    parking: { profile: 'standard', spaces: 6 },
    ...overrides,
  };
}

function harness(overrides: Partial<UrbanBuildingState> = {}) {
  const domain = new UrbanFabricDomain();
  domain.install(urbanState(overrides));
  return { domain, renovation: new RenovationSystem(domain) };
}

test('renovation halves capacity and restores condition without changing structural semantics', () => {
  const { domain, renovation } = harness();
  const before = domain.get(building.id)!;
  const definition = BUILDING_VARIANTS.residential[1]!;

  const job = renovation.start({
    buildingId: building.id,
    developerId: 'developer:1',
    startTick: 500,
    definition,
  });

  assert.ok(job.cost > 0);
  assert.ok(job.completionTick > job.startTick);
  assert.equal(job.targetCondition, 90);
  assert.equal(domain.get(building.id)!.lifecycleState, 'renovating');
  assert.equal(buildUrbanBuildingView(building, domain.get(building.id)!).conditionCapacityMultiplier, 0.5);
  assert.equal(renovation.hasActive(building.id), true);
  assert.throws(() => renovation.start({
    buildingId: building.id,
    developerId: 'developer:2',
    startTick: 501,
    definition,
  }), /renovation|commitment|active/i);

  renovation.tick(job.completionTick - 1);
  assert.equal(domain.get(building.id)!.lifecycleState, 'renovating');
  renovation.tick(job.completionTick);

  const after = domain.get(building.id)!;
  assert.equal(after.conditionScore, 90);
  assert.equal(after.renovationCount, 1);
  assert.equal(after.lifecycleState, 'lease-up');
  assert.equal(renovation.hasActive(building.id), false);
  assert.deepEqual(after.useComponents, before.useComponents);
  assert.equal(after.qualityTier, before.qualityTier);
  assert.deepEqual(after.parking, before.parking);
});

test('renovation cost and duration rise with quality or complexity', () => {
  const standard = harness();
  const premium = harness({ qualityTier: 'premium' });
  const lowDefinition = BUILDING_VARIANTS.residential[0]!;
  const highDefinition = BUILDING_VARIANTS.residential[2]!;

  const standardLow = standard.renovation.evaluateCandidate({
    buildingId: building.id,
    developerId: 'developer:1',
    startTick: 1_000,
    definition: lowDefinition,
  });
  const premiumHigh = premium.renovation.evaluateCandidate({
    buildingId: building.id,
    developerId: 'developer:1',
    startTick: 1_000,
    definition: highDefinition,
  });

  assert.ok(premiumHigh.cost > standardLow.cost);
  assert.ok(premiumHigh.completionTick > standardLow.completionTick);
});

test('renovation snapshot restore preserves deterministic continuation', () => {
  const first = harness();
  const definition = BUILDING_VARIANTS.residential[1]!;
  const job = first.renovation.start({
    buildingId: building.id,
    developerId: 'developer:1',
    startTick: 800,
    definition,
  });
  const snapshot = first.renovation.snapshotState();

  const restoredDomain = new UrbanFabricDomain();
  restoredDomain.restoreState(first.domain.snapshotState());
  const restored = new RenovationSystem(restoredDomain);
  restored.restoreState(snapshot);

  first.renovation.tick(job.completionTick);
  restored.tick(job.completionTick);
  assert.deepEqual(restored.snapshotState(), first.renovation.snapshotState());
  assert.deepEqual(restoredDomain.snapshotState(), first.domain.snapshotState());
});
